import * as THREE from 'three'
import type { CollectibleDef } from './types.ts'
import type { World } from './world.ts'

const KEY = 'lafayette-days-found'

/** Brass tokens on civic roofs. Coordinates are the baked POI footprints. */
const ROOFS: CollectibleDef[] = [
  {
    id: 'roof-library',
    kind: 'roof',
    x: 818,
    z: -436.1,
    note: 'The library roof looks straight down Mt. Diablo Boulevard.',
  },
  {
    id: 'roof-hall',
    kind: 'roof',
    x: 777.6,
    z: -456.5,
    note: 'Community hall keeps a flat roof and a long view west.',
  },
  {
    id: 'roof-town',
    kind: 'roof',
    x: 622.2,
    z: 20.6,
    note: 'Town hall is taller from up here than from the sidewalk.',
  },
]

export class Collectibles {
  readonly found = new Set<string>()
  private readonly items: { def: CollectibleDef; mesh: THREE.Object3D }[] = []
  private readonly world: World
  private spin = 0

  constructor(scene: THREE.Scene, defs: CollectibleDef[], world: World) {
    this.world = world
    const all = defs.slice()
    for (const roof of ROOFS) {
      if (!all.some((d) => d.id === roof.id)) all.push(roof)
    }
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) for (const id of JSON.parse(saved) as string[]) this.found.add(id)
    } catch {
      /* private mode */
    }
    for (const def of all) {
      const mesh = def.kind === 'kite' ? this.kite() : def.kind === 'roof' ? this.token() : this.medallion()
      const y = world.height.sample(def.x, def.z)
      const lift = def.kind === 'kite' ? 2.4 : def.kind === 'roof' ? 8 : 0.85
      mesh.position.set(def.x, y + lift, def.z)
      mesh.userData.baseY = mesh.position.y
      mesh.visible = !this.found.has(def.id)
      scene.add(mesh)
      if (def.kind === 'kite') {
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.28, 3.2, 6),
          new THREE.MeshStandardMaterial({ color: 0x5c4030, roughness: 0.9 }),
        )
        trunk.position.set(def.x + 0.4, y + 1.5, def.z + 0.2)
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.7, 0),
          new THREE.MeshStandardMaterial({ color: 0x2f5d34, roughness: 0.85 }),
        )
        crown.position.set(def.x + 0.4, y + 3.6, def.z + 0.2)
        scene.add(trunk, crown)
      }
      this.items.push({ def, mesh })
    }
  }

  private medallion(): THREE.Group {
    const g = new THREE.Group()
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.8, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 0.8 }),
    )
    post.position.y = 0.2
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2b657, roughness: 0.35, metalness: 0.55, emissive: 0x8a5a12, emissiveIntensity: 0.25 }),
    )
    disc.position.y = 0.7
    g.add(post, disc)
    return g
  }

  private kite(): THREE.Group {
    const g = new THREE.Group()
    const cloth = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 4),
      new THREE.MeshStandardMaterial({ color: 0xd64545, side: THREE.DoubleSide, roughness: 0.6 }),
    )
    cloth.rotation.z = Math.PI / 4
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.7, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xf2c14e }),
    )
    tail.position.y = -0.6
    g.add(cloth, tail)
    return g
  }

  private token(): THREE.Group {
    const g = new THREE.Group()
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.05, 14),
      new THREE.MeshStandardMaterial({ color: 0xe2b657, roughness: 0.35, metalness: 0.6, emissive: 0x8a5a12, emissiveIntensity: 0.35 }),
    )
    g.add(disc)
    return g
  }

  get keepsakes(): { found: number; total: number } {
    const all = this.items
    return { found: all.filter((i) => this.found.has(i.def.id)).length, total: all.length }
  }

  update(dt: number, x: number, y: number, z: number, onFound: (note: string, done: boolean) => void): void {
    this.spin += dt
    for (const item of this.items) {
      if (!item.mesh.visible) continue
      let roofed = item.def.kind !== 'roof'
      if (item.def.kind === 'roof') {
        const roof = this.world.blockers.roofAt(item.def.x, item.def.z)
        if (roof != null) {
          item.mesh.position.y = roof + 0.4
          item.mesh.userData.baseY = item.mesh.position.y
          item.mesh.userData.roofed = 1
        }
        roofed = item.mesh.userData.roofed === 1
      }
      item.mesh.rotation.y = this.spin * (item.def.kind === 'kite' ? 1.4 : 0.8)
      if (item.def.kind === 'kite') item.mesh.position.y = Number(item.mesh.userData.baseY) + Math.sin(this.spin * 2) * 0.18
      const near = Math.hypot(item.def.x - x, item.def.z - z) < (item.def.kind === 'roof' ? 2.2 : 2.6)
      const highEnough = item.def.kind !== 'roof' || Math.abs(item.mesh.position.y - y) < 2.4
      if (near && highEnough && roofed) {
        item.mesh.visible = false
        this.found.add(item.def.id)
        try {
          localStorage.setItem(KEY, JSON.stringify([...this.found]))
        } catch {
          /* ignore */
        }
        const bag = this.keepsakes
        onFound(item.def.note, bag.found === bag.total)
      }
    }
  }
}
