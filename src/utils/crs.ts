import proj4 from 'proj4';
import type { GeoJSONFeatureCollection, GeoJSONGeometry } from '../types';

// ============================================================
// Coordinate Reference System (CRS) support for data import.
//
// The app stores and renders everything in WGS84 (EPSG:4326),
// because MapLibre and Turf assume lon/lat. To let users add data
// in its native CRS, we reproject to WGS84 on import.
//
// This is a *curated* registry of the CRS our field work uses
// (Atlantic Canada: WGS84 / NAD83 geographic + UTM zones, plus
// Web Mercator). Every entry carries a self-contained proj4
// definition string so reprojection works fully offline — no
// epsg.io fetch required. To add a CRS, append one entry below.
// ============================================================

export interface CrsDef {
  /** Canonical id, e.g. "EPSG:26920" */
  code: string;
  /** Human label shown in the import picker */
  label: string;
  /** proj4 definition string */
  proj: string;
}

/** The default/native CRS the app stores everything in. */
export const WGS84 = 'EPSG:4326';

/**
 * Curated CRS list. WGS84 first (the default). UTM zones cover
 * Atlantic Canada (19N–22N) in both the WGS84 and NAD83 datums.
 */
export const CURATED_CRS: CrsDef[] = [
  { code: 'EPSG:4326', label: 'WGS84 — lat/lon (default)', proj: '+proj=longlat +datum=WGS84 +no_defs' },
  { code: 'EPSG:4269', label: 'NAD83 — lat/lon', proj: '+proj=longlat +datum=NAD83 +no_defs' },
  { code: 'EPSG:4267', label: 'NAD27 — lat/lon', proj: '+proj=longlat +datum=NAD27 +no_defs' },
  { code: 'EPSG:3857', label: 'Web Mercator', proj: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs' },
  { code: 'EPSG:26919', label: 'NAD83 / UTM zone 19N', proj: '+proj=utm +zone=19 +datum=NAD83 +units=m +no_defs' },
  { code: 'EPSG:26920', label: 'NAD83 / UTM zone 20N', proj: '+proj=utm +zone=20 +datum=NAD83 +units=m +no_defs' },
  { code: 'EPSG:26921', label: 'NAD83 / UTM zone 21N', proj: '+proj=utm +zone=21 +datum=NAD83 +units=m +no_defs' },
  { code: 'EPSG:26922', label: 'NAD83 / UTM zone 22N', proj: '+proj=utm +zone=22 +datum=NAD83 +units=m +no_defs' },
  { code: 'EPSG:32619', label: 'WGS84 / UTM zone 19N', proj: '+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32620', label: 'WGS84 / UTM zone 20N', proj: '+proj=utm +zone=20 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32621', label: 'WGS84 / UTM zone 21N', proj: '+proj=utm +zone=21 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32622', label: 'WGS84 / UTM zone 22N', proj: '+proj=utm +zone=22 +datum=WGS84 +units=m +no_defs' },
];

let registered = false;

/** Register all curated CRS definitions with proj4 (idempotent). */
export function registerCuratedCRS(): void {
  if (registered) return;
  for (const c of CURATED_CRS) {
    proj4.defs(c.code, c.proj);
  }
  registered = true;
}

/** Look up a curated CRS definition by code. */
export function getCrsDef(code: string): CrsDef | undefined {
  return CURATED_CRS.find(c => c.code.toUpperCase() === code.toUpperCase());
}

/**
 * Pull an EPSG code out of a GeoJSON legacy `crs` member, if present.
 * Handles both "urn:ogc:def:crs:EPSG::26920" and "EPSG:26920" forms.
 * Returns null when absent or when it names CRS84/WGS84 (already our default).
 */
export function detectGeoJSONCrs(fc: GeoJSONFeatureCollection): string | null {
  const name = ((fc as { crs?: { properties?: { name?: string } } }).crs)?.properties?.name;
  if (typeof name !== 'string') return null;
  // CRS84 is WGS84 with lon/lat order — treat as our default.
  if (/CRS84/i.test(name)) return null;
  const m = name.match(/EPSG:{1,2}(\d+)/i);
  if (!m) return null;
  const code = `EPSG:${m[1]}`;
  return code === WGS84 ? null : code;
}

/**
 * True when every sampled coordinate already falls inside WGS84 bounds
 * (±180 lon, ±90 lat). Used as a guard so we never double-reproject data
 * that a parser (e.g. shpjs reading a .prj) already converted to lon/lat.
 */
export function looksLikeGeographic(fc: GeoJSONFeatureCollection): boolean {
  let checked = 0;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const coords = flattenCoords(f.geometry);
    for (const [x, y] of coords) {
      if (!isFinite(x) || !isFinite(y)) continue;
      if (Math.abs(x) > 180 || Math.abs(y) > 90) return false;
      if (++checked >= 50) return true; // sample is enough
    }
  }
  return true;
}

/**
 * Reproject every coordinate in a FeatureCollection from `fromCrs` to WGS84,
 * in place. Z values (3D coords) are preserved. Returns the same object.
 * No-op when fromCrs is already WGS84.
 */
export function reprojectToWGS84(
  fc: GeoJSONFeatureCollection,
  fromCrs: string,
): GeoJSONFeatureCollection {
  if (fromCrs.toUpperCase() === WGS84) return fc;
  registerCuratedCRS();
  // Ensure the source CRS is known to proj4 (curated or already registered).
  try {
    proj4(fromCrs, WGS84, [0, 0]);
  } catch {
    throw new Error(`Unsupported CRS "${fromCrs}" — not in the curated list.`);
  }
  for (const f of fc.features) {
    if (f.geometry) transformGeometry(f.geometry, fromCrs);
  }
  // Drop any stale crs member; data is now WGS84.
  delete (fc as { crs?: unknown }).crs;
  return fc;
}

// ── internal helpers ─────────────────────────────────────────

function transformGeometry(geom: GeoJSONGeometry, fromCrs: string): void {
  if (geom.type === 'Point') {
    geom.coordinates = transformPos(geom.coordinates, fromCrs);
  } else if (geom.type === 'LineString') {
    geom.coordinates = geom.coordinates.map(c => transformPos(c, fromCrs));
  } else if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map(ring => ring.map(c => transformPos(c, fromCrs)));
  }
}

function transformPos(
  pos: [number, number] | [number, number, number],
  fromCrs: string,
): [number, number] | [number, number, number] {
  const [lon, lat] = proj4(fromCrs, WGS84, [pos[0], pos[1]]);
  return pos.length > 2 ? [lon, lat, pos[2] as number] : [lon, lat];
}

function flattenCoords(geom: GeoJSONGeometry): Array<[number, number]> {
  if (geom.type === 'Point') return [[geom.coordinates[0], geom.coordinates[1]]];
  if (geom.type === 'LineString') return geom.coordinates.map(c => [c[0], c[1]]);
  return geom.coordinates.flat().map(c => [c[0], c[1]]);
}
