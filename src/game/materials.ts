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
  Vector2,
} from 'three/webgpu'
import { attribute, frameGroup, mix, normalWorld, positionLocal, smoothstep, uniform, vec3, vertexColor } from 'three/tsl'
import { canopySway, sunDirShade, swayFromHeight, swayFromTip } from './wind.ts'

/** Matte crowns. `fade` is per tree so a crown in the lens can disappear. */
export function townLeafMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    emissive: 0x000000,
    emissiveIntensity: 0,
    flatShading: false,
    vertexColors: true,
  })
  mat.transparent = true
  mat.opacityNode = attribute('fade', 'float')
  mat.depthWrite = true
  // Sway the raw geometry by a few centimetres. Rotating positionLocal
  // spins the crown around the world origin and paints it across the road.
  mat.positionNode = canopySway()
  return mat
}

/** Same crown, for a mesh that is not instanced and has no fade attribute. */
export function solidCanopyMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
  })
  mat.positionNode = canopySway()
  return mat
}

/** Bark. Instance color picks oak brown or the mottled plane trunk. */
export function trunkMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    emissive: 0x000000,
    emissiveIntensity: 0,
    flatShading: false,
    vertexColors: true,
  })
  mat.transparent = true
  mat.opacityNode = attribute('fade', 'float')
  mat.depthWrite = true
  mat.emissiveNode = vertexColor().mul(0.16) as never
  return mat
}

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
  const cols = 3
  const bay = 78
  for (let i = 0; i < cols; i++) {
    const x = 16 + i * bay
    g.fillStyle = '#2c2824'
    g.fillRect(x, y, 64, h)
    g.fillStyle = lit ? '#ffb15e' : '#3d4a52'
    g.fillRect(x + 5, y + 5, 54, h - 10)
    g.fillStyle = lit ? 'rgba(255,236,200,0.28)' : 'rgba(180,196,204,0.28)'
    g.fillRect(x + 8, y + 8, 22, (h - 16) * 0.45)
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
    g.fillStyle = '#7a4a36'
    g.fillRect(0, s - 96, s, 8)
    g.fillStyle = '#3d4a52'
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
    grd.addColorStop(0, '#6f7d4a')
    grd.addColorStop(0.55, '#5e6b3f')
    grd.addColorStop(1, 'rgba(94,107,63,0)')
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
  material.positionNode = positionLocal.add((mode === 'blade' ? swayFromTip() : swayFromHeight(0.55)) as never)
  if (mode === 'blade') material.vertexColors = true
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1
  return material
}

export function foliageMaterial(hex: number, roughness = 0.86, flex = 0.2): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color: hex, roughness })
  material.positionNode = positionLocal.add(swayFromHeight(flex) as never)
  return material
}

/** Hills keep real lighting, with a soft wrap so the shadowed side stays the bounce color. */
export function hillMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0, vertexColors: true })
  const wrap = mix(vec3(0.94, 0.96, 0.92), vec3(1, 1, 1), smoothstep(-0.25, 0.8, normalWorld.dot(sunDirShade)))
  material.colorNode = vertexColor().mul(wrap) as never
  return material
}

/** Storefronts keep a little color in shade. The sun still models the face. */
export function facadeMaterial(roughness = 0.9): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness,
    metalness: 0,
    vertexColors: true,
    flatShading: false,
  })
  material.emissiveNode = vertexColor().mul(0.18) as never
  return material
}

/** Board-and-batten: a vertical groove every 0.4 m along the wall UV (1 unit = 3.2 m). */
export function battenMaterial(): MeshStandardNodeMaterial {
  const material = facadeMaterial(0.9)
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 8
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = 'rgb(128,128,255)'
    g.fillRect(0, 0, 64, 8)
    g.fillStyle = 'rgb(96,128,255)'
    for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 2, 8)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = LinearSRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  material.normalMap = tex
  material.normalScale = new Vector2(0.55, 0.55)
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
  material.positionNode = positionLocal.add(swayFromHeight(0.4) as never)
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
  if (/cafe|restaurant|fast_food|bar|pub|bakery|food|ice_cream/.test(kind)) return '#ff8a2a'
  if (/fuel/.test(kind)) return '#f0a020'
  if (/school|civic|townhall|library|worship|community|station/.test(kind)) return '#7a5af5'
  if (/park|garden|playground|pitch/.test(kind)) return '#22b14c'
  if (/parking/.test(kind)) return '#2f7bff'
  if (/shop|supermarket|store|market/.test(kind)) return '#3b7ddd'
  return '#5c6b7a'
}

const streetCache = new Map<string, CanvasTexture>()
const badgeCache = new Map<string, CanvasTexture>()

/** White street name, meant to lie flat on the asphalt. */
export function streetNameTexture(title: string): CanvasTexture {
  const text = title.replace(/\b(Street|Avenue|Boulevard|Road|Drive|Lane|Way|Court|Place)\b/gi, (w) => {
    const short: Record<string, string> = { street: 'St', avenue: 'Ave', boulevard: 'Blvd', road: 'Rd', drive: 'Dr', lane: 'Ln', way: 'Way', court: 'Ct', place: 'Pl' }
    return short[w.toLowerCase()] ?? w
  }).toUpperCase()
  const cached = streetCache.get(text)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 160
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  g.clearRect(0, 0, 1024, 160)
  g.font = '800 104px Outfit, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 22
  g.strokeStyle = 'rgba(10, 14, 18, 0.92)'
  g.lineJoin = 'round'
  g.strokeText(text, 512, 84)
  g.fillStyle = '#fffdf6'
  g.fillText(text, 512, 84)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  streetCache.set(text, tex)
  return tex
}

/** Glowing category circle. Landmark kinds get a photo-like disc. */
export function badgeTexture(accent: string, landmark = false): CanvasTexture {
  const key = `${landmark ? 'L' : 'b'}|${accent}`
  const cached = badgeCache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) throw new Error('Canvas unavailable')
  g.clearRect(0, 0, 128, 128)
  const glow = g.createRadialGradient(64, 64, 10, 64, 64, 60)
  glow.addColorStop(0, accent)
  glow.addColorStop(0.45, accent)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#fffdf8'
  g.beginPath()
  g.arc(64, 64, landmark ? 40 : 28, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = accent
  g.beginPath()
  g.arc(64, 64, landmark ? 34 : 22, 0, Math.PI * 2)
  g.fill()
  if (landmark) {
    g.save()
    g.beginPath()
    g.arc(64, 64, 30, 0, Math.PI * 2)
    g.clip()
    const sky = g.createLinearGradient(34, 34, 34, 94)
    sky.addColorStop(0, '#8ec8f0')
    sky.addColorStop(0.55, '#d7e7c8')
    sky.addColorStop(1, '#6d8a4a')
    g.fillStyle = sky
    g.fillRect(34, 34, 60, 60)
    g.fillStyle = '#f4efe6'
    g.fillRect(48, 58, 32, 28)
    g.fillStyle = '#c46a3a'
    g.beginPath()
    g.moveTo(46, 58)
    g.lineTo(64, 44)
    g.lineTo(82, 58)
    g.fill()
    g.fillStyle = '#ffe1a8'
    g.fillRect(58, 68, 8, 10)
    g.restore()
    g.strokeStyle = '#fffdf8'
    g.lineWidth = 4
    g.beginPath()
    g.arc(64, 64, 32, 0, Math.PI * 2)
    g.stroke()
  } else {
    g.fillStyle = '#fffdf8'
    g.beginPath()
    g.arc(64, 62, 7, 0, Math.PI * 2)
    g.fill()
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  badgeCache.set(key, tex)
  return tex
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
