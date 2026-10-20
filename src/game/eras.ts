/**
 * One terrain, many years. A mesh with no years is drawn in every era.
 * start_year and end_year are inclusive. Research still to come stays locked.
 */

export type EraId = 'settlement' | 'orchard' | 'fifties' | 'seventies' | 'today'

export interface EraSpan {
  startYear: number | null
  endYear: number | null
}

export interface EraSpec {
  id: EraId
  year: number
  label: string
  short: string
  playable: boolean
  startYear: number | null
  endYear: number | null
  /** 0 is the current painterly grade. Higher values warm and lift it like film. */
  grade: number
  rides: ('wagon' | 'vintage' | 'car')[]
  note: string
  arrival: string
  todayLine: string
}

export const ERAS: EraSpec[] = [
  {
    id: 'settlement',
    year: 1864,
    label: "Elam Brown's settlement",
    short: '1860s',
    playable: false,
    startYear: 1847,
    endYear: 1889,
    grade: 0.85,
    rides: ['wagon'],
    note: 'The plaza deed, the Pioneer Store, and the rancho are in the record. The town is not rebuilt to walk yet.',
    arrival: '',
    todayLine: '',
  },
  {
    id: 'orchard',
    year: 1916,
    label: 'Orchards and the early town',
    short: '1910s',
    playable: false,
    startYear: 1890,
    endYear: 1939,
    grade: 0.7,
    rides: ['wagon', 'vintage'],
    note: 'The electric railway carried passengers from 1913 to 1941. Orchards and the early storefronts are recorded. The walkable town is still ahead.',
    arrival: '',
    todayLine: '',
  },
  {
    id: 'fifties',
    year: 1955,
    label: 'Mt. Diablo Boulevard',
    short: '1955',
    playable: true,
    startYear: 1941,
    endYear: 1956,
    grade: 0.45,
    rides: ['wagon', 'vintage'],
    note: 'Highway 24 still runs along Mt. Diablo Boulevard. The globe lamps, wagon, coupe, and orchard rows are a stand-in look.',
    arrival:
      'The year is 1955. Highway 24 still runs along Mt. Diablo Boulevard. The bypass through town comes about 1957–59 and is rebuilt about 1969–70. The Park Theater has been open since August 21, 1941. The reservoir is already here; it opens to the public on June 13, 1966. The city incorporates in July 1968, and BART opens May 21, 1973. The electric railway stopped carrying passengers in 1941. [Placeholder] Globe lamps, a wagon, a cream coupe, and a few orchard rows are a stand-in look.',
    todayLine: 'Today this is a city street, with Highway 24 and Lafayette Station a short walk north.',
  },
  {
    id: 'seventies',
    year: 1974,
    label: 'BART and the Reservoir',
    short: '1970s',
    playable: false,
    startYear: 1966,
    endYear: 1979,
    grade: 0.35,
    rides: ['car'],
    note: 'The Reservoir opened to the public on June 13, 1966, the city incorporated in July 1968, and BART opened May 21, 1973. That walk is still ahead.',
    arrival: '',
    todayLine: '',
  },
  {
    id: 'today',
    year: 2026,
    label: 'Today',
    short: 'Today',
    playable: true,
    startYear: 1980,
    endYear: null,
    grade: 0,
    rides: ['car'],
    note: 'The town as it stands.',
    arrival: 'Back on the boulevard as it is. Highway 24 and Lafayette Station are in the valley again.',
    todayLine: '',
  },
]

export const ERA_BY_ID: Record<EraId, EraSpec> = {
  settlement: ERAS[0],
  orchard: ERAS[1],
  fifties: ERAS[2],
  seventies: ERAS[3],
  today: ERAS[4],
}

export interface ThenNow {
  then: string
  now: string
}

const FALLBACK: Record<string, ThenNow> = {
  theater: {
    then: 'The Park Theater opened August 21, 1941, with a neon marquee on the boulevard. In 1955 the highway still runs along this street. [Placeholder] The extra glow is a stand-in for the real marquee.',
    now: 'Today the theater is closed, with a reopening aimed at early 2027. The card’s spot is an approximate geocode.',
  },
}

/** Card copy sometimes already starts with “Today”. Don’t say it twice. */
export function asToday(text: string): string {
  if (!text) return ''
  return /^today\b/i.test(text) ? text : `Today: ${text}`
}

export function spanVisible(span: EraSpan, year: number): boolean {
  if (span.startYear != null && year < span.startYear) return false
  if (span.endYear != null && year > span.endYear) return false
  return true
}

export const ERA_KEY = 'lafayette-days-era'

export function loadEra(): EraId {
  try {
    const raw = localStorage.getItem(ERA_KEY)
    const found = ERAS.find((era) => era.id === raw && era.playable)
    return found?.id ?? 'today'
  } catch {
    return 'today'
  }
}

export function saveEra(id: EraId): void {
  try {
    localStorage.setItem(ERA_KEY, id)
  } catch {
    /* private mode */
  }
}

export async function loadEraCopy(base: string): Promise<Map<string, ThenNow>> {
  const map = new Map<string, ThenNow>(Object.entries(FALLBACK))
  try {
    const res = await fetch(`${base}data/eras.json`)
    if (!res.ok) return map
    const data = (await res.json()) as { thenNow?: Record<string, { then?: string; now?: string }> }
    for (const [id, row] of Object.entries(data.thenNow ?? {})) {
      const then = typeof row?.then === 'string' ? row.then : ''
      const now = typeof row?.now === 'string' ? row.now : ''
      if (then || now) map.set(id, { then, now })
    }
  } catch {
    /* the baked fallback stays */
  }
  return map
}
