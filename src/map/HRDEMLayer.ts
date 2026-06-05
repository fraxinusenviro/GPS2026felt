/**
 * HRDEM elevation layer for MapLibre.
 *
 * Follows the same activate / deactivate lifecycle as NSPRDVectorLayer and
 * NSHNVectorLayer so it integrates seamlessly with BasemapManager's
 * rebuildMap() loop.
 */

import maplibregl from 'maplibre-gl';
import proj4 from 'proj4';
import type { MapManager } from './MapManager';
import { fetchHRDEM, type HRDEMResult } from '../lib/hrdemWCS';
import { EventBus } from '../utils/EventBus';
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
import type { CutFillResult } from '../lib/cutFillEngine';

const DEBOUNCE_MS = 300;
const MIN_ZOOM    = 10;

const DTW_COG_URL  = 'https://nswetlands-mapping.s3.us-east-2.amazonaws.com/COG/DTW_cog.tif';
const DTW_CRS      = 'EPSG:22620';
const DTW_CRS_DEF  = '+proj=utm +zone=20 +ellps=GRS80 +units=m +no_defs';

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
  private contourInterval = 1;
  private contourColor    = '#000000';
  private contourWidth    = 0.5;
  private lastContourGeoJSON: GeoJSON.FeatureCollection | null = null;

  private instanceId     = '';
  private layerId        = '';
  private srcId          = '';
  private contourLayerId = '';
  private contourSrcId   = '';
  private active         = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private moveHandler: (() => void) | null = null;
  private toolbarEl: HTMLElement | null = null;
  private elevEventUnsubs: Array<() => void> = [];

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
  private profileLineSrcId         = '';
  private profileLineLayerId       = '';
  private profileLineBorderLayerId = '';
  private profileLineColor         = '#ffdd00';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private profileVertexMarkers: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private profileSegLabelMarkers: any[] = [];

  private sampleMode:    'elevation' | 'slope' | 'aspect' | 'chm' = 'elevation';
  private profileMode:   'dtm' | 'dsm' | 'both' | 'dtm+dtw' | 'dtm+dsm+dtw' = 'dtm';
  private profileChartH  = 160;
  private profilePanelW  = 0;    // 0 = auto (full container width minus margins)
  private profilePanelX: number | null = null;
  private profilePanelTop: number | null = null;
  private profileDtwSmooth = 0;  // moving-average radius for water table line
  private lastDTMResult: HRDEMResult | null = null;
  private lastDSMResult: HRDEMResult | null = null;
  private lastDTWResult: HRDEMResult | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedDTWTiff: any = null;
  private cutFillResultProvider: (() => CutFillResult | null) | null = null;

  constructor(private readonly mapManager: MapManager) {}

  setCutFillResultProvider(fn: (() => CutFillResult | null) | null): void {
    this.cutFillResultProvider = fn;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  activate(instanceId: string, opacity: number, visible: boolean, ramp?: ColorRamp): void {
    if (ramp) this.ramp = ramp;
    this.layerVisible    = visible;
    this.intendedOpacity = visible ? opacity : 0;
    this.removeMapLayers();

    this.instanceId              = instanceId;
    this.layerId                 = `bm-ov-${instanceId}`;
    this.srcId                   = `bmsrc-${instanceId}`;
    this.contourLayerId          = `bm-ov-${instanceId}-contour`;
    this.contourSrcId            = `bmsrc-${instanceId}-contour`;
    this.profileLineSrcId        = `bmsrc-${instanceId}-profline`;
    this.profileLineBorderLayerId = `bm-ov-${instanceId}-profborder`;
    this.profileLineLayerId      = `bm-ov-${instanceId}-profline`;
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

    map.addSource(this.profileLineSrcId, { type: 'geojson', data: EMPTY_FC });
    // Dark casing layer beneath the colored line for contrast
    map.addLayer(
      {
        id:     this.profileLineBorderLayerId,
        type:   'line',
        source: this.profileLineSrcId,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
        paint: {
          'line-color':   'rgba(0,0,0,0.55)',
          'line-width':   8,
          'line-opacity': 0.8,
        },
      },
      LAYER_IDS.COLLECTED_POLYGONS_FILL,
    );
    // Colored line on top — data-driven color keyed on seg_type property
    map.addLayer(
      {
        id:     this.profileLineLayerId,
        type:   'line',
        source: this.profileLineSrcId,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'line-color': ['match', ['get', 'seg_type'],
            'cut',      '#ef4444',
            'fill',     '#3b82f6',
            'existing', '#c0c0c0',
            this.profileLineColor,
          ] as any,
          'line-width':      4,
          'line-dasharray':  [5, 2],
          'line-opacity':    0.95,
        },
      },
      LAYER_IDS.COLLECTED_POLYGONS_FILL,
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
    if (!visible && this.toolbarEl) this.toolbarEl.style.display = 'none';
    else if (visible) this.refreshToolbarButtons();
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
      this.lastContourGeoJSON = null;
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

  /** Expose the current elevation grid for external tools (e.g. Cut/Fill). */
  public getLastResult(): HRDEMResult | null {
    return this.lastResult;
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
    this.lastContourGeoJSON = geojson as GeoJSON.FeatureCollection;
    src.setData(this.lastContourGeoJSON);
  }

  exportContourGeoJSON(): void {
    if (!this.lastContourGeoJSON) return;
    const iv = this.contourInterval;
    const ivStr = iv % 1 === 0 ? iv.toFixed(0) : String(iv);
    const filename = `contours-${ivStr}m.geojson`;
    const json = JSON.stringify(this.lastContourGeoJSON, null, 2);
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.download = filename; a.href = url; a.click();
    URL.revokeObjectURL(url);
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
    if (this.profileLineBorderLayerId && map.getLayer(this.profileLineBorderLayerId)) map.removeLayer(this.profileLineBorderLayerId);
    if (this.profileLineLayerId       && map.getLayer(this.profileLineLayerId))       map.removeLayer(this.profileLineLayerId);
    if (this.profileLineSrcId         && map.getSource(this.profileLineSrcId))        map.removeSource(this.profileLineSrcId);
    if (this.contourLayerId           && map.getLayer(this.contourLayerId))           map.removeLayer(this.contourLayerId);
    if (this.contourSrcId       && map.getSource(this.contourSrcId))      map.removeSource(this.contourSrcId);
    if (this.layerId            && map.getLayer(this.layerId))            map.removeLayer(this.layerId);
    if (this.srcId              && map.getSource(this.srcId))             map.removeSource(this.srcId);
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
        this.lastDTMResult = dtmResult;
        this.lastDSMResult = dsmResult;
        result = HRDEMLayer.computeCHMGrid(dtmResult, dsmResult);
      } else {
        result = await fetchHRDEM(west, south, east, north, targetW, targetH, this.surface);
        if (this.surface === 'dsm') this.lastDSMResult = result;
        else                        this.lastDTMResult = result;
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

  private sampleFromGrid(result: HRDEMResult | null, lon: number, lat: number): number | null {
    if (!result) return null;
    const { grid, width, height, bbox, nodata } = result;
    const [west, south, east, north] = bbox;
    const col = Math.round((lon - west) / (east - west) * (width  - 1));
    const row = Math.round((north - lat) / (north - south) * (height - 1));
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    const v = grid[row * width + col];
    if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) return null;
    return v;
  }

  private sampleElevationAt(lon: number, lat: number): number | null {
    return this.sampleFromGrid(this.lastResult, lon, lat);
  }

  private sampleSlopeAt(result: HRDEMResult, lon: number, lat: number): number | null {
    const { grid, width, height, bbox, nodata } = result;
    const [west, south, east, north] = bbox;
    const col = Math.round((lon - west) / (east - west) * (width - 1));
    const row = Math.round((north - lat) / (north - south) * (height - 1));
    if (col < 1 || col >= width - 1 || row < 1 || row >= height - 1) return null;
    const dx = (east - west) / (width  - 1) * 111320 * Math.cos(lat * Math.PI / 180);
    const dy = (north - south) / (height - 1) * 110540;
    const g = (r: number, c: number): number | null => {
      const v = grid[r * width + c];
      return isFinite(v) && (nodata === null || Math.abs(v - nodata) >= 0.001) ? v : null;
    };
    const z = [g(row-1,col-1),g(row-1,col),g(row-1,col+1),g(row,col-1),g(row,col+1),g(row+1,col-1),g(row+1,col),g(row+1,col+1)];
    if (z.some(v => v === null)) return null;
    const dzdx = ((z[2]! + 2*z[4]! + z[7]!) - (z[0]! + 2*z[3]! + z[5]!)) / (8 * dx);
    const dzdy = ((z[5]! + 2*z[6]! + z[7]!) - (z[0]! + 2*z[1]! + z[2]!)) / (8 * dy);
    return Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
  }

  private sampleAspectAt(result: HRDEMResult, lon: number, lat: number): number | null {
    const { grid, width, height, bbox, nodata } = result;
    const [west, south, east, north] = bbox;
    const col = Math.round((lon - west) / (east - west) * (width - 1));
    const row = Math.round((north - lat) / (north - south) * (height - 1));
    if (col < 1 || col >= width - 1 || row < 1 || row >= height - 1) return null;
    const g = (r: number, c: number): number | null => {
      const v = grid[r * width + c];
      return isFinite(v) && (nodata === null || Math.abs(v - nodata) >= 0.001) ? v : null;
    };
    const z = [g(row-1,col-1),g(row-1,col),g(row-1,col+1),g(row,col-1),g(row,col+1),g(row+1,col-1),g(row+1,col),g(row+1,col+1)];
    if (z.some(v => v === null)) return null;
    const dzdx = ((z[2]! + 2*z[4]! + z[7]!) - (z[0]! + 2*z[3]! + z[5]!)) / 8;
    const dzdy = ((z[5]! + 2*z[6]! + z[7]!) - (z[0]! + 2*z[1]! + z[2]!)) / 8;
    if (Math.abs(dzdx) < 1e-9 && Math.abs(dzdy) < 1e-9) return -1;
    return ((Math.atan2(dzdx, -dzdy) * 180 / Math.PI) + 360) % 360;
  }

  private sampleLayerAt(lon: number, lat: number): { value: number | null; label: string; unit: string } {
    const dtm = this.lastDTMResult ?? this.lastResult;
    switch (this.sampleMode) {
      case 'slope':
        return { value: dtm ? this.sampleSlopeAt(dtm, lon, lat) : null, label: 'Slope', unit: '°' };
      case 'aspect': {
        const v = dtm ? this.sampleAspectAt(dtm, lon, lat) : null;
        return { value: v === -1 ? null : v, label: 'Aspect', unit: v === -1 ? '(flat)' : '°N' };
      }
      case 'chm':
        if (this.lastDTMResult && this.lastDSMResult) {
          const chm = HRDEMLayer.computeCHMGrid(this.lastDTMResult, this.lastDSMResult);
          return { value: this.sampleFromGrid(chm, lon, lat), label: 'Canopy Ht', unit: 'm' };
        }
        if (this.hrdemProduct === 'chm' && this.lastResult)
          return { value: this.sampleFromGrid(this.lastResult, lon, lat), label: 'Canopy Ht', unit: 'm' };
        return { value: null, label: 'Canopy Ht', unit: 'm' };
      default:
        return { value: this.sampleFromGrid(dtm, lon, lat), label: 'Elevation', unit: 'm' };
    }
  }

  private computeSegDists(points: [number, number][]): number[] {
    const result: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [lon1, lat1] = points[i], [lon2, lat2] = points[i + 1];
      const dlon = lon2 - lon1, dlat = lat2 - lat1;
      const latMid = (lat1 + lat2) / 2;
      result.push(Math.sqrt(
        (dlat * 110.54) ** 2 + (dlon * 111.32 * Math.cos(latMid * Math.PI / 180)) ** 2,
      ));
    }
    return result;
  }

  /** Fetch the DTW COG for the current map viewport. Values are in cm. */
  private async fetchDTWForViewport(): Promise<HRDEMResult | null> {
    try {
      // Register CRS once
      try { proj4(DTW_CRS, 'EPSG:4326', [0, 0]); } catch {
        proj4.defs(DTW_CRS, DTW_CRS_DEF);
      }

      if (!this.cachedDTWTiff) {
        const { fromUrl } = await import('geotiff');
        this.cachedDTWTiff = await fromUrl(DTW_COG_URL);
      }

      const map    = this.mapManager.getMap();
      const bounds = map.getBounds();
      const w4326  = bounds.getWest(),  e4326 = bounds.getEast();
      const s4326  = bounds.getSouth(), n4326 = bounds.getNorth();

      const image = await this.cachedDTWTiff.getImage();
      const geoKeys  = (image as any).getGeoKeys?.() as Record<string, number> | undefined;
      const epsgCode = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? 22620;
      const nativeCrs = `EPSG:${epsgCode}`;
      try { proj4(nativeCrs, 'EPSG:4326', [0, 0]); } catch {
        proj4.defs(nativeCrs, DTW_CRS_DEF);
      }

      const [ox, oy] = image.getOrigin();
      const [rx, ry] = image.getResolution();
      const imgW = image.getWidth(), imgH = image.getHeight();

      const [swX, swY] = proj4('EPSG:4326', nativeCrs, [w4326, s4326]);
      const [neX, neY] = proj4('EPSG:4326', nativeCrs, [e4326, n4326]);

      const pxL = Math.max(0,    Math.floor((Math.min(swX, neX) - ox) / rx));
      const pxR = Math.min(imgW, Math.ceil( (Math.max(swX, neX) - ox) / rx));
      const pxT = Math.max(0,    Math.floor((Math.max(swY, neY) - oy) / ry));
      const pxB = Math.min(imgH, Math.ceil( (Math.min(swY, neY) - oy) / ry));

      if (pxL >= pxR || pxT >= pxB) return null;

      const maxPx = 512;
      const winW  = pxR - pxL, winH = pxB - pxT;
      const scale = Math.min(1, maxPx / Math.max(winW, winH));
      const outW  = Math.max(2, Math.round(winW * scale));
      const outH  = Math.max(2, Math.round(winH * scale));

      const rasters = await image.readRasters({
        window: [pxL, pxT, pxR, pxB], width: outW, height: outH,
        interleave: false, resampleMethod: 'bilinear',
      }) as unknown as ArrayLike<number>[];

      const nodata = (image as any).getGDALNoData?.() ?? null;
      const raw    = rasters[0];
      const grid   = raw instanceof Float32Array ? raw as Float32Array
                                                 : Float32Array.from(raw as ArrayLike<number>);

      const utmW = ox + pxL * rx;
      const utmN = oy + pxT * ry;
      const utmE = ox + pxR * rx;
      const utmS = oy + pxB * ry;

      const [geoW, geoS] = proj4(nativeCrs, 'EPSG:4326', [utmW, utmS]);
      const [geoE, geoN] = proj4(nativeCrs, 'EPSG:4326', [utmE, utmN]);

      return {
        grid, width: outW, height: outH, nodata,
        bbox: [geoW, geoS, geoE, geoN],
        elevMin: 0, elevMax: 9999, stretchMin: 0, stretchMax: 9999,
        validCount: outW * outH,
      };
    } catch (err) {
      console.error('[HRDEMLayer] DTW COG fetch failed:', err);
      return null;
    }
  }

  /**
   * Compute water table elevation profile from DTM + DTW profiles.
   * DTW values are in cm; result is in metres (same as DTM).
   * Returns null for any sample where either input is null.
   */
  private computeWaterTableProfile(
    dtmPts: Array<{ dist: number; elev: number | null }>,
    dtwPts: Array<{ dist: number; elev: number | null }>,
  ): Array<{ dist: number; elev: number | null }> {
    return dtmPts.map((p, i) => {
      const dtw = dtwPts[i]?.elev;
      if (p.elev === null || dtw === null || dtw === undefined) return { dist: p.dist, elev: null };
      return { dist: p.dist, elev: p.elev - dtw / 100.0 };
    });
  }

  private sampleProfileLineMulti(
    points: [number, number][], totalSamples = 200,
    overrideResult?: HRDEMResult | null,
  ): Array<{ dist: number; elev: number | null }> {
    const res = overrideResult !== undefined ? overrideResult : this.lastResult;
    if (!res || points.length < 2) return [];
    const { grid, width, height, bbox, nodata } = res;
    const [west, south, east, north] = bbox;

    const segDists = this.computeSegDists(points);
    const totalDist = segDists.reduce((a, b) => a + b, 0);
    if (totalDist === 0) return [];

    const result: Array<{ dist: number; elev: number | null }> = [];
    let accDist = 0;

    for (let seg = 0; seg < points.length - 1; seg++) {
      const [lon1, lat1] = points[seg], [lon2, lat2] = points[seg + 1];
      const segLen = segDists[seg];
      const isLast = seg === points.length - 2;
      const n = Math.max(2, Math.round((segLen / totalDist) * totalSamples));

      for (let i = 0; i <= (isLast ? n : n - 1); i++) {
        const t = i / n;
        const lon = lon1 + t * (lon2 - lon1), lat = lat1 + t * (lat2 - lat1);
        const col = Math.round((lon - west)  / (east - west)   * (width  - 1));
        const row = Math.round((north - lat) / (north - south) * (height - 1));
        let elev: number | null = null;
        if (col >= 0 && col < width && row >= 0 && row < height) {
          const v = grid[row * width + col];
          if (isFinite(v) && (nodata === null || Math.abs(v - nodata) >= 0.001)) elev = v;
        }
        result.push({ dist: accDist + t * segLen, elev });
      }
      accDist += segLen;
    }

    return result;
  }

  private sampleProfileLineCF(
    points: [number, number][],
    totalSamples: number,
    cfResult: CutFillResult,
  ): Array<{ dist: number; elev: number | null }> {
    const { modifiedGrid: grid, width, height, bbox, nodata } = cfResult;
    const [west, south, east, north] = bbox;
    if (points.length < 2) return [];

    const segDists = this.computeSegDists(points);
    const totalDist = segDists.reduce((a, b) => a + b, 0);
    if (totalDist === 0) return [];

    const result: Array<{ dist: number; elev: number | null }> = [];
    let accDist = 0;

    for (let seg = 0; seg < points.length - 1; seg++) {
      const [lon1, lat1] = points[seg], [lon2, lat2] = points[seg + 1];
      const segLen = segDists[seg];
      const isLast = seg === points.length - 2;
      const n = Math.max(2, Math.round((segLen / totalDist) * totalSamples));

      for (let i = 0; i <= (isLast ? n : n - 1); i++) {
        const t = i / n;
        const lon = lon1 + t * (lon2 - lon1), lat = lat1 + t * (lat2 - lat1);
        const col = Math.round((lon - west)  / (east - west)   * (width  - 1));
        const row = Math.round((north - lat) / (north - south) * (height - 1));
        let elev: number | null = null;
        if (col >= 0 && col < width && row >= 0 && row < height) {
          const v = grid[row * width + col];
          if (isFinite(v) && (nodata === null || Math.abs(v - nodata) >= 0.001)) elev = v;
        }
        result.push({ dist: accDist + t * segLen, elev });
      }
      accDist += segLen;
    }

    return result;
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
    this.clearProfileLine();
    // Note: profilePanelEl is intentionally NOT removed here — it has its own close button.
    this.refreshToolbarButtons();
  }

  private clearProfileLine(): void {
    for (const m of this.profileVertexMarkers) m.remove();
    this.profileVertexMarkers = [];
    for (const m of this.profileSegLabelMarkers) m.remove();
    this.profileSegLabelMarkers = [];
    if (!this.profileLineSrcId) return;
    const src = this.mapManager.getMap().getSource(this.profileLineSrcId) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(EMPTY_FC);
  }

  private updateProfileLineOnMap(): void {
    if (!this.profileLineSrcId) return;
    const src = this.mapManager.getMap().getSource(this.profileLineSrcId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (this.profilePoints.length < 2) {
      src.setData(EMPTY_FC);
      this.updateVertexMarkers();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: this.profilePoints },
        properties: {},
      }],
    } as any);
    this.updateVertexMarkers();
  }

  private buildColorCodedLineFeatures(
    points: [number, number][],
    ptsDTM: Array<{ dist: number; elev: number | null }>,
    ptsCF:  Array<{ dist: number; elev: number | null }>,
  ): GeoJSON.Feature[] {
    const segDists  = this.computeSegDists(points);
    const totalDist = segDists.reduce((a, b) => a + b, 0);
    if (totalDist === 0 || ptsDTM.length === 0) return [];

    // Interpolate lng/lat at cumulative distance d along the polyline
    const lnglat = (d: number): [number, number] => {
      let acc = 0;
      for (let s = 0; s < points.length - 1; s++) {
        const sd = segDists[s];
        if (s === points.length - 2 || acc + sd >= d - 1e-9) {
          const t = sd > 0 ? Math.min(1, (d - acc) / sd) : 0;
          return [
            points[s][0] + t * (points[s + 1][0] - points[s][0]),
            points[s][1] + t * (points[s + 1][1] - points[s][1]),
          ];
        }
        acc += sd;
      }
      return points[points.length - 1];
    };

    type Sample = { lon: number; lat: number; seg_type: string };
    const samples: Sample[] = ptsDTM.map((p, i) => {
      const cfElev  = ptsCF[i]?.elev ?? null;
      const dtmElev = p.elev;
      let seg_type = 'existing';
      if (dtmElev !== null && cfElev !== null) {
        if (dtmElev > cfElev + 0.15)      seg_type = 'cut';
        else if (dtmElev < cfElev - 0.15) seg_type = 'fill';
      }
      const [lon, lat] = lnglat(p.dist);
      return { lon, lat, seg_type };
    });

    const features: GeoJSON.Feature[] = [];
    let i = 0;
    while (i < samples.length) {
      const type   = samples[i].seg_type;
      const coords: [number, number][] = [];
      while (i < samples.length && samples[i].seg_type === type) {
        coords.push([samples[i].lon, samples[i].lat]);
        i++;
      }
      // Bridge: include first point of the next group to eliminate gaps
      if (i < samples.length) coords.push([samples[i].lon, samples[i].lat]);
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { seg_type: type },
        } as GeoJSON.Feature);
      }
    }
    return features;
  }

  private updateVertexMarkers(): void {
    for (const m of this.profileVertexMarkers) m.remove();
    this.profileVertexMarkers = [];
    if (!this.profileLineSrcId) return;
    const map = this.mapManager.getMap();
    this.profilePoints.forEach(([lon, lat], i) => {
      const label = String.fromCharCode(65 + i);
      const el = document.createElement('div');
      el.style.cssText = [
        `background:${this.profileLineColor}`,
        'color:#000', 'width:18px', 'height:18px', 'border-radius:50%',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:9px', 'font-weight:bold', 'font-family:sans-serif',
        'border:2px solid rgba(0,0,0,0.45)',
        'box-shadow:0 1px 6px rgba(0,0,0,0.55)',
        'pointer-events:none', 'user-select:none',
      ].join(';');
      el.textContent = label;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const marker = new (maplibregl as any).Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .addTo(map);
      this.profileVertexMarkers.push(marker);
    });
  }

  private updateSegmentLabels(points: [number, number][], segDists: number[]): void {
    for (const m of this.profileSegLabelMarkers) m.remove();
    this.profileSegLabelMarkers = [];
    if (!this.profileLineSrcId || points.length < 2) return;
    const map = this.mapManager.getMap();
    for (let i = 0; i < points.length - 1; i++) {
      const midLon = (points[i][0] + points[i + 1][0]) / 2;
      const midLat = (points[i][1] + points[i + 1][1]) / 2;
      const d = segDists[i];
      const lbl = d < 1 ? `${(d * 1000).toFixed(0)} m` : `${d.toFixed(2)} km`;
      const el = document.createElement('div');
      el.style.cssText = [
        `background:rgba(0,0,0,0.7)`,
        `border:1px solid ${this.profileLineColor}`,
        'color:#fff', 'border-radius:3px',
        'padding:1px 4px', 'font-size:9px', 'font-family:sans-serif',
        'white-space:nowrap', 'pointer-events:none', 'user-select:none',
      ].join(';');
      el.textContent = lbl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const marker = new (maplibregl as any).Marker({ element: el, anchor: 'center' })
        .setLngLat([midLon, midLat])
        .addTo(map);
      this.profileSegLabelMarkers.push(marker);
    }
  }

  activateSampleTool(): void {
    if (this.activeTool === 'sample') { this.cancelTool(); return; }
    this.cancelTool();
    this.activeTool = 'sample';
    const map = this.mapManager.getMap();
    map.getCanvas().style.cursor = 'crosshair';

    this.sampleClickHandler = (e: maplibregl.MapMouseEvent) => {
      const { value, label, unit } = this.sampleLayerAt(e.lngLat.lng, e.lngLat.lat);
      this.showSamplePopup(e.lngLat.lng, e.lngLat.lat, value, label, unit);
    };
    map.on('click', this.sampleClickHandler);
    this.refreshToolbarButtons();
  }

  activateProfileTool(): void {
    if (this.activeTool === 'profile') { this.cancelTool(); return; }
    // Clear any existing completed profile before starting a new one
    this.profilePanelEl?.remove();
    this.profilePanelEl = null;
    this.cancelTool();
    this.activeTool = 'profile';
    this.profilePoints = [];
    const map = this.mapManager.getMap();
    map.getCanvas().style.cursor = 'crosshair';

    this.profileClickHandler = (e: maplibregl.MapMouseEvent) => {
      this.profilePoints.push([e.lngLat.lng, e.lngLat.lat]);
      this.updateProfileLineOnMap();
      this.refreshToolbarButtons();
    };
    map.on('click', this.profileClickHandler);
    this.refreshToolbarButtons();
  }

  private async finishProfileTool(): Promise<void> {
    if (this.profilePoints.length < 2) return;
    const segDists    = this.computeSegDists(this.profilePoints);
    const savedPoints = [...this.profilePoints] as [number, number][];

    const map = this.mapManager.getMap();
    if (this.profileClickHandler) {
      map.off('click', this.profileClickHandler);
      this.profileClickHandler = null;
    }
    map.getCanvas().style.cursor = '';
    this.activeTool = 'none';
    this.profilePoints = [];
    this.refreshToolbarButtons();

    if (map.getLayer(this.profileLineLayerId)) {
      map.setPaintProperty(this.profileLineLayerId, 'line-dasharray', [1, 0]);
    }

    const needsDSM = this.profileMode === 'dsm' || this.profileMode === 'both' || this.profileMode === 'dtm+dsm+dtw';
    const needsDTM = this.profileMode !== 'dsm';  // all modes except pure-DSM need DTM
    const needsDTW = this.profileMode === 'dtm+dtw' || this.profileMode === 'dtm+dsm+dtw';

    const bounds = map.getBounds();
    const mc     = map.getCanvas();
    const bW = bounds.getWest(), bS = bounds.getSouth(), bE = bounds.getEast(), bN = bounds.getNorth();
    const sz = mc.width || 512;

    // Always fetch fresh data for the current viewport so the bbox covers the drawn profile
    const fetches: Promise<void>[] = [];

    if (needsDTM) {
      fetches.push(
        fetchHRDEM(bW, bS, bE, bN, sz, sz, 'dtm')
          .then(r => { this.lastDTMResult = r; })
          .catch(err => console.error('[HRDEMLayer] DTM fetch for profile failed:', err)),
      );
    }

    if (needsDSM) {
      fetches.push(
        fetchHRDEM(bW, bS, bE, bN, sz, sz, 'dsm')
          .then(r => { this.lastDSMResult = r; })
          .catch(err => console.error('[HRDEMLayer] DSM fetch for profile failed:', err)),
      );
    }

    await Promise.all(fetches);

    // Fetch DTW (depth to water) on-demand when required
    if (needsDTW) {
      this.lastDTWResult = await this.fetchDTWForViewport();
    }

    const dtmRes = this.lastDTMResult;

    let pts: Array<{ dist: number; elev: number | null }>;
    let pts2: Array<{ dist: number; elev: number | null }> | undefined;
    let pts3: Array<{ dist: number; elev: number | null }> | undefined;
    let pts4: Array<{ dist: number; elev: number | null }> | undefined;

    if (this.profileMode === 'dsm') {
      pts = this.sampleProfileLineMulti(savedPoints, 200, this.lastDSMResult);
    } else {
      pts = this.sampleProfileLineMulti(savedPoints, 200, dtmRes);
    }

    if ((this.profileMode === 'both' || this.profileMode === 'dtm+dsm+dtw') && this.lastDSMResult) {
      pts2 = this.sampleProfileLineMulti(savedPoints, 200, this.lastDSMResult);
    }

    if (needsDTW && this.lastDTWResult) {
      const dtwRaw = this.sampleProfileLineMulti(savedPoints, 200, this.lastDTWResult);
      pts3 = this.computeWaterTableProfile(pts, dtwRaw);
    }

    // Sample cut/fill surface if a result is available and overlaps the profile line
    const cfResult = this.cutFillResultProvider?.();
    if (cfResult) {
      const cfSamples = this.sampleProfileLineCF(savedPoints, 200, cfResult);
      // Only include if at least some points fell within the cut/fill bbox
      if (cfSamples.some(p => p.elev !== null)) {
        pts4 = cfSamples;
      }
    }

    this.showProfilePanel(pts, segDists, pts2, pts3, pts4);

    // Color-code the map line using cut/fill classification when C/F data is present
    if (pts4 && pts4.some(p => p.elev !== null)) {
      const dtmPts = this.profileMode === 'dsm'
        ? this.sampleProfileLineMulti(savedPoints, 200, this.lastDTMResult)
        : pts;
      const coloredFeatures = this.buildColorCodedLineFeatures(savedPoints, dtmPts, pts4);
      if (coloredFeatures.length > 0 && this.profileLineSrcId) {
        const src = this.mapManager.getMap().getSource(this.profileLineSrcId) as maplibregl.GeoJSONSource | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        src?.setData({ type: 'FeatureCollection', features: coloredFeatures } as any);
      }
    }

    // Add segment distance labels on the map
    this.updateSegmentLabels(savedPoints, segDists);

    // Bring profile line layers above C/F run layers (which insert before collected-points)
    const mapFinal = this.mapManager.getMap();
    if (mapFinal.getLayer(this.profileLineBorderLayerId) && mapFinal.getLayer(LAYER_IDS.COLLECTED_POINTS)) {
      try { mapFinal.moveLayer(this.profileLineBorderLayerId, LAYER_IDS.COLLECTED_POINTS); } catch { /* ignore */ }
      try { mapFinal.moveLayer(this.profileLineLayerId,       LAYER_IDS.COLLECTED_POINTS); } catch { /* ignore */ }
    }
  }

  private showSamplePopup(
    lon: number, lat: number,
    value: number | null, label = 'Elevation', unit = 'm',
  ): void {
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
    const valueTxt = value !== null ? `${value.toFixed(1)} ${unit}` : 'No data';
    el.innerHTML = `<b style="font-size:12px">${valueTxt}</b>&ensp;<span style="font-size:9px;opacity:0.6">${label}</span><br><span style="font-size:9px;opacity:0.45">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`;
    const map = this.mapManager.getMap();
    const pt = map.project([lon, lat]);
    const canv = map.getCanvas();
    el.style.left = `${pt.x * (canv.clientWidth / canv.width) + 12}px`;
    el.style.top  = `${pt.y * (canv.clientHeight / canv.height) - 24}px`;
    container.appendChild(el);
    this.samplePopupEl = el;
    setTimeout(() => { el.remove(); if (this.samplePopupEl === el) this.samplePopupEl = null; }, 4000);
  }

  private buildProfileSvg(
    valid: Array<{ dist: number; elev: number }>,
    elevMin: number, elevMax: number, elevRange: number, distMax: number,
    segDists: number[],
    lineColor: string,
    W: number, H: number,
    padL: number, padR: number, padT: number, padB: number,
    fs: number,
    valid2?: Array<{ dist: number; elev: number }>,  // optional DSM profile
    valid3?: Array<{ dist: number; elev: number }>,  // optional water table profile (DTM - DTW/100)
    valid4?: Array<{ dist: number; elev: number }>,  // optional Cut/Fill surface profile
  ): string {
    // padB carries all bottom-area space (axis labels, optional legend row, segment row)
    // No separate legRowReserve needed — padB is sized to fit everything
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const toX = (d: number) => padL + (d / Math.max(distMax, 1e-9)) * plotW;
    const toY = (e: number) => padT + plotH - ((e - elevMin) / (elevRange || 1)) * plotH;

    // Primary (DTM) path
    let pathD = '';
    for (const p of valid) {
      const x = toX(p.dist).toFixed(1), y = toY(p.elev).toFixed(1);
      pathD += pathD ? ` L${x},${y}` : `M${x},${y}`;
    }
    const firstX = toX(valid[0].dist).toFixed(1);
    const lastX  = toX(valid[valid.length - 1].dist).toFixed(1);
    const baseY  = (padT + plotH).toFixed(1);
    const areaD  = `${pathD} L${lastX},${baseY} L${firstX},${baseY} Z`;

    // Optional second (DSM) path and canopy fill
    let path2Svg = '';
    if (valid2 && valid2.length > 1) {
      let path2D = '';
      for (const p of valid2) {
        const x = toX(p.dist).toFixed(1), y = toY(p.elev).toFixed(1);
        path2D += path2D ? ` L${x},${y}` : `M${x},${y}`;
      }
      // Canopy fill: forward along DSM, backward along DTM
      let canopyD = path2D;
      for (let i = valid.length - 1; i >= 0; i--) {
        canopyD += ` L${toX(valid[i].dist).toFixed(1)},${toY(valid[i].elev).toFixed(1)}`;
      }
      canopyD += ' Z';
      path2Svg = `<path d="${canopyD}" fill="rgba(100,200,100,0.15)"/>
                  <path d="${path2D}" fill="none" stroke="#88ccff" stroke-width="1.5" stroke-dasharray="4,2"/>`;
    }

    // Optional third (water table) path — plotted below DTM
    let path3Svg = '';
    if (valid3 && valid3.length > 1) {
      let path3D = '';
      for (const p of valid3) {
        const x = toX(p.dist).toFixed(1), y = toY(p.elev).toFixed(1);
        path3D += path3D ? ` L${x},${y}` : `M${x},${y}`;
      }
      // Saturated zone fill: forward along DTM, backward along water table
      let satD = pathD;
      for (let i = valid3.length - 1; i >= 0; i--) {
        satD += ` L${toX(valid3[i].dist).toFixed(1)},${toY(valid3[i].elev).toFixed(1)}`;
      }
      satD += ' Z';
      path3Svg = `<path d="${satD}" fill="rgba(21,101,192,0.12)"/>
                  <path d="${path3D}" fill="none" stroke="#1e88e5" stroke-width="1.5"/>`;
    }

    // Optional fourth (Cut/Fill modified surface) path — orange line
    let path4Svg = '';
    if (valid4 && valid4.length > 1) {
      let path4D = '';
      for (const p of valid4) {
        const x = toX(p.dist).toFixed(1), y = toY(p.elev).toFixed(1);
        path4D += path4D ? ` L${x},${y}` : `M${x},${y}`;
      }
      path4Svg = `<path d="${path4D}" fill="none" stroke="#fb923c" stroke-width="2" stroke-dasharray="6,3"/>`;
    }

    // Y-axis: short tick marks + grid lines + labels offset to clear ticks
    const yTicks = [elevMin, elevMin + elevRange / 2, elevMax].map(e => {
      const ty = toY(e).toFixed(1);
      return `<line x1="${padL - 5}" y1="${ty}" x2="${padL}" y2="${ty}" stroke="#6a9a78" stroke-width="1"/>
              <line x1="${padL}" y1="${ty}" x2="${(padL + plotW).toFixed(1)}" y2="${ty}" stroke="#1e3228" stroke-width="1"/>
              <text x="${padL - 9}" y="${ty}" text-anchor="end" dominant-baseline="middle" fill="#7aaa88" font-size="${fs}" font-family="sans-serif">${e.toFixed(0)}</text>`;
    }).join('');

    // Cumulative distances at each vertex
    const vertexDists: number[] = [0];
    for (const d of segDists) vertexDists.push(vertexDists[vertexDists.length - 1] + d);

    const plotRight = padL + plotW;
    const plotBottom = padT + plotH;
    const vertexSvg = vertexDists.map((vd, i) => {
      const lbl = String.fromCharCode(65 + i);
      const vx  = toX(vd);
      const closestPt = valid.reduce((best, p) =>
        Math.abs(p.dist - vd) < Math.abs(best.dist - vd) ? p : best,
      );
      const vy = toY(closestPt.elev);
      const elevLbl  = `${closestPt.elev.toFixed(0)}m`;
      const nearRight = vx + 28 > plotRight;
      const lblAnchor = nearRight ? 'end' : 'start';
      const lblX      = nearRight ? vx - 6 : vx + 6;
      const lblY      = vy - 7;
      return `<line x1="${vx.toFixed(1)}" y1="${padT}" x2="${vx.toFixed(1)}" y2="${plotBottom.toFixed(1)}" stroke="${lineColor}" stroke-width="1" stroke-dasharray="2,2" opacity="0.55"/>
              <circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="3.5" fill="${lineColor}" stroke="#0c1c14" stroke-width="1.5"/>
              <text x="${vx.toFixed(1)}" y="${(padT - 3).toFixed(1)}" text-anchor="middle" fill="${lineColor}" font-size="${fs}" font-family="sans-serif" font-weight="bold">${lbl}</text>
              <text x="${lblX.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="${lblAnchor}" fill="${lineColor}" font-size="${Math.max(7, fs - 1)}" font-family="sans-serif" opacity="0.85">${elevLbl}</text>`;
    }).join('');

    const lfs    = Math.max(7, fs - 1);
    const xLabel = distMax < 1 ? `${(distMax * 1000).toFixed(0)} m` : `${distMax.toFixed(2)} km`;

    // X-axis: tick marks at 0, mid, and max; labels offset below ticks
    const xTickY2  = plotBottom + 5;
    const xAxisY   = plotBottom + 17;
    const xTicksSvg = [padL, padL + plotW / 2, padL + plotW].map(x =>
      `<line x1="${x.toFixed(1)}" y1="${plotBottom}" x2="${x.toFixed(1)}" y2="${xTickY2}" stroke="#6a9a78" stroke-width="1"/>`,
    ).join('');

    // Bottom rows: legend frame then segment labels
    const hasMulti = (valid2 && valid2.length > 1) || (valid3 && valid3.length > 1) || (valid4 && valid4.length > 1);
    const legItems: Array<{ stroke: string; dash?: string; label: string }> = hasMulti
      ? [
          { stroke: lineColor, label: 'DTM' },
          ...((valid2 && valid2.length > 1) ? [{ stroke: '#88ccff', dash: '4,2', label: 'DSM' }] : []),
          ...((valid3 && valid3.length > 1) ? [{ stroke: '#1e88e5', label: 'Water Table' }] : []),
          ...((valid4 && valid4.length > 1) ? [{ stroke: '#fb923c', dash: '6,3', label: 'Cut/Fill' }] : []),
        ]
      : [];

    const legFrameTop = plotBottom + 29;
    const legFrameH   = 16;
    const legItemY    = legFrameTop + legFrameH / 2 + 3;  // vertically centred in frame
    const segRowY     = H - 8;

    let legendSvg = '';
    if (legItems.length > 0) {
      const slotW = plotW / legItems.length;
      const items = legItems.map((item, i) => {
        const cx       = padL + slotW * (i + 0.5);
        const estTextW = item.label.length * lfs * 0.58;
        const totalW   = 20 + 4 + estTextW;
        const sx       = cx - totalW / 2;
        const dashAttr = item.dash ? ` stroke-dasharray="${item.dash}"` : '';
        return `<line x1="${sx.toFixed(1)}" y1="${legItemY - 3}" x2="${(sx + 20).toFixed(1)}" y2="${legItemY - 3}" stroke="${item.stroke}" stroke-width="1.5"${dashAttr}/>
                <text x="${(sx + 24).toFixed(1)}" y="${legItemY}" fill="${item.stroke}" font-size="${lfs}" font-family="sans-serif">${item.label}</text>`;
      }).join('');
      legendSvg = `<rect x="${padL}" y="${legFrameTop}" width="${plotW.toFixed(1)}" height="${legFrameH}" fill="rgba(0,0,0,0.25)" rx="3" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>
                   ${items}`;
    }

    // Segment lengths row
    const segLabels = segDists.map((d, i) => {
      const a = String.fromCharCode(65 + i), b = String.fromCharCode(66 + i);
      const dLbl = d < 1 ? `${(d * 1000).toFixed(0)} m` : `${d.toFixed(2)} km`;
      return `${a}–${b}: ${dLbl}`;
    }).join('   ');

    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#0c1c14" rx="3"/>
      ${yTicks}
      ${path2Svg}
      ${path3Svg}
      ${vertexSvg}
      <path d="${areaD}" fill="rgba(91,175,130,0.13)"/>
      <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="1.8"/>
      ${path4Svg}
      ${xTicksSvg}
      <text x="${padL}" y="${xAxisY}" fill="#7aaa88" font-size="${fs}" font-family="sans-serif">0</text>
      <text x="${plotRight.toFixed(1)}" y="${xAxisY}" fill="#7aaa88" font-size="${fs}" font-family="sans-serif" text-anchor="end">${xLabel}</text>
      ${legendSvg}
      <text x="${padL}" y="${segRowY}" fill="#5a7a60" font-size="${lfs}" font-family="sans-serif">${segLabels}</text>
    </svg>`;
  }

  private showProfilePanel(
    pts: Array<{ dist: number; elev: number | null }>,
    segDists: number[],
    pts2?: Array<{ dist: number; elev: number | null }>,
    pts3?: Array<{ dist: number; elev: number | null }>,
    pts4?: Array<{ dist: number; elev: number | null }>,
  ): void {
    this.profilePanelEl?.remove();
    this.profilePanelEl = null;

    const valid = pts.filter(p => p.elev !== null) as Array<{ dist: number; elev: number }>;
    if (valid.length < 2) return;

    const valid2 = pts2
      ? (pts2.filter(p => p.elev !== null) as Array<{ dist: number; elev: number }>)
      : undefined;
    const valid3 = pts3
      ? (pts3.filter(p => p.elev !== null) as Array<{ dist: number; elev: number }>)
      : undefined;
    const valid4 = pts4
      ? (pts4.filter(p => p.elev !== null) as Array<{ dist: number; elev: number }>)
      : undefined;

    const distMax = valid[valid.length - 1].dist;
    let elevMin   = Math.min(...valid.map(p => p.elev));
    let elevMax   = Math.max(...valid.map(p => p.elev));
    if (valid2 && valid2.length > 0) {
      elevMin = Math.min(elevMin, ...valid2.map(p => p.elev));
      elevMax = Math.max(elevMax, ...valid2.map(p => p.elev));
    }
    if (valid3 && valid3.length > 0) {
      // Water table can extend below DTM — always include in range
      elevMin = Math.min(elevMin, ...valid3.map(p => p.elev));
      elevMax = Math.max(elevMax, ...valid3.map(p => p.elev));
    }
    if (valid4 && valid4.length > 0) {
      elevMin = Math.min(elevMin, ...valid4.map(p => p.elev));
      elevMax = Math.max(elevMax, ...valid4.map(p => p.elev));
    }
    const elevRange = elevMax - elevMin || 1;

    const container = this.mapManager.getMap().getContainer();

    // Sizing / positioning — persists across re-opens via class fields
    const initPanelW = this.profilePanelW > 0 ? this.profilePanelW : container.clientWidth - 20;
    let W = Math.max(300, initPanelW - 20); // SVG inner width (panel minus 10px padding each side)
    const padL = 40, padR = 10, padT = 18, padB = 58;

    // Visibility + smoothing flags for optional profile series
    let showDsm = true;
    let showDtw = true;
    let showCf  = true;
    let dtwSmooth = this.profileDtwSmooth;

    const smoothPts = (pts: Array<{dist: number; elev: number}>, r: number) => {
      if (r <= 0 || pts.length < 3) return pts;
      return pts.map((p, i) => {
        const lo = Math.max(0, i - r), hi = Math.min(pts.length - 1, i + r);
        const sum = pts.slice(lo, hi + 1).reduce((a, b) => a + b.elev, 0);
        return { dist: p.dist, elev: sum / (hi - lo + 1) };
      });
    };

    const buildSvg = () => this.buildProfileSvg(
      valid, elevMin, elevMax, elevRange, distMax, segDists,
      this.profileLineColor, W, this.profileChartH, padL, padR, padT, padB, 9,
      (showDsm && valid2 && valid2.length > 1) ? valid2 : undefined,
      (showDtw && valid3 && valid3.length > 1) ? smoothPts(valid3, dtwSmooth) : undefined,
      (showCf  && valid4 && valid4.length > 1) ? valid4 : undefined,
    );

    const el = document.createElement('div');
    // Start at stored position if previously dragged; otherwise default to bottom-left
    if (this.profilePanelX !== null && this.profilePanelTop !== null) {
      el.style.cssText = [
        'position:absolute',
        `left:${this.profilePanelX}px`,
        `top:${this.profilePanelTop}px`,
        `width:${initPanelW}px`,
        'z-index:30',
        'background:rgba(10,22,16,0.96)',
        'border:1px solid rgba(91,175,130,0.25)',
        'border-radius:6px', 'padding:8px 10px 6px',
        'pointer-events:auto',
        'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
      ].join(';');
    } else {
      el.style.cssText = [
        'position:absolute', 'bottom:70px', 'left:10px',
        `width:${initPanelW}px`,
        'z-index:30',
        'background:rgba(10,22,16,0.96)',
        'border:1px solid rgba(91,175,130,0.25)',
        'border-radius:6px', 'padding:8px 10px 6px',
        'pointer-events:auto',
        'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
      ].join(';');
    }

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;cursor:move;user-select:none';

    // ── Drag-to-move the entire panel ─────────────────────────────────────────
    header.addEventListener('pointerdown', (startEvt) => {
      if ((startEvt.target as HTMLElement).closest('button,select,input')) return;
      startEvt.preventDefault();
      header.setPointerCapture(startEvt.pointerId);
      const contRect = container.getBoundingClientRect();
      const elRect   = el.getBoundingClientRect();
      const startL   = elRect.left  - contRect.left;
      const startT   = elRect.top   - contRect.top;
      el.style.left   = `${startL}px`;
      el.style.top    = `${startT}px`;
      el.style.bottom = '';
      const ox = startEvt.clientX, oy = startEvt.clientY;

      const onMove = (e: PointerEvent) => {
        e.preventDefault();
        const newL = Math.max(0, Math.min(container.clientWidth  - el.offsetWidth,  startL + (e.clientX - ox)));
        const newT = Math.max(0, Math.min(container.clientHeight - el.offsetHeight, startT + (e.clientY - oy)));
        el.style.left = `${newL}px`;
        el.style.top  = `${newT}px`;
        this.profilePanelX   = newL;
        this.profilePanelTop = newT;
      };
      const onUp = () => {
        header.removeEventListener('pointermove', onMove);
        header.removeEventListener('pointerup',   onUp);
      };
      header.addEventListener('pointermove', onMove);
      header.addEventListener('pointerup',   onUp);
    });

    const titleWrap = document.createElement('span');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:6px';
    titleWrap.innerHTML = `<span style="font-size:10px;color:#7a9;letter-spacing:.04em;text-transform:uppercase">Elevation Profile</span><span style="font-size:10px;color:#5baf82">${elevMin.toFixed(0)}–${elevMax.toFixed(0)} m</span>`;

    const btnWrap = document.createElement('span');
    btnWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:8px';

    const snapBtn = document.createElement('button');
    snapBtn.title = 'Save snapshot (map + profile)';
    snapBtn.style.cssText = 'background:none;border:1px solid rgba(91,175,130,0.3);border-radius:3px;color:#7a9;cursor:pointer;padding:2px 6px;line-height:1;display:inline-flex;align-items:center';
    snapBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-44,76a36,36,0,1,1-36-36A36,36,0,0,1,164,132Z"/></svg>';
    snapBtn.addEventListener('click', () =>
      this.takeSnapshot(
        valid, elevMin, elevMax, el, elevRange, distMax, segDists,
        (showDsm && valid2 && valid2.length > 1) ? valid2 : undefined,
        (showDtw && valid3 && valid3.length > 1) ? valid3 : undefined,
        (showCf  && valid4 && valid4.length > 1) ? valid4 : undefined,
      ),
    );

    const close = document.createElement('button');
    close.innerHTML = '&#10005;';
    close.title = 'Close';
    close.style.cssText = 'background:none;border:none;color:#aac8aa;cursor:pointer;font-size:15px;padding:0;line-height:1';
    close.addEventListener('click', () => {
      el.remove();
      this.profilePanelEl = null;
      this.clearProfileLine();
    });

    btnWrap.appendChild(snapBtn);
    btnWrap.appendChild(close);
    header.appendChild(titleWrap);
    header.appendChild(btnWrap);

    // Drag-to-resize grip: dragging up grows the chart, dragging down shrinks it
    const resizeGrip = document.createElement('div');
    resizeGrip.title = 'Drag to resize chart';
    resizeGrip.style.cssText = [
      'display:flex', 'justify-content:center', 'align-items:center',
      'height:10px', 'cursor:ns-resize', 'user-select:none', 'touch-action:none',
      'margin:2px 0 2px', 'opacity:0.55',
    ].join(';');
    resizeGrip.innerHTML = '<svg width="48" height="6" viewBox="0 0 48 6"><rect y="0.5" width="48" height="1.5" rx="1" fill="#7aaa88"/><rect y="4" width="48" height="1.5" rx="1" fill="#7aaa88"/></svg>';

    // ── Chart container (SVG + hover overlay) ────────────────────────────────
    const chartContainer = document.createElement('div');
    chartContainer.style.cssText = 'position:relative;overflow:hidden;line-height:0';

    const svgWrap = document.createElement('div');
    svgWrap.style.cssText = 'overflow:hidden;line-height:0';
    svgWrap.innerHTML = buildSvg();

    const hoverCanvas = document.createElement('canvas');
    hoverCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1';
    hoverCanvas.width  = W;
    hoverCanvas.height = this.profileChartH;

    const hoverTooltip = document.createElement('div');
    hoverTooltip.style.cssText = [
      'position:absolute', 'z-index:2', 'pointer-events:none', 'display:none',
      'background:rgba(8,18,12,0.94)',
      'border:1px solid rgba(91,175,130,0.4)',
      'border-radius:5px', 'padding:5px 9px',
      'font-size:11px', 'color:#c8e6c9',
      'line-height:1.6', 'white-space:nowrap',
      'box-shadow:0 2px 10px rgba(0,0,0,0.55)',
    ].join(';');

    chartContainer.appendChild(svgWrap);
    chartContainer.appendChild(hoverCanvas);
    chartContainer.appendChild(hoverTooltip);

    // ── Hover toggle button (in header) ──────────────────────────────────────
    let hoverEnabled = true;
    const hoverToggleBtn = document.createElement('button');
    hoverToggleBtn.title = 'Toggle profile cursor';
    const syncHoverBtn = () => {
      hoverToggleBtn.style.cssText = [
        'background:none',
        `border:1px solid ${hoverEnabled ? 'rgba(91,175,130,0.7)' : 'rgba(91,175,130,0.25)'}`,
        'border-radius:3px',
        `color:${hoverEnabled ? '#5baf82' : '#7a9'}`,
        'cursor:pointer', 'padding:2px 6px', 'line-height:1',
        'display:inline-flex', 'align-items:center',
      ].join(';');
    };
    syncHoverBtn();
    hoverToggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><line x1="7" y1="0" x2="7" y2="14"/><line x1="0" y1="7" x2="14" y2="7"/><circle cx="7" cy="7" r="2.5"/></svg>`;
    hoverToggleBtn.addEventListener('click', () => {
      hoverEnabled = !hoverEnabled;
      syncHoverBtn();
      if (!hoverEnabled) {
        hoverTooltip.style.display = 'none';
        hoverCanvas.getContext('2d')?.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
      }
    });

    btnWrap.insertBefore(hoverToggleBtn, snapBtn);

    // ── Legend visibility toggles for optional series ─────────────────────────
    if ((valid2 && valid2.length > 1) || (valid3 && valid3.length > 1) || (valid4 && valid4.length > 1)) {
      const legWrap = document.createElement('span');
      legWrap.style.cssText = 'display:flex;align-items:center;gap:3px;margin-right:2px';

      const mkLegBtn = (label: string, clr: string, flagGet: () => boolean, flagSet: (v: boolean) => void) => {
        const btn = document.createElement('button');
        const sync = () => {
          const on = flagGet();
          btn.style.cssText = [
            `background:${on ? clr + '22' : 'none'}`,
            `border:1px solid ${on ? clr : 'rgba(255,255,255,0.15)'}`,
            `color:${on ? clr : 'rgba(91,175,130,0.4)'}`,
            'border-radius:3px', 'cursor:pointer', 'padding:1px 5px',
            'font-size:9px', 'font-family:inherit', 'line-height:1.5',
          ].join(';');
        };
        btn.textContent = label;
        btn.title = `Toggle ${label}`;
        sync();
        btn.addEventListener('click', () => {
          flagSet(!flagGet());
          sync();
          svgWrap.innerHTML = buildSvg();
        });
        return btn;
      };

      if (valid2 && valid2.length > 1) {
        legWrap.appendChild(mkLegBtn('DSM', '#88ccff', () => showDsm, v => { showDsm = v; }));
      }
      if (valid3 && valid3.length > 1) {
        legWrap.appendChild(mkLegBtn('Water', '#1e88e5', () => showDtw, v => { showDtw = v; }));
      }
      if (valid4 && valid4.length > 1) {
        legWrap.appendChild(mkLegBtn('C/F', '#fb923c', () => showCf, v => { showCf = v; }));
      }

      btnWrap.insertBefore(legWrap, hoverToggleBtn);
    }

    // ── DTW smoothing slider (only when water table series present) ───────────
    let smoothWrap: HTMLDivElement | null = null;
    if (valid3 && valid3.length > 1) {
      smoothWrap = document.createElement('div');
      smoothWrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:3px;padding-top:3px;border-top:1px solid rgba(91,175,130,0.12)';
      smoothWrap.innerHTML = '<span style="font-size:9px;color:#5baf82;opacity:0.8">Water smooth</span>';
      const smoothSlider = document.createElement('input');
      smoothSlider.type = 'range'; smoothSlider.min = '0'; smoothSlider.max = '15'; smoothSlider.step = '1';
      smoothSlider.value = String(dtwSmooth);
      smoothSlider.style.cssText = 'width:64px;accent-color:#1e88e5;cursor:pointer';
      const smoothVal = document.createElement('span');
      smoothVal.style.cssText = 'font-size:9px;color:#90caf9;min-width:14px';
      smoothVal.textContent = String(dtwSmooth);
      smoothSlider.addEventListener('input', () => {
        dtwSmooth = parseInt(smoothSlider.value, 10);
        this.profileDtwSmooth = dtwSmooth;
        smoothVal.textContent = String(dtwSmooth);
        svgWrap.innerHTML = buildSvg();
      });
      smoothWrap.appendChild(smoothSlider);
      smoothWrap.appendChild(smoothVal);
    }

    // ── Hover mouse tracking ──────────────────────────────────────────────────
    const drawHover = (mouseX: number) => {
      const curH     = this.profileChartH;
      const curPlotH = curH   - padT - padB;
      const curPlotW = W      - padL - padR;

      // Clear previous frame
      const ctx = hoverCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, W, curH);

      if (mouseX < padL || mouseX > padL + curPlotW) {
        hoverTooltip.style.display = 'none';
        return;
      }

      const snapDist = ((mouseX - padL) / curPlotW) * distMax;
      const dtmPt    = valid.reduce((b, p) =>
        Math.abs(p.dist - snapDist) < Math.abs(b.dist - snapDist) ? p : b,
      );
      const toX = (d: number) => padL + (d / Math.max(distMax, 1e-9)) * curPlotW;
      const toY = (e: number) => padT + curPlotH - ((e - elevMin) / (elevRange || 1)) * curPlotH;

      const cx = toX(dtmPt.dist);
      const cy = toY(dtmPt.elev);

      // Vertical guide
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + curPlotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // DTM dot
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle   = this.profileLineColor; ctx.fill();
      ctx.strokeStyle = '#0c1c14'; ctx.lineWidth = 1.5; ctx.stroke();

      // Build tooltip rows
      const distLbl = dtmPt.dist < 1
        ? `${(dtmPt.dist * 1000).toFixed(0)} m`
        : `${dtmPt.dist.toFixed(2)} km`;
      const tipRows: string[] = [
        `<span style="color:#7aaa88">Dist</span> <b>${distLbl}</b>`,
        `<span style="color:#5baf82">DTM</span> <b>${dtmPt.elev.toFixed(1)} m</b>`,
      ];

      if (valid2 && valid2.length > 1) {
        const dsmPt = valid2.reduce((b, p) =>
          Math.abs(p.dist - dtmPt.dist) < Math.abs(b.dist - dtmPt.dist) ? p : b,
        );
        const dcy = toY(dsmPt.elev);
        ctx.beginPath(); ctx.arc(cx, dcy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#88ccff'; ctx.fill();
        ctx.strokeStyle = '#0c1c14'; ctx.lineWidth = 1.5; ctx.stroke();
        tipRows.push(`<span style="color:#88ccff">DSM</span> <b>${dsmPt.elev.toFixed(1)} m</b>`);
        tipRows.push(`<span style="color:#aaddaa">Canopy</span> <b>${(dsmPt.elev - dtmPt.elev).toFixed(1)} m</b>`);
      }

      if (valid3 && valid3.length > 1) {
        const wtPt = valid3.reduce((b, p) =>
          Math.abs(p.dist - dtmPt.dist) < Math.abs(b.dist - dtmPt.dist) ? p : b,
        );
        const wcy = toY(wtPt.elev);
        ctx.beginPath(); ctx.arc(cx, wcy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#1e88e5'; ctx.fill();
        ctx.strokeStyle = '#0c1c14'; ctx.lineWidth = 1.5; ctx.stroke();
        tipRows.push(`<span style="color:#90caf9">Water Table</span> <b>${wtPt.elev.toFixed(1)} m</b>`);
        tipRows.push(`<span style="color:#90caf9">Depth to WT</span> <b>${(dtmPt.elev - wtPt.elev).toFixed(1)} m</b>`);
      }

      if (valid4 && valid4.length > 1) {
        const cfPt = valid4.reduce((b, p) =>
          Math.abs(p.dist - dtmPt.dist) < Math.abs(b.dist - dtmPt.dist) ? p : b,
        );
        const cfy = toY(cfPt.elev);
        ctx.beginPath(); ctx.arc(cx, cfy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fb923c'; ctx.fill();
        ctx.strokeStyle = '#0c1c14'; ctx.lineWidth = 1.5; ctx.stroke();
        tipRows.push(`<span style="color:#fb923c">Cut/Fill</span> <b>${cfPt.elev.toFixed(1)} m</b>`);
        tipRows.push(`<span style="color:#fb923c">Δ vs DTM</span> <b>${(cfPt.elev - dtmPt.elev).toFixed(2)} m</b>`);
      }

      hoverTooltip.innerHTML = tipRows.join('<br>');

      // Position tooltip (flip if near right edge)
      const tipW    = 145;
      const tipLeft = cx + 10 + tipW > W ? cx - tipW - 10 : cx + 10;
      const tipTop  = Math.max(padT, cy - 44);
      hoverTooltip.style.left    = `${tipLeft}px`;
      hoverTooltip.style.top     = `${tipTop}px`;
      hoverTooltip.style.display = 'block';
    };

    chartContainer.addEventListener('mousemove', (e) => {
      if (!hoverEnabled) return;
      const rect   = chartContainer.getBoundingClientRect();
      drawHover(e.clientX - rect.left);
    });

    chartContainer.addEventListener('mouseleave', () => {
      hoverTooltip.style.display = 'none';
      hoverCanvas.getContext('2d')?.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
    });

    // ── Vertical resize grip (drag up = taller, drag down = shorter) ─────────
    resizeGrip.addEventListener('pointerdown', (startEvt) => {
      startEvt.preventDefault();
      startEvt.stopPropagation();
      resizeGrip.setPointerCapture(startEvt.pointerId);

      const startY = startEvt.clientY;
      const startH = this.profileChartH;
      let rafPending = false;

      const onMove = (e: PointerEvent) => {
        e.preventDefault();
        const newH = Math.max(80, Math.min(600, startH - (e.clientY - startY)));
        if (newH === this.profileChartH) return;
        this.profileChartH = newH;
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            svgWrap.innerHTML   = buildSvg();
            hoverCanvas.width   = W;
            hoverCanvas.height  = this.profileChartH;
            hoverTooltip.style.display = 'none';
            rafPending = false;
          });
        }
      };
      const onUp = () => {
        resizeGrip.removeEventListener('pointermove', onMove);
        resizeGrip.removeEventListener('pointerup', onUp);
      };
      resizeGrip.addEventListener('pointermove', onMove);
      resizeGrip.addEventListener('pointerup', onUp);
    });

    // ── Right-edge horizontal resize grip ─────────────────────────────────────
    const rightGrip = document.createElement('div');
    rightGrip.title = 'Drag to resize width';
    rightGrip.style.cssText = [
      'position:absolute', 'top:0', 'right:0', 'bottom:0', 'width:7px',
      'cursor:ew-resize', 'user-select:none', 'touch-action:none',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    rightGrip.innerHTML = '<div style="width:3px;height:40px;border-radius:2px;background:rgba(122,170,136,0.35)"></div>';
    el.style.position = 'absolute';  // ensure relative positioning context

    rightGrip.addEventListener('pointerdown', (startEvt) => {
      startEvt.preventDefault();
      rightGrip.setPointerCapture(startEvt.pointerId);
      const startX  = startEvt.clientX;
      const startW  = el.getBoundingClientRect().width;
      let rafPending = false;

      const onMove = (e: PointerEvent) => {
        e.preventDefault();
        const newPanelW = Math.max(300, Math.min(container.clientWidth - 20, startW + (e.clientX - startX)));
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            this.profilePanelW = Math.round(newPanelW);
            el.style.width     = `${this.profilePanelW}px`;
            W = this.profilePanelW - 20;
            svgWrap.innerHTML  = buildSvg();
            hoverCanvas.width  = W;
            hoverTooltip.style.display = 'none';
            rafPending = false;
          });
        }
      };
      const onUp = () => {
        rightGrip.removeEventListener('pointermove', onMove);
        rightGrip.removeEventListener('pointerup',   onUp);
      };
      rightGrip.addEventListener('pointermove', onMove);
      rightGrip.addEventListener('pointerup',   onUp);
    });

    el.appendChild(header);
    if (smoothWrap) el.appendChild(smoothWrap);
    el.appendChild(resizeGrip);
    el.appendChild(chartContainer);
    el.appendChild(rightGrip);

    container.appendChild(el);
    this.profilePanelEl = el;
  }

  private takeSnapshot(
    pts: Array<{ dist: number; elev: number }>,
    elevMin: number, elevMax: number,
    panelEl: HTMLElement,
    elevRange: number,
    distMax: number,
    segDists: number[],
    pts2?: Array<{ dist: number; elev: number }>,
    pts3?: Array<{ dist: number; elev: number }>,
    pts4?: Array<{ dist: number; elev: number }>,
  ): void {
    const map       = this.mapManager.getMap();
    const mapCanvas = map.getCanvas();
    const container = map.getContainer();

    const scaleX = mapCanvas.width  / container.clientWidth;
    const scaleY = mapCanvas.height / container.clientHeight;

    const panelRect = panelEl.getBoundingClientRect();
    const contRect  = container.getBoundingClientRect();
    const px = (panelRect.left - contRect.left) * scaleX;
    const py = (panelRect.top  - contRect.top)  * scaleY;
    const pw = panelRect.width  * scaleX;
    const ph = panelRect.height * scaleY;

    const scale  = Math.min(scaleX, scaleY);
    const W      = Math.round(pw), H = Math.round(ph);
    // hdrH covers: header row (~26px) + resize grip + margins (~10px)
    const hdrH   = Math.round(36 * scaleY);
    const padL   = Math.round(40 * scaleX), padR = Math.round(10 * scaleX);
    const padT   = hdrH + Math.round(18 * scaleY), padB = Math.round(58 * scaleY);
    const fs     = Math.max(8, Math.round(9 * scale));

    const snapSvg = this.buildProfileSvg(
      pts, elevMin, elevMax, elevRange, distMax, segDists,
      this.profileLineColor, W, H, padL, padR, padT, padB, fs, pts2, pts3, pts4,
    );

    // Prepend a header row to the snapshot SVG
    const fullSvg = snapSvg.replace(
      '<rect ',
      `<rect /><rect `,
    ).replace(
      '<rect />',
      `<text x="${padL}" y="${Math.round(hdrH * 0.72)}" fill="#88aa99" font-size="${fs}" font-family="sans-serif" letter-spacing="1">ELEVATION PROFILE</text>
       <text x="${W - padR}" y="${Math.round(hdrH * 0.72)}" text-anchor="end" fill="#5baf82" font-size="${fs}" font-family="sans-serif">${elevMin.toFixed(0)}–${elevMax.toFixed(0)} m</text>`,
    );

    const out = document.createElement('canvas');
    out.width  = mapCanvas.width;
    out.height = mapCanvas.height;
    const ctx  = out.getContext('2d')!;

    // 1. Map (WebGL canvas)
    ctx.drawImage(mapCanvas, 0, 0);

    // 2. Vertex markers (DOM elements not captured by drawImage — redraw manually)
    const mscale = Math.min(scaleX, scaleY);
    const r      = 9 * mscale;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `bold ${Math.round(9 * mscale)}px sans-serif`;
    for (let i = 0; i < this.profileVertexMarkers.length; i++) {
      const m      = this.profileVertexMarkers[i];
      const ll     = m.getLngLat();
      const pt     = map.project([ll.lng, ll.lat]);
      const cx     = pt.x * scaleX;
      const cy     = pt.y * scaleY;
      ctx.beginPath(); ctx.arc(cx, cy, r + 2 * mscale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = this.profileLineColor; ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.fillText(String.fromCharCode(65 + i), cx, cy);
    }
    ctx.restore();

    // 3. Profile panel SVG (on top of map + markers)
    const blob = new Blob([fullSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      ctx.drawImage(img, px, py, pw, ph);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.download = 'elevation-profile.png';
      a.href = out.toDataURL('image/png');
      a.click();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // --------------------------------------------------------------------------
  // Toolbar
  // --------------------------------------------------------------------------

  private ensureToolbar(): void {
    if (this.toolbarEl) return;
    const container = this.mapManager.getMap().getContainer();
    container.querySelector('#hrdem-elevation-toolbar')?.remove();
    const el = document.createElement('div');
    el.id = 'hrdem-elevation-toolbar';
    el.style.cssText = [
      'position:absolute', 'top:8px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:20',
      'display:none', 'align-items:center', 'gap:6px',
      'background:rgba(18,36,26,0.90)',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:6px', 'padding:4px 8px',
      'font-family:inherit', 'font-size:11px', 'color:#c8d8c8',
      'pointer-events:auto',
      'backdrop-filter:blur(3px)', '-webkit-backdrop-filter:blur(3px)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
      'max-width:calc(100vw - 152px)',
    ].join(';');

    const dragHandle = document.createElement('span');
    dragHandle.title = 'Drag to reposition';
    dragHandle.style.cssText = [
      'display:inline-flex', 'align-items:center', 'cursor:grab',
      'padding:0 4px 0 0', 'touch-action:none', 'opacity:0.45',
      'flex-shrink:0',
    ].join(';');
    dragHandle.innerHTML = '<svg width="8" height="16" viewBox="0 0 8 16" fill="currentColor"><circle cx="2" cy="3" r="1.5"/><circle cx="6" cy="3" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="6" cy="8" r="1.5"/><circle cx="2" cy="13" r="1.5"/><circle cx="6" cy="13" r="1.5"/></svg>';

    const selectStyle = [
      'background:rgba(10,22,16,0.85)',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:3px', 'color:#c8d8c8',
      'font-size:10px', 'font-family:inherit',
      'padding:1px 2px', 'cursor:pointer',
      'outline:none', 'max-width:90px',
    ].join(';');

    // Sample controls (shown when sample tool is active)
    const sampleControls = document.createElement('span');
    sampleControls.className = 'hrdem-tb-sample-controls';
    sampleControls.style.cssText = 'display:none;align-items:center;gap:5px';

    const sampleHint = document.createElement('span');
    sampleHint.style.cssText = 'font-size:9px;opacity:0.55';
    sampleHint.textContent = 'Click map to sample elevation';

    const sampleSel = document.createElement('select');
    sampleSel.className = 'hrdem-tb-sample-sel';
    sampleSel.title = 'Sample layer';
    sampleSel.style.cssText = selectStyle;
    [
      { value: 'elevation', label: 'Elevation' },
      { value: 'chm',       label: 'CHM' },
      { value: 'slope',     label: 'Slope' },
      { value: 'aspect',    label: 'Aspect' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      if (value === this.sampleMode) opt.selected = true;
      sampleSel.appendChild(opt);
    });
    sampleSel.addEventListener('change', () => {
      this.sampleMode = sampleSel.value as typeof this.sampleMode;
    });

    sampleControls.appendChild(sampleHint);
    sampleControls.appendChild(sampleSel);

    // Profile controls (shown when profile tool is active)
    const profileControls = document.createElement('span');
    profileControls.className = 'hrdem-tb-profile-controls';
    profileControls.style.cssText = 'display:none;align-items:center;gap:5px';

    const profileSel = document.createElement('select');
    profileSel.className = 'hrdem-tb-profile-sel';
    profileSel.title = 'Profile elevation layer';
    profileSel.style.cssText = selectStyle;
    [
      { value: 'dtm',         label: 'DTM Elev' },
      { value: 'dsm',         label: 'DSM Elev' },
      { value: 'both',        label: 'DTM+DSM' },
      { value: 'dtm+dtw',     label: 'DTM+Water' },
      { value: 'dtm+dsm+dtw', label: 'DTM+DSM+Water' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      if (value === this.profileMode) opt.selected = true;
      profileSel.appendChild(opt);
    });
    profileSel.addEventListener('change', () => {
      this.profileMode = profileSel.value as typeof this.profileMode;
    });

    profileControls.appendChild(profileSel);

    el.appendChild(dragHandle);
    el.appendChild(sampleControls);
    el.appendChild(profileControls);

    container.appendChild(el);
    this.toolbarEl = el;
    this.makeDraggable(el, dragHandle);

    // Wire left-toolbar ELEV buttons and accordion deactivation via EventBus
    this.elevEventUnsubs.push(
      EventBus.on('elev:sample-activate', () => this.activateSampleTool()),
      EventBus.on('elev:profile-activate', () => this.activateProfileTool()),
      EventBus.on('elev:export-contour', () => this.exportContourGeoJSON()),
      EventBus.on('elev:cancel', () => { if (this.activeTool !== 'none') this.cancelTool(); }),
    );
  }

  private makeDraggable(el: HTMLElement, handle: HTMLElement): void {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let containerW = 0, containerH = 0;
    let active = false;

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const snapToPixels = () => {
      const parent = el.offsetParent as HTMLElement | null;
      const parentRect = parent?.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      containerW = parentRect?.width  ?? window.innerWidth;
      containerH = parentRect?.height ?? window.innerHeight;
      startLeft = elRect.left - (parentRect?.left ?? 0);
      startTop  = elRect.top  - (parentRect?.top  ?? 0);
      el.style.left      = startLeft + 'px';
      el.style.top       = startTop  + 'px';
      el.style.transform = 'none';
    };

    const move = (cx: number, cy: number) => {
      if (!active) return;
      el.style.left = clamp(startLeft + cx - startX, 0, containerW - el.offsetWidth)  + 'px';
      el.style.top  = clamp(startTop  + cy - startY, 0, containerH - el.offsetHeight) + 'px';
    };

    const end = () => {
      if (!active) return;
      active = false;
      el.style.cursor = '';
      document.removeEventListener('mousemove', onMM);
      document.removeEventListener('mouseup',   onMU);
      document.removeEventListener('touchmove', onTM);
      document.removeEventListener('touchend',  onTE);
    };

    const onMM = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onMU = () => end();
    const onTM = (e: TouchEvent) => { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); };
    const onTE = () => end();

    const begin = (cx: number, cy: number) => {
      snapToPixels();
      startX = cx; startY = cy;
      active = true;
      el.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMM);
      document.addEventListener('mouseup',   onMU);
      document.addEventListener('touchmove', onTM, { passive: false });
      document.addEventListener('touchend',  onTE);
    };

    handle.addEventListener('mousedown',  (e) => { e.preventDefault(); begin(e.clientX, e.clientY); });
    handle.addEventListener('touchstart', (e) => { e.preventDefault(); begin(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
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
    const isSample  = this.activeTool === 'sample';
    const isProfile = this.activeTool === 'profile';

    // Update left toolbar button active states
    document.getElementById('btn-elev-sample')?.classList.toggle('active', isSample);
    document.getElementById('btn-elev-profile')?.classList.toggle('active', isProfile);

    if (!this.toolbarEl) return;

    const sampleControls  = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-sample-controls');
    const profileControls = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-profile-controls');

    // Show toolbar only when a tool is active
    this.toolbarEl.style.display = (isSample || isProfile) ? 'flex' : 'none';

    if (sampleControls)  sampleControls.style.display  = isSample  ? 'inline-flex' : 'none';
    if (profileControls) profileControls.style.display = isProfile ? 'inline-flex' : 'none';

    // Profile: rebuild the dynamic hint/finish section
    profileControls?.querySelector('.hrdem-tb-hint')?.remove();
    if (isProfile && profileControls) {
      const wrap = document.createElement('span');
      wrap.className = 'hrdem-tb-hint';
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-left:2px';

      const colorPick = document.createElement('input');
      colorPick.type  = 'color';
      colorPick.value = this.profileLineColor;
      colorPick.title = 'Line color';
      colorPick.style.cssText = [
        'width:20px', 'height:20px', 'padding:1px',
        'border:1px solid rgba(255,255,255,0.25)', 'border-radius:3px',
        'background:none', 'cursor:pointer', 'vertical-align:middle',
      ].join(';');
      colorPick.addEventListener('input', (ev) => {
        this.profileLineColor = (ev.target as HTMLInputElement).value;
        const map = this.mapManager.getMap();
        if (map.getLayer(this.profileLineLayerId)) {
          map.setPaintProperty(this.profileLineLayerId, 'line-color', this.profileLineColor);
        }
        this.updateVertexMarkers();
      });

      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:9px;opacity:0.55';
      const n = this.profilePoints.length;
      hint.textContent = n === 0 ? 'Click to add points…' : n === 1 ? '1 pt — keep clicking' : `${n} pts`;

      wrap.appendChild(colorPick);
      wrap.appendChild(hint);

      if (n >= 2) {
        const finishBtn = document.createElement('button');
        finishBtn.textContent = 'Finish';
        finishBtn.style.cssText = [
          'background:rgba(91,175,130,0.2)',
          'border:1px solid rgba(91,175,130,0.55)',
          'border-radius:3px', 'color:#5baf82',
          'cursor:pointer', 'padding:1px 6px',
          'font-family:inherit', 'font-size:9px',
        ].join(';');
        finishBtn.addEventListener('click', (e) => { e.stopPropagation(); this.finishProfileTool(); });
        wrap.appendChild(finishBtn);
      }

      profileControls.appendChild(wrap);
    }
  }

  private refreshToolbarContourLabel(): void {
    // Export contour button is now in the left toolbar — update its dim state
    const exportBtn = document.getElementById('btn-elev-export-contour');
    if (exportBtn) exportBtn.style.opacity = this.contourEnabled ? '1' : '0.3';
  }

  private updateContourLabelText(_el: HTMLElement): void {
    // Contour label was removed from the top toolbar; kept for TS compatibility
  }

  private removeToolbar(): void {
    this.toolbarEl?.remove();
    this.toolbarEl = null;
    this.elevEventUnsubs.forEach(unsub => unsub());
    this.elevEventUnsubs = [];
    // Clear left toolbar active state
    document.getElementById('btn-elev-sample')?.classList.remove('active');
    document.getElementById('btn-elev-profile')?.classList.remove('active');
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
