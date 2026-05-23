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
// Named ramp catalogue
// ---------------------------------------------------------------------------

export const HRDEM_RAMPS: Record<string, { label: string; ramp: ColorRamp }> = {
  hypsometric: {
    label: 'Hypsometric',
    ramp: DEFAULT_HYPSOMETRIC,
  },
  terrain: {
    label: 'Terrain',
    ramp: { stops: [
      { t: 0.00, r:  51, g: 102, b:   0 },  // dark green
      { t: 0.35, r: 180, g: 160, b:  90 },  // tan
      { t: 0.65, r: 150, g: 100, b:  55 },  // brown
      { t: 0.85, r: 180, g: 170, b: 160 },  // grey rock
      { t: 1.00, r: 255, g: 255, b: 255 },  // snow
    ]},
  },
  greyscale: {
    label: 'Greyscale',
    ramp: { stops: [
      { t: 0, r:   0, g:   0, b:   0 },
      { t: 1, r: 255, g: 255, b: 255 },
    ]},
  },
  greyscale_r: {
    label: 'Greyscale (R)',
    ramp: { stops: [
      { t: 0, r: 255, g: 255, b: 255 },
      { t: 1, r:   0, g:   0, b:   0 },
    ]},
  },
  viridis: {
    label: 'Viridis',
    ramp: { stops: [
      { t: 0.00, r:  68, g:   1, b:  84 },
      { t: 0.25, r:  59, g:  82, b: 139 },
      { t: 0.50, r:  33, g: 145, b: 140 },
      { t: 0.75, r:  94, g: 201, b:  98 },
      { t: 1.00, r: 253, g: 231, b:  37 },
    ]},
  },
  plasma: {
    label: 'Plasma',
    ramp: { stops: [
      { t: 0.00, r:  13, g:   8, b: 135 },
      { t: 0.25, r: 156, g:  23, b: 158 },
      { t: 0.50, r: 237, g: 121, b:  83 },
      { t: 0.75, r: 246, g: 207, b:  32 },
      { t: 1.00, r: 240, g: 249, b:  33 },
    ]},
  },
  inferno: {
    label: 'Inferno',
    ramp: { stops: [
      { t: 0.00, r:   0, g:   0, b:   4 },
      { t: 0.25, r:  87, g:  16, b: 110 },
      { t: 0.50, r: 188, g:  55, b:  84 },
      { t: 0.75, r: 249, g: 142, b:   9 },
      { t: 1.00, r: 252, g: 255, b: 164 },
    ]},
  },
  rdylbu: {
    label: 'RdYlBu',
    ramp: { stops: [
      { t: 0.00, r: 165, g:   0, b:  38 },
      { t: 0.25, r: 244, g: 109, b:  67 },
      { t: 0.50, r: 255, g: 255, b: 191 },
      { t: 0.75, r: 116, g: 173, b: 209 },
      { t: 1.00, r:  49, g:  54, b: 149 },
    ]},
  },
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
 * Return a new ColorRamp with the colour order reversed (t positions stay).
 * Low elevations get the high-end colour and vice-versa.
 */
export function invertRamp(ramp: ColorRamp): ColorRamp {
  const n = ramp.stops.length;
  return {
    stops: ramp.stops.map((s, i) => ({
      t: s.t,
      r: ramp.stops[n - 1 - i].r,
      g: ramp.stops[n - 1 - i].g,
      b: ramp.stops[n - 1 - i].b,
    })),
  };
}

/**
 * Render an elevation grid onto an HTMLCanvasElement.
 *
 * The canvas is resized to match the grid dimensions.
 * Nodata, NaN, and ±Infinity pixels are written as fully transparent.
 * Colour stretch is always min→max of the values present in this tile
 * (i.e. per-view dynamic range expansion).
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

/**
 * Build a CSS linear-gradient string from a colour ramp (left → right).
 * Used for horizontal preview swatches in the UI.
 */
export function rampToHorizontalGradient(ramp: ColorRamp): string {
  const stops = ramp.stops
    .map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t * 100).toFixed(0)}%`)
    .join(', ');
  return `linear-gradient(to right, ${stops})`;
}

