import { Color, DoubleSide, Matrix4, MeshStandardNodeMaterial, Vector2, Vector3, type PerspectiveCamera } from 'three/webgpu'
import {
  Fn,
  attribute,
  float,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  positionLocal,
  cos,
  sin,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'

/** One wind for grass, oaks, banners, and clothing. */
export const windTime = uniform(0)
export const windStrength = uniform(0.32)
export const windDir = uniform(new Vector2(0.84, 0.54))

/** Local-space offset. `flex` is 0 at the root and 1 at the free end. */
export function sway(flex: unknown) {
  const bend = flex as never
  return Fn(() => {
    const base = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz
    const t = windTime
    const n = sin(base.x.mul(0.063).add(base.z.mul(0.051)).add(t.mul(1.25))).mul(
      sin(base.x.mul(0.017).sub(base.z.mul(0.023)).add(t.mul(0.37))),
    )
    const gust = sin(t.mul(0.23).add(base.x.mul(0.008))).mul(0.35).add(0.75)
    const amp = n.mul(gust).mul(windStrength).mul(bend)
    const worldOff = vec3(windDir.x, float(0), windDir.y).mul(amp)
    return modelWorldMatrixInverse.mul(vec4(worldOff, 0)).xyz
  })()
}

export function swayFromTip() {
  return sway(attribute('tip', 'float'))
}

export function swayFromHeight(scale = 0.5) {
  return sway(positionLocal.y.max(0).mul(scale))
}

/**
 * 0.8° over 4s. `phase` is per tree so a row does not bow together.
 * Instancing has already written the world vertex into `positionLocal`
 * by the time a positionNode runs. Rotating that vector spins the crown
 * around the world origin and lifts it off the trunk. Sway the raw
 * geometry instead, and add the few centimetres back on.
 */
export function canopySway() {
  const amp = (0.8 * Math.PI) / 180
  return Fn(() => {
    const phase = attribute('phase', 'float')
    const ang = sin(windTime.mul(Math.PI / 2).add(phase)).mul(amp)
    const c = cos(ang)
    const s = sin(ang)
    const x = positionGeometry.x
    const y = positionGeometry.y
    const rx = x.mul(c).sub(y.mul(s))
    const ry = x.mul(s).add(y.mul(c))
    return positionLocal.add(vec3(rx.sub(x), ry.sub(y), float(0)))
  })()
}

export function clothMaterial(hex: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color: hex, roughness: 0.68, metalness: 0.03, side: DoubleSide })
  material.positionNode = positionLocal.add(sway(positionLocal.y.negate().max(0).mul(1.5)) as never)
  return material
}

/** Same field the shaders use, for capes and scarves. */
export function sampleWind(x: number, z: number, time: number): { x: number; z: number; mag: number } {
  const n = Math.sin(x * 0.063 + z * 0.051 + time * 1.25) * Math.sin(x * 0.017 - z * 0.023 + time * 0.37)
  const gust = Math.sin(time * 0.23 + x * 0.008) * 0.35 + 0.75
  const amp = n * gust * windStrength.value
  return { x: windDir.value.x * amp, z: windDir.value.y * amp, mag: Math.abs(amp) }
}

export const viewProj = uniform(new Matrix4())
export const camPos = uniform(new Vector3())
export const sunClip = uniform(new Vector2(0.5, 0.65))
export const sunOn = uniform(0)
export const sunDirShade = uniform(new Vector3(0.25, 0.85, 0.2))
export const bounceTint = uniform(new Color(0xd4b36a))
export const shaftGain = uniform(0.35)
export const shaftColor = uniform(new Vector3(1, 0.78, 0.42))
export const dofGain = uniform(0.32)
export const valleyFog = uniform(0)
export const farHaze = uniform(0)
export const invProj = uniform(new Matrix4())
export const camWorld = uniform(new Matrix4())
export const overcastShade = uniform(0)

export function projectSun(camera: PerspectiveCamera, sun: Vector3): void {
  const ahead = camera.position.clone().addScaledVector(sun, 480)
  ahead.project(camera)
  sunClip.value.set(ahead.x * 0.5 + 0.5, ahead.y * 0.5 + 0.5)
  const onScreen = ahead.z < 1 && Math.abs(ahead.x) < 1.45 && Math.abs(ahead.y) < 1.45 && sun.y > -0.04
  sunOn.value = onScreen ? 1 : 0
  sunDirShade.value.copy(sun)
  viewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  camPos.value.copy(camera.position)
  invProj.value.copy(camera.projectionMatrix).invert()
  camWorld.value.copy(camera.matrixWorld)
}
