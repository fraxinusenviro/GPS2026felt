import { v4 as uuidv4 } from 'uuid';
import { kml as toGeoJSONKML } from '@tmcw/togeojson';
import shpjs from 'shpjs';
import type { ImportedLayer, GeoJSONFeatureCollection } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { MapManager } from '../map/MapManager';

export class ImportManager {
  private storage = StorageManager.getInstance();

  constructor(private mapManager: MapManager) {}

  // ============================================================
  // Main entry: handle file input
  // ============================================================
  async importFile(file: File): Promise<ImportedLayer | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    EventBus.emit('toast', { message: `Importing ${file.name}...`, type: 'info' });

    try {
      let layer: ImportedLayer | null = null;

      if (ext === 'geojson' || ext === 'json') {
        layer = await this.importGeoJSON(file);
      } else if (ext === 'kml') {
        layer = await this.importKML(file);
      } else if (ext === 'shp') {
        layer = await this.importSHP(file);
      } else if (ext === 'zip') {
        // Could be a zipped shapefile
        layer = await this.importZippedSHP(file);
      } else if (ext === 'mbtiles') {
        layer = await this.importMBTiles(file);
      } else if (ext === 'pdf') {
        layer = await this.importGeoPDF(file);
      } else if (ext === 'gpx') {
        layer = await this.importGPX(file);
      } else {
        EventBus.emit('toast', { message: `Unsupported format: .${ext}`, type: 'error' });
        return null;
      }

      if (layer) {
        await this.storage.saveImportedLayer(layer);
        this.renderImportedLayer(layer);
        EventBus.emit('layer-added', { layer });
        EventBus.emit('toast', { message: `Imported: ${file.name}`, type: 'success' });
      }
      return layer;
    } catch (err) {
      console.error('Import error:', err);
      EventBus.emit('toast', { message: `Import failed: ${(err as Error).message}`, type: 'error' });
      return null;
    }
  }

  // ============================================================
  // Format-specific importers
  // ============================================================
  private async importGeoJSON(file: File): Promise<ImportedLayer> {
    const text = await file.text();
    const data = JSON.parse(text) as GeoJSONFeatureCollection;

    // Normalise to FeatureCollection
    const fc: GeoJSONFeatureCollection = data.type === 'FeatureCollection'
      ? data
      : { type: 'FeatureCollection', features: data.type === 'Feature' ? [data as never] : [] };

    return {
      id: uuidv4(),
      name: file.name.replace(/\.[^.]+$/, ''),
      file_type: 'geojson',
      data: fc,
      visible: true,
      opacity: 0.8,
      color: this.randomColor(),
      added_at: new Date().toISOString()
    };
  }

  private async importKML(file: File): Promise<ImportedLayer> {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');
    const converted = toGeoJSONKML(xmlDoc) as GeoJSONFeatureCollection;

    return {
      id: uuidv4(),
      name: file.name.replace(/\.[^.]+$/, ''),
      file_type: 'kml',
      data: converted,
      visible: true,
      opacity: 0.8,
      color: this.randomColor(),
      added_at: new Date().toISOString()
    };
  }

  private async importGPX(file: File): Promise<ImportedLayer> {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'application/xml');
    const { gpx: toGeoJSONGPX } = await import('@tmcw/togeojson');
    const converted = toGeoJSONGPX(xmlDoc) as GeoJSONFeatureCollection;

    return {
      id: uuidv4(),
      name: file.name.replace(/\.[^.]+$/, ''),
      file_type: 'geojson',
      data: converted,
      visible: true,
      opacity: 0.8,
      color: this.randomColor(),
      added_at: new Date().toISOString()
    };
  }

  private async importSHP(file: File): Promise<ImportedLayer> {
    const buffer = await file.arrayBuffer();
    const geojson = await shpjs(buffer) as GeoJSONFeatureCollection | GeoJSONFeatureCollection[];
    const fc: GeoJSONFeatureCollection = Array.isArray(geojson)
      ? { type: 'FeatureCollection', features: geojson.flatMap(g => g.features) }
      : geojson;

    return {
      id: uuidv4(),
      name: file.name.replace(/\.[^.]+$/, ''),
      file_type: 'shp',
      data: fc,
      visible: true,
      opacity: 0.8,
      color: this.randomColor(),
      added_at: new Date().toISOString()
    };
  }

  private async importZippedSHP(file: File): Promise<ImportedLayer> {
    const buffer = await file.arrayBuffer();
    const geojson = await shpjs(buffer) as GeoJSONFeatureCollection | GeoJSONFeatureCollection[];
    const fc: GeoJSONFeatureCollection = Array.isArray(geojson)
      ? { type: 'FeatureCollection', features: geojson.flatMap(g => g.features) }
      : geojson;

    return {
      id: uuidv4(),
      name: file.name.replace(/\.[^.]+$/, ''),
      file_type: 'shp',
      data: fc,
      visible: true,
      opacity: 0.8,
      color: this.randomColor(),
      added_at: new Date().toISOString()
    };
  }

  private async importMBTiles(file: File): Promise<ImportedLayer> {
    EventBus.emit('toast', { message: 'Loading MBTiles (this may take a moment)...', type: 'info' });

    const layerId = uuidv4();
    const buffer = await file.arrayBuffer();

    // Dynamically load sql.js to avoid blocking main bundle
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (_filename: string) => `${import.meta.env.BASE_URL}sql-wasm-browser.wasm`
    });

    const db = new SQL.Database(new Uint8Array(buffer));

    // Read metadata
    const metaStmt = db.prepare('SELECT name, value FROM metadata');
    const meta: Record<string, string> = {};
    while (metaStmt.step()) {
      const row = metaStmt.getAsObject();
      meta[row.name as string] = row.value as string;
    }
    metaStmt.free();

    // Read tiles and cache in IndexedDB
    const tileStmt = db.prepare('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles');
    let tileCount = 0;
    while (tileStmt.step()) {
      const row = tileStmt.getAsObject();
      const z = row.zoom_level as number;
      const x = row.tile_column as number;
      // MBTiles uses TMS (Y flipped) - convert to XYZ
      const y = (1 << z) - 1 - (row.tile_row as number);
      const tileData = row.tile_data as Uint8Array;
      const data = new Blob([tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength) as ArrayBuffer], { type: 'image/png' });
      await this.storage.saveTile(layerId, z, x, y, data);
      tileCount++;
    }
    tileStmt.free();
    db.close();

    // Register a custom tile source for this layer
    this.registerMBTilesSource(layerId);

    // Parse bounds from metadata if present (format: "west,south,east,north")
    let bounds: [number, number, number, number] | undefined;
    if (meta.bounds) {
      const parts = meta.bounds.split(',').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        bounds = parts as [number, number, number, number];
      }
    }

    return {
      id: layerId,
      name: meta.name ?? file.name.replace(/\.[^.]+$/, ''),
      file_type: 'mbtiles',
      data: null,
      visible: true,
      opacity: 1,
      color: '#ffffff',
      added_at: new Date().toISOString(),
      bounds
    };
  }

  private registerMBTilesSource(layerId: string): void {
    // Add as custom protocol-based source
    // We use a data URL approach via a Blob URL served through a custom protocol
    const map = this.mapManager.getMap();
    const srcId = `src-${layerId}`;

    // Use a custom tile function approach
    map.addSource(srcId, {
      type: 'raster',
      tiles: [`mbtiles://${layerId}/{z}/{x}/{y}`],
      tileSize: 256
    });

    map.addLayer({
      id: layerId,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': 1 }
    });
  }

  private async importGeoPDF(file: File): Promise<ImportedLayer> {
    const buffer = await file.arrayBuffer();
    const { parseGeoPDF } = await import('./geopdf');
    const { imageDataUrl, bounds } = await parseGeoPDF(buffer);

    if (!bounds) {
      // No geo-registration found — open for visual reference only
      const blob = new Blob([buffer], { type: 'application/pdf' });
      window.open(URL.createObjectURL(blob), '_blank');
      EventBus.emit('toast', {
        message: 'No geo-registration found in this PDF — opened in a new tab for visual reference.',
        type: 'info',
        duration: 6000
      });
      return {
        id: uuidv4(),
        name: file.name.replace(/\.[^.]+$/, ''),
        file_type: 'geopdf',
        data: null,
        visible: false,
        opacity: 1,
        color: '#aaaaaa',
        added_at: new Date().toISOString()
      };
    }

    return {
      id: uuidv4(),
      name: file.name.replace(/\.[^.]+$/, ''),
      file_type: 'geopdf',
      data: null,
      visible: true,
      opacity: 0.9,
      color: '#aaaaaa',
      added_at: new Date().toISOString(),
      bounds,
      image_data_url: imageDataUrl
    };
  }

  // ============================================================
  // Render imported layers on the map
  // ============================================================
  renderImportedLayer(layer: ImportedLayer): void {
    if (!layer.visible) return;

    if (layer.data) {
      this.mapManager.addGeoJSONLayer(layer.id, layer.data, layer.color, layer.opacity);
    } else if (layer.file_type === 'mbtiles') {
      this.registerMBTilesSource(layer.id);
    } else if (layer.file_type === 'geopdf' && layer.image_data_url && layer.bounds) {
      this.mapManager.addGeoPDFLayer(layer.id, layer.image_data_url, layer.bounds, layer.opacity);
    }
  }

  removeImportedLayer(layer: ImportedLayer): void {
    if (layer.data) {
      this.mapManager.removeGeoJSONLayer(layer.id);
    } else {
      this.mapManager.removeLayer(layer.id);
      this.mapManager.getMap().getSource(`src-${layer.id}`) &&
        this.mapManager.getMap().removeSource(`src-${layer.id}`);
    }
  }

  toggleLayerVisibility(layer: ImportedLayer): void {
    if (layer.data) {
      [`${layer.id}-fill`, `${layer.id}-line`, `${layer.id}-point`].forEach(lid => {
        this.mapManager.setLayerVisibility(lid, layer.visible);
      });
    } else if (layer.file_type === 'geopdf' && layer.image_data_url && layer.bounds) {
      if (layer.visible && !this.mapManager.getMap().getLayer(layer.id)) {
        // Layer not yet on map (e.g. added while invisible); add it now
        this.mapManager.addGeoPDFLayer(layer.id, layer.image_data_url, layer.bounds, layer.opacity);
      } else {
        this.mapManager.setLayerVisibility(layer.id, layer.visible);
      }
    } else {
      this.mapManager.setLayerVisibility(layer.id, layer.visible);
    }
  }

  // ============================================================
  // Zoom to layer
  // ============================================================
  zoomToLayer(layer: ImportedLayer): void {
    // Layers with geographic bounds (MBTiles, georeferenced GeoPDF)
    if (layer.bounds) {
      const [w, s, e, n] = layer.bounds;
      this.mapManager.fitBounds([[w, s], [e, n]], 50);
      return;
    }
    if (!layer.data) return;
    const coords: Array<[number, number]> = [];
    layer.data.features.forEach(f => {
      if (f.geometry?.type === 'Point') {
        coords.push(f.geometry.coordinates as [number, number]);
      } else if (f.geometry?.type === 'LineString') {
        (f.geometry.coordinates as Array<[number, number]>).forEach(c => coords.push(c));
      } else if (f.geometry?.type === 'Polygon') {
        (f.geometry.coordinates[0] as Array<[number, number]>).forEach(c => coords.push(c));
      }
    });
    if (coords.length === 0) return;
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    this.mapManager.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      50
    );
  }

  setLayerLabel(layer: ImportedLayer): void {
    this.mapManager.setImportedLayerLabel(layer.id, layer.label_field);
  }

  private randomColor(): string {
    const colors = ['#4ade80', '#facc15', '#60a5fa', '#f87171', '#c084fc', '#fb923c', '#34d399', '#a78bfa'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
