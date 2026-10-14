// Loopy (Slitherlink) map generator and solver, square grid. Plain browser script, no modules.
//
// Rules: draw lines along the grid edges so that
//   1. the lines form ONE closed loop that never crosses or branches,
//   2. every number in a cell equals how many of that cell's four sides are part of the loop.
//
// Map: map[y][x] is the number (0..4) for a cell, or -1 for a cell with no number.
//
// Lines: { h, v } with 1 = line, 0 = no line (the solver also never needs "crossed" marks).
//   h[y][x]  horizontal edge on grid line y (0..rows) between vertex x and x+1   (x: 0..columns-1)
//   v[y][x]  vertical edge on grid line x (0..columns) between vertex y and y+1  (y: 0..rows-1)
//   So cell (x, y) is bounded by h[y][x] (top), h[y+1][x] (bottom), v[y][x] (left), v[y][x+1] (right).

// Seeded RNG (FNV-1a hash -> mulberry32). No seed = Math.random.
function loopy_make_rng(seed) {
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

class LoopyMapGenerator {
  /**
   * config:
   *   columns, rows   grid size in cells
   *   fill_percent    roughly how much of the grid the loop encloses (default 55)
   *   winding         0..1, higher = thinner, more twisting loops (default 0.3)
   *   difficulty      'easy'  solvable by pure deduction, never guessing (default)
   *                   'hard'  unique, but may need trial and error
   *   unique          guarantee exactly one solution (default true)
   *   reduce_clues    remove every number that isn't needed (default true)
   *   max_attempts    loops to try before giving up on uniqueness (default 200)
   *   max_nodes       search budget per uniqueness check in 'hard' mode (default 500; higher = fewer clues but slower)
   *   seed            string/number for reproducible maps (default random)
   */
  constructor(config = {}) {
    this.columns = config.columns || 6
    this.rows = config.rows || 6
    this.fill_percent = config.fill_percent ?? 55
    this.winding = config.winding ?? 0.3
    this.difficulty = config.difficulty ?? 'easy'
    this.unique = config.unique ?? true
    this.reduce_clues = config.reduce_clues ?? true
    this.max_attempts = config.max_attempts ?? 200
    this.max_nodes = config.max_nodes ?? 500
    this.seed = config.seed ?? null
    this.rng = loopy_make_rng(this.seed)
    if (this.columns < 2 || this.rows < 2) throw new Error('Grid must be at least 2 x 2')
  }

  // ---- checking (static so the game can use them too) ----

  /**
   * Work out the state of a set of lines.
   * Returns {
   *   clue[y][x]        for numbered cells: 'ok' (exact), 'err' (too many), 'pending'; else null
   *   vdeg[y][x]        how many lines touch each vertex (rows+1 by columns+1)
   *   vertex_err[y][x]  true where 3 or more lines meet
   *   lines             number of lines drawn
   *   closed            the lines form exactly one closed loop
   *   solved            closed, and every number is exact
   * }
   */
  static analyze(map, lines) {
    const H = map.length, W = map[0].length
    const { h, v } = lines
    const vdeg = Array.from({ length: H + 1 }, () => Array(W + 1).fill(0))
    let n_lines = 0

    for (let y = 0; y <= H; y++) {
      for (let x = 0; x < W; x++) {
        if (h[y][x]) { vdeg[y][x]++; vdeg[y][x + 1]++; n_lines++ }
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x <= W; x++) {
        if (v[y][x]) { vdeg[y][x]++; vdeg[y + 1][x]++; n_lines++ }
      }
    }

    const vertex_err = vdeg.map(row => row.map(d => d > 2))

    const clue = Array.from({ length: H }, () => Array(W).fill(null))
    let clues_ok = true
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = map[y][x]
        if (n < 0) continue
        const count = (h[y][x] ? 1 : 0) + (h[y + 1][x] ? 1 : 0) + (v[y][x] ? 1 : 0) + (v[y][x + 1] ? 1 : 0)
        clue[y][x] = count > n ? 'err' : (count === n ? 'ok' : 'pending')
        if (clue[y][x] !== 'ok') clues_ok = false
      }
    }

    // one closed loop: every touched vertex has exactly 2 lines, and they are all connected
    let degrees_ok = n_lines > 0
    let touched = 0, start = null
    for (let y = 0; y <= H && degrees_ok; y++) {
      for (let x = 0; x <= W; x++) {
        if (vdeg[y][x] === 0) continue
        if (vdeg[y][x] !== 2) { degrees_ok = false; break }
        touched++
        if (!start) start = [x, y]
      }
    }
    let closed = false
    if (degrees_ok && start) {
      const seen = new Set([start[1] * (W + 1) + start[0]])
      const stack = [start]
      while (stack.length) {
        const [x, y] = stack.pop()
        const next = []
        if (x < W && h[y][x]) next.push([x + 1, y])
        if (x > 0 && h[y][x - 1]) next.push([x - 1, y])
        if (y < H && v[y][x]) next.push([x, y + 1])
        if (y > 0 && v[y - 1][x]) next.push([x, y - 1])
        for (const [nx, ny] of next) {
          const key = ny * (W + 1) + nx
          if (!seen.has(key)) { seen.add(key); stack.push([nx, ny]) }
        }
      }
      closed = seen.size === touched
    }

    return { clue, vdeg, vertex_err, lines: n_lines, closed, solved: closed && clues_ok }
  }

  /** Render a map (and optionally lines) as text for the console. */
  static to_text(map, lines = null) {
    const H = map.length, W = map[0].length
    const out = []
    for (let y = 0; y <= H; y++) {
      let top = '+'
      for (let x = 0; x < W; x++) top += (lines && lines.h[y][x] ? '---' : '   ') + '+'
      out.push(top)
      if (y === H) break
      let mid = ''
      for (let x = 0; x <= W; x++) {
        mid += lines && lines.v[y][x] ? '|' : ' '
        if (x < W) mid += map[y][x] >= 0 ? ` ${map[y][x]} ` : '   '
      }
      out.push(mid)
    }
    return out.join('\n')
  }

  // ---- grid topology (shared by the solver) ----

  static _topology(W, H) {
    LoopyMapGenerator._topo_cache = LoopyMapGenerator._topo_cache || {}
    const key = W + 'x' + H
    if (LoopyMapGenerator._topo_cache[key]) return LoopyMapGenerator._topo_cache[key]

    const E = (H + 1) * W + H * (W + 1)
    const hid = (y, x) => y * W + x
    const vid = (y, x) => (H + 1) * W + y * (W + 1) + x
    const vtx = (y, x) => y * (W + 1) + x
    const ea = new Int32Array(E), eb = new Int32Array(E)
    for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) { ea[hid(y, x)] = vtx(y, x); eb[hid(y, x)] = vtx(y, x + 1) }
    for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) { ea[vid(y, x)] = vtx(y, x); eb[vid(y, x)] = vtx(y + 1, x) }

    const vedges = Array.from({ length: (W + 1) * (H + 1) }, () => [])
    for (let e = 0; e < E; e++) { vedges[ea[e]].push(e); vedges[eb[e]].push(e) }

    const cedges = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cedges.push([hid(y, x), hid(y + 1, x), vid(y, x), vid(y, x + 1)])

    const topo = { W, H, E, hid, vid, vtx, ea, eb, vedges, cedges }
    LoopyMapGenerator._topo_cache[key] = topo
    return topo
  }

  // ---- solver ----

  /**
   * Find up to `limit` solutions using deduction + backtracking.
   * opts.guess      false = deduction only, never branch (default true)
   * opts.max_nodes  give up after this many search nodes (default unlimited)
   * Returns { count, solutions, aborted } where each solution is { h, v } lines.
   * With guess:false, count 1 means the puzzle falls to deduction alone.
   */
  static solve(map, limit = 2, opts = {}) {
    const guess = opts.guess ?? true
    const max_nodes = opts.max_nodes ?? Infinity
    const H = map.length, W = map[0].length
    const T = LoopyMapGenerator._topology(W, H)
    const { E, ea, eb, vedges, cedges } = T
    const nV = (W + 1) * (H + 1)
    const UNK = 0, LINE = 1, NO = 2

    const clue = new Int8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) clue[y * W + x] = map[y][x] >= 0 ? map[y][x] : -1

    const parent = new Int32Array(nV)
    const ldeg = new Int8Array(nV)
    const comp_edges = new Int32Array(nV)
    const comp_verts = new Int32Array(nV)
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }

    // Apply every deduction until nothing changes. Returns false on contradiction.
    function propagate(st) {
      let changed = true
      while (changed) {
        changed = false

        // numbers: exactly n of the four sides
        for (let c = 0; c < cedges.length; c++) {
          const n = clue[c]
          if (n < 0) continue
          const ce = cedges[c]
          let L = 0, U = 0
          for (let k = 0; k < 4; k++) { const s = st[ce[k]]; if (s === LINE) L++; else if (s === UNK) U++ }
          if (L > n || L + U < n) return false
          if (U > 0) {
            if (L === n) { for (let k = 0; k < 4; k++) if (st[ce[k]] === UNK) st[ce[k]] = NO; changed = true }
            else if (L + U === n) { for (let k = 0; k < 4; k++) if (st[ce[k]] === UNK) st[ce[k]] = LINE; changed = true }
          }
        }

        // vertices: 0 or 2 lines, never 1 or 3+
        for (let v = 0; v < nV; v++) {
          const ve = vedges[v]
          let L = 0, U = 0
          for (const e of ve) { if (st[e] === LINE) L++; else if (st[e] === UNK) U++ }
          if (L > 2) return false
          if (L === 2) {
            if (U > 0) { for (const e of ve) if (st[e] === UNK) st[e] = NO; changed = true }
          } else if (L === 1) {
            if (U === 0) return false
            if (U === 1) { for (const e of ve) if (st[e] === UNK) st[e] = LINE; changed = true }
          } else if (U === 1) {
            for (const e of ve) if (st[e] === UNK) st[e] = NO
            changed = true
          }
        }

        // single loop: no closed cycle while other lines exist, and no premature closing
        for (let i = 0; i < nV; i++) { parent[i] = i; ldeg[i] = 0; comp_edges[i] = 0; comp_verts[i] = 0 }
        let total = 0
        for (let e = 0; e < E; e++) {
          if (st[e] !== LINE) continue
          total++
          ldeg[ea[e]]++; ldeg[eb[e]]++
          const a = find(ea[e]), b = find(eb[e])
          if (a !== b) parent[a] = b
        }
        for (let e = 0; e < E; e++) if (st[e] === LINE) comp_edges[find(ea[e])]++
        for (let v = 0; v < nV; v++) if (ldeg[v] > 0) comp_verts[find(v)]++

        for (let v = 0; v < nV; v++) {
          if (ldeg[v] === 0 || find(v) !== v) continue
          if (comp_edges[v] === comp_verts[v]) {          // this component is a closed cycle
            if (comp_edges[v] !== total) return false      // ...but other lines exist
            for (let e = 0; e < E; e++) if (st[e] === UNK) { st[e] = NO; changed = true }
          }
        }
        if (changed) continue

        for (let e = 0; e < E; e++) {
          if (st[e] !== UNK) continue
          const a = ea[e], b = eb[e]
          if (ldeg[a] > 0 && ldeg[b] > 0 && find(a) === find(b) && comp_edges[find(a)] < total) {
            st[e] = NO; changed = true
          }
        }
      }
      return true
    }

    // Which unknown edge to branch on: extend a path end, else most constrained number, else any.
    function pick_edge(st) {
      for (let v = 0; v < nV; v++) {
        let L = 0, first = -1
        for (const e of vedges[v]) { if (st[e] === LINE) L++; else if (st[e] === UNK && first < 0) first = e }
        if (L === 1 && first >= 0) return first
      }
      let best = -1, best_u = 9
      for (let c = 0; c < cedges.length; c++) {
        if (clue[c] < 0) continue
        let U = 0, first = -1
        for (const e of cedges[c]) if (st[e] === UNK) { U++; if (first < 0) first = e }
        if (U > 0 && U < best_u) { best_u = U; best = first }
      }
      if (best >= 0) return best
      for (let e = 0; e < E; e++) if (st[e] === UNK) return e
      return -1
    }

    function to_lines(st) {
      const h = Array.from({ length: H + 1 }, () => Array(W).fill(0))
      const v = Array.from({ length: H }, () => Array(W + 1).fill(0))
      for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) if (st[T.hid(y, x)] === LINE) h[y][x] = 1
      for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (st[T.vid(y, x)] === LINE) v[y][x] = 1
      return { h, v }
    }

    const solutions = []
    let nodes = 0, aborted = false

    function search(st) {
      if (solutions.length >= limit || aborted) return
      if (++nodes > max_nodes) { aborted = true; return }
      if (!propagate(st)) return

      const e = pick_edge(st)
      if (e < 0) {  // nothing left undecided
        let any = false
        for (let i = 0; i < E; i++) if (st[i] === LINE) { any = true; break }
        if (any) solutions.push(to_lines(st))
        return
      }
      if (!guess) return

      const a = Int8Array.from(st); a[e] = LINE; search(a)
      if (solutions.length >= limit || aborted) return
      const b = Int8Array.from(st); b[e] = NO; search(b)
    }

    search(new Int8Array(E))
    return { count: solutions.length, solutions, aborted }
  }

  // ---- generation ----

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  // True if the cells outside the region (plus the border around the grid) are all connected.
  _outside_connected(inside) {
    const w = this.columns, h = this.rows
    const W2 = w + 2, H2 = h + 2
    const seen = new Uint8Array(W2 * H2)
    let inside_count = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside[y][x]) inside_count++
    const stack = [0]
    seen[0] = 1
    let reached = 1
    while (stack.length) {
      const i = stack.pop()
      const x = i % W2, y = (i / W2) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue
        const ni = ny * W2 + nx
        if (seen[ni]) continue
        const cx = nx - 1, cy = ny - 1
        if (cx >= 0 && cy >= 0 && cx < w && cy < h && inside[cy][cx]) continue
        seen[ni] = 1; reached++; stack.push(ni)
      }
    }
    return reached === W2 * H2 - inside_count
  }

  // Can (x, y) join the region without making a hole or a pinch point? Either would
  // stop the border of the region being a single simple loop.
  _can_add(inside, x, y) {
    const w = this.columns, h = this.rows
    const at = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && inside[yy][xx]
    inside[y][x] = true
    let ok = true
    for (const [bx, by] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) {
      const a = at(bx, by), b = at(bx + 1, by), c = at(bx, by + 1), d = at(bx + 1, by + 1)
      if ((a && d && !b && !c) || (b && c && !a && !d)) { ok = false; break }  // diagonal-only touch
    }
    if (ok) ok = this._outside_connected(inside)
    inside[y][x] = false
    return ok
  }

  // Grow a random region cell by cell. Its outline is the solution loop.
  _grow_region() {
    const w = this.columns, h = this.rows
    const inside = Array.from({ length: h }, () => Array(w).fill(false))
    const target = Math.max(4, Math.round(w * h * this.fill_percent / 100))
    inside[Math.floor(this.rng() * h)][Math.floor(this.rng() * w)] = true
    let count = 1
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]

    while (count < target) {
      const thin = [], thick = []
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (inside[y][x]) continue
          let n = 0
          for (const [dx, dy] of nb) {
            const nx = x + dx, ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && inside[ny][nx]) n++
          }
          if (n === 1) thin.push([x, y]); else if (n > 1) thick.push([x, y])
        }
      }
      this._shuffle(thin); this._shuffle(thick)
      const order = this.rng() < this.winding ? thin.concat(thick) : this._shuffle(thin.concat(thick))

      let placed = false
      for (const [x, y] of order) {
        if (this._can_add(inside, x, y)) { inside[y][x] = true; count++; placed = true; break }
      }
      if (!placed) break
    }
    return count >= Math.ceil(target * 0.7) ? inside : null
  }

  // Number of sides of each cell that lie on the region's border.
  _clues_from(inside) {
    const w = this.columns, h = this.rows
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y][x]
    return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
      let n = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy) !== at(x, y)) n++
      return n
    }))
  }

  // The border of the region as lines.
  _lines_from(inside) {
    const w = this.columns, h = this.rows
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y][x]
    const hh = Array.from({ length: h + 1 }, (_, y) => Array.from({ length: w }, (_, x) => (at(x, y - 1) !== at(x, y) ? 1 : 0)))
    const vv = Array.from({ length: h }, (_, y) => Array.from({ length: w + 1 }, (_, x) => (at(x - 1, y) !== at(x, y) ? 1 : 0)))
    return { h: hh, v: vv }
  }

  // Does this map have exactly one solution, at the requested difficulty?
  _is_unique(map) {
    if (this.difficulty === 'easy') {
      return LoopyMapGenerator.solve(map, 2, { guess: false }).count === 1
    }
    const res = LoopyMapGenerator.solve(map, 2, { guess: true, max_nodes: this.max_nodes })
    return res.count === 1 && !res.aborted
  }

  // Drop each number (in random order) unless that makes the puzzle too ambiguous.
  _reduce_clues(map) {
    const cells = []
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) cells.push([x, y])
    this._shuffle(cells)
    for (const [x, y] of cells) {
      const keep = map[y][x]
      map[y][x] = -1
      if (!this._is_unique(map)) map[y][x] = keep
    }
  }

  /**
   * Returns { map, solution, unique }
   *   map       numbers per cell, -1 = no number
   *   solution  { h, v } lines forming the loop
   *   unique    true if the solver proved exactly one solution
   */
  generate() {
    let fallback = null
    for (let attempt = 0; attempt < this.max_attempts; attempt++) {
      const inside = this._grow_region()
      if (!inside) continue
      const map = this._clues_from(inside)
      const solution = this._lines_from(inside)
      fallback = { map: map.map(r => r.slice()), solution, unique: false }
      if (!this.unique) return fallback
      if (!this._is_unique(map)) continue
      if (this.reduce_clues) this._reduce_clues(map)
      return { map, solution, unique: true }
    }
    if (!fallback) throw new Error('LoopyMapGenerator: could not grow a loop; try a smaller fill_percent')
    console.warn('LoopyMapGenerator: could not prove uniqueness, returning a best-effort map')
    return fallback
  }
}
