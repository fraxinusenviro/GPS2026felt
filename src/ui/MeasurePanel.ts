import type { MapManager } from '../map/MapManager';
import { EventBus } from '../utils/EventBus';
import * as turf from '@turf/turf';

export class MeasurePanel {
  private vertices: [number, number][] = [];
  private active = false;
  private hud: HTMLElement | null = null;

  constructor(private mapManager: MapManager) {
    EventBus.on<{ tool: string }>('tool-changed', ({ tool }) => {
      if (tool === 'measure') {
        this.start();
      } else if (this.active) {
        this.stop();
      }
    });
  }

  private start(): void {
    this.active = true;
    this.vertices = [];
    this.mapManager.addMeasureLayer();
    this.showHUD();
  }

  stop(): void {
    this.active = false;
    this.vertices = [];
    this.mapManager.removeMeasureLayer();
    this.hideHUD();
  }

  handleClick(lng: number, lat: number): void {
    if (!this.active) return;
    this.vertices.push([lng, lat]);
    this.update();
  }

  undo(): void {
    if (this.vertices.length > 0) {
      this.vertices.pop();
      this.update();
    }
  }

  private update(): void {
    const verts = this.vertices;
    const features: object[] = verts.map(c => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {}
    }));

    let distanceText = '';
    let areaText = '';

    if (verts.length >= 2) {
      const line = turf.lineString(verts);
      const km = turf.length(line, { units: 'kilometers' });
      distanceText = km >= 1 ? `${km.toFixed(3)} km` : `${(km * 1000).toFixed(1)} m`;
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: verts }, properties: {} });
    }

    if (verts.length >= 3) {
      const closed = [...verts, verts[0]];
      const poly = turf.polygon([closed]);
      const m2 = turf.area(poly);
      areaText = m2 >= 10000 ? `${(m2 / 10000).toFixed(3)} ha` : `${m2.toFixed(1)} m²`;
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties: {} });
    }

    this.mapManager.updateMeasureLayer({ type: 'FeatureCollection', features });
    this.updateHUD(verts.length, distanceText, areaText);
  }

  private showHUD(): void {
    let el = document.getElementById('measure-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'measure-hud';
      el.className = 'measure-hud';
      document.getElementById('map-container')?.appendChild(el);
    }
    this.hud = el;
    this.updateHUD(0, '', '');
    el.style.display = 'flex';
  }

  private hideHUD(): void {
    const el = document.getElementById('measure-hud');
    if (el) el.style.display = 'none';
  }

  private updateHUD(count: number, distance: string, area: string): void {
    if (!this.hud) return;
    const hint = count === 0
      ? 'Click map to start measuring'
      : count === 1
      ? 'Click again to measure distance'
      : 'Keep clicking · click toolbar button to finish';

    this.hud.innerHTML = `
      <div class="measure-hud-body">
        <span class="measure-hud-title">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M96,136H64v24a8,8,0,0,1-13.66,5.66l-32-32a8,8,0,0,1,0-11.32l32-32A8,8,0,0,1,64,96v24H96a8,8,0,0,1,0,16Zm0-72h24V96a8,8,0,0,0,16,0V64h24a8,8,0,0,0,5.66-13.66l-32-32a8,8,0,0,0-11.32,0l-32,32A8,8,0,0,0,96,64Zm141.66,58.34-32-32A8,8,0,0,0,192,96v24H160a8,8,0,0,0,0,16h32v24a8,8,0,0,0,13.66,5.66l32-32A8,8,0,0,0,237.66,122.34ZM160,192H136V160a8,8,0,0,0-16,0v32H96a8,8,0,0,0-5.66,13.66l32,32a8,8,0,0,0,11.32,0l32-32A8,8,0,0,0,160,192Z"/></svg>
          Measure
        </span>
        ${distance ? `<span class="measure-val">↔ ${distance}</span>` : ''}
        ${area ? `<span class="measure-val">▣ ${area}</span>` : ''}
        <span class="measure-hint">${hint}</span>
        ${count > 0 ? `<button class="measure-undo-btn" id="measure-undo">Undo</button>` : ''}
        <button class="measure-clear-btn" id="measure-clear">Clear</button>
      </div>
    `;
    this.hud.querySelector('#measure-undo')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.undo();
    });
    this.hud.querySelector('#measure-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.vertices = [];
      this.update();
    });
  }
}
