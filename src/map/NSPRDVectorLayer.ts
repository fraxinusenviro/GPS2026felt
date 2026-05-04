import type { GeoJSONSource } from 'maplibre-gl';
import { LAYER_IDS } from '../constants';
import type { MapManager } from './MapManager';

const EP = 'https://nsgiwa2.novascotia.ca/arcgis/rest/services/PLAN/PLAN_NSPRD_UT83/MapServer/0/query';
const MIN_ZOOM = 12;

export class NSPRDVectorLayer {
  private instanceId: string | null = null;
  private fetchId = 0;
  private moveHandler: (() => void) | null = null;
  private fillOpacity = 1.0;

  constructor(private mapManager: MapManager) {}

  activate(instanceId: string, opacity: number, visible: boolean): void {
    if (this.instanceId === instanceId) return;
    this.deactivate();
    this.instanceId = instanceId;

    const map = this.mapManager.getMap();
    const srcId = `bmsrc-${instanceId}`;
    const layerId = `bm-ov-${instanceId}`;
    const strokeId = `${layerId}-stroke`;
    const hlLayerId = `${layerId}-hl`;
    const hlStrokeId = `${layerId}-hl-stroke`;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: 'fill',
          source: srcId,
          paint: {
            'fill-color': '#e8e0d0',
            'fill-opacity': visible ? opacity * this.fillOpacity : 0,
          },
          layout: { visibility: visible ? 'visible' : 'none' },
        },
        LAYER_IDS.USER_ACCURACY,
      );
    }

    if (!map.getLayer(strokeId)) {
      map.addLayer(
        {
          id: strokeId,
          type: 'line',
          source: srcId,
          paint: {
            'line-color': '#333333',
            'line-width': 0.8,
            'line-opacity': visible ? opacity : 0,
          },
          layout: { visibility: visible ? 'visible' : 'none' },
        },
        LAYER_IDS.USER_ACCURACY,
      );
    }

    if (!map.getLayer(hlLayerId)) {
      map.addLayer(
        {
          id: hlLayerId,
          type: 'fill',
          source: srcId,
          filter: ['in', ['get', 'OBJECTID'], ['literal', []]],
          paint: {
            'fill-color': '#00ccff',
            'fill-opacity': 0.4,
          },
          layout: { visibility: visible ? 'visible' : 'none' },
        },
        LAYER_IDS.USER_ACCURACY,
      );
    }

    if (!map.getLayer(hlStrokeId)) {
      map.addLayer(
        {
          id: hlStrokeId,
          type: 'line',
          source: srcId,
          filter: ['in', ['get', 'OBJECTID'], ['literal', []]],
          paint: {
            'line-color': '#00aaff',
            'line-width': 2.5,
            'line-opacity': visible ? 1 : 0,
          },
          layout: { visibility: visible ? 'visible' : 'none' },
        },
        LAYER_IDS.USER_ACCURACY,
      );
    }

    this.moveHandler = () => this.fetchData();
    map.on('moveend', this.moveHandler);
    this.fetchData();
  }

  deactivate(): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    const strokeId = `${layerId}-stroke`;
    const hlLayerId = `${layerId}-hl`;
    const hlStrokeId = `${layerId}-hl-stroke`;
    const srcId = `bmsrc-${this.instanceId}`;

    if (this.moveHandler) {
      map.off('moveend', this.moveHandler);
      this.moveHandler = null;
    }

    if (map.getLayer(hlStrokeId)) map.removeLayer(hlStrokeId);
    if (map.getLayer(hlLayerId)) map.removeLayer(hlLayerId);
    if (map.getLayer(strokeId)) map.removeLayer(strokeId);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(srcId)) map.removeSource(srcId);

    this.instanceId = null;
    this.fetchId++;
  }

  highlightFeatures(objectIds: number[]): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    const hlLayerId = `${layerId}-hl`;
    const hlStrokeId = `${layerId}-hl-stroke`;
    const filter = ['in', ['get', 'OBJECTID'], ['literal', objectIds]] as unknown[];
    if (map.getLayer(hlLayerId)) map.setFilter(hlLayerId, filter as any);
    if (map.getLayer(hlStrokeId)) map.setFilter(hlStrokeId, filter as any);
  }

  clearHighlight(): void {
    this.highlightFeatures([]);
  }

  setOpacity(opacity: number): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    const strokeId = `${layerId}-stroke`;
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'fill-opacity', opacity * this.fillOpacity);
    if (map.getLayer(strokeId)) map.setPaintProperty(strokeId, 'line-opacity', opacity);
  }

  setVisible(visible: boolean): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    const strokeId = `${layerId}-stroke`;
    const hlLayerId = `${layerId}-hl`;
    const hlStrokeId = `${layerId}-hl-stroke`;
    const vis = visible ? 'visible' : 'none';
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis);
    if (map.getLayer(strokeId)) map.setLayoutProperty(strokeId, 'visibility', vis);
    if (map.getLayer(hlLayerId)) map.setLayoutProperty(hlLayerId, 'visibility', vis);
    if (map.getLayer(hlStrokeId)) map.setLayoutProperty(hlStrokeId, 'visibility', vis);
  }

  setLineWidth(w: number): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const strokeId = `bm-ov-${this.instanceId}-stroke`;
    if (map.getLayer(strokeId)) map.setPaintProperty(strokeId, 'line-width', w);
  }

  setLineColor(color: string): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const strokeId = `bm-ov-${this.instanceId}-stroke`;
    if (map.getLayer(strokeId)) map.setPaintProperty(strokeId, 'line-color', color);
  }

  setFillColor(color: string): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'fill-color', color);
  }

  setFillOpacity(fo: number): void {
    this.fillOpacity = fo;
    // caller must follow up with setOpacity() to apply the combined value
  }

  getLayerIds(): string[] {
    if (!this.instanceId) return [];
    const layerId = `bm-ov-${this.instanceId}`;
    return [layerId, `${layerId}-stroke`];
  }

  private fetchData(): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const srcId = `bmsrc-${this.instanceId}`;

    if (map.getZoom() < MIN_ZOOM) {
      const src = map.getSource(srcId) as GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const bounds = map.getBounds();
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'OBJECTID,PID',
      f: 'geojson',
      geometry: bbox,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: '2000',
    });

    const fid = ++this.fetchId;

    fetch(`${EP}?${params.toString()}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        if (fid !== this.fetchId || !this.instanceId) return;
        const src = map.getSource(srcId) as GeoJSONSource | undefined;
        src?.setData(data);
      })
      .catch(err => console.warn('[NSPRD]', err));
  }
}
