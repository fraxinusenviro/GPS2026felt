import type { MapManager } from './MapManager';
import { generateUTMGrid, getGridInterval } from '../utils/coordinates';
import { EventBus } from '../utils/EventBus';

export class GridOverlay {
  private visible = false;
  private currentInterval = 500;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private mapManager: MapManager) {
    EventBus.on('map-moveend', () => {
      if (this.visible) this.scheduleUpdate();
    });
    EventBus.on('map-zoom', () => {
      if (this.visible) this.scheduleUpdate();
    });
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.update(), 300);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.mapManager.setGridVisible(visible);
    const infoEl = document.getElementById('grid-info');
    if (infoEl) infoEl.style.display = visible ? 'flex' : 'none';

    if (visible) {
      this.update();
    } else {
      this.mapManager.updateUTMGrid({ type: 'FeatureCollection', features: [] });
    }
  }

  isVisible(): boolean { return this.visible; }

  private update(): void {
    const map = this.mapManager.getMap();
    const bounds = map.getBounds();
    const zoom = map.getZoom();

    this.currentInterval = getGridInterval(zoom);

    const grid = generateUTMGrid(
      { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
      this.currentInterval
    );

    this.mapManager.updateUTMGrid(grid);
    this.updateInfoDisplay(bounds);
  }

  private updateInfoDisplay(bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }): void {
    const intervalLabel = document.getElementById('grid-interval-label');
    const areaLabel = document.getElementById('grid-area-label');

    if (intervalLabel) {
      const label = this.currentInterval >= 1000
        ? `${this.currentInterval / 1000} km grid`
        : `${this.currentInterval} m grid`;
      intervalLabel.textContent = label;
    }

    if (areaLabel) {
      // Show area of a single grid cell (interval × interval metres)
      const cellM2 = this.currentInterval * this.currentInterval;
      const cellHa = cellM2 / 10000;
      areaLabel.textContent = cellHa >= 100
        ? `${(cellHa / 100).toFixed(2)} km²/cell`
        : cellHa < 1
          ? `${cellM2.toFixed(0)} m²/cell`
          : `${cellHa % 1 === 0 ? cellHa.toFixed(0) : cellHa.toFixed(2)} ha/cell`;
    }
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
