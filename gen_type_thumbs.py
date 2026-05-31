#!/usr/bin/env python3
"""
Generate three generic type-icon thumbnails (320×180) for the Data Library.
  type-raster.png   — continuous raster / elevation data
  type-lines.png    — vector line features
  type-polygon.png  — vector polygon features
App theme: background #1a2820 (dark green), accent #4ade80 (bright green)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path("public/layer-thumbs")
OUT.mkdir(parents=True, exist_ok=True)
W, H = 320, 180

BG = (26, 40, 32)        # #1a2820
ACCENT = (74, 222, 128)  # #4ade80

# ── Raster icon ───────────────────────────────────────────────────────────────
# Smooth 2-D gradient field suggesting continuous pixel data, with a subtle
# pixel-grid overlay to hint at raster structure.

def make_raster():
    # Build a smooth two-axis gradient
    xs = np.linspace(0, 1, W)
    ys = np.linspace(0, 1, H)
    xg, yg = np.meshgrid(xs, ys)
    # diagonal gradient field
    field = (xg * 0.6 + yg * 0.4)

    # 8-stop colour ramp: deep blue → teal → green → yellow-green
    stops = [
        (0.00, (30,  60, 160)),
        (0.14, (40,  90, 185)),
        (0.28, (50, 145, 180)),
        (0.42, (60, 175, 140)),
        (0.55, (80, 190,  90)),
        (0.68, (140, 200, 60)),
        (0.82, (195, 210, 55)),
        (1.00, (230, 200, 80)),
    ]
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    for i in range(len(stops) - 1):
        v0, c0 = stops[i]
        v1, c1 = stops[i + 1]
        mask = (field >= v0) & (field < v1)
        t = np.clip((field[mask] - v0) / (v1 - v0), 0, 1)
        for ch in range(3):
            rgb[mask, ch] = c0[ch] + t * (c1[ch] - c0[ch])
    last_v, last_c = stops[-1]
    rgb[field >= last_v] = last_c

    # Add gentle noise for texture
    rng = np.random.default_rng(7)
    noise = rng.integers(-12, 12, (H, W, 3))
    rgb = np.clip(rgb + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(1))

    # Subtle pixel-grid overlay (every 20px)
    draw = ImageDraw.Draw(img)
    grid_col = (0, 0, 0, 40)
    for x in range(0, W, 20):
        draw.line([(x, 0), (x, H)], fill=(0, 0, 0), width=1)
    for y in range(0, H, 20):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0), width=1)

    img.save(OUT / "type-raster.png", optimize=True)
    print("  type-raster.png")


# ── Lines icon ────────────────────────────────────────────────────────────────
# Three smooth polylines at different scales on the dark app background,
# suggesting river/road/contour vector line data.

def make_lines():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Main feature line — wide, bright accent green, gently sinuous
    pts1 = [(0, 105), (40, 98), (80, 108), (120, 92), (160, 100),
            (200, 88), (240, 98), (280, 85), (320, 92)]
    for i in range(len(pts1) - 1):
        draw.line([pts1[i], pts1[i+1]], fill=(74, 222, 128), width=4)

    # Secondary line — thinner, cool teal
    pts2 = [(0, 60), (50, 52), (100, 68), (150, 55), (200, 65),
            (250, 50), (320, 58)]
    for i in range(len(pts2) - 1):
        draw.line([pts2[i], pts2[i+1]], fill=(56, 189, 248), width=2)

    # Tertiary line — dashed-look thin amber
    pts3 = [(0, 140), (60, 132), (120, 148), (180, 135), (240, 145), (320, 130)]
    for i in range(len(pts3) - 1):
        draw.line([pts3[i], pts3[i+1]], fill=(251, 191, 36), width=2)

    # Short tributary off main line
    pts4 = [(160, 100), (170, 130), (185, 155), (195, H)]
    for i in range(len(pts4) - 1):
        draw.line([pts4[i], pts4[i+1]], fill=(74, 222, 128), width=2)

    img = img.filter(ImageFilter.SMOOTH)
    img.save(OUT / "type-lines.png", optimize=True)
    print("  type-lines.png")


# ── Polygon icon ──────────────────────────────────────────────────────────────
# Three overlapping filled polygons with visible borders on the dark background,
# suggesting area-based vector data (parcels, habitat zones, wetlands, etc.).

def make_polygon():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Large background polygon — muted teal fill
    poly1 = [(20, 25), (175, 18), (210, 80), (185, 145), (110, 158), (30, 130)]
    draw.polygon(poly1, fill=(40, 90, 75), outline=(74, 222, 128), width=2)

    # Mid polygon — muted blue-green
    poly2 = [(155, 30), (295, 22), (308, 100), (275, 158), (200, 162), (150, 110)]
    draw.polygon(poly2, fill=(35, 70, 100), outline=(56, 189, 248), width=2)

    # Small foreground polygon — warm amber tint, sits in the overlap
    poly3 = [(110, 75), (210, 68), (230, 128), (190, 155), (105, 148)]
    draw.polygon(poly3, fill=(65, 55, 30), outline=(251, 191, 36), width=2)

    img.save(OUT / "type-polygon.png", optimize=True)
    print("  type-polygon.png")


print("Generating type icon thumbnails…")
make_raster()
make_lines()
make_polygon()
print("Done.")
