/**
 * Cut / Fill Tool panel.
 *
 * Floating HUD that lets the user:
 *   1. Draw a polygon footprint on the map
 *   2. Enter a target elevation and optional side-slope ratio
 *   3. Compute a modified DTM surface and view volumes/areas
 *   4. Export the result as a GeoTIFF or as contour GeoJSON
 *
 * Map click interception:
 *   Call handleMapClick(lng, lat) from App.ts wire-map-interactions.
 *   Returns true if the click was consumed (panel is in draw / pick mode).
 */

import type { MapManager } from '../map/MapManager';
import type { BasemapManager } from '../map/BasemapManager';
import { CutFillLayer } from '../map/CutFillLayer';
import { computeCutFill, sampleElevation, type CutFillResult } from '../lib/cutFillEngine';
import { exportGeoTIFF } from '../lib/geotiffExporter';
import { fetchHRDEM } from '../lib/hrdemWCS';

// Padding fraction applied to polygon bbox before fetching HRDEM
const FETCH_PAD = 0.5;
// Maximum grid dimension for the cut/fill fetch
const MAX_GRID_PX = 512;

export class CutFillPanel {
  private el: HTMLElement | null = null;
  private visible = false;

  // draw-polygon state
  private drawMode: 'idle' | 'drawing' | 'pickElev' = 'idle';
  private vertices: [number, number][] = [];

  private cutFillLayer: CutFillLayer;
  private lastResult: CutFillResult | null = null;
  private computing = false;

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
    if (this.el) {
      this.el.style.display = 'none';
    }
  }

  toggle(): void {
    this.visible ? this.close() : this.open();
  }

  isOpen(): boolean { return this.visible; }

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
      const hrdem = this.basemapManager.getFirstHrdemResult();
      let elev: number | null = null;
      if (hrdem) {
        elev = sampleElevation(hrdem.grid, hrdem.width, hrdem.height, hrdem.bbox, hrdem.nodata, lng, lat);
      }
      if (elev !== null) {
        const input = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
        if (input) input.value = elev.toFixed(2);
      }
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
        <div class="cf-hint" id="cf-draw-hint">Click Draw, then click on the map</div>
      </div>

      <div class="cf-section">
        <div class="cf-label">2 · Target elevation (m)</div>
        <div class="cf-row">
          <input type="number" id="cf-target-elev" class="cf-input" step="0.1" placeholder="e.g. 45.0">
          <button class="cf-btn cf-btn-sm" id="cf-pick-elev" title="Click map to read elevation">⊕ Pick</button>
        </div>
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
          <button class="cf-btn" id="cf-view-diff">Cut/Fill</button>
        </div>
        <div class="cf-label cf-label-mt">Contours</div>
        <div class="cf-row">
          <input type="number" id="cf-contour-interval" class="cf-input" style="width:60px" value="1" min="0.1" step="0.5">
          <span class="cf-hint">m</span>
          <button class="cf-btn cf-btn-sm" id="cf-contour-toggle">Show</button>
        </div>
        <div class="cf-row cf-export-row">
          <button class="cf-btn cf-btn-sm" id="cf-export-tiff">↓ GeoTIFF</button>
          <button class="cf-btn cf-btn-sm" id="cf-export-contour">↓ Contours</button>
        </div>
      </div>
    `;

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
        // Second click on Draw = finish polygon
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

    el.querySelector('#cf-target-elev')?.addEventListener('input', () => this.updateComputeBtn());
    el.querySelector('#cf-slope')?.addEventListener('input',       () => this.updateComputeBtn());

    el.querySelector('#cf-compute')?.addEventListener('click', () => void this.runCompute());

    el.querySelector('#cf-view-elev')?.addEventListener('click', () => this.switchView('elevation'));
    el.querySelector('#cf-view-diff')?.addEventListener('click', () => this.switchView('diff'));

    const contourToggle = el.querySelector('#cf-contour-toggle');
    let contoursOn = false;
    contourToggle?.addEventListener('click', () => {
      if (!this.lastResult) return;
      contoursOn = !contoursOn;
      if (contoursOn) {
        const iv = parseFloat((el.querySelector('#cf-contour-interval') as HTMLInputElement).value) || 1;
        this.cutFillLayer.updateContours(this.lastResult, iv);
        (contourToggle as HTMLButtonElement).textContent = 'Hide';
        (contourToggle as HTMLButtonElement).classList.add('cf-btn-active');
      } else {
        this.cutFillLayer.setContoursVisible(false);
        (contourToggle as HTMLButtonElement).textContent = 'Show';
        (contourToggle as HTMLButtonElement).classList.remove('cf-btn-active');
      }
    });

    el.querySelector('#cf-contour-interval')?.addEventListener('change', () => {
      if (!this.lastResult || !contoursOn) return;
      const iv = parseFloat((el.querySelector('#cf-contour-interval') as HTMLInputElement).value) || 1;
      this.cutFillLayer.updateContours(this.lastResult, iv);
    });

    el.querySelector('#cf-export-tiff')?.addEventListener('click', () => {
      if (this.lastResult) exportGeoTIFF(this.lastResult, 'cutfill_surface.tif');
    });

    el.querySelector('#cf-export-contour')?.addEventListener('click', () => {
      if (!this.lastResult) return;
      const iv = parseFloat((el.querySelector('#cf-contour-interval') as HTMLInputElement)?.value) || 1;
      this.cutFillLayer.exportContourGeoJSON(this.lastResult, iv);
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
        ? 'Click map to add vertices · click Draw again to finish'
        : mode === 'pickElev'
        ? 'Click any point on the map to read its elevation'
        : '';
    }
    if (pickBtn) {
      pickBtn.classList.toggle('cf-btn-active', mode === 'pickElev');
    }

    // Update map cursor
    const canvas = this.mapManager.getMap().getCanvas();
    canvas.style.cursor = mode !== 'idle' ? 'crosshair' : '';
  }

  private stopDrawing(): void {
    this.setDrawMode('idle');
    this.mapManager.clearSketchPreview();
    const canvas = this.mapManager.getMap().getCanvas();
    canvas.style.cursor = '';
  }

  private updateVertexCount(): void {
    const el = this.el?.querySelector('#cf-vtx-count');
    if (el) el.textContent = `${this.vertices.length} pts`;
  }

  private updateSketchPreview(): void {
    const verts = this.vertices;
    if (verts.length === 0) {
      this.mapManager.clearSketchPreview();
      return;
    }
    const features: object[] = [];
    if (verts.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: verts.length >= 3
          ? [...verts, verts[0]]
          : verts },
        properties: {},
      });
    }
    verts.forEach(v => features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: v }, properties: {},
    }));
    this.mapManager.updateSketchPreview(features);
  }

  private updateComputeBtn(): void {
    const btn = this.el?.querySelector<HTMLButtonElement>('#cf-compute');
    if (!btn) return;
    const elevInput = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    const hasElev   = elevInput && elevInput.value.trim() !== '' && isFinite(parseFloat(elevInput.value));
    const hasPolygon = this.vertices.length >= 3;
    btn.disabled = !hasElev || !hasPolygon || this.computing;
  }

  // --------------------------------------------------------------------------
  // Computation
  // --------------------------------------------------------------------------

  private async runCompute(): Promise<void> {
    if (this.computing) return;
    const elevInput  = this.el?.querySelector<HTMLInputElement>('#cf-target-elev');
    const slopeInput = this.el?.querySelector<HTMLInputElement>('#cf-slope');
    const computeBtn = this.el?.querySelector<HTMLButtonElement>('#cf-compute');

    const targetElevation = parseFloat(elevInput?.value ?? '');
    if (!isFinite(targetElevation) || this.vertices.length < 3) return;

    const slopeStr  = slopeInput?.value?.trim() ?? '';
    const slopeRatio = slopeStr !== '' && isFinite(parseFloat(slopeStr)) && parseFloat(slopeStr) > 0
      ? parseFloat(slopeStr)
      : null;

    this.computing = true;
    if (computeBtn) { computeBtn.disabled = true; computeBtn.textContent = 'Computing…'; }

    try {
      // Build polygon
      const ring   = [...this.vertices, this.vertices[0]]; // close ring
      const polygon = { type: 'Polygon' as const, coordinates: [ring] };

      // Compute bounding box + padding
      const lons = this.vertices.map(v => v[0]);
      const lats = this.vertices.map(v => v[1]);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const padLon = (maxLon - minLon) * FETCH_PAD || 0.001;
      const padLat = (maxLat - minLat) * FETCH_PAD || 0.001;
      const west  = minLon - padLon;
      const east  = maxLon + padLon;
      const south = minLat - padLat;
      const north = maxLat + padLat;

      // Fetch HRDEM for the padded extent
      const hrdem = await fetchHRDEM(west, south, east, north, MAX_GRID_PX, MAX_GRID_PX, 'dtm');

      // Run the cut/fill algorithm
      const result = computeCutFill(hrdem, { polygon, targetElevation, slopeRatio });
      this.lastResult = result;

      // Show on map
      this.cutFillLayer.show(result);
      this.mapManager.clearSketchPreview();

      // Update results UI
      this.showResults(result);

    } catch (err) {
      console.error('[CutFillPanel] compute failed:', err);
      if (computeBtn) computeBtn.textContent = 'Error — try again';
      setTimeout(() => {
        if (computeBtn) { computeBtn.textContent = 'Compute Cut / Fill'; computeBtn.disabled = false; }
      }, 3000);
    } finally {
      this.computing = false;
      if (computeBtn) { computeBtn.textContent = 'Compute Cut / Fill'; computeBtn.disabled = false; }
    }
  }

  // --------------------------------------------------------------------------
  // Results display
  // --------------------------------------------------------------------------

  private showResults(result: CutFillResult): void {
    const section = this.el?.querySelector<HTMLElement>('#cf-results');
    const viewSec = this.el?.querySelector<HTMLElement>('#cf-view-section');
    if (section) section.style.display = 'block';
    if (viewSec) viewSec.style.display = 'block';

    const fmt = (m3: number) => {
      const ha = m3 / 10000;
      return `${m3 >= 1000 ? (m3 / 1000).toFixed(2) + ' km³' : m3.toFixed(0) + ' m³'}`;
    };
    const fmtArea = (m2: number) =>
      m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${m2.toFixed(0)} m²`;

    const setEl = (id: string, val: string) => {
      const el = this.el?.querySelector(`#${id}`);
      if (el) el.textContent = val;
    };

    setEl('cf-res-cut',  `${fmt(result.cutVolume)}  (${fmtArea(result.cutArea)})`);
    setEl('cf-res-fill', `${fmt(result.fillVolume)}  (${fmtArea(result.fillArea)})`);

    const net = result.fillVolume - result.cutVolume;
    const netSign = net >= 0 ? '+' : '';
    setEl('cf-res-net', `${netSign}${fmt(Math.abs(net))} ${net >= 0 ? '(net fill)' : '(net cut)'}`);
  }

  private switchView(mode: 'elevation' | 'diff'): void {
    if (!this.lastResult) return;

    if (mode === 'diff') {
      this.cutFillLayer.showDiff(this.lastResult);
    } else {
      this.cutFillLayer.show(this.lastResult);
    }
    this.cutFillLayer.setView(mode);

    const elevBtn = this.el?.querySelector<HTMLButtonElement>('#cf-view-elev');
    const diffBtn = this.el?.querySelector<HTMLButtonElement>('#cf-view-diff');
    elevBtn?.classList.toggle('cf-btn-active', mode === 'elevation');
    diffBtn?.classList.toggle('cf-btn-active', mode === 'diff');
  }
}
