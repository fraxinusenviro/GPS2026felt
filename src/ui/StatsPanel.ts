import type { FieldFeature } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import * as turf from '@turf/turf';

export class StatsPanel {
  private el: HTMLElement | null = null;
  private isOpen = false;
  private storage = StorageManager.getInstance();

  constructor() {
    EventBus.on('feature-added', () => { if (this.isOpen) void this.refresh(); });
    EventBus.on('feature-updated', () => { if (this.isOpen) void this.refresh(); });
    EventBus.on('feature-deleted', () => { if (this.isOpen) void this.refresh(); });
  }

  toggle(): void { this.isOpen ? this.close() : void this.open(); }

  async open(): Promise<void> {
    this.isOpen = true;
    const el = document.getElementById('stats-panel');
    if (!el) return;
    this.el = el;
    el.style.display = 'block';
    requestAnimationFrame(() => el.classList.add('open'));
    await this.refresh();
  }

  close(): void {
    this.isOpen = false;
    this.el?.classList.remove('open');
    setTimeout(() => { if (!this.isOpen && this.el) this.el.style.display = 'none'; }, 300);
  }

  private async refresh(): Promise<void> {
    if (!this.el) return;
    const settings = await this.storage.getAppSettings();
    const features = await this.storage.getFeaturesByProject(settings.active_project_id || 'default');
    this.render(features);
  }

  private render(features: FieldFeature[]): void {
    if (!this.el) return;

    const points = features.filter(f => f.geometry_type === 'Point');
    const lines = features.filter(f => f.geometry_type === 'LineString');
    const polys = features.filter(f => f.geometry_type === 'Polygon');
    const photos = features.reduce((n, f) => n + (f.photos?.length ?? 0), 0);

    let totalLenM = 0;
    for (const f of lines) {
      try {
        const coords = (f.geometry as { coordinates: [number, number][] }).coordinates;
        if (coords.length >= 2) totalLenM += turf.length(turf.lineString(coords), { units: 'kilometers' }) * 1000;
      } catch { /* skip */ }
    }

    let totalAreaM2 = 0;
    for (const f of polys) {
      try {
        const coords = (f.geometry as { coordinates: [number, number][][] }).coordinates;
        if (coords[0]?.length >= 3) totalAreaM2 += turf.area(turf.polygon(coords));
      } catch { /* skip */ }
    }

    const typeCounts = new Map<string, number>();
    for (const f of features) {
      typeCounts.set(f.type || '(none)', (typeCounts.get(f.type || '(none)') ?? 0) + 1);
    }
    const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0]?.[1] ?? 1;

    const fmtLen = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
    const fmtArea = (m2: number) => m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${m2.toFixed(0)} m²`;

    const dates = features.map(f => f.created_at.slice(0, 10)).sort();
    const dateRange = dates.length
      ? dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} – ${dates[dates.length - 1]}`
      : '—';

    this.el.innerHTML = `
      <div class="stats-inner">
        <div class="stats-header">
          <h3>Project Statistics</h3>
          <button class="panel-close" id="stats-close">✕</button>
        </div>
        <div class="stats-body">
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-val">${features.length}</div>
              <div class="stat-lbl">Total Features</div>
            </div>
            <div class="stat-card">
              <div class="stat-val">${points.length}</div>
              <div class="stat-lbl">Points</div>
            </div>
            <div class="stat-card">
              <div class="stat-val">${lines.length}</div>
              <div class="stat-lbl">Lines</div>
            </div>
            <div class="stat-card">
              <div class="stat-val">${polys.length}</div>
              <div class="stat-lbl">Polygons</div>
            </div>
            ${totalLenM > 0 ? `<div class="stat-card"><div class="stat-val">${fmtLen(totalLenM)}</div><div class="stat-lbl">Total Line Length</div></div>` : ''}
            ${totalAreaM2 > 0 ? `<div class="stat-card"><div class="stat-val">${fmtArea(totalAreaM2)}</div><div class="stat-lbl">Total Polygon Area</div></div>` : ''}
            <div class="stat-card">
              <div class="stat-val">${photos}</div>
              <div class="stat-lbl">Photos</div>
            </div>
          </div>

          ${features.length > 0 ? `
          <div class="stats-section">
            <div class="stats-section-label">By Type</div>
            ${sorted.slice(0, 12).map(([label, count]) => `
              <div class="stats-bar-row">
                <span class="stats-bar-label">${label}</span>
                <div class="stats-bar-track">
                  <div class="stats-bar-fill" style="width:${(count / maxCount * 100).toFixed(1)}%"></div>
                </div>
                <span class="stats-bar-count">${count}</span>
              </div>
            `).join('')}
          </div>
          ` : ''}

          <div class="stats-section stats-meta">
            <span>Date range: ${dateRange}</span>
          </div>
        </div>
      </div>
    `;

    this.el.querySelector('#stats-close')?.addEventListener('click', () => this.close());
  }
}
