import type { FieldFeature, GeoJSONGeometry, GeoJSONPolygon } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { MapManager } from '../map/MapManager';
import { reshapePolygonWithStroke } from '../utils/reshapePolygon';

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
  private reshapeMode = false;
  private reshapeStroke: [number, number][] = [];
  private reshapeCleanup: (() => void) | null = null;
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
    if (this.reshapeMode) this.stopReshapeMode();
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
    if (this.reshapeMode) return;
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
    const isPolygon = this.feature?.geometry_type === 'Polygon';
    const canDelete = this.selectedIdx !== null && this.workingCoords.length > (this.feature?.geometry_type === 'LineString' ? 2 : 3);

    this.container.innerHTML = `
      <div class="geo-edit-panel">
        <div class="geo-edit-title">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:16px;height:16px"><path d="M224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Zm5.66-58.34-96,96A8,8,0,0,1,128,168H96a8,8,0,0,1-8-8V128a8,8,0,0,1,2.34-5.66l96-96a8,8,0,0,1,11.32,0l32,32A8,8,0,0,1,229.66,69.66Zm-17-5.66L192,43.31,179.31,56,200,76.69Z"/></svg>
          Edit Geometry
        </div>
        <div class="geo-edit-hint">
          ${this.reshapeMode
            ? '✏️ Draw across the polygon boundary to reshape'
            : this.translateMode
              ? '🎯 Tap map to move feature centroid'
              : this.selectedIdx !== null
                ? `✋ Vertex ${this.selectedIdx + 1} selected — tap map to move it`
                : '👆 Tap a vertex (●) to select, or tap ◦ to add vertex'}
        </div>
        <div class="geo-edit-actions">
          ${canDelete && !this.reshapeMode
            ? `<button class="geo-btn danger" id="geo-del-vtx">Delete Vertex</button>`
            : ''}
          ${isPolygon && !this.reshapeMode
            ? `<button class="geo-btn" id="geo-reshape">Reshape</button>`
            : ''}
          ${this.reshapeMode
            ? `<button class="geo-btn danger" id="geo-reshape-cancel">✕ Cancel Reshape</button>`
            : `<button class="geo-btn ${this.translateMode ? 'active' : ''}" id="geo-translate">Move All</button>`}
          ${!this.reshapeMode ? `<button class="geo-btn" id="geo-cancel">Cancel</button>` : ''}
          ${!this.reshapeMode ? `<button class="geo-btn primary" id="geo-done">Done ✓</button>` : ''}
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

    this.container.querySelector('#geo-reshape')?.addEventListener('click', () => {
      this.startReshapeMode();
    });

    this.container.querySelector('#geo-reshape-cancel')?.addEventListener('click', () => {
      this.stopReshapeMode();
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

  private startReshapeMode(): void {
    this.reshapeMode = true;
    this.reshapeStroke = [];
    this.selectedIdx = null;
    this.translateMode = false;

    const map = this.mapManager.getMap();
    map.dragPan.disable();
    const canvas = map.getCanvas();
    // Ensure browser doesn't start native pan/zoom gestures over our draw
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';

    // SVG overlay: yellow dashed line shows the stroke as the user draws
    const mapContainer = document.getElementById('map-container') ?? document.body;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:200';
    mapContainer.appendChild(svg);
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('stroke', '#fbbf24');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-dasharray', '8 4');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('fill', 'none');
    svg.appendChild(polyline);

    let isDrawing = false;
    let screenPts: string[] = [];

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      isDrawing = true;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const ll = map.unproject([px, py]);
      this.reshapeStroke = [[ll.lng, ll.lat]];
      screenPts = [`${px},${py}`];
      polyline.setAttribute('points', screenPts[0]);
    };

    const onMove = (e: PointerEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const ll = map.unproject([px, py]);
      this.reshapeStroke.push([ll.lng, ll.lat]);
      screenPts.push(`${px},${py}`);
      polyline.setAttribute('points', screenPts.join(' '));
    };

    const onUp = (_e: PointerEvent) => {
      if (!isDrawing) return;
      isDrawing = false;
      this.finishReshape();
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    this.reshapeCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.style.touchAction = '';
      canvas.style.cursor = '';
      svg.remove();
    };

    this.render();
  }

  private stopReshapeMode(): void {
    this.reshapeMode = false;
    this.reshapeStroke = [];
    this.reshapeCleanup?.();
    this.reshapeCleanup = null;
    this.mapManager.getMap().dragPan.enable();
    this.render();
  }

  private finishReshape(): void {
    if (!this.feature) { this.stopReshapeMode(); return; }

    const stroke = this.reshapeStroke;
    if (stroke.length < 2) {
      EventBus.emit('toast', { message: 'Draw a stroke across the polygon boundary', type: 'warning' });
      this.stopReshapeMode();
      return;
    }

    const poly: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [[...this.workingCoords, this.workingCoords[0]]]
    };

    const reshaped = reshapePolygonWithStroke(poly, stroke);
    if (!reshaped) {
      EventBus.emit('toast', { message: 'Stroke must cross the boundary at least twice', type: 'warning' });
      this.stopReshapeMode();
      return;
    }

    const newRing = reshaped.coordinates[0] as [number, number][];
    this.workingCoords = newRing.slice(0, -1).map(c => [c[0], c[1]] as [number, number]);

    EventBus.emit('toast', { message: 'Polygon reshaped — tap Done ✓ to save', type: 'success', duration: 2000 });
    this.stopReshapeMode();
  }

  private async stopEditing(save: boolean): Promise<void> {
    if (!this.feature) return;
    if (this.reshapeMode) this.stopReshapeMode();

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
