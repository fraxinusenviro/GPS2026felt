/**
 * COG-backed single-threshold contour layer.
 *
 * Reads a Cloud-Optimized GeoTIFF for the current map viewport, runs
 * marching-squares at one user-defined threshold, and renders:
 *   • a GeoJSON line layer (the isoline)
 *   • an optional image-source fill layer (pixels ≤ threshold)
 *
 * Designed for single-band COGs in EPSG:22620 (NAD83 UTM Zone 20N),
 * i.e. the NS Wetlands Mapping DTW raster.  CRS is detected from the
 * GeoTIFF GeoKeys, with EPSG:22620 registered as a fallback.
 */

import proj4 from 'proj4';
import { LAYER_IDS } from '../constants';
import { generateThresholdContour } from '../lib/contourGenerator';
import type { MapManager } from './MapManager';

const COG_CRS   = 'EPSG:22620';
const COG_CRS_DEF = '+proj=utm +zone=20 +ellps=GRS80 +units=m +no_defs';

// Maximum pixel dimension per fetch (both axes capped to this)
const MAX_PIXELS = 1024;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export class CogContourLayer {
  private readonly mm: MapManager;
  private readonly cogUrl: string;
  private iid = '';

  // Style
  private threshold   = 0.5;
  private lineColor   = '#1565c0';
  private lineWidth   = 2.0;
  private fillEnabled = false;
  private fillColor   = '#1565c0';
  private fillOpacity = 0.30;

  // Map state
  private opacity = 1.0;
  private visible = true;

  // Internal
  private readonly canvas = document.createElement('canvas');
  private lastAbort: AbortController | null = null;
  private moveHandler: (() => void) | null = null;
  private cachedTiff: import('geotiff').GeoTIFF | null = null;

  constructor(mm: MapManager, cogUrl: string) {
    this.mm     = mm;
    this.cogUrl = cogUrl;
    // Ensure the UTM Zone 20N definition is registered for proj4
    try { proj4(COG_CRS, 'EPSG:4326', [0, 0]); } catch {
      proj4.defs(COG_CRS, COG_CRS_DEF);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  activate(iid: string, opacity: number, visible: boolean): void {
    this.iid     = iid;
    this.opacity = opacity;
    this.visible = visible;
    this.ensureLayers();
    this.hookMoveEnd();
    this.scheduleFetch();
  }

  deactivate(): void {
    this.unhookMoveEnd();
    this.lastAbort?.abort();
    const map = this.mm.getMap();
    for (const id of [this.lineId, this.fillId]) {
      try { map.removeLayer(id); } catch { /* */ }
    }
    for (const id of [this.geomSrcId, this.imgSrcId]) {
      try { map.removeSource(id); } catch { /* */ }
    }
  }

  setThreshold(t: number): void {
    this.threshold = t;
    this.scheduleFetch();
  }

  setLineStyle(color: string, width: number): void {
    this.lineColor = color;
    this.lineWidth = width;
    const map = this.mm.getMap();
    try {
      map.setPaintProperty(this.lineId, 'line-color', color);
      map.setPaintProperty(this.lineId, 'line-width', width);
    } catch { /* layer not yet added */ }
  }

  setFill(enabled: boolean, color: string, opacity: number): void {
    this.fillEnabled = enabled;
    this.fillColor   = color;
    this.fillOpacity = opacity;
    const map = this.mm.getMap();
    try {
      map.setLayoutProperty(
        this.fillId, 'visibility',
        enabled && this.visible ? 'visible' : 'none',
      );
    } catch { /* */ }
    if (enabled) this.scheduleFetch();
  }

  setOpacity(o: number): void {
    this.opacity = o;
    const map = this.mm.getMap();
    try {
      map.setPaintProperty(this.lineId, 'line-opacity', this.visible ? o : 0);
      map.setPaintProperty(this.fillId, 'raster-opacity',
        this.fillEnabled && this.visible ? o : 0);
    } catch { /* */ }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    const map = this.mm.getMap();
    try {
      map.setLayoutProperty(this.lineId, 'visibility', v ? 'visible' : 'none');
      map.setLayoutProperty(this.fillId, 'visibility',
        this.fillEnabled && v ? 'visible' : 'none');
    } catch { /* */ }
    if (v) this.scheduleFetch();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private get lineId()    { return `ccl-line-${this.iid}`; }
  private get fillId()    { return `ccl-fill-${this.iid}`; }
  private get geomSrcId() { return `ccl-src-${this.iid}`; }
  private get imgSrcId()  { return `ccl-img-${this.iid}`; }

  private ensureLayers(): void {
    const map    = this.mm.getMap();
    const bounds = map.getBounds();

    if (!map.getSource(this.geomSrcId)) {
      map.addSource(this.geomSrcId, { type: 'geojson', data: EMPTY_FC });
    }

    if (!map.getSource(this.imgSrcId)) {
      this.canvas.width = 1; this.canvas.height = 1;
      map.addSource(this.imgSrcId, {
        type: 'image',
        url: this.canvas.toDataURL(),
        coordinates: [
          [bounds.getWest(), bounds.getNorth()],
          [bounds.getEast(), bounds.getNorth()],
          [bounds.getEast(), bounds.getSouth()],
          [bounds.getWest(), bounds.getSouth()],
        ],
      } as Parameters<typeof map.addSource>[1]);
    }

    if (!map.getLayer(this.fillId)) {
      map.addLayer(
        {
          id: this.fillId, type: 'raster', source: this.imgSrcId,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
          layout: { visibility: 'none' },
        },
        LAYER_IDS.USER_ACCURACY,
      );
    }

    if (!map.getLayer(this.lineId)) {
      map.addLayer(
        {
          id: this.lineId, type: 'line', source: this.geomSrcId,
          paint: {
            'line-color':   this.lineColor,
            'line-width':   this.lineWidth,
            'line-opacity': this.visible ? this.opacity : 0,
          },
          layout: { visibility: this.visible ? 'visible' : 'none' },
        },
        LAYER_IDS.USER_ACCURACY,
      );
    }
  }

  private hookMoveEnd(): void {
    if (this.moveHandler) return;
    this.moveHandler = () => { if (this.visible) this.scheduleFetch(); };
    this.mm.getMap().on('moveend', this.moveHandler);
    this.mm.getMap().on('zoomend', this.moveHandler);
  }

  private unhookMoveEnd(): void {
    if (!this.moveHandler) return;
    this.mm.getMap().off('moveend', this.moveHandler);
    this.mm.getMap().off('zoomend', this.moveHandler);
    this.moveHandler = null;
  }

  private scheduleFetch(): void {
    this.lastAbort?.abort();
    this.lastAbort = new AbortController();
    const sig = this.lastAbort.signal;
    this.doFetch(sig).catch(e => {
      if (e?.name !== 'AbortError') console.warn('[CogContour]', e);
    });
  }

  private async doFetch(signal: AbortSignal): Promise<void> {
    if (!this.visible) return;

    const map    = this.mm.getMap();
    const bounds = map.getBounds();
    const w4326  = bounds.getWest(),  e4326 = bounds.getEast();
    const s4326  = bounds.getSouth(), n4326 = bounds.getNorth();

    // Load and cache the GeoTIFF file object (range-request capable)
    if (!this.cachedTiff) {
      const { fromUrl } = await import('geotiff');
      if (signal.aborted) return;
      this.cachedTiff = await fromUrl(this.cogUrl);
    }
    if (signal.aborted) return;

    const image = await this.cachedTiff.getImage();
    if (signal.aborted) return;

    // Detect native CRS from GeoKeys; fall back to EPSG:22620
    const geoKeys  = (image as any).getGeoKeys?.() as Record<string, number> | undefined;
    const epsgCode = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? 22620;
    const nativeCrs = `EPSG:${epsgCode}`;
    try { proj4(nativeCrs, 'EPSG:4326', [0, 0]); } catch {
      proj4.defs(nativeCrs, COG_CRS_DEF);
    }

    const [ox, oy] = image.getOrigin();
    const [rx, ry] = image.getResolution(); // rx > 0, ry < 0
    const imgW = image.getWidth(), imgH = image.getHeight();

    // Convert WGS84 viewport to native CRS
    const [swX, swY] = proj4('EPSG:4326', nativeCrs, [w4326, s4326]);
    const [neX, neY] = proj4('EPSG:4326', nativeCrs, [e4326, n4326]);

    // Pixel window: ry is negative so pxT < pxB (top row < bottom row)
    const pxL = Math.max(0,    Math.floor((Math.min(swX, neX) - ox) / rx));
    const pxR = Math.min(imgW, Math.ceil( (Math.max(swX, neX) - ox) / rx));
    const pxT = Math.max(0,    Math.floor((Math.max(swY, neY) - oy) / ry));
    const pxB = Math.min(imgH, Math.ceil( (Math.min(swY, neY) - oy) / ry));

    if (pxL >= pxR || pxT >= pxB) {
      // Viewport is outside the COG extent — show nothing
      (map.getSource(this.geomSrcId) as import('maplibre-gl').GeoJSONSource)?.setData(EMPTY_FC);
      return;
    }

    // Down-sample to MAX_PIXELS to keep memory and processing reasonable
    const winW  = pxR - pxL, winH = pxB - pxT;
    const scale = Math.min(1, MAX_PIXELS / Math.max(winW, winH));
    const outW  = Math.max(2, Math.round(winW * scale));
    const outH  = Math.max(2, Math.round(winH * scale));

    const rasters = await image.readRasters({
      window: [pxL, pxT, pxR, pxB],
      width: outW, height: outH,
      interleave: false,
      resampleMethod: 'bilinear',
    }) as unknown as ArrayLike<number>[];
    if (signal.aborted) return;

    const nodata = (image as any).getGDALNoData?.() ?? null;
    const raw    = rasters[0];
    const grid   = raw instanceof Float32Array ? raw as Float32Array
                                               : Float32Array.from(raw as ArrayLike<number>);

    // Actual native-CRS corners of what was read
    const utmW = ox + pxL * rx;
    const utmN = oy + pxT * ry; // northernmost (ry < 0)
    const utmE = ox + pxR * rx;
    const utmS = oy + pxB * ry; // southernmost

    // Convert to WGS84 for the pseudo-geographic bbox passed to the contour generator.
    // Treating the UTM pixel grid as if it were uniform in degrees introduces sub-pixel
    // distortion (< 0.1 % at 45 °N) — acceptable for isoline display purposes.
    const [geoW, geoS] = proj4(nativeCrs, 'EPSG:4326', [utmW, utmS]);
    const [geoE, geoN] = proj4(nativeCrs, 'EPSG:4326', [utmE, utmN]);

    const pseudoResult = {
      grid, width: outW, height: outH, nodata,
      bbox: [geoW, geoS, geoE, geoN] as [number, number, number, number],
      elevMin: 0, elevMax: 9999, stretchMin: 0, stretchMax: 9999, validCount: outW * outH,
    };

    const fc = generateThresholdContour(pseudoResult, this.threshold);
    if (signal.aborted) return;

    (map.getSource(this.geomSrcId) as import('maplibre-gl').GeoJSONSource)
      ?.setData(fc as GeoJSON.FeatureCollection);

    if (this.fillEnabled) {
      this.renderFill(grid, outW, outH, nodata, geoW, geoS, geoE, geoN);
    }

    const chains = (fc.features[0]?.geometry as GeoJSON.MultiLineString | undefined)
      ?.coordinates.length ?? 0;
    console.log(
      `[CogContour] ${this.cogUrl.split('/').pop()} ` +
      `threshold=${this.threshold}m → ${chains} chain${chains !== 1 ? 's' : ''}`,
    );
  }

  private renderFill(
    grid: Float32Array, w: number, h: number, nodata: number | null,
    geoW: number, geoS: number, geoE: number, geoN: number,
  ): void {
    this.canvas.width = w; this.canvas.height = h;
    const ctx     = this.canvas.getContext('2d')!;
    const imgData = ctx.createImageData(w, h);

    const r = parseInt(this.fillColor.slice(1, 3), 16);
    const g = parseInt(this.fillColor.slice(3, 5), 16);
    const b = parseInt(this.fillColor.slice(5, 7), 16);
    const a = Math.round(this.fillOpacity * 255);

    for (let i = 0; i < w * h; i++) {
      const v = grid[i];
      if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001) || v > this.threshold) {
        imgData.data[i * 4 + 3] = 0;
      } else {
        imgData.data[i * 4]     = r;
        imgData.data[i * 4 + 1] = g;
        imgData.data[i * 4 + 2] = b;
        imgData.data[i * 4 + 3] = a;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const url: string = this.canvas.toDataURL();
    const coords: [[number,number],[number,number],[number,number],[number,number]] = [
      [geoW, geoN], [geoE, geoN], [geoE, geoS], [geoW, geoS],
    ];
    const map = this.mm.getMap();
    const src = map.getSource(this.imgSrcId) as import('maplibre-gl').ImageSource;
    if (src) {
      src.updateImage({ url, coordinates: coords });
      map.setLayoutProperty(this.fillId, 'visibility', 'visible');
      map.setPaintProperty(this.fillId, 'raster-opacity', this.opacity);
    }
  }
}
