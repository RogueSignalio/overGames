// Fifteen (sliding tile puzzle) generator and helpers. Plain browser script, no modules.
//
// Rules: slide tiles into the gap until the numbers run 1, 2, 3 ... in order, left to
// right and top to bottom, with the gap in the bottom right corner.
//
// Map: map[y][x] is the tile number (1 .. columns*rows-1), or 0 for the gap.
// Move: { tile, dir } where dir is the direction that tile slides: 'up' 'down' 'left' 'right'.
//       A tile can only slide into the gap, so the tile sits on the opposite side of the gap.

const FIFTEEN = {
  DIRS: {
    up:    { dx: 0,  dy: -1, arrow: '\u2191', opp: 'down' },
    down:  { dx: 0,  dy: 1,  arrow: '\u2193', opp: 'up' },
    left:  { dx: -1, dy: 0,  arrow: '\u2190', opp: 'right' },
    right: { dx: 1,  dy: 0,  arrow: '\u2192', opp: 'left' },
  },
}

// Seeded RNG (FNV-1a hash -> mulberry32). No seed = Math.random.
function fifteen_make_rng(seed) {
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

class FifteenMapGenerator {
  /**
   * config:
   *   columns, rows   grid size (default 4 x 4)
   *   shuffle_moves   how many random moves to scramble with (default columns * rows * 6).
   *                   More = harder and a longer stored solution.
   *   seed            string/number for reproducible puzzles (default random)
   */
  constructor(config = {}) {
    this.columns = config.columns || 4
    this.rows = config.rows || 4
    this.shuffle_moves = config.shuffle_moves ?? this.columns * this.rows * 6
    this.seed = config.seed ?? null
    this.rng = fifteen_make_rng(this.seed)
    if (this.columns < 2 || this.rows < 2) throw new Error('Grid must be at least 2 x 2')
  }

  // ---- helpers (static so the game can use them too) ----

  /** The solved position. */
  static goal(columns, rows) {
    return Array.from({ length: rows }, (_, y) =>
      Array.from({ length: columns }, (_, x) => (y === rows - 1 && x === columns - 1 ? 0 : y * columns + x + 1)))
  }

  static clone(map) { return map.map(row => row.slice()) }

  static key(map) { return map.map(row => row.join(',')).join(';') }

  static find_blank(map) {
    for (let y = 0; y < map.length; y++) for (let x = 0; x < map[0].length; x++) if (map[y][x] === 0) return { x, y }
    return null
  }

  static is_solved(map) {
    const cols = map[0].length
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < cols; x++) {
        const want = (y === map.length - 1 && x === cols - 1) ? 0 : y * cols + x + 1
        if (map[y][x] !== want) return false
      }
    }
    return true
  }

  /** { solved, correct[y][x] (tile is in its final place), misplaced, blank } */
  static analyze(map) {
    const cols = map[0].length
    const correct = map.map((row, y) => row.map((v, x) => v !== 0 && v === y * cols + x + 1))
    const misplaced = map.flat().filter((v, i) => v !== 0 && v !== i + 1).length
    return { solved: FifteenMapGenerator.is_solved(map), correct, misplaced, blank: FifteenMapGenerator.find_blank(map) }
  }

  /**
   * Can this position be solved? (Independent of how the generator works, useful as a check.)
   * Sliding keeps the parity of inversions + gap row, depending on the grid width.
   */
  static is_solvable(map) {
    const flat = map.flat().filter(v => v !== 0)
    let inversions = 0
    for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) if (flat[i] > flat[j]) inversions++
    const cols = map[0].length
    if (cols % 2 === 1) return inversions % 2 === 0
    const row_from_bottom = map.length - FifteenMapGenerator.find_blank(map).y   // 1-based
    return (inversions + row_from_bottom) % 2 === 1
  }

  /**
   * What happens when the tile at (x, y) is clicked? Every tile between it and the gap
   * (same row or column) slides one place toward the gap. Returns single-tile steps,
   * nearest the gap first: [{ tile, x, y, dir }] where (x, y) is where the tile is now.
   * Empty array if the tile isn't in line with the gap.
   */
  static slide_steps(map, x, y) {
    const bl = FifteenMapGenerator.find_blank(map)
    const steps = []
    if (map[y][x] === 0) return steps
    if (y === bl.y && x !== bl.x) {
      const s = x > bl.x ? 1 : -1
      for (let cx = bl.x + s; ; cx += s) {
        steps.push({ tile: map[y][cx], x: cx, y, dir: s > 0 ? 'left' : 'right' })
        if (cx === x) break
      }
    } else if (x === bl.x && y !== bl.y) {
      const s = y > bl.y ? 1 : -1
      for (let cy = bl.y + s; ; cy += s) {
        steps.push({ tile: map[cy][x], x, y: cy, dir: s > 0 ? 'up' : 'down' })
        if (cy === y) break
      }
    }
    return steps
  }

  /** Apply steps from slide_steps() to a map in place. */
  static apply_steps(map, steps) {
    let bl = FifteenMapGenerator.find_blank(map)
    for (const s of steps) {
      map[bl.y][bl.x] = map[s.y][s.x]
      map[s.y][s.x] = 0
      bl = { x: s.x, y: s.y }
    }
  }

  /** Apply one { tile, dir } move in place. Returns false (and changes nothing) if it isn't legal. */
  static apply_move(map, move) {
    const d = FIFTEEN.DIRS[move.dir]
    const bl = FifteenMapGenerator.find_blank(map)
    if (!d || !bl) return false
    const tx = bl.x - d.dx, ty = bl.y - d.dy
    if (tx < 0 || ty < 0 || ty >= map.length || tx >= map[0].length) return false
    if (map[ty][tx] !== move.tile) return false
    map[bl.y][bl.x] = move.tile
    map[ty][tx] = 0
    return true
  }

  /** Play moves on a copy of the map. Returns { ok, solved, final, boards } (boards[0] is the start). */
  static replay(map, moves) {
    const m = FifteenMapGenerator.clone(map)
    const boards = [FifteenMapGenerator.clone(m)]
    for (const mv of moves) {
      if (!FifteenMapGenerator.apply_move(m, mv)) return { ok: false, solved: false, final: m, boards }
      boards.push(FifteenMapGenerator.clone(m))
    }
    return { ok: true, solved: FifteenMapGenerator.is_solved(m), final: m, boards }
  }

  /** Render a map as text. The gap is shown as a dot. */
  static to_text(map) {
    const w = String(map.length * map[0].length - 1).length
    return map.map(row => row.map(v => (v === 0 ? '.' : String(v)).padStart(w)).join(' ')).join('\n')
  }

  /** Render boards side by side, `per_row` to a line, each with a label above it. */
  static boards_to_text(boards, per_row = 6, labels = null) {
    const out = []
    for (let s = 0; s < boards.length; s += per_row) {
      const chunk = boards.slice(s, s + per_row).map((b, i) =>
        [labels ? labels[s + i] : `#${s + i}`].concat(FifteenMapGenerator.to_text(b).split('\n')))
      const widths = chunk.map(lines => Math.max(...lines.map(l => l.length)))
      for (let r = 0; r < chunk[0].length; r++) out.push(chunk.map((lines, i) => lines[r].padEnd(widths[i])).join('    ').trimEnd())
      out.push('')
    }
    return out.join('\n').trimEnd()
  }

  /** "1. 12\u2193  2. 8\u2192 ..." : the tile and the direction it slides, `per_line` moves to a line. */
  static moves_to_text(moves, per_line = 8) {
    const cells = moves.map((m, i) => `${String(i + 1).padStart(3)}. ${m.tile}${FIFTEEN.DIRS[m.dir].arrow}`.padEnd(11))
    const lines = []
    for (let i = 0; i < cells.length; i += per_line) lines.push(cells.slice(i, i + per_line).join('').trimEnd())
    return lines.join('\n')
  }

  // ---- generation ----

  // One random walk from the solved position. With cut_loops, stepping back onto a position
  // already visited cuts the loop out, so the stored solution never goes round in circles.
  // Without it the walk stops as soon as `need` tiles are out of place.
  _scramble(goal, cut_loops, need) {
    const cols = this.columns, rows = this.rows
    const names = Object.keys(FIFTEEN.DIRS)
    const map = FifteenMapGenerator.clone(goal)
    const path = []                                  // scramble moves, solved -> start
    const keys = [FifteenMapGenerator.key(map)]      // keys[i] = position after i moves
    const index = new Map([[keys[0], 0]])
    let last = null

    for (let i = 0; i < this.shuffle_moves; i++) {
      const bl = FifteenMapGenerator.find_blank(map)
      const cands = []
      for (const name of names) {
        const d = FIFTEEN.DIRS[name]
        const tx = bl.x - d.dx, ty = bl.y - d.dy       // the tile that would slide this way
        if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue
        if (last && name === FIFTEEN.DIRS[last].opp) continue   // don't undo the previous move
        cands.push({ name, tx, ty })
      }
      const c = cands[Math.floor(this.rng() * cands.length)]
      const tile = map[c.ty][c.tx]
      map[bl.y][bl.x] = tile
      map[c.ty][c.tx] = 0
      path.push({ tile, dir: c.name })
      last = c.name

      if (cut_loops) {
        const k = FifteenMapGenerator.key(map)
        if (index.has(k)) {                            // back on a visited position: cut the loop
          const j = index.get(k)
          for (let q = j + 1; q < keys.length; q++) index.delete(keys[q])
          keys.length = j + 1
          path.length = j
          last = path.length ? path[path.length - 1].dir : null
        } else {
          keys.push(k)
          index.set(k, keys.length - 1)
        }
      } else if (FifteenMapGenerator.analyze(map).misplaced >= need) {
        break
      }
    }
    const solution = path.slice().reverse().map(m => ({ tile: m.tile, dir: FIFTEEN.DIRS[m.dir].opp }))
    return { map, solution, goal }
  }

  /**
   * Returns { map, solution, goal }
   *   map       the scrambled start position
   *   solution  list of { tile, dir } moves that solve it (not necessarily the shortest)
   *   goal      the solved position
   *
   * It scrambles by a random walk from the solved position, which is why every puzzle is
   * solvable: the solution is just the walk played backwards.
   */
  generate() {
    const goal = FifteenMapGenerator.goal(this.columns, this.rows)
    const need = Math.ceil(this.columns * this.rows * 0.6)   // tiles that must be out of place
    const good = (r) => !FifteenMapGenerator.is_solved(r.map) && FifteenMapGenerator.analyze(r.map).misplaced >= need
    let r = null

    for (let attempt = 0; attempt < 50; attempt++) {
      r = this._scramble(goal, true, need)
      if (good(r)) return r
    }
    // Tiny boards (2 x 2 is a single ring of 12 positions) walk straight back home when loops
    // are cut, so walk without cutting and stop once enough tiles are out of place.
    for (let attempt = 0; attempt < 50; attempt++) {
      r = this._scramble(goal, false, need)
      if (good(r)) return r
    }
    return r
  }
}
