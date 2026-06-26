// Symbology engine: classifiers, ramps, legend building, MapLibre expression output

import type { SymbologyState, ClassifierName } from '../types';

// ---- Sequential / diverging ramps for graduated / proportional ----
export const SEQ_RAMPS: Record<string, string[]> = {
  // Perceptually uniform sequential
  Viridis:  ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  Magma:    ['#0a0722', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
  Plasma:   ['#0d0887', '#9c179e', '#ed7953', '#f6cf20', '#f0f921'],
  Inferno:  ['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4'],
  Cividis:  ['#00204d', '#31446b', '#666970', '#a69d75', '#ffea46'],
  Turbo:    ['#30123b', '#31a7a5', '#7ae556', '#f99c1a', '#b2182b'],
  Mako:     ['#0b0405', '#3b2f5e', '#357ba3', '#4cc8ad', '#def5e5'],
  Rocket:   ['#03051a', '#641a80', '#cb1b4f', '#f6845f', '#faebdd'],
  // ColorBrewer sequential
  Blues:    ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
  Greens:   ['#f7fcf5', '#bae4b3', '#74c476', '#238b45', '#00441b'],
  Reds:     ['#fff5f0', '#fcbba1', '#fc8d59', '#de2d26', '#a50f15'],
  Oranges:  ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'],
  Purples:  ['#fcfbfd', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'],
  Greys:    ['#ffffff', '#cccccc', '#969696', '#525252', '#000000'],
  YlGn:     ['#ffffe5', '#d9f0a3', '#78c679', '#238443', '#004529'],
  YlGnBu:   ['#ffffd9', '#a1dab4', '#41b6c4', '#225ea8', '#081d58'],
  YlOrRd:   ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'],
  OrRd:     ['#fee8c8', '#fdbb84', '#ef6548', '#b30000', '#5c0000'],
  BuGn:     ['#f7fcfd', '#ccece6', '#66c2a4', '#238b45', '#00441b'],
  BuPu:     ['#f7fcfd', '#bfd3e6', '#8c96c6', '#88419d', '#4d004b'],
  GnBu:     ['#f7fcf0', '#ccebc5', '#7bccc4', '#2b8cbe', '#084081'],
  PuRd:     ['#f7f4f9', '#d4b9da', '#df65b0', '#ce1256', '#67001f'],
  // CARTO sequential
  BluGrn:   ['#c4e6c3', '#80c6a3', '#4da284', '#2e7d6c', '#1d4f60'],
  Sunset:   ['#f3e79b', '#f8a07e', '#eb7f86', '#ce6693', '#5c53a5'],
  Emrld:    ['#d3f2a3', '#82d091', '#4c9b82', '#217a79', '#074050'],
  Teal:     ['#d1eeea', '#85c4c9', '#4f90a6', '#3b738f', '#2a5674'],
  Peach:    ['#fde0c5', '#facba6', '#f8b58b', '#f59e72', '#f2855d'],
  // Diverging
  RdBu:     ['#2166ac', '#67a9cf', '#d1e5f0', '#fddbc7', '#ef8a62', '#b2182b'],
  RdYlBu:   ['#a50026', '#f46d43', '#ffffbf', '#74add1', '#313695'],
  RdYlGn:   ['#a50026', '#f46d43', '#ffffbf', '#a6d96a', '#006837'],
  BrBG:     ['#8c510a', '#d8b365', '#f5f5f5', '#5ab4ac', '#01665e'],
  PiYG:     ['#c51b7d', '#e9a3c9', '#f7f7f7', '#a1d76a', '#4d9221'],
  PRGn:     ['#762a83', '#af8dc3', '#f7f7f7', '#7fbf7b', '#1b7837'],
  PuOr:     ['#b35806', '#f1a340', '#f7f7f7', '#998ec3', '#542788'],
  Spectral: ['#9e0142', '#d53e4f', '#fdae61', '#ffffbf', '#abdda4', '#489977', '#5e4fa2'],
  Coolwarm: ['#3b4cc0', '#8db0fe', '#dddddd', '#f49a7b', '#b40426'],
  // Thematic
  Terrain:  ['#336600', '#b4a05a', '#966437', '#b4aaa0', '#ffffff'],
  Bathy:    ['#081d58', '#225ea8', '#41b6c4', '#a1dab4', '#ffffd9'],
};

// ---- Qualitative palettes for categorical ----
export const QUAL_PALETTES: Record<string, string[]> = {
  Bold:     ['#7F3C8D', '#11A579', '#3969AC', '#F2B701', '#E73F74', '#80BA5A', '#E68310'],
  Vivid:    ['#E58606', '#5D69B1', '#52BCA3', '#99C945', '#CC61B0', '#24796C', '#DAA51B'],
  Pastel:   ['#66C5CC', '#F6CF71', '#F89C74', '#DCB0F2', '#87C55F', '#9EB9F3', '#FE88B1'],
  Antique:  ['#855C75', '#D9AF6B', '#AF6458', '#736F4C', '#526A83', '#625377', '#68855C'],
  Prism:    ['#5F4690', '#1D6996', '#38A6A5', '#0F8554', '#73AF48', '#EDAD08', '#E17C05'],
  Safe:     ['#88CCEE', '#CC6677', '#DDCC77', '#117733', '#332288', '#AA4499', '#44AA99'],
  Tableau:  ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1'],
  Set1:     ['#E41A1C', '#377EB8', '#4DAF4A', '#984EA3', '#FF7F00', '#FFFF33', '#A65628'],
  Set2:     ['#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3', '#A6D854', '#FFD92F', '#E5C494'],
  Dark2:    ['#1B9E77', '#D95F02', '#7570B3', '#E7298A', '#66A61E', '#E6AB02', '#A6761D'],
  Accent:   ['#7FC97F', '#BEAED4', '#FDC086', '#FFFF99', '#386CB0', '#F0027F', '#BF5B17'],
  Retro:    ['#5B8E7D', '#F4A259', '#BC4B51', '#8CB369', '#F4E285', '#6B4E71', '#3B6064'],
};

// A broad, perceptually varied default fill palette. Ordered roughly by hue so
// the swatch grid reads like a colour wheel and users can find a tone quickly.
export const SINGLE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#facc15', '#fde725', '#a3e635',
  '#4ade80', '#10b981', '#14b8a6', '#06b6d4', '#38bdf8', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
  '#ffffff', '#9aa5b1', '#64748b', '#334155', '#1e293b', '#0a0d12',
];
// Outline / stroke / casing palette — neutrals first (most common for borders),
// then accent hues for high-contrast outlines.
export const OUTLINE_COLORS = [
  '#0a0d12', '#1e293b', '#334155', '#64748b', '#9aa5b1', '#cbd5e1', '#ffffff', '#000000',
  '#ef4444', '#f59e0b', '#facc15', '#4ade80', '#14b8a6', '#38bdf8', '#6366f1', '#ec4899',
];
// Compact set for label / icon colours — light, dark, plus a few vivid accents.
export const LABEL_COLORS = [
  '#f8fafc', '#0a0d12', '#ffffff', '#facc15', '#f97316', '#ef4444',
  '#4ade80', '#14b8a6', '#38bdf8', '#6366f1', '#a855f7', '#ec4899',
];

// ---- Utility ----

function hex2rgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function rgb2hex(r: [number, number, number]): string {
  return '#' + r.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function sampleRamp(stops: string[], n: number): string[] {  if (n === 1) return [stops[Math.floor(stops.length / 2)]];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(stops.length - 1, lo + 1);
    const f = t - lo;
    const a = hex2rgb(stops[lo]);
    const b = hex2rgb(stops[hi]);
    out.push(rgb2hex([
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ]));
  }
  return out;
}

/**
 * Colours for categorical classes. `paletteKey` may name a qualitative palette
 * (returned as-is, the caller cycles) OR a sequential/diverging ramp (sampled to
 * `n` colours so categories span a continuous ramp like Viridis / RdYlGn / Coolwarm).
 */
export function categoricalColors(paletteKey: string | undefined, n: number): string[] {
  const key = paletteKey ?? 'Bold';
  if (QUAL_PALETTES[key]) return QUAL_PALETTES[key];
  if (SEQ_RAMPS[key]) return sampleRamp(SEQ_RAMPS[key], Math.max(2, n));
  return QUAL_PALETTES.Bold;
}

// ---- Classifiers ----

function equalInterval(vals: number[], k: number): number[] {
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const s = (mx - mn) / k;
  return Array.from({ length: k - 1 }, (_, i) => mn + s * (i + 1));
}

function quantile(vals: number[], k: number): number[] {
  const v = [...vals].sort((a, b) => a - b);
  return Array.from({ length: k - 1 }, (_, i) =>
    v[Math.min(v.length - 1, Math.floor(v.length * (i + 1) / k))]
  );
}

function jenks(vals: number[], k: number): number[] {
  const d = [...vals].sort((a, b) => a - b);
  const n = d.length;
  if (k >= n) return d.slice(1, k);
  const mat1 = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const mat2 = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) { mat1[1][j] = 1; mat2[1][j] = 0; }
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = d[i3 - 1];
      s2 += val * val; s1 += val; w++;
      const v2 = s2 - (s1 * s1) / w;
      const i4 = i3 - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (mat2[l][j] >= v2 + mat2[i4][j - 1]) {
            mat1[l][j] = i3;
            mat2[l][j] = v2 + mat2[i4][j - 1];
          }
        }
      }
    }
    mat1[l][1] = 1;
    mat2[l][1] = s2 - (s1 * s1) / w;
  }
  const breaks: number[] = [];
  let kk = n;
  for (let j = k; j >= 2; j--) {
    const id = Math.max(0, mat1[kk][j] - 2);
    breaks.unshift(d[id]);
    kk = mat1[kk][j] - 1;
  }
  return breaks;
}

export const CLASSIFIERS: Record<ClassifierName, (vals: number[], k: number) => number[]> = {
  'Natural breaks': jenks,
  'Quantile': quantile,
  'Equal interval': equalInterval,
};

// ---- Field analysis ----

export interface FieldInfo {
  name: string;
  kind: 'categorical' | 'numeric';
  uniqueCount: number;
}

export function detectFields(features: { properties: Record<string, unknown> }[]): FieldInfo[] {
  if (features.length === 0) return [];
  const allKeys = new Set<string>();
  features.forEach(f => Object.keys(f.properties ?? {}).forEach(k => allKeys.add(k)));

  return [...allKeys].map(name => {
    const vals = features.map(f => (f.properties ?? {})[name]);
    const unique = new Set(vals.filter(v => v !== null && v !== undefined));
    const numericCount = vals.filter(v => typeof v === 'number' && isFinite(v as number)).length;
    const kind: FieldInfo['kind'] = numericCount > features.length * 0.5 ? 'numeric' : 'categorical';
    return { name, kind, uniqueCount: unique.size };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Legend entries ----

export interface LegendEntry {
  color: string;
  label: string;       // display label (custom override applied if present)
  defaultLabel: string; // auto-generated label (shown as placeholder when overriding)
  key: string;         // stable key for storing a custom label in state.legendLabels
  cat?: string;
  breaks?: number[];
}

// Apply any user label override for `key`, falling back to the generated label.
function withOverride(state: SymbologyState, key: string, defaultLabel: string): { label: string; defaultLabel: string; key: string } {
  const override = state.legendLabels?.[key];
  return { key, defaultLabel, label: override != null && override !== '' ? override : defaultLabel };
}

const fmt = (v: number): string =>
  Math.abs(v) >= 100 ? Math.round(v).toString() : (+v.toFixed(v < 10 ? 2 : 1)).toString();

export function buildLegend(
  features: { properties: Record<string, unknown> }[],
  state: SymbologyState,
): LegendEntry[] {
  if (state.method === 'single' || state.method === 'proportional') {
    return [{ color: state.color ?? SINGLE_COLORS[0], ...withOverride(state, 'all', 'All features') }];
  }

  if (state.method === 'categorical') {
    const field = state.field ?? '';
    const cats = [...new Set(features.map(f => String((f.properties ?? {})[field] ?? '')))].sort();
    const cols = categoricalColors(state.palette, cats.length);
    return cats.map((c, i) => ({ color: cols[i % cols.length], cat: c, ...withOverride(state, `cat:${c}`, c) }));
  }

  // graduated
  const field = state.field ?? '';
  const vals = features
    .map(f => Number((f.properties ?? {})[field]))
    .filter(v => isFinite(v));
  if (vals.length === 0) return [];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const k = state.classes ?? 5;
  const classify = CLASSIFIERS[state.classifier ?? 'Natural breaks'];
  let breaks = classify(vals, k);
  breaks = [...new Set(breaks)].filter(b => b > mn && b < mx);
  const cols = sampleRamp(SEQ_RAMPS[state.ramp ?? 'Viridis'] ?? SEQ_RAMPS.Viridis, breaks.length + 1);
  const edges = [mn, ...breaks, mx];
  return cols.map((c, i) => ({
    color: c,
    breaks,
    ...withOverride(state, `g:${i}`, `${fmt(edges[i])} – ${fmt(edges[i + 1])}`),
  }));
}

// ---- MapLibre expression builders ----

export type MaplibreExpression = string | number | unknown[];

export function buildColorExpression(
  features: { properties: Record<string, unknown> }[],
  state: SymbologyState,
): MaplibreExpression {
  if (state.method === 'single' || state.method === 'proportional') {
    return state.color ?? SINGLE_COLORS[0];
  }

  const leg = buildLegend(features, state);

  if (state.method === 'categorical') {
    const expr: unknown[] = ['match', ['get', state.field ?? '']];
    leg.forEach(l => { if (l.cat !== undefined) { expr.push(l.cat, l.color); } });
    expr.push('#888888');
    return expr;
  }

  // graduated
  if (leg.length === 0) return state.color ?? SINGLE_COLORS[0];
  const breaks = leg[0].breaks ?? [];
  const expr: unknown[] = ['step', ['get', state.field ?? ''], leg[0].color];
  breaks.forEach((b, i) => expr.push(+fmt(b), leg[i + 1]?.color ?? '#888888'));
  return expr;
}

export function buildRadiusExpression(
  features: { properties: Record<string, unknown> }[],
  state: SymbologyState,
): MaplibreExpression {
  if (state.method !== 'proportional' || !state.field) return state.size ?? 6;
  const vals = features
    .map(f => Number((f.properties ?? {})[state.field!]))
    .filter(v => isFinite(v));
  if (vals.length === 0) return state.size ?? 6;
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const maxR = 3 + (state.size ?? 6) * 2.5;
  return ['interpolate', ['linear'], ['get', state.field],
    +fmt(mn), 3,
    +fmt(mx), maxR];
}

export function buildFullLayerSpec(
  features: { properties: Record<string, unknown> }[],
  state: SymbologyState,
  geomType: 'point' | 'line' | 'polygon',
): object {
  const colorExpr = buildColorExpression(features, state);
  const opacity = state.opacity ?? 0.9;

  if (geomType === 'point') {
    const shape = state.shape;
    if (shape && shape !== 'circle') {
      // Non-circle shapes use a symbol layer with canvas sprites (see MapManager.setImportedLayerSymbology).
      return {
        type: 'symbol',
        layout: {
          'icon-image': '<shape-sprite-id>',
          'icon-size': `<(state.size ?? 6) / 14>`,
          'icon-allow-overlap': true,
        },
        note: `Shape '${shape}' rendered via canvas sprites; see setImportedLayerSymbology`,
      };
    }
    const paint: Record<string, unknown> = {
      'circle-color': colorExpr,
      'circle-opacity': opacity,
      'circle-stroke-color': state.outlineColor ?? '#0a0d12',
      'circle-stroke-width': state.outlineWidth ?? 1.5,
      'circle-radius': state.method === 'proportional'
        ? buildRadiusExpression(features, state)
        : (state.size ?? 6),
    };
    return { type: 'circle', paint };
  }

  if (geomType === 'line') {
    const out: Record<string, unknown> = {
      type: 'line',
      layout: { 'line-cap': state.cap ?? 'round', 'line-join': 'round' },
      paint: {
        'line-color': colorExpr,
        'line-opacity': opacity,
        'line-width': state.size ?? 3,
      },
    };
    if (state.casing && (state.casingWidth ?? 0) > 0) {
      out['casingLayer'] = {
        type: 'line',
        layout: { 'line-cap': state.cap ?? 'round', 'line-join': 'round' },
        paint: {
          'line-color': state.casingColor ?? '#0a0d12',
          'line-opacity': opacity,
          'line-width': (state.size ?? 3) + (state.casingWidth ?? 2) * 2,
        },
        note: 'add beneath main layer',
      };
    }
    return out;
  }

  // polygon
  return {
    type: 'fill',
    paint: { 'fill-color': colorExpr, 'fill-opacity': opacity },
    strokeLayer: {
      type: 'line',
      paint: {
        'line-color': state.strokeColor ?? '#ffffff',
        'line-opacity': state.strokeOpacity ?? 0.4,
        'line-width': state.size ?? 1.5,
      },
    },
  };
}
