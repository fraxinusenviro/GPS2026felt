import type { FieldFeature, GeoJSONGeometry } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { ExportManager } from '../io/ExportManager';
import { FeltExportDialog } from './FeltExportDialog';

type MapBounds = { west: number; south: number; east: number; north: number };

export class ExportPanel {
  private panel = document.getElementById('export-panel')!;
  private isOpen = false;
  private storage = StorageManager.getInstance();
  private feltDialog = new FeltExportDialog();

  private exportFeatures: FieldFeature[] = [];
  private exportSelectedDates = new Set<string>(['all']);
  private exportSpatialFilter: 'all' | 'extent' = 'all';

  constructor(
    private exportManager: ExportManager,
    private getMapBounds: () => MapBounds | null = () => null,
  ) {}

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  open(): void {
    this.isOpen = true;
    this.exportFeatures = [];
    this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
    void this.reloadFeatures();
  }

  close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  private async reloadFeatures(): Promise<void> {
    this.exportFeatures = await this.storage.getAllFeatures();
    if (this.isOpen) {
      const content = this.panel.querySelector<HTMLElement>('#export-tab-body');
      if (content) {
        content.innerHTML = this.renderBody();
        this.wireButtons();
      }
    }
  }

  // ── Filtering ────────────────────────────────────────────

  private filterByDate(features: FieldFeature[], selected: Set<string>): FieldFeature[] {
    if (selected.has('all') || selected.size === 0) return features;
    const today = new Date().toLocaleDateString('en-CA');
    const dates = new Set([...selected].map(s => s === 'today' ? today : s));
    return features.filter(f => dates.has(f.created_at.substring(0, 10)));
  }

  private featureCentroid(f: FieldFeature): [number, number] {
    if (f.lat !== null && f.lon !== null) return [f.lon, f.lat];
    const g = f.geometry as GeoJSONGeometry;
    if (g.type === 'LineString') {
      const c = g.coordinates as number[][];
      return [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
    }
    if (g.type === 'Polygon') {
      const c = g.coordinates[0] as number[][];
      return [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
    }
    return [0, 0];
  }

  private filterByExtent(features: FieldFeature[]): FieldFeature[] {
    if (this.exportSpatialFilter === 'all') return features;
    const b = this.getMapBounds();
    if (!b) return features;
    return features.filter(f => {
      const [lon, lat] = this.featureCentroid(f);
      return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
    });
  }

  private getFilteredFeatures(): FieldFeature[] {
    return this.filterByExtent(this.filterByDate(this.exportFeatures, this.exportSelectedDates));
  }

  // ── Rendering ────────────────────────────────────────────

  private formatDateLabel(isoDate: string): string {
    return new Date(isoDate + 'T12:00:00').toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  private renderBody(): string {
    const features = this.exportFeatures;
    const today = new Date().toLocaleDateString('en-CA');
    const todayCount = features.filter(f => f.created_at.startsWith(today)).length;
    const uniqueDates = [...new Set(features.map(f => f.created_at.substring(0, 10)))].sort().reverse();
    const isLoading = features.length === 0 && this.isOpen;
    const isAllSelected = this.exportSelectedDates.has('all');
    const n = this.getFilteredFeatures().length;

    const dateRows = isLoading ? '' : [
      `<label class="export-date-row">
        <input type="checkbox" class="export-date-cb" value="all" ${isAllSelected ? 'checked' : ''} />
        <span>All Dates <span class="export-date-count">(${features.length})</span></span>
      </label>`,
      `<label class="export-date-row export-date-row-indent">
        <input type="checkbox" class="export-date-cb" value="today"
          ${!isAllSelected && this.exportSelectedDates.has('today') ? 'checked' : ''} />
        <span>Today <span class="export-date-count">(${todayCount})</span></span>
      </label>`,
      ...uniqueDates.map(d => {
        const df = features.filter(f => f.created_at.startsWith(d));
        const types = [...new Set(df.map(f => f.type).filter(Boolean))].slice(0, 3).join(', ');
        return `<label class="export-date-row export-date-row-indent">
          <input type="checkbox" class="export-date-cb" value="${d}"
            ${!isAllSelected && this.exportSelectedDates.has(d) ? 'checked' : ''} />
          <span>${this.formatDateLabel(d)} <span class="export-date-count">(${df.length}${types ? ' · ' + types : ''})</span></span>
        </label>`;
      }),
    ].join('');

    return `
      <div class="export-section">

        <div class="settings-section">
          <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Date Filter</h4>
          ${isLoading
            ? `<div class="settings-hint">Loading…</div>`
            : `<div class="export-date-list">${dateRows}</div>`}
        </div>

        <div class="settings-section">
          <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>Spatial Filter</h4>
          <div class="felt-radio-group">
            <label class="felt-radio">
              <input type="radio" name="export-spatial" value="all" ${this.exportSpatialFilter === 'all' ? 'checked' : ''} />
              <span>All features</span>
            </label>
            <label class="felt-radio">
              <input type="radio" name="export-spatial" value="extent" ${this.exportSpatialFilter === 'extent' ? 'checked' : ''} />
              <span>Current map view</span>
            </label>
          </div>
          <p class="settings-hint" id="export-count" style="margin-top:8px;font-weight:500">
            ${isLoading ? '' : `${n} feature${n !== 1 ? 's' : ''} selected`}
          </p>
        </div>

        <div class="settings-section">
          <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Save to Device</h4>
          <div class="export-btn-grid">
            <button class="btn-outline export-btn" data-format="geojson">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="9.01" y2="15"/><path d="M9 12h1v6"/></svg>GeoJSON
            </button>
            <button class="btn-outline export-btn" data-format="kml">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>KML
            </button>
            <button class="btn-outline export-btn" data-format="shp">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>Shapefile
            </button>
            <button class="btn-outline export-btn" data-format="csv">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>CSV
            </button>
          </div>
        </div>

        <div class="settings-section">
          <h4><img src="./felt-logo.svg" alt="Felt" height="16" style="vertical-align:-2px;margin-right:6px">Upload to Felt</h4>
          <p class="settings-hint">Export your field data to a Felt map as a GeoJSON layer, automatically styled by feature type using your configured preset colours. Each type gets its own colour category in the Felt legend, matching the symbology you see in the field mapper.</p>
          <button class="btn-primary export-btn" data-format="felt" style="width:100%;margin-top:8px">
            <img src="./felt-logo.svg" alt="" height="13" style="vertical-align:-1px;margin-right:6px;filter:brightness(0) invert(1)">
            Upload to Felt
          </button>
        </div>

      </div>`;
  }

  private render(): void {
    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Export</h2>
          <button class="panel-close" id="export-close">✕</button>
        </div>
        <div class="panel-body">
          <div id="export-tab-body">${this.renderBody()}</div>
        </div>
        <div class="panel-footer">
          <button class="btn-primary panel-done-btn" id="export-done">Done</button>
        </div>
      </div>`;

    this.panel.querySelector('#export-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#export-done')?.addEventListener('click', () => this.close());
    this.wireButtons();
  }

  private wireButtons(): void {
    const countEl = this.panel.querySelector<HTMLElement>('#export-count');
    const updateCount = () => {
      if (countEl) {
        const n = this.getFilteredFeatures().length;
        countEl.textContent = `${n} feature${n !== 1 ? 's' : ''} selected`;
      }
    };

    this.panel.querySelectorAll<HTMLInputElement>('.export-date-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.value === 'all') {
          if (cb.checked) {
            this.exportSelectedDates = new Set(['all']);
            this.panel.querySelectorAll<HTMLInputElement>('.export-date-cb:not([value="all"])').forEach(o => { o.checked = false; });
          } else {
            this.exportSelectedDates.delete('all');
          }
        } else {
          const allCb = this.panel.querySelector<HTMLInputElement>('.export-date-cb[value="all"]');
          if (allCb) allCb.checked = false;
          this.exportSelectedDates.delete('all');
          if (cb.checked) this.exportSelectedDates.add(cb.value);
          else this.exportSelectedDates.delete(cb.value);
        }
        updateCount();
      });
    });

    this.panel.querySelectorAll<HTMLInputElement>('input[name="export-spatial"]').forEach(r => {
      r.addEventListener('change', () => {
        this.exportSpatialFilter = r.value as 'all' | 'extent';
        updateCount();
      });
    });

    this.panel.querySelectorAll<HTMLButtonElement>('.export-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fmt = btn.dataset.format;
        const features = this.getFilteredFeatures();
        if (features.length === 0) {
          EventBus.emit('toast', { message: 'No features match the current filters', type: 'warning' });
          return;
        }
        if (fmt === 'geojson') {
          const json = await this.exportManager.buildGeoJSON(features);
          this.exportManager.downloadGeoJSONString(json);
        } else if (fmt === 'kml') {
          await this.exportManager.exportKML(features);
        } else if (fmt === 'shp') {
          await this.exportManager.exportShapefile(features);
        } else if (fmt === 'csv') {
          await this.exportManager.exportCSV(features);
        } else if (fmt === 'felt') {
          const presets = await this.storage.getAllTypePresets();
          const typeColors: Record<string, string> = Object.fromEntries(
            presets.map(p => [p.label, p.color])
          );
          const json = this.exportManager.buildGeoJSONWithColors(features, typeColors);
          this.feltDialog.show(json, typeColors);
        }
      });
    });
  }
}
