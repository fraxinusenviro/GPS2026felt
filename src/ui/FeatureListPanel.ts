import type { FieldFeature } from '../types';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';

export class FeatureListPanel {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private body: HTMLElement;
  private isOpen = false;
  private features: FieldFeature[] = [];
  private query = '';
  private storage = StorageManager.getInstance();

  constructor(
    private flyTo: (lat: number, lng: number) => void,
    private selectFeature: (f: FieldFeature) => void,
  ) {
    this.overlay = document.getElementById('feature-list-overlay')!;
    this.panel   = document.getElementById('feature-list-panel')!;
    this.body    = document.getElementById('fl-body')!;

    document.getElementById('fl-close')?.addEventListener('click', () => this.close());
    // Close on backdrop click
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });

    EventBus.on<{ feature: FieldFeature }>('feature-added',   () => { if (this.isOpen) void this.reload(); });
    EventBus.on<{ feature: FieldFeature }>('feature-updated', () => { if (this.isOpen) void this.reload(); });
    EventBus.on<{ id: string }>('feature-deleted',            () => { if (this.isOpen) void this.reload(); });
  }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  async open(): Promise<void> {
    this.isOpen = true;
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('open'));
    await this.reload();
  }

  close(): void {
    this.isOpen = false;
    this.overlay.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.overlay.style.display = 'none'; }, 280);
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

    const titleEl = document.getElementById('fl-panel-title');
    if (titleEl) titleEl.textContent = `Field Data (${filtered.length})`;

    const geomIcon = (g: string) =>
      g === 'Point'
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="11" height="11"><path d="M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z"/></svg>`
        : g === 'LineString'
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="11" height="11"><path d="M211.81,83.79a28,28,0,0,1-33.12,4.83L88.62,178.69a28,28,0,1,1-44.43-6.48h0a28,28,0,0,1,33.12-4.83l90.07-90.07a28,28,0,1,1,44.43,6.48Z"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="11" height="11"><path d="M227.81,52.19a28,28,0,0,0-39.6,0h0a28.14,28.14,0,0,0-4,5L148,47.33A28,28,0,0,0,100.2,28.19h0A28,28,0,0,0,94.7,60L54.58,96.1a28,28,0,0,0-34.39,4.1h0a28,28,0,0,0,36.7,42.12l76.75,56.28a28,28,0,1,0,46.17-10.39,27.66,27.66,0,0,0-3.33-2.84L206.63,100q.69,0,1.38,0a28,28,0,0,0,19.8-47.79ZM161.39,180.05a28,28,0,0,0-18.29,5.64L66.36,129.41A28.15,28.15,0,0,0,65.29,108l40.12-36.11a28,28,0,0,0,38.37-9.12L180,72.66a27.88,27.88,0,0,0,8.17,19.13,28.61,28.61,0,0,0,3.32,2.85Z"/></svg>`;

    this.body.innerHTML = `
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
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M168,112a56,56,0,1,1-56-56A56,56,0,0,1,168,112Zm61.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88,88,0,1,1,11.32-11.31l50.06,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z"/></svg>
              </button>
            </div>
          `).join('')}
      </div>
    `;

    this.body.querySelector<HTMLInputElement>('#fl-search')?.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value;
      this.render();
    });

    this.body.querySelectorAll<HTMLElement>('.fl-item').forEach(el => {
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

    this.body.querySelectorAll<HTMLElement>('.fl-zoom-btn').forEach(btn => {
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
