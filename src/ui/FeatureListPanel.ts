import type { FieldFeature } from '../types';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';

export class FeatureListPanel {
  private panel: HTMLElement;
  private isOpen = false;
  private features: FieldFeature[] = [];
  private query = '';
  private storage = StorageManager.getInstance();

  constructor(
    private flyTo: (lat: number, lng: number) => void,
    private selectFeature: (f: FieldFeature) => void,
  ) {
    this.panel = document.getElementById('feature-list-panel')!;

    EventBus.on<{ feature: FieldFeature }>('feature-added', () => { if (this.isOpen) void this.reload(); });
    EventBus.on<{ feature: FieldFeature }>('feature-updated', () => { if (this.isOpen) void this.reload(); });
    EventBus.on<{ id: string }>('feature-deleted', () => { if (this.isOpen) void this.reload(); });
  }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  async open(): Promise<void> {
    this.isOpen = true;
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
    await this.reload();
  }

  close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  private async reload(): Promise<void> {
    const activeId = (await this.storage.getAppSettings()).active_project_id || 'default';
    this.features = await this.storage.getFeaturesByProject(activeId);
    this.render();
  }

  private render(): void {
    const filtered = this.features.filter(f => {
      if (!this.query) return true;
      const q = this.query.toLowerCase();
      return f.type.toLowerCase().includes(q)
        || f.desc.toLowerCase().includes(q)
        || f.point_id.toLowerCase().includes(q);
    });

    const geomIcon = (g: string) =>
      g === 'Point'
        ? `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><circle cx="12" cy="12" r="6"/></svg>`
        : g === 'LineString'
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><path d="M3 21L21 3"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polygon points="12 3 21 9 18 21 6 21 3 9"/></svg>`;

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h3>Features (${filtered.length})</h3>
          <button class="panel-close" id="fl-close">✕</button>
        </div>
        <div class="panel-body fl-body">
          <input type="search" id="fl-search" class="fl-search" placeholder="Search by type, name…" value="${this.query}" />
          <div class="fl-list" id="fl-list">
            ${filtered.length === 0
              ? `<div class="fl-empty">No features${this.query ? ' matching search' : ' in this project'}</div>`
              : filtered.map(f => `
                <div class="fl-item" data-id="${f.id}">
                  <span class="fl-geom-icon">${geomIcon(f.geometry_type)}</span>
                  <div class="fl-item-body">
                    <div class="fl-item-title">${f.type || '<em>no type</em>'}</div>
                    ${f.desc ? `<div class="fl-item-desc">${f.desc}</div>` : ''}
                    <div class="fl-item-meta">${f.point_id} · ${new Date(f.created_at).toLocaleDateString()}</div>
                  </div>
                  <button class="fl-zoom-btn" data-id="${f.id}" title="Zoom to">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  </button>
                </div>
              `).join('')}
          </div>
        </div>
      </div>
    `;

    this.panel.querySelector('#fl-close')?.addEventListener('click', () => this.close());

    const searchEl = this.panel.querySelector<HTMLInputElement>('#fl-search');
    searchEl?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value;
      this.render();
    });

    this.panel.querySelectorAll<HTMLElement>('.fl-item').forEach(el => {
      el.addEventListener('click', () => {
        const f = this.features.find(x => x.id === el.dataset.id);
        if (!f) return;
        this.selectFeature(f);
        const g = f.geometry;
        const coord = g.type === 'Point'
          ? g.coordinates as [number, number]
          : g.type === 'LineString'
          ? (g.coordinates as [number, number][])[0]
          : (g.coordinates as [number, number][][])[0][0];
        this.flyTo(coord[1], coord[0]);
      });
    });

    this.panel.querySelectorAll<HTMLElement>('.fl-zoom-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = this.features.find(x => x.id === btn.dataset.id);
        if (!f) return;
        const g = f.geometry;
        const coord = g.type === 'Point'
          ? g.coordinates as [number, number]
          : g.type === 'LineString'
          ? (g.coordinates as [number, number][])[0]
          : (g.coordinates as [number, number][][])[0][0];
        this.flyTo(coord[1], coord[0]);
      });
    });
  }
}
