import type { StoryPerson, StoryPoi } from './types.ts'

const PLACEHOLDER = /\[Placeholder\]/i

export function isPlaceholderText(value: string): boolean {
  return PLACEHOLDER.test(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function person(value: unknown): StoryPerson | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const name = text(row.name)
  if (!name) return null
  return {
    name,
    role: text(row.role),
    contribution: text(row.contribution) || text(row.blurb),
    source: text(row.source),
  }
}

function isApproximate(row: Record<string, unknown>): boolean {
  if (row.approximate === true) return true
  const confidence = text(row.confidence).toLowerCase()
  const coord = text(row.coord_source)
  if (confidence === 'low') return true
  return /approximate|interpolat|verify|segment/i.test(coord)
}

function poi(value: unknown): StoryPoi | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const name = text(row.name)
  const lat = typeof row.lat === 'number' ? row.lat : Number.NaN
  const lon = typeof row.lon === 'number' ? row.lon : Number.NaN
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const people = Array.isArray(row.people) ? row.people.map(person).filter((item): item is StoryPerson => item != null) : []
  const category = text(row.category)
  return {
    name,
    lat,
    lon,
    history: text(row.history) || text(row.description),
    people,
    approximate: isApproximate(row),
    confidence: text(row.confidence),
    category,
  }
}

function fromFeature(value: unknown): StoryPoi | null {
  if (!value || typeof value !== 'object') return null
  const feature = value as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }
  const coords = feature.geometry?.coordinates
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coords) || coords.length < 2) return null
  const lon = Number(coords[0])
  const lat = Number(coords[1])
  const props = feature.properties ?? {}
  if (text(props.category).startsWith('business')) return null
  return poi({ ...props, lat, lon })
}

/** Accept a bare array, `{ pois }` / `{ places }`, or a GeoJSON FeatureCollection. */
export function parseStories(raw: unknown): StoryPoi[] {
  if (raw && typeof raw === 'object' && (raw as { type?: string }).type === 'FeatureCollection') {
    const features = (raw as { features?: unknown[] }).features ?? []
    return features.map(fromFeature).filter((item): item is StoryPoi => item != null)
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { pois?: unknown }).pois)
      ? (raw as { pois: unknown[] }).pois
      : raw && typeof raw === 'object' && Array.isArray((raw as { places?: unknown }).places)
        ? (raw as { places: unknown[] }).places
        : []
  return list.map(poi).filter((item): item is StoryPoi => item != null)
}

/** Landmark stories baked from data/pois.geojson into public/data/pois.json. */
export async function loadStories(base: string): Promise<StoryPoi[]> {
  const urls = [`${base}data/pois.json`]
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const parsed = parseStories(await res.json())
      if (parsed.length > 0) return parsed
    } catch {
      /* the next file */
    }
  }
  return []
}
