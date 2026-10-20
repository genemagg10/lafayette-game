import * as THREE from 'three'
import type { World } from './world.ts'
import { clamp, damp, dampAngle, forwardFromHeading, headingFromForward, rightFromHeading, wrapAngle } from './math.ts'
import { buildKid, KIDS, type Kid, type KidId, type KidRig } from './kids.ts'
import { sampleWind, windTime } from './wind.ts'

export interface FlightInput {
  takeoff: boolean
  settle: boolean
  ascend: number
  steer: number
  boost: boolean
}

export class Walker {
  readonly group = new THREE.Group()
  kid: Kid
  x = 0
  y = 0
  z = 0
  heading = 0
  vx = 0
  vy = 0
  vz = 0
  onGround = true
  swimming = false
  flying = false
  /** Clearance above the street, the hill, or the roof underfoot. */
  agl = 0
  /** Horizontal speed. */
  speed = 0
  /** Speed through the air, including the dive. */
  airSpeed = 0
  /** Visual roll in radians. The flight camera reads this. */
  bank = 0
  /** Set for the frame a landing completes. */
  landFx: 'soft' | 'pound' | null = null
  private sitting = false
  private phase = 0
  private settling = false
  private rolling = false
  private roll = 0
  private rollDir = 1
  private rollCool = 0
  private pitch = 0
  private bob = 0
  private landT = 0
  private landKind: 'soft' | 'pound' = 'soft'
  private hips!: THREE.Group
  private cape!: THREE.Group
  private capeTip!: THREE.Group
  private backpack!: THREE.Mesh
  private head!: THREE.Group
  private leftLeg!: THREE.Group
  private rightLeg!: THREE.Group
  private leftArm!: THREE.Group
  private rightArm!: THREE.Group
  private readonly rigs: Record<KidId, KidRig>

  constructor(id: KidId = 'milo') {
    this.kid = KIDS[id]
    this.group.rotation.order = 'YXZ'
    this.group.name = id
    this.rigs = {
      milo: buildKid(KIDS.milo),
      juniper: buildKid(KIDS.juniper),
    }
    this.group.add(this.rigs.milo.hips, this.rigs.juniper.hips, this.rigs.milo.ring, this.rigs.juniper.ring)
    this.useRig(id)
  }

  swap(id: KidId): void {
    if (this.kid.id === id) return
    this.useRig(id)
    if (this.sitting) this.restLimbs()
  }

  /** Gold ring under a portrait on the select screen. */
  setChosen(on: boolean): void {
    this.rigs.milo.ring.visible = on && this.kid.id === 'milo'
    this.rigs.juniper.ring.visible = on && this.kid.id === 'juniper'
  }

  private useRig(id: KidId): void {
    this.kid = KIDS[id]
    this.group.name = id
    const rig = this.rigs[id]
    this.rigs.milo.hips.visible = id === 'milo'
    this.rigs.juniper.hips.visible = id === 'juniper'
    this.hips = rig.hips
    this.head = rig.head
    this.leftLeg = rig.leftLeg
    this.rightLeg = rig.rightLeg
    this.leftArm = rig.leftArm
    this.rightArm = rig.rightArm
    this.cape = rig.cloth
    this.capeTip = rig.clothTip
    this.backpack = rig.pack
  }

  /**
   * Place the portrait in front of the camera so it sits inside a screen card.
   * ndcX/ndcY are the point on the card the body should occupy.
   */
  stand(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number, dist: number): void {
    const ndc = new THREE.Vector3(ndcX, ndcY, 0.5)
    ndc.unproject(camera)
    const dir = ndc.sub(camera.position).normalize()
    this.group.position.copy(camera.position).addScaledVector(dir, dist)
    this.group.quaternion.copy(camera.quaternion)
    this.group.rotateY(Math.PI)
    this.group.scale.setScalar(1.28)
    this.group.visible = true
  }

  /** Idle sway, and a wave while the card is hovered. */
  preview(dt: number, wave: boolean): void {
    const tempo = this.kid.wave === 'big' ? 2.1 : 1.55
    this.phase += dt * (wave ? tempo * 3.2 : tempo)
    const bob = Math.sin(this.phase) * 0.07 * this.kid.bounce
    this.hips.position.y = 0.74 + bob
    this.hips.position.x = Math.sin(this.phase * 0.5) * 0.03 * this.kid.bounce
    this.hips.rotation.set(0, 0, Math.sin(this.phase * 0.65) * 0.045)
    this.head.rotation.set(Math.sin(this.phase * 0.8) * 0.05, Math.sin(this.phase * 0.42) * 0.2, 0)
    this.leftLeg.rotation.set(Math.sin(this.phase * 0.5) * 0.06, 0, 0)
    this.rightLeg.rotation.set(-Math.sin(this.phase * 0.5) * 0.06, 0, 0)
    this.leftArm.rotation.set(0.12, 0, 0.08)
    this.rightArm.rotation.set(0.12, 0, -0.08)
    if (wave) {
      const arm = this.kid.wave === 'big' ? this.rightArm : this.leftArm
      const sign = this.kid.wave === 'big' ? -1 : 1
      const flap = Math.sin(this.phase * (this.kid.wave === 'big' ? 8.5 : 6))
      const reach = this.kid.wave === 'big' ? 0.5 : 0.28
      arm.rotation.set(0.25, 0, sign * (1.05 + flap * reach))
      this.head.rotation.z = sign * (this.kid.wave === 'big' ? 0.16 : 0.08)
      this.head.rotation.y = sign * 0.2
    }
    this.backpack.visible = true
    this.poseCape(wave ? 0.28 : 0.06 + Math.sin(this.phase * 1.4) * 0.04)
  }

  /** Slide inward at the map edge without stopping the walk. */
  ease(dx: number, dz: number): void {
    this.x += dx
    this.z += dz
    const len = Math.hypot(dx, dz) || 1
    const nx = dx / len
    const nz = dz / len
    const along = this.vx * nx + this.vz * nz
    if (along < 0) {
      this.vx -= nx * along
      this.vz -= nz * along
    }
    this.group.position.x = this.x
    this.group.position.z = this.z
  }

  place(x: number, y: number, z: number, heading: number): void {
    this.x = x
    this.y = y
    this.z = z
    this.heading = heading
    this.vx = 0
    this.vy = 0
    this.vz = 0
    this.speed = 0
    this.airSpeed = 0
    this.flying = false
    this.settling = false
    this.rolling = false
    this.roll = 0
    this.bank = 0
    this.pitch = 0
    this.bob = 0
    this.landT = 0
    this.group.position.set(x, y, z)
    this.group.rotation.set(0, -heading, 0)
    this.group.scale.set(1, 1, 1)
    this.hips.scale.set(1, 1, 1)
  }

  sit(on: boolean): void {
    this.sitting = on
    if (on) {
      this.flying = false
      this.settling = false
      this.rolling = false
      this.roll = 0
      this.bank = 0
      this.pitch = 0
    }
    if (!on) this.restLimbs()
  }

  update(dt: number, wishX: number, wishZ: number, jump: boolean, world: World, flight?: FlightInput): void {
    this.landFx = null
    if (this.sitting) return
    if (flight?.takeoff && !this.flying) this.beginFlight(world)
    if (flight?.settle && this.flying) this.settling = true
    if (this.flying) {
      this.flyFrame(dt, wishX, wishZ, flight, world)
      return
    }
    this.walkFrame(dt, wishX, wishZ, jump, world)
  }

  private beginFlight(world: World): void {
    this.flying = true
    this.onGround = false
    this.swimming = false
    this.settling = false
    this.vy = Math.max(this.vy, 11.5)
    const f = forwardFromHeading(this.heading)
    const kick = 3.2 + Math.min(3.5, this.speed)
    this.vx += f.x * kick * 0.45
    this.vz += f.z * kick * 0.45
    if (world.isDeep(this.x, this.z)) this.y = Math.max(this.y, world.waterLevel + 0.35)
  }

  private flyFrame(dt: number, wishX: number, wishZ: number, flight: FlightInput | undefined, world: World): void {
    const ascend = flight?.ascend ?? 0
    const steer = flight?.steer ?? 0
    const boost = flight?.boost ?? false
    if (ascend > 0.2) this.settling = false

    const wish = Math.hypot(wishX, wishZ)
    const max = boost ? 36 : 27
    if (wish > 0.08) {
      const scale = Math.min(1, wish)
      const tx = (wishX / wish) * scale * max
      const tz = (wishZ / wish) * scale * max
      const rate = boost ? 2.5 : 1.65
      this.vx += (tx - this.vx) * (1 - Math.exp(-rate * dt))
      this.vz += (tz - this.vz) * (1 - Math.exp(-rate * dt))
    } else {
      const drag = this.settling ? 1.35 : 0.34
      this.vx *= Math.exp(-drag * dt)
      this.vz *= Math.exp(-drag * dt)
    }

    let targetVy = 0
    if (ascend > 0.12) targetVy = 12 * ascend
    else if (ascend < -0.12) targetVy = 20 * ascend
    if (this.settling) targetVy = Math.min(targetVy, -6.5)
    const vRate = Math.abs(ascend) > 0.12 || this.settling ? 2.8 : 1.6
    this.vy += (targetVy - this.vy) * (1 - Math.exp(-vRate * dt))

    if (this.vy < -3) {
      const f = forwardFromHeading(this.heading)
      const add = Math.min(18, -this.vy) * dt * 1.7
      this.vx += f.x * add
      this.vz += f.z * add
    }
    if (ascend > 0.2 && this.vy < -4) {
      const f = forwardFromHeading(this.heading)
      const pull = Math.min(-this.vy, 16) * dt * 1.35
      this.vx += f.x * pull
      this.vz += f.z * pull
      this.vy += pull * 0.7
    }
    if (!this.settling && Math.abs(ascend) < 0.15 && Math.hypot(this.vx, this.vz) < 6) {
      this.vy += Math.sin(this.phase * 1.7) * 1.6 * dt
    }

    this.speed = Math.hypot(this.vx, this.vz)
    const cap = 42
    if (this.speed > cap) {
      this.vx *= cap / this.speed
      this.vz *= cap / this.speed
      this.speed = cap
    }
    this.airSpeed = Math.hypot(this.speed, this.vy)

    let nx = this.x + this.vx * dt
    let nz = this.z + this.vz * dt
    let ny = this.y + this.vy * dt

    if (world.isDeep(nx, nz) && ny <= world.waterLevel + 0.08) {
      this.x = nx
      this.z = nz
      this.y = world.waterLevel - 0.2
      this.vx *= 0.25
      this.vz *= 0.25
      this.swimming = true
      this.endFlight('soft')
      this.measure(world)
      this.sync(dt)
      this.animate(dt)
      return
    }

    const roofAhead = world.blockers.roofAt(nx, nz)
    const clearOfRoofs = roofAhead != null && this.y >= roofAhead - 0.15
    const resolved = clearOfRoofs ? { x: nx, z: nz, hit: false } : world.blockers.resolve(nx, nz, 0.4, ny)
    if (resolved.hit) {
      const ox = resolved.x - nx
      const oz = resolved.z - nz
      const olen = Math.hypot(ox, oz) || 1
      const onx = ox / olen
      const onz = oz / olen
      const into = this.vx * onx + this.vz * onz
      if (into < 0) {
        this.vx -= onx * into
        this.vz -= onz * into
      }
      this.speed = Math.hypot(this.vx, this.vz)
    }
    nx = resolved.x
    nz = resolved.z

    const ground = world.surface(nx, nz, this.y)
    const roof = world.blockers.roofAt(nx, nz)
    let floor = ground
    if (roof != null && roof > ground + 0.45 && this.y >= roof - 0.35) floor = roof

    if (ny <= floor) {
      const impact = this.vy
      const skim = this.speed > 11 && impact > -9 && !this.settling && ascend > -0.35
      this.x = nx
      this.z = nz
      if (skim) {
        this.y = floor + 0.2
        this.vy = Math.max(4.5, 5 + Math.min(7, this.speed * 0.18))
        this.onGround = false
        this.turn(dt, wishX, wishZ, steer)
      } else {
        this.y = floor
        const pound = impact < -11 || (ascend < -0.45 && impact < -6)
        this.endFlight(pound ? 'pound' : 'soft')
      }
    } else {
      this.x = nx
      this.z = nz
      this.y = ny
      this.onGround = false
      this.turn(dt, wishX, wishZ, steer)
    }

    this.measure(world)
    this.sync(dt)
    this.animate(dt)
  }

  private turn(dt: number, wishX: number, wishZ: number, steer: number): void {
    const prev = this.heading
    if (this.speed > 1.4) this.heading = dampAngle(this.heading, headingFromForward(this.vx, this.vz), 5.2, dt)
    else if (Math.hypot(wishX, wishZ) > 0.2) this.heading = dampAngle(this.heading, headingFromForward(wishX, wishZ), 7, dt)
    const yawRate = wrapAngle(this.heading - prev) / Math.max(dt, 0.001)
    const targetBank = clamp(-steer * 0.95 - yawRate * 0.04, -1.05, 1.05)
    this.rollCool = Math.max(0, this.rollCool - dt)
    if (!this.rolling && this.rollCool <= 0 && Math.abs(steer) > 0.9 && this.speed > 15) {
      this.rolling = true
      this.rollDir = steer > 0 ? -1 : 1
      this.roll = 0
      const side = rightFromHeading(this.heading)
      const kick = steer > 0 ? 1 : -1
      this.vx += side.x * kick * 5
      this.vz += side.z * kick * 5
    }
    if (this.rolling) {
      const remaining = Math.PI * 2 - Math.abs(this.roll)
      this.roll += this.rollDir * Math.min(remaining, dt * (Math.PI * 2 / 0.48))
      if (Math.abs(this.roll) >= Math.PI * 2 - 0.04) {
        this.rolling = false
        this.roll = 0
        this.rollCool = 0.7
        this.bank = targetBank
      } else {
        this.bank = this.roll + targetBank * 0.15
      }
    } else {
      if (Math.abs(this.bank) > 2.4) this.bank = targetBank
      else this.bank = damp(this.bank, targetBank, 6, dt)
    }
    const glide = clamp(this.speed / 14, 0, 1)
    const nose = clamp(-0.2 * (1 - glide) + 0.14 * glide + Math.max(0, -this.vy) * 0.05, -0.45, 0.95)
    this.pitch = damp(this.pitch, nose, 4.5, dt)
  }

  private endFlight(kind: 'soft' | 'pound'): void {
    this.flying = false
    this.settling = false
    this.rolling = false
    this.roll = 0
    this.onGround = true
    this.vy = 0
    this.landFx = kind
    this.landKind = kind
    this.landT = kind === 'pound' ? 0.36 : 0.18
    const s = Math.hypot(this.vx, this.vz)
    const keep = kind === 'pound' ? 1.1 : 5.2
    if (s > keep) {
      this.vx *= keep / s
      this.vz *= keep / s
    }
    this.speed = Math.hypot(this.vx, this.vz)
    this.airSpeed = this.speed
    this.pitch = damp(this.pitch, 0, 1, 0.2)
  }

  private walkFrame(dt: number, wishX: number, wishZ: number, jump: boolean, world: World): void {
    const deep = world.isDeep(this.x, this.z)
    this.swimming = deep
    const target = deep ? 0.45 : 1
    this.vx += (wishX * target - this.vx) * (1 - Math.exp(-12 * dt))
    this.vz += (wishZ * target - this.vz) * (1 - Math.exp(-12 * dt))
    this.speed = Math.hypot(this.vx, this.vz)
    this.airSpeed = this.speed

    if (deep) {
      this.vy += (0 - this.vy) * (1 - Math.exp(-4 * dt))
      this.y = world.waterLevel - 0.2
      this.onGround = true
    } else {
      this.vy -= 22 * dt
      if (this.onGround && jump) {
        this.vy = 7.1
        this.onGround = false
      }
    }

    let nx = this.x + this.vx * dt
    let nz = this.z + this.vz * dt
    const resolved = world.blockers.resolve(nx, nz, 0.34, this.y)
    if (resolved.hit) {
      this.vx *= 0.4
      this.vz *= 0.4
    }
    nx = resolved.x
    nz = resolved.z
    if (!deep) {
      const ground = world.surface(nx, nz, this.y)
      const roof = world.blockers.roofAt(nx, nz)
      let floor = ground
      if (roof != null && roof > ground + 0.45 && this.y >= roof - 0.35) floor = roof
      const nextY = this.y + this.vy * dt
      if (nextY <= floor) {
        this.y = floor
        this.vy = 0
        this.onGround = true
      } else {
        this.y = nextY
        this.onGround = false
      }
    }
    this.x = nx
    this.z = nz
    if (this.speed > 0.25) {
      const face = headingFromForward(this.vx, this.vz)
      this.heading = dampAngle(this.heading, face, 10, dt)
    }
    this.bank = damp(this.bank, 0, 8, dt)
    this.pitch = damp(this.pitch, 0, 8, dt)
    this.measure(world)
    this.sync(dt)
    this.animate(dt)
  }

  private measure(world: World): void {
    const terrain = world.surface(this.x, this.z, this.y)
    const roof = world.blockers.roofAt(this.x, this.z)
    let ground = terrain
    if (roof != null && this.y >= roof - 0.3 && roof > terrain) ground = roof
    this.agl = Math.max(0, this.y - ground)
  }

  private sync(dt: number): void {
    const hover = this.flying && this.speed < 7 && Math.abs(this.vy) < 2.4 ? 0.11 : 0
    this.bob = damp(this.bob, Math.sin(this.phase * 1.8) * hover, 6, dt)
    this.group.position.set(this.x, this.y + this.bob, this.z)
    this.group.rotation.y = -this.heading
    this.group.rotation.x = this.pitch
    this.group.rotation.z = this.flying ? this.bank : damp(this.group.rotation.z, 0, 8, dt)
  }

  private restLimbs(): void {
    this.hips.rotation.set(0, 0, 0)
    this.head.rotation.set(0, 0, 0)
    this.leftLeg.rotation.set(0, 0, 0)
    this.rightLeg.rotation.set(0, 0, 0)
    this.leftArm.rotation.set(0, 0, 0)
    this.rightArm.rotation.set(0, 0, 0)
  }

  animate(dt: number): void {
    const run = this.speed > 4.2 && this.onGround && !this.flying
    const tempo = (this.flying ? 7 : this.swimming ? 6 : run ? 11 : 8) * this.kid.stride
    this.phase += dt * tempo * Math.max(this.flying ? 0.8 : 0.35, this.speed * 0.45)
    if (this.landT > 0) {
      this.landT = Math.max(0, this.landT - dt)
      const span = this.landKind === 'pound' ? 0.36 : 0.18
      const k = clamp(this.landT / span, 0, 1)
      const squash = this.landKind === 'pound' ? 0.68 : 0.9
      const s = 1 - (1 - squash) * k
      this.hips.scale.set(1 + (1 - s) * 0.55, s, 1 + (1 - s) * 0.55)
    } else if (!this.sitting) {
      this.hips.scale.set(1, 1, 1)
    }
    const hop = run ? Math.abs(Math.sin(this.phase)) * 0.07 * this.kid.bounce : 0
    this.hips.position.y = 0.74 + hop
    this.hips.position.x = 0
    this.head.rotation.set(0, 0, 0)

    this.backpack.visible = !this.flying
    if (this.sitting) {
      const lean = this.kid.runLean > 0.1 ? 0.22 : 0.04
      this.hips.rotation.x = lean
      this.leftLeg.rotation.set(this.kid.jump === 'cheer' ? -1.25 : -1.05, 0, 0.06)
      this.rightLeg.rotation.set(this.kid.jump === 'cheer' ? -1.25 : -1.05, 0, -0.06)
      this.leftArm.rotation.set(this.kid.jump === 'cheer' ? -0.7 : -0.35, 0, 0.1)
      this.rightArm.rotation.set(this.kid.jump === 'cheer' ? -0.85 : -0.4, 0, -0.08)
      this.poseCape(0.15)
      return
    }
    this.hips.rotation.x = run ? this.kid.runLean : 0
    if (this.flying) {
      const flutter = Math.sin(this.phase * 2.2) * 0.05
      if (this.kid.flight === 'wide') {
        this.leftArm.rotation.set(0.35 + flutter, 0, 1.25)
        this.rightArm.rotation.set(0.35 - flutter, 0, -1.25)
        this.leftLeg.rotation.set(-0.2, 0, 0.18)
        this.rightLeg.rotation.set(-0.2, 0, -0.18)
      } else {
        const reach = 1.35 + Math.min(0.25, this.speed / 48)
        this.leftArm.rotation.set(reach + flutter, 0, 0.08)
        this.rightArm.rotation.set(-0.35 - flutter, 0, -0.15)
        this.leftLeg.rotation.set(-0.55, 0, 0.05)
        this.rightLeg.rotation.set(0.15, 0, -0.04)
      }
      this.poseCape(clamp(0.5 + this.airSpeed / 16, 0.5, 1.25))
      return
    }
    if (!this.onGround) {
      if (this.kid.jump === 'cheer') {
        this.leftArm.rotation.set(2.6, 0, 0.35)
        this.rightArm.rotation.set(2.6, 0, -0.35)
        this.leftLeg.rotation.set(0.35, 0, 0.08)
        this.rightLeg.rotation.set(-0.45, 0, -0.06)
      } else {
        this.leftArm.rotation.set(1.15, 0, 0.2)
        this.rightArm.rotation.set(1.15, 0, -0.2)
        this.leftLeg.rotation.set(-1.05, 0, 0.1)
        this.rightLeg.rotation.set(-1.15, 0, -0.1)
      }
      this.poseCape(0.4)
      return
    }
    const amp = Math.min(1, this.speed / (run ? 3.4 : 2.2))
    const s = Math.sin(this.phase) * amp * (this.swimming ? 0.35 : 0.72) * this.kid.swing
    this.leftLeg.rotation.set(s, 0, 0)
    this.rightLeg.rotation.set(-s, 0, 0)
    this.leftArm.rotation.set(-s * 0.7, 0, run ? 0.18 : 0)
    this.rightArm.rotation.set(s * 0.7, 0, run ? -0.18 : 0)
    this.poseCape(0.08 + amp * (run ? 0.22 : 0.12))
  }

  private poseCape(stream: number): void {
    const flutter = Math.sin(this.phase * 8.5) * (0.04 + stream * 0.12)
    const gust = sampleWind(this.x, this.z, windTime.value)
    const side = gust.x * Math.cos(this.heading) + gust.z * Math.sin(this.heading)
    const back = -gust.x * Math.sin(this.heading) + gust.z * Math.cos(this.heading)
    this.cape.rotation.x = -0.12 - stream * 1.05 + flutter + back * 0.9
    this.cape.rotation.z = Math.sin(this.phase * 5.5) * (0.04 + stream * 0.08) + side * 1.35
    this.capeTip.rotation.x = -stream * 0.42 + Math.sin(this.phase * 11 + 0.7) * (0.06 + stream * 0.18) + back * 0.4
    this.capeTip.rotation.z = Math.sin(this.phase * 7 + 0.4) * stream * 0.08 + side * 0.45
  }
}
