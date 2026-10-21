import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBuilder } from './geom.ts'
import type { Heightfield } from './height.ts'
import { hash01 } from './math.ts'

/**
 * 3–5 smooth icospheres. Radii sit between 0.55 and 0.9, jittered by ±0.3.
 * Vertex colors vary lightness by ±6%, and the underside is darker so a crown
 * has contact shade without a second shadow map.
 */
export function clusterCanopy(radius = 1): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = []
  const puffs: [number, number, number, number][] = [
    [0.0, 0.1, 0.0, 0.88],
    [0.28, 0.02, 0.14, 0.74],
    [-0.26, 0.06, -0.12, 0.68],
    [0.08, 0.24, -0.22, 0.6],
    [-0.14, -0.06, 0.26, 0.56],
  ]
  for (const [ox, oy, oz, scale] of puffs) {
    const r = radius * Math.min(0.9, Math.max(0.55, scale))
    const geo = new THREE.IcosahedronGeometry(r, 1)
    geo.translate(ox * 0.3, oy * 0.3, oz * 0.3)
    blobs.push(geo)
  }
  const merged = mergeGeometries(blobs) ?? blobs[0]
  paintLightness(merged, true)
  return merged
}

/** Bole from radius 0.18 to 0.32, plus two or three limbs. Mottled in vertex color. */
export function treeTrunk(): THREE.BufferGeometry {
  const bole = new THREE.CylinderGeometry(0.18, 0.32, 3.15, 6)
  bole.translate(0, 1.58, 0)
  const parts: THREE.BufferGeometry[] = [bole]
  const limbs: [number, number, number][] = [
    [0.55, 0.62, 2.15],
    [2.6, 0.5, 1.95],
    [4.3, 0.58, 2.28],
  ]
  for (const [yaw, pitch, y] of limbs) {
    const limb = new THREE.CylinderGeometry(0.045, 0.085, 0.95, 4)
    limb.translate(0, 0.48, 0)
    limb.rotateZ(pitch)
    limb.rotateY(yaw)
    limb.translate(0, y, 0)
    parts.push(limb)
  }
  const merged = mergeGeometries(parts) ?? bole
  paintLightness(merged, false)
  return merged
}

function paintLightness(geo: THREE.BufferGeometry, underside: boolean): void {
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
    let lift = 0.94 + n * 0.12
    if (underside) {
      const t = (pos.getY(i) - minY) / (maxY - minY || 1)
      lift *= 0.7 + t * 0.3
    }
    colors[i * 3] = lift
    colors[i * 3 + 1] = lift
    colors[i * 3 + 2] = lift
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
  // Mostly two stories [S, DDG]. A few one-story and a few three-story [S].
  const stories = n < 0.16 ? 1 : n < 0.82 ? 2 : 3
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
  if (stories <= 1) return 4.6
  if (stories >= 3) return 10.1
  return 7.3
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
    bark.setHex(plane ? 0xa49a86 : 0x5a4a3a)
    bark.multiplyScalar(0.94 + n * 0.1)
    trunks.setColorAt(i, bark)
    const jitter = 0.82 + hash01(i * 9 + 2) * 0.36
    const crown = (plane ? 1.25 : 1.35) * jitter
    const lift = plane ? 3.55 + crown * 0.28 : 2.45 + crown * 0.18
    dummy.position.set(p.x, y + lift, p.z)
    dummy.scale.set(crown * (plane ? 0.92 : 1.15), crown * (plane ? 1.3 : 0.7), crown * (plane ? 0.92 : 1.15))
    dummy.updateMatrix()
    canopy.setMatrixAt(i, dummy.matrix)
    // London planes are the tall olive crowns. Other boulevard trees are valley oaks.
    const hex = plane ? 0x7c8a55 : n > 0.5 ? 0x6f7d4a : 0x5e6b3f
    color.setHex(hex)
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
