import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type Camera,
  type Scene,
} from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { Fn, float, instanceIndex, instancedArray, positionLocal, select, vec4 } from 'three/tsl'
import { F_BUILDING, F_PARK, F_PARKING, F_ROAD, F_URBAN, F_WATER, type Heightfield } from './height.ts'
import { hash01 } from './math.ts'
import { leafMaterial } from './materials.ts'
import type { Season } from './types.ts'
import { camPos, swayFromTip, viewProj } from './wind.ts'

const BLADE_MAX = 11000
const FLOWER_MAX = 2600
const CARPET_MAX = 9000
const TUFT_MAX = 1600

function crossGeo(height: number, width: number, painted: boolean): BufferGeometry {
  const positions: number[] = []
  const tips: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  for (const yaw of [0, Math.PI / 2, Math.PI / 5]) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const w = width
    positions.push(-c * w, 0, -s * w, c * w, 0, s * w, s * w * 0.15, height, -c * w * 0.15)
    tips.push(0, 0, 1)
    normals.push(-s, 0, c, -s, 0, c, 0, 1, 0)
    if (painted) {
      colors.push(0.72, 0.78, 0.62, 0.72, 0.78, 0.62, 1, 1, 0.9)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geo.setAttribute('tip', new BufferAttribute(new Float32Array(tips), 1))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  if (painted) geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geo.setIndex([0, 2, 1, 3, 5, 4, 6, 8, 7])
  geo.computeBoundingSphere()
  return geo
}

function palette(season: Season, kind: 'blade' | 'flower', n: number): number {
  if (kind === 'flower') {
    const spring = [0xf4f1ea, 0xf2d36b, 0xe07aa8, 0xf08a3a, 0xcfe7ff]
    const summer = [0xf2d36b, 0xf08a3a, 0xf4f1ea]
    const list = season === 'spring' ? spring : summer
    return list[n % list.length]
  }
  if (season === 'winter') return [0x2f7a3c, 0x3d8f48, 0x4aa05a, 0x26703a][n % 4]
  if (season === 'spring') return [0x5cb648, 0x7ec85a, 0x3f9a40, 0x8ed36a][n % 4]
  return [0xc4a24a, 0x8aaa3a, 0x6e9430, 0xd2b15a][n % 4]
}

/**
 * Instanced blades near the camera, clump cards farther out.
 * On WebGPU a compute pass masks blades outside the frustum.
 */
export class Meadow {
  season: Season = 'summer'
  private quality: 'low' | 'medium' | 'high'
  private dirty = true
  private cool = 0
  private ax = 1e9
  private az = 1e9
  private bladeCount = 0
  private gpu = false
  private cull: unknown = null
  private cullCount = -1
  private positions: { value: { array: Float32Array; needsUpdate: boolean }; element: (i: unknown) => unknown } | null = null
  private alive: { toAttribute: () => unknown; element: (i: unknown) => { assign: (v: unknown) => void } } | null = null
  private readonly blades: InstancedMesh
  private readonly flowers: InstancedMesh
  private readonly carpet: InstancedMesh
  private readonly tufts: InstancedMesh
  private readonly dummy = new Object3D()
  private readonly color = new Color()
  private readonly height: Heightfield

  constructor(scene: Scene, height: Heightfield, quality: 'low' | 'medium' | 'high') {
    this.height = height
    this.quality = quality
    const bladeMat = leafMaterial('blade')
    const flowerMat = leafMaterial('blade')
    const carpetMat = leafMaterial('blade')
    flowerMat.polygonOffsetFactor = -2
    const blades = new InstancedMesh(crossGeo(0.92, 0.09, true), bladeMat, BLADE_MAX)
    const flowers = new InstancedMesh(crossGeo(0.42, 0.16, true), flowerMat, FLOWER_MAX)
    const carpet = new InstancedMesh(crossGeo(1.15, 0.55, true), carpetMat, CARPET_MAX)
    for (const mesh of [blades, flowers, carpet]) {
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.count = 0
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3)
      scene.add(mesh)
    }
    this.blades = blades
    this.flowers = flowers
    this.carpet = carpet
    const tuftGeo = new PlaneGeometry(0.52, 0.74)
    tuftGeo.translate(0, 0.37, 0)
    const tufts = new InstancedMesh(
      tuftGeo,
      new MeshStandardMaterial({ roughness: 0.92, vertexColors: true, side: DoubleSide }),
      TUFT_MAX,
    )
    tufts.frustumCulled = false
    tufts.castShadow = false
    tufts.receiveShadow = true
    tufts.count = 0
    tufts.instanceColor = new InstancedBufferAttribute(new Float32Array(TUFT_MAX * 3), 3)
    scene.add(tufts)
    this.tufts = tufts
  }

  setQuality(quality: 'low' | 'medium' | 'high'): void {
    this.quality = quality
    this.dirty = true
  }

  setSeason(season: Season): void {
    this.season = season
    this.dirty = true
  }

  /** The instanced arrays belonged to a device that is gone. The next update builds them again. */
  releaseGpu(): void {
    this.gpu = false
    this.positions = null
    this.alive = null
    this.cull = null
    this.cullCount = -1
    const mat = this.blades.material as { positionNode?: unknown }
    mat.positionNode = undefined
    this.dirty = true
  }

  /** Rescatter on the next frame. Travel jumps farther than the stream cooldown. */
  bump(): void {
    this.dirty = true
    this.cool = 0
  }

  update(x: number, z: number, agl: number, camera: Camera, renderer: WebGPURenderer, webgpu: boolean, dt: number): void {
    if (webgpu && !this.gpu) this.setupGpu()
    this.cool -= dt
    const moved = Math.hypot(x - this.ax, z - this.az)
    if (this.dirty || (this.cool <= 0 && moved > 26)) {
      this.scatter(x, z, agl)
      this.ax = x
      this.az = z
      this.dirty = false
      this.cool = 0.45
    }
    if (this.gpu && this.bladeCount > 0) this.dispatch(renderer, camera)
    this.tufts.quaternion.copy(camera.quaternion)
  }

  private setupGpu(): void {
    try {
      const positions = instancedArray(BLADE_MAX, 'vec3') as unknown as NonNullable<Meadow['positions']>
      const alive = instancedArray(BLADE_MAX, 'float') as unknown as NonNullable<Meadow['alive']>
      const buf = positions.value
      buf.array.fill(0)
      buf.needsUpdate = true
      const vis = alive.toAttribute()
      const mat = this.blades.material as unknown as { positionNode: unknown }
      mat.positionNode = positionLocal.mul(vis as never).add(swayFromTip() as never)
      this.positions = positions
      this.alive = alive
      this.gpu = true
    } catch (err) {
      console.warn(err)
      this.gpu = false
    }
  }

  private dispatch(renderer: WebGPURenderer, camera: Camera): void {
    if (!this.positions || !this.alive) return
    if (this.cullCount !== this.bladeCount) {
      const positions = this.positions
      const alive = this.alive
      this.cull = Fn(() => {
        const pos = positions.element(instanceIndex) as any
        const clip = viewProj.mul(vec4(pos, 1))
        const ndcX = clip.x.div(clip.w)
        const ndcY = clip.y.div(clip.w)
        const inside = ndcX.abs().lessThan(1.25).and(ndcY.abs().lessThan(1.25)).and(clip.w.greaterThan(float(0)))
        const dist = pos.sub(camPos).length()
        const keep = inside.and(dist.lessThan(float(this.quality === 'low' ? 40 : 80)))
        alive.element(instanceIndex).assign(select(keep, float(1), float(0)))
      })().compute(this.bladeCount)
      this.cullCount = this.bladeCount
    }
    camPos.value.copy(camera.position)
    try {
      renderer.compute(this.cull as never)
    } catch (err) {
      console.warn(err)
      this.gpu = false
    }
  }

  private scatter(x: number, z: number, agl: number): void {
    const high = this.quality === 'high'
    const mid = this.quality === 'medium'
    const aloft = agl > 48
    const bladeR = aloft ? (high ? 26 : 14) : high ? 50 : mid ? 36 : 22
    const bladeStep = high ? 0.85 : mid ? 1.15 : 1.6
    const flowerR = Math.min(bladeR, this.season === 'winter' ? 0 : high ? 42 : 28)
    const flowerStep = this.season === 'spring' ? 1.65 : 4.6
    let blades = 0
    let flowers = 0
    let carpet = 0
    const pos = this.positions?.value.array

    const consider = (px: number, pz: number, kind: 'blade' | 'flower' | 'carpet') => {
      if (!this.open(px, pz)) return
      const y = this.height.sample(px, pz)
      const n = hash01((px * 10) | 0 ^ (pz * 13) | 0)
      const mesh = kind === 'blade' ? this.blades : kind === 'flower' ? this.flowers : this.carpet
      const index = kind === 'blade' ? blades : kind === 'flower' ? flowers : carpet
      const cap = kind === 'blade' ? BLADE_MAX : kind === 'flower' ? FLOWER_MAX : CARPET_MAX
      if (index >= cap) return
      const tall = kind === 'flower' ? 0.55 + n * 0.45 : kind === 'blade' ? 0.75 + n * 0.7 : 0.85 + n * 0.7
      const wide = kind === 'carpet' ? 1.6 + n * 1.5 : kind === 'flower' ? 0.7 + n * 0.5 : 0.75 + n * 0.45
      this.dummy.position.set(px, y, pz)
      this.dummy.rotation.set((n - 0.5) * 0.2, n * Math.PI * 2, (hash01(index + 3) - 0.5) * 0.18)
      this.dummy.scale.set(wide, tall, wide)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(index, this.dummy.matrix)
      this.color.setHex(palette(this.season, kind === 'flower' ? 'flower' : 'blade', (n * 7) | 0))
      mesh.setColorAt(index, this.color)
      if (kind === 'blade' && pos) {
        pos[index * 3] = px
        pos[index * 3 + 1] = y
        pos[index * 3 + 2] = pz
      }
      if (kind === 'blade') blades += 1
      else if (kind === 'flower') flowers += 1
      else carpet += 1
    }

    const grid = (radius: number, step: number, kind: 'blade' | 'flower' | 'carpet', inner = 0) => {
      if (radius <= inner) return
      const n = Math.ceil(radius / step)
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const px = x + i * step + (hash01(i * 19 + j * 7) - 0.5) * step
          const pz = z + j * step + (hash01(i * 3 + j * 23) - 0.5) * step
          const d = Math.hypot(px - x, pz - z)
          if (d > radius || d < inner) continue
          consider(px, pz, kind)
        }
      }
    }

    grid(bladeR, bladeStep, 'blade')
    if (flowerR > 4) grid(flowerR, flowerStep, 'flower')
    // Carpet crosses were the flat squares at low quality. Blades stay at every tier.

    let tufts = 0
    const tuftR = Math.min(bladeR, 34)
    const tuftN = Math.ceil(tuftR / 1.7)
    for (let j = -tuftN; j <= tuftN && tufts < TUFT_MAX; j++) {
      for (let i = -tuftN; i <= tuftN && tufts < TUFT_MAX; i++) {
        const px = x + i * 1.7 + (hash01(i * 11 + j) - 0.5) * 1.4
        const pz = z + j * 1.7 + (hash01(j * 17 + i) - 0.5) * 1.4
        if (Math.hypot(px - x, pz - z) > tuftR) continue
        if (!this.open(px, pz)) continue
        const n = hash01((px * 5) | 0 ^ (pz * 9) | 0)
        const flower = this.season !== 'winter' && n > (this.season === 'spring' ? 0.62 : 0.84)
        this.dummy.position.set(px, this.height.sample(px, pz), pz)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.scale.set(0.7 + n * 0.7, 0.75 + n * 0.8, 1)
        this.dummy.updateMatrix()
        this.tufts.setMatrixAt(tufts, this.dummy.matrix)
        this.color.setHex(flower ? palette(this.season, 'flower', (n * 5) | 0) : palette(this.season, 'blade', (n * 4) | 0))
        this.tufts.setColorAt(tufts, this.color)
        tufts += 1
      }
    }
    this.tufts.count = tufts
    this.tufts.instanceMatrix.needsUpdate = true
    if (this.tufts.instanceColor) this.tufts.instanceColor.needsUpdate = true

    this.bladeCount = blades
    this.blades.count = blades
    this.flowers.count = flowers
    this.carpet.count = carpet
    this.blades.instanceMatrix.needsUpdate = true
    this.flowers.instanceMatrix.needsUpdate = true
    this.carpet.instanceMatrix.needsUpdate = true
    if (this.blades.instanceColor) this.blades.instanceColor.needsUpdate = true
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true
    if (this.carpet.instanceColor) this.carpet.instanceColor.needsUpdate = true
    if (this.positions) this.positions.value.needsUpdate = true
    this.cullCount = -1
  }

  private open(x: number, z: number): boolean {
    if (!this.height.inBounds(x, z, 2)) return false
    const f = this.height.flag(x, z)
    if (f & (F_ROAD | F_WATER | F_BUILDING | F_PARKING)) return false
    if (f & F_URBAN && (f & F_PARK) === 0) return false
    return true
  }
}
