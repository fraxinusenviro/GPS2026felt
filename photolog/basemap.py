"""Locator basemap fetching + overlay geometry.

Strategy (per build spec):
  1. Static image API (MapTiler / Mapbox) — one request per map, preferred.
  2. Slippy-tile stitching (OSM keyless fallback) — fetch covering tiles, stitch.
  3. Graceful degradation — a light grid placeholder when the network fails.

Provider chosen by config/env; tiles & static images cached on disk by key.
Overlays (pin, view wedge, scale bar, north badge) are drawn as vector SVG in
the HTML template — this module only computes their geometry so they stay crisp.
"""

from __future__ import annotations

import base64
import hashlib
import io
import math
import os
import ssl
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Optional, Tuple

from PIL import Image, ImageDraw

EARTH_CIRCUM = 156543.03392  # m/px at zoom 0, equator (Web Mercator)
TILE = 256
USER_AGENT = "FraxinusFieldMapper/1.0 (+photolog; contact ibryson@fraxinusenviro.com)"
CA_BUNDLE = "/root/.ccr/ca-bundle.crt"

_NET_LOCK = threading.Semaphore(4)  # small concurrency limit for tile fetches


# ── Web Mercator helpers ─────────────────────────────────────────────────────

def meters_per_pixel(lat: float, zoom: float) -> float:
    return EARTH_CIRCUM * math.cos(math.radians(lat)) / (2 ** zoom)


def lonlat_to_pixel(lon: float, lat: float, zoom: int) -> Tuple[float, float]:
    """Global Web-Mercator pixel coordinates at the given zoom."""
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n * TILE
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n * TILE
    return x, y


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> Tuple[int, int]:
    px, py = lonlat_to_pixel(lon, lat, zoom)
    return int(px // TILE), int(py // TILE)


# ── Overlay geometry (panel-space px) ────────────────────────────────────────

def wedge_path(bearing: Optional[float], cx: float, cy: float,
               length: float = 46.0, half_angle: float = 20.0) -> Optional[str]:
    """SVG path for a view-direction cone. North-up map: bearing 0 points up.
    Returns None when bearing is unknown (caller omits the wedge)."""
    if bearing is None:
        return None
    a1 = math.radians(bearing - half_angle)
    a2 = math.radians(bearing + half_angle)
    # Screen space: up is -y; clockwise rotation = increasing bearing.
    x1 = cx + math.sin(a1) * length
    y1 = cy - math.cos(a1) * length
    x2 = cx + math.sin(a2) * length
    y2 = cy - math.cos(a2) * length
    return (f"M {cx:.2f} {cy:.2f} L {x1:.2f} {y1:.2f} "
            f"A {length:.2f} {length:.2f} 0 0 1 {x2:.2f} {y2:.2f} Z")


def scale_geometry(lat: float, zoom: float, full_m: int = 100, half_m: int = 50,
                   max_px: float = 90.0) -> dict:
    """Pixel widths for a 0 / half / full metre scale bar at this lat & zoom.
    If the full distance would overflow max_px, fall back to a smaller nice
    distance so the bar always fits the panel."""
    mpp = meters_per_pixel(lat, zoom)
    full, half = full_m, half_m
    while full / mpp > max_px and full > 10:
        full //= 2
        half = full // 2
    return {
        "px": round(full / mpp, 2),
        "half_px": round(half / mpp, 2),
        "full_label": str(full),
        "half_label": str(half),
        "mpp": mpp,
    }


# ── Disk cache ───────────────────────────────────────────────────────────────

def _cache_path(cache_dir: str, key: str) -> str:
    os.makedirs(cache_dir, exist_ok=True)
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(cache_dir, f"{h}.png")


# ── Network fetch (proxy-aware, retrying) ────────────────────────────────────

def _ssl_context() -> ssl.SSLContext:
    if os.path.exists(CA_BUNDLE):
        return ssl.create_default_context(cafile=CA_BUNDLE)
    return ssl.create_default_context()


def _fetch_bytes(url: str, retries: int = 3) -> Optional[bytes]:
    ctx = _ssl_context()
    delay = 1.0
    for attempt in range(retries):
        try:
            with _NET_LOCK:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    if resp.status == 200:
                        return resp.read()
        except Exception:
            pass
        time.sleep(delay)
        delay *= 2
    return None


def _fetch_image(url: str, cache_dir: str, key: str) -> Optional[Image.Image]:
    path = _cache_path(cache_dir, key)
    if os.path.exists(path):
        try:
            return Image.open(path).convert("RGB")
        except Exception:
            pass
    data = _fetch_bytes(url)
    if not data:
        return None
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.save(path, format="PNG")
        return img
    except Exception:
        return None


# ── Provider URLs ─────────────────────────────────────────────────────────────

def _static_url(provider: str, lat: float, lon: float, zoom: int,
                w: int, h: int) -> Optional[str]:
    if provider == "maptiler":
        key = os.environ.get("MAPTILER_KEY")
        if not key:
            return None
        style = os.environ.get("MAPTILER_STYLE", "outdoor")
        return (f"https://api.maptiler.com/maps/{style}/static/"
                f"{lon},{lat},{zoom}/{w}x{h}@2x.png?key={key}")
    if provider == "mapbox":
        token = os.environ.get("MAPBOX_TOKEN")
        if not token:
            return None
        style = os.environ.get("MAPBOX_STYLE", "outdoors-v12")
        return (f"https://api.mapbox.com/styles/v1/mapbox/{style}/static/"
                f"{lon},{lat},{zoom}/{w}x{h}@2x?access_token={token}")
    return None


def _osm_tile_url(z: int, x: int, y: int) -> str:
    return f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"


# ── Map composition ────────────────────────────────────────────────────────────

def _stitch_osm(lat: float, lon: float, zoom: int, w: int, h: int,
                cache_dir: str) -> Optional[Image.Image]:
    """Fetch covering OSM tiles and crop to a w×h window centered on lat/lon."""
    cx, cy = lonlat_to_pixel(lon, lat, zoom)
    left = cx - w / 2.0
    top = cy - h / 2.0
    tx0, ty0 = int(left // TILE), int(top // TILE)
    tx1, ty1 = int((left + w) // TILE), int((top + h) // TILE)

    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))
    got_any = False
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            n = 2 ** zoom
            if not (0 <= tx < n and 0 <= ty < n):
                continue
            key = f"osm/{zoom}/{tx}/{ty}"
            tile = _fetch_image(_osm_tile_url(zoom, tx, ty), cache_dir, key)
            if tile is None:
                continue
            got_any = True
            canvas.paste(tile, ((tx - tx0) * TILE, (ty - ty0) * TILE))
    if not got_any:
        return None
    ox = left - tx0 * TILE
    oy = top - ty0 * TILE
    return canvas.crop((int(ox), int(oy), int(ox) + w, int(oy) + h))


def make_placeholder(w: int, h: int) -> Image.Image:
    """Light grid placeholder so the document still produces with no network."""
    img = Image.new("RGB", (w, h), (238, 241, 236))
    draw = ImageDraw.Draw(img)
    step = 24
    grid = (230, 232, 227)
    for x in range(0, w, step):
        draw.line([(x, 0), (x, h)], fill=grid, width=1)
    for y in range(0, h, step):
        draw.line([(0, y), (w, y)], fill=grid, width=1)
    return img


def image_to_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@dataclass
class MapResult:
    image_uri: str
    is_placeholder: bool


def build_basemap(lat: Optional[float], lon: Optional[float], zoom: int,
                  panel_w: int, panel_h: int, provider: str,
                  cache_dir: str, scale_factor: int = 2,
                  offline: bool = False) -> MapResult:
    """Return a basemap image (data URI) for the panel. Falls back to a slippy
    stitch, then to a placeholder grid, so a PDF is always produced."""
    w, h = panel_w * scale_factor, panel_h * scale_factor

    if lat is None or lon is None:
        return MapResult(image_to_data_uri(make_placeholder(w, h)), True)

    img: Optional[Image.Image] = None

    if not offline:
        # 1. Static image API
        url = _static_url(provider, lat, lon, zoom, panel_w, panel_h)
        if url:
            key = f"{provider}/static/{zoom}/{lat:.5f}/{lon:.5f}/{w}x{h}"
            fetched = _fetch_image(url, cache_dir, key)
            if fetched is not None:
                img = fetched.resize((w, h), Image.LANCZOS)

        # 2. Slippy-tile stitch (OSM keyless fallback)
        if img is None:
            img = _stitch_osm(lat, lon, zoom, w, h, cache_dir)

    # 3. Placeholder
    if img is None:
        return MapResult(image_to_data_uri(make_placeholder(w, h)), True)
    return MapResult(image_to_data_uri(img), False)
