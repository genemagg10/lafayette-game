/**
 * Bake Lafayette, CA into compact offline files.
 * Map data © OpenStreetMap contributors, ODbL.
 * Elevation: AWS Terrain Tiles (terrarium), USGS 3DEP / SRTM.
 *
 *   node scripts/bake-map.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')
const CACHE = join(ROOT, '.cache')

const SOUTH = 37.868
const WEST = -122.158
const NORTH = 37.908
const EAST = -122.092
const ORIGIN = { lat: (SOUTH + NORTH) / 2, lon: (WEST + EAST) / 2 }
const M_LAT = 111320
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
const COLS = 448
const ROWS = 336
const CHUNK = 280
const ZOOM = 15

const F_WATER = 1
const F_PARK = 2
const F_WOOD = 4
const F_URBAN = 8
const F_PARKING = 16
const F_ROAD = 32
const F_BUILDING = 64

const HW_OK =
  /^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|pedestrian|footway|path|cycleway|track|steps)$/

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function r1(n) {
  return Math.round(n * 10) / 10
}

function toWorld(lat, lon) {
  return {
    x: (lon - ORIGIN.lon) * M_LON,
    z: -(lat - ORIGIN.lat) * M_LAT,
  }
}

function worldBounds() {
  const a = toWorld(NORTH, WEST)
  const b = toWorld(SOUTH, EAST)
  return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z }
}

function hash01(n) {
  let x = n | 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x = (x ^ (x >>> 16)) >>> 0
  return x / 4294967296
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

function signedArea(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}

function inside(x, z, poly) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const zi = poly[i][1]
    const xj = poly[j][0]
    const zj = poly[j][1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 0.0000001) + xi) c = !c
  }
  return c
}

function bboxOf(poly) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

function simplify(poly, eps) {
  if (poly.length < 3) return poly.slice()
  const eps2 = eps * eps
  function dp(a, b, out) {
    let maxD = 0
    let idx = -1
    const [ax, az] = poly[a]
    const [bx, bz] = poly[b]
    const abx = bx - ax
    const abz = bz - az
    const ab2 = abx * abx + abz * abz || 1
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = poly[i]
      const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2))
      const dx = px - (ax + abx * t)
      const dz = pz - (az + abz * t)
      const d = dx * dx + dz * dz
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > eps2) {
      dp(a, idx, out)
      dp(idx, b, out)
    } else out.push(b)
  }
  const keep = [0]
  dp(0, poly.length - 1, keep)
  return keep.map((i) => poly[i])
}

function closeRing(poly) {
  if (poly.length < 2) return poly
  const a = poly[0]
  const b = poly[poly.length - 1]
  if (dist2(a[0], a[1], b[0], b[1]) < 1) return poly.slice(0, -1)
  return poly
}

function wayPoints(el) {
  const geom = el.geometry
  if (!geom || geom.length < 2) return []
  const pts = []
  for (const g of geom) {
    if (typeof g.lat !== 'number' || typeof g.lon !== 'number') continue
    if (g.lat < SOUTH - 0.01 || g.lat > NORTH + 0.01 || g.lon < WEST - 0.012 || g.lon > EAST + 0.012) {
      pts.push(null)
      continue
    }
    const w = toWorld(g.lat, g.lon)
    const last = pts[pts.length - 1]
    if (last && last !== null && dist2(last[0], last[1], w.x, w.z) < 0.4) continue
    pts.push([r1(w.x), r1(w.z)])
  }
  const parts = []
  let cur = []
  for (const p of pts) {
    if (p === null) {
      if (cur.length) parts.push(cur)
      cur = []
    } else cur.push(p)
  }
  if (cur.length) parts.push(cur)
  return parts
}

function relationOuters(el) {
  if (!el.members) return []
  return el.members
    .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry)
    .map((m) => wayPoints({ geometry: m.geometry }))
    .flat()
}

async function overpass(query, label) {
  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]
  let lastErr = null
  for (const url of servers) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`overpass ${label} ${url} try ${attempt}`)
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'LafayetteDays/1.0 (family educational map bake)',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(180000),
        })
        if (res.status === 429 || res.status === 504 || res.status === 502) {
          throw new Error(`status ${res.status}`)
        }
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = await res.json()
        if (json.remark && !json.elements) throw new Error(json.remark)
        console.log(`  ${label}: ${json.elements?.length ?? 0} elements`)
        return json
      } catch (err) {
        lastErr = err
        console.warn(`  failed: ${err.message}`)
        await sleep(2500 * attempt)
      }
    }
  }
  throw lastErr || new Error(`overpass failed: ${label}`)
}

function cachePath(name) {
  return join(CACHE, 'osm', name + '.json')
}

async function cachedQuery(name, query) {
  const p = cachePath(name)
  if (existsSync(p)) {
    console.log(`cache hit ${name}`)
    return JSON.parse(readFileSync(p, 'utf8'))
  }
  const json = await overpass(query, name)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(json))
  return json
}

function quadBoxes() {
  const midLat = (SOUTH + NORTH) / 2
  const midLon = (WEST + EAST) / 2
  const pad = 0.0015
  const lats = [
    [SOUTH, midLat + pad],
    [midLat - pad, NORTH],
  ]
  const lons = [
    [WEST, midLon + pad],
    [midLon - pad, EAST],
  ]
  const boxes = []
  for (const [s, n] of lats) for (const [w, e] of lons) boxes.push([s, w, n, e])
  return boxes
}

async function fetchSplit(name, filter) {
  try {
    const q = `[out:json][timeout:160];(${filter(SOUTH, WEST, NORTH, EAST)});out geom;`
    return await cachedQuery(name, q)
  } catch (err) {
    console.warn(`splitting ${name}: ${err.message}`)
    const elements = []
    const seen = new Set()
    let i = 0
    for (const [s, w, n, e] of quadBoxes()) {
      const q = `[out:json][timeout:120];(${filter(s, w, n, e)});out geom;`
      const json = await cachedQuery(`${name}-q${i++}`, q)
      for (const el of json.elements || []) {
        const id = el.type + el.id
        if (seen.has(id)) continue
        seen.add(id)
        elements.push(el)
      }
    }
    return { elements }
  }
}

function tileRange() {
  const n = 2 ** ZOOM
  function xy(lat, lon) {
    const x = ((lon + 180) / 360) * n
    const latRad = (lat * Math.PI) / 180
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    return { x, y }
  }
  const a = xy(NORTH, WEST)
  const b = xy(SOUTH, EAST)
  const x0 = Math.floor(Math.min(a.x, b.x))
  const x1 = Math.floor(Math.max(a.x, b.x))
  const y0 = Math.floor(Math.min(a.y, b.y))
  const y1 = Math.floor(Math.max(a.y, b.y))
  return { x0, x1, y0, y1 }
}

async function loadTiles() {
  const { x0, x1, y0, y1 } = tileRange()
  const tiles = new Map()
  const jobs = []
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let y = y0 - 1; y <= y1 + 1; y++) jobs.push([x, y])
  }
  console.log(`terrain tiles ${jobs.length} @ z${ZOOM}`)
  mkdirSync(join(CACHE, 'terrain'), { recursive: true })
  let cursor = 0
  async function worker() {
    while (cursor < jobs.length) {
      const [x, y] = jobs[cursor++]
      const file = join(CACHE, 'terrain', `${ZOOM}-${x}-${y}.png`)
      let buf
      if (existsSync(file)) buf = readFileSync(file)
      else {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`
        const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
        if (!res.ok) throw new Error(`tile ${x}/${y} ${res.status}`)
        buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(file, buf)
      }
      const png = PNG.sync.read(buf)
      tiles.set(`${x},${y}`, png)
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  return tiles
}

function makeSampler(tiles) {
  const n = 2 ** ZOOM
  function pixel(gx, gy) {
    if (gx < 0 || gy < 0) return null
    const tx = Math.floor(gx / 256)
    const ty = Math.floor(gy / 256)
    const png = tiles.get(`${tx},${ty}`)
    if (!png) return null
    const px = gx - tx * 256
    const py = gy - ty * 256
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) return null
    const i = (py * png.width + px) << 2
    const r = png.data[i]
    const g = png.data[i + 1]
    const b = png.data[i + 2]
    return r * 256 + g + b / 256 - 32768
  }
  return function sample(lat, lon) {
    const gx = ((lon + 180) / 360) * n * 256 - 0.5
    const latRad = (lat * Math.PI) / 180
    const gy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * 256 - 0.5
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const e00 = pixel(x0, y0)
    const e10 = pixel(x0 + 1, y0)
    const e01 = pixel(x0, y0 + 1)
    const e11 = pixel(x0 + 1, y0 + 1)
    if (e00 == null || e10 == null || e01 == null || e11 == null) return e00 ?? e10 ?? e01 ?? e11 ?? 100
    return e00 * (1 - fx) * (1 - fy) + e10 * fx * (1 - fy) + e01 * (1 - fx) * fy + e11 * fx * fy
  }
}

function roadStyle(tags) {
  const hw = tags.highway || 'service'
  const table = {
    motorway: [14, 0, 0, 1],
    motorway_link: [7, 0, 0, 1],
    trunk: [12, 0, 0, 1],
    trunk_link: [6.5, 0, 0, 1],
    primary: [11, 1, 0, 2],
    primary_link: [6.5, 1, 0, 2],
    secondary: [9.5, 1, 0, 3],
    secondary_link: [5.5, 1, 0, 3],
    tertiary: [7.6, 1, 0, 4],
    tertiary_link: [5, 1, 0, 4],
    residential: [6.2, 1, 0, 5],
    unclassified: [6, 1, 0, 5],
    living_street: [5.4, 1, 0, 5],
    service: [3.5, 0, 0, 6],
    pedestrian: [5.5, 0, 0, 5],
    footway: [1.7, 0, 1, 7],
    path: [1.6, 0, 1, 7],
    cycleway: [2.5, 0, 1, 7],
    track: [2.3, 0, 1, 7],
    steps: [1.5, 0, 1, 8],
  }
  const row = table[hw] || [5, 0, 0, 6]
  let [w, sidewalk, trail, rank] = row
  const lanes = parseInt(tags.lanes || '', 10)
  if (lanes && !trail && hw !== 'service') w = Math.max(w, lanes * 3.3)
  if (tags.sidewalk === 'none' || tags.sidewalk === 'no') sidewalk = 0
  if (tags.footway === 'sidewalk' || tags.footway === 'crossing') return null
  if (hw === 'steps') trail = 1
  const layer = parseInt(tags.layer || '0', 10) || 0
  const bridge = tags.bridge === 'yes' || tags.bridge === 'viaduct' || tags.bridge === 'boardwalk'
  const lift = bridge ? 6.2 + Math.max(0, layer) * 2.4 : 0
  return { w, sidewalk, trail, rank, lift, hw }
}

function buildingHeight(tags, id) {
  const h = parseFloat(tags.height || '')
  if (Number.isFinite(h) && h > 2.2 && h < 80) return h
  const levels = parseFloat(tags['building:levels'] || '')
  if (Number.isFinite(levels) && levels > 0 && levels < 30) return levels * 3.15
  const b = tags.building || 'yes'
  const base = {
    house: 6.2,
    detached: 6.2,
    semidetached_house: 6.4,
    terrace: 6.6,
    residential: 7.4,
    apartments: 11.5,
    commercial: 8.2,
    retail: 7.2,
    office: 9,
    school: 8,
    church: 11,
    chapel: 8,
    garage: 3.2,
    garages: 3.2,
    shed: 2.8,
    roof: 3,
    industrial: 7,
    hotel: 11,
    kindergarten: 6,
    yes: 6.6,
  }[b] || 6.6
  return base + hash01(id) * 1.5
}

function buildingKind(tags) {
  const b = tags.building || ''
  const amenity = tags.amenity || ''
  const shop = tags.shop || ''
  if (shop || amenity === 'restaurant' || amenity === 'cafe' || amenity === 'fast_food' || amenity === 'bank' || b === 'retail' || b === 'commercial')
    return 'c'
  if (b === 'apartments' || (b === 'residential' && parseFloat(tags['building:levels'] || '0') >= 3)) return 'a'
  if (b === 'house' || b === 'detached' || b === 'semidetached_house' || b === 'terrace') return 'h'
  if (b === 'school' || b === 'church' || b === 'chapel' || amenity === 'school' || amenity === 'place_of_worship' || amenity === 'library')
    return 's'
  if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'roof') return 'g'
  return 'o'
}

function poiKind(tags) {
  if (tags.railway === 'station') return 'station'
  if (tags.shop) return tags.shop
  if (tags.amenity) return tags.amenity
  if (tags.tourism) return tags.tourism
  if (tags.leisure) return tags.leisure
  return 'place'
}

function nearestSegAngle(x, z, roads) {
  let best = Infinity
  let ang = 0
  for (const road of roads) {
    const p = road.p
    for (let i = 0; i < p.length - 3; i += 3) {
      const ax = p[i]
      const az = p[i + 1]
      const bx = p[i + 3]
      const bz = p[i + 4]
      const abx = bx - ax
      const abz = bz - az
      const ab2 = abx * abx + abz * abz || 1
      let t = ((x - ax) * abx + (z - az) * abz) / ab2
      t = Math.max(0, Math.min(1, t))
      const px = ax + abx * t
      const pz = az + abz * t
      const d = dist2(x, z, px, pz)
      if (d < best) {
        best = d
        ang = Math.atan2(abx, -abz)
      }
    }
  }
  return { ang, d: Math.sqrt(best) }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(CACHE, { recursive: true })

  const bb = (s, w, n, e) => `${s},${w},${n},${e}`
  const highwayFilter = (s, w, n, e) =>
    `way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|footway|path|cycleway|track|steps"](${bb(s, w, n, e)});`
  const buildingFilter = (s, w, n, e) => `way["building"](${bb(s, w, n, e)});`
  const landFilter = (s, w, n, e) => `
    way["natural"~"water|wood"](${bb(s, w, n, e)});
    way["landuse"~"forest|grass|meadow|park|retail|commercial|recreation_ground|cemetery|basin|reservoir|orchard"](${bb(s, w, n, e)});
    way["leisure"~"park|playground|garden|pitch|nature_reserve|common"](${bb(s, w, n, e)});
    way["waterway"~"stream|river|ditch|drain|canal"](${bb(s, w, n, e)});
    way["amenity"="parking"](${bb(s, w, n, e)});
    relation["natural"="water"](${bb(s, w, n, e)});
  `
  const nodeFilter = (s, w, n, e) => `
    node["natural"="tree"](${bb(s, w, n, e)});
    node["highway"="traffic_signals"](${bb(s, w, n, e)});
    node["highway"="crossing"](${bb(s, w, n, e)});
    node["shop"](${bb(s, w, n, e)});
    node["amenity"~"restaurant|cafe|fast_food|bank|pharmacy|library|school|place_of_worship|fuel|cinema|theatre|community_centre|bicycle_rental|fountain|ice_cream|clinic|bar|pub|post_office|police|fire_station|townhall|marketplace"](${bb(s, w, n, e)});
    node["tourism"](${bb(s, w, n, e)});
    node["railway"="station"](${bb(s, w, n, e)});
    node["leisure"~"park|playground|pitch|garden"](${bb(s, w, n, e)});
  `

  const tilesPromise = loadTiles()
  const highways = await fetchSplit('highways', highwayFilter)
  const buildings = await fetchSplit('buildings', buildingFilter)
  const land = await fetchSplit('land', landFilter)
  const nodes = await fetchSplit('nodes', nodeFilter)
  const tiles = await tilesPromise
  const sampleLL = makeSampler(tiles)

  const bounds = worldBounds()
  const { minX, maxX, minZ, maxZ } = bounds
  const sizeX = maxX - minX
  const sizeZ = maxZ - minZ
  const heights = new Float32Array(COLS * ROWS)
  const flags = new Uint8Array(COLS * ROWS)

  console.log('sampling DEM', COLS, 'x', ROWS)
  let minElev = Infinity
  let maxElev = -Infinity
  let sumElev = 0
  for (let j = 0; j < ROWS; j++) {
    const lat = NORTH - ((NORTH - SOUTH) * j) / (ROWS - 1)
    for (let i = 0; i < COLS; i++) {
      const lon = WEST + ((EAST - WEST) * i) / (COLS - 1)
      let h = sampleLL(lat, lon)
      if (!Number.isFinite(h) || h < -50 || h > 2500) h = 100
      heights[j * COLS + i] = h
      if (h < minElev) minElev = h
      if (h > maxElev) maxElev = h
      sumElev += h
    }
  }
  console.log(`elev ${minElev.toFixed(1)} .. ${maxElev.toFixed(1)} mean ${(sumElev / heights.length).toFixed(1)}`)

  function cellIndex(x, z) {
    const i = Math.round(((x - minX) / sizeX) * (COLS - 1))
    const j = Math.round(((z - minZ) / sizeZ) * (ROWS - 1))
    if (i < 0 || j < 0 || i >= COLS || j >= ROWS) return -1
    return j * COLS + i
  }
  function sampleXZ(x, z) {
    const fx = ((x - minX) / sizeX) * (COLS - 1)
    const fz = ((z - minZ) / sizeZ) * (ROWS - 1)
    if (fx < 0 || fz < 0 || fx > COLS - 1 || fz > ROWS - 1) return 90
    const i0 = Math.floor(fx)
    const j0 = Math.floor(fz)
    const i1 = Math.min(COLS - 1, i0 + 1)
    const j1 = Math.min(ROWS - 1, j0 + 1)
    const tx = fx - i0
    const tz = fz - j0
    const h00 = heights[j0 * COLS + i0]
    const h10 = heights[j0 * COLS + i1]
    const h01 = heights[j1 * COLS + i0]
    const h11 = heights[j1 * COLS + i1]
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz
  }
  function forCells(poly, fn) {
    const box = bboxOf(poly)
    const i0 = Math.max(0, Math.floor(((box.minX - minX) / sizeX) * (COLS - 1)))
    const i1 = Math.min(COLS - 1, Math.ceil(((box.maxX - minX) / sizeX) * (COLS - 1)))
    const j0 = Math.max(0, Math.floor(((box.minZ - minZ) / sizeZ) * (ROWS - 1)))
    const j1 = Math.min(ROWS - 1, Math.ceil(((box.maxZ - minZ) / sizeZ) * (ROWS - 1)))
    for (let j = j0; j <= j1; j++) {
      const z = minZ + (j / (ROWS - 1)) * sizeZ
      for (let i = i0; i <= i1; i++) {
        const x = minX + (i / (COLS - 1)) * sizeX
        if (inside(x, z, poly)) fn(i, j, x, z)
      }
    }
  }
  function stampCircle(x, z, radius, bit) {
    const radI = Math.ceil((radius / sizeX) * (COLS - 1)) + 1
    const radJ = Math.ceil((radius / sizeZ) * (ROWS - 1)) + 1
    const ci = Math.round(((x - minX) / sizeX) * (COLS - 1))
    const cj = Math.round(((z - minZ) / sizeZ) * (ROWS - 1))
    const r2 = radius * radius
    for (let j = cj - radJ; j <= cj + radJ; j++) {
      if (j < 0 || j >= ROWS) continue
      const wz = minZ + (j / (ROWS - 1)) * sizeZ
      for (let i = ci - radI; i <= ci + radI; i++) {
        if (i < 0 || i >= COLS) continue
        const wx = minX + (i / (COLS - 1)) * sizeX
        if (dist2(wx, wz, x, z) <= r2) flags[j * COLS + i] |= bit
      }
    }
  }

  const waters = []
  const creeks = []
  const parks = []
  const woods = []
  const urban = []
  const parking = []

  function pushPoly(list, name, kind, parts, eps) {
    for (const part of parts) {
      let poly = closeRing(part)
      if (poly.length < 3) continue
      poly = simplify(poly, eps)
      if (poly.length < 3) continue
      if (Math.abs(signedArea(poly)) < 40) continue
      if (signedArea(poly) < 0) poly.reverse()
      list.push({ n: name || '', k: kind || '', p: poly })
    }
  }

  for (const el of land.elements || []) {
    const tags = el.tags || {}
    const parts = el.type === 'relation' ? relationOuters(el) : wayPoints(el)
    if (!parts.length) continue
    const name = tags.name || ''
    if (tags.natural === 'water' || tags.landuse === 'reservoir' || tags.landuse === 'basin' || tags.water) {
      const ele = parseFloat(tags.ele || '')
      for (const part of parts) {
        let poly = closeRing(part)
        if (poly.length < 3) continue
        poly = simplify(poly, 2.2)
        if (Math.abs(signedArea(poly)) < 80) continue
        if (signedArea(poly) < 0) poly.reverse()
        waters.push({ n: name, k: tags.water || tags.natural || 'water', level: Number.isFinite(ele) ? ele : null, p: poly })
      }
      continue
    }
    if (tags.waterway) {
      for (const part of parts) {
        if (part.length < 2) continue
        const simp = simplify(part, 2)
        if (simp.length >= 2) creeks.push({ n: name, p: simp })
      }
      continue
    }
    if (tags.amenity === 'parking') {
      pushPoly(parking, name, 'parking', parts, 1.5)
      continue
    }
    if (tags.natural === 'wood' || tags.landuse === 'forest' || tags.landuse === 'orchard') {
      pushPoly(woods, name, 'wood', parts, 3)
      continue
    }
    if (tags.landuse === 'retail' || tags.landuse === 'commercial') {
      pushPoly(urban, name, 'urban', parts, 3)
      continue
    }
    if (
      tags.leisure === 'park' ||
      tags.leisure === 'garden' ||
      tags.leisure === 'common' ||
      tags.leisure === 'nature_reserve' ||
      tags.landuse === 'park' ||
      tags.landuse === 'grass' ||
      tags.landuse === 'meadow' ||
      tags.landuse === 'recreation_ground' ||
      tags.leisure === 'pitch' ||
      tags.leisure === 'playground'
    ) {
      pushPoly(parks, name, tags.leisure || tags.landuse || 'park', parts, 3)
    }
  }

  waters.sort((a, b) => Math.abs(signedArea(b.p)) - Math.abs(signedArea(a.p)))
  const reservoir = waters.find((w) => /reservoir/i.test(w.n)) || waters[0]
  let waterLevel = 139
  if (reservoir) {
    const samples = []
    forCells(reservoir.p, (i, j) => samples.push(heights[j * COLS + i]))
    samples.sort((a, b) => a - b)
    const median = samples.length ? samples[(samples.length * 0.5) | 0] : 139
    waterLevel = reservoir.level && reservoir.level > 50 && reservoir.level < 400 ? reservoir.level : median
    console.log(`reservoir "${reservoir.n}" area ${Math.abs(signedArea(reservoir.p)).toFixed(0)} level ${waterLevel.toFixed(1)} medianDEM ${median.toFixed(1)}`)
    for (const w of waters) {
      if (w.level == null || w.level < 50) {
        const ss = []
        forCells(w.p, (i, j) => ss.push(heights[j * COLS + i]))
        ss.sort((a, b) => a - b)
        w.level = ss.length ? ss[(ss.length * 0.45) | 0] : waterLevel
      }
      const level = w.level
      const insideIdx = []
      forCells(w.p, (i, j) => {
        insideIdx.push(j * COLS + i)
        flags[j * COLS + i] |= F_WATER
      })
      for (const idx of insideIdx) heights[idx] = level - 2.4
      const box = bboxOf(w.p)
      const i0 = Math.max(0, Math.floor(((box.minX - 20 - minX) / sizeX) * (COLS - 1)))
      const i1 = Math.min(COLS - 1, Math.ceil(((box.maxX + 20 - minX) / sizeX) * (COLS - 1)))
      const j0 = Math.max(0, Math.floor(((box.minZ - 20 - minZ) / sizeZ) * (ROWS - 1)))
      const j1 = Math.min(ROWS - 1, Math.ceil(((box.maxZ + 20 - minZ) / sizeZ) * (ROWS - 1)))
      for (let j = j0; j <= j1; j++) {
        const z = minZ + (j / (ROWS - 1)) * sizeZ
        for (let i = i0; i <= i1; i++) {
          const idx = j * COLS + i
          if (flags[idx] & F_WATER) continue
          const x = minX + (i / (COLS - 1)) * sizeX
          if (inside(x, z, w.p)) continue
          let near = false
          let best = 18
          for (let k = 0; k < w.p.length; k++) {
            const [ax, az] = w.p[k]
            const [bx, bz] = w.p[(k + 1) % w.p.length]
            const abx = bx - ax
            const abz = bz - az
            const ab2 = abx * abx + abz * abz || 1
            let t = ((x - ax) * abx + (z - az) * abz) / ab2
            t = Math.max(0, Math.min(1, t))
            const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t))
            if (d < best) best = d
            if (d < 16) near = true
          }
          if (!near) continue
          const t = Math.max(0, Math.min(1, best / 16))
          const h = heights[idx]
          if (h < level) heights[idx] = level + 0.35
          else heights[idx] = level + (h - level) * (0.35 + 0.65 * t)
        }
      }
    }
  } else {
    console.warn('no reservoir polygon found')
  }

  for (const p of parks) forCells(p.p, (i, j) => (flags[j * COLS + i] |= F_PARK))
  for (const p of woods) forCells(p.p, (i, j) => (flags[j * COLS + i] |= F_WOOD))
  for (const p of urban) forCells(p.p, (i, j) => (flags[j * COLS + i] |= F_URBAN))
  for (const p of parking) forCells(p.p, (i, j) => (flags[j * COLS + i] |= F_PARKING))

  const roads = []
  for (const el of highways.elements || []) {
    const tags = el.tags || {}
    if (!HW_OK.test(tags.highway || '')) continue
    const style = roadStyle(tags)
    if (!style) continue
    const parts = wayPoints(el)
    for (const part of parts) {
      if (part.length < 2) continue
      const eps = style.trail ? 0.8 : style.rank <= 2 ? 1.4 : 1.1
      const simp = simplify(part, eps)
      if (simp.length < 2) continue
      const y = simp.map(([x, z]) => sampleXZ(x, z) + 0.16 + style.lift)
      const p = []
      for (let i = 0; i < simp.length; i++) p.push(r1(simp[i][0]), r1(simp[i][1]), r1(y[i]))
      roads.push({
        n: tags.name || '',
        t: style.hw,
        w: r1(style.w),
        s: style.sidewalk ? 1 : 0,
        d: style.trail ? 1 : 0,
        b: r1(style.lift),
        rank: style.rank,
        p,
      })
    }
  }

  function endpointNear(x, z, lift, self) {
    for (const o of roads) {
      if (o === self || o.b <= 0) continue
      const n = o.p.length
      if (dist2(x, z, o.p[0], o.p[1]) < 64) return true
      if (dist2(x, z, o.p[n - 3], o.p[n - 2]) < 64) return true
    }
    return false
  }
  for (const road of roads) {
    if (road.b <= 0) continue
    const nPts = road.p.length / 3
    const ramp = (end) => {
      const x = end === 0 ? road.p[0] : road.p[road.p.length - 3]
      const z = end === 0 ? road.p[1] : road.p[road.p.length - 2]
      if (endpointNear(x, z, road.b, road)) return
      const steps = Math.min(6, nPts - 1)
      for (let s = 0; s < steps; s++) {
        const i = end === 0 ? s : nPts - 1 - s
        const t = s / steps
        const ground = sampleXZ(road.p[i * 3], road.p[i * 3 + 1]) + 0.16
        const deck = road.p[i * 3 + 2]
        road.p[i * 3 + 2] = r1(ground * (1 - t) + deck * t)
      }
    }
    ramp(0)
    ramp(1)
  }

  for (const road of roads) {
    const step = Math.max(6, road.w)
    const nPts = road.p.length / 3
    for (let i = 0; i < nPts - 1; i++) {
      const ax = road.p[i * 3]
      const az = road.p[i * 3 + 1]
      const bx = road.p[(i + 1) * 3]
      const bz = road.p[(i + 1) * 3 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.ceil(len / step))
      for (let k = 0; k <= n; k++) {
        const t = k / n
        stampCircle(ax + (bx - ax) * t, az + (bz - az) * t, road.w * 0.5 + (road.s ? 2.2 : 0.6), F_ROAD)
      }
    }
  }

  const builtPolys = []
  const chunks = {}
  function chunkOf(x, z) {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`
    if (!chunks[key]) chunks[key] = { b: [], t: [], reeds: [], parking: [] }
    return chunks[key]
  }

  let buildingCount = 0
  for (const el of buildings.elements || []) {
    const tags = el.tags || {}
    const parts = wayPoints(el)
    for (const part of parts) {
      let poly = closeRing(part)
      if (poly.length < 3) continue
      poly = simplify(poly, 0.9)
      if (poly.length < 3 || poly.length > 48) {
        if (poly.length > 48) poly = simplify(poly, 1.8)
      }
      if (poly.length < 3) continue
      const area = Math.abs(signedArea(poly))
      const name = tags.name || tags.brand || ''
      if (area < (name ? 18 : 28)) continue
      if (signedArea(poly) < 0) poly.reverse()
      let cx = 0
      let cz = 0
      for (const [x, z] of poly) {
        cx += x
        cz += z
      }
      cx /= poly.length
      cz /= poly.length
      if (cx < minX - 10 || cx > maxX + 10 || cz < minZ - 10 || cz > maxZ + 10) continue
      const h = r1(buildingHeight(tags, el.id))
      const kind = buildingKind(tags)
      const flat = [h, kind, name]
      for (const [x, z] of poly) flat.push(r1(x), r1(z))
      chunkOf(cx, cz).b.push(flat)
      builtPolys.push(poly)
      forCells(poly, (i, j) => (flags[j * COLS + i] |= F_BUILDING))
      buildingCount++
    }
  }

  for (const lot of parking) {
    let cx = 0
    let cz = 0
    const flat = []
    for (const [x, z] of lot.p) {
      cx += x
      cz += z
      flat.push(r1(x), r1(z))
    }
    cx /= lot.p.length
    cz /= lot.p.length
    chunkOf(cx, cz).parking.push(flat)
  }

  const signals = []
  const crossings = []
  const pois = []
  const osmTrees = []

  function addPoi(name, kind, x, z) {
    if (!name) return
    for (const p of pois) {
      if (p.n === name && dist2(p.x, p.z, x, z) < 900) return
    }
    pois.push({ n: name, k: kind, x: r1(x), z: r1(z) })
  }

  for (const el of nodes.elements || []) {
    const tags = el.tags || {}
    if (typeof el.lat !== 'number') continue
    const w = toWorld(el.lat, el.lon)
    if (w.x < minX || w.x > maxX || w.z < minZ || w.z > maxZ) continue
    if (tags.natural === 'tree') {
      osmTrees.push([r1(w.x), r1(w.z), hash01(el.id) < 0.5 ? 0 : 1])
      continue
    }
    if (tags.highway === 'traffic_signals') {
      signals.push({ x: r1(w.x), z: r1(w.z) })
      continue
    }
    if (tags.highway === 'crossing') {
      const { ang, d } = nearestSegAngle(w.x, w.z, roads.filter((rd) => rd.rank <= 5 && !rd.d))
      if (d < 18) crossings.push({ x: r1(w.x), z: r1(w.z), ang: Math.round(ang * 1000) / 1000 })
      continue
    }
    const name = tags.name || tags.brand || ''
    if (name) addPoi(name, poiKind(tags), w.x, w.z)
  }

  for (const key of Object.keys(chunks)) {
    for (const b of chunks[key].b) {
      if (!b[2]) continue
      const pts = b.length - 3
      let cx = 0
      let cz = 0
      const n = pts / 2
      for (let i = 0; i < n; i++) {
        cx += b[3 + i * 2]
        cz += b[4 + i * 2]
      }
      addPoi(b[2], b[1] === 'c' ? 'shop' : b[1] === 's' ? 'civic' : 'building', cx / n, cz / n)
    }
  }

  const treeTiers = { osm: osmTrees, street: [], wood: [], hill: [], park: [] }
  function occupied(x, z, minD) {
    const idx = cellIndex(x, z)
    if (idx < 0) return true
    const f = flags[idx]
    if (f & (F_WATER | F_ROAD | F_BUILDING | F_PARKING)) return true
    return false && minD
  }

  for (const road of roads) {
    if (!road.s || road.rank > 5 || road.b > 0) continue
    const nPts = road.p.length / 3
    let carry = 0
    for (let i = 0; i < nPts - 1; i++) {
      const ax = road.p[i * 3]
      const az = road.p[i * 3 + 1]
      const bx = road.p[(i + 1) * 3]
      const bz = road.p[(i + 1) * 3 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 1) continue
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      const px = -dz
      const pz = dx
      const off = road.w * 0.5 + 1.7
      let d = carry
      while (d < len) {
        const x = ax + dx * d
        const z = az + dz * d
        for (const side of [-1, 1]) {
          const tx = x + px * off * side
          const tz = z + pz * off * side
          if (!occupied(tx, tz)) treeTiers.street.push([r1(tx), r1(tz), hash01((tx * 10) | 0) < 0.7 ? 0 : 1])
        }
        d += 18
      }
      carry = d - len
    }
  }

  function scatter(list, poly, step, chance, variantBias) {
    const box = bboxOf(poly)
    for (let x = box.minX; x <= box.maxX; x += step) {
      for (let z = box.minZ; z <= box.maxZ; z += step) {
        const jx = x + (hash01((x * 13 + z * 7) | 0) - 0.5) * step * 0.7
        const jz = z + (hash01((x * 3 + z * 19) | 0) - 0.5) * step * 0.7
        if (!inside(jx, jz, poly)) continue
        if (occupied(jx, jz)) continue
        if (hash01((jx * 100 + jz) | 0) > chance) continue
        const v = hash01((jx * 17) | 0) < variantBias ? 0 : 1
        list.push([r1(jx), r1(jz), v])
      }
    }
  }
  for (const w of woods) scatter(treeTiers.wood, w.p, 11, 0.85, 0.55)
  for (const p of parks) scatter(treeTiers.park, p.p, 16, 0.45, 0.6)

  for (let z = minZ + 8; z < maxZ; z += 15) {
    for (let x = minX + 8; x < maxX; x += 15) {
      const idx = cellIndex(x, z)
      if (idx < 0) continue
      const f = flags[idx]
      if (f & (F_WATER | F_ROAD | F_BUILDING | F_PARKING | F_WOOD | F_PARK)) continue
      const h = heights[idx]
      const jx = x + (hash01((x * 9 + z) | 0) - 0.5) * 8
      const jz = z + (hash01((z * 5 + x) | 0) - 0.5) * 8
      if (occupied(jx, jz)) continue
      const roll = hash01((jx * 50 + jz * 3) | 0)
      if (h > 175 && roll < 0.62) treeTiers.hill.push([r1(jx), r1(jz), roll < 0.3 ? 0 : 1])
      else if (h > waterLevel + 8 && !(f & F_URBAN) && roll < 0.28) treeTiers.hill.push([r1(jx), r1(jz), 0])
    }
  }

  const trees = []
  for (const tier of [treeTiers.osm, treeTiers.street, treeTiers.wood, treeTiers.hill, treeTiers.park]) {
    for (const t of tier) {
      if (trees.length >= 9500) break
      trees.push(t)
    }
    if (trees.length >= 9500) break
  }
  console.log(
    `trees osm ${treeTiers.osm.length} street ${treeTiers.street.length} wood ${treeTiers.wood.length} hill ${treeTiers.hill.length} park ${treeTiers.park.length} kept ${trees.length}`,
  )

  const reedSet = []
  if (reservoir) {
    const poly = reservoir.p
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k]
      const [bx, bz] = poly[(k + 1) % poly.length]
      const len = Math.hypot(bx - ax, bz - az)
      const steps = Math.floor(len / 9)
      for (let s = 0; s < steps && reedSet.length < 380; s++) {
        if (hash01(k * 50 + s) < 0.45) continue
        const t = (s + 0.5) / Math.max(1, steps)
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length
        const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length
        const dx = x - cx
        const dz = z - cz
        const mag = Math.hypot(dx, dz) || 1
        reedSet.push([r1(x + (dx / mag) * 3.5), r1(z + (dz / mag) * 3.5)])
      }
    }
  }

  for (const t of trees) {
    chunkOf(t[0], t[1]).t.push(t[0], t[1], t[2])
  }
  for (const rd of reedSet) chunkOf(rd[0], rd[1]).reeds.push(rd[0], rd[1])

  function centroid(poly) {
    let x = 0
    let z = 0
    for (const [px, pz] of poly) {
      x += px
      z += pz
    }
    return { x: x / poly.length, z: z / poly.length }
  }

  let boulevard = null
  let bestBd = Infinity
  const target = toWorld(37.89105, -122.1194)
  for (const road of roads) {
    if (!/diablo boulevard/i.test(road.n)) continue
    const nPts = road.p.length / 3
    for (let i = 0; i < nPts; i++) {
      const d = dist2(road.p[i * 3], road.p[i * 3 + 1], target.x, target.z)
      if (d < bestBd) {
        bestBd = d
        boulevard = { road, i }
      }
    }
  }
  if (!boulevard) throw new Error('Mount Diablo Boulevard not found in extract')
  const bi = boulevard.i
  const bx = boulevard.road.p[bi * 3]
  const bz = boulevard.road.p[bi * 3 + 1]
  const bi2 = Math.min(boulevard.road.p.length / 3 - 1, bi + 1)
  const bdx = boulevard.road.p[bi2 * 3] - bx
  const bdz = boulevard.road.p[bi2 * 3 + 1] - bz
  const blen = Math.hypot(bdx, bdz) || 1
  const heading = Math.atan2(bdx / blen, -(bdz / blen))
  const px = -bdz / blen
  const pz = bdx / blen
  const spawn = {
    x: r1(bx + px * (boulevard.road.w * 0.5 + 1.8)),
    z: r1(bz + pz * (boulevard.road.w * 0.5 + 1.8)),
    heading: Math.round(heading * 1000) / 1000,
    name: 'Downtown Lafayette',
  }

  function landPoint(x, z, push) {
    const idx = cellIndex(x, z)
    if (idx >= 0 && !(flags[idx] & F_WATER) && !(flags[idx] & F_BUILDING)) return { x, z }
    for (let rad = 6; rad < 80; rad += 6) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2
        const xx = x + Math.cos(ang) * rad * push
        const zz = z + Math.sin(ang) * rad
        const id2 = cellIndex(xx, zz)
        if (id2 >= 0 && !(flags[id2] & (F_WATER | F_BUILDING))) return { x: xx, z: zz }
      }
    }
    return { x, z }
  }

  let carSpot = landPoint(spawn.x + 28, spawn.z + 18, 1)
  let bestLot = Infinity
  for (const lot of parking) {
    const c = centroid(lot.p)
    const d = dist2(c.x, c.z, spawn.x, spawn.z)
    if (d < bestLot && d > 100) {
      const idx = cellIndex(c.x, c.z)
      if (idx >= 0 && !(flags[idx] & F_WATER)) {
        bestLot = d
        carSpot = c
      }
    }
  }

  const resC = reservoir ? centroid(reservoir.p) : toWorld(37.883, -122.141)
  let heliSpot = landPoint(resC.x + 40, resC.z, 1)
  if (reservoir) {
    let east = -Infinity
    let ex = resC.x
    let ez = resC.z
    for (const [x, z] of reservoir.p) {
      if (x > east) {
        east = x
        ex = x
        ez = z
      }
    }
    heliSpot = landPoint(ex + 28, ez, 1)
  }

  const bikeSpot = {
    x: r1(spawn.x + px * 4),
    z: r1(spawn.z + pz * 4),
    h: heading,
  }

  const memLL = toWorld(37.89515, -122.12365)
  const memorial = { x: r1(memLL.x), z: r1(memLL.z) }
  const kite = landPoint(memorial.x + 22, memorial.z - 6, 1)

  const collectibles = []
  if (reservoir) {
    const notes = [
      'The rim trail is a full loop if you don’t stop for every duck.',
      'These oaks keep the afternoon.',
      'From this bank, the boulevard is only a rumor.',
      'Cold water. Warm hill.',
      'A smooth stone was already here. It can stay.',
      'If the light is low, town looks painted on.',
    ]
    const c = centroid(reservoir.p)
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + 0.4
      const dx = Math.cos(ang)
      const dz = Math.sin(ang)
      let hit = null
      let bestT = Infinity
      const poly = reservoir.p
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i]
        const [bx, bz] = poly[(i + 1) % poly.length]
        const rx = bx - ax
        const rz = bz - az
        const den = dx * rz - dz * rx
        if (Math.abs(den) < 1e-6) continue
        const t = ((ax - c.x) * rz - (az - c.z) * rx) / den
        const u = ((ax - c.x) * dz - (az - c.z) * dx) / den
        if (t > 8 && u >= 0 && u <= 1 && t < bestT) {
          bestT = t
          hit = { x: c.x + dx * t, z: c.z + dz * t, dx, dz }
        }
      }
      if (!hit) continue
      const mag = Math.hypot(hit.dx, hit.dz) || 1
      const spot = landPoint(hit.x + (hit.dx / mag) * 12, hit.z + (hit.dz / mag) * 12, 1)
      collectibles.push({
        id: `rim-${k + 1}`,
        kind: 'medallion',
        x: r1(spot.x),
        z: r1(spot.z),
        note: notes[k],
      })
    }
  }
  collectibles.push({
    id: 'kite',
    kind: 'kite',
    x: r1(kite.x),
    z: r1(kite.z),
    note: 'A red kite lives in this oak. It has watched a lot of evenings.',
  })

  let bart = null
  for (const p of pois) {
    if (p.k === 'station' && /lafayette/i.test(p.n)) bart = p
  }
  if (!bart) {
    const w = toWorld(37.8932, -122.1246)
    bart = { n: 'Lafayette Station', k: 'station', x: r1(w.x), z: r1(w.z) }
    pois.push(bart)
  }

  const streetSigns = []
  const named = roads.filter((rd) => rd.n && rd.rank <= 4 && !rd.d)
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      if (named[i].n === named[j].n) continue
      const a = named[i].p
      const b = named[j].p
      const ends = [
        [a[0], a[1], b[0], b[1]],
        [a[0], a[1], b[b.length - 3], b[b.length - 2]],
        [a[a.length - 3], a[a.length - 2], b[0], b[1]],
        [a[a.length - 3], a[a.length - 2], b[b.length - 3], b[b.length - 2]],
      ]
      for (const [ax, az, bx0, bz0] of ends) {
        if (dist2(ax, az, bx0, bz0) < 140 && streetSigns.length < 70) {
          const { ang } = nearestSegAngle(ax, az, [named[i]])
          streetSigns.push({ name: named[i].n, x: r1((ax + bx0) / 2), z: r1((az + bz0) / 2), ang })
        }
      }
    }
  }

  const places = [
    { id: 'downtown', name: 'Downtown Lafayette', x: spawn.x, z: spawn.z },
    { id: 'reservoir', name: 'Lafayette Reservoir', x: r1(heliSpot.x), z: r1(heliSpot.z) },
    { id: 'bart', name: 'Lafayette Station', x: bart.x, z: bart.z },
    { id: 'overlook', name: 'Hillside overlook', x: memorial.x, z: memorial.z },
  ]
  if (collectibles[0]) places.push({ id: 'rim', name: 'Reservoir rim', x: collectibles[0].x, z: collectibles[0].z })

  const flatWater = waters.map((w) => ({
    n: w.n,
    k: w.k,
    level: r1(w.level || waterLevel),
    p: w.p.flatMap(([x, z]) => [r1(x), r1(z)]),
  }))
  const flatCreeks = creeks
    .filter((c) => c.p.length >= 2)
    .map((c) => ({ n: c.n, p: c.p.flatMap(([x, z]) => [r1(x), r1(z)]) }))
  const flatParks = parks
    .filter((p) => p.n || Math.abs(signedArea(p.p)) > 2500)
    .slice(0, 80)
    .map((p) => ({ n: p.n, p: simplify(p.p, 6).flatMap(([x, z]) => [r1(x), r1(z)]) }))

  const meta = {
    attribution: '© OpenStreetMap contributors (ODbL)',
    terrainAttribution: 'Elevation: USGS 3DEP / SRTM via AWS Terrain Tiles (terrarium)',
    origin: ORIGIN,
    bbox: { south: SOUTH, west: WEST, north: NORTH, east: EAST },
    chunkSize: CHUNK,
    spawn,
    places,
    pois: pois.slice(0, 280),
    signals,
    crossings: crossings.filter((c) => {
      const { d } = nearestSegAngle(c.x, c.z, roads.filter((rd) => rd.rank <= 4 && !rd.d))
      return d < 14
    }),
    streetSigns,
    collectibles,
    memorial,
    vehicles: {
      bike: bikeSpot,
      car: { x: r1(carSpot.x), z: r1(carSpot.z), h: heading + Math.PI },
      heli: { x: r1(heliSpot.x), z: r1(heliSpot.z), h: -0.6 },
    },
    terrain: {
      cols: COLS,
      rows: ROWS,
      originX: r1(minX),
      originZ: r1(minZ),
      sizeX: r1(sizeX),
      sizeZ: r1(sizeZ),
      minElev: r1(minElev),
      maxElev: r1(maxElev),
      waterLevel: r1(waterLevel),
    },
    stats: {
      roads: roads.length,
      buildings: buildingCount,
      trees: trees.length,
      pois: pois.length,
      signals: signals.length,
      crossings: crossings.length,
      chunks: Object.keys(chunks).length,
      waters: waters.length,
      parks: parks.length,
    },
  }

  const header = Buffer.alloc(44)
  header.write('LFHT', 0)
  header.writeUInt32LE(COLS, 4)
  header.writeUInt32LE(ROWS, 8)
  header.writeFloatLE(minX, 12)
  header.writeFloatLE(minZ, 16)
  header.writeFloatLE(sizeX, 20)
  header.writeFloatLE(sizeZ, 24)
  header.writeFloatLE(minElev, 28)
  header.writeFloatLE(maxElev, 32)
  header.writeFloatLE(waterLevel, 36)
  header.writeUInt32LE(0, 40)
  const hBuf = Buffer.alloc(COLS * ROWS * 2)
  for (let i = 0; i < heights.length; i++) {
    let dm = Math.round(heights[i] * 10)
    if (dm > 32767) dm = 32767
    if (dm < -32768) dm = -32768
    hBuf.writeInt16LE(dm, i * 2)
  }
  writeFileSync(join(OUT, 'terrain.bin'), Buffer.concat([header, hBuf, Buffer.from(flags)]))

  const roadsOut = roads.map(({ rank, ...rest }) => rest)
  writeFileSync(join(OUT, 'roads.json'), JSON.stringify(roadsOut))
  writeFileSync(join(OUT, 'chunks.json'), JSON.stringify(chunks))
  writeFileSync(join(OUT, 'water.json'), JSON.stringify({ bodies: flatWater, creeks: flatCreeks, parks: flatParks }))
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta))
  writeFileSync(
    join(OUT, 'ATTRIBUTION.txt'),
    [
      'Lafayette Days map data',
      '© OpenStreetMap contributors. https://www.openstreetmap.org/copyright',
      'This extract is made available under the Open Database License (ODbL) 1.0.',
      'https://opendatacommons.org/licenses/odbl/',
      '',
      'Elevation: AWS Terrain Tiles in terrarium encoding, derived from USGS 3DEP and SRTM.',
      'USGS data is in the public domain. SRTM is courtesy of NASA.',
      '',
      `BBox: ${SOUTH},${WEST},${NORTH},${EAST}`,
      `Baked: ${new Date().toISOString()}`,
      '',
    ].join('\n'),
  )

  console.log('stats', meta.stats)
  console.log('spawn', spawn)
  console.log('vehicles', meta.vehicles)
  console.log('places', places)
  console.log('collectibles', collectibles.length)
  console.log('wrote', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
