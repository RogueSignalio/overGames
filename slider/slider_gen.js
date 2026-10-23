// Slider (sliding rows and columns) generator and helpers. Plain browser script, no modules.
//
// Rules: every tile is numbered and there is no gap. Slide any row left or right, or any
// column up or down, by one place. Tiles that fall off one end come back in at the other.
// Put the numbers in order, 1, 2, 3 ... left to right and top to bottom.
//
// Map: map[y][x] is the tile number (1 .. columns*rows).
// Move: { kind, index, dir }
//   kind  'row' or 'col'
//   index which row (from the top) or column (from the left), counting from 0
//   dir   'left' / 'right' for a row, 'up' / 'down' for a column

const SLIDER = {
  DIRS: {
    left:  { step: -1, kind: 'row', arrow: '\u2190', opp: 'right' },
    right: { step: 1,  kind: 'row', arrow: '\u2192', opp: 'left' },
    up:    { step: -1, kind: 'col', arrow: '\u2191', opp: 'down' },
    down:  { step: 1,  kind: 'col', arrow: '\u2193', opp: 'up' },
  },
}

// Seeded RNG (FNV-1a hash -> mulberry32). No seed = Math.random.
function slider_make_rng(seed) {
  if (seed === null || seed === undefined) return Math.random
  let h = 2166136261
  for (const c of String(seed)) {
    h ^= c.codePointAt(0)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class SliderMapGenerator {
  /**
   * config:
   *   columns, rows   grid size (default 4 x 4)
   *   shuffle_moves   how many random moves to scramble with. The default is about the typical
   *                   distance between two positions on this grid, plus a few. Going well past
   *                   that does NOT make the puzzle harder (a 3 x 3 grid has no position more than
   *                   8 moves from solved); it only makes the stored solution longer.
   *   seed            string/number for reproducible puzzles (default random)
   */
  constructor(config = {}) {
    this.columns = config.columns || 4
    this.rows = config.rows || 4
    // positions ~ n!, and each position has about 2 * (columns + rows) - 1 useful moves, so a
    // typical position is about log(n!) / log(moves) moves from solved
    let ln_positions = 0
    for (let i = 2; i <= this.columns * this.rows; i++) ln_positions += Math.log(i)
    const branching = 2 * (this.columns + this.rows) - 1
    this.shuffle_moves = config.shuffle_moves ?? Math.ceil(ln_positions / Math.log(branching)) + 3
    this.seed = config.seed ?? null
    this.rng = slider_make_rng(this.seed)
    if (this.columns < 2 || this.rows < 2) throw new Error('Grid must be at least 2 x 2')
  }

  // ---- helpers (static so the game can use them too) ----

  /** The solved position. */
  static goal(columns, rows) {
    return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => y * columns + x + 1))
  }

  static clone(map) { return map.map(row => row.slice()) }

  static key(map) { return map.map(row => row.join(',')).join(';') }

  static is_solved(map) {
    const cols = map[0].length
    for (let y = 0; y < map.length; y++) for (let x = 0; x < cols; x++) if (map[y][x] !== y * cols + x + 1) return false
    return true
  }

  /** { solved, correct[y][x] (tile is in its final place), misplaced } */
  static analyze(map) {
    const cols = map[0].length
    const correct = map.map((row, y) => row.map((v, x) => v === y * cols + x + 1))
    return { solved: SliderMapGenerator.is_solved(map), correct, misplaced: correct.flat().filter(c => !c).length }
  }

  /** The move that undoes this one. */
  static inverse(move) {
    return { kind: move.kind, index: move.index, dir: SLIDER.DIRS[move.dir].opp }
  }

  /** Shift a row or column by `step` places (+1 = right/down, -1 = left/up), wrapping round. In place. */
  static rotate_line(map, kind, index, step) {
    const n = kind === 'row' ? map[0].length : map.length
    const vals = []
    for (let i = 0; i < n; i++) vals.push(kind === 'row' ? map[index][i] : map[i][index])
    for (let i = 0; i < n; i++) {
      const j = (((i + step) % n) + n) % n
      if (kind === 'row') map[index][j] = vals[i]; else map[j][index] = vals[i]
    }
  }

  /** Apply one move in place. Returns false (and changes nothing) if it isn't a legal move. */
  static apply_move(map, move) {
    const d = SLIDER.DIRS[move.dir]
    if (!d || d.kind !== move.kind) return false
    const limit = move.kind === 'row' ? map.length : map[0].length
    if (!Number.isInteger(move.index) || move.index < 0 || move.index >= limit) return false
    SliderMapGenerator.rotate_line(map, move.kind, move.index, d.step)
    return true
  }

  /** Play moves on a copy of the map. Returns { ok, solved, final, boards } (boards[0] is the start). */
  static replay(map, moves) {
    const m = SliderMapGenerator.clone(map)
    const boards = [SliderMapGenerator.clone(m)]
    for (const mv of moves) {
      if (!SliderMapGenerator.apply_move(m, mv)) return { ok: false, solved: false, final: m, boards }
      boards.push(SliderMapGenerator.clone(m))
    }
    return { ok: true, solved: SliderMapGenerator.is_solved(m), final: m, boards }
  }

  /** Shorten runs of the same shift: doing it n times is a full circle, so k > n/2 is better done backwards. */
  static compress(moves, columns, rows) {
    const out = []
    let i = 0
    while (i < moves.length) {
      let j = i
      const m = moves[i]
      while (j < moves.length && moves[j].kind === m.kind && moves[j].index === m.index && moves[j].dir === m.dir) j++
      const n = m.kind === 'row' ? columns : rows
      const r = (j - i) % n
      if (r > n - r) for (let q = 0; q < n - r; q++) out.push(SliderMapGenerator.inverse(m))
      else for (let q = 0; q < r; q++) out.push({ kind: m.kind, index: m.index, dir: m.dir })
      i = j
    }
    return out
  }

  /** Render a map as text. */
  static to_text(map) {
    const w = String(map.length * map[0].length).length
    return map.map(row => row.map(v => String(v).padStart(w)).join(' ')).join('\n')
  }

  /** Render boards side by side, `per_row` to a line, each with a label above it. */
  static boards_to_text(boards, per_row = 6, labels = null) {
    const out = []
    for (let s = 0; s < boards.length; s += per_row) {
      const chunk = boards.slice(s, s + per_row).map((b, i) =>
        [labels ? labels[s + i] : `#${s + i}`].concat(SliderMapGenerator.to_text(b).split('\n')))
      const widths = chunk.map(lines => Math.max(...lines.map(l => l.length)))
      for (let r = 0; r < chunk[0].length; r++) out.push(chunk.map((lines, i) => lines[r].padEnd(widths[i])).join('    ').trimEnd())
      out.push('')
    }
    return out.join('\n').trimEnd()
  }

  /** "row 2 \u2192" or "col 3 \u2193". Rows count from the top, columns from the left, both from 1. */
  static move_label(m) {
    return `${m.kind} ${m.index + 1} ${SLIDER.DIRS[m.dir].arrow}`
  }

  /** Numbered list of moves, `per_line` to a line. */
  static moves_to_text(moves, per_line = 6) {
    const cells = moves.map((m, i) => `${String(i + 1).padStart(3)}. ${SliderMapGenerator.move_label(m)}`.padEnd(16))
    const lines = []
    for (let i = 0; i < cells.length; i += per_line) lines.push(cells.slice(i, i + per_line).join('').trimEnd())
    return lines.join('\n')
  }

  // ---- generation ----

  // One random walk from the solved position. With cut_loops, landing on a position already
  // visited cuts the loop out, so the stored solution never goes round in circles.
  // Without it the walk stops as soon as `need` tiles are out of place.
  _scramble(goal, cut_loops, need) {
    const cols = this.columns, rows = this.rows
    const all = []
    for (let y = 0; y < rows; y++) for (const dir of ['left', 'right']) all.push({ kind: 'row', index: y, dir })
    for (let x = 0; x < cols; x++) for (const dir of ['up', 'down']) all.push({ kind: 'col', index: x, dir })

    const map = SliderMapGenerator.clone(goal)
    const path = []                                       // scramble moves, solved -> start
    const keys = [SliderMapGenerator.key(map)]            // keys[i] = position after i moves
    const index = new Map([[keys[0], 0]])
    let last = null

    for (let i = 0; i < this.shuffle_moves; i++) {
      const cands = last
        ? all.filter(m => !(m.kind === last.kind && m.index === last.index && m.dir === SLIDER.DIRS[last.dir].opp))
        : all
      const mv = cands[Math.floor(this.rng() * cands.length)]
      SliderMapGenerator.apply_move(map, mv)
      path.push(mv)
      last = mv

      if (cut_loops) {
        const k = SliderMapGenerator.key(map)
        if (index.has(k)) {                                // back on a visited position: cut the loop
          const j = index.get(k)
          for (let q = j + 1; q < keys.length; q++) index.delete(keys[q])
          keys.length = j + 1
          path.length = j
          last = path.length ? path[path.length - 1] : null
        } else {
          keys.push(k)
          index.set(k, keys.length - 1)
        }
      } else if (SliderMapGenerator.analyze(map).misplaced >= need) {
        break
      }
    }
    const solution = SliderMapGenerator.compress(
      path.slice().reverse().map(SliderMapGenerator.inverse), cols, rows)
    return { map, solution, goal }
  }

  /**
   * Returns { map, solution, goal }
   *   map       the scrambled start position
   *   solution  list of { kind, index, dir } moves that solve it (not necessarily the shortest)
   *   goal      the solved position
   *
   * It scrambles by random moves from the solved position, which is why every puzzle is
   * solvable: the solution is just those moves undone in reverse order. (A random shuffle
   * would often be impossible: on a grid with odd sides, shifting rows and columns can only
   * ever reach half of all arrangements.)
   */
  generate() {
    const goal = SliderMapGenerator.goal(this.columns, this.rows)
    const need = Math.ceil(this.columns * this.rows * 0.6)   // tiles that must be out of place
    const good = (r) => !SliderMapGenerator.is_solved(r.map) && SliderMapGenerator.analyze(r.map).misplaced >= need
    let r = null

    for (let attempt = 0; attempt < 50; attempt++) {
      r = this._scramble(goal, true, need)
      if (good(r)) return r
    }
    // Tiny boards loop back home when loops are cut, so walk without cutting and stop once
    // enough tiles are out of place.
    for (let attempt = 0; attempt < 50; attempt++) {
      r = this._scramble(goal, false, need)
      if (good(r)) return r
    }
    return r
  }
}
