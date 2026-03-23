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

        <div class="felt-field">
          <label class="felt-label">Date Filter</label>
          ${isLoading
            ? `<div class="settings-hint">Loading…</div>`
            : `<div class="export-date-list">${dateRows}</div>`}
        </div>

        <div class="felt-field">
          <label class="felt-label">Spatial Filter</label>
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
        </div>

        <p class="settings-hint" id="export-count" style="margin:0 0 14px;font-weight:500">
          ${isLoading ? '' : `${n} feature${n !== 1 ? 's' : ''} selected`}
        </p>

        <div>
          <h4 style="margin:0 0 8px">Save to Device</h4>
          <div class="export-btn-grid">
            <button class="btn-outline export-btn" data-format="geojson"><span class="export-icon">{ }</span>GeoJSON</button>
            <button class="btn-outline export-btn" data-format="kml"><span class="export-icon">KML</span>KML</button>
            <button class="btn-outline export-btn" data-format="shp"><span class="export-icon">SHP</span>Shapefile</button>
            <button class="btn-outline export-btn" data-format="csv"><span class="export-icon">CSV</span>CSV</button>
          </div>
        </div>

        <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border,#333)">
          <h4 style="margin:0 0 6px">Upload to Felt</h4>
          <p class="settings-hint" style="margin-bottom:10px">Uploads selected features as a GeoJSON layer.</p>
          <button class="btn-primary export-btn" data-format="felt" style="width:100%">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;margin-right:6px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
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
          const json = await this.exportManager.buildGeoJSON(features);
          this.feltDialog.show(json);
        }
      });
    });
  }
}
