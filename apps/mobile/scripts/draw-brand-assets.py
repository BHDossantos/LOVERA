#!/usr/bin/env python3
"""Draw the brand mark and write the app's icon, splash and adaptive-icon assets as PNGs.

No image library is available here, so this is a small RGBA8 PNG writer plus analytic coverage
with 4x4 supersampling. That is enough for a mark made of circles, and it keeps the assets
reproducible from source rather than being binaries nobody can regenerate.

The mark: two overlapping rings with the lens between them filled. Two people, one shared space.
It is not a heart, because every dating app is a heart, and it survives being 48 pixels wide.
"""
from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

OUT = Path(sys.argv[1])

ROSE = (0xB4, 0x2D, 0x55)
ROSE_LIGHT = (0xC6, 0x3C, 0x65)
ROSE_DARK = (0x8A, 0x20, 0x42)
WARM_WHITE = (0xFF, 0xFA, 0xF8)
CANVAS = (0xFD, 0xF7, 0xF4)

# Mark geometry, in units of the mark's own bounding box width.
R = 0.26          # circle radius
D = 0.155         # half the distance between the two centres
STROKE = 0.075    # ring thickness
SS = 4            # supersampling per axis


def coverage(x: int, y: int, origin: float, span: float) -> float:
    """How much of pixel (x, y) the mark covers.

    The subpixel offsets are added in *pixel* space and only then mapped into the mark's unit
    space. Adding them to the unit coordinate instead offsets each sample by a quarter of the
    whole mark, which renders the thing tiled across the canvas rather than antialiased.
    """
    hits = 0
    for sy in range(SS):
        for sx in range(SS):
            px = (x + (sx + 0.5) / SS - origin) / span
            py = (y + (sy + 0.5) / SS - origin) / span
            d1 = math.hypot(px - (0.5 - D), py - 0.5)
            d2 = math.hypot(px - (0.5 + D), py - 0.5)
            on_ring = abs(d1 - R) < STROKE / 2 or abs(d2 - R) < STROKE / 2
            in_lens = d1 < R and d2 < R
            if on_ring or in_lens:
                hits += 1
    return hits / (SS * SS)


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def render(
    size: int,
    *,
    mark: tuple[int, int, int],
    background: tuple[tuple[int, int, int], tuple[int, int, int]] | None,
    scale: float,
) -> bytes:
    """`background` is a top-to-bottom gradient pair, or None for transparency.

    `scale` is the mark's bounding box as a fraction of the canvas.
    """
    span = size * scale
    origin = (size - span) / 2
    plain = scale <= 0  # a background plate: the gradient with no mark on it
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # filter: none
        if background is None:
            base = (0, 0, 0, 0)
        else:
            r, g, b = lerp(background[0], background[1], y / max(size - 1, 1))
            base = (r, g, b, 255)
        for x in range(size):
            a = 0.0 if plain else coverage(x, y, origin, span)
            if a <= 0:
                rows += bytes(base)
                continue
            if base[3] == 0:
                rows += bytes((*mark, round(a * 255)))
            else:
                rows += bytes((*(lerp(base[:3], mark, a)), 255))
    return bytes(rows)


def drop_alpha(raw: bytes, size: int) -> bytes:
    """RGBA scanlines to RGB ones.

    App Store Connect rejects an icon that carries an alpha channel at all — "Invalid Image - the
    icon can't be transparent nor contain an alpha channel" — even when every pixel in it is
    opaque. So anything with a background is written as colour type 2.
    """
    out = bytearray()
    stride = 1 + size * 4
    for y in range(size):
        row = raw[y * stride : (y + 1) * stride]
        out.append(row[0])
        for x in range(size):
            out += row[1 + x * 4 : 1 + x * 4 + 3]
    return bytes(out)


def png(path: Path, size: int, raw: bytes, *, opaque: bool = False) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    if opaque:
        raw = drop_alpha(raw, size)
    header = struct.pack(">IIBBBBB", size, size, 8, 2 if opaque else 6, 0, 0, 0)
    body = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(body)
    print(f"{path.name}: {size}x{size} {'RGB' if opaque else 'RGBA'}, {len(body):,} bytes")


# The home-screen icon: the mark reversed out of a deep rose field, full bleed, no transparency
# and no rounded corners of its own (both platforms mask it themselves).
png(OUT / "icon.png", 1024, render(1024, mark=WARM_WHITE, background=(ROSE_LIGHT, ROSE_DARK), scale=0.62), opaque=True)

# The splash mark sits on BRAND_BACKGROUND, which app.config.ts supplies, so it is transparent.
png(OUT / "splash-icon.png", 1024, render(1024, mark=ROSE, background=None, scale=0.46))

# Android adaptive icon: the foreground is masked to a shape that can crop ~33% off, so the mark
# stays well inside the safe zone.
png(OUT / "android-icon-foreground.png", 512, render(512, mark=WARM_WHITE, background=None, scale=0.56))
png(OUT / "android-icon-background.png", 512, render(512, mark=ROSE_DARK, background=(ROSE_LIGHT, ROSE_DARK), scale=0.0), opaque=True)

# Themed icons are tinted by the launcher from the alpha channel alone, so only the shape matters.
png(OUT / "android-icon-monochrome.png", 432, render(432, mark=(0, 0, 0), background=None, scale=0.56))

# RGBA, with every pixel opaque. Next.js decodes `app/favicon.ico` at build time and refuses an
# embedded PNG that is not RGBA ("The PNG is not in RGBA format!"), and the same file is the web
# favicon, so one format has to satisfy both.
png(OUT / "favicon.png", 48, render(48, mark=ROSE, background=(CANVAS, CANVAS), scale=0.78))

# The web favicon. A real ICO container with a PNG payload inside it (supported everywhere since
# Windows Vista), because Next.js serves `app/favicon.ico` verbatim and a PNG renamed to .ico is
# the kind of thing that works until something validates it.
WEB_ICON = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if WEB_ICON:
    payload = (OUT / "favicon.png").read_bytes()
    directory = struct.pack("<BBBBHHII", 48, 48, 0, 0, 1, 32, len(payload), 22)
    WEB_ICON.write_bytes(struct.pack("<HHH", 0, 1, 1) + directory + payload)
    print(f"{WEB_ICON.name}: ICO wrapping a 48x48 PNG, {WEB_ICON.stat().st_size:,} bytes")
