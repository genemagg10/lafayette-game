import * as THREE from 'three'
import type { Road } from './types.ts'
import type { World } from './world.ts'
import { hash01, headingFromForward } from './math.ts'
import { signalGreen } from './world.ts'

interface Pt { x: number; y: number; z: number }
interface Route { pts: Pt[]; cum: number[]; len: number }

function ptsOf(road: Road): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < road.p.length; i += 3) pts.push({ x: road.p[i], y: road.p[i + 2], z: road.p[i + 1] })
  return pts
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function makeRoute(pts: Pt[]): Route | null {
  if (pts.length < 2) return null
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
  if (cum[cum.length - 1] < 40) return null
  return { pts, cum, len: cum[cum.length - 1] }
}

function sample(route: Route, d: number): { x: number; y: number; z: number; heading: number } {
  let distAlong = d % route.len
  if (distAlong < 0) distAlong += route.len
  let i = 0
  while (i < route.cum.length - 2 && route.cum[i + 1] < distAlong) i++
  const span = route.cum[i + 1] - route.cum[i] || 1
  const t = (distAlong - route.cum[i]) / span
  const a = route.pts[i]
  const b = route.pts[i + 1]
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: headingFromForward(b.x - a.x, b.z - a.z),
  }
}

function chain(roads: Road[]): Route[] {
  const groups = new Map<string, Road[]>()
  const routes: Route[] = []
  for (const road of roads) {
    if (!road.n) {
      const solo = makeRoute(ptsOf(road))
      if (solo && solo.len > 70) routes.push(solo)
      continue
    }
    const list = groups.get(road.n) ?? []
    list.push(road)
    groups.set(road.n, list)
  }
  for (const list of groups.values()) {
    const unused = list.map(ptsOf)
    while (unused.length) {
      let chainPts = unused.pop()
      if (!chainPts) break
      let grew = true
      while (grew) {
        grew = false
        for (let i = 0; i < unused.length; i++) {
          const p = unused[i]
          const a = chainPts[0]
          const b = chainPts[chainPts.length - 1]
          const p0 = p[0]
          const p1 = p[p.length - 1]
          if (dist(b, p0) < 20) chainPts = chainPts.concat(p.slice(1))
          else if (dist(b, p1) < 20) chainPts = chainPts.concat(p.slice().reverse().slice(1))
          else if (dist(a, p1) < 20) chainPts = p.slice(0, -1).concat(chainPts)
          else if (dist(a, p0) < 20) chainPts = p.slice().reverse().slice(0, -1).concat(chainPts)
          else continue
          unused.splice(i, 1)
          grew = true
          break
        }
      }
      const route = makeRoute(chainPts)
      if (route && route.len > 80) routes.push(route)
    }
  }
  routes.sort((a, b) => b.len - a.len)
  return routes
}

function person(color: number): THREE.Group {
  const g = new THREE.Group()
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b394, roughness: 0.65 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.45, 2, 6), cloth)
  body.position.y = 0.85
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), skin)
  head.position.y = 1.32
  g.add(body, head)
  return g
}

interface NpcCar {
  mesh: THREE.Group
  body: THREE.Group
  front: THREE.Object3D[]
  wheels: THREE.Object3D[]
  paint: THREE.MeshStandardMaterial
  route: Route
  d: number
  speed: number
  base: number
  lane: number
  color: number
  heading: number
  bob: number
}

export class Traffic {
  private cars: NpcCar[] = []
  private pace = 1
  private people: { mesh: THREE.Group; route: Route; d: number; speed: number; phase: number }[] = []
  private birds: { mesh: THREE.Group; ang: number; rad: number; y: number; cx: number; cz: number; rate: number }[] = []
  private ducks: { mesh: THREE.Group; ang: number; rad: number; scare: number }[] = []
  private duckCenter = new THREE.Vector3()

  constructor(scene: THREE.Scene, roads: Road[], world: World, lake: { x: number; z: number }) {
    const drive = chain(roads.filter((r) => r.d === 0 && r.b === 0 && r.w >= 6 && /primary|secondary|tertiary|residential|unclassified/.test(r.t)))
    const colors = [0xd4564e, 0xf2f4f6, 0x355f8a, 0xe6c15a, 0x2f2f33, 0x7aa0a6]
    for (let i = 0; i < Math.min(8, drive.length); i++) {
      const mesh = new THREE.Group()
      const paint = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.5 })
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.7 })
      const body = new THREE.Group()
      const shell = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 3.8), paint)
      shell.position.y = 0.7
      shell.castShadow = true
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.45, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x243038, roughness: 0.3 }),
      )
      cabin.position.set(0, 1.15, -0.1)
      body.add(shell, cabin)
      const front: THREE.Object3D[] = []
      const wheels: THREE.Object3D[] = []
      const addWheel = (x: number, z: number, steered: boolean) => {
        const steer = new THREE.Group()
        const spin = new THREE.Group()
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), dark)
        tire.rotation.z = Math.PI / 2
        spin.add(tire)
        steer.add(spin)
        steer.position.set(x, 0.32, z)
        mesh.add(steer)
        wheels.push(spin)
        if (steered) front.push(steer)
      }
      addWheel(-0.72, -1.2, true)
      addWheel(0.72, -1.2, true)
      addWheel(-0.72, 1.2, false)
      addWheel(0.72, 1.2, false)
      mesh.add(body)
      scene.add(mesh)
      const speed = 7 + hash01(i) * 4
      this.cars.push({
        mesh,
        body,
        front,
        wheels,
        paint,
        route: drive[i],
        d: hash01(i + 3) * drive[i].len,
        speed,
        base: speed,
        lane: i % 2 === 0 ? 1.4 : -1.4,
        color: colors[i % colors.length],
        heading: 0,
        bob: i,
      })
    }

    const trailRoads = roads.filter((r) => r.d === 1 && r.p.length > 12)
    const near: Road[] = []
    for (const road of trailRoads) {
      const x = road.p[0]
      const z = road.p[1]
      if (Math.hypot(x - lake.x, z - lake.z) < 700 || /trail|reservoir|rim/i.test(road.n)) near.push(road)
    }
    const trails = chain(near.length ? near : trailRoads.slice(0, 12))
    const shirts = [0x4aa3c7, 0xe07a4c, 0x6aaa4a, 0xf2f4f6]
    for (let i = 0; i < Math.min(4, trails.length); i++) {
      const mesh = person(shirts[i % shirts.length])
      scene.add(mesh)
      this.people.push({ mesh, route: trails[i], d: hash01(i + 9) * trails[i].len, speed: 2.4, phase: i })
    }
    const blvd = chain(roads.filter((r) => /diablo boulevard/i.test(r.n)))
    for (let i = 0; i < Math.min(3, blvd.length); i++) {
      const mesh = person(0xf4efe4)
      scene.add(mesh)
      this.people.push({ mesh, route: blvd[i], d: (i + 1) * 40, speed: 1.2, phase: i + 2 })
    }

    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Group()
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.18), new THREE.MeshStandardMaterial({ color: 0x2c3338 }))
      wing.rotation.z = 0.4
      const wing2 = wing.clone()
      wing2.rotation.z = -0.4
      mesh.add(wing, wing2)
      scene.add(mesh)
      this.birds.push({
        mesh,
        ang: (i / 8) * Math.PI * 2,
        rad: 40 + i * 12,
        y: 70 + (i % 3) * 18,
        cx: -200 + i * 80,
        cz: -200,
        rate: 0.25 + (i % 3) * 0.08,
      })
    }

    this.duckCenter.set(lake.x, world.waterLevel + 0.2, lake.z)
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Group()
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf4f1ea }))
      body.scale.set(1.3, 0.7, 1)
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3d7a3a }))
      head.position.set(0, 0.12, -0.18)
      mesh.add(body, head)
      scene.add(mesh)
      this.ducks.push({ mesh, ang: (i / 5) * Math.PI * 2, rad: 6 + i * 1.4, scare: 0 })
    }
  }

  /** Today keeps the modern paint. 1955 slows the street and dresses it in period colors. */
  setPeriod(period: 'today' | 'fifties'): void {
    const periodColors = [0xf4efe4, 0x8c2f2f, 0x1f4d3a, 0x2c3338, 0xd8c07a, 0x6d7f8a]
    this.pace = period === 'fifties' ? 0.62 : 1
    this.cars.forEach((car, i) => {
      const color = period === 'fifties' ? periodColors[i % periodColors.length] : car.color
      car.paint.color.setHex(color)
      car.speed = car.base * (period === 'fifties' ? 0.72 : 1)
    })
  }

  honk(x: number, z: number): void {
    if (Math.hypot(x - this.duckCenter.x, z - this.duckCenter.z) < 80) {
      for (const duck of this.ducks) duck.scare = 1
    }
  }

  update(dt: number, time: number, px: number, pz: number, world: World): void {
    for (const car of this.cars) {
      const ahead = sample(car.route, car.d + 14)
      let speed = car.speed
      if (!signalGreen(ahead.x, ahead.z, time)) {
        const lightD = Math.hypot(ahead.x - sample(car.route, car.d).x, ahead.z - sample(car.route, car.d).z)
        if (lightD < 16) speed = Math.min(speed, 1.2)
      }
      const here = sample(car.route, car.d)
      const fx = Math.sin(here.heading)
      const fz = -Math.cos(here.heading)
      const toP = (px - here.x) * fx + (pz - here.z) * fz
      const gap = Math.hypot(px - here.x, pz - here.z)
      if (toP > -3 && toP < 22 && gap < 9) speed = Math.min(speed, gap < 4.5 ? 0.6 : 2.4)
      let lane = car.lane
      if (gap < 6) {
        const side = Math.cos(here.heading) * (px - here.x) + Math.sin(here.heading) * (pz - here.z)
        lane += side > 0 ? -1.6 : 1.6
      }
      car.d += speed * this.pace * dt
      const p = sample(car.route, car.d)
      const rx = Math.cos(p.heading) * lane
      const rz = Math.sin(p.heading) * lane
      const turn = Math.atan2(Math.sin(p.heading - car.heading), Math.cos(p.heading - car.heading))
      const steer = Math.max(-0.5, Math.min(0.5, turn * 2.4))
      car.heading = p.heading
      car.bob += dt * (3.2 + speed * 0.35)
      car.mesh.position.set(p.x + rx, p.y, p.z + rz)
      car.mesh.rotation.y = -p.heading
      car.body.position.y = Math.sin(car.bob) * 0.045
      car.body.rotation.z = -steer * 0.28
      for (const wheel of car.front) wheel.rotation.y = steer
      for (const wheel of car.wheels) wheel.rotation.x += speed * dt / 0.34
    }
    for (const person of this.people) {
      person.d += person.speed * dt
      person.phase += dt * 7
      const p = sample(person.route, person.d)
      const side = 3.2
      let ox = Math.cos(p.heading) * side
      let oz = Math.sin(p.heading) * side
      const gap = Math.hypot(p.x + ox - px, p.z + oz - pz)
      if (gap < 2.4 && gap > 0.05) {
        const push = (2.4 - gap) / gap
        ox += (p.x + ox - px) * push
        oz += (p.z + oz - pz) * push
      }
      person.mesh.position.set(p.x + ox, world.height.sample(p.x, p.z), p.z + oz)
      person.mesh.rotation.y = -p.heading
      person.mesh.position.y += Math.abs(Math.sin(person.phase)) * 0.05
    }
    for (const bird of this.birds) {
      bird.ang += dt * bird.rate
      bird.cx += dt * 1.5
      bird.mesh.position.set(bird.cx + Math.cos(bird.ang) * bird.rad, world.height.sample(bird.cx, bird.cz) + bird.y, bird.cz + Math.sin(bird.ang) * bird.rad)
      bird.mesh.rotation.y = -bird.ang
    }
    for (const duck of this.ducks) {
      duck.scare = Math.max(0, duck.scare - dt * 0.3)
      duck.ang += dt * (0.35 + duck.scare)
      const r = duck.rad + duck.scare * 8
      duck.mesh.position.set(
        this.duckCenter.x + Math.cos(duck.ang) * r,
        world.waterLevel + 0.15,
        this.duckCenter.z + Math.sin(duck.ang) * r,
      )
      duck.mesh.rotation.y = -duck.ang
    }
  }
}
