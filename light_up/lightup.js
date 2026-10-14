// Light Up mini game (Phaser 3), image/theme based.
// Plain browser script; needs Phaser and lightup_gen.js loaded first.
//
// new LightUpGame(config, phaser_config)
//   config.maps          array of results from LightUpMapGenerator.generate()
//   config.map           a single result (used if maps is empty)
//   config.tile_size     pixels per cell (default 48); images are scaled to fit
//   config.theme         see "Themes" below
//   config.advance_delay ms to wait before the next map after a win (default 1200)
//   config.win_callback  called with { level, moves, submit } on each win
//   config.debug         true = log each level's solution to the browser console
//   phaser_config        merged into the Phaser.Game config (e.g. { parent: 'game' })
//
// Controls: left click  = place / remove a lamp
//           right click (or shift + click) = place / remove a "no lamp here" mark
//
// The puzzle is solved when every white cell is lit, no two lamps see each other,
// and every number has exactly that many lamps next to it. Any valid layout wins,
// it doesn't have to match the stored solution.
//
// Themes
//   A theme is a folder of images plus a few settings:
//     path              folder holding the images, e.g. 'assets/default/'
//     background        board background image (stretched to the board), or null
//     background_color  CSS color shown behind everything
//     images            filename for each image key (override any you rename)
//
//   Image keys (all square, any resolution; they are scaled to tile_size):
//     white       empty white cell, not lit
//     lit         white cell that is lit
//     black       black cell (base for numbered and unnumbered ones)
//     clue_0 ... clue_4        the number, transparent, drawn on top of black
//     clue_0_ok ... clue_4_ok  same number when the cell has exactly that many lamps
//     clue_0_err ... clue_4_err  same number when it has too many lamps
//     lamp        a lamp, transparent, drawn on top of white/lit
//     lamp_err    a lamp that can see another lamp
//     mark        the "no lamp" mark, transparent
//   Leave a little transparent margin around cell images if you want the
//   background to show through as grid lines.

const LU_THEME_DEFAULT = (() => {
  const images = {
    white: 'white.png', lit: 'lit.png', black: 'black.png',
    lamp: 'lamp.png', lamp_err: 'lamp_err.png', mark: 'mark.png',
  }
  for (let n = 0; n <= 4; n++) {
    images[`clue_${n}`] = `clue_${n}.png`
    images[`clue_${n}_ok`] = `clue_${n}_ok.png`
    images[`clue_${n}_err`] = `clue_${n}_err.png`
  }
  return { path: 'assets/default/', background: 'background.png', background_color: '#222222', images }
})()

class LightUpGame {
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
    this.theme = Object.assign({}, LU_THEME_DEFAULT, t, {
      images: Object.assign({}, LU_THEME_DEFAULT.images, t.images),
    })

    this.levels = this.config.maps.length ? this.config.maps : (this.config.map ? [this.config.map] : [])
    if (!this.levels.length) throw new Error('LightUpGame needs map or maps')

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
    if (t.background) scene.load.image('lu_background', t.background)
    for (const [name, file] of Object.entries(t.images)) {
      scene.load.image(`lu_${name}`, file)
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

  // Print the level's solution to the console as text so it can be checked by eye.
  log_solution(i, lv) {
    const a = LightUpMapGenerator.analyze(lv.map, lv.solution)
    const verdict = a.solved
      ? 'PASS (every cell lit, no lamps see each other, every number exact)'
      : 'FAIL (this stored solution does not solve the map)'
    console.log(
      `Level ${i + 1} solution (${this.columns} x ${this.rows})` + (lv.unique ? ', unique' : '') + '\n' +
      'Legend:  * lamp   - lit cell   . unlit cell   # black cell   0-4 number\n\n' +
      LightUpMapGenerator.to_text(lv.map, lv.solution) + '\n\n' +
      `Check: ${verdict}`
    )
  }

  load_level(i) {
    const lv = this.levels[i]
    this.level_index = i
    this.map = lv.map
    this.rows = this.map.length
    this.columns = this.map[0].length
    // per cell: 0 = empty, 1 = lamp, 2 = "no lamp" mark
    this.state = Array.from({ length: this.rows }, () => Array(this.columns).fill(0))
    this.moves = 0
    this.solved = false

    const ts = this.config.tile_size
    const w = this.columns * ts, h = this.rows * ts
    const scene = this.scene
    scene.scale.resize(w, h)
    scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.msg.setPosition(w / 2, h / 2).setVisible(false)

    // Sprite layers: 0 board bg, 1 cell, 2 number, 3 mark, 4 lamp
    this.clear_sprites()
    if (this.theme.background) {
      this.sprites.push(scene.add.image(0, 0, 'lu_background').setOrigin(0).setDisplaySize(w, h).setDepth(0))
    }

    for (let y = 0; y < this.rows; y++) {
      const row = []
      for (let x = 0; x < this.columns; x++) {
        const v = this.map[y][x]
        const cx = x * ts + ts / 2, cy = y * ts + ts / 2
        const cell = { base: null, clue: null, mark: null, lamp: null }

        cell.base = scene.add.image(cx, cy, v === LU.WHITE ? 'lu_white' : 'lu_black').setDisplaySize(ts, ts).setDepth(1)
        if (v === LU.WHITE) {
          cell.mark = scene.add.image(cx, cy, 'lu_mark').setDisplaySize(ts, ts).setDepth(3).setVisible(false)
          cell.lamp = scene.add.image(cx, cy, 'lu_lamp').setDisplaySize(ts, ts).setDepth(4).setVisible(false)
        } else if (v >= 0 && v <= 4) {
          cell.clue = scene.add.image(cx, cy, `lu_clue_${v}`).setDisplaySize(ts, ts).setDepth(2)
        }
        for (const s of Object.values(cell)) if (s) this.sprites.push(s)
        row.push(cell)
      }
      this.cells.push(row)
    }

    if (this.config.debug) this.log_solution(i, lv)
    this.draw()
  }

  on_click(p) {
    if (this.solved) return
    const ts = this.config.tile_size
    const x = Math.floor(p.x / ts), y = Math.floor(p.y / ts)
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    if (this.map[y][x] !== LU.WHITE) return

    const want_mark = p.rightButtonDown() || (p.event && p.event.shiftKey)
    const target = want_mark ? 2 : 1
    this.state[y][x] = this.state[y][x] === target ? 0 : target
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

  // Update each cell's sprites from the current state. Only textures are swapped.
  draw() {
    const ts = this.config.tile_size
    const lamps = this.state.map(row => row.map(v => (v === 1 ? 1 : 0)))
    const a = LightUpMapGenerator.analyze(this.map, lamps)
    this.analysis = a

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const v = this.map[y][x]
        const cell = this.cells[y][x]

        if (v === LU.WHITE) {
          cell.base.setTexture(a.lit[y][x] ? 'lu_lit' : 'lu_white').setDisplaySize(ts, ts)
          const s = this.state[y][x]
          cell.mark.setVisible(s === 2)
          cell.lamp.setVisible(s === 1)
          if (s === 1) cell.lamp.setTexture(a.conflict[y][x] ? 'lu_lamp_err' : 'lu_lamp').setDisplaySize(ts, ts)
        } else if (cell.clue) {
          const status = a.clue[y][x]
          const suffix = status === 'ok' ? '_ok' : (status === 'err' ? '_err' : '')
          cell.clue.setTexture(`lu_clue_${v}${suffix}`).setDisplaySize(ts, ts)
        }
      }
    }
  }
}
