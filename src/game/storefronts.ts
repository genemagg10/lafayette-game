import type { StorefrontStyle } from './types.ts'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function row(value: unknown): StorefrontStyle | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const style = item.style && typeof item.style === 'object' ? (item.style as Record<string, unknown>) : {}
  const name = text(item.name)
  const lat = typeof item.lat === 'number' ? item.lat : Number.NaN
  const lon = typeof item.lon === 'number' ? item.lon : Number.NaN
  const wall = text(style.wall) || text(item.wall)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !/^#[0-9a-fA-F]{6}$/.test(wall)) return null
  return {
    name,
    lat,
    lon,
    category: text(item.category),
    approximate: item.approximate === true,
    wall,
    awning: text(style.awning) || text(item.awning) || wall,
  }
}

/** Business facade colors. Research left storefront color unknown, so style is the override. */
export async function loadStorefronts(base: string): Promise<StorefrontStyle[]> {
  try {
    const res = await fetch(`${base}data/businesses.json`)
    if (!res.ok) return []
    const raw = (await res.json()) as unknown
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { businesses?: unknown[] }).businesses)
        ? (raw as { businesses: unknown[] }).businesses
        : []
    return list.map(row).filter((item): item is StorefrontStyle => item != null)
  } catch {
    return []
  }
}
