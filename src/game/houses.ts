import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type Group,
  type Material,
} from 'three'
import { pointInPoly } from './geom.ts'
import { assignPhase, crownLift } from './downtown.ts'
import { hash01 } from './math.ts'

export interface HouseBlock {
  poly: number[]
  roof: number
}

export interface YardTree {
  x: number
  z: number
  y: number
  trunkR: number
  canopyR: number
  canopyY: number
  index: number
}

export interface HouseLots {
  blocks: HouseBlock[]
  trees: YardTree[]
  trunkFade: InstancedBufferAttribute
  canopyFade: InstancedBufferAttribute
  canopy: InstancedMesh | null
}

interface Approach {
  x: number
  z: number
  dx?: number
  dz?: number
  w?: number
}

interface House {
  x: number
  y: number
  z: number
  yaw: number
  w: number
  d: number
  wallH: number
  rise: number
  hip: boolean
  wall: number
  roof: number
  door: number
  setback: number
  lot: number
  two: boolean
}

const WALLS = [0xf7f1e6, 0xf3e4cc, 0xead9c0, 0xfbf8f2, 0xe7d3b6]
const ROOFS = [0xa24b32, 0x7a3e2e, 0xc4623c, 0x5e6a72, 0x8c4030]
const DOORS = [0x6b3028, 0x1e3a32, 0x3c2a22, 0xf4f0e6]

const wallMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 })
const roofMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: DoubleSide })
const frameMat = new MeshStandardMaterial({ color: 0x2c3338, roughness: 0.7 })
const glassMat = new MeshBasicMaterial({ color: 0xd7eef8 })
const doorMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
const garageMat = new MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.62 })
const porchMat = new MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.82 })
const driveMat = new MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.9 })
const lawnMat = new MeshStandardMaterial({ color: 0xc8f08a, roughness: 0.95 })
lawnMat.polygonOffset = true
lawnMat.polygonOffsetFactor = -2
lawnMat.polygonOffsetUnits = -2

const boxGeo = new BoxGeometry(1, 1, 1)
boxGeo.translate(0, 0.5, 0)
const lawnGeo = new PlaneGeometry(1, 1)
lawnGeo.rotateX(-Math.PI / 2)
lawnGeo.translate(0, 0.08, 0)

function unitRoof(hip: boolean): BufferGeometry {
  const x0 = -0.5
  const x1 = 0.5
  const z0 = -0.5
  const z1 = 0.5
  const rx0 = hip ? -0.16 : x0
  const rx1 = hip ? 0.16 : x1
  const p: number[] = []
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }
  tri(x0, 0, z1, x1, 0, z1, rx1, 1, 0)
  tri(x0, 0, z1, rx1, 1, 0, rx0, 1, 0)
  tri(x1, 0, z0, x0, 0, z0, rx0, 1, 0)
  tri(x1, 0, z0, rx0, 1, 0, rx1, 1, 0)
  tri(x0, 0, z0, x0, 0, z1, rx0, 1, 0)
  tri(x1, 0, z1, x1, 0, z0, rx1, 1, 0)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(p, 3))
  geo.computeVertexNormals()
  return geo
}

const gableGeo = unitRoof(false)
const hipGeo = unitRoof(true)

class Bucket {
  private readonly mats: Matrix4[] = []
  private readonly cols: Color[] = []
  private readonly dummy = new Object3D()
  private readonly color = new Color()

  add(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, hex: number): void {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, yaw, 0)
    this.dummy.scale.set(sx, sy, sz)
    this.dummy.updateMatrix()
    this.mats.push(this.dummy.matrix.clone())
    this.color.setHex(hex)
    this.cols.push(this.color.clone())
  }

  mesh(geo: BufferGeometry, material: Material, shadow: boolean): InstancedMesh | null {
    const n = this.mats.length
    if (!n) return null
    const mesh = new InstancedMesh(geo, material, n)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3)
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, this.mats[i])
      mesh.setColorAt(i, this.cols[i])
    }
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    mesh.boundingSphere = null
    return mesh
  }
}

function orient(poly: number[], road: Approach | null): { cx: number; cz: number; ax: number; az: number; fx: number; fz: number; minA: number; maxA: number; minF: number; maxF: number } | null {
  const n = poly.length / 2
  if (n < 3) return null
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += poly[i * 2]
    cz += poly[i * 2 + 1]
  }
  cx /= n
  cz /= n
  let fx = 0
  let fz = 1
  if (road) {
    fx = road.x - cx
    fz = road.z - cz
  } else {
    let best = 0
    for (let i = 0; i < n; i++) {
      const x1 = poly[i * 2]
      const z1 = poly[i * 2 + 1]
      const x2 = poly[((i + 1) % n) * 2]
      const z2 = poly[((i + 1) % n) * 2 + 1]
      const len = Math.hypot(x2 - x1, z2 - z1)
      if (len > best) {
        best = len
        fx = -(z2 - z1) / len
        fz = (x2 - x1) / len
      }
    }
  }
  const fl = Math.hypot(fx, fz) || 1
  fx /= fl
  fz /= fl
  const ax = -fz
  const az = fx
  let minA = Infinity
  let maxA = -Infinity
  let minF = Infinity
  let maxF = -Infinity
  for (let i = 0; i < n; i++) {
    const dx = poly[i * 2] - cx
    const dz = poly[i * 2 + 1] - cz
    const a = dx * ax + dz * az
    const f = dx * fx + dz * fz
    if (a < minA) minA = a
    if (a > maxA) maxA = a
    if (f < minF) minF = f
    if (f > maxF) maxF = f
  }
  if (maxA - minA < 4 || maxF - minF < 4) return null
  return { cx, cz, ax, az, fx, fz, minA, maxA, minF, maxF }
}

function plan(poly: number[], road: Approach | null, sample: (x: number, z: number) => number, roadAt: (x: number, z: number) => Approach | null): House[] {
  const frame = orient(poly, road)
  if (!frame) return []
  const spanA = frame.maxA - frame.minA
  const spanF = frame.maxF - frame.minF
  let count = Math.max(1, Math.round(spanA / 15.5))
  while (spanA / count > 19.5) count += 1
  while (count > 1 && spanA / count < 12) count -= 1
  const lot = spanA / count
  const houses: House[] = []
  for (let i = 0; i < count; i++) {
    let setback = Math.min(7.4, Math.max(2.8, spanF * 0.34))
    let depth = Math.min(9.2, Math.max(6.6, spanF * 0.48))
    if (setback + depth > spanF - 0.45) {
      depth = Math.max(6, spanF - setback - 0.35)
      if (setback + depth > spanF - 0.25) setback = Math.max(1.5, spanF - depth - 0.25)
    }
    let width = Math.min(16.8, Math.max(7.6, lot - Math.min(2.3, lot * 0.14)))
    const a = frame.minA + lot * (i + 0.5)
    const f = frame.maxF - setback - depth / 2
    let x = frame.cx + frame.ax * a + frame.fx * f
    let z = frame.cz + frame.az * a + frame.fz * f
    const yaw = Math.atan2(frame.fx, frame.fz)
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    let clear = true
    const faceLen = road ? Math.hypot(road.dx ?? 0, road.dz ?? 0) : 0
    const faceVx = road && faceLen > 0.5 ? (road.dx ?? 0) / faceLen : 0
    const faceVz = road && faceLen > 0.5 ? (road.dz ?? 0) / faceLen : 0
    for (let step = 0; step < 6; step++) {
      let worst = 0
      let ax = 0
      let az = 0
      const samples: [number, number][] = [
        [0, depth / 2],
        [0, 0],
        [-width / 2, depth / 2],
        [width / 2, depth / 2],
      ]
      const consider = (px: number, pz: number, near: Approach | null, keep: number) => {
        if (!near) return
        const dist = Math.hypot(px - near.x, pz - near.z)
        const overlap = keep - dist
        if (overlap > worst) {
          worst = overlap
          const len = dist || 1
          ax = (px - near.x) / len
          az = (pz - near.z) / len
        }
      }
      for (const [lx, lz] of samples) {
        const px = x + cos * lx + sin * lz
        const pz = z - sin * lx + cos * lz
        const near = roadAt(px, pz)
        consider(px, pz, near, (near?.w ?? 6) * 0.5 + 6.4)
        if (road && faceLen > 0.5) {
          const along = (px - road.x) * faceVx + (pz - road.z) * faceVz
          consider(px, pz, { x: road.x + faceVx * along, z: road.z + faceVz * along, w: road.w }, (road.w ?? 6) * 0.5 + 6.4)
        }
      }
      if (worst <= 0.15) break
      const nx = x + ax * (worst + 0.35)
      const nz = z + az * (worst + 0.35)
      if (!pointInPoly(nx, nz, poly)) {
        depth = Math.max(6.2, depth - 1.1)
        width = Math.max(7.2, width - 0.5)
        clear = worst < 0.8
        break
      }
      x = nx
      z = nz
      clear = true
    }
    if (!clear || !pointInPoly(x, z, poly)) continue
    const salt = (x * 10 + z * 3) | 0
    const n = hash01(salt)
    const two = n > 0.62
    const wallH = two ? 5.45 : 3.15
    const rise = Math.min(4.15, Math.max(2.7, depth * 0.52))
    houses.push({
      x,
      y: sample(x, z),
      z,
      yaw,
      w: width,
      d: depth,
      wallH,
      rise,
      hip: hash01(salt + 4) > 0.46,
      wall: WALLS[Math.floor(hash01(salt + 1) * WALLS.length) % WALLS.length],
      roof: ROOFS[Math.floor(hash01(salt + 2) * ROOFS.length) % ROOFS.length],
      door: DOORS[Math.floor(hash01(salt + 3) * DOORS.length) % DOORS.length],
      setback,
      lot,
      two,
    })
  }
  return houses
}

function worldOf(house: House, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const c = Math.cos(house.yaw)
  const s = Math.sin(house.yaw)
  return {
    x: house.x + c * lx + s * lz,
    y: house.y + ly,
    z: house.z - s * lx + c * lz,
  }
}

function footprint(house: House): number[] {
  const hw = house.w / 2
  const hd = house.d / 2
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]
  const poly: number[] = []
  for (const [lx, lz] of corners) {
    const p = worldOf(house, lx, 0, lz)
    poly.push(p.x, p.z)
  }
  return poly
}

/**
 * Break a neighbourhood footprint into house lots of about 12–20 m,
 * each an instanced kit set back behind a lawn and a driveway.
 */
export function addHouseLots(
  group: Group,
  polys: number[][],
  sample: (x: number, z: number) => number,
  roadAt: (x: number, z: number) => Approach | null,
  trees: { trunkGeo: BufferGeometry; canopyGeo: BufferGeometry; trunkMat: Material; canopyMat: Material },
  frontAt: (x: number, z: number) => Approach | null = roadAt,
): HouseLots | null {
  const houses: House[] = []
  const owners: number[][] = []
  for (const poly of polys) {
    let sx = 0
    let sz = 0
    const n = poly.length / 2
    for (let i = 0; i < n; i++) {
      sx += poly[i * 2]
      sz += poly[i * 2 + 1]
    }
    const planned = plan(poly, frontAt(sx / n, sz / n), sample, roadAt)
    for (const house of planned) {
      houses.push(house)
      owners.push(poly)
    }
  }
  if (!houses.length) return null

  const walls = new Bucket()
  const gables = new Bucket()
  const hips = new Bucket()
  const frames = new Bucket()
  const glass = new Bucket()
  const doors = new Bucket()
  const garages = new Bucket()
  const porches = new Bucket()
  const drives = new Bucket()
  const lawns = new Bucket()
  const blocks: HouseBlock[] = []

  const put = (bucket: Bucket, house: House, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, hex: number) => {
    const p = worldOf(house, lx, ly, lz)
    bucket.add(p.x, p.y, p.z, house.yaw, sx, sy, sz, hex)
  }

  for (const house of houses) {
    walls.add(house.x, house.y, house.z, house.yaw, house.w, house.wallH, house.d, house.wall)
    const roofBucket = house.hip ? hips : gables
    const roofAt = worldOf(house, 0, house.wallH, 0)
    roofBucket.add(roofAt.x, roofAt.y, roofAt.z, house.yaw, house.w + 0.9, house.rise, house.d + 0.9, house.roof)
    blocks.push({ poly: footprint(house), roof: house.y + house.wallH + house.rise + 0.3 })

    const garageW = house.w >= 10.4 ? 2.55 : house.w >= 8.8 ? 2.15 : 0
    const doorW = 0.94
    const winW = house.w > 12 ? 1.35 : 1.15
    const right = house.w / 2
    const garageX = garageW ? right - 0.5 - garageW / 2 : 0
    const doorX = garageW ? garageX - garageW / 2 - 0.62 - doorW / 2 : 0.15
    const winY = 1.02
    const winH = 1.42
    let cursor = -house.w / 2 + 0.65 + winW / 2
    const limit = doorX - doorW / 2 - 0.4
    let windows = 0
    while (cursor < limit && windows < 3) {
      put(frames, house, cursor, winY, house.d / 2, winW + 0.16, winH + 0.16, 0.08, 0xffffff)
      put(glass, house, cursor, winY, house.d / 2 + 0.03, winW, winH, 0.06, 0xdff1f8)
      windows += 1
      cursor += winW + 0.48
    }
    if (!windows) {
      put(frames, house, doorX - 1.25, winY, house.d / 2, 1.05, winH + 0.12, 0.08, 0xffffff)
      put(glass, house, doorX - 1.25, winY, house.d / 2 + 0.03, 0.9, winH, 0.06, 0xdff1f8)
    }
    put(doors, house, doorX, 0, house.d / 2, doorW, 2.15, 0.1, house.door)
    if (garageW) put(garages, house, garageX, 0, house.d / 2, garageW, 2.18, 0.1, 0xffffff)
    put(porches, house, doorX, 0, house.d / 2 + 0.62, 1.85, 0.16, 1.15, 0xffffff)
    put(porches, house, doorX, 2.28, house.d / 2 + 0.5, 2.05, 0.1, 1.25, 0xffffff)
    put(walls, house, doorX - 0.85, 0.16, house.d / 2 + 1.05, 0.12, 2.15, 0.12, house.wall)
    put(walls, house, doorX + 0.85, 0.16, house.d / 2 + 1.05, 0.12, 2.15, 0.12, house.wall)

    const sideH = 1.28
    for (const lz of [-0.85, 0.7]) {
      put(frames, house, house.w / 2, winY, lz, 0.08, sideH + 0.14, 1.05, 0xffffff)
      put(glass, house, house.w / 2 + 0.02, winY, lz, 0.05, sideH, 0.88, 0xdff1f8)
      put(frames, house, -house.w / 2, winY, lz, 0.08, sideH + 0.14, 1.05, 0xffffff)
      put(glass, house, -house.w / 2 - 0.02, winY, lz, 0.05, sideH, 0.88, 0xdff1f8)
    }
    put(frames, house, 0, winY, -house.d / 2, 1.15, winH + 0.1, 0.08, 0xffffff)
    put(glass, house, 0, winY, -house.d / 2 - 0.03, 1.0, winH, 0.06, 0xdff1f8)
    if (house.two) {
      const upper = 3.45
      let ux = -house.w / 2 + 0.9
      let up = 0
      while (ux < house.w / 2 - 0.7 && up < 4) {
        put(frames, house, ux, upper, house.d / 2, 1.05, 1.15, 0.08, 0xffffff)
        put(glass, house, ux, upper, house.d / 2 + 0.03, 0.9, 1.0, 0.06, 0xdff1f8)
        ux += 1.7
        up += 1
      }
    }

    const yard = Math.max(1.6, house.setback)
    put(lawns, house, 0, 0, house.d / 2 + yard / 2, house.lot * 0.94, 1, yard, 0xffffff)
    if (garageW) {
      const driveLen = Math.min(12, yard + 1.4)
      put(drives, house, garageX, 0.02, house.d / 2 + driveLen / 2, Math.min(3.15, garageW + 0.35), 0.05, driveLen, 0xffffff)
    }

  }

  const yardTrees: YardTree[] = []
  const treePos: { x: number; z: number; y: number; yaw: number; scale: number }[] = []
  for (let h = 0; h < houses.length; h++) {
    const house = houses[h]
    const owner = owners[h]
    const spots: [number, number][] = [[-house.w / 2 + 1.15, house.d / 2 + house.setback * 0.58]]
    if (house.w > 12.4 && house.setback > 2.2) spots.push([-house.w / 2 + 3.3, house.d / 2 + house.setback * 0.42])
    for (const [lx, lz] of spots) {
      const p = worldOf(house, lx, 0, lz)
      if (pointInPoly(p.x, p.z, footprint(house))) continue
      if (!pointInPoly(p.x, p.z, owner)) continue
      const y = sample(p.x, p.z)
      const scale = 0.72 + hash01((p.x * 5 + p.z) | 0) * 0.28
      treePos.push({ x: p.x, z: p.z, y, yaw: hash01((p.z * 9) | 0) * Math.PI, scale })
    }
  }

  const parts: [Bucket, BufferGeometry, Material, boolean][] = [
    [walls, boxGeo, wallMat, true],
    [gables, gableGeo, roofMat, true],
    [hips, hipGeo, roofMat, true],
    [frames, boxGeo, frameMat, false],
    [glass, boxGeo, glassMat, false],
    [doors, boxGeo, doorMat, false],
    [garages, boxGeo, garageMat, false],
    [porches, boxGeo, porchMat, true],
    [drives, boxGeo, driveMat, false],
    [lawns, lawnGeo, lawnMat, false],
  ]
  for (const [bucket, geo, material, shadow] of parts) {
    const mesh = bucket.mesh(geo, material, shadow)
    if (mesh) group.add(mesh)
  }

  let canopy: InstancedMesh | null = null
  const trunkFade = new InstancedBufferAttribute(new Float32Array(Math.max(1, treePos.length)).fill(1), 1)
  const canopyFade = new InstancedBufferAttribute(new Float32Array(Math.max(1, treePos.length)).fill(1), 1)
  if (treePos.length) {
    const trunkGeo = trees.trunkGeo.clone()
    const canopyGeo = trees.canopyGeo.clone()
    trunkGeo.setAttribute('fade', trunkFade)
    canopyGeo.setAttribute('fade', canopyFade)
    assignPhase(canopyGeo, treePos.length, 41)
    const trunks = new InstancedMesh(trunkGeo, trees.trunkMat, treePos.length)
    canopy = new InstancedMesh(canopyGeo, trees.canopyMat, treePos.length)
    trunks.instanceColor = new InstancedBufferAttribute(new Float32Array(treePos.length * 3), 3)
    canopy.instanceColor = new InstancedBufferAttribute(new Float32Array(treePos.length * 3), 3)
    const dummy = new Object3D()
    const white = new Color(1, 1, 1)
    for (let i = 0; i < treePos.length; i++) {
      const tree = treePos[i]
      const trunkSY = 0.82 + hash01(i * 3) * 0.16
      dummy.position.set(tree.x, tree.y, tree.z)
      dummy.rotation.set(0, tree.yaw, 0)
      dummy.scale.set(tree.scale, trunkSY, tree.scale)
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
      trunks.setColorAt(i, white)
      const canopySY = 0.85 * tree.scale
      const lift = crownLift(trunkSY, canopySY, 0.35)
      dummy.position.set(tree.x, tree.y + lift, tree.z)
      dummy.scale.set(canopySY * 1.45, canopySY, canopySY * 1.45)
      dummy.updateMatrix()
      canopy.setMatrixAt(i, dummy.matrix)
      canopy.setColorAt(i, white)
      const canopyR = 1.6 * tree.scale
      yardTrees.push({
        x: tree.x,
        z: tree.z,
        y: tree.y,
        trunkR: 0.28 * tree.scale,
        canopyR,
        canopyY: tree.y + lift,
        index: i,
      })
    }
    trunks.castShadow = true
    trunks.userData.unique = true
    canopy.castShadow = false
    canopy.userData.canopy = true
    canopy.userData.unique = true
    trunks.boundingSphere = null
    canopy.boundingSphere = null
    group.add(trunks, canopy)
  }

  return { blocks, trees: yardTrees, trunkFade, canopyFade, canopy }
}
