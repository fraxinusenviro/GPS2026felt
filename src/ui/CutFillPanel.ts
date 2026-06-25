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
import { CutFillRunStore } from '../map/CutFillRunStore';
import {
  computeCutFill,
  computeDaylightFeatures,
  findBalancedElevation,
  sampleElevation,
  sampleElevationBilinear,
  type CutFillResult,
} from '../lib/cutFillEngine';
import { exportGeoTIFF } from '../lib/geotiffExporter';
import { fetchHRDEM } from '../lib/hrdemWCS';
import { SurfaceViewer3D } from './SurfaceViewer3D';

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
  private drawMode: 'idle' | 'drawing' | 'drawing3d' | 'pickElev' = 'idle';
  private vertices: [number, number][] = [];
  private freehandActive = false;
  private freehandCleanup: (() => void) | null = null;

  // 3D (graded) polygon state — parallel to `vertices`
  //   source 'hrdem' → vertex sits at existing ground (sampled at compute time)
  //   source 'user'  → vertex sits at a fixed elevation `value`
  private poly3D = false;
  private vertexElev: Array<{ source: 'hrdem' | 'user'; value: number | null }> = [];

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

  // Tracks whether current lastResult has already been saved to layer manager
  private savedToLayers = false;
  // Debounce timer for live recompute
  private recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  // CutFillRunStore subscription handle
  private cfRunUnsub: (() => void) | null = null;
  // Persisted dragged position (px, relative to map container) — null = default centred
  private dragPos: { left: number; top: number } | null = null;

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
    this.cfRunUnsub = CutFillRunStore.getInstance().subscribe(() => {
      this.refreshRefSurface();
    });
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.stopDrawing();
    if (this.el) this.el.style.display = 'none';
    this.cfRunUnsub?.();
    this.cfRunUnsub = null;
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

    if (this.drawMode === 'drawing3d') {
      this.vertices.push([lng, lat]);
      this.vertexElev.push(this.currentVertexSource(lng, lat));
      this.updateSketchPreview();
      this.updateVertexCount();
      this.updateComputeBtn();
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
      <div class="cf-header" id="cf-drag-handle">
        <span class="cf-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/>
            <line x1="20" y1="4" x2="4" y2="20"/>
            <line x1="8.12" y1="3.88" x2="3.88" y2="8.12"/>
            <line x1="20.12" y1="15.88" x2="15.88" y2="20.12"/>
          </svg>
          Cut / Fill
        </span>
        <button class="cf-close" id="cf-close">✕</button>
      </div>

      <div class="cf-body">
        <div class="cf-col cf-col-left">

          <div class="cf-section">
            <div class="cf-label"><span class="cf-step">1</span> Polygon footprint</div>
            <div class="cf-row">
              <button class="cf-btn" id="cf-draw-btn">Draw</button>
              <button class="cf-btn" id="cf-draw3d-btn" title="Draw a graded polygon with per-vertex elevations">3D</button>
              <button class="cf-btn" id="cf-freehand-btn" title="Draw polygon freehand (press and drag)">Freehand</button>
              <button class="cf-btn cf-btn-sm" id="cf-undo-btn" title="Remove last vertex">↩</button>
              <button class="cf-btn cf-btn-sm" id="cf-clear-btn">Clear</button>
            </div>
            <div class="cf-hint" id="cf-vtx-count">0 pts</div>
            <div class="cf-hint" id="cf-draw-hint"></div>
          </div>

          <div class="cf-section" id="cf-3d-source-section" style="display:none">
            <div class="cf-label"><span class="cf-step">1b</span> Vertex elevation source</div>
            <div class="cf-row">
              <select id="cf-vtx-source" class="cf-input" style="flex:1;min-width:0">
                <option value="hrdem">Ground (HRDEM)</option>
                <option value="user">Constant elevation</option>
              </select>
              <input type="number" id="cf-vtx-elev" class="cf-input" style="width:78px" step="0.1" placeholder="m" disabled>
            </div>
            <div class="cf-hint">Each click adds a vertex at the selected source. Switch source between clicks to mix ground-matched and fixed-elevation points.</div>
          </div>

          <div class="cf-section">
            <div class="cf-label"><span class="cf-step">2</span> Reference surface</div>
            <select id="cf-ref-surface" class="cf-input cf-input-full">
              <option value="hrdem">HRDEM (live data)</option>
              ${CutFillRunStore.getInstance().getRuns().map(r =>
                `<option value="${r.id}">${r.name} (elev ${r.params.targetElevation.toFixed(1)}m)</option>`
              ).join('')}
            </select>
          </div>

          <div class="cf-section">
            <div class="cf-label" id="cf-elev-label"><span class="cf-step">3</span> Target elevation (m)</div>
            <div class="cf-row">
              <input type="number" id="cf-target-elev" class="cf-input" step="0.1" placeholder="e.g. 45.0">
              <button class="cf-btn cf-btn-sm" id="cf-pick-elev" title="Click map to sample elevation">⊕ Pick</button>
              <button class="cf-btn cf-btn-sm" id="cf-balance" title="Find balanced cut/fill elevation" disabled>⚖ Balance</button>
            </div>
            <div class="cf-hint" id="cf-elev-hint" style="display:none;color:#f87171;margin-top:2px"></div>
          </div>

          <div class="cf-section">
            <div class="cf-label"><span class="cf-step">4</span> Side slope H:V ratio</div>
            <input type="number" id="cf-slope" class="cf-input cf-input-full" step="0.5" min="0.5" placeholder="e.g. 2  (blank = vertical walls)">
          </div>

          <div class="cf-section">
            <button class="cf-btn cf-btn-primary" id="cf-compute" disabled>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg>
              Compute Cut / Fill
            </button>
          </div>

        </div>

        <div class="cf-col cf-col-right">

          <div class="cf-section">
            <div class="cf-label cf-results-title">Results</div>
            <div class="cf-results" id="cf-results">
              <div class="cf-result-row">
                <span class="cf-result-label">Cut</span>
                <span class="cf-result-val" id="cf-res-cut">—</span>
              </div>
              <div class="cf-result-row">
                <span class="cf-result-label">Fill</span>
                <span class="cf-result-val" id="cf-res-fill">—</span>
              </div>
              <div class="cf-result-net" id="cf-res-net-box">
                <span class="cf-result-label">Net</span>
                <span class="cf-result-val" id="cf-res-net">—</span>
              </div>
            </div>
          </div>

          <div class="cf-section cf-view-section" id="cf-view-section" style="display:none">
            <div class="cf-label">Display</div>
            <div class="cf-row">
              <button class="cf-btn cf-btn-active" id="cf-view-elev">▲ Elevation</button>
              <button class="cf-btn" id="cf-view-diff">◑ Cut/Fill Diff</button>
            </div>
            <div class="cf-row" style="margin-top:4px">
              <label class="cf-toggle-row">
                <input type="checkbox" id="cf-hillshade-toggle"> Hillshade
              </label>
              <button class="cf-btn cf-btn-sm" id="cf-view-3d" title="Open interactive 3D surface viewer" style="margin-left:auto">⬡ 3D View</button>
            </div>

            <div class="cf-label cf-label-mt">Contours</div>
            <div class="cf-row">
              <input type="number" id="cf-contour-interval" class="cf-input" style="width:64px" value="1" min="0.1" step="0.5">
              <span class="cf-hint">m</span>
              <button class="cf-btn cf-btn-sm" id="cf-contour-toggle" style="margin-left:auto">Show</button>
            </div>

            <div class="cf-label cf-label-mt">Daylight limit</div>
            <div class="cf-row">
              <button class="cf-btn cf-btn-sm" id="cf-daylight-toggle">☀ Show</button>
              <button class="cf-btn cf-btn-sm" id="cf-daylight-export">{ } GeoJSON</button>
            </div>

            <div class="cf-label cf-label-mt">Export</div>
            <div class="cf-row cf-export-row">
              <button class="cf-btn cf-btn-sm" id="cf-export-tiff">↓ GeoTIFF</button>
              <button class="cf-btn cf-btn-sm" id="cf-export-contour">↜ Contours</button>
            </div>

            <div class="cf-label cf-label-mt">Persist</div>
            <button class="cf-btn cf-btn-persist" id="cf-save-layers" style="width:100%">⊟ Save to Layer Manager</button>
          </div>

        </div>
      </div>

      <div class="cf-footer">
        <button class="cf-btn cf-btn-danger" id="cf-clear-data">🗑 Clear Current Data</button>
      </div>
    `;

    this.syncDisplayState();
    this.wireEvents();
    this.makeDraggable();
    this.updateElevLabel();
    this.updateVertexCount();
    this.updateComputeBtn();
    el.style.display = 'flex';
    // Re-apply any previously dragged position
    if (this.dragPos) this.applyDragPos(this.dragPos.left, this.dragPos.top);
  }

  // --------------------------------------------------------------------------
  // Draggable header — lets the user reposition the floating panel
  // --------------------------------------------------------------------------

  private applyDragPos(left: number, top: number): void {
    if (!this.el) return;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.bottom = 'auto';
    this.el.style.transform = 'none';
  }

  private makeDraggable(): void {
    const handle = this.el?.querySelector<HTMLElement>('#cf-drag-handle');
    if (!handle || !this.el) return;
    const panel = this.el;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      // Ignore drags that start on the close button
      if ((e.target as HTMLElement).closest('#cf-close')) return;
      e.preventDefault();

      const rect = panel.getBoundingClientRect();
      const container = panel.offsetParent as HTMLElement | null;
      const cRect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      handle.setPointerCapture(e.pointerId);
      handle.classList.add('cf-dragging');

      const onMove = (ev: PointerEvent) => {
        const maxLeft = (container?.clientWidth ?? window.innerWidth) - rect.width;
        const maxTop = (container?.clientHeight ?? window.innerHeight) - 40;
        let left = ev.clientX - cRect.left - offsetX;
        let top = ev.clientY - cRect.top - offsetY;
        left = Math.max(0, Math.min(left, Math.max(0, maxLeft)));
        top = Math.max(0, Math.min(top, Math.max(0, maxTop)));
        this.dragPos = { left, top };
        this.applyDragPos(left, top);
      };

      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.classList.remove('cf-dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
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
        // Starting a fresh flat polygon — discard any 3D vertex elevations
        this.vertices = [];
        this.vertexElev = [];
        this.poly3D = false;
        this.updateSketchPreview();
        this.updateVertexCount();
        this.updateElevLabel();
        this.setDrawMode('drawing');
      }
    });

    el.querySelector('#cf-draw3d-btn')?.addEventListener('click', () => {
      if (this.drawMode === 'drawing3d') {
        if (this.vertices.length >= 3) {
          this.setDrawMode('idle');
          this.updateComputeBtn();
        }
      } else {
        // Starting a fresh 3D polygon
        this.vertices = [];
        this.vertexElev = [];
        this.poly3D = true;
        this.stopFreehand();
        this.updateSketchPreview();
        this.updateVertexCount();
        this.setDrawMode('drawing3d');
        this.updateElevLabel();
      }
    });

    el.querySelector('#cf-vtx-source')?.addEventListener('change', () => {
      const src = this.el?.querySelector<HTMLSelectElement>('#cf-vtx-source')?.value;
      const elevIn = this.el?.querySelector<HTMLInputElement>('#cf-vtx-elev');
      if (elevIn) elevIn.disabled = src !== 'user';
    });

    el.querySelector('#cf-undo-btn')?.addEventListener('click', () => {
      this.vertices.pop();
      if (this.poly3D) this.vertexElev.pop();
      this.updateSketchPreview();
      this.updateVertexCount();
      this.updateComputeBtn();
    });

    el.querySelector('#cf-clear-btn')?.addEventListener('click', () => {
      this.vertices = [];
      this.vertexElev = [];
      this.poly3D = false;
      this.setDrawMode('idle');
      this.stopFreehand();
      this.updateSketchPreview();
      this.updateVertexCount();
      this.updateComputeBtn();
      this.updateElevLabel();
    });

    el.querySelector('#cf-freehand-btn')?.addEventListener('click', () => {
      if (this.freehandActive) {
        this.stopFreehand();
      } else {
        this.poly3D = false;
        this.vertexElev = [];
        this.updateElevLabel();
        this.setDrawMode('idle');
        this.startFreehand();
      }
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

    el.querySelector('#cf-view-3d')?.addEventListener('click', () => {
      if (this.lastResult) SurfaceViewer3D.open(this.lastResult);
    });

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

    el.querySelector('#cf-save-layers')?.addEventListener('click', () => this.saveToLayers());
    el.querySelector('#cf-clear-data')?.addEventListener('click', () => this.clearCurrentData());
  }

  // --------------------------------------------------------------------------
  // Draw mode
  // --------------------------------------------------------------------------

  private setDrawMode(mode: 'idle' | 'drawing' | 'drawing3d' | 'pickElev'): void {
    this.drawMode = mode;
    if (!this.el) return;

    const drawBtn   = this.el.querySelector<HTMLButtonElement>('#cf-draw-btn');
    const draw3dBtn = this.el.querySelector<HTMLButtonElement>('#cf-draw3d-btn');
    const hint      = this.el.querySelector<HTMLElement>('#cf-draw-hint');
    const pickBtn   = this.el.querySelector<HTMLButtonElement>('#cf-pick-elev');
    const srcSec    = this.el.querySelector<HTMLElement>('#cf-3d-source-section');

    if (drawBtn) {
      drawBtn.textContent = mode === 'drawing' ? 'Finish' : 'Draw';
      drawBtn.classList.toggle('cf-btn-active', mode === 'drawing');
    }
    if (draw3dBtn) {
      draw3dBtn.textContent = mode === 'drawing3d' ? 'Finish' : '3D';
      draw3dBtn.classList.toggle('cf-btn-active', mode === 'drawing3d');
    }
    if (hint) {
      hint.textContent = mode === 'drawing'
        ? 'Click map to add vertices · click Finish when done'
        : mode === 'drawing3d'
        ? 'Click map to add graded vertices · click Finish when done'
        : mode === 'pickElev'
        ? 'Click any point on the map to read its elevation'
        : '';
    }
    if (pickBtn) {
      pickBtn.classList.toggle('cf-btn-active', mode === 'pickElev');
    }
    // Show the per-vertex source picker only while drawing a 3D polygon
    if (srcSec) srcSec.style.display = mode === 'drawing3d' ? 'flex' : 'none';

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
    if (!el) return;
    const areaTxt = this.vertices.length >= 3
      ? ` · ${this.formatArea(this.polygonAreaM2(this.vertices))} ground`
      : '';
    if (this.poly3D && this.vertexElev.length > 0) {
      const last = this.vertexElev[this.vertexElev.length - 1];
      const lbl = last.source === 'user'
        ? (last.value !== null && isFinite(last.value) ? `${last.value.toFixed(1)}m fixed` : 'fixed')
        : (last.value !== null && isFinite(last.value) ? `${last.value.toFixed(1)}m ground` : 'ground');
      el.textContent = `${this.vertices.length} pts · ${lbl}${areaTxt}`;
    } else {
      el.textContent = `${this.vertices.length} pts${areaTxt}`;
    }
  }

  /** Planar ground area (m²) of a lng/lat ring via an equirectangular projection. */
  private polygonAreaM2(verts: [number, number][]): number {
    if (verts.length < 3) return 0;
    const R = 6378137;
    const latRad = (verts.reduce((s, v) => s + v[1], 0) / verts.length) * Math.PI / 180;
    const mPerDegLat = (Math.PI / 180) * R;
    const mPerDegLon = mPerDegLat * Math.cos(latRad);
    const xy = verts.map(([lon, lat]) => [lon * mPerDegLon, lat * mPerDegLat]);
    let area = 0;
    for (let i = 0; i < xy.length; i++) {
      const [x1, y1] = xy[i];
      const [x2, y2] = xy[(i + 1) % xy.length];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area) / 2;
  }

  private formatArea(m2: number): string {
    return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${m2.toFixed(1)} m²`;
  }

  /** Determine the elevation source/value for a vertex being placed at lng/lat. */
  private currentVertexSource(lng: number, lat: number): { source: 'hrdem' | 'user'; value: number | null } {
    const src = this.el?.querySelector<HTMLSelectElement>('#cf-vtx-source')?.value === 'user'
      ? 'user' : 'hrdem';
    if (src === 'user') {
      const v = parseFloat(this.el?.querySelector<HTMLInputElement>('#cf-vtx-elev')?.value ?? '');
      return { source: 'user', value: isFinite(v) ? v : null };
    }
    // Ground: try to sample any loaded HRDEM for live feedback (resolved firmly at compute)
    const sample = this.sampleAnyHrdem(lng, lat);
    return { source: 'hrdem', value: sample };
  }

  /** Sample elevation from any available HRDEM source (cached or basemap). */
  private sampleAnyHrdem(lng: number, lat: number): number | null {
    const sources: Array<HRDEMResult | null> = [
      this.lastHrdem,
      this.basemapManager.getFirstHrdemResult(),
    ];
    for (const hr of sources) {
      if (!hr) continue;
      const e = sampleElevationBilinear(hr.grid, hr.width, hr.height, hr.bbox, hr.nodata, lng, lat)
            ?? sampleElevation(hr.grid, hr.width, hr.height, hr.bbox, hr.nodata, lng, lat);
      if (e !== null) return e;
    }
    return null;
  }

  /** Resolve final per-vertex elevations against the fetched reference surface. */
  private resolveVertexElevations(hrdem: HRDEMResult): number[] {
    return this.vertices.map((v, i) => {
      const meta = this.vertexElev[i];
      if (meta && meta.source === 'user' && meta.value !== null && isFinite(meta.value)) {
        return meta.value;
      }
      const e = sampleElevationBilinear(hrdem.grid, hrdem.width, hrdem.height, hrdem.bbox, hrdem.nodata, v[0], v[1])
            ?? sampleElevation(hrdem.grid, hrdem.width, hrdem.height, hrdem.bbox, hrdem.nodata, v[0], v[1]);
      // Fall back to a live sample, then to the reference minimum
      return e ?? meta?.value ?? this.sampleAnyHrdem(v[0], v[1]) ?? hrdem.elevMin;
    });
  }

  /** Relabel the elevation section to reflect flat-pad vs graded-offset semantics. */
  private updateElevLabel(): void {
    const label = this.el?.querySelector<HTMLElement>('#cf-elev-label');
    const input = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    if (label) {
      label.textContent = this.poly3D ? '3 · Vertical offset (m)' : '3 · Target elevation (m)';
    }
    if (input) {
      input.placeholder = this.poly3D ? '0  (raise / lower graded surface)' : 'e.g. 45.0';
    }
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
    // Graded (3D) pads derive their surface from per-vertex elevations, so the
    // target/offset field is optional (defaults to 0).
    btn.disabled = !hasPolygon || (!this.poly3D && !hasElev) || this.computing;
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

    const rawElev = parseFloat(elevInput?.value ?? '');
    // For a graded pad the field is a vertical offset (default 0); for a flat
    // pad it is the required target elevation.
    const targetElevation = this.poly3D ? (isFinite(rawElev) ? rawElev : 0) : rawElev;
    if ((!this.poly3D && !isFinite(targetElevation)) || this.vertices.length < 3) return;

    const slopeRatio = this.parseSlopeRatio(slopeInput?.value ?? '');

    this.computing = true;
    if (computeBtn) { computeBtn.disabled = true; computeBtn.textContent = 'Fetching…'; }

    try {
      const ring    = [...this.vertices, this.vertices[0]];
      const polygon = { type: 'Polygon' as const, coordinates: [ring] };

      const refSel   = this.el?.querySelector<HTMLSelectElement>('#cf-ref-surface');
      const refRunId = refSel?.value ?? 'hrdem';
      let hrdem: HRDEMResult;

      if (refRunId === 'hrdem') {
        const lons   = this.vertices.map(v => v[0]);
        const lats   = this.vertices.map(v => v[1]);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const padLon = (maxLon - minLon) * FETCH_PAD || 0.001;
        const padLat = (maxLat - minLat) * FETCH_PAD || 0.001;

        if (computeBtn) computeBtn.textContent = 'Fetching elevation…';

        hrdem = await fetchHRDEM(
          minLon - padLon, minLat - padLat,
          maxLon + padLon, maxLat + padLat,
          MAX_GRID_PX, MAX_GRID_PX, 'dtm',
        );
      } else {
        const refRun = CutFillRunStore.getInstance().getById(refRunId);
        if (!refRun) { throw new Error(`Reference run ${refRunId} not found`); }
        const r = refRun.result;
        hrdem = {
          grid:       r.modifiedGrid,
          width:      r.width,
          height:     r.height,
          bbox:       r.bbox,
          nodata:     r.nodata,
          elevMin:    r.stretchMin,
          elevMax:    r.stretchMax,
          stretchMin: r.stretchMin,
          stretchMax: r.stretchMax,
          validCount: r.width * r.height,
        };
      }
      this.lastHrdem = hrdem;

      if (computeBtn) computeBtn.textContent = 'Computing…';

      const vertexElevations = this.poly3D ? this.resolveVertexElevations(hrdem) : undefined;
      const result = computeCutFill(hrdem, { polygon, targetElevation, slopeRatio, vertexElevations });
      this.lastResult   = result;
      this.savedToLayers = false;
      this.daylightFC   = null; // invalidate cached daylight

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

    const rawElev = parseFloat(elevInput?.value ?? '');
    const targetElevation = this.poly3D ? (isFinite(rawElev) ? rawElev : 0) : rawElev;
    if (!this.poly3D && !isFinite(targetElevation)) return;

    const slopeRatio = this.parseSlopeRatio(slopeInput?.value ?? '');
    const ring       = [...this.vertices, this.vertices[0]];
    const polygon    = { type: 'Polygon' as const, coordinates: [ring] };

    const vertexElevations = this.poly3D ? this.resolveVertexElevations(this.lastHrdem) : undefined;
    const result       = computeCutFill(this.lastHrdem, { polygon, targetElevation, slopeRatio, vertexElevations });
    this.lastResult    = result;
    this.savedToLayers = false;
    this.daylightFC    = null;

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
      let balanced: number;
      if (this.poly3D) {
        // Search for the vertical offset that balances cut vs fill on the graded surface
        const vertexElevations = this.resolveVertexElevations(this.lastHrdem);
        const minV = Math.min(...vertexElevations);
        const maxV = Math.max(...vertexElevations);
        const bounds: [number, number] = [
          this.lastHrdem.elevMin - maxV,
          this.lastHrdem.elevMax - minV,
        ];
        balanced = findBalancedElevation(this.lastHrdem, { polygon, slopeRatio, vertexElevations }, bounds);
      } else {
        balanced = findBalancedElevation(this.lastHrdem, { polygon, slopeRatio });
      }
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
    const viewSec = this.el?.querySelector<HTMLElement>('#cf-view-section');
    if (viewSec) viewSec.style.display = 'flex';

    const fmt = (m3: number) =>
      `${m3.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`;
    const fmtArea = (m2: number) =>
      m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${m2.toFixed(0)} m²`;

    const setEl = (id: string, val: string, sub?: string) => {
      const el = this.el?.querySelector(`#${id}`);
      if (el) el.innerHTML = sub ? `${val}<span class="cf-result-sub">${sub}</span>` : val;
    };

    setEl('cf-res-cut',  fmt(result.cutVolume),  `(${fmtArea(result.cutArea)})`);
    setEl('cf-res-fill', fmt(result.fillVolume), `(${fmtArea(result.fillArea)})`);

    const net     = result.fillVolume - result.cutVolume;
    const netSign = net >= 0 ? '+' : '';
    setEl('cf-res-net', `${netSign}${fmt(Math.abs(net))}`, net >= 0 ? '(net fill)' : '(net cut)');

    const netBox = this.el?.querySelector<HTMLElement>('#cf-res-net-box');
    netBox?.classList.toggle('cf-net-fill', net >= 0);
    netBox?.classList.toggle('cf-net-cut', net < 0);
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

  private saveToLayers(): void {
    if (!this.lastResult || !this.lastHrdem) return;
    const elevInput  = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    const slopeInput = this.el?.querySelector<HTMLInputElement>('#cf-slope');
    const targetElevation = parseFloat(elevInput?.value ?? '');
    if (!isFinite(targetElevation)) return;
    const slopeRatio = this.parseSlopeRatio(slopeInput?.value ?? '');
    const ring    = [...this.vertices, this.vertices[0]];
    const polygon = { type: 'Polygon' as const, coordinates: [ring] };

    CutFillRunStore.getInstance().addRun({
      result:     this.lastResult,
      hrdem:      this.lastHrdem,
      daylightFC: this.daylightFC,
      params:     { targetElevation, slopeRatio, polygon },
    });
    this.savedToLayers = true;

    const btn = this.el?.querySelector<HTMLButtonElement>('#cf-save-layers');
    if (btn) {
      const orig = btn.textContent ?? 'Save to Layer Manager';
      btn.textContent = 'Saved!';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }
  }

  private clearCurrentData(): void {
    if (!this.lastResult) return;

    if (!this.savedToLayers) {
      const confirmed = window.confirm(
        'This result has not been saved to the Layer Manager.\nClear anyway?'
      );
      if (!confirmed) return;
    }

    this.lastResult    = null;
    this.lastHrdem     = null;
    this.daylightFC    = null;
    this.savedToLayers = false;
    this.hillshadeOn   = false;
    this.contoursOn    = false;
    this.daylightOn    = false;

    this.cutFillLayer.clear();

    const viewSecEl  = this.el?.querySelector<HTMLElement>('#cf-view-section');
    if (viewSecEl)  viewSecEl.style.display  = 'none';

    // Reset the result cards to their empty state (card stays visible)
    ['cf-res-cut', 'cf-res-fill', 'cf-res-net'].forEach(id => {
      const el = this.el?.querySelector(`#${id}`);
      if (el) el.textContent = '—';
    });
    const netBox = this.el?.querySelector<HTMLElement>('#cf-res-net-box');
    netBox?.classList.remove('cf-net-fill', 'cf-net-cut');

    this.updateComputeBtn();
    this.syncDisplayState();
  }

  // ── Freehand polygon drawing ──────────────────────────────────────────────

  private startFreehand(): void {
    this.freehandActive = true;
    const map    = this.mapManager.getMap();
    const canvas = map.getCanvas();
    map.dragPan.disable();
    canvas.style.cursor = 'crosshair';
    this.syncFreehandBtn();

    let collecting = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      collecting = true;
      const r  = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      this.vertices = [[ll.lng, ll.lat]];
    };

    const onMove = (e: PointerEvent) => {
      if (!collecting || !(e.buttons & 1)) return;
      e.preventDefault();
      const r  = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      this.vertices.push([ll.lng, ll.lat]);
      this.updateSketchPreview();
    };

    const onUp = () => {
      if (!collecting) return;
      collecting = false;
      this.vertices = this.minSpacingFilter(this.vertices, 5);
      this.stopFreehand();
      this.updateSketchPreview();
      this.updateVertexCount();
      this.updateComputeBtn();
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup',   onUp);
    canvas.addEventListener('pointercancel', onUp);

    this.freehandCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup',   onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }

  private stopFreehand(): void {
    if (!this.freehandActive) return;
    this.freehandActive = false;
    this.freehandCleanup?.();
    this.freehandCleanup = null;
    const map = this.mapManager.getMap();
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    this.syncFreehandBtn();
  }

  private syncFreehandBtn(): void {
    const btn = this.el?.querySelector<HTMLButtonElement>('#cf-freehand-btn');
    if (btn) btn.classList.toggle('cf-btn-active', this.freehandActive);
  }

  private minSpacingFilter(pts: [number, number][], toleranceM: number): [number, number][] {
    if (pts.length < 2) return pts;
    const tolDeg = toleranceM / 111320;
    const result: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = result[result.length - 1];
      const dx = pts[i][0] - prev[0], dy = pts[i][1] - prev[1];
      if (Math.sqrt(dx * dx + dy * dy) >= tolDeg) result.push(pts[i]);
    }
    return result;
  }

  private refreshRefSurface(): void {
    const sel = this.el?.querySelector<HTMLSelectElement>('#cf-ref-surface');
    if (!sel) return;
    const current = sel.value;
    const runs = CutFillRunStore.getInstance().getRuns();
    const runOpts = runs.map(r =>
      `<option value="${r.id}">${r.name} (elev ${r.params.targetElevation.toFixed(1)}m)</option>`
    ).join('');
    sel.innerHTML = `<option value="hrdem">HRDEM (live data)</option>${runOpts}`;
    if (current !== 'hrdem' && runs.find(r => r.id === current)) sel.value = current;
  }
}
