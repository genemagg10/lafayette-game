import * as THREE from 'three'
import { hash01 } from './math.ts'

export class MeshBuilder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  col: number[] = []

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, color: THREE.Color): void {
    this.pos.push(x, y, z)
    this.nor.push(nx, ny, nz)
    this.uv.push(u, v)
    this.col.push(color.r, color.g, color.b)
  }

  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    color: THREE.Color,
    uv: number[] = [0, 0, 1, 0, 0, 1],
  ): void {
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const ny = uz * vx - ux * vz
    // Roads and roofs are authored flat. If the face points down, swap the
    // last two corners so the camera above the street actually sees them.
    if (ny < -0.2) {
      this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, color, [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]])
      return
    }
    let nx = uy * vz - uz * vy
    let nny = ny
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, nny, nz) || 1
    nx /= len
    nny /= len
    nz /= len
    this.vertex(ax, ay, az, nx, nny, nz, uv[0], uv[1], color)
    this.vertex(bx, by, bz, nx, nny, nz, uv[2], uv[3], color)
    this.vertex(cx, cy, cz, nx, nny, nz, uv[4], uv[5], color)
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    return g
  }
}

export function appendRibbon(
  out: MeshBuilder,
  pts: { x: number; y: number; z: number }[],
  width: number,
  color: THREE.Color,
  lift = 0,
): void {
  if (pts.length < 2 || width <= 0) return
  const left: number[] = []
  const right: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const cur = pts[i]
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    let px = -dz
    let pz = dx
    if (i > 0 && i < pts.length - 1) {
      const d1x = cur.x - prev.x
      const d1z = cur.z - prev.z
      const d2x = next.x - cur.x
      const d2z = next.z - cur.z
      const l1 = Math.hypot(d1x, d1z) || 1
      const l2 = Math.hypot(d2x, d2z) || 1
      const n1x = -d1z / l1
      const n1z = d1x / l1
      const n2x = -d2z / l2
      const n2z = d2x / l2
      px = n1x + n2x
      pz = n1z + n2z
      const pl = Math.hypot(px, pz) || 1
      px /= pl
      pz /= pl
      const miter = Math.min(1.35, 1 / Math.max(0.55, n1x * px + n1z * pz))
      px *= miter
      pz *= miter
    }
    const hw = width / 2
    left.push(cur.x + px * hw, cur.y + lift, cur.z + pz * hw)
    right.push(cur.x - px * hw, cur.y + lift, cur.z - pz * hw)
  }
  let u = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)
    const u2 = u + seg * 0.15
    const a = i * 3
    out.tri(
      left[a], left[a + 1], left[a + 2],
      right[a], right[a + 1], right[a + 2],
      left[a + 3], left[a + 4], left[a + 5],
      color,
      [u, 0, u, 1, u2, 0],
    )
    out.tri(
      right[a], right[a + 1], right[a + 2],
      right[a + 3], right[a + 4], right[a + 5],
      left[a + 3], left[a + 4], left[a + 5],
      color,
      [u, 1, u2, 1, u2, 0],
    )
    u = u2
  }
}

/**
 * Follow the heightfield every few metres. A long chord whose straight Y
 * floats above a dip becomes a ribbon in the air and a black smear on the grass.
 * A real overpass, more than 6 m above the ground, keeps its authored height.
 */
export function drapePath(
  pts: { x: number; y: number; z: number }[],
  sample: (x: number, z: number) => number,
  step = 8,
): { x: number; y: number; z: number }[] {
  if (pts.length < 2) return pts
  const out: { x: number; y: number; z: number }[] = []
  const push = (x: number, z: number, authored: number) => {
    const ground = sample(x, z)
    const y = authored > ground + 6 ? authored : ground
    const last = out[out.length - 1]
    if (last && Math.hypot(last.x - x, last.z - z) < 0.35) {
      last.y = y
      return
    }
    out.push({ x, y, z })
  }
  push(pts[0].x, pts[0].z, pts[0].y)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      push(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, a.y + (b.y - a.y) * t)
    }
  }
  return out.length >= 2 ? out : pts
}

export function pointInPoly(x: number, z: number, poly: number[]): boolean {
  let c = false
  const n = poly.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]
    const zi = poly[i * 2 + 1]
    const xj = poly[j * 2]
    const zj = poly[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi) c = !c
  }
  return c
}

interface Block {
  key: string
  poly: number[]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cx: number
  cz: number
  /** World-space roof height. Infinity means the volume never ends. */
  roof: number
  /** Null means the wall exists in every year. */
  startYear: number | null
  /** Sheds and kiosks give way so a bike or a drift keeps its pace. */
  squish: boolean
}

export class Blockers {
  private cell = 42
  private grid = new Map<string, Block[]>()
  private year = 2026

  setYear(year: number): void {
    this.year = year
  }

  private live(block: Block): boolean {
    return block.startYear == null || this.year >= block.startYear
  }

  add(key: string, poly: number[], roof = Infinity, startYear: number | null = null): void {
    if (poly.length < 6) return
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let cx = 0
    let cz = 0
    const n = poly.length / 2
    for (let i = 0; i < n; i++) {
      const x = poly[i * 2]
      const z = poly[i * 2 + 1]
      cx += x
      cz += z
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const span = Math.max(maxX - minX, maxZ - minZ)
    const squish = span < 3.6 && roof < 3.2
    const block: Block = { key, poly, minX, maxX, minZ, maxZ, cx: cx / n, cz: cz / n, roof, startYear, squish }
    const i0 = Math.floor(minX / this.cell)
    const i1 = Math.floor(maxX / this.cell)
    const j0 = Math.floor(minZ / this.cell)
    const j1 = Math.floor(maxZ / this.cell)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const id = `${i},${j}`
        let list = this.grid.get(id)
        if (!list) {
          list = []
          this.grid.set(id, list)
        }
        list.push(block)
      }
    }
  }

  clear(key: string): void {
    for (const [id, list] of this.grid) {
      const next = list.filter((b) => b.key !== key)
      if (next.length === 0) this.grid.delete(id)
      else if (next.length !== list.length) this.grid.set(id, next)
    }
  }

  private nearby(x: number, z: number): Block[] {
    const i = Math.floor(x / this.cell)
    const j = Math.floor(z / this.cell)
    const seen = new Set<Block>()
    const out: Block[] = []
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.grid.get(`${i + dx},${j + dz}`)
        if (!list) continue
        for (const b of list) {
          if (seen.has(b)) continue
          seen.add(b)
          out.push(b)
        }
      }
    }
    return out
  }

  /** Highest roof whose footprint contains this point, or null when clear. */
  roofAt(x: number, z: number): number | null {
    let best: number | null = null
    for (const b of this.nearby(x, z)) {
      if (!this.live(b)) continue
      if (!Number.isFinite(b.roof)) continue
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
      if (!pointInPoly(x, z, b.poly)) continue
      if (best == null || b.roof > best) best = b.roof
    }
    return best
  }

  resolve(x: number, z: number, radius: number, feetY?: number): { x: number; z: number; hit: boolean } {
    let hit = false
    let px = x
    let pz = z
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.nearby(px, pz)) {
        if (!this.live(b)) continue
        if (b.squish) continue
        if (feetY != null && feetY >= b.roof - 0.05) continue
        if (px < b.minX - radius || px > b.maxX + radius || pz < b.minZ - radius || pz > b.maxZ + radius) continue
        const inside = pointInPoly(px, pz, b.poly)
        let best = inside ? Infinity : radius
        let qx = px
        let qz = pz
        const n = b.poly.length / 2
        for (let i = 0; i < n; i++) {
          const ax = b.poly[i * 2]
          const az = b.poly[i * 2 + 1]
          const bx = b.poly[((i + 1) % n) * 2]
          const bz = b.poly[((i + 1) % n) * 2 + 1]
          const abx = bx - ax
          const abz = bz - az
          const ab2 = abx * abx + abz * abz || 1
          let t = ((px - ax) * abx + (pz - az) * abz) / ab2
          t = Math.max(0, Math.min(1, t))
          const sx = ax + abx * t
          const sz = az + abz * t
          const d = Math.hypot(px - sx, pz - sz)
          if (d < best) {
            best = d
            qx = sx
            qz = sz
          }
        }
        if (inside || best < radius) {
          let nx = px - b.cx
          let nz = pz - b.cz
          if (!inside) {
            nx = px - qx
            nz = pz - qz
          }
          const len = Math.hypot(nx, nz) || 1
          const push = inside ? best + radius + 0.05 : radius - best + 0.02
          px += (nx / len) * push
          pz += (nz / len) * push
          hit = true
        }
      }
    }
    return { x: px, z: pz, hit }
  }

  clipCamera(fromX: number, fromZ: number, toX: number, toZ: number, fromY = -Infinity, toY = -Infinity): number {
    let best = 1
    const dx = toX - fromX
    const dz = toZ - fromZ
    for (const b of this.nearby((fromX + toX) / 2, (fromZ + toZ) / 2)) {
      if (b.squish) continue
      if (fromY > b.roof + 0.6 && toY > b.roof + 0.6) continue
      const n = b.poly.length / 2
      for (let i = 0; i < n; i++) {
        const ax = b.poly[i * 2]
        const az = b.poly[i * 2 + 1]
        const bx = b.poly[((i + 1) % n) * 2]
        const bz = b.poly[((i + 1) % n) * 2 + 1]
        const ex = bx - ax
        const ez = bz - az
        const den = dx * ez - dz * ex
        if (Math.abs(den) < 1e-6) continue
        const t = ((ax - fromX) * ez - (az - fromZ) * ex) / den
        const u = ((ax - fromX) * dz - (az - fromZ) * dx) / den
        if (t > 0.02 && t < best && u >= 0 && u <= 1) best = t
      }
    }
    return best
  }
}

export function tint(hex: number, salt: number): THREE.Color {
  const c = new THREE.Color(hex)
  const k = 0.94 + hash01(salt) * 0.1
  c.multiplyScalar(k)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  if (hsl.s > 0.45) c.setHSL(hsl.h, 0.45, hsl.l)
  return c
}
