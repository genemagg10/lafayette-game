#!/usr/bin/env python3
"""Resample USGS 3DEP 1 m DEM tiles onto the playable heightfield.

Tiles (public domain):
  CA_NoCAL_Wildfires_B5b_2018 x57y420 and x58y420
  CA_AlamedaCounty_2021_B21 x57y420, preferred where it has data

Water cells keep the surveyed reservoir surface. A 5-point median
smooths single-meter spikes before the game's own spike pass.
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform as crs_transform

ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / "public" / "data" / "terrain.bin"
TILES = [
    Path("/tmp/dem/x57-2021.tif"),
    Path("/tmp/dem/x57.tif"),
    Path("/tmp/dem/x58.tif"),
]
F_WATER = 1
ORIGIN_LAT = 37.888
ORIGIN_LON = -122.125
M_LAT = 111320
M_LON = 111320 * math.cos(math.radians(ORIGIN_LAT))


def main() -> None:
    blob = TERRAIN.read_bytes()
    magic, cols, rows = struct.unpack_from("<4sII", blob, 0)
    if magic != b"LFHT":
        raise SystemExit("terrain.bin is not LFHT")
    origin_x, origin_z, size_x, size_z, min_elev, max_elev, water = struct.unpack_from("<7f", blob, 12)
    count = cols * rows
    heights = np.frombuffer(blob[44 : 44 + count * 2], dtype="<i2").astype(np.float32) / 10
    flags = np.frombuffer(blob[44 + count * 2 : 44 + count * 3], dtype=np.uint8).copy()
    water_mask = (flags & F_WATER) != 0
    samples = np.full((5, count), np.nan, dtype=np.float64)
    offsets = [(0, 0), (6, 0), (-6, 0), (0, 6), (0, -6)]
    sources = [rasterio.open(path) for path in TILES if path.exists() and path.stat().st_size > 10000]
    if len(sources) < 2:
        raise SystemExit(f"expected the 1 m tiles in /tmp/dem, opened {len(sources)}")
    print("opened", [src.name for src in sources])
    try:
        for s, (dx, dz) in enumerate(offsets):
            cols_i = np.arange(count) % cols
            rows_i = np.arange(count) // cols
            xs = origin_x + (cols_i / (cols - 1)) * size_x + dx
            zs = origin_z + (rows_i / (rows - 1)) * size_z + dz
            lats = ORIGIN_LAT - zs / M_LAT
            lons = ORIGIN_LON + xs / M_LON
            filled = np.zeros(count, dtype=bool)
            for src in sources:
                todo = np.flatnonzero(~water_mask & ~filled)
                if todo.size == 0:
                    break
                east, north = crs_transform("EPSG:4326", src.crs, lons[todo], lats[todo])
                coords = list(zip(east, north))
                vals = np.fromiter((v[0] for v in src.sample(coords)), dtype=np.float64, count=todo.size)
                nodata = src.nodata
                ok = np.isfinite(vals) & (vals > -100) & (vals < 1500)
                if nodata is not None:
                    ok &= np.abs(vals - nodata) > 1
                samples[s, todo[ok]] = vals[ok]
                filled[todo[ok]] = True
            print(f"offset {dx},{dz} filled {int(filled.sum())} / {int((~water_mask).sum())}")
    finally:
        for src in sources:
            src.close()
    med = np.nanmedian(samples, axis=0)
    new = heights.copy()
    use = ~water_mask & np.isfinite(med)
    new[use] = med[use].astype(np.float32)
    land = new[~water_mask]
    min_elev = float(land.min())
    max_elev = float(land.max())
    header = bytearray(blob[:44])
    struct.pack_into("<2f", header, 28, min_elev, max_elev)
    out_h = np.clip(np.round(new * 10), -32768, 32767).astype("<i2")
    TERRAIN.write_bytes(bytes(header) + out_h.tobytes() + flags.tobytes())
    delta = (new - heights)[~water_mask]
    print(f"cells {int(use.sum())} water kept {int(water_mask.sum())} elev {min_elev:.1f}..{max_elev:.1f}")
    print(f"land delta m  p50 {np.median(delta):.2f}  p95 {np.percentile(np.abs(delta), 95):.2f}  max {np.max(np.abs(delta)):.2f}")


if __name__ == "__main__":
    main()
