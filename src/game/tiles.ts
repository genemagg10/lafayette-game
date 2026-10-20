/**
 * OpenMapTiles-style vector tiles in a local meter grid.
 *
 * Layer names match the OpenMapTiles schema (building, transportation,
 * poi, landuse). Tree, parking, crossing, and reed are Lafayette detail
 * layers a whole-Earth stream would fold into landcover.
 *
 * Tile ids are `{zoom}/{x}/{y}`. x is east, y is south. Coordinates inside
 * a tile are absolute meters (x east, z south, elevation up) so the same
 * reader can later sit on a Web Mercator source by swapping `tileOf`.
 */

export interface TileSet {
  schema: string
  profile: string
  zoom: number
  tileMeters: number
  originX: number
  originZ: number
  layers: string[]
  present: number[][]
  /** Tiles that carry downtown-density labels, parapets, and facades. */
  rich: number[][]
}

export interface VectorTile {
  building?: unknown[][]
  transportation?: unknown[][]
  poi?: unknown[][]
  landuse?: unknown[][]
  parking?: number[][]
  crossing?: number[][]
  tree?: number[]
  reed?: number[]
}

export function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`
}

export function tileOf(x: number, z: number, originX: number, originZ: number, tileMeters: number): [number, number] {
  return [Math.floor((x - originX) / tileMeters), Math.floor((z - originZ) / tileMeters)]
}
