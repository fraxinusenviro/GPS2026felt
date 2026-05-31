#!/usr/bin/env python3
"""
Generate representative PNG thumbnails (320×180) for each Data Library layer.
Output: public/layer-thumbs/<id>.png
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

OUT = Path("public/layer-thumbs")
OUT.mkdir(parents=True, exist_ok=True)
W, H = 320, 180
rng = np.random.default_rng(42)

# ── helpers ─────────────────────────────────────────────────────────────────

def perlin_like(w, h, scale=40, octaves=5, seed=0):
    """Layered random smooth noise → plausible terrain heightfield [0,1]."""
    rng2 = np.random.default_rng(seed)
    field = np.zeros((h, w))
    amp = 1.0
    freq = 1.0
    for _ in range(octaves):
        s = max(1, int(scale / freq))
        small = rng2.random((max(1, h // s + 2), max(1, w // s + 2))).astype(np.float32)
        # resize by repeating and interpolating
        ys = np.linspace(0, small.shape[0] - 1, h)
        xs = np.linspace(0, small.shape[1] - 1, w)
        yi = np.floor(ys).astype(int)
        xi = np.floor(xs).astype(int)
        yi = np.clip(yi, 0, small.shape[0] - 2)
        xi = np.clip(xi, 0, small.shape[1] - 2)
        fy = ys - yi
        fx = xs - xi
        interp = (small[yi, :][:, xi] * (1 - fy[:, None]) * (1 - fx[None, :]) +
                  small[yi + 1, :][:, xi] * fy[:, None] * (1 - fx[None, :]) +
                  small[yi, :][:, xi + 1] * (1 - fy[:, None]) * fx[None, :] +
                  small[yi + 1, :][:, xi + 1] * fy[:, None] * fx[None, :])
        field += amp * interp
        amp *= 0.5
        freq *= 2.0
    field -= field.min()
    mx = field.max()
    if mx > 0:
        field /= mx
    return field

def hillshade(dem, az_deg=315, alt_deg=45):
    """Simple hillshade from DEM array."""
    az = math.radians(az_deg)
    alt = math.radians(alt_deg)
    dy, dx = np.gradient(dem * 30)
    slope = np.arctan(np.sqrt(dx**2 + dy**2))
    aspect = np.arctan2(-dy, dx)
    shade = (np.sin(alt) * np.cos(slope) +
             np.cos(alt) * np.sin(slope) * np.cos(az - aspect))
    shade = np.clip(shade, 0, 1)
    return shade

def apply_colormap(dem, colors):
    """Map [0,1] DEM through list of (value, R,G,B) stops."""
    h, w = dem.shape
    out = np.zeros((h, w, 3), dtype=np.uint8)
    stops = sorted(colors, key=lambda x: x[0])
    for i in range(len(stops) - 1):
        v0, r0, g0, b0 = stops[i]
        v1, r1, g1, b1 = stops[i + 1]
        mask = (dem >= v0) & (dem < v1)
        if v1 == v0:
            continue
        t = np.clip((dem[mask] - v0) / (v1 - v0), 0, 1)
        out[mask, 0] = (r0 + t * (r1 - r0)).astype(np.uint8)
        out[mask, 1] = (g0 + t * (g1 - g0)).astype(np.uint8)
        out[mask, 2] = (b0 + t * (b1 - b0)).astype(np.uint8)
    # last stop
    v, r, g, b = stops[-1]
    mask = dem >= v
    out[mask] = (r, g, b)
    return out

def save(img, name):
    img.save(OUT / f"{name}.png", optimize=True)
    print(f"  {name}.png")

def label_img(img, text, color=(255,255,255,160), size=11):
    """Burn a small label into bottom-left of image."""
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, H - 18, W, H], fill=(0, 0, 0, 120))
    draw.text((5, H - 15), text, fill=color[:3])
    return img

# ── ESRI Imagery ─────────────────────────────────────────────────────────────
def gen_esri_imagery():
    dem = perlin_like(W, H, scale=60, octaves=6, seed=1)
    # mix of dark forest greens, farm fields, bare ground
    colors = [
        (0.0,  20, 40, 15),    # dark forest
        (0.25, 35, 65, 25),
        (0.45, 75, 95, 45),    # lighter vegetation
        (0.6,  140,160, 80),   # fields
        (0.72, 190,175,130),   # sandy/bare
        (0.85, 160,145,110),
        (1.0,  200,195,180),   # exposed rock
    ]
    rgb = apply_colormap(dem, colors)
    # add noise texture to look more like satellite
    noise = rng.integers(-18, 18, (H, W, 3))
    rgb = np.clip(rgb.astype(int) + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    # add a few rectangular field patterns
    draw = ImageDraw.Draw(img)
    for _ in range(8):
        x0 = random.randint(10, W - 60)
        y0 = random.randint(10, H - 40)
        x1 = x0 + random.randint(20, 60)
        y1 = y0 + random.randint(15, 35)
        col = (random.randint(60,120), random.randint(80,130), random.randint(30,70), 60)
        draw.rectangle([x0,y0,x1,y1], outline=col[:3])
    save(img, "esri-imagery")

# ── ESRI Hybrid ──────────────────────────────────────────────────────────────
def gen_esri_hybrid():
    dem = perlin_like(W, H, scale=60, octaves=6, seed=1)
    colors = [
        (0.0,  20, 40, 15),
        (0.35, 35, 65, 25),
        (0.55, 75, 95, 45),
        (0.7,  140,160, 80),
        (0.85, 190,175,130),
        (1.0,  200,195,180),
    ]
    rgb = apply_colormap(dem, colors)
    noise = rng.integers(-15, 15, (H, W, 3))
    rgb = np.clip(rgb.astype(int) + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    draw = ImageDraw.Draw(img)
    # draw roads on top (white/yellow lines)
    pts = [(0, H//2), (W//4, H//2 - 10), (W//2, H//2 + 5), (3*W//4, H//2 - 8), (W, H//2)]
    for i in range(len(pts) - 1):
        draw.line([pts[i], pts[i+1]], fill=(255, 240, 120), width=3)
    pts2 = [(W//3, 0), (W//3 + 10, H//3), (W//3 - 5, H//2), (W//3 + 8, H)]
    for i in range(len(pts2) - 1):
        draw.line([pts2[i], pts2[i+1]], fill=(230, 230, 230), width=2)
    save(img, "esri-hybrid")

# ── OpenStreetMap ────────────────────────────────────────────────────────────
def gen_osm():
    img = Image.new("RGB", (W, H), (242, 239, 233))
    draw = ImageDraw.Draw(img)
    # background land fill patterns
    for _ in range(12):
        x0, y0 = random.randint(0, W), random.randint(0, H)
        pts = [(x0 + random.randint(-30,30), y0 + random.randint(-20,20)) for _ in range(5)]
        draw.polygon(pts, fill=(228, 236, 220))
    # water patch
    draw.ellipse([10, 100, 90, 155], fill=(170, 211, 223))
    # parks
    draw.rectangle([200, 30, 280, 90], fill=(205, 235, 176))
    # roads
    draw.line([(0, 90), (W, 90)], fill=(249, 178, 156), width=5)
    draw.line([(0, 90), (W, 90)], fill=(252, 214, 164), width=3)
    draw.line([(130, 0), (130, H)], fill=(249, 178, 156), width=4)
    draw.line([(130, 0), (130, H)], fill=(252, 214, 164), width=2)
    for i in range(4):
        y = 30 + i * 38
        draw.line([(0, y), (W, y)], fill=(200, 200, 200), width=1)
    for i in range(6):
        x = 30 + i * 50
        draw.line([(x, 0), (x, H)], fill=(200, 200, 200), width=1)
    draw.line([(W//4, 0), (W//5, H)], fill=(220, 220, 220), width=2)
    draw.line([(2*W//3, 0), (2*W//3 + 15, H)], fill=(220, 220, 220), width=2)
    save(img, "osm")

# ── Topo ─────────────────────────────────────────────────────────────────────
def gen_topo():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=5)
    # hypsometric tints
    colors = [
        (0.0,  210, 240, 200),
        (0.25, 190, 230, 160),
        (0.45, 235, 235, 175),
        (0.62, 210, 185, 140),
        (0.78, 190, 160, 110),
        (0.9,  200, 195, 185),
        (1.0,  240, 240, 240),
    ]
    rgb = apply_colormap(dem, colors)
    img = Image.fromarray(rgb)
    draw = ImageDraw.Draw(img)
    # contour lines
    for level in np.arange(0.1, 1.0, 0.08):
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if abs(dem[y, x] - level) < 0.012:
                    draw.point((x, y), fill=(160, 130, 80))
    # index contour (thicker, every 5th)
    for level in np.arange(0.1, 1.0, 0.40):
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if abs(dem[y, x] - level) < 0.018:
                    draw.point((x, y), fill=(140, 100, 50))
    # spot elevation markers
    draw.text((145, 60), "▲ 312 m", fill=(80, 50, 20))
    save(img, "topo")

# ── Default point / line / polygon ───────────────────────────────────────────
def gen_defaults():
    # point
    img = Image.new("RGB", (W, H), (26, 40, 32))
    draw = ImageDraw.Draw(img)
    for _ in range(18):
        x, y = random.randint(20, W-20), random.randint(20, H-20)
        r = random.randint(4, 9)
        draw.ellipse([x-r, y-r, x+r, y+r], fill=(74, 222, 128), outline=(26,40,32), width=1)
    save(img, "default")

    # line
    img = Image.new("RGB", (W, H), (26, 40, 32))
    draw = ImageDraw.Draw(img)
    pts = [(random.randint(0, W), random.randint(0, H)) for _ in range(8)]
    pts.sort(key=lambda p: p[0])
    for i in range(len(pts)-1):
        draw.line([pts[i], pts[i+1]], fill=(74, 222, 128), width=3)
    pts2 = [(random.randint(0, W), random.randint(0, H)) for _ in range(5)]
    pts2.sort(key=lambda p: p[0])
    for i in range(len(pts2)-1):
        draw.line([pts2[i], pts2[i+1]], fill=(96, 165, 250), width=2)
    save(img, "default-line")

    # polygon
    img = Image.new("RGB", (W, H), (26, 40, 32))
    draw = ImageDraw.Draw(img)
    polys = [
        [(40, 40), (110, 30), (130, 90), (60, 100)],
        [(160, 60), (230, 50), (250, 120), (180, 130), (150, 100)],
        [(30, 120), (100, 110), (120, 160), (50, 165)],
        [(220, 130), (290, 120), (305, 165), (235, 168)],
    ]
    colors_p = [(74, 222, 128, 80), (96, 165, 250, 80), (251, 191, 36, 80), (248, 113, 113, 80)]
    for poly, col in zip(polys, colors_p):
        # fill with alpha simulation
        draw.polygon(poly, fill=tuple(max(0,c//3) for c in col[:3]), outline=col[:3])
    save(img, "default-polygon")

# ── HRDEM DTM Hillshade ───────────────────────────────────────────────────────
def gen_hrdem_dtm_hillshade():
    dem = perlin_like(W, H, scale=45, octaves=6, seed=10)
    shade = hillshade(dem, az_deg=315, alt_deg=40)
    gray = (shade * 255).astype(np.uint8)
    rgb = np.stack([gray, gray, gray], axis=2)
    img = Image.fromarray(rgb)
    save(img, "hrdem-dtm-hillshade")

# ── HRDEM DSM Hillshade ───────────────────────────────────────────────────────
def gen_hrdem_dsm_hillshade():
    dem = perlin_like(W, H, scale=35, octaves=7, seed=11)
    # add canopy bumps
    canopy = perlin_like(W, H, scale=12, octaves=4, seed=99)
    mixed = dem * 0.7 + canopy * 0.3
    shade = hillshade(mixed, az_deg=315, alt_deg=40)
    gray = (shade * 255).astype(np.uint8)
    # slight green tint for canopy-influenced DSM
    rgb = np.stack([
        (gray * 0.88).astype(np.uint8),
        (gray * 0.95).astype(np.uint8),
        (gray * 0.88).astype(np.uint8)
    ], axis=2)
    img = Image.fromarray(rgb)
    save(img, "hrdem-dsm-hillshade")

# ── NS Plan / NSPRD ───────────────────────────────────────────────────────────
def gen_ns_plan_nsprd():
    img = Image.new("RGB", (W, H), (248, 244, 236))
    draw = ImageDraw.Draw(img)
    # land use zones
    zones = [
        ((0, 0, 80, 60), (220, 235, 200)),     # residential green
        ((80, 0, 200, 60), (255, 230, 190)),    # commercial peach
        ((200, 0, W, 60), (200, 225, 245)),     # industrial blue
        ((0, 60, 130, 130), (235, 245, 215)),   # residential
        ((130, 60, W, 130), (245, 235, 200)),   # mixed
        ((0, 130, 90, H), (200, 220, 245)),     # institutional
        ((90, 130, 220, H), (220, 235, 200)),   # park
        ((220, 130, W, H), (255, 235, 200)),    # commercial
    ]
    for rect, fill in zones:
        draw.rectangle(rect, fill=fill)
    # road grid
    for y in (0, 60, 130, H):
        draw.line([(0, y), (W, y)], fill=(200, 180, 140), width=2)
    for x in (0, 80, 130, 200, W):
        draw.line([(x, 0), (x, H)], fill=(200, 180, 140), width=2)
    # main road
    draw.line([(0, 60), (W, 60)], fill=(240, 200, 120), width=5)
    draw.line([(130, 0), (130, H)], fill=(240, 200, 120), width=4)
    save(img, "ns-plan-nsprd")

# ── NS NSHN Watercourses ──────────────────────────────────────────────────────
def gen_ns_nshn_watercourses():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=20)
    shade = hillshade(dem) * 0.4 + 0.6
    gray = (shade * 200 + 30).astype(np.uint8)
    bg = np.stack([(gray * 0.95).astype(np.uint8), (gray * 1.0).astype(np.uint8), (gray * 0.92).astype(np.uint8)], axis=2)
    img = Image.fromarray(bg)
    draw = ImageDraw.Draw(img)
    # simulate drainage network – main river
    river = [(10, 20), (40, 45), (70, 55), (100, 80), (130, 90), (160, 105), (200, 115), (240, 120), (280, 135), (W, 145)]
    for i in range(len(river)-1):
        draw.line([river[i], river[i+1]], fill=(64, 164, 223), width=4)
    # tributaries
    trib1 = [(60, 0), (65, 25), (70, 55)]
    for i in range(len(trib1)-1):
        draw.line([trib1[i], trib1[i+1]], fill=(100, 180, 230), width=2)
    trib2 = [(200, H), (205, 140), (200, 115)]
    for i in range(len(trib2)-1):
        draw.line([trib2[i], trib2[i+1]], fill=(100, 180, 230), width=2)
    trib3 = [(W, 80), (270, 100), (240, 120)]
    for i in range(len(trib3)-1):
        draw.line([trib3[i], trib3[i+1]], fill=(100, 180, 230), width=2)
    save(img, "ns-nshn-watercourses")

# ── NS NSHN Waterbodies ───────────────────────────────────────────────────────
def gen_ns_nshn_waterbodies():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=22)
    shade = hillshade(dem) * 0.4 + 0.6
    gray = (shade * 200 + 30).astype(np.uint8)
    bg = np.stack([(gray * 0.95).astype(np.uint8), (gray * 1.0).astype(np.uint8), (gray * 0.92).astype(np.uint8)], axis=2)
    img = Image.fromarray(bg)
    draw = ImageDraw.Draw(img)
    # lake shapes
    draw.ellipse([30, 30, 120, 90], fill=(64, 164, 223))
    draw.polygon([(160, 50), (210, 40), (240, 70), (235, 110), (200, 120), (165, 100)], fill=(80, 155, 210))
    draw.ellipse([30, 110, 100, 160], fill=(64, 164, 223))
    draw.ellipse([230, 110, 300, 160], fill=(80, 155, 210))
    # add wave texture
    for lake_y in [58, 125, 135]:
        for x in range(35, 115, 12):
            draw.arc([x, lake_y, x+10, lake_y+5], 180, 360, fill=(120, 200, 240), width=1)
    save(img, "ns-nshn-waterbodies")

# ── NS NSHN Wetlands ──────────────────────────────────────────────────────────
def gen_ns_nshn_wetlands():
    dem = perlin_like(W, H, scale=40, octaves=4, seed=25)
    # wetland base: muted green-gray
    colors = [
        (0.0,  100, 130, 100),
        (0.3,  120, 150, 110),
        (0.55, 145, 170, 125),
        (0.75, 160, 185, 140),
        (1.0,  185, 200, 165),
    ]
    rgb = apply_colormap(dem, colors)
    img = Image.fromarray(rgb)
    draw = ImageDraw.Draw(img)
    # wetland polygons with characteristic teal colour
    wet_areas = [
        [(20, 30), (80, 20), (110, 50), (100, 90), (50, 95), (15, 70)],
        [(160, 60), (220, 55), (245, 85), (240, 120), (195, 130), (158, 105)],
        [(30, 120), (95, 115), (110, 150), (60, 165), (20, 155)],
    ]
    for poly in wet_areas:
        draw.polygon(poly, fill=(100, 160, 140), outline=(60, 120, 105), width=1)
    # cattail/marsh symbols
    for _ in range(20):
        x, y = random.randint(20, 250), random.randint(20, H-20)
        draw.line([(x, y+8), (x, y)], fill=(80, 100, 70), width=1)
        draw.ellipse([x-2, y-4, x+2, y], fill=(100, 80, 50))
    save(img, "ns-nshn-wetlands")

# ── NS Base Contours ──────────────────────────────────────────────────────────
def gen_ns_base_contours():
    dem = perlin_like(W, H, scale=55, octaves=5, seed=30)
    # light topo tint
    colors = [
        (0.0,  240, 245, 230),
        (0.5,  220, 235, 210),
        (1.0,  200, 220, 195),
    ]
    rgb = apply_colormap(dem, colors)
    img = Image.fromarray(rgb)
    draw = ImageDraw.Draw(img)
    # regular contours
    for level in np.arange(0.05, 1.0, 0.06):
        for y in range(1, H-1):
            for x in range(1, W-1):
                if abs(dem[y, x] - level) < 0.013:
                    draw.point((x, y), fill=(160, 130, 90))
    # index contours
    for level in np.arange(0.05, 1.0, 0.30):
        for y in range(1, H-1):
            for x in range(1, W-1):
                if abs(dem[y, x] - level) < 0.019:
                    draw.point((x, y), fill=(120, 85, 40))
    save(img, "ns-base-contours")

# ── NS Base Parks ─────────────────────────────────────────────────────────────
def gen_ns_base_parks():
    img = Image.new("RGB", (W, H), (240, 245, 235))
    draw = ImageDraw.Draw(img)
    # park polygons
    parks = [
        ([(20, 20), (150, 15), (160, 100), (130, 120), (30, 115)], (170, 210, 150)),
        ([(180, 30), (290, 25), (305, 90), (270, 110), (175, 100)], (155, 200, 135)),
        ([(20, 135), (110, 130), (120, H), (15, H)], (170, 210, 150)),
        ([(180, 130), (280, 125), (290, H), (175, H)], (145, 195, 130)),
    ]
    for poly, fill in parks:
        draw.polygon(poly, fill=fill, outline=(100, 155, 85), width=1)
    # tree dots inside parks
    for _ in range(35):
        x, y = random.randint(25, W-25), random.randint(20, H-20)
        r = random.randint(3, 7)
        draw.ellipse([x-r, y-r, x+r, y+r], fill=(100, 155, 80, 180))
    # boundary / road lines
    draw.line([(0, 125), (W, 125)], fill=(200, 180, 140), width=2)
    draw.line([(165, 0), (165, H)], fill=(200, 180, 140), width=2)
    save(img, "ns-base-parks")

# ── NS Base Designated areas ──────────────────────────────────────────────────
def gen_ns_base_designated():
    img = Image.new("RGB", (W, H), (240, 240, 235))
    draw = ImageDraw.Draw(img)
    regions = [
        ([(10, 10), (130, 8), (140, 85), (115, 100), (15, 98)], (190, 220, 175)),  # nature reserve
        ([(145, 10), (W-10, 12), (W-8, 100), (155, 98)], (175, 210, 240)),          # protected marine
        ([(10, 105), (120, 102), (125, H-10), (8, H-8)], (245, 220, 175)),          # UNESCO buffer
        ([(130, 105), (W-10, 102), (W-8, H-8), (125, H-10)], (220, 195, 235)),      # wilderness
    ]
    labels = ["Nature Reserve", "Marine Protected", "Heritage", "Wilderness"]
    for (poly, fill), lbl in zip(regions, labels):
        draw.polygon(poly, fill=fill, outline=(150, 150, 150), width=1)
        cx = int(sum(p[0] for p in poly) / len(poly))
        cy = int(sum(p[1] for p in poly) / len(poly))
        draw.text((cx - 30, cy - 5), lbl, fill=(60, 60, 60))
    save(img, "ns-base-designated")

# ── NS Bio Habitat ────────────────────────────────────────────────────────────
def gen_ns_bio_habitat():
    dem = perlin_like(W, H, scale=40, octaves=5, seed=35)
    # ecological community colours
    colors = [
        (0.0,  100, 155, 195),   # aquatic
        (0.12, 130, 180, 150),   # riparian
        (0.28, 90,  145, 80),    # tolerant hardwood
        (0.45, 65,  120, 60),    # boreal softwood
        (0.60, 120, 160, 90),    # mixed forest
        (0.75, 170, 195, 130),   # upland meadow
        (0.88, 195, 180, 145),   # barrens / heath
        (1.0,  215, 205, 195),   # rocky outcrop
    ]
    rgb = apply_colormap(dem, colors)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    save(img, "ns-bio-habitat")

# ── NS Bio NSNRR Wetlands ─────────────────────────────────────────────────────
def gen_ns_bio_nsnrr_wetlands():
    dem = perlin_like(W, H, scale=40, octaves=4, seed=38)
    # wetland classification palette
    colors = [
        (0.0,  60,  110, 160),   # open water
        (0.15, 90,  150, 170),   # shallow water marsh
        (0.28, 110, 165, 145),   # emergent marsh
        (0.42, 100, 155, 120),   # shrub bog
        (0.58, 80,  135, 95),    # treed bog
        (0.72, 115, 150, 105),   # fen
        (0.85, 145, 165, 120),   # swamp
        (1.0,  165, 180, 140),   # upland transition
    ]
    rgb = apply_colormap(dem, colors)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    save(img, "ns-bio-nsnrr-wetlands")

# ── NS Forest Old Growth ──────────────────────────────────────────────────────
def gen_ns_for_old_growth():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=40)
    shade = hillshade(dem, alt_deg=35) * 0.5 + 0.5
    colors = [
        (0.0,  40, 80, 35),
        (0.3,  55, 100, 45),
        (0.55, 70, 120, 58),
        (0.75, 90, 145, 70),
        (1.0,  115, 170, 90),
    ]
    rgb = apply_colormap(dem, colors)
    # blend with hillshade
    for c in range(3):
        rgb[:, :, c] = (rgb[:, :, c] * shade).astype(np.uint8)
    img = Image.fromarray(rgb)
    draw = ImageDraw.Draw(img)
    # highlight old-growth patches in bright accent
    og_patches = [
        [(50, 30), (110, 25), (125, 65), (100, 80), (45, 75)],
        [(170, 70), (220, 65), (235, 100), (215, 118), (168, 108)],
        [(40, 110), (95, 105), (100, 150), (50, 158)],
    ]
    for poly in og_patches:
        draw.polygon(poly, fill=(180, 240, 80, 120), outline=(140, 210, 50), width=2)
    save(img, "ns-for-old-growth")

# ── NS Forest FEC Soil ────────────────────────────────────────────────────────
def gen_ns_for_fec_soil():
    dem = perlin_like(W, H, scale=35, octaves=4, seed=45)
    # soil classification colours (FEC)
    colors = [
        (0.0,  60,  100, 160),   # very wet / gleysol
        (0.14, 100, 145, 180),   # wet
        (0.27, 155, 185, 140),   # moist
        (0.42, 190, 200, 145),   # fresh
        (0.58, 215, 195, 140),   # dry-fresh
        (0.72, 200, 175, 120),   # dry
        (0.85, 185, 155, 105),   # very dry / brunisol
        (1.0,  170, 145, 115),   # xeric
    ]
    rgb = apply_colormap(dem, colors)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    save(img, "ns-for-fec-soil")

# ── NS Transportation Roads ───────────────────────────────────────────────────
def gen_ns_trns_roads():
    dem = perlin_like(W, H, scale=50, octaves=4, seed=50)
    shade = hillshade(dem) * 0.3 + 0.7
    gray = (shade * 220 + 20).astype(np.uint8)
    bg = np.stack([(gray * 0.96).astype(np.uint8)] * 3, axis=2)
    img = Image.fromarray(bg)
    draw = ImageDraw.Draw(img)
    # highway
    draw.line([(0, H//2), (W, H//2 + 10)], fill=(255, 190, 80), width=6)
    draw.line([(0, H//2), (W, H//2 + 10)], fill=(255, 215, 120), width=4)
    # arterial
    draw.line([(W//3, 0), (W//3 - 10, H)], fill=(240, 120, 80), width=4)
    draw.line([(W//3, 0), (W//3 - 10, H)], fill=(250, 160, 110), width=2)
    # collectors
    draw.line([(0, H//4), (W, H//4 + 15)], fill=(200, 200, 200), width=2)
    draw.line([(2*W//3, 0), (2*W//3 + 20, H)], fill=(200, 200, 200), width=2)
    # local roads
    for _ in range(12):
        x0, y0 = random.randint(0, W), random.randint(0, H)
        x1, y1 = x0 + random.randint(-60, 60), y0 + random.randint(-40, 40)
        draw.line([(x0, y0), (x1, y1)], fill=(180, 180, 180), width=1)
    save(img, "ns-trns-roads")

# ── NS Crown Parcels ──────────────────────────────────────────────────────────
def gen_ns_crown_parcels():
    img = Image.new("RGB", (W, H), (240, 238, 232))
    draw = ImageDraw.Draw(img)
    # parcel grid with crown land highlight
    cell_w, cell_h = 42, 35
    crown_ids = {(1,1),(1,3),(2,2),(3,0),(3,2),(4,1),(5,3),(6,2)}
    for col in range(W // cell_w + 1):
        for row in range(H // cell_h + 1):
            x0, y0 = col * cell_w, row * cell_h
            x1, y1 = x0 + cell_w, y0 + cell_h
            fill = (180, 215, 175) if (col, row) in crown_ids else (235, 230, 220)
            draw.rectangle([x0, y0, x1, y1], fill=fill, outline=(180, 170, 155), width=1)
    # annotation line overlay
    draw.line([(W//3, 0), (W//3, H)], fill=(200, 140, 80), width=2)
    draw.line([(0, H//2), (W, H//2)], fill=(200, 140, 80), width=2)
    save(img, "ns-crown-parcels")

# ── HRDEM Elevation ───────────────────────────────────────────────────────────
def gen_hrdem_elevation():
    dem = perlin_like(W, H, scale=50, octaves=6, seed=60)
    colors = [
        (0.0,  48, 80, 200),    # deep valley / water
        (0.08, 60, 130, 210),
        (0.18, 70, 190, 140),   # low elevation
        (0.32, 110, 185, 70),
        (0.48, 190, 190, 50),   # mid
        (0.62, 200, 145, 50),
        (0.75, 175, 105, 45),
        (0.86, 155, 120, 100),  # high
        (0.94, 200, 195, 190),
        (1.0,  240, 240, 245),  # summit
    ]
    rgb = apply_colormap(dem, colors)
    shade = hillshade(dem, alt_deg=35)
    for c in range(3):
        rgb[:, :, c] = np.clip(rgb[:, :, c] * (0.6 + shade * 0.5), 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb)
    save(img, "hrdem-elevation")

# ── HRDEM Slope ───────────────────────────────────────────────────────────────
def gen_hrdem_slope():
    dem = perlin_like(W, H, scale=40, octaves=6, seed=65)
    dy, dx = np.gradient(dem * 30)
    slope_raw = np.arctan(np.sqrt(dx**2 + dy**2)) / (math.pi / 2)  # 0-1
    colors = [
        (0.0,  30, 130, 30),
        (0.2,  100, 180, 50),
        (0.4,  220, 220, 50),
        (0.6,  240, 140, 30),
        (0.8,  210, 60, 30),
        (1.0,  160, 20, 20),
    ]
    rgb = apply_colormap(slope_raw, colors)
    img = Image.fromarray(rgb)
    save(img, "hrdem-slope")

# ── HRDEM Aspect ──────────────────────────────────────────────────────────────
def gen_hrdem_aspect():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=70)
    dy, dx = np.gradient(dem)
    aspect = np.arctan2(-dy, dx)  # -pi to pi
    aspect_norm = (aspect + math.pi) / (2 * math.pi)  # 0-1
    # circular hue: N=blue, E=yellow, S=red, W=purple
    r = (np.sin(aspect + math.pi) * 0.5 + 0.5) * 200 + 55
    g = (np.sin(aspect + math.pi / 2) * 0.4 + 0.5) * 180 + 30
    b = (np.sin(aspect) * 0.5 + 0.5) * 200 + 55
    rgb = np.stack([
        np.clip(r, 0, 255).astype(np.uint8),
        np.clip(g, 0, 255).astype(np.uint8),
        np.clip(b, 0, 255).astype(np.uint8),
    ], axis=2)
    img = Image.fromarray(rgb)
    # compass rose overlay
    draw = ImageDraw.Draw(img)
    cx, cy = W - 25, 25
    r2 = 12
    draw.ellipse([cx-r2, cy-r2, cx+r2, cy+r2], outline=(255,255,255), width=1)
    draw.text((cx-3, cy-r2-10), "N", fill=(255,255,255))
    draw.text((cx+r2+2, cy-4), "E", fill=(255,255,255))
    draw.text((cx-3, cy+r2+2), "S", fill=(255,255,255))
    draw.text((cx-r2-10, cy-4), "W", fill=(255,255,255))
    save(img, "hrdem-aspect")

# ── HRDEM TPI ─────────────────────────────────────────────────────────────────
def gen_hrdem_tpi():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=75)
    # TPI = elevation - mean of neighbourhood
    from PIL import ImageFilter
    dem_img = Image.fromarray((dem * 255).astype(np.uint8))
    mean_dem = np.array(dem_img.filter(ImageFilter.BoxBlur(12))) / 255.0
    tpi = dem - mean_dem
    tpi = (tpi - tpi.min()) / (tpi.max() - tpi.min() + 1e-9)
    colors = [
        (0.0,  33, 102, 172),   # valley
        (0.2,  103, 169, 207),
        (0.35, 209, 229, 240),
        (0.45, 247, 247, 247),  # flat
        (0.55, 253, 219, 199),
        (0.7,  239, 138, 98),
        (0.85, 178, 24, 43),    # ridge
        (1.0,  103, 0, 31),
    ]
    rgb = apply_colormap(tpi, colors)
    img = Image.fromarray(rgb)
    save(img, "hrdem-tpi")

# ── HRDEM Contours ────────────────────────────────────────────────────────────
def gen_hrdem_contours():
    dem = perlin_like(W, H, scale=50, octaves=6, seed=80)
    shade = hillshade(dem, alt_deg=35)
    gray = (shade * 180 + 60).astype(np.uint8)
    bg = np.stack([gray, gray, gray], axis=2)
    img = Image.fromarray(bg)
    draw = ImageDraw.Draw(img)
    for level in np.arange(0.05, 1.0, 0.06):
        col = (120, 80, 40) if abs(level % 0.30) < 0.07 else (160, 120, 70)
        width = 2 if abs(level % 0.30) < 0.07 else 1
        for y in range(1, H-1):
            for x in range(1, W-1):
                if abs(dem[y, x] - level) < 0.013:
                    if width == 2:
                        draw.rectangle([x-0,y-0,x+1,y+1], fill=col)
                    else:
                        draw.point((x, y), fill=col)
    save(img, "hrdem-contours")

# ── HRDEM DSM Elevation ───────────────────────────────────────────────────────
def gen_hrdem_dsm_elevation():
    dem = perlin_like(W, H, scale=45, octaves=6, seed=85)
    canopy = perlin_like(W, H, scale=12, octaves=4, seed=88)
    dsm = dem * 0.65 + canopy * 0.35
    colors = [
        (0.0,  48, 80, 200),
        (0.1,  60, 130, 210),
        (0.22, 80, 200, 150),
        (0.38, 120, 195, 80),
        (0.52, 200, 195, 55),
        (0.65, 210, 150, 55),
        (0.78, 185, 115, 60),
        (0.90, 200, 195, 190),
        (1.0,  245, 245, 250),
    ]
    rgb = apply_colormap(dsm, colors)
    shade = hillshade(dsm, alt_deg=35)
    for c in range(3):
        rgb[:, :, c] = np.clip(rgb[:, :, c] * (0.6 + shade * 0.5), 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb)
    save(img, "hrdem-dsm-elevation")

# ── HRDEM CHM (Canopy Height) ─────────────────────────────────────────────────
def gen_hrdem_chm():
    canopy = perlin_like(W, H, scale=18, octaves=5, seed=90)
    # zero out ~30% as open ground
    canopy = np.where(canopy < 0.3, 0, canopy)
    canopy = np.clip((canopy - 0.3) / 0.7, 0, 1)
    colors = [
        (0.0,  240, 240, 235),   # no canopy / bare
        (0.05, 200, 235, 195),   # sparse
        (0.18, 140, 210, 130),   # low (<5 m)
        (0.35, 80, 170, 80),     # medium (5–15 m)
        (0.55, 40, 130, 50),     # tall (15–25 m)
        (0.75, 20, 90, 35),      # very tall (>25 m)
        (1.0,  10, 55, 20),      # emergent / max
    ]
    rgb = apply_colormap(canopy, colors)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    save(img, "hrdem-chm")

# ── WI Depth to Water Table ───────────────────────────────────────────────────
def gen_wi_dtw():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=100)
    # invert: valleys = shallow water table
    dtw = 1.0 - dem
    dtw = dtw ** 0.7  # stretch shallows
    colors = [
        (0.0,  30, 100, 200),    # at surface / flooded
        (0.15, 60, 145, 215),
        (0.30, 100, 180, 220),
        (0.45, 155, 210, 215),
        (0.60, 200, 225, 200),
        (0.75, 220, 220, 180),
        (0.90, 215, 200, 155),
        (1.0,  200, 180, 135),   # deep water table
    ]
    rgb = apply_colormap(dtw, colors)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    save(img, "wi-dtw")

# ── WI Ground Elevation Index ─────────────────────────────────────────────────
def gen_wi_gei():
    dem = perlin_like(W, H, scale=50, octaves=6, seed=105)
    colors = [
        (0.0,  45, 75, 145),
        (0.2,  70, 130, 185),
        (0.4,  135, 185, 175),
        (0.55, 190, 210, 165),
        (0.70, 215, 200, 140),
        (0.85, 195, 165, 100),
        (1.0,  165, 130, 80),
    ]
    rgb = apply_colormap(dem, colors)
    shade = hillshade(dem, alt_deg=40)
    for c in range(3):
        rgb[:, :, c] = np.clip(rgb[:, :, c] * (0.65 + shade * 0.45), 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb)
    save(img, "wi-gei")

# ── WI DTW Contour ────────────────────────────────────────────────────────────
def gen_wi_dtw_contour():
    dem = perlin_like(W, H, scale=50, octaves=5, seed=108)
    dtw = 1.0 - dem
    shade = hillshade(dem, alt_deg=35)
    gray = (shade * 200 + 40).astype(np.uint8)
    bg = np.stack([
        np.clip(gray * 0.88 + 15, 0, 255).astype(np.uint8),
        np.clip(gray * 0.93 + 20, 0, 255).astype(np.uint8),
        np.clip(gray * 1.00 + 10, 0, 255).astype(np.uint8),
    ], axis=2)
    img = Image.fromarray(bg)
    draw = ImageDraw.Draw(img)
    for level in np.arange(0.08, 1.0, 0.08):
        col = (30, 80, 190) if abs(level % 0.40) < 0.10 else (70, 130, 210)
        for y in range(1, H-1):
            for x in range(1, W-1):
                if abs(dtw[y, x] - level) < 0.012:
                    draw.point((x, y), fill=col)
    save(img, "wi-dtw-contour")

# ── WI Ponding Depth ──────────────────────────────────────────────────────────
def gen_wi_pdep():
    dem = perlin_like(W, H, scale=45, octaves=5, seed=112)
    # ponding in depressions
    pdep = np.clip(0.35 - dem, 0, 1)  # only depression areas pond
    pdep = pdep / (pdep.max() + 1e-9)
    colors = [
        (0.0,  230, 240, 235),   # no ponding
        (0.05, 200, 230, 220),
        (0.20, 155, 210, 220),
        (0.40, 100, 175, 215),
        (0.60, 55, 130, 195),
        (0.80, 25, 90, 170),
        (1.0,  10, 55, 140),     # deepest ponding
    ]
    rgb = apply_colormap(pdep, colors)
    img = Image.fromarray(rgb).filter(ImageFilter.SMOOTH)
    save(img, "wi-pdep")


# ── Run all ──────────────────────────────────────────────────────────────────
print("Generating layer thumbnails…")
random.seed(42)
gen_esri_imagery()
gen_esri_hybrid()
gen_osm()
gen_topo()
gen_defaults()          # creates default, default-line, default-polygon
gen_hrdem_dtm_hillshade()
gen_hrdem_dsm_hillshade()
gen_ns_plan_nsprd()
gen_ns_nshn_watercourses()
gen_ns_nshn_waterbodies()
gen_ns_nshn_wetlands()
gen_ns_base_contours()
gen_ns_base_parks()
gen_ns_base_designated()
gen_ns_bio_habitat()
gen_ns_bio_nsnrr_wetlands()
gen_ns_for_old_growth()
gen_ns_for_fec_soil()
gen_ns_trns_roads()
gen_ns_crown_parcels()
gen_hrdem_elevation()
gen_hrdem_slope()
gen_hrdem_aspect()
gen_hrdem_tpi()
gen_hrdem_contours()
gen_hrdem_dsm_elevation()
gen_hrdem_chm()
gen_wi_dtw()
gen_wi_gei()
gen_wi_dtw_contour()
gen_wi_pdep()
print(f"Done — {len(list(OUT.glob('*.png')))} images in {OUT}")
