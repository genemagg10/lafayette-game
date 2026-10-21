import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBuilder } from './geom.ts'
import type { Heightfield } from './height.ts'
import { hash01 } from './math.ts'

const LEAF_LO = [0x5e / 255, 0x6b / 255, 0x3f / 255]
const LEAF_HI = [0x7c / 255, 0x8a / 255, 0x55 / 255]

/**
 * Five lobes, each offset by up to 0.4 of the crown radius.
 * Vertex color sits between #5e6b3f and #7c8a55, then ±6%.
 */
export function clusterCanopy(radius = 1): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = []
  const lobes: [number, number, number, number][] = [
    [0, 0.08, 0, 0.86],
    [0.4, -0.02, 0.12, 0.72],
    [-0.36, 0.04, -0.18, 0.64],
    [0.14, 0.12, -0.4, 0.58],
    [-0.22, -0.08, 0.38, 0.55],
  ]
  for (const [ox, oy, oz, scale] of lobes) {
    const r = radius * Math.min(0.9, Math.max(0.55, scale))
    const geo = new THREE.IcosahedronGeometry(r, 1)
    geo.translate(ox * radius, oy * radius * 0.35, oz * radius)
    blobs.push(geo)
  }
  const merged = mergeGeometries(blobs) ?? blobs[0]
  paintFoliage(merged)
  const phase = new Float32Array(merged.getAttribute('position').count)
  merged.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  return merged
}

/** Per-instance phase so the 4s sway does not lock a whole row. */
export function assignPhase(geo: THREE.BufferGeometry, count: number, seed: number): void {
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
  for (let i = 0; i < count; i++) phase.setX(i, hash01(seed + i * 17) * Math.PI * 2)
  geo.setAttribute('phase', phase)
}

/** Top of the bole in local space. Crowns seat on this, not above it. */
export const TRUNK_TOP = 3.15
/** Lowest vertex of `clusterCanopy(1)`, with a little slack so the crown overlaps the bole. */
export const CANOPY_BOTTOM = -0.9

/** Lift for an instanced crown so its bottom rests on the bole and tucks `tuck` meters over the limbs. */
export function crownLift(trunkScaleY: number, canopyScaleY: number, tuck = 0.45): number {
  return TRUNK_TOP * trunkScaleY - tuck - CANOPY_BOTTOM * canopyScaleY
}

const BARK_LO = [0x6b / 255, 0x3e / 255, 0x28 / 255]
const BARK_HI = [0xa6 / 255, 0x6a / 255, 0x42 / 255]

/** Bole from radius 0.18 to 0.32. Short limbs stay inside the crown. */
export function treeTrunk(): THREE.BufferGeometry {
  const bole = new THREE.CylinderGeometry(0.22, 0.34, 3.15, 7)
  bole.translate(0, 1.58, 0)
  const parts: THREE.BufferGeometry[] = [bole]
  const limbs: [number, number, number][] = [
    [0.6, 0.38, 2.78],
    [2.7, 0.34, 2.62],
    [4.4, 0.36, 2.88],
  ]
  for (const [yaw, pitch, y] of limbs) {
    const limb = new THREE.CylinderGeometry(0.05, 0.09, 0.62, 4)
    limb.translate(0, 0.31, 0)
    limb.rotateZ(pitch)
    limb.rotateY(yaw)
    limb.translate(0, y, 0)
    parts.push(limb)
  }
  const merged = mergeGeometries(parts) ?? bole
  paintBark(merged)
  return merged
}

/** Warm brown in the vertex color. Instance color stays near white so it is not multiplied down to black. */
function paintBark(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (let i = 0; i < pos.count; i++) {
    const n = hash01(i * 17 + Math.round(pos.getY(i) * 40))
    const t = (pos.getY(i) - minY) / (maxY - minY || 1)
    const mix = Math.min(1, Math.max(0, n * 0.72 + (1 - t) * 0.18))
    colors[i * 3] = BARK_LO[0] + (BARK_HI[0] - BARK_LO[0]) * mix
    colors[i * 3 + 1] = BARK_LO[1] + (BARK_HI[1] - BARK_LO[1]) * mix
    colors[i * 3 + 2] = BARK_LO[2] + (BARK_HI[2] - BARK_LO[2]) * mix
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function paintFoliage(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (let i = 0; i < pos.count; i++) {
    const n = hash01(i * 17 + Math.round(pos.getY(i) * 40))
    const t = (pos.getY(i) - minY) / (maxY - minY || 1)
    const mix = Math.min(1, Math.max(0, n * 0.65 + t * 0.35))
    const lift = 0.94 + n * 0.12
    colors[i * 3] = (LEAF_LO[0] + (LEAF_HI[0] - LEAF_LO[0]) * mix) * lift
    colors[i * 3 + 1] = (LEAF_LO[1] + (LEAF_HI[1] - LEAF_LO[1]) * mix) * lift
    colors[i * 3 + 2] = (LEAF_LO[2] + (LEAF_HI[2] - LEAF_LO[2]) * mix) * lift
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/**
 * Downtown Lafayette, as the street reads today.
 * Heights and the hero sites follow the research spec: sourced where a
 * document or address exists, estimated where the spec says so.
 */

export type HeroId = 'theater' | 'garrett' | 'pioneer' | 'library'

export interface Facade {
  wall: number
  base: number
  roof: number
  awning: number
  hero: HeroId | null
  /** 1, 2, or 3. Two is the boulevard read. */
  stories: number
}

const HEROES: { id: HeroId; x: number; z: number; r: number }[] = [
  // Park Theater, 3558 Mt Diablo Blvd. Address geocode [S, Census].
  { id: 'theater', x: 368.8, z: -422.9, r: 42 },
  // Garrett Building, 3565. The odd address is the other side of the boulevard [S number, E side].
  { id: 'garrett', x: 392, z: -458, r: 36 },
  // Pioneer Store, 3535 Plaza Way. Coordinate is low-confidence [E].
  { id: 'pioneer', x: 603.6, z: -404.9, r: 34 },
  // Library and Learning Center. Footprint is the OSM way; this is its centre [S].
  { id: 'library', x: 820, z: -438, r: 48 },
]

const STUCCO = [0xe6dccb, 0xddd4c4, 0xe7e0d4, 0xd8cbb8]
const BATTEN = [0xcfc6b4]
const BRICK = [0x9a5a44, 0x8e4e3c, 0xa46652]
const STONE = [0xc5beb4, 0x9a948c, 0xb7aea2]
const AWNING = [0x7a4a36, 0x3f5a4a]
export const BATTEN_HEX = 0xcfc6b4

export function inDowntown(x: number, z: number): boolean {
  return x > 140 && x < 980 && z > -640 && z < -300
}

export function coreBoulevard(name: string, x: number, z: number): boolean {
  return /mount diablo boulevard/i.test(name) && x > 160 && x < 960 && z > -560 && z < -340
}

/** Grey pavers at Oak Hill, Moraga, and First [S, SIMP]. */
export function greyIntersection(x: number, z: number): boolean {
  const spots = [
    [412.8, -432.3],
    [551.4, -444.2],
    [763.2, -437],
  ]
  return spots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 28)
}

export function noteHero(name: string, x: number, z: number, best: Map<HeroId, number>): void {
  const hero = heroNear(name, x, z)
  if (!hero) return
  const spot = HEROES.find((item) => item.id === hero)
  const d = spot ? Math.hypot(x - spot.x, z - spot.z) : 0
  const prev = best.get(hero)
  if (prev == null || d < prev) best.set(hero, d)
}

export function facadeFor(x: number, z: number, name: string, salt: number, best?: Map<HeroId, number>): Facade | null {
  if (!inDowntown(x, z) && !/library/i.test(name)) return null
  let hero = heroNear(name, x, z)
  if (hero && best) {
    const spot = HEROES.find((item) => item.id === hero)
    const d = spot ? Math.hypot(x - spot.x, z - spot.z) : 99
    if (d > (best.get(hero) ?? 0) + 0.8) hero = null
  }
  if (hero === 'theater') return { wall: 0xe6dccb, base: 0xd8cbb8, roof: 0xb56a4a, awning: 0x7a4a36, hero, stories: 2 }
  if (hero === 'garrett') return { wall: 0x9a5a44, base: 0x7a4638, roof: 0xb56a4a, awning: 0x3f5a4a, hero, stories: 2 }
  if (hero === 'pioneer') return { wall: BATTEN_HEX, base: 0xb7ad9c, roof: 0xb56a4a, awning: 0x7a4a36, hero, stories: 2 }
  if (hero === 'library') return { wall: 0xe6dccb, base: 0xc5beb4, roof: 0xb8b1a4, awning: 0x3f5a4a, hero, stories: 2 }
  const n = hash01(salt)
  // Mt Diablo Blvd is one and two storeys. Taller blocks stay near BART.
  const stories = n < 0.28 ? 1 : 2
  const family = hash01(salt + 5)
  const upper = family < 0.4 ? STUCCO : family < 0.62 ? BATTEN : family < 0.86 ? BRICK : STONE
  const lower = family < 0.5 ? STONE : family < 0.75 ? BRICK : BATTEN
  const wall = upper[Math.abs(salt) % upper.length]
  const base = lower[Math.abs(salt + 2) % lower.length]
  return {
    wall,
    base,
    roof: hash01(salt + 9) > 0.45 ? 0xb56a4a : 0xb8b1a4,
    awning: AWNING[Math.abs(salt) % AWNING.length],
    hero: null,
    stories,
  }
}

export function storyHeight(stories: number): number {
  if (stories <= 1) return 3.6
  if (stories >= 3) return 10.1
  return 6.4
}

function heroNear(name: string, x: number, z: number): HeroId | null {
  if (/library/i.test(name)) return 'library'
  let best: HeroId | null = null
  let bestD = Infinity
  for (const hero of HEROES) {
    if (hero.id === 'library') continue
    const d = Math.hypot(x - hero.x, z - hero.z)
    if (d < hero.r && d < bestD) {
      best = hero.id
      bestD = d
    }
  }
  return best
}

const signCache = new Map<string, THREE.CanvasTexture>()

export function shopSignTexture(title: string): THREE.CanvasTexture {
  const text = title.length > 22 ? `${title.slice(0, 20)}…` : title
  const cached = signCache.get(text)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  g.fillStyle = '#f7f1e4'
  g.fillRect(0, 0, 512, 128)
  g.strokeStyle = '#2a241c'
  g.lineWidth = 10
  g.strokeRect(6, 6, 500, 116)
  g.fillStyle = '#1c2430'
  g.font = '700 54px Outfit, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 256, 68)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  signCache.set(text, tex)
  return tex
}

/**
 * Window bays at 1.2 m with 1.6 m sills and a 6 cm frame.
 * A storefront (any awning) gets a 3.2 m ground-floor glass band.
 */
export function punchFacade(
  glass: MeshBuilder,
  awnings: MeshBuilder,
  poly: number[],
  y0: number,
  height: number,
  awning: number,
): void {
  const n = poly.length / 2
  let longest = 0
  let longI = 0
  for (let i = 0; i < n; i++) {
    const len = Math.hypot(poly[((i + 1) % n) * 2] - poly[i * 2], poly[((i + 1) % n) * 2 + 1] - poly[i * 2 + 1])
    if (len > longest) {
      longest = len
      longI = i
    }
  }
  const glassColor = new THREE.Color(0x3d4a52)
  const frame = new THREE.Color(0x2c2824)
  const warm = new THREE.Color(0xffe1a8)
  const cloth = new THREE.Color(awning || 0x7a4a36)
  const storefront = awning !== 0
  for (let i = 0; i < n; i++) {
    const x1 = poly[i * 2]
    const z1 = poly[i * 2 + 1]
    const x2 = poly[((i + 1) % n) * 2]
    const z2 = poly[((i + 1) % n) * 2 + 1]
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    if (len < 2.2) continue
    const ux = dx / len
    const uz = dz / len
    const ox = uz * 0.08
    const oz = -ux * 0.08
    const bays = Math.max(1, Math.round(len / 1.2))
    const floors = height > 8.4 ? 3 : height > 5.2 ? 2 : 1
    const bandTop = storefront ? Math.min(y0 + 3.2, y0 + height - 0.35) : 0
    if (storefront && bandTop - y0 > 1.4) {
      const yb = y0 + 0.12
      const pane = new THREE.Color(0x3d4a52)
      quad(glass, x1 + ox, yb, z1 + oz, x2 + ox, yb, z2 + oz, x2 + ox, bandTop, z2 + oz, x1 + ox, bandTop, z1 + oz, pane)
      quad(glass, x1 + ox, bandTop - 0.06, z1 + oz, x2 + ox, bandTop - 0.06, z2 + oz, x2 + ox, bandTop, z2 + oz, x1 + ox, bandTop, z1 + oz, frame)
      for (let b = 0; b <= bays; b++) {
        const t = b / bays
        const cx = x1 + dx * t + ox
        const cz = z1 + dz * t + oz
        quad(
          glass,
          cx - ux * 0.03, yb, cz - uz * 0.03,
          cx + ux * 0.03, yb, cz + uz * 0.03,
          cx + ux * 0.03, bandTop, cz + uz * 0.03,
          cx - ux * 0.03, bandTop, cz - uz * 0.03,
          frame,
        )
      }
    }
    const firstFloor = storefront ? 1 : 0
    for (let f = firstFloor; f < floors; f++) {
      const sill = y0 + (storefront ? 3.45 : 1.05) + (f - firstFloor) * 2.4
      const top = sill + 1.6
      if (top > y0 + height - 0.2) continue
      for (let b = 0; b < bays; b++) {
        const t = (b + 0.5) / bays
        const cx = x1 + dx * t + ox
        const cz = z1 + dz * t + oz
        const hw = 0.42
        const lit = hash01((cx * 10 + f) | 0) > 0.86 ? warm : glassColor
        quad(
          glass,
          cx - ux * (hw + 0.06), sill - 0.06, cz - uz * (hw + 0.06),
          cx + ux * (hw + 0.06), sill - 0.06, cz + uz * (hw + 0.06),
          cx + ux * (hw + 0.06), top + 0.06, cz + uz * (hw + 0.06),
          cx - ux * (hw + 0.06), top + 0.06, cz - uz * (hw + 0.06),
          frame,
        )
        quad(
          glass,
          cx - ux * hw, sill, cz - uz * hw,
          cx + ux * hw, sill, cz + uz * hw,
          cx + ux * hw, top, cz + uz * hw,
          cx - ux * hw, top, cz - uz * hw,
          lit,
        )
      }
    }
    if (awning && i === longI && len > 4) {
      const y = storefront ? y0 + 3.2 : y0 + Math.min(3.15, height * 0.42)
      const reach = 1.05
      awnings.tri(
        x1, y, z1,
        x2, y, z2,
        x1 + ox * reach * 14, y + 0.08, z1 + oz * reach * 14,
        cloth,
      )
      awnings.tri(
        x2, y, z2,
        x2 + ox * reach * 14, y + 0.08, z2 + oz * reach * 14,
        x1 + ox * reach * 14, y + 0.08, z1 + oz * reach * 14,
        cloth,
      )
    }
  }
}

function quad(
  b: MeshBuilder,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  x4: number, y4: number, z4: number,
  color: THREE.Color,
): void {
  b.tri(x1, y1, z1, x2, y2, z2, x3, y3, z3, color)
  b.tri(x1, y1, z1, x3, y3, z3, x4, y4, z4, color)
}

/** +1 when the boulevard (about z = -432) lies south of the building. */
function towardStreet(z: number): number {
  return Math.sign(-432 - z) || -1
}

export function addHeroAccent(group: THREE.Group, hero: HeroId, x: number, z: number, y: number): void {
  const face = towardStreet(z)
  if (hero === 'theater') {
    // Side marquee [S]. The letters also face along the boulevard so the street view can read them.
    const mz = z + face * 4.4
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 1.6, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xf7f1e4, emissive: 0xffb03a, emissiveIntensity: 0.85, roughness: 0.4 }),
    )
    board.position.set(x, y + 6.4, mz)
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.55, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xfff1c2, emissive: 0xffe28a, emissiveIntensity: 1.4, roughness: 0.2 }),
    )
    neon.position.set(x, y + 6.45, mz + face * 0.22)
    const letters = shopSignTexture('PARK')
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.05),
      new THREE.MeshBasicMaterial({ map: letters, toneMapped: false, side: THREE.DoubleSide }),
    )
    front.position.set(x, y + 6.45, mz + face * 0.28)
    const blade = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.05),
      new THREE.MeshBasicMaterial({ map: letters, toneMapped: false, side: THREE.DoubleSide }),
    )
    blade.rotation.y = Math.PI / 2
    blade.position.set(x + 3.5, y + 6.45, mz)
    group.add(board, neon, front, blade)
    return
  }
  if (hero === 'garrett') {
    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.5, 12.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x8e4038, roughness: 0.78, flatShading: true }),
    )
    turret.position.set(x + 4.2, y + 6.1, z + face * 3.2)
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(1.9, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.7, flatShading: true }),
    )
    cap.position.set(x + 4.2, y + 13.2, z + face * 3.2)
    group.add(turret, cap)
    return
  }
  if (hero === 'pioneer') {
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(8.5, 0.16, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x6e4a34, roughness: 0.8 }),
    )
    canopy.position.set(x, y + 3.2, z + face * 3.4)
    group.add(canopy)
  }
}

export interface BlvdTree {
  x: number
  z: number
  /** plane = median London plane. gum = sidewalk sweetgum. pear = intersection Aristocrat [S, SIMP]. */
  kind: 'plane' | 'gum' | 'pear'
}

export interface PlantedTree {
  x: number
  z: number
  y: number
  trunkR: number
  canopyR: number
  canopyY: number
  index: number
}

/** London planes in the median, sweetgums on the sidewalk. Crowns start above eye level [S, SIMP]. */
export function plantBoulevard(
  group: THREE.Group,
  lines: BlvdTree[],
  height: Heightfield,
  trunkMat: THREE.Material,
  canopyMat: THREE.Material,
): { planted: PlantedTree[]; trunkFade: THREE.InstancedBufferAttribute; canopyFade: THREE.InstancedBufferAttribute } | null {
  if (!lines.length) return null
  const count = lines.length
  const trunkGeo = treeTrunk()
  const canopyGeo = clusterCanopy(1)
  const trunkFade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
  const canopyFade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
  trunkGeo.setAttribute('fade', trunkFade)
  canopyGeo.setAttribute('fade', canopyFade)
  assignPhase(canopyGeo, count, 11)
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count)
  const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, count)
  canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
  trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const bark = new THREE.Color()
  const planted: PlantedTree[] = []
  for (let i = 0; i < count; i++) {
    const p = lines[i]
    const y = height.sample(p.x, p.z)
    const plane = p.kind === 'plane'
    dummy.position.set(p.x, y, p.z)
    dummy.rotation.set(0, hash01(i) * Math.PI, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    trunks.setMatrixAt(i, dummy.matrix)
    const n = hash01(i * 5 + 3)
    bark.setRGB(1, 1, 1)
    bark.multiplyScalar(0.94 + n * 0.1)
    trunks.setColorAt(i, bark)
    const jitter = 0.82 + hash01(i * 9 + 2) * 0.36
    const crown = (plane ? 1.25 : 1.35) * jitter
    const canopyScaleY = plane ? crown * 1.35 : crown * 0.78
    const lift = crownLift(1, canopyScaleY)
    dummy.position.set(p.x, y + lift, p.z)
    if (plane) dummy.scale.set(crown * 0.86, canopyScaleY, crown * 0.86)
    else dummy.scale.set(canopyScaleY * 1.6, canopyScaleY, canopyScaleY * 1.6)
    dummy.updateMatrix()
    canopy.setMatrixAt(i, dummy.matrix)
    color.setRGB(1, 1, 1)
    canopy.setColorAt(i, color)
    planted.push({
      x: p.x,
      z: p.z,
      y,
      trunkR: 0.34,
      canopyR: crown,
      canopyY: y + lift,
      index: i,
    })
  }
  trunks.castShadow = true
  canopy.castShadow = false
  canopy.receiveShadow = false
  trunks.userData.unique = true
  canopy.userData.unique = true
  group.add(trunks, canopy)
  return { planted, trunkFade, canopyFade }
}
