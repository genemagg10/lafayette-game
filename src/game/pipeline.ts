import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  RenderPipeline,
  Scene,
  SRGBColorSpace,
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
import { godrays } from 'three/addons/tsl/display/GodraysNode.js'
import GTAONode from 'three/addons/tsl/display/GTAONode.js'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { blurAmount, eraFilm, gradeGolden, gradeNight } from './materials.ts'
import type { Sky } from './sky.ts'

export type Quality = 'low' | 'medium' | 'high'

export class Picture {
  renderer: WebGPURenderer
  pipeline: RenderPipeline
  quality: Quality
  webgpu = false
  bloomOn = true
  private env: { texture: Texture; dispose: () => void } | null = null
  private pmrem: PMREMGenerator | null = null
  private failed = false
  private bloomNode: { strength: { value: number }; radius: { value: number } } | null = null
  private readonly lut = createLut()

  private readonly canvas: HTMLCanvasElement
  private readonly scene: Scene
  private readonly camera: Camera
  private readonly sun: DirectionalLight

  constructor(canvas: HTMLCanvasElement, scene: Scene, camera: Camera, sun: DirectionalLight, quality: Quality) {
    this.canvas = canvas
    this.scene = scene
    this.camera = camera
    this.sun = sun
    this.quality = quality
    this.renderer = this.mountRenderer(false)
    this.pipeline = new RenderPipeline(this.renderer)
  }

  /** WebGPU when the browser has it. `forceWebGL` is the fallback when that init throws. */
  private mountRenderer(forceWebGL: boolean): WebGPURenderer {
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: this.quality !== 'low', forceWebGL })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.96
    renderer.shadowMap.enabled = this.quality !== 'low'
    renderer.shadowMap.type = PCFShadowMap
    return renderer
  }

  async init(sky: Sky): Promise<void> {
    try {
      await this.renderer.init()
    } catch (err) {
      console.warn(err)
      this.renderer.dispose()
      this.renderer = this.mountRenderer(true)
      this.pipeline = new RenderPipeline(this.renderer)
      await this.renderer.init()
    }
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean }
    this.webgpu = backend.isWebGPUBackend === true
    if (this.quality !== 'low' && this.webgpu) {
      try {
        this.cascades()
      } catch (err) {
        console.warn(err)
      }
    }
    this.pmrem = new PMREMGenerator(this.renderer)
    try {
      this.refreshEnvironment(sky)
    } catch (err) {
      console.warn(err)
    }
    dofGain.value = this.quality === 'high' ? 0.4 : this.quality === 'medium' ? 0.22 : 0
    this.compose()
  }

  private csm: CSMShadowNode | null = null

  private cascades(): void {
    const csm = new CSMShadowNode(this.sun, { cascades: this.quality === 'high' ? 3 : 2, maxFar: 280, mode: 'practical', lightMargin: 64 })
    this.csm = csm
    csm.fade = true
    const shadow = this.sun.shadow as { shadowNode?: CSMShadowNode; mapSize: { set: (w: number, h: number) => void } }
    shadow.shadowNode = csm
    shadow.mapSize.set(1024, 1024)
  }

  refreshEnvironment(sky: Sky): void {
    if (!this.pmrem) return
    const probe = new Scene()
    const shell = sky.mesh.clone()
    shell.scale.setScalar(0.01)
    probe.add(shell)
    const next = this.pmrem.fromScene(probe, 0.06, 0.1, 80)
    this.env?.dispose()
    this.env = next
    this.scene.environment = next.texture
    this.scene.environmentIntensity = 0.72
  }

  setQuality(quality: Quality): void {
    this.quality = quality
    this.renderer.shadowMap.enabled = quality !== 'low'
    dofGain.value = quality === 'high' ? 0.4 : quality === 'medium' ? 0.22 : 0
    this.compose()
  }

  syncBloom(golden: number): void {
    if (!this.bloomNode) return
    const base = this.quality === 'high' ? 0.58 : 0.36
    this.bloomNode.strength.value = base + golden * 0.3
    this.bloomNode.radius.value = 0.55 + golden * 0.12
  }

  setBloom(on: boolean): void {
    this.bloomOn = on
    this.compose()
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
      aoNode.radius.value = 0.4
      const occlusion = aoNode.getTextureNode() as unknown as { r: { mul: (v: unknown) => { add: (v: unknown) => unknown } } }
      picture = mul(asNode(picture), asNode(occlusion.r.mul(0.62).add(0.38)))
      if (this.webgpu && !this.csm) {
        // godrays() samples sun.shadow.map, which CSM never allocates.

        const rays = godrays(depth, this.camera, this.sun)
        rays.resolutionScale = 0.25
        rays.raymarchSteps.value = 16
        rays.density.value = 0.22
        rays.maxDensity.value = 0.34
        picture = add(asNode(picture), asNode(mul(asNode(rays.rgb), asNode(float(0.4)))))
      }
    }

    if (depth && this.quality !== 'low') {
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
          const dens = drop.mul(0.018).add(0.012).mul(valleyFog.add(0.08))
          const phase = pow(max(dir.dot(sunDirShade), float(0)), float(7)).mul(shaftGain).add(0.1)
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
      const glow = bloom(color, this.quality === 'high' ? 0.58 : 0.36, 0.58, 0.85)
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
    if (this.failed) {
      this.renderer.render(this.scene, this.camera)
      return
    }
    try {
      this.pipeline.render()
    } catch (err) {
      console.error(err)
      if (this.csm) {
        const shadow = this.sun.shadow as { shadowNode?: CSMShadowNode | null }
        shadow.shadowNode = null
        this.csm = null
        this.compose()
        try {
          this.pipeline.render()
          return
        } catch (again) {
          console.error(again)
        }
      }
      if (this.quality !== 'low') {
        this.quality = 'low'
        this.compose()
        try {
          this.pipeline.render()
          return
        } catch (again) {
          console.error(again)
        }
      }
      this.failed = true
      this.renderer.render(this.scene, this.camera)
    }
  }
}
