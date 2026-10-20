import * as THREE from 'three'
import { WaterMesh } from 'three/addons/objects/WaterMesh.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Blockers, MeshBuilder, appendRibbon, tint } from './geom.ts'
import { Heightfield, F_PARK, F_ROAD, F_URBAN, F_WATER, F_WOOD } from './height.ts'
import { dotTexture, foliageMaterial, hillMaterial, impostorMaterial, leafMaterial, makeSignTexture, pillTexture, poiAccent, shared, type Textures } from './materials.ts'
import { dressTown } from './dress.ts'
import { spanVisible } from './eras.ts'
import { dressFifties } from './period.ts'
import { hash01 } from './math.ts'
import { tileKey, tileOf, type TileSet, type VectorTile } from './tiles.ts'
import type { Meta, Road, Season, WaterFile } from './types.ts'

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
  private baseUrl = ''
  private readonly segGrid = new Map<string, Seg[]>()
  private readonly signs: THREE.Object3D[] = []
  private readonly shops: { x: number; z: number; wall: number }[] = []
  private readonly signalColor: THREE.InstancedMesh | null = null
  private readonly signalPos: { x: number; z: number }[] = []
  private terrainColors: Float32Array | null = null
  private season: Season = 'summer'
  private readonly canopies: THREE.InstancedMesh[] = []
  private readonly cardMats: THREE.MeshStandardMaterial[] = []
  private segCell = 40
  private readonly tmpColor = new THREE.Color()
  private trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 2.3, 5)
  private canopyGeo = new THREE.IcosahedronGeometry(1.05, 0)
  private reedGeo = new THREE.ConeGeometry(0.12, 1.05, 4)
  private trunkMat: THREE.Material
  private canopyMat: THREE.Material
  private reedMat: THREE.Material
  private impostorMat: THREE.Material
  private impostorGeo: THREE.BufferGeometry
  private reservoir: THREE.Mesh | null = null
  private reflective: WaterMesh | null = null
  private readonly sunDir = new THREE.Vector3(0.2, 0.8, 0.3)
  private readonly paperMat: THREE.MeshStandardMaterial
  private readonly roofMat: THREE.MeshStandardMaterial
  private readonly parkMat: THREE.MeshStandardMaterial
  private readonly lineMat: THREE.MeshBasicMaterial
  private readonly walkMat: THREE.MeshStandardMaterial
  private readonly trailMat: THREE.MeshStandardMaterial
  private eraYear = 2026
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

    this.roadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0.02, vertexColors: true })
    this.windowMat = new THREE.MeshStandardMaterial({
      map: textures.wall,
      emissiveMap: textures.windows,
      emissive: 0xfff1d6,
      emissiveIntensity: 0,
      roughness: 0.82,
      metalness: 0.04,
      vertexColors: true,
    })
    this.storeMat = new THREE.MeshStandardMaterial({
      map: textures.store,
      emissiveMap: textures.windows,
      emissive: 0xffe1b0,
      emissiveIntensity: 0,
      roughness: 0.7,
      metalness: 0.06,
      vertexColors: true,
    })
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d2,
      emissive: 0xffc56b,
      emissiveIntensity: 0,
      roughness: 0.35,
    })
    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.02, vertexColors: true })
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, vertexColors: true })
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
    this.trunkGeo.translate(0, 1.15, 0)
    this.canopyGeo.translate(0, 1.2, 0)
    this.reedGeo.translate(0, 0.5, 0)
    this.trunkMat = foliageMaterial(0x6a4a32, 0.9, 0.16)
    this.canopyMat = leafMaterial('canopy')
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
    const i = Math.floor(x / this.segCell)
    const j = Math.floor(z / this.segCell)
    const out: Seg[] = []
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.segGrid.get(`${i + dx},${j + dz}`)
        if (list) out.push(...list)
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
      const y = seg.ay + (seg.by - seg.ay) * t
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
      const sy = seg.ay + (seg.by - seg.ay) * t
      if (Math.abs(sy - y) < 2.2) return true
    }
    return false
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
    if (!mesh || this.reflective) return
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
        const center = group.userData.center as { x: number; z: number }
        const dist = Math.hypot(center.x - x, center.z - z)
        const fade = THREE.MathUtils.smoothstep(dist, 340, 520)
        if (lod.mat) lod.mat.opacity = THREE.MathUtils.clamp(fade * 1.35, 0, 1)
        lod.far.visible = (lod.mat?.opacity ?? 0) > 0.04
        for (const mesh of lod.detail) mesh.visible = fade < 0.82
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
      const near = kind === 'place' ? 28 : kind === 'pin' ? 6 : 8
      let visible = item.dist > near && item.dist < far
      if (visible && shown[kind] >= cap[kind]) visible = false
      if (visible) shown[kind] += 1
      item.sprite.visible = visible
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
    let k = 0
    for (let j = 0; j < rows; j++) {
      const jj = Math.min(h.rows - 1, j * step)
      for (let i = 0; i < cols; i++) {
        const ii = Math.min(h.cols - 1, i * step)
        const idx = jj * h.cols + ii
        const elev = h.heights[idx]
        const f = h.flags[idx]
        const n = hash01(ii * 13 + jj * 9)
        let hex = season === 'winter' ? 0x3f8f45 : season === 'spring' ? 0x67b34a : 0xd4a24a
        if (f & F_WATER) hex = 0x8a7a58
        else if (f & F_ROAD) hex = 0xd8dce3
        else if (f & F_PARK) hex = season === 'winter' ? 0x7ed07a : season === 'spring' ? 0x9ed36a : 0xc6d25a
        else if (f & F_WOOD) hex = season === 'summer' ? 0x4a6230 : 0x2f6a38
        else if (f & F_URBAN) {
          const n2 = hash01(ii * 3 + jj * 17)
          hex = n2 > 0.78 ? 0xd7e4c6 : n2 > 0.46 ? 0xe6d2ac : 0xf7f1e4
        }
        else if (elev < h.waterLevel + 18) hex = season === 'winter' ? 0x2f7a38 : season === 'spring' ? 0x4e9a40 : 0x8aaa3a
        else if (elev < h.waterLevel + 36) hex = season === 'winter' ? 0x3d8a42 : season === 'spring' ? 0x62b04e : 0xc4a04a
        if (season === 'spring' && n > 0.86 && (f & (F_ROAD | F_URBAN | F_WATER)) === 0) hex = n > 0.93 ? 0xe7a0b8 : 0xf2d36b
        c.setHex(hex)
        const vary = 0.9 + n * 0.18
        colors[k++] = c.r * vary
        colors[k++] = c.g * vary
        colors[k++] = c.b * vary
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
          poles.push(x - dz * off * side, z + dx * off * side)
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
    const count = 70
    const upright = new THREE.BoxGeometry(0.1, 1.15, 0.05)
    upright.translate(0, 0.7, 0)
    const arm = new THREE.BoxGeometry(0.58, 0.08, 0.05)
    arm.translate(0, 0.95, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 })
    const a = new THREE.InstancedMesh(upright, mat, count)
    const b = new THREE.InstancedMesh(arm, mat, count)
    const dummy = new THREE.Object3D()
    let n = 0
    for (let i = 0; i < count * 3 && n < count; i++) {
      const x = m.x + (hash01(i * 3) - 0.5) * 78
      const z = m.z + 8 + hash01(i * 5) * 62
      if (this.height.flag(x, z) & (F_ROAD | F_WATER)) continue
      const y = this.height.sample(x, z)
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, hash01(i) * 0.6, 0)
      dummy.scale.set(1, 0.75 + hash01(i * 9) * 0.5, 1)
      dummy.updateMatrix()
      a.setMatrixAt(n, dummy.matrix)
      b.setMatrixAt(n, dummy.matrix)
      n++
    }
    a.count = n
    b.count = n
    this.root.add(a, b)
    const tex = makeSignTexture('Hillside overlook')
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.95), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
    const sx = m.x
    const sz = m.z + 36
    sign.position.set(sx, this.height.sample(sx, sz) + 1.6, sz)
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
    const roofs = new MeshBuilder()
    const bartWalls = new MeshBuilder()
    const bartShops = new MeshBuilder()
    const bartPaper = new MeshBuilder()
    const bartRoofs = new MeshBuilder()
    const bart = this.bartAt()
    for (const raw of data.building ?? []) {
      if (!Array.isArray(raw) || raw.length < 9) continue
      const height = Number(raw[0])
      const kind = String(raw[1])
      const name = String(raw[2] ?? '')
      const poly: number[] = []
      for (let i = 3; i < raw.length; i++) poly.push(Number(raw[i]))
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
      this.blockers.add(key, poly, this.roofOf(poly, height), later ? 1973 : null)
      const shop = kind === 'c' || kind === 's' || (name.length > 2 && height > 4)
      const target = later ? (rich ? (shop ? bartShops : bartWalls) : bartPaper) : rich ? (shop ? shops : walls) : paper
      this.extrude(poly, height, kind, target, later ? bartRoofs : roofs, rich)
    }
    this.addMesh(group, walls, this.windowMat, true)
    this.addMesh(group, shops, this.storeMat, true)
    this.addMesh(group, paper, this.paperMat, true)
    this.addMesh(group, roofs, this.roofMat, true)
    const station = new THREE.Group()
    station.name = 'bart-era'
    this.addMesh(station, bartWalls, this.windowMat, true)
    this.addMesh(station, bartShops, this.storeMat, true)
    this.addMesh(station, bartPaper, this.paperMat, true)
    this.addMesh(station, bartRoofs, this.roofMat, true)
    if (station.children.length > 0) {
      group.add(station)
      this.tagSpan(station, 1973, null)
    }
    this.addRoads(group, data.transportation ?? [], rich)
    this.addLanduse(group, data.landuse ?? [])
    this.addCrossings(group, data.crossing ?? [])
    this.addLabels(group, data, rich)
    if (data.tree?.length) this.addTrees(group, data.tree)
    if (data.reed?.length) this.addReeds(group, data.reed)
    if (data.parking?.length) this.addParking(group, data.parking)
    this.root.add(group)
    this.built.set(key, group)
  }

  private addMesh(group: THREE.Group, builder: MeshBuilder, material: THREE.Material, shadow: boolean): void {
    const geo = builder.geometry()
    if (!geo) return
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    mesh.userData.unique = true
    group.add(mesh)
  }

  private addRoads(group: THREE.Group, rows: unknown[][], rich: boolean): void {
    const casing = new MeshBuilder()
    const asphalt = new MeshBuilder()
    const walk = new MeshBuilder()
    const trail = new MeshBuilder()
    const paint = new MeshBuilder()
    const freewayCasing = new MeshBuilder()
    const freewayAsphalt = new MeshBuilder()
    const freewayPaint = new MeshBuilder()
    const casingColor = new THREE.Color(0xb7bcc4)
    const paved = new THREE.Color(0xe7eaee)
    const major = new THREE.Color(0xd5dae2)
    const walkColor = new THREE.Color(0xf6f3ec)
    const trailColor = new THREE.Color(0xc6a36a)
    const white = new THREE.Color(0xfbfcfb)
    const yellow = new THREE.Color(0xe6c84a)
    const named: { name: string; cls: string; x: number; z: number; len: number }[] = []
    for (const raw of rows) {
      if (!Array.isArray(raw) || raw.length < 10) continue
      const cls = String(raw[0])
      const name = String(raw[1] ?? '')
      const width = Number(raw[2])
      const flags = Number(raw[3])
      const pts: { x: number; y: number; z: number }[] = []
      for (let i = 4; i + 2 < raw.length; i += 3) {
        pts.push({ x: Number(raw[i]), y: Number(raw[i + 1]), z: Number(raw[i + 2]) })
      }
      if (pts.length < 2 || !Number.isFinite(width)) continue
      const dirt = (flags & 2) !== 0
      const sidewalk = (flags & 1) !== 0 && !dirt
      const big = /^(motorway|trunk|primary|secondary)/.test(cls)
      // Hwy 24 through Lafayette was first built c.1957–59. Before that it ran on the boulevard.
      const freeway = /^(motorway|trunk)/.test(cls)
      // Centerline stays on the surveyed path. Tight OSM trails are drawn wide enough for a bike.
      const trailWidth = dirt ? Math.max(width, cls === 'steps' ? 2.05 : 2.65) : width
      if (dirt) appendRibbon(trail, pts, trailWidth, trailColor, 0.05)
      else if (freeway) {
        appendRibbon(freewayCasing, pts, width + 0.55, casingColor, 0.07)
        appendRibbon(freewayAsphalt, pts, width, major, 0.1)
        if (width >= 6.5) {
          appendRibbon(freewayPaint, pts, width - 0.12, white, 0.14)
          appendRibbon(freewayAsphalt, pts, width - 1.2, major, 0.18)
        }
        if (width >= 8) this.dashes(freewayPaint, pts, yellow)
      } else {
        if (sidewalk) appendRibbon(walk, pts, width + 3.2, walkColor, 0.045)
        appendRibbon(casing, pts, width + 0.55, casingColor, 0.07)
        appendRibbon(asphalt, pts, width, big ? major : paved, 0.1)
        if (width >= 6.5 && cls !== 'service') {
          appendRibbon(paint, pts, width - 0.12, white, 0.14)
          appendRibbon(asphalt, pts, width - 1.2, big ? major : paved, 0.18)
        }
        if (big && width >= 8) this.dashes(paint, pts, yellow)
      }
      if (name.length > 2) {
        let len = 0
        for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)
        const mid = pts[Math.floor(pts.length / 2)]
        named.push({ name, cls, x: mid.x, z: mid.z, len })
      }
    }
    this.addMesh(group, walk, this.walkMat, false)
    this.addMesh(group, casing, this.walkMat, false)
    this.addMesh(group, asphalt, this.roadMat, false)
    this.addMesh(group, trail, this.trailMat, false)
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
    const seen = new Set<string>()
    named.sort((a, b) => b.len - a.len)
    for (const road of named) {
      if (seen.has(road.name)) continue
      const minor = /^(service|footway|path|track|steps|cycleway)$/.test(road.cls)
      if (road.cls === 'service') continue
      if (!rich && (minor || !/^(motorway|trunk|primary|secondary)/.test(road.cls))) continue
      seen.add(road.name)
      const label = this.addLabel(group, road.name, road.x, road.z, 'street')
      if (/^(motorway|trunk)/.test(road.cls)) this.tagSpan(label, 1957, null)
    }
  }

  private dashes(builder: MeshBuilder, pts: { x: number; y: number; z: number }[], color: THREE.Color): void {
    const dash = 3.1
    const gap = 4.6
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
          const y = a.y + (dy * (t0 + t1)) / (2 * len) + 0.18
          const c0x = a.x + ux * t0
          const c0z = a.z + uz * t0
          const c1x = a.x + ux * t1
          const c1z = a.z + uz * t1
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
    const color = new THREE.Color(0xc5e6a8)
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
    const white = new THREE.Color(0xf7f8f6)
    for (const cross of rows) {
      if (cross.length < 3) continue
      const ang = cross[2]
      const fwdX = Math.sin(ang)
      const fwdZ = -Math.cos(ang)
      const rx = Math.cos(ang)
      const rz = Math.sin(ang)
      const y = this.surface(cross[0], cross[1], null) + 0.2
      for (let s = -3; s <= 3; s++) {
        const ox = cross[0] + fwdX * s * 0.72
        const oz = cross[1] + fwdZ * s * 0.72
        const len = 2.8
        stripe.tri(
          ox - rx * len, y, oz - rz * len,
          ox + rx * len, y, oz + rz * len,
          ox - rx * len + fwdX * 0.34, y, oz - rz * len + fwdZ * 0.34,
          white,
        )
        stripe.tri(
          ox + rx * len, y, oz + rz * len,
          ox + rx * len + fwdX * 0.34, y, oz + rz * len + fwdZ * 0.34,
          ox - rx * len + fwdX * 0.34, y, oz - rz * len + fwdZ * 0.34,
          white,
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
      if (poi.k === 'place') {
        const label = this.addLabel(group, poi.n, poi.x, poi.z, 'place')
        if (nearStation) this.tagSpan(label, 1973, null)
        continue
      }
      if (!rich) continue
      if (seen.size > 36) continue
      const label = this.addLabel(group, poi.n, poi.x, poi.z, 'poi', poiAccent(poi.k))
      const pin = this.addPin(group, poi.x, poi.z, poiAccent(poi.k))
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

  private addPin(group: THREE.Group, x: number, z: number, accent: string): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ map: dotTexture(accent), transparent: true, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(x, this.height.sample(x, z) + 3.4, z)
    sprite.scale.set(2.4, 2.4, 1)
    sprite.renderOrder = 18
    mat.depthTest = false
    sprite.userData.label = 'pin'
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

  private extrude(poly: number[], height: number, kind: string, walls: MeshBuilder, roofs: MeshBuilder, rich: boolean): void {
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
    const paper = [0xf7f4ee, 0xf3efe6, 0xfbf8f2, 0xeae6de]
    let cx = 0
    let cz = 0
    for (let i = 0; i < n; i++) {
      cx += poly[i * 2]
      cz += poly[i * 2 + 1]
    }
    cx /= n
    cz /= n
    const custom = this.shopWall(cx, cz)
    const wallHex = custom ?? (rich && (kind === 'c' || kind === 's') ? 0xfffaf4 : paper[((salt % 4) + 4) % 4])
    const wallColor = tint(wallHex, salt)
    const roofColor = tint(0xe4dfd4, salt + 2)
    const aoColor = wallColor.clone().multiplyScalar(0.4)
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
    let u = 0
    for (let i = 0; i < n; i++) {
      const x1 = poly[i * 2]
      const z1 = poly[i * 2 + 1]
      const x2 = poly[((i + 1) % n) * 2]
      const z2 = poly[((i + 1) % n) * 2 + 1]
      const len = Math.hypot(x2 - x1, z2 - z1)
      if (len < 0.15) continue
      const u2 = u + len / 3.2
      const aoTop = Math.min(y0 + 2.1, y0 + (yTop - y0) * 0.42)
      const vAo = (aoTop - y0) / 3.2
      const vTop = (yTop - y0) / 3.2
      walls.tri(x1, y0, z1, x1, aoTop, z1, x2, y0, z2, aoColor, [u, 0, u, vAo, u2, 0])
      walls.tri(x1, aoTop, z1, x2, aoTop, z2, x2, y0, z2, aoColor, [u, vAo, u2, vAo, u2, 0])
      walls.tri(x1, aoTop, z1, x1, yTop, z1, x2, aoTop, z2, wallColor, [u, vAo, u, vTop, u2, vAo])
      walls.tri(x1, yTop, z1, x2, yTop, z2, x2, aoTop, z2, wallColor, [u, vTop, u2, vTop, u2, vAo])
      u = u2
    }
  }

  private addTrees(group: THREE.Group, flat: number[]): void {
    const count = flat.length / 3
    if (!count) return
    const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, count)
    const canopy = new THREE.InstancedMesh(this.canopyGeo, this.canopyMat, count)
    canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const x = flat[i * 3]
      const z = flat[i * 3 + 1]
      const variant = flat[i * 3 + 2]
      const y = this.height.sample(x, z)
      const wide = variant === 1
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, hash01(i * 11) * Math.PI, 0)
      dummy.scale.set(1, 0.85 + hash01(i) * 0.4, 1)
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
      dummy.position.set(x, y + 2.05, z)
      dummy.scale.set(wide ? 2.8 : 2.15, wide ? 1.55 : 1.9, wide ? 2.8 : 2.15)
      dummy.updateMatrix()
      canopy.setMatrixAt(i, dummy.matrix)
      color.setHex(this.canopyHex(x, z))
      canopy.setColorAt(i, color)
    }
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

  private canopyHex(x: number, z: number): number {
    const n = hash01(Math.round(x * 3 + z))
    if (this.season === 'spring') return n > 0.84 ? 0xe7a0b8 : n > 0.5 ? 0x4e9a48 : 0x6aaa3e
    if (this.season === 'winter') return n > 0.5 ? 0x2c6a3c : 0x3d7d48
    return n > 0.55 ? 0x6d8a32 : 0xa08a38
  }

  private paintCanopy(mesh: THREE.InstancedMesh): void {
    const color = new THREE.Color()
    const dummy = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, dummy)
      pos.setFromMatrixPosition(dummy)
      color.setHex(this.canopyHex(pos.x, pos.z))
      mesh.setColorAt(i, color)
    }
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
    const color = new THREE.Color(0xd7dbe2)
    for (const lot of lots) {
      if (lot.length < 6) continue
      const contour: THREE.Vector2[] = []
      for (let i = 0; i < lot.length; i += 2) contour.push(new THREE.Vector2(lot[i], lot[i + 1]))
      let faces: number[][] = []
      try {
        faces = THREE.ShapeUtils.triangulateShape(contour, [])
      } catch {
        faces = []
      }
      for (const face of faces) {
        const pts = face.map((idx) => {
          const x = lot[idx * 2]
          const z = lot[idx * 2 + 1]
          return { x, y: this.height.sample(x, z) + 0.07, z }
        })
        if (pts.length < 3) continue
        b.tri(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z, pts[2].x, pts[2].y, pts[2].z, color)
      }
    }
    const geo = b.geometry()
    if (!geo) return
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
    mesh.receiveShadow = true
    mesh.userData.unique = true
    group.add(mesh)
  }
}

export function signalGreen(x: number, z: number, time: number): boolean {
  const phase = hash01((Math.round(x) * 13 + Math.round(z) * 17) | 0)
  return (time * 0.13 + phase) % 1 > 0.42
}
