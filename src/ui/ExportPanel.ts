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
          <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM112,184a8,8,0,0,1-16,0V132.94l-4.42,2.22a8,8,0,0,1-7.16-14.32l16-8A8,8,0,0,1,112,120Zm56-8a8,8,0,0,1,0,16H136a8,8,0,0,1-6.4-12.8l28.78-38.37A8,8,0,1,0,145.07,132a8,8,0,1,1-13.85-8A24,24,0,0,1,176,136a23.76,23.76,0,0,1-4.84,14.45L152,176ZM48,80V48H72v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80Z"/></svg>Date Filter</h4>
          ${isLoading
            ? `<div class="settings-hint">Loading…</div>`
            : `<div class="export-date-list">${dateRows}</div>`}
        </div>

        <div class="settings-section">
          <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M228.92,49.69a8,8,0,0,0-6.86-1.45L160.93,63.52,99.58,32.84a8,8,0,0,0-5.52-.6l-64,16A8,8,0,0,0,24,56V200a8,8,0,0,0,9.94,7.76l61.13-15.28,61.35,30.68A8.15,8.15,0,0,0,160,224a8,8,0,0,0,1.94-.24l64-16A8,8,0,0,0,232,200V56A8,8,0,0,0,228.92,49.69ZM96,176a8,8,0,0,0-1.94.24L40,189.75V62.25L95.07,48.48l.93.46Zm120,17.75-55.07,13.77-.93-.46V80a8,8,0,0,0,1.94-.23L216,66.25Z"/></svg>Spatial Filter</h4>
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
          <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M74.34,85.66A8,8,0,0,1,85.66,74.34L120,108.69V24a8,8,0,0,1,16,0v84.69l34.34-34.35a8,8,0,0,1,11.32,11.32l-48,48a8,8,0,0,1-11.32,0ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H84.4a4,4,0,0,1,2.83,1.17L111,145A24,24,0,0,0,145,145l23.8-23.8A4,4,0,0,1,171.6,120H224A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>Save to Device</h4>
          <div class="export-btn-grid">
            <button class="btn-outline export-btn" data-format="geojson">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,176H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm-8-56V44l44,44Z"/></svg>GeoJSON
            </button>
            <button class="btn-outline export-btn" data-format="kml">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm78.36,64H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM216,128a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM128,43a115.27,115.27,0,0,1,26,45H102A115.11,115.11,0,0,1,128,43ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48Zm50.35,61.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z"/></svg>KML
            </button>
            <button class="btn-outline export-btn" data-format="shp">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M220,169.09l-92,53.65L36,169.09A8,8,0,0,0,28,182.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,169.09Z"/></svg>Shapefile
            </button>
            <button class="btn-outline export-btn" data-format="csv">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM40,112H80v32H40Zm56,0H216v32H96ZM40,160H80v32H40Zm176,32H96V160H216v32Z"/></svg>CSV
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
