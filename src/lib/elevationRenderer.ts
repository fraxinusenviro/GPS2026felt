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
// Product-specific ramps (not user-selectable, used internally)
// ---------------------------------------------------------------------------

/** Slope: white (flat) → light green → brown → near-black (steep). */
export const SLOPE_RAMP: ColorRamp = {
  stops: [
    { t: 0.00, r: 255, g: 255, b: 255 },
    { t: 0.25, r: 195, g: 220, b: 185 },
    { t: 0.55, r: 150, g: 115, b:  65 },
    { t: 1.00, r:  25, g:  15, b:   5 },
  ],
};

/** CHM: transparent/dark (0 m) → lime-green → deep forest-green (40 m+). */
const CHM_DEFAULT_RAMP: ColorRamp = {
  stops: [
    { t: 0.00, r:  30, g:  50, b:  20 },
    { t: 0.10, r:  80, g: 155, b:  65 },
    { t: 0.35, r:  60, g: 158, b:  55 },
    { t: 0.65, r:  30, g: 120, b:  50 },
    { t: 1.00, r:  10, g:  70, b:  35 },
  ],
};

// ---------------------------------------------------------------------------
// CHM ramp catalogue and class breaks
// ---------------------------------------------------------------------------

export const CHM_RAMPS: Record<string, { label: string; ramp: ColorRamp }> = {
  canopy_green: {
    label: 'Canopy',
    ramp: CHM_DEFAULT_RAMP,
  },
  height_map: {
    label: 'Height',
    ramp: { stops: [
      { t: 0.00, r: 230, g: 215, b: 170 },  // cream/sand (bare)
      { t: 0.20, r: 195, g: 225, b: 110 },  // yellow-green
      { t: 0.50, r:  90, g: 185, b:  75 },  // medium green
      { t: 0.80, r:  30, g: 130, b:  55 },  // forest green
      { t: 1.00, r:   5, g:  60, b:  30 },  // dark forest
    ]},
  },
  turbo: {
    label: 'Turbo',
    ramp: { stops: [
      { t: 0.00, r:  48, g:  18, b:  59 },  // dark purple
      { t: 0.25, r:  49, g: 167, b: 165 },  // teal
      { t: 0.50, r: 122, g: 229, b:  86 },  // lime
      { t: 0.75, r: 249, g: 156, b:  26 },  // orange
      { t: 1.00, r: 178, g:  24, b:  43 },  // deep red
    ]},
  },
  inferno: {
    label: 'Inferno',
    ramp: HRDEM_RAMPS.inferno.ramp,
  },
};

/** Structural canopy height class breaks (CHM classified mode). */
export const CHM_CLASSES: Array<{ max: number; label: string; r: number; g: number; b: number }> = [
  { max: 0.10,     label: '<0.1 m',       r: 180, g: 162, b: 120 },  // bare/soil
  { max: 0.25,     label: '0.1–0.25 m',   r: 210, g: 200, b:  90 },  // ground veg
  { max: 0.50,     label: '0.25–0.5 m',   r: 165, g: 215, b:  80 },  // low shrub
  { max: 2.00,     label: '0.5–2 m',      r:  95, g: 190, b:  60 },  // tall shrub
  { max: 7.00,     label: '2–7 m',        r:  45, g: 155, b:  45 },  // pole/young tree
  { max: 15.00,    label: '7–15 m',       r:  20, g: 110, b:  35 },  // mature forest
  { max: Infinity, label: '>15 m',        r:   5, g:  65, b:  25 },  // tall forest
];

/** Render a CHM grid using the classified structural break scheme. */
export function renderCHMClassified(
  canvas: HTMLCanvasElement,
  grid: Float32Array,
  width: number,
  height: number,
): void {
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;
  const n = CHM_CLASSES.length;
  for (let i = 0; i < grid.length; i++) {
    const v  = grid[i];
    const px = i * 4;
    if (!isFinite(v)) { pixels[px + 3] = 0; continue; }
    let cls = CHM_CLASSES[n - 1];
    for (let c = 0; c < n; c++) { if (v < CHM_CLASSES[c].max) { cls = CHM_CLASSES[c]; break; } }
    pixels[px] = cls.r; pixels[px + 1] = cls.g; pixels[px + 2] = cls.b; pixels[px + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/** TPI: deep-blue (valley) → light-blue → cream (midslope) → orange → red (peak). */
export const TPI_RAMP: ColorRamp = {
  stops: [
    { t: 0.00, r:  49, g:  54, b: 149 },
    { t: 0.35, r: 116, g: 173, b: 209 },
    { t: 0.50, r: 255, g: 255, b: 191 },
    { t: 0.65, r: 244, g: 109, b:  67 },
    { t: 1.00, r: 165, g:   0, b:  38 },
  ],
};

// ---------------------------------------------------------------------------
// Named slope ramp catalogue
// ---------------------------------------------------------------------------

export const SLOPE_RAMPS: Record<string, { label: string; ramp: ColorRamp }> = {
  classic: {
    label: 'Classic',
    ramp: SLOPE_RAMP,
  },
  grey: {
    label: 'Greyscale',
    ramp: { stops: [
      { t: 0, r: 255, g: 255, b: 255 },
      { t: 1, r:  20, g:  20, b:  20 },
    ]},
  },
  warm: {
    label: 'Warm',
    ramp: { stops: [
      { t: 0.00, r: 255, g: 252, b: 220 },
      { t: 0.40, r: 249, g: 180, b:  70 },
      { t: 0.75, r: 210, g:  80, b:  20 },
      { t: 1.00, r: 100, g:  15, b:   5 },
    ]},
  },
  stoplight: {
    label: 'Green→Red',
    ramp: { stops: [
      { t: 0.00, r:  54, g: 155, b:  85 },
      { t: 0.35, r: 210, g: 215, b:  65 },
      { t: 0.65, r: 230, g: 110, b:  40 },
      { t: 1.00, r: 165, g:   0, b:  38 },
    ]},
  },
  plasma: {
    label: 'Plasma',
    ramp: HRDEM_RAMPS.plasma.ramp,
  },
};

// ---------------------------------------------------------------------------
// Named TPI ramp catalogue
// ---------------------------------------------------------------------------

export const TPI_RAMPS: Record<string, { label: string; ramp: ColorRamp }> = {
  rdylbu: {
    label: 'RdYlBu',
    ramp: TPI_RAMP,
  },
  brbg: {
    label: 'BrBG',
    ramp: { stops: [
      { t: 0.00, r: 140, g:  81, b:  10 },
      { t: 0.35, r: 216, g: 179, b: 101 },
      { t: 0.50, r: 245, g: 245, b: 245 },
      { t: 0.65, r: 128, g: 205, b: 193 },
      { t: 1.00, r:   1, g: 102, b:  94 },
    ]},
  },
  piyg: {
    label: 'PiYG',
    ramp: { stops: [
      { t: 0.00, r: 197, g:  27, b: 125 },
      { t: 0.35, r: 233, g: 163, b: 201 },
      { t: 0.50, r: 247, g: 247, b: 247 },
      { t: 0.65, r: 161, g: 215, b:  74 },
      { t: 1.00, r:  77, g: 146, b:  33 },
    ]},
  },
  spectral: {
    label: 'Spectral',
    ramp: { stops: [
      { t: 0.00, r: 213, g:  62, b:  79 },
      { t: 0.25, r: 253, g: 174, b:  97 },
      { t: 0.50, r: 255, g: 255, b: 191 },
      { t: 0.75, r: 102, g: 194, b: 165 },
      { t: 1.00, r:  50, g: 136, b: 189 },
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
 * Colour is mapped using the 2nd–98th percentile stretch range stored in
 * `result.stretchMin` / `result.stretchMax`, so ocean-at-zero or outlier
 * peaks don't collapse the entire land relief into one colour.
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
  const { grid, width, height, nodata, stretchMin, stretchMax } = result;
  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const pixels    = imageData.data;
  const range     = stretchMax - stretchMin;

  for (let i = 0; i < grid.length; i++) {
    const v  = grid[i];
    const px = i * 4;

    // Transparent for nodata / non-finite values
    if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) {
      pixels[px + 3] = 0;
      continue;
    }

    const t = range > 0 ? Math.max(0, Math.min(1, (v - stretchMin) / range)) : 0.5;
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

/**
 * Generic grid renderer — same pixel loop as renderElevation() but with
 * explicit min/max instead of stretchMin/stretchMax from HRDEMResult.
 * NaN pixels → transparent (nodata argument is for raw source grids; pass
 * null for pre-computed derived grids which already use NaN for invalid).
 */
export function renderGrid(
  canvas: HTMLCanvasElement,
  grid: Float32Array,
  width: number,
  height: number,
  min: number,
  max: number,
  nodata: number | null,
  ramp: ColorRamp,
): HTMLCanvasElement {
  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const pixels    = imageData.data;
  const range     = max - min;

  for (let i = 0; i < grid.length; i++) {
    const v  = grid[i];
    const px = i * 4;

    if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) {
      pixels[px + 3] = 0;
      continue;
    }

    const t = range > 0 ? Math.max(0, Math.min(1, (v - min) / range)) : 0.5;
    const [r, g, b] = sampleRamp(ramp, t);
    pixels[px]     = r;
    pixels[px + 1] = g;
    pixels[px + 2] = b;
    pixels[px + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** HSL → RGB helper (h ∈ [0,1], s/l ∈ [0,1]) → [r,g,b] 0-255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 1 / 6) { r = c; g = x; b = 0; }
  else if (h < 2 / 6) { r = x; g = c; b = 0; }
  else if (h < 3 / 6) { r = 0; g = c; b = x; }
  else if (h < 4 / 6) { r = 0; g = x; b = c; }
  else if (h < 5 / 6) { r = x; g = 0; b = c; }
  else                 { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Render an aspect grid using a circular hue wheel.
 * - Values in [0, 360): hue = aspect_deg mapped to HSL(hue, 80%, 50%)
 * - Value -1 (flat sentinel): semi-transparent grey
 * - NaN: transparent
 */
export function renderAspect(
  canvas: HTMLCanvasElement,
  grid: Float32Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const pixels    = imageData.data;

  for (let i = 0; i < grid.length; i++) {
    const v  = grid[i];
    const px = i * 4;

    if (!isFinite(v)) { pixels[px + 3] = 0; continue; }

    if (v === -1) {
      // Flat area — light grey, semi-transparent
      pixels[px] = 160; pixels[px + 1] = 160; pixels[px + 2] = 160; pixels[px + 3] = 180;
      continue;
    }

    const [r, g, b] = hslToRgb(v / 360, 0.8, 0.5);
    pixels[px]     = r;
    pixels[px + 1] = g;
    pixels[px + 2] = b;
    pixels[px + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

