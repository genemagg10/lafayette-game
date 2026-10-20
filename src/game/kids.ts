import * as THREE from 'three'
import { clothMaterial } from './wind.ts'

export type KidId = 'milo' | 'juniper'

const KEY = 'lafayette-days-kid'

export interface Kid {
  id: KidId
  name: string
  line: string
  skin: number
  hair: number
  shirt: number
  shorts: number
  shoes: number
  accent: number
  cloth: number
  pack: number
  hat: boolean
  /** Quicker steps when higher. */
  stride: number
  /** Arm and leg swing. */
  swing: number
  /** Idle and run hop. */
  bounce: number
  runLean: number
  wave: 'big' | 'small'
  flight: 'wide' | 'dart'
  jump: 'cheer' | 'tuck'
  /** Brighter, snappier blips. */
  bright: boolean
}

export const KIDS: Record<KidId, Kid> = {
  milo: {
    id: 'milo',
    name: 'Milo',
    line: 'Nine. Bounces when he runs.',
    skin: 0xf0c2a0,
    hair: 0x3a2418,
    shirt: 0xe25b2a,
    shorts: 0x243656,
    shoes: 0xf7f1e6,
    accent: 0xf2c14e,
    cloth: 0xc4343c,
    pack: 0x6b3a2a,
    hat: true,
    stride: 0.92,
    swing: 1.15,
    bounce: 1.3,
    runLean: 0.16,
    wave: 'big',
    flight: 'wide',
    jump: 'cheer',
    bright: true,
  },
  juniper: {
    id: 'juniper',
    name: 'Juniper',
    line: 'Eleven. Light on the pedals.',
    skin: 0xc68658,
    hair: 0x1a1216,
    shirt: 0x178a86,
    shorts: 0xf0c43a,
    shoes: 0xf7f4ee,
    accent: 0xf0c43a,
    cloth: 0x7ec8e3,
    pack: 0x6b3d78,
    hat: false,
    stride: 1.22,
    swing: 0.78,
    bounce: 0.72,
    runLean: 0.04,
    wave: 'small',
    flight: 'dart',
    jump: 'tuck',
    bright: false,
  },
}

export function loadKid(): KidId {
  try {
    return localStorage.getItem(KEY) === 'juniper' ? 'juniper' : 'milo'
  } catch {
    return 'milo'
  }
}

export function saveKid(id: KidId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private mode */
  }
}

export interface KidRig {
  hips: THREE.Group
  head: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  cloth: THREE.Group
  clothTip: THREE.Group
  pack: THREE.Mesh
  ring: THREE.Mesh
}

export function buildKid(kid: Kid): KidRig {
  const skin = mat(kid.skin, 0.62)
  const shirt = mat(kid.shirt, 0.7)
  const shorts = mat(kid.shorts, 0.74)
  const shoe = mat(kid.shoes, 0.55)
  const hair = mat(kid.hair, 0.58)
  const accent = mat(kid.accent, 0.5)
  const clothMat = clothMaterial(kid.cloth)
  const packMat = mat(kid.pack, 0.8)
  const eyeWhite = mat(0xfffaf4, 0.4)
  const pupil = mat(0x1c2430, 0.35)
  const blush = mat(0xe48b86, 0.7)

  const hips = new THREE.Group()
  hips.position.y = 0.74

  const legGeo = new THREE.CapsuleGeometry(0.065, 0.22, 2, 6)
  const calfGeo = new THREE.CapsuleGeometry(0.05, 0.16, 2, 6)
  const armGeo = new THREE.CapsuleGeometry(0.048, 0.2, 2, 6)
  const leftLeg = limb(legGeo, shorts, -0.16)
  const rightLeg = limb(legGeo, shorts, -0.16)
  leftLeg.position.set(-0.09, 0, 0)
  rightLeg.position.set(0.09, 0, 0)
  const leftCalf = limb(calfGeo, skin, -0.16)
  const rightCalf = limb(calfGeo, skin, -0.16)
  leftCalf.position.y = -0.28
  rightCalf.position.y = -0.28
  leftLeg.add(leftCalf)
  rightLeg.add(rightCalf)
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.06, 8), accent)
  sock.position.y = -0.22
  const sock2 = sock.clone()
  leftCalf.add(sock)
  rightCalf.add(sock2)
  const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.2), shoe)
  shoeMesh.position.set(0, -0.4, 0.03)
  shoeMesh.castShadow = true
  leftCalf.add(shoeMesh)
  rightCalf.add(shoeMesh.clone())

  const leftArm = limb(armGeo, shirt, -0.16)
  const rightArm = limb(armGeo, shirt, -0.16)
  leftArm.position.set(-0.22, 0.26, 0)
  rightArm.position.set(0.22, 0.26, 0)
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin)
  hand.position.y = -0.3
  leftArm.add(hand)
  rightArm.add(hand.clone())

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 3, 8), shirt)
  torso.position.y = 0.2
  torso.castShadow = true
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.08), accent)
  stripe.position.set(0, 0.16, -0.12)
  const headPivot = new THREE.Group()
  headPivot.position.y = 0.48
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 12), skin)
  head.castShadow = true
  headPivot.add(head)
  const eye = (x: number) => {
    const g = new THREE.Group()
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), eyeWhite)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), pupil)
    dot.position.z = -0.028
    g.add(white, dot)
    g.position.set(x, 0.02, -0.15)
    return g
  }
  headPivot.add(eye(-0.062), eye(0.062))
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.01, 6, 10, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xc45b58, roughness: 0.6 }),
  )
  smile.position.set(0, -0.055, -0.155)
  smile.rotation.z = Math.PI
  headPivot.add(smile)
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), blush)
  cheek.position.set(-0.1, -0.02, -0.12)
  cheek.scale.z = 0.4
  const cheek2 = cheek.clone()
  cheek2.position.x = 0.1
  headPivot.add(cheek, cheek2)

  if (kid.hat) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), hair)
    cap.position.y = 0.05
    headPivot.add(cap)
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.028, 14), accent)
    brim.position.set(0, 0.12, -0.02)
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 10), accent)
    crown.position.y = 0.18
    headPivot.add(brim, crown)
  } else {
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), hair)
    bob.scale.set(1.08, 1.05, 0.78)
    bob.position.set(0, 0.04, 0.05)
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.06), hair)
    fringe.position.set(0, 0.1, -0.12)
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.04), accent)
    clip.position.set(0.14, 0.1, -0.06)
    headPivot.add(bob, fringe, clip)
  }

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.09), packMat)
  pack.position.set(0, 0.2, 0.15)
  pack.castShadow = true

  const cloth = new THREE.Group()
  const topW = kid.flight === 'wide' ? 0.22 : 0.08
  const botW = kid.flight === 'wide' ? 0.32 : 0.12
  cloth.add(panel(topW, botW * 0.7, 0.5, clothMat))
  const clothTip = new THREE.Group()
  clothTip.position.y = -0.5
  clothTip.add(panel(botW * 0.7, botW, kid.flight === 'wide' ? 0.42 : 0.62, clothMat))
  cloth.add(clothTip)
  cloth.position.set(kid.flight === 'dart' ? -0.2 : 0, 0.36, kid.flight === 'dart' ? -0.04 : 0.1)
  if (kid.flight === 'dart') cloth.rotation.z = 0.42

  hips.add(leftLeg, rightLeg, torso, stripe, headPivot, leftArm, rightArm, pack, cloth)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.035, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xe7c36a }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.04
  ring.visible = false

  return {
    hips,
    head: headPivot,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    cloth,
    clothTip,
    pack,
    ring,
  }
}

function mat(color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })
}

function limb(geo: THREE.BufferGeometry, material: THREE.Material, y: number): THREE.Group {
  const pivot = new THREE.Group()
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.y = y
  mesh.castShadow = true
  pivot.add(mesh)
  return pivot
}

function panel(top: number, bottom: number, length: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-top, 0, 0, top, 0, 0, -bottom, -length, 0.02, bottom, -length, 0.02]),
      3,
    ),
  )
  geo.setIndex([0, 2, 1, 1, 2, 3])
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  return mesh
}
