/**
 * Cut / Fill Tool panel.
 *
 * Floating HUD that lets the user:
 *   1. Draw a polygon footprint on the map
 *   2. Enter a target elevation and optional side-slope ratio
 *   3. Compute a modified DTM surface and view volumes/areas
 *   4. Export the result as a GeoTIFF or as contour / daylight GeoJSON
 *
 * Map click interception:
 *   Call handleMapClick(lng, lat) from App.ts before other click handlers.
 *   Returns true if the click was consumed (panel is in draw / pick mode).
 */

import type { MapManager } from '../map/MapManager';
import type { BasemapManager } from '../map/BasemapManager';
import type { HRDEMResult } from '../lib/hrdemWCS';
import { CutFillLayer } from '../map/CutFillLayer';
import {
  computeCutFill,
  computeDaylightFeatures,
  findBalancedElevation,
  sampleElevation,
  type CutFillResult,
} from '../lib/cutFillEngine';
import { exportGeoTIFF } from '../lib/geotiffExporter';
import { fetchHRDEM } from '../lib/hrdemWCS';

// Padding fraction applied to polygon bbox before fetching HRDEM
const FETCH_PAD = 0.5;
// Maximum grid dimension for the cut/fill fetch
const MAX_GRID_PX = 512;
// Debounce delay (ms) for live recompute after elevation/slope change
const RECOMPUTE_DEBOUNCE = 600;

export class CutFillPanel {
  private el: HTMLElement | null = null;
  private visible = false;

  // Draw-polygon state
  private drawMode: 'idle' | 'drawing' | 'pickElev' = 'idle';
  private vertices: [number, number][] = [];

  // Layer manager
  private cutFillLayer: CutFillLayer;

  // Compute state
  private lastResult:  CutFillResult | null = null;
  private lastHrdem:   HRDEMResult   | null = null; // cached — reused for live recompute
  private computing = false;
  private daylightFC: GeoJSON.FeatureCollection | null = null;

  // Display state (instance variables — no local closure bugs)
  private currentView: 'elevation' | 'diff' = 'elevation';
  private hillshadeOn  = false;
  private contoursOn   = false;
  private daylightOn   = false;

  // Debounce timer for live recompute
  private recomputeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly mapManager: MapManager,
    private readonly basemapManager: BasemapManager,
  ) {
    this.cutFillLayer = new CutFillLayer(mapManager);
  }

  // --------------------------------------------------------------------------
  // Open / close
  // --------------------------------------------------------------------------

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.stopDrawing();
    if (this.el) this.el.style.display = 'none';
  }

  toggle(): void { this.visible ? this.close() : this.open(); }
  isOpen(): boolean { return this.visible; }
  getLastResult(): CutFillResult | null { return this.lastResult; }

  // --------------------------------------------------------------------------
  // Map click interception — called by App.ts wireMapInteractions
  // --------------------------------------------------------------------------

  handleMapClick(lng: number, lat: number): boolean {
    if (!this.visible) return false;

    if (this.drawMode === 'drawing') {
      this.vertices.push([lng, lat]);
      this.updateSketchPreview();
      this.updateVertexCount();
      return true;
    }

    if (this.drawMode === 'pickElev') {
      this.pickElevationAt(lng, lat);
      this.setDrawMode('idle');
      return true;
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Render the panel HTML
  // --------------------------------------------------------------------------

  private render(): void {
    let el = document.getElementById('cutfill-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cutfill-panel';
      el.className = 'cf-panel';
      document.getElementById('map-container')?.appendChild(el);
    }
    this.el = el;

    el.innerHTML = `
      <div class="cf-header">
        <span class="cf-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/>
            <line x1="20" y1="4" x2="4" y2="20"/>
            <line x1="8.12" y1="3.88" x2="3.88" y2="8.12"/>
            <line x1="20.12" y1="15.88" x2="15.88" y2="20.12"/>
          </svg>
          Cut / Fill
        </span>
        <button class="cf-close" id="cf-close">✕</button>
      </div>

      <div class="cf-section">
        <div class="cf-label">1 · Polygon footprint</div>
        <div class="cf-row">
          <button class="cf-btn" id="cf-draw-btn">Draw</button>
          <button class="cf-btn cf-btn-sm" id="cf-undo-btn" title="Remove last vertex">↩</button>
          <button class="cf-btn cf-btn-sm" id="cf-clear-btn">Clear</button>
          <span class="cf-hint" id="cf-vtx-count">0 pts</span>
        </div>
        <div class="cf-hint" id="cf-draw-hint"></div>
      </div>

      <div class="cf-section">
        <div class="cf-label">2 · Target elevation (m)</div>
        <div class="cf-row">
          <input type="number" id="cf-target-elev" class="cf-input" step="0.1" placeholder="e.g. 45.0">
          <button class="cf-btn cf-btn-sm" id="cf-pick-elev" title="Click map to sample elevation">⊕ Pick</button>
          <button class="cf-btn cf-btn-sm" id="cf-balance" title="Find balanced cut/fill elevation" disabled>⚖ Balance</button>
        </div>
        <div class="cf-hint" id="cf-elev-hint" style="display:none;color:#f87171;margin-top:2px"></div>
      </div>

      <div class="cf-section">
        <div class="cf-label">3 · Side slope H:V ratio</div>
        <input type="number" id="cf-slope" class="cf-input cf-input-full" step="0.5" min="0.5" placeholder="e.g. 2  (blank = vertical walls)">
      </div>

      <div class="cf-section">
        <button class="cf-btn cf-btn-primary" id="cf-compute" disabled>Compute Cut / Fill</button>
      </div>

      <div class="cf-results" id="cf-results" style="display:none">
        <div class="cf-result-row">
          <span class="cf-result-label">Cut</span>
          <span class="cf-result-val" id="cf-res-cut">—</span>
        </div>
        <div class="cf-result-row">
          <span class="cf-result-label">Fill</span>
          <span class="cf-result-val" id="cf-res-fill">—</span>
        </div>
        <div class="cf-result-row cf-result-net">
          <span class="cf-result-label">Net</span>
          <span class="cf-result-val" id="cf-res-net">—</span>
        </div>
      </div>

      <div class="cf-section cf-view-section" id="cf-view-section" style="display:none">
        <div class="cf-label">Display</div>
        <div class="cf-row">
          <button class="cf-btn cf-btn-active" id="cf-view-elev">Elevation</button>
          <button class="cf-btn" id="cf-view-diff">Cut/Fill Diff</button>
        </div>
        <div class="cf-row" style="margin-top:4px">
          <label class="cf-toggle-row">
            <input type="checkbox" id="cf-hillshade-toggle"> Hillshade
          </label>
        </div>

        <div class="cf-label cf-label-mt">Contours</div>
        <div class="cf-row">
          <input type="number" id="cf-contour-interval" class="cf-input" style="width:64px" value="1" min="0.1" step="0.5">
          <span class="cf-hint">m</span>
          <button class="cf-btn cf-btn-sm" id="cf-contour-toggle">Show</button>
        </div>

        <div class="cf-label cf-label-mt">Daylight limit</div>
        <div class="cf-row">
          <button class="cf-btn cf-btn-sm" id="cf-daylight-toggle">Show</button>
          <button class="cf-btn cf-btn-sm" id="cf-daylight-export">↓ GeoJSON</button>
        </div>

        <div class="cf-label cf-label-mt">Export</div>
        <div class="cf-row cf-export-row">
          <button class="cf-btn cf-btn-sm" id="cf-export-tiff">↓ GeoTIFF</button>
          <button class="cf-btn cf-btn-sm" id="cf-export-contour">↓ Contours</button>
        </div>
      </div>
    `;

    this.syncDisplayState();
    this.wireEvents();
    el.style.display = 'flex';
  }

  // --------------------------------------------------------------------------
  // Internal event wiring
  // --------------------------------------------------------------------------

  private wireEvents(): void {
    const el = this.el!;

    el.querySelector('#cf-close')?.addEventListener('click', () => this.close());

    el.querySelector('#cf-draw-btn')?.addEventListener('click', () => {
      if (this.drawMode === 'drawing') {
        if (this.vertices.length >= 3) {
          this.setDrawMode('idle');
          this.updateComputeBtn();
        }
      } else {
        this.setDrawMode('drawing');
      }
    });

    el.querySelector('#cf-undo-btn')?.addEventListener('click', () => {
      this.vertices.pop();
      this.updateSketchPreview();
      this.updateVertexCount();
      this.updateComputeBtn();
    });

    el.querySelector('#cf-clear-btn')?.addEventListener('click', () => {
      this.vertices = [];
      this.setDrawMode('idle');
      this.updateSketchPreview();
      this.updateComputeBtn();
    });

    el.querySelector('#cf-pick-elev')?.addEventListener('click', () => {
      this.setDrawMode(this.drawMode === 'pickElev' ? 'idle' : 'pickElev');
    });

    // Live-recompute debounce on elevation / slope changes
    el.querySelector('#cf-target-elev')?.addEventListener('input', () => {
      this.updateComputeBtn();
      this.scheduleRecompute();
    });
    el.querySelector('#cf-slope')?.addEventListener('input', () => {
      this.updateComputeBtn();
      this.scheduleRecompute();
    });

    el.querySelector('#cf-compute')?.addEventListener('click', () => void this.runCompute());

    el.querySelector('#cf-balance')?.addEventListener('click', () => void this.runBalance());

    el.querySelector('#cf-view-elev')?.addEventListener('click', () => this.switchView('elevation'));
    el.querySelector('#cf-view-diff')?.addEventListener('click', () => this.switchView('diff'));

    el.querySelector<HTMLInputElement>('#cf-hillshade-toggle')?.addEventListener('change', (e) => {
      this.hillshadeOn = (e.target as HTMLInputElement).checked;
      if (this.lastResult) this.rerender();
    });

    // Contour interval — use 'input' event so it fires on every keystroke
    el.querySelector('#cf-contour-interval')?.addEventListener('input', () => {
      if (!this.lastResult || !this.contoursOn) return;
      const iv = this.getContourInterval();
      this.cutFillLayer.updateContours(this.lastResult, iv);
    });

    const contourToggleBtn = el.querySelector<HTMLButtonElement>('#cf-contour-toggle');
    contourToggleBtn?.addEventListener('click', () => {
      if (!this.lastResult) return;
      this.contoursOn = !this.contoursOn;
      if (this.contoursOn) {
        this.cutFillLayer.updateContours(this.lastResult, this.getContourInterval());
      } else {
        this.cutFillLayer.setContoursVisible(false);
      }
      this.syncDisplayState();
    });

    const daylightToggleBtn = el.querySelector<HTMLButtonElement>('#cf-daylight-toggle');
    daylightToggleBtn?.addEventListener('click', () => {
      if (!this.lastResult) return;
      this.daylightOn = !this.daylightOn;
      if (this.daylightOn) {
        if (!this.daylightFC) {
          this.daylightFC = computeDaylightFeatures(this.lastResult);
        }
        this.cutFillLayer.setDaylight(this.daylightFC);
      } else {
        this.cutFillLayer.setDaylightVisible(false);
      }
      this.syncDisplayState();
    });

    el.querySelector('#cf-daylight-export')?.addEventListener('click', () => {
      if (!this.lastResult) return;
      const fc = this.daylightFC ?? computeDaylightFeatures(this.lastResult);
      this.cutFillLayer.exportDaylightGeoJSON(fc);
    });

    el.querySelector('#cf-export-tiff')?.addEventListener('click', () => {
      if (this.lastResult) exportGeoTIFF(this.lastResult, 'cutfill_surface.tif');
    });

    el.querySelector('#cf-export-contour')?.addEventListener('click', () => {
      if (!this.lastResult) return;
      this.cutFillLayer.exportContourGeoJSON(this.lastResult, this.getContourInterval());
    });
  }

  // --------------------------------------------------------------------------
  // Draw mode
  // --------------------------------------------------------------------------

  private setDrawMode(mode: 'idle' | 'drawing' | 'pickElev'): void {
    this.drawMode = mode;
    if (!this.el) return;

    const drawBtn = this.el.querySelector<HTMLButtonElement>('#cf-draw-btn');
    const hint    = this.el.querySelector<HTMLElement>('#cf-draw-hint');
    const pickBtn = this.el.querySelector<HTMLButtonElement>('#cf-pick-elev');

    if (drawBtn) {
      drawBtn.textContent = mode === 'drawing' ? 'Finish' : 'Draw';
      drawBtn.classList.toggle('cf-btn-active', mode === 'drawing');
    }
    if (hint) {
      hint.textContent = mode === 'drawing'
        ? 'Click map to add vertices · click Finish when done'
        : mode === 'pickElev'
        ? 'Click any point on the map to read its elevation'
        : '';
    }
    if (pickBtn) {
      pickBtn.classList.toggle('cf-btn-active', mode === 'pickElev');
    }

    const canvas = this.mapManager.getMap().getCanvas();
    canvas.style.cursor = mode !== 'idle' ? 'crosshair' : '';
  }

  private stopDrawing(): void {
    this.setDrawMode('idle');
    this.mapManager.clearSketchPreview();
    this.mapManager.getMap().getCanvas().style.cursor = '';
  }

  private updateVertexCount(): void {
    const el = this.el?.querySelector('#cf-vtx-count');
    if (el) el.textContent = `${this.vertices.length} pts`;
  }

  private updateSketchPreview(): void {
    const verts = this.vertices;
    if (verts.length === 0) { this.mapManager.clearSketchPreview(); return; }
    const features: object[] = [];
    if (verts.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: verts.length >= 3 ? [...verts, verts[0]] : verts,
        },
        properties: {},
      });
    }
    verts.forEach(v => features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: v }, properties: {},
    }));
    this.mapManager.updateSketchPreview(features);
  }

  private updateComputeBtn(): void {
    const btn      = this.el?.querySelector<HTMLButtonElement>('#cf-compute');
    if (!btn) return;
    const elevInput = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    const hasElev   = elevInput && elevInput.value.trim() !== '' && isFinite(parseFloat(elevInput.value));
    const hasPolygon = this.vertices.length >= 3;
    btn.disabled = !hasElev || !hasPolygon || this.computing;
  }

  // --------------------------------------------------------------------------
  // Elevation picker
  // --------------------------------------------------------------------------

  private pickElevationAt(lng: number, lat: number): void {
    const hintEl = this.el?.querySelector<HTMLElement>('#cf-elev-hint');

    // Try cached HRDEM result first (most accurate for the current view extent)
    const sources: Array<HRDEMResult | null> = [
      this.lastHrdem,
      this.basemapManager.getFirstHrdemResult(),
    ];

    for (const hr of sources) {
      if (!hr) continue;
      const elev = sampleElevation(hr.grid, hr.width, hr.height, hr.bbox, hr.nodata, lng, lat);
      if (elev !== null) {
        const input = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
        if (input) input.value = elev.toFixed(2);
        if (hintEl) hintEl.style.display = 'none';
        this.updateComputeBtn();
        this.scheduleRecompute();
        return;
      }
    }

    // Nothing found — show guidance
    if (hintEl) {
      hintEl.textContent = '⚠ No elevation data at that point — load HRDEM first or click within its extent';
      hintEl.style.display = 'block';
      setTimeout(() => { if (hintEl) hintEl.style.display = 'none'; }, 5000);
    }
  }

  // --------------------------------------------------------------------------
  // Main computation
  // --------------------------------------------------------------------------

  private async runCompute(): Promise<void> {
    if (this.computing) return;

    const elevInput  = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    const slopeInput = this.el?.querySelector<HTMLInputElement>('#cf-slope');
    const computeBtn = this.el?.querySelector<HTMLButtonElement>('#cf-compute');

    const targetElevation = parseFloat(elevInput?.value ?? '');
    if (!isFinite(targetElevation) || this.vertices.length < 3) return;

    const slopeRatio = this.parseSlopeRatio(slopeInput?.value ?? '');

    this.computing = true;
    if (computeBtn) { computeBtn.disabled = true; computeBtn.textContent = 'Fetching…'; }

    try {
      const ring    = [...this.vertices, this.vertices[0]];
      const polygon = { type: 'Polygon' as const, coordinates: [ring] };

      const lons   = this.vertices.map(v => v[0]);
      const lats   = this.vertices.map(v => v[1]);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const padLon = (maxLon - minLon) * FETCH_PAD || 0.001;
      const padLat = (maxLat - minLat) * FETCH_PAD || 0.001;

      if (computeBtn) computeBtn.textContent = 'Fetching elevation…';

      const hrdem = await fetchHRDEM(
        minLon - padLon, minLat - padLat,
        maxLon + padLon, maxLat + padLat,
        MAX_GRID_PX, MAX_GRID_PX, 'dtm',
      );
      this.lastHrdem = hrdem;

      if (computeBtn) computeBtn.textContent = 'Computing…';

      const result = computeCutFill(hrdem, { polygon, targetElevation, slopeRatio });
      this.lastResult  = result;
      this.daylightFC  = null; // invalidate cached daylight

      this.mapManager.clearSketchPreview();
      this.rerender();

      // Refresh contours if they were showing
      if (this.contoursOn) {
        this.cutFillLayer.updateContours(result, this.getContourInterval());
      }

      // Refresh daylight if it was showing
      if (this.daylightOn) {
        this.daylightFC = computeDaylightFeatures(result);
        this.cutFillLayer.setDaylight(this.daylightFC);
      }

      this.showResults(result);
      this.syncDisplayState();

    } catch (err) {
      console.error('[CutFillPanel] compute failed:', err);
      if (computeBtn) {
        computeBtn.textContent = 'Error — try again';
        setTimeout(() => {
          computeBtn.textContent = 'Compute Cut / Fill';
          computeBtn.disabled = false;
        }, 3000);
        return;
      }
    } finally {
      this.computing = false;
      if (computeBtn) { computeBtn.textContent = 'Compute Cut / Fill'; computeBtn.disabled = false; }
    }
  }

  // --------------------------------------------------------------------------
  // Live recompute with cached HRDEM (no re-fetch)
  // --------------------------------------------------------------------------

  private scheduleRecompute(): void {
    if (this.recomputeTimer !== null) clearTimeout(this.recomputeTimer);
    if (!this.lastHrdem || !this.lastResult) return;
    this.recomputeTimer = setTimeout(() => void this.runRecompute(), RECOMPUTE_DEBOUNCE);
  }

  private async runRecompute(): Promise<void> {
    if (!this.lastHrdem || this.vertices.length < 3) return;

    const elevInput  = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    const slopeInput = this.el?.querySelector<HTMLInputElement>('#cf-slope');

    const targetElevation = parseFloat(elevInput?.value ?? '');
    if (!isFinite(targetElevation)) return;

    const slopeRatio = this.parseSlopeRatio(slopeInput?.value ?? '');
    const ring       = [...this.vertices, this.vertices[0]];
    const polygon    = { type: 'Polygon' as const, coordinates: [ring] };

    const result    = computeCutFill(this.lastHrdem, { polygon, targetElevation, slopeRatio });
    this.lastResult = result;
    this.daylightFC = null;

    this.rerender();
    if (this.contoursOn) this.cutFillLayer.updateContours(result, this.getContourInterval());
    if (this.daylightOn) {
      this.daylightFC = computeDaylightFeatures(result);
      this.cutFillLayer.setDaylight(this.daylightFC);
    }
    this.showResults(result);
  }

  // --------------------------------------------------------------------------
  // Balance elevation optimizer
  // --------------------------------------------------------------------------

  private async runBalance(): Promise<void> {
    if (!this.lastHrdem || this.vertices.length < 3 || this.computing) return;

    const slopeInput = this.el?.querySelector<HTMLInputElement>('#cf-slope');
    const slopeRatio = this.parseSlopeRatio(slopeInput?.value ?? '');
    const ring       = [...this.vertices, this.vertices[0]];
    const polygon    = { type: 'Polygon' as const, coordinates: [ring] };

    const balBtn = this.el?.querySelector<HTMLButtonElement>('#cf-balance');
    if (balBtn) { balBtn.disabled = true; balBtn.textContent = '⚖…'; }

    try {
      const balanced = findBalancedElevation(this.lastHrdem, { polygon, slopeRatio });
      const elevInput = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
      if (elevInput) elevInput.value = balanced.toFixed(2);
      this.updateComputeBtn();
      await this.runRecompute();
    } finally {
      if (balBtn) { balBtn.disabled = false; balBtn.textContent = '⚖ Balance'; }
    }
  }

  // --------------------------------------------------------------------------
  // Rerender current view (elevation or diff, with optional hillshade)
  // --------------------------------------------------------------------------

  private rerender(): void {
    if (!this.lastResult) return;
    if (this.currentView === 'diff') {
      this.cutFillLayer.showDiff(this.lastResult, this.hillshadeOn);
    } else {
      this.cutFillLayer.show(this.lastResult, undefined, this.hillshadeOn);
    }
  }

  // --------------------------------------------------------------------------
  // View switching
  // --------------------------------------------------------------------------

  private switchView(mode: 'elevation' | 'diff'): void {
    this.currentView = mode;
    this.rerender();

    const elevBtn = this.el?.querySelector<HTMLButtonElement>('#cf-view-elev');
    const diffBtn = this.el?.querySelector<HTMLButtonElement>('#cf-view-diff');
    elevBtn?.classList.toggle('cf-btn-active', mode === 'elevation');
    diffBtn?.classList.toggle('cf-btn-active', mode === 'diff');
  }

  // --------------------------------------------------------------------------
  // Results display
  // --------------------------------------------------------------------------

  private showResults(result: CutFillResult): void {
    const section = this.el?.querySelector<HTMLElement>('#cf-results');
    const viewSec = this.el?.querySelector<HTMLElement>('#cf-view-section');
    if (section) section.style.display = 'block';
    if (viewSec) viewSec.style.display = 'block';

    const fmt = (m3: number) =>
      m3 >= 1000 ? `${(m3 / 1000).toFixed(2)} km³` : `${m3.toFixed(0)} m³`;
    const fmtArea = (m2: number) =>
      m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${m2.toFixed(0)} m²`;

    const setEl = (id: string, val: string) => {
      const el = this.el?.querySelector(`#${id}`);
      if (el) el.textContent = val;
    };

    setEl('cf-res-cut',  `${fmt(result.cutVolume)} (${fmtArea(result.cutArea)})`);
    setEl('cf-res-fill', `${fmt(result.fillVolume)} (${fmtArea(result.fillArea)})`);

    const net     = result.fillVolume - result.cutVolume;
    const netSign = net >= 0 ? '+' : '';
    setEl('cf-res-net', `${netSign}${fmt(Math.abs(net))} ${net >= 0 ? '(net fill)' : '(net cut)'}`);
  }

  // --------------------------------------------------------------------------
  // Sync display-state toggles back to DOM (called after state changes)
  // --------------------------------------------------------------------------

  private syncDisplayState(): void {
    if (!this.el) return;

    const contourBtn = this.el.querySelector<HTMLButtonElement>('#cf-contour-toggle');
    if (contourBtn) {
      contourBtn.textContent = this.contoursOn ? 'Hide' : 'Show';
      contourBtn.classList.toggle('cf-btn-active', this.contoursOn);
    }

    const daylightBtn = this.el.querySelector<HTMLButtonElement>('#cf-daylight-toggle');
    if (daylightBtn) {
      daylightBtn.textContent = this.daylightOn ? 'Hide' : 'Show';
      daylightBtn.classList.toggle('cf-btn-active', this.daylightOn);
    }

    const hillshadeChk = this.el.querySelector<HTMLInputElement>('#cf-hillshade-toggle');
    if (hillshadeChk) hillshadeChk.checked = this.hillshadeOn;

    const elevBtn = this.el.querySelector<HTMLButtonElement>('#cf-view-elev');
    const diffBtn = this.el.querySelector<HTMLButtonElement>('#cf-view-diff');
    elevBtn?.classList.toggle('cf-btn-active', this.currentView === 'elevation');
    diffBtn?.classList.toggle('cf-btn-active', this.currentView === 'diff');

    const balBtn = this.el.querySelector<HTMLButtonElement>('#cf-balance');
    if (balBtn) balBtn.disabled = !this.lastHrdem;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private getContourInterval(): number {
    const input = this.el?.querySelector<HTMLInputElement>('#cf-contour-interval');
    const v = parseFloat(input?.value ?? '1');
    return isFinite(v) && v > 0 ? v : 1;
  }

  private parseSlopeRatio(str: string): number | null {
    const s = str.trim();
    if (s === '') return null;
    const v = parseFloat(s);
    return isFinite(v) && v > 0 ? v : null;
  }
}
