import type { TerrainMeta } from './types.ts'

export const F_WATER = 1
export const F_PARK = 2
export const F_WOOD = 4
export const F_URBAN = 8
export const F_PARKING = 16
export const F_ROAD = 32
export const F_BUILDING = 64

export class Heightfield {
  cols: number
  rows: number
  originX: number
  originZ: number
  sizeX: number
  sizeZ: number
  minElev: number
  maxElev: number
  waterLevel: number
  heights: Float32Array
  flags: Uint8Array

  constructor(buffer: ArrayBuffer, fallback: TerrainMeta) {
    const view = new DataView(buffer)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (magic !== 'LFHT') throw new Error('Terrain file is not a Lafayette heightfield')
    this.cols = view.getUint32(4, true)
    this.rows = view.getUint32(8, true)
    this.originX = view.getFloat32(12, true)
    this.originZ = view.getFloat32(16, true)
    this.sizeX = view.getFloat32(20, true)
    this.sizeZ = view.getFloat32(24, true)
    this.minElev = view.getFloat32(28, true)
    this.maxElev = view.getFloat32(32, true)
    this.waterLevel = view.getFloat32(36, true) || fallback.waterLevel
    const count = this.cols * this.rows
    this.heights = new Float32Array(count)
    for (let i = 0; i < count; i++) this.heights[i] = view.getInt16(44 + i * 2, true) / 10
    this.flags = new Uint8Array(buffer, 44 + count * 2, count)
    this.easeSpikes()
    this.easeMounds()
  }

  /**
   * USGS cells sometimes spike one sample above the neighbors.
   * Water stays as surveyed. A real slope under about 8 m per cell is left alone.
   */
  private easeSpikes(): void {
    const src = this.heights
    const next = new Float32Array(src)
    const cols = this.cols
    const rows = this.rows
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const idx = j * cols + i
        if (this.flags[idx] & F_WATER) continue
        const samples = [
          src[idx - 1],
          src[idx + 1],
          src[idx - cols],
          src[idx + cols],
          src[idx - cols - 1],
          src[idx - cols + 1],
          src[idx + cols - 1],
          src[idx + cols + 1],
        ]
        samples.sort((a, b) => a - b)
        const median = (samples[3] + samples[4]) * 0.5
        const spike = src[idx] - median
        if (Math.abs(spike) > 8) next[idx] = src[idx] * 0.4 + median * 0.6
      }
    }
    this.heights = next
  }

  /**
   * A smooth pyramid can clear an 8 m neighbor test on every cell.
   * Two wider passes pull a cell that stands more than 12 m above the
   * median of a ~40 m window. A steady hillside stays, because that
   * median already sits on the slope.
   */
  private easeMounds(): void {
    const cols = this.cols
    const rows = this.rows
    const rad = 3
    for (let pass = 0; pass < 2; pass++) {
      const src = this.heights
      const next = new Float32Array(src)
      for (let j = rad; j < rows - rad; j++) {
        for (let i = rad; i < cols - rad; i++) {
          const idx = j * cols + i
          if (this.flags[idx] & F_WATER) continue
          const samples: number[] = []
          for (let dj = -rad; dj <= rad; dj++) {
            const row = (j + dj) * cols
            for (let di = -rad; di <= rad; di++) {
              if (di === 0 && dj === 0) continue
              samples.push(src[row + i + di])
            }
          }
          samples.sort((a, b) => a - b)
          const median = samples[(samples.length / 2) | 0]
          const spike = src[idx] - median
          if (Math.abs(spike) > 12) next[idx] = src[idx] * 0.25 + median * 0.75
        }
      }
      this.heights = next
    }
  }

  sample(x: number, z: number): number {
    const fx = ((x - this.originX) / this.sizeX) * (this.cols - 1)
    const fz = ((z - this.originZ) / this.sizeZ) * (this.rows - 1)
    if (fx < 0 || fz < 0 || fx > this.cols - 1 || fz > this.rows - 1) return this.minElev
    const i0 = Math.floor(fx)
    const j0 = Math.floor(fz)
    const i1 = Math.min(this.cols - 1, i0 + 1)
    const j1 = Math.min(this.rows - 1, j0 + 1)
    const tx = fx - i0
    const tz = fz - j0
    const h00 = this.heights[j0 * this.cols + i0]
    const h10 = this.heights[j0 * this.cols + i1]
    const h01 = this.heights[j1 * this.cols + i0]
    const h11 = this.heights[j1 * this.cols + i1]
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz
  }

  flag(x: number, z: number): number {
    const i = Math.round(((x - this.originX) / this.sizeX) * (this.cols - 1))
    const j = Math.round(((z - this.originZ) / this.sizeZ) * (this.rows - 1))
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return 0
    return this.flags[j * this.cols + i]
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return (
      x >= this.originX + margin &&
      z >= this.originZ + margin &&
      x <= this.originX + this.sizeX - margin &&
      z <= this.originZ + this.sizeZ - margin
    )
  }
}
