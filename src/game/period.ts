import * as THREE from 'three'
import { F_WATER } from './height.ts'
import type { World } from './world.ts'

/**
 * 1955 dressing that is not in the baked map: globe lamps and a remnant orchard.
 * Both are [Placeholder] looks. The group is hidden in every other year.
 */
export function dressFifties(world: World): void {
  const group = new THREE.Group()
  group.name = 'fifties-boulevard'
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.6, metalness: 0.25 })
  const globeMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c8,
    emissive: 0xffc56b,
    emissiveIntensity: 0.85,
    roughness: 0.35,
  })
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.9 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x6e8f3a, roughness: 0.8 })
  for (const z of [-418, -456]) {
    for (let x = 340; x <= 760; x += 36) {
      if ((world.height.flag(x, z) & F_WATER) !== 0) continue
      const y = world.height.sample(x, z)
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), postMat)
      post.position.set(x, y + 2.1, z)
      post.castShadow = true
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), globeMat)
      globe.position.set(x, y + 4.25, z)
      group.add(post, globe)
    }
  }
  const row0x = 520
  const row0z = -250
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 7; col++) {
      const x = row0x + col * 4.4
      const z = row0z + row * 5.2
      if (!world.height.inBounds(x, z, 30)) continue
      if ((world.height.flag(x, z) & F_WATER) !== 0) continue
      const y = world.height.sample(x, z)
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.3, 5), trunkMat)
      trunk.position.set(x, y + 0.65, z)
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), leafMat)
      crown.position.set(x, y + 1.7, z)
      crown.castShadow = true
      group.add(trunk, crown)
    }
  }
  world.root.add(group)
  world.tagSpan(group, 1941, 1956)
}

/** A brass town clock. It is a game object, so it stays in every year. */
export function createTownClock(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'town-clock'
  const brass = new THREE.MeshStandardMaterial({ color: 0xd7a441, roughness: 0.35, metalness: 0.72 })
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e4,
    emissive: 0xffc56b,
    emissiveIntensity: 0.55,
    roughness: 0.4,
  })
  const dark = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 0.5, metalness: 0.4 })
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.35, 8), dark)
  post.position.y = 0.68
  const watch = new THREE.Group()
  watch.name = 'watch'
  watch.position.y = 1.55
  const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 16), brass)
  caseMesh.rotation.x = Math.PI / 2
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), faceMat)
  face.position.z = 0.07
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.02), dark)
  hand.position.set(0, 0.06, 0.09)
  watch.add(caseMesh, face, hand)
  group.add(post, watch)
  return group
}
