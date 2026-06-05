import type { CutFillResult } from '../lib/cutFillEngine';
import type { HRDEMResult } from '../lib/hrdemWCS';

const CF_RUNS_KEY = 'fm2026_cf_runs';

function encodeFloat32(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeFloat32(s: string): Float32Array {
  const bin = atob(s);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Float32Array(buf.buffer);
}

export interface CutFillRunDisplayState {
  elevVisible: boolean;
  diffVisible: boolean;
  hillshade: boolean;
  contours: boolean;
  contourInterval: number;
  daylight: boolean;
  elevOpacity: number;
  diffOpacity: number;
  hillshadeAzimuth: number;   // default 315
  hillshadeAltitude: number;  // default 45
  hillshadeZFactor: number;   // default 1
}

export interface CutFillRun {
  id: string;
  name: string;
  createdAt: number;
  result: CutFillResult;
  hrdem: HRDEMResult;
  daylightFC: GeoJSON.FeatureCollection | null;
  params: {
    targetElevation: number;
    slopeRatio: number | null;
    polygon: GeoJSON.Polygon;
  };
  displayState: CutFillRunDisplayState;
}

type Listener = (runs: CutFillRun[]) => void;

export class CutFillRunStore {
  private static _instance: CutFillRunStore;
  private runs: CutFillRun[] = [];
  private listeners: Listener[] = [];
  private nextIdx = 1;

  static getInstance(): CutFillRunStore {
    if (!CutFillRunStore._instance) CutFillRunStore._instance = new CutFillRunStore();
    return CutFillRunStore._instance;
  }
  private constructor() {}

  addRun(data: Omit<CutFillRun, 'id' | 'name' | 'createdAt' | 'displayState'>): CutFillRun {
    const run: CutFillRun = {
      ...data,
      id: `cfrun-${this.nextIdx++}`,
      name: `C/F Run ${this.runs.length + 1}`,
      createdAt: Date.now(),
      displayState: {
        elevVisible: true,
        diffVisible: false,
        hillshade: false,
        contours: false,
        contourInterval: 1,
        daylight: false,
        elevOpacity: 0.85,
        diffOpacity: 0.85,
        hillshadeAzimuth: 315,
        hillshadeAltitude: 45,
        hillshadeZFactor: 1,
      },
    };
    this.runs.push(run);
    this.notify();
    this.saveRuns();
    return run;
  }

  removeRun(id: string): void {
    this.runs = this.runs.filter(r => r.id !== id);
    this.notify();
    this.saveRuns();
  }

  updateRun(id: string, updates: Partial<Pick<CutFillRun, 'result' | 'daylightFC' | 'params'>>): void {
    const run = this.runs.find(r => r.id === id);
    if (!run) return;
    Object.assign(run, updates);
    // No notify — caller manages UI updates directly
  }

  renameRun(id: string, name: string): void {
    const run = this.runs.find(r => r.id === id);
    if (!run) return;
    run.name = name.trim() || run.name;
    this.notify();
    this.saveRuns();
  }

  moveRun(id: string, direction: 'up' | 'down'): void {
    const idx = this.runs.findIndex(r => r.id === id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= this.runs.length) return;
    [this.runs[idx], this.runs[swapIdx]] = [this.runs[swapIdx], this.runs[idx]];
    this.notify();
    this.saveRuns();
  }

  private saveRuns(): void {
    try {
      const serialized = this.runs.map(r => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        params: r.params,
        displayState: r.displayState,
        result: {
          modifiedGrid: encodeFloat32(r.result.modifiedGrid),
          originalGrid: encodeFloat32(r.result.originalGrid),
          diffGrid: encodeFloat32(r.result.diffGrid),
          insideMask: (() => {
            const bytes = r.result.insideMask;
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
          })(),
          width: r.result.width,
          height: r.result.height,
          bbox: r.result.bbox,
          nodata: r.result.nodata,
          targetElevation: r.result.targetElevation,
          stretchMin: r.result.stretchMin,
          stretchMax: r.result.stretchMax,
          cutVolume: r.result.cutVolume,
          fillVolume: r.result.fillVolume,
          cutArea: r.result.cutArea,
          fillArea: r.result.fillArea,
        },
        hrdem: {
          grid: encodeFloat32(r.hrdem.grid),
          width: r.hrdem.width,
          height: r.hrdem.height,
          bbox: r.hrdem.bbox,
          nodata: r.hrdem.nodata,
          elevMin: r.hrdem.elevMin,
          elevMax: r.hrdem.elevMax,
          stretchMin: r.hrdem.stretchMin,
          stretchMax: r.hrdem.stretchMax,
          validCount: r.hrdem.validCount,
        },
        daylightFC: r.daylightFC,
      }));
      localStorage.setItem(CF_RUNS_KEY, JSON.stringify({ runs: serialized, nextIdx: this.nextIdx }));
    } catch { /* ignore QuotaExceededError */ }
  }

  loadRuns(): void {
    try {
      const raw = localStorage.getItem(CF_RUNS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { runs: any[]; nextIdx: number };
      if (!Array.isArray(parsed.runs)) return;
      this.runs = parsed.runs.map((s: any): CutFillRun => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        params: s.params,
        displayState: {
          elevVisible: s.displayState.elevVisible,
          diffVisible: s.displayState.diffVisible,
          hillshade: s.displayState.hillshade,
          contours: s.displayState.contours,
          contourInterval: s.displayState.contourInterval,
          daylight: s.displayState.daylight,
          elevOpacity: s.displayState.elevOpacity,
          diffOpacity: s.displayState.diffOpacity,
          hillshadeAzimuth: s.displayState.hillshadeAzimuth ?? 315,
          hillshadeAltitude: s.displayState.hillshadeAltitude ?? 45,
          hillshadeZFactor: s.displayState.hillshadeZFactor ?? 1,
        },
        result: {
          modifiedGrid: decodeFloat32(s.result.modifiedGrid),
          originalGrid: decodeFloat32(s.result.originalGrid),
          diffGrid: decodeFloat32(s.result.diffGrid),
          insideMask: (() => {
            const bin = atob(s.result.insideMask);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
          })(),
          targetElevation: s.result.targetElevation,
          width: s.result.width,
          height: s.result.height,
          bbox: s.result.bbox,
          nodata: s.result.nodata,
          stretchMin: s.result.stretchMin,
          stretchMax: s.result.stretchMax,
          cutVolume: s.result.cutVolume,
          fillVolume: s.result.fillVolume,
          cutArea: s.result.cutArea,
          fillArea: s.result.fillArea,
        },
        hrdem: {
          grid: decodeFloat32(s.hrdem.grid),
          width: s.hrdem.width,
          height: s.hrdem.height,
          bbox: s.hrdem.bbox,
          nodata: s.hrdem.nodata,
          elevMin: s.hrdem.elevMin,
          elevMax: s.hrdem.elevMax,
          stretchMin: s.hrdem.stretchMin,
          stretchMax: s.hrdem.stretchMax,
          validCount: s.hrdem.validCount,
        },
        daylightFC: s.daylightFC ?? null,
      }));
      this.nextIdx = parsed.nextIdx ?? (this.runs.length + 1);
      this.notify();
    } catch (e) {
      console.warn('[CutFillRunStore] Failed to load persisted runs:', e);
    }
  }

  getRuns(): CutFillRun[] { return [...this.runs]; }
  getById(id: string): CutFillRun | undefined { return this.runs.find(r => r.id === id); }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify(): void { this.listeners.forEach(fn => fn(this.getRuns())); }
}
