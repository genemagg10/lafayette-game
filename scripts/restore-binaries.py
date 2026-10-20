#!/usr/bin/env python3
"""Rebuild binary map files from ASCII parts.

GitHub's file API stores text as UTF-8, which corrupts terrain.bin and lion.spz.
Those two files are uploaded as ordered base64 parts named
`<path>.b64part.NN`. This step runs in GitHub Actions before the Vite build.
When the parts are absent, the real files already in the tree are left alone.
"""

import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGETS = (
    "public/data/terrain.bin",
    "public/splats/lion.spz",
)


def main() -> None:
    for rel in TARGETS:
        dest = ROOT / rel
        parts = sorted(ROOT.glob(rel + ".b64part.*"))
        if not parts:
            continue
        text = "".join(part.read_text() for part in parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(base64.b64decode(text))
        print(f"restored {rel} ({dest.stat().st_size} bytes) from {len(parts)} parts")


if __name__ == "__main__":
    main()
