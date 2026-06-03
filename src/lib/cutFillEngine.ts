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

  // Distance transform (pixels from polygon boundary, outside only)
  const distPx = slopeRatio !== null
    ? computeDistanceTransform(inside, width, height)
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

  // Binary search — converges in 30 iterations to sub-mm precision
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const netMid = netAt(mid);
    if (Math.abs(netMid) < 0.5) return mid; // close enough (< 0.5 m³ net)
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
): Uint8Array {
  const [west, south, east, north] = bbox;
  const latMid = (south + north) / 2;
  const cy = ((north - south) / height) * 110540;
  const cx = ((east  - west)  / width)  * 111320 * Math.cos(latMid * Math.PI / 180);

  // Sun direction: azimuth 315° (NW), altitude 45°
  const azRad  = (315 - 90) * Math.PI / 180; // convert to math convention
  const altRad = 45 * Math.PI / 180;
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

      const dzdx = ((ne + 2*e + se) - (nw + 2*w + sw)) / (8 * cx);
      const dzdy = ((nw + 2*n + ne) - (sw + 2*s + se)) / (8 * cy);

      // Surface normal (unnormalized): (-dzdx, -dzdy, 1) in geographic coords
      const nx = -dzdx;
      const ny = dzdy; // positive Y = north
      const nz = 1.0;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);

      const dot = (nx*lx + ny*ly + nz*lz) / len;
      out[row * width + col] = Math.round(Math.max(0, Math.min(1, dot)) * 255);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Daylight features — top-of-cut and toe-of-fill boundary lines
// ---------------------------------------------------------------------------

export function computeDaylightFeatures(result: CutFillResult): GeoJSON.FeatureCollection {
  const { diffGrid, insideMask, width, height, bbox } = result;
  const THRESH = 0.05; // metres — threshold to count as "modified"

  // Build separate float grids for cut shoulder and fill embankment zones
  const cutZone  = new Float32Array(width * height);
  const fillZone = new Float32Array(width * height);

  for (let i = 0; i < diffGrid.length; i++) {
    if (insideMask[i]) continue; // inside polygon — not the daylight zone
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
// Elevation sampling (standalone, mirrors HRDEMLayer private method)
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

  // Convert ring from [lon, lat] to pixel coords (col, row)
  const pxRing = ring.map(([lon, lat]): [number, number] => [
    (lon - west)   / (east  - west)  * (width  - 1),
    (north - lat)  / (north - south) * (height - 1),
  ]);

  // Scan-line fill: for each integer row, find X-intersections with ring edges
  for (let row = 0; row < height; row++) {
    const xs: number[] = [];
    const n = pxRing.length;

    for (let j = 0, k = n - 1; j < n; k = j++) {
      const [x1, y1] = pxRing[j];
      const [x2, y2] = pxRing[k];

      if ((y1 <= row && y2 > row) || (y2 <= row && y1 > row)) {
        // Compute X intersection using linear interpolation
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
// Distance transform — 4-connectivity BFS from inside/outside boundary
// ---------------------------------------------------------------------------

function computeDistanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  // dist[i] = distance in pixels from the nearest polygon boundary, for outside pixels.
  // Inside pixels and boundary-adjacent pixels start at 0 / 1.
  const dist = new Float32Array(width * height).fill(-1);
  const queue: number[] = [];

  // Seed: outside pixels that are 4-adjacent to an inside pixel
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (mask[i]) {
        dist[i] = 0;  // inside — zero distance (not used in slope calc)
        continue;
      }
      const adjacent =
        (r > 0          && mask[(r - 1) * width + c]) ||
        (r < height - 1 && mask[(r + 1) * width + c]) ||
        (c > 0          && mask[r * width + (c - 1)]) ||
        (c < width - 1  && mask[r * width + (c + 1)]);
      if (adjacent) {
        dist[i] = 1;
        queue.push(i);
      }
    }
  }

  // BFS expansion — 4-connectivity, uniform cost
  let qi = 0;
  while (qi < queue.length) {
    const i   = queue[qi++];
    const r   = (i / width) | 0;
    const c   = i % width;
    const d   = dist[i];
    const nbr = [
      r > 0          ? i - width : -1,
      r < height - 1 ? i + width : -1,
      c > 0          ? i - 1     : -1,
      c < width - 1  ? i + 1     : -1,
    ];
    for (const ni of nbr) {
      if (ni >= 0 && dist[ni] < 0) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }

  return dist;
}
