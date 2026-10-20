export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function wrapAngle(a: number): number {
  let v = a
  while (v > Math.PI) v -= Math.PI * 2
  while (v < -Math.PI) v += Math.PI * 2
  return v
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Heading 0 faces north (−Z). Positive heading turns right, toward east. */
export function forwardFromHeading(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: -Math.cos(heading) }
}

export function rightFromHeading(heading: number): { x: number; z: number } {
  return { x: Math.cos(heading), z: Math.sin(heading) }
}

export function headingFromForward(x: number, z: number): number {
  return Math.atan2(x, -z)
}

export function hash01(n: number): number {
  let x = n | 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x = (x ^ (x >>> 16)) >>> 0
  return x / 4294967296
}
