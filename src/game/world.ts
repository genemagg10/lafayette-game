import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { uniform } from 'three/tsl'
import { WaterMesh } from 'three/addons/objects/WaterMesh.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Blockers, MeshBuilder, appendRibbon, drapePath, pointInPoly, tint } from './geom.ts'
import { Heightfield, F_BUILDING, F_PARK, F_PARKING, F_ROAD, F_URBAN, F_WATER, F_WOOD } from './height.ts'
import { badgeTexture, battenMaterial, facadeMaterial, foliageMaterial, hillMaterial, impostorMaterial, makeSignTexture, pillTexture, poiAccent, shared, streetNameTexture, townLeafMaterial, trunkMaterial, type Textures } from './materials.ts'
import { dressTown } from './dress.ts'
import { addClassroomRows, dressDistricts, footprintSize, schoolDress } from './districts.ts'
import { spanVisible } from './eras.ts'
import { dressFifties } from './period.ts'
import { forwardFromHeading, hash01, headingFromForward, wrapAngle } from './math.ts'
import { addHouseLots } from './houses.ts'
import { parseOsmColor, town } from './palette.ts'
import { BATTEN_HEX, addHeroAccent, assignPhase, clusterCanopy, coreBoulevard, crownLift, facadeFor, greyIntersection, inDowntown, noteHero, plantBoulevard, punchFacade, shopSignTexture, storyHeight, treeTrunk, type BlvdTree, type Facade, type HeroId } from './downtown.ts'
import { tileKey, tileOf, type TileSet, type VectorTile } from './tiles.ts'
import type { Meta, Road, Season, WaterFile } from './types.ts'

interface TreeOccluder {
  x: number
  z: number
  y: number
  trunkR: number
  canopyR: number
  canopyY: number
  index: number
  trunkFade: THREE.InstancedBufferAttribute
  canopyFade: THREE.InstancedBufferAttribute
  fade: number
}

interface Seg {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  w: number
  trail: boolean
  paved: boolean
  name: string
  cls: string
}

export class World {
  readonly height: Heightfield
  readonly blockers = new Blockers()
  readonly root = new THREE.Group()
  readonly roads: Road[]
  readonly waterLevel: number
  readonly roadMat: THREE.MeshStandardMaterial
  readonly windowMat: THREE.MeshStandardMaterial
  readonly storeMat: THREE.MeshStandardMaterial
  readonly lampMat: THREE.MeshStandardMaterial
  private readonly meta: Meta
  private readonly tileset: TileSet
  private readonly present = new Set<string>()
  private readonly richTiles = new Set<string>()
  private readonly built = new Map<string, THREE.Group>()
  private readonly empty = new Set<string>()
  private readonly inflight = new Set<string>()
  private readonly fails = new Map<string, number>()
  private readonly retryAt = new Map<string, number>()
  private readonly ready: { key: string; tile: VectorTile }[] = []
  private readonly labels: THREE.Sprite[] = []
  private readonly streetNames: THREE.Mesh[] = []
  /** Shared by every painted name, including the dark stroke baked into the texture. */
  private readonly streetFade = uniform(0)
  private baseUrl = ''
  private readonly segGrid = new Map<string, Seg[]>()
  private readonly signs: THREE.Object3D[] = []
  private readonly shops: { x: number; z: number; wall: number }[] = []
  private readonly signalColor: THREE.InstancedMesh | null = null
  private readonly signalPos: { x: number; z: number }[] = []
  private terrainColors: Float32Array | null = null
  private season: Season = 'summer'
  private readonly canopies: THREE.InstancedMesh[] = []
  private readonly occluders: TreeOccluder[] = []
  private readonly cardMats: THREE.MeshStandardMaterial[] = []
  private segCell = 40
  private readonly poles: { x: number; z: number; r: number }[] = []
  private readonly drivePolys: number[][] = []
  private readonly driveGrid = new Map<string, number[]>()
  private readonly tmpColor = new THREE.Color()
  private trunkGeo = treeTrunk()
  private canopyGeo = clusterCanopy(1)
  private reedGeo = new THREE.ConeGeometry(0.12, 1.05, 4)
  private trunkMat: THREE.Material
  private canopyMat: THREE.Material
  private reedMat: THREE.Material
  private impostorMat: THREE.Material
  private impostorGeo: THREE.BufferGeometry
  private reservoir: THREE.Mesh | null = null
  private reflective: WaterMesh | null = null
  private readonly sunDir = new THREE.Vector3(0.2, 0.8, 0.3)
  private readonly paperMat: THREE.Material
  private readonly battenMat: THREE.Material
  private readonly roofMat: THREE.Material
  private readonly parkMat: THREE.MeshStandardMaterial
  private readonly lineMat: THREE.MeshBasicMaterial
  private readonly walkMat: THREE.MeshStandardMaterial
  private readonly trailMat: THREE.MeshStandardMaterial
  private eraYear = 2026
  private readonly heroesPlaced = new Set<string>()
  readonly townGlassMat: THREE.MeshStandardMaterial
  private eraBits: { obj: THREE.Object3D; startYear: number | null; endYear: number | null }[] = []

  constructor(scene: THREE.Scene, meta: Meta, height: Heightfield, roads: Road[], water: WaterFile, tileset: TileSet, textures: Textures, baseUrl: string) {
    this.meta = meta
    this.height = height
    this.roads = roads
    this.tileset = tileset
    this.baseUrl = baseUrl
    for (const pair of tileset.present) this.present.add(tileKey(pair[0], pair[1]))
    for (const pair of tileset.rich) this.richTiles.add(tileKey(pair[0], pair[1]))
    this.waterLevel = height.waterLevel
    scene.add(this.root)

    this.roadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.02, vertexColors: true })
    this.windowMat = new THREE.MeshStandardMaterial({
      map: textures.wall,
      emissiveMap: textures.windows,
      emissive: 0xffc98a,
      emissiveIntensity: 0,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
    })
    this.storeMat = new THREE.MeshStandardMaterial({
      map: textures.store,
      emissiveMap: textures.windows,
      emissive: 0xffe1b0,
      emissiveIntensity: 0,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
    })
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d2,
      emissive: 0xffc56b,
      emissiveIntensity: 0,
      roughness: 0.35,
    })
    this.paperMat = facadeMaterial(0.9)
    this.battenMat = battenMaterial()
    this.townGlassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffc98a,
      emissiveIntensity: 0,
      roughness: 0.2,
      metalness: 0.15,
      envMapIntensity: 0.15,
      vertexColors: true,
    })
    this.roofMat = facadeMaterial(0.9)
    this.parkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true })
    this.lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    this.walkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true })
    this.trailMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true })
    this.roadMat.polygonOffset = true
    this.roadMat.polygonOffsetFactor = -1
    this.roadMat.polygonOffsetUnits = -1
    this.reedGeo.translate(0, 0.5, 0)
    this.trunkMat = trunkMaterial()
    this.canopyMat = townLeafMaterial()
    this.reedMat = foliageMaterial(0x6a8f45, 0.9, 0.85)
    this.impostorMat = impostorMaterial(textures.oak)
    const card = new THREE.PlaneGeometry(4.4, 5.4)
    card.translate(0, 2.7, 0)
    const crossed = card.clone().rotateY(Math.PI / 2)
    this.impostorGeo = mergeGeometries([card, crossed]) ?? card

    this.indexRoads()
    this.root.add(this.buildTerrain())
    this.root.add(this.buildWater(water))
    this.addLamps()
    this.signalColor = this.addSignals()
    this.addMemorial()
    dressDistricts(this.root, this.height, water, this.roads)
    this.poles.push({ x: 1124, z: 130, r: 1.15 }, { x: 1140, z: 118, r: 1.15 })
    dressTown(this.root, this.roads, this.height, meta.spawn)
    dressFifties(this)
  }

  /**
   * Show a mesh only inside an inclusive year span.
   * Untagged town geometry stays in every era, so Today matches the untimed town.
   */
  tagSpan(obj: THREE.Object3D, startYear: number | null, endYear: number | null): void {
    this.eraBits.push({ obj, startYear, endYear })
    obj.visible = spanVisible({ startYear, endYear }, this.eraYear)
  }

  setEra(year: number): void {
    this.eraYear = year
    this.blockers.setYear(year)
    for (const bit of this.eraBits) bit.obj.visible = spanVisible(bit, year)
  }

  private bartAt(): { x: number; z: number } {
    const place = this.meta.places.find((item) => item.id === 'bart')
    return place ?? { x: 31.9, z: -577.3 }
  }

  private dropEraBits(group: THREE.Object3D): void {
    this.eraBits = this.eraBits.filter((bit) => {
      let parent: THREE.Object3D | null = bit.obj
      while (parent) {
        if (parent === group) return false
        parent = parent.parent
      }
      return true
    })
  }

  /** Pale facade tints. Edit public/data/businesses.json to override a shop. */
  setStorefronts(rows: { lat: number; lon: number; wall: string }[]): void {
    const origin = this.meta.origin
    const mLat = 111320
    const mLon = 111320 * Math.cos((origin.lat * Math.PI) / 180)
    this.shops.length = 0
    for (const row of rows) {
      const wall = Number.parseInt(row.wall.slice(1), 16)
      if (!Number.isFinite(wall)) continue
      this.shops.push({
        x: (row.lon - origin.lon) * mLon,
        z: -(row.lat - origin.lat) * mLat,
        wall,
      })
    }
  }

  private shopWall(x: number, z: number): number | null {
    let best = 22
    let wall: number | null = null
    for (const shop of this.shops) {
      const distance = Math.hypot(shop.x - x, shop.z - z)
      if (distance < best) {
        best = distance
        wall = shop.wall
      }
    }
    return wall
  }

  private indexRoads(): void {
    for (const road of this.roads) {
      const n = road.p.length / 3
      for (let i = 0; i < n - 1; i++) {
        const seg: Seg = {
          ax: road.p[i * 3],
          ay: road.p[i * 3 + 2],
          az: road.p[i * 3 + 1],
          bx: road.p[(i + 1) * 3],
          by: road.p[(i + 1) * 3 + 2],
          bz: road.p[(i + 1) * 3 + 1],
          w: road.w,
          trail: road.d === 1,
          paved: road.d === 0 && road.t !== 'track' && road.t !== 'path',
          name: road.n,
          cls: road.t,
        }
        this.insertSeg(seg)
      }
    }
  }

  private insertSeg(seg: Seg): void {
    const minX = Math.min(seg.ax, seg.bx)
    const maxX = Math.max(seg.ax, seg.bx)
    const minZ = Math.min(seg.az, seg.bz)
    const maxZ = Math.max(seg.az, seg.bz)
    const i0 = Math.floor(minX / this.segCell)
    const i1 = Math.floor(maxX / this.segCell)
    const j0 = Math.floor(minZ / this.segCell)
    const j1 = Math.floor(maxZ / this.segCell)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const id = `${i},${j}`
        let list = this.segGrid.get(id)
        if (!list) {
          list = []
          this.segGrid.set(id, list)
        }
        list.push(seg)
      }
    }
  }

  private segsAt(x: number, z: number): Seg[] {
    return this.segsAround(x, z, 1)
  }

  private segsAround(x: number, z: number, radius: number): Seg[] {
    const i = Math.floor(x / this.segCell)
    const j = Math.floor(z / this.segCell)
    const out: Seg[] = []
    const seen = new Set<Seg>()
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const list = this.segGrid.get(`${i + dx},${j + dz}`)
        if (!list) continue
        for (const seg of list) {
          if (seen.has(seg)) continue
          seen.add(seg)
          out.push(seg)
        }
      }
    }
    return out
  }

  /** Flat floor while a memory portal has moved the walker off the heightfield. */
  memoryFloor: number | null = null

  surface(x: number, z: number, refY: number | null): number {
    if (this.memoryFloor !== null) return this.memoryFloor
    const ground = this.height.sample(x, z)
    let best = ground
    let bestScore = 0
    for (const seg of this.segsAt(x, z)) {
      const abx = seg.bx - seg.ax
      const abz = seg.bz - seg.az
      const ab2 = abx * abx + abz * abz || 1
      let t = ((x - seg.ax) * abx + (z - seg.az) * abz) / ab2
      t = Math.max(0, Math.min(1, t))
      const sx = seg.ax + abx * t
      const sz = seg.az + abz * t
      if (Math.hypot(x - sx, z - sz) > seg.w * 0.5 + 0.3) continue
      const authored = seg.ay + (seg.by - seg.ay) * t
      const y = authored > ground + 6 ? authored : ground + 0.12
      const close = refY == null ? y <= ground + 2.4 : Math.abs(y - refY) < 2.1
      if (close && y > bestScore) {
        bestScore = y
        best = y
      }
    }
    return Math.max(ground, best)
  }

  onPaved(x: number, z: number, y: number): boolean {
    for (const seg of this.segsAt(x, z)) {
      if (!seg.paved) continue
      const abx = seg.bx - seg.ax
      const abz = seg.bz - seg.az
      const ab2 = abx * abx + abz * abz || 1
      let t = ((x - seg.ax) * abx + (z - seg.az) * abz) / ab2
      t = Math.max(0, Math.min(1, t))
      const sx = seg.ax + abx * t
      const sz = seg.az + abz * t
      if (Math.hypot(x - sx, z - sz) > seg.w * 0.55) continue
      const ground = this.height.sample(sx, sz)
      const authored = seg.ay + (seg.by - seg.ay) * t
      const sy = authored > ground + 6 ? authored : ground + 0.12
      if (Math.abs(sy - y) < 2.2) return true
    }
    return false
  }

  /** Closest paved approach, used to keep a house off the asphalt. */
  nearestRoad(x: number, z: number, max = 72): { x: number; z: number; dx: number; dz: number; w: number } | null {
    return this.closestRoad(x, z, max, 2, () => true)
  }

  /**
   * The named residential street a house should face, when the closest
   * pavement is only a driveway. Null when the closest road is already that street.
   */
  frontage(x: number, z: number): { x: number; z: number; dx: number; dz: number; w: number } | null {
    const street = /^(residential|living_street|unclassified|tertiary|secondary)$/
    let any = Infinity
    let anyNamed = false
    let best = 74
    let hit: { x: number; z: number; dx: number; dz: number; w: number } | null = null
    for (const seg of this.segsAround(x, z, 3)) {
      if (seg.trail || seg.w < 2.2) continue
      const d = this.segDistance(x, z, seg)
      if (d == null) continue
      if (d.dist < any) {
        any = d.dist
        anyNamed = seg.name.length > 0 && street.test(seg.cls)
      }
      if (!seg.name || !street.test(seg.cls) || seg.w < 4.8) continue
      if (d.dist < best) {
        best = d.dist
        hit = d.hit
      }
    }
    if (!hit || best > 70) return null
    if (anyNamed && any <= best + 6) return null
    return hit
  }

  private segDistance(
    x: number,
    z: number,
    seg: Seg,
  ): { dist: number; hit: { x: number; z: number; dx: number; dz: number; w: number } } | null {
    const abx = seg.bx - seg.ax
    const abz = seg.bz - seg.az
    const ab2 = abx * abx + abz * abz || 1
    let t = ((x - seg.ax) * abx + (z - seg.az) * abz) / ab2
    t = Math.max(0, Math.min(1, t))
    const sx = seg.ax + abx * t
    const sz = seg.az + abz * t
    return { dist: Math.hypot(x - sx, z - sz), hit: { x: sx, z: sz, dx: abx, dz: abz, w: seg.w } }
  }

  private closestRoad(
    x: number,
    z: number,
    max: number,
    radius: number,
    accept: (seg: Seg) => boolean,
  ): { x: number; z: number; dx: number; dz: number; w: number } | null {
    let best = max
    let hit: { x: number; z: number; dx: number; dz: number; w: number } | null = null
    for (const seg of this.segsAround(x, z, radius)) {
      if (seg.trail || seg.w < 2.2 || !accept(seg)) continue
      const d = this.segDistance(x, z, seg)
      if (!d || d.dist >= best) continue
      best = d.dist
      hit = d.hit
    }
    return hit
  }

  /**
   * Where a map click should put the walker: on the paved centerline, preferring
   * the street they tapped, then slid along it until a house footprint is clear.
   */
  landing(x: number, z: number, name?: string): { x: number; z: number } | null {
    const want = name && name !== 'Selected street' ? name : ''
    const named = want ? this.closestSeg(x, z, 48, (seg) => seg.paved && seg.name === want) : null
    const hit = named ?? this.closestSeg(x, z, 48, (seg) => seg.paved)
    if (!hit) return null
    if (this.roadClear(hit.x, hit.z)) return { x: hit.x, z: hit.z }
    const nameKey = hit.seg.name
    let bestX = hit.x
    let bestZ = hit.z
    let bestD = Infinity
    const pool = this.segsAround(x, z, 2).filter((seg) => seg.paved && !seg.trail && (nameKey ? seg.name === nameKey : seg === hit.seg))
    for (const seg of pool) {
      const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az)
      const steps = Math.max(1, Math.ceil(len / 2))
      for (let i = 0; i <= steps; i++) {
        const u = i / steps
        const sx = seg.ax + (seg.bx - seg.ax) * u
        const sz = seg.az + (seg.bz - seg.az) * u
        if (!this.roadClear(sx, sz)) continue
        const d = Math.hypot(sx - x, sz - z)
        if (d < bestD) {
          bestD = d
          bestX = sx
          bestZ = sz
        }
      }
    }
    if (bestD < 56) return { x: bestX, z: bestZ }
    return { x: hit.x, z: hit.z }
  }

  /** Asphalt, a parking lot, or a house driveway. Grass tufts stay off these. */
  paved(x: number, z: number): boolean {
    if (this.height.flag(x, z) & (F_ROAD | F_PARKING)) return true
    if (this.onDrive(x, z)) return true
    const road = this.nearestRoad(x, z, 14)
    return !!road && Math.hypot(road.x - x, road.z - z) <= road.w * 0.5 + 1.6
  }

  noteDrives(polys: number[][]): void {
    for (const poly of polys) {
      if (poly.length < 6) continue
      const index = this.drivePolys.length
      this.drivePolys.push(poly)
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
      const i0 = Math.floor(minX / 24)
      const i1 = Math.floor(maxX / 24)
      const j0 = Math.floor(minZ / 24)
      const j1 = Math.floor(maxZ / 24)
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const id = `${i},${j}`
          let list = this.driveGrid.get(id)
          if (!list) {
            list = []
            this.driveGrid.set(id, list)
          }
          list.push(index)
        }
      }
    }
  }

  private onDrive(x: number, z: number): boolean {
    const list = this.driveGrid.get(`${Math.floor(x / 24)},${Math.floor(z / 24)}`)
    if (!list) return false
    for (const index of list) {
      if (pointInPoly(x, z, this.drivePolys[index])) return true
    }
    return false
  }

  private roadClear(x: number, z: number): boolean {
    if (this.blockers.roofAt(x, z) != null) return false
    const pushed = this.blockers.resolve(x, z, 0.45)
    return Math.hypot(pushed.x - x, pushed.z - z) < 0.2
  }

  private closestSeg(
    x: number,
    z: number,
    max: number,
    accept: (seg: Seg) => boolean,
  ): { seg: Seg; t: number; x: number; z: number } | null {
    let best = max
    let hit: { seg: Seg; t: number; x: number; z: number } | null = null
    for (const seg of this.segsAround(x, z, 2)) {
      if (seg.trail || seg.w < 2.2 || !accept(seg)) continue
      const abx = seg.bx - seg.ax
      const abz = seg.bz - seg.az
      const ab2 = abx * abx + abz * abz || 1
      let t = ((x - seg.ax) * abx + (z - seg.az) * abz) / ab2
      t = Math.max(0, Math.min(1, t))
      const sx = seg.ax + abx * t
      const sz = seg.az + abz * t
      const dist = Math.hypot(x - sx, z - sz)
      if (dist >= best) continue
      best = dist
      hit = { seg, t, x: sx, z: sz }
    }
    return hit
  }

  /**
   * A heading along the nearest street. Prefers the way whose chase camera
   * stays out of a building, then the caller's preferred direction.
   */
  streetHeading(x: number, z: number, prefer = 0): number {
    const road = this.nearestRoad(x, z, 40)
    if (!road) return prefer
    const len = Math.hypot(road.dx, road.dz) || 1
    const h1 = headingFromForward(road.dx / len, road.dz / len)
    const h2 = headingFromForward(-road.dx / len, -road.dz / len)
    const score = (h: number) => {
      const f = forwardFromHeading(h)
      let s = 0
      for (const dist of [3, 7, 12, 18]) {
        const blocked = this.blockers.roofAt(x + f.x * dist, z + f.z * dist) != null
        if (!blocked) s += dist < 8 ? 5 : 1
        else if (dist <= 7) s -= 8
      }
      if (this.blockers.roofAt(x - f.x * 11, z - f.z * 11) == null) s += 3
      else s -= 4
      return s
    }
    const s1 = score(h1)
    const s2 = score(h2)
    if (Math.abs(s1 - s2) <= 2) {
      return Math.abs(wrapAngle(h1 - prefer)) <= Math.abs(wrapAngle(h2 - prefer)) ? h1 : h2
    }
    return s1 > s2 ? h1 : h2
  }

  roadName(x: number, z: number): string {
    let best = 28
    let name = ''
    for (const seg of this.segsAt(x, z)) {
      if (!seg.name) continue
      const abx = seg.bx - seg.ax
      const abz = seg.bz - seg.az
      const ab2 = abx * abx + abz * abz || 1
      let t = ((x - seg.ax) * abx + (z - seg.az) * abz) / ab2
      t = Math.max(0, Math.min(1, t))
      const d = Math.hypot(x - (seg.ax + abx * t), z - (seg.az + abz * t))
      if (d < best) {
        best = d
        name = seg.name
      }
    }
    return name
  }

  isDeep(x: number, z: number): boolean {
    if (this.memoryFloor !== null) return false
    return (this.height.flag(x, z) & F_WATER) !== 0 && this.height.sample(x, z) < this.waterLevel - 0.6
  }

  setSun(dir: THREE.Vector3): void {
    this.sunDir.copy(dir)
    if (this.reflective) this.reflective.sunDirection.value.copy(dir)
  }

  useReflections(normals: THREE.Texture, scale: number): void {
    const mesh = this.reservoir
    if (!mesh) return
    if (this.reflective) {
      this.reflective.resolutionScale = scale
      return
    }
    const water = new WaterMesh(mesh.geometry, {
      waterNormals: normals,
      sunColor: 0xfff1dd,
      waterColor: 0x176e78,
      distortionScale: 2.4,
      alpha: 0.94,
      size: 0.35,
      sunDirection: this.sunDir,
    })
    water.position.copy(mesh.position)
    water.resolutionScale = scale
    mesh.parent?.add(water)
    mesh.removeFromParent()
    this.reflective = water
  }

  /** Drop the reservoir reflector and put the flat water mesh back. */
  clearReflections(): void {
    const water = this.reflective
    const mesh = this.reservoir
    if (!water || !mesh) return
    water.parent?.add(mesh)
    mesh.position.copy(water.position)
    water.removeFromParent()
    const material = water.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
    this.reflective = null
  }

  /** True when the tile under this point is already built, or there is no tile to build. */
  resident(x: number, z: number): boolean {
    const [tx, tz] = tileOf(x, z, this.tileset.originX, this.tileset.originZ, this.tileset.tileMeters)
    const key = tileKey(tx, tz)
    return this.built.has(key) || this.empty.has(key)
  }

  placeName(x: number, z: number): string {
    let best = 220 * 220
    let name = ''
    for (const p of this.meta.places) {
      if (this.eraYear < 1973 && p.id === 'bart') continue
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < best) {
        best = d
        name = p.name
      }
    }
    if (best < 180 * 180) return name
    const road = this.roadName(x, z)
    if (road) return road
    if (this.height.sample(x, z) > this.waterLevel + 40) return 'The hills'
    return 'Lafayette'
  }

  setSeason(season: Season): void {
    this.season = season
    const mesh = this.root.getObjectByName('terrain') as THREE.Mesh | undefined
    const attr = mesh?.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!attr || !this.terrainColors) return
    this.paint(this.terrainColors, season)
    attr.needsUpdate = true
    for (const canopy of this.canopies) this.paintCanopy(canopy)
    const tintHex = season === 'summer' ? 0xc6b15a : season === 'spring' ? 0x9ed07a : 0x6aaa78
    ;(this.impostorMat as THREE.MeshStandardMaterial).color.setHex(tintHex)
    for (const cards of this.cardMats) cards.color.setHex(tintHex)
  }

  /** Fetch and build the tiles around a point before the first frame. */
  async preload(x: number, z: number, radius = 2): Promise<void> {
    const jobs: Promise<void>[] = []
    this.forTiles(x, z, radius, (key, tx, tz) => {
      if (this.built.has(key) || this.empty.has(key) || this.inflight.has(key)) return
      jobs.push(this.fetchTile(tx, tz, key))
    })
    await Promise.all(jobs)
    while (this.ready.length) {
      const item = this.ready.shift()
      if (item && !this.built.has(item.key)) this.buildVectorTile(item.key, item.tile)
    }
  }

  /** Pull the chase rig in before a lamp or signal fills the lens. */
  clipPoles(fromX: number, fromZ: number, toX: number, toZ: number): number {
    let best = 1
    const dx = toX - fromX
    const dz = toZ - fromZ
    const len2 = dx * dx + dz * dz
    if (len2 < 0.25) return 1
    for (const pole of this.poles) {
      if (Math.abs(pole.x - fromX) > 20 && Math.abs(pole.x - toX) > 20) continue
      if (Math.abs(pole.z - fromZ) > 20 && Math.abs(pole.z - toZ) > 20) continue
      const u = ((pole.x - fromX) * dx + (pole.z - fromZ) * dz) / len2
      if (u < 0.05 || u > 1.02) continue
      const d = Math.hypot(pole.x - (fromX + dx * u), pole.z - (fromZ + dz * u))
      if (d < pole.r && u < best) best = Math.max(0.18, u - 0.16)
    }
    return best
  }

  /** Last step of the rig: never render from inside a wall or a pole. */
  escapeRig(x: number, y: number, z: number): { x: number; y: number; z: number } {
    let px = x
    let pz = z
    const out = this.blockers.resolve(px, pz, 0.65, y)
    px = out.x
    pz = out.z
    const keep = (cx: number, cz: number, rad: number) => {
      const dx = px - cx
      const dz = pz - cz
      const d = Math.hypot(dx, dz)
      if (d >= rad) return
      if (d < 1e-4) {
        px += rad
        return
      }
      px = cx + (dx / d) * rad
      pz = cz + (dz / d) * rad
    }
    for (let n = 0; n < 2; n++) {
      for (const pole of this.poles) {
        if (Math.abs(pole.x - px) > pole.r + 2 || Math.abs(pole.z - pz) > pole.r + 2) continue
        keep(pole.x, pole.z, pole.r)
      }
      if (y < this.height.sample(px, pz) + 8) {
        for (const tree of this.occluders) {
          if (Math.abs(tree.x - px) > 4 || Math.abs(tree.z - pz) > 4) continue
          if (y > tree.y + 4.8) continue
          keep(tree.x, tree.z, tree.trunkR + 0.9)
        }
      }
    }
    const floor = this.height.sample(px, pz) + 0.55
    return { x: px, y: y < floor ? floor : y, z: pz }
  }

  /** Pull the chase rig in before a trunk crosses the line to the player. */
  clipTrees(fromX: number, fromZ: number, toX: number, toZ: number): number {
    let best = 1
    const dx = toX - fromX
    const dz = toZ - fromZ
    const len2 = dx * dx + dz * dz
    if (len2 < 0.25) return 1
    for (const tree of this.occluders) {
      if (Math.abs(tree.x - fromX) > 24 && Math.abs(tree.x - toX) > 24) continue
      if (Math.abs(tree.z - fromZ) > 24 && Math.abs(tree.z - toZ) > 24) continue
      const u = ((tree.x - fromX) * dx + (tree.z - fromZ) * dz) / len2
      if (u < 0.08 || u > 0.98) continue
      const d = Math.hypot(tree.x - (fromX + dx * u), tree.z - (fromZ + dz * u))
      if (d < tree.trunkR + 0.9 && u < best) best = Math.max(0.15, u - 0.12)
    }
    return best
  }

  /** Crowns and trunks on the camera-to-player segment fade out instead of blocking the street. */
  fadeOccluders(cx: number, cy: number, cz: number, px: number, pz: number): void {
    const dx = px - cx
    const dz = pz - cz
    const len2 = dx * dx + dz * dz || 1
    for (const tree of this.occluders) {
      if (Math.hypot(tree.x - cx, tree.z - cz) > 22) {
        if (tree.fade > 0.98) continue
        tree.fade = 1
      } else {
        const u = Math.max(0, Math.min(1, ((tree.x - cx) * dx + (tree.z - cz) * dz) / len2))
        const d = Math.hypot(tree.x - (cx + dx * u), tree.z - (cz + dz * u))
        const canopy = d < tree.canopyR * 0.85 && cy > tree.y + 1.4 && cy < tree.canopyY + tree.canopyR
        const trunk = d < tree.trunkR + 0.75
        const target = canopy || trunk ? 0.04 : 1
        tree.fade += (target - tree.fade) * 0.55
      }
      tree.trunkFade.setX(tree.index, tree.fade)
      tree.canopyFade.setX(tree.index, tree.fade)
      tree.trunkFade.needsUpdate = true
      tree.canopyFade.needsUpdate = true
    }
  }

  private noteTree(
    group: THREE.Group,
    x: number,
    z: number,
    y: number,
    trunkR: number,
    canopyR: number,
    canopyY: number,
    index: number,
    trunkFade: THREE.InstancedBufferAttribute,
    canopyFade: THREE.InstancedBufferAttribute,
  ): void {
    const list = (group.userData.occluders ??= []) as TreeOccluder[]
    const item = { x, z, y, trunkR, canopyR, canopyY, index, trunkFade, canopyFade, fade: 1 }
    list.push(item)
    this.occluders.push(item)
  }

  private fadeBuffer(geo: THREE.BufferGeometry, count: number): THREE.InstancedBufferAttribute {
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    geo.setAttribute('fade', fade)
    return fade
  }

  update(x: number, z: number, airborne: boolean, camera: THREE.Camera, time: number): void {
    const radius = airborne ? 3 : 2
    this.forTiles(x, z, radius, (key, tx, tz) => {
      if (this.built.has(key) || this.empty.has(key) || this.inflight.has(key)) return
      void this.fetchTile(tx, tz, key)
    })
    let budget = 2
    while (budget > 0 && this.ready.length) {
      const item = this.ready.shift()
      if (!item || this.built.has(item.key)) continue
      this.buildVectorTile(item.key, item.tile)
      budget -= 1
    }
    const [cx, cz] = tileOf(x, z, this.tileset.originX, this.tileset.originZ, this.tileset.tileMeters)
    for (const [key, group] of this.built) {
      const [ix, iz] = key.split(',').map(Number)
      const lod = group.userData.lod as
        | { detail: THREE.Object3D[]; far: THREE.Object3D; mat?: THREE.MeshStandardMaterial }
        | undefined
      if (lod) {
        lod.far.visible = false
        for (const mesh of lod.detail) mesh.visible = true
      }
      if (Math.abs(ix - cx) > radius + 1 || Math.abs(iz - cz) > radius + 1) this.unloadTile(key, group)
    }
    const camX = camera.position.x
    const camZ = camera.position.z
    const ranked = this.labels.map((sprite) => ({
      sprite,
      dist: Math.hypot(sprite.position.x - camX, sprite.position.z - camZ),
      kind: sprite.userData.label as string,
    }))
    ranked.sort((a, b) => a.dist - b.dist)
    const shown = { poi: 0, street: 0, pin: 0, place: 0 }
    const cap = { poi: 12, street: 7, pin: 16, place: 4 }
    for (const item of ranked) {
      const kind = item.kind === 'poi' || item.kind === 'street' || item.kind === 'pin' || item.kind === 'place' ? item.kind : 'poi'
      const far = kind === 'place' ? 1400 : kind === 'street' ? 520 : kind === 'pin' ? 280 : 260
      const near = kind === 'place' ? 28 : kind === 'pin' ? 18 : 8
      let visible = item.dist > near && item.dist < far
      if (visible && shown[kind] >= cap[kind]) visible = false
      if (visible) shown[kind] += 1
      item.sprite.visible = visible
      const base = item.sprite.userData.base as number | undefined
      if (base && visible) {
        const pop = item.kind === 'place' || item.sprite.userData.landmark ? THREE.MathUtils.smoothstep(item.dist, 90, 22) : THREE.MathUtils.smoothstep(item.dist, 40, 18)
        const s = base * (1 + pop * 0.22)
        item.sprite.scale.set(s, s, 1)
      }
    }
    for (const sign of this.signs) {
      sign.rotation.y = Math.atan2(camera.position.x - sign.position.x, camera.position.z - sign.position.z)
    }
    if (this.signalColor?.instanceColor) {
      for (let i = 0; i < this.signalPos.length; i++) {
        const p = this.signalPos[i]
        this.tmpColor.setHex(signalGreen(p.x, p.z, time) ? 0x3ddc6e : 0xe23b3b)
        this.signalColor.setColorAt(i, this.tmpColor)
      }
      this.signalColor.instanceColor.needsUpdate = true
    }
  }

  private forTiles(x: number, z: number, radius: number, visit: (key: string, tx: number, tz: number) => void): void {
    const [cx, cz] = tileOf(x, z, this.tileset.originX, this.tileset.originZ, this.tileset.tileMeters)
    for (let tz = cz - radius; tz <= cz + radius; tz++) {
      for (let tx = cx - radius; tx <= cx + radius; tx++) visit(tileKey(tx, tz), tx, tz)
    }
  }

  private async fetchTile(tx: number, tz: number, key: string): Promise<void> {
    if (!this.present.has(key)) {
      this.empty.add(key)
      return
    }
    if (this.inflight.has(key) || this.built.has(key) || this.empty.has(key)) return
    const wait = this.retryAt.get(key) ?? 0
    if (wait > performance.now()) return
    this.inflight.add(key)
    try {
      const res = await fetch(`${this.baseUrl}data/tiles/${this.tileset.zoom}/${tx}/${tz}.json`)
      if (!res.ok) throw new Error(String(res.status))
      this.ready.push({ key, tile: (await res.json()) as VectorTile })
      this.fails.delete(key)
      this.retryAt.delete(key)
    } catch (err) {
      const n = (this.fails.get(key) ?? 0) + 1
      this.fails.set(key, n)
      if (n >= 3) {
        console.warn('tile', key, err)
        this.empty.add(key)
      } else this.retryAt.set(key, performance.now() + 350 * n)
    } finally {
      this.inflight.delete(key)
    }
  }

  private unloadTile(key: string, group: THREE.Group): void {
    this.dropEraBits(group)
    const drop = new Set<THREE.Object3D>()
    group.traverse((obj) => {
      if (obj.userData.label) drop.add(obj)
    })
    if (drop.size) this.labels.splice(0, this.labels.length, ...this.labels.filter((sprite) => !drop.has(sprite)))
    const lod = group.userData.lod as { mat?: THREE.Material } | undefined
    if (lod?.mat) {
      lod.mat.dispose()
      const mats = this.cardMats
      const at = mats.indexOf(lod.mat as THREE.MeshStandardMaterial)
      if (at >= 0) mats.splice(at, 1)
    }
    this.blockers.clear(key)
    this.streetNames.splice(
      0,
      this.streetNames.length,
      ...this.streetNames.filter((mesh) => {
        let parent: THREE.Object3D | null = mesh
        while (parent) {
          if (parent === group) return false
          parent = parent.parent
        }
        return true
      }),
    )
    const owned = group.userData.occluders as TreeOccluder[] | undefined
    if (owned?.length) {
      const drop = new Set(owned)
      this.occluders.splice(0, this.occluders.length, ...this.occluders.filter((item) => !drop.has(item)))
    }
    group.removeFromParent()
    this.canopies.splice(
      0,
      this.canopies.length,
      ...this.canopies.filter((mesh) => {
        let parent: THREE.Object3D | null = mesh
        while (parent) {
          if (parent === group) return false
          parent = parent.parent
        }
        return true
      }),
    )
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.userData.unique) mesh.geometry?.dispose()
      if (mesh.userData.label && mesh.material) {
        const mat = mesh.material as THREE.Material
        mat.dispose()
      }
    })
    this.built.delete(key)
  }

  private buildTerrain(): THREE.Mesh {
    const h = this.height
    const step = 1
    const cols = Math.floor((h.cols - 1) / step) + 1
    const rows = Math.floor((h.rows - 1) / step) + 1
    const positions = new Float32Array(cols * rows * 3)
    const colors = new Float32Array(cols * rows * 3)
    this.terrainColors = colors
    let k = 0
    for (let j = 0; j < rows; j++) {
      const jj = Math.min(h.rows - 1, j * step)
      const z = h.originZ + (jj / (h.rows - 1)) * h.sizeZ
      for (let i = 0; i < cols; i++) {
        const ii = Math.min(h.cols - 1, i * step)
        const x = h.originX + (ii / (h.cols - 1)) * h.sizeX
        positions[k++] = x
        positions[k++] = h.heights[jj * h.cols + ii]
        positions[k++] = z
      }
    }
    this.paint(colors, this.season)
    const indices: number[] = []
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i
        const b = a + 1
        const c = a + cols
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    const normals = geo.getAttribute('normal')
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (inDowntown(pos.getX(i), pos.getZ(i))) normals.setXYZ(i, 0, 1, 0)
    }
    const mat = hillMaterial()
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'terrain'
    mesh.receiveShadow = true
    return mesh
  }

  private paint(colors: Float32Array, season: Season): void {
    const h = this.height
    const step = 1
    const cols = Math.floor((h.cols - 1) / step) + 1
    const rows = Math.floor((h.rows - 1) / step) + 1
    const c = new THREE.Color()
    const hillShadow = new THREE.Color(0x9c7f4c)
    const lawn = (n: number, winter: number, spring: number) => {
      if (season === 'winter') return n > 0.86 ? 0xc4b07a : winter
      if (season === 'spring') return n > 0.86 ? 0xc4b07a : spring
      if (n > 0.88) return 0xc4b07a
      return n > 0.5 ? 0x6e8a46 : 0x7d9a52
    }
    let k = 0
    for (let j = 0; j < rows; j++) {
      const jj = Math.min(h.rows - 1, j * step)
      for (let i = 0; i < cols; i++) {
        const ii = Math.min(h.cols - 1, i * step)
        const idx = jj * h.cols + ii
        const elev = h.heights[idx]
        const f = h.flags[idx]
        const n = hash01(ii * 13 + jj * 9)
        const x = h.originX + (ii / (h.cols - 1)) * h.sizeX
        const z = h.originZ + (jj / (h.rows - 1)) * h.sizeZ
        let hex = season === 'winter' ? 0x7f9a5a : season === 'spring' ? 0x8aa35c : 0xc9a86a
        let vary = 0.97 + n * 0.06
        if (inDowntown(x, z) && (f & F_WATER) === 0) {
          // One flat fill. Road and lot meshes carry the asphalt, so a building
          // cell does not pick up a lawn-green or road-black neighbour.
          const nearBuilding = this.buildingNear(ii, jj)
          hex = (f & F_PARK) && (f & F_BUILDING) === 0 && !nearBuilding ? 0x7d9a52 : 0xd9d0c2
          vary = 1
        } else if (f & F_WATER) hex = 0x8a7a58
        else if (f & F_ROAD) hex = 0x454c58
        else if (f & F_PARK) hex = lawn(n, 0x6d8a48, 0x6f9a48)
        else if (f & F_WOOD) hex = season === 'summer' ? 0x6a8a3c : 0x2f6a38
        else if (f & F_URBAN) {
          const n2 = hash01(ii * 3 + jj * 17)
          hex = n2 > 0.9 ? 0x6e8a46 : n2 > 0.78 ? 0x7d9a52 : n2 > 0.46 ? 0xd4c8a4 : 0xe4dcc8
        }
        else if (elev < h.waterLevel + 18) hex = lawn(n, 0x6d8a48, 0x6f9a48)
        if (!inDowntown(x, z) && season === 'spring' && n > 0.86 && (f & (F_ROAD | F_URBAN | F_WATER)) === 0) hex = n > 0.93 ? 0xe7a0b8 : 0xf2d36b
        c.setHex(hex)
        let shade = this.vertexShade(ii, jj, f)
        if ((hex === 0xc9a86a || hex === 0x7f9a5a || hex === 0x8aa35c) && shade < 0.86) {
          c.lerp(hillShadow, 0.28)
          shade = 1
        }
        colors[k++] = c.r * vary * shade
        colors[k++] = c.g * vary * shade
        colors[k++] = c.b * vary * shade
      }
    }
  }

  private buildWater(water: WaterFile): THREE.Group {
    const group = new THREE.Group()
    for (const body of water.bodies) {
      const shape = new THREE.Shape()
      const n = body.p.length / 2
      if (n < 3) continue
      let cx = 0
      let cz = 0
      shape.moveTo(body.p[0], body.p[1])
      for (let i = 0; i < n; i++) {
        const x = body.p[i * 2]
        const z = body.p[i * 2 + 1]
        cx += x
        cz += z
        if (i > 0) shape.lineTo(x, z)
      }
      cx /= n
      cz /= n
      let radius = 8
      for (let i = 0; i < n; i++) radius = Math.max(radius, Math.hypot(body.p[i * 2] - cx, body.p[i * 2 + 1] - cz))
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(Math.PI / 2)
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x1c7c86,
        roughness: 0.18,
        metalness: 0.06,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
      const center = new THREE.Vector2(cx, cz)
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = shared.time
        shader.uniforms.uCenter = { value: center }
        shader.uniforms.uRadius = { value: radius }
        shader.vertexShader =
          'uniform float uTime;\nvarying vec3 vWorldPos;\n' +
          shader.vertexShader
            .replace(
              '#include <begin_vertex>',
              `vec3 transformed = vec3( position );
               transformed.y += sin(position.x * 0.07 + uTime * 1.2) * sin(position.z * 0.06 + uTime * 0.8) * 0.08;`,
            )
            .replace('#include <project_vertex>', '#include <project_vertex>\n vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        shader.fragmentShader =
          'uniform float uTime;\nuniform vec2 uCenter;\nuniform float uRadius;\nvarying vec3 vWorldPos;\n' +
          shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `float inland = uRadius - length(vWorldPos.xz - uCenter);
             float shallows = smoothstep(26.0, 1.5, inland);
             float foamBand = shallows * (0.42 + 0.58 * smoothstep(0.35, 0.85, sin(vWorldPos.x * 0.35 + vWorldPos.z * 0.28 - uTime * 1.6)));
             outgoingLight = mix(outgoingLight, vec3(0.62, 0.86, 0.84), shallows * 0.72);
             outgoingLight = mix(outgoingLight, vec3(0.96, 0.98, 0.97), foamBand * 0.85);
             diffuseColor.a = mix(0.94, 0.58, shallows);
             #include <opaque_fragment>`,
          )
      }
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.y = (body.level || this.waterLevel) + 0.12
      mesh.userData.unique = true
      if (!this.reservoir || body.p.length > ((this.reservoir.userData.span as number) || 0)) {
        mesh.userData.span = body.p.length
        this.reservoir = mesh
      }
      group.add(mesh)
    }
    const creeks = new MeshBuilder()
    const creekColor = new THREE.Color(0x3d8f98)
    for (const creek of water.creeks) {
      const pts: { x: number; y: number; z: number }[] = []
      const n = creek.p.length / 2
      for (let i = 0; i < n; i++) {
        const x = creek.p[i * 2]
        const z = creek.p[i * 2 + 1]
        pts.push({ x, y: this.height.sample(x, z) + 0.18, z })
      }
      appendRibbon(creeks, pts, 2.3, creekColor, 0)
    }
    const cg = creeks.geometry()
    if (cg) {
      const mesh = new THREE.Mesh(
        cg,
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05, vertexColors: true }),
      )
      mesh.userData.unique = true
      group.add(mesh)
    }
    return group
  }

  private addLamps(): void {
    const poles: number[] = []
    for (const road of this.roads) {
      if (!road.s || road.b > 0) continue
      const n = road.p.length / 3
      let carry = 12
      for (let i = 0; i < n - 1 && poles.length < 1400; i++) {
        const ax = road.p[i * 3]
        const az = road.p[i * 3 + 1]
        const bx = road.p[(i + 1) * 3]
        const bz = road.p[(i + 1) * 3 + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 1) continue
        const dx = (bx - ax) / len
        const dz = (bz - az) / len
        const off = road.w * 0.5 + 1.5
        let d = carry
        while (d < len && poles.length < 1400) {
          const x = ax + dx * d
          const z = az + dz * d
          const side = hash01((x * 10) | 0) > 0.5 ? 1 : -1
          const px = x - dz * off * side
          const pz = z + dx * off * side
          poles.push(px, pz)
          this.poles.push({ x: px, z: pz, r: 1.15 })
          d += 32
        }
        carry = d - len
      }
    }
    const count = poles.length / 2
    if (!count) return
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 5.2, 5)
    poleGeo.translate(0, 2.6, 0)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.7 })
    const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, count)
    const bulbGeo = new THREE.SphereGeometry(0.16, 8, 6)
    const bulbMesh = new THREE.InstancedMesh(bulbGeo, this.lampMat, count)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const x = poles[i * 2]
      const z = poles[i * 2 + 1]
      const y = this.height.sample(x, z)
      dummy.position.set(x, y, z)
      dummy.scale.set(1, 1, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      poleMesh.setMatrixAt(i, dummy.matrix)
      dummy.position.set(x, y + 5.15, z)
      dummy.updateMatrix()
      bulbMesh.setMatrixAt(i, dummy.matrix)
    }
    poleMesh.castShadow = false
    this.root.add(poleMesh, bulbMesh)
  }

  private addSignals(): THREE.InstancedMesh | null {
    const list = this.meta.signals
    if (!list.length) return null
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 4.4, 5)
    poleGeo.translate(0, 2.2, 0)
    const headGeo = new THREE.BoxGeometry(0.28, 0.7, 0.22)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6 })
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, list.length)
    const heads = new THREE.InstancedMesh(headGeo, headMat, list.length)
    heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      const y = this.surface(s.x, s.z, null)
      dummy.position.set(s.x, y, s.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)
      this.poles.push({ x: s.x, z: s.z, r: 1.2 })
      dummy.position.set(s.x, y + 4.3, s.z)
      dummy.updateMatrix()
      heads.setMatrixAt(i, dummy.matrix)
      this.signalPos.push(s)
    }
    this.root.add(poles, heads)
    return heads
  }


  private addMemorial(): void {
    const m = this.meta.memorial
    const count = 64
    const upright = new THREE.BoxGeometry(0.1, 1.15, 0.05)
    upright.translate(0, 0.7, 0)
    const arm = new THREE.BoxGeometry(0.58, 0.08, 0.05)
    arm.translate(0, 0.95, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 })
    const a = new THREE.InstancedMesh(upright, mat, count)
    const b = new THREE.InstancedMesh(arm, mat, count)
    const dummy = new THREE.Object3D()
    const along = new THREE.Vector2(0.964, -0.264)
    const north = new THREE.Vector2(-0.264, -0.964)
    const curb = new THREE.Vector2(m.x, -746)
    let n = 0
    for (let row = 0; row < 8 && n < count; row++) {
      for (let col = -4; col < 4 && n < count; col++) {
        const x = curb.x + along.x * col * 6.5 + north.x * (6 + row * 7.2)
        const z = curb.y + along.y * col * 6.5 + north.y * (6 + row * 7.2)
        if (this.height.flag(x, z) & (F_ROAD | F_WATER)) continue
        const y = this.height.sample(x, z)
        dummy.position.set(x, y, z)
        dummy.rotation.set(0, hash01(n * 3) * 0.4, 0)
        dummy.scale.set(1, 0.8 + hash01(n * 5) * 0.45, 1)
        dummy.updateMatrix()
        a.setMatrixAt(n, dummy.matrix)
        b.setMatrixAt(n, dummy.matrix)
        n++
      }
    }
    a.count = n
    b.count = n
    this.root.add(a, b)
    const tex = makeSignTexture('Remember')
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.85), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
    const sx = curb.x + north.x * 4
    const sz = curb.y + north.y * 4
    sign.position.set(sx, this.height.sample(sx, sz) + 1.7, sz)
    sign.lookAt(sx, sign.position.y, sz + 8)
    this.root.add(sign)
    this.signs.push(sign)
  }

  private buildVectorTile(key: string, data: VectorTile): void {
    const [tx, tz] = key.split(',').map(Number)
    const group = new THREE.Group()
    group.name = key
    const meters = this.tileset.tileMeters
    group.userData.center = {
      x: this.tileset.originX + (tx + 0.5) * meters,
      z: this.tileset.originZ + (tz + 0.5) * meters,
    }
    const rich = this.richTiles.has(key)
    const walls = new MeshBuilder()
    const shops = new MeshBuilder()
    const paper = new MeshBuilder()
    const battens = new MeshBuilder()
    const roofs = new MeshBuilder()
    const bartWalls = new MeshBuilder()
    const bartShops = new MeshBuilder()
    const bartPaper = new MeshBuilder()
    const bartBattens = new MeshBuilder()
    const bartRoofs = new MeshBuilder()
    const glass = new MeshBuilder()
    const awnings = new MeshBuilder()
    const blvdTrees: BlvdTree[] = []
    const bart = this.bartAt()
    const homes: number[][] = []
    const heroBest = new Map<HeroId, number>()
    for (const raw of data.building ?? []) {
      const spot = this.buildingSpot(raw)
      if (spot) noteHero(spot.name, spot.sx, spot.sz, heroBest)
    }
    for (const raw of data.building ?? []) {
      if (!Array.isArray(raw) || raw.length < 9) continue
      const height = Number(raw[0])
      const kind = String(raw[1])
      const name = String(raw[2] ?? '')
      // New tiles store roof shape and OSM colours before the footprint.
      // Older tiles start the footprint at index 3.
      let roofShape = ''
      let wallHex: number | null = null
      let roofHex: number | null = null
      let polyAt = 3
      if (typeof raw[3] === 'string') {
        roofShape = raw[3]
        wallHex = parseOsmColor(String(raw[4] ?? ''))
        roofHex = parseOsmColor(String(raw[5] ?? ''))
        polyAt = 6
      }
      const poly: number[] = []
      for (let i = polyAt; i < raw.length; i++) poly.push(Number(raw[i]))
      if (poly.length < 6 || !Number.isFinite(height)) continue
      let sx = 0
      let sz = 0
      const n = poly.length / 2
      for (let i = 0; i < n; i++) {
        sx += poly[i * 2]
        sz += poly[i * 2 + 1]
      }
      sx /= n
      sz /= n
      // Lafayette Station opened May 21, 1973. Hide that block before then.
      const later = Math.hypot(sx - bart.x, sz - bart.z) < 90
      let facade = facadeFor(sx, sz, name, (sx * 10 + sz) | 0, heroBest)
      const dress = schoolDress(name, sx, sz, footprintSize(poly), height)
      if (dress?.rows) {
        addClassroomRows(paper, later ? bartRoofs : roofs, poly, (x, z) => this.height.sample(x, z))
        this.blockers.add(key, poly, this.roofOf(poly, dress.height), null)
        continue
      }
      if (facade && inDowntown(sx, sz) && !later && facade.stories > 2) facade = { ...facade, stories: 2 }
      let builtHeight = facade ? storyHeight(facade.stories) : height
      if (inDowntown(sx, sz) && !later) builtHeight = Math.min(builtHeight, storyHeight(2))
      else if (later) builtHeight = Math.min(16, Math.max(builtHeight, height))
      let wallPaint = facade ? facade.wall : wallHex
      let roofPaint = facade ? facade.roof : roofHex
      if (dress) {
        builtHeight = dress.height
        wallPaint = dress.wall
        roofPaint = dress.roof
      }
      // Neighbourhood footprints become house lots. A 60 m OSM shell is a row of homes, not one wall.
      const home = !inDowntown(sx, sz) && !later && !dress
      if (home) {
        homes.push(poly)
        continue
      }
      const roofWanted = facade?.hero === 'pioneer' || (facade && !facade.hero && hash01((sx * 4) | 0) > 0.78) ? roofShape || 'gabled' : roofShape
      this.blockers.add(key, poly, this.roofOf(poly, builtHeight), later ? 1973 : null)
      const shop = kind === 'c' || kind === 's' || (name.length > 2 && height > 4)
      let target = home || dress ? paper : facade ? (later ? bartPaper : paper) : later ? (rich ? (shop ? bartShops : bartWalls) : bartPaper) : rich ? (shop ? shops : walls) : paper
      if (wallPaint === BATTEN_HEX) target = later ? bartBattens : battens
      this.extrude(poly, builtHeight, kind, target, later ? bartRoofs : roofs, rich, roofWanted, wallPaint, roofPaint, facade)
      let minY = Infinity
      for (let i = 0; i < n; i++) {
        const sample = this.height.sample(poly[i * 2], poly[i * 2 + 1])
        if (sample < minY) minY = sample
      }
      punchFacade(glass, awnings, poly, minY - 0.2, builtHeight, facade?.awning ?? 0)
      if (facade?.hero && !this.heroesPlaced.has(facade.hero)) {
        this.heroesPlaced.add(facade.hero)
        addHeroAccent(group, facade.hero, sx, sz, this.height.sample(sx, sz))
      }
    }
    if (homes.length) {
      const placed = addHouseLots(
        group,
        homes,
        (x, z) => this.height.sample(x, z),
        (x, z) => this.nearestRoad(x, z),
        {
          trunkGeo: this.trunkGeo,
          canopyGeo: this.canopyGeo,
          trunkMat: this.trunkMat,
          canopyMat: this.canopyMat,
        },
        (x, z) => this.frontage(x, z) ?? this.nearestRoad(x, z),
      )
      if (placed) {
        for (const block of placed.blocks) this.blockers.add(key, block.poly, block.roof, null)
        for (const tree of placed.trees) {
          this.noteTree(group, tree.x, tree.z, tree.y, tree.trunkR, tree.canopyR, tree.canopyY, tree.index, placed.trunkFade, placed.canopyFade)
        }
        if (placed.canopy) this.canopies.push(placed.canopy)
        if (placed.driveways.length) this.noteDrives(placed.driveways)
      }
    }
    this.addMesh(group, walls, this.windowMat, true)
    this.addMesh(group, shops, this.storeMat, true)
    this.addMesh(group, paper, this.paperMat, true)
    this.addMesh(group, battens, this.battenMat, true)
    this.addMesh(group, roofs, this.roofMat, true)
    this.addMesh(group, glass, this.townGlassMat, false)
    const awningMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, vertexColors: true, flatShading: true })
    this.addMesh(group, awnings, awningMat, true)
    const station = new THREE.Group()
    station.name = 'bart-era'
    this.addMesh(station, bartWalls, this.windowMat, true)
    this.addMesh(station, bartShops, this.storeMat, true)
    this.addMesh(station, bartPaper, this.paperMat, true)
    this.addMesh(station, bartBattens, this.battenMat, true)
    this.addMesh(station, bartRoofs, this.roofMat, true)
    if (station.children.length > 0) {
      group.add(station)
      this.tagSpan(station, 1973, null)
    }
    this.addRoads(group, data.transportation ?? [], rich, blvdTrees)
    const planted = plantBoulevard(group, blvdTrees, this.height, this.trunkMat, this.canopyMat)
    if (planted) {
      for (const tree of planted.planted) {
        this.noteTree(group, tree.x, tree.z, tree.y, tree.trunkR, tree.canopyR, tree.canopyY, tree.index, planted.trunkFade, planted.canopyFade)
      }
    }
    this.addLanduse(group, data.landuse ?? [])
    this.addCrossings(group, data.crossing ?? [])
    this.addLabels(group, data, rich)
    if (data.tree?.length) this.addTrees(group, data.tree)
    if (data.reed?.length) this.addReeds(group, data.reed)
    if (data.parking?.length) this.addParking(group, data.parking)
    this.root.add(group)
    this.built.set(key, group)
  }

  private addMesh(group: THREE.Group, builder: MeshBuilder, material: THREE.Material, shadow: boolean, receive = shadow): void {
    const geo = builder.geometry()
    if (!geo) return
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = shadow
    mesh.receiveShadow = receive
    mesh.userData.unique = true
    group.add(mesh)
  }

  private addRoads(group: THREE.Group, rows: unknown[][], rich: boolean, blvdTrees: BlvdTree[]): void {
    const casing = new MeshBuilder()
    const asphalt = new MeshBuilder()
    const walk = new MeshBuilder()
    const trail = new MeshBuilder()
    const paint = new MeshBuilder()
    const freewayCasing = new MeshBuilder()
    const freewayAsphalt = new MeshBuilder()
    const freewayPaint = new MeshBuilder()
    const curb = new THREE.Color(town.curb)
    const paved = new THREE.Color(town.asphalt)
    const pavedAlt = new THREE.Color(town.asphaltAlt)
    const walkColor = new THREE.Color(town.sidewalk)
    const trailColor = new THREE.Color(town.dirt)
    const white = new THREE.Color(town.laneWhite)
    const yellow = new THREE.Color(town.laneYellow)
    const named: { name: string; cls: string; pts: { x: number; y: number; z: number }[]; len: number }[] = []
    for (const raw of rows) {
      if (!Array.isArray(raw) || raw.length < 10) continue
      const cls = String(raw[0])
      const name = String(raw[1] ?? '')
      const width = Number(raw[2])
      const flags = Number(raw[3])
      let lanes = 0
      let coordAt = 4
      const laneField = Number(raw[4])
      if (Number.isFinite(laneField) && laneField >= 0 && laneField <= 12 && Math.abs(Number(raw[5])) > 30) {
        lanes = laneField
        coordAt = 5
      }
      const rawPts: { x: number; y: number; z: number }[] = []
      for (let i = coordAt; i + 2 < raw.length; i += 3) {
        rawPts.push({ x: Number(raw[i]), y: Number(raw[i + 1]), z: Number(raw[i + 2]) })
      }
      if (rawPts.length < 2 || !Number.isFinite(width)) continue
      const pts = drapePath(rawPts, (x, z) => this.height.sample(x, z))
      const shorePath = /lakeside nature trail|dock trail/i.test(name)
      const dirt = (flags & 2) !== 0 && !shorePath
      let sidewalk = (flags & 1) !== 0 && !dirt
      const oneway = (flags & 8) !== 0
      const big = /^(motorway|trunk|primary|secondary)/.test(cls)
      const freeway = /^(motorway|trunk)/.test(cls)
      const boulevard = coreBoulevard(name, pts[0].x, pts[0].z)
      const salt = ((pts[0].x * 3 + pts[0].z) | 0) & 1
      const asphaltColor = salt ? pavedAlt : paved
      const moragaFour = /^moraga road$/i.test(name) && pts.some((p) => p.x > 420 && p.z < 760 && p.z > -520)
      const deerWalk = /^deer hill road$/i.test(name) && pts.some((p) => p.x < 500 && p.z < -640 && p.z > -900)
      const deerEast = /^deer hill road$/i.test(name) && pts.some((p) => p.x > 900)
      const hillCampus = /^pleasant hill road$/i.test(name) && pts.some((p) => p.x > 2100 && p.z < -1500)
      let drawWidth = width
      let laneCount = lanes > 0 ? lanes : dirt ? 0 : Math.max(1, Math.round(width / 3.3))
      if (moragaFour) {
        drawWidth = 14.6
        laneCount = 4
        sidewalk = true
      } else if (deerEast) {
        drawWidth = Math.max(width, 12.4)
        laneCount = Math.max(laneCount, 3)
        sidewalk = true
      } else if (deerWalk) {
        sidewalk = true
      } else if (hillCampus) {
        drawWidth = Math.max(width, 16.2)
        laneCount = 4
        sidewalk = true
      }
      const trailWidth = dirt ? Math.max(width, cls === 'steps' ? 2.05 : 2.65) : drawWidth
      if (shorePath) appendRibbon(asphalt, pts, 3.6, asphaltColor, 0.08)
      else if (dirt) appendRibbon(trail, pts, trailWidth, trailColor, 0.05)
      else if (boulevard) {
        const paver = new THREE.Color(0xcfc6b6)
        const band = new THREE.Color(0xcfc6b6)
        const median = new THREE.Color(0x7d9a52)
        const half = 6.4
        appendRibbon(walk, pts, half * 2 + 7.2, paver, 0.04)
        appendRibbon(casing, pts, half * 2 + 4.4, band, 0.055)
        appendRibbon(asphalt, this.shiftLine(pts, half * 0.55), half - 0.3, asphaltColor, 0.1)
        appendRibbon(asphalt, this.shiftLine(pts, -half * 0.55), half - 0.3, salt ? paved : pavedAlt, 0.1)
        appendRibbon(walk, pts, 2.2, median, 0.12)
        this.lanePaint(paint, this.shiftLine(pts, half * 0.55), half - 0.5, 2, false, white, yellow)
        this.lanePaint(paint, this.shiftLine(pts, -half * 0.55), half - 0.5, 2, false, white, yellow)
        this.scatterTrees(blvdTrees, pts)
      } else if (freeway) {
        appendRibbon(freewayCasing, pts, width + 1.15, curb, 0.05)
        appendRibbon(freewayAsphalt, pts, width, asphaltColor, 0.1)
        this.lanePaint(freewayPaint, pts, width, laneCount, oneway || big, white, yellow)
      } else {
        if (sidewalk) appendRibbon(walk, pts, drawWidth + 3.4, walkColor, 0.04)
        appendRibbon(casing, pts, drawWidth + 0.85, curb, 0.065)
        appendRibbon(asphalt, pts, drawWidth, asphaltColor, 0.1)
        if (cls !== 'service' && drawWidth >= 3.2) this.lanePaint(paint, pts, drawWidth, laneCount, oneway, white, yellow)
        if (/^school street$/i.test(name)) appendRibbon(asphalt, this.shiftLine(pts, drawWidth * 0.5 + 2.8), 3.05, asphaltColor, 0.08)
      }
      if (name.length > 2) {
        let len = 0
        for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)
        named.push({ name, cls, pts, len })
      }
    }
    this.addMesh(group, walk, this.walkMat, false, true)
    this.addMesh(group, casing, this.walkMat, false, true)
    this.addMesh(group, asphalt, this.roadMat, false, true)
    this.addMesh(group, trail, this.trailMat, false, true)
    this.addMesh(group, paint, this.lineMat, false)
    const belt = new THREE.Group()
    belt.name = 'freeway-era'
    this.addMesh(belt, freewayCasing, this.walkMat, false)
    this.addMesh(belt, freewayAsphalt, this.roadMat, false)
    this.addMesh(belt, freewayPaint, this.lineMat, false)
    if (belt.children.length > 0) {
      group.add(belt)
      this.tagSpan(belt, 1957, null)
    }
    named.sort((a, b) => b.len - a.len)
    const painted: { name: string; x: number; z: number }[] = []
    for (const road of named) {
      const minor = /^(service|footway|path|track|steps|cycleway)$/.test(road.cls)
      if (road.cls === 'service' || minor) continue
      if (!rich && !/^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)/.test(road.cls)) continue
      this.paintStreetNames(group, road.name, road.pts, road.cls, painted)
    }
  }

  /** Repeat the painted name along the roadway so a high camera still has one in frame. */
  private paintStreetNames(
    group: THREE.Group,
    name: string,
    pts: { x: number; y: number; z: number }[],
    cls: string,
    painted: { name: string; x: number; z: number }[],
  ): void {
    const step = 56
    let acc = 0
    let next = 18
    let dropped = 0
    const place = (x: number, z: number, y: number, dx: number, dz: number) => {
      if (painted.some((p) => p.name === name && Math.hypot(p.x - x, p.z - z) < 42)) return
      let px = x
      let pz = z
      if (coreBoulevard(name, x, z)) {
        const span = Math.hypot(dx, dz) || 1
        px += (-dz / span) * 3.6
        pz += (dx / span) * 3.6
      }
      const decal = this.addStreetName(group, name, px, pz, px + dx, pz + dz, y)
      if (/^(motorway|trunk)/.test(cls)) this.tagSpan(decal, 1957, null)
      painted.push({ name, x: px, z: pz })
      dropped += 1
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const seg = Math.hypot(dx, dz)
      if (seg < 0.4) continue
      while (acc + seg >= next) {
        const t = (next - acc) / seg
        place(a.x + dx * t, a.z + dz * t, a.y + (b.y - a.y) * t, dx, dz)
        next += step
      }
      acc += seg
    }
    if (dropped === 0 && pts.length >= 2) {
      const i = Math.min(pts.length - 1, Math.floor(pts.length / 2))
      const a = pts[Math.max(0, i - 1)]
      const b = pts[i]
      place(b.x, b.z, b.y, b.x - a.x, b.z - a.z)
    }
  }

  private shiftLine(pts: { x: number; y: number; z: number }[], offset: number): { x: number; y: number; z: number }[] {
    return pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      return { x: p.x - dz * offset, y: p.y, z: p.z + dx * offset }
    })
  }

  /** Planes down the median, sweetgums on the pavers, pears at the grey crossings [S, SIMP]. */
  private scatterTrees(out: BlvdTree[], pts: { x: number; y: number; z: number }[]): void {
    let carry = 6
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 2) continue
      const ux = dx / len
      const uz = dz / len
      let d = carry
      while (d < len) {
        const x = a.x + ux * d
        const z = a.z + uz * d
        if (inDowntown(x, z)) {
          const pear = greyIntersection(x, z)
          out.push({ x, z, kind: 'plane' })
          out.push({ x: x - uz * 8.2, z: z + ux * 8.2, kind: pear ? 'pear' : 'gum' })
          out.push({ x: x + uz * 8.2, z: z - ux * 8.2, kind: pear ? 'pear' : 'gum' })
        }
        d += 16
      }
      carry = d - len
    }
  }

  /** Bold lane paint: white edges, yellow center, white dividers from the lane count. */
  private lanePaint(
    paint: MeshBuilder,
    pts: { x: number; y: number; z: number }[],
    width: number,
    lanes: number,
    oneway: boolean,
    white: THREE.Color,
    yellow: THREE.Color,
  ): void {
    const edge = Math.max(0.55, width * 0.5 - 0.28)
    this.offsetRibbon(paint, pts, 0.16, white, 0.16, edge)
    this.offsetRibbon(paint, pts, 0.16, white, 0.16, -edge)
    const count = Math.max(1, lanes)
    if (count >= 2 && !oneway) {
      this.offsetRibbon(paint, pts, 0.14, yellow, 0.17, 0.16)
      this.offsetRibbon(paint, pts, 0.14, yellow, 0.17, -0.16)
    } else if (count >= 2) {
      this.dashes(paint, pts, white, 0)
    }
    if (count >= 3) {
      const span = width * 0.5 - 0.7
      for (let lane = 1; lane < count; lane++) {
        const off = -span + (span * 2 * lane) / count
        if (Math.abs(off) < 0.35) continue
        this.dashes(paint, pts, white, off)
      }
    }
  }

  private offsetRibbon(
    builder: MeshBuilder,
    pts: { x: number; y: number; z: number }[],
    width: number,
    color: THREE.Color,
    lift: number,
    offset: number,
  ): void {
    if (Math.abs(offset) < 0.02) {
      appendRibbon(builder, pts, width, color, lift)
      return
    }
    const shifted = pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      return { x: p.x + -dz * offset, y: p.y, z: p.z + dx * offset }
    })
    appendRibbon(builder, shifted, width, color, lift)
  }

  private addStreetName(group: THREE.Group, name: string, x: number, z: number, bx: number, bz: number, y: number): THREE.Mesh {
    const dx = bx - x
    const dz = bz - z
    const h = 8.6
    const geo = new THREE.PlaneGeometry(h * (1024 / 160), h)
    const mat = new MeshBasicNodeMaterial({
      map: streetNameTexture(name),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -12,
      polygonOffsetUnits: -12,
      opacity: 0,
    })
    mat.opacityNode = this.streetFade
    mat.transparent = true
    mat.depthWrite = false
    const span = Math.hypot(dx, dz) || 1
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y + 0.58, z)
    mesh.matrixAutoUpdate = false
    mesh.visible = false
    mesh.userData.unique = true
    mesh.userData.along = { x: dx / span, z: dz / span }
    mesh.renderOrder = 6
    group.add(mesh)
    this.streetNames.push(mesh)
    return mesh
  }

  /** Tops of the letters point up the screen, on the camera-facing side of the road. */
  orientStreetNames(camera: THREE.Camera): void {
    const ground = this.height.sample(camera.position.x, camera.position.z)
    const agl = camera.position.y - ground
    const fade = THREE.MathUtils.smoothstep(agl, 25, 60)
    this.streetFade.value = fade
    const hidden = fade <= 0.001
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const normal = new THREE.Vector3(0, 1, 0)
    const score = (tx: number, tz: number, ux: number, uz: number) =>
      ux * screenUp.x + uz * screenUp.z + 0.45 * (tx * screenRight.x + tz * screenRight.z)
    for (const mesh of this.streetNames) {
      const mat = mesh.material as THREE.Material
      mat.opacity = fade
      mesh.visible = !hidden
      if (hidden) {
        mesh.matrix.makeScale(0, 0, 0)
        continue
      }
      const along = mesh.userData.along as { x: number; z: number }
      let tx = along.x
      let tz = along.z
      let ux = tz
      let uz = -tx
      if (score(-tx, -tz, -ux, -uz) > score(tx, tz, ux, uz)) {
        tx = -tx
        tz = -tz
        ux = -ux
        uz = -uz
      }
      right.set(tx, 0, tz)
      up.set(ux, 0, uz)
      mesh.matrix.makeBasis(right, up, normal)
      mesh.matrix.setPosition(mesh.position.x, mesh.position.y, mesh.position.z)
    }
  }

  private dashes(builder: MeshBuilder, pts: { x: number; y: number; z: number }[], color: THREE.Color, offset = 0): void {
    const dash = 2.4
    const gap = 2.8
    let carry = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const dy = b.y - a.y
      const len = Math.hypot(dx, dz)
      if (len < 0.3) continue
      const ux = dx / len
      const uz = dz / len
      const rx = -uz
      const rz = ux
      let d = carry
      while (d < len) {
        const t0 = d
        const t1 = Math.min(len, d + dash)
        if (t1 - t0 > 0.45) {
          const y = a.y + (dy * (t0 + t1)) / (2 * len) + 0.2
          const c0x = a.x + ux * t0 + rx * offset
          const c0z = a.z + uz * t0 + rz * offset
          const c1x = a.x + ux * t1 + rx * offset
          const c1z = a.z + uz * t1 + rz * offset
          const hw = 0.2
          builder.tri(c0x - rx * hw, y, c0z - rz * hw, c0x + rx * hw, y, c0z + rz * hw, c1x - rx * hw, y, c1z - rz * hw, color)
          builder.tri(c0x + rx * hw, y, c0z + rz * hw, c1x + rx * hw, y, c1z + rz * hw, c1x - rx * hw, y, c1z - rz * hw, color)
        }
        d += dash + gap
      }
      carry = Math.max(0, d - len)
    }
  }

  private addLanduse(group: THREE.Group, rows: unknown[][]): void {
    const pads = new MeshBuilder()
    const color = new THREE.Color(0x7fbf45)
    for (const raw of rows) {
      if (!Array.isArray(raw) || raw.length < 8) continue
      if (String(raw[0]) !== 'park') continue
      const poly: number[] = []
      for (let i = 2; i < raw.length; i++) poly.push(Number(raw[i]))
      const contour: THREE.Vector2[] = []
      for (let i = 0; i < poly.length; i += 2) contour.push(new THREE.Vector2(poly[i], poly[i + 1]))
      let faces: number[][] = []
      try {
        faces = THREE.ShapeUtils.triangulateShape(contour, [])
      } catch {
        faces = []
      }
      for (const face of faces) {
        const pts = face.map((idx) => {
          const x = poly[idx * 2]
          const z = poly[idx * 2 + 1]
          return { x, y: this.height.sample(x, z) + 0.03, z }
        })
        if (pts.length < 3) continue
        pads.tri(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z, pts[2].x, pts[2].y, pts[2].z, color)
      }
    }
    this.addMesh(group, pads, this.parkMat, false)
  }

  private addCrossings(group: THREE.Group, rows: number[][]): void {
    const stripe = new MeshBuilder()
    const white = new THREE.Color(town.crosswalk)
    for (const cross of rows) {
      if (cross.length < 3) continue
      const ang = cross[2]
      const fwdX = Math.sin(ang)
      const fwdZ = -Math.cos(ang)
      const rx = Math.cos(ang)
      const rz = Math.sin(ang)
      const y = this.surface(cross[0], cross[1], null) + 0.22
      const core = inDowntown(cross[0], cross[1])
      const bars = core ? 4 : 5
      const gap = core ? 1.35 : 0.9
      for (let s = 0; s < bars; s++) {
        const offset = (s - (bars - 1) / 2) * gap
        const ox = cross[0] + fwdX * offset
        const oz = cross[1] + fwdZ * offset
        const len = core ? 4.6 : 5.4
        const color = white
        stripe.tri(
          ox - rx * len, y, oz - rz * len,
          ox + rx * len, y, oz + rz * len,
          ox - rx * len + fwdX * 0.34, y, oz - rz * len + fwdZ * 0.34,
          color,
        )
        stripe.tri(
          ox + rx * len, y, oz + rz * len,
          ox + rx * len + fwdX * 0.34, y, oz + rz * len + fwdZ * 0.34,
          ox - rx * len + fwdX * 0.34, y, oz - rz * len + fwdZ * 0.34,
          color,
        )
      }
    }
    this.addMesh(group, stripe, this.lineMat, false)
  }

  private addLabels(group: THREE.Group, data: VectorTile, rich: boolean): void {
    const seen = new Set<string>()
    const pois = (data.poi ?? []).filter((raw) => Array.isArray(raw) && raw.length >= 4)
    const ranked = pois
      .map((raw) => ({ n: String(raw[0]), k: String(raw[1]), x: Number(raw[2]), z: Number(raw[3]) }))
      .filter((p) => p.n.length > 1 && !/^\d+$/.test(p.n.trim()))
      .sort((a, b) => (a.k === 'place' ? -1 : 0) - (b.k === 'place' ? -1 : 0))
    for (const poi of ranked) {
      const id = poi.n.toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      const station = this.bartAt()
      const nearStation = Math.hypot(poi.x - station.x, poi.z - station.z) < 75
      if (inDowntown(poi.x, poi.z)) {
        this.addShopSign(group, poi.n, poi.x, poi.z)
        continue
      }
      if (poi.k === 'place') {
        const label = this.addLabel(group, poi.n, poi.x, poi.z, 'place')
        if (nearStation) this.tagSpan(label, 1973, null)
        continue
      }
      if (!rich) continue
      if (seen.size > 36) continue
      const accent = poiAccent(poi.k)
      const landmark = /station|park|civic|worship|townhall|library/.test(poi.k) || poi.n.length > 18
      const label = this.addLabel(group, poi.n, poi.x, poi.z, 'poi', accent)
      const pin = this.addPin(group, poi.x, poi.z, accent, landmark)
      if (nearStation) {
        this.tagSpan(label, 1973, null)
        this.tagSpan(pin, 1973, null)
      }
    }
  }

  private addLabel(group: THREE.Group, text: string, x: number, z: number, kind: 'street' | 'poi' | 'place', accent = ''): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ map: pillTexture(text, accent), transparent: true, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    const lift = kind === 'place' ? 36 : kind === 'poi' ? 18 : 13
    sprite.position.set(x, this.height.sample(x, z) + lift, z)
    const w = kind === 'place' ? 42 : Math.min(40, 12 + text.length * 0.95)
    sprite.scale.set(w, kind === 'place' ? 9.2 : 5.4, 1)
    sprite.center.set(0.5, 0)
    sprite.renderOrder = 20
    mat.depthTest = false
    sprite.userData.label = kind
    group.add(sprite)
    this.labels.push(sprite)
    return sprite
  }

  /** A small blade sign on the street side, readable looking along the boulevard. */
  private addShopSign(group: THREE.Group, text: string, x: number, z: number): void {
    const toward = Math.sign(-432 - z) || -1
    const sz = z + toward * Math.min(3.2, Math.max(1.4, Math.abs(-432 - z) * 0.25))
    const y = this.height.sample(x, sz) + 3.35
    const w = Math.min(4.4, 1.5 + text.length * 0.16)
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.62, w),
      new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.6 }),
    )
    board.position.set(x, y, sz)
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.92, 0.48),
      new THREE.MeshBasicMaterial({ map: shopSignTexture(text), side: THREE.DoubleSide }),
    )
    face.rotation.y = Math.PI / 2
    face.position.set(x + 0.06, y, sz)
    board.userData.unique = true
    face.userData.unique = true
    group.add(board, face)
  }

  private addPin(group: THREE.Group, x: number, z: number, accent: string, landmark = false): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: badgeTexture(accent, landmark),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(mat)
    const size = landmark ? 2.15 : 1.2
    sprite.position.set(x, this.height.sample(x, z) + (landmark ? 3.1 : 2.3), z)
    sprite.scale.set(size, size, 1)
    sprite.center.set(0.5, 0)
    sprite.renderOrder = 18
    sprite.userData.label = landmark ? 'place' : 'pin'
    sprite.userData.base = size
    sprite.userData.landmark = landmark
    group.add(sprite)
    this.labels.push(sprite)
    return sprite
  }

  private roofOf(poly: number[], height: number): number {
    let maxY = -Infinity
    const n = poly.length / 2
    for (let i = 0; i < n; i++) {
      const y = this.height.sample(poly[i * 2], poly[i * 2 + 1])
      if (y > maxY) maxY = y
    }
    return maxY + height
  }

  private buildingSpot(raw: unknown[]): { name: string; sx: number; sz: number } | null {
    if (!Array.isArray(raw) || raw.length < 9) return null
    const name = String(raw[2] ?? '')
    const polyAt = typeof raw[3] === 'string' ? 6 : 3
    let sx = 0
    let sz = 0
    let n = 0
    for (let i = polyAt; i + 1 < raw.length; i += 2) {
      sx += Number(raw[i])
      sz += Number(raw[i + 1])
      n += 1
    }
    if (n < 3) return null
    return { name, sx: sx / n, sz: sz / n }
  }

  private extrude(
    poly: number[],
    height: number,
    kind: string,
    walls: MeshBuilder,
    roofs: MeshBuilder,
    rich: boolean,
    roofShape = '',
    wallHex: number | null = null,
    roofHex: number | null = null,
    facade: Facade | null = null,
  ): void {
    const n = poly.length / 2
    const contour: THREE.Vector2[] = []
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = poly[i * 2]
      const z = poly[i * 2 + 1]
      contour.push(new THREE.Vector2(x, z))
      const y = this.height.sample(x, z)
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const y0 = minY - 0.2
    const y1 = maxY + height
    const yTop = rich ? y1 + 0.42 : y1
    const salt = (poly[0] * 10 + poly[1] * 3) | 0
    let cx = 0
    let cz = 0
    for (let i = 0; i < n; i++) {
      cx += poly[i * 2]
      cz += poly[i * 2 + 1]
    }
    cx /= n
    cz /= n
    const custom = facade ? null : this.shopWall(cx, cz)
    const picked = facade?.wall ?? custom ?? wallHex ?? (rich && (kind === 'c' || kind === 's') ? 0xfff3e4 : town.paper[((salt % town.paper.length) + town.paper.length) % town.paper.length])
    const wallColor = tint(picked, salt)
    const pitched = Boolean(roofShape) && roofShape !== 'flat'
    const roofColor = tint(facade?.roof ?? roofHex ?? (pitched ? town.roof : town.roofAlt), salt + 2)
    const aoColor = (facade ? tint(facade.base, salt) : wallColor).clone().multiplyScalar(0.86)
    const cornerColor = wallColor.clone().multiplyScalar(0.9)
    let faces: number[][] = []
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, [])
    } catch {
      faces = []
    }
    for (const face of faces) {
      const pts = face.map((idx) => ({ x: poly[idx * 2], z: poly[idx * 2 + 1] }))
      if (pts.length < 3) continue
      roofs.tri(pts[0].x, y1, pts[0].z, pts[1].x, y1, pts[1].z, pts[2].x, y1, pts[2].z, roofColor)
    }
    if (roofShape && roofShape !== 'flat') this.raiseRoof(roofs, poly, y1, cx, cz, roofShape, roofColor)
    else this.dressRoof(roofs, poly, y1, cx, cz, roofColor, salt)
    let u = 0
    for (let i = 0; i < n; i++) {
      const x1 = poly[i * 2]
      const z1 = poly[i * 2 + 1]
      const x2 = poly[((i + 1) % n) * 2]
      const z2 = poly[((i + 1) % n) * 2 + 1]
      const len = Math.hypot(x2 - x1, z2 - z1)
      if (len < 0.15) continue
      const u2 = u + len / 3.2
      const contact = wallColor.clone().multiplyScalar(0.72)
      const contactTop = Math.min(y0 + 0.45, yTop - 0.3)
      const aoTop = facade ? Math.min(Math.max(contactTop, y0 + 3.2), yTop - 0.35) : contactTop
      const vContact = (contactTop - y0) / 3.2
      const vAo = (aoTop - y0) / 3.2
      const vTop = (yTop - y0) / 3.2
      const inset = Math.min(0.55, len * 0.22)
      const ux = (x2 - x1) / len
      const uz = (z2 - z1) / len
      const ix1 = x1 + ux * inset
      const iz1 = z1 + uz * inset
      const ix2 = x2 - ux * inset
      const iz2 = z2 - uz * inset
      const paintWall = (xa: number, za: number, xb: number, zb: number, ua: number, ub: number, color: THREE.Color) => {
        walls.tri(xa, y0, za, xa, contactTop, za, xb, y0, zb, contact, [ua, 0, ua, vContact, ub, 0])
        walls.tri(xa, contactTop, za, xb, contactTop, zb, xb, y0, zb, contact, [ua, vContact, ub, vContact, ub, 0])
        if (aoTop - contactTop > 0.15) {
          walls.tri(xa, contactTop, za, xa, aoTop, za, xb, contactTop, zb, aoColor, [ua, vContact, ua, vAo, ub, vContact])
          walls.tri(xa, aoTop, za, xb, aoTop, zb, xb, contactTop, zb, aoColor, [ua, vAo, ub, vAo, ub, vContact])
        }
        walls.tri(xa, aoTop, za, xa, yTop, za, xb, aoTop, zb, color, [ua, vAo, ua, vTop, ub, vAo])
        walls.tri(xa, yTop, za, xb, yTop, zb, xb, aoTop, zb, color, [ua, vTop, ub, vTop, ub, vAo])
      }
      paintWall(x1, z1, ix1, iz1, u, u + inset / 3.2, cornerColor)
      paintWall(ix1, iz1, ix2, iz2, u + inset / 3.2, u2 - inset / 3.2, wallColor)
      paintWall(ix2, iz2, x2, z2, u2 - inset / 3.2, u2, cornerColor)
      u = u2
    }
  }

  /** Parapet, a low ridge, and a roof box so a flat top is not a blank slab. */
  private dressRoof(roofs: MeshBuilder, poly: number[], y1: number, cx: number, cz: number, color: THREE.Color, salt: number): void {
    const n = poly.length / 2
    if (n < 3) return
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      const x = poly[i * 2]
      const z = poly[i * 2 + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const spanX = maxX - minX
    const spanZ = maxZ - minZ
    const span = Math.max(spanX, spanZ)
    if (span < 2.4) return
    const lip = color.clone().multiplyScalar(0.86)
    const chamfer = 0.1
    for (let i = 0; i < n; i++) {
      const x1 = poly[i * 2]
      const z1 = poly[i * 2 + 1]
      const x2 = poly[((i + 1) % n) * 2]
      const z2 = poly[((i + 1) % n) * 2 + 1]
      if (Math.hypot(x2 - x1, z2 - z1) < 0.35) continue
      const mx = (x1 + x2) / 2
      const mz = (z1 + z2) / 2
      let px = -(z2 - z1)
      let pz = x2 - x1
      if (px * (cx - mx) + pz * (cz - mz) < 0) {
        px = -px
        pz = -pz
      }
      const plen = Math.hypot(px, pz) || 1
      px = (px / plen) * chamfer
      pz = (pz / plen) * chamfer
      roofs.tri(x1, y1, z1, x2, y1, z2, x1 + px, y1 + chamfer, z1 + pz, lip)
      roofs.tri(x2, y1, z2, x2 + px, y1 + chamfer, z2 + pz, x1 + px, y1 + chamfer, z1 + pz, lip)
    }
    const alongX = spanX >= spanZ
    const ridge = color.clone().multiplyScalar(0.72)
    const rise = Math.min(1.05, Math.max(0.32, span * 0.07))
    const ax = alongX ? minX + spanX * 0.2 : cx
    const az = alongX ? cz : minZ + spanZ * 0.2
    const bx = alongX ? maxX - spanX * 0.2 : cx
    const bz = alongX ? cz : maxZ - spanZ * 0.2
    const px = alongX ? 0 : spanX * 0.14
    const pz = alongX ? spanZ * 0.14 : 0
    roofs.tri(ax - px, y1 + 0.08, az - pz, bx - px, y1 + 0.08, bz - pz, ax, y1 + rise, az, ridge)
    roofs.tri(bx - px, y1 + 0.08, bz - pz, bx, y1 + rise, bz, ax, y1 + rise, az, ridge)
    const shade = ridge.clone().multiplyScalar(0.86)
    roofs.tri(ax + px, y1 + 0.08, az + pz, ax, y1 + rise, az, bx + px, y1 + 0.08, bz + pz, shade)
    roofs.tri(bx + px, y1 + 0.08, bz + pz, ax, y1 + rise, az, bx, y1 + rise, bz, shade)
    if (span > 7.5) {
      const hx = cx + (hash01(salt) - 0.5) * Math.min(5.5, span * 0.18)
      const hz = cz + (hash01(salt + 4) - 0.5) * Math.min(5.5, span * 0.18)
      this.roofBox(roofs, hx, y1 + 0.5, hz, 1.55, 0.4, 1.1, color.clone().multiplyScalar(0.7))
    }
  }

  private roofBox(roofs: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color): void {
    const x0 = x - w / 2
    const x1 = x + w / 2
    const y0 = y
    const y1 = y + h
    const z0 = z - d / 2
    const z1 = z + d / 2
    const side = color.clone().multiplyScalar(0.82)
    roofs.tri(x0, y1, z0, x1, y1, z0, x0, y1, z1, color)
    roofs.tri(x1, y1, z0, x1, y1, z1, x0, y1, z1, color)
    roofs.tri(x0, y0, z0, x1, y0, z0, x0, y1, z0, side)
    roofs.tri(x1, y0, z0, x1, y1, z0, x0, y1, z0, side)
    roofs.tri(x0, y0, z1, x0, y1, z1, x1, y0, z1, side)
    roofs.tri(x1, y0, z1, x0, y1, z1, x1, y1, z1, side)
    roofs.tri(x0, y0, z0, x0, y1, z0, x0, y0, z1, side)
    roofs.tri(x0, y1, z0, x0, y1, z1, x0, y0, z1, side)
    roofs.tri(x1, y0, z0, x1, y0, z1, x1, y1, z0, side)
    roofs.tri(x1, y0, z1, x1, y1, z1, x1, y1, z0, side)
  }

  /** A toy roof only when OSM recorded a shape. Missing tags stay flat. */
  private raiseRoof(roofs: MeshBuilder, poly: number[], y1: number, cx: number, cz: number, shape: string, color: THREE.Color): void {
    const n = poly.length / 2
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      const x = poly[i * 2]
      const z = poly[i * 2 + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const span = Math.min(maxX - minX, maxZ - minZ)
    const rise = Math.min(3.2, Math.max(1.2, span * 0.32))
    const peakY = y1 + rise
    const alongX = maxX - minX >= maxZ - minZ
    const peaked = shape === 'pyramidal' || shape === 'dome' || shape === 'round'
    const hip = shape === 'hip'
    const inset = peaked ? 0 : hip ? 0.34 : 0.08
    const ax = peaked ? cx : alongX ? minX + (maxX - minX) * inset : cx
    const az = peaked ? cz : alongX ? cz : minZ + (maxZ - minZ) * inset
    const bx = peaked ? cx : alongX ? maxX - (maxX - minX) * inset : cx
    const bz = peaked ? cz : alongX ? cz : maxZ - (maxZ - minZ) * inset
    const shade = color.clone().multiplyScalar(0.78)
    for (let i = 0; i < n; i++) {
      const x1 = poly[i * 2]
      const z1 = poly[i * 2 + 1]
      const x2 = poly[((i + 1) % n) * 2]
      const z2 = poly[((i + 1) % n) * 2 + 1]
      const face = i % 2 === 0 ? color : shade
      const ex = Math.abs(x2 - x1)
      const ez = Math.abs(z2 - z1)
      const end = !peaked && !hip && (alongX ? ez > ex : ex > ez)
      if (peaked || shape === 'skillion') {
        const py = shape === 'skillion' ? y1 + rise * 0.65 : peakY
        const px = shape === 'skillion' ? cx + (maxX - minX) * 0.15 : cx
        const pz = shape === 'skillion' ? cz : cz
        roofs.tri(x1, y1, z1, x2, y1, z2, px, py, pz, face)
      } else if (end) {
        const midX = (x1 + x2) / 2
        const midZ = (z1 + z2) / 2
        const useB = Math.hypot(midX - bx, midZ - bz) < Math.hypot(midX - ax, midZ - az)
        roofs.tri(x1, y1, z1, x2, y1, z2, useB ? bx : ax, peakY, useB ? bz : az, shade)
      } else {
        roofs.tri(x1, y1, z1, x2, y1, z2, ax, peakY, az, face)
        roofs.tri(x2, y1, z2, bx, peakY, bz, ax, peakY, az, shade)
      }
    }
  }

  private addTrees(group: THREE.Group, flat: number[]): void {
    const count = flat.length / 3
    if (!count) return
    const trunkGeo = this.trunkGeo.clone()
    const canopyGeo = this.canopyGeo.clone()
    const trunkFade = this.fadeBuffer(trunkGeo, count)
    const canopyFade = this.fadeBuffer(canopyGeo, count)
    assignPhase(canopyGeo, count, 29)
    const trunks = new THREE.InstancedMesh(trunkGeo, this.trunkMat, count)
    const canopy = new THREE.InstancedMesh(canopyGeo, this.canopyMat, count)
    canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const bark = new THREE.Color(0x5a4a3a)
    for (let i = 0; i < count; i++) {
      const x = flat[i * 3]
      const z = flat[i * 3 + 1]
      const variant = flat[i * 3 + 2]
      const wide = variant === 1
      const y = this.height.sample(x, z)
      const bulk = 0.68 + hash01(i * 17 + 1) * 0.92
      const trunkSY = 0.9 + hash01(i) * 0.2
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, hash01(i * 11) * Math.PI, 0)
      dummy.scale.set(0.9 + hash01(i + 2) * 0.25, trunkSY, 0.9 + hash01(i + 2) * 0.25)
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
      bark.setRGB(1, 1, 1)
      bark.multiplyScalar(0.94 + hash01(i * 3) * 0.1)
      trunks.setColorAt(i, bark)
      const crown = (wide ? 1.45 : 1.15) * bulk
      const canopySY = wide ? crown * 0.72 : crown * 1.2
      const lift = crownLift(trunkSY, canopySY)
      dummy.position.set(x, y + lift, z)
      dummy.rotation.set(0, hash01(i * 13) * Math.PI, 0)
      if (wide) dummy.scale.set(canopySY * 1.6, canopySY, canopySY * 1.6)
      else dummy.scale.set(crown * 0.9, canopySY, crown * 0.9)
      dummy.updateMatrix()
      canopy.setMatrixAt(i, dummy.matrix)
      color.setRGB(1, 1, 1)
      canopy.setColorAt(i, color)
      this.noteTree(group, x, z, y, 0.28, crown * 1.45, y + lift, i, trunkFade, canopyFade)
    }
    trunks.castShadow = true
    canopy.castShadow = false
    canopy.receiveShadow = false
    canopy.userData.canopy = true
    this.canopies.push(canopy)
    const cardMat = (this.impostorMat as THREE.MeshStandardMaterial).clone()
    cardMat.transparent = true
    cardMat.opacity = 0
    this.cardMats.push(cardMat)
    const cards = new THREE.InstancedMesh(this.impostorGeo, cardMat, count)
    for (let i = 0; i < count; i++) {
      const x = flat[i * 3]
      const z = flat[i * 3 + 1]
      const y = this.height.sample(x, z)
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, hash01(i * 3) * Math.PI, 0)
      dummy.scale.set(1, 0.9 + hash01(i + 4) * 0.35, 1)
      dummy.updateMatrix()
      cards.setMatrixAt(i, dummy.matrix)
    }
    cards.visible = false
    group.add(trunks, canopy, cards)
    const lod: { detail: THREE.Object3D[]; far: THREE.Object3D; mat?: THREE.MeshStandardMaterial } = group.userData.lod ?? {
      detail: [],
      far: cards,
    }
    lod.detail.push(trunks, canopy)
    lod.far = cards
    lod.mat = cardMat
    group.userData.lod = lod
  }

  private paintCanopy(mesh: THREE.InstancedMesh): void {
    const color = new THREE.Color(1, 1, 1)
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, color)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  private addReeds(group: THREE.Group, flat: number[]): void {
    const count = flat.length / 2
    if (!count) return
    const mesh = new THREE.InstancedMesh(this.reedGeo, this.reedMat, count)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const x = flat[i * 2]
      const z = flat[i * 2 + 1]
      dummy.position.set(x, this.waterLevel - 0.1, z)
      dummy.scale.set(1, 0.7 + hash01(i) * 0.8, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    group.add(mesh)
  }

  private addParking(group: THREE.Group, lots: number[][]): void {
    const b = new MeshBuilder()
    const lines = new MeshBuilder()
    const color = new THREE.Color(town.asphalt)
    const paint = new THREE.Color(town.laneWhite)
    const spots: { x: number; z: number }[] = []
    const boxes: number[][] = []
    for (const lot of lots) {
      if (lot.length < 6) continue
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      let sx = 0
      let sz = 0
      const n = lot.length / 2
      for (let i = 0; i < n; i++) {
        const x = lot[i * 2]
        const z = lot[i * 2 + 1]
        sx += x
        sz += z
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      sx /= n
      sz /= n
      const inset = 0
      const shaped: number[] = []
      for (let i = 0; i < n; i++) {
        const x = lot[i * 2]
        const z = lot[i * 2 + 1]
        shaped.push(sx + (x - sx) * (1 - inset), sz + (z - sz) * (1 - inset))
      }
      const contour: THREE.Vector2[] = []
      let sMinX = Infinity
      let sMaxX = -Infinity
      let sMinZ = Infinity
      let sMaxZ = -Infinity
      for (let i = 0; i < shaped.length; i += 2) {
        const x = shaped[i]
        const z = shaped[i + 1]
        contour.push(new THREE.Vector2(x, z))
        if (x < sMinX) sMinX = x
        if (x > sMaxX) sMaxX = x
        if (z < sMinZ) sMinZ = z
        if (z > sMaxZ) sMaxZ = z
      }
      let faces: number[][] = []
      try {
        faces = THREE.ShapeUtils.triangulateShape(contour, [])
      } catch {
        faces = []
      }
      for (const face of faces) {
        const pts = face.map((idx) => {
          const x = shaped[idx * 2]
          const z = shaped[idx * 2 + 1]
          return { x, y: this.height.sample(x, z) + 0.07, z }
        })
        if (pts.length < 3) continue
        b.tri(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z, pts[2].x, pts[2].y, pts[2].z, color)
      }
      this.stallLines(lines, sMinX, sMaxX, sMinZ, sMaxZ, paint, lot)
      const w = sMaxX - sMinX
      const d = sMaxZ - sMinZ
      if (Math.max(w, d) >= 14 && Math.min(w, d) >= 8) boxes.push(lot)
      if (w * d > 240 && Math.min(w, d) > 9) {
        const count = Math.min(5, Math.max(2, Math.floor((w * d) / 420)))
        for (let t = 0; t < count; t++) {
          const fx = 0.2 + hash01(sx * 3 + t * 5) * 0.6
          const fz = 0.2 + hash01(sz * 5 + t * 7) * 0.6
          spots.push({ x: sMinX + w * fx, z: sMinZ + d * fz })
        }
      }
    }
    const geo = b.geometry()
    if (!geo) return
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0 }))
    mesh.receiveShadow = true
    mesh.userData.unique = true
    group.add(mesh)
    const stalls = lines.geometry()
    if (stalls) {
      const paintMesh = new THREE.Mesh(stalls, this.lineMat)
      paintMesh.userData.unique = true
      paintMesh.renderOrder = 2
      group.add(paintMesh)
    }
    if (spots.length) this.addLotTrees(group, spots)
    if (boxes.length) this.addLotCars(group, boxes)
    let pins = 0
    for (const lot of lots) {
      if (lot.length < 6 || pins >= 4) continue
      let sx = 0
      let sz = 0
      const n = lot.length / 2
      for (let i = 0; i < n; i++) {
        sx += lot[i * 2]
        sz += lot[i * 2 + 1]
      }
      this.addPin(group, sx / n, sz / n, poiAccent('parking'))
      pins += 1
    }
  }

  /** Contact darkening in the vertex color. Lower ground under an eave, and slopes facing away from the afternoon sun. */
  private vertexShade(i: number, j: number, flag: number): number {
    let shade = 1
    if ((flag & F_BUILDING) !== 0 || this.buildingNear(i, j)) shade = 0.94
    const h = this.height
    const spanX = h.sizeX / Math.max(1, h.cols - 1)
    const spanZ = h.sizeZ / Math.max(1, h.rows - 1)
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(h.cols - 1, i + 1)
    const j0 = Math.max(0, j - 1)
    const j1 = Math.min(h.rows - 1, j + 1)
    const dx = (h.heights[j * h.cols + i1] - h.heights[j * h.cols + i0]) / Math.max(0.01, (i1 - i0) * spanX)
    const dz = (h.heights[j1 * h.cols + i] - h.heights[j0 * h.cols + i]) / Math.max(0.01, (j1 - j0) * spanZ)
    const nx = -dx
    const ny = 1
    const nz = -dz
    const len = Math.hypot(nx, ny, nz) || 1
    const sun = (nx * 0.2 + ny * 0.8 + nz * -0.3) / len
    if (sun < 0.35) shade *= 0.84
    return Math.min(1, Math.max(0.7, shade))
  }

  private buildingNear(i: number, j: number): boolean {
    const h = this.height
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= h.cols || jj >= h.rows) continue
        if (h.flags[jj * h.cols + ii] & F_BUILDING) return true
      }
    }
    return false
  }

  private insideLot(x: number, z: number, lot: number[]): boolean {
    const n = lot.length / 2
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = lot[i * 2]
      const zi = lot[i * 2 + 1]
      const xj = lot[j * 2]
      const zj = lot[j * 2 + 1]
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) inside = !inside
    }
    return inside
  }

  private stallLines(lines: MeshBuilder, minX: number, maxX: number, minZ: number, maxZ: number, color: THREE.Color, lot: number[]): void {
    const w = maxX - minX
    const d = maxZ - minZ
    if (Math.max(w, d) < 14 || Math.min(w, d) < 8) return
    const alongX = w >= d
    const span = alongX ? w : d
    const cross = alongX ? d : w
    const gap = 8.2
    const depth = Math.min(7.2, cross * 0.26)
    const count = Math.floor((span - 4) / gap)
    if (count < 2) return
    const mark = (x0: number, z0: number, x1: number, z1: number) => {
      const mx = (x0 + x1) / 2
      const mz = (z0 + z1) / 2
      if (!this.insideLot(mx, mz, lot)) return
      const dx = x1 - x0
      const dz = z1 - z0
      const len = Math.hypot(dx, dz) || 1
      const half = 0.06
      const px = (-dz / len) * half
      const pz = (dx / len) * half
      const y0 = this.height.sample(x0, z0) + 0.16
      const y1 = this.height.sample(x1, z1) + 0.16
      lines.tri(x0 - px, y0, z0 - pz, x0 + px, y0, z0 + pz, x1 - px, y1, z1 - pz, color)
      lines.tri(x0 + px, y0, z0 + pz, x1 + px, y1, z1 + pz, x1 - px, y1, z1 - pz, color)
    }
    for (let s = 0; s < count; s++) {
      const t = 3 + s * gap
      if (alongX) {
        const x = minX + t
        mark(x, minZ + 1.2, x, minZ + 1.2 + depth)
        if (cross > 18) mark(x, maxZ - 1.2, x, maxZ - 1.2 - depth)
      } else {
        const z = minZ + t
        mark(minX + 1.2, z, minX + 1.2 + depth, z)
        if (cross > 18) mark(maxX - 1.2, z, maxX - 1.2 - depth, z)
      }
    }
  }

  /** A few cars in the stalls, so a lot is not only paint. */
  private addLotCars(group: THREE.Group, lots: number[][]): void {
    const places: { x: number; z: number; rot: number; hex: number }[] = []
    const colors = [0xd4564e, 0xf2f4f6, 0x355f8a, 0xe6c15a, 0x2f2f33, 0x7aa0a6]
    for (const lot of lots) {
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < lot.length; i += 2) {
        const x = lot[i]
        const z = lot[i + 1]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      const w = maxX - minX
      const depth = maxZ - minZ
      if (w * depth < 280 || Math.min(w, depth) < 9) continue
      const rot = w >= depth ? Math.PI / 2 : 0
      let placed = 0
      const want = Math.min(6, Math.max(3, Math.floor(Math.sqrt(w * depth) / 6)))
      for (let ix = 1; ix < 8 && placed < want; ix++) {
        for (let iz = 1; iz < 6 && placed < want; iz++) {
          const x = minX + (w * ix) / 8
          const z = minZ + (depth * iz) / 6
          if (!this.insideLot(x, z, lot)) continue
          if (Math.hypot(x - 452, z + 426) < 12) continue
          if (places.some((p) => Math.hypot(p.x - x, p.z - z) < 11)) continue
          places.push({ x, z, rot, hex: colors[(placed + (minX | 0)) % colors.length] })
          placed += 1
        }
      }
    }
    if (!places.length) return
    const bodyGeo = new THREE.BoxGeometry(1.65, 0.48, 3.7)
    bodyGeo.translate(0, 0.55, 0)
    const cabinGeo = new THREE.BoxGeometry(1.45, 0.38, 1.7)
    cabinGeo.translate(0, 0.95, -0.15)
    const bodies = new THREE.InstancedMesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.12 }),
      places.length,
    )
    const cabins = new THREE.InstancedMesh(
      cabinGeo,
      new THREE.MeshStandardMaterial({ color: 0x243038, roughness: 0.25, metalness: 0.2 }),
      places.length,
    )
    bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(places.length * 3), 3)
    const dummy = new THREE.Object3D()
    const tint = new THREE.Color()
    for (let i = 0; i < places.length; i++) {
      const spot = places[i]
      dummy.position.set(spot.x, this.height.sample(spot.x, spot.z), spot.z)
      dummy.rotation.set(0, spot.rot, 0)
      dummy.updateMatrix()
      bodies.setMatrixAt(i, dummy.matrix)
      cabins.setMatrixAt(i, dummy.matrix)
      tint.setHex(spot.hex)
      bodies.setColorAt(i, tint)
    }
    bodies.castShadow = false
    bodies.receiveShadow = false
    cabins.castShadow = false
    cabins.receiveShadow = false
    bodies.frustumCulled = false
    cabins.frustumCulled = false
    bodies.userData.unique = true
    cabins.userData.unique = true
    group.add(bodies, cabins)
  }

  private addLotTrees(group: THREE.Group, spots: { x: number; z: number }[]): void {
    const count = spots.length
    const trunkGeo = this.trunkGeo.clone()
    const canopyGeo = this.canopyGeo.clone()
    const trunkFade = this.fadeBuffer(trunkGeo, count)
    const canopyFade = this.fadeBuffer(canopyGeo, count)
    assignPhase(canopyGeo, count, 47)
    const trunks = new THREE.InstancedMesh(trunkGeo, this.trunkMat, count)
    const canopy = new THREE.InstancedMesh(canopyGeo, this.canopyMat, count)
    canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    trunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const bark = new THREE.Color(0x5a4a3a)
    for (let i = 0; i < count; i++) {
      const { x, z } = spots[i]
      const y = this.height.sample(x, z)
      const bulk = 0.7 + hash01(i * 19 + x) * 0.7
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, hash01(i * 3) * Math.PI, 0)
      dummy.scale.set(1, 0.95, 1)
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
      bark.setRGB(1, 1, 1)
      trunks.setColorAt(i, bark)
      const crown = 1.2 * bulk
      const canopySY = crown * 0.72
      const lift = crownLift(0.95, canopySY)
      dummy.position.set(x, y + lift, z)
      dummy.scale.set(canopySY * 1.6, canopySY, canopySY * 1.6)
      dummy.updateMatrix()
      canopy.setMatrixAt(i, dummy.matrix)
      color.setRGB(1, 1, 1)
      canopy.setColorAt(i, color)
      this.noteTree(group, x, z, y, 0.25, crown * 1.15, y + lift, i, trunkFade, canopyFade)
    }
    trunks.castShadow = true
    canopy.castShadow = false
    canopy.receiveShadow = false
    trunks.userData.unique = true
    canopy.userData.unique = true
    group.add(trunks, canopy)
  }
}

export function signalGreen(x: number, z: number, time: number): boolean {
  const phase = hash01((Math.round(x) * 13 + Math.round(z) * 17) | 0)
  return (time * 0.13 + phase) % 1 > 0.42
}
