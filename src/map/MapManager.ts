import maplibregl from 'maplibre-gl';
import type { Map as MLMap, LngLat, StyleSpecification } from 'maplibre-gl';
import type { FieldFeature, AppSettings, LayerPreset, TypePreset, SymbologyState, GeometryType } from '../types';
import { LAYER_IDS, BASEMAPS, BASEMAP_OVERLAYS } from '../constants';
import { buildColorExpression, buildRadiusExpression } from '../lib/symbologyEngine';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';
import { SymbolRenderer, renderIconImageData } from '../ui/SymbolRenderer';
import { wetlandPlotColor } from '../wetlands/wetlandSurvey';
import proj4 from 'proj4';

// ---- Module-level COG colormap registry (mutable so ramp can be changed at runtime) ----
type CogColorStop = [number, number, number, number, number]; // [value, R, G, B, alpha 0-255]

const cogColormapRegistry = new Map<string, CogColorStop[]>();
const cogSmoothRegistry = new Map<string, boolean>();

// ---- Module-level raster recolour LUT registry (luminance → RGB, 256×3) ----
// Used by the rampify:// protocol to apply colour ramps to plain RGB tile layers.
const rasterLutRegistry = new Map<string, Uint8ClampedArray>();

// Initialize from BASEMAP_OVERLAYS at module load time
for (const def of BASEMAP_OVERLAYS) {
  if (def.cog_colormap && def.url.startsWith('cog://')) {
    const parts = def.url.slice('cog://'.length).split('/');
    parts.pop(); parts.pop(); parts.pop(); // strip {y}, {x}, {z}
    cogColormapRegistry.set(decodeURIComponent(parts.join('/')), def.cog_colormap as CogColorStop[]);
  }
}

const interpolateCogColormap = (stops: CogColorStop[], v: number): [number, number, number, number] => {
  if (v <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3], stops[0][4]];
  const last = stops[stops.length - 1];
  if (v >= last[0]) return [last[1], last[2], last[3], last[4]];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i + 1][0]) {
      const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [
        Math.round(stops[i][1] + t * (stops[i + 1][1] - stops[i][1])),
        Math.round(stops[i][2] + t * (stops[i + 1][2] - stops[i][2])),
        Math.round(stops[i][3] + t * (stops[i + 1][3] - stops[i][3])),
        Math.round(stops[i][4] + t * (stops[i + 1][4] - stops[i][4])),
      ];
    }
  }
  return [0, 0, 0, 0];
};

export class MapManager {
  private map!: MLMap;
  private userMarker: maplibregl.Marker | null = null;
  private accuracyCircle: maplibregl.Marker | null = null;
  private initialized = false;
  private basemapOverlayIds: string[] = [];

  async init(containerId: string, settings: AppSettings): Promise<void> {
    const basemap = BASEMAPS.find(b => b.id === settings.basemap_id) ?? BASEMAPS[0];
    if (settings.map_bg_color) this.mapBgColor = settings.map_bg_color;

    // Register cog:// protocol — reads Cloud-Optimized GeoTIFFs via range requests
    if (!(maplibregl as unknown as { _cogProtocolRegistered?: boolean })._cogProtocolRegistered) {
      (maplibregl as unknown as { _cogProtocolRegistered?: boolean })._cogProtocolRegistered = true;
      const cogCache = new Map<string, import('geotiff').GeoTIFF>();

      maplibregl.addProtocol('cog', async (params) => {
        try {
          // URL format: cog://ENCODED_COG_URL/z/x/y  (query string ignored for cache-busting)
          const clean = params.url.split('?')[0];
          const withoutProto = clean.slice('cog://'.length);
          const parts = withoutProto.split('/');
          const y = parseInt(parts.pop()!);
          const x = parseInt(parts.pop()!);
          const z = parseInt(parts.pop()!);
          const cogUrl = decodeURIComponent(parts.join('/'));
          const tileSize = 256;

          // Tile bbox in EPSG:3857
          const n = Math.pow(2, z);
          const tileW = (20037508.342789244 * 2) / n;
          const west3857 = -20037508.342789244 + x * tileW;
          const east3857 = west3857 + tileW;
          const north3857 = 20037508.342789244 - y * tileW;
          const south3857 = north3857 - tileW;

          let tiff = cogCache.get(cogUrl);
          if (!tiff) {
            const { fromUrl } = await import('geotiff');
            tiff = await fromUrl(cogUrl);
            cogCache.set(cogUrl, tiff);
          }
          const image = await tiff.getImage();
          const bands = image.getSamplesPerPixel();

          // Detect the COG's native CRS from GeoKeys and register proj4 definition if needed
          const geoKeys = image.getGeoKeys() as Record<string, number> | undefined;
          const epsgCode = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? 4326;
          const cogCrs = `EPSG:${epsgCode}`;

          if (epsgCode !== 4326 && epsgCode !== 3857) {
            try { proj4(cogCrs, 'EPSG:4326', [0, 0]); } catch {
              if (epsgCode === 22620)
                // NAD83(CSRS)v6 / UTM Zone 20N  (NS Wetlands Mapping COGs)
                proj4.defs(cogCrs, '+proj=utm +zone=20 +ellps=GRS80 +units=m +no_defs');
              else if (epsgCode >= 32601 && epsgCode <= 32660)
                proj4.defs(cogCrs, `+proj=utm +zone=${epsgCode - 32600} +datum=WGS84 +units=m +no_defs`);
              else if (epsgCode >= 32701 && epsgCode <= 32760)
                proj4.defs(cogCrs, `+proj=utm +zone=${epsgCode - 32700} +south +datum=WGS84 +units=m +no_defs`);
              else if (epsgCode >= 26901 && epsgCode <= 26960)
                proj4.defs(cogCrs, `+proj=utm +zone=${epsgCode - 26900} +datum=NAD83 +units=m +no_defs`);
              else
                console.warn(`[COG] Unknown CRS EPSG:${epsgCode} — tile may misalign`);
            }
          }

          // Diagnostic log once per unique COG
          if (!cogCache.has(cogUrl)) {
            console.info(`[COG] ${cogUrl.split('/').pop()} → EPSG:${epsgCode}, ${image.getWidth()}×${image.getHeight()}, nodata=${(image as any).getGDALNoData?.() ?? 'none'}`);
          }

          // Convert tile bbox to the COG's native CRS
          const [swX, swY] = cogCrs === 'EPSG:4326'
            ? proj4('EPSG:3857', 'EPSG:4326', [west3857, south3857])
            : proj4('EPSG:3857', cogCrs, [west3857, south3857]);
          const [neX, neY] = cogCrs === 'EPSG:4326'
            ? proj4('EPSG:3857', 'EPSG:4326', [east3857, north3857])
            : proj4('EPSG:3857', cogCrs, [east3857, north3857]);

          const origin = image.getOrigin();
          const res    = image.getResolution();
          const [ox, oy] = origin;
          const [rx, ry] = res;
          const imgW = image.getWidth(), imgH = image.getHeight();

          const pxL = Math.round((swX - ox) / rx);
          const pxR = Math.round((neX - ox) / rx);
          const pxT = Math.round((neY - oy) / ry);
          const pxB = Math.round((swY - oy) / ry);
          const winL = Math.max(0, Math.min(pxL, pxR));
          const winR = Math.min(imgW, Math.max(pxL, pxR));
          const winT = Math.max(0, Math.min(pxT, pxB));
          const winB = Math.min(imgH, Math.max(pxT, pxB));

          if (winL >= winR || winT >= winB) return { data: new ArrayBuffer(0) };

          const smooth = cogSmoothRegistry.get(cogUrl) ?? false;
          const rasters = await image.readRasters({
            window: [winL, winT, winR, winB],
            width: tileSize, height: tileSize, interleave: false,
            resampleMethod: smooth ? 'bilinear' : 'nearest',
          }) as unknown as number[][];

          const canvas = new OffscreenCanvas(tileSize, tileSize);
          const ctx = canvas.getContext('2d')!;
          const imgData = ctx.createImageData(tileSize, tileSize);
          const r0 = rasters[0];

          const colormap = cogColormapRegistry.get(cogUrl);
          if (colormap && colormap.length >= 2) {
            const nodata = (image as unknown as { getGDALNoData?: () => number | null }).getGDALNoData?.() ?? null;
            for (let i = 0; i < tileSize * tileSize; i++) {
              const v = r0[i];
              if (!isFinite(v) || v === nodata) { imgData.data[i * 4 + 3] = 0; continue; }
              const [rv, gv, bv, av] = interpolateCogColormap(colormap, v);
              imgData.data[i * 4]     = rv;
              imgData.data[i * 4 + 1] = gv;
              imgData.data[i * 4 + 2] = bv;
              imgData.data[i * 4 + 3] = av;
            }
          } else {
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < r0.length; i++) {
              if (isFinite(r0[i]) && r0[i] !== 0) { min = Math.min(min, r0[i]); max = Math.max(max, r0[i]); }
            }
            const range = max - min || 1;
            for (let i = 0; i < tileSize * tileSize; i++) {
              if (bands >= 3) {
                imgData.data[i * 4]     = Math.round(((rasters[0][i] - min) / range) * 255);
                imgData.data[i * 4 + 1] = Math.round(((rasters[1][i] - min) / range) * 255);
                imgData.data[i * 4 + 2] = Math.round(((rasters[2][i] - min) / range) * 255);
              } else {
                const v = Math.round(((r0[i] - min) / range) * 255);
                imgData.data[i * 4] = imgData.data[i * 4 + 1] = imgData.data[i * 4 + 2] = v;
              }
              imgData.data[i * 4 + 3] = 255;
            }
          }

          ctx.putImageData(imgData, 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          return { data: await blob.arrayBuffer() };
        } catch (e) {
          console.warn('[COG] tile error', params.url, e);
          return { data: new ArrayBuffer(0) };
        }
      });
    }

    // Register mbtiles:// protocol — serves tiles stored in IndexedDB
    if (!(maplibregl as unknown as { _mbtilesProtocolRegistered?: boolean })._mbtilesProtocolRegistered) {
      (maplibregl as unknown as { _mbtilesProtocolRegistered?: boolean })._mbtilesProtocolRegistered = true;
      maplibregl.addProtocol('mbtiles', async (params) => {
        const url = params.url; // mbtiles://layerId/z/x/y
        const withoutProto = url.slice('mbtiles://'.length);
        const firstSlash = withoutProto.indexOf('/');
        if (firstSlash === -1) return { data: new ArrayBuffer(0) };
        const layerId = withoutProto.substring(0, firstSlash);
        const rest = withoutProto.substring(firstSlash + 1).split('/');
        const z = parseInt(rest[0]), x = parseInt(rest[1]), y = parseInt(rest[2]);
        if (isNaN(z) || isNaN(x) || isNaN(y)) return { data: new ArrayBuffer(0) };
        const blob = await StorageManager.getInstance().getTile(layerId, z, x, y);
        if (!blob) return { data: new ArrayBuffer(0) };
        return { data: await blob.arrayBuffer() };
      });
    }

    // Register rampify:// protocol — recolours RGB tiles through a luminance LUT
    // URL format: rampify://<key>@<version>/<real tile URL (templates pre-expanded)>
    if (!(maplibregl as unknown as { _rampifyProtocolRegistered?: boolean })._rampifyProtocolRegistered) {
      (maplibregl as unknown as { _rampifyProtocolRegistered?: boolean })._rampifyProtocolRegistered = true;
      maplibregl.addProtocol('rampify', async (params) => {
        try {
          const withoutProto = params.url.slice('rampify://'.length);
          const slash = withoutProto.indexOf('/');
          if (slash === -1) return { data: new ArrayBuffer(0) };
          const key = withoutProto.slice(0, slash).split('@')[0];
          const realUrl = withoutProto.slice(slash + 1);
          const resp = await fetch(realUrl);
          if (!resp.ok) return { data: new ArrayBuffer(0) };
          const blob = await resp.blob();
          const lut = rasterLutRegistry.get(key);
          if (!lut) return { data: await blob.arrayBuffer() };

          const bmp = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bmp, 0, 0);
          const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            const lum = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
            d[i]     = lut[lum * 3];
            d[i + 1] = lut[lum * 3 + 1];
            d[i + 2] = lut[lum * 3 + 2];
          }
          ctx.putImageData(img, 0, 0);
          const out = await canvas.convertToBlob({ type: 'image/png' });
          return { data: await out.arrayBuffer() };
        } catch (e) {
          console.warn('[rampify] tile error', params.url, e);
          return { data: new ArrayBuffer(0) };
        }
      });
    }

    this.map = new maplibregl.Map({
      container: containerId,
      style: this.buildMapStyle(basemap),
      center: [-63.755, 44.562], // Default to NS, Canada
      zoom: 13,
      maxZoom: 23,
      attributionControl: false,
      preserveDrawingBuffer: true, // required for canvas.toDataURL() in Layout Mode
    });

    // Add attribution in a non-intrusive way
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Scale control
    this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    await new Promise<void>((resolve, reject) => {
      this.map.on('load', () => {
        try {
          this.setupDataLayers();
          this.setupUserLocation();
          this.initialized = true;
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      this.map.on('error', (e: { error?: Error }) => {
        if (!this.initialized) reject(e.error ?? new Error('Map failed to load'));
      });
    });

    // Background color changes from LayersPanel
    EventBus.on<{ color: string }>('map-background-color', ({ color }) => {
      this.setBackgroundColor(color);
    });

    // Bind map events
    this.map.on('mousemove', (e) => {
      EventBus.emit('map-mousemove', { lngLat: e.lngLat });
    });

    this.map.on('mousedown', (e) => {
      EventBus.emit('map-mousedown', { lngLat: e.lngLat });
    });

    this.map.on('mouseup', (e) => {
      EventBus.emit('map-mouseup', { lngLat: e.lngLat });
    });

    this.map.on('click', (e) => {
      EventBus.emit('map-click', { lngLat: e.lngLat, originalEvent: e.originalEvent });
    });

    this.map.on('dblclick', (e) => {
      e.preventDefault();
      EventBus.emit('map-dblclick', { lngLat: e.lngLat });
    });

    this.map.on('moveend', () => {
      EventBus.emit('map-moveend', { center: this.map.getCenter(), zoom: this.map.getZoom(), bounds: this.map.getBounds() });
    });

    this.map.on('zoom', () => {
      EventBus.emit('map-zoom', { zoom: this.map.getZoom() });
    });
  }

  private mapBgColor = '#000000';

  setBackgroundColor(color: string): void {
    this.mapBgColor = color;
    if (this.map && this.map.getLayer('map-background')) {
      this.map.setPaintProperty('map-background', 'background-color', color);
    }
  }

  private buildMapStyle(basemap: typeof BASEMAPS[0]): StyleSpecification {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        basemap: {
          type: 'raster',
          tiles: [basemap.url],
          tileSize: basemap.tile_size ?? 256,
          maxzoom: basemap.max_zoom ?? 19,
          attribution: basemap.attribution
        }
      },
      layers: [
        { id: 'map-background', type: 'background', paint: { 'background-color': this.mapBgColor } },
        { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } }
      ]
    };
  }

  private setupDataLayers(): void {
    // --- Collected data sources ---
    this.map.addSource('collected-points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    this.map.addSource('collected-lines', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    this.map.addSource('collected-polygons', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // --- Sketch/GPS preview source ---
    this.map.addSource('sketch-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // --- User location source ---
    this.map.addSource('user-location', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // --- UTM Grid source ---
    this.map.addSource('utm-grid', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // --- Selected feature highlight ---
    this.map.addSource('selected-feature', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // --- Wetland plots (dedicated source so they're an independent TOC class) ---
    this.map.addSource('wetland-plots', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // ---- Layers ----

    // User accuracy circle
    this.map.addLayer({
      id: LAYER_IDS.USER_ACCURACY,
      type: 'circle',
      source: 'user-location',
      filter: ['==', ['get', 'type'], 'accuracy'],
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': 'rgba(66, 133, 244, 0.15)',
        'circle-stroke-color': 'rgba(66, 133, 244, 0.4)',
        'circle-stroke-width': 1
      }
    });

    // User location dot
    this.map.addLayer({
      id: LAYER_IDS.USER_LOCATION,
      type: 'circle',
      source: 'user-location',
      filter: ['==', ['get', 'type'], 'location'],
      paint: {
        'circle-radius': 8,
        'circle-color': '#4285f4',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });

    // UTM Grid lines
    this.map.addLayer({
      id: LAYER_IDS.UTM_GRID,
      type: 'line',
      source: 'utm-grid',
      layout: { visibility: 'none' },
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.4)',
        'line-width': 0.8,
        'line-dasharray': [4, 2]
      }
    });

    // Polygon fill (data-driven opacity)
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POLYGONS_FILL,
      type: 'fill',
      source: 'collected-polygons',
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#4ade80'],
        'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.35]
      }
    });

    // Polygon outline (data-driven stroke color + width)
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POLYGONS_OUTLINE,
      type: 'line',
      source: 'collected-polygons',
      paint: {
        'line-color': ['coalesce', ['get', 'stroke_color'], ['get', 'color'], '#4ade80'],
        'line-width': ['coalesce', ['get', 'stroke_width'], 2]
      }
    });

    // Line casing (rendered below main lines — wider, solid, casing_color)
    this.map.addLayer({
      id: 'collected-lines-casing',
      type: 'line',
      source: 'collected-lines',
      filter: ['>', ['coalesce', ['get', 'casing_width'], 0], 0],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'casing_color'], 'rgba(0,0,0,0)'],
        'line-width': ['+', ['coalesce', ['get', 'stroke_width'], 3], ['*', 2, ['coalesce', ['get', 'casing_width'], 0]]],
      }
    });

    // Lines — solid (default): all that are not dashed or dotted
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_LINES,
      type: 'line',
      source: 'collected-lines',
      filter: ['all',
        ['!=', ['coalesce', ['get', 'dash_pattern'], 'solid'], 'dashed'],
        ['!=', ['coalesce', ['get', 'dash_pattern'], 'solid'], 'dotted'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#facc15'],
        'line-width': ['coalesce', ['get', 'stroke_width'], 3],
      }
    });

    // Lines — dashed
    this.map.addLayer({
      id: 'collected-lines-dashed',
      type: 'line',
      source: 'collected-lines',
      filter: ['==', ['get', 'dash_pattern'], 'dashed'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#facc15'],
        'line-width': ['coalesce', ['get', 'stroke_width'], 3],
        'line-dasharray': [6, 3],
      }
    });

    // Lines — dotted
    this.map.addLayer({
      id: 'collected-lines-dotted',
      type: 'line',
      source: 'collected-lines',
      filter: ['==', ['get', 'dash_pattern'], 'dotted'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#facc15'],
        'line-width': ['coalesce', ['get', 'stroke_width'], 3],
        'line-dasharray': [1.5, 3],
      }
    });

    // Points — circle layer for non-symbol features (circle shape, no icon)
    // Also acts as hit-detection fallback for all points
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POINTS,
      type: 'circle',
      source: 'collected-points',
      filter: ['!', ['get', 'use_symbol']],
      paint: {
        'circle-radius': ['coalesce', ['get', 'size'], 7],
        'circle-color': ['coalesce', ['get', 'color'], '#4ade80'],
        'circle-stroke-color': ['coalesce', ['get', 'stroke_color'], '#ffffff'],
        'circle-stroke-width': ['coalesce', ['get', 'stroke_width'], 2],
        'circle-opacity': ['coalesce', ['get', 'fill_opacity'], 1],
      }
    });

    // Points — canvas-rendered symbol images (non-circle shapes or with icon overlay)
    this.map.addLayer({
      id: 'collected-points-symbols',
      type: 'symbol',
      source: 'collected-points',
      filter: ['get', 'use_symbol'],
      layout: {
        'icon-image': ['concat', 'preset-', ['get', 'preset_id']],
        // icon-size scales 48px canvas: size/24 → default size 7 → 0.29 → ~14px
        'icon-size': ['/', ['coalesce', ['get', 'size'], 7.0], 24.0],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      }
    });

    // Point labels — shown for all collected points when label_text is non-empty
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POINTS_LABELS,
      type: 'symbol',
      source: 'collected-points',
      layout: {
        'text-field': ['get', 'label_text'],
        'text-font': ['literal', ['Open Sans Regular', 'Arial Unicode MS Regular']],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'symbol-sort-key': ['get', 'created_at'],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 2
      }
    });

    // ---- Wetland plots — dedicated layers (mirror collected points) ----
    this.map.addLayer({
      id: 'wetland-plots-circle',
      type: 'circle',
      source: 'wetland-plots',
      filter: ['!', ['get', 'use_symbol']],
      paint: {
        'circle-radius': ['coalesce', ['get', 'size'], 7],
        'circle-color': ['coalesce', ['get', 'color'], '#14b8a6'],
        'circle-stroke-color': ['coalesce', ['get', 'stroke_color'], '#ffffff'],
        'circle-stroke-width': ['coalesce', ['get', 'stroke_width'], 2],
        'circle-opacity': ['coalesce', ['get', 'fill_opacity'], 1],
      }
    });
    this.map.addLayer({
      id: 'wetland-plots-symbols',
      type: 'symbol',
      source: 'wetland-plots',
      filter: ['get', 'use_symbol'],
      layout: {
        'icon-image': ['concat', 'preset-', ['get', 'preset_id']],
        'icon-size': ['/', ['coalesce', ['get', 'size'], 7.0], 24.0],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      }
    });
    this.map.addLayer({
      id: 'wetland-plots-labels',
      type: 'symbol',
      source: 'wetland-plots',
      layout: {
        'text-field': ['get', 'label_text'],
        'text-font': ['literal', ['Open Sans Regular', 'Arial Unicode MS Regular']],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 2
      }
    });

    // Sketch preview (polygon fill)
    this.map.addLayer({
      id: 'sketch-preview-fill',
      type: 'fill',
      source: 'sketch-preview',
      filter: ['==', '$type', 'Polygon'],
      paint: {
        'fill-color': 'rgba(255, 200, 0, 0.2)',
        'fill-outline-color': 'rgba(255, 200, 0, 0.8)'
      }
    });

    // Sketch preview (lines + polygon outline)
    this.map.addLayer({
      id: 'sketch-preview-line',
      type: 'line',
      source: 'sketch-preview',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#fbbf24',
        'line-width': 2.5,
        'line-dasharray': [4, 2]
      }
    });

    // Sketch preview vertices
    this.map.addLayer({
      id: 'sketch-preview-vertices',
      type: 'circle',
      source: 'sketch-preview',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#fbbf24',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });

    // Selected feature highlight
    this.map.addLayer({
      id: LAYER_IDS.SELECTED_FEATURE,
      type: 'line',
      source: 'selected-feature',
      paint: {
        'line-color': '#00eaff',
        'line-width': 4,
        'line-opacity': 0.9
      }
    });

    // Selected feature fill highlight
    this.map.addLayer({
      id: 'selected-feature-fill',
      type: 'fill',
      source: 'selected-feature',
      filter: ['==', '$type', 'Polygon'],
      paint: {
        'fill-color': 'rgba(0,234,255,0.2)'
      }
    });

    // Selected feature point highlight
    this.map.addLayer({
      id: 'selected-feature-point',
      type: 'circle',
      source: 'selected-feature',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 12,
        'circle-color': 'rgba(0,234,255,0.3)',
        'circle-stroke-color': '#00eaff',
        'circle-stroke-width': 3
      }
    });

    // --- Geometry editing sources ---
    this.map.addSource('edit-geom-preview', {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }
    });
    this.map.addSource('edit-geom-vertices', {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }
    });
    this.map.addSource('edit-geom-midpoints', {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }
    });

    this.map.addLayer({
      id: 'edit-geom-fill', type: 'fill', source: 'edit-geom-preview',
      filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': 'rgba(255,165,0,0.2)' }
    });
    this.map.addLayer({
      id: 'edit-geom-outline', type: 'line', source: 'edit-geom-preview',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#ff9800', 'line-width': 2.5, 'line-dasharray': [4, 2] }
    });
    this.map.addLayer({
      id: 'edit-geom-midpoints', type: 'circle', source: 'edit-geom-midpoints',
      paint: {
        'circle-radius': 5, 'circle-color': 'rgba(255,152,0,0.5)',
        'circle-stroke-color': '#ff9800', 'circle-stroke-width': 1.5
      }
    });
    this.map.addLayer({
      id: 'edit-geom-vertices', type: 'circle', source: 'edit-geom-vertices',
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 10, 7],
        'circle-color': ['case', ['get', 'selected'], '#ff5722', '#ff9800'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2
      }
    });

    // Make collected layers clickable for selection
    [LAYER_IDS.COLLECTED_POINTS, 'wetland-plots-circle', LAYER_IDS.COLLECTED_LINES,
      LAYER_IDS.COLLECTED_POLYGONS_FILL].forEach(layerId => {
      this.map.on('mouseenter', layerId, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        this.map.getCanvas().style.cursor = '';
      });
    });

    // Profile preview layers (dedicated, above all C/F and collected layers)
    this.map.addSource('profile-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    this.map.addLayer({
      id: 'profile-preview-border',
      type: 'line',
      source: 'profile-preview',
      filter: ['==', '$type', 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': 'rgba(0,0,0,0.55)', 'line-width': 6 }
    });
    this.map.addLayer({
      id: 'profile-preview-line',
      type: 'line',
      source: 'profile-preview',
      filter: ['==', '$type', 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'seg_type'],
          'cut',  '#ef4444',
          'fill', '#3b82f6',
          '#f1f5f9'
        ],
        'line-width': 3.5
      }
    });
    this.map.addLayer({
      id: 'profile-preview-vertices',
      type: 'circle',
      source: 'profile-preview',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'seg_type'], 'sample-pin']],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#64748b',
        'circle-stroke-width': 1.5
      }
    });
    // Sample-pin: the position clicked on the elevation-profile chart
    this.map.addLayer({
      id: 'profile-preview-pin',
      type: 'circle',
      source: 'profile-preview',
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'seg_type'], 'sample-pin']],
      paint: {
        'circle-radius': 8,
        'circle-color': '#f97316',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5
      }
    });
  }

  private setupUserLocation(): void {
    // User location is handled via GeoJSON source updates
  }

  getMap(): MLMap {
    return this.map;
  }

  getMapContainer(): HTMLElement {
    return this.map.getContainer();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ---- Data Updates ----
  updateCollectedFeatures(features: FieldFeature[], layerPresets?: LayerPreset[], typePresets?: TypePreset[]): void {
    if (!this.initialized) return;

    // Build lookup: layer_id → { color, visible }
    const layerMap = new Map<string, { color: string; stroke: string; visible: boolean }>();
    if (layerPresets) {
      for (const lp of layerPresets) {
        layerMap.set(lp.id, { color: lp.color, stroke: lp.stroke_color, visible: lp.visible !== false });
      }
    }

    // Build full TypePreset lookup: type label → TypePreset
    const typeMap = new Map<string, TypePreset>();
    if (typePresets) {
      for (const tp of typePresets) {
        typeMap.set(tp.label, tp);
      }
    }

    const points: object[] = [];
    const lines: object[] = [];
    const polygons: object[] = [];
    const wetlandPlots: object[] = [];

    for (const f of features) {
      const lp = layerMap.get(f.layer_id);
      if (lp && !lp.visible) continue;

      const tp = typeMap.get(f.type);
      // Skip features whose TypePreset is marked invisible
      if (tp && tp.visible === false) continue;

      // TypePreset color takes priority; features without any matched preset render grey
      let color         = tp?.color        ?? '#888888';
      const strokeColor = tp?.stroke_color ?? '#aaaaaa';
      const strokeWidth = tp?.stroke_width ?? 2;
      const fillOpacity = tp?.fill_opacity ?? (f.geometry_type === 'Polygon' ? 0.4 : 1.0);
      const size        = tp?.size         ?? 7;
      const icon        = tp?.icon         ?? '';
      const shape       = tp?.shape        ?? 'circle';
      const dashPattern = tp?.dash_pattern ?? 'solid';
      const casingColor = tp?.casing_color ?? null;
      const casingWidth = tp?.casing_width ?? 0;

      // use_symbol: true when shape is non-circle OR has icon (triggers symbol layer)
      const useSymbol = (shape !== 'circle') || (icon !== '');

      // label_text: type name, falling back to note/desc; empty when show_labels explicitly false
      let labelText = (!tp || tp.show_labels !== false) ? (f.type || f.desc || '') : '';

      // Wetland plots render in their own layer: colour differentially by Upland vs
      // Wetland plot type and label by PLOT ID (falling back to the point id).
      const isWetlandPlot = f.layer_id.endsWith('-wetlands') || !!f.wetland_data;
      let plotId = '';
      let plotType = '';
      if (isWetlandPlot) {
        plotType = String(f.wetland_data?.PLOT_TYPE ?? '');
        plotId = String(f.wetland_data?.PLOT_ID ?? '') || f.point_id;
        color = wetlandPlotColor(plotType);
        labelText = plotId;
      }

      const geoFeature = {
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          id: f.id,
          point_id: f.point_id,
          type: f.type,
          desc: f.desc,
          label_text: labelText,
          PLOT_ID: plotId,
          PLOT_TYPE: plotType,
          color,
          stroke_color: strokeColor,
          stroke_width: strokeWidth,
          fill_opacity: fillOpacity,
          size,
          icon,
          shape,
          dash_pattern: dashPattern,
          has_icon: icon !== '',
          use_symbol: useSymbol,
          casing_color: casingColor,
          casing_width: casingWidth,
          preset_id: tp?.id ?? '',
          layer_id: f.layer_id,
          created_at: f.created_at,
          elevation: f.elevation,
          accuracy: f.accuracy,
        }
      };

      // Wetland plots render in their OWN source/layers (independent TOC class).
      if (isWetlandPlot) wetlandPlots.push(geoFeature);
      else if (f.geometry_type === 'Point') points.push(geoFeature);
      else if (f.geometry_type === 'LineString') lines.push(geoFeature);
      else if (f.geometry_type === 'Polygon') polygons.push(geoFeature);
    }

    const toFC = (feats: object[]) => ({ type: 'FeatureCollection', features: feats });
    (this.map.getSource('collected-points') as maplibregl.GeoJSONSource)?.setData(toFC(points) as never);
    (this.map.getSource('collected-lines') as maplibregl.GeoJSONSource)?.setData(toFC(lines) as never);
    (this.map.getSource('collected-polygons') as maplibregl.GeoJSONSource)?.setData(toFC(polygons) as never);
    (this.map.getSource('wetland-plots') as maplibregl.GeoJSONSource)?.setData(toFC(wetlandPlots) as never);

    // Explicitly sync the visibility layout property for collected-lines sub-layers
    // (casing, dashed, dotted) so they disappear when the feature layer is toggled
    // off — relying on empty source data alone isn't sufficient because Symbology
    // Studio can leave those layers with opacity > 0 / filter = null.
    if (layerPresets !== undefined) {
      const linePresets = layerPresets.filter(
        lp => lp.geometry_type === 'LineString' && !lp.id.endsWith('-wetlands')
      );
      const lineVis = linePresets.length === 0 || linePresets.some(lp => lp.visible !== false)
        ? 'visible' : 'none';
      for (const id of [
        LAYER_IDS.COLLECTED_LINES,
        'collected-lines-casing',
        'collected-lines-dashed',
        'collected-lines-dotted',
        'collected-lines-labels',
      ]) {
        if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', lineVis);
      }
    }

    // Re-apply the wetland-plots layer's saved symbology + label visibility so it
    // survives data refreshes / reloads (paint persists, but reload needs it set).
    const wetlandLp = layerPresets?.find(lp => lp.id.endsWith('-wetlands'));
    const wetlandFeatProps = wetlandPlots.map(p => ({ properties: (p as { properties: Record<string, unknown> }).properties }));
    this.setWetlandPlotSymbology(wetlandLp?.symbologyState ?? null, wetlandFeatProps);
    this.setLayerVisibility('wetland-plots-labels', wetlandLp?.show_labels !== false);
  }

  private colorCache: Map<string, string> = new Map();

  private getFeatureColor(type: string): string {
    if (this.colorCache.has(type)) return this.colorCache.get(type)!;
    // Generate consistent colour from type string
    let hash = 0;
    for (let i = 0; i < type.length; i++) {
      hash = ((hash << 5) - hash) + type.charCodeAt(i);
      hash |= 0;
    }
    const h = Math.abs(hash) % 360;
    const color = `hsl(${h}, 70%, 55%)`;
    this.colorCache.set(type, color);
    return color;
  }

  updateSketchPreview(features: object[]): void {
    if (!this.initialized) return;
    (this.map.getSource('sketch-preview') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: features as never[]
    });
  }

  clearSketchPreview(): void {
    this.updateSketchPreview([]);
  }

  updateProfilePreview(features: object[]): void {
    if (!this.initialized) return;
    (this.map.getSource('profile-preview') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: features as never[]
    });
  }

  clearProfilePreview(): void {
    this.updateProfilePreview([]);
  }

  updateUserLocation(lat: number, lon: number, accuracy: number | null): void {
    if (!this.initialized) return;

    const features: object[] = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { type: 'location' }
      }
    ];

    if (accuracy !== null) {
      // Convert accuracy radius to map pixels approximately
      const metersPerPixel = this.getMetersPerPixel(lat);
      const radiusPx = accuracy / metersPerPixel;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { type: 'accuracy', radius: Math.max(8, Math.min(radiusPx, 200)) }
      });
    }

    (this.map.getSource('user-location') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: features as never[]
    });
  }

  private getMetersPerPixel(lat: number): number {
    const zoom = this.map.getZoom();
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }

  updateUTMGrid(data: object): void {
    if (!this.initialized) return;
    (this.map.getSource('utm-grid') as maplibregl.GeoJSONSource)?.setData(data as never);
  }

  setGridVisible(visible: boolean): void {
    if (!this.initialized) return;
    const vis = visible ? 'visible' : 'none';
    this.map.setLayoutProperty(LAYER_IDS.UTM_GRID, 'visibility', vis);
  }

  highlightFeature(feature: FieldFeature | null): void {
    if (!this.initialized) return;
    if (!feature) {
      (this.map.getSource('selected-feature') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: []
      });
      return;
    }
    (this.map.getSource('selected-feature') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: feature.geometry as never, properties: {} }]
    });
  }

  highlightFeatures(features: FieldFeature[]): void {
    if (!this.initialized) return;
    (this.map.getSource('selected-feature') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: features.map(f => ({ type: 'Feature', geometry: f.geometry as never, properties: {} }))
    });
  }

  flyTo(lat: number, lon: number, zoom?: number): void {
    this.map.flyTo({ center: [lon, lat], zoom: zoom ?? this.map.getZoom(), duration: 800 });
  }

  fitBounds(bounds: [[number, number], [number, number]], padding = 40): void {
    this.map.fitBounds(bounds, { padding, duration: 800 });
  }

  getCenter(): LngLat {
    return this.map.getCenter();
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  getBounds() {
    return this.map.getBounds();
  }

  getBearing(): number {
    return this.map.getBearing();
  }

  resetNorthPitch(): void {
    this.map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  }

  getCanvas(): HTMLCanvasElement {
    return this.map.getCanvas();
  }

  onRotate(callback: () => void): () => void {
    this.map.on('rotate', callback);
    return () => this.map.off('rotate', callback);
  }

  addMeasureLayer(): void {
    if (this.map.getSource('measure-preview')) return;
    this.map.addSource('measure-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.map.addLayer({ id: 'measure-line', type: 'line', source: 'measure-preview',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#facc15', 'line-width': 2, 'line-dasharray': [4, 2] }
    });
    this.map.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure-preview',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#facc15', 'fill-opacity': 0.15 }
    });
    this.map.addLayer({ id: 'measure-points', type: 'circle', source: 'measure-preview',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': '#facc15', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }
    });
  }

  updateMeasureLayer(data: object): void {
    const src = this.map.getSource('measure-preview') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data as Parameters<typeof src.setData>[0]);
  }

  removeMeasureLayer(): void {
    ['measure-points', 'measure-fill', 'measure-line'].forEach(id => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    if (this.map.getSource('measure-preview')) this.map.removeSource('measure-preview');
  }

  zoomIn(): void {
    this.map.zoomIn();
  }

  zoomOut(): void {
    this.map.zoomOut();
  }

  // ---- Basemap switching ----
  setBasemap(basemap: typeof BASEMAPS[0], overlayId?: string): void {
    if (!this.initialized) return;
    const src = this.map.getSource('basemap') as maplibregl.RasterTileSource | undefined;
    if (src) {
      // Remove and re-add source for URL update
      this.map.removeLayer('basemap');
      this.map.removeSource('basemap');
    }
    this.map.addSource('basemap', {
      type: 'raster',
      tiles: [basemap.url],
      tileSize: basemap.tile_size ?? 256,
      maxzoom: Math.max(basemap.max_zoom ?? 19, 23),
      attribution: basemap.attribution
    });
    // Insert basemap above the background layer but below everything else.
    // layers[0] is the 'map-background' (type:'background'); inserting before it
    // would place the raster tile layer underneath it, hiding the basemap entirely.
    const layers = this.map.getStyle().layers;
    const firstNonBgId = layers.find(l => l.type !== 'background')?.id;
    this.map.addLayer(
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } },
      firstNonBgId
    );

    // If hybrid, add labels overlay
    if (overlayId === 'esri-labels') {
      this.addEsriLabels();
    }
  }

  setBasemapOpacity(opacity: number): void {
    if (!this.initialized) return;
    this.map.setPaintProperty('basemap', 'raster-opacity', opacity);
  }

  setBasemapBlendMode(mode: string): void {
    if (!this.initialized) return;
    // MapLibre supports raster-resampling, not blend modes natively - apply via CSS
    const canvas = this.map.getCanvas();
    if (mode === 'none') canvas.style.mixBlendMode = 'normal';
    else canvas.style.mixBlendMode = mode;
  }

  private addEsriLabels(): void {
    const labelSrcId = 'esri-labels-src';
    if (!this.map.getSource(labelSrcId)) {
      this.map.addSource(labelSrcId, {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 20
      });
      this.map.addLayer({ id: 'esri-labels-layer', type: 'raster', source: labelSrcId });
    }
  }

  // ---- Custom raster layers (WMS, XYZ, COG) ----
  addRasterLayer(id: string, url: string, opacity = 1, beforeId?: string): void {
    if (!this.initialized) return;
    if (this.map.getLayer(id)) return;

    const srcId = `src-${id}`;
    if (!this.map.getSource(srcId)) {
      this.map.addSource(srcId, { type: 'raster', tiles: [url], tileSize: 256 });
    }
    this.map.addLayer(
      { id, type: 'raster', source: srcId, paint: { 'raster-opacity': opacity } },
      beforeId
    );
  }

  removeLayer(id: string): void {
    if (!this.initialized) return;
    if (this.map.getLayer(id)) this.map.removeLayer(id);
    const srcId = `src-${id}`;
    if (this.map.getSource(srcId)) this.map.removeSource(srcId);
  }

  setLayerOpacity(id: string, opacity: number): void {
    if (!this.initialized || !this.map.getLayer(id)) return;
    this.map.setPaintProperty(id, 'raster-opacity', opacity);
  }

  setLayerVisibility(id: string, visible: boolean): void {
    if (!this.initialized || !this.map.getLayer(id)) return;
    this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }

  // ---- GeoJSON vector layer for WFS/imported data ----
  addGeoJSONLayer(id: string, data: object, color: string, opacity = 0.8): void {
    if (!this.initialized) return;
    const srcId = `src-${id}`;
    if (this.map.getSource(srcId)) {
      (this.map.getSource(srcId) as maplibregl.GeoJSONSource).setData(data as never);
      return;
    }
    this.map.addSource(srcId, { type: 'geojson', data: data as never });

    this.map.addLayer({
      id: `${id}-fill`,
      type: 'fill',
      source: srcId,
      filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': color, 'fill-opacity': opacity * 0.4 }
    });
    // Line casing (rendered beneath the main line; off until symbology enables it).
    this.map.addLayer({
      id: `${id}-casing`,
      type: 'line',
      source: srcId,
      filter: ['==', '$type', 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0a0d12', 'line-width': 0, 'line-opacity': 0 }
    });
    this.map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: srcId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 2, 'line-opacity': opacity }
    });
    this.map.addLayer({
      id: `${id}-point`,
      type: 'circle',
      source: srcId,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': color,
        'circle-opacity': opacity,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1
      }
    });
  }

  removeGeoJSONLayer(id: string): void {
    [`${id}-fill`, `${id}-casing`, `${id}-line`, `${id}-point`, `${id}-labels`, `${id}-icons`].forEach(lid => {
      if (this.map.getLayer(lid)) this.map.removeLayer(lid);
    });
    const srcId = `src-${id}`;
    if (this.map.getSource(srcId)) this.map.removeSource(srcId);
  }

  // Apply data-driven symbology to a collected-* geometry group.
  // Pass null to reset to TypePreset-based defaults.
  setCollectedLayerSymbology(
    geomType: GeometryType,
    state: SymbologyState | null,
    features: { properties: Record<string, unknown> }[],
  ): void {
    if (!this.initialized) return;

    // Labels by any attribute (lines/polygons gain labels; points get an extra
    // attribute label distinct from the type/desc label layer).
    const labelSrc = geomType === 'Point' ? 'collected-points'
      : geomType === 'LineString' ? 'collected-lines' : 'collected-polygons';
    const labelId = geomType === 'Point' ? 'collected-points-symlabels'
      : geomType === 'LineString' ? 'collected-lines-labels' : 'collected-polygons-labels';
    this.setLayerLabels(labelSrc, labelId, state,
      geomType === 'LineString' ? { placement: 'line', anchor: 'center', offset: [0, 0] }
      : geomType === 'Polygon' ? { anchor: 'center', offset: [0, 0] }
      : undefined);
    if (geomType === 'Point') this.setPointIconOverlay('collected-points', 'collected-points-icons', state);

    if (geomType === 'Point') {
      const layerId = LAYER_IDS.COLLECTED_POINTS;
      if (!this.map.getLayer(layerId)) return;
      if (!state || (state.method === 'categorical' && state.field === 'type')) {
        this.map.setPaintProperty(layerId, 'circle-color', ['coalesce', ['get', 'color'], '#4ade80']);
        this.map.setPaintProperty(layerId, 'circle-radius', ['coalesce', ['get', 'size'], 7]);
        this.map.setPaintProperty(layerId, 'circle-opacity', 1);
        this.map.setPaintProperty(layerId, 'circle-stroke-color', ['coalesce', ['get', 'stroke_color'], '#ffffff']);
        this.map.setPaintProperty(layerId, 'circle-stroke-width', ['coalesce', ['get', 'stroke_width'], 2]);
        return;
      }
      this.map.setPaintProperty(layerId, 'circle-color', buildColorExpression(features, state));
      this.map.setPaintProperty(layerId, 'circle-opacity', state.opacity ?? 0.9);
      this.map.setPaintProperty(layerId, 'circle-radius',
        state.method === 'proportional'
          ? buildRadiusExpression(features, state)
          : (state.size ?? 7),
      );
      this.map.setPaintProperty(layerId, 'circle-stroke-color', state.outlineColor ?? '#ffffff');
      this.map.setPaintProperty(layerId, 'circle-stroke-width', state.outlineWidth ?? 1.5);
      return;
    }

    if (geomType === 'LineString') {
      const layerId = LAYER_IDS.COLLECTED_LINES;
      const casingId = 'collected-lines-casing';
      if (!this.map.getLayer(layerId)) return;
      if (!state) {
        this.map.setPaintProperty(layerId, 'line-color', ['coalesce', ['get', 'color'], '#facc15']);
        this.map.setPaintProperty(layerId, 'line-width', ['coalesce', ['get', 'stroke_width'], 3]);
        this.map.setPaintProperty(layerId, 'line-opacity', 1);
        this.map.setLayoutProperty(layerId, 'line-cap', 'round');
        // Restore per-feature (casing_color / casing_width) driven casing.
        if (this.map.getLayer(casingId)) {
          this.map.setFilter(casingId, ['>', ['coalesce', ['get', 'casing_width'], 0], 0]);
          this.map.setPaintProperty(casingId, 'line-color', ['coalesce', ['get', 'casing_color'], 'rgba(0,0,0,0)']);
          this.map.setPaintProperty(casingId, 'line-width', ['+', ['coalesce', ['get', 'stroke_width'], 3], ['*', 2, ['coalesce', ['get', 'casing_width'], 0]]]);
          this.map.setPaintProperty(casingId, 'line-opacity', 1);
        }
        return;
      }
      // Lines are fully opaque by default; the slider still lets the user dial it down.
      const lineOpacity = state.opacity ?? 1;
      this.map.setPaintProperty(layerId, 'line-color', buildColorExpression(features, state));
      this.map.setPaintProperty(layerId, 'line-width', state.size ?? 3);
      this.map.setPaintProperty(layerId, 'line-opacity', lineOpacity);
      if (state.cap) this.map.setLayoutProperty(layerId, 'line-cap', state.cap);
      // Symbology-driven casing: a uniform border beneath every line.
      if (this.map.getLayer(casingId)) {
        if (state.casing && (state.casingWidth ?? 0) > 0) {
          this.map.setFilter(casingId, null);
          this.map.setPaintProperty(casingId, 'line-color', state.casingColor ?? '#0a0d12');
          this.map.setPaintProperty(casingId, 'line-width', (state.size ?? 3) + (state.casingWidth ?? 2) * 2);
          this.map.setPaintProperty(casingId, 'line-opacity', lineOpacity);
          if (state.cap) this.map.setLayoutProperty(casingId, 'line-cap', state.cap);
        } else {
          // Casing off — keep all features in range but render nothing.
          this.map.setFilter(casingId, null);
          this.map.setPaintProperty(casingId, 'line-opacity', 0);
        }
      }
      return;
    }

    if (geomType === 'Polygon') {
      const fillId = LAYER_IDS.COLLECTED_POLYGONS_FILL;
      const outlineId = LAYER_IDS.COLLECTED_POLYGONS_OUTLINE;
      if (!state) {
        if (this.map.getLayer(fillId)) {
          this.map.setPaintProperty(fillId, 'fill-color', ['coalesce', ['get', 'color'], '#4ade80']);
          this.map.setPaintProperty(fillId, 'fill-opacity', ['coalesce', ['get', 'fill_opacity'], 0.35]);
        }
        if (this.map.getLayer(outlineId)) {
          this.map.setPaintProperty(outlineId, 'line-color', ['coalesce', ['get', 'stroke_color'], ['get', 'color'], '#4ade80']);
          this.map.setPaintProperty(outlineId, 'line-width', ['coalesce', ['get', 'stroke_width'], 2]);
        }
        return;
      }
      const colorExpr = buildColorExpression(features, state);
      if (this.map.getLayer(fillId)) {
        this.map.setPaintProperty(fillId, 'fill-color', colorExpr);
        this.map.setPaintProperty(fillId, 'fill-opacity', state.opacity ?? 0.65);
      }
      if (this.map.getLayer(outlineId)) {
        this.map.setPaintProperty(outlineId, 'line-color', state.strokeColor ?? '#ffffff');
        this.map.setPaintProperty(outlineId, 'line-width', state.size ?? 1.5);
        this.map.setPaintProperty(outlineId, 'line-opacity', state.strokeOpacity ?? 0.4);
      }
    }
  }

  // Apply data-driven symbology to an imported GeoJSON layer.
  /** Apply data-driven symbology + labels to the dedicated wetland-plots layers. */
  setWetlandPlotSymbology(
    state: SymbologyState | null,
    features: { properties: Record<string, unknown> }[],
  ): void {
    if (!this.initialized) return;
    const circleId = 'wetland-plots-circle';
    const labelId = 'wetland-plots-labels';

    // Labels: default to per-feature PLOT_ID (label_text); honour a chosen field.
    if (this.map.getLayer(labelId)) {
      const lf = state?.label_field;
      this.map.setLayoutProperty(labelId, 'text-field',
        lf ? ['coalesce', ['to-string', ['get', lf]], ''] : ['get', 'label_text']);
      this.map.setLayoutProperty(labelId, 'text-size', state?.label_size ?? 11);
      this.map.setPaintProperty(labelId, 'text-color', state?.label_color ?? '#ffffff');
    }

    if (!this.map.getLayer(circleId)) return;
    if (!state) {
      // Default — per-feature colour (by PLOT_TYPE, set in updateCollectedFeatures)
      this.map.setPaintProperty(circleId, 'circle-color', ['coalesce', ['get', 'color'], '#14b8a6']);
      this.map.setPaintProperty(circleId, 'circle-radius', ['coalesce', ['get', 'size'], 7]);
      this.map.setPaintProperty(circleId, 'circle-opacity', ['coalesce', ['get', 'fill_opacity'], 1]);
      this.map.setPaintProperty(circleId, 'circle-stroke-color', ['coalesce', ['get', 'stroke_color'], '#ffffff']);
      this.map.setPaintProperty(circleId, 'circle-stroke-width', ['coalesce', ['get', 'stroke_width'], 2]);
      return;
    }
    this.map.setPaintProperty(circleId, 'circle-color', buildColorExpression(features, state));
    this.map.setPaintProperty(circleId, 'circle-opacity', state.opacity ?? 0.9);
    this.map.setPaintProperty(circleId, 'circle-radius',
      state.method === 'proportional' ? buildRadiusExpression(features, state) : (state.size ?? 7));
    this.map.setPaintProperty(circleId, 'circle-stroke-color', state.outlineColor ?? '#ffffff');
    this.map.setPaintProperty(circleId, 'circle-stroke-width', state.outlineWidth ?? 1.5);
  }

  setImportedLayerSymbology(
    layerId: string,
    state: SymbologyState | null,
    features: { properties: Record<string, unknown> }[],
    originalColor: string,
  ): void {
    if (!this.initialized) return;
    // Optional point icon overlay (no-op for non-point features via the layer filter).
    this.setPointIconOverlay(`src-${layerId}`, `${layerId}-icons`, state);
    const fillId = `${layerId}-fill`;
    const lineId = `${layerId}-line`;
    const casingId = `${layerId}-casing`;
    const pointId = `${layerId}-point`;

    if (!state) {
      if (this.map.getLayer(pointId)) {
        this.map.setPaintProperty(pointId, 'circle-color', originalColor);
        this.map.setPaintProperty(pointId, 'circle-opacity', 0.8);
        this.map.setPaintProperty(pointId, 'circle-radius', 5);
      }
      if (this.map.getLayer(lineId)) {
        this.map.setPaintProperty(lineId, 'line-color', originalColor);
        this.map.setPaintProperty(lineId, 'line-opacity', 0.8);
        this.map.setPaintProperty(lineId, 'line-width', 2);
      }
      if (this.map.getLayer(casingId)) this.map.setPaintProperty(casingId, 'line-opacity', 0);
      if (this.map.getLayer(fillId)) {
        this.map.setPaintProperty(fillId, 'fill-color', originalColor);
        this.map.setPaintProperty(fillId, 'fill-opacity', 0.32);
      }
      return;
    }

    const colorExpr = buildColorExpression(features, state);
    // Decouple fill vs stroke opacity. For polygon layers the SymbologyStudio
    // exposes a separate stroke-opacity (state.strokeOpacity); point/line layers
    // only set state.opacity, so stroke falls back to it.
    const fillOpacity = state.opacity ?? 0.8;
    const strokeOpacity = state.strokeOpacity ?? fillOpacity;

    if (this.map.getLayer(pointId)) {
      this.map.setPaintProperty(pointId, 'circle-color', colorExpr);
      this.map.setPaintProperty(pointId, 'circle-opacity', fillOpacity);
      this.map.setPaintProperty(pointId, 'circle-radius',
        state.method === 'proportional'
          ? buildRadiusExpression(features, state)
          : (state.size ?? 5),
      );
      this.map.setPaintProperty(pointId, 'circle-stroke-color', state.outlineColor ?? '#ffffff');
      this.map.setPaintProperty(pointId, 'circle-stroke-width', state.outlineWidth ?? 1);
    }
    if (this.map.getLayer(lineId)) {
      this.map.setPaintProperty(lineId, 'line-color', colorExpr);
      this.map.setPaintProperty(lineId, 'line-opacity', strokeOpacity);
      this.map.setPaintProperty(lineId, 'line-width', state.size ?? 2);
      if (state.cap) this.map.setLayoutProperty(lineId, 'line-cap', state.cap);
    }
    if (this.map.getLayer(casingId)) {
      if (state.casing && (state.casingWidth ?? 0) > 0) {
        this.map.setPaintProperty(casingId, 'line-color', state.casingColor ?? '#0a0d12');
        this.map.setPaintProperty(casingId, 'line-width', (state.size ?? 2) + (state.casingWidth ?? 2) * 2);
        this.map.setPaintProperty(casingId, 'line-opacity', strokeOpacity);
        if (state.cap) this.map.setLayoutProperty(casingId, 'line-cap', state.cap);
      } else {
        this.map.setPaintProperty(casingId, 'line-opacity', 0);
      }
    }
    if (this.map.getLayer(fillId)) {
      this.map.setPaintProperty(fillId, 'fill-color', colorExpr);
      this.map.setPaintProperty(fillId, 'fill-opacity', fillOpacity);
    }
  }

  // Apply data-driven symbology to a web-based vector overlay (NSHN / NSPRD).
  setVectorOverlaySymbology(
    instanceId: string,
    state: SymbologyState | null,
    features: { properties: Record<string, unknown> }[],
    geomType: 'line' | 'polygon',
  ): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${instanceId}`;
    const strokeId = `${layerId}-stroke`;

    // Labels (any attribute) — also handles removal when label_field is cleared.
    this.setLayerLabels(`bmsrc-${instanceId}`, `${layerId}-labels`, state,
      geomType === 'line' ? { placement: 'line', anchor: 'center', offset: [0, 0] } : { anchor: 'center', offset: [0, 0] });

    if (!state) return;

    const colorExpr = buildColorExpression(features, state);
    // Fill and stroke opacity are independent: state.opacity drives the fill,
    // state.strokeOpacity drives the outline (falling back to opacity).
    const fillOpacity = state.opacity ?? 1.0;
    const strokeOpacity = state.strokeOpacity ?? fillOpacity;

    if (geomType === 'line') {
      if (this.map.getLayer(layerId)) {
        this.map.setPaintProperty(layerId, 'line-color', colorExpr);
        this.map.setPaintProperty(layerId, 'line-width', state.size ?? 1);
        this.map.setPaintProperty(layerId, 'line-opacity', fillOpacity);
      }
    } else {
      if (this.map.getLayer(layerId)) {
        this.map.setPaintProperty(layerId, 'fill-color', colorExpr);
        this.map.setPaintProperty(layerId, 'fill-opacity', fillOpacity);
      }
      if (this.map.getLayer(strokeId)) {
        this.map.setPaintProperty(strokeId, 'line-color', state.strokeColor ?? '#ffffff');
        this.map.setPaintProperty(strokeId, 'line-width', state.size ?? 1);
        this.map.setPaintProperty(strokeId, 'line-opacity', strokeOpacity);
      }
    }
  }

  // ---- GeoPDF image overlay ----
  addGeoPDFLayer(
    id: string,
    imageDataUrl: string,
    bounds: [number, number, number, number],
    opacity: number,
  ): void {
    if (!this.initialized) return;
    const srcId = `src-${id}`;
    if (this.map.getSource(srcId)) return; // already added
    const [west, south, east, north] = bounds;
    this.map.addSource(srcId, {
      type: 'image',
      url: imageDataUrl,
      coordinates: [
        [west, north],  // top-left
        [east, north],  // top-right
        [east, south],  // bottom-right
        [west, south],  // bottom-left
      ],
    });
    this.map.addLayer({
      id,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': opacity },
    });
  }

  setImportedLayerLabel(layerId: string, field: string | null | undefined): void {
    if (!this.initialized) return;
    const labelLayerId = `${layerId}-labels`;
    if (this.map.getLayer(labelLayerId)) this.map.removeLayer(labelLayerId);
    if (!field) return;
    const srcId = `src-${layerId}`;
    if (!this.map.getSource(srcId)) return;
    this.map.addLayer({
      id: labelLayerId, type: 'symbol', source: srcId,
      layout: {
        'text-field': ['coalesce', ['to-string', ['get', field]], ''],
        'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 10
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.5 }
    });
  }

  /**
   * Create/update/remove a symbol label layer driven by SymbologyState.label_field
   * (any source attribute). Shared by collected, imported, static, and web-vector
   * layers. Passing no field (or null state) removes the label layer.
   */
  setLayerLabels(
    sourceId: string,
    labelLayerId: string,
    state: SymbologyState | null,
    opts?: { placement?: 'point' | 'line'; anchor?: string; offset?: [number, number] },
  ): void {
    if (!this.initialized) return;
    const field = state?.label_field;
    const exists = this.map.getLayer(labelLayerId);
    if (!field) { if (exists) this.map.removeLayer(labelLayerId); return; }
    if (!this.map.getSource(sourceId)) return;

    const size = state?.label_size ?? 12;
    const color = state?.label_color ?? '#f8fafc';
    const textField = ['coalesce', ['to-string', ['get', field]], ''] as unknown;

    if (exists) {
      this.map.setLayoutProperty(labelLayerId, 'text-field', textField as never);
      this.map.setLayoutProperty(labelLayerId, 'text-size', size);
      this.map.setPaintProperty(labelLayerId, 'text-color', color);
      return;
    }
    this.map.addLayer({
      id: labelLayerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'text-field': textField as never,
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': size,
        'text-offset': opts?.offset ?? [0, 1.1],
        'text-anchor': (opts?.anchor ?? 'top') as never,
        'text-max-width': 10,
        'symbol-placement': (opts?.placement ?? 'point') as never,
        'text-allow-overlap': false,
      },
      paint: { 'text-color': color, 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5 },
    });
  }

  /**
   * Single icon overlay on a point layer (Symbology Studio). Renders the chosen
   * icon glyph (icon_color) as a symbol layer on top of the circle so the
   * data-driven circle colour still shows beneath. No icon → removes the layer.
   */
  setPointIconOverlay(sourceId: string, iconLayerId: string, state: SymbologyState | null): void {
    if (!this.initialized) return;
    const icon = state?.icon;
    const exists = this.map.getLayer(iconLayerId);
    const imgId = `ssicon-${iconLayerId}`;
    if (!icon) { if (exists) this.map.removeLayer(iconLayerId); return; }
    if (!this.map.getSource(sourceId)) return;

    const data = renderIconImageData(icon, state?.icon_color ?? '#ffffff');
    if (!data) { if (exists) this.map.removeLayer(iconLayerId); return; }
    if (this.map.hasImage(imgId)) this.map.removeImage(imgId);
    this.map.addImage(imgId, data, { pixelRatio: 2 });

    const size = (state?.icon_size ?? 1) * 0.6;
    const rotate = state?.icon_rotation ?? 0;
    if (exists) {
      this.map.setLayoutProperty(iconLayerId, 'icon-image', imgId);
      this.map.setLayoutProperty(iconLayerId, 'icon-size', size);
      this.map.setLayoutProperty(iconLayerId, 'icon-rotate', rotate);
      return;
    }
    this.map.addLayer({
      id: iconLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['==', '$type', 'Point'],
      layout: {
        'icon-image': imgId,
        'icon-size': size,
        'icon-rotate': rotate,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }

  // ---- Geometry editing ----
  updateEditGeometry(
    vertices: object[], midpoints: object[], previewGeom: object | null
  ): void {
    if (!this.initialized) return;
    (this.map.getSource('edit-geom-vertices') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection', features: vertices as never[]
    });
    (this.map.getSource('edit-geom-midpoints') as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection', features: midpoints as never[]
    });
    (this.map.getSource('edit-geom-preview') as maplibregl.GeoJSONSource)?.setData(
      previewGeom
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: previewGeom, properties: {} }] } as never
        : { type: 'FeatureCollection', features: [] } as never
    );
  }

  clearEditGeometry(): void {
    if (!this.initialized) return;
    const empty = { type: 'FeatureCollection', features: [] };
    (this.map.getSource('edit-geom-vertices') as maplibregl.GeoJSONSource)?.setData(empty as never);
    (this.map.getSource('edit-geom-midpoints') as maplibregl.GeoJSONSource)?.setData(empty as never);
    (this.map.getSource('edit-geom-preview') as maplibregl.GeoJSONSource)?.setData(empty as never);
  }

  queryEditVerticesAt(point: maplibregl.Point): maplibregl.MapGeoJSONFeature[] {
    return this.map.queryRenderedFeatures(point, { layers: ['edit-geom-vertices'] });
  }

  queryEditMidpointsAt(point: maplibregl.Point): maplibregl.MapGeoJSONFeature[] {
    return this.map.queryRenderedFeatures(point, { layers: ['edit-geom-midpoints'] });
  }

  // ---- Query features at point ----
  queryFeaturesAtPoint(point: maplibregl.Point): maplibregl.MapGeoJSONFeature[] {
    return this.map.queryRenderedFeatures(point, {
      layers: [
        LAYER_IDS.COLLECTED_POINTS,
        'collected-points-symbols',
        'wetland-plots-circle',
        'wetland-plots-symbols',
        LAYER_IDS.COLLECTED_LINES,
        'collected-lines-dashed',
        'collected-lines-dotted',
        LAYER_IDS.COLLECTED_POLYGONS_FILL
      ]
    });
  }

  /** Load (or reload) canvas-rendered symbol images for all given TypePresets. */
  loadPresetImages(presets: TypePreset[]): void {
    if (!this.initialized) return;
    const sr = new SymbolRenderer(this.map);
    sr.registerAll(presets);
  }

  // ---- Basemap overlay management ----
  addBasemapOverlay(instanceId: string, url: string, opacity: number): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${instanceId}`;
    const srcId = `bmsrc-${instanceId}`;
    if (!this.map.getSource(srcId)) {
      this.map.addSource(srcId, { type: 'raster', tiles: [url], tileSize: 256 });
    }
    if (!this.map.getLayer(layerId)) {
      this.map.addLayer(
        { id: layerId, type: 'raster', source: srcId, paint: { 'raster-opacity': opacity } },
        LAYER_IDS.USER_ACCURACY
      );
    }
    if (!this.basemapOverlayIds.includes(layerId)) this.basemapOverlayIds.push(layerId);
  }

  removeBasemapOverlay(instanceId: string): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${instanceId}`;
    const srcId = `bmsrc-${instanceId}`;
    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    if (this.map.getSource(srcId)) this.map.removeSource(srcId);
    this.basemapOverlayIds = this.basemapOverlayIds.filter(id => id !== layerId);
  }

  rebuildBasemapOverlays(overlays: Array<{
    instanceId: string; url: string; opacity: number; visible: boolean;
  }>): void {
    if (!this.initialized) return;
    for (const layerId of [...this.basemapOverlayIds]) {
      const srcId = layerId.replace('bm-ov-', 'bmsrc-');
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      if (this.map.getSource(srcId)) this.map.removeSource(srcId);
    }
    this.basemapOverlayIds = [];
    for (const ov of overlays) {
      const layerId = `bm-ov-${ov.instanceId}`;
      const srcId = `bmsrc-${ov.instanceId}`;
      if (!this.map.getSource(srcId)) {
        this.map.addSource(srcId, { type: 'raster', tiles: [ov.url], tileSize: 256 });
      }
      this.map.addLayer(
        { id: layerId, type: 'raster', source: srcId, paint: { 'raster-opacity': ov.opacity } },
        LAYER_IDS.USER_ACCURACY
      );
      if (!ov.visible) this.map.setLayoutProperty(layerId, 'visibility', 'none');
      this.basemapOverlayIds.push(layerId);
    }
  }

  clearAllRasterOverlays(): void {
    if (!this.initialized) return;
    for (const layerId of [...this.basemapOverlayIds]) {
      const srcId = layerId.replace('bm-ov-', 'bmsrc-');
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      if (this.map.getSource(srcId)) this.map.removeSource(srcId);
    }
    this.basemapOverlayIds = [];
  }

  /** Add a WebGLBlendLayer (CustomLayerInterface) before the user-data layers and track it for cleanup. */
  addCustomBlendOverlay(layer: import('maplibre-gl').CustomLayerInterface): void {
    if (!this.initialized) return;
    this.map.addLayer(layer, LAYER_IDS.USER_ACCURACY);
    this.basemapOverlayIds.push(layer.id);
  }

  addSingleRasterOverlay(ov: {
    instanceId: string; url: string; opacity: number; visible: boolean;
  }): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${ov.instanceId}`;
    const srcId = `bmsrc-${ov.instanceId}`;
    if (!this.map.getSource(srcId)) {
      this.map.addSource(srcId, { type: 'raster', tiles: [ov.url], tileSize: 256 });
    }
    this.map.addLayer(
      { id: layerId, type: 'raster', source: srcId, paint: { 'raster-opacity': ov.opacity } },
      LAYER_IDS.USER_ACCURACY,
    );
    if (!ov.visible) this.map.setLayoutProperty(layerId, 'visibility', 'none');
    this.basemapOverlayIds.push(layerId);
  }

  setBasemapOverlayOpacity(instanceId: string, opacity: number): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${instanceId}`;
    if (this.map.getLayer(layerId)) this.map.setPaintProperty(layerId, 'raster-opacity', opacity);
  }

  setBasemapOverlayVisible(instanceId: string, visible: boolean): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${instanceId}`;
    if (this.map.getLayer(layerId)) this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }

  /** Set a raster paint property on an overlay layer */
  setBasemapOverlayPaint(instanceId: string, prop: string, val: number): void {
    if (!this.initialized) return;
    const layerId = `bm-ov-${instanceId}`;
    if (this.map.getLayer(layerId)) this.map.setPaintProperty(layerId, prop as never, val);
  }

  /** Set a raster paint property on the base basemap layer */
  setBasemapPaint(prop: string, val: number): void {
    if (!this.initialized) return;
    if (this.map.getLayer('basemap')) this.map.setPaintProperty('basemap', prop as never, val);
  }

  /** Update the colormap used for a COG layer (takes effect on next tile refresh). */
  setCogColormap(cogUrl: string, stops: CogColorStop[]): void {
    cogColormapRegistry.set(cogUrl, stops);
  }

  /** Set bilinear smooth resampling for a COG layer (takes effect on next tile refresh). */
  setCogSmooth(cogUrl: string, smooth: boolean): void {
    cogSmoothRegistry.set(cogUrl, smooth);
  }

  /** Extract the raw COG URL from a cog:// tile URL template. */
  static cogUrlFromTemplate(tileTemplate: string): string {
    const parts = tileTemplate.split('?')[0].slice('cog://'.length).split('/');
    parts.pop(); parts.pop(); parts.pop(); // strip {y}, {x}, {z}
    return decodeURIComponent(parts.join('/'));
  }

  /**
   * Sample pixel values from a COG by reading a coarse (downsampled) overview of
   * the whole image. Returns finite values (nodata excluded) for data-driven
   * classification (Natural breaks / Quantile). Returns [] on failure.
   */
  async sampleCogValues(cogUrl: string, maxDim = 96): Promise<number[]> {
    try {
      const { fromUrl } = await import('geotiff');
      const tiff = await fromUrl(cogUrl);
      // Read the smallest overview (last image) so sampling is a single small range read.
      const count = await tiff.getImageCount();
      const image = await tiff.getImage(Math.max(0, count - 1));
      const w = image.getWidth(), h = image.getHeight();
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const rw = Math.max(1, Math.round(w * scale));
      const rh = Math.max(1, Math.round(h * scale));
      const rasters = await image.readRasters({
        width: rw, height: rh, interleave: false, resampleMethod: 'nearest',
      }) as unknown as number[][];
      const band = rasters[0];
      const nodata = (image as unknown as { getGDALNoData?: () => number | null }).getGDALNoData?.() ?? null;
      const out: number[] = [];
      for (let i = 0; i < band.length; i++) {
        const v = band[i];
        if (isFinite(v) && v !== nodata) out.push(v);
      }
      return out;
    } catch (e) {
      console.warn('[COG] sampleCogValues failed', e);
      return [];
    }
  }

  /**
   * Read a single COG pixel value at a lng/lat (full-res image, 1×1 window).
   * Mirrors the cog:// protocol's CRS detection so non-4326 COGs sample correctly.
   * Returns null when outside the raster or at a nodata pixel.
   */
  async sampleCogAtPoint(cogUrl: string, lng: number, lat: number): Promise<number | null> {
    try {
      const { fromUrl } = await import('geotiff');
      const tiff = await fromUrl(cogUrl);
      const image = await tiff.getImage();
      const geoKeys = image.getGeoKeys() as Record<string, number> | undefined;
      const epsgCode = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? 4326;
      const cogCrs = `EPSG:${epsgCode}`;
      if (epsgCode !== 4326 && epsgCode !== 3857) {
        try { proj4(cogCrs, 'EPSG:4326', [0, 0]); } catch {
          if (epsgCode === 22620) proj4.defs(cogCrs, '+proj=utm +zone=20 +ellps=GRS80 +units=m +no_defs');
          else if (epsgCode >= 32601 && epsgCode <= 32660) proj4.defs(cogCrs, `+proj=utm +zone=${epsgCode - 32600} +datum=WGS84 +units=m +no_defs`);
          else if (epsgCode >= 32701 && epsgCode <= 32760) proj4.defs(cogCrs, `+proj=utm +zone=${epsgCode - 32700} +south +datum=WGS84 +units=m +no_defs`);
          else if (epsgCode >= 26901 && epsgCode <= 26960) proj4.defs(cogCrs, `+proj=utm +zone=${epsgCode - 26900} +datum=NAD83 +units=m +no_defs`);
        }
      }
      const [x, y] = epsgCode === 4326 ? [lng, lat] : proj4('EPSG:4326', cogCrs, [lng, lat]);
      const [ox, oy] = image.getOrigin();
      const [rx, ry] = image.getResolution();
      const px = Math.floor((x - ox) / rx);
      const py = Math.floor((y - oy) / ry);
      if (px < 0 || py < 0 || px >= image.getWidth() || py >= image.getHeight()) return null;
      const rasters = await image.readRasters({ window: [px, py, px + 1, py + 1], interleave: false }) as unknown as number[][];
      const v = rasters[0]?.[0];
      const nodata = (image as unknown as { getGDALNoData?: () => number | null }).getGDALNoData?.() ?? null;
      if (v == null || !isFinite(v) || v === nodata) return null;
      return v;
    } catch (e) {
      console.warn('[COG] sampleCogAtPoint failed', e);
      return null;
    }
  }

  /** Register / clear the luminance recolour LUT for a rampify:// raster layer. */
  setRasterRecolorLut(key: string, lut: Uint8ClampedArray | null): void {
    if (lut) rasterLutRegistry.set(key, lut);
    else rasterLutRegistry.delete(key);
  }

  /** Wrap a tile URL template in the rampify:// recolour protocol. */
  static rampifyUrl(key: string, url: string, version: number): string {
    return `rampify://${key}@${version}/${url}`;
  }

  destroy(): void {
    this.map?.remove();
  }
}
