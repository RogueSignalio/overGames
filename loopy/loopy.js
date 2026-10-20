// Loopy mini game (Phaser 3), image/theme based and responsive.
// Plain browser script; needs Phaser and loopy_gen.js loaded first.
//
// new LoopyGame(config, phaser_config)
//   config.maps          array of results from LoopyMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.responsive    true (default): the board scales to fill its container.
//                        false: fixed size, using tile_size pixels per cell.
//   config.max_tile_size responsive only: cap the cell size in pixels (default null = no cap)
//   config.tile_size     pixels per cell when responsive is false (default 48)
//   config.margin        space around the grid, in cells (default 0.5), so edges on the
//                        border are easy to click
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, submit } on each win
//   config.debug         true = log each level's solution to the browser console
//   phaser_config        merged into the Phaser.Game config. Pass { parent: 'game' } with the
//                        id of the container element (it needs a real width and height).
//
// Responsive mode: the canvas always fills the container. On every resize the cell size
// becomes whole pixels of min(container width / (columns + 2 * margin),
// container height / (rows + 2 * margin)) and the board is centred. Whatever space is
// left over shows theme.background_color.
//
// Controls: left click  = draw / remove a line on the nearest edge
//           right click (or shift + click) = mark / unmark the nearest edge as "no line"
//
// The puzzle is solved when the lines form one closed loop and every number
// matches. Any valid loop wins, it doesn't have to match the stored solution.
//
// Themes
//   A theme is a folder of images plus a few settings:
//     path              folder holding the images, e.g. 'assets/default/'
//     background        board background image (stretched over grid + margin), or null
//     background_color  CSS color shown behind everything, including any spare space
//     line_overlap      how far each line sticks out past its ends, as a fraction of
//                       the tile (default 0.16). Fills the notch at corners. 0 = exact fit.
//     images            filename for each image key (override any you rename)
//
//   Image keys (all square, any resolution; they are scaled to the cell size):
//     cell        backing for each cell
//     dot         the grid point at every vertex
//     line        a line, drawn HORIZONTAL and spanning the full width; the game rotates it
//     line_err    a line touching a vertex where 3+ lines meet
//     line_done   every line once the puzzle is solved
//     cross       the "no line" mark, centered on the edge
//     clue_0 ... clue_4          the number, transparent, drawn over the cell
//     clue_0_ok ... clue_4_ok    same number when the cell has exactly that many lines
//     clue_0_err ... clue_4_err  same number when it has too many lines
//   Because the board can be scaled up, supply art at 128px or more for large boards.

const LOOPY_THEME_DEFAULT = (() => {
  const images = {
    cell: 'cell.png', dot: 'dot.png',
    line: 'line.png', line_err: 'line_err.png', line_done: 'line_done.png',
    cross: 'cross.png',
  }
  for (let n = 0; n <= 4; n++) {
    images[`clue_${n}`] = `clue_${n}.png`
    images[`clue_${n}_ok`] = `clue_${n}_ok.png`
    images[`clue_${n}_err`] = `clue_${n}_err.png`
  }
  return {
    path: 'assets/default/',
    background: 'background.png',
    background_color: '#222222',
    line_overlap: 0.16,
    images,
  }
})()

class LoopyGame {
  constructor(config = {}, phaser_config = {}) {
    this.config = Object.assign({
      map: null,
      maps: [],
      responsive: true,
      max_tile_size: null,
      tile_size: 48,
      margin: 0.5,
      theme: {},
      advance_delay: 1200,
      win_callback: null,
      debug: false,
    }, config)

    const t = this.config.theme || {}
    this.theme = Object.assign({}, LOOPY_THEME_DEFAULT, t, {
      images: Object.assign({}, LOOPY_THEME_DEFAULT.images, t.images),
    })

    this.levels = this.config.maps.length ? this.config.maps : (this.config.map ? [this.config.map] : [])
    if (!this.levels.length) throw new Error('LoopyGame needs map or maps')

    this.level_index = 0
    this.moves = 0
    this.solved = false
    this.sprites = []
    this.ts = 0   // current cell size in pixels, set by relayout()
    this.ox = 0   // position of the grid's top-left vertex inside the canvas
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
      const m = this.config.margin * 2, ts = this.config.tile_size
      base.width = Math.ceil((first[0].length + m) * ts)
      base.height = Math.ceil((first.length + m) * ts)
    }
    const scale = Object.assign({}, base.scale, phaser_config.scale)
    this.phaser = new Phaser.Game(Object.assign({}, base, phaser_config, { scale }))
  }

  preload(scene) {
    const t = this.theme
    scene.load.setPath(t.path)
    if (t.background) scene.load.image('loopy_background', t.background)
    for (const [name, file] of Object.entries(t.images)) {
      scene.load.image(`loopy_${name}`, file)
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
  }

  // Print the level's solution to the console as text so it can be checked by eye.
  log_solution(i, lv) {
    const a = LoopyMapGenerator.analyze(lv.map, lv.solution)
    const verdict = a.solved
      ? `PASS (one closed loop of ${a.lines} lines, every number exact)`
      : 'FAIL (this stored solution does not solve the map)'
    console.log(
      `Level ${i + 1} solution (${this.columns} x ${this.rows})` + (lv.unique ? ', unique' : '') + '\n' +
      'Legend:  +---+ and |  loop     numbers = clues (blank cell = no clue)\n\n' +
      LoopyMapGenerator.to_text(lv.map, lv.solution) + '\n\n' +
      `Check: ${verdict}`
    )
  }

  load_level(i) {
    const lv = this.levels[i]
    this.level_index = i
    this.map = lv.map
    this.rows = this.map.length
    this.columns = this.map[0].length
    // per edge: 0 = empty, 1 = line, 2 = "no line" mark
    this.state = {
      h: Array.from({ length: this.rows + 1 }, () => Array(this.columns).fill(0)),
      v: Array.from({ length: this.rows }, () => Array(this.columns + 1).fill(0)),
    }
    this.moves = 0
    this.solved = false

    const scene = this.scene
    if (!this.config.responsive) {
      const m = this.config.margin * 2, ts = this.config.tile_size
      scene.scale.resize(Math.ceil((this.columns + m) * ts), Math.ceil((this.rows + m) * ts))
    }
    scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.msg.setVisible(false)

    if (this.config.debug) this.log_solution(i, lv)
    this.relayout()
  }

  // Work out cell size and grid position from the current canvas size, then rebuild.
  // Runs on every level load and every container resize.
  relayout() {
    if (!this.map) return
    const W = this.scene.scale.width, H = this.scene.scale.height
    if (W < 8 || H < 8) return  // container has no size yet

    const m = this.config.margin * 2
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

  // Sprite layers: 0 board bg, 1 cell, 2 number, 3 dot, 4 line, 5 cross
  build_sprites() {
    const scene = this.scene
    const ts = this.ts, ox = this.ox, oy = this.oy
    const pad = Math.round(ts * this.config.margin)
    this.clear_sprites()
    const add = (s) => { this.sprites.push(s); return s }

    if (this.theme.background) {
      add(scene.add.image(ox - pad, oy - pad, 'loopy_background').setOrigin(0)
        .setDisplaySize(this.columns * ts + pad * 2, this.rows * ts + pad * 2).setDepth(0))
    }

    this.clues = []
    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const cx = ox + x * ts + ts / 2, cy = oy + y * ts + ts / 2
        add(scene.add.image(cx, cy, 'loopy_cell').setDisplaySize(ts, ts).setDepth(1))
        const n = this.map[y][x]
        row.push(n >= 0 ? add(scene.add.image(cx, cy, `loopy_clue_${n}`).setDisplaySize(ts, ts).setDepth(2)) : null)
      }
      this.clues.push(row)
    }

    for (let y = 0; y <= this.rows; y++) {
      for (let x = 0; x <= this.columns; x++) {
        add(scene.add.image(ox + x * ts, oy + y * ts, 'loopy_dot').setDisplaySize(ts, ts).setDepth(3))
      }
    }

    // Edge sprites. Horizontal edges sit on grid line y; vertical ones are the same
    // image rotated 90 degrees. Lines are a little longer than the tile so corners fill in.
    const long = ts * (1 + this.theme.line_overlap)
    this.edges = { h: [], v: [] }
    for (let y = 0; y <= this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const cx = ox + x * ts + ts / 2, cy = oy + y * ts
        row.push({
          line: add(scene.add.image(cx, cy, 'loopy_line').setDisplaySize(long, ts).setDepth(4).setVisible(false)),
          cross: add(scene.add.image(cx, cy, 'loopy_cross').setDisplaySize(ts, ts).setDepth(5).setVisible(false)),
        })
      }
      this.edges.h.push(row)
    }
    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x <= this.columns; x++) {
        const cx = ox + x * ts, cy = oy + y * ts + ts / 2
        row.push({
          line: add(scene.add.image(cx, cy, 'loopy_line').setDisplaySize(long, ts).setAngle(90).setDepth(4).setVisible(false)),
          cross: add(scene.add.image(cx, cy, 'loopy_cross').setDisplaySize(ts, ts).setDepth(5).setVisible(false)),
        })
      }
      this.edges.v.push(row)
    }
  }

  // Nearest edge to a pointer position, or null if it isn't over the board.
  pick_edge(px, py) {
    const ts = this.ts
    const fx = (px - this.ox) / ts, fy = (py - this.oy) / ts
    const hy = Math.round(fy), vx = Math.round(fx)
    const dh = Math.abs(fy - hy), dv = Math.abs(fx - vx)
    const hx = Math.floor(fx), vy = Math.floor(fy)
    const h_ok = hy >= 0 && hy <= this.rows && hx >= 0 && hx < this.columns
    const v_ok = vx >= 0 && vx <= this.columns && vy >= 0 && vy < this.rows
    if (h_ok && (!v_ok || dh <= dv)) return { kind: 'h', x: hx, y: hy }
    if (v_ok) return { kind: 'v', x: vx, y: vy }
    return null
  }

  on_click(p) {
    if (this.solved || !this.ts) return
    const e = this.pick_edge(p.x, p.y)
    if (!e) return

    const want_cross = p.rightButtonDown() || (p.event && p.event.shiftKey)
    const target = want_cross ? 2 : 1
    const grid = this.state[e.kind]
    grid[e.y][e.x] = grid[e.y][e.x] === target ? 0 : target
    this.moves++

    this.draw()
    this.check_win()
  }

  check_win() {
    if (!this.analysis.solved) return
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

  // Update every sprite from the current state. Only visibility and textures change.
  draw() {
    const ts = this.ts
    const long = ts * (1 + this.theme.line_overlap)
    const as_lines = {
      h: this.state.h.map(row => row.map(s => (s === 1 ? 1 : 0))),
      v: this.state.v.map(row => row.map(s => (s === 1 ? 1 : 0))),
    }
    const a = LoopyMapGenerator.analyze(this.map, as_lines)
    this.analysis = a

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const sprite = this.clues[y][x]
        if (!sprite) continue
        const status = a.clue[y][x]
        const suffix = status === 'ok' ? '_ok' : (status === 'err' ? '_err' : '')
        sprite.setTexture(`loopy_clue_${this.map[y][x]}${suffix}`).setDisplaySize(ts, ts)
      }
    }

    const show = (kind, y, x, err) => {
      const s = this.state[kind][y][x]
      const sp = this.edges[kind][y][x]
      sp.cross.setVisible(s === 2)
      sp.line.setVisible(s === 1)
      if (s === 1) {
        const key = a.solved ? 'loopy_line_done' : (err ? 'loopy_line_err' : 'loopy_line')
        sp.line.setTexture(key).setDisplaySize(long, ts)
      }
    }
    for (let y = 0; y <= this.rows; y++) {
      for (let x = 0; x < this.columns; x++) show('h', y, x, a.vertex_err[y][x] || a.vertex_err[y][x + 1])
    }
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x <= this.columns; x++) show('v', y, x, a.vertex_err[y][x] || a.vertex_err[y + 1][x])
    }
  }
}
