/**
 * HRDEM elevation layer for MapLibre.
 *
 * Follows the same activate / deactivate lifecycle as NSPRDVectorLayer and
 * NSHNVectorLayer so it integrates seamlessly with BasemapManager's
 * rebuildMap() loop.
 *
 * Layer / source naming deliberately mirrors the raster-overlay convention
 * (bm-ov-{iid} / bmsrc-{iid}) so that all existing wireContent() handlers
 * for opacity sliders, visibility toggles, and image-adjustment sliders
 * work on this layer without modification.
 */

import maplibregl from 'maplibre-gl';
import type { MapManager } from './MapManager';
import { fetchHRDEM, type HRDEMResult } from '../lib/hrdemWCS';
import {
  renderElevation,
  renderGrid,
  renderAspect,
  rampToGradient,
  invertRamp,
  HRDEM_RAMPS,
  SLOPE_RAMP,
  TPI_RAMP,
  type ColorRamp,
} from '../lib/elevationRenderer';
import { generateContours } from '../lib/contourGenerator';
import { computeSlope, computeAspect, computeTPI } from '../lib/demProducts';
import { LAYER_IDS } from '../constants';

const DEBOUNCE_MS = 300;
const MIN_ZOOM    = 10;

// 1×1 transparent PNG — used as the initial image source placeholder
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export type HRDEMProduct = 'elevation' | 'slope' | 'aspect' | 'tpi';

export class HRDEMLayer {
  // Stable across activate/deactivate cycles so canvas data survives rebuildMap()
  private readonly canvas = document.createElement('canvas');
  private ramp: ColorRamp = HRDEM_RAMPS['terrain'].ramp;

  // Last fetched result — re-rendered immediately on ramp/product changes (no re-fetch needed)
  private lastResult: HRDEMResult | null = null;

  // Last fetched coordinates — restored on re-activate to avoid a blank flash
  private lastCoords: [[number,number],[number,number],[number,number],[number,number]] = [
    [-180, 85], [180, 85], [180, -85], [-180, -85],
  ];
  private canvasHasData = false;

  // Tracks the opacity the caller wants; used to restore after the zoom-guard zeroes it
  private intendedOpacity = 1;

  // Visibility state — tracked internally so each sublayer can be controlled independently
  private layerVisible  = true;  // main eye-icon toggle
  private rasterVisible = true;  // "Show raster" checkbox in adj panel

  // Display product
  private hrdemProduct: HRDEMProduct = 'elevation';

  // Contour state
  private contourEnabled  = false;
  private contourInterval = 10;
  private contourColor    = '#ffffff';
  private contourWidth    = 1.2;

  // Current activation state
  private instanceId     = '';
  private layerId        = '';
  private srcId          = '';
  private contourLayerId = '';
  private contourSrcId   = '';
  private active         = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private moveHandler: (() => void) | null = null;
  private legendEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;

  // Legend status
  private legendStatus: 'idle' | 'loading' | 'error' | 'ready' = 'idle';
  private legendError = '';

  // Elevation sample / profile tool state
  private activeTool: 'none' | 'sample' | 'profile' = 'none';
  private profilePoints: [number, number][] = [];
  private sampleClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private profileClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private profilePanelEl: HTMLElement | null = null;
  private samplePopupEl: HTMLElement | null = null;

  constructor(private readonly mapManager: MapManager) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Activate (or re-activate) the layer.
   * Always tears down existing map layers first so that the layer is
   * re-inserted at the correct position within the unified overlay order.
   */
  activate(instanceId: string, opacity: number, visible: boolean, ramp?: ColorRamp): void {
    if (ramp) this.ramp = ramp;
    this.layerVisible    = visible;
    this.intendedOpacity = visible ? opacity : 0;
    // Remove old map artefacts if present (ensures correct ordering after rebuildMap)
    this.removeMapLayers();

    this.instanceId     = instanceId;
    this.layerId        = `bm-ov-${instanceId}`;
    this.srcId          = `bmsrc-${instanceId}`;
    this.contourLayerId = `bm-ov-${instanceId}-contour`;
    this.contourSrcId   = `bmsrc-${instanceId}-contour`;
    this.active         = true;

    const map = this.mapManager.getMap();

    // Add raster image source — restore cached content immediately to avoid a blank frame
    map.addSource(this.srcId, {
      type:        'image',
      url:         this.canvasHasData ? this.canvas.toDataURL('image/png') : BLANK_PNG,
      coordinates: this.lastCoords,
    } as Parameters<typeof map.addSource>[1]);

    map.addLayer(
      {
        id:    this.layerId,
        type:  'raster',
        source: this.srcId,
        paint: {
          'raster-opacity':       visible ? opacity : 0,
          'raster-fade-duration': 0,
        },
      },
      LAYER_IDS.USER_ACCURACY,
    );

    if (!this.effectiveRasterVisible()) {
      map.setLayoutProperty(this.layerId, 'visibility', 'none');
    }

    // Add contour GeoJSON source + line layer (initially empty / hidden)
    map.addSource(this.contourSrcId, { type: 'geojson', data: EMPTY_FC });

    map.addLayer(
      {
        id:     this.contourLayerId,
        type:   'line',
        source: this.contourSrcId,
        layout: { visibility: this.effectiveContourVisible() ? 'visible' : 'none' },
        paint: {
          'line-color':   this.contourColor,
          'line-width':   this.contourWidth,
          'line-opacity': this.intendedOpacity,
        },
      },
      LAYER_IDS.USER_ACCURACY,
    );

    // Create or restore legend and toolbar
    this.ensureLegend();
    this.ensureToolbar();

    // Attach move listeners (idempotent guard)
    if (!this.moveHandler) {
      this.moveHandler = () => this.scheduleFetch();
      map.on('moveend', this.moveHandler);
      map.on('zoomend', this.moveHandler);
    }

    this.scheduleFetch();
  }

  deactivate(): void {
    if (!this.active) return;
    this.removeMapLayers();
    this.removeLegend();
    this.removeToolbar();
    this.cancelTool();
    this.active = false;
  }

  // --------------------------------------------------------------------------
  // Public controls (called by BasemapManager when stack changes)
  // --------------------------------------------------------------------------

  setOpacity(opacity: number): void {
    this.intendedOpacity = opacity;
    const map = this.mapManager.getMap();
    if (map.getLayer(this.layerId)) {
      map.setPaintProperty(this.layerId, 'raster-opacity', opacity);
    }
    if (map.getLayer(this.contourLayerId)) {
      map.setPaintProperty(this.contourLayerId, 'line-opacity', opacity);
    }
  }

  setVisible(visible: boolean): void {
    this.layerVisible = visible;
    this.applyVisibilities();
    if (visible) this.scheduleFetch();
    if (this.toolbarEl) this.toolbarEl.style.display = visible ? '' : 'none';
  }

  setRasterVisible(visible: boolean): void {
    this.rasterVisible = visible;
    this.applyVisibilities();
    if (visible && this.layerVisible) this.scheduleFetch();
  }

  setRamp(ramp: ColorRamp, invert = false): void {
    this.ramp = invert ? invertRamp(ramp) : ramp;
    if (this.hrdemProduct !== 'elevation') return; // ramp only applies to elevation
    if (this.lastResult) {
      renderElevation(this.canvas, this.lastResult, this.ramp);
      this.canvasHasData = true;
      const src = this.mapManager.getMap().getSource(this.srcId) as maplibregl.ImageSource | undefined;
      if (src) src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });
      this.updateLegend(this.lastResult);
    } else {
      this.scheduleFetch();
    }
  }

  setProduct(product: HRDEMProduct): void {
    this.hrdemProduct = product;
    if (this.lastResult) {
      this.renderProduct(this.canvas, this.lastResult);
      this.canvasHasData = true;
      const src = this.mapManager.getMap().getSource(this.srcId) as maplibregl.ImageSource | undefined;
      if (src) src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });
      this.updateLegend(this.lastResult);
    } else {
      this.scheduleFetch();
    }
  }

  setContour(enabled: boolean, interval: number, color: string, width = 1.2): void {
    this.contourEnabled  = enabled;
    this.contourInterval = Math.max(0.1, interval);
    this.contourColor    = color;
    this.contourWidth    = width;

    const map = this.mapManager.getMap();
    if (map.getLayer(this.contourLayerId)) {
      map.setPaintProperty(this.contourLayerId, 'line-color', color);
      map.setPaintProperty(this.contourLayerId, 'line-width', width);
    }
    this.applyVisibilities();

    if (enabled && this.lastResult) {
      this.updateContourSource(this.lastResult);
      // Fetch fresh data if the raster was hidden (no prior fetch in that state)
      if (!this.rasterVisible) this.scheduleFetch();
    } else if (!enabled) {
      const src = map.getSource(this.contourSrcId) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(EMPTY_FC);
    }

    // Update toolbar contour label
    this.refreshToolbarContourLabel();
  }

  getLayerIds(): string[] {
    if (!this.active) return [];
    return this.contourEnabled
      ? [this.layerId, this.contourLayerId]
      : [this.layerId];
  }

  // --------------------------------------------------------------------------
  // Internal — product rendering
  // --------------------------------------------------------------------------

  private renderProduct(canvas: HTMLCanvasElement, result: HRDEMResult): void {
    switch (this.hrdemProduct) {
      case 'slope': {
        const { grid, min, max } = computeSlope(result);
        renderGrid(canvas, grid, result.width, result.height, min, max, null, SLOPE_RAMP);
        break;
      }
      case 'aspect': {
        const { grid } = computeAspect(result);
        renderAspect(canvas, grid, result.width, result.height);
        break;
      }
      case 'tpi': {
        const { grid, min, max } = computeTPI(result);
        const range = Math.max(Math.abs(min), Math.abs(max), 0.1);
        renderGrid(canvas, grid, result.width, result.height, -range, range, null, TPI_RAMP);
        break;
      }
      default: // 'elevation'
        renderElevation(canvas, result, this.ramp);
    }
  }

  // --------------------------------------------------------------------------
  // Internal — visibility
  // --------------------------------------------------------------------------

  private effectiveRasterVisible():  boolean { return this.layerVisible && this.rasterVisible; }
  private effectiveContourVisible(): boolean { return this.layerVisible && this.contourEnabled; }

  private applyVisibilities(): void {
    const map = this.mapManager.getMap();
    if (map.getLayer(this.layerId)) {
      map.setLayoutProperty(this.layerId, 'visibility',
        this.effectiveRasterVisible() ? 'visible' : 'none');
    }
    if (map.getLayer(this.contourLayerId)) {
      map.setLayoutProperty(this.contourLayerId, 'visibility',
        this.effectiveContourVisible() ? 'visible' : 'none');
    }
  }

  private updateContourSource(result: HRDEMResult): void {
    const map = this.mapManager.getMap();
    const src = map.getSource(this.contourSrcId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const geojson = generateContours(result, this.contourInterval);
    src.setData(geojson as GeoJSON.FeatureCollection);
  }

  private removeMapLayers(): void {
    if (this.moveHandler) {
      const map = this.mapManager.getMap();
      map.off('moveend', this.moveHandler);
      map.off('zoomend', this.moveHandler);
      this.moveHandler = null;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const map = this.mapManager.getMap();
    if (this.contourLayerId && map.getLayer(this.contourLayerId)) map.removeLayer(this.contourLayerId);
    if (this.contourSrcId   && map.getSource(this.contourSrcId))  map.removeSource(this.contourSrcId);
    if (this.layerId        && map.getLayer(this.layerId))         map.removeLayer(this.layerId);
    if (this.srcId          && map.getSource(this.srcId))          map.removeSource(this.srcId);
  }

  private scheduleFetch(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.fetchAndRender();
    }, DEBOUNCE_MS);
  }

  private async fetchAndRender(): Promise<void> {
    if (!this.active) return;

    const map = this.mapManager.getMap();

    // Skip at small scales — HRDEM 1 m data is meaningless below zoom 10
    if (map.getZoom() < MIN_ZOOM) {
      if (map.getLayer(this.layerId))        map.setPaintProperty(this.layerId, 'raster-opacity', 0);
      if (map.getLayer(this.contourLayerId)) map.setLayoutProperty(this.contourLayerId, 'visibility', 'none');
      this.updateLegend(null);
      return;
    }

    // Skip if nothing would be shown — but allow fetch when raster is off if contours are on
    if (!this.layerVisible) return;
    if (!this.rasterVisible && !this.contourEnabled) return;

    const bounds = map.getBounds();
    const west  = bounds.getWest();
    const south = bounds.getSouth();
    const east  = bounds.getEast();
    const north = bounds.getNorth();

    // Request at screen resolution (capped inside fetchHRDEM)
    const mc = map.getCanvas();
    const targetW = mc.width  || 512;
    const targetH = mc.height || 512;

    this.legendStatus = 'loading';
    this.updateLegend(null);

    let result;
    try {
      result = await fetchHRDEM(west, south, east, north, targetW, targetH);
    } catch (err) {
      this.legendStatus = 'error';
      this.legendError = String(err).slice(0, 120);
      this.updateLegend(null);
      console.error('[HRDEMLayer] fetch failed:', err);
      return;
    }

    this.legendStatus = 'ready';

    if (!this.active) return; // deactivated while fetch was in-flight

    this.lastResult = result;
    this.renderProduct(this.canvas, result);
    this.canvasHasData = true;

    // NW → NE → SE → SW (MapLibre image-source coordinate order)
    this.lastCoords = [
      [west,  north],
      [east,  north],
      [east,  south],
      [west,  south],
    ];

    const src = map.getSource(this.srcId) as maplibregl.ImageSource | undefined;
    if (!src) return;

    src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });

    // Restore raster opacity if the zoom-guard previously zeroed it
    const currentOpacity = map.getPaintProperty(this.layerId, 'raster-opacity') as number;
    if (currentOpacity === 0 && this.intendedOpacity > 0) {
      map.setPaintProperty(this.layerId, 'raster-opacity', this.intendedOpacity);
    }

    // Generate / refresh contour lines
    if (this.contourEnabled) {
      this.updateContourSource(result);
      if (map.getLayer(this.contourLayerId)) {
        map.setLayoutProperty(this.contourLayerId, 'visibility', 'visible');
        map.setPaintProperty(this.contourLayerId, 'line-opacity', this.intendedOpacity);
      }
    }

    this.updateLegend(result);
  }

  // --------------------------------------------------------------------------
  // Elevation sample helper
  // --------------------------------------------------------------------------

  private sampleElevationAt(lon: number, lat: number): number | null {
    if (!this.lastResult) return null;
    const { grid, width, height, bbox, nodata } = this.lastResult;
    const [west, south, east, north] = bbox;
    const col = Math.round((lon - west) / (east - west) * (width  - 1));
    const row = Math.round((north - lat) / (north - south) * (height - 1));
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    const v = grid[row * width + col];
    if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) return null;
    return v;
  }

  private sampleProfileLine(
    lon1: number, lat1: number,
    lon2: number, lat2: number,
    n = 200,
  ): Array<{ dist: number; elev: number | null }> {
    if (!this.lastResult) return [];
    const { grid, width, height, bbox, nodata } = this.lastResult;
    const [west, south, east, north] = bbox;

    const dlon = lon2 - lon1, dlat = lat2 - lat1;
    const latMid = (lat1 + lat2) / 2;
    const distKm = Math.sqrt(
      (dlat * 110.54) ** 2 +
      (dlon * 111.32 * Math.cos(latMid * Math.PI / 180)) ** 2,
    );

    const points: Array<{ dist: number; elev: number | null }> = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const lon = lon1 + t * dlon;
      const lat = lat1 + t * dlat;
      const col = Math.round((lon - west)  / (east  - west)  * (width  - 1));
      const row = Math.round((north - lat) / (north - south) * (height - 1));
      let elev: number | null = null;
      if (col >= 0 && col < width && row >= 0 && row < height) {
        const v = grid[row * width + col];
        if (isFinite(v) && (nodata === null || Math.abs(v - nodata) >= 0.001)) {
          elev = v;
        }
      }
      points.push({ dist: t * distKm, elev });
    }
    return points;
  }

  // --------------------------------------------------------------------------
  // Tool management
  // --------------------------------------------------------------------------

  private cancelTool(): void {
    this.activeTool = 'none';
    this.profilePoints = [];

    const map = this.mapManager.getMap();

    if (this.sampleClickHandler) {
      map.off('click', this.sampleClickHandler);
      this.sampleClickHandler = null;
    }
    if (this.profileClickHandler) {
      map.off('click', this.profileClickHandler);
      this.profileClickHandler = null;
    }

    map.getCanvas().style.cursor = '';
    this.samplePopupEl?.remove();
    this.samplePopupEl = null;
    this.profilePanelEl?.remove();
    this.profilePanelEl = null;

    this.refreshToolbarButtons();
  }

  private activateSampleTool(): void {
    if (this.activeTool === 'sample') { this.cancelTool(); return; }
    this.cancelTool();
    this.activeTool = 'sample';

    const map = this.mapManager.getMap();
    map.getCanvas().style.cursor = 'crosshair';

    this.sampleClickHandler = (e: maplibregl.MapMouseEvent) => {
      const elev = this.sampleElevationAt(e.lngLat.lng, e.lngLat.lat);
      this.showSamplePopup(e.lngLat.lng, e.lngLat.lat, elev);
    };
    map.on('click', this.sampleClickHandler);
    this.refreshToolbarButtons();
  }

  private activateProfileTool(): void {
    if (this.activeTool === 'profile') { this.cancelTool(); return; }
    this.cancelTool();
    this.activeTool = 'profile';
    this.profilePoints = [];

    const map = this.mapManager.getMap();
    map.getCanvas().style.cursor = 'crosshair';

    this.profileClickHandler = (e: maplibregl.MapMouseEvent) => {
      this.profilePoints.push([e.lngLat.lng, e.lngLat.lat]);
      if (this.profilePoints.length >= 2) {
        const [p1, p2] = this.profilePoints;
        const pts = this.sampleProfileLine(p1[0], p1[1], p2[0], p2[1]);
        this.showProfilePanel(pts);
        this.cancelTool();
      }
    };
    map.on('click', this.profileClickHandler);
    this.refreshToolbarButtons();
  }

  private showSamplePopup(lon: number, lat: number, elev: number | null): void {
    this.samplePopupEl?.remove();

    const container = this.mapManager.getMap().getContainer();
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'z-index:30',
      'background:rgba(18,36,26,0.92)', 'border:1px solid rgba(255,255,255,0.18)',
      'border-radius:5px', 'padding:6px 10px',
      'font-family:inherit', 'font-size:11px', 'color:#c8d8c8',
      'pointer-events:none', 'white-space:nowrap',
    ].join(';');

    const elevTxt = elev !== null ? `${elev.toFixed(1)} m` : 'No data';
    el.innerHTML = `<b style="font-size:12px">${elevTxt}</b><br><span style="font-size:9px;opacity:0.55">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`;

    // Position near map centre — will be repositioned by pixel projection
    const map = this.mapManager.getMap();
    const pt = map.project([lon, lat]);
    const canv = map.getCanvas();
    const scaleX = canv.clientWidth  / canv.width;
    const scaleY = canv.clientHeight / canv.height;
    el.style.left = `${pt.x * scaleX + 12}px`;
    el.style.top  = `${pt.y * scaleY - 24}px`;

    container.appendChild(el);
    this.samplePopupEl = el;

    // Auto-dismiss after 4 s
    setTimeout(() => { el.remove(); if (this.samplePopupEl === el) this.samplePopupEl = null; }, 4000);
  }

  private showProfilePanel(pts: Array<{ dist: number; elev: number | null }>): void {
    this.profilePanelEl?.remove();

    const valid = pts.filter(p => p.elev !== null) as Array<{ dist: number; elev: number }>;
    if (valid.length < 2) return;

    const distMax = valid[valid.length - 1].dist;
    const elevMin = Math.min(...valid.map(p => p.elev));
    const elevMax = Math.max(...valid.map(p => p.elev));
    const elevRange = elevMax - elevMin || 1;

    const W = 360, H = 120, padL = 40, padR = 8, padT = 8, padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const toX = (d: number) => padL + (d / distMax) * plotW;
    const toY = (e: number) => padT + plotH - ((e - elevMin) / elevRange) * plotH;

    // Build SVG polyline path
    let pathD = '';
    for (const p of valid) {
      const x = toX(p.dist), y = toY(p.elev);
      pathD += pathD ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
    }

    // Y-axis ticks (3 values)
    const yTicks = [elevMin, elevMin + elevRange / 2, elevMax];
    const yTickSvg = yTicks.map(e =>
      `<text x="${padL - 3}" y="${toY(e).toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="#9ab" font-size="9">${e.toFixed(0)}</text>
       <line x1="${padL}" y1="${toY(e).toFixed(1)}" x2="${padL + plotW}" y2="${toY(e).toFixed(1)}" stroke="#334" stroke-width="1"/>`,
    ).join('');

    // X-axis label
    const xLabel = distMax < 1
      ? `${(distMax * 1000).toFixed(0)} m`
      : `${distMax.toFixed(2)} km`;

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0c1c14" rx="4"/>
      ${yTickSvg}
      <path d="${pathD}" fill="none" stroke="#5baf82" stroke-width="1.5"/>
      <text x="${padL}" y="${H - 8}" fill="#9ab" font-size="9">0</text>
      <text x="${padL + plotW}" y="${H - 8}" fill="#9ab" font-size="9" text-anchor="end">${xLabel}</text>
      <text x="${padL + plotW / 2}" y="${H - 8}" fill="#9ab" font-size="9" text-anchor="middle">Distance</text>
      <text x="8" y="${H / 2}" fill="#9ab" font-size="9" text-anchor="middle" transform="rotate(-90,8,${H / 2})">Elev (m)</text>
    </svg>`;

    const container = this.mapManager.getMap().getContainer();
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'bottom:80px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:30',
      'background:rgba(12,28,20,0.95)',
      'border:1px solid rgba(255,255,255,0.14)',
      'border-radius:6px', 'padding:8px',
      'pointer-events:auto',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:11px;color:#c8d8c8';
    header.innerHTML = `<span>Elevation Profile &nbsp;<span style="font-size:9px;opacity:0.55">${elevMin.toFixed(0)}–${elevMax.toFixed(0)} m</span></span>`;

    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'background:none;border:none;color:#9ab;cursor:pointer;font-size:12px;padding:0 0 0 8px';
    close.addEventListener('click', () => { el.remove(); this.profilePanelEl = null; });
    header.appendChild(close);

    el.appendChild(header);
    const svgContainer = document.createElement('div');
    svgContainer.innerHTML = svg;
    el.appendChild(svgContainer);

    container.appendChild(el);
    this.profilePanelEl = el;
  }

  // --------------------------------------------------------------------------
  // Toolbar
  // --------------------------------------------------------------------------

  private ensureToolbar(): void {
    if (this.toolbarEl) return;
    const container = this.mapManager.getMap().getContainer();

    const el = document.createElement('div');
    el.id = 'hrdem-elevation-toolbar';
    el.style.cssText = [
      'position:absolute', 'top:8px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:20',
      'display:flex', 'align-items:center', 'gap:6px',
      'background:rgba(18,36,26,0.90)',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:6px', 'padding:4px 8px',
      'font-family:inherit', 'font-size:11px', 'color:#c8d8c8',
      'pointer-events:auto',
      'backdrop-filter:blur(3px)', '-webkit-backdrop-filter:blur(3px)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    ].join(';');

    // Contour interval label (shown only when contours enabled)
    const contourLbl = document.createElement('span');
    contourLbl.className = 'hrdem-tb-contour-lbl';
    contourLbl.style.cssText = `font-size:10px;opacity:0.7;display:${this.contourEnabled ? '' : 'none'}`;
    this.updateContourLabelText(contourLbl);

    // Divider
    const sep1 = document.createElement('span');
    sep1.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.15);flex-shrink:0';
    sep1.className = 'hrdem-tb-sep hrdem-tb-sep-contour';
    sep1.style.display = this.contourEnabled ? '' : 'none';

    // Sample button
    const sampleBtn = document.createElement('button');
    sampleBtn.className = 'hrdem-tb-btn hrdem-tb-sample';
    sampleBtn.title = 'Click a point on the map to read its elevation';
    sampleBtn.style.cssText = this.toolBtnStyle();
    sampleBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg> Sample';
    sampleBtn.addEventListener('click', () => this.activateSampleTool());

    // Profile button
    const profileBtn = document.createElement('button');
    profileBtn.className = 'hrdem-tb-btn hrdem-tb-profile';
    profileBtn.title = 'Click two points to create an elevation profile';
    profileBtn.style.cssText = this.toolBtnStyle();
    profileBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,13 5,7 9,10 15,3"/></svg> Profile';
    profileBtn.addEventListener('click', () => this.activateProfileTool());

    if (this.contourEnabled) {
      el.appendChild(contourLbl);
      el.appendChild(sep1);
    }
    el.appendChild(sampleBtn);
    el.appendChild(profileBtn);

    container.appendChild(el);
    this.toolbarEl = el;
  }

  private toolBtnStyle(active = false): string {
    return [
      'display:inline-flex', 'align-items:center', 'gap:4px',
      'background:' + (active ? 'rgba(91,175,130,0.25)' : 'none'),
      'border:1px solid ' + (active ? 'rgba(91,175,130,0.5)' : 'rgba(255,255,255,0.12)'),
      'border-radius:4px', 'color:#c8d8c8',
      'cursor:pointer', 'padding:3px 7px',
      'font-family:inherit', 'font-size:10px',
    ].join(';');
  }

  private refreshToolbarButtons(): void {
    if (!this.toolbarEl) return;
    const sampleBtn = this.toolbarEl.querySelector<HTMLButtonElement>('.hrdem-tb-sample');
    const profileBtn = this.toolbarEl.querySelector<HTMLButtonElement>('.hrdem-tb-profile');
    if (sampleBtn)  sampleBtn.style.cssText  = this.toolBtnStyle(this.activeTool === 'sample');
    if (profileBtn) profileBtn.style.cssText = this.toolBtnStyle(this.activeTool === 'profile');

    // Hint text in toolbar while profile first point is pending
    const existing = this.toolbarEl.querySelector('.hrdem-tb-hint');
    existing?.remove();
    if (this.activeTool === 'profile' && this.profilePoints.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hrdem-tb-hint';
      hint.style.cssText = 'font-size:9px;opacity:0.55;margin-left:2px';
      hint.textContent = 'Click start point…';
      this.toolbarEl.appendChild(hint);
    }
  }

  private refreshToolbarContourLabel(): void {
    if (!this.toolbarEl) return;
    const lbl = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-contour-lbl');
    const sep = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-sep-contour');
    if (lbl) {
      lbl.style.display = this.contourEnabled ? '' : 'none';
      this.updateContourLabelText(lbl);
    }
    if (sep) sep.style.display = this.contourEnabled ? '' : 'none';
  }

  private updateContourLabelText(el: HTMLElement): void {
    const iv = this.contourInterval;
    const ivlLbl = iv < 1
      ? `${iv}m`
      : `${iv % 1 === 0 ? iv.toFixed(0) : iv}m`;
    el.innerHTML = `<span style="display:inline-block;width:12px;height:0;border-top:1.5px solid ${this.contourColor};vertical-align:middle;margin-right:3px"></span>${ivlLbl} contours`;
  }

  private removeToolbar(): void {
    this.toolbarEl?.remove();
    this.toolbarEl = null;
  }

  // --------------------------------------------------------------------------
  // Legend
  // --------------------------------------------------------------------------

  private ensureLegend(): void {
    if (this.legendEl) return;
    const container = this.mapManager.getMap().getContainer();
    const el = document.createElement('div');
    el.id = 'hrdem-elevation-legend';
    // Offset left by toolbar width (~52px) + gap so legend doesn't sit under the left toolbar
    el.style.cssText = [
      'position:absolute', 'bottom:36px', 'left:68px', 'z-index:10',
      'background:rgba(18,36,26,0.88)', 'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:6px', 'padding:8px 10px',
      'font-family:inherit', 'font-size:11px', 'color:#c8d8c8',
      'min-width:80px', 'pointer-events:none',
      'backdrop-filter:blur(3px)', '-webkit-backdrop-filter:blur(3px)',
    ].join(';');
    el.innerHTML = this.buildLegendHTML(null);
    container.appendChild(el);
    this.legendEl = el;
  }

  private removeLegend(): void {
    this.legendEl?.remove();
    this.legendEl = null;
  }

  private updateLegend(result: HRDEMResult | null): void {
    if (this.legendEl) this.legendEl.innerHTML = this.buildLegendHTML(result);
  }

  private buildLegendHTML(result: HRDEMResult | null): string {
    if (this.legendStatus === 'loading') {
      return `
        <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:4px;text-transform:uppercase">${this.productLabel()}</div>
        <div style="font-size:10px;opacity:0.7">⟳ Fetching…</div>`;
    }

    if (this.legendStatus === 'error') {
      return `
        <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:4px;text-transform:uppercase">${this.productLabel()}</div>
        <div style="font-size:10px;color:#f87171;line-height:1.4;max-width:160px">⚠ ${this.legendError}</div>
        <div style="font-size:9px;opacity:0.5;margin-top:3px">Check browser console</div>`;
    }

    switch (this.hrdemProduct) {
      case 'slope':    return this.buildSlopeLegend(result);
      case 'aspect':   return this.buildAspectLegend();
      case 'tpi':      return this.buildTPILegend(result);
      default:         return this.buildElevationLegend(result);
    }
  }

  private productLabel(): string {
    const labels: Record<HRDEMProduct, string> = {
      elevation: 'Elevation',
      slope:     'Slope',
      aspect:    'Aspect',
      tpi:       'TPI',
    };
    return labels[this.hrdemProduct] ?? 'Elevation';
  }

  private buildElevationLegend(result: HRDEMResult | null): string {
    const grad = rampToGradient(this.ramp);
    const minLbl = result ? `${result.stretchMin.toFixed(0)} m` : '—';
    const maxLbl = result ? `${result.stretchMax.toFixed(0)} m` : '—';
    const statsLbl = result
      ? `${result.elevMin.toFixed(0)}–${result.elevMax.toFixed(0)} m (${result.validCount.toLocaleString()} px)`
      : '';

    const iv = this.contourInterval;
    const ivlLbl = iv < 1 ? `${iv} m` : `${iv % 1 === 0 ? iv.toFixed(0) : iv} m`;
    const contourHud = this.contourEnabled
      ? `<div style="display:flex;align-items:center;gap:4px;font-size:9px;margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)">
           <span style="display:inline-block;width:14px;height:0;border-top:1.5px solid ${this.contourColor};opacity:0.85;flex-shrink:0"></span>
           <span style="opacity:0.65">${ivlLbl} contours</span>
         </div>`
      : '';

    return `
      <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Elevation</div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span>${maxLbl}</span>
          <span>${minLbl}</span>
        </div>
      </div>
      ${statsLbl ? `<div style="font-size:9px;opacity:0.45;margin-top:4px;max-width:120px;line-height:1.3">${statsLbl}</div>` : ''}
      ${contourHud}`;
  }

  private buildSlopeLegend(result: HRDEMResult | null): string {
    const stops = SLOPE_RAMP.stops
      .map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t * 100).toFixed(0)}%`)
      .join(', ');
    const grad = `linear-gradient(to top, ${stops})`;
    const statsLbl = result
      ? `${result.validCount.toLocaleString()} px`
      : '';
    return `
      <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Slope</div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span>90°</span>
          <span>0°</span>
        </div>
      </div>
      ${statsLbl ? `<div style="font-size:9px;opacity:0.45;margin-top:4px">${statsLbl}</div>` : ''}`;
  }

  private buildAspectLegend(): string {
    // Compass rose using a conic-gradient: N=red, E=yellow, S=cyan, W=blue
    return `
      <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Aspect</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;
          background:conic-gradient(from -90deg,
            hsl(0,80%,50%) 0deg,
            hsl(90,80%,50%) 90deg,
            hsl(180,80%,50%) 180deg,
            hsl(270,80%,50%) 270deg,
            hsl(360,80%,50%) 360deg);
          border:1px solid rgba(255,255,255,0.15)">
        </div>
        <div style="font-size:9px;line-height:1.6;opacity:0.7">
          N &nbsp;↑<br>E &nbsp;→<br>S &nbsp;↓<br>W ←
        </div>
      </div>
      <div style="font-size:9px;opacity:0.4;margin-top:4px">Grey = flat</div>`;
  }

  private buildTPILegend(result: HRDEMResult | null): string {
    const stops = TPI_RAMP.stops
      .map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t * 100).toFixed(0)}%`)
      .join(', ');
    const grad = `linear-gradient(to top, ${stops})`;
    const statsLbl = result
      ? `${result.validCount.toLocaleString()} px`
      : '';
    return `
      <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">TPI</div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span>Ridge +</span>
          <span style="opacity:0.55">0</span>
          <span>Valley −</span>
        </div>
      </div>
      ${statsLbl ? `<div style="font-size:9px;opacity:0.45;margin-top:4px">${statsLbl}</div>` : ''}`;
  }
}
