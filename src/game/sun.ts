/** NOAA solar position. Azimuth 0 = north, clockwise. Altitude in radians. */
export function solarPosition(
  dayOfYear: number,
  localMinutes: number,
  latDeg: number,
  lonDeg: number,
  tzHours: number,
): { altitude: number; azimuth: number } {
  const rad = Math.PI / 180
  const lat = latDeg * rad
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (localMinutes / 60 - 12) / 24)
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  const tst = localMinutes + eqtime + 4 * lonDeg - 60 * tzHours
  const ha = (tst / 4 - 180) * rad
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZen)))
  const altitude = Math.PI / 2 - zenith
  const sinZen = Math.sin(zenith) || 1e-6
  let azimuth = Math.acos(
    Math.min(1, Math.max(-1, (Math.sin(decl) - Math.sin(lat) * Math.cos(zenith)) / (Math.cos(lat) * sinZen))),
  )
  if (ha > 0) azimuth = Math.PI * 2 - azimuth
  return { altitude, azimuth }
}

export const LAFAYETTE = { lat: 37.8858, lon: -122.118 }

export function sunForClock(minutes: number, season: 'summer' | 'winter' | 'spring'): { altitude: number; azimuth: number } {
  const day = season === 'winter' ? 15 : season === 'spring' ? 110 : 172
  const tz = season === 'winter' ? -8 : -7
  const local = ((minutes % 1440) + 1440) % 1440
  return solarPosition(day, local, LAFAYETTE.lat, LAFAYETTE.lon, tz)
}
