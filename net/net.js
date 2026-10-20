// Net mini game (Phaser 3), image/theme based and responsive.
// Plain browser script; needs Phaser and net_gen.js loaded first.
//
// new NetGame(config, phaser_config)
//   config.maps          array of results from NetMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.responsive    true (default): the board scales to fill its container.
//                        false: fixed size, using tile_size pixels per tile.
//   config.max_tile_size responsive only: cap the tile size in pixels (default null = no cap)
//   config.tile_size     pixels per tile when responsive is false (default 48)
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, submit } on each win
//   config.debug         log each level's solution to the console
//   phaser_config        merged into the Phaser.Game config. Pass { parent: 'game' } with the
//                        id of the container element (it needs a real width and height).
//
// Responsive mode: the canvas always fills the container. On every resize the tile size
// becomes whole pixels of min(container width / columns, container height / rows) and the
// board is centred. Whatever space is left over shows theme.background_color.
//
// Controls: left click = rotate clockwise, right click = rotate counter-clockwise,
//           shift + click = lock/unlock a tile.
//
// Themes
//   A theme is a folder of images plus a few settings:
//     path              folder holding the images, e.g. 'assets/default/'
//     background        board background image (stretched over the board), or null
//     background_color  CSS color shown behind everything, including any spare space
//     tile_bg           optional image drawn under every tile, or null
//     images            filename for each image key (override any you rename)
//
//   Pipe images are drawn in their BASE orientation and the game rotates them:
//     end      opens North            (a computer / dead end)
//     straight opens North + South
//     corner   opens North + East
//     tee      opens North + East + South
//     cross    opens all four sides
//   Each has a powered twin named <shape>_on (e.g. corner_on.png).
//   server.png is drawn on top of the server tile, lock.png on top of locked tiles.
//   Because the board can be scaled up, supply art at 128px or more for large boards.

const NET_SHAPES = { end: 1, straight: 5, corner: 3, tee: 7, cross: 15 }  // base masks

const NET_THEME_DEFAULT = {
  path: 'assets/default/',
  background: 'background.png',
  background_color: '#222222',
  tile_bg: 'tile_bg.png',
  images: {
    end: 'end.png', end_on: 'end_on.png',
    straight: 'straight.png', straight_on: 'straight_on.png',
    corner: 'corner.png', corner_on: 'corner_on.png',
    tee: 'tee.png', tee_on: 'tee_on.png',
    cross: 'cross.png', cross_on: 'cross_on.png',
    server: 'server.png',
    lock: 'lock.png',
  },
}

// Which image + how many clockwise quarter-turns produces this mask?
const NET_MASK_LOOKUP = (() => {
  const table = {}
  for (const [shape, base] of Object.entries(NET_SHAPES)) {
    for (let turns = 0; turns < 4; turns++) {
      const m = NetMapGenerator.rotate(base, turns)
      if (!(m in table)) table[m] = { shape, turns }
    }
  }
  return table
})()

class NetGame {
  constructor(config = {}, phaser_config = {}) {
    this.config = Object.assign({
      map: null,
      maps: [],
      responsive: true,
      max_tile_size: null,
      tile_size: 48,
      theme: {},
      advance_delay: 1200,
      win_callback: null,
      debug: false,
    }, config)

    const t = this.config.theme || {}
    this.theme = Object.assign({}, NET_THEME_DEFAULT, t, {
      images: Object.assign({}, NET_THEME_DEFAULT.images, t.images),
    })

    this.levels = this.config.maps.length ? this.config.maps : (this.config.map ? [this.config.map] : [])
    if (!this.levels.length) throw new Error('NetGame needs map or maps')

    this.level_index = 0
    this.moves = 0
    this.solved = false
    this.sprites = []
    this.cells = []
    this.ts = 0   // current tile size in pixels, set by relayout()
    this.ox = 0   // board position inside the canvas
    this.oy = 0

    const self = this
    const base = {
      type: Phaser.AUTO,
      backgroundColor: this.theme.background_color,
      scene: {
        preload: function () { self.preload(this) },
        create: function () { self.create(this) },
      },
    }
    if (this.config.responsive) {
      base.scale = { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%', resizeInterval: 100 }
    } else {
      const first = this.levels[0].map
      base.width = first[0].length * this.config.tile_size
      base.height = first.length * this.config.tile_size
    }
    const scale = Object.assign({}, base.scale, phaser_config.scale)
    this.phaser = new Phaser.Game(Object.assign({}, base, phaser_config, { scale }))
  }

  preload(scene) {
    const t = this.theme
    scene.load.setPath(t.path)
    if (t.background) scene.load.image('net_background', t.background)
    if (t.tile_bg) scene.load.image('net_tile_bg', t.tile_bg)
    for (const [name, file] of Object.entries(t.images)) {
      scene.load.image(`net_${name}`, file)
    }
  }

  create(scene) {
    this.scene = scene
    this.msg = scene.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '32px', color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.65)', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(10).setVisible(false)

    scene.input.mouse.disableContextMenu()
    scene.input.on('pointerdown', (p) => this.on_click(p))
    scene.scale.on('resize', () => this.relayout())
    this.load_level(0)
  }

  clear_sprites() {
    this.sprites.forEach(s => s.destroy())
    this.sprites = []
    this.cells = []
  }

  load_level(i) {
    const lv = this.levels[i]
    this.level_index = i
    this.grid = lv.map.map(row => row.slice())
    this.server = lv.server
    this.rows = this.grid.length
    this.columns = this.grid[0].length
    this.locked = Array.from({ length: this.rows }, () => Array(this.columns).fill(false))
    this.moves = 0
    this.solved = false

    const scene = this.scene
    if (!this.config.responsive) {
      scene.scale.resize(this.columns * this.config.tile_size, this.rows * this.config.tile_size)
    }
    scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.msg.setVisible(false)

    if (this.config.debug) {
      console.log(`Level ${i + 1} solution:\n${NetMapGenerator.to_text(lv.solution)}`)
    }
    this.relayout()
  }

  // Work out tile size and board position from the current canvas size, then rebuild.
  // Runs on every level load and every container resize.
  relayout() {
    if (!this.grid) return
    const W = this.scene.scale.width, H = this.scene.scale.height
    if (W < 8 || H < 8) return  // container has no size yet

    let ts = this.config.tile_size
    if (this.config.responsive) {
      ts = Math.floor(Math.min(W / this.columns, H / this.rows))
      if (this.config.max_tile_size) ts = Math.min(ts, this.config.max_tile_size)
    }
    this.ts = Math.max(1, ts)
    this.ox = Math.floor((W - this.columns * this.ts) / 2)
    this.oy = Math.floor((H - this.rows * this.ts) / 2)

    this.msg.setPosition(W / 2, H / 2).setFontSize(Math.max(14, Math.round(this.ts * 0.7)))
    this.build_sprites()
    this.draw()
  }

  // Sprite layers: 0 board bg, 1 tile bg, 2 pipes, 3 server, 4 locks
  build_sprites() {
    const scene = this.scene
    const ts = this.ts, ox = this.ox, oy = this.oy
    this.clear_sprites()

    if (this.theme.background) {
      this.sprites.push(scene.add.image(ox, oy, 'net_background').setOrigin(0)
        .setDisplaySize(this.columns * ts, this.rows * ts).setDepth(0))
    }

    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const cx = ox + x * ts + ts / 2, cy = oy + y * ts + ts / 2
        if (this.theme.tile_bg) {
          this.sprites.push(scene.add.image(cx, cy, 'net_tile_bg').setDisplaySize(ts, ts).setDepth(1))
        }
        const pipe = scene.add.image(cx, cy, 'net_end').setDepth(2)
        const lock = scene.add.image(cx, cy, 'net_lock').setDisplaySize(ts, ts).setDepth(4).setVisible(false)
        this.sprites.push(pipe, lock)
        row.push({ pipe, lock })
      }
      this.cells.push(row)
    }

    const sx = ox + this.server.x * ts + ts / 2, sy = oy + this.server.y * ts + ts / 2
    this.sprites.push(scene.add.image(sx, sy, 'net_server').setDisplaySize(ts, ts).setDepth(3))
  }

  on_click(p) {
    if (this.solved || !this.ts) return
    const ts = this.ts
    const x = Math.floor((p.x - this.ox) / ts), y = Math.floor((p.y - this.oy) / ts)
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return

    if (p.event && p.event.shiftKey) {
      this.locked[y][x] = !this.locked[y][x]
    } else if (!this.locked[y][x]) {
      const times = p.rightButtonDown() ? -1 : 1
      this.grid[y][x] = NetMapGenerator.rotate(this.grid[y][x], times)
      this.moves++
    }
    this.draw()
    this.check_win()
  }

  check_win() {
    if (!NetMapGenerator.isSolved(this.grid, this.server)) return
    this.solved = true
    this.msg.setText('Solved!').setVisible(true)

    if (this.config.win_callback) {
      this.config.win_callback({
        level: this.level_index + 1,
        moves: this.moves,
        submit: `level=${this.level_index + 1};moves=${this.moves}`,
      })
    }

    if (this.level_index + 1 < this.levels.length) {
      this.scene.time.delayedCall(this.config.advance_delay, () => this.load_level(this.level_index + 1))
    }
  }

  // Update each tile's sprite from the current grid: textures swapped and rotated.
  draw() {
    const ts = this.ts
    const powered = NetMapGenerator.getPowered(this.grid, this.server)

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const info = NET_MASK_LOOKUP[this.grid[y][x]]
        const cell = this.cells[y][x]
        if (!info) { cell.pipe.setVisible(false); continue }  // empty tile (mask 0)

        const key = `net_${info.shape}${powered[y][x] ? '_on' : ''}`
        cell.pipe.setVisible(true)
        cell.pipe.setTexture(key).setDisplaySize(ts, ts).setAngle(info.turns * 90)
        cell.lock.setVisible(this.locked[y][x])
      }
    }
  }
}
