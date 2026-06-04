import type { CutFillResult } from '../lib/cutFillEngine';
import type { HRDEMResult } from '../lib/hrdemWCS';

export interface CutFillRunDisplayState {
  view: 'elevation' | 'diff';
  hillshade: boolean;
  contours: boolean;
  contourInterval: number;
  daylight: boolean;
  opacity: number;
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
        view: 'elevation',
        hillshade: false,
        contours: false,
        contourInterval: 1,
        daylight: false,
        opacity: 0.85,
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

  getRuns(): CutFillRun[] { return [...this.runs]; }
  getById(id: string): CutFillRun | undefined { return this.runs.find(r => r.id === id); }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify(): void { this.listeners.forEach(fn => fn(this.getRuns())); }
}
