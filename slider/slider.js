// Slider mini game (Phaser 3), image/theme based and responsive.
// Plain browser script; needs Phaser and slider_gen.js loaded first.
//
// new SliderGame(config, phaser_config)
//   config.maps          array of results from SliderMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.responsive    true (default): the board scales to fill its container.
//                        false: fixed size, using tile_size pixels per tile.
//   config.max_tile_size responsive only: cap the tile size in pixels (default null = no cap)
//   config.tile_size     pixels per tile when responsive is false (default 64)
//   config.arrows        show an arrow button at both ends of every row and column (default true)
//   config.margin        width of the arrow strip around the board, in tiles (default 0.8)
//   config.slide_ms      how long a shift takes, in ms (default 120, 0 = instant)
//   config.highlight_correct  show tiles that are already in their final place using the
//                        tile_ok image (default false)
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, submit } on each win. moves counts shifts.
//   config.debug         true = log each level's start position, solution moves and a replay
//                        check to the browser console. 'full' also prints the board after
//                        every move.
//   phaser_config        merged into the Phaser.Game config. Pass { parent: 'game' } with the
//                        id of the container element (it needs a real width and height).
//
// Responsive mode: the canvas always fills the container. On every resize the tile size
// becomes whole pixels of min(container width / (columns + 2 * margin),
// container height / (rows + 2 * margin)) and the board is centred. Whatever space is left
// over shows theme.background_color.
//
// Controls: click an arrow to shift that row or column one place; a tile that falls off one
//           end comes back in at the other. You can also drag or swipe on the board: drag a
//           tile sideways to shift its row, up or down to shift its column.
//
// game.play_solution(delay_ms) restarts the current level and plays the stored solution,
// so you can watch it solve the puzzle.
//
// Themes
//   A theme is a folder of images plus a few settings:
//     path              folder holding the images, e.g. 'assets/default/'
//     background        board background image (stretched over board + arrow strip), or null
//     background_color  CSS color shown behind everything, including any spare space
//     digit_scale       largest size of a digit image, as a fraction of the tile (default 1)
//     digit_advance     how much of a digit image's width one digit takes up, i.e. the spacing
//                       between digit centres (default 0.5)
//     digit_max_width   numbers with several digits shrink until they are no wider than this
//                       fraction of the tile (default 0.78)
//     images            filename for each image key (override any you rename)
//
//   Image keys (all square, any resolution; they are scaled to the tile size):
//     slot        backing drawn under every cell
//     tile        a tile
//     tile_ok     a tile that is in its final place (only used with highlight_correct)
//     arrow       a button, drawn pointing UP; the game rotates it for the other directions
//     digit_0 ... digit_9   the digits, transparent, drawn on top of a tile. A tile numbered
//                 12 is digit_1 and digit_2 side by side, so ten images cover any board size.
//   Because the board can be scaled up, supply art at 128px or more for large boards.

const SLIDER_THEME_DEFAULT = (() => {
  const images = { slot: 'slot.png', tile: 'tile.png', tile_ok: 'tile_ok.png', arrow: 'arrow.png' }
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

class SliderGame {
  constructor(config = {}, phaser_config = {}) {
    this.config = Object.assign({
      map: null,
      maps: [],
      responsive: true,
      max_tile_size: null,
      tile_size: 64,
      arrows: true,
      margin: 0.8,
      slide_ms: 120,
      highlight_correct: false,
      theme: {},
      advance_delay: 1200,
      win_callback: null,
      debug: false,
    }, config)

    const t = this.config.theme || {}
    this.theme = Object.assign({}, SLIDER_THEME_DEFAULT, t, {
      images: Object.assign({}, SLIDER_THEME_DEFAULT.images, t.images),
    })

    this.levels = this.config.maps.length ? this.config.maps : (this.config.map ? [this.config.map] : [])
    if (!this.levels.length) throw new Error('SliderGame needs map or maps')

    this.level_index = 0
    this.moves = 0
    this.solved = false
    this.drag = null
    this.sprites = []
    this.tiles = []
    this.playback = null
    this.ts = 0   // current tile size in pixels, set by relayout()
    this.ox = 0   // top-left of the grid inside the canvas
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
      const m = this.margin_cells() * 2, ts = this.config.tile_size
      base.width = Math.ceil((first[0].length + m) * ts)
      base.height = Math.ceil((first.length + m) * ts)
    }
    const scale = Object.assign({}, base.scale, phaser_config.scale)
    this.phaser = new Phaser.Game(Object.assign({}, base, phaser_config, { scale }))
  }

  // Width of the arrow strip around the board, in tiles (0 when arrows are off).
  margin_cells() { return this.config.arrows ? this.config.margin : 0 }

  preload(scene) {
    const t = this.theme
    scene.load.setPath(t.path)
    if (t.background) scene.load.image('slider_background', t.background)
    for (const [name, file] of Object.entries(t.images)) {
      scene.load.image(`slider_${name}`, file)
    }
  }

  create(scene) {
    this.scene = scene
    this.msg = scene.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '32px', color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.65)', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(10).setVisible(false)

    scene.input.on('pointerdown', (p) => this.on_down(p))
    scene.input.on('pointerup', (p) => this.on_up(p))
    scene.input.on('pointerupoutside', (p) => this.on_up(p))
    scene.scale.on('resize', () => this.relayout())
    this.load_level(0)
  }

  clear_sprites() {
    this.sprites.forEach(s => s.destroy())
    this.sprites = []
    this.tiles = []
  }

  // Print the level's start position and solution to the console so it can be checked by eye.
  log_solution(i, lv) {
    const S = SliderMapGenerator
    const r = S.replay(lv.map, lv.solution)
    const n = lv.solution.length
    const verdict = r.ok && r.solved
      ? `PASS (replaying the ${n} moves on the start position reaches the solved position)`
      : 'FAIL (the stored moves do not solve this start position)'
    let text =
      `Level ${i + 1} solution (${this.columns} x ${this.rows}), ${n} moves\n` +
      'Start position and solved position:\n\n' +
      S.boards_to_text([lv.map, lv.goal || S.goal(this.columns, this.rows)], 2, ['Start', 'Solved']) + '\n\n' +
      'Moves (rows count from the top, columns from the left, both from 1;\n' +
      'the arrow is the direction the row or column slides):\n' + S.moves_to_text(lv.solution) + '\n\n' +
      `Check: ${verdict}`
    if (this.config.debug === 'full') text += '\n\nBoard after each move:\n\n' + S.boards_to_text(r.boards, 6)
    console.log(text)
  }

  load_level(i) {
    const lv = this.levels[i]
    this.level_index = i
    this.grid = SliderMapGenerator.clone(lv.map)
    this.rows = this.grid.length
    this.columns = this.grid[0].length
    this.moves = 0
    this.solved = false
    this.drag = null

    const scene = this.scene
    if (this.playback) { this.playback.remove(false); this.playback = null }
    if (!this.config.responsive) {
      const m = this.margin_cells() * 2, ts = this.config.tile_size
      scene.scale.resize(Math.ceil((this.columns + m) * ts), Math.ceil((this.rows + m) * ts))
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

    const m = this.margin_cells() * 2
    let ts = this.config.tile_size
    if (this.config.responsive) {
      ts = Math.floor(Math.min(W / (this.columns + m), H / (this.rows + m)))
      if (this.config.max_tile_size) ts = Math.min(ts, this.config.max_tile_size)
    }
    this.ts = Math.max(1, ts)
    this.ox = Math.floor((W - this.columns * this.ts) / 2)
    this.oy = Math.floor((H - this.rows * this.ts) / 2)

    this.msg.setPosition(W / 2, H / 2).setFontSize(Math.max(14, Math.round(this.ts * 0.7)))
    this.build_sprites()
    this.draw()
  }

  // Pixel centre of a cell. Works for cells just outside the board too (-1 and columns/rows),
  // which is where tiles go while they wrap round.
  cell_x(x) { return this.ox + x * this.ts + this.ts / 2 }
  cell_y(y) { return this.oy + y * this.ts + this.ts / 2 }

  // Sprite layers: 0 board bg, 1 slot under every cell, 2 tiles (a tile is a container:
  // the tile image plus one image per digit), 3 arrow buttons
  build_sprites() {
    const scene = this.scene
    const ts = this.ts, m = this.margin_cells()
    const pad = Math.round(ts * m)
    this.clear_sprites()

    if (this.theme.background) {
      this.sprites.push(scene.add.image(this.ox - pad, this.oy - pad, 'slider_background').setOrigin(0)
        .setDisplaySize(this.columns * ts + pad * 2, this.rows * ts + pad * 2).setDepth(0))
    }

    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        this.sprites.push(scene.add.image(this.cell_x(x), this.cell_y(y), 'slider_slot').setDisplaySize(ts, ts).setDepth(1))
        row.push(this.make_tile(this.grid[y][x], this.cell_x(x), this.cell_y(y)))
      }
      this.tiles.push(row)
    }

    if (m > 0) {
      const size = ts * m, half = size / 2
      const arrow = (x, y, angle) =>
        this.sprites.push(scene.add.image(x, y, 'slider_arrow').setDisplaySize(size, size).setAngle(angle).setDepth(3))
      for (let y = 0; y < this.rows; y++) {
        arrow(this.ox - half, this.cell_y(y), 270)                        // row: left
        arrow(this.ox + this.columns * ts + half, this.cell_y(y), 90)     // row: right
      }
      for (let x = 0; x < this.columns; x++) {
        arrow(this.cell_x(x), this.oy - half, 0)                          // column: up
        arrow(this.cell_x(x), this.oy + this.rows * ts + half, 180)       // column: down
      }
    }
  }

  make_tile(value, cx, cy) {
    const scene = this.scene, ts = this.ts
    const bg = scene.add.image(0, 0, 'slider_tile').setDisplaySize(ts, ts)
    const parts = [bg]
    const s = String(value), n = s.length
    const th = this.theme
    // one digit fills digit_scale of the tile; several digits shrink so the number fits
    const size = ts * Math.min(th.digit_scale, th.digit_max_width / (n * th.digit_advance))
    const gap = size * th.digit_advance
    for (let i = 0; i < n; i++) {
      parts.push(scene.add.image((i - (n - 1) / 2) * gap, 0, `slider_digit_${s[i]}`).setDisplaySize(size, size))
    }
    const c = scene.add.container(cx, cy, parts).setDepth(2)
    this.sprites.push(c)
    return { c, bg, value }
  }

  // Which arrow button is at this pixel? Returns { kind, index, dir } or null.
  arrow_at(px, py) {
    const m = this.margin_cells()
    if (!m || !this.ts) return null
    const gx = (px - this.ox) / this.ts, gy = (py - this.oy) / this.ts   // in tiles, grid-relative
    if (gy >= 0 && gy < this.rows) {
      if (gx >= -m && gx < 0) return { kind: 'row', index: Math.floor(gy), dir: 'left' }
      if (gx >= this.columns && gx < this.columns + m) return { kind: 'row', index: Math.floor(gy), dir: 'right' }
    }
    if (gx >= 0 && gx < this.columns) {
      if (gy >= -m && gy < 0) return { kind: 'col', index: Math.floor(gx), dir: 'up' }
      if (gy >= this.rows && gy < this.rows + m) return { kind: 'col', index: Math.floor(gx), dir: 'down' }
    }
    return null
  }

  on_down(p) {
    if (this.solved || !this.ts) return
    if (p.rightButtonDown && p.rightButtonDown()) return
    const a = this.arrow_at(p.x, p.y)
    if (a) { this.shift(a.kind, a.index, a.dir); return }

    const cx = Math.floor((p.x - this.ox) / this.ts), cy = Math.floor((p.y - this.oy) / this.ts)
    if (cx >= 0 && cy >= 0 && cx < this.columns && cy < this.rows) this.drag = { x: p.x, y: p.y, cx, cy }
  }

  // A drag that ends far enough from where it began shifts the tile's row (sideways)
  // or column (up/down) one place.
  on_up(p) {
    const d = this.drag
    this.drag = null
    if (!d || this.solved || !this.ts) return
    const dx = p.x - d.x, dy = p.y - d.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.ts * 0.3) return   // just a click
    if (Math.abs(dx) >= Math.abs(dy)) this.shift('row', d.cy, dx > 0 ? 'right' : 'left')
    else this.shift('col', d.cx, dy > 0 ? 'down' : 'up')
  }

  // Shift a row or column one place. Returns false if the request isn't valid.
  shift(kind, index, dir) {
    const d = SLIDER.DIRS[dir]
    if (!d || d.kind !== kind || this.solved || !this.grid) return false
    const horiz = kind === 'row'
    if (index < 0 || index >= (horiz ? this.rows : this.columns)) return false

    const n = horiz ? this.columns : this.rows
    const step = d.step
    const at = (i) => (horiz ? this.tiles[index][i] : this.tiles[i][index])
    const pos = (i) => (horiz ? [this.cell_x(i), this.cell_y(index)] : [this.cell_x(index), this.cell_y(i)])
    const old = Array.from({ length: n }, (_, i) => at(i))
    const next = new Array(n)

    for (let i = 0; i < n; i++) {
      const j = (i + step + n) % n
      const t = old[i]
      const wraps = step > 0 ? i === n - 1 : i === 0
      if (!wraps) {
        next[j] = t
        this.move_sprite(t, ...pos(j))
      } else {
        // the tile slides off the end while a copy slides in from the other side
        this.fly_out(t, ...pos(i + step))
        const c = this.make_tile(t.value, ...pos(j - step))
        next[j] = c
        this.move_sprite(c, ...pos(j))
      }
    }
    for (let i = 0; i < n; i++) {
      if (horiz) { this.tiles[index][i] = next[i]; this.grid[index][i] = next[i].value }
      else { this.tiles[i][index] = next[i]; this.grid[i][index] = next[i].value }
    }

    this.moves++
    this.draw()
    this.check_win()
    return true
  }

  move_sprite(tile, tx, ty) {
    this.scene.tweens.killTweensOf(tile.c)
    if (!this.config.slide_ms) { tile.c.setPosition(tx, ty); return }
    this.scene.tweens.add({ targets: tile.c, x: tx, y: ty, duration: this.config.slide_ms, ease: 'Quad.easeOut' })
  }

  // Slide a tile off the board, then remove it.
  fly_out(tile, tx, ty) {
    if (!this.config.slide_ms) { this.discard(tile); return }
    this.scene.tweens.killTweensOf(tile.c)
    this.scene.tweens.add({
      targets: tile.c, x: tx, y: ty, duration: this.config.slide_ms, ease: 'Quad.easeOut',
      onComplete: () => this.discard(tile),
    })
  }

  discard(tile) {
    tile.c.destroy()
    this.sprites = this.sprites.filter(s => s !== tile.c)
  }

  check_win() {
    if (!SliderMapGenerator.is_solved(this.grid)) return
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

  // Restart the current level and play its stored solution, one move per `delay` ms.
  // It counts as a normal win at the end (win_callback fires).
  play_solution(delay = 400) {
    const lv = this.levels[this.level_index]
    this.load_level(this.level_index)
    let i = 0
    this.playback = this.scene.time.addEvent({
      delay,
      repeat: Math.max(0, lv.solution.length - 1),
      callback: () => {
        const mv = lv.solution[i++]
        if (mv) this.shift(mv.kind, mv.index, mv.dir)
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
        const ok = this.config.highlight_correct && t.value === y * cols + x + 1
        t.bg.setTexture(ok ? 'slider_tile_ok' : 'slider_tile').setDisplaySize(ts, ts)
      }
    }
  }
}
