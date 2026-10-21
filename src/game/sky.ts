import { BackSide, Mesh, NodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu'
import { Fn, acos, clamp, color, cos, dot, exp, float, max, mix, normalize, positionLocal, pow, sin, smoothstep, uniform, vec3 } from 'three/tsl'

/**
 * Preetham / Hosek-style daylight, plus the painted sunset and night
 * so a time lapse stays warm instead of turning into a lab diagram.
 */
export function createSky() {
  const uSun = uniform(new Vector3(0, 1, 0))
  const uAlt = uniform(0.4)
  const uOvercast = uniform(0)
  const uStar = uniform(1)
  const uA = uniform(new Vector3())
  const uB = uniform(new Vector3())
  const uC = uniform(new Vector3())
  const uD = uniform(new Vector3())
  const uE = uniform(new Vector3())
  const uZenith = uniform(new Vector3(1, 0.3, 0.3))
  const uDen = uniform(new Vector3(1, 1, 1))

  const material = new NodeMaterial()
  material.side = BackSide
  material.depthWrite = false
  material.depthTest = false
  material.fog = false
  material.lights = false
  material.colorNode = Fn(() => {
    const dir = normalize(positionLocal)
    const sun = normalize(uSun)
    const h = dir.y
    const sunDot = max(dot(dir, sun), float(0))
    const day = smoothstep(float(-0.12), float(0.22), uAlt)
    const golden = smoothstep(float(0.34), float(0.02), uAlt).mul(smoothstep(float(-0.12), float(0.18), uAlt))

    const theta = acos(clamp(h, 0.02, 1))
    const gamma = acos(clamp(dot(dir, sun), -1, 1))
    const cosG = cos(gamma)
    const perez = (A: any, B: any, C: any, D: any, E: any) => {
      return float(1)
        .add(A.mul(exp(B.div(max(cos(theta), float(0.02))))))
        .mul(float(1).add(C.mul(exp(D.mul(gamma)))).add(E.mul(cosG.mul(cosG))))
    }
    const y = max(uZenith.x.mul(perez(uA.x, uB.x, uC.x, uD.x, uE.x)).div(max(uDen.x, float(0.001))), float(0))
    const cx = uZenith.y.mul(perez(uA.y, uB.y, uC.y, uD.y, uE.y)).div(max(uDen.y, float(0.001)))
    const cy = max(uZenith.z.mul(perez(uA.z, uB.z, uC.z, uD.z, uE.z)).div(max(uDen.z, float(0.001))), float(0.001))
    const Y = max(y, float(0.001))
    const X = Y.div(cy).mul(cx)
    const Z = Y.div(cy).mul(float(1).sub(cx).sub(cy))
    const r = X.mul(3.2406).sub(Y.mul(1.5372)).sub(Z.mul(0.4986))
    const g = X.mul(-0.9689).add(Y.mul(1.8758)).add(Z.mul(0.0415))
    const b = X.mul(0.0557).sub(Y.mul(0.204)).add(Z.mul(1.057))
    const lum = max(r.mul(0.2126).add(g.mul(0.7152)).add(b.mul(0.0722)), float(0.0008))
    const chroma = vec3(max(r, float(0)), max(g, float(0)), max(b, float(0))).div(lum)
    // Afternoon sky: zenith #8fb4d6 down to a warm horizon #efe6d6. Perez only tints the sun side.
    const dayBlue = mix(vec3(0.937, 0.902, 0.839), vec3(0.561, 0.706, 0.839), smoothstep(float(0.02), float(0.62), h))
    let col = mix(chroma.mul(float(0.22)), dayBlue, float(0.9))

    const setHorizon = vec3(0.99, 0.46, 0.2)
    const setZenith = vec3(0.28, 0.34, 0.62)
    const sunset = mix(setHorizon, setZenith, smoothstep(float(0.0), float(0.55), h))
    const nightZenith = vec3(0.012, 0.018, 0.05)
    const nightHorizon = vec3(0.09, 0.1, 0.16)
    const night = mix(nightHorizon, nightZenith, smoothstep(float(-0.05), float(0.4), h))

    col = mix(col, sunset, golden.mul(0.72))
    const blueHour = smoothstep(float(0.06), float(-0.04), uAlt).mul(smoothstep(float(-0.28), float(-0.05), uAlt))
    const blueSky = mix(vec3(0.98, 0.46, 0.32), vec3(0.07, 0.16, 0.48), smoothstep(float(0.0), float(0.42), h))
    col = mix(col, blueSky, blueHour.mul(0.82))
    col = mix(night, col, day)

    const mie = pow(sunDot, float(8)).mul(vec3(1.0, 0.52, 0.2)).mul(golden.mul(0.9).add(day.mul(0.1)))
    const disc = pow(sunDot, float(1400)).mul(vec3(1.0, 0.93, 0.72)).mul(day.add(golden.mul(0.8)))
    col = col.add(mie).add(disc.mul(1.8))

    const moon = normalize(uSun.negate())
    const moonDot = max(dot(dir, moon), float(0))
    col = col.add(vec3(0.82, 0.88, 1.0).mul(pow(moonDot, float(900)).mul(float(1).sub(day)).mul(1.3)))

    const cell = dir.mul(380)
    const star = sin(cell.x.mul(127.1).add(cell.y.mul(311.7)).add(cell.z.mul(74.7)))
    const twinkle = smoothstep(float(0.986), float(0.997), star.mul(0.5).add(0.5))
    col = col.add(vec3(0.9, 0.93, 1).mul(twinkle).mul(uStar).mul(float(1).sub(day)).mul(smoothstep(float(0), float(0.2), h)))

    const gray = mix(color(0x8e97a1), color(0xc5ccd3), smoothstep(float(0), float(0.45), h))
    col = mix(col, gray, uOvercast.mul(0.82))
    col = mix(col, col.mul(0.45), smoothstep(float(0), float(-0.25), h))
    return col
  })()

  const mesh = new Mesh(new SphereGeometry(7000, 48, 24), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -2
  return { mesh, uSun, uAlt, uOvercast, uStar, uA, uB, uC, uD, uE, uZenith, uDen }
}

export type Sky = ReturnType<typeof createSky>

function perez(theta: number, gamma: number, A: number, B: number, C: number, D: number, E: number): number {
  const cosT = Math.max(0.02, Math.cos(theta))
  return (1 + A * Math.exp(B / cosT)) * (1 + C * Math.exp(D * gamma) + E * Math.cos(gamma) ** 2)
}

/** Turbidity and sun altitude drive the Perez coefficients. Below the horizon the night mix takes over. */
export function syncSky(sky: Sky, altitude: number, turbidity: number): void {
  const T = Math.min(8, Math.max(1.8, turbidity))
  const thetaS = Math.min(1.45, Math.max(0.08, Math.PI / 2 - Math.max(altitude, 0.03)))
  const Y = [0.1787 * T - 1.463, -0.3554 * T + 0.4275, -0.0227 * T + 5.3251, 0.1206 * T - 2.5771, -0.067 * T + 0.3703]
  const x = [-0.0193 * T - 0.2592, -0.0665 * T + 0.0008, -0.0004 * T + 0.2125, -0.0641 * T - 0.8989, -0.0033 * T + 0.0452]
  const y = [-0.0167 * T - 0.2608, -0.095 * T + 0.0092, -0.0079 * T + 0.2102, -0.0441 * T - 1.6537, -0.0109 * T + 0.0529]
  sky.uA.value.set(Y[0], x[0], y[0])
  sky.uB.value.set(Y[1], x[1], y[1])
  sky.uC.value.set(Y[2], x[2], y[2])
  sky.uD.value.set(Y[3], x[3], y[3])
  sky.uE.value.set(Y[4], x[4], y[4])

  const t2 = thetaS * thetaS
  const t3 = t2 * thetaS
  const T2 = T * T
  const chi = (4 / 9 - T / 120) * (Math.PI - 2 * thetaS)
  const zenithY = Math.max(0.05, (4.0453 * T - 4.971) * Math.tan(chi) - 0.2155 * T + 2.4192)
  const zenithX =
    (0.00166 * t3 - 0.00375 * t2 + 0.00209 * thetaS) * T2 +
    (-0.02903 * t3 + 0.06377 * t2 - 0.03202 * thetaS + 0.00394) * T +
    (0.11693 * t3 - 0.21196 * t2 + 0.06052 * thetaS + 0.25886)
  const zenithy =
    (0.00275 * t3 - 0.0061 * t2 + 0.00317 * thetaS) * T2 +
    (-0.04214 * t3 + 0.0897 * t2 - 0.04153 * thetaS + 0.00516) * T +
    (0.15346 * t3 - 0.26756 * t2 + 0.0667 * thetaS + 0.26688)
  sky.uZenith.value.set(zenithY, zenithX, Math.max(0.05, zenithy))
  sky.uDen.value.set(
    Math.max(0.05, perez(0, thetaS, Y[0], Y[1], Y[2], Y[3], Y[4])),
    Math.max(0.05, perez(0, thetaS, x[0], x[1], x[2], x[3], x[4])),
    Math.max(0.05, perez(0, thetaS, y[0], y[1], y[2], y[3], y[4])),
  )
}
