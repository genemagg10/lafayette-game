export interface TerrainMeta {
  cols: number
  rows: number
  originX: number
  originZ: number
  sizeX: number
  sizeZ: number
  minElev: number
  maxElev: number
  waterLevel: number
}

export interface Place {
  id: string
  name: string
  x: number
  z: number
}

export interface Poi {
  n: string
  k: string
  x: number
  z: number
}

/** One researched place. `public/data/pois.json` is an array of these. */
export interface StoryPerson {
  name: string
  role: string
  contribution: string
  source: string
}

export interface StoryPoi {
  name: string
  lat: number
  lon: number
  history: string
  people: StoryPerson[]
  /** Low-confidence, interpolated, or partial-segment geocode. */
  approximate?: boolean
  confidence?: string
  category?: string
}

export interface StorefrontStyle {
  name: string
  lat: number
  lon: number
  category: string
  approximate: boolean
  wall: string
  awning: string
}

export interface CollectibleDef {
  id: string
  kind: string
  x: number
  z: number
  note: string
}

export interface Meta {
  attribution: string
  terrainAttribution: string
  origin: { lat: number; lon: number }
  bbox: { south: number; west: number; north: number; east: number }
  chunkSize: number
  spawn: { x: number; z: number; heading: number; name: string }
  places: Place[]
  pois: Poi[]
  signals: { x: number; z: number }[]
  crossings: { x: number; z: number; ang: number }[]
  streetSigns: { name: string; x: number; z: number; ang: number }[]
  collectibles: CollectibleDef[]
  memorial: { x: number; z: number }
  vehicles: {
    bike: { x: number; z: number; h: number }
    car: { x: number; z: number; h: number }
    heli: { x: number; z: number; h: number }
  }
  terrain: TerrainMeta
  stats: Record<string, number>
}

export interface Road {
  n: string
  t: string
  w: number
  s: number
  d: number
  b: number
  p: number[]
}

export interface WaterBody {
  n: string
  k: string
  level: number
  p: number[]
}

export interface WaterFile {
  bodies: WaterBody[]
  creeks: { n: string; p: number[] }[]
  parks: { n: string; p: number[] }[]
}

export interface ChunkData {
  b: unknown[][]
  t: number[]
  reeds: number[]
  parking: number[][]
}

export type ChunkFile = Record<string, ChunkData>

export type Season = 'summer' | 'winter' | 'spring'
export type WeatherId = 'clear' | 'fog' | 'overcast' | 'rain'
export type RideKind = 'foot' | 'bike' | 'car' | 'heli'
export type CamKind = RideKind | 'fly'
export type CamMode = 'chase' | 'first' | 'cine'
