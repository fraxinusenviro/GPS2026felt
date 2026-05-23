/**
 * NRCan HRDEM elevation fetch via WCS 1.1.1.
 *
 * Endpoint: datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic
 * Protocol: WCS 1.1.1 (confirmed via GetCapabilities)
 * Coverages: dtm (bare earth) | dsm (surface incl. veg/structures)
 * CRS: EPSG:4326 for browser requests (native is EPSG:3979)
 *
 * WCS 1.1.1 quirks vs 2.0:
 *   - IDENTIFIER (not COVERAGEID)
 *   - BOUNDINGBOX = south,west,north,east,CRS  (lat/lon axis order of EPSG:4326)
 *   - GRIDOFFSETS drives output resolution (lonStep,latStep)
 *   - Response is multipart/related — binary GeoTIFF must be extracted from envelope
 *
 * CORS: NRCan exposes CORS headers. If fetches fail, proxy via:
 *   const OGC_BASE_URL = '/api/nrcan-elevation';
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

/** Run once at startup — logs available WCS 1.1.1 coverage identifiers. */
export async function probeCapabilities(): Promise<void> {
  try {
    const resp = await fetch(`${OGC_BASE_URL}?SERVICE=WCS&VERSION=1.1.1&REQUEST=GetCapabilities`);
    const text = await resp.text();
    const ids = [...text.matchAll(/<[\w:]*Identifier[^>]*>([^<]+)<\/[\w:]*Identifier>/g)]
      .map(m => m[1].trim());
    console.log(`[HRDEM] WCS 1.1.1 identifiers (HTTP ${resp.status}):`, ids.length ? ids : '(none found)');
    if (!ids.length) console.log('[HRDEM] Capabilities (first 2000 chars):', text.slice(0, 2000));
  } catch (e) { console.warn('[HRDEM] Probe failed:', e); }
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

  // GRIDOFFSETS: lonStep (positive = east), latStep (negative = south from north origin)
  const lonStep =  ((east  - west)  / reqW).toFixed(8);
  const latStep = -((north - south) / reqH);

  // BOUNDINGBOX: south,west,north,east,CRS  (EPSG:4326 lat-first axis order)
  const url = `${OGC_BASE_URL}?` +
    `SERVICE=WCS&VERSION=1.1.1&REQUEST=GetCoverage` +
    `&IDENTIFIER=dtm` +
    `&BOUNDINGBOX=${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326` +
    `&GRIDBASECRS=urn:ogc:def:crs:EPSG::4326` +
    `&GRIDCS=urn:ogc:def:crs:OGC::CS0002` +
    `&GRIDTYPE=urn:ogc:def:method:WCS:1.1:2dSimpleGrid` +
    `&GRIDOFFSETS=${lonStep},${latStep.toFixed(8)}` +
    `&FORMAT=image/geotiff`;

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

    const raw = await resp.arrayBuffer();
    console.log(`[HRDEM] Received ${(raw.byteLength / 1024).toFixed(1)} KB`);

    // WCS 1.1.1 wraps the GeoTIFF in a multipart/related envelope
    arrayBuffer = ct.includes('multipart') ? extractMultipartBinary(raw, ct) : raw;

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

/**
 * Strip the multipart/related MIME envelope from a WCS 1.1.1 response and
 * return the ArrayBuffer of the binary image part.
 */
function extractMultipartBinary(buf: ArrayBuffer, contentType: string): ArrayBuffer {
  const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
  if (!boundaryMatch) {
    console.warn('[HRDEM] No boundary in multipart Content-Type; attempting raw decode');
    return buf;
  }

  const boundary = '--' + boundaryMatch[1];
  // latin-1 decode preserves all byte values as char codes — safe for binary scanning
  const str = new TextDecoder('latin-1').decode(buf);

  let searchFrom = 0;
  while (searchFrom < str.length) {
    const partStart = str.indexOf(boundary, searchFrom);
    if (partStart === -1) break;

    const lineEnd = str.indexOf('\r\n', partStart);
    if (lineEnd === -1) break;

    const headersStart = lineEnd + 2;
    const headersEnd   = str.indexOf('\r\n\r\n', headersStart);
    if (headersEnd === -1) break;

    const headers   = str.slice(headersStart, headersEnd).toLowerCase();
    const dataStart = headersEnd + 4;

    if (headers.includes('image/') || headers.includes('octet-stream')) {
      const nextBoundary = str.indexOf('\r\n' + boundary, dataStart);
      const dataEnd = nextBoundary !== -1 ? nextBoundary : str.length;
      console.log(`[HRDEM] Extracted GeoTIFF from multipart: ${((dataEnd - dataStart) / 1024).toFixed(1)} KB`);
      return buf.slice(dataStart, dataEnd);
    }

    searchFrom = headersEnd + 4;
  }

  console.warn('[HRDEM] No image/* part found in multipart; attempting raw decode');
  return buf;
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
    `stretch ${stretchMin.toFixed(1)}–${stretchMax.toFixed(1)} m`,
  );

  return { grid, width, height, bbox: [west, south, east, north], nodata, elevMin, elevMax, stretchMin, stretchMax, validCount: valid.length };
}
