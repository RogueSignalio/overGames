// Light Up (Akari) map generator and solver. Plain browser script, no modules.
//
// Rules: put lamps on white cells so that
//   1. every white cell is lit (a lamp lights its row and column until a black cell blocks it),
//   2. no lamp lights another lamp,
//   3. every black cell with a number has exactly that many lamps orthogonally next to it.
//
// Map cell codes, map[y][x]:
//   -1      white cell
//   0..4    black cell showing that number
//   5       black cell with no number
// Lamp grids use 1 = lamp, 0 = no lamp, also indexed [y][x].

const LU = {
  WHITE: -1,
  BLACK: 5,
  DIRS: [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ],
}

// Seeded RNG (FNV-1a hash -> mulberry32). No seed = Math.random.
function lu_make_rng(seed) {
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

class LightUpMapGenerator {
  /**
   * config:
   *   columns, rows   grid size
   *   black_percent   chance (0-100) that a cell starts black (default 20)
   *   symmetry        'rot2' (180 degree rotational, default) or 'none'
   *   unique          guarantee exactly one solution (default true)
   *   max_attempts    layouts to try before giving up on uniqueness (default 200)
   *   reduce_clues    remove every number that isn't needed (default true)
   *   seed            string/number for reproducible maps (default random)
   */
  constructor(config = {}) {
    this.columns = config.columns || 7
    this.rows = config.rows || 7
    this.black_percent = config.black_percent ?? 20
    this.symmetry = config.symmetry ?? 'rot2'
    this.unique = config.unique ?? true
    this.max_attempts = config.max_attempts ?? 200
    this.reduce_clues = config.reduce_clues ?? true
    this.seed = config.seed ?? null
    this.rng = lu_make_rng(this.seed)
    if (this.columns * this.rows < 4) throw new Error('Grid must have at least 4 cells')
  }

  // ---- checking (static so the game can use them too) ----

  /**
   * Work out the state of a lamp layout.
   * Returns {
   *   lit[y][x]       true if the cell is lit (lamps count as lit)
   *   conflict[y][x]  true for lamps that can see another lamp
   *   clue[y][x]      for numbered black cells: 'ok' (exact), 'err' (too many), 'pending'; else null
   *   solved          every white cell lit, no conflicts, every number exact
   * }
   */
  static analyze(map, lamps) {
    const h = map.length, w = map[0].length
    const grid = (fill) => Array.from({ length: h }, () => Array(w).fill(fill))
    const lit = grid(false), conflict = grid(false), clue = grid(null)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!lamps[y][x]) continue
        lit[y][x] = true
        for (const d of LU.DIRS) {
          let nx = x + d.dx, ny = y + d.dy
          while (nx >= 0 && ny >= 0 && nx < w && ny < h && map[ny][nx] === LU.WHITE) {
            lit[ny][nx] = true
            if (lamps[ny][nx]) { conflict[y][x] = true; conflict[ny][nx] = true }
            nx += d.dx; ny += d.dy
          }
        }
      }
    }

    let all_lit = true, clues_ok = true, any_conflict = false
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = map[y][x]
        if (v === LU.WHITE) {
          if (!lit[y][x]) all_lit = false
          if (conflict[y][x]) any_conflict = true
        } else if (v >= 0 && v <= 4) {
          let count = 0
          for (const d of LU.DIRS) {
            const nx = x + d.dx, ny = y + d.dy
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && lamps[ny][nx]) count++
          }
          clue[y][x] = count > v ? 'err' : (count === v ? 'ok' : 'pending')
          if (clue[y][x] !== 'ok') clues_ok = false
        }
      }
    }
    return { lit, conflict, clue, solved: all_lit && !any_conflict && clues_ok }
  }

  /**
   * Render a map (and optionally a lamp layout) as text for the console.
   *   *  lamp      -  lit cell      .  unlit cell      #  black      0-4  number
   */
  static to_text(map, lamps = null, axes = true) {
    const h = map.length, w = map[0].length
    const layout = lamps || map.map(row => row.map(() => 0))
    const a = LightUpMapGenerator.analyze(map, layout)
    const lines = []
    if (axes) lines.push('    ' + Array.from({ length: w }, (_, x) => x % 10).join(' '))
    for (let y = 0; y < h; y++) {
      const cells = map[y].map((v, x) => {
        if (v === LU.WHITE) return layout[y][x] ? '*' : (a.lit[y][x] ? '-' : '.')
        return v === LU.BLACK ? '#' : String(v)
      })
      lines.push((axes ? String(y).padStart(2, ' ') + '  ' : '') + cells.join(' '))
    }
    return lines.join('\n')
  }

  // ---- solver ----

  /**
   * Find up to `limit` solutions using propagation + backtracking.
   * Returns { count, solutions } where each solution is a 0/1 lamp grid.
   * Numbers that were removed (code 5) simply don't constrain anything.
   */
  static solve(map, limit = 2) {
    const h = map.length, w = map[0].length
    const UNK = 0, LAMP = 1, NO = 2
    const isWhite = new Uint8Array(w * h)
    const white = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (map[y][x] === LU.WHITE) { isWhite[y * w + x] = 1; white.push(y * w + x) }
      }
    }

    // seers[i]: white cells in the same row/column segment as i (not including i)
    const seers = new Array(w * h)
    for (const i of white) {
      const x = i % w, y = (i / w) | 0
      const list = []
      for (const d of LU.DIRS) {
        let nx = x + d.dx, ny = y + d.dy
        while (nx >= 0 && ny >= 0 && nx < w && ny < h && isWhite[ny * w + nx]) {
          list.push(ny * w + nx)
          nx += d.dx; ny += d.dy
        }
      }
      seers[i] = list
    }

    // numbered black cells and their white neighbours
    const clues = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = map[y][x]
        if (v < 0 || v > 4) continue
        const cells = []
        for (const d of LU.DIRS) {
          const nx = x + d.dx, ny = y + d.dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && isWhite[ny * w + nx]) cells.push(ny * w + nx)
        }
        clues.push({ n: v, cells })
      }
    }

    // Apply every deduction until nothing changes. Returns false on contradiction.
    function propagate(st) {
      let changed = true
      while (changed) {
        changed = false

        // a lamp rules out every other cell it can see
        for (const i of white) {
          if (st[i] !== LAMP) continue
          for (const s of seers[i]) {
            if (st[s] === LAMP) return false
            if (st[s] === UNK) { st[s] = NO; changed = true }
          }
        }

        // an unlit cell needs a lamp somewhere in its row/column segment
        for (const i of white) {
          if (st[i] === LAMP) continue
          let lit = false
          for (const s of seers[i]) if (st[s] === LAMP) { lit = true; break }
          if (lit) continue
          let cnt = 0, last = -1
          if (st[i] === UNK) { cnt++; last = i }
          for (const s of seers[i]) if (st[s] === UNK) { cnt++; last = s }
          if (cnt === 0) return false
          if (cnt === 1) { st[last] = LAMP; changed = true }
        }

        // numbers need exactly n lamps around them
        for (const c of clues) {
          let L = 0, U = 0
          for (const i of c.cells) { if (st[i] === LAMP) L++; else if (st[i] === UNK) U++ }
          if (L > c.n || L + U < c.n) return false
          if (U > 0 && L === c.n) {
            for (const i of c.cells) if (st[i] === UNK) st[i] = NO
            changed = true
          } else if (U > 0 && L + U === c.n) {
            for (const i of c.cells) if (st[i] === UNK) st[i] = LAMP
            changed = true
          }
        }
      }
      return true
    }

    const solutions = []
    function search(st) {
      if (solutions.length >= limit) return
      if (!propagate(st)) return

      // branch on the unlit cell with the fewest places a lamp could go
      let best = -1, best_cnt = Infinity
      for (const i of white) {
        if (st[i] === LAMP) continue
        let lit = false
        for (const s of seers[i]) if (st[s] === LAMP) { lit = true; break }
        if (lit) continue
        let cnt = st[i] === UNK ? 1 : 0
        for (const s of seers[i]) if (st[s] === UNK) cnt++
        if (cnt < best_cnt) { best_cnt = cnt; best = i }
      }

      if (best === -1) {  // everything lit and consistent
        const grid = Array.from({ length: h }, () => Array(w).fill(0))
        for (const i of white) if (st[i] === LAMP) grid[(i / w) | 0][i % w] = 1
        solutions.push(grid)
        return
      }

      const v = st[best] === UNK ? best : seers[best].find(s => st[s] === UNK)
      const a = Int8Array.from(st); a[v] = LAMP; search(a)
      if (solutions.length >= limit) return
      const b = Int8Array.from(st); b[v] = NO; search(b)
    }

    search(new Int8Array(w * h))
    return { count: solutions.length, solutions }
  }

  // ---- generation ----

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  _set_black(layout, x, y) {
    layout[y][x] = LU.BLACK
    if (this.symmetry === 'rot2') layout[this.rows - 1 - y][this.columns - 1 - x] = LU.BLACK
  }

  // Random black cells, everything else white.
  _place_black() {
    const layout = Array.from({ length: this.rows }, () => Array(this.columns).fill(LU.WHITE))
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        if (this.rng() * 100 < this.black_percent) this._set_black(layout, x, y)
      }
    }
    return layout
  }

  // Pick a random unlit white cell, put a lamp on a random unlit cell that can light it, repeat.
  // Only unlit cells are used, so no lamp ever sees another. Always ends with every cell lit.
  _place_lamps(layout) {
    const w = this.columns, h = this.rows
    const lamps = Array.from({ length: h }, () => Array(w).fill(0))
    const lit = Array.from({ length: h }, () => Array(w).fill(false))
    const whites = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (layout[y][x] === LU.WHITE) whites.push([x, y])
    this._shuffle(whites)

    for (const [x, y] of whites) {
      if (lit[y][x]) continue
      const cand = [[x, y]]
      for (const d of LU.DIRS) {
        let nx = x + d.dx, ny = y + d.dy
        while (nx >= 0 && ny >= 0 && nx < w && ny < h && layout[ny][nx] === LU.WHITE) {
          if (!lit[ny][nx]) cand.push([nx, ny])
          nx += d.dx; ny += d.dy
        }
      }
      const [cx, cy] = cand[Math.floor(this.rng() * cand.length)]
      lamps[cy][cx] = 1
      lit[cy][cx] = true
      for (const d of LU.DIRS) {
        let nx = cx + d.dx, ny = cy + d.dy
        while (nx >= 0 && ny >= 0 && nx < w && ny < h && layout[ny][nx] === LU.WHITE) {
          lit[ny][nx] = true
          nx += d.dx; ny += d.dy
        }
      }
    }
    return lamps
  }

  // Copy the layout, giving every black cell the number of lamps next to it.
  _with_clues(layout, lamps) {
    const w = this.columns, h = this.rows
    const map = layout.map(row => row.slice())
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (map[y][x] !== LU.BLACK) continue
        let n = 0
        for (const d of LU.DIRS) {
          const nx = x + d.dx, ny = y + d.dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && lamps[ny][nx]) n++
        }
        map[y][x] = n
      }
    }
    return map
  }

  // Drop each number (in random order) unless that makes the solution non-unique.
  _reduce_clues(map) {
    const cells = []
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) if (map[y][x] >= 0 && map[y][x] <= 4) cells.push([x, y])
    }
    this._shuffle(cells)
    for (const [x, y] of cells) {
      const keep = map[y][x]
      map[y][x] = LU.BLACK
      if (LightUpMapGenerator.solve(map, 2).count !== 1) map[y][x] = keep
    }
  }

  /**
   * Returns { map, solution, unique }
   *   map       the puzzle (see cell codes at the top of this file)
   *   solution  0/1 lamp grid that solves it
   *   unique    true if the solver proved it has exactly one solution
   */
  generate() {
    const total = this.columns * this.rows
    const repairs = Math.max(6, Math.floor(total / 5))
    const max_black = Math.floor(total * 0.45)
    let fallback = null

    for (let attempt = 0; attempt < this.max_attempts; attempt++) {
      const layout = this._place_black()

      for (let r = 0; r <= repairs; r++) {
        if (layout.flat().filter(v => v !== LU.WHITE).length > max_black) break

        const lamps = this._place_lamps(layout)
        const map = this._with_clues(layout, lamps)
        fallback = { map, solution: lamps, unique: false }
        if (!this.unique) return fallback

        const res = LightUpMapGenerator.solve(map, 2)
        if (res.count === 1) {
          if (this.reduce_clues) this._reduce_clues(map)
          return { map, solution: lamps, unique: true }
        }

        // Ambiguous: turn a cell where two solutions disagree into a black cell, then try again.
        const other = res.solutions.find(s => s.some((row, y) => row.some((v, x) => v !== lamps[y][x]))) || res.solutions[0]
        const diff = []
        for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.columns; x++) {
            if (other[y][x] !== lamps[y][x] && layout[y][x] === LU.WHITE) diff.push([x, y])
          }
        }
        if (!diff.length) break
        const [dx, dy] = diff[Math.floor(this.rng() * diff.length)]
        this._set_black(layout, dx, dy)
      }
    }

    console.warn('LightUpMapGenerator: could not prove uniqueness, returning a best-effort map')
    return fallback
  }
}
