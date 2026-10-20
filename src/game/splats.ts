import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  TorusGeometry,
  type Camera,
  type Material,
  type Scene,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { uniform } from 'three/tsl'
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js'
import { SPZLoader } from 'three/addons/loaders/SPZLoader.js'
import { SPLATLoader } from 'three/addons/loaders/SPLATLoader.js'
import { GaussianSplatPLYLoader } from 'three/addons/loaders/GaussianSplatPLYLoader.js'
import { KSPLATLoader } from 'three/addons/loaders/KSPLATLoader.js'
import { createGaussianSplatGeometry } from 'three/addons/utils/GaussianSplatUtils.js'
import type { Quality } from './pipeline.ts'

/**
 * One resident Gaussian splat, stride-sampled to a count the frame can sort.
 * WebGPU sorts on the GPU. The WebGL fallback sorts on the CPU, so its cap
 * stays much lower. Three's splat mesh has no octree; distance streaming plus
 * this cap is the LOD.
 */
function capFor(quality: Quality, webgpu: boolean): number {
  if (webgpu) return quality === 'high' ? 80000 : quality === 'medium' ? 36000 : 16000
  return quality === 'high' ? 12000 : quality === 'medium' ? 8000 : 5000
}

const POCKET_X = -14000
const POCKET_Y = 42
const POCKET_Z = 2400
const ROOM = 12

export interface MemorySwap {
  kind: 'enter' | 'exit'
  x: number
  y: number
  z: number
  heading: number
  title: string
  blurb: string
  credit: string
}

export interface PortalHint {
  prompt: string | null
  use: string | null
}

interface SplatRecord {
  id: string
  file: string
  format: 'spz' | 'splat' | 'ply' | 'ksplat'
  anchor: string
  placeholder: boolean
  title: string
  blurb: string
  credit: string
  position: [number, number, number]
  rotation: [number, number, number]
  yaw: number
  scale: number
  fitHeight: number
  memoryFitHeight: number
  blendIn: number
  blendOut: number
  stream: number
  budget: number
  lat: number | null
  lon: number | null
}

interface Fit {
  cx: number
  cz: number
  minY: number
  height: number
}

interface SplatMesh extends Mesh {
  autoSort: boolean
  splatGeometry: BufferGeometry
  updateSort: (renderer: WebGPURenderer, camera: Camera) => boolean
}

interface Capture extends SplatRecord {
  x: number
  y: number
  z: number
  placeName: string
  placed: boolean
  state: 'idle' | 'loading' | 'ready' | 'error'
  source: BufferGeometry | null
  fit: Fit | null
  mesh: SplatMesh | null
  fade: { value: number } | null
  applied: number
  sorted: boolean
  rig: Group
  door: Group
}

interface AnchorSpot {
  id: string
  name: string
  x: number
  z: number
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function vec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback
  return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
}

function kindOf(file: string, format: unknown): SplatRecord['format'] | null {
  const raw = typeof format === 'string' && format ? format : file.split('.').pop() || ''
  const ext = raw.toLowerCase().replace(/^\./, '')
  if (ext === 'spz' || ext === 'splat' || ext === 'ply' || ext === 'ksplat') return ext
  return null
}

function parseRecord(value: unknown): SplatRecord | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const file = typeof row.file === 'string' ? row.file.trim() : ''
  const anchor = typeof row.anchor === 'string' ? row.anchor.trim() : ''
  const format = kindOf(file, row.format)
  if (!file || !anchor || !format) return null
  if (file.includes('/') || file.includes('\\') || file.includes('..')) return null
  const lat = typeof row.lat === 'number' ? row.lat : null
  const lon = typeof row.lon === 'number' ? row.lon : null
  return {
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : anchor,
    file,
    format,
    anchor,
    placeholder: row.placeholder === true,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : anchor,
    blurb: typeof row.blurb === 'string' ? row.blurb.trim() : '',
    credit: typeof row.credit === 'string' ? row.credit.trim() : '',
    position: vec3(row.position, [0, 0, 0]),
    rotation: vec3(row.rotation, [0, 0, 0]),
    yaw: num(row.yaw, 0),
    scale: Math.max(0.01, num(row.scale, 1)),
    fitHeight: Math.max(0.2, num(row.fitHeight, 2.4)),
    memoryFitHeight: Math.max(0.2, num(row.memoryFitHeight, 4.5)),
    blendIn: Math.max(1, num(row.blendIn, 10)),
    blendOut: Math.max(4, num(row.blendOut, 24)),
    stream: Math.max(12, num(row.stream, 70)),
    budget: Math.max(1000, Math.round(num(row.budget, 80000))),
    lat,
    lon,
  }
}

export async function loadSplatManifest(base: string): Promise<SplatRecord[]> {
  try {
    const res = await fetch(`${base}splats/manifest.json`)
    if (!res.ok) return []
    const data = (await res.json()) as { captures?: unknown } | unknown[]
    const rows = Array.isArray(data) ? data : data.captures
    if (!Array.isArray(rows)) return []
    return rows.map(parseRecord).filter((row): row is SplatRecord => row !== null)
  } catch (err) {
    console.warn(err)
    return []
  }
}

async function loadGeometry(url: string, format: SplatRecord['format']): Promise<BufferGeometry> {
  if (format === 'ply') return new GaussianSplatPLYLoader().loadAsync(url)
  if (format === 'splat') return new SPLATLoader().loadAsync(url)
  if (format === 'ksplat') return new KSPLATLoader().loadAsync(url)
  const parsed = await new SPZLoader().loadAsync(url)
  return parsed
}

function measure(geometry: BufferGeometry): Fit {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) return { cx: 0, cz: 0, minY: 0, height: 1 }
  return {
    cx: (box.min.x + box.max.x) * 0.5,
    cz: (box.min.z + box.max.z) * 0.5,
    minY: box.min.y,
    height: Math.max(0.05, box.max.y - box.min.y),
  }
}

function budgetGeometry(source: BufferGeometry, maxCount: number): BufferGeometry {
  const position = source.getAttribute('position')
  const covariance = source.getAttribute('covariance')
  const color = source.getAttribute('color')
  const count = position.count
  if (count <= maxCount) return source
  const colors = color.array as Uint8Array
  let alive = 0
  for (let i = 0; i < count; i++) if ((colors[i * 4 + 3] ?? 0) >= 10) alive++
  const filter = alive >= maxCount
  const indices: number[] = []
  for (let i = 0; i < count; i++) {
    if (!filter || (colors[i * 4 + 3] ?? 0) >= 10) indices.push(i)
  }
  const out = Math.min(maxCount, indices.length)
  const centers = new Float32Array(out * 3)
  const covariances = new Float32Array(out * 6)
  const outColors = new Uint8ClampedArray(out * 4)
  const pos = position.array as Float32Array
  const cov = covariance.array as Float32Array
  const step = indices.length / out
  for (let k = 0; k < out; k++) {
    const i = indices[Math.min(indices.length - 1, Math.floor(k * step))] ?? 0
    centers.set(pos.subarray(i * 3, i * 3 + 3), k * 3)
    covariances.set(cov.subarray(i * 6, i * 6 + 6), k * 6)
    outColors.set(colors.subarray(i * 4, i * 4 + 4), k * 4)
  }
  return createGaussianSplatGeometry(centers, covariances, outColors)
}

function approach(x: number, z: number, yaw: number, dist: number): { x: number; z: number } {
  return { x: x + Math.sin(yaw) * dist, z: z + Math.cos(yaw) * dist }
}

function headingToward(yaw: number): number {
  return Math.atan2(-Math.sin(yaw), Math.cos(yaw))
}

function buildDoor(frame: MeshStandardMaterial, glow: MeshBasicMaterial): { group: Group; light: PointLight } {
  const group = new Group()
  const post = new BoxGeometry(0.16, 3.05, 0.18)
  const left = new Mesh(post, frame)
  left.position.set(-1.05, 1.52, 0)
  const right = new Mesh(post, frame)
  right.position.set(1.05, 1.52, 0)
  const lintel = new Mesh(new BoxGeometry(2.26, 0.18, 0.18), frame)
  lintel.position.set(0, 3.08, 0)
  const sill = new Mesh(new BoxGeometry(2.26, 0.08, 0.7), frame)
  sill.position.set(0, 0.04, 0.1)
  const ring = new Mesh(new TorusGeometry(0.78, 0.045, 10, 32), frame)
  ring.name = 'ring'
  ring.position.set(0, 1.72, 0.08)
  const veil = new Mesh(new CircleGeometry(0.72, 28), glow)
  veil.position.set(0, 1.72, 0.02)
  const light = new PointLight(0xffc56a, 2.2, 8, 2)
  light.position.set(0, 1.8, 0.7)
  light.castShadow = false
  group.add(left, right, lintel, sill, ring, veil, light)
  return { group, light }
}

export class MemoryPortals {
  onSwap: ((swap: MemorySwap) => void) | null = null
  inside = false
  locked = false
  holdX = 0
  holdZ = 0
  label = ''

  private readonly captures: Capture[] = []
  private readonly frameMat: MeshStandardMaterial
  private readonly glowMat: MeshBasicMaterial
  private readonly returnDoor: Group
  private readonly returnLight: PointLight
  private readonly disc: Mesh
  private active: Capture | null = null
  private memory: Capture | null = null
  private phase: 'idle' | 'cover' | 'reveal' = 'idle'
  private phaseT = 0
  private pending: 'enter' | 'exit' = 'enter'
  private glowT = 0
  private sortTick = 0
  private nearWorld = false
  private nearReturn = false
  private webgpu = false
  private broken = false
  private readonly returnPose = { x: 0, y: 0, z: 0, heading: 0 }
  private readonly base: string

  constructor(scene: Scene, base: string, records: SplatRecord[]) {
    this.base = base
    this.frameMat = new MeshStandardMaterial({
      color: 0x4a341c,
      emissive: 0xffb347,
      emissiveIntensity: 1.8,
      roughness: 0.42,
      metalness: 0.08,
    })
    this.glowMat = new MeshBasicMaterial({
      color: 0xffe2ae,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    })
    const back = buildDoor(this.frameMat, this.glowMat)
    this.returnDoor = back.group
    this.returnDoor.name = 'memory-return'
    this.returnLight = back.light
    this.returnDoor.position.set(POCKET_X, POCKET_Y, POCKET_Z + 5.2)
    this.returnDoor.rotation.y = Math.PI
    this.returnDoor.visible = false
    scene.add(this.returnDoor)

    this.disc = new Mesh(
      new CylinderGeometry(14, 14.8, 0.32, 36),
      new MeshStandardMaterial({ color: 0xe6d3b2, roughness: 0.94, metalness: 0 }),
    )
    this.disc.position.set(POCKET_X, POCKET_Y - 0.16, POCKET_Z)
    this.disc.receiveShadow = true
    this.disc.visible = false
    scene.add(this.disc)

    for (const record of records) {
      const rig = new Group()
      rig.name = `splat-${record.id}`
      scene.add(rig)
      const door = buildDoor(this.frameMat, this.glowMat).group
      door.name = `portal-${record.id}`
      door.visible = false
      scene.add(door)
      this.captures.push({
        ...record,
        x: 0,
        y: 0,
        z: 0,
        placeName: record.anchor,
        placed: false,
        state: 'idle',
        source: null,
        fit: null,
        mesh: null,
        fade: null,
        applied: 0,
        sorted: false,
        rig,
        door,
      })
    }
  }

  anchor(
    places: AnchorSpot[],
    origin: { lat: number; lon: number },
    ground: (x: number, z: number) => number,
    blocked: (x: number, z: number) => boolean,
  ): void {
    const mLat = 111320
    const mLon = 111320 * Math.cos((origin.lat * Math.PI) / 180)
    for (const cap of this.captures) {
      const spot = places.find((place) => place.id === cap.anchor)
      if (!spot) {
        console.warn(`Splat ${cap.id} has no anchor “${cap.anchor}” inside the walk.`)
        continue
      }
      let x = spot.x
      let z = spot.z
      if (cap.lat != null && cap.lon != null) {
        x = (cap.lon - origin.lon) * mLon
        z = -(cap.lat - origin.lat) * mLat
      }
      const open = this.openSpot(x, z, blocked)
      const y = ground(open.x, open.z)
      cap.x = open.x
      cap.y = y
      cap.z = open.z
      cap.placeName = spot.name
      cap.placed = true
      cap.door.visible = true
      cap.door.position.set(open.x, y, open.z)
      cap.door.rotation.y = (cap.yaw * Math.PI) / 180
      this.poseWorld(cap)
    }
  }

  stand(id: string): { x: number; z: number; lookX: number; lookZ: number } | null {
    const cap = this.captures.find((row) => row.placed && (row.anchor === id || row.id === id))
    if (!cap) return null
    const yaw = (cap.yaw * Math.PI) / 180
    const at = approach(cap.x, cap.z, yaw, 2.4)
    return { x: at.x, z: at.z, lookX: cap.x, lookZ: cap.z }
  }

  hint(onFoot: boolean, touch: boolean): PortalHint {
    if (this.locked) {
      const leaving = this.inside || this.pending === 'exit'
      return {
        prompt: leaving ? 'Stepping back outside…' : 'Stepping through…',
        use: leaving ? 'Back' : 'Enter',
      }
    }
    if (this.inside && this.memory) {
      const back = this.nearReturn
        ? touch
          ? 'Tap Back to step outside'
          : 'Press E to step back outside'
        : 'The glowing door behind you leads back'
      return { prompt: back, use: 'Back' }
    }
    if (!this.nearWorld || !onFoot) return { prompt: null, use: null }
    const cap = this.active
    if (!cap || cap.state === 'error') return { prompt: 'This memory couldn’t be opened', use: null }
    if (cap.state !== 'ready') return { prompt: 'The memory is still gathering', use: 'Enter' }
    return {
      prompt: touch ? 'Tap Enter to step through' : 'Press E to step into the memory',
      use: 'Enter',
    }
  }

  tryUse(onFoot: boolean): 'go' | 'wait' | 'error' | null {
    if (this.locked || this.phase !== 'idle') return null
    if (this.inside) {
      if (!this.nearReturn || !this.memory) return null
      this.pending = 'exit'
      this.phase = 'cover'
      this.phaseT = 0
      this.locked = true
      this.veil(true)
      return 'go'
    }
    if (!onFoot || !this.nearWorld || !this.active) return null
    const cap = this.active
    if (cap.state === 'error') return 'error'
    if (cap.state !== 'ready') {
      this.ensure(cap)
      return 'wait'
    }
    this.pending = 'enter'
    this.memory = cap
    this.phase = 'cover'
    this.phaseT = 0
    this.locked = true
    this.veil(true)
    return 'go'
  }

  forceExit(): void {
    const wasInside = this.inside
    this.phase = 'idle'
    this.phaseT = 0
    this.locked = false
    this.veil(false)
    if (!wasInside) return
    this.finish('exit')
  }

  contain(x: number, z: number, ease: (dx: number, dz: number) => void): void {
    if (!this.inside || this.locked) return
    const dx = x - POCKET_X
    const dz = z - POCKET_Z
    const dist = Math.hypot(dx, dz)
    if (dist <= ROOM) return
    const scale = ROOM / (dist || 1)
    ease(POCKET_X + dx * scale - x, POCKET_Z + dz * scale - z)
  }

  update(
    dt: number,
    x: number,
    y: number,
    z: number,
    streaming: boolean,
    renderer: WebGPURenderer,
    camera: Camera,
    quality: Quality,
  ): void {
    this.glowT += dt
    const pulse = 0.65 + Math.sin(this.glowT * 2.6) * 0.35
    this.frameMat.emissiveIntensity = 1.15 + pulse * 1.5
    this.glowMat.opacity = 0.14 + pulse * 0.24
    this.spin(this.returnDoor)
    for (const cap of this.captures) this.spin(cap.door)

    if (this.phase === 'cover') {
      this.phaseT += dt
      this.veil(true)
      if (this.phaseT >= 0.42) {
        this.finish(this.pending)
        this.phase = 'reveal'
        this.phaseT = 0
        this.veil(false)
      }
    } else if (this.phase === 'reveal') {
      this.phaseT += dt
      if (this.phaseT >= 0.48) {
        this.phase = 'idle'
        this.locked = false
      }
    }

    const backend = renderer.backend as { isWebGPUBackend?: boolean } | undefined
    this.webgpu = backend?.isWebGPUBackend === true
    const want = this.pick(x, z, streaming)
    if (want && want !== this.active && !this.inside) {
      if (this.active) this.dropMesh(this.active)
      this.active = want
    }
    if (!want && this.active && !this.inside) {
      this.dropMesh(this.active)
      this.active = null
    }
    if (streaming && this.active) this.ensure(this.active)

    const budget = this.active ? Math.min(this.active.budget, capFor(quality, this.webgpu)) : 0
    if (this.active?.source && this.active.fit && budget > 0 && this.active.applied !== budget) {
      this.mount(this.active, budget)
    }

    this.nearWorld = false
    this.nearReturn = false
    if (this.inside && this.memory) {
      const yaw = Math.PI
      const at = approach(POCKET_X, POCKET_Z + 5.2, yaw, 1.55)
      this.nearReturn = Math.hypot(x - at.x, z - at.z) < 1.7 && Math.abs(y - POCKET_Y) < 3
      this.poseMemory(this.memory)
    } else if (this.active?.placed) {
      const yaw = (this.active.yaw * Math.PI) / 180
      const at = approach(this.active.x, this.active.z, yaw, 1.7)
      this.nearWorld = Math.hypot(x - at.x, z - at.z) < 2.05 && Math.abs(y - this.active.y) < 2.6
      this.poseWorld(this.active)
      const dist = Math.hypot(x - (this.active.x + this.active.position[0]), z - (this.active.z + this.active.position[2]))
      const fade = this.fadeFor(this.active, dist)
      this.applyFade(this.active, fade)
    }

    this.returnDoor.visible = this.inside
    this.returnLight.intensity = this.inside ? 1.5 + pulse * 2.2 : 0
    this.disc.visible = this.inside
    this.label = this.inside && this.memory ? `Memory · ${this.memory.placeName}` : ''

    const mesh = (this.inside ? this.memory : this.active)?.mesh
    if (!mesh || !mesh.visible || this.broken) return
    if (this.webgpu) {
      mesh.autoSort = true
      return
    }
    mesh.autoSort = false
    this.sortTick++
    if (mesh && (this.sortTick % 3 === 0 || !this.sorted(mesh))) {
      try {
        mesh.updateSort(renderer, camera)
        this.markSorted(mesh)
      } catch (err) {
        console.warn(err)
        this.broken = true
        mesh.visible = false
      }
    }
  }

  private sorted(mesh: SplatMesh): boolean {
    return this.captures.some((cap) => cap.mesh === mesh && cap.sorted)
  }

  private markSorted(mesh: SplatMesh): void {
    for (const cap of this.captures) if (cap.mesh === mesh) cap.sorted = true
  }

  private fadeFor(cap: Capture, dist: number): number {
    if (dist <= cap.blendIn) return 1
    if (dist >= cap.blendOut) return 0
    return 1 - (dist - cap.blendIn) / (cap.blendOut - cap.blendIn)
  }

  private applyFade(cap: Capture, amount: number): void {
    if (!cap.mesh || !cap.fade) return
    cap.fade.value = amount
    cap.mesh.visible = amount > 0.03
  }

  private poseWorld(cap: Capture): void {
    const [ox, oy, oz] = cap.position
    const [rx, ry, rz] = cap.rotation
    cap.rig.position.set(cap.x + ox, cap.y + oy, cap.z + oz)
    cap.rig.rotation.copy(new Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'YXZ'))
    const height = cap.fit?.height ?? 1
    cap.rig.scale.setScalar((cap.fitHeight / height) * cap.scale)
  }

  private poseMemory(cap: Capture): void {
    const [rx, ry, rz] = cap.rotation
    cap.rig.position.set(POCKET_X, POCKET_Y, POCKET_Z - 4.2)
    cap.rig.rotation.copy(new Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'YXZ'))
    const height = cap.fit?.height ?? 1
    cap.rig.scale.setScalar((cap.memoryFitHeight / height) * cap.scale)
    if (cap.fade) cap.fade.value = 1
    if (cap.mesh) cap.mesh.visible = true
  }

  private pick(x: number, z: number, streaming: boolean): Capture | null {
    if (this.inside && this.memory) return this.memory
    if (!streaming) return this.active
    let best: Capture | null = null
    let bestD = Infinity
    for (const cap of this.captures) {
      if (!cap.placed) continue
      const dist = Math.hypot(x - cap.x, z - cap.z)
      if (dist < cap.stream && dist < bestD) {
        best = cap
        bestD = dist
      }
    }
    if (best) return best
    if (this.active?.placed) {
      const dist = Math.hypot(x - this.active.x, z - this.active.z)
      if (dist < this.active.stream * 1.65) return this.active
    }
    return null
  }

  private ensure(cap: Capture): void {
    if (cap.state !== 'idle') return
    cap.state = 'loading'
    const url = `${this.base}splats/${cap.file}`
    loadGeometry(url, cap.format)
      .then((geometry) => {
        cap.source = geometry
        cap.fit = measure(geometry)
        cap.state = 'ready'
      })
      .catch((err) => {
        console.warn(err)
        cap.state = 'error'
      })
  }

  private mount(cap: Capture, budget: number): void {
    if (!cap.source || !cap.fit) return
    this.dropMesh(cap)
    try {
      const geometry = budgetGeometry(cap.source, budget)
      const mesh = new GaussianSplat(geometry) as SplatMesh
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.renderOrder = 2
      mesh.autoSort = this.webgpu
      const fade = uniform(1) as { value: number }
      const material = mesh.material as Material & { opacityNode?: unknown; depthTest: boolean; depthWrite: boolean; transparent: boolean }
      material.transparent = true
      material.depthTest = true
      material.depthWrite = false
      material.opacityNode = fade
      mesh.position.set(-cap.fit.cx, -cap.fit.minY, -cap.fit.cz)
      cap.rig.add(mesh)
      cap.mesh = mesh
      cap.fade = fade
      cap.applied = budget
      cap.sorted = false
    } catch (err) {
      console.warn(err)
      cap.state = 'error'
      cap.applied = budget
    }
  }

  private dropMesh(cap: Capture): void {
    const mesh = cap.mesh
    if (!mesh) return
    mesh.removeFromParent()
    mesh.geometry.dispose()
    if (mesh.splatGeometry !== cap.source) mesh.splatGeometry.dispose()
    const material = mesh.material
    if (!Array.isArray(material)) material.dispose()
    cap.mesh = null
    cap.fade = null
    cap.sorted = false
    cap.applied = 0
  }

  private finish(kind: 'enter' | 'exit'): void {
    if (kind === 'enter' && this.memory) {
      const cap = this.memory
      const yaw = (cap.yaw * Math.PI) / 180
      const at = approach(cap.x, cap.z, yaw, 2.15)
      this.returnPose.x = at.x
      this.returnPose.y = cap.y
      this.returnPose.z = at.z
      this.returnPose.heading = headingToward(yaw)
      this.inside = true
      this.holdX = cap.x
      this.holdZ = cap.z
      this.onSwap?.({
        kind: 'enter',
        x: POCKET_X,
        y: POCKET_Y,
        z: POCKET_Z,
        heading: 0,
        title: cap.title,
        blurb: cap.blurb,
        credit: cap.credit,
      })
      return
    }
    const pose = this.returnPose
    this.inside = false
    this.onSwap?.({
      kind: 'exit',
      x: pose.x,
      y: pose.y,
      z: pose.z,
      heading: pose.heading,
      title: '',
      blurb: '',
      credit: '',
    })
  }

  private spin(group: Group): void {
    const ring = group.getObjectByName('ring')
    if (ring) ring.rotation.z = this.glowT * 0.45
  }

  private veil(shut: boolean): void {
    const el = document.getElementById('portal-veil')
    if (!el) return
    el.classList.toggle('shut', shut)
  }

  private openSpot(x: number, z: number, blocked: (x: number, z: number) => boolean): { x: number; z: number } {
    if (!blocked(x, z)) return { x, z }
    for (let radius = 3; radius <= 24; radius += 3) {
      for (let step = 0; step < 8; step++) {
        const ang = (step / 8) * Math.PI * 2
        const nx = x + Math.cos(ang) * radius
        const nz = z + Math.sin(ang) * radius
        if (!blocked(nx, nz)) return { x: nx, z: nz }
      }
    }
    return { x, z }
  }
}
