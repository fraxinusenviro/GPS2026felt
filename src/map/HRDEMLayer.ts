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

  private sampleMode:    'elevation' | 'slope' | 'aspect' | 'chm' = 'elevation';
  private profileMode:   'dtm' | 'dsm' | 'both' | 'dtm+dtw' | 'dtm+dsm+dtw' = 'dtm';
  private profileChartH  = 160;
  private lastDTMResult: HRDEMResult | null = null;
  private lastDSMResult: HRDEMResult | null = null;
  private lastDTWResult: HRDEMResult | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedDTWTiff: any = null;

  constructor(private readonly mapManager: MapManager) {}

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
      LAYER_IDS.USER_ACCURACY,
    );
    // Colored line on top
    map.addLayer(
      {
        id:     this.profileLineLayerId,
        type:   'line',
        source: this.profileLineSrcId,
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
        paint: {
          'line-color':      this.profileLineColor,
          'line-width':      4,
          'line-dasharray':  [5, 2],
          'line-opacity':    0.95,
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

  private activateSampleTool(): void {
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

  private activateProfileTool(): void {
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

    this.showProfilePanel(pts, segDists, pts2, pts3);
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
    const hasMulti = (valid2 && valid2.length > 1) || (valid3 && valid3.length > 1);
    const legItems: Array<{ stroke: string; dash?: string; label: string }> = hasMulti
      ? [
          { stroke: lineColor, label: 'DTM' },
          ...((valid2 && valid2.length > 1) ? [{ stroke: '#88ccff', dash: '4,2', label: 'DSM' }] : []),
          ...((valid3 && valid3.length > 1) ? [{ stroke: '#1e88e5', label: 'Water Table' }] : []),
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
    const elevRange = elevMax - elevMin || 1;

    const container = this.mapManager.getMap().getContainer();
    // Full-width: 10 px margin each side, 10 px padding each side inside panel
    const W    = Math.max(320, container.clientWidth - 40);
    const padL = 40, padR = 10, padT = 18, padB = 58;

    const buildSvg = () => this.buildProfileSvg(
      valid, elevMin, elevMax, elevRange, distMax, segDists,
      this.profileLineColor, W, this.profileChartH, padL, padR, padT, padB, 9, valid2, valid3,
    );

    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute', 'bottom:70px', 'left:10px', 'right:10px',
      'z-index:30',
      'background:rgba(10,22,16,0.96)',
      'border:1px solid rgba(91,175,130,0.25)',
      'border-radius:6px', 'padding:8px 10px 6px',
      'pointer-events:auto',
      'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';

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
      this.takeSnapshot(valid, elevMin, elevMax, el, elevRange, distMax, segDists, valid2, valid3),
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

    // ── Resize grip ───────────────────────────────────────────────────────────
    // Use Pointer Events + setPointerCapture so drag works even when the
    // cursor moves over the MapLibre canvas, which otherwise intercepts events
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

    el.appendChild(header);
    el.appendChild(resizeGrip);
    el.appendChild(chartContainer);

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
      this.profileLineColor, W, H, padL, padR, padT, padB, fs, pts2, pts3,
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

    const exportContourBtn = document.createElement('button');
    exportContourBtn.className = 'hrdem-tb-btn hrdem-tb-contour-export';
    exportContourBtn.title = 'Export contours as GeoJSON';
    exportContourBtn.style.cssText = `${this.toolBtnStyle(false)};display:${this.contourEnabled ? '' : 'none'}`;
    exportContourBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 12h12"/></svg>&thinsp;GeoJSON`;
    exportContourBtn.addEventListener('click', () => this.exportContourGeoJSON());

    const sep1 = document.createElement('span');
    sep1.className = 'hrdem-tb-sep hrdem-tb-sep-contour';
    sep1.style.cssText = `width:1px;height:14px;background:rgba(255,255,255,0.15);flex-shrink:0;display:${this.contourEnabled ? '' : 'none'}`;

    const selectStyle = [
      'background:rgba(10,22,16,0.85)',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:3px', 'color:#c8d8c8',
      'font-size:10px', 'font-family:inherit',
      'padding:1px 2px', 'cursor:pointer',
      'outline:none', 'max-width:90px',
    ].join(';');

    const sampleBtn = document.createElement('button');
    sampleBtn.className = 'hrdem-tb-btn hrdem-tb-sample';
    sampleBtn.title = 'Click the map to read elevation at a point';
    sampleBtn.style.cssText = this.toolBtnStyle(false);
    sampleBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>&thinsp;Sample`;
    sampleBtn.addEventListener('click', () => this.activateSampleTool());

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

    const profileBtn = document.createElement('button');
    profileBtn.className = 'hrdem-tb-btn hrdem-tb-profile';
    profileBtn.title = 'Click two or more points to create an elevation profile';
    profileBtn.style.cssText = this.toolBtnStyle(false);
    profileBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,13 5,7 9,10 15,3"/></svg>&thinsp;Profile`;
    profileBtn.addEventListener('click', () => this.activateProfileTool());

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

    // Always in DOM so refreshToolbarContourLabel() can show/hide them
    el.appendChild(contourLbl);
    el.appendChild(exportContourBtn);
    el.appendChild(sep1);
    el.appendChild(sampleBtn);
    el.appendChild(sampleSel);
    el.appendChild(profileBtn);
    el.appendChild(profileSel);

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
      const wrap = document.createElement('span');
      wrap.className = 'hrdem-tb-hint';
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-left:2px';

      // Color picker — always visible while tool is active
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
      if (n === 0) {
        hint.textContent = 'Click to add points…';
      } else if (n === 1) {
        hint.textContent = '1 pt — keep clicking';
      } else {
        hint.textContent = `${n} pts`;
      }

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

      this.toolbarEl.appendChild(wrap);
    }
  }

  private refreshToolbarContourLabel(): void {
    if (!this.toolbarEl) return;
    const lbl     = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-contour-lbl');
    const sep     = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-sep-contour');
    const expBtn  = this.toolbarEl.querySelector<HTMLElement>('.hrdem-tb-contour-export');
    const vis = this.contourEnabled ? '' : 'none';
    if (lbl)    { lbl.style.display = vis; this.updateContourLabelText(lbl); }
    if (sep)    sep.style.display = vis;
    if (expBtn) expBtn.style.display = vis;
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
