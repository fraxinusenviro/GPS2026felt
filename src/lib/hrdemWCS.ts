/**
 * NRCan HRDEM WCS 2.0.1 fetch module.
 *
 * Endpoint: https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic
 * Coverage:  dtm  (Digital Terrain Model, ~1 m native resolution)
 *
 * CORS note: NRCan's datacube services expose CORS headers for browser requests.
 * If requests fail with a CORS error in your deployment, replace WCS_BASE_URL
 * with a proxy that forwards to the real endpoint, e.g.:
 *   export const WCS_BASE_URL = '/api/wcs-proxy';
 * The proxy should append '?url=<encoded>' or forward the query string as-is.
 */

import { fromArrayBuffer } from 'geotiff';

export const WCS_BASE_URL =
  'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic';

/** Maximum pixel dimension for a single WCS request (both axes). */
const MAX_PIXELS = 1024;

/** Decoded elevation grid plus metadata. */
export interface HRDEMResult {
  grid: Float32Array;
  width: number;
  height: number;
  /** [west, south, east, north] in EPSG:4326. */
  bbox: [number, number, number, number];
  nodata: number | null;
  elevMin: number;
  elevMax: number;
}

/**
 * Fetch and decode an HRDEM DTM coverage for the given geographic bounding box.
 *
 * @param west         Western longitude  (EPSG:4326)
 * @param south        Southern latitude
 * @param east         Eastern longitude
 * @param north        Northern latitude
 * @param targetWidth  Desired pixel width  (capped internally to MAX_PIXELS)
 * @param targetHeight Desired pixel height (capped internally to MAX_PIXELS)
 */
export async function fetchHRDEM(
  west: number,
  south: number,
  east: number,
  north: number,
  targetWidth: number,
  targetHeight: number,
): Promise<HRDEMResult> {
  // Scale down so neither axis exceeds MAX_PIXELS
  const scale = Math.min(1, MAX_PIXELS / Math.max(targetWidth, targetHeight, 1));
  const reqW = Math.max(1, Math.round(targetWidth  * scale));
  const reqH = Math.max(1, Math.round(targetHeight * scale));

  // WCS 2.0.1 GetCoverage
  // EPSG:4326 axis order: Lat (N/S) first, then Long (E/W).
  // Many servers also accept the reverse order; 'Lat' / 'Long' aliases are widely supported.
  // WIDTH/HEIGHT are a vendor extension accepted by GeoServer, MapServer, and NRCan's wrapper.
  const base = `${WCS_BASE_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage` +
    `&COVERAGEID=dtm&FORMAT=image/tiff` +
    `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326` +
    `&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326` +
    // Two SUBSET params — URLSearchParams collapses duplicate keys, so build manually
    `&SUBSET=Lat(${south},${north})&SUBSET=Long(${west},${east})` +
    `&WIDTH=${reqW}&HEIGHT=${reqH}`;

  let arrayBuffer: ArrayBuffer;
  try {
    const resp = await fetch(base);
    if (!resp.ok) {
      throw new Error(`WCS HTTP ${resp.status} ${resp.statusText}`);
    }
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.includes('tiff') && !ct.includes('geotiff') && !ct.includes('octet-stream')) {
      // Service returned an error document (e.g. XML exception report)
      const body = await resp.text();
      throw new Error(
        `WCS returned unexpected content-type "${ct}".\n` +
        `Response body (first 400 chars): ${body.slice(0, 400)}`,
      );
    }
    arrayBuffer = await resp.arrayBuffer();
  } catch (err) {
    if (err instanceof TypeError) {
      // TypeError from fetch() typically means a network or CORS failure
      console.error(
        '[HRDEM] Network/CORS error fetching WCS endpoint.\n' +
        `  URL: ${base}\n` +
        '  If this is a CORS error, set WCS_BASE_URL to a server-side proxy.\n' +
        '  Example: export const WCS_BASE_URL = \'/api/nrcan-wcs\';',
        err,
      );
    }
    throw err;
  }

  return decodeElevationTIFF(arrayBuffer);
}

/** Decode a raw GeoTIFF ArrayBuffer into a Float32 elevation grid. */
async function decodeElevationTIFF(buf: ArrayBuffer): Promise<HRDEMResult> {
  let tiff;
  try {
    tiff = await fromArrayBuffer(buf);
  } catch (err) {
    throw new Error(`[HRDEM] GeoTIFF decode failed: ${err}`);
  }

  const image = await tiff.getImage();
  const width  = image.getWidth();
  const height = image.getHeight();

  // BoundingBox from GeoTIFF metadata: [west, south, east, north] in native CRS
  const [west, south, east, north] = image.getBoundingBox() as
    [number, number, number, number];

  // GDAL nodata tag (GeoTIFF tag 42113)
  const nodataStr = image.getGDALNoData();
  const nodata = nodataStr !== null ? parseFloat(nodataStr) : null;

  // Read the first band (elevation values)
  const rasters = await image.readRasters({ interleave: false });
  const rawBand = rasters[0] as Float32Array | Int16Array | Int32Array | Uint16Array;
  const grid = rawBand instanceof Float32Array
    ? rawBand
    : Float32Array.from(rawBand);

  // Compute finite min/max, skipping nodata
  let elevMin =  Infinity;
  let elevMax = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!isFinite(v)) continue;
    if (nodata !== null && Math.abs(v - nodata) < 0.001) continue;
    if (v < elevMin) elevMin = v;
    if (v > elevMax) elevMax = v;
  }
  if (!isFinite(elevMin)) { elevMin = 0; elevMax = 1; }

  return { grid, width, height, bbox: [west, south, east, north], nodata, elevMin, elevMax };
}
