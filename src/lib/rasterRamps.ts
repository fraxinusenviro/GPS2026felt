// Shared raster colour-ramp catalogue + classification / stretch helpers.
//
// One ramp catalogue serves every raster pipeline in the app:
//   - COG layers (colormap stops fed to the cog:// protocol)
//   - HRDEM WCS products (canvas ColorRamp rendering)
//   - Plain RGB tile layers / web sources (luminance LUT via the rampify:// protocol)
//
// Keys are lower-case and remain backward-compatible with the legacy COG_RAMPS
// ids persisted in saved stacks ('viridis', 'grays', 'grays_r', …).

import type { ColorRamp } from './elevationRenderer';
import { SEQ_RAMPS, CLASSIFIERS } from './symbologyEngine';
import type { ClassifierName, RasterSymbologyState } from '../types';

export type RGB = [number, number, number];

export interface RasterRampDef {
  label: string;
  stops: RGB[];
}

function hex2rgb(h: string): RGB {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// Build the catalogue from the vector studio's ramps so both studios stay in sync.
export const RASTER_RAMPS: Record<string, RasterRampDef> = {};
for (const [name, hexes] of Object.entries(SEQ_RAMPS)) {
  const key = name === 'Greys' ? 'grays' : name.toLowerCase();
  RASTER_RAMPS[key] = { label: name, stops: hexes.map(hex2rgb) };
}
RASTER_RAMPS['grays_r'] = { label: 'Greys (R)', stops: [[0, 0, 0], [255, 255, 255]] };

// ---- Sampling ----

/** Interpolated colour at normalised position t ∈ [0,1] along the stop list. */
export function rampColorAt(stops: RGB[], t: number, invert = false): RGB {
  if (stops.length === 0) return [0, 0, 0];
  const tt = Math.max(0, Math.min(1, invert ? 1 - t : t));
  const pos = tt * (stops.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(stops.length - 1, lo + 1);
  const f = pos - lo;
  const a = stops[lo], b = stops[hi];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** n evenly spaced discrete colours from a ramp (for classified rendering). */
export function sampleRampColors(stops: RGB[], n: number, invert = false): RGB[] {
  if (n <= 1) return [rampColorAt(stops, 0.5, invert)];
  return Array.from({ length: n }, (_, i) => rampColorAt(stops, i / (n - 1), invert));
}

/** CSS linear-gradient preview string (left → right). */
export function rampCssGradient(stops: RGB[], invert = false): string {
  const list = invert ? [...stops].reverse() : stops;
  return `linear-gradient(to right,${list.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(',')})`;
}

/** Convert ramp stops to an elevationRenderer ColorRamp (evenly spaced t). */
export function stopsToColorRamp(stops: RGB[], invert = false): ColorRamp {
  const list = invert ? [...stops].reverse() : stops;
  const n = list.length;
  return {
    stops: list.map((c, i) => ({ t: n > 1 ? i / (n - 1) : 0, r: c[0], g: c[1], b: c[2] })),
  };
}

/** Catalogue exposed as elevationRenderer-style entries (for HRDEM ramp resolution). */
export const EXTENDED_COLOR_RAMPS: Record<string, { label: string; ramp: ColorRamp }> =
  Object.fromEntries(Object.entries(RASTER_RAMPS).map(([k, def]) =>
    [k, { label: def.label, ramp: stopsToColorRamp(def.stops) }]));

// ---- Classification ----

/**
 * Compute class break values from raw data using one of the studio classifiers.
 * Values are sampled before running Jenks (O(n²)) so large grids stay fast.
 */
export function computeClassBreaks(
  values: number[] | Float32Array,
  k: number,
  classifier: ClassifierName,
): number[] {
  const finite: number[] = [];
  const maxSamples = classifier === 'Natural breaks' ? 1200 : 5000;
  const step = Math.max(1, Math.floor(values.length / maxSamples));
  for (let i = 0; i < values.length; i += step) {
    const v = values[i];
    if (isFinite(v)) finite.push(v);
  }
  if (finite.length < k) return [];
  const fn = CLASSIFIERS[classifier] ?? CLASSIFIERS['Equal interval'];
  const breaks = [...new Set(fn(finite, k))].sort((a, b) => a - b);
  return breaks;
}

/**
 * Build a stepped (piecewise-constant) ColorRamp for classified rendering.
 * `breaks` are data values; `min`/`max` define the render range used by the caller.
 */
export function buildClassedColorRamp(
  stops: RGB[],
  invert: boolean,
  breaks: number[],
  min: number,
  max: number,
): ColorRamp {
  const range = max - min || 1;
  const ts = breaks
    .map(b => (b - min) / range)
    .filter(t => t > 0 && t < 1)
    .sort((a, b) => a - b);
  const colors = sampleRampColors(stops, ts.length + 1, invert);
  const out: ColorRamp = { stops: [] };
  const EPS = 0.0001;
  out.stops.push({ t: 0, r: colors[0][0], g: colors[0][1], b: colors[0][2] });
  ts.forEach((t, i) => {
    const a = colors[i], b = colors[i + 1];
    out.stops.push({ t: Math.max(0, t - EPS), r: a[0], g: a[1], b: a[2] });
    out.stops.push({ t, r: b[0], g: b[1], b: b[2] });
  });
  const last = colors[colors.length - 1];
  out.stops.push({ t: 1, r: last[0], g: last[1], b: last[2] });
  return out;
}

// ---- RGB tile LUT (luminance → colour) ----

/**
 * Build a 256-entry RGB lookup table from a RasterSymbologyState for recolouring
 * plain RGB tiles by luminance. stretchMin/stretchMax act as black/white points
 * (0–255). Returns null when no recolouring applies (rampId 'original').
 */
export function buildRgbLut(state: RasterSymbologyState): Uint8ClampedArray | null {
  if (!state.rampId || state.rampId === 'original') return null;
  const def = RASTER_RAMPS[state.rampId];
  if (!def) return null;
  const invert = state.invert ?? false;
  const lo = state.stretchMin ?? 0;
  const hi = state.stretchMax ?? 255;
  const range = hi - lo || 1;
  const classified = state.mode === 'classified';
  const k = Math.max(2, Math.min(12, state.classes ?? 5));
  const classColors = classified ? sampleRampColors(def.stops, k, invert) : null;

  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - lo) / range));
    let c: RGB;
    if (classColors) {
      c = classColors[Math.min(k - 1, Math.floor(t * k))];
    } else {
      c = rampColorAt(def.stops, t, invert);
    }
    lut[v * 3] = c[0];
    lut[v * 3 + 1] = c[1];
    lut[v * 3 + 2] = c[2];
  }
  return lut;
}

// ---- COG colormap building ----

export type CogColorStop = [number, number, number, number, number];

/**
 * Build cog:// protocol colormap stops from a ramp + symbology state.
 * Continuous mode produces interpolated stops across [min,max]; classified mode
 * produces hard-edged equal-interval (or supplied-break) classes.
 */
export function buildCogColormap(
  rampId: string,
  invert: boolean,
  min: number,
  max: number,
  classes?: number,
): CogColorStop[] | null {
  const def = RASTER_RAMPS[rampId];
  if (!def) return null;
  const range = max - min || 1;
  if (classes && classes >= 2) {
    const k = Math.min(12, classes);
    const colors = sampleRampColors(def.stops, k, invert);
    const out: CogColorStop[] = [];
    const eps = range * 0.0001;
    for (let i = 0; i < k; i++) {
      const lo = min + (i / k) * range;
      const hi = min + ((i + 1) / k) * range;
      const c = colors[i];
      out.push([lo, c[0], c[1], c[2], 255]);
      out.push([hi - eps, c[0], c[1], c[2], 255]);
    }
    return out;
  }
  const src = invert ? [...def.stops].reverse() : def.stops;
  return src.map((c, i, arr): CogColorStop => {
    const t = arr.length > 1 ? i / (arr.length - 1) : 0;
    return [min + t * range, c[0], c[1], c[2], 255];
  });
}
