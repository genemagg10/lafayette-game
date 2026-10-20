import * as THREE from 'three'
import { cameraPosition, float, fog, length, positionWorld, smoothstep } from 'three/tsl'
import type { Season, WeatherId } from './types.ts'
import type { World } from './world.ts'
import { createSky, syncSky } from './sky.ts'
import { sunForClock } from './sun.ts'
import { damp } from './math.ts'
import { gradeGolden, gradeNight, shared } from './materials.ts'
import { fogDensity, fogHeight, fogTint } from './grade.ts'
import { bounceTint, farHaze, overcastShade, shaftColor, shaftGain, valleyFog, windDir, windStrength, windTime } from './wind.ts'

export class Atmosphere {
  minutes = 14 * 60 + 40
  rate = 0.55
  season: Season = 'summer'
  weather: WeatherId = 'clear'
  forced = false
  fog = 0
  overcast = 0
  rain = 0
  wet = 0
  wind = 0.25
  sunAlt = 0.4
  night = 0
  morning = 0
  shadows = true
  private readonly scene: THREE.Scene
  readonly sunDir = new THREE.Vector3(0.2, 0.8, -0.3)
  private nextSwap = 90
  readonly sky: ReturnType<typeof createSky>
  readonly sun: THREE.DirectionalLight
  private readonly moon: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly rainPoints: THREE.Points
  private readonly rainPos: Float32Array
  private readonly puffs: THREE.Mesh[] = []
  private clock = 0
  private readonly fogColor = new THREE.Color()
  private readonly fill: THREE.DirectionalLight
  private readonly rim: THREE.DirectionalLight
  private readonly dusk = new THREE.Color(0xf0c39a)
  private readonly dayFog = new THREE.Color(0xc5d7ea)
  private readonly nightFog = new THREE.Color(0x1b2433)
  private readonly grayFog = new THREE.Color(0xaeb6bf)
  private readonly bankFog = new THREE.Color(0xd5dde4)
  private readonly morningFog = new THREE.Color(0xe7eef2)
  private readonly wetRoad = new THREE.Color(0x2a2e33)

  constructor(scene: THREE.Scene, soft: THREE.Texture) {
    this.scene = scene
    this.sky = createSky()
    scene.add(this.sky.mesh)
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 280
    this.sun.shadow.camera.left = -90
    this.sun.shadow.camera.right = 90
    this.sun.shadow.camera.top = 90
    this.sun.shadow.camera.bottom = -90
    this.sun.shadow.bias = -0.0004
    scene.add(this.sun, this.sun.target)
    this.moon = new THREE.DirectionalLight(0xb9c7e6, 0)
    scene.add(this.moon, this.moon.target)
    this.hemi = new THREE.HemisphereLight(0x9ec2ea, 0xc6a15a, 0.7)
    scene.add(this.hemi)
    this.fill = new THREE.DirectionalLight(0xc6e2a4, 0.28)
    this.fill.position.set(-40, 80, 30)
    scene.add(this.fill, this.fill.target)
    this.rim = new THREE.DirectionalLight(0xffd7a4, 0.22)
    this.rim.position.set(30, 40, -80)
    scene.add(this.rim, this.rim.target)
    // Haze belongs on the far hills, not on the asphalt underfoot.
    const dist = length(positionWorld.sub(cameraPosition))
    const far = smoothstep(float(2600), float(6400), dist).mul(farHaze)
    const bank = smoothstep(fogHeight, fogHeight.sub(36), positionWorld.y).mul(valleyFog).mul(0.45)
    const factor = far.add(bank).clamp(0, 0.55)
    const fogScene = scene as THREE.Scene & { fogNode: unknown }
    fogScene.fog = null
    fogScene.fogNode = fog(fogTint, factor)

    const count = 1600
    this.rainPos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 80
      this.rainPos[i * 3 + 1] = Math.random() * 40
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 80
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3))
    const mat = new THREE.PointsMaterial({ color: 0xd5e4ee, size: 0.12, transparent: true, opacity: 0, depthWrite: false })
    this.rainPoints = new THREE.Points(geo, mat)
    this.rainPoints.frustumCulled = false
    scene.add(this.rainPoints)

    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Mesh(new THREE.PlaneGeometry(520, 180), new THREE.MeshBasicMaterial({
        map: soft,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        color: 0xd5dde3,
      }))
      puff.position.set(-900 + i * 180, 230 + (i % 3) * 18, -200 + (i - 3) * 140)
      puff.rotation.x = -0.15
      scene.add(puff)
      this.puffs.push(puff)
    }
  }

  get time(): number {
    return this.clock
  }

  setWeather(id: WeatherId | 'auto'): void {
    if (id === 'auto') {
      this.forced = false
      return
    }
    this.forced = true
    this.weather = id
  }

  toggleSeason(): Season {
    this.season = this.season === 'summer' ? 'winter' : this.season === 'winter' ? 'spring' : 'summer'
    return this.season
  }

  update(dt: number, paused: boolean, focus: THREE.Vector3, world: World, renderer: { toneMappingExposure: number }): void {
    this.clock += dt
    if (!paused) this.minutes += dt * this.rate
    this.minutes = ((this.minutes % 1440) + 1440) % 1440
    if (!this.forced) {
      this.nextSwap -= dt
      if (this.nextSwap <= 0) {
        const roll = Math.random()
        this.weather = roll < 0.46 ? 'clear' : roll < 0.7 ? 'fog' : roll < 0.88 ? 'overcast' : 'rain'
        this.nextSwap = 75 + Math.random() * 80
      }
    }
    const goal = {
      clear: [0, 0, 0, 0.22],
      fog: [1, 0.28, 0, 0.16],
      overcast: [0.2, 1, 0, 0.38],
      rain: [0.28, 0.85, 1, 0.72],
    }[this.weather]
    this.fog = damp(this.fog, goal[0], 0.32, dt)
    this.overcast = damp(this.overcast, goal[1], 0.32, dt)
    this.rain = damp(this.rain, goal[2], 0.4, dt)
    this.wind = damp(this.wind, goal[3], 0.3, dt)
    this.wet = damp(this.wet, this.rain * 0.85 + this.fog * 0.15, 0.25, dt)

    const solar = sunForClock(this.minutes, this.season)
    this.sunAlt = solar.altitude
    const cosA = Math.cos(solar.altitude)
    this.sunDir.set(Math.sin(solar.azimuth) * cosA, Math.sin(solar.altitude), -Math.cos(solar.azimuth) * cosA)
    const day = THREE.MathUtils.smoothstep(this.sunAlt, -0.08, 0.18)
    this.night = 1 - day
    const golden = (1 - THREE.MathUtils.smoothstep(this.sunAlt, 0.02, 0.35)) * THREE.MathUtils.smoothstep(this.sunAlt, -0.08, 0.16)
    const blue = THREE.MathUtils.smoothstep(this.sunAlt, 0.05, -0.02) * THREE.MathUtils.smoothstep(this.sunAlt, -0.22, -0.04)
    const hour = this.minutes / 60
    this.morning = THREE.MathUtils.smoothstep(hour, 5.4, 7.1) * (1 - THREE.MathUtils.smoothstep(hour, 9.2, 11.4))
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 180)
    this.sun.target.position.copy(focus)
    this.sun.intensity = (0.85 + day * 1.9) * (1 - this.overcast * 0.45) * (1 - this.fog * 0.3)
    this.sun.color.set(golden > 0.2 ? 0xffc48a : 0xfff6e8)
    this.moon.position.copy(focus).addScaledVector(this.sunDir, -140)
    this.moon.target.position.copy(focus)
    this.moon.intensity = this.night * 0.35
    this.hemi.intensity = 0.85 + day * 0.55
    this.hemi.color.set(golden > 0.25 ? 0xffd7b0 : 0x9ed4fb)
    const bounce = this.season === 'summer' ? 0xe4c99a : this.season === 'spring' ? 0x9ed48a : 0x6aaa78
    this.hemi.groundColor.set(bounce)
    bounceTint.value.set(bounce)
    this.fill.color.set(golden > 0.25 ? 0xffe0c0 : 0xb9dcff)
    this.fill.intensity = (0.42 + day * 0.38) * (1 - this.night * 0.35)
    this.fill.position.copy(focus).addScaledVector(this.sunDir, -90)
    this.fill.position.y += 50
    this.fill.target.position.copy(focus)
    const rimSide = new THREE.Vector3(-this.sunDir.z, 0.45, this.sunDir.x).normalize()
    this.rim.position.copy(focus).addScaledVector(rimSide, 140)
    this.rim.target.position.copy(focus)
    this.rim.intensity = 0.12 + golden * 0.55 + blue * 0.42
    this.rim.color.set(blue > 0.35 ? 0x9ec4ff : golden > 0.2 ? 0xffb06a : 0xfff3dd)
    this.sun.castShadow = this.shadows
    const span = THREE.MathUtils.clamp(78 + (0.45 - Math.max(0.08, this.sunAlt)) * 180, 80, 210)
    const shadowCam = this.sun.shadow.camera as THREE.OrthographicCamera
    shadowCam.left = -span
    shadowCam.right = span
    shadowCam.top = span
    shadowCam.bottom = -span
    shadowCam.far = 420
    shadowCam.updateProjectionMatrix()
    this.sun.shadow.bias = -0.00022
    this.sun.shadow.normalBias = 0.02

    this.sky.mesh.position.copy(focus)
    this.sky.uSun.value.copy(this.sunDir)
    this.sky.uAlt.value = this.sunAlt
    this.sky.uOvercast.value = this.overcast
    this.sky.uStar.value = 1
    world.setSun(this.sunDir)
    this.scene.environmentIntensity = 0.16 + day * 0.38
    gradeGolden.value = golden
    gradeNight.value = this.night
    windTime.value = this.clock
    windStrength.value = 0.16 + this.wind * 0.9
    windDir.value.set(Math.cos(this.clock * 0.05), Math.sin(this.clock * 0.05))
    const turbidity = 2.15 + golden * 1.35 + this.fog * 2.4 + this.overcast * 3.2
    syncSky(this.sky, this.sunAlt, turbidity)
    overcastShade.value = this.overcast
    valleyFog.value = this.weather === 'fog' || this.weather === 'rain' ? Math.min(1, this.fog * 0.85 + this.rain * 0.2) : 0
    fogHeight.value = 18 + this.fog * 28
    fogDensity.value = 0.00015 + this.fog * 0.0004
    shaftGain.value = this.night * 0.02
    farHaze.value = this.weather === 'fog' ? 0.5 : this.weather === 'rain' ? 0.16 : 0
    shaftColor.value.set(golden > 0.2 ? 1 : 0.9, golden > 0.2 ? 0.68 : 0.9, golden > 0.2 ? 0.34 : 0.78)

    this.fogColor.copy(golden > 0.3 ? this.dusk : day > 0.4 ? this.dayFog : this.nightFog)
    if (this.overcast > 0.4) this.fogColor.lerp(this.grayFog, this.overcast)
    if (this.fog > 0.2) this.fogColor.lerp(this.bankFog, this.fog * 0.7)
    if (this.morning > 0.2) this.fogColor.lerp(this.morningFog, this.morning * 0.45)
    fogTint.value.copy(this.fogColor)
    renderer.toneMappingExposure = 1.18 + golden * 0.1 - this.night * 0.22 - this.overcast * 0.1

    shared.time.value = this.clock
    shared.wind.value = 0.12 + this.wind * 0.55
    shared.night.value = this.night
    shared.wet.value = this.wet
    const windows = Math.max(this.night * 1.7, golden * 0.95 + blue * 1.25)
    world.windowMat.emissiveIntensity = windows
    world.townGlassMat.emissiveIntensity = windows * 0.85
    world.storeMat.emissiveIntensity = windows * 1.15
    world.lampMat.emissiveIntensity = Math.max(this.night, golden * 0.7 + blue) * 2.4
    world.roadMat.roughness = 0.94 - this.wet * 0.55
    world.roadMat.metalness = 0.02 + this.wet * 0.22
    world.roadMat.color.setRGB(1, 1, 1).lerp(this.wetRoad, this.wet * 0.45)

    const attr = this.rainPoints.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= (18 + (i % 7)) * dt * (0.35 + this.rain)
      if (arr[i + 1] < 0) arr[i + 1] = 36
    }
    attr.needsUpdate = true
    this.rainPoints.position.set(focus.x, focus.y + 8, focus.z)
    const rainMat = this.rainPoints.material as THREE.PointsMaterial
    rainMat.opacity = this.rain * 0.55

    this.puffs.forEach((puff, i) => {
      puff.position.x += dt * (6 + this.wind * 10)
      if (puff.position.x > 1600) puff.position.x = -1600
      const mat = puff.material as THREE.MeshBasicMaterial
      mat.opacity = this.fog * (0.28 + (i % 3) * 0.05)
    })
  }
}

