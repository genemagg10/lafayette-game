import * as THREE from 'three'

/** Dust and grass bits kicked up under the helicopter, and a puff behind the bike on dirt. */
export class Wash {
  private readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array

  constructor(scene: THREE.Scene) {
    const count = 180
    this.pos = new Float32Array(count * 3)
    this.vel = new Float32Array(count * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xd7c4a2,
      size: 0.22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  update(
    dt: number,
    source: { x: number; y: number; z: number; agl: number; speed: number } | null,
    strength: number,
  ): void {
    const mat = this.points.material as THREE.PointsMaterial
    const alive = source && source.agl < 16 && strength > 0.05
    mat.opacity = alive ? Math.min(0.55, strength * (1 - source.agl / 16)) : Math.max(0, mat.opacity - dt)
    if (!source) return
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += this.vel[i] * dt
      arr[i + 1] += this.vel[i + 1] * dt
      arr[i + 2] += this.vel[i + 2] * dt
      this.vel[i + 1] -= 4 * dt
      const life = arr[i + 1] - source.y
      if (!alive || life > 6 || life < -1 || Math.random() < dt * 0.8) {
        const ang = Math.random() * Math.PI * 2
        const rad = 1.2 + Math.random() * 4.5
        arr[i] = source.x + Math.cos(ang) * rad
        arr[i + 1] = source.y + 0.2
        arr[i + 2] = source.z + Math.sin(ang) * rad
        this.vel[i] = Math.cos(ang) * (2 + strength * 6)
        this.vel[i + 1] = 1.5 + strength * 5
        this.vel[i + 2] = Math.sin(ang) * (2 + strength * 6)
      }
    }
    attr.needsUpdate = true
  }
}
