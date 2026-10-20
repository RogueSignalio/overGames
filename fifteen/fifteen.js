// Fifteen mini game (Phaser 3), image/theme based and responsive.
// Plain browser script; needs Phaser and fifteen_gen.js loaded first.
//
// new FifteenGame(config, phaser_config)
//   config.maps          array of results from FifteenMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.responsive    true (default): the board scales to fill its container.
//                        false: fixed size, using tile_size pixels per tile.
//   config.max_tile_size responsive only: cap the tile size in pixels (default null = no cap)
//   config.tile_size     pixels per tile when responsive is false (default 64)
//   config.slide_ms      how long a tile takes to slide, in ms (default 120, 0 = instant)
//   config.highlight_correct  show tiles that are already in their final place using the
//                        tile_ok image (default false)
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, clicks, submit } on each win.
//                        moves counts every tile that slid; clicks counts clicks / key presses.
//   config.debug         true = log each level's start position, solution moves and a replay
//                        check to the browser console. 'full' also prints the board after
//                        every move.
//   phaser_config        merged into the Phaser.Game config. Pass { parent: 'game' } with the
//                        id of the container element (it needs a real width and height).
//
// Responsive mode: the canvas always fills the container. On every resize the tile size
// becomes whole pixels of min(container width / columns, container height / rows) and the
// board is centred. Whatever space is left over shows theme.background_color.
//
// Controls: click a tile in the same row or column as the gap and every tile between it and
//           the gap slides along. Arrow keys slide the tile next to the gap in that direction
//           (left arrow = the tile to the right of the gap slides left, and so on).
//
// game.play_solution(delay_ms) restarts the current level and plays the stored solution,
// so you can watch it solve the puzzle.
//
// Themes
//   A theme is a folder of images plus a few settings:
//     path              folder holding the images, e.g. 'assets/default/'
//     background        board background image (stretched over the board), or null
//     background_color  CSS color shown behind everything, including any spare space
//     digit_scale       largest size of a digit image, as a fraction of the tile (default 1)
//     digit_advance     how much of a digit image's width one digit takes up, i.e. the spacing
//                       between digit centres (default 0.5)
//     digit_max_width   numbers with several digits shrink until they are no wider than this
//                       fraction of the tile (default 0.78)
//     images            filename for each image key (override any you rename)
//
//   Image keys (all square, any resolution; they are scaled to the tile size):
//     slot        backing drawn under every cell; it shows where the gap is
//     tile        a tile
//     tile_ok     a tile that is in its final place (only used with highlight_correct)
//     digit_0 ... digit_9   the digits, transparent, drawn on top of a tile. A tile numbered
//                 12 is digit_1 and digit_2 side by side, so ten images cover any board size.
//   Because the board can be scaled up, supply art at 128px or more for large boards.

const FIFTEEN_THEME_DEFAULT = (() => {
  const images = { slot: 'slot.png', tile: 'tile.png', tile_ok: 'tile_ok.png' }
  for (let d = 0; d <= 9; d++) images[`digit_${d}`] = `digit_${d}.png`
  return {
    path: 'assets/default/',
    background: 'background.png',
    background_color: '#222222',
    digit_scale: 1,
    digit_advance: 0.5,
    digit_max_width: 0.78,
    images,
  }
})()

class FifteenGame {
  constructor(config = {}, phaser_config = {}) {
    this.config = Object.assign({
      map: null,
      maps: [],
      responsive: true,
      max_tile_size: null,
      tile_size: 64,
      slide_ms: 120,
      highlight_correct: false,
      theme: {},
      advance_delay: 1200,
      win_callback: null,
      debug: false,
    }, config)

    const t = this.config.theme || {}
    this.theme = Object.assign({}, FIFTEEN_THEME_DEFAULT, t, {
      images: Object.assign({}, FIFTEEN_THEME_DEFAULT.images, t.images),
    })

    this.levels = this.config.maps.length ? this.config.maps : (this.config.map ? [this.config.map] : [])
    if (!this.levels.length) throw new Error('FifteenGame needs map or maps')

    this.level_index = 0
    this.moves = 0
    this.clicks = 0
    this.solved = false
    this.sprites = []
    this.tiles = []
    this.playback = null
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
    if (t.background) scene.load.image('fifteen_background', t.background)
    for (const [name, file] of Object.entries(t.images)) {
      scene.load.image(`fifteen_${name}`, file)
    }
  }

  create(scene) {
    this.scene = scene
    this.msg = scene.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '32px', color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.65)', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(10).setVisible(false)

    scene.input.on('pointerdown', (p) => this.on_click(p))
    scene.scale.on('resize', () => this.relayout())

    if (scene.input.keyboard) {
      scene.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT')   // stop the page scrolling
      // Phaser can hand over the same key event again when several arrive within one frame
      // (a slow frame plus key auto-repeat), so remember which ones were already handled.
      const handled = new WeakSet()
      for (const name of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
        scene.input.keyboard.on(`keydown-${name}`, (event) => {
          if (event) {
            if (handled.has(event)) return
            handled.add(event)
          }
          this.on_key(name.toLowerCase())
        })
      }
    }
    this.load_level(0)
  }

  clear_sprites() {
    this.sprites.forEach(s => s.destroy())
    this.sprites = []
    this.tiles = []
  }

  // Print the level's start position and solution to the console so it can be checked by eye.
  log_solution(i, lv) {
    const F = FifteenMapGenerator
    const r = F.replay(lv.map, lv.solution)
    const n = lv.solution.length
    const verdict = r.ok && r.solved
      ? `PASS (replaying the ${n} moves on the start position reaches the solved position)`
      : 'FAIL (the stored moves do not solve this start position)'
    let text =
      `Level ${i + 1} solution (${this.columns} x ${this.rows}), ${n} moves\n` +
      'Start position and solved position (. is the gap):\n\n' +
      F.boards_to_text([lv.map, lv.goal || F.goal(this.columns, this.rows)], 2, ['Start', 'Solved']) + '\n\n' +
      'Moves (tile number + the direction it slides):\n' + F.moves_to_text(lv.solution) + '\n\n' +
      `Check: ${verdict}`
    if (this.config.debug === 'full') text += '\n\nBoard after each move:\n\n' + F.boards_to_text(r.boards, 6)
    console.log(text)
  }

  load_level(i) {
    const lv = this.levels[i]
    this.level_index = i
    this.grid = FifteenMapGenerator.clone(lv.map)
    this.rows = this.grid.length
    this.columns = this.grid[0].length
    this.moves = 0
    this.clicks = 0
    this.solved = false

    const scene = this.scene
    if (this.playback) { this.playback.remove(false); this.playback = null }
    if (!this.config.responsive) {
      scene.scale.resize(this.columns * this.config.tile_size, this.rows * this.config.tile_size)
    }
    scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.msg.setVisible(false)

    if (this.config.debug) this.log_solution(i, lv)
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

  // Pixel centre of a cell.
  cell_x(x) { return this.ox + x * this.ts + this.ts / 2 }
  cell_y(y) { return this.oy + y * this.ts + this.ts / 2 }

  // Sprite layers: 0 board bg, 1 slot under every cell, 2 tiles (a tile is a container:
  // the tile image plus one image per digit)
  build_sprites() {
    const scene = this.scene
    const ts = this.ts
    this.clear_sprites()

    if (this.theme.background) {
      this.sprites.push(scene.add.image(this.ox, this.oy, 'fifteen_background').setOrigin(0)
        .setDisplaySize(this.columns * ts, this.rows * ts).setDepth(0))
    }

    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        this.sprites.push(scene.add.image(this.cell_x(x), this.cell_y(y), 'fifteen_slot').setDisplaySize(ts, ts).setDepth(1))
        const v = this.grid[y][x]
        row.push(v ? this.make_tile(v, this.cell_x(x), this.cell_y(y)) : null)
      }
      this.tiles.push(row)
    }
  }

  make_tile(value, cx, cy) {
    const scene = this.scene, ts = this.ts
    const bg = scene.add.image(0, 0, 'fifteen_tile').setDisplaySize(ts, ts)
    const parts = [bg]
    const s = String(value), n = s.length
    const th = this.theme
    // one digit fills digit_scale of the tile; several digits shrink so the number fits
    const size = ts * Math.min(th.digit_scale, th.digit_max_width / (n * th.digit_advance))
    const gap = size * th.digit_advance
    for (let i = 0; i < n; i++) {
      parts.push(scene.add.image((i - (n - 1) / 2) * gap, 0, `fifteen_digit_${s[i]}`).setDisplaySize(size, size))
    }
    const c = scene.add.container(cx, cy, parts).setDepth(2)
    this.sprites.push(c)
    return { c, bg, value }
  }

  on_click(p) {
    if (this.solved || !this.ts) return
    const x = Math.floor((p.x - this.ox) / this.ts), y = Math.floor((p.y - this.oy) / this.ts)
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    this.slide(x, y)
  }

  // Arrow key: the tile on the far side of the gap slides in the key's direction.
  on_key(dir) {
    if (this.solved || !this.grid) return
    const d = FIFTEEN.DIRS[dir]
    const bl = FifteenMapGenerator.find_blank(this.grid)
    const x = bl.x - d.dx, y = bl.y - d.dy
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    this.slide(x, y)
  }

  // Slide the tile at (x, y) and every tile between it and the gap. Returns false if the
  // tile isn't in line with the gap.
  slide(x, y) {
    const steps = FifteenMapGenerator.slide_steps(this.grid, x, y)
    if (!steps.length) return false

    let bl = FifteenMapGenerator.find_blank(this.grid)
    for (const s of steps) {                              // nearest the gap first
      this.grid[bl.y][bl.x] = this.grid[s.y][s.x]
      this.grid[s.y][s.x] = 0
      const t = this.tiles[s.y][s.x]
      this.tiles[bl.y][bl.x] = t
      this.tiles[s.y][s.x] = null
      this.move_sprite(t, bl.x, bl.y)
      bl = { x: s.x, y: s.y }
    }
    this.moves += steps.length
    this.clicks++
    this.draw()
    this.check_win()
    return true
  }

  move_sprite(tile, x, y) {
    const tx = this.cell_x(x), ty = this.cell_y(y)
    this.scene.tweens.killTweensOf(tile.c)
    if (!this.config.slide_ms) { tile.c.setPosition(tx, ty); return }
    this.scene.tweens.add({ targets: tile.c, x: tx, y: ty, duration: this.config.slide_ms, ease: 'Quad.easeOut' })
  }

  check_win() {
    if (!FifteenMapGenerator.is_solved(this.grid)) return
    this.solved = true
    this.msg.setText('Solved!').setVisible(true)

    if (this.config.win_callback) {
      this.config.win_callback({
        level: this.level_index + 1,
        moves: this.moves,
        clicks: this.clicks,
        submit: `level=${this.level_index + 1};moves=${this.moves}`,
      })
    }

    if (this.level_index + 1 < this.levels.length) {
      this.scene.time.delayedCall(this.config.advance_delay, () => this.load_level(this.level_index + 1))
    }
  }

  // Restart the current level and play its stored solution, one move per `delay` ms.
  // It counts as a normal win at the end (win_callback fires).
  play_solution(delay = 250) {
    const lv = this.levels[this.level_index]
    this.load_level(this.level_index)
    let i = 0
    this.playback = this.scene.time.addEvent({
      delay,
      repeat: Math.max(0, lv.solution.length - 1),
      callback: () => {
        const mv = lv.solution[i++]
        if (!mv) return
        for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.columns; x++) if (this.grid[y][x] === mv.tile) { this.slide(x, y); return }
        }
      },
    })
  }

  // Update tile images from the current grid. Only textures are swapped.
  draw() {
    const ts = this.ts
    const cols = this.columns
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < cols; x++) {
        const t = this.tiles[y][x]
        if (!t) continue
        const ok = this.config.highlight_correct && t.value === y * cols + x + 1
        t.bg.setTexture(ok ? 'fifteen_tile_ok' : 'fifteen_tile').setDisplaySize(ts, ts)
      }
    }
  }
}
