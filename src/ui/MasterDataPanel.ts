import type { FieldFeature, Project } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { ExportManager } from '../io/ExportManager';
import { EventBus } from '../utils/EventBus';

/**
 * Master Data — a read-only, cross-project view of every synced feature.
 * Aggregates features from all projects for summary stats, filtering, combined
 * export, and an optional read-only map preview (rendered by App via EventBus).
 * It never writes data and does not change the active project.
 */
export class MasterDataPanel {
  private panel = document.getElementById('master-data-panel')!;
  private storage = StorageManager.getInstance();
  private isOpen = false;
  private features: FieldFeature[] = [];
  private projects: Project[] = [];
  private previewing = false;
  private filters = { project: '', geometry: '', type: '', search: '' };

  toggle(): void { this.isOpen ? this.close() : void this.open(); }

  async open(): Promise<void> {
    this.isOpen = true;
    [this.features, this.projects] = await Promise.all([
      this.storage.getAllFeatures(),
      this.storage.getAllProjects(),
    ]);
    this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
  }

  close(): void {
    this.isOpen = false;
    if (this.previewing) { this.previewing = false; EventBus.emit('master-data-hide'); }
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  /** Apply the active filters to the full feature set. */
  private filtered(): FieldFeature[] {
    const q = this.filters.search.trim().toLowerCase();
    return this.features.filter(f => {
      if (this.filters.project && f.project_id !== this.filters.project) return false;
      if (this.filters.geometry && f.geometry_type !== this.filters.geometry) return false;
      if (this.filters.type && f.type !== this.filters.type) return false;
      if (q) {
        const hay = `${f.point_id ?? ''} ${f.desc ?? ''} ${f.notes ?? ''} ${f.type ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  private projectName(id: string): string {
    return this.projects.find(p => p.id === id)?.name ?? id;
  }

  private render(): void {
    const rows = this.filtered();
    const projectName = (id: string) => this.projectName(id);

    // Distinct values for the filter dropdowns (from the full set).
    const types = [...new Set(this.features.map(f => f.type).filter(Boolean))].sort();
    const projectsWithData = [...new Set(this.features.map(f => f.project_id))];

    // Stats for the current filtered set.
    const byGeom = { Point: 0, LineString: 0, Polygon: 0 } as Record<string, number>;
    const byProject = new Map<string, number>();
    for (const f of rows) {
      byGeom[f.geometry_type] = (byGeom[f.geometry_type] ?? 0) + 1;
      byProject.set(f.project_id, (byProject.get(f.project_id) ?? 0) + 1);
    }
    const perProject = [...byProject.entries()].sort((a, b) => b[1] - a[1]);

    const opt = (val: string, label: string, sel: string) =>
      `<option value="${escAttr(val)}"${val === sel ? ' selected' : ''}>${escHtml(label)}</option>`;

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Master Data</h2>
          <button class="panel-close" id="md-close">✕</button>
        </div>
        <div class="panel-body">
          <p class="settings-hint">Read-only view across all ${projectsWithData.length} project(s) with data. ${rows.length} of ${this.features.length} features shown.</p>

          <div class="settings-section">
            <h4>Filters</h4>
            <label>Project
              <select id="md-f-project">
                ${opt('', 'All projects', this.filters.project)}
                ${this.projects.map(p => opt(p.id, p.name, this.filters.project)).join('')}
              </select>
            </label>
            <label>Geometry
              <select id="md-f-geom">
                ${opt('', 'All', this.filters.geometry)}
                ${opt('Point', 'Points', this.filters.geometry)}
                ${opt('LineString', 'Lines', this.filters.geometry)}
                ${opt('Polygon', 'Polygons', this.filters.geometry)}
              </select>
            </label>
            <label>Type
              <select id="md-f-type">
                ${opt('', 'All types', this.filters.type)}
                ${types.map(t => opt(t, t, this.filters.type)).join('')}
              </select>
            </label>
            <label>Search
              <input type="text" id="md-f-search" placeholder="point id, description, notes…" value="${escAttr(this.filters.search)}" />
            </label>
          </div>

          <div class="settings-section">
            <h4>Summary</h4>
            <div class="settings-hint">
              ${byGeom.Point} points · ${byGeom.LineString} lines · ${byGeom.Polygon} polygons
            </div>
            <div class="md-perproject">
              ${perProject.map(([pid, n]) => `<div class="settings-hint">${escHtml(projectName(pid))}: <strong>${n}</strong></div>`).join('') || '<div class="settings-hint">No features match.</div>'}
            </div>
          </div>

          <div class="settings-section">
            <h4>Map</h4>
            <label class="toggle-label">
              <span>Show filtered features on map (read-only)</span>
              <input type="checkbox" id="md-preview" ${this.previewing ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-section">
            <h4>Export (${rows.length} features)</h4>
            <div class="btn-group">
              <button class="btn-outline" id="md-exp-geojson">GeoJSON</button>
              <button class="btn-outline" id="md-exp-csv">CSV</button>
              <button class="btn-outline" id="md-exp-kml">KML</button>
              <button class="btn-outline" id="md-exp-shp">Shapefile</button>
            </div>
          </div>
        </div>
        <div class="panel-footer">
          <button class="btn btn-primary panel-done-btn" id="md-done">Done</button>
        </div>
      </div>`;

    this.wire();
  }

  private wire(): void {
    this.panel.querySelector('#md-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#md-done')?.addEventListener('click', () => this.close());

    const reRender = () => { const wasPreview = this.previewing; this.render(); if (wasPreview) this.emitPreview(); };
    this.panel.querySelector<HTMLSelectElement>('#md-f-project')?.addEventListener('change', e => { this.filters.project = (e.target as HTMLSelectElement).value; reRender(); });
    this.panel.querySelector<HTMLSelectElement>('#md-f-geom')?.addEventListener('change', e => { this.filters.geometry = (e.target as HTMLSelectElement).value; reRender(); });
    this.panel.querySelector<HTMLSelectElement>('#md-f-type')?.addEventListener('change', e => { this.filters.type = (e.target as HTMLSelectElement).value; reRender(); });
    this.panel.querySelector<HTMLInputElement>('#md-f-search')?.addEventListener('input', e => { this.filters.search = (e.target as HTMLInputElement).value; reRender(); });

    this.panel.querySelector<HTMLInputElement>('#md-preview')?.addEventListener('change', e => {
      this.previewing = (e.target as HTMLInputElement).checked;
      if (this.previewing) this.emitPreview();
      else EventBus.emit('master-data-hide');
    });

    const exp = new ExportManager();
    const rows = () => this.filtered();
    this.panel.querySelector('#md-exp-geojson')?.addEventListener('click', () => void exp.exportGeoJSON(rows()));
    this.panel.querySelector('#md-exp-csv')?.addEventListener('click', () => void exp.exportCSV(rows()));
    this.panel.querySelector('#md-exp-kml')?.addEventListener('click', () => void exp.exportKML(rows()));
    this.panel.querySelector('#md-exp-shp')?.addEventListener('click', () => void exp.exportShapefile(rows()));
  }

  private emitPreview(): void {
    EventBus.emit('master-data-show', { features: this.filtered() });
  }
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s: string): string { return escHtml(s); }
