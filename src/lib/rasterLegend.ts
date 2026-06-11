// Shared helpers for building classified raster legends (value-range → colour).
// Used by the Raster Symbology Studio (live legend table) and the Map Legend
// drawer so both present classified rasters identically.

import { sampleRampColors, type RGB } from './rasterRamps';

export interface LegendClass {
  color: RGB;
  /** Range label, e.g. "12 – 24" */
  label: string;
}

function fmt(v: number, decimals: number): string {
  if (!isFinite(v)) return '—';
  const r = Number(v.toFixed(decimals));
  return Number.isInteger(r) ? r.toString() : r.toString();
}

/**
 * Equal-interval class list across [min,max]. Mirrors buildCogColormap /
 * buildRgbLut classified rendering (equal bins, k colours sampled from the ramp).
 */
export function equalIntervalClasses(
  stops: RGB[],
  invert: boolean,
  classes: number,
  min: number,
  max: number,
  unit = '',
  decimals = 1,
): LegendClass[] {
  const k = Math.max(2, Math.min(12, Math.round(classes)));
  const colors = sampleRampColors(stops, k, invert);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const range = hi - lo || 1;
  const u = unit ? ` ${unit}` : '';
  const out: LegendClass[] = [];
  for (let i = 0; i < k; i++) {
    const a = lo + (i / k) * range;
    const b = lo + ((i + 1) / k) * range;
    out.push({ color: colors[i], label: `${fmt(a, decimals)} – ${fmt(b, decimals)}${u}` });
  }
  return out;
}

/**
 * Class list from explicit data-driven break values (Natural breaks / Quantile).
 * Produces N+1 classes: [min,b0], [b0,b1] … [bN-1,max].
 */
export function breaksToClasses(
  stops: RGB[],
  invert: boolean,
  breaks: number[],
  min: number,
  max: number,
  unit = '',
  decimals = 1,
): LegendClass[] {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const valid = breaks.filter(b => b > lo && b < hi).sort((a, b) => a - b);
  const edges = [lo, ...valid, hi];
  const k = edges.length - 1;
  const colors = sampleRampColors(stops, k, invert);
  const u = unit ? ` ${unit}` : '';
  const out: LegendClass[] = [];
  for (let i = 0; i < k; i++) {
    out.push({ color: colors[i], label: `${fmt(edges[i], decimals)} – ${fmt(edges[i + 1], decimals)}${u}` });
  }
  return out;
}

/** Inline-styled classified swatch rows — works inside any container (studio or drawer). */
export function classifiedRowsInlineHtml(classes: LegendClass[]): string {
  return classes.map(c =>
    `<div style="display:flex;align-items:center;gap:7px;padding:2px 0;line-height:1.3">
       <span style="width:16px;height:12px;border-radius:3px;flex-shrink:0;background:rgb(${c.color[0]},${c.color[1]},${c.color[2]});border:1px solid rgba(127,127,127,0.6);box-shadow:0 0 0 1px rgba(255,255,255,0.12) inset"></span>
       <span style="font-size:10px;opacity:0.9">${c.label}</span>
     </div>`,
  ).join('');
}

/** Map-legend-drawer classified rows (uses themed .legend-row / .legend-swatch classes). */
export function classifiedRowsHtml(classes: LegendClass[]): string {
  return classes.map(c =>
    `<div class="legend-row">
       <span class="legend-swatch" style="background:rgb(${c.color[0]},${c.color[1]},${c.color[2]})"></span>
       <span class="legend-row-label">${c.label}</span>
     </div>`,
  ).join('');
}
