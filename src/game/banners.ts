import { BufferAttribute, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, type Scene } from 'three'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'
import type { Heightfield } from './height.ts'
import { swayFromTip } from './wind.ts'

function cloth(color: number): Mesh {
  const geo = new PlaneGeometry(1.15, 0.72, 1, 4)
  geo.translate(0.58, -0.36, 0)
  const tip = geo.getAttribute('position')
  const tips = new Float32Array(tip.count)
  for (let i = 0; i < tip.count; i++) tips[i] = Math.min(1, Math.abs(tip.getY(i)) / 0.72)
  geo.setAttribute('tip', new BufferAttribute(tips, 1))
  const mat = new MeshStandardNodeMaterial({ color, roughness: 0.72, metalness: 0.02, side: DoubleSide })
  mat.positionNode = swayFromTip()
  const mesh = new Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

/** A few cloth flags along the boulevard and the reservoir, on the same wind as the grass. */
export function addBanners(scene: Scene, height: Heightfield): void {
  const spots: { x: number; z: number; yaw: number; color: number }[] = [
    { x: 430, z: -470, yaw: 0.4, color: 0xf2d36b },
    { x: 560, z: -455, yaw: 1.2, color: 0xe25b2a },
    { x: 690, z: -500, yaw: 0.2, color: 0x7ec8e3 },
    { x: 250, z: -400, yaw: -0.6, color: 0xf4efe4 },
    { x: 820, z: -440, yaw: 1.5, color: 0xc4343c },
    { x: -700, z: 780, yaw: 0.8, color: 0x178a86 },
    { x: -980, z: 900, yaw: -0.4, color: 0xf2d36b },
    { x: 140, z: -760, yaw: 2.2, color: 0xe7a0b8 },
  ]
  const poleMat = new MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.7 })
  const poleGeo = new CylinderGeometry(0.06, 0.07, 3.2, 6)
  const group = new Group()
  group.name = 'banners'
  for (const spot of spots) {
    const y = height.sample(spot.x, spot.z)
    const pole = new Mesh(poleGeo, poleMat)
    pole.position.set(spot.x, y + 1.6, spot.z)
    pole.castShadow = true
    const flag = cloth(spot.color)
    flag.position.set(spot.x, y + 3.05, spot.z)
    flag.rotation.y = spot.yaw
    group.add(pole, flag)
  }
  scene.add(group)
}
