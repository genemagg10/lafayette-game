import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PMREMGenerator,
  RenderPipeline,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGPURenderer,
  type Camera,
  type DirectionalLight,
  type Texture,
} from 'three/webgpu'
import {
  Fn,
  Loop,
  add,
  dot,
  float,
  getViewPosition,
  length,
  max,
  mix,
  mul,
  normalize,
  pow,
  screenUV,
  smoothstep,
  texture3D,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { pass } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { createLut, fogHeight } from './grade.ts'
import { camPos, camWorld, dofGain, invProj, overcastShade, shaftColor, shaftGain, sunClip, sunDirShade, sunOn, valleyFog } from './wind.ts'
import GTAONode from 'three/addons/tsl/display/GTAONode.js'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { blurAmount, eraFilm, gradeGolden, gradeNight } from './materials.ts'
import type { Sky } from './sky.ts'

export type Quality = 'low' | 'medium' | 'high'

const LOST = /createBuffer|too large|out of memory|device lost|depthTexture|backend is initialized|getSupportedExtensions/i

type GpuNavigator = {
  requestAdapter?: () => Promise<unknown>
  getPreferredCanvasFormat?: () => string
}

type AdapterInfo = {
  vendor?: string
  architecture?: string
  device?: string
  description?: string
}

/**
 * Phone, or a window too short to spend a desktop shadow budget.
 * One predicate feeds the starting tier, the reflector, and the cascade choice.
 */
export function prefersMobile(): boolean {
  return matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 820
}

export class Picture {
  renderer: WebGPURenderer
  pipeline: RenderPipeline
  quality: Quality
  webgpu = false
  bloomOn = true
  /** Frames that actually presented. Compile hitches before the first one do not count. */
  presented = 0
  /** Stop the frame loop. The backend is not safe to render. */
  terminal = false
  gpuLine = ''
  onCanvas: ((canvas: HTMLCanvasElement) => void) | null = null
  onRecovered: (() => void) | null = null
  onTerminal: (() => void) | null = null

  private env: { texture: Texture; dispose: () => void } | null = null
  private pmrem: PMREMGenerator | null = null
  private failed = false
  private pendingFallback = false
  private swapping = false
  private disposing = false
  private sawDevice = false
  private watchGen = 0
  private marchOn = false
  private sky: Sky | null = null
  private gpuQuery: string | null
  private loseLeft: number
  private loseReady = false
  private framesSinceArm = 0
  private armFrame = 0
  private bloomNode: { strength: { value: number }; radius: { value: number } } | null = null
  private readonly lut = createLut()
  private csm: CSMShadowNode | null = null

  private canvas: HTMLCanvasElement
  private readonly scene: Scene
  private readonly camera: Camera
  private readonly sun: DirectionalLight

  constructor(canvas: HTMLCanvasElement, scene: Scene, camera: Camera, sun: DirectionalLight, quality: Quality, gpuQuery: string | null) {
    this.canvas = canvas
    this.scene = scene
    this.camera = camera
    this.sun = sun
    this.quality = quality
    this.gpuQuery = gpuQuery
    this.loseLeft = gpuQuery === 'lose' ? 2 : 0
    this.renderer = this.mountRenderer(gpuQuery === 'webgl')
    this.pipeline = new RenderPipeline(this.renderer)
    this.bindVisibility()
  }

  get busy(): boolean {
    return this.swapping || this.terminal || this.failed
  }

  isMobile(): boolean {
    return prefersMobile()
  }

  /** WebGPU when the browser has it. A lost device gets a new canvas before the next backend. */
  private mountRenderer(forceWebGL: boolean): WebGPURenderer {
    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      forceWebGL,
      outputBufferType: this.quality === 'low' ? UnsignedByteType : undefined,
    })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = this.quality !== 'low'
    renderer.shadowMap.type = PCFSoftShadowMap
    return renderer
  }

  async init(sky: Sky): Promise<void> {
    this.sky = sky
    try {
      await this.renderer.init()
    } catch (err) {
      console.warn(err)
      await this.recoverFromInit()
      return
    }
    this.finishInit(this.gpuQuery === 'webgl')
  }

  private backendIsWebGPU(): boolean {
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean }
    return backend.isWebGPUBackend === true
  }

  private finishInit(forceWebGL: boolean): void {
    this.webgpu = this.backendIsWebGPU() && !forceWebGL
    if (this.webgpu) this.sawDevice = true
    this.armDeviceWatch()
    this.applyShadowBudget()
    this.pmrem = new PMREMGenerator(this.renderer)
    if (this.sky) {
      try {
        this.refreshEnvironment(this.sky)
      } catch (err) {
        console.warn(err)
      }
    }
    dofGain.value = this.quality === 'high' ? 0.04 : 0
    this.compose()
    this.publishInfo()
    this.armFrame = (this.renderer.info as { render?: { frame?: number } } | undefined)?.render?.frame ?? 0
    this.framesSinceArm = 0
    this.loseReady = false
  }

  private publishInfo(): void {
    const backend = this.renderer.backend as {
      isWebGPUBackend?: boolean
      adapter?: { info?: AdapterInfo; isFallbackAdapter?: boolean; features?: { has: (name: string) => boolean } }
      device?: { limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number; maxTextureDimension2D?: number; maxColorAttachments?: number } }
    }
    const info = backend.adapter?.info
    const limits = backend.device?.limits
    const named = info ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') : 'no-adapter'
    const gpu = (navigator as Navigator & { gpu?: GpuNavigator }).gpu
    const format = gpu?.getPreferredCanvasFormat?.() ?? 'n/a'
    const core = backend.adapter?.features?.has('core-features-and-limits') ? 'core-features-and-limits' : 'no-core-features-and-limits'
    this.gpuLine = [
      named,
      backend.adapter?.isFallbackAdapter ? 'fallback-adapter' : 'adapter',
      core,
      `maxBufferSize=${limits?.maxBufferSize ?? 0}`,
      `maxStorageBufferBindingSize=${limits?.maxStorageBufferBindingSize ?? 0}`,
      `maxTextureDimension2D=${limits?.maxTextureDimension2D ?? 0}`,
      `maxColorAttachments=${limits?.maxColorAttachments ?? 0}`,
      `canvas=${format}`,
      `samples=${this.renderer.samples}`,
      this.webgpu ? 'webgpu' : 'webgl',
    ].join(' ')
    if (this.gpuQuery === 'info') console.info(this.gpuLine)
  }

  private applyShadowBudget(): void {
    const low = this.quality === 'low'
    const vivid = this.quality === 'high' && this.webgpu && !this.isMobile()
    if (!vivid) this.clearCascades()
    const size = low ? 256 : vivid ? 1024 : 512
    this.sun.shadow.mapSize.set(size, size)
    this.sun.shadow.radius = 4
    this.sun.shadow.bias = -0.0002
    this.sun.shadow.normalBias = 0.03
    this.renderer.shadowMap.enabled = !low
    this.renderer.shadowMap.type = PCFSoftShadowMap
    if (vivid && !this.csm) {
      try {
        this.cascades()
      } catch (err) {
        console.warn(err)
      }
    }
  }

  private armDeviceWatch(): void {
    const backend = this.renderer.backend as {
      device?: {
        lost: Promise<{ message?: string; reason?: string }>
        addEventListener?: (type: string, cb: (event: Event) => void) => void
      }
    }
    const device = backend.device
    if (!this.webgpu || !device) return
    const gen = this.watchGen
    device.lost.then((info) => {
      if (gen !== this.watchGen || this.disposing) return
      console.warn('WebGPU device lost', info?.reason ?? '', info?.message ?? '')
      this.pendingFallback = true
    }).catch((err) => {
      if (gen !== this.watchGen || this.disposing) return
      console.warn(err)
      this.pendingFallback = true
    })
    device.addEventListener?.('uncapturederror', (event: Event) => {
      if (gen !== this.watchGen || this.disposing) return
      const message = String((event as { error?: { message?: string } }).error?.message ?? '')
      if (LOST.test(message)) {
        console.warn(message)
        this.pendingFallback = true
      }
    })
  }

  private bindVisibility(): void {
    const wake = () => {
      if (document.hidden || this.swapping || this.terminal || !this.webgpu || !this.sawDevice) return
      const renderer = this.renderer as unknown as { _isDeviceLost?: boolean }
      const backend = this.renderer.backend as { isDeviceLost?: boolean }
      if (renderer._isDeviceLost || backend.isDeviceLost) this.pendingFallback = true
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) wake()
    })
    window.addEventListener('pageshow', () => wake())
  }

  private swapCanvas(): void {
    const next = this.canvas.cloneNode(false) as HTMLCanvasElement
    next.width = this.canvas.width
    next.height = this.canvas.height
    this.canvas.replaceWith(next)
    this.canvas = next
    this.onCanvas?.(next)
  }

  private disposeRenderer(): void {
    this.watchGen += 1
    this.disposing = true
    this.clearCascades()
    try {
      this.env?.dispose()
    } catch (err) {
      console.warn(err)
    }
    this.env = null
    try {
      this.pmrem?.dispose()
    } catch (err) {
      console.warn(err)
    }
    this.pmrem = null
    try {
      this.renderer.dispose()
    } catch (err) {
      console.warn(err)
    }
    this.disposing = false
  }

  private async swapRenderer(forceWebGL: boolean): Promise<boolean> {
    try {
      this.disposeRenderer()
      this.swapCanvas()
      this.renderer = this.mountRenderer(forceWebGL)
      this.pipeline = new RenderPipeline(this.renderer)
      await this.renderer.init()
    } catch (err) {
      console.warn(err)
      return false
    }
    this.failed = false
    this.finishInit(forceWebGL)
    this.onRecovered?.()
    this.swapping = false
    return true
  }

  private failTerminal(): void {
    this.failed = true
    this.terminal = true
    this.swapping = false
    this.webgpu = false
    this.pendingFallback = false
    this.onTerminal?.()
  }

  /** Init threw before a device existed. A new canvas, then WebGL. */
  private async recoverFromInit(): Promise<void> {
    if (this.terminal) return
    this.swapping = true
    const ok = await this.swapRenderer(true)
    if (!ok) this.failTerminal()
  }

  /**
   * The device that owned the first canvas is gone.
   * Try WebGPU once more on a new canvas when an adapter still exists.
   * Otherwise ask for a reload and stop. Never call getContext on the old canvas.
   */
  private async recover(): Promise<void> {
    if (this.swapping || this.terminal || !this.sky) return
    if (!this.webgpu) {
      this.failTerminal()
      return
    }
    this.swapping = true
    this.pendingFallback = false
    let adapterOk = false
    try {
      const gpu = (navigator as Navigator & { gpu?: GpuNavigator }).gpu
      adapterOk = (await gpu?.requestAdapter?.()) != null
    } catch {
      adapterOk = false
    }
    if (!adapterOk) {
      this.disposeRenderer()
      this.failTerminal()
      return
    }
    const again = await this.swapRenderer(false)
    if (again) return
    const webgl = await this.swapRenderer(true)
    if (!webgl) this.failTerminal()
  }

  /** Drop cascaded shadows without writing null. A null shadow node is compiled into the shader as the identifier `null`. */
  private clearCascades(): void {
    const shadow = this.sun.shadow as { shadowNode?: CSMShadowNode }
    delete shadow.shadowNode
    this.csm = null
  }

  private cascades(): void {
    const csm = new CSMShadowNode(this.sun, { cascades: 2, maxFar: 220, mode: 'practical', lightMargin: 48 })
    this.csm = csm
    csm.fade = true
    const shadow = this.sun.shadow as { shadowNode?: CSMShadowNode; mapSize: { set: (w: number, h: number) => void } }
    shadow.shadowNode = csm
    shadow.mapSize.set(1024, 1024)
  }

  refreshEnvironment(sky: Sky): void {
    if (!this.pmrem || this.terminal) return
    const probe = new Scene()
    const shell = sky.mesh.clone()
    shell.scale.setScalar(0.01)
    probe.add(shell)
    const next = this.pmrem.fromScene(probe, 0.06, 0.1, 80)
    this.env?.dispose()
    this.env = next
    this.scene.environment = next.texture
    this.scene.environmentIntensity = 0.28
  }

  setQuality(quality: Quality): void {
    this.quality = quality
    dofGain.value = quality === 'high' ? 0.04 : 0
    this.applyShadowBudget()
    this.compose()
  }

  /** Recompose only when fog or night shafts actually have a term. */
  syncShafts(fog: number, gain: number): void {
    const on = fog > 0.005 || gain > 0.005
    if (on === this.marchOn) return
    this.marchOn = on
    if (this.busy) return
    this.compose()
  }

  syncBloom(golden: number): void {
    if (!this.bloomNode) return
    const base = this.quality === 'high' ? 0.04 : 0.025
    this.bloomNode.strength.value = base + golden * 0.03
    this.bloomNode.radius.value = 0.2 + golden * 0.04
  }

  setBloom(on: boolean): void {
    this.bloomOn = on
    this.compose()
  }

  /** @returns true when this call destroyed the device and the frame must not render. */
  private maybeLose(): boolean {
    if (this.loseLeft <= 0 || !this.webgpu || this.loseReady || this.busy) return false
    const frame = (this.renderer.info as { render?: { frame?: number } } | undefined)?.render?.frame ?? 0
    this.framesSinceArm += 1
    if (frame <= this.armFrame && this.framesSinceArm <= 120) return false
    this.loseReady = true
    this.loseLeft -= 1
    const device = (this.renderer.backend as { device?: { destroy?: () => void } }).device
    try {
      device?.destroy?.()
    } catch (err) {
      console.warn(err)
    }
    return true
  }

  private compose(): void {
    const asNode = (value: unknown) => value as never
    const scenePass = pass(this.scene, this.camera)
    const color = scenePass.getTextureNode('output')
    let picture: unknown = color

    // The WebGL backend often has no depth attachment on the post pass.
    // Sampling it throws "reading 'depthTexture'" and the shaft march calls
    // a swizzle `.oneMinus()` that production builds used to drop.
    const depth = this.webgpu && this.quality !== 'low' ? scenePass.getTextureNode('depth') : null
    if (this.quality === 'high' && depth) {
      const aoNode = new GTAONode(depth, null as never, this.camera)
      aoNode.resolutionScale = 0.5
      aoNode.samples.value = 8
      aoNode.radius.value = 0.35
      const occlusion = aoNode.getTextureNode() as unknown as { r: { mul: (v: unknown) => { add: (v: unknown) => unknown } } }
      picture = mul(asNode(picture), asNode(occlusion.r.mul(0.45).add(0.55)))
    }

    if (depth && this.quality !== 'low' && this.marchOn) {
      const depthTex = depth as { sample: (uv: unknown) => unknown }
      const light = Fn(() => {
        const view = getViewPosition(screenUV, asNode(depth), invProj)
        const world = camWorld.mul(vec4(view, 1)).xyz
        const ray = world.sub(camPos)
        const reach = length(ray).min(260)
        const dir = normalize(ray)
        const acc = vec3(0, 0, 0).toVar()
        Loop(8, ({ i }) => {
          const t = float(i).add(0.5).div(8)
          const p = camPos.add(dir.mul(reach.mul(t)))
          const drop = fogHeight.sub(p.y).max(0)
          const dens = drop.mul(0.018).add(0.012).mul(valleyFog)
          const phase = pow(max(dir.dot(sunDirShade), float(0)), float(7)).mul(shaftGain)
          acc.addAssign(shaftColor.mul(dens).mul(phase).mul(0.11))
        })
        const beam = float(0).toVar()
        const toSun = sunClip.sub(screenUV)
        Loop(8, ({ i }) => {
          const uv = screenUV.add(toSun.mul(float(i).div(8).mul(0.7)))
          const sample = getViewPosition(asNode(uv), asNode(depthTex.sample(uv)), invProj)
          beam.addAssign(smoothstep(float(80), float(340), length(sample)))
        })
        const shafts = shaftColor.mul(beam.div(8)).mul(sunOn).mul(shaftGain).mul(float(1).sub(overcastShade.mul(0.65)))
        return acc.add(shafts)
      })()
      picture = add(asNode(picture), asNode(light))
    }

    this.bloomNode = null
    if (this.quality !== 'low' && this.bloomOn) {
      const glow = bloom(color, this.quality === 'high' ? 0.04 : 0.025, 0.18, 0.985)
      glow.setResolutionScale(this.quality === 'high' ? 0.5 : 0.35)
      this.bloomNode = glow
      picture = add(asNode(picture), asNode(glow))
    }

    const delta = screenUV.sub(vec2(0.5, 0.5))
    const sampleAt = screenUV.sub(mul(asNode(delta), asNode(blurAmount)))
    const smeared = color.sample(sampleAt)
    const spread = mul(asNode(blurAmount), asNode(delta.length().mul(1.6)))
    picture = mix(asNode(picture), asNode(smeared), asNode(spread))

    if (depth && dofGain.value > 0) {
      const view = getViewPosition(screenUV, asNode(depth), invProj)
      const far = smoothstep(float(48), float(280), length(view)).mul(dofGain)
      const tap = (x: number, y: number) => color.sample(screenUV.add(vec2(x, y).mul(far.add(0.2)))).rgb
      const soft = tap(0.0032, 0).add(tap(-0.0032, 0)).add(tap(0, 0.0032)).add(tap(0, -0.0032)).add(asNode((picture as { rgb: unknown }).rgb)).div(5)
      picture = mix(asNode((picture as { rgb: unknown }).rgb), asNode(soft), asNode(far.mul(0.8)))
    }

    const rgb = max(asNode((picture as { rgb: unknown }).rgb ?? picture), asNode(vec3(0, 0, 0)))
    const graded = mix(asNode(rgb), asNode(texture3D(this.lut, asNode(rgb.clamp(0, 1))).rgb), asNode(float(0.82)))
    const warm = mix(asNode(graded), asNode(mul(asNode(graded), asNode(vec3(1.08, 0.96, 0.8)))), asNode(mul(asNode(gradeGolden), asNode(float(0.65)))))
    const night = mix(asNode(warm), asNode(mul(asNode(warm), asNode(vec3(0.7, 0.78, 1.1)))), asNode(mul(asNode(gradeNight), asNode(float(0.55)))))
    const luma = dot(asNode(night), asNode(vec3(0.2126, 0.7152, 0.0722)))
    const filmed = add(asNode(mul(asNode(luma), asNode(vec3(1.12, 0.96, 0.7)))), asNode(vec3(0.05, 0.03, 0.012)))
    const era = mix(asNode(night), asNode(filmed), asNode(eraFilm))
    this.pipeline.outputNode = vec4(asNode(era), asNode(float(1)))
    this.pipeline.needsUpdate = true
  }

  render(): void {
    if (this.terminal || this.failed) return
    if (this.pendingFallback && !this.swapping) void this.recover()
    if (this.swapping) return
    if (this.maybeLose()) return
    try {
      this.pipeline.render()
      this.presented += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (LOST.test(message)) {
        console.warn(message)
        if (this.webgpu) this.pendingFallback = true
        else this.failTerminal()
        return
      }
      console.warn(err)
      if (this.csm) {
        this.clearCascades()
        this.compose()
        try {
          this.pipeline.render()
          this.presented += 1
          return
        } catch (again) {
          console.warn(again)
        }
      }
      if (this.quality !== 'low') {
        this.quality = 'low'
        this.compose()
        try {
          this.pipeline.render()
          this.presented += 1
          return
        } catch (again) {
          console.warn(again)
        }
      }
      this.failTerminal()
    }
  }
}
