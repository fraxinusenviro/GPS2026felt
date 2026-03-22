import type { FieldFeature, GeoJSONGeometry } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { MapManager } from '../map/MapManager';

/**
 * GeometryEditor — tap-based vertex editing for mobile and desktop.
 *
 * Interaction model:
 *  • Tap a vertex circle → select it (turns orange)
 *  • Tap elsewhere on map while vertex selected → move vertex there
 *  • Tap a midpoint circle (between vertices) → insert new vertex
 *  • "Delete Vertex" button → remove selected vertex
 *  • "Move Feature" button → next map tap translates whole geometry
 *  • "Done" → save and exit
 *  • "Cancel" → discard changes
 */
export class GeometryEditor {
  private feature: FieldFeature | null = null;
  private workingCoords: [number, number][] = [];
  private selectedIdx: number | null = null;
  private translateMode = false;
  private container!: HTMLElement;
  private storage = StorageManager.getInstance();

  constructor(private mapManager: MapManager) {
    this.container = this.createOverlay();

    EventBus.on<{ feature: FieldFeature }>('edit-geometry-start', ({ feature }) => {
      this.startEditing(feature);
    });

    EventBus.on<{ lngLat: { lng: number; lat: number } }>('map-click', ({ lngLat }) => {
      if (!this.feature) return;
      this.handleMapClick(lngLat.lng, lngLat.lat);
    });
  }

  private startEditing(feature: FieldFeature): void {
    this.feature = { ...feature, geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJSONGeometry };
    this.workingCoords = this.extractCoords(feature.geometry);
    this.selectedIdx = null;
    this.translateMode = false;
    this.render();
    this.container.style.display = 'flex';
  }

  private extractCoords(geom: GeoJSONGeometry): [number, number][] {
    if (geom.type === 'Point') {
      return [(geom.coordinates as [number, number]).slice(0, 2) as [number, number]];
    }
    if (geom.type === 'LineString') {
      return (geom.coordinates as [number, number][]).map(c => [c[0], c[1]] as [number, number]);
    }
    // Polygon: first ring, excluding closing vertex
    const ring = geom.coordinates[0] as [number, number][];
    return ring.slice(0, -1).map(c => [c[0], c[1]] as [number, number]);
  }

  private handleMapClick(lng: number, lat: number): void {
    if (!this.feature) return;
    const map = this.mapManager.getMap();
    const point = map.project([lng, lat]);

    // Check if a vertex was tapped
    const vertexFeatures = this.mapManager.queryEditVerticesAt(point);
    const midFeatures = this.mapManager.queryEditMidpointsAt(point);

    if (vertexFeatures.length > 0) {
      const idx = vertexFeatures[0].properties?.idx as number;
      if (this.selectedIdx === idx) {
        this.selectedIdx = null; // deselect on second tap
      } else {
        this.selectedIdx = idx;
      }
      this.translateMode = false;
      this.render();
      return;
    }

    if (midFeatures.length > 0) {
      // Insert new vertex at midpoint
      const afterIdx = midFeatures[0].properties?.afterIdx as number;
      this.workingCoords.splice(afterIdx + 1, 0, [lng, lat]);
      this.selectedIdx = afterIdx + 1;
      this.translateMode = false;
      this.render();
      return;
    }

    if (this.translateMode) {
      // Translate whole feature so its centroid lands at the tapped point
      this.translateFeatureTo(lng, lat);
      this.translateMode = false;
      this.render();
      return;
    }

    if (this.selectedIdx !== null) {
      // Move selected vertex to tapped location
      this.workingCoords[this.selectedIdx] = [lng, lat];
      // Keep vertex selected for additional moves
      this.render();
      return;
    }

    // Nothing active — deselect
    this.selectedIdx = null;
    this.render();
  }

  private translateFeatureTo(lng: number, lat: number): void {
    const centroid = this.getCentroid();
    const dlng = lng - centroid[0];
    const dlat = lat - centroid[1];
    this.workingCoords = this.workingCoords.map(c => [c[0] + dlng, c[1] + dlat]);
  }

  private getCentroid(): [number, number] {
    const n = this.workingCoords.length;
    const sum = this.workingCoords.reduce((a, c) => [a[0] + c[0], a[1] + c[1]] as [number, number], [0, 0] as [number, number]);
    return [sum[0] / n, sum[1] / n];
  }

  private render(): void {
    if (!this.feature) return;

    const isPoint = this.feature.geometry_type === 'Point';
    const isPolygon = this.feature.geometry_type === 'Polygon';
    const n = this.workingCoords.length;

    // Vertex features
    const vertices = this.workingCoords.map((c, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: { idx: i, selected: i === this.selectedIdx }
    }));

    // Midpoint features (not for single point)
    const midpoints: object[] = [];
    if (!isPoint) {
      const loopCount = isPolygon ? n : n - 1;
      for (let i = 0; i < loopCount; i++) {
        const j = (i + 1) % n;
        midpoints.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [
              (this.workingCoords[i][0] + this.workingCoords[j][0]) / 2,
              (this.workingCoords[i][1] + this.workingCoords[j][1]) / 2
            ]
          },
          properties: { afterIdx: i }
        });
      }
    }

    // Preview geometry
    let previewGeom: object;
    if (isPoint) {
      previewGeom = { type: 'Point', coordinates: this.workingCoords[0] };
    } else if (this.feature.geometry_type === 'LineString') {
      previewGeom = { type: 'LineString', coordinates: this.workingCoords };
    } else {
      previewGeom = { type: 'Polygon', coordinates: [[...this.workingCoords, this.workingCoords[0]]] };
    }

    this.mapManager.updateEditGeometry(vertices, midpoints, previewGeom);
    this.renderOverlay();
  }

  private renderOverlay(): void {
    const canDelete = this.selectedIdx !== null && this.workingCoords.length > (this.feature?.geometry_type === 'LineString' ? 2 : 3);

    this.container.innerHTML = `
      <div class="geo-edit-panel">
        <div class="geo-edit-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit Geometry
        </div>
        <div class="geo-edit-hint">
          ${this.translateMode
            ? '🎯 Tap map to move feature centroid'
            : this.selectedIdx !== null
              ? `✋ Vertex ${this.selectedIdx + 1} selected — tap map to move it`
              : '👆 Tap a vertex (●) to select, or tap ◦ to add vertex'}
        </div>
        <div class="geo-edit-actions">
          ${canDelete
            ? `<button class="geo-btn danger" id="geo-del-vtx">Delete Vertex</button>`
            : ''}
          <button class="geo-btn ${this.translateMode ? 'active' : ''}" id="geo-translate">Move All</button>
          <button class="geo-btn" id="geo-cancel">Cancel</button>
          <button class="geo-btn primary" id="geo-done">Done ✓</button>
        </div>
      </div>
    `;

    this.container.querySelector('#geo-del-vtx')?.addEventListener('click', () => {
      if (this.selectedIdx !== null) {
        this.workingCoords.splice(this.selectedIdx, 1);
        this.selectedIdx = null;
        this.render();
      }
    });

    this.container.querySelector('#geo-translate')?.addEventListener('click', () => {
      this.translateMode = !this.translateMode;
      this.selectedIdx = null;
      this.render();
    });

    this.container.querySelector('#geo-cancel')?.addEventListener('click', () => {
      this.stopEditing(false);
    });

    this.container.querySelector('#geo-done')?.addEventListener('click', () => {
      this.stopEditing(true);
    });
  }

  private async stopEditing(save: boolean): Promise<void> {
    if (!this.feature) return;

    if (save) {
      let geometry: GeoJSONGeometry;
      if (this.feature.geometry_type === 'Point') {
        geometry = { type: 'Point', coordinates: this.workingCoords[0] };
      } else if (this.feature.geometry_type === 'LineString') {
        if (this.workingCoords.length < 2) {
          EventBus.emit('toast', { message: 'Line needs at least 2 vertices', type: 'warning' });
          return;
        }
        geometry = { type: 'LineString', coordinates: this.workingCoords };
      } else {
        if (this.workingCoords.length < 3) {
          EventBus.emit('toast', { message: 'Polygon needs at least 3 vertices', type: 'warning' });
          return;
        }
        geometry = { type: 'Polygon', coordinates: [[...this.workingCoords, this.workingCoords[0]]] };
      }

      const updated: FieldFeature = {
        ...this.feature,
        geometry,
        updated_at: new Date().toISOString()
      };
      await this.storage.saveFeature(updated);
      EventBus.emit('feature-updated', { feature: updated });
      EventBus.emit('toast', { message: 'Geometry updated', type: 'success' });
    }

    this.feature = null;
    this.workingCoords = [];
    this.selectedIdx = null;
    this.container.style.display = 'none';
    this.mapManager.clearEditGeometry();
    EventBus.emit('edit-geometry-done', {});
  }

  private createOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'geo-edit-container';
    el.style.display = 'none';
    // Insert inside map-container so it overlays the map
    const mapContainer = document.getElementById('map-container') ?? document.body;
    mapContainer.appendChild(el);
    return el;
  }
}
