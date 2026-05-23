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

/** Coverage ID — must match a coverage listed in the WCS GetCapabilities response. */
const COVERAGE_ID = 'elevation-hrdem-mosaic';

/** Maximum pixel dimension for a single WCS request (both axes). */
const MAX_PIXELS = 1024;

/** Run once at startup: fetch GetCapabilities and log available coverage IDs. */
export async function probeCapabilities(): Promise<void> {
  const url = `${WCS_BASE_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCapabilities`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    // Extract CoverageId elements from the XML
    const ids = [...text.matchAll(/<\w+:?CoverageId[^>]*>([^<]+)<\/\w+:?CoverageId>/g)]
      .map(m => m[1]);
    if (ids.length) {
      console.log('[HRDEM] Available coverage IDs:', ids);
    } else {
      console.log('[HRDEM] GetCapabilities response (first 1000 chars):', text.slice(0, 1000));
    }
  } catch (e) {
    console.warn('[HRDEM] GetCapabilities probe failed:', e);
  }
}

// Trigger the probe once on module load so the IDs appear in the console
void probeCapabilities();

/** Decoded elevation grid plus metadata. */
export interface HRDEMResult {
  grid: Float32Array;
  width: number;
  height: number;
  /** [west, south, east, north] in EPSG:4326. */
  bbox: [number, number, number, number];
  nodata: number | null;
  /** Absolute min/max of valid pixels (for reference). */
  elevMin: number;
  elevMax: number;
  /** 2nd–98th percentile stretch range — use these for colour mapping. */
  stretchMin: number;
  stretchMax: number;
  /** Count of valid (non-nodata) pixels returned. */
  validCount: number;
}

/**
 * Fetch and decode an HRDEM DTM coverage for the given geographic bounding box.
 */
export async function fetchHRDEM(
  west: number,
  south: number,
  east: number,
  north: number,
  targetWidth: number,
  targetHeight: number,
): Promise<HRDEMResult> {
  const scale = Math.min(1, MAX_PIXELS / Math.max(targetWidth, targetHeight, 1));
  const reqW = Math.max(1, Math.round(targetWidth  * scale));
  const reqH = Math.max(1, Math.round(targetHeight * scale));

  const url = `${WCS_BASE_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage` +
    `&COVERAGEID=${COVERAGE_ID}&FORMAT=image/tiff` +
    `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326` +
    `&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326` +
    `&SUBSET=Lat(${south},${north})&SUBSET=Long(${west},${east})` +
    `&WIDTH=${reqW}&HEIGHT=${reqH}`;

  console.log('[HRDEM] Requesting:', url);

  let arrayBuffer: ArrayBuffer;
  try {
    const resp = await fetch(url);
    const ct = resp.headers.get('content-type') ?? '';
    console.log(`[HRDEM] Response: HTTP ${resp.status}, content-type: "${ct}"`);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`WCS HTTP ${resp.status}. Body: ${body.slice(0, 300)}`);
    }

    if (!ct.includes('tiff') && !ct.includes('geotiff') && !ct.includes('octet-stream')) {
      const body = await resp.text();
      throw new Error(`Unexpected content-type "${ct}". Body: ${body.slice(0, 300)}`);
    }

    arrayBuffer = await resp.arrayBuffer();
    console.log(`[HRDEM] Received ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`);
  } catch (err) {
    if (err instanceof TypeError) {
      console.error('[HRDEM] Network/CORS error — URL:', url, err);
    } else {
      console.error('[HRDEM] Fetch error:', err);
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

  const [west, south, east, north] = image.getBoundingBox() as [number, number, number, number];
  const nodata = image.getGDALNoData();

  const rasters = await image.readRasters({ interleave: false });
  const rawBand = rasters[0] as Float32Array | Int16Array | Int32Array | Uint16Array;
  const grid = rawBand instanceof Float32Array ? rawBand : Float32Array.from(rawBand);

  // Collect valid values for statistics and percentile stretch
  const valid: number[] = [];
  let zeroCount = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!isFinite(v)) continue;
    if (nodata !== null && Math.abs(v - nodata) < 0.001) continue;
    valid.push(v);
    if (v === 0) zeroCount++;
  }

  let elevMin = 0, elevMax = 1, stretchMin = 0, stretchMax = 1;
  if (valid.length > 0) {
    valid.sort((a, b) => a - b);
    const n = valid.length;
    elevMin = valid[0];
    elevMax = valid[n - 1];
    stretchMin = valid[Math.floor(n * 0.02)];
    stretchMax = valid[Math.min(n - 1, Math.ceil(n * 0.98) - 1)];
    if (stretchMax - stretchMin < 1) {
      stretchMin = elevMin;
      stretchMax = elevMax > elevMin ? elevMax : elevMin + 1;
    }
  }

  console.log(
    `[HRDEM] Decoded ${width}×${height} px | nodata=${nodata} | ` +
    `valid=${valid.length}/${grid.length} (${zeroCount} at 0m) | ` +
    `elev ${elevMin.toFixed(1)}–${elevMax.toFixed(1)} m | ` +
    `stretch ${stretchMin.toFixed(1)}–${stretchMax.toFixed(1)} m`
  );

  return { grid, width, height, bbox: [west, south, east, north], nodata, elevMin, elevMax, stretchMin, stretchMax, validCount: valid.length };
}
