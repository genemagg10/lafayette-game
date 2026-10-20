/**
 * Era-tagged places from public/data/history_pois.geojson.
 * start_year / end_year in the file are historical facts. A completion date
 * or a closed business does not always remove the site from the walk.
 */

export interface HistoryFeature {
  name: string
  startYear: number | null
  endYear: number | null
  description: string
  source: string
  coordSource: string
  confidence: string
  lon: number | null
  lat: number | null
}

interface HistoryCollection {
  features?: {
    properties?: Record<string, unknown>
    geometry?: { type?: string; coordinates?: number[] } | null
  }[]
}

const VANISHED = /hotel corner|cornfield|van meter|sacramento northern|west lafayette station/i
const UNPLACED = /rancho acalanes|caldecott|hwy 24|recreation area/i

/** The site can still be found after end_year. The dam’s 1933 is a completion; the theater’s 2005 is a closing. */
export function historyPersists(name: string, endYear: number | null): boolean {
  if (endYear == null) return true
  return !VANISHED.test(name)
}

/** Null geometry, the rancho centroid, the Caldecott bore, the freeway median, and the lake centroid do not chime. */
export function historyChimes(feature: HistoryFeature): boolean {
  if (feature.lon == null || feature.lat == null) return false
  return !UNPLACED.test(feature.name)
}

export function historyApproximate(feature: HistoryFeature): boolean {
  if (/^(low|none)$/i.test(feature.confidence.trim())) return true
  return /approximate|interpolat|estimated|verify|\bgap\b/i.test(feature.coordSource)
}

export function historyVisible(startYear: number | null, endYear: number | null, year: number): boolean {
  if (startYear != null && year < startYear) return false
  if (endYear != null && year > endYear) return false
  return true
}

function yearOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseHistory(data: unknown): HistoryFeature[] {
  const features = (data as HistoryCollection)?.features
  if (!Array.isArray(features)) return []
  const out: HistoryFeature[] = []
  for (const feature of features) {
    const props = feature?.properties ?? {}
    const name = textOf(props.name).trim()
    if (!name) continue
    const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null
    const lon = coords && typeof coords[0] === 'number' ? coords[0] : null
    const lat = coords && typeof coords[1] === 'number' ? coords[1] : null
    out.push({
      name,
      startYear: yearOf(props.start_year),
      endYear: yearOf(props.end_year),
      description: textOf(props.description).trim(),
      source: textOf(props.source).trim(),
      coordSource: textOf(props.coord_source).trim(),
      confidence: textOf(props.confidence).trim(),
      lon,
      lat,
    })
  }
  return out
}

export async function loadHistory(base: string): Promise<HistoryFeature[]> {
  try {
    const res = await fetch(`${base}data/history_pois.geojson`)
    if (!res.ok) return []
    return parseHistory(await res.json())
  } catch {
    return []
  }
}
