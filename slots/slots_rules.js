// Slot machine rules and outcome generator. Plain browser script, no modules, no Phaser.
// (Also loads in Node for testing: it exports SlotRules and slots_make_rng if `module` exists.)
//
// Symbols    'cherry', or { id: 'cherry', weight: 3 }. weight is the relative chance of that
//            symbol landing on a reel (default 1). 'wild' is just another symbol unless you
//            name it as the wildcard.
// Wins       an array of winning combinations, one entry per combination, in priority order
//            (the FIRST entry that matches is the win that gets reported). An entry is either
//              ['A', 'A', 'A']                                    one symbol per reel, left to right
//              { symbols: ['A', 'A', 'wild'], name: 'x', ... }    same, plus any extra data you want
//                                                                  handed back to win_callback
//            The token '*' (any_token) in an entry matches any symbol on that reel.
// Wildcard   config.wildcard names the wildcard symbol. By default it only matches where you
//            list it ([A, A, wild] needs a wild on the third reel). Set wildcard_substitutes:
//            true and a wild on the reels stands in for anything, so [A, A, A] is also won by
//            A, wild, A without listing it.
// Order      ordered: true (default) means entries match reel by reel. ordered: false means
//            [A, A, B] is won by A, B, A and B, A, A as well.

function slots_make_rng(seed) {
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

class SlotRules {
  /**
   * config:
   *   symbols              list of symbol ids or { id, weight }
   *   wildcard             id of the wildcard symbol, or null (it is added to symbols if missing)
   *   wildcard_substitutes true = a wildcard on the reels matches any symbol in a combination
   *   wins                 list of winning combinations (see top of file)
   *   ordered              true (default) = match reel by reel; false = any order
   *   any_token            the "matches anything" marker used inside combinations (default '*')
   *   reels                number of reels (default 3); every combination must be this long
   *   win_rate             null = natural odds from the symbol weights. A number from 0 to 1 =
   *                        decide win or lose first with that chance, then build a matching
   *                        result (a random combination from wins, or a random non-winning one)
   *   seed                 string/number for reproducible results (default random)
   *   result_provider      optional function({ play }) returning an array of symbol ids (one per
   *                        reel) to use as that spin's result, or null/undefined to fall back to
   *                        the normal random result. Use it for outcomes decided elsewhere.
   */
  constructor(config = {}) {
    this.reels = config.reels === undefined ? 3 : config.reels
    if (!Number.isInteger(this.reels) || this.reels < 1) throw new Error('SlotRules: reels must be a whole number, 1 or more')
    this.ordered = config.ordered !== false
    this.any_token = config.any_token === undefined ? '*' : config.any_token
    this.wildcard = config.wildcard === undefined ? null : config.wildcard
    this.wildcard_substitutes = !!config.wildcard_substitutes
    this.win_rate = typeof config.win_rate === 'number' ? Math.min(1, Math.max(0, config.win_rate)) : null
    this.result_provider = config.result_provider || null
    this.rng = slots_make_rng(config.seed)

    // symbols -> [{ id, weight }]
    this.symbols = []
    for (const s of config.symbols || []) {
      const sym = typeof s === 'object' ? { id: s.id, weight: s.weight === undefined ? 1 : s.weight } : { id: s, weight: 1 }
      if (sym.id === undefined || sym.id === null || sym.id === '') throw new Error('SlotRules: every symbol needs an id')
      if (!(sym.weight > 0)) throw new Error(`SlotRules: symbol "${sym.id}" needs a weight above 0`)
      if (this.symbols.some(x => x.id === sym.id)) throw new Error(`SlotRules: symbol "${sym.id}" is listed twice`)
      this.symbols.push(sym)
    }
    if (this.wildcard !== null && !this.symbols.some(s => s.id === this.wildcard)) {
      this.symbols.push({ id: this.wildcard, weight: 1 })
    }
    if (this.symbols.length < 1) throw new Error('SlotRules: needs at least one symbol')
    this.ids = this.symbols.map(s => s.id)
    this.total_weight = this.symbols.reduce((a, s) => a + s.weight, 0)

    // wins -> [{ ...extra, symbols: [...], index }]
    this.wins = (config.wins || []).map((w, index) => {
      const entry = Array.isArray(w) ? { symbols: w.slice() } : Object.assign({}, w, { symbols: (w.symbols || []).slice() })
      entry.index = index
      if (entry.symbols.length !== this.reels) {
        throw new Error(`SlotRules: win #${index} [${entry.symbols.join(', ')}] has ${entry.symbols.length} symbols but there are ${this.reels} reels`)
      }
      for (const s of entry.symbols) {
        if (s !== this.any_token && !this.ids.includes(s)) {
          throw new Error(`SlotRules: win #${index} uses "${s}", which is not in symbols`)
        }
      }
      return entry
    })
  }

  // One symbol id, picked by weight.
  random_symbol() {
    let r = this.rng() * this.total_weight
    for (const s of this.symbols) {
      r -= s.weight
      if (r < 0) return s.id
    }
    return this.symbols[this.symbols.length - 1].id
  }

  random_result() {
    return Array.from({ length: this.reels }, () => this.random_symbol())
  }

  // The loop of symbols a reel scrolls through: each symbol appears about weight times
  // (at least once), shuffled, and padded to at least 8 so a reel never looks repetitive.
  // This is only what spinning looks like; results are decided separately.
  build_strip() {
    let strip = []
    for (const s of this.symbols) {
      for (let i = 0; i < Math.max(1, Math.round(s.weight)); i++) strip.push(s.id)
    }
    const once = strip.slice()
    while (strip.length < 8) strip = strip.concat(once)
    for (let i = strip.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [strip[i], strip[j]] = [strip[j], strip[i]]
    }
    return strip
  }

  // Does this result (array of ids) win? Returns the first matching win entry, or null.
  match(result) {
    for (const w of this.wins) if (this.matches(w.symbols, result)) return w
    return null
  }

  matches(pattern, result) {
    if (pattern.length !== result.length) return false
    const any = this.any_token
    const wild = this.wildcard
    const sub = this.wildcard_substitutes && wild !== null

    if (this.ordered) {
      return pattern.every((p, i) => p === any || p === result[i] || (sub && result[i] === wild))
    }

    // Any order: use up exact matches first, then let wilds fill what is still missing.
    // Whatever is left over goes to the '*' slots, and the lengths guarantee it fits.
    const left = result.slice()
    let missing = 0
    for (const p of pattern) {
      if (p === any) continue
      const i = left.indexOf(p)
      if (i >= 0) left.splice(i, 1)
      else missing++
    }
    if (missing === 0) return true
    if (!sub) return false
    return left.filter(s => s === wild).length >= missing
  }

  validate_result(result) {
    if (!Array.isArray(result) || result.length !== this.reels) {
      throw new Error(`SlotRules: a result needs ${this.reels} symbols, got ${JSON.stringify(result)}`)
    }
    for (const s of result) {
      if (!this.ids.includes(s)) throw new Error(`SlotRules: result uses "${s}", which is not in symbols`)
    }
    return result
  }

  // A random result that wins: pick one of the wins and fill any '*' with random symbols.
  winning_result() {
    const w = this.wins[Math.floor(this.rng() * this.wins.length)]
    const result = w.symbols.map(s => (s === this.any_token ? this.random_symbol() : s))
    if (!this.ordered) {
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]]
      }
    }
    return result
  }

  // A random result that does not win. If every possible result wins, this gives up and
  // returns a random one after a lot of tries.
  losing_result() {
    let result
    for (let i = 0; i < 500; i++) {
      result = this.random_result()
      if (!this.match(result)) return result
    }
    return result
  }

  // The result for one spin: { play } is the 1-based number of this spin.
  generate(info = {}) {
    if (this.result_provider) {
      const given = this.result_provider(info)
      if (given !== null && given !== undefined) return this.validate_result(given.slice())
    }
    if (this.win_rate !== null) {
      const win = this.wins.length > 0 && this.rng() < this.win_rate
      return win ? this.winning_result() : this.losing_result()
    }
    return this.random_result()
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SlotRules, slots_make_rng }
