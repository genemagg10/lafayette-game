import * as THREE from 'three'
import type { Car } from './vehicles.ts'

const GEMS_KEY = 'lafayette-days-gems'
const BADGES_KEY = 'lafayette-days-badges'
const DIST_KEY = 'lafayette-days-distance'

/** Tire smoke and the floating drift tally. The score is a flourish, not a fail. */
export class Juice {
  onStyle: (points: number) => void = () => {}
  private readonly puffs: { mesh: THREE.Mesh; life: number }[] = []
  private score = 0
  private sliding = false
  private cursor = 0

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.38, 6, 5)
    const mat = new THREE.MeshBasicMaterial({ color: 0xf7f4ee, transparent: true, opacity: 0.4, depthWrite: false })
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone())
      mesh.visible = false
      mesh.frustumCulled = false
      scene.add(mesh)
      this.puffs.push({ mesh, life: 0 })
    }
  }

  update(dt: number, car: Car | null): void {
    const sliding = car != null && car.slide > 0.22 && Math.abs(car.speed) > 6
    if (sliding && car) {
      this.sliding = true
      this.score += car.slide * Math.abs(car.speed) * dt * 2.6
      if (Math.random() < dt * 18) this.puff(car)
    } else if (this.sliding) {
      if (this.score > 20) this.onStyle(Math.round(this.score))
      this.score = 0
      this.sliding = false
    }
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue
      puff.life -= dt
      const t = Math.max(0, puff.life / 0.7)
      const mat = puff.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = 0.42 * t
      puff.mesh.scale.setScalar(1 + (1 - t) * 1.8)
      puff.mesh.position.y += dt * 0.6
      if (puff.life <= 0) puff.mesh.visible = false
    }
    const el = document.getElementById('drift')
    if (el) {
      const show = this.score > 8
      el.textContent = show ? String(Math.round(this.score)) : ''
      el.style.opacity = show ? '1' : '0'
    }
  }

  private puff(car: Car): void {
    const puff = this.puffs[this.cursor % this.puffs.length]
    this.cursor += 1
    const side = this.cursor % 2 === 0 ? 0.72 : -0.72
    const fx = Math.sin(car.heading)
    const fz = -Math.cos(car.heading)
    const rx = Math.cos(car.heading)
    const rz = Math.sin(car.heading)
    puff.mesh.visible = true
    puff.mesh.position.set(car.x - fx * 1.45 + rx * side, car.y + 0.28, car.z - fz * 1.45 + rz * side)
    puff.mesh.scale.setScalar(0.6)
    puff.life = 0.7
    const mat = puff.mesh.material as THREE.MeshBasicMaterial
    mat.opacity = 0.42
  }
}

/** Distance, gems, and Explorer notes. Nothing here can be lost. */
export class Rewards {
  gems = 0
  distance = 0
  private readonly badges = new Set<string>()
  private lastX = Number.NaN
  private lastZ = Number.NaN
  private nextMark = 100

  constructor() {
    try {
      this.gems = Math.max(0, Number(localStorage.getItem(GEMS_KEY)) || 0)
      this.distance = Math.max(0, Number(localStorage.getItem(DIST_KEY)) || 0)
      this.nextMark = Math.floor(this.distance / 100) * 100 + 100
      const raw = localStorage.getItem(BADGES_KEY)
      if (raw) {
        const list = JSON.parse(raw) as unknown
        if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') this.badges.add(id)
      }
    } catch {
      /* private mode keeps the session tally */
    }
  }

  gemsLabel(): string {
    return `${this.gems} gems`
  }

  distanceLabel(): string {
    if (this.distance >= 1000) return `${(this.distance / 1000).toFixed(1)} km`
    return `${Math.floor(this.distance)} m`
  }

  step(x: number, z: number, places: number): void {
    if (Number.isNaN(this.lastX)) {
      this.lastX = x
      this.lastZ = z
      return
    }
    const moved = Math.hypot(x - this.lastX, z - this.lastZ)
    this.lastX = x
    this.lastZ = z
    if (moved > 80) return
    this.distance += moved
    if (this.distance >= this.nextMark) {
      const at = Math.floor(this.distance / 100) * 100
      this.nextMark = at + 100
      this.pop(`${at} m`)
      this.save()
    }
    if (this.distance >= 500) this.badge('explorer-walk')
    if (places >= 3) this.badge('explorer-places')
  }

  grant(gems: number, text: string): void {
    this.gems += gems
    this.pop(text)
    this.save()
  }

  badge(id: string): void {
    if (this.badges.has(id)) return
    this.badges.add(id)
    this.gems += 3
    this.pop('Explorer')
    this.save()
  }

  private pop(text: string): void {
    const host = document.getElementById('pops')
    if (!host) return
    const el = document.createElement('p')
    el.className = 'pop'
    el.textContent = text
    host.append(el)
    window.setTimeout(() => el.remove(), 2500)
  }

  private save(): void {
    try {
      localStorage.setItem(GEMS_KEY, String(this.gems))
      localStorage.setItem(DIST_KEY, String(Math.floor(this.distance)))
      localStorage.setItem(BADGES_KEY, JSON.stringify([...this.badges]))
    } catch {
      /* ignore */
    }
  }
}
