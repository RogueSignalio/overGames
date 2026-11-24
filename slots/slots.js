// Slot machine mini game (Phaser 3), image/theme based and responsive.
// Plain browser script; needs Phaser and slots_rules.js loaded first.
//
// new SlotGame(config, phaser_config)
//
//   Rules (see slots_rules.js for the details of each)
//   config.symbols       list of symbol ids, or { id, weight }  e.g. ['cherry', 'bell', { id: 'seven', weight: 0.5 }]
//   config.wins          list of winning combinations, e.g. [['cherry','cherry','cherry'], ['cherry','cherry','wild']]
//                        An entry can also be { symbols: [...], name: 'jackpot', anything: 'you like' };
//                        the whole entry is passed back to win_callback as `win`. '*' matches any symbol.
//   config.wildcard      id of the wildcard symbol or null
//   config.wildcard_substitutes   true = a wildcard stands in for anything in every combination
//   config.ordered       true (default) = reel by reel; false = any order
//   config.reels         number of reels (default 3). Every combination needs exactly this many symbols.
//   config.visible_rows  rows of symbols shown in each reel window (default 3). Only the middle
//                        row counts (the payline). With an even number, the lower middle row.
//   config.win_rate      null = natural odds from symbol weights; 0..1 = force that chance of a win
//   config.seed          reproducible results
//   config.result_provider  function({ play }) -> ['cherry','bell','cherry'] to decide a spin yourself
//
//   Plays
//   config.plays         how many spins the player gets (default 5). Infinity or null = unlimited.
//   game.add_plays(n)    give more plays, also to a game that has already run out (returns the new total)
//   game.set_plays(n)    set the remaining plays to an exact number
//   game.plays_left      plays remaining (read only; use the two methods above to change it)
//   game.spin()          same as pressing the button (returns false if it can't spin right now)
//
//   Callbacks (all optional)
//   config.win_callback            called after the reels stop on a win
//   config.lose_callback           called after the reels stop on a loss
//   config.out_of_plays_callback   called once the last play has finished, win or lose
//   Each is given { play, plays_left, result, win, submit }:
//     play        number of this spin, from 1
//     plays_left  plays remaining after this spin
//     result      symbols on the payline, left to right, e.g. ['cherry','cherry','wild']
//     win         the winning entry from config.wins ({ symbols, index, ...your extra data }), null on a loss
//     submit      a string like the slider game's, "play=3;result=cherry,cherry,wild;win=1"
//                 (win= is the index of the winning entry, or "none")
//
//   Layout and size
//   config.responsive    true (default): the machine scales to fill its container.
//                        false: fixed size, using tile_size pixels per symbol cell.
//   config.max_tile_size responsive only: cap the symbol cell size in pixels
//   config.tile_size     pixels per symbol cell when responsive is false (default 96)
//
//   Spin feel
//   Each reel does: a small wind-up (it dips back against the spin), speeds up, runs at full
//   speed, slows down, drops slightly past its stop and rebounds into place. Everything is
//   randomized a little per reel and per spin, and reels always stop left to right.
//   config.spin_ms          how long the first reel spins at full tilt, roughly, in ms (default 1400)
//   config.stagger_ms       each further reel spins this much longer (default 350)
//   config.spin_jitter_ms   random +/- added to each reel's spin time (default 150)
//   config.start_stagger_ms reels start this much after one another, plus a little randomness (default 60)
//   config.speed            top scroll speed in symbols per second (default 14; varies a bit per reel)
//   config.bounce           size of the wind-up and the rebound, 0 = none, 1 = normal (default 1)
//   config.motion_blur      0..1, how much symbols stretch and fade while moving fast (default 0.4)
//   config.reel_ease        optional. A Phaser ease name or function (e.g. 'Cubic.easeInOut') switches
//                           back to the old plain eased spin with no wind-up or rebound. Default null.
//
//   Text and audio
//   config.messages      { win, lose, plays, out } texts. plays uses {n}. Set one to '' to hide it.
//   config.message_ms    how long the win/lose message stays up (default 1800)
//   config.volume        0..1 (default 1)       config.muted    true to start silent
//   game.set_volume(v), game.set_muted(bool)
//   config.keyboard      Space or Enter spins (default true)
//   config.debug         true = log every spin to the console
//   phaser_config        merged into the Phaser.Game config. Pass { parent: 'game' } with the
//                        id of the container element (it needs a real width and height).
//
// Themes
//   A theme is a folder of images and sounds plus a few settings:
//     path              folder holding the files, e.g. 'assets/default/'
//     background        full-canvas background image (scaled to cover the canvas), or null
//     background_color  CSS color shown behind everything
//     foreground        the machine itself, drawn OVER the reels. The reel windows must be
//                       transparent. Stretched over the machine rectangle (see layout), or null
//     reel              backing drawn under the symbols in each reel window (stretched), or null
//     button            spin button, any aspect ratio (its height is set by the game)
//     button_disabled   same button when it can't be pressed (falls back to button, dimmed)
//     symbol_scale      size of a symbol image as a fraction of its cell (default 0.8)
//     symbols           filename per symbol id. Default is symbol_<id>.png, so only list overrides:
//                       { cherry: 'my_cherry.png' }
//     sounds            { spin, stop, win, lose } filenames, any may be null or missing.
//                       A list of files gives fallbacks, e.g. ['win.ogg', 'win.mp3'].
//                       spin loops while the reels turn; stop plays as each reel lands.
//     text_color        color of the plays counter and messages (default '#ffffff')
//     payline_color     color of a line drawn through the payline row, or null for none
//     drum_angle        how round the reels look: the angle, in radians, that one symbol step turns
//                       the drum (default 0.45; 0 = flat, a straight strip). It is reduced
//                       automatically if the reel window is tall enough that it would wrap too far.
//     shade             the cylinder shading drawn over each reel window: { strength, highlight, color }
//                       strength    how dark the top and bottom edges get, 0..1 (default 0.6)
//                       highlight   a soft light band near the top, 0..1 (default 0.12)
//                       color       the edge color (default '#000000')
//                       Set shade to null for no shading.
//     shade_image       optional filename of your own shading image (transparent, stretched over
//                       each reel window, drawn over the symbols). Replaces the generated shading.
//     layout            { pad_x, pad_top, pad_bottom, gap } in symbol cells. This is the one thing
//                       the foreground art has to line up with:
//                         pad_x       frame width at the left and right of the reels
//                         pad_top     frame height above the reels
//                         pad_bottom  frame height below the reels (holds the counter and button)
//                         gap         space between neighbouring reels
//                       Machine width  = reels + (reels - 1) * gap + 2 * pad_x   (in cells)
//                       Machine height = visible_rows + pad_top + pad_bottom     (in cells)
//                       Draw foreground.png at that aspect ratio with a transparent hole for each window.
//   Because the machine can be scaled up, supply art at 128px per cell or more.

const SLOTS_THEME_DEFAULT = {
  path: 'assets/default/',
  background: 'background.png',
  background_color: '#1a1a2e',
  foreground: 'foreground.png',
  reel: 'reel.png',
  button: 'button.png',
  button_disabled: 'button_disabled.png',
  symbol_scale: 0.8,
  symbols: {},
  sounds: { spin: 'spin.wav', stop: 'stop.wav', win: 'win.wav', lose: 'lose.wav' },
  text_color: '#ffffff',
  payline_color: null,
  drum_angle: 0.45,
  shade: { strength: 0.6, highlight: 0.12, color: '#000000' },
  shade_image: null,
  layout: { pad_x: 0.55, pad_top: 0.55, pad_bottom: 1.7, gap: 0.12 },
}

class SlotGame {
  constructor(config = {}, phaser_config = {}) {
    const c = this.config = Object.assign({
      symbols: ['cherry', 'lemon', 'bell', 'seven', 'star'],
      wins: [],
      wildcard: null,
      wildcard_substitutes: false,
      ordered: true,
      any_token: '*',
      reels: 3,
      visible_rows: 3,
      win_rate: null,
      seed: null,
      result_provider: null,
      plays: 5,
      responsive: true,
      max_tile_size: null,
      tile_size: 96,
      spin_ms: 1400,
      stagger_ms: 350,
      speed: 14,
      spin_jitter_ms: 150,
      start_stagger_ms: 60,
      bounce: 1,
      motion_blur: 0.4,
      reel_ease: null,
      messages: {},
      message_ms: 1800,
      volume: 1,
      muted: false,
      keyboard: true,
      theme: {},
      win_callback: null,
      lose_callback: null,
      out_of_plays_callback: null,
      debug: false,
    }, config)
    c.messages = Object.assign({ win: 'You win!', lose: 'Try again', plays: 'Plays left: {n}', out: 'No plays left' }, config.messages)

    const t = c.theme || {}
    this.theme = Object.assign({}, SLOTS_THEME_DEFAULT, t, {
      symbols: Object.assign({}, SLOTS_THEME_DEFAULT.symbols, t.symbols),
      sounds: Object.assign({}, SLOTS_THEME_DEFAULT.sounds, t.sounds),
      layout: Object.assign({}, SLOTS_THEME_DEFAULT.layout, t.layout),
      shade: t.shade === null ? null : Object.assign({}, SLOTS_THEME_DEFAULT.shade, t.shade),
    })

    if (!Number.isInteger(c.visible_rows) || c.visible_rows < 1) throw new Error('SlotGame: visible_rows must be a whole number, 1 or more')
    this.rules = new SlotRules(c)   // throws on a bad symbol list or win combination
    this.reel_count = this.rules.reels
    this.rows = c.visible_rows
    this.mid = Math.floor(this.rows / 2)

    this.plays_left = SlotGame.clean_plays(c.plays)
    this.play_number = 0
    this.spinning = false
    this.scene = null
    this.sprites = []
    this.pulses = []
    this.msg_timer = null
    this.ts = 0
    this.ox = 0
    this.oy = 0
    this.reels = []
    for (let i = 0; i < this.reel_count; i++) {
      const strip = this.rules.build_strip()
      this.reels.push({ strip, pos: Math.floor(Math.random() * strip.length), vel: 0, cells: [], tween: null })
    }

    const self = this
    const base = {
      type: Phaser.AUTO,
      backgroundColor: this.theme.background_color,
      scene: {
        preload: function () { self.preload(this) },
        create: function () { self.create(this) },
      },
    }
    if (c.responsive) {
      base.scale = { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%', resizeInterval: 100 }
    } else {
      const size = this.machine_size()
      base.width = Math.ceil(size.w * c.tile_size)
      base.height = Math.ceil(size.h * c.tile_size)
    }
    const scale = Object.assign({}, base.scale, phaser_config.scale)
    this.phaser = new Phaser.Game(Object.assign({}, base, phaser_config, { scale }))
  }

  // null / Infinity / non-numbers = unlimited, everything else a whole number >= 0
  static clean_plays(n) {
    if (n === null || n === undefined || n === Infinity) return Infinity
    n = Math.floor(Number(n))
    return Number.isFinite(n) ? Math.max(0, n) : Infinity
  }

  // Machine size in symbol cells.
  machine_size() {
    const L = this.theme.layout
    return {
      w: this.reel_count + (this.reel_count - 1) * L.gap + 2 * L.pad_x,
      h: this.rows + L.pad_top + L.pad_bottom,
    }
  }

  // ---------------------------------------------------------------- public api

  // Give more plays. Works at any time, including after the game ran out. Returns the new total.
  add_plays(n = 1) {
    n = Math.floor(Number(n))
    if (!(n > 0)) return this.plays_left
    this.plays_left += n   // Infinity stays Infinity
    this.refresh_hud()
    return this.plays_left
  }

  // Set the remaining plays to an exact number (null / Infinity = unlimited).
  set_plays(n) {
    this.plays_left = SlotGame.clean_plays(n)
    this.refresh_hud()
    return this.plays_left
  }

  // Start a spin, like pressing the button. Returns false if it can't start right now.
  spin() {
    if (!this.scene || !this.ts || this.spinning || this.plays_left <= 0) return false

    this.plays_left--
    this.play_number++
    this.spinning = true
    this.hide_msg()
    this.stop_pulses()

    const result = this.rules.generate({ play: this.play_number })
    this.stopped = 0
    this.sound_start_spin()
    this.refresh_hud()

    let prev_stop = 0
    this.reels.forEach((reel, i) => {
      if (reel.tween) reel.tween.stop()
      const len = reel.strip.length
      const cur = Math.round(reel.pos)
      const options = []
      reel.strip.forEach((sym, idx) => { if (sym === result[i]) options.push(idx) })
      const target_index = options[Math.floor(Math.random() * options.length)]
      // how far the reel must turn for the chosen symbol to end up on the payline
      const delta = (((target_index + this.mid - cur) % len) + len) % len

      const plan = this.plan_reel(i, cur, delta, len, prev_stop)
      prev_stop = plan.abs_land
      reel.plan = plan
      reel.vel = 0
      reel.last_t = null
      let landed = false

      reel.tween = this.scene.tweens.addCounter({
        from: 0,
        to: plan.total_ms,
        duration: plan.total_ms,
        delay: plan.delay_ms,
        ease: 'Linear',
        onUpdate: (tw) => {
          const t = tw.getValue()
          const p = plan.at(t)
          if (reel.last_t !== null && t > reel.last_t) {
            const v = Math.abs(p - reel.last_pos) / ((t - reel.last_t) / 1000)
            reel.vel = reel.vel * 0.6 + v * 0.4   // smoothed, it only drives the blur
          }
          reel.last_t = t
          reel.last_pos = p
          reel.pos = p
          if (!landed && t >= plan.land_ms) { landed = true; this.play_sound('stop') }   // the thud as it drops in
          this.update_reel(i)
        },
        onComplete: () => {
          reel.pos = plan.target % len
          reel.vel = 0
          reel.tween = null
          this.update_reel(i)
          if (!landed) this.play_sound('stop')
          if (++this.stopped === this.reel_count) this.finish(result)
        },
      })
    })
    return true
  }

  // The motion of one reel for one spin, as a function of time. `cur` is the whole-number position it
  // starts from, `delta` how far it must turn (0 .. len - 1) to land the chosen symbol on the payline,
  // `prev_stop` when the reel to its left lands, in ms from the start of the spin.
  // Returns { at(t_ms) -> position, delay_ms, total_ms, land_ms, abs_land, target, peak }.
  plan_reel(i, cur, delta, len, prev_stop) {
    const c = this.config
    const rnd = (a, b) => a + Math.random() * (b - a)

    if (c.reel_ease) {   // old behaviour: one eased move, no wind-up or rebound
      const duration = c.spin_ms + i * c.stagger_ms
      const laps = Math.max(1, Math.ceil((c.speed * duration / 1000 - delta) / len))
      const target = cur + delta + laps * len
      const ease = typeof c.reel_ease === 'function' ? c.reel_ease : Phaser.Tweens.Builders.GetEaseFunction(c.reel_ease)
      return {
        delay_ms: 0, total_ms: duration, land_ms: duration, abs_land: duration, target, peak: c.speed,
        at: (t) => cur + (target - cur) * ease(Math.min(1, Math.max(0, t / duration))),
      }
    }

    const A = 0.14, B = 0.38                 // share of the main run spent speeding up / slowing down
    const T = 1 - (A + B) / 2                // distance covered, as a share of (top speed x main run time)
    const bounce = Math.max(0, c.bounce)
    const w = bounce * rnd(0.15, 0.4)        // wind-up: symbols the reel dips back first
    const over = bounce * rnd(0.12, 0.3)     // symbols it overshoots its stop by before rebounding
    const wu = bounce > 0 ? rnd(110, 190) : 0
    const settle = bounce > 0 ? rnd(260, 420) : 0
    const delay = c.start_stagger_ms > 0 ? i * c.start_stagger_ms + rnd(0, c.start_stagger_ms * 0.5) : 0
    // asked-for run time; later reels are always asked to land at least 220 ms after the one before
    const want = Math.max(300, c.spin_ms + i * c.stagger_ms + rnd(-1, 1) * c.spin_jitter_ms, prev_stop + 220 - delay - wu)
    const speed = Math.max(1, c.speed) * rnd(0.92, 1.08)   // each reel runs a touch faster or slower

    // whole laps of the strip so it runs about as long as asked at about the top speed
    const base = delta + over + w
    const laps0 = Math.max(1, Math.floor((speed * want / 1000 * T - base) / len))
    let best = null
    for (const laps of [laps0, laps0 + 1]) {
      const D = base + laps * len
      const dur = D / (speed * T) * 1000
      const err = Math.abs(Math.log(dur / want))
      if (!best || err < best.err) best = { laps, D, dur, err }
    }
    let dur = Math.min(want * 1.35, Math.max(want * 0.75, best.dur))
    dur = Math.max(dur, prev_stop + 160 - delay - wu)   // reels land left to right, at least 160 ms apart
    const D = best.D
    const target = cur + delta + best.laps * len
    const s0 = cur - w
    const total = wu + dur + settle

    // distance covered by the main run: speed ramps up over A, is flat, then ramps down over B
    const F = (p) => {
      let v
      if (p < A) v = p * p / (2 * A)
      else if (p < 1 - B) v = A / 2 + (p - A)
      else { const q = p - (1 - B); v = A / 2 + (1 - A - B) + q - q * q / (2 * B) }
      return v / T
    }
    const at = (t) => {
      if (t <= 0) return cur
      if (t < wu) { const p = t / wu; return cur - w * p * p * (3 - 2 * p) }
      if (t < wu + dur) return s0 + D * F((t - wu) / dur)
      if (settle > 0 && t < total) {
        const q = (t - wu - dur) / settle   // damped rebound: past the stop, back, a little past again, rest
        return target + over * (1 - q) * (1 - q) * Math.cos(Math.PI * 2.5 * q)
      }
      return target
    }
    return { at, delay_ms: delay, total_ms: total, land_ms: wu + dur, abs_land: delay + wu + dur, target, peak: D / (T * dur / 1000) }
  }

  // Cylinder shading: a one-pixel-wide gradient drawn to a canvas texture, stretched over each window.
  make_shade_texture(scene) {
    const sh = this.theme.shade
    if (!sh || this.theme.shade_image) return
    if (scene.textures.exists('slots_shade')) scene.textures.remove('slots_shade')
    const W = 4, H = 256
    const tex = scene.textures.createCanvas('slots_shade', W, H)
    const ctx = tex.getContext()
    const col = Phaser.Display.Color.HexStringToColor(sh.color)
    const rgb = `${col.red},${col.green},${col.blue}`
    const dark = ctx.createLinearGradient(0, 0, 0, H)
    for (let n = 0; n <= 24; n++) {
      const p = n / 24
      dark.addColorStop(p, `rgba(${rgb},${(sh.strength * Math.pow(Math.abs(2 * p - 1), 2.2)).toFixed(3)})`)
    }
    ctx.fillStyle = dark
    ctx.fillRect(0, 0, W, H)
    if (sh.highlight > 0) {
      const lite = ctx.createLinearGradient(0, 0, 0, H)
      lite.addColorStop(0, 'rgba(255,255,255,0)')
      lite.addColorStop(0.14, 'rgba(255,255,255,0)')
      lite.addColorStop(0.28, `rgba(255,255,255,${sh.highlight})`)
      lite.addColorStop(0.42, 'rgba(255,255,255,0)')
      lite.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = lite
      ctx.fillRect(0, 0, W, H)
    }
    tex.refresh()
  }

  set_volume(v) {
    this.config.volume = Math.min(1, Math.max(0, Number(v) || 0))
    if (this.scene && this.scene.sound) this.scene.sound.volume = this.config.volume
  }

  set_muted(m) {
    this.config.muted = !!m
    if (this.scene && this.scene.sound) this.scene.sound.mute = this.config.muted
  }

  destroy() { this.phaser.destroy(true) }

  // ---------------------------------------------------------------- phaser scene

  preload(scene) {
    const t = this.theme
    scene.load.setPath(t.path)
    for (const key of ['background', 'foreground', 'reel', 'button', 'button_disabled']) {
      if (t[key]) scene.load.image(`slots_${key}`, t[key])
    }
    if (t.shade_image) scene.load.image('slots_shade', t.shade_image)
    for (const id of this.rules.ids) {
      scene.load.image(`slots_sym_${id}`, t.symbols[id] || `symbol_${id}.png`)
    }
    for (const [name, file] of Object.entries(t.sounds)) {
      if (file && (!Array.isArray(file) || file.length)) scene.load.audio(`slots_snd_${name}`, file)
    }
  }

  create(scene) {
    this.scene = scene
    const c = this.config, th = this.theme

    if (scene.sound) {
      scene.sound.volume = c.volume
      scene.sound.mute = c.muted
      if (this.has_sound('spin')) this.spin_sound = scene.sound.add('slots_snd_spin', { loop: true })
    }

    const style = (extra) => Object.assign({ fontFamily: 'sans-serif', fontStyle: 'bold', color: th.text_color }, extra)
    this.plays_text = scene.add.text(0, 0, '', style({ fontSize: '24px' })).setOrigin(0.5).setDepth(6)
    this.msg = scene.add.text(0, 0, '', style({
      fontSize: '32px', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)', padding: { x: 14, y: 8 },
    })).setOrigin(0.5).setDepth(7).setVisible(false)

    this.make_shade_texture(scene)
    scene.scale.on('resize', () => this.relayout())
    if (c.keyboard && scene.input.keyboard) {
      scene.input.keyboard.addCapture('SPACE')
      scene.input.keyboard.on('keydown-SPACE', () => this.spin())
      scene.input.keyboard.on('keydown-ENTER', () => this.spin())
    }
    this.relayout()
  }

  // Work out cell size and machine position from the canvas size, then rebuild the sprites.
  // Runs once at start and on every container resize (reels keep spinning through it).
  relayout() {
    if (!this.scene) return
    const W = this.scene.scale.width, H = this.scene.scale.height
    if (W < 8 || H < 8) return

    const size = this.machine_size()
    let ts = this.config.tile_size
    if (this.config.responsive) {
      ts = Math.floor(Math.min(W / size.w, H / size.h))
      if (this.config.max_tile_size) ts = Math.min(ts, this.config.max_tile_size)
    }
    this.ts = Math.max(1, ts)
    this.ox = Math.floor((W - size.w * this.ts) / 2)
    this.oy = Math.floor((H - size.h * this.ts) / 2)
    this.size = size

    // drum geometry: a symbol d cells from the middle of the window turns d * a radians round the
    // drum, so it sits R * sin(a * d) from the middle and is squashed to cos(a * d) of its height.
    // R is chosen so the top and bottom edges of the window land exactly on the window edges.
    const half = this.rows / 2
    const a = Math.min(Math.max(0, this.theme.drum_angle), 1.4 / (half + 1.5))   // keep cos() well above 0
    this.drum_a = a
    this.drum_R = a > 1e-4 ? (half * this.ts) / Math.sin(a * half) : 0

    this.scene.cameras.main.setBackgroundColor(this.theme.background_color)
    this.build_sprites()
    this.refresh_hud()
  }

  clear_sprites() {
    this.stop_pulses()
    this.sprites.forEach(s => s.destroy())
    this.sprites = []
    this.reels.forEach(r => { r.cells = [] })
    if (this.masks) this.masks.forEach(m => m.destroy())
    this.masks = []
  }

  // Layers: 0 background, 1 reel backing, 2 symbols, 3 foreground, 4 payline, 5 button,
  // 6 counter text, 7 message
  build_sprites() {
    const scene = this.scene, th = this.theme, L = th.layout
    const ts = this.ts, rows = this.rows
    const W = scene.scale.width, H = scene.scale.height
    const add = (obj) => { this.sprites.push(obj); return obj }
    this.clear_sprites()

    if (th.background) {
      const img = add(scene.add.image(W / 2, H / 2, 'slots_background').setDepth(0))
      const k = Math.max(W / img.width, H / img.height)   // cover
      img.setDisplaySize(img.width * k, img.height * k)
    }

    const mw = this.size.w * ts, mh = this.size.h * ts
    const win_top = this.oy + L.pad_top * ts
    const sym = Math.round(ts * th.symbol_scale)

    for (let i = 0; i < this.reel_count; i++) {
      const left = this.reel_left(i)
      if (th.reel) add(scene.add.image(left, win_top, 'slots_reel').setOrigin(0).setDisplaySize(ts, rows * ts).setDepth(1))

      const g = scene.make.graphics({ x: 0, y: 0, add: false })
      g.fillStyle(0xffffff).fillRect(left, win_top, ts, rows * ts)
      const mask = g.createGeometryMask()
      this.masks.push(mask)
      this.sprites.push(g)

      const reel = this.reels[i]
      for (let k = -1; k <= rows; k++) {
        const s = add(scene.add.image(left + ts / 2, win_top + ts / 2, `slots_sym_${reel.strip[0]}`).setDepth(2))
        s.setMask(mask)
        s.sym_size = sym
        reel.cells.push(s)
      }
      this.update_reel(i)

      if (th.shade || th.shade_image) {
        add(scene.add.image(left, win_top, 'slots_shade').setOrigin(0).setDisplaySize(ts, rows * ts).setDepth(2.5))
      }
    }

    if (th.foreground) {
      add(scene.add.image(this.ox, this.oy, 'slots_foreground').setOrigin(0).setDisplaySize(mw, mh).setDepth(3))
    }
    if (th.payline_color && rows > 1) {
      const y = win_top + (this.mid + 0.5) * ts
      const line = scene.add.graphics().setDepth(4)
      line.lineStyle(Math.max(2, Math.round(ts * 0.04)), Phaser.Display.Color.HexStringToColor(th.payline_color).color, 0.7)
      line.lineBetween(this.reel_left(0), y, this.reel_left(this.reel_count - 1) + ts, y)
      add(line)
    }

    // button, in the strip below the reels
    const bottom = win_top + rows * ts
    const strip_h = L.pad_bottom * ts
    const bh = Math.min(ts * 0.9, strip_h * 0.5)
    this.button = add(scene.add.image(this.ox + mw / 2, bottom + strip_h * 0.64, 'slots_button').setDepth(5))
    const aspect = this.button.width / this.button.height
    this.button_w = Math.min(bh * aspect, mw * 0.8)
    this.button_h = this.button_w / aspect
    this.button.setDisplaySize(this.button_w, this.button_h)
    this.button.setInteractive({ useHandCursor: true })
    this.button.on('pointerdown', () => this.spin())

    this.plays_text.setPosition(this.ox + mw / 2, bottom + strip_h * 0.2).setFontSize(Math.max(10, Math.round(ts * 0.3)))
    this.msg.setPosition(this.ox + mw / 2, win_top + (this.mid + 0.5) * ts).setFontSize(Math.max(14, Math.round(ts * 0.5)))
  }

  reel_left(i) {
    const L = this.theme.layout
    return this.ox + (L.pad_x + i * (1 + L.gap)) * this.ts
  }

  // Position, size and texture of the cells of one reel for its current scroll position `pos`.
  // Cell k (-1 .. rows) shows strip[base - k]; as pos grows the symbols move down.
  // Cells are placed on a drum: see relayout() for the geometry. Fast reels also stretch and
  // fade their symbols a little (motion_blur).
  update_reel(i) {
    const reel = this.reels[i]
    if (!reel.cells.length) return
    const len = reel.strip.length
    const base = Math.floor(reel.pos), frac = reel.pos - base
    const ts = this.ts, a = this.drum_a, R = this.drum_R
    const mid_y = this.oy + this.theme.layout.pad_top * ts + this.rows * ts / 2
    const cx = this.reel_left(i) + ts / 2
    const speed_share = Math.min(1, reel.vel / Math.max(1, this.config.speed))
    const blur = Math.max(0, this.config.motion_blur) * speed_share
    for (let k = -1; k <= this.rows; k++) {
      const s = reel.cells[k + 1]
      const key = `slots_sym_${reel.strip[(((base - k) % len) + len) % len]}`
      if (s.texture.key !== key) s.setTexture(key)
      const d = k + frac + 0.5 - this.rows / 2     // cells from the middle of the window
      let y = mid_y + d * ts, squash = 1
      if (a > 0) { y = mid_y + R * Math.sin(a * d); squash = Math.cos(a * d) }
      s.setDisplaySize(s.sym_size, Math.max(1, s.sym_size * squash * (1 + blur * 0.6)))
      s.setAlpha(1 - 0.3 * blur)
      s.setPosition(cx, y)
    }
  }

  // ---------------------------------------------------------------- results

  finish(result) {
    this.spinning = false
    this.sound_stop_spin()

    const win = this.rules.match(result)
    const payload = {
      play: this.play_number,
      plays_left: this.plays_left,
      result: result.slice(),
      win: win ? Object.assign({}, win, { symbols: win.symbols.slice() }) : null,
      submit: `play=${this.play_number};result=${result.join(',')};win=${win ? win.index : 'none'}`,
    }
    if (this.config.debug) console.log(`Play ${this.play_number}: ${result.join(' | ')} -> ${win ? 'WIN (entry ' + win.index + ')' : 'no win'}, ${this.plays_left} plays left`)

    if (win) this.pulse_payline()
    this.play_sound(win ? 'win' : 'lose')
    this.show_msg(win ? this.config.messages.win : this.config.messages.lose)
    this.refresh_hud()

    // callbacks last, so the game is already in a consistent state if one of them calls add_plays()
    const c = this.config
    if (win && c.win_callback) c.win_callback(payload)
    if (!win && c.lose_callback) c.lose_callback(payload)
    if (this.plays_left <= 0 && c.out_of_plays_callback) c.out_of_plays_callback(payload)
  }

  // Make the winning symbols pulse.
  pulse_payline() {
    this.reels.forEach((reel, i) => {
      const s = reel.cells[this.mid + 1]
      const w = s.displayWidth, h = s.displayHeight
      this.pulses.push(this.scene.tweens.add({
        targets: s, displayWidth: w * 1.25, displayHeight: h * 1.25,
        duration: 220, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
        onComplete: () => { if (s.scene) this.update_reel(i) },
      }))
    })
  }

  stop_pulses() {
    this.pulses.forEach(t => t.stop())
    this.pulses = []
    this.reels.forEach((_, i) => this.update_reel(i))   // update_reel puts the size back
  }

  // ---------------------------------------------------------------- hud

  button_enabled() { return !this.spinning && this.plays_left > 0 }

  refresh_hud() {
    if (!this.scene || !this.ts) return
    const m = this.config.messages
    const left = this.plays_left === Infinity ? '\u221e' : String(this.plays_left)
    this.plays_text.setText(this.plays_left <= 0 && !this.spinning ? m.out : (m.plays || '').replace('{n}', left))
    if (this.button) {
      const th = this.theme
      const key = this.button_enabled() ? 'slots_button' : (th.button_disabled ? 'slots_button_disabled' : 'slots_button')
      if (this.button.texture.key !== key) this.button.setTexture(key)
      this.button.setDisplaySize(this.button_w, this.button_h)
      this.button.setAlpha(this.button_enabled() || th.button_disabled ? 1 : 0.5)
    }
  }

  show_msg(text) {
    if (!text) return
    this.msg.setText(text).setVisible(true)
    if (this.msg_timer) this.msg_timer.remove(false)
    this.msg_timer = this.scene.time.delayedCall(this.config.message_ms, () => this.hide_msg())
  }

  hide_msg() {
    if (this.msg_timer) { this.msg_timer.remove(false); this.msg_timer = null }
    if (this.msg) this.msg.setVisible(false)
  }

  // ---------------------------------------------------------------- audio

  has_sound(name) {
    return !!(this.scene && this.scene.cache.audio.exists(`slots_snd_${name}`))
  }

  play_sound(name) {
    if (this.has_sound(name)) this.scene.sound.play(`slots_snd_${name}`)
  }

  sound_start_spin() {
    if (this.spin_sound && !this.spin_sound.isPlaying) this.spin_sound.play()
  }

  sound_stop_spin() {
    if (this.spin_sound) this.spin_sound.stop()
  }
}
