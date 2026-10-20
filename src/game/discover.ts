import * as THREE from 'three'
import type { ThenNow } from './eras.ts'
import {
  historyApproximate,
  historyChimes,
  historyPersists,
  historyVisible,
  type HistoryFeature,
} from './history.ts'
import type { Meta, StoryPerson, StoryPoi } from './types.ts'
import type { World } from './world.ts'

const PLACES_KEY = 'lafayette-days-places'
const VIEWS_KEY = 'lafayette-days-views'
const ROAM_KEY = 'lafayette-days-roam'
const CELL = 96

export interface Spot {
  id: string
  name: string
  line: string
  x: number
  z: number
  radius: number
  /** Inclusive. Omit and the place can be found in every year. */
  startYear?: number | null
  endYear?: number | null
}

export interface ViewSpot extends Spot {
  lookX: number
  lookZ: number
}

export interface HallCredit {
  place: string
  name: string
  role: string
  contribution: string
  source: string
}

interface Arrive {
  id: string
  kind: 'place' | 'view'
  name: string
  line: string
  history: string
  people: StoryPerson[]
  approximate: boolean
}

/**
 * Landmarks a local would name, plus the views worth keeping.
 * Park Theater and the plaza are placed from street addresses because the
 * bake's POI list did not tag them. The theater marquee is on the building.
 */
export class Discover {
  readonly places: Spot[]
  readonly views: ViewSpot[]
  private readonly placeFound = new Set<string>()
  private readonly viewFound = new Set<string>()
  private readonly stories = new Map<string, StoryPoi>()
  private readonly propGroups = new Map<string, THREE.Group>()
  private readonly marquee: { mat: THREE.MeshStandardMaterial; base: number }[] = []
  private readonly historyNotes = new Map<string, ThenNow>()
  private year = 2026
  private readonly ground: { sample: (x: number, z: number) => number; flag: (x: number, z: number) => number; inBounds: (x: number, z: number, margin?: number) => boolean }
  private readonly seen: Uint8Array
  private readonly cols: number
  private readonly rows: number
  private readonly originX: number
  private readonly originZ: number
  private roamDirty = false

  constructor(scene: THREE.Scene, world: World, meta: Meta) {
    const place = (id: string) => meta.places.find((p) => p.id === id)
    const reservoir = place('reservoir') ?? { x: -813, z: 845 }
    const bart = place('bart') ?? { x: 32, z: -577 }
    const cross = meta.memorial
    const library = meta.pois.find((p) => /library and learning/i.test(p.n))
    const rim = place('rim') ?? { x: -1437, z: 846 }
    this.places = [
      {
        id: 'reservoir',
        name: 'Lafayette Reservoir',
        line: 'The Res. The rim trail is the long way around.',
        x: reservoir.x,
        z: reservoir.z,
        radius: 110,
      },
      {
        id: 'reservoir-rim',
        name: 'Lafayette Reservoir',
        line: 'The Res. The rim trail is the long way around.',
        x: rim.x,
        z: rim.z,
        radius: 70,
      },
      {
        id: 'cross',
        name: 'The hillside cross',
        line: 'You can pick it out from the boulevard on a clear evening.',
        x: cross.x,
        z: cross.z,
        radius: 42,
      },
      {
        id: 'bart',
        name: 'Lafayette Station',
        line: 'The platform is the quiet stretch under the freeway.',
        x: bart.x,
        z: bart.z,
        radius: 48,
      },
      {
        id: 'theater',
        name: 'Park Theater',
        line: 'The marquee still faces Golden Gate Way. It opened in 1941.',
        x: 368.8,
        z: -422.9,
        radius: 28,
      },
      {
        id: 'library',
        name: 'Lafayette Library',
        line: 'The reading room looks out on Mt. Diablo Boulevard.',
        x: library?.x ?? 818,
        z: library?.z ?? -436,
        radius: 34,
      },
      {
        id: 'plaza',
        name: 'Lafayette Plaza',
        line: 'Elam and Margaret Brown Plaza. Lawn, benches, and the pergolas. No fountain is on record.',
        x: 536,
        z: -428,
        radius: 36,
      },
    ]
    this.views = [
      {
        id: 'view-hill',
        name: 'The boulevard from the hill',
        line: 'Downtown sits in the fold, and Diablo is the far ridge.',
        x: cross.x,
        z: cross.z,
        radius: 42,
        lookX: 453,
        lookZ: -440,
      },
      {
        id: 'view-rim',
        name: 'The Res from the rim',
        line: 'The water holds the afternoon longer than the street does.',
        x: rim.x,
        z: rim.z,
        radius: 55,
        lookX: reservoir.x,
        lookZ: reservoir.z,
      },
      {
        id: 'view-shore',
        name: 'Across the water',
        line: 'The dam road is behind you. The oaks are the far bank.',
        x: reservoir.x,
        z: reservoir.z,
        radius: 70,
        lookX: rim.x,
        lookZ: rim.z,
      },
    ]
    this.ground = world.height
    this.originX = world.height.originX
    this.originZ = world.height.originZ
    this.cols = Math.ceil(world.height.sizeX / CELL)
    this.rows = Math.ceil(world.height.sizeZ / CELL)
    this.seen = new Uint8Array(this.cols * this.rows)
    this.load()
    this.props(scene, world)
  }

  /**
   * Match researched records onto landmarks by name, then by lat/lon within 80 m.
   * A record that matches neither becomes its own discoverable place.
   */
  useStories(pois: StoryPoi[], origin: { lat: number; lon: number }): void {
    const mLat = 111320
    const mLon = 111320 * Math.cos((origin.lat * Math.PI) / 180)
    const located = pois.map((poi) => ({
      poi,
      x: (poi.lon - origin.lon) * mLon,
      z: -(poi.lat - origin.lat) * mLat,
    }))
    const spots = this.places.filter((spot) => spot.id !== 'reservoir-rim')
    const used = new Set<number>()
    const assign = (id: string, poi: StoryPoi, fromX: number, fromZ: number) => {
      this.stories.set(id, poi)
      if (id === 'reservoir') {
        this.stories.set('reservoir-rim', poi)
        return
      }
      const x = (poi.lon - origin.lon) * mLon
      const z = -(poi.lat - origin.lat) * mLat
      const moved = Math.hypot(x - fromX, z - fromZ)
      const water = (this.ground.flag(x, z) & 1) !== 0
      if (moved > 12 && moved < 400 && this.ground.inBounds(x, z, 40) && !water) {
        const spot = this.places.find((item) => item.id === id)
        if (spot) {
          spot.x = x
          spot.z = z
        }
        const group = this.propGroups.get(id)
        if (group) group.position.set(x, this.ground.sample(x, z), z)
      }
    }
    for (const spot of spots) {
      let best = -1
      let bestD = Infinity
      located.forEach((row, index) => {
        if (used.has(index) || !namesMatch(spot.name, row.poi.name)) return
        const distance = Math.hypot(row.x - spot.x, row.z - spot.z)
        if (distance < bestD) {
          best = index
          bestD = distance
        }
      })
      if (best >= 0) {
        used.add(best)
        assign(spot.id, located[best].poi, spot.x, spot.z)
      }
    }
    for (const spot of spots) {
      if (this.stories.has(spot.id)) continue
      let best = -1
      let bestD = 80
      located.forEach((row, index) => {
        if (used.has(index)) return
        const distance = Math.hypot(row.x - spot.x, row.z - spot.z)
        if (distance < bestD) {
          best = index
          bestD = distance
        }
      })
      if (best >= 0) {
        used.add(best)
        assign(spot.id, located[best].poi, spot.x, spot.z)
      }
    }
    located.forEach((row, index) => {
      if (used.has(index)) return
      if (!this.ground.inBounds(row.x, row.z, 40)) return
      if ((this.ground.flag(row.x, row.z) & 1) !== 0) return
      const id = uniqueId(this.places.map((spot) => spot.id), slug(row.poi.name))
      this.places.push({
        id,
        name: row.poi.name,
        line: row.poi.history,
        x: row.x,
        z: row.z,
        radius: 42,
      })
      this.stories.set(id, row.poi)
    })
  }

  /**
   * Year windows and then-lines from the history pack.
   * A place with no geometry, or one outside the walk, stays in the file and does not chime.
   */
  useHistory(features: HistoryFeature[], origin: { lat: number; lon: number }): void {
    const mLat = 111320
    const mLon = 111320 * Math.cos((origin.lat * Math.PI) / 180)
    for (const feature of features) {
      if (/dam & outlet|outlet tower|recreation area/i.test(feature.name)) {
        this.appendNote('reservoir', feature.description)
      }
      if (!historyChimes(feature) || feature.lon == null || feature.lat == null) continue
      const x = (feature.lon - origin.lon) * mLon
      const z = -(feature.lat - origin.lat) * mLat
      if (!this.ground.inBounds(x, z, 40)) continue
      if ((this.ground.flag(x, z) & 1) !== 0) continue
      const approx = historyApproximate(feature)
      let spot = this.matchHistory(feature.name, x, z)
      if (!spot) {
        const id = uniqueId(this.places.map((item) => item.id), slug(feature.name))
        spot = {
          id,
          name: feature.name,
          line: feature.description,
          x,
          z,
          radius: 42,
        }
        this.places.push(spot)
        this.stories.set(id, {
          name: feature.name,
          lat: feature.lat,
          lon: feature.lon,
          history: feature.description,
          people: [],
          approximate: approx,
          confidence: feature.confidence,
        })
      } else if (approx) {
        const story = this.stories.get(spot.id === 'reservoir-rim' ? 'reservoir' : spot.id)
        if (story) story.approximate = true
      }
      const end = historyPersists(feature.name, feature.endYear) ? null : feature.endYear
      this.gate(spot, feature.startYear, end)
      this.appendNote(spot.id, feature.description)
    }
    for (const [id, look] of Object.entries(INVENTED_LOOK)) {
      const row = this.historyNotes.get(id)
      if (row && !row.then.includes('[Placeholder]')) row.then = `${row.then} ${look}`
    }
  }

  setYear(year: number): void {
    this.year = year
  }

  lineFor(id: string): ThenNow | undefined {
    return this.historyNotes.get(id === 'reservoir-rim' ? 'reservoir' : id)
  }

  private projectKey(id: string): string {
    return id === 'reservoir-rim' ? 'reservoir' : id
  }

  private appendNote(id: string, text: string): void {
    const chunk = text.trim()
    if (!chunk) return
    const key = this.projectKey(id)
    const prev = this.historyNotes.get(key)
    if (prev?.then.includes(chunk)) return
    this.historyNotes.set(key, { then: prev ? `${prev.then} ${chunk}` : chunk, now: prev?.now ?? '' })
  }

  private gate(spot: Spot, startYear: number | null, endYear: number | null): void {
    if (startYear != null) spot.startYear = spot.startYear == null ? startYear : Math.min(spot.startYear, startYear)
    if (endYear != null) spot.endYear = spot.endYear == null ? endYear : Math.min(spot.endYear, endYear)
  }

  private matchHistory(name: string, x: number, z: number): Spot | undefined {
    const alias = historyAlias(name)
    if (alias) return this.places.find((spot) => spot.id === alias)
    let best: Spot | undefined
    let bestD = Infinity
    for (const spot of this.places) {
      if (spot.id === 'reservoir-rim') continue
      const story = this.stories.get(spot.id)
      if (!tokenMatch(name, spot.name) && !(story && tokenMatch(name, story.name))) continue
      const distance = Math.hypot(spot.x - x, spot.z - z)
      if (distance < bestD) {
        best = spot
        bestD = distance
      }
    }
    return best
  }

  private live(spot: Spot): boolean {
    return historyVisible(spot.startYear ?? null, spot.endYear ?? null, this.year)
  }

  private load(): void {
    const read = (key: string, into: Set<string>) => {
      try {
        const raw = localStorage.getItem(key)
        if (raw) for (const id of JSON.parse(raw) as string[]) into.add(id)
      } catch {
        /* private mode */
      }
    }
    read(PLACES_KEY, this.placeFound)
    read(VIEWS_KEY, this.viewFound)
    try {
      const raw = localStorage.getItem(ROAM_KEY)
      if (raw) {
        const bin = atob(raw)
        for (let i = 0; i < this.seen.length && i < bin.length; i++) this.seen[i] = bin[i] === '1' ? 1 : 0
      }
    } catch {
      /* ignore */
    }
  }

  private savePlaces(): void {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify([...this.placeFound]))
    } catch {
      /* ignore */
    }
  }

  private saveViews(): void {
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify([...this.viewFound]))
    } catch {
      /* ignore */
    }
  }

  private saveRoam(): void {
    let s = ''
    for (let i = 0; i < this.seen.length; i++) s += this.seen[i] ? '1' : '0'
    try {
      localStorage.setItem(ROAM_KEY, btoa(s))
    } catch {
      /* ignore */
    }
  }

  private props(scene: THREE.Scene, world: World): void {
    const y = (x: number, z: number) => world.height.sample(x, z)
    const stone = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.72 })
    const cross = this.places.find((p) => p.id === 'cross')
    if (cross) {
      const g = new THREE.Group()
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8.2, 0.4), stone)
      upright.position.y = 4.2
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.4), stone)
      arm.position.y = 6.1
      upright.castShadow = true
      arm.castShadow = true
      g.add(upright, arm)
      g.position.set(cross.x, y(cross.x, cross.z), cross.z)
      this.propGroups.set('cross', g)
      scene.add(g)
    }
    const plaza = this.places.find((p) => p.id === 'plaza')
    if (plaza) {
      const g = new THREE.Group()
      const lawn = new THREE.Mesh(
        new THREE.CircleGeometry(9.5, 20),
        new THREE.MeshStandardMaterial({ color: 0x6ea34a, roughness: 0.95 }),
      )
      lawn.rotation.x = -Math.PI / 2
      lawn.position.y = 0.08
      const wood = new THREE.MeshStandardMaterial({ color: 0x8d5a3c, roughness: 0.8 })
      const beam = (px: number, pz: number, rot: number) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 0.18), wood)
        post.position.set(px, 1.4, pz)
        const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.18), wood)
        top.position.set(px, 2.75, pz)
        top.rotation.y = rot
        g.add(post, top)
      }
      beam(-2.2, -1.4, 0.4)
      beam(2.4, 1.2, -0.3)
      g.add(lawn)
      g.position.set(plaza.x, y(plaza.x, plaza.z), plaza.z)
      this.propGroups.set('plaza', g)
      scene.add(g)
    }
  }

  placeCount(): { found: number; total: number } {
    const ids = new Set<string>()
    let found = 0
    for (const spot of this.places) {
      if (!this.live(spot)) continue
      const id = spot.id === 'reservoir-rim' ? 'reservoir' : spot.id
      if (ids.has(id)) continue
      ids.add(id)
      if (this.placeFound.has(id)) found++
    }
    return { found, total: ids.size }
  }

  viewCount(): { found: number; total: number } {
    return { found: this.viewFound.size, total: this.views.length }
  }

  openPlaces(): { id: string; name: string; x: number; z: number; found: boolean }[] {
    const out: { id: string; name: string; x: number; z: number; found: boolean }[] = []
    const seen = new Set<string>()
    for (const spot of this.places) {
      if (!this.live(spot)) continue
      const id = spot.id === 'reservoir-rim' ? 'reservoir' : spot.id
      if (seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        name: this.stories.get(id)?.name || spot.name,
        x: spot.x,
        z: spot.z,
        found: this.placeFound.has(id),
      })
    }
    return out
  }

  foundPlaces(): { name: string; x: number; z: number }[] {
    const out: { name: string; x: number; z: number }[] = []
    const seen = new Set<string>()
    for (const spot of this.places) {
      if (!this.live(spot)) continue
      const id = spot.id === 'reservoir-rim' ? 'reservoir' : spot.id
      if (!this.placeFound.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push({ name: this.stories.get(id)?.name || spot.name, x: spot.x, z: spot.z })
    }
    return out
  }

  hall(): HallCredit[] {
    const out: HallCredit[] = []
    const seen = new Set<string>()
    for (const spot of this.places) {
      if (!this.live(spot)) continue
      const id = spot.id === 'reservoir-rim' ? 'reservoir' : spot.id
      if (!this.placeFound.has(id) || seen.has(id)) continue
      seen.add(id)
      const story = this.stories.get(id)
      if (!story) continue
      for (const person of story.people) {
        out.push({
          place: story.name || spot.name,
          name: person.name,
          role: person.role,
          contribution: person.contribution,
          source: person.source,
        })
      }
    }
    return out
  }

  viewHere(x: number, z: number): ViewSpot | null {
    let best: ViewSpot | null = null
    let bestD = Infinity
    for (const view of this.views) {
      if (!this.viewFound.has(view.id)) continue
      const d = Math.hypot(view.x - x, view.z - z)
      if (d < view.radius && d < bestD) {
        best = view
        bestD = d
      }
    }
    return best
  }

  revealed(x: number, z: number): boolean {
    const i = this.index(x, z)
    return i >= 0 && this.seen[i] === 1
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x - this.originX) / CELL)
    const j = Math.floor((z - this.originZ) / CELL)
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1
    return j * this.cols + i
  }

  private stamp(x: number, z: number): void {
    const i0 = Math.floor((x - this.originX) / CELL)
    const j0 = Math.floor((z - this.originZ) / CELL)
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue
        const idx = j * this.cols + i
        if (this.seen[idx]) continue
        this.seen[idx] = 1
        this.roamDirty = true
      }
    }
  }

  update(x: number, z: number): Arrive[] {
    this.stamp(x, z)
    if (this.roamDirty) {
      this.roamDirty = false
      this.saveRoam()
    }
    const arrived: Arrive[] = []
    for (const spot of this.places) {
      if (!this.live(spot)) continue
      const id = spot.id === 'reservoir-rim' ? 'reservoir' : spot.id
      if (this.placeFound.has(id)) continue
      if (Math.hypot(spot.x - x, spot.z - z) > spot.radius) continue
      this.placeFound.add(id)
      this.savePlaces()
      const story = this.stories.get(id)
      arrived.push({
        id,
        kind: 'place',
        name: story?.name || spot.name,
        line: spot.line,
        history: story?.history || spot.line,
        people: story?.people ?? [],
        approximate: story?.approximate === true,
      })
    }
    for (const view of this.views) {
      if (this.viewFound.has(view.id)) continue
      if (Math.hypot(view.x - x, view.z - z) > view.radius) continue
      this.viewFound.add(view.id)
      this.saveViews()
      arrived.push({ id: view.id, kind: 'view', name: view.name, line: view.line, history: '', people: [], approximate: false })
    }
    return arrived
  }

  /** Brighter marquee in 1955. Today restores the stand-in glow. */
  setMarquee(hot: boolean): void {
    for (const lamp of this.marquee) lamp.mat.emissiveIntensity = hot ? Math.max(1.15, lamp.base * 3) : lamp.base
  }

  nearestUnfound(x: number, z: number): Spot | null {
    let best: Spot | null = null
    let bestD = 80
    for (const spot of this.places) {
      if (!this.live(spot)) continue
      const id = spot.id === 'reservoir-rim' ? 'reservoir' : spot.id
      if (this.placeFound.has(id)) continue
      const distance = Math.hypot(spot.x - x, spot.z - z)
      const reach = LANDMARK_IDS.has(id) ? Math.max(spot.radius, 70) : spot.radius
      if (distance < reach && distance < bestD) {
        best = spot
        bestD = distance
      }
    }
    return best
  }

  /** Mark a place found and return its story, so a time jump can show the card once. */
  claim(id: string): { name: string; history: string; people: StoryPerson[]; approximate: boolean } | null {
    const key = id === 'reservoir-rim' ? 'reservoir' : id
    if (this.placeFound.has(key)) return null
    this.placeFound.add(key)
    this.savePlaces()
    const spot = this.places.find((item) => item.id === id)
    const story = this.stories.get(key)
    return {
      name: story?.name || spot?.name || id,
      history: story?.history || spot?.line || '',
      people: story?.people ?? [],
      approximate: story?.approximate === true,
    }
  }
}

/** The clock’s arrival card reaches a little past these, so downtown still gets a then-and-now. */
const LANDMARK_IDS = new Set(['reservoir', 'bart', 'cross', 'theater', 'library', 'plaza'])

/** Invented meshes. The sentence is the only [Placeholder] on an otherwise sourced card. */
const INVENTED_LOOK: Record<string, string> = {
  theater: '[Placeholder] The brighter marquee is a stand-in for the Streamline Moderne front.',
  plaza: 'The plaza is the lawn and the pergolas. No fountain is documented.',
  library: '[Placeholder] The present library building is still drawn on the veterans hall site.',
  reservoir: '[Placeholder] The rim path is today’s trail.',
}

function historyAlias(name: string): string | null {
  if (/park theater/i.test(name)) return 'theater'
  if (/plaza \(elam|elam brown's gift/i.test(name)) return 'plaza'
  if (/bart station/i.test(name)) return 'bart'
  if (/veterans memorial building/i.test(name)) return 'library'
  return null
}

function tokenMatch(a: string, b: string): boolean {
  const left = normName(a)
  const right = normName(b)
  if (!left || !right) return false
  if (left === right) return true
  const stop = new Set(['lafayette', 'the', 'and', 'with', 'from', 'near'])
  const words = (value: string) => value.split(' ').filter((word) => word.length >= 4 && !stop.has(word))
  const tb = new Set(words(right))
  let shared = 0
  for (const word of words(left)) if (tb.has(word)) shared += 1
  return shared >= 2
}

function normName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function namesMatch(a: string, b: string): boolean {
  const left = normName(a)
  const right = normName(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function slug(value: string): string {
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return text || 'place'
}

function uniqueId(taken: string[], base: string): string {
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
