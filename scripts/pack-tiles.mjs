/**
 * Pack the baked Lafayette map into OpenMapTiles-style vector tiles.
 * No network. Reads public/data and writes public/data/tileset.json
 * plus public/data/tiles/{z}/{x}/{y}.json.
 *
 * Layers follow the OpenMapTiles vocabulary (building, transportation,
 * poi, landuse) plus Lafayette detail layers (tree, parking, crossing, reed)
 * that a whole-Earth stream would collapse into landcover.
 *
 *   npm run tiles
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const ZOOM = 16
const TILE = 512

const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8'))
const roads = JSON.parse(readFileSync(join(DATA, 'roads.json'), 'utf8'))
const chunks = JSON.parse(readFileSync(join(DATA, 'chunks.json'), 'utf8'))
const water = JSON.parse(readFileSync(join(DATA, 'water.json'), 'utf8'))

const OX = meta.terrain.originX
const OZ = meta.terrain.originZ
const spawn = meta.spawn
const place = (id) => meta.places.find((p) => p.id === id) ?? spawn

function r1(n) {
  return Math.round(n * 10) / 10
}

function tileOf(x, z) {
  return [Math.floor((x - OX) / TILE), Math.floor((z - OZ) / TILE)]
}

function tileBox(tx, tz) {
  return {
    minX: OX + tx * TILE,
    maxX: OX + (tx + 1) * TILE,
    minZ: OZ + tz * TILE,
    maxZ: OZ + (tz + 1) * TILE,
  }
}

function keyOf(tx, tz) {
  return `${tx},${tz}`
}

const tiles = new Map()
function bucket(tx, tz) {
  const key = keyOf(tx, tz)
  let tile = tiles.get(key)
  if (!tile) {
    tile = { tx, tz }
    tiles.set(key, tile)
  }
  return tile
}

function push(tile, layer, value) {
  if (!tile[layer]) tile[layer] = []
  tile[layer].push(value)
}

function clipSeg(a, b, box) {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dz = b.z - a.z
  const p = [-dx, dx, -dz, dz]
  const q = [a.x - box.minX, box.maxX - a.x, a.z - box.minZ, box.maxZ - a.z]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) {
      if (q[i] < 0) return null
    } else {
      const r = q[i] / p[i]
      if (p[i] < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  const mix = (t) => ({
    x: a.x + dx * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + dz * t,
  })
  return { a: mix(t0), b: mix(t1) }
}

function clipPolyline(pts, box) {
  const parts = []
  let cur = []
  const flush = () => {
    if (cur.length >= 2) parts.push(cur)
    cur = []
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const hit = clipSeg(pts[i], pts[i + 1], box)
    if (!hit) {
      flush()
      continue
    }
    if (!cur.length) cur.push(hit.a)
    else if (Math.hypot(cur[cur.length - 1].x - hit.a.x, cur[cur.length - 1].z - hit.a.z) > 0.08) {
      flush()
      cur.push(hit.a)
    }
    cur.push(hit.b)
  }
  flush()
  return parts
}

function tilesTouched(pts) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  const a = tileOf(minX, minZ)
  const b = tileOf(maxX, maxZ)
  const out = []
  for (let tz = a[1]; tz <= b[1]; tz++) {
    for (let tx = a[0]; tx <= b[0]; tx++) out.push([tx, tz])
  }
  return out
}

for (const road of roads) {
  const n = road.p.length / 3
  if (n < 2) continue
  const pts = []
  for (let i = 0; i < n; i++) {
    pts.push({ x: road.p[i * 3], z: road.p[i * 3 + 1], y: road.p[i * 3 + 2] })
  }
  const flags = (road.s ? 1 : 0) | (road.d ? 2 : 0) | (road.b ? 4 : 0) | (road.o ? 8 : 0)
  for (const [tx, tz] of tilesTouched(pts)) {
    const parts = clipPolyline(pts, tileBox(tx, tz))
    for (const part of parts) {
      const flat = [road.t || 'service', road.n || '', r1(road.w), flags, road.l || 0]
      for (const p of part) flat.push(r1(p.x), r1(p.y), r1(p.z))
      push(bucket(tx, tz), 'transportation', flat)
    }
  }
}

for (const key of Object.keys(chunks)) {
  const data = chunks[key]
  for (const raw of data.b || []) {
    if (!Array.isArray(raw) || raw.length < 12) continue
    let cx = 0
    let cz = 0
    const n = (raw.length - 6) / 2
    for (let i = 0; i < n; i++) {
      cx += Number(raw[6 + i * 2])
      cz += Number(raw[7 + i * 2])
    }
    cx /= n
    cz /= n
    const [tx, tz] = tileOf(cx, cz)
    push(bucket(tx, tz), 'building', raw)
  }
  const trees = data.t || []
  for (let i = 0; i < trees.length; i += 3) {
    const [tx, tz] = tileOf(trees[i], trees[i + 1])
    const tile = bucket(tx, tz)
    if (!tile.tree) tile.tree = []
    tile.tree.push(r1(trees[i]), r1(trees[i + 1]), trees[i + 2])
  }
  const reeds = data.reeds || []
  for (let i = 0; i < reeds.length; i += 2) {
    const [tx, tz] = tileOf(reeds[i], reeds[i + 1])
    const tile = bucket(tx, tz)
    if (!tile.reed) tile.reed = []
    tile.reed.push(r1(reeds[i]), r1(reeds[i + 1]))
  }
  for (const lot of data.parking || []) {
    if (!lot || lot.length < 6) continue
    let cx = 0
    let cz = 0
    const n = lot.length / 2
    for (let i = 0; i < n; i++) {
      cx += lot[i * 2]
      cz += lot[i * 2 + 1]
    }
    const [tx, tz] = tileOf(cx / n, cz / n)
    push(bucket(tx, tz), 'parking', lot)
  }
}

for (const poi of meta.pois) {
  if (!poi.n || /^\d+$/.test(String(poi.n).trim())) continue
  const [tx, tz] = tileOf(poi.x, poi.z)
  push(bucket(tx, tz), 'poi', [poi.n, poi.k || 'yes', r1(poi.x), r1(poi.z)])
}

for (const spot of meta.places) {
  const [tx, tz] = tileOf(spot.x, spot.z)
  push(bucket(tx, tz), 'poi', [spot.name, 'place', r1(spot.x), r1(spot.z)])
}

for (const cross of meta.crossings) {
  const [tx, tz] = tileOf(cross.x, cross.z)
  push(bucket(tx, tz), 'crossing', [r1(cross.x), r1(cross.z), cross.ang])
}

for (const park of water.parks || []) {
  const n = park.p.length / 2
  if (n < 3) continue
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += park.p[i * 2]
    cz += park.p[i * 2 + 1]
  }
  const [tx, tz] = tileOf(cx / n, cz / n)
  push(bucket(tx, tz), 'landuse', ['park', park.n || '', ...park.p])
}

const anchors = [
  [spawn.x, spawn.z, 760],
  [place('reservoir').x, place('reservoir').z, 620],
  [place('bart').x, place('bart').z, 480],
  [place('overlook').x, place('overlook').z, 420],
]

const present = []
const rich = []
const outRoot = join(DATA, 'tiles')
rmSync(outRoot, { recursive: true, force: true })

let bytes = 0
for (const tile of tiles.values()) {
  const cx = OX + (tile.tx + 0.5) * TILE
  const cz = OZ + (tile.tz + 0.5) * TILE
  const isRich = anchors.some(([x, z, radius]) => (cx - x) ** 2 + (cz - z) ** 2 < radius * radius)
  const body = {}
  for (const layer of ['building', 'transportation', 'poi', 'landuse', 'parking', 'crossing']) {
    if (tile[layer]?.length) body[layer] = tile[layer]
  }
  if (tile.tree?.length) body.tree = tile.tree
  if (tile.reed?.length) body.reed = tile.reed
  const json = JSON.stringify(body)
  const dir = join(outRoot, String(ZOOM), String(tile.tx))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${tile.tz}.json`), json)
  bytes += json.length
  present.push([tile.tx, tile.tz])
  if (isRich) rich.push([tile.tx, tile.tz])
}

present.sort((a, b) => a[0] - b[0] || a[1] - b[1])
rich.sort((a, b) => a[0] - b[0] || a[1] - b[1])

const tileset = {
  schema: 'openmaptiles',
  profile: 'lafayette-local',
  zoom: ZOOM,
  tileMeters: TILE,
  originX: OX,
  originZ: OZ,
  layers: ['building', 'transportation', 'poi', 'landuse', 'tree', 'parking', 'crossing', 'reed'],
  note: 'OSM-derived vector tiles in the OpenMapTiles layer vocabulary. x is east meters, z is south meters, tile y grows south. A later Earth source can reuse these layer names.',
  present,
  rich,
}
writeFileSync(join(DATA, 'tileset.json'), JSON.stringify(tileset))

console.log(`tiles ${present.length} rich ${rich.length} ${(bytes / 1024 / 1024).toFixed(2)} MB`)
