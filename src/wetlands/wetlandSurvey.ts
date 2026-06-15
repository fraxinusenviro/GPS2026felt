/**
 * Wetland delineation survey model + logic, ported from the WETLANDS app
 * (docs/app.js). All functions operate on a passed WetlandSurvey object rather
 * than a module global, so multiple plots can be edited independently.
 *
 * Field names are kept identical to the WETLANDS schema so the ported PDF report
 * (WetlandReport.ts) consumes a survey unchanged.
 */
import type { WetlandSurvey } from '../types';

// ---- small coercion helpers (survey has an index signature of `unknown`) ----
export const str = (v: unknown): string => (v == null ? '' : String(v));
const numOf = (v: unknown): number => Number(v);

// ---- option lists ----
export const yesNo = ['', 'Yes', 'No'];
export const observers = ['', 'IB', 'ZS', 'SD', 'CN', 'Other'];
export const provinces = ['', 'NS', 'PEI', 'NB', 'NL'];
export const plotTypes = ['', 'Wetland Control Plot', 'Upland Control Plot'];
export const localReliefOptions = ['', 'Convex', 'Concave', 'None'];
export const redoxTypeOptions = ['', 'Concentrations', 'Depletions', 'Pore Linings', 'Nodules', 'Masses', 'Soft Masses', 'Other'];
export const redoxLocationOptions = ['', 'Matrix', 'Pore', 'Root Channel', 'Ped Face', 'Combined', 'Other'];
export const textureTriangleOptions = ['', 'Organic', 'Sand', 'Loamy Sand', 'Sandy Loam', 'Loam', 'Silt Loam', 'Silt', 'Sandy Clay Loam', 'Clay Loam', 'Silty Clay Loam', 'Sandy Clay', 'Silty Clay', 'Clay'];

export const hydricSoilIndicators = ['Histosol (A1)', 'Histic Epipedon (A2)', 'Black Histic (A3)', 'Hydrogen Sulfide (A4)', 'Stratified Layers (A5)', 'Depleted Below Dark Surface (A11)', 'Thick Dark Surface (A12)', 'Sandy Mucky Mineral (S1)', 'Sandy Gleyed Matrix (S4)', 'Sandy Redox (S5)', 'Polyvalue Below Surface (S8)', 'Thin Dark Surface (S9)', 'Loamy Gleyed Matrix (F2)', 'Depleted Matrix (F3)', 'Redox Dark Surface (F6)', 'Depleted Dark Surface (F7)', 'Redox Depressions (F8)'];
export const wetlandHydrologyPrimary = ['Surface Water (A1)', 'High Water Table (A2)', 'Saturation (A3)', 'Water Marks (B1)', 'Sediment Deposits (B2)', 'Drift Deposits (B3)', 'Algal Mat or Crust (B4)', 'Iron Deposits (B5)', 'Inundation Visible on Aerial Imagery (B7)', 'Sparsely Vegetated Concave Surface (B8)', 'Water-Stained Leaves (B9)', 'Aquatic Fauna (B13)', 'Marl Deposits (B15)', 'Hydrogen Sulfide Odor (C1)', 'Oxidized Rhizospheres on Living Roots (C3)', 'Presence of Reduced Iron (C4)', 'Recent Iron Reduction in Tilled Soils (C6)', 'Thin Muck Surface (C7)', 'Other (Explain in Remarks)'];
export const wetlandHydrologySecondary = ['Surface Soil Cracks (B6)', 'Drainage Patterns (B10)', 'Moss Trim Lines (B16)', 'Dry-Season Water Table (C2)', 'Saturation Visible on Aerial Imagery (C9)', 'Stunted or Stressed Plants (D1)', 'Geomorphic Position (D2)', 'Shallow Aquitard (D3)', 'Microtopographic Relief (D4)', 'FAC-Neutral Test (D5)'];

export type FieldDef = [string, string, string[]?];
export const metadataFields: FieldDef[] = [
  ['SiteID', 'text'], ['LocaleName', 'text'], ['Province', 'select', provinces], ['date', 'date'], ['time', 'time'], ['observer', 'select', observers],
  ['PLOT_ID', 'text'], ['WetlandID', 'text'], ['PLOT_TYPE', 'select', plotTypes], ['latitude', 'number'], ['longitude', 'number'],
  ['LocalRelief', 'select', localReliefOptions], ['PercentSlope', 'number'], ['Landform', 'text'],
  ['DistSoilYN', 'select', yesNo], ['DistVegYN', 'select', yesNo], ['DistHydroYN', 'select', yesNo], ['ProbSoilYN', 'select', yesNo], ['ProbVegYN', 'select', yesNo], ['ProbHydroYN', 'select', yesNo],
  ['ClimHydroNormalYN', 'select', yesNo], ['CircNormalYN', 'select', yesNo], ['SummaryHydroVegYN', 'select', yesNo], ['SummaryHydricSoilYN', 'select', yesNo], ['SummaryHydrologyYN', 'select', yesNo], ['SummaryInWetlandYN', 'select', yesNo],
];

export const hydrologyFields: FieldDef[] = [
  ['RestrictiveLayer', 'text'], ['RestrictiveLayerDepthCM', 'number'], ['SurfaceWaterYN', 'select', yesNo], ['SurfaceWaterDepthCM', 'number'],
  ['WaterTableYN', 'select', yesNo], ['WaterTableDepthCM', 'number'], ['SaturationYN', 'select', yesNo], ['SaturationDepthCM', 'number'],
];

export const VEG_GROUPS: Array<[string, number]> = [['Tree', 6], ['Shrub', 6], ['Herb', 10]];

// Differential plot symbology: Wetland plots vs Upland (control) plots.
export const WETLAND_PLOT_COLOR = '#0b6b50'; // teal
export const UPLAND_PLOT_COLOR = '#b45309';  // amber/brown

/** Colour for a plot given its PLOT_TYPE ("Upland Control Plot" → amber). */
export function wetlandPlotColor(plotType: unknown): string {
  return String(plotType || '').toLowerCase().includes('upland') ? UPLAND_PLOT_COLOR : WETLAND_PLOT_COLOR;
}

export function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultWetlandSurvey(): WetlandSurvey {
  const now = new Date();
  const obj: Record<string, unknown> = {
    id: makeId(), timestamp: new Date().toISOString(),
    SiteID: '', LocaleName: '', Province: '', date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5), observer: '',
    PLOT_ID: '', WetlandID: '', PLOT_TYPE: '', latitude: '', longitude: '', LocalRelief: '', PercentSlope: '', Landform: '',
    DistSoilYN: '', DistVegYN: '', DistHydroYN: '', ProbSoilYN: '', ProbVegYN: '', ProbHydroYN: '',
    ClimHydroNormalYN: '', CircNormalYN: '', SummaryHydroVegYN: '', SummaryHydricSoilYN: '', SummaryHydrologyYN: '', SummaryInWetlandYN: '',
    notes: '', RestrictiveLayer: '', RestrictiveLayerDepthCM: '', SurfaceWaterYN: '', SurfaceWaterDepthCM: '',
    WaterTableYN: '', WaterTableDepthCM: '', SaturationYN: '', SaturationDepthCM: '',
    HydricSoilIndicators: [], HydrologyPrimary: [], HydrologySecondary: [], photos: [],
  };
  (['Tree', 'Shrub'] as const).forEach(g => { for (let i = 1; i <= 6; i++) { obj[`${g}Sp${i}`] = ''; obj[`${g}Sp${i}Cov`] = ''; obj[`${g}Sp${i}Status`] = ''; obj[`${g}Sp${i}Dom`] = false; } });
  for (let i = 1; i <= 10; i++) { obj[`HerbSp${i}`] = ''; obj[`HerbSp${i}Cov`] = ''; obj[`HerbSp${i}Status`] = ''; obj[`HerbSp${i}Dom`] = false; }
  for (let h = 1; h <= 4; h++) ['RestrictiveYN', 'RestrictiveNote', 'StartDepthCM', 'EndDepthCM', 'ThickCM', 'Texture', 'Matrix', 'MatrixPC', 'Redox', 'RedoxPC', 'RedoxType', 'RedoxLoc'].forEach(suffix => { obj[`SoilH${h}${suffix}`] = ''; });
  return obj as WetlandSurvey;
}

export function displayLabel(key: string): string {
  const m = key.match(/^(Tree|Shrub|Herb)Sp(\d+)(Cov|Status|Dom)?$/);
  if (m) {
    const suffix = m[3] === 'Cov' ? ' % Cover' : m[3] === 'Status' ? ' Indicator Status' : m[3] === 'Dom' ? ' Dominant?' : '';
    return `${m[1]} Species #${m[2]}${suffix}`;
  }
  const h = key.match(/^SoilH(\d+)(RestrictiveYN|RestrictiveNote|StartDepthCM|EndDepthCM|ThickCM|Texture|Matrix|MatrixPC|Redox|RedoxPC|RedoxType|RedoxLoc)$/);
  if (h) {
    const map: Record<string, string> = { RestrictiveYN: 'Restrictive Layer / Pit End?', RestrictiveNote: 'Restrictive Layer Note', StartDepthCM: 'Start Depth (cm)', EndDepthCM: 'End Depth (cm)', ThickCM: 'Thickness (cm)', Texture: 'Texture', Matrix: 'Matrix Color', MatrixPC: 'Matrix %', Redox: 'Redox Color', RedoxPC: 'Redox %', RedoxType: 'Redox Type', RedoxLoc: 'Redox Location' };
    return `Soil Horizon ${h[1]} ${map[h[2]]}`;
  }
  const fixed: Record<string, string> = {
    SiteID: 'Site ID', LocaleName: 'Locale', PLOT_ID: 'Plot ID', WetlandID: 'Wetland ID', PLOT_TYPE: 'Plot Type', LocalRelief: 'Local Relief', PercentSlope: '% Slope', Landform: 'Landform',
    DistSoilYN: 'Disturbed Soils?', DistVegYN: 'Disturbed Vegetation?', DistHydroYN: 'Disturbed Hydrology?',
    ProbSoilYN: 'Problematic Soils?', ProbVegYN: 'Problematic Vegetation?', ProbHydroYN: 'Problematic Hydrology?',
    ClimHydroNormalYN: 'Normal Climatic Conditions?', CircNormalYN: 'Normal Circumstances Present?',
    SummaryHydroVegYN: 'Hydrophytic Vegetation Present?', SummaryHydricSoilYN: 'Hydric Soils Present?',
    SummaryHydrologyYN: 'Wetland Hydrology Present?', SummaryInWetlandYN: 'Sampling Location in Wetland?',
    RestrictiveLayerDepthCM: 'Restrictive Layer Depth (cm)', SurfaceWaterDepthCM: 'Surface Water Depth (cm)', WaterTableDepthCM: 'Water Table Depth (cm)', SaturationDepthCM: 'Saturation Depth (cm)',
    HydricSoilIndicators: 'Hydric Soil Indicators', HydrologyPrimary: 'Primary Hydrology Indicators', HydrologySecondary: 'Secondary Hydrology Indicators',
  };
  if (fixed[key]) return fixed[key];
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bYN\b/g, '?');
}

// ============================================================
// Species reference data + lookups
// ============================================================
interface SpeciesRecord { mcode: string; elcode: string; scientificName: string; commonName: string; indicatorStatus: string; }

let speciesRecords: SpeciesRecord[] = [];
let speciesList: string[] = [];
let speciesDisplayMap = new Map<string, SpeciesRecord>();
let munsellDescriptions = new Map<string, string>();
let referenceLoaded = false;
let referenceLoading: Promise<void> | null = null;

const refUrl = (file: string): string => `${import.meta.env.BASE_URL}wetlands/${file}`;

export function normalizeStatus(status: unknown): string {
  const s = String(status || '').toUpperCase().replace(/\s+/g, '');
  if (s.startsWith('OBL')) return 'OBL';
  if (s.startsWith('FACW')) return 'FACW';
  if (s === 'FAC' || s.startsWith('FAC+')) return 'FAC';
  if (s.startsWith('FACU')) return 'FACU';
  if (s.startsWith('UPL')) return 'UPL';
  return '';
}

function parseLegacySpeciesLine(line: unknown): SpeciesRecord | null {
  const m = String(line || '').match(/^([^\s-]+)\s*-\s*(.*?)\s*\((.*?)\)\s*-\s*([A-Za-z0-9+\-?]+)\s*$/);
  if (!m) return null;
  return { mcode: m[1].trim(), elcode: '', commonName: m[2].trim(), scientificName: m[3].trim(), indicatorStatus: normalizeStatus(m[4].trim()) || m[4].trim().toUpperCase() };
}

export function speciesDisplay(rec: SpeciesRecord): string {
  const code = rec.mcode ? `${rec.mcode} - ` : '';
  return `${code}${rec.commonName || 'Unknown'} (${rec.scientificName || 'Unknown'}) - ${rec.indicatorStatus || 'NA'}`;
}

export function extractScientificName(text: unknown): string {
  const raw = String(text || '');
  const m = raw.match(/\(([^)]+)\)/);
  return m && m[1] ? m[1].trim() : (raw.trim() || '—');
}

export function extractCommonName(text: unknown): string {
  const raw = String(text || '');
  const noCode = raw.replace(/^[^-]+-\s*/, '');
  const m = noCode.match(/^(.*?)\s*\(([^)]+)\)\s*-\s*[A-Za-z0-9+\-?]+\s*$/);
  return m && m[1] ? m[1].trim() : (noCode.trim() || '—');
}

/** Lazily fetch + merge the species and Munsell reference data (once). */
export async function loadWetlandReferenceData(): Promise<void> {
  if (referenceLoaded) return;
  if (referenceLoading) return referenceLoading;
  referenceLoading = (async () => {
    try {
      const [legacyRes, nsRes, munsellRes] = await Promise.all([
        fetch(refUrl('VASC_names.json')),
        fetch(refUrl('species_ns_indicators.json')),
        fetch(refUrl('munsell_descriptions.json')),
      ]);
      const legacyRaw: unknown[] = legacyRes.ok ? await legacyRes.json() : [];
      const nsRaw: Array<Record<string, unknown>> = nsRes.ok ? await nsRes.json() : [];
      const munsellRaw: Record<string, unknown> = munsellRes.ok ? await munsellRes.json() : {};

      const legacy = (Array.isArray(legacyRaw) ? legacyRaw : []).map(parseLegacySpeciesLine).filter((x): x is SpeciesRecord => !!x);
      const bySci = new Map<string, SpeciesRecord>();
      const byCommon = new Map<string, SpeciesRecord>();
      nsRaw.forEach(r => {
        const rec: SpeciesRecord = { elcode: String(r.elcode || ''), scientificName: String(r.scientificName || '').trim(), commonName: String(r.commonName || '').trim(), indicatorStatus: normalizeStatus(r.nsWetlandIndicator || ''), mcode: '' };
        if (rec.scientificName) bySci.set(rec.scientificName.toLowerCase(), rec);
        if (rec.commonName) byCommon.set(rec.commonName.toLowerCase(), rec);
      });

      const merged: SpeciesRecord[] = [];
      legacy.forEach(l => {
        const ns = bySci.get((l.scientificName || '').toLowerCase()) || byCommon.get((l.commonName || '').toLowerCase());
        merged.push({ mcode: l.mcode || '', elcode: ns?.elcode || '', scientificName: l.scientificName || ns?.scientificName || '', commonName: l.commonName || ns?.commonName || '', indicatorStatus: ns?.indicatorStatus || l.indicatorStatus || '' });
      });
      nsRaw.forEach(r => {
        const sci = String(r.scientificName || '').trim();
        if (!sci) return;
        if (merged.some(m => (m.scientificName || '').toLowerCase() === sci.toLowerCase())) return;
        merged.push({ mcode: '', elcode: String(r.elcode || ''), scientificName: sci, commonName: String(r.commonName || '').trim(), indicatorStatus: normalizeStatus(r.nsWetlandIndicator || '') });
      });

      speciesRecords = merged;
      speciesDisplayMap = new Map();
      speciesList = merged.map(speciesDisplay);
      speciesList.forEach((d, i) => speciesDisplayMap.set(d, merged[i]));

      munsellDescriptions = new Map(Object.entries(munsellRaw || {}).map(([k, v]) => [normalizeMunsellCode(k), String(v || '').trim()]));
    } catch (err) {
      console.warn('[wetlands] reference data load failed:', err);
    } finally {
      referenceLoaded = true;
    }
  })();
  return referenceLoading;
}

/** Build the <datalist> elements the form inputs reference. Idempotent. */
export function buildReferenceDatalists(): void {
  document.getElementById('species-options')?.remove();
  const sp = document.createElement('datalist');
  sp.id = 'species-options';
  speciesList.slice(0, 6000).forEach(s => { const o = document.createElement('option'); o.value = s; sp.appendChild(o); });
  document.body.appendChild(sp);

  document.getElementById('munsell-options')?.remove();
  const mu = document.createElement('datalist');
  mu.id = 'munsell-options';
  [...munsellDescriptions.keys()].forEach(code => { const o = document.createElement('option'); o.value = code; const d = munsellDescriptions.get(code); o.label = d ? `${code} (${d})` : code; mu.appendChild(o); });
  document.body.appendChild(mu);
}

export function findSpeciesRecord(query: string): SpeciesRecord | null {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  if (speciesDisplayMap.has(query)) return speciesDisplayMap.get(query)!;
  const exact = speciesRecords.find(r => [r.mcode, r.elcode, r.commonName, r.scientificName].filter(Boolean).map(v => String(v).toLowerCase()).includes(q));
  if (exact) return exact;
  return speciesRecords.find(r => speciesDisplay(r).toLowerCase() === q) || null;
}

/** Resolve a typed species value to its canonical display + indicator status. */
export function applySpeciesLookup(s: WetlandSurvey, group: string, i: number, raw: string): void {
  const rec = findSpeciesRecord(raw);
  if (!rec) { s[`${group}Sp${i}Status`] = ''; return; }
  s[`${group}Sp${i}`] = speciesDisplay(rec);
  s[`${group}Sp${i}Status`] = rec.indicatorStatus || '';
}

// ============================================================
// Munsell helpers
// ============================================================
export function normalizeMunsellCode(input: unknown): string {
  return String(input || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function munsellDescriptionFor(input: unknown): string {
  const code = normalizeMunsellCode(input);
  if (!code) return '';
  if (munsellDescriptions.has(code)) return munsellDescriptions.get(code)!;
  const base = code.match(/([0-9]{1,2}(?:\.[0-9])?[A-Z]{1,3})\s+([0-9](?:\.[0-9])?\/[0-9]+)/);
  if (!base) return '';
  return munsellDescriptions.get(`${base[1]} ${base[2]}`) || '';
}

export function munsellDisplay(input: unknown): string {
  const code = normalizeMunsellCode(input).replace(/(?:\s*(\([^)]*\)|\[[^\]]*\]))+\s*$/, '');
  const desc = munsellDescriptionFor(code);
  return desc ? `${code} [${desc}]` : code;
}

export function munsellDisplayMultiline(input: unknown): string {
  const code = normalizeMunsellCode(input).replace(/(?:\s*(\([^)]*\)|\[[^\]]*\]))+\s*$/, '');
  const desc = munsellDescriptionFor(code);
  return desc ? `${code}\n[${desc}]` : code;
}

export function parseMunsellCode(input: unknown): { code: string; value: number; chroma: number } {
  const code = normalizeMunsellCode(input || '').replace(/\s*(\([^)]*\)|\[[^\]]*\])\s*$/, '');
  const m = code.match(/^(?:[0-9]{1,2}(?:\.[0-9])?[A-Z]{1,3})\s+([0-9](?:\.[0-9])?)\/([0-9](?:\.[0-9])?)$/);
  if (!m) return { code, value: NaN, chroma: NaN };
  return { code, value: Number(m[1]), chroma: Number(m[2]) };
}

// ============================================================
// Soil horizon logic
// ============================================================
export function isRestrictiveHorizon(s: WetlandSurvey, h: number): boolean {
  return str(s[`SoilH${h}RestrictiveYN`]).toLowerCase() === 'yes';
}

export function recomputeHorizonThickness(s: WetlandSurvey, h: number): void {
  const start = numOf(s[`SoilH${h}StartDepthCM`]);
  const end = numOf(s[`SoilH${h}EndDepthCM`]);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const diff = end - start;
    s[`SoilH${h}ThickCM`] = Number.isFinite(diff) ? String(Math.max(0, +diff.toFixed(2))) : '';
  } else {
    s[`SoilH${h}ThickCM`] = '';
  }
}

/** Cascade start depths, auto-compute thickness, and clear horizons below a
 *  restrictive layer / pit end. Mutates the survey. */
export function syncHorizonDepthLinks(s: WetlandSurvey, horizonCount: number): void {
  let stop = false;
  for (let h = 1; h <= horizonCount; h++) {
    if (stop) { s[`SoilH${h}StartDepthCM`] = ''; s[`SoilH${h}EndDepthCM`] = ''; s[`SoilH${h}ThickCM`] = ''; continue; }
    if (h > 1) {
      if (isRestrictiveHorizon(s, h - 1)) { s[`SoilH${h}StartDepthCM`] = ''; s[`SoilH${h}EndDepthCM`] = ''; s[`SoilH${h}ThickCM`] = ''; stop = true; continue; }
      const prevEnd = numOf(s[`SoilH${h - 1}EndDepthCM`]);
      if (Number.isFinite(prevEnd)) s[`SoilH${h}StartDepthCM`] = String(prevEnd);
    }
    recomputeHorizonThickness(s, h);
    if (isRestrictiveHorizon(s, h)) {
      s[`SoilH${h}EndDepthCM`] = ''; s[`SoilH${h}ThickCM`] = '';
      ['Texture', 'Matrix', 'MatrixPC', 'Redox', 'RedoxPC', 'RedoxType', 'RedoxLoc'].forEach(k => { s[`SoilH${h}${k}`] = ''; });
      stop = true;
    }
  }
}

function isSandyTexture(t: string): boolean { return ['Sand', 'Loamy Sand', 'Sandy Loam'].includes(t); }
function isLoamyClayeyTexture(t: string): boolean { return ['Loam', 'Silt Loam', 'Silt', 'Sandy Clay Loam', 'Clay Loam', 'Silty Clay Loam', 'Sandy Clay', 'Silty Clay', 'Clay'].includes(t); }
function isGleyedByHue(code: string, value: number): boolean {
  const hue = String(code || '').split(' ')[0] || '';
  const gleyHues = new Set(['N', '10Y', '5GY', '10GY', '5G', '10G', '5BG', '10BG', '5B', '10B', '5PB']);
  return gleyHues.has(hue) && Number(value) >= 4;
}

interface HorizonRow { h: number; start: number; end: number; thick: number; matrixPC: number; redoxPC: number; texture: string; matrix: { code: string; value: number; chroma: number }; redoxType: string; restrictive: boolean; }
function horizonRows(s: WetlandSurvey, horizonCount: number): HorizonRow[] {
  const rows: HorizonRow[] = [];
  for (let h = 1; h <= horizonCount; h++) {
    rows.push({
      h, start: numOf(s[`SoilH${h}StartDepthCM`]), end: numOf(s[`SoilH${h}EndDepthCM`]), thick: numOf(s[`SoilH${h}ThickCM`]),
      matrixPC: numOf(s[`SoilH${h}MatrixPC`]), redoxPC: numOf(s[`SoilH${h}RedoxPC`]), texture: str(s[`SoilH${h}Texture`]),
      matrix: parseMunsellCode(s[`SoilH${h}Matrix`]), redoxType: str(s[`SoilH${h}RedoxType`]), restrictive: isRestrictiveHorizon(s, h),
    });
  }
  return rows;
}

/** Suggest hydric soil indicator codes from current soil entries. */
export function computeHydricCandidateIndicators(s: WetlandSurvey, horizonCount = 4): string[] {
  const candidates = new Set<string>();
  horizonRows(s, horizonCount).forEach(r => {
    const lowChroma = Number.isFinite(r.matrix.chroma) && r.matrix.chroma <= 2;
    const darkSurface = Number.isFinite(r.matrix.value) && r.matrix.value <= 3 && Number.isFinite(r.matrix.chroma) && r.matrix.chroma <= 1;
    const gleyed = isGleyedByHue(r.matrix.code, r.matrix.value);
    if (r.texture === 'Organic' && Number.isFinite(r.thick) && r.thick >= 40) candidates.add('A1');
    if (r.texture === 'Organic' && Number.isFinite(r.thick) && r.thick >= 20 && r.thick < 40) candidates.add('A2');
    if (Number.isFinite(r.start) && Number.isFinite(r.thick) && r.start <= 30 && r.thick >= 15 && lowChroma && r.matrixPC >= 60) candidates.add('A11');
    if (Number.isFinite(r.start) && Number.isFinite(r.thick) && r.start >= 30 && r.thick >= 15 && lowChroma && r.matrixPC >= 60) candidates.add('A12');
    if (isSandyTexture(r.texture)) {
      if (Number.isFinite(r.start) && r.start <= 15 && gleyed && r.matrixPC >= 60) candidates.add('S4');
      if (Number.isFinite(r.start) && Number.isFinite(r.thick) && r.start <= 15 && r.thick >= 10 && lowChroma && r.matrixPC >= 60 && r.redoxPC >= 2 && ['Concentrations', 'Pore Linings', 'Soft Masses', 'Masses'].includes(r.redoxType)) candidates.add('S5');
      if (Number.isFinite(r.start) && Number.isFinite(r.thick) && r.start <= 15 && r.thick >= 5 && darkSurface) candidates.add('S9');
    }
    if (isLoamyClayeyTexture(r.texture)) {
      if (Number.isFinite(r.start) && r.start <= 30 && gleyed && r.matrixPC >= 60) candidates.add('F2');
      if (lowChroma && r.matrixPC >= 60 && ((Number.isFinite(r.thick) && r.thick >= 5 && Number.isFinite(r.start) && r.start <= 15) || (Number.isFinite(r.thick) && r.thick >= 15 && Number.isFinite(r.start) && r.start <= 25))) candidates.add('F3');
      if (Number.isFinite(r.end) && r.end <= 30 && Number.isFinite(r.thick) && r.thick >= 10) {
        if ((r.matrix.value <= 3 && r.matrix.chroma <= 1 && r.redoxPC >= 2) || (r.matrix.value <= 3 && r.matrix.chroma <= 2 && r.redoxPC >= 5)) candidates.add('F6');
        if ((r.matrix.value <= 3 && r.matrix.chroma <= 1 && r.redoxPC >= 10) || (r.matrix.value <= 3 && r.matrix.chroma <= 2 && r.redoxPC >= 20)) candidates.add('F7');
      }
    }
  });
  return [...candidates];
}

// ============================================================
// Vegetation dominance + metrics (50/20 rule, prevalence index)
// ============================================================
interface VegEntry { group: string; i: number; species: string; cover: number; status: string; manualDom: boolean; }
export function vegetationEntriesFromSurvey(s: WetlandSurvey): VegEntry[] {
  const entries: VegEntry[] = [];
  VEG_GROUPS.forEach(([g, n]) => {
    for (let i = 1; i <= n; i++) {
      const sp = str(s[`${g}Sp${i}`]);
      const cov = numOf(s[`${g}Sp${i}Cov`] || 0);
      const status = normalizeStatus(s[`${g}Sp${i}Status`]);
      if (!sp && !cov) continue;
      entries.push({ group: g, i, species: sp || '—', cover: Number.isFinite(cov) ? cov : 0, status, manualDom: !!s[`${g}Sp${i}Dom`] });
    }
  });
  return entries;
}

export function autoDominantSet(entries: VegEntry[]): Set<string> {
  const byGroup = new Map<string, VegEntry[]>();
  entries.forEach(e => { if (!byGroup.has(e.group)) byGroup.set(e.group, []); byGroup.get(e.group)!.push(e); });
  const set = new Set<string>();
  for (const arr of byGroup.values()) {
    const sorted = [...arr].filter(e => e.cover > 0).sort((a, b) => b.cover - a.cover);
    const total = sorted.reduce((acc, e) => acc + (e.cover || 0), 0);
    if (total <= 0) continue;
    let cum = 0;
    for (const e of sorted) { set.add(`${e.group}:${e.i}`); cum += e.cover; if (cum > 0.5 * total) break; }
    const min20 = 0.2 * total;
    sorted.forEach(e => { if (e.cover >= min20) set.add(`${e.group}:${e.i}`); });
  }
  return set;
}

export function recomputeDominanceFlags(s: WetlandSurvey): void {
  const entries = vegetationEntriesFromSurvey(s);
  const autoSet = autoDominantSet(entries);
  entries.forEach(e => { s[`${e.group}Sp${e.i}Dom`] = autoSet.has(`${e.group}:${e.i}`); });
}

export interface VegMetrics {
  dominanceA: number; dominanceB: number; dominancePct: number; dominancePass: boolean;
  prevalenceIndex: number; prevalencePass: boolean;
  cover: Record<'OBL' | 'FACW' | 'FAC' | 'FACU' | 'UPL', number>;
}
export function vegetationMetricsFromSurvey(s: WetlandSurvey): VegMetrics {
  const entries = vegetationEntriesFromSurvey(s);
  const autoSet = autoDominantSet(entries);
  const dominant = entries.filter(e => autoSet.has(`${e.group}:${e.i}`));
  const dominanceB = dominant.length;
  const dominanceA = dominant.filter(e => ['OBL', 'FACW', 'FAC'].includes(e.status)).length;
  const dominancePct = dominanceB ? (dominanceA / dominanceB) * 100 : 0;
  const cover = { OBL: 0, FACW: 0, FAC: 0, FACU: 0, UPL: 0 };
  entries.forEach(e => { if ((cover as Record<string, number>)[e.status] != null) (cover as Record<string, number>)[e.status] += e.cover || 0; });
  const A = cover.OBL + cover.FACW + cover.FAC + cover.FACU + cover.UPL;
  const B = cover.OBL * 1 + cover.FACW * 2 + cover.FAC * 3 + cover.FACU * 4 + cover.UPL * 5;
  const prevalenceIndex = A > 0 ? B / A : 0;
  return { dominanceA, dominanceB, dominancePct, dominancePass: dominancePct > 50, prevalenceIndex, prevalencePass: A > 0 ? prevalenceIndex <= 3.0 : false, cover };
}

// ============================================================
// Row builders shared with the PDF report
// ============================================================
export function speciesRows(s: WetlandSurvey, group: string, n: number): string[][] {
  const rows: string[][] = [];
  for (let i = 1; i <= n; i++) {
    const sp = str(s[`${group}Sp${i}`]);
    const cov = str(s[`${group}Sp${i}Cov`]);
    if (sp || cov) rows.push([sp || '—', cov || '—']);
  }
  return rows.length ? rows : [['—', '—']];
}

export function soilRows(s: WetlandSurvey, includeMunsell = false, multilineMunsell = false): string[][] {
  const rows: string[][] = [];
  for (let h = 1; h <= 4; h++) {
    const startDepth = str(s[`SoilH${h}StartDepthCM`]);
    const endDepth = str(s[`SoilH${h}EndDepthCM`]);
    const thick = str(s[`SoilH${h}ThickCM`]);
    const texture = str(s[`SoilH${h}Texture`]);
    const matrixRaw = str(s[`SoilH${h}Matrix`]);
    const matrix = includeMunsell ? (multilineMunsell ? munsellDisplayMultiline(matrixRaw) : munsellDisplay(matrixRaw)) : (matrixRaw || '—');
    const matrixPC = str(s[`SoilH${h}MatrixPC`]);
    const redoxRaw = str(s[`SoilH${h}Redox`]);
    const redox = includeMunsell ? (multilineMunsell ? munsellDisplayMultiline(redoxRaw) : munsellDisplay(redoxRaw)) : (redoxRaw || '—');
    const redoxPC = str(s[`SoilH${h}RedoxPC`]);
    const redoxType = str(s[`SoilH${h}RedoxType`]);
    const redoxLoc = str(s[`SoilH${h}RedoxLoc`]);
    const restrictive = str(s[`SoilH${h}RestrictiveYN`]);
    const restrictiveNote = str(s[`SoilH${h}RestrictiveNote`]);
    if ([startDepth, endDepth, thick, texture, matrixRaw, matrixPC, redoxRaw, redoxPC, redoxType, redoxLoc, restrictive, restrictiveNote].some(Boolean)) {
      rows.push([`H${h}`, startDepth || '—', endDepth || '—', thick || '—', texture || '—', matrix || '—', matrixPC || '—', redox || '—', redoxPC || '—', redoxType || '—', redoxLoc || '—', restrictive || '—', restrictiveNote || '—']);
    }
  }
  return rows.length ? rows : [['H1', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']];
}

export function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Read a photo File into a resized JPEG WetlandPhoto (bounds synced doc size). */
export async function fileToWetlandPhoto(file: File, maxDim = 1600): Promise<import('../types').WetlandPhoto> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  let out = dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      out = canvas.toDataURL('image/jpeg', 0.85);
    }
  } catch { /* keep original on failure */ }
  return { name: file.name, type: 'image/jpeg', size: out.length, dataUrl: out, ts: new Date().toISOString() };
}
