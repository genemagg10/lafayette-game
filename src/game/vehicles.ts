import * as THREE from 'three'
import type { World } from './world.ts'
import { damp, forwardFromHeading } from './math.ts'

export interface VehicleInput {
  throttle: number
  steer: number
  handbrake: boolean
  ascend: number
}

abstract class Vehicle {
  readonly group = new THREE.Group()
  readonly seat = new THREE.Object3D()
  x = 0
  y = 0
  z = 0
  heading = 0
  speed = 0
  agl = 0
  protected vx = 0
  protected vz = 0

  constructor() {
    this.group.add(this.seat)
  }

  ease(dx: number, dz: number): void {
    this.x += dx
    this.z += dz
    const len = Math.hypot(dx, dz) || 1
    const nx = dx / len
    const nz = dz / len
    const fx = Math.sin(this.heading)
    const fz = -Math.cos(this.heading)
    if (fx * nx + fz * nz < 0) this.speed *= 0.72
    const along = this.vx * nx + this.vz * nz
    if (along < 0) {
      this.vx -= nx * along
      this.vz -= nz * along
    }
    this.sync()
  }

  place(x: number, z: number, heading: number, world: World): void {
    this.x = x
    this.z = z
    this.heading = heading
    this.y = world.surface(x, z, null)
    this.sync()
  }

  protected sync(): void {
    this.group.position.set(this.x, this.y, this.z)
    this.group.rotation.y = -this.heading
  }

  protected blocked(nx: number, nz: number, radius: number, world: World): { x: number; z: number; hit: boolean; wet: boolean } {
    if (world.isDeep(nx, nz)) return { x: this.x, z: this.z, hit: true, wet: true }
    const resolved = world.blockers.resolve(nx, nz, radius)
    return { x: resolved.x, z: resolved.z, hit: resolved.hit, wet: false }
  }

  setNight(_amount: number): void {}
  abstract update(dt: number, input: VehicleInput, world: World): void
}

export class Bike extends Vehicle {
  readonly kind = 'bike' as const
  private spin = 0
  private wheels: THREE.Object3D[] = []
  private frame: THREE.Group

  constructor() {
    super()
    this.frame = new THREE.Group()
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.45, metalness: 0.2 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.7 })
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.035) => {
      const dir = b.clone().sub(a)
      const len = dir.length()
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), frameMat)
      mesh.position.copy(a).add(b).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
      mesh.castShadow = true
      this.frame.add(mesh)
    }
    const wheel = (z: number) => {
      const g = new THREE.Group()
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 12), dark)
      tire.rotation.y = Math.PI / 2
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), frameMat)
      hub.rotation.z = Math.PI / 2
      g.add(tire, hub)
      g.position.set(0, 0.34, z)
      this.frame.add(g)
      this.wheels.push(g)
      return g
    }
    wheel(0.72)
    wheel(-0.62)
    tube(new THREE.Vector3(0, 0.34, 0.72), new THREE.Vector3(0, 0.72, 0.15))
    tube(new THREE.Vector3(0, 0.72, 0.15), new THREE.Vector3(0, 0.34, -0.62))
    tube(new THREE.Vector3(0, 0.34, -0.62), new THREE.Vector3(0, 0.95, -0.15))
    tube(new THREE.Vector3(0, 0.95, -0.15), new THREE.Vector3(0, 0.72, 0.15))
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 6), dark)
    bar.rotation.z = Math.PI / 2
    bar.position.set(0, 1.05, 0.42)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.28), dark)
    seat.position.set(0, 0.98, -0.12)
    this.frame.add(bar, seat)
    this.seat.position.set(0, 0.98, -0.08)
    this.group.add(this.frame)
  }

  update(dt: number, input: VehicleInput, world: World): void {
    const onRoad = world.onPaved(this.x, this.z, this.y) || !world.isDeep(this.x, this.z)
    const drive = input.throttle * (onRoad ? 13 : 11)
    this.speed += drive * dt
    const drag = Math.abs(input.throttle) < 0.05 ? 1.7 : 0.62
    this.speed -= this.speed * drag * dt
    this.speed = Math.max(-3.2, Math.min(14.2, this.speed))
    const fwd = forwardFromHeading(this.heading)
    const ahead = world.surface(this.x + fwd.x * 2, this.z + fwd.z * 2, this.y)
    const slope = ahead - this.y
    if (slope > 0.02) this.speed -= slope * 4.2 * dt
    const steer = input.steer * (2.35 / (1 + Math.abs(this.speed) * 0.045))
    this.heading += steer * dt * (this.speed >= 0 ? 1 : -1)
    const nx = this.x + Math.sin(this.heading) * this.speed * dt
    const nz = this.z - Math.cos(this.heading) * this.speed * dt
    const hit = this.blocked(nx, nz, 0.5, world)
    if (hit.hit) this.speed *= hit.wet ? 0.1 : 0.45
    this.x = hit.x
    this.z = hit.z
    const gy = world.surface(this.x, this.z, this.y)
    this.y = damp(this.y, gy, 12, dt)
    this.agl = this.y - world.height.sample(this.x, this.z)
    const nose = world.surface(this.x + Math.sin(this.heading) * 0.9, this.z - Math.cos(this.heading) * 0.9, this.y)
    const tail = world.surface(this.x - Math.sin(this.heading) * 0.7, this.z + Math.cos(this.heading) * 0.7, this.y)
    this.frame.rotation.x = damp(this.frame.rotation.x, Math.atan2(tail - nose, 1.6), 8, dt)
    this.frame.position.y = Math.sin(this.spin * 2.2) * Math.min(0.035, Math.abs(this.speed) * 0.003)
    this.frame.rotation.z = damp(this.frame.rotation.z, -input.steer * Math.min(0.38, Math.abs(this.speed) * 0.03), 8, dt)
    this.spin += this.speed * dt / 0.34
    for (const w of this.wheels) w.rotation.x = this.spin
    this.sync()
  }
}

export class Car extends Vehicle {
  readonly kind = 'car' as const
  readonly name: string
  readonly eraRide: 'car' | 'vintage'
  /** 0 when the tires hold, 1 in a full slide. */
  slide = 0
  private recover = 0
  private surge = 0
  private spin = 0
  private steerVis = 0
  private wheels: THREE.Object3D[] = []
  private front: THREE.Object3D[] = []
  private body: THREE.Group
  private headL: THREE.SpotLight
  private headR: THREE.SpotLight

  constructor(look: { paint: number; name: string; eraRide: 'car' | 'vintage' } | null = null) {
    super()
    this.name = look?.name ?? 'car'
    this.eraRide = look?.eraRide ?? 'car'
    const vintage = this.eraRide === 'vintage'
    this.body = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial({
      color: look?.paint ?? 0x3d7a6a,
      roughness: vintage ? 0.32 : 0.45,
      metalness: vintage ? 0.45 : 0.15,
    })
    const glass = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.15, metalness: 0.4 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.7 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe2a0, emissiveIntensity: 0.2 })
    const tail = new THREE.MeshStandardMaterial({ color: 0x8c1d1d, emissive: 0xff2a2a, emissiveIntensity: 0.15 })
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.72, vintage ? 0.62 : 0.55, vintage ? 4.35 : 4.15), paint)
    shell.position.set(0, vintage ? 0.7 : 0.62, 0)
    shell.castShadow = true
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, vintage ? 0.42 : 0.48, vintage ? 1.55 : 1.9), glass)
    cabin.position.set(0, vintage ? 1.12 : 1.05, vintage ? -0.05 : -0.15)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.16, 1.2), paint)
    hood.position.set(0, vintage ? 0.96 : 0.86, -1.35)
    this.body.add(shell, cabin, hood)
    if (vintage) {
      const chrome = new THREE.MeshStandardMaterial({ color: 0xe7eef2, roughness: 0.2, metalness: 0.85 })
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.12, 0.16), chrome)
      bumper.position.set(0, 0.48, -2.2)
      const bumper2 = bumper.clone()
      bumper2.position.z = 2.2
      const spear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 3.6), chrome)
      spear.position.set(0, 0.95, 0)
      this.body.add(bumper, bumper2, spear)
    }
    const lightGeo = new THREE.BoxGeometry(0.28, 0.14, 0.08)
    const hl = new THREE.Mesh(lightGeo, lamp)
    const hr = hl.clone()
    hl.position.set(-0.55, 0.7, -2.08)
    hr.position.set(0.55, 0.7, -2.08)
    const tl = new THREE.Mesh(lightGeo, tail)
    const tr = tl.clone()
    tl.position.set(-0.55, 0.72, 2.08)
    tr.position.set(0.55, 0.72, 2.08)
    this.body.add(hl, hr, tl, tr)
    this.group.add(this.body)

    const addWheel = (x: number, z: number, front: boolean) => {
      const steer = new THREE.Group()
      const spin = new THREE.Group()
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), dark)
      tire.rotation.z = Math.PI / 2
      spin.add(tire)
      if (vintage) {
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 0.23, 12),
          new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.55 }),
        )
        wall.rotation.z = Math.PI / 2
        spin.add(wall)
      }
      steer.add(spin)
      steer.position.set(x, 0.34, z)
      this.group.add(steer)
      this.wheels.push(spin)
      if (front) this.front.push(steer)
    }
    addWheel(-0.78, -1.35, true)
    addWheel(0.78, -1.35, true)
    addWheel(-0.78, 1.35, false)
    addWheel(0.78, 1.35, false)
    this.seat.position.set(-0.38, 0.78, -0.05)

    this.headL = new THREE.SpotLight(0xfff4d2, 0, 36, 0.55, 0.45, 1.1)
    this.headR = new THREE.SpotLight(0xfff4d2, 0, 36, 0.55, 0.45, 1.1)
    this.headL.position.set(-0.55, 0.7, -2.1)
    this.headR.position.set(0.55, 0.7, -2.1)
    this.headL.target.position.set(-0.4, 0.2, -12)
    this.headR.target.position.set(0.4, 0.2, -12)
    this.group.add(this.headL, this.headL.target, this.headR, this.headR.target)
  }

  setNight(amount: number): void {
    const n = amount * 8
    this.headL.intensity = n
    this.headR.intensity = n
  }

  update(dt: number, input: VehicleInput, world: World): void {
    const paved = world.onPaved(this.x, this.z, this.y)
    const drive = input.throttle * (paved ? 28 : 10)
    const steerScale = 1.7 / (1 + Math.abs(this.speed) * 0.08)
    this.heading += input.steer * steerScale * dt * (this.speed >= -0.4 ? 1 : -1)
    const fx = Math.sin(this.heading)
    const fz = -Math.cos(this.heading)
    const rx = Math.cos(this.heading)
    const rz = Math.sin(this.heading)
    this.vx += fx * drive * dt
    this.vz += fz * drive * dt
    const drag = Math.abs(input.throttle) < 0.05 ? 1.2 : paved ? 0.45 : 1.05
    this.vx -= this.vx * drag * dt
    this.vz -= this.vz * drag * dt
    let fwd = this.vx * fx + this.vz * fz
    let lat = this.vx * rx + this.vz * rz
    const fast = Math.abs(fwd) > 7
    const loose = input.handbrake || Math.abs(input.steer) > 0.55
    const grip = !fast ? 6 : loose ? (paved ? 1.05 : 1.45) : paved ? 3.6 : 1.8
    lat *= Math.exp(-grip * dt)
    const cap = paved ? 23 : 8.5
    fwd = Math.max(-6, Math.min(cap, fwd))
    this.vx = fx * fwd + rx * lat
    this.vz = fz * fwd + rz * lat
    this.speed = fwd
    this.slide = Math.min(1, Math.abs(lat) / 5.5)
    if (this.recover > 0) {
      this.recover = Math.max(0, this.recover - dt)
      const push = this.surge * dt * 3.4
      this.vx += fx * push
      this.vz += fz * push
      this.surge *= Math.exp(-3.2 * dt)
    }
    const nx = this.x + this.vx * dt
    const nz = this.z + this.vz * dt
    const hit = this.blocked(nx, nz, 1.15, world)
    if (hit.hit) {
      if (hit.wet) {
        this.speed *= 0.1
        this.vx *= 0.1
        this.vz *= 0.1
        this.recover = 0
      } else if (this.recover <= 0) {
        const before = Math.hypot(this.vx, this.vz)
        this.vx *= -0.2
        this.vz *= -0.2
        this.speed *= 0.2
        this.surge = Math.min(before, 16) * 0.7
        this.recover = 0.42
      }
    }
    this.x = hit.x
    this.z = hit.z
    const gy = world.surface(this.x, this.z, this.y)
    this.y = damp(this.y, gy, 8, dt)
    this.agl = this.y - world.height.sample(this.x, this.z)
    const nose = world.surface(this.x + fx * 1.5, this.z + fz * 1.5, this.y)
    const tail = world.surface(this.x - fx * 1.5, this.z - fz * 1.5, this.y)
    this.body.rotation.x = damp(this.body.rotation.x, Math.atan2(tail - nose, 3), 5, dt)
    this.body.position.y = Math.sin(this.spin) * Math.min(0.04, Math.abs(this.speed) * 0.002)
    const lean = -input.steer * Math.min(0.18, Math.abs(this.speed) * 0.01) - Math.sign(lat || input.steer) * this.slide * 0.14
    this.body.rotation.z = damp(this.body.rotation.z, lean, 6, dt)
    this.steerVis = damp(this.steerVis, input.steer * 0.35, 10, dt)
    this.spin += this.speed * dt / 0.34
    for (const w of this.wheels) w.rotation.x = this.spin
    for (const w of this.front) w.rotation.y = this.steerVis
    this.sync()
  }
}

export class Helicopter extends Vehicle {
  readonly kind = 'heli' as const
  private vy = 0
  private rotor: THREE.Group
  private tailRotor: THREE.Group
  private body: THREE.Group
  private collective = 0

  constructor() {
    super()
    this.body = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial({ color: 0xe07a3d, roughness: 0.48, metalness: 0.1 })
    const cream = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.5 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x243038, roughness: 0.3, metalness: 0.3 })
    const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 12), paint)
    cabin.scale.set(1, 0.78, 1.35)
    cabin.position.set(0, 1.15, -0.2)
    cabin.castShadow = true
    const belly = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 1.6), cream)
    belly.position.set(0, 0.62, -0.1)
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.1, 8), paint)
    boom.rotation.x = Math.PI / 2
    boom.position.set(0, 1.15, 2.1)
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.55), paint)
    fin.position.set(0, 1.5, 3.45)
    const skidGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.1, 6)
    const skidL = new THREE.Mesh(skidGeo, dark)
    const skidR = skidL.clone()
    skidL.rotation.x = Math.PI / 2
    skidR.rotation.x = Math.PI / 2
    skidL.position.set(-0.55, 0.28, 0)
    skidR.position.set(0.55, 0.28, 0)
    this.body.add(cabin, belly, boom, fin, skidL, skidR)
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), dark)
    glass.scale.set(1.1, 0.7, 0.7)
    glass.position.set(0, 1.2, -0.85)
    this.body.add(glass)
    this.group.add(this.body)

    this.rotor = new THREE.Group()
    this.rotor.position.set(0, 1.85, -0.15)
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.5 })
    for (const rot of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.04, 0.22), bladeMat)
      blade.rotation.y = rot
      this.rotor.add(blade)
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 6), dark)
    mast.position.y = -0.15
    this.rotor.add(mast)
    this.group.add(this.rotor)

    this.tailRotor = new THREE.Group()
    this.tailRotor.position.set(0.18, 1.5, 3.45)
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.1), bladeMat)
    const t2 = t1.clone()
    t2.rotation.z = Math.PI / 2
    this.tailRotor.add(t1, t2)
    this.group.add(this.tailRotor)
    this.seat.position.set(-0.28, 0.95, -0.15)
  }

  update(dt: number, input: VehicleInput, world: World): void {
    this.heading += input.steer * 0.9 * dt
    const desired = input.throttle * 42
    const response = Math.abs(input.throttle) < 0.05 ? 1.35 : 0.85
    this.speed = damp(this.speed, desired, response, dt)
    this.vy = damp(this.vy, input.ascend * 12, Math.abs(input.ascend) < 0.05 ? 2.2 : 1.15, dt)
    const nx = this.x + Math.sin(this.heading) * this.speed * dt
    const nz = this.z - Math.cos(this.heading) * this.speed * dt
    const resolved = world.blockers.resolve(nx, nz, 1.6)
    if (resolved.hit && this.agl < 8) {
      this.speed *= 0.7
    }
    this.x = this.agl < 6 ? resolved.x : nx
    this.z = this.agl < 6 ? resolved.z : nz
    this.y += this.vy * dt
    const ground = world.height.sample(this.x, this.z)
    const minY = ground + 1.15
    if (this.y < minY) {
      this.y = minY
      this.vy = Math.max(0, this.vy)
    }
    const maxY = ground + 380
    if (this.y > maxY) {
      this.y = maxY
      this.vy = Math.min(0, this.vy)
    }
    this.agl = this.y - ground
    this.body.rotation.x = damp(this.body.rotation.x, input.throttle * 0.22, 3, dt)
    this.body.rotation.z = damp(this.body.rotation.z, -input.steer * 0.34, 3.2, dt)
    this.collective = damp(this.collective, 1 + Math.abs(this.vy) * 0.08 + Math.abs(this.speed) * 0.02, 2, dt)
    this.rotor.rotation.y += dt * (22 + this.collective * 10)
    this.tailRotor.rotation.x += dt * 40
    this.sync()
  }

  rpm(): number {
    return 0.7 + Math.abs(this.vy) * 0.05 + Math.abs(this.speed) * 0.02
  }
}

/** [Placeholder] A team and a wagon. The model is not a sourced 1860s or 1950s vehicle. */
export class Wagon extends Vehicle {
  readonly kind = 'car' as const
  readonly name = 'wagon'
  readonly eraRide = 'wagon' as const
  private spin = 0
  private horses: THREE.Object3D
  private wheels: THREE.Object3D[] = []

  constructor() {
    super()
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.82 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.7 })
    const hide = new THREE.MeshStandardMaterial({ color: 0x6b4630, roughness: 0.75 })
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 2.4), wood)
    bed.position.set(0, 0.72, 0.35)
    bed.castShadow = true
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.18), wood)
    seat.position.set(0, 1.05, -0.55)
    this.group.add(bed, seat)
    this.horses = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.85, 3, 6), hide)
    body.rotation.z = Math.PI / 2
    body.position.set(-0.32, 0.95, -1.85)
    const body2 = body.clone()
    body2.position.x = 0.32
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.4, 2, 5), hide)
    neck.position.set(-0.32, 1.25, -2.45)
    neck.rotation.x = 0.7
    const neck2 = neck.clone()
    neck2.position.x = 0.32
    this.horses.add(body, body2, neck, neck2)
    this.group.add(this.horses)
    const addWheel = (x: number, z: number) => {
      const spin = new THREE.Group()
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 10), dark)
      tire.rotation.z = Math.PI / 2
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), wood)
      spin.add(tire, spoke)
      spin.position.set(x, 0.42, z)
      this.group.add(spin)
      this.wheels.push(spin)
    }
    addWheel(-0.82, -0.45)
    addWheel(0.82, -0.45)
    addWheel(-0.82, 1.15)
    addWheel(0.82, 1.15)
    this.seat.position.set(0, 1.15, -0.15)
  }

  update(dt: number, input: VehicleInput, world: World): void {
    const drive = input.throttle * 9
    this.heading += input.steer * 0.85 * dt * (this.speed >= -0.2 ? 1 : -1)
    const fx = Math.sin(this.heading)
    const fz = -Math.cos(this.heading)
    this.speed = damp(this.speed, drive, 1.4, dt)
    this.speed = Math.max(-2.2, Math.min(6.5, this.speed))
    const nx = this.x + fx * this.speed * dt
    const nz = this.z + fz * this.speed * dt
    const hit = this.blocked(nx, nz, 1.15, world)
    if (hit.hit) this.speed *= 0.4
    this.x = hit.x
    this.z = hit.z
    const gy = world.surface(this.x, this.z, this.y)
    this.y = damp(this.y, gy, 8, dt)
    this.agl = this.y - world.height.sample(this.x, this.z)
    this.spin += this.speed * dt / 0.42
    for (const wheel of this.wheels) wheel.rotation.x = this.spin
    this.horses.position.y = Math.sin(this.spin * 2) * Math.min(0.05, Math.abs(this.speed) * 0.012)
    this.sync()
  }
}
