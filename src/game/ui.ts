import type { Quality } from './pipeline.ts'
import type { HallCredit } from './discover.ts'
import { isPlaceholderText } from './stories.ts'
import type { Road, StoryPerson, WaterFile, WeatherId } from './types.ts'
import type { Heightfield } from './height.ts'
import type { KidId } from './kids.ts'
import { ERAS, type EraId } from './eras.ts'
import type { StreetAtlas } from './streets.ts'

export class Hud {
  mapOpen = false
  debugOpen = false
  onPlay = () => {}
  onTitle = () => {}
  onTravel = (_x: number, _z: number, _name?: string) => {}
  onWeather = (_id: WeatherId | 'auto') => {}
  onSeason = () => {}
  onHour = (_h: number) => {}
  onTravelKind = (_kind: string) => {}
  private coached = false
  onRate = (_r: number) => {}
  onTeleport = (_id: string) => {}
  onBloom = (_on: boolean) => {}
  onQuality = (_quality: Quality) => {}
  onMute = () => {}
  onKid = (_id: KidId) => {}
  onHoverKid = (_id: KidId | null) => {}
  onPause = () => {}
  onPhoto = () => {}
  onEra = (_id: EraId) => {}
  onTour = () => {}
  onTrain = () => {}

  private roads: Road[] = []
  private atlas: StreetAtlas | null = null
  private water: WaterFile | null = null
  private minX = 0
  private maxX = 1
  private minZ = 0
  private maxZ = 1
  private mapFit = { ox: 0, oy: 0, scale: 1 }
  private readonly dev: boolean
  private pin: { x: number; z: number } | null = null
  private pinName = ''
  private mapZoom = 1
  private mapFocus: { x: number; z: number } | null = null
  private nibs: { ax: number; az: number; bx: number; bz: number; at: number }[] = []
  private stationTaps = 0
  private stationAt = 0
  private toastUntil = 0
  private cardTimer = 0
  private hereX = 0
  private hereZ = 0
  private miniSpan = 220
  private reveal: ((x: number, z: number) => boolean) | null = null
  private marks: { name: string; x: number; z: number }[] = []
  private seals: { name: string; x: number; z: number; found: boolean }[] = []

  constructor() {
    this.dev = new URLSearchParams(location.search).has('debug')
    const devTools = document.getElementById('dev-tools')
    if (devTools) devTools.hidden = !this.dev
    document.getElementById('play')?.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.onTitle()
    })
    document.getElementById('cast-go')?.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.onPlay()
    })
    document.getElementById('pause-btn')?.addEventListener('click', () => this.onPause())
    document.getElementById('photo-btn')?.addEventListener('click', () => this.onPhoto())
    document.getElementById('card')?.addEventListener('click', () => this.hideCard())
    document.getElementById('tab-places')?.addEventListener('click', () => this.showJournal('places'))
    document.getElementById('tab-hall')?.addEventListener('click', () => this.showJournal('hall'))
    document.querySelectorAll<HTMLButtonElement>('#cast [data-kid]').forEach((button) => {
      const id = (button.dataset.kid || 'milo') as KidId
      const face = button.querySelector('canvas')
      if (face instanceof HTMLCanvasElement) paintPortrait(face, id === 'juniper' ? 'juniper' : 'milo')
      button.addEventListener('click', () => this.onKid(id))
      button.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return
        this.onHoverKid(id)
      })
      button.addEventListener('pointerleave', () => this.onHoverKid(null))
    })
    document.getElementById('menu-btn')?.addEventListener('click', () => this.toggleMenu())
    document.getElementById('daybook-btn')?.addEventListener('click', () => {
      this.toggleMenu(false)
      this.toggleDebug()
    })
    document.getElementById('wheel-btn')?.addEventListener('click', () => this.toggleWheel())
    document.querySelectorAll<HTMLButtonElement>('#wheel [data-travel]').forEach((button) => {
      button.addEventListener('click', () => this.onTravelKind(button.dataset.travel || 'walk'))
    })
    document.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach((other) => other.classList.toggle('on', other === button))
        this.onHour(Number(button.dataset.hour || '14.67'))
      })
    })
    document.getElementById('mute')?.addEventListener('click', () => this.onMute())
    document.getElementById('map-btn')?.addEventListener('click', () => {
      this.toggleMenu(false)
      this.toggleMap()
    })
    document.getElementById('map-close')?.addEventListener('click', () => this.toggleMap(false))
    document.getElementById('mini')?.addEventListener('click', () => this.toggleMap(true))
    document.getElementById('travel')?.addEventListener('click', () => {
      if (this.pin) this.onTravel(this.pin.x, this.pin.z, this.pinName)
    })
    document.getElementById('tour')?.addEventListener('click', () => this.onTour())
    document.getElementById('open-travel')?.addEventListener('click', () => this.toggleMap(true))
    document.getElementById('season')?.addEventListener('click', () => this.onSeason())
    document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
      button.addEventListener('click', () => this.onQuality((button.dataset.quality || 'high') as Quality))
    })
    document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((other) => other.classList.toggle('on', other === button))
        this.onWeather((button.dataset.weather || 'auto') as WeatherId | 'auto')
      })
    })
    document.querySelectorAll<HTMLButtonElement>('[data-tp]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.tp === 'bart') this.noteStationTap()
        this.onTeleport(button.dataset.tp || 'downtown')
      })
    })
    document.getElementById('map-in')?.addEventListener('click', () => this.zoomMap(1.35))
    document.getElementById('map-out')?.addEventListener('click', () => this.zoomMap(1 / 1.35))
    const time = document.getElementById('time') as HTMLInputElement | null
    const scale = document.getElementById('tscale') as HTMLInputElement | null
    time?.addEventListener('input', () => this.onHour(Number(time.value)))
    scale?.addEventListener('input', () => this.onRate(Number(scale.value)))
    const bloom = document.getElementById('bloom') as HTMLInputElement | null
    bloom?.addEventListener('change', () => this.onBloom(bloom.checked))
    const eras = document.getElementById('era-list')
    if (eras) {
      eras.replaceChildren()
      eras.className = ''
      const dial = document.createElement('div')
      dial.id = 'era-dial'
      const face = document.createElement('div')
      face.className = 'dial-face'
      const hand = document.createElement('div')
      hand.className = 'dial-hand'
      hand.id = 'era-hand'
      const cap = document.createElement('div')
      cap.className = 'dial-cap'
      face.append(hand, cap)
      const step = 360 / ERAS.length
      ERAS.forEach((era, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'era-tick'
        button.dataset.era = era.id
        button.style.setProperty('--ang', `${index * step}deg`)
        button.title = era.playable ? era.label : era.note
        if (!era.playable) {
          button.classList.add('locked')
          const lock = document.createElement('span')
          lock.className = 'lock'
          lock.setAttribute('aria-hidden', 'true')
          button.append(lock)
        }
        const label = document.createElement('span')
        label.textContent = era.short
        button.append(label)
        button.addEventListener('click', () => this.onEra(era.id))
        face.append(button)
      })
      for (let i = 0; i < 12; i++) {
        const mark = document.createElement('span')
        mark.className = 'dial-mark'
        mark.style.setProperty('--ang', `${i * 30}deg`)
        face.append(mark)
      }
      const run = document.createElement('div')
      run.id = 'quail-run'
      run.hidden = true
      const pos = document.createElement('div')
      pos.className = 'quail-pos'
      const quailFace = document.createElement('div')
      quailFace.className = 'quail-face'
      const quail = document.createElement('canvas')
      quail.id = 'quail'
      quail.width = 42
      quail.height = 32
      paintQuail(quail)
      const say = document.createElement('p')
      say.className = 'quail-say'
      say.textContent = 'chi-ca-go'
      say.hidden = true
      quailFace.append(quail, say)
      pos.append(quailFace)
      const prints = document.createElement('div')
      prints.id = 'quail-prints'
      run.append(pos)
      face.append(prints, run)
      dial.append(face)
      eras.append(dial)
    }
    document.getElementById('daybook-close')?.addEventListener('click', () => this.toggleDebug(false))
    document.getElementById('place-card')?.addEventListener('click', () => {
      const name = document.getElementById('place')?.textContent ?? ''
      if (/station/i.test(name)) this.noteStationTap()
    })
    const cast = document.getElementById('cast')
    cast?.addEventListener('scroll', () => {
      const cue = document.getElementById('scroll-cue')
      if (!cue || !cast) return
      const remain = cast.scrollHeight - cast.scrollTop - cast.clientHeight
      cue.hidden = remain < 28
    })
    const mapc = document.getElementById('mapc') as HTMLCanvasElement | null
    mapc?.addEventListener('click', (event) => {
      const rect = mapc.getBoundingClientRect()
      const sx = ((event.clientX - rect.left) / rect.width) * mapc.width
      const sy = ((event.clientY - rect.top) / rect.height) * mapc.height
      const hit = this.pickOnMap(sx, sy)
      const travel = document.getElementById('travel') as HTMLButtonElement | null
      if (!hit) {
        this.pin = null
        this.pinName = ''
        if (travel) travel.disabled = true
      } else {
        this.pin = { x: hit.x, z: hit.z }
        this.pinName = hit.name
        if (travel) travel.disabled = false
      }
      this.paintMap()
    })
    mapc?.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        const rect = mapc.getBoundingClientRect()
        const sx = ((event.clientX - rect.left) / rect.width) * mapc.width
        const sy = ((event.clientY - rect.top) / rect.height) * mapc.height
        this.zoomMap(event.deltaY > 0 ? 1 / 1.18 : 1.18, sx, sy)
      },
      { passive: false },
    )
  }

  setMap(roads: Road[], water: WaterFile, height: Heightfield, atlas: StreetAtlas | null = null): void {
    this.roads = roads
    this.atlas = atlas
    this.water = water
    if (atlas && atlas.count > 0) {
      this.minX = atlas.minX
      this.maxX = atlas.maxX
      this.minZ = atlas.minZ
      this.maxZ = atlas.maxZ
    } else {
      this.minX = height.originX
      this.maxX = height.originX + height.sizeX
      this.minZ = height.originZ
      this.maxZ = height.originZ + height.sizeZ
    }
  }

  setStreetProgress(share: number): void {
    const el = document.getElementById('map-progress')
    const pct = share * 100
    const shown = pct > 0 && pct < 1 ? '<1' : String(Math.round(pct))
    const text = `${shown}% of streets walked`
    if (el && el.textContent !== text) el.textContent = text
  }

  stamp(name: string): void {
    const el = document.getElementById('street-stamp')
    if (!el) return
    el.hidden = false
    el.textContent = name
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
    window.setTimeout(() => {
      el.classList.remove('show')
      el.hidden = true
    }, 950)
  }

  loading(message: string | null): void {
    const el = document.getElementById('loading')
    const msg = document.getElementById('load-msg')
    if (msg && message) msg.textContent = message
    if (el) el.hidden = message == null
  }

  showTitle(): void {
    const title = document.getElementById('title')
    if (title) title.hidden = false
    this.hideCast()
  }

  openPicker(): void {
    const title = document.getElementById('title')
    if (title) title.hidden = true
    this.showCast('pick')
  }

  beginPlay(): void {
    const title = document.getElementById('title')
    const hud = document.getElementById('hud')
    if (title) title.hidden = true
    if (hud) hud.hidden = false
    this.hideCast()
  }

  showCast(mode: 'pick' | 'pause'): void {
    const cast = document.getElementById('cast')
    const go = document.getElementById('cast-go')
    const kicker = document.getElementById('cast-kicker')
    if (mode === 'pause') this.toggleMenu(false)
    if (cast) {
      cast.hidden = false
      cast.classList.toggle('is-pause', mode === 'pause')
      if (mode === 'pause') cast.scrollTop = 0
    }
    const cue = document.getElementById('scroll-cue')
    if (cue) cue.hidden = mode !== 'pause'
    if (go) {
      go.hidden = false
      go.textContent = mode === 'pause' ? 'Back to the boulevard' : 'Start downtown'
    }
    if (kicker) kicker.textContent = mode === 'pause' ? 'Swap ramblers' : 'Pick a rambler'
  }

  hideCast(): void {
    const cast = document.getElementById('cast')
    if (cast) cast.hidden = true
  }

  setKid(id: KidId): void {
    document.querySelectorAll<HTMLButtonElement>('#cast [data-kid]').forEach((button) => {
      const on = button.dataset.kid === id
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
    const who = document.getElementById('who')
    if (who) who.textContent = id === 'juniper' ? 'Juniper' : 'Milo'
  }

  toggleMap(force?: boolean): void {
    this.mapOpen = force ?? !this.mapOpen
    const map = document.getElementById('map')
    if (map) map.hidden = !this.mapOpen
    if (this.mapOpen) this.paintMap()
  }

  setRoam(
    reveal: (x: number, z: number) => boolean,
    marks: { name: string; x: number; z: number; line?: string }[],
    hall: HallCredit[] = [],
    seals: { name: string; x: number; z: number; found: boolean }[] = [],
  ): void {
    this.reveal = reveal
    this.marks = marks
    this.seals = seals
    this.setPlaceList(marks)
    this.setTravelList(marks)
    this.setHall(hall)
    if (this.mapOpen) this.paintMap()
  }

  private showJournal(which: 'places' | 'hall'): void {
    const places = document.getElementById('journal-places')
    const hall = document.getElementById('journal-hall')
    if (places) places.hidden = which !== 'places'
    if (hall) hall.hidden = which !== 'hall'
    for (const id of ['tab-places', 'tab-hall'] as const) {
      const button = document.getElementById(id)
      const on = (id === 'tab-places' && which === 'places') || (id === 'tab-hall' && which === 'hall')
      button?.classList.toggle('on', on)
      button?.setAttribute('aria-selected', on ? 'true' : 'false')
    }
  }

  private paintMap(): void {
    this.drawMap(this.hereX, this.hereZ, this.reveal ?? undefined, this.marks)
  }

  toggleDebug(force?: boolean): void {
    this.debugOpen = force ?? !this.debugOpen
    const el = document.getElementById('debug')
    if (el) el.hidden = !this.debugOpen
  }

  setHudHidden(hidden: boolean): void {
    const hud = document.getElementById('hud')
    if (hud) hud.hidden = hidden
  }

  setLetterbox(on: boolean): void {
    const el = document.getElementById('letterbox')
    if (el) el.hidden = !on
  }

  setEra(id: EraId, label: string): void {
    const index = Math.max(0, ERAS.findIndex((era) => era.id === id))
    const hand = document.getElementById('era-hand')
    hand?.style.setProperty('--hand', `${index * (360 / ERAS.length)}deg`)
    if (hand) {
      hand.classList.remove('snap')
      void hand.offsetWidth
      hand.classList.add('snap')
    }
    document.querySelectorAll<HTMLButtonElement>('.era-tick').forEach((button) => {
      const on = button.dataset.era === id
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
    const face = document.getElementById('era-face')
    if (face) face.textContent = label
    document.getElementById('era-grade')?.classList.toggle('on', id === 'fifties')
  }

  setEraVeil(year: number | null): void {
    const veil = document.getElementById('era-veil')
    const label = document.getElementById('era-year')
    if (label && year != null) label.textContent = String(year)
    veil?.classList.toggle('shut', year != null)
  }

  showStory(card: { kicker: string; title: string; history?: string; line?: string; now?: string; people?: StoryPerson[]; approximate?: boolean }): void {
    const root = document.getElementById('card')
    const kicker = document.getElementById('card-kicker')
    const title = document.getElementById('card-title')
    const history = document.getElementById('card-history')
    const approx = document.getElementById('card-approx')
    const flag = document.getElementById('card-flag')
    const credits = document.getElementById('card-credits')
    const people = document.getElementById('card-people')
    const line = document.getElementById('card-line')
    const now = document.getElementById('card-now')
    const folks = card.people ?? []
    const historyText = card.history ?? ''
    const nowText = card.now ?? ''
    if (kicker) kicker.textContent = card.kicker
    if (title) title.textContent = card.title
    if (history) {
      history.hidden = historyText.length === 0
      history.textContent = historyText
    }
    const placeholder =
      isPlaceholderText(historyText) ||
      isPlaceholderText(nowText) ||
      folks.some((person) => isPlaceholderText(`${person.name} ${person.role} ${person.contribution} ${person.source}`))
    if (flag) flag.hidden = !placeholder
    if (approx) approx.hidden = card.approximate !== true
    if (credits) credits.hidden = folks.length === 0
    if (people) {
      people.replaceChildren()
      for (const person of folks) {
        const item = document.createElement('li')
        const name = document.createElement('span')
        name.className = 'credit-name'
        name.textContent = person.name
        const role = document.createElement('span')
        role.className = 'credit-role'
        role.textContent = person.role
        const contribution = document.createElement('span')
        contribution.className = 'credit-contribution'
        contribution.textContent = person.contribution
        const source = document.createElement('span')
        source.className = 'credit-source'
        source.textContent = person.source
        item.append(name, role, contribution, source)
        people.append(item)
      }
    }
    if (now) {
      now.hidden = nowText.length === 0
      now.textContent = nowText
    }
    if (line) {
      line.hidden = !card.line
      line.textContent = card.line ?? ''
    }
    if (root) root.hidden = false
    const long = historyText.length + nowText.length
    this.cardTimer = folks.length > 0 ? Math.min(34, 12 + folks.length * 3.2) : long > 80 ? 16 : 8.4
  }

  hideCard(): void {
    const card = document.getElementById('card')
    if (card) card.hidden = true
  }

  setUseLabel(label: string | null): void {
    const button = document.getElementById('context-pill')
    if (!button) return
    button.hidden = !label
    if (label) button.textContent = label
  }

  setContext(label: string): void {
    const button = document.getElementById('context-btn')
    if (!button || button.textContent === label) return
    button.textContent = label
    button.classList.remove('spring')
    void button.offsetWidth
    button.classList.add('spring')
  }

  toggleMenu(force?: boolean): void {
    const sheet = document.getElementById('menu-sheet')
    if (!sheet) return
    sheet.hidden = force == null ? !sheet.hidden : !force
  }

  toggleWheel(force?: boolean): void {
    const wheel = document.getElementById('wheel')
    if (!wheel) return
    wheel.hidden = force == null ? !wheel.hidden : !force
  }

  poof(label: string): void {
    this.toast(`${label} appears beside you.`)
  }

  coachLine(touch: boolean): string {
    if (this.coached) return ''
    try {
      if (sessionStorage.getItem('ld-coach') === '1') {
        this.coached = true
        return ''
      }
    } catch {
      /* private mode */
    }
    return touch ? 'Hold to fly' : 'Hold Space to fly'
  }

  noteCoach(): void {
    this.coached = true
    try {
      sessionStorage.setItem('ld-coach', '1')
    } catch {
      /* private mode */
    }
  }

  setPhotoOffer(label: string | null): void {
    const button = document.getElementById('photo-btn') as HTMLButtonElement | null
    if (!button) return
    button.hidden = label == null
    if (label) button.textContent = label
  }

  setTour(on: boolean): void {
    const el = document.getElementById('tour')
    if (!el) return
    el.classList.toggle('on', on)
    el.textContent = on ? 'Tour on' : 'Tour'
  }

  private setTravelList(marks: { name: string; x: number; z: number }[]): void {
    const list = document.getElementById('travel-spots')
    if (!list) return
    list.replaceChildren()
    if (marks.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'travel-empty'
      const compass = document.createElement('span')
      compass.className = 'compass'
      compass.setAttribute('aria-hidden', 'true')
      empty.append(compass, document.createTextNode('Find a place on the boulevard to unlock Travel'))
      list.append(empty)
      return
    }
    for (const mark of marks) {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = mark.name
      button.addEventListener('click', () => this.onTravel(mark.x, mark.z, mark.name))
      li.append(button)
      list.append(li)
    }
  }

  setPlaceList(marks: { name: string; line?: string }[]): void {
    const list = document.getElementById('found-list')
    if (!list) return
    list.replaceChildren()
    if (marks.length === 0) {
      const empty = document.createElement('li')
      empty.textContent = 'Nothing pinned yet. Walk somewhere new.'
      list.append(empty)
      return
    }
    for (const mark of marks) {
      const li = document.createElement('li')
      const name = document.createElement('strong')
      name.textContent = mark.name
      li.append(name)
      if (mark.line) {
        const note = document.createElement('p')
        note.textContent = mark.line
        li.append(note)
      }
      list.append(li)
    }
  }

  setHall(credits: HallCredit[]): void {
    const list = document.getElementById('hall-list')
    const note = document.getElementById('hall-note')
    if (!list) return
    list.replaceChildren()
    if (credits.length === 0) {
      if (note) note.textContent = 'The hall is quiet. Visit a landmark and the people who helped build it are entered here.'
      return
    }
    const placeholder = credits.some((credit) =>
      isPlaceholderText(`${credit.name} ${credit.role} ${credit.contribution} ${credit.source}`),
    )
    if (note) {
      note.textContent = placeholder
        ? 'Stand-in names. Researched credits replace them when the Lafayette research files are in.'
        : 'People and organizations behind the places you have found.'
    }
    const groups = new Map<string, { credit: HallCredit; places: string[] }>()
    for (const credit of credits) {
      const key = `${credit.name}\n${credit.role}\n${credit.contribution}\n${credit.source}`
      const existing = groups.get(key)
      if (existing) {
        if (!existing.places.includes(credit.place)) existing.places.push(credit.place)
      } else groups.set(key, { credit, places: [credit.place] })
    }
    for (const { credit, places } of groups.values()) {
      const article = document.createElement('article')
      article.className = 'hall-person'
      const name = document.createElement('h4')
      name.textContent = credit.name
      const role = document.createElement('p')
      role.className = 'hall-role'
      role.textContent = credit.role
      const contribution = document.createElement('p')
      contribution.className = 'hall-contribution'
      contribution.textContent = credit.contribution
      const source = document.createElement('p')
      source.className = 'hall-source'
      source.textContent = credit.source
      const where = document.createElement('p')
      where.className = 'hall-places'
      where.textContent = places.join(' · ')
      article.append(name, role, contribution, source, where)
      list.append(article)
    }
  }

  showEase(): void {
    const note = document.getElementById('ease-note')
    if (note) note.hidden = false
  }

  waddleQuail(): void {
    const quail = document.getElementById('quail')
    const run = document.getElementById('quail-run')
    const pos = run?.querySelector('.quail-pos') as HTMLElement | null
    const quailFace = run?.querySelector('.quail-face') as HTMLElement | null
    const say = run?.querySelector('.quail-say') as HTMLElement | null
    const prints = document.getElementById('quail-prints')
    const hand = document.getElementById('era-hand')
    if (hand) {
      hand.classList.remove('spin')
      void hand.offsetWidth
      hand.classList.add('spin')
    }
    if (!quail || !run || !pos || !quailFace || !prints) return
    if (quailFrame) cancelAnimationFrame(quailFrame)
    quailFrame = 0
    prints.replaceChildren()
    run.hidden = false
    quail.classList.add('bob')
    if (say) say.hidden = false
    const hold = new URLSearchParams(location.search).get('egg') === 'quail'
    const place = (ang: number) => {
      pos.style.transform = `rotate(${ang}deg) translateY(-78px) rotate(${-ang}deg)`
      const faceRight = Math.cos((ang * Math.PI) / 180) >= 0
      quailFace.style.transform = faceRight ? 'scaleX(1)' : 'scaleX(-1)'
    }
    const drop = (ang: number, opacity: number) => {
      const dot = document.createElement('span')
      dot.className = 'quail-print'
      dot.style.opacity = String(opacity)
      dot.style.transform = `rotate(${ang}deg) translateY(-78px)`
      prints.append(dot)
      if (!hold) {
        const born = performance.now()
        const fade = () => {
          const t = (performance.now() - born) / 1400
          dot.style.opacity = String(Math.max(0, opacity * (1 - t)))
          if (t < 1) requestAnimationFrame(fade)
          else dot.remove()
        }
        requestAnimationFrame(fade)
      }
    }
    if (hold) {
      place(128)
      drop(108, 0.72)
      drop(90, 0.48)
      drop(72, 0.28)
      drop(54, 0.12)
      run.dataset.held = '1'
      return
    }
    delete run.dataset.held
    const started = performance.now()
    let lastDrop = -1
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 2800)
      const ang = -24 + t * 250
      place(ang)
      if (t - lastDrop > 0.08) {
        lastDrop = t
        drop(ang - 16, 0.7)
      }
      if (t < 1) quailFrame = requestAnimationFrame(step)
      else {
        quailFrame = 0
        run.hidden = true
        quail.classList.remove('bob')
        if (say) say.hidden = true
        prints.replaceChildren()
      }
    }
    quailFrame = requestAnimationFrame(step)
  }

  noteInk(ax: number, az: number, bx: number, bz: number): void {
    this.nibs.push({ ax, az, bx, bz, at: performance.now() })
    if (this.nibs.length > 6) this.nibs.shift()
  }

  toast(text: string, seconds = 5.2): void {
    const el = document.getElementById('toast')
    if (!el) return
    if (text.startsWith('Softened the picture')) {
      if (softToastShown) return
      try {
        if (sessionStorage.getItem('ld-soft-toast') === '1') {
          softToastShown = true
          return
        }
        sessionStorage.setItem('ld-soft-toast', '1')
      } catch {
        /* once this run */
      }
      softToastShown = true
    }
    el.textContent = text
    el.classList.add('show')
    el.classList.remove('hold')
    el.onclick = null
    this.toastUntil = performance.now() + seconds * 1000
  }

  /** Stays up until the click. Used when the picture cannot rebuild itself. */
  holdToast(text: string, onClick: () => void): void {
    const el = document.getElementById('toast')
    if (!el) return
    el.textContent = text
    el.classList.add('show', 'hold')
    this.toastUntil = 0
    el.onclick = () => onClick()
  }

  tickToast(dt: number, holdCard = false): void {
    const toast = document.getElementById('toast')
    if (this.toastUntil > 0 && !toast?.classList.contains('hold') && performance.now() >= this.toastUntil) {
      this.toastUntil = 0
      if (toast) {
        toast.classList.remove('show')
        toast.textContent = ''
      }
    }
    if (holdCard || this.cardTimer <= 0) return
    this.cardTimer -= dt
    if (this.cardTimer <= 0) this.hideCard()
  }

  setMuteLabel(muted: boolean): void {
    const el = document.getElementById('mute')
    if (el) el.textContent = muted ? 'Muted' : 'Sound'
  }

  setQualityLabel(quality: Quality): void {
    document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
      button.classList.toggle('on', button.dataset.quality === quality)
    })
  }

  setSeasonLabel(season: 'summer' | 'winter' | 'spring'): void {
    const el = document.getElementById('season')
    const next = season === 'summer' ? 'Winter hills' : season === 'winter' ? 'Spring hills' : 'Summer hills'
    if (el) el.textContent = next
  }

  update(state: {
    minutes: number
    weather: string
    place: string
    found: string
    prompt: string
    hint: string
    speed: string
    fps: string
    x: number
    z: number
    heading: number
    gems: string
    distance: string
    activity: string
    miniSpan: number
  }): void {
    const set = (id: string, text: string) => {
      const el = document.getElementById(id)
      if (el && el.textContent !== text) el.textContent = text
    }
    const h = Math.floor(state.minutes / 60)
    const m = Math.floor(state.minutes % 60)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hr = h % 12 || 12
    set('clock', `${hr}:${m.toString().padStart(2, '0')} ${ampm}`)
    set('weather', state.weather)
    const parts = state.place.split(' · ')
    set('place', parts[0] || state.place)
    set('era-pill', parts[1] || 'Today')
    set('found', state.found)
    set('prompt', state.prompt)
    set('hint', state.hint)
    set('speed', state.speed)
    if (this.dev) set('fps', state.fps)
    set('gems', state.gems)
    set('distance', state.distance)
    const activity = document.getElementById('activity')
    if (activity) {
      activity.hidden = state.activity.length === 0
      if (!activity.hidden && activity.textContent !== state.activity) activity.textContent = state.activity
    }
    this.hereX = state.x
    this.hereZ = state.z
    this.miniSpan = state.miniSpan
    this.drawMini(state.x, state.z, state.heading)
    if (this.mapOpen) this.paintMap()
  }

  /** Keep the you-are-here pulse moving while the sheet is open and the walk is paused. */
  track(x: number, z: number): void {
    this.hereX = x
    this.hereZ = z
    if (this.mapOpen) this.paintMap()
  }

  private layout(w: number, h: number): void {
    const pad = 24
    const spanX = Math.max(1, this.maxX - this.minX)
    const spanZ = Math.max(1, this.maxZ - this.minZ)
    const fit = Math.min(Math.max(1, w - pad * 2) / spanX, Math.max(1, h - pad * 2) / spanZ)
    if (this.mapZoom <= 1.02 || !this.mapFocus) {
      this.mapFit = { scale: fit, ox: (w - spanX * fit) / 2, oy: (h - spanZ * fit) / 2 }
      return
    }
    const scale = fit * this.mapZoom
    this.mapFit = {
      scale,
      ox: w / 2 - (this.mapFocus.x - this.minX) * scale,
      oy: h / 2 - (this.mapFocus.z - this.minZ) * scale,
    }
  }

  private zoomMap(factor: number, sx?: number, sy?: number): void {
    const next = Math.min(8, Math.max(1, this.mapZoom * factor))
    const canvas = document.getElementById('mapc') as HTMLCanvasElement | null
    const w = canvas?.width || 2
    const h = canvas?.height || 2
    const old = this.mapFit.scale || 1
    const wx = sx != null ? this.minX + (sx - this.mapFit.ox) / old : (this.mapFocus?.x ?? this.hereX)
    const wz = sy != null ? this.minZ + (sy - this.mapFit.oy) / old : (this.mapFocus?.z ?? this.hereZ)
    this.mapZoom = next
    if (next <= 1.02) {
      this.mapFocus = null
      this.paintMap()
      return
    }
    const pad = 24
    const spanX = Math.max(1, this.maxX - this.minX)
    const spanZ = Math.max(1, this.maxZ - this.minZ)
    const fit = Math.min(Math.max(1, w - pad * 2) / spanX, Math.max(1, h - pad * 2) / spanZ)
    const scale = fit * next
    if (sx != null && sy != null) {
      this.mapFocus = { x: wx + (w / 2 - sx) / scale, z: wz + (h / 2 - sy) / scale }
    } else {
      this.mapFocus = { x: wx, z: wz }
    }
    this.paintMap()
  }

  private noteStationTap(): void {
    const now = performance.now()
    if (now - this.stationAt > 4000) this.stationTaps = 0
    this.stationAt = now
    this.stationTaps += 1
    if (this.stationTaps >= 5) {
      this.stationTaps = 0
      this.onTrain()
    }
  }

  private pickOnMap(sx: number, sy: number): { x: number; z: number; name: string } | null {
    let best: { x: number; z: number; name: string; d: number } | null = null
    for (const seal of this.seals) {
      if (!seal.found) continue
      const [px, py] = this.project(seal.x, seal.z)
      const d = Math.hypot(px - sx, py - sy)
      if (d < 18 && (!best || d < best.d)) best = { x: seal.x, z: seal.z, name: seal.name, d }
    }
    if (best) return best
    const atlas = this.atlas
    if (!atlas) return null
    const scale = this.mapFit.scale || 1
    for (let i = 0; i < atlas.count; i++) {
      const seg = atlas.segment(i)
      const [ax, ay] = this.project(seg.ax, seg.az)
      const [bx, by] = this.project(seg.bx, seg.bz)
      const hit = segHit(sx, sy, ax, ay, bx, by)
      if (hit.d > 16 || (best && hit.d >= best.d)) continue
      best = {
        x: this.minX + (hit.x - this.mapFit.ox) / scale,
        z: this.minZ + (hit.y - this.mapFit.oy) / scale,
        name: atlas.nameOf(i) || 'Selected street',
        d: hit.d,
      }
    }
    return best
  }

  private project(x: number, z: number): [number, number] {
    return [this.mapFit.ox + (x - this.minX) * this.mapFit.scale, this.mapFit.oy + (z - this.minZ) * this.mapFit.scale]
  }

  private drawRoads(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    near: { x: number; z: number; span: number } | null,
    reveal: ((x: number, z: number) => boolean) | null,
  ): void {
    for (const road of this.roads) {
      ctx.beginPath()
      let started = false
      const n = road.p.length / 3
      for (let i = 0; i < n; i++) {
        const x = road.p[i * 3]
        const z = road.p[i * 3 + 1]
        if (near && Math.hypot(x - near.x, z - near.z) > near.span) {
          started = false
          continue
        }
        if (reveal && i > 0) {
          const px = road.p[(i - 1) * 3]
          const pz = road.p[(i - 1) * 3 + 1]
          if (!reveal(x, z) && !reveal(px, pz)) {
            started = false
            continue
          }
        }
        const pt = near
          ? [w / 2 + ((x - near.x) / near.span) * (w / 2), h / 2 + ((z - near.z) / near.span) * (h / 2)]
          : this.project(x, z)
        if (!started) {
          ctx.moveTo(pt[0], pt[1])
          started = true
        } else ctx.lineTo(pt[0], pt[1])
      }
      ctx.strokeStyle = road.d ? '#b08968' : road.w >= 9 ? '#2c3340' : '#5c6570'
      ctx.lineWidth = road.d ? 1.4 : Math.max(1, road.w / 8)
      ctx.stroke()
    }
  }

  drawMini(x: number, z: number, heading: number): void {
    const canvas = document.getElementById('mini') as HTMLCanvasElement | null
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const span = this.miniSpan
    ctx.clearRect(0, 0, w, h)
    ctx.save()
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#f4efe4'
    ctx.fillRect(0, 0, w, h)
    if (this.water) {
      ctx.fillStyle = '#7eb8b8'
      for (const body of this.water.bodies) {
        ctx.beginPath()
        const n = body.p.length / 2
        for (let i = 0; i < n; i++) {
          const px = w / 2 + ((body.p[i * 2] - x) / span) * (w / 2)
          const py = h / 2 + ((body.p[i * 2 + 1] - z) / span) * (h / 2)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.fill()
      }
    }
    this.drawRoads(ctx, w, h, { x, z, span }, null)
    const now = performance.now()
    this.nibs = this.nibs.filter((nib) => now - nib.at < 700)
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1c2430'
    ctx.fillStyle = '#1c2430'
    ctx.lineWidth = 2.4
    for (const nib of this.nibs) {
      const u = Math.min(1, (now - nib.at) / 420)
      const ax = w / 2 + ((nib.ax - x) / span) * (w / 2)
      const ay = h / 2 + ((nib.az - z) / span) * (h / 2)
      const bx = w / 2 + ((nib.bx - x) / span) * (w / 2)
      const by = h / 2 + ((nib.bz - z) / span) * (h / 2)
      const ex = ax + (bx - ax) * u
      const ey = ay + (by - ay) * u
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(ex, ey, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(-heading)
    ctx.fillStyle = '#d64545'
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5, 6)
    ctx.lineTo(-5, 6)
    ctx.fill()
    ctx.restore()
    ctx.restore()
  }

  drawMap(
    px?: number,
    pz?: number,
    _reveal?: (x: number, z: number) => boolean,
    _pins?: { name: string; x: number; z: number }[],
  ): void {
    const canvas = document.getElementById('mapc') as HTMLCanvasElement | null
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(2, Math.floor(rect.width))
    canvas.height = Math.max(2, Math.floor(rect.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    this.layout(canvas.width, canvas.height)
    ctx.fillStyle = '#f6f1e6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (this.water) {
      ctx.fillStyle = 'rgba(143, 208, 207, 0.85)'
      for (const body of this.water.bodies) {
        ctx.beginPath()
        const n = body.p.length / 2
        for (let i = 0; i < n; i++) {
          const [sx, sy] = this.project(body.p[i * 2], body.p[i * 2 + 1])
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.fill()
      }
    }
    const now = performance.now()
    if (this.atlas) this.drawAtlas(ctx, now)
    else this.drawRoads(ctx, canvas.width, canvas.height, null, null)
    const pins = this.seals.length ? this.seals : this.marks.map((mark) => ({ ...mark, found: true }))
    const colors = ['#2f5d34', '#1d4e89', '#9e2430', '#b8924a', '#7a4a36']
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 12px Outfit, sans-serif'
    const unfound = pins.filter((pin) => !pin.found)
    const cluster = this.mapZoom < 2.2
    const drawn = new Set<number>()
    if (cluster) {
      unfound.forEach((pin, index) => {
        if (drawn.has(index)) return
        const [sx, sy] = this.project(pin.x, pin.z)
        const group = [index]
        for (let other = index + 1; other < unfound.length; other++) {
          if (drawn.has(other)) continue
          const [ox, oy] = this.project(unfound[other].x, unfound[other].z)
          if (Math.hypot(ox - sx, oy - sy) < 28) group.push(other)
        }
        for (const item of group) drawn.add(item)
        let cx = 0
        let cy = 0
        for (const item of group) {
          const [gx, gy] = this.project(unfound[item].x, unfound[item].z)
          cx += gx
          cy += gy
        }
        cx /= group.length
        cy /= group.length
        this.drawSeal(ctx, cx, cy, group.length === 1 ? '?' : `?${group.length}`)
      })
    } else {
      for (const pin of unfound) {
        const [sx, sy] = this.project(pin.x, pin.z)
        this.drawSeal(ctx, sx, sy, '?')
      }
    }
    pins.forEach((pin, index) => {
      if (!pin.found) return
      const [sx, sy] = this.project(pin.x, pin.z)
      ctx.fillStyle = colors[index % colors.length]
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.textAlign = 'left'
      ctx.fillText(pin.name, sx + 8, sy + 4)
      ctx.textAlign = 'center'
    })
    if (px != null && pz != null) {
      const [sx, sy] = this.project(px, pz)
      const pulse = (Math.sin(now / 320) + 1) / 2
      ctx.beginPath()
      ctx.arc(sx, sy, 8 + pulse * 7, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(214, 69, 69, ${0.28 + (1 - pulse) * 0.45})`
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#d64545'
      ctx.beginPath()
      ctx.arc(sx, sy, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    if (this.pin) {
      const [sx, sy] = this.project(this.pin.x, this.pin.z)
      ctx.fillStyle = '#9e2430'
      ctx.beginPath()
      ctx.arc(sx, sy - 16, 7, Math.PI * 0.15, Math.PI * 0.85, true)
      ctx.lineTo(sx, sy)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#f7f3ea'
      ctx.beginPath()
      ctx.arc(sx, sy - 16, 2.5, 0, Math.PI * 2)
      ctx.fill()
      if (this.pinName) {
        ctx.font = '700 13px Outfit, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = '#1c2430'
        ctx.fillText(this.pinName, sx, sy - 30)
      }
    }
  }

  private drawSeal(ctx: CanvasRenderingContext2D, sx: number, sy: number, label: string): void {
    ctx.save()
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = '#2a3340'
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.arc(sx, sy, label.length > 2 ? 13 : 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#2a3340'
    ctx.fillText(label, sx, sy + 0.5)
  }

  private drawAtlas(ctx: CanvasRenderingContext2D, now: number): void {
    const atlas = this.atlas
    if (!atlas) return
    ctx.beginPath()
    for (let i = 0; i < atlas.count; i++) {
      const seg = atlas.segment(i)
      const [ax, ay] = this.project(seg.ax, seg.az)
      const [bx, by] = this.project(seg.bx, seg.bz)
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#d6cdbd'
    ctx.lineWidth = 1.25
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#2a3340'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    let inked = false
    for (let i = 0; i < atlas.count; i++) {
      const t = atlas.ink(i, now)
      if (t <= 0) continue
      const seg = atlas.segment(i)
      const [ax, ay] = this.project(seg.ax, seg.az)
      const [bx, by] = this.project(seg.bx, seg.bz)
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t)
      inked = true
    }
    if (inked) ctx.stroke()
  }
}

let softToastShown = false
let quailFrame = 0

function segHit(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; x: number; y: number } {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 < 0.01) return { d: Math.hypot(px - ax, py - ay), x: ax, y: ay }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  const x = ax + dx * t
  const y = ay + dy * t
  return { d: Math.hypot(px - x, py - y), x, y }
}

function paintPortrait(canvas: HTMLCanvasElement, who: 'milo' | 'juniper'): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const w = canvas.width
  const h = canvas.height
  g.fillStyle = '#efe6d4'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#d7cbb8'
  g.fillRect(0, h - 16, w, 16)
  const skin = who === 'milo' ? '#f0c2a0' : '#c68658'
  const hair = who === 'milo' ? '#3a2418' : '#1a1216'
  const shirt = who === 'milo' ? '#e25b2a' : '#178a86'
  const shorts = who === 'milo' ? '#243656' : '#f0c43a'
  const cx = w / 2
  g.fillStyle = skin
  g.fillRect(cx - 14, 78, 10, 16)
  g.fillRect(cx + 4, 78, 10, 16)
  g.fillStyle = shorts
  g.fillRect(cx - 16, 60, 32, 22)
  g.fillStyle = shirt
  g.fillRect(cx - 18, 36, 36, 28)
  g.fillStyle = skin
  g.beginPath()
  g.arc(cx, 24, 14, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = hair
  g.beginPath()
  g.arc(cx, 20, 14, Math.PI * 1.05, Math.PI * 1.95)
  g.fill()
  if (who === 'milo') {
    g.fillStyle = '#c4343c'
    g.fillRect(cx - 16, 6, 32, 6)
    g.fillRect(cx - 8, 0, 16, 8)
  } else {
    g.fillStyle = hair
    g.fillRect(cx + 6, 18, 8, 20)
  }
  g.fillStyle = '#1c2430'
  g.fillRect(cx - 7, 22, 3, 3)
  g.fillRect(cx + 4, 22, 3, 3)
}

function paintQuail(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d')
  if (!g) return
  g.imageSmoothingEnabled = false
  const pix = (x: number, y: number, color: string) => {
    g.fillStyle = color
    g.fillRect(x, y, 1, 1)
  }
  const body = '#8d8f86'
  const belly = '#e4d2b0'
  const ink = '#1c2430'
  const cream = '#f4f1ea'
  // Plump body, facing right. Feet sit on the bottom row.
  for (let y = 14; y <= 24; y++) {
    for (let x = 8; x <= 28; x++) {
      const dx = (x - 18) / 11
      const dy = (y - 19) / 6
      if (dx * dx + dy * dy <= 1) pix(x, y, y > 21 ? belly : body)
    }
  }
  for (let y = 12; y <= 18; y++) {
    for (let x = 24; x <= 32; x++) {
      const dx = (x - 27) / 6
      const dy = (y - 15) / 4
      if (dx * dx + dy * dy <= 1) pix(x, y, body)
    }
  }
  // Black face and a white cheek stripe.
  for (let x = 29; x <= 33; x++) pix(x, 14, ink)
  pix(30, 13, ink)
  pix(31, 13, ink)
  pix(32, 13, ink)
  pix(33, 14, ink)
  pix(34, 15, ink)
  pix(28, 15, cream)
  pix(28, 16, cream)
  pix(29, 15, cream)
  // Beak.
  pix(34, 16, '#c4a574')
  pix(35, 16, '#c4a574')
  pix(35, 17, '#c4a574')
  // Eye.
  pix(31, 14, cream)
  pix(32, 14, ink)
  // Curled black topknot, forward over the beak.
  const plume = [
    [27, 12], [28, 11], [29, 10], [30, 9], [31, 8], [32, 7], [33, 6], [34, 6], [35, 7], [35, 8], [34, 9], [33, 10], [32, 11],
  ]
  for (const [x, y] of plume) pix(x, y, ink)
  pix(31, 8, ink)
  pix(33, 7, ink)
  // Scale flecks on the belly.
  pix(16, 22, ink)
  pix(19, 23, ink)
  pix(22, 22, ink)
  pix(14, 21, '#6e6258')
  // Two feet.
  pix(14, 26, '#c4a574')
  pix(15, 27, '#c4a574')
  pix(16, 27, '#c4a574')
  pix(22, 26, '#c4a574')
  pix(23, 27, '#c4a574')
  pix(24, 27, '#c4a574')
}
