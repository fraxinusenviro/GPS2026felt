import type { GeoJSONSource } from 'maplibre-gl';
import { LAYER_IDS } from '../constants';
import type { MapManager } from './MapManager';
import type { VectorLayerConfig } from '../types';

const MIN_ZOOM = 12;

export class NSHNVectorLayer {
  private instanceId: string | null = null;
  private fetchId = 0;
  private moveHandler: (() => void) | null = null;

  constructor(
    private mapManager: MapManager,
    private config: VectorLayerConfig,
  ) {}

  activate(instanceId: string, opacity: number, visible: boolean): void {
    if (this.instanceId === instanceId) return;
    this.deactivate();
    this.instanceId = instanceId;

    const map = this.mapManager.getMap();
    const srcId = `bmsrc-${instanceId}`;
    const layerId = `bm-ov-${instanceId}`;
    const strokeId = `${layerId}-stroke`;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (this.config.geomType === 'line') {
      if (!map.getLayer(layerId)) {
        map.addLayer(
          {
            id: layerId,
            type: 'line',
            source: srcId,
            paint: {
              'line-color': this.config.lineColor,
              'line-width': this.config.lineWidth,
              'line-opacity': visible ? opacity : 0,
            },
            layout: { visibility: visible ? 'visible' : 'none' },
          },
          LAYER_IDS.USER_ACCURACY,
        );
      }
    } else {
      if (!map.getLayer(layerId)) {
        map.addLayer(
          {
            id: layerId,
            type: 'fill',
            source: srcId,
            paint: {
              'fill-color': this.config.fillColor ?? this.config.lineColor,
              'fill-opacity': visible ? opacity * (this.config.fillOpacity ?? 0.5) : 0,
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
              'line-color': this.config.lineColor,
              'line-width': this.config.lineWidth,
              'line-opacity': visible ? opacity : 0,
            },
            layout: { visibility: visible ? 'visible' : 'none' },
          },
          LAYER_IDS.USER_ACCURACY,
        );
      }
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
    const strokeId = `${layerId}-stroke`;

    if (this.moveHandler) {
      map.off('moveend', this.moveHandler);
      this.moveHandler = null;
    }

    if (map.getLayer(strokeId)) map.removeLayer(strokeId);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(srcId)) map.removeSource(srcId);

    this.instanceId = null;
    this.fetchId++;
  }

  setOpacity(opacity: number): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    const strokeId = `${layerId}-stroke`;
    if (this.config.geomType === 'line') {
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-opacity', opacity);
    } else {
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'fill-opacity', opacity * (this.config.fillOpacity ?? 0.5));
      if (map.getLayer(strokeId)) map.setPaintProperty(strokeId, 'line-opacity', opacity);
    }
  }

  setVisible(visible: boolean): void {
    if (!this.instanceId) return;
    const map = this.mapManager.getMap();
    const layerId = `bm-ov-${this.instanceId}`;
    const strokeId = `${layerId}-stroke`;
    const vis = visible ? 'visible' : 'none';
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis);
    if (map.getLayer(strokeId)) map.setLayoutProperty(strokeId, 'visibility', vis);
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
      where: this.config.where ?? '1=1',
      outFields: this.config.outFields ?? 'OBJECTID',
      f: 'geojson',
      geometry: bbox,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultRecordCount: '2000',
    });

    const fid = ++this.fetchId;

    fetch(`${this.config.endpoint}?${params.toString()}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        if (fid !== this.fetchId || !this.instanceId) return;
        const src = map.getSource(srcId) as GeoJSONSource | undefined;
        src?.setData(data);
      })
      .catch(err => console.warn('[NSHN]', err));
  }
}
