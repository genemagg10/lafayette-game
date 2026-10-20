import {
  ClampToEdgeWrapping,
  Color,
  Data3DTexture,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from 'three/webgpu'
import { uniform } from 'three/tsl'

/** Fog color shared by the height fog and the god-ray march. */
export const fogTint = uniform(new Color(0xc5d7ea))
export const fogHeight = uniform(104)
export const fogDensity = uniform(0.00115)

const SIZE = 16

function curve(v: number): number {
  const x = Math.min(1, Math.max(0, v))
  return x * x * (3 - 2 * x)
}

/** Warm grade with the blacks lifted, so shade stays a color instead of a hole. */
function bake(r: number, g: number, b: number): [number, number, number] {
  const contrast = (v: number) => {
    const x = Math.min(1, Math.max(0, v))
    const lifted = 0.16 + x * 0.84
    return (lifted - 0.5) * 1.02 + 0.52
  }
  let R = contrast(curve(r))
  let G = contrast(curve(g))
  let B = contrast(curve(b * 0.98))
  const l = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const sat = 1.28
  R = l + (R - l) * sat
  G = l + (G - l) * sat
  B = l + (B - l) * sat
  const shade = 1 - Math.min(1, l * 1.8)
  R += 0.02 * shade
  G += 0.028 * shade
  B += 0.008 * shade
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  return [clamp(R), clamp(G), clamp(B)]
}

export function createLut(): Data3DTexture {
  const data = new Uint8Array(SIZE * SIZE * SIZE * 4)
  let i = 0
  for (let b = 0; b < SIZE; b++) {
    for (let g = 0; g < SIZE; g++) {
      for (let r = 0; r < SIZE; r++) {
        const c = bake(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1))
        data[i++] = c[0]
        data[i++] = c[1]
        data[i++] = c[2]
        data[i++] = 255
      }
    }
  }
  const tex = new Data3DTexture(data, SIZE, SIZE, SIZE)
  tex.format = RGBAFormat
  tex.type = UnsignedByteType
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.wrapR = ClampToEdgeWrapping
  tex.generateMipmaps = false
  tex.colorSpace = LinearSRGBColorSpace
  tex.needsUpdate = true
  return tex
}
