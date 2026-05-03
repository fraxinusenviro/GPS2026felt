import type { GeoJSONSource } from 'maplibre-gl';
import { LAYER_IDS } from '../constants';
import type { MapManager } from './MapManager';

const EP = 'https://nsgiwa2.novascotia.ca/arcgis/rest/services/PLAN/PLAN_NSPRD_UT83/MapServer/0/query';
const MIN_ZOOM = 12;

export class NSPRDVectorLayer {
  private instanceId: string | null = null;
  private fetchId = 0;
  private moveHandler: (() => void) | null = null;

  constructor(private mapManager: MapManager) {}

  activate(instanceId: string, opacity: number, visible: boolean): void {
    if (this.instanceId === instanceId) return;
    this.deactivate();
    this.instanceId = instanceId;

    const map = this.mapManager.getMap();
    const srcId = `bmsrc-${instanceId}`;
    const layerId = `bm-ov-${instanceId}`;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: 'line',
          source: srcId,
          paint: {
            'line-color': '#000000',
            'line-width': 0.8,
            'line-opacity': visible ? opacity : 0,
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
    const srcId = `bmsrc-${this.instanceId}`;

    if (this.moveHandler) {
      map.off('moveend', this.moveHandler);
      this.moveHandler = null;
    }

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(srcId)) map.removeSource(srcId);

    this.instanceId = null;
    this.fetchId++;
  }

  setOpacity(opacity: number): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-opacity', opacity);
  }

  setVisible(visible: boolean): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
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
      outFields: 'OBJECTID,PID,SHAPE.AREA',
      f: 'geojson',
      geometry: bbox,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
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
