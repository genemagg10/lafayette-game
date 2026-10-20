#!/usr/bin/env python3
"""Turn data/pois.geojson into the game's pois.json and businesses.json.

Storefront color, material, and signage are unknown in the research.
businesses.json style fields are pale stand-ins. Edit style to override one shop.
"""

from __future__ import annotations

import json
import re
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "pois.geojson"
POIS_OUT = ROOT / "public" / "data" / "pois.json"
BIZ_OUT = ROOT / "public" / "data" / "businesses.json"

# Pale tints. Vertex color multiplies the cream storefront texture.
PALETTES = {
    "restaurant": ("#f0d2c4", "#c46a4a"),
    "cafe": ("#e7efe4", "#6e8f72"),
    "shop": ("#e4eaf3", "#6d88a8"),
    "bank": ("#e7e4df", "#8d8680"),
    "fuel": ("#f3e4d4", "#c47a45"),
    "bar": ("#e7ebe4", "#3f6b4e"),
    "fast_food": ("#f6e7d2", "#d08948"),
    "health": ("#e4efe8", "#6e9a86"),
    "therapist": ("#e6e8f2", "#7d86a8"),
    "yes": ("#efe8df", "#a89480"),
}
FALLBACK = ("#f3efe6", "#8a8178")


def approximate(props: dict) -> bool:
    confidence = str(props.get("confidence") or "").lower()
    coord = str(props.get("coord_source") or "")
    if confidence == "low":
        return True
    return bool(re.search(r"approximate|interpolat|verify|segment", coord, re.I))


def person(row: dict) -> dict:
    return {
        "name": row.get("name") or "",
        "role": row.get("role") or "",
        "contribution": row.get("contribution") or row.get("blurb") or "",
        "source": row.get("source") or "",
    }


def main() -> None:
    raw = json.loads(SRC.read_text())
    landmarks = []
    businesses = []
    for feature in raw["features"]:
        props = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"]
        category = props.get("category") or ""
        approx = approximate(props)
        if category.startswith("business"):
            kind = category.split(":", 1)[-1]
            light, accent = PALETTES.get(kind, FALLBACK)
            # Stable variety: some shops take a neighboring pale from the same family.
            if zlib.crc32(props["name"].encode()) % 2 == 0:
                wall, awning = light, accent
            else:
                wall, awning = FALLBACK[0], accent
            businesses.append(
                {
                    "name": props["name"],
                    "lat": lat,
                    "lon": lon,
                    "category": category,
                    "address": props.get("address"),
                    "confidence": props.get("confidence"),
                    "approximate": approx,
                    "coord_source": props.get("coord_source"),
                    "source": props.get("source"),
                    "style": {
                        "wall": wall,
                        "awning": awning,
                        "note": "Storefront color and signage are unknown. Edit wall and awning to override this shop.",
                    },
                }
            )
            continue
        people = [person(p) for p in (props.get("people") or []) if p.get("name")]
        landmarks.append(
            {
                "name": props["name"],
                "lat": lat,
                "lon": lon,
                "history": props.get("description") or "",
                "people": people,
                "approximate": approx,
                "confidence": props.get("confidence"),
                "category": category,
                "source": props.get("source"),
                "coord_source": props.get("coord_source"),
            }
        )
    POIS_OUT.write_text(json.dumps(landmarks, indent=2) + "\n")
    BIZ_OUT.write_text(
        json.dumps(
            {
                "note": "Storefront color, material, and signage are unknown in the Lafayette research. style.wall and style.awning are pale stand-ins. Change them on a business to override that facade. approximate marks a low-confidence, interpolated, or partial-segment geocode.",
                "businesses": businesses,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"landmarks {len(landmarks)} businesses {len(businesses)} approximate landmarks {sum(1 for p in landmarks if p['approximate'])}")


if __name__ == "__main__":
    main()
