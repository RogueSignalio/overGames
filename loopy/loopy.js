// Loopy mini game (Phaser 3), image/theme based.
// Plain browser script; needs Phaser and loopy_gen.js loaded first.
//
// new LoopyGame(config, phaser_config)
//   config.maps          array of results from LoopyMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.tile_size     pixels per cell (default 48); images are scaled to fit
//   config.margin        pixels of space around the board (default tile_size / 2)
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, submit } on each win
//   config.debug         true = log each level's solution to the browser console
//   phaser_config        merged into the Phaser.Game config (e.g. { parent: 'game' })
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
//     background        board background image (stretched to the board), or null
//     background_color  CSS color shown behind everything
//     line_overlap      how far each line sticks out past its ends, as a fraction of
//                       the tile (default 0.16). Fills the notch at corners. 0 = exact fit.
//     images            filename for each image key (override any you rename)
//
//   Image keys (all square, any resolution; they are scaled to tile_size):
//     cell        backing for each cell
//     dot         the grid point at every vertex
//     line        a line, drawn HORIZONTAL and spanning the full width; the game rotates it
//     line_err    a line touching a vertex where 3+ lines meet
//     line_done   every line once the puzzle is solved
//     cross       the "no line" mark, centered on the edge
//     clue_0 ... clue_4          the number, transparent, drawn over the cell
//     clue_0_ok ... clue_4_ok    same number when the cell has exactly that many lines
//     clue_0_err ... clue_4_err  same number when it has too many lines

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
      tile_size: 48,
      margin: null,
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

    const ts = this.config.tile_size
    this.pad = this.config.margin ?? Math.round(ts / 2)
    const first = this.levels[0].map
    const self = this

    this.phaser = new Phaser.Game(Object.assign({
      type: Phaser.AUTO,
      width: first[0].length * ts + this.pad * 2,
      height: first.length * ts + this.pad * 2,
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

    const ts = this.config.tile_size, pad = this.pad
    const w = this.columns * ts + pad * 2, h = this.rows * ts + pad * 2
    const scene = this.scene
    scene.scale.resize(w, h)
    scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.msg.setPosition(w / 2, h / 2).setVisible(false)

    // Sprite layers: 0 board bg, 1 cell, 2 number, 3 dot, 4 line, 5 cross
    this.clear_sprites()
    const add = (s) => { this.sprites.push(s); return s }
    if (this.theme.background) {
      add(scene.add.image(0, 0, 'loopy_background').setOrigin(0).setDisplaySize(w, h).setDepth(0))
    }

    this.clues = []
    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const cx = pad + x * ts + ts / 2, cy = pad + y * ts + ts / 2
        add(scene.add.image(cx, cy, 'loopy_cell').setDisplaySize(ts, ts).setDepth(1))
        const n = this.map[y][x]
        row.push(n >= 0 ? add(scene.add.image(cx, cy, `loopy_clue_${n}`).setDisplaySize(ts, ts).setDepth(2)) : null)
      }
      this.clues.push(row)
    }

    for (let y = 0; y <= this.rows; y++) {
      for (let x = 0; x <= this.columns; x++) {
        add(scene.add.image(pad + x * ts, pad + y * ts, 'loopy_dot').setDisplaySize(ts, ts).setDepth(3))
      }
    }

    // Edge sprites. Horizontal edges sit on grid line y; vertical ones are the same
    // image rotated 90 degrees. Lines are a little longer than the tile so corners fill in.
    const long = ts * (1 + this.theme.line_overlap)
    this.edges = { h: [], v: [] }
    for (let y = 0; y <= this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const cx = pad + x * ts + ts / 2, cy = pad + y * ts
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
        const cx = pad + x * ts, cy = pad + y * ts + ts / 2
        row.push({
          line: add(scene.add.image(cx, cy, 'loopy_line').setDisplaySize(long, ts).setAngle(90).setDepth(4).setVisible(false)),
          cross: add(scene.add.image(cx, cy, 'loopy_cross').setDisplaySize(ts, ts).setDepth(5).setVisible(false)),
        })
      }
      this.edges.v.push(row)
    }

    if (this.config.debug) this.log_solution(i, lv)
    this.draw()
  }

  // Nearest edge to a pointer position, or null if it isn't over the board.
  pick_edge(px, py) {
    const ts = this.config.tile_size
    const fx = (px - this.pad) / ts, fy = (py - this.pad) / ts
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
    if (this.solved) return
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
    const ts = this.config.tile_size
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
