/**
 * HRDEM elevation layer for MapLibre.
 *
 * Follows the same activate / deactivate lifecycle as NSPRDVectorLayer and
 * NSHNVectorLayer so it integrates seamlessly with BasemapManager's
 * rebuildMap() loop.
 */

import maplibregl from 'maplibre-gl';
import type { MapManager } from './MapManager';
import { fetchHRDEM, type HRDEMResult } from '../lib/hrdemWCS';
import {
  renderElevation,
  renderGrid,
  renderAspect,
  renderCHMClassified,
  rampToGradient,
  invertRamp,
  sampleRamp,
  HRDEM_RAMPS,
  SLOPE_RAMPS,
  TPI_RAMPS,
  CHM_RAMPS,
  CHM_CLASSES,
  CHM_CLASS_PALETTES,
  SLOPE_RAMP,
  TPI_RAMP,
  type ColorRamp,
} from '../lib/elevationRenderer';
import { generateContours } from '../lib/contourGenerator';
import { computeSlope, computeAspect, computeTPI } from '../lib/demProducts';
import { LAYER_IDS } from '../constants';

const DEBOUNCE_MS = 300;
const MIN_ZOOM    = 10;

const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export type HRDEMProduct = 'elevation' | 'slope' | 'aspect' | 'tpi' | 'chm';

export interface ProductStyle {
  // Slope
  slopeRampId?:  string;    // key of SLOPE_RAMPS
  slopeUnit?:    'degrees' | 'percent';
  slopeStretch?: 'auto' | 'full' | '0-45' | '0-90';
  slopeInvert?:  boolean;
  // Aspect
  aspectSat?:    number;    // 0–1
  aspectLight?:  number;    // 0–1
  // TPI
  tpiRampId?:    string;    // key of TPI_RAMPS
  tpiStretch?:   'symmetric' | 'auto';
  tpiInvert?:    boolean;
  // CHM
  chmMode?:      'stretch' | 'classified';  // default 'classified'
  chmRampId?:    string;                    // key of CHM_RAMPS, used in stretch mode
  chmInvert?:    boolean;
  chmClassPaletteId?: string;            // key of CHM_CLASS_PALETTES, default 'structural'
}

export class HRDEMLayer {
  private readonly canvas = document.createElement('canvas');
  private ramp: ColorRamp = HRDEM_RAMPS['terrain'].ramp;

  private lastResult: HRDEMResult | null = null;
  private lastCoords: [[number,number],[number,number],[number,number],[number,number]] = [
    [-180, 85], [180, 85], [180, -85], [-180, -85],
  ];
  private canvasHasData = false;
  private intendedOpacity = 1;

  private layerVisible  = true;
  private rasterVisible = true;

  private hrdemProduct: HRDEMProduct = 'elevation';
  private surface: 'dtm' | 'dsm' = 'dtm';

  // Per-product style state
  private slopeRampId:  string  = 'classic';
  private slopeUnit:    'degrees' | 'percent' = 'degrees';
  private slopeStretch: string  = 'auto';
  private slopeInvert:  boolean = false;
  private aspectSat:    number  = 0.8;
  private aspectLight:  number  = 0.5;
  private tpiRampId:    string  = 'rdylbu';
  private tpiStretch:   string  = 'symmetric';
  private tpiInvert:    boolean = false;
  private chmMode:      'stretch' | 'classified' = 'classified';
  private chmRampId:    string  = 'canopy_green';
  private chmInvert:    boolean = false;
  private chmClassPaletteId: string = 'structural';

  private contourEnabled  = false;
  private contourInterval = 10;
  private contourColor    = '#ffffff';
  private contourWidth    = 1.2;

  private instanceId     = '';
  private layerId        = '';
  private srcId          = '';
  private contourLayerId = '';
  private contourSrcId   = '';
  private active         = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private moveHandler: (() => void) | null = null;
  private toolbarEl: HTMLElement | null = null;

  private legendStatus: 'idle' | 'loading' | 'error' | 'ready' = 'idle';
  private legendError = '';

  /** Called by BasemapManager whenever legend content changes. */
  public onLegendUpdate: (() => void) | null = null;

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

  activate(instanceId: string, opacity: number, visible: boolean, ramp?: ColorRamp): void {
    if (ramp) this.ramp = ramp;
    this.layerVisible    = visible;
    this.intendedOpacity = visible ? opacity : 0;
    this.removeMapLayers();

    this.instanceId     = instanceId;
    this.layerId        = `bm-ov-${instanceId}`;
    this.srcId          = `bmsrc-${instanceId}`;
    this.contourLayerId = `bm-ov-${instanceId}-contour`;
    this.contourSrcId   = `bmsrc-${instanceId}-contour`;
    this.active         = true;

    const map = this.mapManager.getMap();

    map.addSource(this.srcId, {
      type: 'image',
      url:  this.canvasHasData ? this.canvas.toDataURL('image/png') : BLANK_PNG,
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

    this.ensureToolbar();

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
    this.removeToolbar();
    this.cancelTool();
    this.onLegendUpdate?.();
    this.active = false;
  }

  // --------------------------------------------------------------------------
  // Public controls
  // --------------------------------------------------------------------------

  setOpacity(opacity: number): void {
    this.intendedOpacity = opacity;
    const map = this.mapManager.getMap();
    if (map.getLayer(this.layerId))        map.setPaintProperty(this.layerId, 'raster-opacity', opacity);
    if (map.getLayer(this.contourLayerId)) map.setPaintProperty(this.contourLayerId, 'line-opacity', opacity);
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
    if (this.hrdemProduct !== 'elevation') return;
    if (this.lastResult) {
      renderElevation(this.canvas, this.lastResult, this.ramp);
      this.canvasHasData = true;
      const src = this.mapManager.getMap().getSource(this.srcId) as maplibregl.ImageSource | undefined;
      if (src) src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });
      this.onLegendUpdate?.();
    } else {
      this.scheduleFetch();
    }
  }

  setProduct(product: HRDEMProduct): void {
    this.hrdemProduct = product;
    if (this.lastResult && product !== 'chm') {
      this.renderProduct(this.canvas, this.lastResult);
      this.canvasHasData = true;
      const src = this.mapManager.getMap().getSource(this.srcId) as maplibregl.ImageSource | undefined;
      if (src) src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });
      this.onLegendUpdate?.();
    } else {
      this.scheduleFetch();
    }
  }

  setProductStyle(style: ProductStyle): void {
    if (style.slopeRampId  !== undefined) this.slopeRampId  = style.slopeRampId;
    if (style.slopeUnit    !== undefined) this.slopeUnit    = style.slopeUnit;
    if (style.slopeStretch !== undefined) this.slopeStretch = style.slopeStretch;
    if (style.slopeInvert  !== undefined) this.slopeInvert  = style.slopeInvert;
    if (style.aspectSat    !== undefined) this.aspectSat    = style.aspectSat;
    if (style.aspectLight  !== undefined) this.aspectLight  = style.aspectLight;
    if (style.tpiRampId    !== undefined) this.tpiRampId    = style.tpiRampId;
    if (style.tpiStretch   !== undefined) this.tpiStretch   = style.tpiStretch;
    if (style.tpiInvert    !== undefined) this.tpiInvert    = style.tpiInvert;
    if (style.chmMode      !== undefined) this.chmMode      = style.chmMode;
    if (style.chmRampId    !== undefined) this.chmRampId    = style.chmRampId;
    if (style.chmInvert    !== undefined) this.chmInvert    = style.chmInvert;
    if (style.chmClassPaletteId !== undefined) this.chmClassPaletteId = style.chmClassPaletteId;

    if (this.lastResult) {
      this.renderProduct(this.canvas, this.lastResult);
      this.canvasHasData = true;
      const src = this.mapManager.getMap().getSource(this.srcId) as maplibregl.ImageSource | undefined;
      if (src) src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });
      this.onLegendUpdate?.();
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
      if (!this.rasterVisible) this.scheduleFetch();
    } else if (!enabled) {
      const src = map.getSource(this.contourSrcId) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(EMPTY_FC);
    }

    this.refreshToolbarContourLabel();
  }

  setSurface(surface: string): void {
    const s = surface === 'dsm' ? 'dsm' : 'dtm';
    if (this.surface === s) return;
    this.surface = s;
    if (this.lastResult) this.scheduleFetch();
  }

  /** Returns the inner HTML for this layer's legend block (used by BasemapManager unified legend). */
  public getLegendHTML(): string {
    return this.buildLegendHTML(this.lastResult);
  }

  getLayerIds(): string[] {
    if (!this.active) return [];
    return this.contourEnabled ? [this.layerId, this.contourLayerId] : [this.layerId];
  }

  // --------------------------------------------------------------------------
  // Product rendering
  // --------------------------------------------------------------------------

  private resolveSlopeRamp(): ColorRamp {
    const entry = SLOPE_RAMPS[this.slopeRampId] ?? SLOPE_RAMPS['classic'];
    return this.slopeInvert ? invertRamp(entry.ramp) : entry.ramp;
  }

  private resolveTpiRamp(): ColorRamp {
    const entry = TPI_RAMPS[this.tpiRampId] ?? TPI_RAMPS['rdylbu'];
    return this.tpiInvert ? invertRamp(entry.ramp) : entry.ramp;
  }

  private resolveChmRamp(): ColorRamp {
    const entry = CHM_RAMPS[this.chmRampId] ?? CHM_RAMPS['canopy_green'];
    return this.chmInvert ? invertRamp(entry.ramp) : entry.ramp;
  }

  private renderProduct(canvas: HTMLCanvasElement, result: HRDEMResult): void {
    switch (this.hrdemProduct) {
      case 'slope': {
        const { grid, min, max } = computeSlope(result);
        let outGrid = grid;
        let outMin = min, outMax = max;

        if (this.slopeUnit === 'percent') {
          outGrid = new Float32Array(grid.length);
          for (let i = 0; i < grid.length; i++) {
            outGrid[i] = isFinite(grid[i]) ? Math.tan(grid[i] * Math.PI / 180) * 100 : NaN;
          }
          outMin = Math.tan(min * Math.PI / 180) * 100;
          outMax = Math.tan(max * Math.PI / 180) * 100;
        }

        let rMin = outMin, rMax = outMax;
        if (this.slopeStretch === 'full') {
          rMin = 0; rMax = this.slopeUnit === 'percent' ? Infinity : 90;
        } else if (this.slopeStretch === '0-45') {
          rMin = 0; rMax = this.slopeUnit === 'percent' ? 100 : 45;
        } else if (this.slopeStretch === '0-90') {
          rMin = 0; rMax = this.slopeUnit === 'percent' ? Infinity : 90;
        }
        // 'auto' uses actual data min/max
        if (!isFinite(rMax) || rMax > outMax) rMax = outMax;
        if (rMin < outMin) rMin = outMin;

        renderGrid(canvas, outGrid, result.width, result.height, rMin, rMax, null, this.resolveSlopeRamp());
        break;
      }
      case 'aspect': {
        const { grid } = computeAspect(result);
        this.renderAspectWithStyle(canvas, grid, result.width, result.height);
        break;
      }
      case 'tpi': {
        const { grid, min, max } = computeTPI(result);
        let rMin: number, rMax: number;
        if (this.tpiStretch === 'symmetric') {
          const range = Math.max(Math.abs(min), Math.abs(max), 0.1);
          rMin = -range; rMax = range;
        } else {
          rMin = min; rMax = max;
        }
        renderGrid(canvas, grid, result.width, result.height, rMin, rMax, null, this.resolveTpiRamp());
        break;
      }
      case 'chm':
        if (this.chmMode === 'classified') {
          renderCHMClassified(canvas, result.grid, result.width, result.height, this.chmClassPaletteId);
        } else {
          renderGrid(canvas, result.grid, result.width, result.height,
            result.stretchMin, result.stretchMax, result.nodata, this.resolveChmRamp());
        }
        break;
      default:
        renderElevation(canvas, result, this.ramp);
    }
  }

  /** Aspect renderer that respects sat/light style overrides. */
  private renderAspectWithStyle(
    canvas: HTMLCanvasElement,
    grid: Float32Array,
    width: number,
    height: number,
  ): void {
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    const pixels    = imageData.data;
    const s = this.aspectSat, l = this.aspectLight;

    for (let i = 0; i < grid.length; i++) {
      const v  = grid[i];
      const px = i * 4;
      if (!isFinite(v)) { pixels[px + 3] = 0; continue; }
      if (v === -1) {
        pixels[px] = 160; pixels[px + 1] = 160; pixels[px + 2] = 160; pixels[px + 3] = 180;
        continue;
      }
      const [r, g, b] = hslToRgb(v / 360, s, l);
      pixels[px] = r; pixels[px + 1] = g; pixels[px + 2] = b; pixels[px + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // --------------------------------------------------------------------------
  // Visibility helpers
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

    if (map.getZoom() < MIN_ZOOM) {
      if (map.getLayer(this.layerId))        map.setPaintProperty(this.layerId, 'raster-opacity', 0);
      if (map.getLayer(this.contourLayerId)) map.setLayoutProperty(this.contourLayerId, 'visibility', 'none');
      this.updateLegend(null);
      return;
    }

    if (!this.layerVisible) return;
    if (!this.rasterVisible && !this.contourEnabled) return;

    const bounds = map.getBounds();
    const west  = bounds.getWest(), south = bounds.getSouth();
    const east  = bounds.getEast(), north = bounds.getNorth();
    const mc = map.getCanvas();
    const targetW = mc.width || 512, targetH = mc.height || 512;

    this.legendStatus = 'loading';
    this.onLegendUpdate?.();

    let result;
    try {
      if (this.hrdemProduct === 'chm') {
        const [dtmResult, dsmResult] = await Promise.all([
          fetchHRDEM(west, south, east, north, targetW, targetH, 'dtm'),
          fetchHRDEM(west, south, east, north, targetW, targetH, 'dsm'),
        ]);
        result = HRDEMLayer.computeCHMGrid(dtmResult, dsmResult);
      } else {
        result = await fetchHRDEM(west, south, east, north, targetW, targetH, this.surface);
      }
    } catch (err) {
      this.legendStatus = 'error';
      this.legendError = String(err).slice(0, 120);
      this.onLegendUpdate?.();
      console.error('[HRDEMLayer] fetch failed:', err);
      return;
    }

    this.legendStatus = 'ready';
    if (!this.active) return;

    this.lastResult = result;
    this.renderProduct(this.canvas, result);
    this.canvasHasData = true;

    this.lastCoords = [
      [west, north], [east, north], [east, south], [west, south],
    ];

    const src = map.getSource(this.srcId) as maplibregl.ImageSource | undefined;
    if (!src) return;
    src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });

    const currentOpacity = map.getPaintProperty(this.layerId, 'raster-opacity') as number;
    if (currentOpacity === 0 && this.intendedOpacity > 0) {
      map.setPaintProperty(this.layerId, 'raster-opacity', this.intendedOpacity);
    }

    if (this.contourEnabled) {
      this.updateContourSource(result);
      if (map.getLayer(this.contourLayerId)) {
        map.setLayoutProperty(this.contourLayerId, 'visibility', 'visible');
        map.setPaintProperty(this.contourLayerId, 'line-opacity', this.intendedOpacity);
      }
    }

    this.updateLegend(result);
  }

  /** Compute CHM (DSM minus DTM) on the intersection of two grids. */
  private static computeCHMGrid(dtm: HRDEMResult, dsm: HRDEMResult): HRDEMResult {
    const { width, height, bbox, nodata } = dtm;
    const grid = new Float32Array(width * height);
    const valid: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      const d = dtm.grid[i], s = dsm.grid[i];
      if (!isFinite(d) || !isFinite(s) ||
          (nodata !== null && (Math.abs(d - nodata) < 0.001 || Math.abs(s - nodata) < 0.001))) {
        grid[i] = NaN;
        continue;
      }
      const chm = Math.max(0, s - d);
      grid[i] = chm;
      valid.push(chm);
    }
    valid.sort((a, b) => a - b);
    const n = valid.length;
    const elevMin = n > 0 ? valid[0] : 0;
    const elevMax = n > 0 ? valid[n - 1] : 1;
    const stretchMin = n > 0 ? valid[Math.floor(n * 0.02)] : 0;
    const stretchMax = n > 0 ? valid[Math.min(n - 1, Math.ceil(n * 0.98) - 1)] : 1;
    return { grid, width, height, bbox, nodata, elevMin, elevMax, stretchMin, stretchMax, validCount: n };
  }

  // --------------------------------------------------------------------------
  // Elevation sample / profile
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
    lon1: number, lat1: number, lon2: number, lat2: number, n = 200,
  ): Array<{ dist: number; elev: number | null }> {
    if (!this.lastResult) return [];
    const { grid, width, height, bbox, nodata } = this.lastResult;
    const [west, south, east, north] = bbox;
    const dlon = lon2 - lon1, dlat = lat2 - lat1;
    const latMid = (lat1 + lat2) / 2;
    const distKm = Math.sqrt(
      (dlat * 110.54) ** 2 + (dlon * 111.32 * Math.cos(latMid * Math.PI / 180)) ** 2,
    );

    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const lon = lon1 + t * dlon, lat = lat1 + t * dlat;
      const col = Math.round((lon - west)  / (east - west)   * (width  - 1));
      const row = Math.round((north - lat) / (north - south) * (height - 1));
      let elev: number | null = null;
      if (col >= 0 && col < width && row >= 0 && row < height) {
        const v = grid[row * width + col];
        if (isFinite(v) && (nodata === null || Math.abs(v - nodata) >= 0.001)) elev = v;
      }
      return { dist: t * distKm, elev };
    });
  }

  // --------------------------------------------------------------------------
  // Tool management
  // --------------------------------------------------------------------------

  private cancelTool(): void {
    this.activeTool = 'none';
    this.profilePoints = [];
    const map = this.mapManager.getMap();
    if (this.sampleClickHandler)  { map.off('click', this.sampleClickHandler);  this.sampleClickHandler  = null; }
    if (this.profileClickHandler) { map.off('click', this.profileClickHandler); this.profileClickHandler = null; }
    map.getCanvas().style.cursor = '';
    this.samplePopupEl?.remove();
    this.samplePopupEl = null;
    // Note: profilePanelEl is intentionally NOT removed here — it has its own close button.
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

        // Reset tool input state WITHOUT removing the profile panel
        if (this.profileClickHandler) {
          map.off('click', this.profileClickHandler);
          this.profileClickHandler = null;
        }
        map.getCanvas().style.cursor = '';
        this.activeTool = 'none';
        this.profilePoints = [];
        this.refreshToolbarButtons();

        // Show panel after resetting state (so cancelTool won't see it)
        this.showProfilePanel(pts);
      } else {
        // After first click, update hint
        this.refreshToolbarButtons();
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
    const map = this.mapManager.getMap();
    const pt = map.project([lon, lat]);
    const canv = map.getCanvas();
    el.style.left = `${pt.x * (canv.clientWidth / canv.width) + 12}px`;
    el.style.top  = `${pt.y * (canv.clientHeight / canv.height) - 24}px`;
    container.appendChild(el);
    this.samplePopupEl = el;
    setTimeout(() => { el.remove(); if (this.samplePopupEl === el) this.samplePopupEl = null; }, 4000);
  }

  private showProfilePanel(pts: Array<{ dist: number; elev: number | null }>): void {
    this.profilePanelEl?.remove();
    this.profilePanelEl = null;

    const valid = pts.filter(p => p.elev !== null) as Array<{ dist: number; elev: number }>;
    if (valid.length < 2) return;

    const distMax  = valid[valid.length - 1].dist;
    const elevMin  = Math.min(...valid.map(p => p.elev));
    const elevMax  = Math.max(...valid.map(p => p.elev));
    const elevRange = elevMax - elevMin || 1;

    const W = 340, H = 110, padL = 38, padR = 8, padT = 6, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const toX = (d: number) => padL + (d / Math.max(distMax, 1e-9)) * plotW;
    const toY = (e: number) => padT + plotH - ((e - elevMin) / elevRange) * plotH;

    let pathD = '';
    for (const p of valid) {
      const x = toX(p.dist).toFixed(1), y = toY(p.elev).toFixed(1);
      pathD += pathD ? ` L${x},${y}` : `M${x},${y}`;
    }

    // Filled area under the profile
    const firstX = toX(valid[0].dist).toFixed(1);
    const lastX  = toX(valid[valid.length - 1].dist).toFixed(1);
    const baseY  = (padT + plotH).toFixed(1);
    const areaD  = `${pathD} L${lastX},${baseY} L${firstX},${baseY} Z`;

    const yTicks = [elevMin, elevMin + elevRange / 2, elevMax].map(e =>
      `<text x="${padL - 3}" y="${toY(e).toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="#7a9" font-size="9">${e.toFixed(0)}</text>
       <line x1="${padL}" y1="${toY(e).toFixed(1)}" x2="${padL + plotW}" y2="${toY(e).toFixed(1)}" stroke="#1e3228" stroke-width="1"/>`,
    ).join('');

    const xLabel = distMax < 1 ? `${(distMax * 1000).toFixed(0)} m` : `${distMax.toFixed(2)} km`;

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0c1c14" rx="3"/>
      ${yTicks}
      <path d="${areaD}" fill="rgba(91,175,130,0.15)"/>
      <path d="${pathD}" fill="none" stroke="#5baf82" stroke-width="1.5"/>
      <text x="${padL}" y="${H - 5}" fill="#7a9" font-size="9">0</text>
      <text x="${padL + plotW}" y="${H - 5}" fill="#7a9" font-size="9" text-anchor="end">${xLabel}</text>
    </svg>`;

    const container = this.mapManager.getMap().getContainer();
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'bottom:70px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:30',
      'background:rgba(10,22,16,0.96)',
      'border:1px solid rgba(91,175,130,0.25)',
      'border-radius:6px', 'padding:8px 10px 6px',
      'pointer-events:auto',
      'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
    header.innerHTML = `<span style="font-size:10px;color:#7a9;letter-spacing:.04em;text-transform:uppercase">Elevation Profile</span><span style="font-size:10px;color:#5baf82;margin-left:8px">${elevMin.toFixed(0)}–${elevMax.toFixed(0)} m</span>`;

    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'background:none;border:none;color:#7a9;cursor:pointer;font-size:11px;padding:0 0 0 10px;line-height:1';
    close.addEventListener('click', () => { el.remove(); this.profilePanelEl = null; });
    header.appendChild(close);

    el.appendChild(header);
    const svgWrap = document.createElement('div');
    svgWrap.innerHTML = svg;
    el.appendChild(svgWrap);

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

    const contourLbl = document.createElement('span');
    contourLbl.className = 'hrdem-tb-contour-lbl';
    contourLbl.style.cssText = `font-size:10px;opacity:0.7;display:${this.contourEnabled ? '' : 'none'}`;
    this.updateContourLabelText(contourLbl);

    const sep1 = document.createElement('span');
    sep1.className = 'hrdem-tb-sep hrdem-tb-sep-contour';
    sep1.style.cssText = `width:1px;height:14px;background:rgba(255,255,255,0.15);flex-shrink:0;display:${this.contourEnabled ? '' : 'none'}`;

    const sampleBtn = document.createElement('button');
    sampleBtn.className = 'hrdem-tb-btn hrdem-tb-sample';
    sampleBtn.title = 'Click the map to read elevation at a point';
    sampleBtn.style.cssText = this.toolBtnStyle(false);
    sampleBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>&thinsp;Sample`;
    sampleBtn.addEventListener('click', () => this.activateSampleTool());

    const profileBtn = document.createElement('button');
    profileBtn.className = 'hrdem-tb-btn hrdem-tb-profile';
    profileBtn.title = 'Click two points to create an elevation profile';
    profileBtn.style.cssText = this.toolBtnStyle(false);
    profileBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,13 5,7 9,10 15,3"/></svg>&thinsp;Profile`;
    profileBtn.addEventListener('click', () => this.activateProfileTool());

    if (this.contourEnabled) { el.appendChild(contourLbl); el.appendChild(sep1); }
    el.appendChild(sampleBtn);
    el.appendChild(profileBtn);

    container.appendChild(el);
    this.toolbarEl = el;
  }

  private toolBtnStyle(active: boolean): string {
    return [
      'display:inline-flex', 'align-items:center', 'gap:3px',
      'background:' + (active ? 'rgba(91,175,130,0.2)' : 'none'),
      'border:1px solid ' + (active ? 'rgba(91,175,130,0.45)' : 'rgba(255,255,255,0.12)'),
      'border-radius:4px', 'color:' + (active ? '#5baf82' : '#c8d8c8'),
      'cursor:pointer', 'padding:2px 7px',
      'font-family:inherit', 'font-size:10px',
    ].join(';');
  }

  private refreshToolbarButtons(): void {
    if (!this.toolbarEl) return;
    const sampleBtn  = this.toolbarEl.querySelector<HTMLButtonElement>('.hrdem-tb-sample');
    const profileBtn = this.toolbarEl.querySelector<HTMLButtonElement>('.hrdem-tb-profile');
    if (sampleBtn)  sampleBtn.style.cssText  = this.toolBtnStyle(this.activeTool === 'sample');
    if (profileBtn) profileBtn.style.cssText = this.toolBtnStyle(this.activeTool === 'profile');

    const existing = this.toolbarEl.querySelector('.hrdem-tb-hint');
    existing?.remove();
    if (this.activeTool === 'profile') {
      const hint = document.createElement('span');
      hint.className = 'hrdem-tb-hint';
      hint.style.cssText = 'font-size:9px;opacity:0.55;margin-left:2px';
      hint.textContent = this.profilePoints.length === 0 ? 'Click start…' : 'Click end point…';
      this.toolbarEl.appendChild(hint);
    }
  }

  private refreshToolbarContourLabel(): void {
    if (!this.toolbarEl) return;
    const lbl = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-contour-lbl');
    const sep = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-sep-contour');
    if (lbl) { lbl.style.display = this.contourEnabled ? '' : 'none'; this.updateContourLabelText(lbl); }
    if (sep) sep.style.display = this.contourEnabled ? '' : 'none';
  }

  private updateContourLabelText(el: HTMLElement): void {
    const iv = this.contourInterval;
    const ivlLbl = iv < 1 ? `${iv}m` : `${iv % 1 === 0 ? iv.toFixed(0) : iv}m`;
    el.innerHTML = `<span style="display:inline-block;width:12px;height:0;border-top:1.5px solid ${this.contourColor};vertical-align:middle;margin-right:3px"></span>${ivlLbl} contours`;
  }

  private removeToolbar(): void {
    this.toolbarEl?.remove();
    this.toolbarEl = null;
  }

  // --------------------------------------------------------------------------
  // Legend
  // --------------------------------------------------------------------------

  private updateLegend(result: HRDEMResult | null): void {
    this.lastResult = result ?? this.lastResult;
    this.onLegendUpdate?.();
  }

  private buildLegendHTML(result: HRDEMResult | null): string {
    if (this.legendStatus === 'idle') return '';     // ← ADD THIS LINE
    if (this.legendStatus === 'loading') {
      return `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:4px;text-transform:uppercase">${this.productLabel()}</div>
              <div style="font-size:10px;opacity:0.7">⟳ Fetching…</div>`;
    }
    if (this.legendStatus === 'error') {
      return `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:4px;text-transform:uppercase">${this.productLabel()}</div>
              <div style="font-size:10px;color:#f87171;line-height:1.4;max-width:160px">⚠ ${this.legendError}</div>
              <div style="font-size:9px;opacity:0.5;margin-top:3px">Check browser console</div>`;
    }
    switch (this.hrdemProduct) {
      case 'slope':  return this.buildSlopeLegend(result);
      case 'aspect': return this.buildAspectLegend();
      case 'tpi':    return this.buildTPILegend(result);
      case 'chm':    return this.buildCHMLegend(result);
      default:       return this.buildElevationLegend(result);
    }
  }

  private productLabel(): string {
    return { elevation: 'Elevation', slope: 'Slope', aspect: 'Aspect', tpi: 'TPI', chm: 'Canopy Height' }[this.hrdemProduct] ?? 'Elevation';
  }

  private buildElevationLegend(result: HRDEMResult | null): string {
    const grad = rampToGradient(this.ramp);
    const minLbl = result ? `${result.stretchMin.toFixed(0)} m` : '—';
    const maxLbl = result ? `${result.stretchMax.toFixed(0)} m` : '—';
    const stats  = result ? `${result.elevMin.toFixed(0)}–${result.elevMax.toFixed(0)} m` : '';
    const iv = this.contourInterval;
    const ivlLbl = iv < 1 ? `${iv} m` : `${iv % 1 === 0 ? iv.toFixed(0) : iv} m`;
    const contourHud = this.contourEnabled
      ? `<div style="display:flex;align-items:center;gap:4px;font-size:9px;margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)">
           <span style="display:inline-block;width:14px;height:0;border-top:1.5px solid ${this.contourColor};opacity:0.85;flex-shrink:0"></span>
           <span style="opacity:0.65">${ivlLbl} contours</span></div>` : '';
    return `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Elevation</div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span>${maxLbl}</span><span>${minLbl}</span>
        </div>
      </div>
      ${stats ? `<div style="font-size:9px;opacity:0.45;margin-top:4px">${stats}</div>` : ''}
      ${contourHud}`;
  }

  private buildSlopeLegend(result: HRDEMResult | null): string {
    const ramp = this.resolveSlopeRamp();
    const grad = `linear-gradient(to top, ${ramp.stops.map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t*100).toFixed(0)}%`).join(',')})`;
    const unit = this.slopeUnit === 'percent' ? '%' : '°';
    const maxLbl = this.slopeStretch === '0-45' ? `45${unit}` : this.slopeStretch === '0-90' ? `90${unit}` : `max${unit}`;
    return `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Slope</div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span>${maxLbl}</span><span>0${unit}</span>
        </div>
      </div>
      ${result ? `<div style="font-size:9px;opacity:0.45;margin-top:4px">${result.validCount.toLocaleString()} px</div>` : ''}`;
  }

  private buildAspectLegend(): string {
    return `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Aspect</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;
          background:conic-gradient(from -90deg,
            hsl(0,${Math.round(this.aspectSat*100)}%,${Math.round(this.aspectLight*100)}%) 0deg,
            hsl(90,${Math.round(this.aspectSat*100)}%,${Math.round(this.aspectLight*100)}%) 90deg,
            hsl(180,${Math.round(this.aspectSat*100)}%,${Math.round(this.aspectLight*100)}%) 180deg,
            hsl(270,${Math.round(this.aspectSat*100)}%,${Math.round(this.aspectLight*100)}%) 270deg,
            hsl(360,${Math.round(this.aspectSat*100)}%,${Math.round(this.aspectLight*100)}%) 360deg);
          border:1px solid rgba(255,255,255,0.15)"></div>
        <div style="font-size:9px;line-height:1.6;opacity:0.7">N↑ &nbsp;E→<br>S↓ &nbsp;W←</div>
      </div>
      <div style="font-size:9px;opacity:0.4;margin-top:4px">Grey = flat</div>`;
  }

  private buildTPILegend(result: HRDEMResult | null): string {
    const ramp = this.resolveTpiRamp();
    const grad = `linear-gradient(to top, ${ramp.stops.map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t*100).toFixed(0)}%`).join(',')})`;
    return `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">TPI</div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span style="opacity:0.7">Ridge</span><span style="opacity:0.45">0</span><span style="opacity:0.7">Valley</span>
        </div>
      </div>
      ${result ? `<div style="font-size:9px;opacity:0.45;margin-top:4px">${result.validCount.toLocaleString()} px</div>` : ''}`;
  }

  private buildCHMLegend(result: HRDEMResult | null): string {
    const hdr = `<div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">Canopy Height</div>`;
    if (this.chmMode === 'stretch') {
      const ramp = this.resolveChmRamp();
      const grad = `linear-gradient(to top, ${ramp.stops.map(s => `rgb(${s.r},${s.g},${s.b}) ${(s.t*100).toFixed(0)}%`).join(',')})`;
      const maxLbl = result ? `${result.stretchMax.toFixed(1)} m` : '—';
      return `${hdr}
        <div style="display:flex;align-items:stretch;gap:7px">
          <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
          <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
            <span>${maxLbl}</span><span>0 m</span>
          </div>
        </div>`;
    }
    // Classified
    const rows = CHM_CLASSES.map(c =>
      `<div style="display:flex;align-items:center;gap:5px">
         <div style="width:12px;height:9px;border-radius:2px;background:rgb(${c.r},${c.g},${c.b});flex-shrink:0"></div>
         <span style="font-size:9px;opacity:0.75">${c.label}</span>
       </div>`,
    ).join('');
    return `${hdr}<div style="display:flex;flex-direction:column;gap:3px">${rows}</div>`;
  }
}

// ---------------------------------------------------------------------------
// HSL helper (exported for aspect renderer in elevationRenderer.ts context)
// ---------------------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 1/6) { r = c; g = x; b = 0; }
  else if (h < 2/6) { r = x; g = c; b = 0; }
  else if (h < 3/6) { r = 0; g = c; b = x; }
  else if (h < 4/6) { r = 0; g = x; b = c; }
  else if (h < 5/6) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
