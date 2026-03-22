import maplibregl from 'maplibre-gl';
import type { Map as MLMap, LngLat, StyleSpecification } from 'maplibre-gl';
import type { FieldFeature, AppSettings } from '../types';
import { LAYER_IDS, BASEMAPS } from '../constants';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';
import proj4 from 'proj4';

export class MapManager {
  private map!: MLMap;
  private userMarker: maplibregl.Marker | null = null;
  private accuracyCircle: maplibregl.Marker | null = null;
  private initialized = false;
  private basemapOverlayIds: string[] = [];

  async init(containerId: string, settings: AppSettings): Promise<void> {
    const basemap = BASEMAPS.find(b => b.id === settings.basemap_id) ?? BASEMAPS[0];

    // Register cog:// protocol — reads Cloud-Optimized GeoTIFFs via range requests
    if (!(maplibregl as unknown as { _cogProtocolRegistered?: boolean })._cogProtocolRegistered) {
      (maplibregl as unknown as { _cogProtocolRegistered?: boolean })._cogProtocolRegistered = true;
      const cogCache = new Map<string, import('geotiff').GeoTIFF>();
      maplibregl.addProtocol('cog', async (params) => {
        try {
          // URL format: cog://ENCODED_COG_URL/z/x/y
          const withoutProto = params.url.slice('cog://'.length);
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

          // Convert to EPSG:4326 for GeoTIFF read
          const sw4326 = proj4('EPSG:3857', 'EPSG:4326', [west3857, south3857]);
          const ne4326 = proj4('EPSG:3857', 'EPSG:4326', [east3857, north3857]);

          let tiff = cogCache.get(cogUrl);
          if (!tiff) {
            const { fromUrl } = await import('geotiff');
            tiff = await fromUrl(cogUrl);
            cogCache.set(cogUrl, tiff);
          }
          const image = await tiff.getImage();
          const bands = image.getSamplesPerPixel();

          // Convert geographic bbox to pixel window
          const origin = image.getOrigin();     // [topLeftX, topLeftY]
          const res = image.getResolution();    // [xRes, yRes] — yRes may be negative
          const imgW = image.getWidth();
          const imgH = image.getHeight();
          const [ox, oy] = origin;
          const rx = res[0], ry = res[1];
          const pxL = Math.round((sw4326[0] - ox) / rx);
          const pxR = Math.round((ne4326[0] - ox) / rx);
          const pxT = Math.round((ne4326[1] - oy) / ry);
          const pxB = Math.round((sw4326[1] - oy) / ry);
          const winL = Math.max(0, Math.min(pxL, pxR));
          const winR = Math.min(imgW, Math.max(pxL, pxR));
          const winT = Math.max(0, Math.min(pxT, pxB));
          const winB = Math.min(imgH, Math.max(pxT, pxB));

          if (winL >= winR || winT >= winB) return { data: new ArrayBuffer(0) };

          const rasters = await image.readRasters({
            window: [winL, winT, winR, winB],
            width: tileSize, height: tileSize, interleave: false
          }) as unknown as number[][];

          // Find min/max for auto-scaling (first band)
          const r0 = rasters[0];
          let min = Infinity, max = -Infinity;
          for (let i = 0; i < r0.length; i++) {
            if (isFinite(r0[i]) && r0[i] !== 0) { min = Math.min(min, r0[i]); max = Math.max(max, r0[i]); }
          }
          const range = max - min || 1;

          const canvas = new OffscreenCanvas(tileSize, tileSize);
          const ctx = canvas.getContext('2d')!;
          const imgData = ctx.createImageData(tileSize, tileSize);

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
          ctx.putImageData(imgData, 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          return { data: await blob.arrayBuffer() };
        } catch {
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

    this.map = new maplibregl.Map({
      container: containerId,
      style: this.buildMapStyle(basemap),
      center: [-63.755, 44.562], // Default to NS, Canada
      zoom: 13,
      maxZoom: 23,
      attributionControl: false
    });

    // Add attribution in a non-intrusive way
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Scale control
    this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    await new Promise<void>(resolve => {
      this.map.on('load', () => {
        this.setupDataLayers();
        this.setupUserLocation();
        this.initialized = true;
        resolve();
      });
    });

    // Bind map events
    this.map.on('mousemove', (e) => {
      EventBus.emit('map-mousemove', { lngLat: e.lngLat });
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

    // Polygon fill
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POLYGONS_FILL,
      type: 'fill',
      source: 'collected-polygons',
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#4ade80'],
        'fill-opacity': 0.35
      }
    });

    // Polygon outline
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POLYGONS_OUTLINE,
      type: 'line',
      source: 'collected-polygons',
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#4ade80'],
        'line-width': 2
      }
    });

    // Lines
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_LINES,
      type: 'line',
      source: 'collected-lines',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#facc15'],
        'line-width': 3
      }
    });

    // Points
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POINTS,
      type: 'circle',
      source: 'collected-points',
      paint: {
        'circle-radius': 7,
        'circle-color': ['coalesce', ['get', 'color'], '#4ade80'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });

    // Point labels
    this.map.addLayer({
      id: LAYER_IDS.COLLECTED_POINTS_LABELS,
      type: 'symbol',
      source: 'collected-points',
      layout: {
        'text-field': ['get', 'type'],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-max-width': 10
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.5
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
    [LAYER_IDS.COLLECTED_POINTS, LAYER_IDS.COLLECTED_LINES,
      LAYER_IDS.COLLECTED_POLYGONS_FILL].forEach(layerId => {
      this.map.on('mouseenter', layerId, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        this.map.getCanvas().style.cursor = '';
      });
    });
  }

  private setupUserLocation(): void {
    // User location is handled via GeoJSON source updates
  }

  getMap(): MLMap {
    return this.map;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ---- Data Updates ----
  updateCollectedFeatures(features: FieldFeature[]): void {
    if (!this.initialized) return;

    const points: object[] = [];
    const lines: object[] = [];
    const polygons: object[] = [];

    for (const f of features) {
      const geoFeature = {
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          id: f.id,
          point_id: f.point_id,
          type: f.type,
          desc: f.desc,
          color: this.getFeatureColor(f.type),
          created_at: f.created_at
        }
      };

      if (f.geometry_type === 'Point') points.push(geoFeature);
      else if (f.geometry_type === 'LineString') lines.push(geoFeature);
      else if (f.geometry_type === 'Polygon') polygons.push(geoFeature);
    }

    const toFC = (feats: object[]) => ({ type: 'FeatureCollection', features: feats });
    (this.map.getSource('collected-points') as maplibregl.GeoJSONSource)?.setData(toFC(points) as never);
    (this.map.getSource('collected-lines') as maplibregl.GeoJSONSource)?.setData(toFC(lines) as never);
    (this.map.getSource('collected-polygons') as maplibregl.GeoJSONSource)?.setData(toFC(polygons) as never);
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
    // Insert basemap layer below all other layers
    const firstLayerId = this.map.getStyle().layers[0]?.id;
    this.map.addLayer(
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } },
      firstLayerId
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
    this.map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: srcId,
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
    [`${id}-fill`, `${id}-line`, `${id}-point`, `${id}-labels`].forEach(lid => {
      if (this.map.getLayer(lid)) this.map.removeLayer(lid);
    });
    const srcId = `src-${id}`;
    if (this.map.getSource(srcId)) this.map.removeSource(srcId);
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
        LAYER_IDS.COLLECTED_LINES,
        LAYER_IDS.COLLECTED_POLYGONS_FILL
      ]
    });
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
    hueRotate?: number; saturation?: number; contrast?: number; brightness?: number;
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
        { id: layerId, type: 'raster', source: srcId, paint: {
          'raster-opacity': ov.opacity,
          'raster-hue-rotate': ov.hueRotate ?? 0,
          'raster-saturation': ov.saturation ?? 0,
          'raster-contrast': ov.contrast ?? 0,
          'raster-brightness-max': ov.brightness ?? 1,
        }},
        LAYER_IDS.USER_ACCURACY
      );
      if (!ov.visible) this.map.setLayoutProperty(layerId, 'visibility', 'none');
      this.basemapOverlayIds.push(layerId);
    }
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

  destroy(): void {
    this.map?.remove();
  }
}
