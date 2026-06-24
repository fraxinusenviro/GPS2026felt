#!/usr/bin/env python3
"""Fraxinus Georeferenced Field Photo Log — PDF generator.

Renders a multi-page, print-ready photo log (two entries per Letter page) from a
JSON records file or a directory of EXIF-tagged photos. Locator maps use live
raster tiles (MapTiler / Mapbox / OSM) composited under vector overlays; the
HTML/CSS template is rendered to PDF via Playwright (Chromium print_to_pdf).

Usage:
  python generate_log.py --records sample_records.json --project "Riverside Parcel"
  python generate_log.py --photos ./field_photos --project "..." --site "..."
  python generate_log.py --records sample_records.json --dry-run --offline

Provider config via env: BASEMAP_PROVIDER (maptiler|mapbox|osm),
MAPTILER_KEY, MAPBOX_TOKEN. Browser: set CHROMIUM_PATH to override the
auto-detected Chromium executable.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from glob import glob

from jinja2 import Environment, FileSystemLoader, select_autoescape

import basemap
import records as rec

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(HERE, "templates")
DEFAULT_CACHE = os.path.join(HERE, "tilecache")

MAP_W, MAP_H = 220, 128
PHOTO_EXTS = (".jpg", ".jpeg", ".png", ".tif", ".tiff")

# Auto-detect a bundled Chromium (Playwright managed install) if present.
_PW_GLOB = sorted(glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
                  + glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux/chrome")))


def slugify(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", (text or "").strip())
    return s.strip("_") or "Project"


def load_records(args) -> list[rec.PhotoRecord]:
    if args.records:
        with open(args.records, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict) and "records" in raw:
            raw = raw["records"]
        base_dir = os.path.dirname(os.path.abspath(args.records))
        return [rec.merge_record(r, base_dir=base_dir) for r in raw]

    if args.photos:
        paths = sorted(
            p for p in glob(os.path.join(args.photos, "*"))
            if p.lower().endswith(PHOTO_EXTS)
        )
        return [rec.scan_record(p, f"{i + 1:02d}") for i, p in enumerate(paths)]

    raise SystemExit("error: provide --records <file.json> or --photos <dir>")


def build_entry(r: rec.PhotoRecord, provider: str, cache_dir: str,
                zoom: int, offline: bool) -> dict:
    cx, cy = MAP_W / 2.0, MAP_H / 2.0
    lat_for_scale = r.lat if r.lat is not None else 45.0
    scale = basemap.scale_geometry(lat_for_scale, zoom)
    map_res = basemap.build_basemap(
        r.lat, r.lon, zoom, MAP_W, MAP_H, provider, cache_dir, offline=offline
    )
    return {
        "photo_id": r.photo_id,
        "image_uri": rec.image_to_data_uri(r.image_path),
        "datetime": rec.format_datetime(r.datetime_iso),
        "observer": r.observer or "—",
        "lat_str": rec.format_coord(r.lat, "lat"),
        "lon_str": rec.format_coord(r.lon, "lon"),
        "elev_str": rec.format_elevation(r.elevation_m),
        "bearing_str": rec.format_bearing(r.bearing_deg),
        "notes": (r.notes or "").strip(),
        "map": {
            "image_uri": map_res.image_uri,
            "is_placeholder": map_res.is_placeholder,
            "wedge_path": basemap.wedge_path(r.bearing_deg, cx, cy),
            "scale": scale,
        },
    }


def paginate(entries: list[dict], per_page: int = 2) -> list[dict]:
    pages = []
    total = (len(entries) + per_page - 1) // per_page or 1
    for i in range(0, max(len(entries), 1), per_page):
        chunk = entries[i:i + per_page]
        pages.append({
            "entries": chunk,
            "page_num": len(pages) + 1,
            "page_count": total,
        })
    for p in pages:
        p["page_count"] = total
    return pages


def render_html(args, entries: list[dict]) -> str:
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template("photo_log.html.j2")
    with open(os.path.join(TEMPLATE_DIR, "photo_log.css"), "r", encoding="utf-8") as f:
        css = f.read()

    doc = {
        "title": f"Field Photo Log — {args.project}",
        "project": args.project,
        "site": args.site,
        "doc_string": f"{args.doc} · {args.rev}",
        "company": args.company,
        "prepared_by": args.prepared_by,
    }
    return template.render(
        css=css, doc=doc, pages=paginate(entries),
        map_w=MAP_W, map_h=MAP_H, cx=MAP_W / 2.0, cy=MAP_H / 2.0,
    )


def html_to_pdf(html: str, out_path: str) -> None:
    from playwright.sync_api import sync_playwright

    exe = os.environ.get("CHROMIUM_PATH") or (_PW_GLOB[-1] if _PW_GLOB else None)
    launch_kwargs = {"args": ["--no-sandbox"]}
    if exe:
        launch_kwargs["executable_path"] = exe

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        page = browser.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(
            path=out_path,
            prefer_css_page_size=True,
            print_background=True,
            margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
        )
        browser.close()


def main(argv=None) -> int:
    today = date.today().isoformat()
    ap = argparse.ArgumentParser(description="Generate a Fraxinus field photo log PDF.")
    src = ap.add_argument_group("input (choose one)")
    src.add_argument("--records", help="JSON file of photo records")
    src.add_argument("--photos", help="directory of photos to EXIF-scan")

    ap.add_argument("--project", default="Sample Environmental Assessment")
    ap.add_argument("--site", default="Riverside Parcel")
    ap.add_argument("--doc", default="2026-001", help="document number (e.g. 2026-001)")
    ap.add_argument("--rev", default="REV00")
    ap.add_argument("--prepared-by", default="Jastels")
    ap.add_argument("--company", default="Fraxinus Environmental & Geomatics Ltd.")
    ap.add_argument("--report-date", default=today, help="YYYY-MM-DD for the filename")

    ap.add_argument("--provider", default=os.environ.get("BASEMAP_PROVIDER", "maptiler"),
                    choices=["maptiler", "mapbox", "osm"])
    ap.add_argument("--zoom", type=int, default=16)
    ap.add_argument("--cache-dir", default=DEFAULT_CACHE)
    ap.add_argument("--offline", action="store_true",
                    help="skip all network fetches; use placeholder maps")
    ap.add_argument("-o", "--out", help="output PDF path (overrides default name)")
    ap.add_argument("--dry-run", action="store_true",
                    help="also write the intermediate HTML next to the PDF")

    args = ap.parse_args(argv)

    records = load_records(args)
    if not records:
        print("error: no photo records found", file=sys.stderr)
        return 2

    print(f"Loaded {len(records)} record(s). Building basemaps "
          f"(provider={args.provider}, offline={args.offline})…")
    entries = [
        build_entry(r, args.provider, args.cache_dir, args.zoom, args.offline)
        for r in records
    ]
    placeholders = sum(1 for e in entries if e["map"]["is_placeholder"])
    if placeholders:
        print(f"  note: {placeholders}/{len(entries)} map(s) used the placeholder "
              "(no tiles fetched).")

    html = render_html(args, entries)

    out = args.out or os.path.join(
        os.getcwd(),
        f"FieldPhotoLog_{slugify(args.project)}_{args.report_date}_{args.rev}.pdf",
    )

    if args.dry_run:
        html_path = os.path.splitext(out)[0] + ".html"
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  wrote HTML preview: {html_path}")

    html_to_pdf(html, out)
    print(f"✓ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
