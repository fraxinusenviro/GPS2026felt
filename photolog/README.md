# Fraxinus Georeferenced Field Photo Log

Generates a multi-page, print-ready PDF photo log from georeferenced field
photos. Two entries per US-Letter page; each entry pairs a large photo with a
right-hand panel stacking a locator map (with a view-bearing wedge) over a
metadata table and notes block. Styled to Fraxinus ADM-001 conventions.

## How it works

HTML/CSS template → PDF via **Playwright (Chromium `print_to_pdf`)**. Locator
maps composite real raster basemap tiles under **vector SVG overlays** (pin,
view wedge, scale bar, north badge) so the overlays stay crisp in the PDF.
Photos and maps are embedded as data URIs, so PDF rendering needs no network.

## Install

```bash
pip install -r requirements.txt
python -m playwright install chromium     # or set CHROMIUM_PATH to an existing build
```

If a Playwright-managed Chromium already exists (e.g. `/opt/pw-browsers/chromium-*`
or `~/.cache/ms-playwright/chromium-*`) it is auto-detected; otherwise set
`CHROMIUM_PATH=/path/to/chrome`.

## Usage

```bash
# From a JSON records file (image paths resolved relative to the JSON):
python generate_log.py --records sample_records.json \
    --project "Sample Environmental Assessment" --site "Riverside Parcel" \
    --doc 2026-001 --prepared-by "Jastels"

# From a directory of EXIF-tagged photos (metadata read from EXIF):
python generate_log.py --photos ./field_photos --project "..." --site "..."

# Eyeball the layout with no network and an HTML preview:
python generate_log.py --records sample_records.json --offline --dry-run
```

Output: `FieldPhotoLog_<project>_<date>_REV00.pdf`. `--dry-run` also writes the
intermediate `.html` next to the PDF. `--offline` skips all network and uses
placeholder maps.

## Records

JSON: either a top-level array or `{"records": [...]}`. Per record:

```json
{
  "photo_id": "01",
  "image_path": "sample_images/photo_01.jpg",
  "datetime": "2026-06-23T14:11:00-03:00",
  "observer": "Jastels",
  "lat": 45.005000,
  "lon": -64.010510,
  "elevation_m": 215.3,
  "bearing_deg": 81.0,
  "notes": "..."
}
```

EXIF (GPSLatitude/Longitude, GPSImgDirection, DateTimeOriginal, GPSAltitude) is
read when present; explicit JSON values override it, and EXIF fills any gaps the
JSON omits. Image orientation (EXIF Orientation) is auto-applied. If bearing is
missing from both, the wedge is omitted and the field shows `—`.

## Basemap providers

Selected with `--provider` or `BASEMAP_PROVIDER` (`maptiler` | `mapbox` | `osm`).

| Provider | Env var | Notes |
|----------|---------|-------|
| `maptiler` (default) | `MAPTILER_KEY`, `MAPTILER_STYLE` (`outdoor`) | static image API |
| `mapbox` | `MAPBOX_TOKEN`, `MAPBOX_STYLE` (`outdoors-v12`) | static image API |
| `osm` | — (keyless) | slippy-tile stitch; respect OSM tile usage policy |

Fetch order: static image API → slippy-tile stitch (OSM) → **placeholder grid**.
Tiles/static images are cached on disk under `tilecache/` (keyed by
provider + zoom + center), with a small concurrency limit and retry/backoff.

> Note: in network-restricted environments (e.g. a sandbox where tile hosts are
> blocked), every map gracefully falls back to the placeholder grid and the PDF
> still produces — the run logs how many maps used the placeholder.

## Formatting (ADM-001)

- Coordinates: 6 decimals + hemisphere (`45.005000° N`, `64.010510° W`), monospace.
- Elevation: 1 decimal + `m`.
- Bearing: integer degrees + 8-point compass (`81° E`, `335° NW`), accent orange.
- Date/Time: `%b %-d, %Y · %-I:%M %p` in the photo's local timezone.
- Scale bar: metres-per-pixel from Web Mercator at the entry's latitude & zoom.

## Files

```
generate_log.py            CLI + orchestration
records.py                 record dataclass, EXIF merge, formatting, image prep
basemap.py                 mercator math, providers, tile stitch, cache, overlays
templates/photo_log.html.j2  Jinja2 layout
templates/photo_log.css      print stylesheet (@page Letter, tokens, grid)
sample_records.json          2-record sample
sample_images/               synthetic sample photos (run _make_samples.py)
tilecache/                   on-disk tile/static-image cache
```
