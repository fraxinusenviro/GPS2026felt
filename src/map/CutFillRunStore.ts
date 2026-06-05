import type { CutFillResult } from '../lib/cutFillEngine';
import type { HRDEMResult } from '../lib/hrdemWCS';

export interface CutFillRunDisplayState {
  elevVisible: boolean;
  diffVisible: boolean;
  hillshade: boolean;
  contours: boolean;
  contourInterval: number;
  daylight: boolean;
  elevOpacity: number;
  diffOpacity: number;
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
      },
    };
    this.runs.push(run);
    this.notify();
    return run;
  }

  removeRun(id: string): void {
    this.runs = this.runs.filter(r => r.id !== id);
    this.notify();
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
  }

  moveRun(id: string, direction: 'up' | 'down'): void {
    const idx = this.runs.findIndex(r => r.id === id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= this.runs.length) return;
    [this.runs[idx], this.runs[swapIdx]] = [this.runs[swapIdx], this.runs[idx]];
    this.notify();
  }

  getRuns(): CutFillRun[] { return [...this.runs]; }
  getById(id: string): CutFillRun | undefined { return this.runs.find(r => r.id === id); }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify(): void { this.listeners.forEach(fn => fn(this.getRuns())); }
}
