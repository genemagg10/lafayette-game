import * as THREE from 'three'
import { F_BUILDING, F_WATER, Heightfield } from './height.ts'
import { World } from './world.ts'
import { Walker, type FlightInput } from './actor.ts'
import { Bike, Car, Helicopter, Wagon, type VehicleInput } from './vehicles.ts'
import { ChaseCamera } from './camera.ts'
import { Input } from './input.ts'
import { AudioBus } from './audio.ts'
import { Atmosphere } from './atmosphere.ts'
import { Traffic } from './traffic.ts'
import { Collectibles } from './collectibles.ts'
import { Discover, type ViewSpot } from './discover.ts'
import { loadStories } from './stories.ts'
import { loadStorefronts } from './storefronts.ts'
import { Hud } from './ui.ts'
import { blurAmount, createTextures, eraFilm, gradeGolden } from './materials.ts'
import { Picture, type Quality } from './pipeline.ts'
import { Meadow } from './meadow.ts'
import { Horizon } from './horizon.ts'
import { addBanners } from './banners.ts'
import { projectSun } from './wind.ts'
import { Wash } from './wash.ts'
import { forwardFromHeading, rightFromHeading } from './math.ts'
import type { TileSet } from './tiles.ts'
import { KIDS, loadKid, saveKid, type KidId } from './kids.ts'
import { MemoryPortals, loadSplatManifest } from './splats.ts'
import { ERA_BY_ID, asToday, loadEra, loadEraCopy, saveEra, type EraId, type EraSpec, type ThenNow } from './eras.ts'
import { loadHistory } from './history.ts'
import { Juice, Rewards } from './arcade.ts'
import { Activities } from './beams.ts'
import { createTownClock } from './period.ts'
import type { CamKind, CamMode, Meta, RideKind, Road, WaterFile } from './types.ts'

type Mount = Bike | Car | Wagon | Helicopter

export class Game {
  private picture!: Picture
  private meadow!: Meadow
  private horizon!: Horizon
  private readonly look = new THREE.Vector3()
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly input: Input
  private readonly wash: Wash
  private readonly audio = new AudioBus()
  private readonly hud = new Hud()
  private readonly cam = new ChaseCamera()
  private readonly focus = new THREE.Vector3()
  private world!: World
  private atmo!: Atmosphere
  private walker!: Walker
  private bike!: Bike
  private car!: Car
  private vintage!: Car
  private wagon!: Wagon
  private heli!: Helicopter
  private eraId: EraId = 'today'
  private eraLines = new Map<string, ThenNow>()
  private eraAnim: { t: number; phase: 'in' | 'hold' | 'out'; next: EraId; told: boolean } | null = null
  private townClock: THREE.Group | null = null
  private clock = new THREE.Vector3()
  private hoof = 0
  private traffic!: Traffic
  private collect!: Collectibles
  private discover!: Discover
  private portals: MemoryPortals | null = null
  private juice!: Juice
  private rewards!: Rewards
  private activities!: Activities
  private meta!: Meta
  private ride: RideKind = 'foot'
  private active: Mount | null = null
  private mode: 'boot' | 'title' | 'play' | 'pause' = 'boot'
  private milo!: Walker
  private juniper!: Walker
  private castLight!: THREE.PointLight
  private hover: KidId | null = null
  private waveUntil: Record<KidId, number> = { milo: 0, juniper: 0 }
  private kidId: KidId = loadKid()
  private titleTime = 0
  private last = 0
  private fps = 60
  private fpsWarm = 0
  private adapted = false
  private edgeNote = false
  private photo = false
  private photoRate = 0
  private photoCam: CamMode = 'chase'
  private photoView: ViewSpot | null = null
  private photoHudWasHidden = false
  private travelTakeoff = false
  private travelSettle = false
  private step = 0
  private bird = 2
  private readonly coarse = matchMedia('(pointer: coarse)').matches
  private quality: Quality = this.coarse ? 'medium' : 'high'
  private envClock = 0

  constructor() {
    const canvas = document.querySelector('#view') as HTMLCanvasElement
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.25, 9000)
    this.input = new Input(canvas)
    this.wash = new Wash(this.scene)
    window.addEventListener('resize', () => this.resize())
    this.hud.onPlay = () => {
      if (this.mode === 'pause') this.resume()
      else this.play()
    }
    this.hud.onPause = () => this.togglePause()
    this.hud.onKid = (id) => this.chooseKid(id)
    this.hud.onHoverKid = (id) => this.hoverKid(id)
    this.hud.onMute = () => {
      this.audio.ensure()
      this.hud.setMuteLabel(this.audio.toggleMute())
    }
    this.hud.onTravel = (x, z) => this.travel(x, z)
    this.hud.onWeather = (id) => this.atmo?.setWeather(id)
    this.hud.onSeason = () => {
      if (!this.atmo || !this.world) return
      const season = this.atmo.toggleSeason()
      this.world.setSeason(season)
      this.meadow?.setSeason(season)
      this.horizon?.setSeason(season)
      this.hud.setSeasonLabel(season)
    }
    this.hud.onHour = (h) => {
      if (this.atmo) this.atmo.minutes = h * 60
    }
    this.hud.onRate = (r) => {
      if (this.atmo) this.atmo.rate = r
    }
    this.hud.onTeleport = (id) => {
      const stand = this.portals?.stand(id)
      if (stand) {
        this.travel(stand.x, stand.z)
        this.face(stand.lookX, stand.lookZ)
        return
      }
      const place = this.meta?.places.find((p) => p.id === id)
      if (!place) return
      const spot = id === 'reservoir' ? { x: this.heli.x, z: this.heli.z } : place
      this.travel(spot.x, spot.z)
      const look: Record<string, { x: number; z: number }> = {
        downtown: { x: place.x - 180, z: place.z + 10 },
        reservoir: { x: place.x - 400, z: place.z },
        rim: { x: place.x + 420, z: place.z - 40 },
        overlook: { x: 480, z: -420 },
        bart: { x: 420, z: -430 },
      }
      const at = look[id]
      if (at) this.face(at.x, at.z)
    }
    this.hud.onBloom = (on) => this.picture?.setBloom(on)
    this.hud.onQuality = (quality) => this.applyQuality(quality)
    this.hud.onPhoto = () => this.togglePhoto()
    this.hud.onTravelKind = (kind) => this.input.pickTravel(kind)
    this.hud.onEra = (id) => this.beginEra(id)
    this.hud.onTour = () => {
      if (!this.activities) return
      this.hud.setTour(this.activities.toggleTour())
    }
  }

  async start(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL
      this.hud.loading('Fetching Mt. Diablo Boulevard…')
      const [meta, roads, water, tileset, stories, storefronts, terrainBuf, splats, eraLines, history] = await Promise.all([
        this.getJSON<Meta>(`${base}data/meta.json`),
        this.getJSON<Road[]>(`${base}data/roads.json`),
        this.getJSON<WaterFile>(`${base}data/water.json`),
        this.getJSON<TileSet>(`${base}data/tileset.json`),
        loadStories(base),
        loadStorefronts(base),
        fetch(`${base}data/terrain.bin`).then((res) => {
          if (!res.ok) throw new Error('terrain missing')
          return res.arrayBuffer()
        }),
        loadSplatManifest(base),
        loadEraCopy(base),
        loadHistory(base),
      ])
      this.eraLines = eraLines
      this.meta = meta
      this.hud.loading('Raising the hills and the reservoir…')
      const height = new Heightfield(terrainBuf, meta.terrain)
      const textures = createTextures()
      this.world = new World(this.scene, meta, height, roads, water, tileset, textures, base)
      this.world.setStorefronts(storefronts)
      this.hud.loading('Streaming downtown tiles…')
      const lake = this.lakeCenter(water)
      await this.world.preload(meta.spawn.x, meta.spawn.z, 2)
      await this.world.preload(lake.x, lake.z, 1)
      const bart = meta.places.find((p) => p.id === 'bart')
      if (bart) await this.world.preload(bart.x, bart.z, 1)
      const overlook = meta.places.find((p) => p.id === 'overlook')
      if (overlook) await this.world.preload(overlook.x, overlook.z, 1)
      this.atmo = new Atmosphere(this.scene, textures.soft)
      this.meadow = new Meadow(this.scene, height, this.quality)
      this.horizon = new Horizon(this.scene, height, textures.oak)
      addBanners(this.scene, height)
      const canvas = document.querySelector('#view') as HTMLCanvasElement
      this.picture = new Picture(canvas, this.scene, this.camera, this.atmo.sun, this.quality)
      await this.picture.init(this.atmo.sky)
      this.resize()
      if (this.quality !== 'low') {
        try {
          this.world.useReflections(textures.waterNormals, this.quality === 'high' ? 0.45 : 0.3)
        } catch (err) {
          console.warn(err)
        }
      }
      this.walker = new Walker(this.kidId)
      this.scene.add(this.walker.group)
      this.milo = new Walker('milo')
      this.juniper = new Walker('juniper')
      this.milo.group.visible = false
      this.juniper.group.visible = false
      this.scene.add(this.milo.group, this.juniper.group)
      this.castLight = new THREE.PointLight(0xfff6ea, 7, 3.6, 2)
      this.castLight.visible = false
      this.scene.add(this.castLight)
      this.hud.setKid(this.kidId)
      const stand = this.sidewalk()
      this.walker.place(stand.x, this.world.surface(stand.x, stand.z, null), stand.z, stand.heading)
      this.cam.snap(stand.heading)
      this.bike = new Bike()
      this.car = new Car()
      this.vintage = new Car({ paint: 0xf3e6c4, name: 'vintage car', eraRide: 'vintage' })
      this.wagon = new Wagon()
      this.heli = new Helicopter()
      this.bike.place(stand.bikeX, stand.bikeZ, stand.heading, this.world)
      this.car.place(meta.vehicles.car.x, meta.vehicles.car.z, meta.vehicles.car.h, this.world)
      const vintageAt = this.world.blockers.resolve(meta.vehicles.car.x + 11, meta.vehicles.car.z + 6, 1.2)
      this.vintage.place(vintageAt.x, vintageAt.z, meta.vehicles.car.h, this.world)
      const wagonAt = this.world.blockers.resolve(stand.x - 12, stand.z + 8, 1.2)
      this.wagon.place(wagonAt.x, wagonAt.z, stand.heading, this.world)
      this.heli.place(meta.vehicles.heli.x, meta.vehicles.heli.z, meta.vehicles.heli.h, this.world)
      this.scene.add(this.bike.group, this.car.group, this.vintage.group, this.wagon.group, this.heli.group)
      const clockAt = this.world.blockers.resolve(stand.clockX, stand.clockZ, 0.45)
      const clockY = this.world.surface(clockAt.x, clockAt.z, null)
      this.clock.set(clockAt.x, clockY, clockAt.z)
      this.townClock = createTownClock()
      this.townClock.position.set(clockAt.x, clockY, clockAt.z)
      this.scene.add(this.townClock)
      this.traffic = new Traffic(this.scene, roads, this.world, lake)
      this.collect = new Collectibles(this.scene, meta.collectibles, this.world)
      this.discover = new Discover(this.scene, this.world, meta)
      this.discover.useStories(stories, meta.origin)
      this.discover.useHistory(history, meta.origin)
      const spotAt = (id: string, x: number, z: number) => this.discover.places.find((p) => p.id === id) ?? { x, z }
      this.juice = new Juice(this.scene)
      this.rewards = new Rewards()
      this.activities = new Activities(
        this.scene,
        this.world,
        spotAt('library', 818, -436),
        spotAt('reservoir', -813, 845),
        spotAt('plaza', 536, -428),
      )
      this.juice.onStyle = (points) => {
        this.rewards.grant(1, `+${points} style`)
        this.rewards.badge('explorer-drift')
      }
      this.portals = new MemoryPortals(this.scene, base, splats)
      this.portals.onSwap = (swap) => this.swapMemory(swap)
      this.portals.anchor(
        this.discover.places,
        meta.origin,
        (x, z) => this.world.surface(x, z, null),
        (x, z) => (this.world.height.flag(x, z) & (F_BUILDING | F_WATER)) !== 0,
      )
      this.hud.setMap(roads, water, height)
      this.parkOnShore(this.heli)
      this.applyEra(loadEra(), false)
      this.hud.loading(null)
      this.hud.showTitle()
      this.walker.group.visible = false
      this.input.allowLock = false
      this.mode = 'title'
      this.focus.set(stand.x, 160, stand.z)
      requestAnimationFrame((t) => this.frame(t))
    } catch (err) {
      console.error(err)
      this.hud.loading('The map didn’t load. Run npm run bake if the data files are missing.')
    }
  }

  private async getJSON<T>(url: string): Promise<T> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} ${res.status}`)
    return (await res.json()) as T
  }

  private lakeCenter(water: WaterFile): { x: number; z: number } {
    const body = water.bodies[0]
    if (!body) return { x: 0, z: 0 }
    let x = 0
    let z = 0
    const n = body.p.length / 2
    for (let i = 0; i < n; i++) {
      x += body.p[i * 2]
      z += body.p[i * 2 + 1]
    }
    return { x: x / n, z: z / n }
  }

  private sidewalk(): { x: number; z: number; heading: number; bikeX: number; bikeZ: number; clockX: number; clockZ: number } {
    // East of the Park Theater, in the boulevard, looking west at the storefronts.
    const x = 452
    const z = -426
    return {
      x,
      z,
      heading: -Math.PI / 2,
      bikeX: x + 5,
      bikeZ: z + 2,
      clockX: x - 10,
      clockZ: z - 8,
    }
  }

  private play(): void {
    if (this.mode === 'play') return
    this.mode = 'play'
    this.input.allowLock = true
    this.walker.group.visible = true
    this.milo.group.visible = false
    this.juniper.group.visible = false
    this.castLight.visible = false
    this.hud.beginPlay()
    this.input.setTouchVisible(true)
    this.cam.snap(this.walker.heading)
    queueMicrotask(() => this.audio.ensure())
  }

  private resize(): void {
    if (!this.picture) return
    const w = window.innerWidth
    const h = window.innerHeight
    const cap = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.25 : this.coarse ? 1.15 : 1.5
    const pr = Math.min(window.devicePixelRatio || 1, cap)
    this.picture.renderer.setPixelRatio(pr)
    this.picture.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  private applyQuality(quality: Quality): void {
    this.quality = quality
    this.atmo.shadows = quality !== 'low'
    this.meadow?.setQuality(quality)
    this.picture.setQuality(quality)
    this.resize()
    this.hud.setQualityLabel(quality)
  }

  private position(): { x: number; y: number; z: number; heading: number; speed: number; agl: number } {
    if (this.active) {
      return {
        x: this.active.x,
        y: this.active.y,
        z: this.active.z,
        heading: this.active.heading,
        speed: Math.abs(this.active.speed),
        agl: this.active.agl,
      }
    }
    return {
      x: this.walker.x,
      y: this.walker.y,
      z: this.walker.z,
      heading: this.walker.heading,
      speed: this.walker.flying ? this.walker.airSpeed : this.walker.speed,
      agl: this.walker.agl,
    }
  }

  private frame = (now: number): void => {
    const raw = this.last ? (now - this.last) / 1000 : 0.016
    const dt = Math.min(0.05, raw)
    this.last = now
    this.fps = this.fps * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08
    this.input.update()
    if (this.input.pauseEdge) {
      if (this.photo) this.exitPhoto()
      else this.togglePause()
    }
    if (this.input.confirmEdge) {
      if (this.mode === 'title') this.play()
      else if (this.mode === 'pause') this.resume()
    }
    if (this.input.photoEdge) this.togglePhoto()
    if (this.input.wheelEdge && this.mode === 'play' && !this.photo) this.hud.toggleWheel()
    if (this.input.mapEdge && this.mode === 'play' && !this.photo) this.hud.toggleMap()
    if (this.input.debugEdge && this.mode !== 'pause' && !this.photo) this.hud.toggleDebug()
    if (this.input.hudEdge && !this.photo) this.hud.setHudHidden(this.hudHidden())
    const playing = this.mode === 'play' && !this.hud.mapOpen && !this.photo
    if (this.mode === 'play' || this.mode === 'pause') this.tickEra(Math.min(0.35, raw))
    if (playing && this.input.travel) this.chooseTravel(this.input.travel)
    if (playing) this.simulate(dt)
    else if (this.mode === 'title') {
      this.titleTime += dt
      this.fly(this.titleTime)
    }
    const pos = this.position()
    if (this.mode === 'title') this.focus.copy(this.camera.position)
    else this.focus.set(pos.x, pos.y + 1.5, pos.z)
    this.atmo.update(dt, !playing, this.focus, this.world, this.picture.renderer)
    const portals = this.portals
    const memory = portals?.inside === true
    const streamX = this.mode === 'title' ? this.camera.position.x : memory && portals ? portals.holdX : pos.x
    const streamZ = this.mode === 'title' ? this.camera.position.z : memory && portals ? portals.holdZ : pos.z
    const airborne = this.mode === 'title' || this.ride === 'heli' || this.walker.flying
    this.world.update(streamX, streamZ, airborne, this.camera, this.atmo.time)
    if (this.mode === 'play') this.traffic.update(dt, this.atmo.time, pos.x, pos.z, this.world)
    if (this.mode === 'title' || this.mode === 'pause') this.stageCast(dt)
    if (playing) {
      const camKind: CamKind = this.walker.flying ? 'fly' : this.ride
      this.cam.update(dt, this.input, this.camera, this.world, { x: pos.x, y: pos.y, z: pos.z }, pos.heading, camKind, pos.speed, this.walker.bank)
      this.hud.setLetterbox(this.cam.mode === 'cine')
      this.greet(this.discover.update(pos.x, pos.z))
      this.collect.update(dt, pos.x, pos.y, pos.z, (note, done) => {
        this.audio.found()
        this.hud.toast(done ? `${note} That’s every keepsake.` : note)
      })
      this.mixAudio(pos)
      this.car.setNight(this.atmo.night)
      this.present(pos)
      this.maybeAdapt()
    } else if (this.photo) {
      this.holdPhoto(pos)
      this.hud.setLetterbox(true)
    }
    this.hud.tickToast(dt, this.photo)
    const flying = this.walker?.flying ?? false
    blurAmount.value = this.quality === 'low' ? 0 : Math.min(flying ? 0.085 : 0.05, pos.speed * (flying ? 0.0025 : 0.0018))
    const lines = document.getElementById('speedlines')
    const fringe = document.getElementById('fringe')
    const slide = this.active instanceof Car ? this.active.slide : 0
    const boosting = (flying && this.input.sprint) || (this.active instanceof Car && (this.input.handbrake || slide > 0.2) && Math.abs(pos.speed) > 6)
    const streak = Math.max(
      flying ? Math.min(0.78, Math.max(0, (pos.speed - 3.5) * 0.032)) : Math.min(0.55, Math.max(0, (pos.speed - 8) * 0.03)),
      Math.min(0.8, slide * 0.9),
      boosting ? 0.42 : 0,
    )
    if (lines) lines.style.opacity = String(streak)
    if (fringe) fringe.style.opacity = flying && pos.speed > 8 || slide > 0.18 || boosting ? String(Math.min(0.7, streak)) : '0'
    if (playing) {
      let source: { x: number; y: number; z: number; agl: number; speed: number } | null = null
      let strength = 0
      if (this.ride === 'heli' && this.heli.agl < 18) {
        source = this.heli
        strength = 1
      } else if (this.ride === 'bike' && Math.abs(this.bike.speed) > 3) {
        source = this.bike
        strength = Math.abs(this.bike.speed) / 12
      } else if (flying && this.walker.agl < 11 && this.walker.speed > 8) {
        source = {
          x: this.walker.x,
          y: this.walker.y - this.walker.agl,
          z: this.walker.z,
          agl: this.walker.agl,
          speed: this.walker.speed,
        }
        strength = Math.min(1.15, this.walker.speed / 16)
      }
      if (this.walker.landFx === 'pound') {
        source = { x: this.walker.x, y: this.walker.y, z: this.walker.z, agl: 0.3, speed: 10 }
        strength = 1.45
      }
      this.wash.update(dt, source, strength)
    }
    this.envClock += dt
    if (this.envClock > 45) {
      this.envClock = 0
      try {
        this.picture.refreshEnvironment(this.atmo.sky)
      } catch (err) {
        console.warn(err)
      }
    }
    const anchorX = this.mode === 'title' ? this.look.x : memory && portals ? portals.holdX : pos.x
    const anchorZ = this.mode === 'title' ? this.look.z : memory && portals ? portals.holdZ : pos.z
    const ground = this.world.height.sample(anchorX, anchorZ)
    const agl = this.mode === 'title' ? this.camera.position.y - ground : pos.agl
    projectSun(this.camera, this.atmo.sunDir)
    this.meadow?.update(anchorX, anchorZ, agl, this.camera, this.picture.renderer, this.picture.webgpu, dt)
    this.horizon?.update(this.camera)
    const watch = this.townClock?.getObjectByName('watch')
    if (watch) watch.rotation.y = Math.sin(now / 900) * 0.35
    if (this.portals && this.mode !== 'boot') {
      const view = this.mode === 'title' ? this.camera.position : pos
      this.portals.update(dt, view.x, view.y, view.z, this.mode === 'play' || this.mode === 'pause', this.picture.renderer, this.camera, this.quality)
    }
    this.picture.syncBloom(gradeGolden.value)
    this.world.orientStreetNames(this.camera)
    this.picture.render()
    this.input.endFrame()
    requestAnimationFrame(this.frame)
  }

  private hudHidden(): boolean {
    const hud = document.getElementById('hud')
    const hidden = hud ? !hud.hidden : false
    return hidden
  }

  private simulate(dt: number): void {
    if (this.eraAnim) return
    if (this.input.useEdge) this.use()
    if (this.portals?.locked) return
    if (this.input.hornEdge) this.horn()
    if (this.ride === 'foot') {
      const f = forwardFromHeading(this.cam.yaw)
      const r = rightFromHeading(this.cam.yaw)
      let wx = f.x * this.input.moveY + r.x * this.input.moveX
      let wz = f.z * this.input.moveY + r.z * this.input.moveX
      const mag = Math.hypot(wx, wz)
      if (mag > 1) {
        wx /= mag
        wz /= mag
      }
      let takeoff = (this.input.flyEdge || this.input.flyHoldEdge || this.travelTakeoff) && !this.walker.flying && !this.portals?.inside
      const settle = (this.input.flyEdge && this.walker.flying) || this.travelSettle
      this.travelTakeoff = false
      this.travelSettle = false
      const wasFlying = this.walker.flying
      const wasGrounded = this.walker.onGround && !wasFlying
      const pace = this.walker.flying || takeoff ? 1 : this.input.sprint ? 6.5 : 2.45
      let ascend = this.input.ascend
      if (this.walker.flying && this.input.usingTouch && this.input.moveY < -0.15) {
        ascend = Math.max(-1, Math.min(1, ascend + this.input.moveY))
      }
      const flight: FlightInput = {
        takeoff,
        settle,
        ascend,
        steer: this.input.moveX,
        boost: this.input.sprint,
      }
      this.walker.update(dt, wx * pace, wz * pace, this.input.jumpEdge && !takeoff, this.world, flight)
      if (!wasFlying && this.walker.flying) {
        this.audio.whoosh(1)
        this.audio.blip('fly', this.walker.kid.bright)
        navigator.vibrate?.(16)
        this.hud.noteCoach()
      } else if (this.walker.landFx === 'pound') {
        this.audio.thud()
        this.hud.toast('Ground pound.')
      } else if (this.walker.landFx === 'soft') this.audio.whoosh(0.45)
      else if (wasGrounded && !this.walker.onGround && !this.walker.flying) this.audio.blip('jump', this.walker.kid.bright)
      if (this.walker.onGround && !this.walker.flying && this.walker.speed > 1.8 && !this.walker.swimming) {
        this.step -= dt
        if (this.step <= 0) {
          this.audio.foot(this.walker.kid.bright)
          const quick = this.walker.kid.stride
          this.step = (this.input.sprint ? 0.26 : 0.4) / quick
        }
      }
    } else if (this.active) {
      const vehicleInput: VehicleInput = {
        throttle: this.input.throttle,
        steer: this.input.steer,
        handbrake: this.input.handbrake && this.ride === 'car',
        ascend: this.ride === 'heli' ? this.input.ascend : 0,
      }
      this.active.update(dt, vehicleInput, this.world)
      this.walker.animate(dt)
      if (this.active === this.wagon && Math.abs(this.wagon.speed) > 0.8) {
        this.hoof -= dt
        if (this.hoof <= 0) {
          this.audio.clop()
          this.hoof = 0.42
        }
      }
    }
    if (this.juice && this.activities && this.rewards && !this.portals?.inside) {
      const here = this.position()
      this.juice.update(dt, this.active instanceof Car ? this.active : null)
      const note = this.activities.update(dt, here.x, here.y, here.z, this.world, this.discover)
      if (note) {
        if (note.gems > 0) this.rewards.grant(note.gems, note.text)
        else this.hud.toast(note.text)
      }
      this.rewards.step(here.x, here.z, this.discover.placeCount().found)
    }
    if (this.portals?.inside) this.portals.contain(this.walker.x, this.walker.z, (dx, dz) => this.walker.ease(dx, dz))
    else this.softenEdge(dt)
    if (this.atmo.sunAlt > 0.05) {
      this.bird -= dt
      if (this.bird <= 0) {
        this.audio.chirp()
        this.bird = 4 + Math.random() * 7
      }
    }
  }

  private nearestRide(reach = 3.5): Mount | null {
    const ox = this.active ? this.active.x : this.walker.x
    const oz = this.active ? this.active.z : this.walker.z
    const oy = this.active ? this.active.y : this.walker.y
    let best: Mount | null = null
    let bestD = reach
    for (const ride of [this.bike, this.wagon, this.vintage, this.car, this.heli]) {
      if (!ride.group.visible || ride === this.active) continue
      const d = Math.hypot(ride.x - ox, ride.z - oz)
      if (d < bestD && Math.abs(ride.y - oy) < 3) {
        best = ride
        bestD = d
      }
    }
    return best
  }

  private nearClock(): boolean {
    if (!this.townClock) return false
    return Math.hypot(this.clock.x - this.walker.x, this.clock.z - this.walker.z) < 2.4 && Math.abs(this.clock.y - this.walker.y) < 3
  }

  private rideName(ride: Mount): string {
    if (ride === this.heli) return 'helicopter'
    if (ride === this.bike) return 'bike'
    if (ride === this.wagon) return 'wagon'
    if (ride === this.vintage) return 'vintage car'
    return 'car'
  }

  private chooseTravel(kind: string): void {
    if (kind === 'drone') {
      this.cam.setDrone(true)
      this.hud.toast('Drone view.')
      this.hud.toggleWheel(false)
      return
    }
    this.cam.setDrone(false)
    this.hud.toggleWheel(false)
    if (kind === 'walk') {
      if (this.ride !== 'foot') this.dismount()
      this.travelSettle = this.walker.flying
      return
    }
    if (kind === 'fly') {
      if (this.ride !== 'foot') this.dismount()
      this.travelTakeoff = true
      return
    }
    const ride = kind === 'bike' ? this.bike : kind === 'heli' ? this.heli : this.car
    if (!ride) return
    const heading = this.walker.heading
    const right = rightFromHeading(heading)
    const x = this.walker.x + Math.sin(heading) * 3.2 + right.x * 1.6
    const z = this.walker.z - Math.cos(heading) * 3.2 + right.z * 1.6
    if (this.walker.flying) this.travelSettle = true
    if (this.ride !== 'foot') this.dismount()
    ride.place(x, z, heading, this.world)
    this.hud.poof(kind === 'bike' ? 'Bike' : kind === 'heli' ? 'Helicopter' : 'Car')
    this.audio.whoosh(0.7)
    this.mount(ride, true)
  }

  private use(): void {
    const portal = this.portals?.tryUse(this.ride === 'foot' && !this.walker.flying) ?? null
    if (portal === 'go') {
      this.audio.portal()
      return
    }
    if (portal === 'wait') {
      this.hud.toast('The memory is still gathering.')
      return
    }
    if (portal === 'error') {
      this.hud.toast('This memory couldn’t be opened.')
      return
    }
    if (this.ride === 'foot' && !this.walker.flying && !this.nearestRide() && this.nearClock()) {
      this.pause()
      this.hud.toast('Wind the town clock.')
      return
    }
    if (this.ride !== 'foot') {
      const swap = this.nearestRide(8)
      if (swap) {
        this.mount(swap, false)
        return
      }
      if (this.ride === 'heli' && this.heli.agl > 3.4) {
        this.hud.toast('Set the helicopter down before you hop out.')
        return
      }
      this.dismount()
      return
    }
    const ride = this.nearestRide()
    if (!ride) return
    this.mount(ride, true)
  }

  private mount(ride: Mount, cutCam: boolean): void {
    this.ride = ride.kind
    this.active = ride
    this.walker.sit(true)
    ride.seat.add(this.walker.group)
    this.walker.group.position.set(0, -0.74, 0)
    this.walker.group.rotation.set(0, 0, 0)
    if (cutCam) this.cam.snap(ride.heading)
  }

  private dismount(): void {
    const ride = this.active
    if (!ride) return
    const right = rightFromHeading(ride.heading)
    let x = ride.x + right.x * 1.9
    let z = ride.z + right.z * 1.9
    if (this.world.isDeep(x, z)) {
      x = ride.x - right.x * 1.9
      z = ride.z - right.z * 1.9
    }
    const resolved = this.world.blockers.resolve(x, z, 0.4)
    this.scene.add(this.walker.group)
    this.walker.sit(false)
    this.walker.place(resolved.x, this.world.surface(resolved.x, resolved.z, null), resolved.z, ride.heading)
    this.ride = 'foot'
    this.active = null
    this.cam.snap(ride.heading)
  }

  private horn(): void {
    const pos = this.position()
    if (this.ride === 'bike') this.audio.bell()
    else if (this.active === this.wagon) this.audio.clop()
    else if (this.ride === 'car') this.audio.horn()
    else if (this.ride === 'heli') this.audio.horn()
    this.traffic.honk(pos.x, pos.z)
  }

  private greet(arrived: { id: string; kind: 'place' | 'view'; name: string; line: string; history: string; people: { name: string; role: string; contribution: string; source: string }[]; approximate: boolean }[]): void {
    if (arrived.length === 0) return
    this.audio.chime()
    const place = arrived.find((spot) => spot.kind === 'place')
    const view = arrived.find((spot) => spot.kind === 'view')
    const keep = this.coarse ? 'Tap Keep this view.' : 'Press V to keep the view.'
    if (place) {
      const lines = this.eraId === 'fifties' ? this.linesFor(place.id) : undefined
      this.hud.showStory({
        kicker: lines ? '1955' : 'Found',
        title: place.name,
        history: lines?.then || place.history,
        now: lines ? asToday(lines.now) : '',
        people: place.people,
        approximate: place.approximate,
        line: view ? keep : '',
      })
    } else if (view) {
      const lines = this.eraId === 'fifties' ? this.linesFor(view.id) : undefined
      this.hud.showStory({
        kicker: lines ? '1955' : 'A view',
        title: view.name,
        history: lines?.then || '',
        now: lines ? asToday(lines.now) : '',
        line: lines ? `${view.line} ${keep}` : `${view.line} ${keep}`,
      })
    }
  }

  private linesFor(id: string): ThenNow | undefined {
    const key = id === 'reservoir-rim' ? 'reservoir' : id
    const sourced = this.discover.lineFor(key)
    const baked = this.eraLines.get(key)
    if (!sourced && !baked) return undefined
    return { then: sourced?.then || baked?.then || '', now: sourced?.now || baked?.now || '' }
  }

  private togglePhoto(): void {
    if (this.photo) {
      this.exitPhoto()
      return
    }
    if (this.mode !== 'play' || this.hud.mapOpen) return
    const pos = this.position()
    const view = this.discover.viewHere(pos.x, pos.z)
    if (!view) return
    this.photo = true
    this.photoView = view
    this.photoRate = this.atmo.rate
    this.atmo.rate = 0
    this.photoCam = this.cam.mode
    this.photoHudWasHidden = document.getElementById('hud')?.hidden === true
    this.cam.mode = 'cine'
    this.input.allowLock = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.hud.setHudHidden(true)
    this.hud.setLetterbox(true)
    this.audio.shutter()
    this.hud.showStory({ kicker: 'Kept', title: view.name, line: view.line })
  }

  private exitPhoto(): void {
    if (!this.photo) return
    this.photo = false
    this.atmo.rate = this.photoRate
    this.cam.mode = this.photoCam
    this.cam.cut(this.position().heading)
    this.input.allowLock = this.mode === 'play'
    this.hud.setHudHidden(this.photoHudWasHidden)
    this.hud.setLetterbox(this.cam.mode === 'cine')
    this.hud.hideCard()
    this.photoView = null
  }

  private holdPhoto(pos: { x: number; y: number; z: number }): void {
    const view = this.photoView
    if (!view) return
    const heading = Math.atan2(view.lookX - pos.x, -(view.lookZ - pos.z))
    const back = 11
    const x = pos.x - Math.sin(heading) * back
    const z = pos.z + Math.cos(heading) * back
    const y = Math.max(pos.y + 2.2, this.world.height.sample(x, z) + 1.1)
    this.camera.position.set(x, y, z)
    const lookY = this.world.height.sample(view.lookX, view.lookZ) + 6
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(view.lookX, lookY, view.lookZ)
    this.camera.fov = 36
    this.camera.updateProjectionMatrix()
  }

  private softenEdge(dt: number): void {
    const h = this.world.height
    const pos = this.position()
    const soft = 64
    const hard = 12
    const minX = h.originX + soft
    const maxX = h.originX + h.sizeX - soft
    const minZ = h.originZ + soft
    const maxZ = h.originZ + h.sizeZ - soft
    let dx = 0
    let dz = 0
    if (pos.x < minX) dx = minX - pos.x
    else if (pos.x > maxX) dx = maxX - pos.x
    if (pos.z < minZ) dz = minZ - pos.z
    else if (pos.z > maxZ) dz = maxZ - pos.z
    if (dx === 0 && dz === 0) return
    const pull = 1 - Math.exp(-1.7 * dt)
    dx *= pull
    dz *= pull
    const hx0 = h.originX + hard
    const hx1 = h.originX + h.sizeX - hard
    const hz0 = h.originZ + hard
    const hz1 = h.originZ + h.sizeZ - hard
    const nx = pos.x + dx
    const nz = pos.z + dz
    if (nx < hx0) dx = hx0 - pos.x
    else if (nx > hx1) dx = hx1 - pos.x
    if (nz < hz0) dz = hz0 - pos.z
    else if (nz > hz1) dz = hz1 - pos.z
    if (this.ride === 'foot') this.walker.ease(dx, dz)
    else this.active?.ease(dx, dz)
    if (!this.edgeNote) {
      this.edgeNote = true
      this.hud.toast('The mapped hills ease you back. The real ones keep going.')
    }
  }

  private face(x: number, z: number): void {
    const px = this.active ? this.active.x : this.walker.x
    const pz = this.active ? this.active.z : this.walker.z
    const heading = Math.atan2(x - px, -(z - pz))
    if (this.active) this.active.heading = heading
    this.walker.heading = heading
    this.cam.snap(heading)
  }

  private parkOnShore(vehicle: { x: number; z: number; heading: number; place: (x: number, z: number, h: number, world: World) => void }): void {
    if (!this.world.isDeep(vehicle.x, vehicle.z)) return
    for (let i = 1; i <= 36; i++) {
      const x = vehicle.x + i * 14
      if (!this.world.isDeep(x, vehicle.z)) {
        vehicle.place(x, vehicle.z, vehicle.heading, this.world)
        return
      }
    }
  }

  private travel(x: number, z: number): void {
    if (this.portals?.inside || this.portals?.locked) this.portals.forceExit()
    if (this.ride !== 'foot') this.dismount()
    if (this.world.isDeep(x, z)) {
      this.hud.toast('That’s open water. Pick a spot on the shore.')
      return
    }
    if (this.mode === 'pause') this.resume()
    const y = this.world.surface(x, z, null)
    this.walker.place(x, y, z, this.walker.heading)
    this.cam.cut(this.walker.heading)
    this.meadow?.bump()
    this.hud.toggleMap(false)
    if (this.mode === 'title') this.play()
  }

  private readonly ear = new THREE.Vector3()

  private mixAudio(pos: { x: number; z: number; speed: number }): void {
    const rush = this.walker.flying ? Math.min(1.35, this.walker.airSpeed / 16) : 0
    this.audio.wind(0.15 + this.atmo.wind * 0.6 + (this.ride === 'heli' ? 0.35 : 0) + rush)
    this.audio.rotor(0.7, this.heli.rpm())
    const engine = this.active === this.wagon ? 0 : this.ride === 'car' ? (this.active === this.vintage ? 0.75 : 1) : this.ride === 'bike' ? 0.35 : 0
    this.audio.engine(engine, pos.speed)
    this.camera.getWorldDirection(this.ear)
    this.audio.hear(this.camera.position, this.ear, this.heli, this.car)
  }

  private swapMemory(swap: { kind: 'enter' | 'exit'; x: number; y: number; z: number; heading: number; title: string; blurb: string; credit: string }): void {
    this.world.memoryFloor = swap.kind === 'enter' ? swap.y : null
    const y = swap.kind === 'enter' ? swap.y : this.world.surface(swap.x, swap.z, null)
    if (this.ride !== 'foot') this.dismount()
    this.walker.place(swap.x, y, swap.z, swap.heading)
    this.cam.cut(swap.heading)
    if (swap.kind === 'enter' && swap.title) {
      this.hud.showStory({
        kicker: 'Memory',
        title: swap.title,
        history: swap.blurb,
        line: swap.credit,
      })
    }
  }

  private present(pos: { x: number; y: number; z: number; speed: number; agl: number; heading: number }): void {
    const flying = this.ride === 'foot' && this.walker.flying
    const near = this.ride === 'foot' && !flying && !this.portals?.inside ? this.nearestRide() : null
    const swap = this.ride !== 'foot' && !this.portals?.inside ? this.nearestRide(8) : null
    const clock = this.ride === 'foot' && !flying && !near && !this.portals?.inside && this.nearClock()
    const touch = this.input.usingTouch
    const portal = this.portals?.hint(this.ride === 'foot' && !flying, touch) ?? { prompt: null, use: null }
    const pill = portal.use ?? (clock ? 'Town clock' : near ? `Hop on ${this.rideName(near)}` : swap ? 'Hop out' : this.ride !== 'foot' ? 'Hop out' : null)
    this.hud.setUseLabel(pill)
    this.hud.setContext(flying ? 'Up' : 'Jump')
    const prompt = portal.prompt
      ? portal.prompt
      : near
      ? touch
        ? ''
        : `Press E to ride the ${this.rideName(near)}`
      : clock
        ? touch
          ? ''
          : 'Press E. The town clock can change the year.'
      : this.ride !== 'foot'
        ? ''
        : ''
    const crossing = this.portals?.inside === true || this.portals?.locked === true
    const hint = crossing ? (touch ? 'Walk to the door' : 'E at the door steps back') : this.hud.coachLine(touch)
    const speed = flying
      ? `${Math.round(pos.speed * 3.6)} km/h · ${Math.round(pos.agl)} m up`
      : this.ride === 'heli'
        ? `${Math.round(pos.speed * 3.6)} km/h · ${Math.round(pos.agl)} m up`
        : this.ride === 'foot'
          ? this.walker.swimming
            ? 'Swimming'
            : ''
          : `${Math.round(pos.speed * 3.6)} km/h`
    const places = this.discover.placeCount()
    const keeps = this.collect.keepsakes
    const viewHere = this.discover.viewHere(pos.x, pos.z)
    this.hud.setPhotoOffer(viewHere ? 'Keep this view' : null)
    this.hud.setRoam((x, z) => this.discover.revealed(x, z), this.discover.foundPlaces(), this.discover.hall())
    const weather = this.atmo.rain > 0.45 ? 'Rain' : this.atmo.fog > 0.45 ? 'Fog on the hills' : this.atmo.overcast > 0.45 ? 'Overcast' : 'Clear'
    const where = this.portals?.label || this.world.placeName(pos.x, pos.z)
    const place = this.eraId === 'today' || this.portals?.label ? where : `${where} · ${ERA_BY_ID[this.eraId].short}`
    this.hud.update({
      minutes: this.atmo.minutes,
      weather: `${weather}${this.atmo.season === 'summer' ? '' : this.atmo.season === 'winter' ? ' · winter hills' : ' · spring hills'}`,
      place,
      found: `Places ${places.found}/${places.total} · Keepsakes ${keeps.found}/${keeps.total}`,
      prompt,
      hint,
      speed,
      fps: this.hud.debugOpen ? `${Math.round(this.fps)} fps` : '',
      x: pos.x,
      z: pos.z,
      heading: pos.heading,
      gems: this.rewards?.gemsLabel() ?? '0 gems',
      distance: this.rewards?.distanceLabel() ?? '0 m',
      activity: this.activities?.label() ?? '',
      miniSpan: flying || this.ride === 'heli' ? 700 : 220,
    })
  }

  private maybeAdapt(): void {
    if (this.adapted) return
    this.fpsWarm += 1
    if (this.fpsWarm < 240) return
    if (this.fps < 34 && this.quality !== 'low') {
      this.adapted = true
      this.applyQuality(this.quality === 'high' ? 'medium' : 'low')
      this.hud.toast('Softened the picture so the town stays smooth.')
    } else this.adapted = true
  }

  private chooseKid(id: KidId): void {
    const changed = id !== this.kidId
    this.kidId = id
    saveKid(id)
    this.walker.swap(id)
    this.hud.setKid(id)
    this.waveUntil[id] = performance.now() + 900
    if (changed) {
      this.audio.ensure()
      this.audio.blip('pick', KIDS[id].bright)
      this.hud.toast(`${KIDS[id].name}’s turn.`)
    }
  }

  private hoverKid(id: KidId | null): void {
    if (id === this.hover) return
    this.hover = id
    if (!id) return
    this.waveUntil[id] = performance.now() + 800
    this.audio.ensure()
    this.audio.blip('hello', KIDS[id].bright)
  }

  private showEraRides(spec: EraSpec): void {
    const allowed = (ride: Mount): boolean => {
      if (ride === this.wagon) return spec.rides.includes('wagon')
      if (ride === this.vintage) return spec.rides.includes('vintage')
      if (ride === this.car) return spec.rides.includes('car')
      return true
    }
    if (this.active && !allowed(this.active)) this.dismount()
    this.wagon.group.visible = spec.rides.includes('wagon')
    this.vintage.group.visible = spec.rides.includes('vintage')
    this.car.group.visible = spec.rides.includes('car')
  }

  private applyEra(id: EraId, announce: boolean): void {
    const spec = ERA_BY_ID[id]
    if (!spec.playable) return
    this.eraId = id
    saveEra(id)
    eraFilm.value = spec.grade
    this.discover.setYear(spec.year)
    this.world.setEra(spec.year)
    this.traffic.setPeriod(id === 'fifties' ? 'fifties' : 'today')
    this.discover.setMarquee(id === 'fifties')
    this.showEraRides(spec)
    this.audio.setEraBed(id === 'fifties')
    this.hud.setEra(id, spec.id === 'today' ? 'Today' : `${spec.short} · ${spec.label}`)
    if (announce) this.announceEra(spec)
  }

  private beginEra(id: EraId): void {
    const spec = ERA_BY_ID[id]
    if (!spec.playable) {
      this.hud.toast('That year is in the record, and the walkable town is still ahead. The clock can reach today and 1955.')
      return
    }
    if (id === this.eraId || this.eraAnim) return
    if (this.mode === 'boot' || this.mode === 'title') return
    if (this.portals?.inside || this.portals?.locked) {
      this.hud.toast('Step back outside before you change the year.')
      return
    }
    if (this.mode === 'pause') this.resume()
    this.audio.ensure()
    this.audio.eraShift()
    this.hud.setEraVeil(spec.year)
    this.eraAnim = { t: 0, phase: 'in', next: id, told: false }
  }

  private tickEra(dt: number): void {
    const anim = this.eraAnim
    if (!anim) return
    anim.t += dt
    if (anim.phase === 'in' && anim.t > 0.62) {
      this.applyEra(anim.next, false)
      anim.phase = 'hold'
      anim.t = 0
    } else if (anim.phase === 'hold' && anim.t > 0.42) {
      this.hud.setEraVeil(null)
      if (!anim.told) {
        anim.told = true
        this.announceEra(ERA_BY_ID[anim.next])
      }
      anim.phase = 'out'
      anim.t = 0
    } else if (anim.phase === 'out' && anim.t > 0.7) this.eraAnim = null
  }

  private announceEra(spec: EraSpec): void {
    const pos = this.position()
    const spot = spec.id === 'fifties' ? this.discover.nearestUnfound(pos.x, pos.z) : null
    const lines = spot ? this.linesFor(spot.id) : undefined
    if (spot && lines) {
      const story = this.discover.claim(spot.id)
      this.hud.showStory({
        kicker: '1955',
        title: story?.name || spot.name,
        history: lines.then,
        now: asToday(lines.now),
        people: story?.people ?? [],
        approximate: story?.approximate === true,
      })
      return
    }
    this.hud.showStory({
      kicker: spec.short,
      title: spec.label,
      history: spec.arrival,
      now: asToday(spec.todayLine),
    })
  }

  private togglePause(): void {
    if (this.eraAnim) return
    if (this.mode === 'boot' || this.mode === 'title') return
    if (this.hud.mapOpen) {
      this.hud.toggleMap(false)
      return
    }
    if (this.hud.debugOpen) {
      this.hud.toggleDebug(false)
      return
    }
    if (this.mode === 'pause') this.resume()
    else this.pause()
  }

  private pause(): void {
    this.mode = 'pause'
    this.input.allowLock = false
    if (document.pointerLockElement) document.exitPointerLock()
    this.walker.group.visible = false
    this.input.setTouchVisible(false)
    this.hud.showCast('pause')
  }

  private resume(): void {
    this.mode = 'play'
    this.input.allowLock = true
    this.walker.group.visible = true
    this.milo.group.visible = false
    this.juniper.group.visible = false
    this.castLight.visible = false
    this.hud.hideCast()
    this.input.setTouchVisible(true)
  }

  private stageCast(dt: number): void {
    this.camera.updateMatrixWorld()
    const now = performance.now()
    const w = window.innerWidth
    const h = window.innerHeight
    const buttons = document.querySelectorAll<HTMLButtonElement>('#cast [data-kid]')
    buttons.forEach((button) => {
      const id = (button.dataset.kid || 'milo') as KidId
      const kid = id === 'juniper' ? this.juniper : this.milo
      const rect = button.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height * 0.4
      const ndcX = (cx / w) * 2 - 1
      const ndcY = -((cy / h) * 2 - 1)
      kid.stand(this.camera, ndcX, ndcY, 5.15)
      kid.setChosen(id === this.kidId)
      kid.preview(dt, now < this.waveUntil[id])
    })
    this.castLight.position.copy(this.milo.group.position).lerp(this.juniper.group.position, 0.5)
    this.castLight.position.y += 0.6
    this.castLight.visible = true
  }

  private fly(t: number): void {
    const place = (id: string) => this.meta.places.find((p) => p.id === id) ?? this.meta.places[0]
    const d = place('downtown')
    const r = place('reservoir')
    const o = place('overlook')
    const keys = [
      { p: [d.x + 50, 150, d.z + 110], l: [d.x, 96, d.z] },
      { p: [d.x - 90, 112, d.z + 16], l: [d.x + 70, 94, d.z - 6] },
      { p: [o.x + 24, 168, o.z + 70], l: [o.x, 145, o.z] },
      { p: [r.x + 160, 180, r.z - 10], l: [r.x - 30, 142, r.z] },
      { p: [r.x - 240, 210, r.z + 80], l: [r.x, 140, r.z] },
      { p: [d.x - 10, 175, d.z - 90], l: [d.x + 20, 96, d.z] },
    ]
    const span = 9
    const u = (t % (keys.length * span)) / span
    const i = Math.floor(u) % keys.length
    const f = u - Math.floor(u)
    const s = f * f * (3 - 2 * f)
    const a = keys[i]
    const b = keys[(i + 1) % keys.length]
    const mix = (k: number) => a.p[k] + (b.p[k] - a.p[k]) * s
    const look = (k: number) => a.l[k] + (b.l[k] - a.l[k]) * s
    const x = mix(0)
    const z = mix(2)
    this.look.set(look(0), look(1), look(2))
    const y = Math.max(mix(1), this.world.height.sample(x, z) + 18)
    this.camera.position.set(x, y, z)
    this.camera.lookAt(look(0), look(1), look(2))
    this.camera.fov = 52
    this.camera.updateProjectionMatrix()
  }
}
