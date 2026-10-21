import type { Quality } from './pipeline.ts'
import type { HallCredit } from './discover.ts'
import { isPlaceholderText } from './stories.ts'
import type { Road, StoryPerson, WaterFile, WeatherId } from './types.ts'
import type { Heightfield } from './height.ts'
import type { KidId } from './kids.ts'
import { ERAS, type EraId } from './eras.ts'

export class Hud {
  mapOpen = false
  debugOpen = false
  onPlay = () => {}
  onTitle = () => {}
  onTravel = (_x: number, _z: number) => {}
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

  private roads: Road[] = []
  private water: WaterFile | null = null
  private minX = 0
  private maxX = 1
  private minZ = 0
  private maxZ = 1
  private pin: { x: number; z: number } | null = null
  private toastTimer = 0
  private cardTimer = 0
  private hereX = 0
  private hereZ = 0
  private miniSpan = 220
  private reveal: ((x: number, z: number) => boolean) | null = null
  private marks: { name: string; x: number; z: number }[] = []

  constructor() {
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
      button.addEventListener('click', () => this.onHour(Number(button.dataset.hour || '14.67')))
    })
    document.getElementById('mute')?.addEventListener('click', () => this.onMute())
    document.getElementById('map-btn')?.addEventListener('click', () => {
      this.toggleMenu(false)
      this.toggleMap()
    })
    document.getElementById('map-close')?.addEventListener('click', () => this.toggleMap(false))
    document.getElementById('mini')?.addEventListener('click', () => this.toggleMap(true))
    document.getElementById('travel')?.addEventListener('click', () => {
      if (this.pin) this.onTravel(this.pin.x, this.pin.z)
    })
    document.getElementById('tour')?.addEventListener('click', () => this.onTour())
    document.getElementById('open-travel')?.addEventListener('click', () => this.toggleMap(true))
    document.getElementById('season')?.addEventListener('click', () => this.onSeason())
    document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
      button.addEventListener('click', () => this.onQuality((button.dataset.quality || 'high') as Quality))
    })
    document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((button) => {
      button.addEventListener('click', () => this.onWeather((button.dataset.weather || 'auto') as WeatherId | 'auto'))
    })
    document.querySelectorAll<HTMLButtonElement>('[data-tp]').forEach((button) => {
      button.addEventListener('click', () => this.onTeleport(button.dataset.tp || 'downtown'))
    })
    const time = document.getElementById('time') as HTMLInputElement | null
    const scale = document.getElementById('tscale') as HTMLInputElement | null
    time?.addEventListener('input', () => this.onHour(Number(time.value)))
    scale?.addEventListener('input', () => this.onRate(Number(scale.value)))
    const bloom = document.getElementById('bloom') as HTMLInputElement | null
    bloom?.addEventListener('change', () => this.onBloom(bloom.checked))
    const eras = document.getElementById('era-list')
    for (const era of ERAS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'era-chip'
      button.dataset.era = era.id
      button.textContent = era.short
      button.title = era.playable ? era.label : era.note
      if (!era.playable) button.classList.add('locked')
      button.addEventListener('click', () => this.onEra(era.id))
      eras?.append(button)
    }
    const mapc = document.getElementById('mapc') as HTMLCanvasElement | null
    mapc?.addEventListener('click', (event) => {
      const rect = mapc.getBoundingClientRect()
      const u = (event.clientX - rect.left) / rect.width
      const v = (event.clientY - rect.top) / rect.height
      this.pin = { x: this.minX + u * (this.maxX - this.minX), z: this.minZ + v * (this.maxZ - this.minZ) }
      const travel = document.getElementById('travel') as HTMLButtonElement | null
      if (travel) travel.disabled = false
      this.paintMap()
    })
  }

  setMap(roads: Road[], water: WaterFile, height: Heightfield): void {
    this.roads = roads
    this.water = water
    this.minX = height.originX
    this.maxX = height.originX + height.sizeX
    this.minZ = height.originZ
    this.maxZ = height.originZ + height.sizeZ
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
    if (cast) {
      cast.hidden = false
      cast.classList.toggle('is-pause', mode === 'pause')
    }
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
  ): void {
    this.reveal = reveal
    this.marks = marks
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
    document.querySelectorAll<HTMLButtonElement>('.era-chip').forEach((button) => {
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
      empty.textContent = 'Places you find show up here.'
      list.append(empty)
      return
    }
    for (const mark of marks) {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = mark.name
      button.addEventListener('click', () => this.onTravel(mark.x, mark.z))
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

  toast(text: string): void {
    const el = document.getElementById('toast')
    if (!el) return
    el.textContent = text
    el.classList.add('show')
    el.classList.remove('hold')
    el.onclick = null
    this.toastTimer = 5.2
  }

  /** Stays up until the click. Used when the picture cannot rebuild itself. */
  holdToast(text: string, onClick: () => void): void {
    const el = document.getElementById('toast')
    if (!el) return
    el.textContent = text
    el.classList.add('show', 'hold')
    this.toastTimer = 0
    el.onclick = () => onClick()
  }

  tickToast(dt: number, holdCard = false): void {
    const toast = document.getElementById('toast')
    if (this.toastTimer > 0 && !toast?.classList.contains('hold')) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) document.getElementById('toast')?.classList.remove('show')
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
    set('fps', state.fps)
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
  }

  private project(x: number, z: number, w: number, h: number): [number, number] {
    const u = (x - this.minX) / (this.maxX - this.minX)
    const v = (z - this.minZ) / (this.maxZ - this.minZ)
    return [u * w, v * h]
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
          : this.project(x, z, w, h)
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
    reveal?: (x: number, z: number) => boolean,
    pins?: { name: string; x: number; z: number }[],
  ): void {
    const canvas = document.getElementById('mapc') as HTMLCanvasElement | null
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(2, Math.floor(rect.width))
    canvas.height = Math.max(2, Math.floor(rect.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#f6f1e6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (this.water) {
      ctx.fillStyle = '#8fd0cf'
      for (const body of this.water.bodies) {
        let known = !reveal
        if (reveal) {
          const n = body.p.length / 2
          for (let i = 0; i < n; i++) {
            if (reveal(body.p[i * 2], body.p[i * 2 + 1])) {
              known = true
              break
            }
          }
        }
        if (!known) continue
        ctx.beginPath()
        const n = body.p.length / 2
        for (let i = 0; i < n; i++) {
          const [sx, sy] = this.project(body.p[i * 2], body.p[i * 2 + 1], canvas.width, canvas.height)
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.fill()
      }
    }
    this.drawRoads(ctx, canvas.width, canvas.height, null, reveal ?? null)
    if (pins) {
      ctx.fillStyle = '#2f5d34'
      ctx.font = '600 13px Outfit, sans-serif'
      ctx.textAlign = 'left'
      for (const pin of pins) {
        const [sx, sy] = this.project(pin.x, pin.z, canvas.width, canvas.height)
        ctx.beginPath()
        ctx.arc(sx, sy, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(pin.name, sx + 8, sy + 4)
      }
    }
    if (px != null && pz != null) {
      const [sx, sy] = this.project(px, pz, canvas.width, canvas.height)
      ctx.fillStyle = '#d64545'
      ctx.beginPath()
      ctx.arc(sx, sy, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    if (this.pin) {
      const [sx, sy] = this.project(this.pin.x, this.pin.z, canvas.width, canvas.height)
      ctx.strokeStyle = '#2f5d34'
      ctx.lineWidth = 2
      ctx.strokeRect(sx - 6, sy - 6, 12, 12)
    }
  }
}
