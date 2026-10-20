/**
 * Town materials in one place.
 * A downtown reference pack can replace these hexes without touching the mesh code.
 * OSM `building:colour` / `roof:colour` still override a single building when the tag exists.
 */
export const town = {
  asphalt: 0x3c434e,
  asphaltAlt: 0x4a5260,
  curb: 0xc9bfb0,
  sidewalk: 0xd7d0c4,
  laneWhite: 0xf5f7fb,
  laneYellow: 0xf0c42a,
  crosswalk: 0xf7f8f6,
  dirt: 0xc6a36a,
  paper: [0xe7e0d4, 0xddd4c6, 0xf0e8dc, 0xd5cfc4],
  roof: 0x6e5848,
  roofAlt: 0x8a6a52,
}

const NAMED: Record<string, number> = {
  white: 0xf4f1ea,
  black: 0x2a2a2a,
  gray: 0x8a8680,
  grey: 0x8a8680,
  silver: 0xc5c5c8,
  red: 0x8d3a32,
  brown: 0x6b4a34,
  beige: 0xd9c7a6,
  tan: 0xc4a574,
  yellow: 0xe0c15a,
  cream: 0xf0e6d0,
  blue: 0x4d6d8a,
  green: 0x5d7344,
  orange: 0xc47a3a,
  pink: 0xd7a0a8,
}

/** Parse an OSM colour tag. Returns null when the tag is missing or unknown. */
export function parseOsmColor(value: string): number | null {
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (/^[0-9a-f]{6}$/.test(hex)) return Number.parseInt(hex, 16)
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return Number.parseInt(hex.split('').map((c) => c + c).join(''), 16)
  }
  return NAMED[raw] ?? null
}
