import * as THREE from 'three'
import type { CamKind, CamMode } from './types.ts'
import type { World } from './world.ts'
import { damp, dampAngle } from './math.ts'
import type { Input } from './input.ts'

const RIG: Record<CamKind, { dist: number; look: number; fov: number }> = {
  foot: { dist: 6.4, look: 1.35, fov: 58 },
  bike: { dist: 5.1, look: 1.15, fov: 64 },
  car: { dist: 8.6, look: 1.15, fov: 58 },
  heli: { dist: 16.5, look: 1.6, fov: 68 },
  fly: { dist: 10.6, look: 1.55, fov: 62 },
}

export class ChaseCamera {
  yaw = 0
  pitch = 0.38
  dist = 7
  mode: CamMode = 'chase'
  private lastHeading = 0
  private elastic = 0
  private readonly pos = new THREE.Vector3()
  private ready = false

  snap(heading: number): void {
    this.yaw = heading
    this.lastHeading = heading
  }

  /** Drop the chase rig on the target. Used when travel skips across town. */
  cut(heading: number): void {
    this.snap(heading)
    this.ready = false
  }

  update(
    dt: number,
    input: Input,
    camera: THREE.PerspectiveCamera,
    world: World,
    target: { x: number; y: number; z: number },
    heading: number,
    kind: CamKind,
    speed = 0,
    roll = 0,
  ): void {
    if (input.camEdge) {
      this.mode = this.mode === 'chase' ? 'first' : this.mode === 'first' ? 'cine' : 'chase'
    }
    const sens = input.usingTouch ? 0.0042 : 0.0024
    this.yaw += input.lookX * sens
    const pitchMin = kind === 'fly' ? -0.15 : 0.08
    this.pitch = Math.max(pitchMin, Math.min(1.2, this.pitch - input.lookY * sens * 0.75))
    const distMin = kind === 'heli' ? 8 : kind === 'fly' ? 5.5 : 3.2
    const distMax = kind === 'heli' ? 42 : kind === 'fly' ? 30 : 22
    this.dist = Math.max(distMin, Math.min(distMax, this.dist + input.zoom * 0.008))

    const pace = Math.abs(speed)
    const elasticTarget = kind === 'fly' || kind === 'heli' ? Math.min(1, pace / 28) : Math.min(1, pace / 16)
    this.elastic = damp(this.elastic, elasticTarget, 2.4, dt)
    if (kind !== 'foot') {
      this.yaw += heading - this.lastHeading
      if (this.mode === 'chase' && Math.abs(input.lookX) < 0.4) {
        const follow = (kind === 'heli' ? 1.1 : kind === 'fly' ? 3.1 : 2.5) * (1 - this.elastic * 0.45)
        this.yaw = dampAngle(this.yaw, heading, follow, dt)
      }
    }
    this.lastHeading = heading

    const rig = RIG[kind]
    const cine = this.mode === 'cine'
    const pull = 1 + this.elastic * 0.72
    const dist = (this.mode === 'first' ? 0.15 : this.dist * (rig.dist / 7) * pull) * (cine ? 1.45 : 1)
    const lookY = this.mode === 'first' ? (kind === 'foot' || kind === 'fly' ? 1.5 : 1.25) : rig.look
    const pitch = this.mode === 'first' ? this.pitch * 0.65 : this.pitch
    let dx = -Math.sin(this.yaw) * Math.cos(pitch) * dist
    let dy = Math.sin(pitch) * dist + (cine ? 1.4 : 0)
    let dz = Math.cos(this.yaw) * Math.cos(pitch) * dist
    if (this.mode === 'first') {
      dx = Math.sin(this.yaw) * 0.35
      dy = lookY
      dz = -Math.cos(this.yaw) * 0.35
    }
    let tx = target.x + dx
    let ty = target.y + dy
    let tz = target.z + dz
    if (this.mode !== 'first') {
      const clip = world.blockers.clipCamera(target.x, target.z, tx, tz, target.y + 1.3, ty)
      if (clip < 1) {
        const t = Math.max(0.08, clip - 0.04)
        tx = target.x + dx * t
        tz = target.z + dz * t
        ty = target.y + dy * t
      }
    }
    const floor = world.height.sample(tx, tz) + 0.55
    if (ty < floor) ty = floor

    const lambda = cine ? 2.1 : 7.5 * (1 - this.elastic * 0.38)
    if (!this.ready) {
      this.pos.set(tx, ty, tz)
      this.ready = true
    }
    this.pos.x = damp(this.pos.x, tx, lambda, dt)
    this.pos.y = damp(this.pos.y, ty, lambda, dt)
    this.pos.z = damp(this.pos.z, tz, lambda, dt)
    camera.position.copy(this.pos)
    const tip = kind === 'fly' ? Math.sin(roll) * 0.62 : 0
    camera.up.set(Math.sin(tip), Math.cos(tip), 0)
    const lookX = target.x + (this.mode === 'first' ? Math.sin(this.yaw) * 4 : 0)
    const lookZ = target.z + (this.mode === 'first' ? -Math.cos(this.yaw) * 4 : 0)
    const lookPitch = this.mode === 'first' ? -Math.sin(this.pitch - 0.4) * 2 : 0
    camera.lookAt(lookX, target.y + lookY + lookPitch, lookZ)
    const widen = this.elastic * (kind === 'fly' || kind === 'heli' ? 22 : 16)
    const fov = cine ? 42 : this.mode === 'first' ? 74 : rig.fov + widen
    camera.fov = damp(camera.fov, fov, kind === 'fly' ? 8 : 6, dt)
    camera.updateProjectionMatrix()
  }
}
