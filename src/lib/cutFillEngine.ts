/**
 * Cut/fill earthworks engine.
 *
 * Given an HRDEM DTM result, a polygon footprint, a target elevation, and an
 * optional side-slope ratio (H:V), produces a modified elevation grid where:
 *
 *   Inside polygon  → targetElevation (flat pad)
 *   Outside polygon → side-slope transition until existing grade is met:
 *       cut shoulder  (existing > target):  min(existing, target + d / H:V)
 *       fill embankment (existing < target): max(existing, target − d / H:V)
 *   null slope ratio → vertical walls (outside pixels unchanged)
 *
 * All spatial arithmetic is in EPSG:4326; distances are converted to metres
 * using the haversine approximation at the grid midpoint.
 */

import type { HRDEMResult } from './hrdemWCS';
import { generateThresholdContour } from './contourGenerator';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CutFillParams {
  polygon: { type: 'Polygon'; coordinates: [number, number][][] }; // EPSG:4326
  targetElevation: number;  // metres
  /** H:V ratio — e.g. 2 means 2 m horizontal per 1 m vertical.  null = vertical walls. */
  slopeRatio: number | null;
}

export interface CutFillResult {
  modifiedGrid: Float32Array; // new surface elevations
  diffGrid: Float32Array;     // modified − original  (negative = cut, positive = fill)
  originalGrid: Float32Array; // reference to hrdem.grid
  insideMask: Uint8Array;     // 1 = inside polygon footprint
  targetElevation: number;    // stored for convenience
  cutVolume: number;          // m³ material removed inside polygon
  fillVolume: number;         // m³ material added inside polygon
  cutArea: number;            // m² inside polygon where original > target
  fillArea: number;           // m² inside polygon where original < target
  // Spatial metadata — mirrors HRDEMResult
  bbox: [number, number, number, number]; // [west, south, east, north]
  width: number;
  height: number;
  nodata: number | null;
  stretchMin: number;
  stretchMax: number;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function computeCutFill(hrdem: HRDEMResult, params: CutFillParams): CutFillResult {
  const { grid, width, height, bbox, nodata } = hrdem;
  const { polygon, targetElevation, slopeRatio } = params;
  const [west, south, east, north] = bbox;

  // Pixel dimensions in metres (haversine approximation at midpoint)
  const latMid  = (south + north) / 2;
  const pixelW  = ((east - west)   / width)  * 111320 * Math.cos(latMid * Math.PI / 180);
  const pixelH  = ((north - south) / height) * 110540;
  const pixelM  = (pixelW + pixelH) / 2; // average cell size in metres
  const pixelArea = pixelW * pixelH;     // m² per pixel

  // Rasterize polygon to binary mask
  const inside = rasterizePolygon(polygon.coordinates[0], width, height, west, south, east, north);

  // Euclidean distance transform (pixels from polygon boundary, outside only)
  const distPx = slopeRatio !== null
    ? computeEuclideanDT(inside, width, height)
    : null;

  const modifiedGrid = new Float32Array(grid.length);
  const diffGrid     = new Float32Array(grid.length);

  let cutVolume = 0, fillVolume = 0, cutArea = 0, fillArea = 0;
  let stretchMin = Infinity, stretchMax = -Infinity;

  for (let i = 0; i < grid.length; i++) {
    const orig = grid[i];
    const isNodata = !isFinite(orig) || (nodata !== null && Math.abs(orig - nodata) < 0.001);

    if (isNodata) {
      modifiedGrid[i] = orig;
      diffGrid[i]     = 0;
      continue;
    }

    let newVal: number;

    if (inside[i]) {
      newVal = targetElevation;

      // Accumulate volumes (only inside the polygon footprint)
      const diff = orig - targetElevation;
      if (diff > 0) { cutVolume  += diff * pixelArea; cutArea  += pixelArea; }
      else if (diff < 0) { fillVolume -= diff * pixelArea; fillArea += pixelArea; }

    } else if (distPx !== null) {
      const d = distPx[i] * pixelM; // convert pixels → metres
      const delta = d / slopeRatio!;

      if (orig >= targetElevation) {
        // Cut shoulder: slope rises from target to meet existing grade
        newVal = Math.min(orig, targetElevation + delta);
      } else {
        // Fill embankment: slope drops from target to meet existing grade
        newVal = Math.max(orig, targetElevation - delta);
      }
    } else {
      // Vertical walls — outside pixels unchanged
      newVal = orig;
    }

    modifiedGrid[i] = newVal;
    diffGrid[i]     = newVal - orig;

    if (newVal < stretchMin) stretchMin = newVal;
    if (newVal > stretchMax) stretchMax = newVal;
  }

  if (!isFinite(stretchMin)) stretchMin = hrdem.stretchMin;
  if (!isFinite(stretchMax)) stretchMax = hrdem.stretchMax;

  return {
    modifiedGrid,
    diffGrid,
    originalGrid: grid,
    insideMask: inside,
    targetElevation,
    cutVolume,
    fillVolume,
    cutArea,
    fillArea,
    bbox,
    width,
    height,
    nodata,
    stretchMin,
    stretchMax,
  };
}

// ---------------------------------------------------------------------------
// Volume balance optimizer — binary search for target elevation where
// |cutVolume - fillVolume| is minimised.
// ---------------------------------------------------------------------------

export function findBalancedElevation(
  hrdem: HRDEMResult,
  params: Omit<CutFillParams, 'targetElevation'>,
): number {
  const lo0 = hrdem.elevMin;
  const hi0 = hrdem.elevMax;

  const netAt = (elev: number): number => {
    const r = computeCutFill(hrdem, { ...params, targetElevation: elev });
    return r.fillVolume - r.cutVolume; // positive = net fill, negative = net cut
  };

  const netLo = netAt(lo0);
  const netHi = netAt(hi0);

  // If sign doesn't change, return endpoint with smallest |net|
  if (Math.sign(netLo) === Math.sign(netHi)) {
    return Math.abs(netLo) < Math.abs(netHi) ? lo0 : hi0;
  }

  let lo = lo0, hi = hi0;
  const signLo = Math.sign(netLo);

  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const netMid = netAt(mid);
    if (Math.abs(netMid) < 0.5) return mid;
    if (Math.sign(netMid) === signLo) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Hillshade — Lambertian shading using Horn's gradient method.
// Returns a Uint8Array of shade values 0–255 (0 = fully shadowed).
// ---------------------------------------------------------------------------

export function computeHillshadeGrid(
  grid: Float32Array,
  width: number,
  height: number,
  bbox: [number, number, number, number],
  nodata: number | null,
  azimuthDeg = 315,
  altitudeDeg = 45,
  zFactor = 1,
): Uint8Array {
  const [west, south, east, north] = bbox;
  const latMid = (south + north) / 2;
  const cy = ((north - south) / height) * 110540;
  const cx = ((east  - west)  / width)  * 111320 * Math.cos(latMid * Math.PI / 180);

  // Sun direction: azimuth 315° (NW), altitude 45°
  const azRad  = (azimuthDeg - 90) * Math.PI / 180;
  const altRad = altitudeDeg * Math.PI / 180;
  const lx =  Math.cos(altRad) * Math.cos(azRad);
  const ly =  Math.cos(altRad) * Math.sin(azRad);
  const lz =  Math.sin(altRad);

  const out = new Uint8Array(width * height).fill(128);

  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const center = grid[row * width + col];
      if (!isFinite(center) || (nodata !== null && Math.abs(center - nodata) < 0.001)) {
        out[row * width + col] = 0;
        continue;
      }

      const at = (r: number, c: number) => grid[r * width + c];
      const nw = at(row-1, col-1), n = at(row-1, col), ne = at(row-1, col+1);
      const w  = at(row,   col-1),                      e  = at(row,   col+1);
      const sw = at(row+1, col-1), s = at(row+1, col), se = at(row+1, col+1);

      const vals = [nw, n, ne, w, e, sw, s, se];
      if (vals.some(v => !isFinite(v))) { out[row * width + col] = 128; continue; }
      if (nodata !== null && vals.some(v => Math.abs(v - nodata) < 0.001)) {
        out[row * width + col] = 128;
        continue;
      }

      const dzdx = ((ne + 2*e + se) - (nw + 2*w + sw)) * zFactor / (8 * cx);
      const dzdy = ((nw + 2*n + ne) - (sw + 2*s + se)) * zFactor / (8 * cy);

      const nx = -dzdx;
      const ny = dzdy;
      const nz = 1.0;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);

      out[row * width + col] = Math.round(Math.max(0, Math.min(1, (nx*lx + ny*ly + nz*lz) / len)) * 255);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Daylight features — top-of-cut and toe-of-fill boundary lines
// ---------------------------------------------------------------------------

export function computeDaylightFeatures(result: CutFillResult): GeoJSON.FeatureCollection {
  const { diffGrid, insideMask, width, height, bbox } = result;
  const THRESH = 0.05;

  const cutZone  = new Float32Array(width * height);
  const fillZone = new Float32Array(width * height);

  for (let i = 0; i < diffGrid.length; i++) {
    if (insideMask[i]) continue;
    cutZone[i]  = diffGrid[i] >  THRESH ? 1.0 : 0.0;
    fillZone[i] = diffGrid[i] < -THRESH ? 1.0 : 0.0;
  }

  const makeHrdem = (grid: Float32Array): HRDEMResult => ({
    grid, width, height, bbox, nodata: null,
    elevMin: 0, elevMax: 1, stretchMin: 0, stretchMax: 1, validCount: width * height,
  });

  const cutFC  = generateThresholdContour(makeHrdem(cutZone),  0.5);
  const fillFC = generateThresholdContour(makeHrdem(fillZone), 0.5);

  const features: GeoJSON.Feature[] = [
    ...cutFC.features.map(f => ({
      ...f,
      properties: {
        type: 'top_of_cut',
        description: 'Top of cut',
        target_elevation: result.targetElevation,
      },
    })),
    ...fillFC.features.map(f => ({
      ...f,
      properties: {
        type: 'toe_of_fill',
        description: 'Toe of fill',
        target_elevation: result.targetElevation,
      },
    })),
  ];

  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Smooth a grid with a 3×3 box filter for contour generation.
// Does NOT modify the original grid — returns a new Float32Array.
// ---------------------------------------------------------------------------

export function smoothGridForContours(
  grid: Float32Array,
  width: number,
  height: number,
  nodata: number | null,
  passes = 2,
): Float32Array {
  let src = new Float32Array(grid);
  let dst = new Float32Array(grid.length);

  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const i = r * width + c;
        const v = src[i];
        if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) {
          dst[i] = v;
          continue;
        }
        let sum = 0, cnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const r2 = r + dr, c2 = c + dc;
            if (r2 < 0 || r2 >= height || c2 < 0 || c2 >= width) continue;
            const vn = src[r2 * width + c2];
            if (!isFinite(vn) || (nodata !== null && Math.abs(vn - nodata) < 0.001)) continue;
            sum += vn;
            cnt++;
          }
        }
        dst[i] = cnt > 0 ? sum / cnt : v;
      }
    }
    [src, dst] = [dst, src];
  }

  return src;
}

// ---------------------------------------------------------------------------
// Bilinear elevation sampling (for profile tool)
// ---------------------------------------------------------------------------

export function sampleElevationBilinear(
  grid: Float32Array,
  width: number,
  height: number,
  bbox: [number, number, number, number],
  nodata: number | null,
  lon: number,
  lat: number,
): number | null {
  const [west, south, east, north] = bbox;
  const xf = (lon  - west)  / (east  - west)  * (width  - 1);
  const yf = (north - lat)  / (north - south) * (height - 1);

  const x0 = Math.floor(xf), y0 = Math.floor(yf);
  const x1 = x0 + 1,         y1 = y0 + 1;
  if (x0 < 0 || x1 >= width || y0 < 0 || y1 >= height) return null;

  const tx = xf - x0, ty = yf - y0;
  const tl = grid[y0 * width + x0];
  const tr = grid[y0 * width + x1];
  const bl = grid[y1 * width + x0];
  const br = grid[y1 * width + x1];

  const vals = [tl, tr, bl, br];
  if (vals.some(v => !isFinite(v))) return null;
  if (nodata !== null && vals.some(v => Math.abs(v - nodata) < 0.001)) return null;

  return (tl + (tr - tl) * tx) * (1 - ty) + (bl + (br - bl) * tx) * ty;
}

// ---------------------------------------------------------------------------
// Nearest-pixel elevation sampling
// ---------------------------------------------------------------------------

export function sampleElevation(
  grid: Float32Array,
  width: number,
  height: number,
  bbox: [number, number, number, number],
  nodata: number | null,
  lon: number,
  lat: number,
): number | null {
  const [west, south, east, north] = bbox;
  const col = Math.round((lon - west)   / (east  - west)  * (width  - 1));
  const row = Math.round((north - lat)  / (north - south) * (height - 1));
  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  const v = grid[row * width + col];
  if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) return null;
  return v;
}

// ---------------------------------------------------------------------------
// Polygon rasterization — scan-line fill
// ---------------------------------------------------------------------------

function rasterizePolygon(
  ring: [number, number][],
  width: number,
  height: number,
  west: number,
  south: number,
  east: number,
  north: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);

  const pxRing = ring.map(([lon, lat]): [number, number] => [
    (lon - west)   / (east  - west)  * (width  - 1),
    (north - lat)  / (north - south) * (height - 1),
  ]);

  for (let row = 0; row < height; row++) {
    const xs: number[] = [];
    const n = pxRing.length;

    for (let j = 0, k = n - 1; j < n; k = j++) {
      const [x1, y1] = pxRing[j];
      const [x2, y2] = pxRing[k];

      if ((y1 <= row && y2 > row) || (y2 <= row && y1 > row)) {
        xs.push(x1 + ((row - y1) / (y2 - y1)) * (x2 - x1));
      }
    }

    xs.sort((a, b) => a - b);

    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil(xs[i]));
      const c1 = Math.min(width - 1, Math.floor(xs[i + 1]));
      for (let col = c0; col <= c1; col++) {
        mask[row * width + col] = 1;
      }
    }
  }

  return mask;
}

// ---------------------------------------------------------------------------
// Exact Euclidean Distance Transform (Felzenszwalb & Huttenlocher, 2012)
//
// Returns pixel distances from each outside pixel to the nearest inside
// pixel.  Inside pixels are set to 0.  Uses the separable 1D parabola
// envelope method — O(width × height), exact Euclidean (not Manhattan).
// ---------------------------------------------------------------------------

function computeEuclideanDT(mask: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e10; // larger than any possible squared pixel distance
  const n   = width * height;

  // Initialise squared-distance grid
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) sq[i] = mask[i] ? 0 : INF;

  // Reusable scratch buffers
  const bufLen = Math.max(width, height);
  const buf = new Float32Array(bufLen);
  const v   = new Int32Array(bufLen);
  const z   = new Float32Array(bufLen + 1);

  // Row pass: squared horizontal distance to nearest inside pixel per row
  for (let r = 0; r < height; r++) {
    const off = r * width;
    for (let c = 0; c < width; c++) buf[c] = sq[off + c];
    dt1d(buf, width, v, z, INF);
    for (let c = 0; c < width; c++) sq[off + c] = buf[c];
  }

  // Column pass: combine row DT with vertical component → 2D squared distance
  const out = new Float32Array(n);
  for (let c = 0; c < width; c++) {
    for (let r = 0; r < height; r++) buf[r] = sq[r * width + c];
    dt1d(buf, height, v, z, INF);
    for (let r = 0; r < height; r++) {
      out[r * width + c] = mask[r * width + c] ? 0 : Math.sqrt(buf[r]);
    }
  }

  return out;
}

/**
 * 1D squared Euclidean DT using the lower parabola envelope method.
 * Modifies `f` in-place.  INF marks non-source entries.
 * `v` and `z` are pre-allocated scratch buffers.
 */
function dt1d(f: Float32Array, n: number, v: Int32Array, z: Float32Array, INF: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] =  INF;

  for (let q = 1; q < n; q++) {
    const fq = f[q];
    let s: number;
    // Remove parabola centres that are no longer on the lower envelope
    while (k >= 0) {
      const vk = v[k];
      s = ((fq + q * q) - (f[vk] + vk * vk)) / (2 * (q - vk));
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k]     = k === 0 ? -INF : ((fq + q * q) - (f[v[k-1]] + v[k-1] * v[k-1])) / (2 * (q - v[k-1]));
    z[k + 1] = INF;
  }

  // Backward pass: assign each position to its nearest source
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const vk   = v[k];
    const diff = q - vk;
    f[q] = diff * diff + f[vk];
  }
}
