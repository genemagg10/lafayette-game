import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBuilder } from './geom.ts'
import type { Heightfield } from './height.ts'
import { hash01 } from './math.ts'

/** A few overlapping spheres, so a crown reads as a clump instead of one gem. */
export function clusterCanopy(radius = 1): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = []
  blobs.push(new THREE.SphereGeometry(radius, 8, 6))
  const puffs: [number, number, number, number][] = [
    [0.58, 0.32, 0.1, 0.76],
    [-0.46, 0.22, 0.4, 0.7],
    [0.14, 0.46, -0.5, 0.72],
    [-0.16, -0.08, -0.46, 0.6],
  ]
  for (const [ox, oy, oz, scale] of puffs) {
    const puff = new THREE.SphereGeometry(radius * scale, 6, 5)
    puff.translate(ox * radius, oy * radius, oz * radius)
    blobs.push(puff)
  }
  return mergeGeometries(blobs) ?? blobs[0]
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

const STUCCO = [0xf4e6cf, 0xe7d3b4, 0xf7f0e4, 0xdcc7a6]
const WOOD = [0xc4a06a, 0xa67c4e, 0x8d5a3c, 0xd7b48a]
const BRICK = [0xa34b3c, 0x8e4038, 0xb85a48]
const STONE = [0xc5beb4, 0x9a948c, 0xb7aea2]

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
  if (hero === 'theater') return { wall: 0xf6f1e6, base: 0xe7e0d2, roof: 0x4a4e55, awning: 0x9e2430, hero, stories: 2 }
  if (hero === 'garrett') return { wall: 0x8e4038, base: 0x6e322c, roof: 0x3a3330, awning: 0x1c2430, hero, stories: 2 }
  if (hero === 'pioneer') return { wall: 0xc4a06a, base: 0x8d5a3c, roof: 0x6e4a34, awning: 0x2f5d34, hero, stories: 2 }
  if (hero === 'library') return { wall: 0xb08968, base: 0x9a9186, roof: 0x5c4636, awning: 0x6e5848, hero, stories: 2 }
  const n = hash01(salt)
  // Mostly two stories [S, DDG]. A few one-story and a few three-story [S].
  const stories = n < 0.16 ? 1 : n < 0.82 ? 2 : 3
  const family = hash01(salt + 5)
  const upper = family < 0.34 ? STUCCO : family < 0.62 ? WOOD : family < 0.84 ? BRICK : STONE
  const lower = family < 0.5 ? STONE : family < 0.75 ? BRICK : WOOD
  const wall = upper[Math.abs(salt) % upper.length]
  const base = lower[Math.abs(salt + 2) % lower.length]
  return {
    wall,
    base,
    roof: hash01(salt + 9) > 0.7 ? 0x6e5848 : 0x5c534c,
    awning: [0x9e2430, 0x2f5d34, 0x1d4e89, 0xc47a3a, 0xf4efe4][Math.abs(salt) % 5],
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

/** Punched windows and a ground-floor awning. Bays are about 25 ft [E from OBJ]. */
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
  const glassColor = new THREE.Color(0x243044)
  const warm = new THREE.Color(0xffe1a8)
  const cloth = new THREE.Color(awning)
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
    const ox = uz * 0.16
    const oz = -ux * 0.16
    const bays = Math.max(1, Math.round(len / 6.4))
    const floors = height > 8.4 ? 3 : height > 5.2 ? 2 : 1
    for (let f = 0; f < floors; f++) {
      const sill = y0 + 1.35 + f * 3.05
      if (sill > y0 + height - 0.55) continue
      const band = new THREE.Color(0x1a2330)
      glass.tri(x1 + ox, sill, z1 + oz, x2 + ox, sill, z2 + oz, x1 + ox, sill + 0.14, z1 + oz, band)
      glass.tri(x2 + ox, sill, z2 + oz, x2 + ox, sill + 0.14, z2 + oz, x1 + ox, sill + 0.14, z1 + oz, band)
    }
    for (let b = 0; b < bays; b++) {
      const t = (b + 0.5) / bays
      const cx = x1 + dx * t + ox
      const cz = z1 + dz * t + oz
      const hw = Math.min(1.7, Math.max(0.95, (len / bays) * 0.32))
      for (let f = 0; f < floors; f++) {
        const wy = y0 + 1.55 + f * 3.05
        const top = wy + 1.85
        if (top > y0 + height - 0.25) continue
        const color = f === 0 && hash01((cx * 10 + f) | 0) > 0.72 ? warm : glassColor
        glass.tri(cx - ux * hw, wy, cz - uz * hw, cx + ux * hw, wy, cz + uz * hw, cx - ux * hw, top, cz - uz * hw, color)
        glass.tri(cx + ux * hw, wy, cz + uz * hw, cx + ux * hw, top, cz + uz * hw, cx - ux * hw, top, cz - uz * hw, color)
      }
    }
    if (awning && i === longI && len > 4) {
      const y = y0 + Math.min(3.15, height * 0.42)
      const reach = 1.15
      awnings.tri(
        x1, y, z1,
        x2, y, z2,
        x1 + ox * reach * 12, y + 0.08, z1 + oz * reach * 12,
        cloth,
      )
      awnings.tri(
        x2, y, z2,
        x2 + ox * reach * 12, y + 0.08, z2 + oz * reach * 12,
        x1 + ox * reach * 12, y + 0.08, z1 + oz * reach * 12,
        cloth,
      )
    }
  }
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
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.8, 6)
  trunkGeo.translate(0, 1.4, 0)
  const canopyGeo = clusterCanopy(1)
  const trunkFade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
  const canopyFade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
  trunkGeo.setAttribute('fade', trunkFade)
  canopyGeo.setAttribute('fade', canopyFade)
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count)
  const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, count)
  canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const planted: PlantedTree[] = []
  for (let i = 0; i < count; i++) {
    const p = lines[i]
    const y = height.sample(p.x, p.z)
    const plane = p.kind === 'plane'
    const pear = p.kind === 'pear'
    const trunkH = plane ? 1.05 : pear ? 0.85 : 0.95
    dummy.position.set(p.x, y, p.z)
    dummy.rotation.set(0, hash01(i) * Math.PI, 0)
    dummy.scale.set(1, trunkH, 1)
    dummy.updateMatrix()
    trunks.setMatrixAt(i, dummy.matrix)
    const jitter = 0.72 + hash01(i * 9 + 2) * 0.62
    const crown = (plane ? 1.45 : pear ? 0.98 : 1.16) * jitter
    const lift = 3.85 + crown * 1.55
    dummy.position.set(p.x, y + lift, p.z)
    dummy.scale.set(crown, crown * 0.92, crown)
    dummy.updateMatrix()
    canopy.setMatrixAt(i, dummy.matrix)
    // Planes are the broad green crowns. Sweetgums carry a little red [E, species]. Pears stay pale.
    const n = hash01(i * 5 + 3)
    const hex = plane
      ? n > 0.66 ? 0x7ed34a : n > 0.33 ? 0x2f9a3c : 0x1d6e32
      : pear
        ? n > 0.5 ? 0xd5e7b0 : 0xb7d07a
        : n > 0.82 ? 0xd06a30 : n > 0.45 ? 0x3aaa44 : 0x8fce3a
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
