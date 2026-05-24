/**
 * DEM-derived product computations (slope, aspect, TPI).
 *
 * All functions operate directly on HRDEMResult.grid (Float32Array).
 * Invalid/border pixels are written as NaN so callers can treat them
 * as transparent consistently.
 */

import type { HRDEMResult } from './hrdemWCS';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellSizeMeters(
  bbox: [number, number, number, number],
  width: number,
  height: number,
): { cx: number; cy: number } {
  const [west, south, east, north] = bbox;
  const latCenter = (north + south) / 2;
  const cy = ((north - south) / height) * 110540;
  const cx = ((east  - west)  / width)  * 111320 * Math.cos(latCenter * Math.PI / 180);
  return { cx: Math.max(cx, 0.01), cy: Math.max(cy, 0.01) };
}

/** Compute Horn's method dz/dx and dz/dy for a given cell. Returns null for
 *  border pixels or any non-finite / nodata neighbour. */
function hornGradients(
  grid: Float32Array,
  width: number,
  height: number,
  row: number,
  col: number,
  cx: number,
  cy: number,
  nodata: number | null,
): { dzdx: number; dzdy: number } | null {
  if (row < 1 || row >= height - 1 || col < 1 || col >= width - 1) return null;

  const at = (r: number, c: number) => grid[r * width + c];
  const nw = at(row - 1, col - 1), n = at(row - 1, col), ne = at(row - 1, col + 1);
  const w  = at(row,     col - 1),                        e  = at(row,     col + 1);
  const sw = at(row + 1, col - 1), s = at(row + 1, col), se = at(row + 1, col + 1);

  const vals = [nw, n, ne, w, e, sw, s, se];
  if (vals.some(v => !isFinite(v))) return null;
  if (nodata !== null && vals.some(v => Math.abs(v - nodata) < 0.001)) return null;

  const dzdx = ((ne + 2 * e + se) - (nw + 2 * w + sw)) / (8 * cx);
  const dzdy = ((nw + 2 * n + ne) - (sw + 2 * s + se)) / (8 * cy);
  return { dzdx, dzdy };
}

// ---------------------------------------------------------------------------
// Slope (0–90°)
// ---------------------------------------------------------------------------

export interface SlopeResult {
  grid: Float32Array;
  min: number;
  max: number;
}

export function computeSlope(result: HRDEMResult): SlopeResult {
  const { grid, width, height, bbox, nodata } = result;
  const { cx, cy } = cellSizeMeters(bbox, width, height);
  const out = new Float32Array(grid.length).fill(NaN);
  let min = Infinity, max = -Infinity;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const center = grid[row * width + col];
      if (!isFinite(center)) continue;
      if (nodata !== null && Math.abs(center - nodata) < 0.001) continue;

      const g = hornGradients(grid, width, height, row, col, cx, cy, nodata);
      if (!g) continue;

      const slope = Math.atan(Math.sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy)) * 180 / Math.PI;
      out[row * width + col] = slope;
      if (slope < min) min = slope;
      if (slope > max) max = slope;
    }
  }

  return {
    grid: out,
    min: isFinite(min) ? min : 0,
    max: isFinite(max) ? max : 90,
  };
}

// ---------------------------------------------------------------------------
// Aspect (0–360° from North, clockwise; -1 = flat)
// ---------------------------------------------------------------------------

export interface AspectResult {
  grid: Float32Array;
}

export function computeAspect(result: HRDEMResult): AspectResult {
  const { grid, width, height, bbox, nodata } = result;
  const { cx, cy } = cellSizeMeters(bbox, width, height);
  const out = new Float32Array(grid.length).fill(NaN);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const center = grid[row * width + col];
      if (!isFinite(center)) continue;
      if (nodata !== null && Math.abs(center - nodata) < 0.001) continue;

      const g = hornGradients(grid, width, height, row, col, cx, cy, nodata);
      if (!g) continue;

      const mag = Math.sqrt(g.dzdx * g.dzdx + g.dzdy * g.dzdy);
      if (mag < 1e-6) {
        out[row * width + col] = -1; // flat — use sentinel
        continue;
      }

      // Degrees from North, clockwise
      let aspect = 90 - Math.atan2(g.dzdy, -g.dzdx) * 180 / Math.PI;
      if (aspect < 0)   aspect += 360;
      if (aspect >= 360) aspect -= 360;
      out[row * width + col] = aspect;
    }
  }

  return { grid: out };
}

// ---------------------------------------------------------------------------
// TPI — Topographic Position Index (centre − mean of 8 neighbours)
// ---------------------------------------------------------------------------

export interface TPIResult {
  grid: Float32Array;
  min: number;
  max: number;
}

export function computeTPI(result: HRDEMResult): TPIResult {
  const { grid, width, height, nodata } = result;
  const out = new Float32Array(grid.length).fill(NaN);
  let min = Infinity, max = -Infinity;

  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const center = grid[row * width + col];
      if (!isFinite(center)) continue;
      if (nodata !== null && Math.abs(center - nodata) < 0.001) continue;

      let sum = 0, count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const v = grid[(row + dr) * width + (col + dc)];
          if (!isFinite(v)) continue;
          if (nodata !== null && Math.abs(v - nodata) < 0.001) continue;
          sum += v;
          count++;
        }
      }
      if (count === 0) continue;

      const tpi = center - sum / count;
      out[row * width + col] = tpi;
      if (tpi < min) min = tpi;
      if (tpi > max) max = tpi;
    }
  }

  return {
    grid: out,
    min: isFinite(min) ? min : -1,
    max: isFinite(max) ? max :  1,
  };
}
