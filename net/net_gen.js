// Net / FreeNet map generator (no wrapping). Plain browser script, no modules.
// Tiles are 4-bit masks: N=1, E=2, S=4, W=8. Grids are indexed grid[y][x].

const NET = {
  N: 1, E: 2, S: 4, W: 8,
  DIRS: [
    { bit: 1, opp: 4, dx: 0, dy: -1, name: 'N' },
    { bit: 2, opp: 8, dx: 1, dy: 0, name: 'E' },
    { bit: 4, opp: 1, dx: 0, dy: 1, name: 'S' },
    { bit: 8, opp: 2, dx: -1, dy: 0, name: 'W' },
  ],
}

// Seeded RNG (FNV-1a hash -> mulberry32). No seed = Math.random.
function net_make_rng(seed) {
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

class NetMapGenerator {
  /**
   * config:
   *   columns, rows   grid size
   *   branch_bias     0 = bushy, 1 = snaky (default 0.4)
   *   allow_cross     allow 4-way tiles (default false)
   *   seed            string/number for reproducible maps (default random)
   */
  constructor(config = {}) {
    this.columns = config.columns || 7
    this.rows = config.rows || 7
    this.branch_bias = config.branch_bias ?? 0.4
    this.allow_cross = config.allow_cross ?? false
    this.seed = config.seed ?? null
    this.rng = net_make_rng(this.seed)
    if (this.columns * this.rows < 2) throw new Error('Grid must have at least 2 cells')
  }

  // ---- helpers (static so the game can use them too) ----

  static bits(mask) {
    return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)
  }

  // Render a grid as box-drawing characters (handy for debugging).
  static to_text(grid) {
    const CHARS = [' ', '╵', '╶', '└', '╷', '│', '┌', '├', '╴', '┘', '─', '┴', '┐', '┤', '┬', '┼']
    return grid.map(row => row.map(m => CHARS[m]).join('')).join('\n')
  }

  // Rotate a mask 90 degrees clockwise, `times` times (negative = counter-clockwise).
  static rotate(mask, times = 1) {
    const n = ((times % 4) + 4) % 4
    for (let i = 0; i < n; i++) mask = ((mask << 1) | (mask >> 3)) & 0b1111
    return mask
  }

  // Flood fill from the server. Returns grid of booleans: true = powered.
  static getPowered(grid, server) {
    const h = grid.length, w = grid[0].length
    const powered = Array.from({ length: h }, () => Array(w).fill(false))
    const stack = [[server.x, server.y]]
    powered[server.y][server.x] = true
    while (stack.length) {
      const [x, y] = stack.pop()
      for (const d of NET.DIRS) {
        if (!(grid[y][x] & d.bit)) continue
        const nx = x + d.dx, ny = y + d.dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if (powered[ny][nx] || !(grid[ny][nx] & d.opp)) continue
        powered[ny][nx] = true
        stack.push([nx, ny])
      }
    }
    return powered
  }

  // Win: every tile powered, and no open end faces a wall or a closed side.
  static isSolved(grid, server) {
    const h = grid.length, w = grid[0].length
    const powered = NetMapGenerator.getPowered(grid, server)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!powered[y][x]) return false
        for (const d of NET.DIRS) {
          if (!(grid[y][x] & d.bit)) continue
          const nx = x + d.dx, ny = y + d.dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false
          if (!(grid[ny][nx] & d.opp)) return false
        }
      }
    }
    return true
  }

  // ---- generation ----

  // Random spanning tree (Prim's with a DFS-style bias). Returns null if
  // banning crosses stranded a cell; generate() retries.
  _build_solution() {
    const w = this.columns, h = this.rows
    const grid = Array.from({ length: h }, () => Array(w).fill(0))
    const seen = Array.from({ length: h }, () => Array(w).fill(false))
    const server = { x: w >> 1, y: h >> 1 }
    const frontier = []
    let count = 0

    const add = (x, y) => {
      seen[y][x] = true
      count++
      for (const d of NET.DIRS) {
        const nx = x + d.dx, ny = y + d.dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny][nx]) continue
        frontier.push({ x, y, nx, ny, d })
      }
    }

    add(server.x, server.y)
    while (frontier.length) {
      const i = this.rng() < this.branch_bias
        ? frontier.length - 1
        : Math.floor(this.rng() * frontier.length)
      const e = frontier[i]
      frontier[i] = frontier[frontier.length - 1]
      frontier.pop()

      if (seen[e.ny][e.nx]) continue
      if (!this.allow_cross && NetMapGenerator.bits(grid[e.y][e.x]) >= 3) continue

      grid[e.y][e.x] |= e.d.bit
      grid[e.ny][e.nx] |= e.d.opp
      add(e.nx, e.ny)
    }
    return count === w * h ? { grid, server } : null
  }

  /**
   * Returns { map, solution, server }
   *   map       scrambled grid the player starts with
   *   solution  solved grid
   *   server    { x, y } power source
   */
  generate() {
    let built = null
    for (let attempt = 0; attempt < 100 && !built; attempt++) built = this._build_solution()
    if (!built) throw new Error('Could not generate a map; try allow_cross: true')

    const { grid: solution, server } = built
    let map
    do {
      map = solution.map(row => row.map(m => NetMapGenerator.rotate(m, Math.floor(this.rng() * 4))))
    } while (NetMapGenerator.isSolved(map, server))

    return { map, solution, server }
  }
}
