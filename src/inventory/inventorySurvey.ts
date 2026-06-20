/**
 * Inventory domain constants and helpers, ported from the NSINV app (app.js).
 *
 * Species records come from the bundled ACCDC Nova Scotia databases, loaded as
 * `window.DB_*` globals by <script> tags in index.html (vertebrates / vascular /
 * nonvascular eager; invertebrates lazy-loaded on first enable). The combined,
 * settings-filtered species list is rebuilt on demand and cached.
 */
import type { AppSettings, SpeciesRecord, InventorySurvey, InventoryObservation, InventoryReportSettings } from '../types';
import { DEFAULT_SETTINGS } from '../constants';

declare global {
  interface Window {
    DB_VERTEBRATES?: SpeciesRecord[];
    DB_VASCULAR?: SpeciesRecord[];
    DB_NONVASCULAR?: SpeciesRecord[];
    DB_INVERTEBRATES?: SpeciesRecord[];
  }
}

export const INVENTORY_POINT_COLOR = '#22c55e';

// Special pseudo-species kept out of stats/exports but selectable as time markers.
export const SPECIAL_ENTRIES: SpeciesRecord[] = [
  { elcode: 'Survey Start', taxon: 'Survey Start', taxonGroup: 'special', family: '', mcode: 'START', commonName: 'Survey Start', scientificName: '', srank: '' },
  { elcode: 'Survey End',   taxon: 'Survey End',   taxonGroup: 'special', family: '', mcode: 'END',   commonName: 'Survey End',   scientificName: '', srank: '' },
];

// "UNKNOWN <taxon>" placeholder entries injected per enabled group.
const GROUP_UNKNOWNS: Record<string, string[]> = {
  vertebrates:   ['Amphibian', 'Bird', 'Fish', 'Mammal', 'Reptile'],
  vascular:      ['Vascular Plant', 'Fern / Fern Ally', 'Conifer'],
  nonvascular:   ['Bryophyte', 'Lichen', 'Fungus'],
  invertebrates: ['Insect', 'Arthropod', 'Crustacean', 'Mollusc', 'Invertebrate'],
};

// Taxon → display group; Fern/Ally and Conifer fold into Vascular Plants.
export const TAXON_GROUP_MAP: Record<string, string> = {
  'Vascular Plant': 'Vascular Plants',
  'Fern / Fern Ally': 'Vascular Plants',
  'Conifer': 'Vascular Plants',
  'Bryophyte': 'Non-Vascular Plants',
  'Lichen': 'Lichens',
  'Fungus': 'Fungi',
  'Bird': 'Birds',
  'Mammal': 'Mammals',
  'Amphibian': 'Amphibians',
  'Reptile': 'Reptiles',
  'Fish': 'Fish',
  'Insect': 'Insects',
  'Mollusc': 'Molluscs',
  'Arthropod': 'Arthropods',
  'Crustacean': 'Crustaceans',
  'Invertebrate': 'Invertebrates',
};

export const TAXON_GROUP_COLORS: Record<string, string> = {
  'Birds': '#e8871a',
  'Mammals': '#9b59b6',
  'Vascular Plants': '#27ae60',
  'Non-Vascular Plants': '#1abc9c',
  'Lichens': '#48c9b0',
  'Fungi': '#e67e22',
  'Fish': '#2980b9',
  'Amphibians': '#52be80',
  'Reptiles': '#c8b400',
  'Insects': '#c0392b',
  'Arthropods': '#ec407a',
  'Crustaceans': '#f06292',
  'Molluscs': '#8e44ad',
  'Invertebrates': '#ba68c8',
};

export const REPORT_GROUP_ORDER = [
  'Vascular Plants', 'Non-Vascular Plants', 'Lichens', 'Fungi',
  'Birds', 'Mammals', 'Amphibians', 'Reptiles', 'Fish',
  'Insects', 'Molluscs', 'Arthropods', 'Crustaceans', 'Invertebrates',
];

export function getGroupColor(taxon: string): string {
  const group = TAXON_GROUP_MAP[taxon] || taxon || '';
  return TAXON_GROUP_COLORS[group] || '#7f8c8d';
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function hexToLightRgb(hex: string, alpha = 0.18): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  return [Math.round(r * alpha + 255 * (1 - alpha)), Math.round(g * alpha + 255 * (1 - alpha)), Math.round(b * alpha + 255 * (1 - alpha))];
}

/** Species of Conservation Interest: S1/S2/S3 rank OR a provincial protection status. */
export function isSoCI(sp: SpeciesRecord | undefined): boolean {
  if (!sp) return false;
  return /^S[123]($|[^0-9])/.test(sp.srank || '') ||
    /^(Endangered|Threatened|Vulnerable|Extirpated)$/i.test(sp.sprot || '');
}

const TAXON_ICONS: Record<string, string> = {
  'Bird': '🐦', 'Mammal': '🦌', 'Amphibian': '🐸', 'Reptile': '🦎', 'Fish': '🐟',
  'Vascular Plant': '🌿', 'Fern / Fern Ally': '🌿', 'Conifer': '🌲',
  'Bryophyte': '🍃', 'Lichen': '🪨', 'Fungus': '🍄',
  'Insect': '🦋', 'Arthropod': '🕷️', 'Crustacean': '🦐', 'Mollusc': '🐌', 'Invertebrate': '🪱',
  'Survey Start': '▶️', 'Survey End': '⏹️',
};
export function taxonIcon(taxon: string): string {
  return TAXON_ICONS[taxon] || '🔬';
}

// ── Combined species list (settings-filtered, cached) ──────────────
let _speciesList: SpeciesRecord[] | null = null;

export function invalidateSpeciesList(): void { _speciesList = null; }

export function getSpeciesList(settings: AppSettings): SpeciesRecord[] {
  if (_speciesList) return _speciesList;
  _speciesList = buildSpeciesList(settings);
  return _speciesList;
}

function buildSpeciesList(settings: AppSettings): SpeciesRecord[] {
  const dbs: Record<string, boolean> = {
    vertebrates: settings.inventory_db_vertebrates ?? true,
    vascular: settings.inventory_db_vascular ?? true,
    nonvascular: settings.inventory_db_nonvascular ?? true,
    invertebrates: settings.inventory_db_invertebrates ?? false,
  };
  const dbData: Record<string, SpeciesRecord[] | undefined> = {
    vertebrates: window.DB_VERTEBRATES,
    vascular: window.DB_VASCULAR,
    nonvascular: window.DB_NONVASCULAR,
    invertebrates: window.DB_INVERTEBRATES,
  };
  const list: SpeciesRecord[] = [...SPECIAL_ENTRIES];
  for (const [group, enabled] of Object.entries(dbs)) {
    if (!enabled) continue;
    const data = dbData[group];
    if (!data) continue;
    (GROUP_UNKNOWNS[group] || []).forEach(t =>
      list.push({ elcode: '', taxon: t, taxonGroup: group, family: '', mcode: '', commonName: `UNKNOWN ${t}`, scientificName: '', srank: '' }));
    list.push(...data);
  }
  return list;
}

/** Dynamically inject the large invertebrate DB script on first enable. */
export function loadInvertebratesDB(baseUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    if (window.DB_INVERTEBRATES) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = `${baseUrl}db/db-invertebrates.js`;
    script.onload = () => { invalidateSpeciesList(); resolve(true); };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

// ── Survey lifecycle helpers ───────────────────────────────────────
export function defaultSurvey(projectId: string, meta: Partial<InventorySurvey> = {}): InventorySurvey {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    surveyID: '', siteName: '', surveyor: '', locale: '', county: '',
    date: new Date().toISOString().slice(0, 10),
    reportNote: '',
    startTime: now, endTime: null, pausedAt: null, pausedDuration: 0,
    status: 'draft',
    project_id: projectId,
    observations: [],
    ...meta,
  };
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function getElapsed(survey: InventorySurvey | null): number {
  if (!survey) return 0;
  const p = survey.pausedDuration || 0;
  const base = survey.pausedAt
    ? survey.pausedAt - survey.startTime - p
    : Date.now() - survey.startTime - p;
  return Math.max(0, base);
}

/** Real (non-event) observations only. */
export function realObservations(survey: InventorySurvey): InventoryObservation[] {
  return survey.observations.filter(o => !['Survey Start', 'Survey End'].includes(o.species.taxon));
}

export function uniqueSpeciesCount(obs: InventoryObservation[]): number {
  return new Set(obs.filter(o => o.species.elcode).map(o => o.species.elcode)).size +
    obs.filter(o => !o.species.elcode).length;
}

export function getReportSettings(settings: AppSettings): InventoryReportSettings {
  return settings.inventory_report ?? DEFAULT_SETTINGS.inventory_report!;
}

// Ordered Map of groupName → observations[].
export function buildReportGroups(obs: InventoryObservation[]): Map<string, InventoryObservation[]> {
  const raw = new Map<string, InventoryObservation[]>();
  obs.forEach(o => {
    const g = TAXON_GROUP_MAP[o.species.taxon] || o.species.taxon || 'Unknown';
    if (!raw.has(g)) raw.set(g, []);
    raw.get(g)!.push(o);
  });
  const ordered = new Map<string, InventoryObservation[]>();
  for (const g of REPORT_GROUP_ORDER) if (raw.has(g)) ordered.set(g, raw.get(g)!);
  for (const [g, v] of raw) if (!ordered.has(g)) ordered.set(g, v);
  return ordered;
}

export function sortObservations(obs: InventoryObservation[], sortOrder: string): InventoryObservation[] {
  if (sortOrder === 'time') return obs;
  const keyFns: Record<string, (o: InventoryObservation) => string> = {
    family: o => (o.species.family || '').toLowerCase(),
    commonName: o => (o.species.commonName || '').toLowerCase(),
    scientificName: o => (o.species.scientificName || '').toLowerCase(),
  };
  const key = keyFns[sortOrder] || keyFns.commonName;
  return [...obs].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

// ── Small DOM/util helpers (mirrors WetlandsManager) ───────────────
export function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function escapeHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
