"""Photo records: dataclass, EXIF extraction, and ADM-001 numeric formatting.

A record may come from a JSON file or be scanned from a photo's EXIF. The merge
policy follows the build spec: EXIF is read when present; an explicit value in
the JSON record overrides it; if EXIF is missing the JSON value is the fallback.
"""

from __future__ import annotations

import base64
import io
import math
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from PIL import Image, ImageOps
from PIL.ExifTags import GPSTAGS, TAGS

COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


@dataclass
class PhotoRecord:
    photo_id: str
    image_path: Optional[str]
    datetime_iso: Optional[str]
    observer: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    elevation_m: Optional[float]
    bearing_deg: Optional[float]
    notes: Optional[str]


# ── EXIF extraction ─────────────────────────────────────────────────────────

def _ratio(value) -> Optional[float]:
    """Coerce an EXIF rational / tuple into a float."""
    try:
        if isinstance(value, (tuple, list)):
            num, den = value
            return float(num) / float(den) if den else None
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _dms_to_deg(dms, ref: str) -> Optional[float]:
    try:
        d = _ratio(dms[0]) or 0.0
        m = _ratio(dms[1]) or 0.0
        s = _ratio(dms[2]) or 0.0
    except (TypeError, IndexError):
        return None
    deg = d + m / 60.0 + s / 3600.0
    if ref in ("S", "W"):
        deg = -deg
    return deg


def read_exif(image_path: str) -> dict:
    """Return a dict of {lat, lon, elevation_m, bearing_deg, datetime_iso} from
    EXIF where available. Missing keys are simply absent."""
    out: dict = {}
    try:
        with Image.open(image_path) as img:
            exif = img.getexif()
    except Exception:
        return out
    if not exif:
        return out

    tag_by_name = {TAGS.get(k, k): v for k, v in exif.items()}

    dto = tag_by_name.get("DateTimeOriginal") or tag_by_name.get("DateTime")
    if isinstance(dto, str):
        try:
            # EXIF format: "YYYY:MM:DD HH:MM:SS"
            out["datetime_iso"] = datetime.strptime(
                dto.strip(), "%Y:%m:%d %H:%M:%S"
            ).isoformat()
        except ValueError:
            pass

    # GPS IFD
    try:
        gps_ifd = exif.get_ifd(0x8825)  # GPSInfo
    except Exception:
        gps_ifd = None
    if gps_ifd:
        gps = {GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}
        if "GPSLatitude" in gps and "GPSLatitudeRef" in gps:
            lat = _dms_to_deg(gps["GPSLatitude"], gps["GPSLatitudeRef"])
            if lat is not None:
                out["lat"] = lat
        if "GPSLongitude" in gps and "GPSLongitudeRef" in gps:
            lon = _dms_to_deg(gps["GPSLongitude"], gps["GPSLongitudeRef"])
            if lon is not None:
                out["lon"] = lon
        if "GPSAltitude" in gps:
            alt = _ratio(gps["GPSAltitude"])
            if alt is not None:
                if gps.get("GPSAltitudeRef") in (1, b"\x01"):
                    alt = -alt
                out["elevation_m"] = alt
        if "GPSImgDirection" in gps:
            brg = _ratio(gps["GPSImgDirection"])
            if brg is not None:
                out["bearing_deg"] = brg % 360.0
    return out


def merge_record(raw: dict, base_dir: str = "") -> PhotoRecord:
    """Build a PhotoRecord by merging a JSON record with EXIF read from its
    image. JSON values override EXIF; EXIF fills gaps the JSON leaves out."""
    image_path = raw.get("image_path")
    if image_path and base_dir and not os.path.isabs(image_path):
        candidate = os.path.join(base_dir, image_path)
        if os.path.exists(candidate):
            image_path = candidate

    exif = read_exif(image_path) if (image_path and os.path.exists(image_path)) else {}

    def pick(key):
        v = raw.get(key)
        return v if v is not None else exif.get(key)

    return PhotoRecord(
        photo_id=str(raw.get("photo_id", "")),
        image_path=image_path,
        datetime_iso=raw.get("datetime") or exif.get("datetime_iso"),
        observer=raw.get("observer"),
        lat=pick("lat"),
        lon=pick("lon"),
        elevation_m=pick("elevation_m"),
        bearing_deg=pick("bearing_deg"),
        notes=raw.get("notes"),
    )


def scan_record(image_path: str, photo_id: str) -> PhotoRecord:
    """Build a record purely from a photo's EXIF (directory-scan mode)."""
    return merge_record({"photo_id": photo_id, "image_path": image_path})


# ── Formatting (ADM-001) ─────────────────────────────────────────────────────

def compass_label(bearing: Optional[float]) -> Optional[str]:
    if bearing is None:
        return None
    return COMPASS_8[round(((bearing % 360) / 45.0)) % 8]


def format_bearing(bearing: Optional[float]) -> str:
    if bearing is None:
        return "—"
    deg = int(round(bearing)) % 360
    return f"{deg}° {compass_label(bearing)}"


def format_coord(value: Optional[float], axis: str) -> str:
    """6 decimals + hemisphere suffix. axis is 'lat' or 'lon'."""
    if value is None:
        return "—"
    hemi = ("N" if value >= 0 else "S") if axis == "lat" else ("E" if value >= 0 else "W")
    return f"{abs(value):.6f}° {hemi}"


def format_elevation(value: Optional[float]) -> str:
    return f"{value:.1f} m" if value is not None else "—"


def format_datetime(iso: Optional[str]) -> str:
    """Render '%b %-d, %Y · %-I:%M %p' in the photo's local tz (offset kept)."""
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return iso
    try:
        return dt.strftime("%b %-d, %Y · %-I:%M %p")
    except ValueError:  # platforms without %-d / %-I
        return dt.strftime("%b %d, %Y · %I:%M %p")


# ── Image preparation ────────────────────────────────────────────────────────

def image_to_data_uri(image_path: Optional[str], max_dim: int = 1600) -> Optional[str]:
    """Auto-rotate (EXIF Orientation), downscale, and return a JPEG data URI.
    Returns None when no usable image exists so the template shows a placeholder."""
    if not image_path or not os.path.exists(image_path):
        return None
    try:
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            if max(img.size) > max_dim:
                scale = max_dim / max(img.size)
                img = img.resize(
                    (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
                    Image.LANCZOS,
                )
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=86, optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{b64}"
    except Exception:
        return None
