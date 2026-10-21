export class Input {
  moveX = 0
  moveY = 0
  throttle = 0
  steer = 0
  sprint = false
  handbrake = false
  ascend = 0
  lookX = 0
  lookY = 0
  zoom = 0
  jumpEdge = false
  flyEdge = false
  useEdge = false
  hornEdge = false
  mapEdge = false
  camEdge = false
  debugEdge = false
  hudEdge = false
  pauseEdge = false
  confirmEdge = false
  photoEdge = false
  flyHoldEdge = false
  wheelEdge = false
  /** One-shot travel pick: walk, bike, car, heli, fly, drone. */
  travel = ''
  usingTouch = false
  pointerLocked = false
  /** Title and pause keep the pointer free so the cast can be clicked. */
  allowLock = false
  /** Play shows the on-screen controls. Title, loading, and pause keep them off. */
  private touchWanted = false
  private touchRoot: HTMLElement | null = null

  private keys = new Set<string>()
  private jumpHeld = false
  private flyHeld = false
  private useHeld = false
  private hornHeld = false
  private mapHeld = false
  private camHeld = false
  private debugHeld = false
  private hudHeld = false
  private pauseHeld = false
  private confirmHeld = false
  private photoHeld = false
  private wheelHeld = false
  private spaceDownAt = 0
  private flyHoldSent = false
  private stickId = -1
  private lookId = -1
  private stickX = 0
  private stickY = 0
  private btn = new Set<string>()

  private view: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.view = canvas
    const typing = (e: Event) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA'
    }
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return
      this.keys.add(e.code)
      const pick = ({ Digit1: 'walk', Digit2: 'bike', Digit3: 'car', Digit4: 'heli', Digit5: 'fly', Digit6: 'drone' } as Record<string, string>)[e.code]
      if (pick && !e.repeat) this.queuedTravel = pick
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
    this.bindView(canvas)
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.view
    })
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || e.buttons === 2) {
        this.lookX += e.movementX
        this.lookY += e.movementY
      }
    })
    window.addEventListener('wheel', (e) => {
      this.zoom += e.deltaY
    }, { passive: true })

    const stick = document.getElementById('stick')
    const knob = document.getElementById('knob')
    const look = document.getElementById('lookpad')
    this.touchRoot = document.getElementById('touch')
    const armTouch = () => {
      this.usingTouch = true
      this.applyTouch()
    }
    if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) armTouch()
    const leftSide = (x: number) => x <= window.innerWidth * 0.5
    const onControl = (target: EventTarget | null) => (target as HTMLElement | null)?.closest?.('button, a, input')
    const takeStick = (id: number, x: number, y: number) => {
      if (!stick || !this.touchWanted || !leftSide(x) || this.stickId >= 0 && this.stickId !== id) return
      this.stickId = id
      this.moveStickAt(x, y, stick, knob)
    }
    window.addEventListener('touchstart', (e) => {
      armTouch()
      const t = e.changedTouches[0]
      if (!t || onControl(e.target)) return
      if (!leftSide(t.clientX) || !this.touchWanted) return
      takeStick(t.identifier, t.clientX, t.clientY)
    }, { passive: false })
    window.addEventListener('touchmove', (e) => {
      if (!stick || this.stickId < 0) return
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId || leftSide(t.clientX)) this.moveStickAt(t.clientX, t.clientY, stick, knob)
      }
    }, { passive: false })
    const endStick = (e: TouchEvent) => {
      let held = false
      for (const t of e.touches) if (leftSide(t.clientX)) held = true
      if (!held) this.releaseStick(knob)
    }
    window.addEventListener('touchend', endStick)
    window.addEventListener('touchcancel', endStick)

    const pointerStick = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !stick || onControl(e.target)) return
      armTouch()
      if (e.type === 'pointerdown') {
        if (!this.touchWanted || !leftSide(e.clientX)) return
        this.stickId = e.pointerId
        try {
          stick.setPointerCapture?.(e.pointerId)
        } catch {
          // The pointer started on the road, not the stick. Window moves still track it.
        }
        this.moveStickAt(e.clientX, e.clientY, stick, knob)
      } else if (e.pointerId === this.stickId) {
        this.moveStickAt(e.clientX, e.clientY, stick, knob)
      }
    }
    window.addEventListener('pointerdown', pointerStick)
    window.addEventListener('pointermove', pointerStick)
    window.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.stickId) this.releaseStick(knob)
    })
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.stickId) this.releaseStick(knob)
    })

    look?.addEventListener('touchstart', (e) => {
      this.lookId = e.changedTouches[0].identifier
    }, { passive: true })
    look?.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookId) {
          this.lookX += t.clientX - (this.prevLookX || t.clientX)
          this.lookY += t.clientY - (this.prevLookY || t.clientY)
          this.prevLookX = t.clientX
          this.prevLookY = t.clientY
        }
      }
    }, { passive: true })
    const endLook = (e: TouchEvent) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookId) {
          this.lookId = -1
          this.prevLookX = 0
          this.prevLookY = 0
        }
      }
    }
    look?.addEventListener('touchend', endLook)
    look?.addEventListener('touchcancel', endLook)

    this.applyTouch()

    document.querySelectorAll<HTMLButtonElement>('#touch [data-act]').forEach((button) => {
      const act = button.dataset.act || ''
      const down = (e: Event) => {
        this.btn.add(act)
        e.preventDefault()
      }
      const up = () => this.btn.delete(act)
      button.addEventListener('touchstart', down, { passive: false })
      button.addEventListener('touchend', up)
      button.addEventListener('pointerdown', down)
      button.addEventListener('pointerup', up)
      button.addEventListener('pointerleave', up)
    })
  }

  /** The picture swaps the canvas node after a device loss. Listen on the new one. */
  retarget(canvas: HTMLCanvasElement): void {
    this.view = canvas
    this.bindView(canvas)
  }

  private bindView(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('click', () => {
      if (this.usingTouch || !this.allowLock) return
      if (navigator.webdriver) return
      const lock = canvas.requestPointerLock?.()
      if (lock && typeof (lock as Promise<void>).catch === 'function') void (lock as Promise<void>).catch(() => {})
    })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private prevLookX = 0
  private prevLookY = 0

  private releaseStick(knob: HTMLElement | null): void {
    this.stickId = -1
    this.stickX = 0
    this.stickY = 0
    if (knob) knob.style.transform = 'translate(-50%, -50%)'
  }

  private moveStickAt(clientX: number, clientY: number, stick: HTMLElement, knob: HTMLElement | null): void {
    const rect = stick.getBoundingClientRect()
    const max = rect.width * 0.36
    if (!(max > 8)) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = clientX - cx
    let dy = clientY - cy
    const len = Math.hypot(dx, dy)
    if (len > max && len > 0) {
      dx = (dx / len) * max
      dy = (dy / len) * max
    }
    this.stickX = dx / max
    this.stickY = dy / max
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  private down(code: string): boolean {
    return this.keys.has(code)
  }

  private edge(held: boolean, code: boolean): boolean {
    return code && !held
  }

  update(): void {
    const pad = navigator.getGamepads?.()[0] ?? null
    const ax = (i: number) => (pad && Math.abs(pad.axes[i] || 0) > 0.18 ? pad.axes[i] : 0)
    const btn = (i: number) => (pad ? (pad.buttons[i]?.pressed ?? false) : false)
    const trigger = (i: number) => (pad ? (pad.buttons[i]?.value ?? 0) : 0)

    let mx = 0
    let my = 0
    if (this.down('KeyA') || this.down('ArrowLeft')) mx -= 1
    if (this.down('KeyD') || this.down('ArrowRight')) mx += 1
    if (this.down('KeyW') || this.down('ArrowUp')) my += 1
    if (this.down('KeyS') || this.down('ArrowDown')) my -= 1
    mx += this.stickX + ax(0)
    my += -this.stickY - ax(1)
    const mag = Math.hypot(mx, my)
    if (mag > 1) {
      mx /= mag
      my /= mag
    }
    this.moveX = mx
    this.moveY = my
    this.steer = Math.max(-1, Math.min(1, mx))
    this.throttle = Math.max(-1, Math.min(1, my))
    const rt = trigger(7)
    const lt = trigger(6)
    if (rt > 0.05) this.throttle = Math.max(this.throttle, rt)
    if (lt > 0.05) this.throttle = Math.min(this.throttle, -lt)

    const deflected = Math.hypot(this.stickX, this.stickY) > 0.86
    this.sprint = this.down('ShiftLeft') || this.down('ShiftRight') || btn(7) || this.btn.has('run') || deflected
    this.handbrake = this.down('Space') || btn(0) || this.btn.has('jump')
    let ascend = 0
    if (this.down('Space') || btn(0) || this.btn.has('jump')) ascend += 1
    if (this.down('ControlLeft') || this.down('ControlRight') || btn(6) || this.btn.has('down')) ascend -= 1
    this.ascend = Math.max(-1, Math.min(1, ascend))

    this.lookX += ax(2) * 28
    this.lookY += ax(3) * 18

    const jumpNow = this.down('Space') || btn(0) || this.btn.has('jump')
    const flyNow = this.down('KeyF') || this.btn.has('fly')
    const useNow = this.down('KeyE') || btn(2) || this.btn.has('use')
    const hornNow = this.down('KeyH') || btn(1) || this.btn.has('horn')
    const mapNow = this.down('KeyM') || btn(3) || this.btn.has('map')
    const camNow = this.down('KeyC') || btn(5) || this.btn.has('cam')
    const debugNow = this.down('F3')
    const hudNow = this.down('KeyP')
    const pauseNow = this.down('Escape')
    const confirmNow = this.down('Enter')
    const photoNow = this.down('KeyV') || this.btn.has('photo')
    const wheelNow = this.down('Tab')
    const nowMs = performance.now()
    if (jumpNow && !this.jumpHeld) {
      this.spaceDownAt = nowMs
      this.flyHoldSent = false
    }
    this.flyHoldEdge = jumpNow && !this.flyHoldSent && nowMs - this.spaceDownAt > 280
    if (this.flyHoldEdge) this.flyHoldSent = true
    const picks: [string, string][] = [
      ['Digit1', 'walk'],
      ['Digit2', 'bike'],
      ['Digit3', 'car'],
      ['Digit4', 'heli'],
      ['Digit5', 'fly'],
      ['Digit6', 'drone'],
    ]
    this.travel = this.queuedTravel
    this.queuedTravel = ''
    for (const [code, kind] of picks) {
      if (this.edge(this.keysTravel.has(code), this.down(code))) this.travel = kind
    }
    for (const [code] of picks) {
      if (this.down(code)) this.keysTravel.add(code)
      else this.keysTravel.delete(code)
    }
    this.jumpEdge = this.edge(this.jumpHeld, jumpNow)
    this.flyEdge = this.edge(this.flyHeld, flyNow)
    this.useEdge = this.edge(this.useHeld, useNow)
    this.hornEdge = this.edge(this.hornHeld, hornNow)
    this.mapEdge = this.edge(this.mapHeld, mapNow)
    this.camEdge = this.edge(this.camHeld, camNow)
    this.debugEdge = this.edge(this.debugHeld, debugNow)
    this.hudEdge = this.edge(this.hudHeld, hudNow)
    this.pauseEdge = this.edge(this.pauseHeld, pauseNow)
    this.confirmEdge = this.edge(this.confirmHeld, confirmNow)
    this.photoEdge = this.edge(this.photoHeld, photoNow)
    this.wheelEdge = this.edge(this.wheelHeld, wheelNow)
    this.wheelHeld = wheelNow
    this.jumpHeld = jumpNow
    this.flyHeld = flyNow
    this.useHeld = useNow
    this.hornHeld = hornNow
    this.mapHeld = mapNow
    this.camHeld = camNow
    this.debugHeld = debugNow
    this.hudHeld = hudNow
    this.pauseHeld = pauseNow
    this.confirmHeld = confirmNow
    this.photoHeld = photoNow
  }

  private keysTravel = new Set<string>()
  private queuedTravel = ''

  /** Travel-wheel buttons call this. Read on the next update. */
  pickTravel(kind: string): void {
    this.queuedTravel = kind
  }

  /** Show the stick and buttons only while playing on a touch device. */
  setTouchVisible(on: boolean): void {
    this.touchWanted = on
    this.applyTouch()
  }

  private applyTouch(): void {
    if (!this.touchRoot) return
    this.touchRoot.hidden = !(this.touchWanted && this.usingTouch)
  }

  endFrame(): void {
    this.lookX = 0
    this.lookY = 0
    this.zoom = 0
    this.jumpEdge = false
    this.flyEdge = false
    this.useEdge = false
    this.hornEdge = false
    this.mapEdge = false
    this.camEdge = false
    this.debugEdge = false
    this.hudEdge = false
    this.pauseEdge = false
    this.confirmEdge = false
    this.photoEdge = false
    this.flyHoldEdge = false
    this.wheelEdge = false
    this.travel = ''
  }
}
