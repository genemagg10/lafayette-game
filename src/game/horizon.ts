import { Color, ConeGeometry, Group, InstancedMesh, Mesh, Object3D, PlaneGeometry, Sprite, SpriteMaterial, type Camera, type CanvasTexture, type Scene } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { cameraPosition, mix, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl'
import type { Heightfield } from './height.ts'
import { hash01 } from './math.ts'
import { impostorMaterial } from './materials.ts'
import type { Season } from './types.ts'

/**
 * Mt. Diablo and a ring of ridge impostors past the heightfield,
 * hazed by distance so the playable hills sit in a larger range.
 */
export class Horizon {
  private readonly peakTint = uniform(new Color(0xd7c4a2))
  private readonly ridgeTint = uniform(new Color(0x8eaa78))
  private readonly label: Sprite
  private readonly peak: Mesh
  private readonly cards: InstancedMesh

  constructor(scene: Scene, height: Heightfield, oak: CanvasTexture) {
    // East of downtown, close enough to read as a massif rather than a speck.
    const east = height.originX + height.sizeX - 120
    const midZ = -180
    const group = new Group()
    group.name = 'horizon'

    this.peak = this.mass(980, 1560, this.peakTint)
    this.peak.position.set(east, 60, midZ)
    group.add(this.peak)
    const shoulder = this.mass(980, 680, this.ridgeTint)
    shoulder.position.set(east - 280, 20, midZ - 980)
    const shoulderB = this.mass(1120, 760, this.ridgeTint)
    shoulderB.position.set(east + 180, 10, midZ + 1200)
    group.add(shoulder, shoulderB)

    const minX = height.originX - 900
    const maxX = height.originX + height.sizeX + 700
    const minZ = height.originZ - 800
    const maxZ = height.originZ + height.sizeZ + 700
    const ring: [number, number, number][] = [
      [minX, height.originZ + height.sizeZ * 0.3, 420],
      [minX + 800, minZ, 360],
      [height.originX + height.sizeX * 0.4, minZ - 200, 480],
      [maxX, height.originZ + height.sizeZ * 0.15, 390],
      [maxX - 200, maxZ, 440],
      [height.originX + height.sizeX * 0.55, maxZ + 120, 360],
      [minX + 200, maxZ - 300, 410],
      [height.originX + height.sizeX * 0.2, maxZ, 300],
    ]
    for (const [x, z, h] of ring) {
      const ridge = this.mass(h * 1.8, h, this.ridgeTint)
      ridge.position.set(x, -20, z)
      group.add(ridge)
    }

    // Low ridges west of the boulevard, far enough to sit on the horizon
    // instead of standing in the sky like the old poles.
    const west: [number, number, number, number][] = [
      [-2800, -500, 980, 300],
      [-2600, -1600, 860, 260],
      [-3000, 500, 900, 280],
    ]
    for (const [x, z, radius, heightM] of west) {
      const ridge = this.mass(radius, heightM, this.ridgeTint)
      ridge.position.set(x, 70, z)
      group.add(ridge)
    }

    const cardMat = impostorMaterial(oak)
    // null, not undefined: NodeMaterial only skips a position node when it is null.
    ;(cardMat as { positionNode: unknown }).positionNode = null
    const count = 160
    this.cards = new InstancedMesh(forestCard(), cardMat, count)
    const dummy = new Object3D()
    const tint = new Color()
    for (let i = 0; i < count; i++) {
      const around = i < 96
      const x = around ? east + (hash01(i) - 0.5) * 1600 : ring[i % ring.length][0] + (hash01(i + 4) - 0.5) * 700
      const z = around ? midZ + (hash01(i + 2) - 0.5) * 1800 : ring[i % ring.length][1] + (hash01(i + 9) - 0.5) * 600
      const y = 6 + hash01(i + 6) * 18
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, hash01(i * 3) * Math.PI, 0)
      const s = 2.4 + hash01(i + 8) * 2.2
      dummy.scale.set(s, s * 0.85, s)
      dummy.updateMatrix()
      this.cards.setMatrixAt(i, dummy.matrix)
      tint.setHex(hash01(i + 5) > 0.6 ? 0x8a9a48 : 0x3e7340)
      this.cards.setColorAt(i, tint)
    }
    this.cards.castShadow = false
    this.cards.receiveShadow = false
    this.cards.frustumCulled = false
    group.add(this.cards)

    this.label = new Sprite(new SpriteMaterial({ transparent: true, opacity: 0 }))
    this.label.visible = false
    this.label.position.set(east, 1400, midZ)

    scene.add(group)
    this.setSeason('summer')
  }

  setSeason(season: Season): void {
    this.peakTint.value.setHex(0xc4b49a)
    this.ridgeTint.value.setHex(season === 'summer' ? 0xc6a15a : season === 'spring' ? 0x7eae58 : 0x3f7a46)
    const tint = this.cards.instanceColor
    if (!tint) return
    const color = new Color()
    for (let i = 0; i < this.cards.count; i++) {
      const springBlossom = season === 'spring' && hash01(i + 5) > 0.78
      const hex = springBlossom ? 0xe7a0b8 : season === 'winter' ? 0x2f6a40 : season === 'spring' ? 0x3e8f42 : hash01(i) > 0.5 ? 0x6a8a32 : 0xc2a85a
      color.setHex(hex)
      this.cards.setColorAt(i, color)
    }
    tint.needsUpdate = true
  }

  update(camera: Camera): void {
    const d = camera.position.distanceTo(this.peak.position)
    const s = Math.min(340, Math.max(48, d * 0.05))
    this.label.scale.set(s, s * 0.22, 1)
    this.label.position.y = this.peak.position.y + 1000
  }

  private mass(radius: number, height: number, tint: unknown): Mesh {
    const geo = new ConeGeometry(radius, height, 7)
    geo.translate(0, height * 0.45, 0)
    const mat = new MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 })
    mat.fog = false
    mat.colorNode = mix(tint as never, vec3(0.42, 0.55, 0.7), smoothstep(3400, 6800, cameraPosition.distance(positionWorld)).mul(0.28)) as never
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = false
    mesh.receiveShadow = false
    return mesh
  }
}

function forestCard() {
  const card = new PlaneGeometry(4.4, 5.4)
  card.translate(0, 2.7, 0)
  const crossed = card.clone().rotateY(Math.PI / 2)
  return mergeGeometries([card, crossed]) ?? card
}
