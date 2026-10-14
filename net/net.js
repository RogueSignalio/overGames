// Net mini game (Phaser 3), image/theme based.
// Plain browser script; needs Phaser and net_gen.js loaded first.
//
// new NetGame(config, phaser_config)
//   config.maps          array of results from NetMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.tile_size     pixels per tile (default 48); images are scaled to fit
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, submit } on each win
//   config.debug         log each level's solution to the console
//   phaser_config        merged into the Phaser.Game config (e.g. { parent: 'game' })
//
// Controls: left click = rotate clockwise, right click = rotate counter-clockwise,
//           shift + click = lock/unlock a tile.
//
// Themes
//   A theme is a folder of images plus a few settings:
//     path              folder holding the images, e.g. 'assets/default/'
//     background        board background image (stretched to the board), or null
//     background_color  CSS color shown behind everything (used if no background image)
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

    const ts = this.config.tile_size
    const first = this.levels[0].map
    const self = this

    this.phaser = new Phaser.Game(Object.assign({
      type: Phaser.AUTO,
      width: first[0].length * ts,
      height: first.length * ts,
      backgroundColor: this.theme.background_color,
      scene: {
        preload: function () { self.preload(this) },
        create: function () { self.create(this) },
      },
    }, phaser_config))
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

    const ts = this.config.tile_size
    const w = this.columns * ts, h = this.rows * ts
    const scene = this.scene
    scene.scale.resize(w, h)
    scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.msg.setPosition(w / 2, h / 2).setVisible(false)

    // Rebuild the sprite layers: 0 board bg, 1 tile bg, 2 pipes, 3 server, 4 locks
    this.clear_sprites()
    if (this.theme.background) {
      this.sprites.push(scene.add.image(0, 0, 'net_background').setOrigin(0).setDisplaySize(w, h).setDepth(0))
    }

    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const cx = x * ts + ts / 2, cy = y * ts + ts / 2
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

    const sx = this.server.x * ts + ts / 2, sy = this.server.y * ts + ts / 2
    this.sprites.push(scene.add.image(sx, sy, 'net_server').setDisplaySize(ts, ts).setDepth(3))

    if (this.config.debug) {
      console.log(`Level ${i + 1} solution:\n${NetMapGenerator.to_text(lv.solution)}`)
    }
    this.draw()
  }

  on_click(p) {
    if (this.solved) return
    const ts = this.config.tile_size
    const x = Math.floor(p.x / ts), y = Math.floor(p.y / ts)
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

  // Update each tile's sprite from the current grid. No shapes are drawn here,
  // only textures swapped and rotated.
  draw() {
    const ts = this.config.tile_size
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
