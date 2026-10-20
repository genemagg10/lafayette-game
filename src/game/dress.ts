import * as THREE from 'three'
import type { Heightfield } from './height.ts'
import { F_WATER } from './height.ts'
import type { Road } from './types.ts'
import { hash01 } from './math.ts'

/** Parked cars, planters, and benches along Mt. Diablo Boulevard. */
export function dressTown(
  root: THREE.Object3D,
  roads: Road[],
  height: Heightfield,
  spawn: { x: number; z: number },
): void {
  const spots: { x: number; z: number; h: number; salt: number }[] = []
  for (const road of roads) {
    if (!/diablo boulevard/i.test(road.n) || road.d) continue
    const n = road.p.length / 3
    let carry = 8
    for (let i = 0; i < n - 1 && spots.length < 48; i++) {
      const ax = road.p[i * 3]
      const az = road.p[i * 3 + 1]
      const bx = road.p[(i + 1) * 3]
      const bz = road.p[(i + 1) * 3 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 4) continue
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      let d = carry
      while (d < len && spots.length < 48) {
        const x = ax + dx * d
        const z = az + dz * d
        if ((x - spawn.x) ** 2 + (z - spawn.z) ** 2 < 680 * 680 && hash01((x * 3) | 0) > 0.42) {
          const side = hash01((z * 5) | 0) > 0.5 ? 1 : -1
          const px = x - dz * (road.w * 0.5 + 2.1) * side
          const pz = z + dx * (road.w * 0.5 + 2.1) * side
          if ((height.flag(px, pz) & F_WATER) === 0) {
            spots.push({ x: px, z: pz, h: Math.atan2(dx, -dz), salt: spots.length * 17 + ((x * 10) | 0) })
          }
        }
        d += 26
      }
      carry = d - len
    }
  }
  if (!spots.length) return

  const paint = [0xf4efe4, 0x3d7a6a, 0xc4553a, 0x243044, 0xe7c36a, 0x6d7c8a]
  const bodyGeo = new THREE.BoxGeometry(1.7, 0.48, 4.05)
  bodyGeo.translate(0, 0.62, 0)
  const cabinGeo = new THREE.BoxGeometry(1.52, 0.42, 1.85)
  cabinGeo.translate(0, 1.02, -0.1)
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.18 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.12, metalness: 0.45 })
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, spots.length)
  const cabins = new THREE.InstancedMesh(cabinGeo, glass, spots.length)
  bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]
    dummy.position.set(s.x, height.sample(s.x, s.z), s.z)
    dummy.rotation.set(0, -s.h + (hash01(s.salt) > 0.5 ? Math.PI : 0), 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    bodies.setMatrixAt(i, dummy.matrix)
    cabins.setMatrixAt(i, dummy.matrix)
    color.setHex(paint[s.salt % paint.length])
    bodies.setColorAt(i, color)
  }
  bodies.castShadow = true
  root.add(bodies, cabins)

  const potGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.55, 7)
  potGeo.translate(0, 0.28, 0)
  const shrubGeo = new THREE.SphereGeometry(0.55, 7, 6)
  shrubGeo.translate(0, 0.95, 0)
  const pots = new THREE.InstancedMesh(potGeo, new THREE.MeshStandardMaterial({ color: 0xc4553a, roughness: 0.8 }), spots.length)
  const shrubs = new THREE.InstancedMesh(shrubGeo, new THREE.MeshStandardMaterial({ color: 0x2f5d34, roughness: 0.9 }), spots.length)
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]
    const side = hash01(s.salt + 3) > 0.5 ? 1 : -1
    dummy.position.set(s.x + Math.cos(s.h) * 1.8 * side, height.sample(s.x, s.z), s.z + Math.sin(s.h) * 1.8 * side)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    pots.setMatrixAt(i, dummy.matrix)
    shrubs.setMatrixAt(i, dummy.matrix)
  }
  root.add(pots, shrubs)

  const benchGeo = new THREE.BoxGeometry(1.4, 0.08, 0.42)
  benchGeo.translate(0, 0.48, 0)
  const legGeo = new THREE.BoxGeometry(1.3, 0.4, 0.08)
  legGeo.translate(0, 0.2, 0)
  const count = Math.min(16, spots.length)
  const wood = new THREE.MeshStandardMaterial({ color: 0x8d5a3c, roughness: 0.8 })
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.6 })
  const seats = new THREE.InstancedMesh(benchGeo, wood, count)
  const legs = new THREE.InstancedMesh(legGeo, iron, count)
  for (let i = 0; i < count; i++) {
    const s = spots[i * 2] ?? spots[i]
    dummy.position.set(s.x, height.sample(s.x, s.z), s.z)
    dummy.rotation.set(0, -s.h, 0)
    dummy.updateMatrix()
    seats.setMatrixAt(i, dummy.matrix)
    legs.setMatrixAt(i, dummy.matrix)
  }
  root.add(seats, legs)
}
