import * as THREE from 'three'
import type { Discover } from './discover.ts'
import type { World } from './world.ts'

export interface ActivityNote {
  text: string
  gems: number
}

interface Pin {
  x: number
  z: number
}

const HUNT_SECONDS = 78

/** Gold columns mark places. Teal, coral, and cream columns are things to drive into. */
export class Activities {
  tour = false
  private carrying: 'surfboard' | 'book' | null = null
  private hunt: { x: number; z: number; left: number } | null = null
  private huntReady = true
  private readonly greeted = new Set<string>()
  private readonly huntStart: Pin
  private readonly board: Pin
  private readonly book: Pin
  private readonly library: Pin
  private readonly gold: THREE.Group[] = []
  private readonly huntBeam: THREE.Group
  private readonly boardBeam: THREE.Group
  private readonly bookBeam: THREE.Group
  private readonly tourBeam: THREE.Group
  private readonly light: THREE.PointLight
  private pulse = 0

  constructor(scene: THREE.Scene, world: World, library: Pin, reservoir: Pin, plaza: Pin) {
    this.library = stand(world, library.x, library.z + 12)
    this.board = shore(world, reservoir.x, reservoir.z)
    this.book = stand(world, plaza.x + 8, plaza.z + 6)
    this.huntStart = stand(world, 508, -360)
    for (let i = 0; i < 2; i++) {
      const column = makeBeam(0xf2c14e, 8)
      column.visible = false
      scene.add(column)
      this.gold.push(column)
    }
    this.huntBeam = makeBeam(0x3ec8c0, 8)
    this.huntBeam.visible = false
    this.boardBeam = makeBeam(0xf08a6a, 8)
    this.bookBeam = makeBeam(0xf08a6a, 8)
    this.tourBeam = makeBeam(0xfff6df, 8)
    this.light = new THREE.PointLight(0xfff1c4, 0, 22, 1.6)
    this.light.position.y = 6
    scene.add(this.huntBeam, this.boardBeam, this.bookBeam, this.tourBeam, this.light)
    this.place(this.huntBeam, world, this.huntStart)
  }

  toggleTour(): boolean {
    this.tour = !this.tour
    if (!this.tour) this.tourBeam.visible = false
    return this.tour
  }

  label(): string {
    if (this.hunt) return `Treasure · ${Math.ceil(this.hunt.left)}s`
    if (this.carrying === 'surfboard') return 'Surfboard · to the library'
    if (this.carrying === 'book') return 'Book · to the library'
    if (this.tour) return 'Tour'
    return ''
  }

  update(dt: number, x: number, y: number, z: number, world: World, discover: Discover): ActivityNote | null {
    this.pulse += dt
    const bob = 1 + Math.sin(this.pulse * 2.2) * 0.04
    let note: ActivityNote | null = null
    const open = discover.openPlaces().filter((spot) => !spot.found)
    open.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
    for (const column of this.gold) column.visible = false
    if (this.hunt) {
      this.hunt.left -= dt
      this.huntBeam.visible = true
      this.place(this.huntBeam, world, this.hunt)
      if (this.hunt.left <= 0) {
        this.hunt = null
        this.huntReady = true
        this.huntBeam.visible = false
        note = { text: 'The hunt can wait.', gems: 0 }
      } else if (close(world, x, y, z, this.hunt)) {
        this.hunt = null
        this.huntReady = true
        this.huntBeam.visible = false
        note = { text: '+4 gems', gems: 4 }
      }
    } else if (this.huntReady && close(world, x, y, z, this.huntStart)) {
      const next = this.nextHunt(x, z, world, open)
      this.hunt = { x: next.x, z: next.z, left: HUNT_SECONDS }
      this.huntReady = false
      this.huntBeam.visible = true
      this.place(this.huntBeam, world, next)
      note = { text: 'Find the next beam.', gems: 0 }
    } else {
      this.huntBeam.visible = false
    }
    this.huntBeam.scale.set(1, bob, 1)

    const drop = this.carrying != null
    const pickup = drop ? null : close(world, x, y, z, this.board) ? 'surfboard' : close(world, x, y, z, this.book) ? 'book' : null
    if (pickup) {
      this.carrying = pickup
      note = { text: pickup === 'surfboard' ? 'Surfboard aboard. The library is waiting.' : 'A book for the library.', gems: 0 }
    } else if (drop && close(world, x, y, z, this.library)) {
      const what = this.carrying === 'surfboard' ? 'Surfboard delivered.' : 'Book delivered.'
      this.carrying = null
      note = { text: `${what} +5 gems`, gems: 5 }
    }
    this.boardBeam.visible = this.carrying == null
    this.bookBeam.visible = this.carrying == null
    if (this.carrying) this.place(this.boardBeam, world, this.library)
    else {
      this.place(this.boardBeam, world, this.board)
      this.place(this.bookBeam, world, this.book)
    }
    if (this.carrying) this.boardBeam.visible = true
    this.boardBeam.scale.set(1, bob, 1)
    this.bookBeam.scale.set(1, bob, 1)

    if (this.tour && open.length) {
      const spot = open.find((item) => Math.hypot(item.x - x, item.z - z) > 28) ?? open[0]
      this.tourBeam.visible = true
      this.place(this.tourBeam, world, spot)
      this.tourBeam.scale.set(1, bob, 1)
      if (!this.greeted.has(spot.id) && close(world, x, y, z, spot)) {
        this.greeted.add(spot.id)
        note = { text: `${spot.name}. +2 gems`, gems: 2 }
      }
    } else this.tourBeam.visible = false

    const glow = this.hunt ? this.huntBeam : this.carrying ? this.boardBeam : this.tour && this.tourBeam.visible ? this.tourBeam : this.huntBeam
    this.light.position.x = glow.position.x
    this.light.position.z = glow.position.z
    this.light.color.set(this.hunt ? 0x7ef0e8 : this.carrying ? 0xffb199 : 0xfff6df)
    this.light.intensity = 6
    return note
  }

  private nextHunt(x: number, z: number, world: World, open: { x: number; z: number }[]): Pin {
    let best: Pin | null = null
    let bestD = 0
    for (const spot of open) {
      const d = Math.hypot(spot.x - x, spot.z - z)
      if (d > 40 && d < 900 && d > bestD) {
        best = spot
        bestD = d
      }
    }
    if (best) return stand(world, best.x, best.z)
    const ang = this.pulse * 1.7
    return stand(world, x + Math.cos(ang) * 90, z + Math.sin(ang) * 90)
  }

  private place(group: THREE.Group, world: World, pin: Pin): void {
    group.position.set(pin.x, world.surface(pin.x, pin.z, null), pin.z)
  }
}

function stand(world: World, x: number, z: number): Pin {
  const cleared = world.blockers.resolve(x, z, 0.8)
  if (world.isDeep(cleared.x, cleared.z)) return shore(world, cleared.x, cleared.z)
  return cleared
}

function shore(world: World, x: number, z: number): Pin {
  if (!world.isDeep(x, z)) return { x, z }
  for (let i = 1; i <= 40; i++) {
    const nx = x + i * 12
    if (!world.isDeep(nx, z)) return world.blockers.resolve(nx, z, 0.8)
  }
  return { x, z }
}

function close(world: World, x: number, y: number, z: number, pin: Pin): boolean {
  if (Math.hypot(x - pin.x, z - pin.z) > 7.6) return false
  return Math.abs(y - world.surface(pin.x, pin.z, null)) < 5
}

function makeBeam(color: number, height: number): THREE.Group {
  const group = new THREE.Group()
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.85, height, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
  )
  shaft.position.y = height * 0.5
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.85, 22),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.18
  group.add(shaft, ring)
  return group
}
