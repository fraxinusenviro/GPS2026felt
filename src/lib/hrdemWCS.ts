/**
 * NRCan HRDEM elevation fetch via OGC API - Coverages.
 *
 * The datacube.services.geo.ca `wrapper/ogc` endpoint follows OGC API -
 * Coverages (19-087), NOT traditional WCS 2.0.1.  The correct request is a
 * GET to  /{collection}/coverage  with `subset` and `f` parameters.
 *
 * CORS: NRCan's datacube exposes CORS headers.  If fetches fail in your
 * deployment, set OGC_BASE_URL to a server-side proxy:
 *   export const OGC_BASE_URL = '/api/nrcan-elevation';
 */

import { fromArrayBuffer } from 'geotiff';

const OGC_BASE_URL =
  'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic';

/** Maximum pixel dimension for a single coverage request (both axes). */
const MAX_PIXELS = 1024;

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

/** Run once at startup — logs the OGC API conformance and available collections. */
export async function probeCapabilities(): Promise<void> {
  try {
    const resp = await fetch(`${OGC_BASE_URL}?f=application/json`);
    const text = await resp.text();
    console.log('[HRDEM] OGC API landing page:', text.slice(0, 800));
  } catch (e) {
    console.warn('[HRDEM] Probe failed:', e);
  }
}

void probeCapabilities();

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

  // NRCan wrapper/ogc requires service + request OGC params even under the REST path
  const url = `${OGC_BASE_URL}?` +
    `service=WCS&version=2.0.1&request=GetCoverage` +
    `subset=Lat(${south}:${north})&subset=Lon(${west}:${east})` +
    `&scale-size=${reqW},${reqH}` +
    `&f=image%2Ftiff`;

  console.log('[HRDEM] Requesting:', url);

  let arrayBuffer: ArrayBuffer;
  try {
    const resp = await fetch(url);
    const ct = resp.headers.get('content-type') ?? '';
    console.log(`[HRDEM] Response: HTTP ${resp.status}, content-type: "${ct}"`);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}. Body: ${body.slice(0, 300)}`);
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
