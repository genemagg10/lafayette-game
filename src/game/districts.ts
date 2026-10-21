import * as THREE from 'three'
import { MeshBuilder } from './geom.ts'
import type { Heightfield } from './height.ts'
import { F_ROAD, F_WATER } from './height.ts'
import { hash01 } from './math.ts'
import { clusterCanopy, crownLift, treeTrunk } from './downtown.ts'
import { makeSignTexture, solidCanopyMaterial } from './materials.ts'
import type { Road, WaterFile } from './types.ts'

/**
 * Facade colours and street-tree species are not in the spec.
 * Assumptions, used only where the spec is silent:
 * - Visitor Center: cedar walls, pale roof.
 * - Stanley: cream stucco, one story, gray roof.
 * - Springhill: warm-gray stucco; the largest wing is the brick multipurpose room kept from 1955.
 * - Acalanes rows: off-white stucco, dark window band, shallow roof.
 * - Moraga Rd and Deer Hill oaks: valley oak #6f7d4a, wide and low, planted sparsely.
 * - Helen Webber column colours are a stand-in for the 1970s enamel.
 * - The second play area sits just east of the mapped playground.
 * - The fish-cleaning roof sits beside the larger east pier.
 */

const CREAM = 0xe7d7c0
const WARM_GRAY = 0xd5cfc3
const BRICK = 0x8c4e3b
const CEDAR = 0x8d5e3c
const OFFWHITE = 0xddd4c4
const ROOF = 0xb7b2a8
const WOOD = 0x8a6844

export interface Footprint {
  w: number
  d: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function footprintSize(poly: number[]): Footprint {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i])
    maxX = Math.max(maxX, poly[i])
    minZ = Math.min(minZ, poly[i + 1])
    maxZ = Math.max(maxZ, poly[i + 1])
  }
  return { w: maxX - minX, d: maxZ - minZ, minX, maxX, minZ, maxZ }
}

export interface SchoolDress {
  height: number
  wall: number
  roof: number
  rows: boolean
}

/** Campus overrides. Null leaves the ordinary tile building alone. */
export function schoolDress(name: string, sx: number, sz: number, box: Footprint, height: number): SchoolDress | null {
  if (/visitor center/i.test(name)) return { height, wall: CEDAR, roof: 0xd9d3c6, rows: false }
  const thin = Math.min(box.w, box.d)
  const thick = Math.max(box.w, box.d)
  if (sx > 880 && sx < 1040 && sz > 60 && sz < 260) {
    return { height: thin < 22 && thick > 36 ? 4.3 : Math.min(height, 5.2), wall: CREAM, roof: ROOF, rows: false }
  }
  if (sx > 2140 && sx < 2340 && sz < -1980 && sz > -2220) {
    const hall = thick > 26
    return { height: hall ? 6.4 : 4.5, wall: hall ? BRICK : WARM_GRAY, roof: hall ? 0x6e6258 : ROOF, rows: false }
  }
  if (sx > 2280 && sx < 2520 && sz < -1650 && sz > -1960) {
    if (/cafeteria|drama|gym/i.test(name)) return { height: Math.min(height, 8), wall: OFFWHITE, roof: ROOF, rows: false }
    if (box.w * box.d > 3600) return { height: 7.4, wall: 0xe7e0d4, roof: ROOF, rows: false }
    if (thin > 26 && thick > 45) return { height: 4.2, wall: OFFWHITE, roof: ROOF, rows: true }
    return { height: 4.3, wall: OFFWHITE, roof: ROOF, rows: false }
  }
  return null
}

const rowWall = new THREE.Color(OFFWHITE)
const rowRoof = new THREE.Color(ROOF)
const rowGlass = new THREE.Color(0x243038)

/** A box with the same winding as the roof penthouses, so the outside face is the one the camera sees. */
function addBox(builder: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color): void {
  const x0 = x - w / 2
  const x1 = x + w / 2
  const y0 = y
  const y1 = y + h
  const z0 = z - d / 2
  const z1 = z + d / 2
  builder.tri(x0, y1, z0, x1, y1, z0, x0, y1, z1, color)
  builder.tri(x1, y1, z0, x1, y1, z1, x0, y1, z1, color)
  builder.tri(x0, y0, z0, x1, y0, z0, x0, y1, z0, color)
  builder.tri(x1, y0, z0, x1, y1, z0, x0, y1, z0, color)
  builder.tri(x0, y0, z1, x0, y1, z1, x1, y0, z1, color)
  builder.tri(x1, y0, z1, x0, y1, z1, x1, y1, z1, color)
  builder.tri(x0, y0, z0, x0, y1, z0, x0, y0, z1, color)
  builder.tri(x0, y1, z0, x0, y1, z1, x0, y0, z1, color)
  builder.tri(x1, y0, z0, x1, y0, z1, x1, y1, z0, color)
  builder.tri(x1, y0, z1, x1, y1, z1, x1, y1, z0, color)
}

/** Parallel single-story bars inside a fat footprint, the 1939 classroom plan. */
export function addClassroomRows(walls: MeshBuilder, roofs: MeshBuilder, poly: number[], sample: (x: number, z: number) => number): void {
  const box = footprintSize(poly)
  const alongX = box.w >= box.d
  const long = (alongX ? box.w : box.d) - 3
  const short = alongX ? box.d : box.w
  const rows = 3
  const bar = 4.6
  const inset = 1.6
  const usable = Math.max(bar * rows, short - inset * 2)
  const cx = (box.minX + box.maxX) / 2
  const cz = (box.minZ + box.maxZ) / 2
  const y = sample(cx, cz)
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows
    const ox = alongX ? 0 : box.minX + inset + t * usable - cx
    const oz = alongX ? box.minZ + inset + t * usable - cz : 0
    const px = cx + ox
    const pz = cz + oz
    const bw = alongX ? long : bar
    const bd = alongX ? bar : long
    addBox(walls, px, y, pz, bw, 4.2, bd, rowWall)
    addBox(roofs, px, y + 4.2, pz, bw + 0.6, 0.28, bd + 0.8, rowRoof)
    addBox(walls, px, y + 1.7, pz, alongX ? long - 2 : bar + 0.16, 1.05, alongX ? bar + 0.16 : long - 2, rowGlass)
  }
}

function lit(color: number, rough = 0.82): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, emissive: color, emissiveIntensity: 0.16 })
}

function sign(title: string, x: number, z: number, height: Heightfield, parent: THREE.Object3D): void {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: makeSignTexture(title), transparent: true }))
  mesh.position.set(x, height.sample(x, z) + 2.2, z)
  parent.add(mesh)
}

function deckBetween(a: THREE.Vector3, b: THREE.Vector3, width: number, mat: THREE.Material, flat = false): THREE.Mesh {
  const from = a.clone()
  const to = b.clone()
  if (flat) {
    const y = Math.max(from.y, to.y)
    from.y = y
    to.y = y
  }
  const length = Math.max(1.2, from.distanceTo(to))
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, flat ? 0.28 : 0.18, length), mat)
  mesh.position.copy(from).lerp(to, 0.5)
  mesh.lookAt(to.x, to.y, to.z)
  return mesh
}

export function dressDistricts(root: THREE.Group, height: Heightfield, water: WaterFile, roads: Road[]): void {
  const group = new THREE.Group()
  group.name = 'districts'
  const wood = lit(WOOD, 0.78)
  const concrete = lit(0xc8c4bc, 0.9)
  const scaffold = lit(0xc45c32, 0.7)
  const waterY = height.waterLevel

  const body = water.bodies.reduce((best, item) => (item.p.length > (best?.p.length ?? 0) ? item : best), water.bodies[0])
  if (body) {
    const shore: { x: number; z: number }[] = []
    const n = body.p.length / 2
    let cx = 0
    let cz = 0
    for (let i = 0; i < n; i++) {
      cx += body.p[i * 2]
      cz += body.p[i * 2 + 1]
    }
    cx /= n
    cz /= n
    let carry = 0
    for (let i = 0; i < n; i++) {
      const ax = body.p[i * 2]
      const az = body.p[i * 2 + 1]
      const bx = body.p[((i + 1) % n) * 2]
      const bz = body.p[((i + 1) % n) * 2 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      let d = 70 - carry
      while (d < len) {
        const t = d / len
        shore.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t })
        d += 78
      }
      carry = Math.max(0, d - len)
    }
    const docks = [
      { x: -1520.8, z: 420.8 },
      { x: -1512, z: 436.4 },
    ]
    const pierAt: { x: number; z: number }[] = []
    const addPier = (x: number, z: number, reach: number, width: number) => {
      const dx = cx - x
      const dz = cz - z
      const span = Math.hypot(dx, dz) || 1
      const land = new THREE.Vector3(x - (dx / span) * 3, waterY + 0.72, z - (dz / span) * 3)
      const tip = new THREE.Vector3(x + (dx / span) * reach, waterY + 0.72, z + (dz / span) * reach)
      group.add(deckBetween(land, tip, width, wood, true))
      pierAt.push({ x, z })
    }
    let placed = 0
    for (const p of shore) {
      if (placed >= 28) break
      if (docks.some((dock) => Math.hypot(dock.x - p.x, dock.z - p.z) < 36)) continue
      addPier(p.x, p.z, 11, 1.7)
      placed += 1
    }
    // The 78 m walk skips the north-shore inlet. The spec wants many separate piers there.
    let inlet = 0
    for (let i = 0; i < n; i++) {
      const ax = body.p[i * 2]
      const az = body.p[i * 2 + 1]
      const bx = body.p[((i + 1) % n) * 2]
      const bz = body.p[((i + 1) % n) * 2 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      for (let d = 8; d < len; d += 22) {
        const t = d / len
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        if (z < 350 || z > 520 || x < -1490 || x > -1290) continue
        if (docks.some((dock) => Math.hypot(dock.x - x, dock.z - z) < 24)) continue
        if (pierAt.some((pier) => Math.hypot(pier.x - x, pier.z - z) < 16)) continue
        addPier(x, z, 8, 1.45)
        inlet += 1
        if (inlet >= 10) break
      }
      if (inlet >= 10) break
    }
    const longPier = (x: number, z: number) => {
      const dx = cx - x
      const dz = cz - z
      const span = Math.hypot(dx, dz) || 1
      const land = new THREE.Vector3(x - (dx / span) * 3, waterY + 0.74, z - (dz / span) * 3)
      const tip = new THREE.Vector3(x + (dx / span) * 18, waterY + 0.74, z + (dz / span) * 18)
      group.add(deckBetween(land, tip, 2.4, wood, true))
    }
    longPier(-1298.5, 719.1)
    longPier(-1087.6, 548.8)
    for (const dock of docks) {
      const dx = cx - dock.x
      const dz = cz - dock.z
      const span = Math.hypot(dx, dz) || 1
      const land = new THREE.Vector3(dock.x - (dx / span) * 2, waterY + 0.78, dock.z - (dz / span) * 2)
      const tip = new THREE.Vector3(dock.x + (dx / span) * 16, waterY + 0.78, dock.z + (dz / span) * 16)
      group.add(deckBetween(land, tip, 4.2, wood, true))
      const sideX = -dz / span
      const sideZ = dx / span
      for (let i = 0; i < 4; i++) {
        const boat = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.42, 2.6), lit(i % 2 === 0 ? 0xf4efe4 : i === 1 ? 0x3d6ea5 : 0xd4564e, 0.55))
        const t = 0.32 + i * 0.16
        boat.position.copy(land).lerp(tip, t)
        const side = i % 2 === 0 ? 2.5 : -2.5
        boat.position.x += sideX * side
        boat.position.z += sideZ * side
        boat.position.y = waterY + 0.62
        boat.lookAt(tip.x, boat.position.y, tip.z)
        group.add(boat)
      }
    }
    const rampLand = new THREE.Vector3(-1066, Math.max(height.sample(-1066, 552), waterY + 0.4), 552)
    const rampWet = new THREE.Vector3(-1052, waterY - 0.05, 540)
    group.add(deckBetween(rampLand, rampWet, 3.2, concrete))
  }

  const tower = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 12, 8), concrete)
  shaft.position.y = 6
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.45, 8), concrete)
  rim.position.y = 11.6
  tower.add(shaft, rim)
  for (const [px, pz] of [[3.2, 3.2], [3.2, -3.2], [-3.2, 3.2], [-3.2, -3.2]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 13.5, 6), scaffold)
    pole.position.set(px, 6.6, pz)
    tower.add(pole)
  }
  for (const yy of [3.4, 6.4, 9.4]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.16, 6, 14), scaffold)
    ring.rotation.x = Math.PI / 2
    ring.position.y = yy
    tower.add(ring)
  }
  tower.position.set(-1376.7, waterY, 444.2)
  group.add(tower)

  const play = (x: number, z: number, scale: number) => {
    const y = height.sample(x, z)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2 * scale, 0.12, 0.12), lit(0xc4553a, 0.6))
    frame.position.set(x, y + 2.2 * scale, z)
    const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2 * scale, 5), lit(0x355f8a, 0.6))
    legA.position.set(x - 1.4 * scale, y + 1.1 * scale, z)
    const legB = legA.clone()
    legB.position.x = x + 1.4 * scale
    group.add(frame, legA, legB)
  }
  play(-910.2, 549.9, 1)
  play(-868, 546, 0.72)

  const clean = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 3.2), lit(0xd9d3c6, 0.8))
  const cleanAt = nudgeLand(height, -1087.6, 548.8)
  clean.position.set(cleanAt.x, height.sample(cleanAt.x, cleanAt.z) + 2.4, cleanAt.z)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5), lit(0x5c4636, 0.8))
  post.position.set(cleanAt.x - 1.6, height.sample(cleanAt.x, cleanAt.z) + 1.2, cleanAt.z - 1.2)
  group.add(clean, post)
  sign('Boat rental', -1568, 470, height, group)

  plantOaks(group, height, roads)
  schoolPath(group, height, roads)
  beacons(group, height)
  gemProps(group, height)
  root.add(group)
}

function nudgeLand(height: Heightfield, x: number, z: number): { x: number; z: number } {
  if ((height.flag(x, z) & F_WATER) === 0) return { x, z }
  for (let r = 6; r <= 40; r += 6) {
    for (let a = 0; a < 8; a++) {
      const nx = x + Math.cos(a) * r
      const nz = z + Math.sin(a) * r
      if ((height.flag(nx, nz) & F_WATER) === 0) return { x: nx, z: nz }
    }
  }
  return { x, z }
}

function plantOaks(group: THREE.Group, height: Heightfield, roads: Road[]): void {
  const trunk = new THREE.MeshStandardMaterial({ color: 0x8d5a38, roughness: 0.95, metalness: 0 })
  const leaf = solidCanopyMaterial()
  const stemGeo = treeTrunk()
  const crownGeo = clusterCanopy(1)
  let n = 0
  for (const road of roads) {
    const moraga = /^moraga road$/i.test(road.n)
    const deer = /^deer hill road$/i.test(road.n)
    if (!moraga && !deer) continue
    const step = moraga ? 42 : 36
    let carry = 8
    for (let i = 0; i < road.p.length - 3 && n < 70; i += 3) {
      const ax = road.p[i]
      const az = road.p[i + 1]
      const bx = road.p[i + 3]
      const bz = road.p[i + 4]
      if (moraga && !(ax > 420 && az < 760 && az > -520)) continue
      if (deer && !(ax < 500 && az < -640 && az > -900)) continue
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 1) continue
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      let d = carry
      while (d < len && n < 70) {
        const x = ax + dx * d - dz * (moraga ? 9.2 : 8.4)
        const z = az + dz * d + dx * (moraga ? 9.2 : 8.4)
        if ((height.flag(x, z) & (F_ROAD | F_WATER)) === 0) {
          const y = height.sample(x, z)
          const stem = new THREE.Mesh(stemGeo, trunk)
          stem.position.set(x, y, z)
          stem.castShadow = true
          const crownMesh = crownGeo.clone()
          const verts = crownMesh.getAttribute('position').count
          const phase = new Float32Array(verts)
          phase.fill(hash01(n * 17) * Math.PI * 2)
          crownMesh.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
          const crown = new THREE.Mesh(crownMesh, leaf)
          const canopySY = 2.15 / 1.6
          crown.position.set(x, y + crownLift(1, canopySY), z)
          crown.scale.set(2.15, canopySY, 2.15)
          crown.castShadow = false
          group.add(stem, crown)
          n += 1
        }
        d += step
      }
      carry = Math.max(0, d - len)
    }
  }
}

function schoolPath(group: THREE.Group, height: Heightfield, roads: Road[]): void {
  const mat = lit(0x5b5a57, 0.94)
  for (const road of roads) {
    if (!/^school street$/i.test(road.n)) continue
    for (let i = 0; i < road.p.length - 3; i += 3) {
      const ax = road.p[i]
      const az = road.p[i + 1]
      const bx = road.p[i + 3]
      const bz = road.p[i + 4]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 2) continue
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      const off = road.w * 0.5 + 2.8
      const a = new THREE.Vector3(ax - dz * off, height.sample(ax, az) + 0.08, az + dx * off)
      const b = new THREE.Vector3(bx - dz * off, height.sample(bx, bz) + 0.08, bz + dx * off)
      group.add(deckBetween(a, b, 3.05, mat))
    }
  }
}

function beacons(group: THREE.Group, height: Heightfield): void {
  const pole = lit(0x22262b, 0.6)
  const lamp = lit(0xe6c15a, 0.4)
  for (const [x, z] of [[1124, 130], [1140, 118]] as const) {
    const y = height.sample(x, z)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 3.2, 5), pole)
    post.position.set(x, y + 1.6, z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lamp)
    head.position.set(x, y + 3.3, z)
    group.add(post, head)
  }
  sign('Stanley', 960, 70, height, group)
  sign('Springhill', 2168, -2072, height, group)
  sign('Acalanes', 2290, -1760, height, group)
  sign('Lafayette', 48, -560, height, group)
}

function gemProps(group: THREE.Group, height: Heightfield): void {
  const plots = lit(0x6f8f45, 0.9)
  const soil = lit(0x6b4a32, 0.95)
  for (let i = 0; i < 6; i++) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 4.2), i % 2 ? plots : soil)
    bed.position.set(-1476 + (i % 3) * 2.8, height.sample(-1476, -156) + 0.15, -156 + Math.floor(i / 3) * 4.8)
    group.add(bed)
  }
  const stepMat = lit(0xc8c2b6, 0.9)
  for (let i = 0; i < 8; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.7), stepMat)
    const x = 832
    const z = -2159 - i * 0.7
    step.position.set(x, height.sample(x, z) + 0.1 + i * 0.16, z)
    group.add(step)
  }
  const bridge = (x: number, z: number, rot: number) => {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 7), lit(0x6e5844, 0.8))
    const y = height.sample(x, z) + 0.6
    deck.position.set(x, y, z)
    deck.rotation.y = rot
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 7), lit(0x4a3a30, 0.8))
    rail.position.set(x + Math.cos(rot) * 0.9, y + 0.45, z + Math.sin(rot) * 0.9)
    rail.rotation.y = rot
    group.add(deck, rail)
  }
  bridge(728.3, -1463.9, 0.4)
  bridge(1062.2, 7.8, 0.2)
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(7, 16), lit(0x6fbf4a, 0.95))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.set(1169, height.sample(1169, -354) + 0.05, -354)
  group.add(lawn)
  const enamel = [0xc4553a, 0x2f6b4f, 0xe6c15a, 0x355f8a]
  enamel.forEach((color, i) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.4, 0.08), lit(color, 0.55))
    panel.position.set(29 + i * 1.3, height.sample(29, -583) + 2.2, -583)
    group.add(panel)
  })
}
