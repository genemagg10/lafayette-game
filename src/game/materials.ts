import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DoubleSide,
  LinearFilter,
  LinearSRGBColorSpace,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three/webgpu'
import { frameGroup, mix, normalWorld, positionWorld, sin, smoothstep, uniform, vec3, vertexColor } from 'three/tsl'
import { bounceTint, sunDirShade, swayFromHeight, swayFromTip } from './wind.ts'

export const shared = {
  time: { value: 0 },
  wind: { value: 0.28 },
  night: { value: 0 },
  wet: { value: 0 },
}

export const gradeGolden = uniform(0)
export const gradeNight = uniform(0)
export const blurAmount = uniform(0)
/** 0 keeps the current grade. Higher values lift and warm the frame like film. */
export const eraFilm = uniform(0).setGroup(frameGroup)

function canvasTex(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  draw(ctx, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.anisotropy = 8
  return tex
}

function windows(g: CanvasRenderingContext2D, y: number, h: number, lit: boolean): void {
  const cols = 4
  for (let i = 0; i < cols; i++) {
    const x = 18 + i * 58
    g.fillStyle = lit ? '#ffb15e' : '#1d3344'
    g.fillRect(x, y, 40, h)
    g.fillStyle = lit ? 'rgba(255,236,200,0.35)' : '#8eb4c8'
    g.fillRect(x + 3, y + 3, 15, h * 0.42)
    g.fillRect(x + 22, y + 3, 15, h * 0.42)
    g.strokeStyle = 'rgba(40,32,24,0.45)'
    g.strokeRect(x, y, 40, h)
  }
}

export function createTextures() {
  const wall = canvasTex((g, s) => {
    g.fillStyle = '#f6f3ec'
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#e4ddd2'
    g.fillRect(0, 0, s, 10)
    g.fillRect(0, s - 16, s, 16)
    g.fillStyle = '#d5cdc0'
    g.fillRect(0, 10, s, 3)
    windows(g, 40, 64, false)
    windows(g, 148, 64, false)
  })
  const store = canvasTex((g, s) => {
    g.fillStyle = '#f7f4ee'
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#e7e1d6'
    g.fillRect(0, s - 92, s, 92)
    g.fillStyle = '#c4553c'
    g.fillRect(0, s - 96, s, 8)
    g.fillStyle = '#d5e7ef'
    g.fillRect(18, s - 78, s - 36, 58)
    g.strokeStyle = 'rgba(28,36,48,0.28)'
    g.lineWidth = 3
    g.strokeRect(18, s - 78, s - 36, 58)
    windows(g, 28, 62, false)
    windows(g, 112, 48, true)
  })
  const windowsEmissive = canvasTex((g, s) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#ffb15e'
    const panes = [
      [18, 36, 40, 70],
      [76, 36, 40, 70],
      [134, 36, 40, 70],
      [192, 140, 40, 70],
    ]
    for (const [x, y, w, h] of panes) g.fillRect(x, y, w, h)
  })
  const soft = canvasTex((g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 8, s / 2, s / 2, s / 2)
    grd.addColorStop(0, 'rgba(255,255,255,0.95)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, s, s)
  }, 128)
  soft.wrapS = ClampToEdgeWrapping
  soft.wrapT = ClampToEdgeWrapping
  const oak = canvasTex((g, s) => {
    g.clearRect(0, 0, s, s)
    const grd = g.createRadialGradient(s * 0.5, s * 0.58, s * 0.05, s * 0.5, s * 0.55, s * 0.48)
    grd.addColorStop(0, '#6ea24a')
    grd.addColorStop(0.55, '#2f5d34')
    grd.addColorStop(1, 'rgba(47,93,52,0)')
    g.fillStyle = grd
    g.beginPath()
    g.ellipse(s * 0.5, s * 0.56, s * 0.42, s * 0.36, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#5a3d28'
    g.fillRect(s * 0.47, s * 0.72, s * 0.06, s * 0.28)
  }, 128)
  oak.wrapS = ClampToEdgeWrapping
  oak.wrapT = ClampToEdgeWrapping
  const waterNormals = canvasTex((g, s) => {
    const img = g.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const n = (Math.sin(x * 0.35) + Math.sin(y * 0.41) + Math.sin((x + y) * 0.17)) / 3
        const i = (y * s + x) * 4
        img.data[i] = 128 + n * 40
        img.data[i + 1] = 128 + Math.cos(x * 0.22) * 28
        img.data[i + 2] = 220
        img.data[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
  }, 128)
  waterNormals.colorSpace = LinearSRGBColorSpace
  waterNormals.wrapS = RepeatWrapping
  waterNormals.wrapT = RepeatWrapping
  return { wall, store, windows: windowsEmissive, soft, oak, waterNormals }
}

export type Textures = ReturnType<typeof createTextures>

let rampTex: CanvasTexture | null = null

function softRamp(): CanvasTexture {
  if (rampTex) return rampTex
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 4
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  const grd = g.createLinearGradient(0, 0, 64, 0)
  grd.addColorStop(0, '#9a9a9a')
  grd.addColorStop(0.42, '#b0b0b0')
  grd.addColorStop(0.52, '#e8e8e8')
  grd.addColorStop(1, '#ffffff')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 4)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = LinearSRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  rampTex = tex
  return tex
}

/** Gentle toon band over a lit leaf. Blades use a tip attribute; canopies flex with height. */
export function leafMaterial(mode: 'blade' | 'canopy'): MeshToonNodeMaterial {
  const material = new MeshToonNodeMaterial({ color: 0xffffff, gradientMap: softRamp(), side: DoubleSide })
  material.positionNode = mode === 'blade' ? swayFromTip() : swayFromHeight(0.55)
  if (mode === 'blade') material.vertexColors = true
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1
  return material
}

export function foliageMaterial(hex: number, roughness = 0.86, flex = 0.2): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color: hex, roughness })
  material.positionNode = swayFromHeight(flex)
  return material
}

/** Hills keep real lighting, with a soft wrap so the shadowed side stays the bounce color. */
export function hillMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0, vertexColors: true })
  const wrap = mix(
    vec3(1, 1, 1),
    mix(bounceTint, vec3(1.04, 0.99, 0.94), smoothstep(-0.15, 0.85, normalWorld.dot(sunDirShade))),
    0.34,
  )
  material.colorNode = vertexColor().mul(wrap).mul(sin(positionWorld.x.mul(0.17).add(positionWorld.z.mul(0.13))).mul(0.045).add(1)) as never
  return material
}

export function impostorMaterial(map: CanvasTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
    map,
    roughness: 0.9,
    transparent: true,
    alphaTest: 0.28,
    depthWrite: true,
  })
  material.positionNode = swayFromHeight(0.4)
  return material
}

const pillCache = new Map<string, CanvasTexture>()
const dotCache = new Map<string, CanvasTexture>()

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Apple Maps-style label: pale pill, dark type, optional category dot. */
export function pillTexture(title: string, accent = ''): CanvasTexture {
  const text = title.length > 28 ? `${title.slice(0, 26)}…` : title
  const key = `${accent}|${text}`
  const cached = pillCache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  g.clearRect(0, 0, 512, 128)
  g.fillStyle = 'rgba(28, 36, 48, 0.16)'
  roundRect(g, 20, 24, 472, 84, 28)
  g.fill()
  g.fillStyle = 'rgba(255, 252, 247, 0.94)'
  roundRect(g, 14, 14, 472, 84, 28)
  g.fill()
  g.fillStyle = '#1c2430'
  g.font = '600 44px Outfit, sans-serif'
  g.textBaseline = 'middle'
  if (accent) {
    g.fillStyle = accent
    g.beginPath()
    g.arc(56, 56, 13, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#1c2430'
    g.textAlign = 'left'
    g.fillText(text, 84, 58)
  } else {
    g.textAlign = 'center'
    g.fillText(text, 250, 58)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  pillCache.set(key, tex)
  return tex
}

export function dotTexture(accent: string): CanvasTexture {
  const cached = dotCache.get(accent)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  g.clearRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(255,252,247,0.95)'
  g.beginPath()
  g.arc(32, 32, 22, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = accent
  g.beginPath()
  g.arc(32, 32, 14, 0, Math.PI * 2)
  g.fill()
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  dotCache.set(accent, tex)
  return tex
}

export function poiAccent(kind: string): string {
  if (/cafe|restaurant|fast_food|bar|pub|bakery|food/.test(kind)) return '#e25b45'
  if (/fuel/.test(kind)) return '#e6a23a'
  if (/school|civic|townhall|library|worship|community/.test(kind)) return '#7a5af5'
  if (/park|garden/.test(kind)) return '#2f9e5a'
  if (/shop|supermarket|store|market/.test(kind)) return '#3b7ddd'
  return '#5c6b7a'
}

export function makeSignTexture(title: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  g.fillStyle = '#f7f1e4'
  g.fillRect(0, 0, 512, 128)
  g.strokeStyle = '#2f5d34'
  g.lineWidth = 10
  g.strokeRect(8, 8, 496, 112)
  g.fillStyle = '#1c2430'
  g.font = '600 52px Outfit, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const text = title.length > 26 ? title.slice(0, 24) + '…' : title
  g.fillText(text, 256, 68)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}
