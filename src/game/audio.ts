export class AudioBus {
  muted = false
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private windGain: GainNode | null = null
  private rotorGain: GainNode | null = null
  private rotorOsc: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private rotorPanner: PannerNode | null = null
  private enginePanner: PannerNode | null = null
  private eraOn = false
  private eraGain: GainNode | null = null

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = 0.65
    master.connect(ctx.destination)
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    const wind = ctx.createGain()
    wind.gain.value = 0
    src.connect(filter)
    filter.connect(wind)
    wind.connect(master)
    src.start()

    const rotor = ctx.createOscillator()
    rotor.type = 'sawtooth'
    rotor.frequency.value = 46
    const rFilter = ctx.createBiquadFilter()
    rFilter.type = 'lowpass'
    rFilter.frequency.value = 160
    const rotorGain = ctx.createGain()
    rotorGain.gain.value = 0
    const rotorPanner = this.panner(ctx)
    rotor.connect(rFilter)
    rFilter.connect(rotorGain)
    rotorGain.connect(rotorPanner)
    rotorPanner.connect(master)
    rotor.start()

    const engine = ctx.createOscillator()
    engine.type = 'triangle'
    engine.frequency.value = 80
    const engineGain = ctx.createGain()
    engineGain.gain.value = 0
    const enginePanner = this.panner(ctx)
    engine.connect(engineGain)
    engineGain.connect(enginePanner)
    enginePanner.connect(master)
    engine.start()

    this.ctx = ctx
    this.master = master
    this.windGain = wind
    this.rotorGain = rotorGain
    this.rotorOsc = rotor
    this.engineGain = engineGain
    this.engineOsc = engine
    this.rotorPanner = rotorPanner
    this.enginePanner = enginePanner
    this.applyEraBed()
  }

  private panner(ctx: AudioContext): PannerNode {
    const node = ctx.createPanner()
    node.panningModel = 'HRTF'
    node.distanceModel = 'inverse'
    node.refDistance = 10
    node.maxDistance = 220
    node.rolloffFactor = 1.15
    return node
  }

  hear(
    cam: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
    heli: { x: number; y: number; z: number },
    car: { x: number; y: number; z: number },
  ): void {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const ear = ctx.listener
    ear.positionX.setTargetAtTime(cam.x, now, 0.05)
    ear.positionY.setTargetAtTime(cam.y, now, 0.05)
    ear.positionZ.setTargetAtTime(cam.z, now, 0.05)
    ear.forwardX.setTargetAtTime(forward.x, now, 0.05)
    ear.forwardY.setTargetAtTime(forward.y, now, 0.05)
    ear.forwardZ.setTargetAtTime(forward.z, now, 0.05)
    ear.upX.setTargetAtTime(0, now, 0.05)
    ear.upY.setTargetAtTime(1, now, 0.05)
    ear.upZ.setTargetAtTime(0, now, 0.05)
    this.rotorPanner?.positionX.setTargetAtTime(heli.x, now, 0.08)
    this.rotorPanner?.positionY.setTargetAtTime(heli.y, now, 0.08)
    this.rotorPanner?.positionZ.setTargetAtTime(heli.z, now, 0.08)
    this.enginePanner?.positionX.setTargetAtTime(car.x, now, 0.08)
    this.enginePanner?.positionY.setTargetAtTime(car.y, now, 0.08)
    this.enginePanner?.positionZ.setTargetAtTime(car.z, now, 0.08)
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.65
    return this.muted
  }

  wind(amount: number): void {
    if (!this.windGain || !this.ctx) return
    this.windGain.gain.setTargetAtTime(Math.max(0, amount) * 0.18, this.ctx.currentTime, 0.3)
  }

  rotor(amount: number, rpm: number): void {
    if (!this.rotorGain || !this.rotorOsc || !this.ctx) return
    this.rotorGain.gain.setTargetAtTime(Math.max(0, amount) * 0.22, this.ctx.currentTime, 0.08)
    this.rotorOsc.frequency.setTargetAtTime(38 + rpm * 8, this.ctx.currentTime, 0.1)
  }

  engine(amount: number, speed: number): void {
    if (!this.engineGain || !this.engineOsc || !this.ctx) return
    this.engineGain.gain.setTargetAtTime(Math.max(0, amount) * 0.12, this.ctx.currentTime, 0.08)
    this.engineOsc.frequency.setTargetAtTime(55 + Math.abs(speed) * 4.5, this.ctx.currentTime, 0.08)
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  /** Soft click when the town-clock hand snaps. */
  tick(): void {
    this.ensure()
    this.tone(1800, 0.03, 'square', 0.018)
  }

  /** A small bell, used when the hand lands on 1955. */
  bellSoft(): void {
    this.ensure()
    this.tone(1318, 0.26, 'sine', 0.045)
    window.setTimeout(() => this.tone(1760, 0.2, 'sine', 0.028), 90)
  }

  /** Two short blasts for the toy BART train. */
  toot(): void {
    this.ensure()
    this.tone(440, 0.16, 'sawtooth', 0.05)
    this.tone(330, 0.2, 'triangle', 0.04)
    window.setTimeout(() => {
      this.tone(392, 0.26, 'sawtooth', 0.045)
      this.tone(294, 0.28, 'triangle', 0.035)
    }, 220)
  }

  /** Rubber-stamp thump for a walking milestone. */
  thump(): void {
    this.ensure()
    this.tone(140, 0.06, 'sine', 0.07)
    this.tone(90, 0.08, 'triangle', 0.04)
  }

  /** A short pencil scratch when a street finishes inking. */
  scratch(): void {
    this.ensure()
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    const len = Math.floor(this.ctx.sampleRate * 0.16)
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len
      data[i] = (Math.random() * 2 - 1) * env * env
    }
    src.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1600
    filter.Q.value = 0.6
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.045, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    src.start(t)
  }

  bell(): void {
    this.ensure()
    this.tone(1568, 0.45, 'sine', 0.22)
    window.setTimeout(() => this.tone(2093, 0.35, 'sine', 0.08), 70)
  }

  horn(): void {
    this.ensure()
    this.tone(392, 0.38, 'sawtooth', 0.12)
    this.tone(311, 0.38, 'square', 0.05)
  }

  foot(bright = true): void {
    if (!this.ctx || !this.master || Math.random() > 0.85) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    const buffer = this.ctx.createBuffer(1, 800, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    src.buffer = buffer
    const g = this.ctx.createGain()
    g.gain.value = bright ? 0.07 : 0.1
    const f = this.ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = bright ? 640 : 220
    src.connect(f)
    f.connect(g)
    g.connect(this.master)
    src.start(t)
  }

  /** Short voice blips. Milo is bright and snappy. Juniper is rounder. */
  blip(kind: 'hello' | 'pick' | 'jump' | 'fly', bright: boolean): void {
    this.ensure()
    if (kind === 'hello') {
      const a = bright ? 784 : 523
      const b = bright ? 1046 : 698
      this.tone(a, 0.11, 'sine', 0.11)
      window.setTimeout(() => this.tone(b, 0.16, 'triangle', 0.08), bright ? 70 : 100)
      return
    }
    if (kind === 'pick') {
      const notes = bright ? [659, 880, 1174] : [494, 659, 880]
      notes.forEach((note, i) => window.setTimeout(() => this.tone(note, 0.14, 'sine', 0.1), i * 95))
      return
    }
    if (kind === 'jump') {
      if (bright) {
        this.tone(620, 0.07, 'sine', 0.07)
        window.setTimeout(() => this.tone(932, 0.14, 'sine', 0.09), 55)
      } else {
        this.tone(392, 0.1, 'triangle', 0.08)
        window.setTimeout(() => this.tone(659, 0.18, 'sine', 0.09), 80)
      }
      return
    }
    this.tone(bright ? 988 : 698, 0.18, 'sine', 0.07)
    window.setTimeout(() => this.tone(bright ? 1318 : 880, 0.16, 'triangle', 0.05), 90)
  }

  chime(): void {
    this.ensure()
    const notes = [523, 659, 784, 1046]
    notes.forEach((note, i) => window.setTimeout(() => this.tone(note, 0.22, 'sine', 0.09), i * 110))
  }

  /** A short rising door: whoosh, then a bright stack of fifths. */
  portal(): void {
    this.ensure()
    this.whoosh(0.85)
    const notes = [349, 440, 523, 659, 880]
    notes.forEach((note, i) => window.setTimeout(() => this.tone(note, 0.34, 'sine', 0.06), 40 + i * 78))
    window.setTimeout(() => this.tone(1174, 0.45, 'triangle', 0.04), 420)
  }

  shutter(): void {
    this.ensure()
    this.tone(1800, 0.04, 'square', 0.04)
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const len = Math.floor(this.ctx.sampleRate * 0.12)
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const g = this.ctx.createGain()
    g.gain.value = 0.12
    src.connect(g)
    g.connect(this.master)
    src.start(t)
  }

  chirp(): void {
    this.ensure()
    const base = 1400 + Math.random() * 800
    this.tone(base, 0.12, 'sine', 0.05)
    window.setTimeout(() => this.tone(base + 400, 0.1, 'sine', 0.04), 90)
  }

  whoosh(amount = 1): void {
    this.ensure()
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const len = Math.floor(this.ctx.sampleRate * 0.36)
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) {
      const e = 1 - i / len
      data[i] = (Math.random() * 2 - 1) * e * e
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(420, t)
    filter.frequency.exponentialRampToValueAtTime(1500, t + 0.2)
    filter.Q.value = 0.65
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18 * amount, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master)
    src.start(t)
    this.tone(320 * (0.7 + amount * 0.3), 0.24, 'sine', 0.06 * amount)
  }

  thud(): void {
    this.ensure()
    this.tone(68, 0.32, 'sine', 0.3)
    this.tone(44, 0.4, 'triangle', 0.16)
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const len = 1400
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 180
    const g = this.ctx.createGain()
    g.gain.value = 0.22
    src.connect(filter)
    filter.connect(g)
    g.connect(this.master)
    src.start(t)
  }

  found(): void {
    this.ensure()
    this.tone(523, 0.18, 'sine', 0.12)
    window.setTimeout(() => this.tone(659, 0.18, 'sine', 0.1), 120)
    window.setTimeout(() => this.tone(784, 0.28, 'sine', 0.1), 240)
  }

  /** A clock winding, not the memory-door chime. */
  eraShift(): void {
    this.ensure()
    this.tone(988, 0.04, 'square', 0.025)
    window.setTimeout(() => this.tone(740, 0.04, 'square', 0.02), 110)
    const notes = [392, 494, 587, 784]
    notes.forEach((note, i) => window.setTimeout(() => this.tone(note, 0.42, 'triangle', 0.06), 200 + i * 130))
  }

  /** Soft hooves. The wagon calls this while it is moving. */
  clop(): void {
    this.ensure()
    this.tone(170, 0.045, 'triangle', 0.07)
    window.setTimeout(() => this.tone(120, 0.05, 'sine', 0.05), 80)
  }

  /**
   * 1955 bed: distant traffic and a faint radio fifth.
   * Today leaves the gain at zero, so the mix matches the untimed town.
   */
  setEraBed(on: boolean): void {
    this.eraOn = on
    this.applyEraBed()
  }

  private applyEraBed(): void {
    if (!this.ctx || !this.master) return
    if (!this.eraGain) {
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      const noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      const src = this.ctx.createBufferSource()
      src.buffer = noise
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 280
      const hush = this.ctx.createGain()
      hush.gain.value = 0.35
      src.connect(filter)
      filter.connect(hush)
      hush.connect(gain)
      src.start()
      const a = this.ctx.createOscillator()
      a.type = 'sine'
      a.frequency.value = 220
      const e = this.ctx.createOscillator()
      e.type = 'sine'
      e.frequency.value = 330
      const tone = this.ctx.createGain()
      tone.gain.value = 0.22
      a.connect(tone)
      e.connect(tone)
      tone.connect(gain)
      a.start()
      e.start()
      gain.connect(this.master)
      this.eraGain = gain
    }
    const target = this.eraOn && !this.muted ? 0.045 : 0
    this.eraGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.7)
  }
}
