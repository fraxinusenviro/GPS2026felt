/**
 * Canvas-based elevation renderer.
 *
 * Paints a Float32Array elevation grid onto an HTMLCanvasElement using a
 * configurable colour ramp. The interface is deliberately kept pure
 * (Float32Array in → canvas out) so this renderer can be replaced with a
 * WebGL implementation later without changing callers.
 */

import type { HRDEMResult } from './hrdemWCS';

// ---------------------------------------------------------------------------
// Colour-ramp types
// ---------------------------------------------------------------------------

/** A single stop in a colour ramp. `t` is normalised [0, 1] (maps to data min/max). */
export interface RampStop {
  t: number;
  r: number;
  g: number;
  b: number;
}

export interface ColorRamp {
  stops: RampStop[];
}

/**
 * Default 5-stop hypsometric tint:
 *   deep blue (lowest) → green → yellow → orange-brown → white (highest).
 * Stops are normalised so they stretch across whatever elevation range is present.
 */
export const DEFAULT_HYPSOMETRIC: ColorRamp = {
  stops: [
    { t: 0.00, r:   8, g:  48, b: 107 },  // deep blue
    { t: 0.25, r:  65, g: 145, b:  90 },  // mid-green
    { t: 0.50, r: 210, g: 195, b:  90 },  // yellow
    { t: 0.75, r: 185, g: 115, b:  55 },  // orange-brown
    { t: 1.00, r: 238, g: 238, b: 238 },  // near-white
  ],
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Linearly interpolate an RGB colour between two stops. */
function lerpStop(
  a: RampStop,
  b: RampStop,
  t: number,
): [number, number, number] {
  const f = (t - a.t) / (b.t - a.t);
  return [
    Math.round(lerp(a.r, b.r, f)),
    Math.round(lerp(a.g, b.g, f)),
    Math.round(lerp(a.b, b.b, f)),
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Sample the colour ramp at normalised position t ∈ [0, 1]. */
export function sampleRamp(ramp: ColorRamp, t: number): [number, number, number] {
  const stops = ramp.stops;
  if (stops.length === 0) return [0, 0, 0];
  if (t <= stops[0].t) return [stops[0].r, stops[0].g, stops[0].b];
  const last = stops[stops.length - 1];
  if (t >= last.t) return [last.r, last.g, last.b];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      return lerpStop(stops[i], stops[i + 1], t);
    }
  }
  return [stops[0].r, stops[0].g, stops[0].b];
}

/**
 * Render an elevation grid onto an HTMLCanvasElement.
 *
 * The canvas is resized to match the grid dimensions.
 * Nodata, NaN, and ±Infinity pixels are written as fully transparent.
 *
 * @param canvas  Target canvas (will be resized to grid width × height)
 * @param result  Decoded HRDEM data from fetchHRDEM()
 * @param ramp    Colour ramp to apply; defaults to DEFAULT_HYPSOMETRIC
 * @returns       The same canvas element (for chaining)
 */
export function renderElevation(
  canvas: HTMLCanvasElement,
  result: HRDEMResult,
  ramp: ColorRamp = DEFAULT_HYPSOMETRIC,
): HTMLCanvasElement {
  const { grid, width, height, nodata, elevMin, elevMax } = result;
  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const pixels    = imageData.data;
  const range     = elevMax - elevMin;

  for (let i = 0; i < grid.length; i++) {
    const v  = grid[i];
    const px = i * 4;

    // Transparent for nodata / non-finite values
    if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) {
      pixels[px + 3] = 0;
      continue;
    }

    const t = range > 0 ? Math.max(0, Math.min(1, (v - elevMin) / range)) : 0.5;
    const [r, g, b] = sampleRamp(ramp, t);
    pixels[px]     = r;
    pixels[px + 1] = g;
    pixels[px + 2] = b;
    pixels[px + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Build a CSS linear-gradient string from a colour ramp (bottom → top).
 * Used to paint the legend bar.
 */
export function rampToGradient(ramp: ColorRamp): string {
  const stops = ramp.stops
    .map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t * 100).toFixed(0)}%`)
    .join(', ');
  return `linear-gradient(to top, ${stops})`;
}
