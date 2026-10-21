import type { Road } from './types.ts'

const REACH = 16
const CELL = 48

/**
 * The street map draws every road at once. Walking inks a segment,
 * and a named road stamps when its last segment is walked.
 */
export class StreetAtlas {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly count: number
  private readonly ax: Float32Array
  private readonly az: Float32Array
  private readonly bx: Float32Array
  private readonly bz: Float32Array
  private readonly len: Float32Array
  private readonly roadOf: Uint16Array
  private readonly walked: Uint8Array
  /** performance.now() when the segment was walked. 0 means it was already inked. */
  private readonly inkAt: Float64Array
  private readonly names: string[]
  private readonly roadTotal: Uint16Array
  private readonly roadWalked: Uint16Array
  private readonly roadDone: Uint8Array
  private readonly bins: number[][]
  private readonly cols: number
  private readonly rows: number
  private readonly originX: number
  private readonly originZ: number
  private totalLen = 0
  private walkedLen = 0

  constructor(roads: Road[]) {
    let n = 0
    for (const road of roads) n += Math.max(0, road.p.length / 3 - 1)
    this.count = n
    this.ax = new Float32Array(n)
    this.az = new Float32Array(n)
    this.bx = new Float32Array(n)
    this.bz = new Float32Array(n)
    this.len = new Float32Array(n)
    this.roadOf = new Uint16Array(n)
    this.walked = new Uint8Array(n)
    this.inkAt = new Float64Array(n)
    this.names = []
    const perRoad: number[] = []
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let cursor = 0
    for (const road of roads) {
      const name = road.n.trim()
      const roadIndex = this.names.length
      this.names.push(name)
      let segs = 0
      const pts = road.p.length / 3
      for (let i = 0; i < pts - 1; i++) {
        const ax = road.p[i * 3]
        const az = road.p[i * 3 + 1]
        const bx = road.p[(i + 1) * 3]
        const bz = road.p[(i + 1) * 3 + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 0.4) continue
        this.ax[cursor] = ax
        this.az[cursor] = az
        this.bx[cursor] = bx
        this.bz[cursor] = bz
        this.len[cursor] = len
        this.roadOf[cursor] = roadIndex
        this.totalLen += len
        if (ax < minX) minX = ax
        if (bx < minX) minX = bx
        if (ax > maxX) maxX = ax
        if (bx > maxX) maxX = bx
        if (az < minZ) minZ = az
        if (bz < minZ) minZ = bz
        if (az > maxZ) maxZ = az
        if (bz > maxZ) maxZ = bz
        cursor += 1
        segs += 1
      }
      perRoad.push(segs)
    }
    this.count = cursor
    this.minX = Number.isFinite(minX) ? minX : 0
    this.maxX = Number.isFinite(maxX) ? maxX : 1
    this.minZ = Number.isFinite(minZ) ? minZ : 0
    this.maxZ = Number.isFinite(maxZ) ? maxZ : 1
    this.roadTotal = Uint16Array.from(perRoad)
    this.roadWalked = new Uint16Array(perRoad.length)
    this.roadDone = new Uint8Array(perRoad.length)
    const spanX = Math.max(1, this.maxX - this.minX)
    this.cols = Math.max(1, Math.ceil(spanX / CELL))
    this.originX = this.minX
    this.originZ = this.minZ
    this.rows = Math.max(1, Math.ceil(Math.max(1, this.maxZ - this.minZ) / CELL))
    this.bins = Array.from({ length: this.cols * this.rows }, () => [])
    for (let i = 0; i < this.count; i++) this.bin(i)
    this.restore()
  }

  share(): number {
    if (this.totalLen <= 0) return 0
    return this.walkedLen / this.totalLen
  }

  /** 0–1 draw progress for a walked segment. Unwalked segments return 0. */
  ink(index: number, now: number): number {
    if (!this.walked[index]) return 0
    const at = this.inkAt[index]
    if (at <= 0) return 1
    const u = Math.max(0, Math.min(1, (now - at) / 600))
    return 1 - (1 - u) * (1 - u) * (1 - u)
  }

  segment(index: number): { ax: number; az: number; bx: number; bz: number } {
    return { ax: this.ax[index], az: this.az[index], bx: this.bx[index], bz: this.bz[index] }
  }

  nameOf(index: number): string {
    return this.names[this.roadOf[index]] ?? ''
  }

  /** Newly inked segments, plus the name when that street's last segment is walked. */
  walk(x: number, z: number, now: number): { done: string[]; inked: { ax: number; az: number; bx: number; bz: number }[] } {
    const ix = Math.floor((x - this.originX) / CELL)
    const iz = Math.floor((z - this.originZ) / CELL)
    const done: string[] = []
    const inked: { ax: number; az: number; bx: number; bz: number }[] = []
    let dirty = false
    for (let jz = iz - 1; jz <= iz + 1; jz++) {
      for (let jx = ix - 1; jx <= ix + 1; jx++) {
        const bin = this.bins[this.key(jx, jz)]
        if (!bin) continue
        for (const i of bin) {
          if (this.walked[i]) continue
          if (distToSeg(x, z, this.ax[i], this.az[i], this.bx[i], this.bz[i]) > REACH) continue
          this.walked[i] = 1
          this.inkAt[i] = now
          this.walkedLen += this.len[i]
          inked.push({ ax: this.ax[i], az: this.az[i], bx: this.bx[i], bz: this.bz[i] })
          const road = this.roadOf[i]
          this.roadWalked[road] += 1
          dirty = true
          if (this.roadWalked[road] >= this.roadTotal[road] && !this.roadDone[road]) {
            this.roadDone[road] = 1
            const name = this.names[road]
            if (name) done.push(name)
          }
        }
      }
    }
    if (dirty) this.persist()
    return { done, inked }
  }

  private bin(index: number): void {
    const ax = this.ax[index]
    const az = this.az[index]
    const bx = this.bx[index]
    const bz = this.bz[index]
    const steps = Math.max(1, Math.ceil(this.len[index] / 24))
    const seen = new Set<number>()
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const k = this.key(Math.floor((x - this.originX) / CELL), Math.floor((z - this.originZ) / CELL))
      if (seen.has(k) || !this.bins[k]) continue
      seen.add(k)
      this.bins[k].push(index)
    }
  }

  private key(ix: number, iz: number): number {
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1
    return iz * this.cols + ix
  }

  private persist(): void {
    try {
      const bytes = new Uint8Array(Math.ceil(this.count / 8))
      for (let i = 0; i < this.count; i++) if (this.walked[i]) bytes[i >> 3] |= 1 << (i & 7)
      let raw = ''
      for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i])
      localStorage.setItem('ld-streets', `${this.count}:${btoa(raw)}`)
    } catch {
      /* private mode */
    }
  }

  private restore(): void {
    try {
      const saved = localStorage.getItem('ld-streets')
      if (!saved) return
      const split = saved.indexOf(':')
      if (Number(saved.slice(0, split)) !== this.count) return
      const bytes = Uint8Array.from(atob(saved.slice(split + 1)), (ch) => ch.charCodeAt(0))
      for (let i = 0; i < this.count; i++) {
        if ((bytes[i >> 3] & (1 << (i & 7))) === 0) continue
        this.walked[i] = 1
        this.inkAt[i] = 0
        this.walkedLen += this.len[i]
        const road = this.roadOf[i]
        this.roadWalked[road] += 1
        if (this.roadWalked[road] >= this.roadTotal[road]) this.roadDone[road] = 1
      }
    } catch {
      /* ignore a bad save */
    }
  }
}

function distToSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  if (l2 < 0.01) return Math.hypot(x - ax, z - az)
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}
