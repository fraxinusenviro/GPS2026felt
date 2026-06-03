/**
 * Elevation Profile Panel.
 *
 * Draws a line on the map and plots an elevation profile chart comparing:
 *   - Original DTM (from HRDEM WCS or the cut/fill's originalGrid)
 *   - Modified Cut/Fill surface (if a cut/fill result is active)
 *
 * Data priority:
 *   1. If a cut/fill result is available AND the profile line is within its
 *      bbox, sample both originalGrid and modifiedGrid directly (no extra fetch).
 *   2. Otherwise fetch HRDEM for the profile line extent and show DTM only
 *      (plus cut/fill surface if the profile is partially within its bbox).
 */

import type { MapManager }     from '../map/MapManager';
import type { BasemapManager } from '../map/BasemapManager';
import type { CutFillResult }  from '../lib/cutFillEngine';
import { sampleElevationBilinear }      from '../lib/cutFillEngine';
import { fetchHRDEM }                   from '../lib/hrdemWCS';

interface ProfileSample {
  distM:   number;
  dtm:     number | null;
  cutfill: number | null;
}

const N_SAMPLES    = 256;   // profile resolution
const FETCH_PAD    = 0.15;  // fraction of line bbox to pad before fetch
const MAX_FETCH_PX = 256;   // HRDEM fetch resolution

// Chart layout constants (pixels, within the canvas element)
const ML = 44, MR = 10, MT = 14, MB = 28; // margins: left, right, top, bottom

export class ProfilePanel {
  private el:          HTMLElement | null = null;
  private visible      = false;
  private drawMode:    'idle' | 'drawing' = 'idle';
  private vertices:    [number, number][] = [];
  private samples:     ProfileSample[] | null = null;
  private hoverIdx:    number | null = null;
  private loading      = false;

  constructor(
    private readonly mapManager:      MapManager,
    private readonly basemapManager:  BasemapManager,
    private readonly getCutFillResult: () => CutFillResult | null,
  ) {}

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

  // --------------------------------------------------------------------------
  // Map click interception
  // --------------------------------------------------------------------------

  handleMapClick(lng: number, lat: number): boolean {
    if (!this.visible || this.drawMode !== 'drawing') return false;
    this.vertices.push([lng, lat]);
    this.updatePreview();
    if (this.vertices.length >= 2) void this.buildProfile();
    return true;
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  private render(): void {
    let el = document.getElementById('profile-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'profile-panel';
      el.className = 'pf-panel';
      document.getElementById('map-container')?.appendChild(el);
    }
    this.el = el;

    el.innerHTML = `
      <div class="pf-header">
        <span class="pf-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 17 9 11 13 15 21 7"/>
          </svg>
          Elevation Profile
        </span>
        <button class="cf-close" id="pf-close">✕</button>
      </div>

      <div class="pf-controls">
        <button class="cf-btn" id="pf-draw-btn">Draw Line</button>
        <button class="cf-btn cf-btn-sm" id="pf-undo-btn" title="Remove last vertex">↩</button>
        <button class="cf-btn cf-btn-sm" id="pf-clear-btn">Clear</button>
        <span class="cf-hint" id="pf-vtx-count"></span>
      </div>
      <div class="cf-hint" id="pf-hint" style="padding:0 10px 4px"></div>

      <div class="pf-chart-wrap">
        <canvas id="pf-canvas" class="pf-canvas" width="320" height="170"></canvas>
        <div class="pf-loading" id="pf-loading" style="display:none">Loading…</div>
      </div>

      <div class="pf-legend" id="pf-legend" style="display:none">
        <span class="pf-leg-item pf-leg-dtm">— DTM</span>
        <span class="pf-leg-item pf-leg-cf" id="pf-leg-cf" style="display:none">— Cut / Fill</span>
        <button class="cf-btn cf-btn-sm" id="pf-export-csv" style="margin-left:auto">↓ CSV</button>
      </div>
    `;

    this.wireEvents();
    el.style.display = 'flex';
    // Draw blank chart
    this.drawChart(null, null);
  }

  // --------------------------------------------------------------------------
  // Event wiring
  // --------------------------------------------------------------------------

  private wireEvents(): void {
    const el = this.el!;

    el.querySelector('#pf-close')?.addEventListener('click', () => this.close());

    el.querySelector('#pf-draw-btn')?.addEventListener('click', () => {
      if (this.drawMode === 'drawing') {
        this.setDrawMode('idle');
      } else {
        this.setDrawMode('drawing');
      }
    });

    el.querySelector('#pf-undo-btn')?.addEventListener('click', () => {
      if (this.vertices.length > 0) {
        this.vertices.pop();
        this.updatePreview();
        if (this.vertices.length >= 2) void this.buildProfile();
        else { this.samples = null; this.drawChart(null, null); }
      }
    });

    el.querySelector('#pf-clear-btn')?.addEventListener('click', () => {
      this.vertices = [];
      this.samples  = null;
      this.setDrawMode('idle');
      this.updatePreview();
      this.drawChart(null, null);
      const legend = el.querySelector<HTMLElement>('#pf-legend');
      if (legend) legend.style.display = 'none';
    });

    el.querySelector('#pf-export-csv')?.addEventListener('click', () => this.exportCSV());

    const canvas = el.querySelector<HTMLCanvasElement>('#pf-canvas');
    canvas?.addEventListener('mousemove', (e) => {
      if (!this.samples) return;
      const rect = canvas.getBoundingClientRect();
      const chartW = canvas.width  - ML - MR;
      const px = (e.clientX - rect.left) * (canvas.width / rect.width) - ML;
      const idx = Math.round(px / chartW * (this.samples.length - 1));
      this.hoverIdx = Math.max(0, Math.min(this.samples.length - 1, idx));
      this.drawChart(this.samples, this.hoverIdx);
    });

    canvas?.addEventListener('mouseleave', () => {
      if (this.samples) {
        this.hoverIdx = null;
        this.drawChart(this.samples, null);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Draw mode
  // --------------------------------------------------------------------------

  private setDrawMode(mode: 'idle' | 'drawing'): void {
    this.drawMode = mode;
    if (!this.el) return;

    const drawBtn = this.el.querySelector<HTMLButtonElement>('#pf-draw-btn');
    const hint    = this.el.querySelector<HTMLElement>('#pf-hint');

    if (drawBtn) {
      drawBtn.textContent = mode === 'drawing' ? 'End Line' : 'Draw Line';
      drawBtn.classList.toggle('cf-btn-active', mode === 'drawing');
    }
    if (hint) {
      hint.textContent = mode === 'drawing'
        ? 'Click map to add vertices; click End Line when done'
        : '';
    }

    const canvas = this.mapManager.getMap().getCanvas();
    canvas.style.cursor = mode === 'drawing' ? 'crosshair' : '';
  }

  private stopDrawing(): void {
    this.setDrawMode('idle');
    this.mapManager.clearSketchPreview();
    this.mapManager.getMap().getCanvas().style.cursor = '';
  }

  private updatePreview(): void {
    const verts = this.vertices;
    if (verts.length === 0) { this.mapManager.clearSketchPreview(); return; }
    const features: object[] = [];
    if (verts.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: verts }, properties: {} });
    }
    verts.forEach(v => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: v }, properties: {} }));
    this.mapManager.updateSketchPreview(features);

    const cnt = this.el?.querySelector('#pf-vtx-count');
    if (cnt) cnt.textContent = `${verts.length} pts`;
  }

  // --------------------------------------------------------------------------
  // Build profile data
  // --------------------------------------------------------------------------

  private async buildProfile(): Promise<void> {
    if (this.vertices.length < 2) return;

    const cfResult   = this.getCutFillResult();
    const lineBbox   = this.getLineBbox();

    let dtmGrid:    Float32Array | null = null;
    let cfGrid:     Float32Array | null = null;
    let gridWidth   = 0, gridHeight = 0;
    let gridBbox:   [number, number, number, number] = [0, 0, 0, 0];
    let gridNodata: number | null = null;

    // Case 1: cut/fill result covers the profile line — use its grids directly
    if (cfResult && this.bboxContains(cfResult.bbox, lineBbox)) {
      dtmGrid    = cfResult.originalGrid;
      cfGrid     = cfResult.modifiedGrid;
      gridWidth  = cfResult.width;
      gridHeight = cfResult.height;
      gridBbox   = cfResult.bbox;
      gridNodata = cfResult.nodata;

    } else {
      // Case 2: fetch HRDEM for the profile extent
      const [west, south, east, north] = lineBbox;
      const dLon = Math.max((east - west)   * FETCH_PAD, 0.001);
      const dLat = Math.max((north - south) * FETCH_PAD, 0.001);

      this.setLoading(true);
      try {
        const hrdem = await fetchHRDEM(
          west - dLon, south - dLat, east + dLon, north + dLat,
          MAX_FETCH_PX, MAX_FETCH_PX, 'dtm',
        );
        dtmGrid    = hrdem.grid;
        gridWidth  = hrdem.width;
        gridHeight = hrdem.height;
        gridBbox   = hrdem.bbox;
        gridNodata = hrdem.nodata;

        // Also sample cut/fill if the line overlaps its bbox
        if (cfResult) cfGrid = cfResult.modifiedGrid;
      } catch (err) {
        console.error('[ProfilePanel] HRDEM fetch failed:', err);
        this.setLoading(false);
        return;
      }
      this.setLoading(false);
    }

    // Sample N equally-spaced points along the line
    const points = this.sampleLinePoints(this.vertices, N_SAMPLES);

    this.samples = points.map(({ lon, lat, distM }) => {
      const dtm = dtmGrid
        ? sampleElevationBilinear(dtmGrid, gridWidth, gridHeight, gridBbox, gridNodata, lon, lat)
        : null;

      // For cfGrid, use cfResult dimensions if they differ from dtmGrid's
      let cf: number | null = null;
      if (cfGrid && cfResult) {
        cf = sampleElevationBilinear(
          cfGrid, cfResult.width, cfResult.height, cfResult.bbox, cfResult.nodata, lon, lat,
        );
      }

      return { distM, dtm, cutfill: cf };
    });

    const hasCf = this.samples.some(s => s.cutfill !== null);
    const legend  = this.el?.querySelector<HTMLElement>('#pf-legend');
    const cfLegEl = this.el?.querySelector<HTMLElement>('#pf-leg-cf');
    if (legend) legend.style.display = 'flex';
    if (cfLegEl) cfLegEl.style.display = hasCf ? 'inline' : 'none';

    this.drawChart(this.samples, this.hoverIdx);
  }

  // --------------------------------------------------------------------------
  // Chart rendering
  // --------------------------------------------------------------------------

  private drawChart(samples: ProfileSample[] | null, hoverIdx: number | null): void {
    const canvas = this.el?.querySelector<HTMLCanvasElement>('#pf-canvas');
    if (!canvas) return;
    const ctx   = canvas.getContext('2d')!;
    const W     = canvas.width;
    const H     = canvas.height;
    const cw    = W - ML - MR; // chart plot width
    const ch    = H - MT - MB; // chart plot height

    // Background
    ctx.fillStyle = '#13231a';
    ctx.fillRect(0, 0, W, H);

    if (!samples || samples.length === 0) {
      ctx.fillStyle = '#4a6a5a';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Draw a line on the map to see the profile', W / 2, H / 2);
      return;
    }

    // Compute extents
    const totalDist = samples[samples.length - 1].distM;
    let yMin = Infinity, yMax = -Infinity;
    for (const s of samples) {
      if (s.dtm     !== null) { yMin = Math.min(yMin, s.dtm);     yMax = Math.max(yMax, s.dtm); }
      if (s.cutfill !== null) { yMin = Math.min(yMin, s.cutfill); yMax = Math.max(yMax, s.cutfill); }
    }
    if (!isFinite(yMin)) { yMin = 0; yMax = 10; }
    const yRange = Math.max(yMax - yMin, 0.1);
    yMin -= yRange * 0.08;
    yMax += yRange * 0.08;
    const ySpan = yMax - yMin;

    const xPx = (d: number) => ML + (d / totalDist) * cw;
    const yPx = (e: number) => MT + (1 - (e - yMin) / ySpan) * ch;

    // Grid lines
    ctx.strokeStyle = 'rgba(74,222,128,0.08)';
    ctx.lineWidth   = 0.5;
    const nYGrid = 4;
    for (let i = 0; i <= nYGrid; i++) {
      const y = MT + (i / nYGrid) * ch;
      ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + cw, y); ctx.stroke();
    }
    const nXGrid = 4;
    for (let i = 0; i <= nXGrid; i++) {
      const x = ML + (i / nXGrid) * cw;
      ctx.beginPath(); ctx.moveTo(x, MT); ctx.lineTo(x, MT + ch); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(74,222,128,0.3)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(ML, MT, cw, ch);

    // Y-axis labels
    ctx.fillStyle  = '#94a3b8';
    ctx.font       = '9px sans-serif';
    ctx.textAlign  = 'right';
    for (let i = 0; i <= nYGrid; i++) {
      const elev = yMax - (i / nYGrid) * ySpan;
      ctx.fillText(elev.toFixed(1), ML - 3, MT + (i / nYGrid) * ch + 3);
    }
    // Y label
    ctx.save();
    ctx.translate(9, MT + ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b8a7a';
    ctx.fillText('Elev (m)', 0, 0);
    ctx.restore();

    // X-axis labels
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    for (let i = 0; i <= nXGrid; i++) {
      const dist = (i / nXGrid) * totalDist;
      const label = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;
      ctx.fillText(label, ML + (i / nXGrid) * cw, H - 5);
    }

    // Cut/fill shading between DTM and cut/fill surface
    if (samples.some(s => s.dtm !== null && s.cutfill !== null)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ML, MT, cw, ch);
      ctx.clip();

      // Two separate passes: fill area (cf > dtm), cut area (cf < dtm)
      for (let si = 0; si < samples.length - 1; si++) {
        const a = samples[si], b = samples[si + 1];
        if (a.dtm === null || b.dtm === null || a.cutfill === null || b.cutfill === null) continue;

        const ax = xPx(a.distM), bx = xPx(b.distM);
        const adtm = yPx(a.dtm), bdtm = yPx(b.dtm);
        const acf  = yPx(a.cutfill), bcf  = yPx(b.cutfill);

        // Determine sign of the gap
        const aNet = a.cutfill - a.dtm, bNet = b.cutfill - b.dtm;
        const isFill = aNet >= 0 && bNet >= 0;
        const isCut  = aNet <= 0 && bNet <= 0;

        ctx.fillStyle = isFill ? 'rgba(251,146,60,0.18)' : isCut ? 'rgba(96,165,250,0.18)' : 'rgba(180,180,180,0.06)';
        ctx.beginPath();
        ctx.moveTo(ax, adtm); ctx.lineTo(bx, bdtm);
        ctx.lineTo(bx, bcf);  ctx.lineTo(ax, acf);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw DTM line
    ctx.save();
    ctx.beginPath();
    ctx.rect(ML, MT, cw, ch);
    ctx.clip();

    const drawLine = (getValue: (s: ProfileSample) => number | null, color: string, lw: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      let penDown = false;
      for (const s of samples) {
        const e = getValue(s);
        if (e === null) { penDown = false; continue; }
        const x = xPx(s.distM), y = yPx(e);
        if (!penDown) { ctx.moveTo(x, y); penDown = true; }
        else          ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine(s => s.dtm,     '#60a5fa', 1.5);
    drawLine(s => s.cutfill, '#fb923c', 1.5);

    ctx.restore();

    // Hover indicator
    if (hoverIdx !== null && hoverIdx < samples.length) {
      const s  = samples[hoverIdx];
      const hx = xPx(s.distM);

      // Vertical line
      ctx.save();
      ctx.beginPath();
      ctx.rect(ML, MT, cw, ch);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, MT);
      ctx.lineTo(hx, MT + ch);
      ctx.stroke();
      ctx.restore();

      // Tooltip
      const distLabel = s.distM >= 1000
        ? `${(s.distM / 1000).toFixed(3)} km`
        : `${s.distM.toFixed(1)} m`;
      const lines: string[] = [`d: ${distLabel}`];
      if (s.dtm     !== null) lines.push(`DTM: ${s.dtm.toFixed(2)} m`);
      if (s.cutfill !== null) lines.push(`C/F: ${s.cutfill.toFixed(2)} m`);

      const pad = 4, lh = 12;
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
      const th = lines.length * lh + pad * 2;
      let tx = hx + 6;
      if (tx + tw > ML + cw) tx = hx - tw - 4;
      const ty = MT + 4;

      ctx.fillStyle   = 'rgba(18,35,26,0.88)';
      ctx.strokeStyle = 'rgba(74,222,128,0.4)';
      ctx.lineWidth   = 0.7;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#d1fae5';
      ctx.font      = '9px sans-serif';
      ctx.textAlign = 'left';
      lines.forEach((l, i) => ctx.fillText(l, tx + pad, ty + pad + (i + 1) * lh - 2));
    }
  }

  // --------------------------------------------------------------------------
  // CSV export
  // --------------------------------------------------------------------------

  private exportCSV(): void {
    if (!this.samples) return;
    const rows = ['distance_m,dtm_m,cutfill_m'];
    for (const s of this.samples) {
      rows.push(`${s.distM.toFixed(3)},${s.dtm?.toFixed(3) ?? ''},${s.cutfill?.toFixed(3) ?? ''}`);
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'elevation_profile.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private setLoading(on: boolean): void {
    this.loading = on;
    const el = this.el?.querySelector<HTMLElement>('#pf-loading');
    if (el) el.style.display = on ? 'flex' : 'none';
  }

  private getLineBbox(): [number, number, number, number] {
    const lons = this.vertices.map(v => v[0]);
    const lats = this.vertices.map(v => v[1]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }

  /** True if `outer` fully contains `inner`. */
  private bboxContains(
    outer: [number, number, number, number],
    inner: [number, number, number, number],
  ): boolean {
    return inner[0] >= outer[0] && inner[1] >= outer[1] &&
           inner[2] <= outer[2] && inner[3] <= outer[3];
  }

  /**
   * Return N equally-spaced sample points along a LineString.
   * Uses haversine for accurate arc-length parameterisation.
   */
  private sampleLinePoints(
    verts: [number, number][],
    nSamples: number,
  ): { lon: number; lat: number; distM: number }[] {
    if (verts.length < 2) return [];

    const cumDist: number[] = [0];
    for (let i = 1; i < verts.length; i++) {
      cumDist.push(cumDist[i - 1] + haversineM(verts[i - 1], verts[i]));
    }
    const total = cumDist[cumDist.length - 1];

    const result: { lon: number; lat: number; distM: number }[] = [];
    for (let s = 0; s < nSamples; s++) {
      const t     = s / (nSamples - 1);
      const distM = t * total;

      let si = cumDist.findIndex((d, i) => i > 0 && d >= distM) - 1;
      if (si < 0) si = verts.length - 2;
      si = Math.max(0, Math.min(verts.length - 2, si));

      const segLen = cumDist[si + 1] - cumDist[si];
      const frac   = segLen > 0 ? (distM - cumDist[si]) / segLen : 0;

      result.push({
        lon:   verts[si][0] + (verts[si + 1][0] - verts[si][0]) * frac,
        lat:   verts[si][1] + (verts[si + 1][1] - verts[si][1]) * frac,
        distM,
      });
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Haversine distance in metres
// ---------------------------------------------------------------------------

function haversineM([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const R    = 6371000;
  const dlat = (lat2 - lat1) * Math.PI / 180;
  const dlon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dlat / 2) ** 2
              + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
