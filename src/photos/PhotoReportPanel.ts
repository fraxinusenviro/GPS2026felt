import type { FieldFeature } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import { generatePhotoLogPdf } from './PhotoReport';
import type { FontKey } from './pdfFonts';
import { BASEMAPS } from '../constants';
import type { MapManager } from '../map/MapManager';

type MapBounds = { west: number; south: number; east: number; north: number };

export class PhotoReportPanel {
  private panel = document.getElementById('photo-report-panel')!;
  private isOpen = false;
  private storage = StorageManager.getInstance();
  private allPhotoFeatures: FieldFeature[] = [];
  private dateFrom = '';
  private dateTo = '';
  private spatialFilter: 'all' | 'extent' = 'all';
  private selectedObservers = new Set<string>(['all']);
  private selectedFont: FontKey = 'default';

  constructor(
    private mapManager: MapManager,
  ) {}

  open(): void {
    this.isOpen = true;
    this.allPhotoFeatures = [];
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
    const all = await this.storage.getAllFeatures();
    this.allPhotoFeatures = all.filter(f => f.photo_data !== undefined);
    // Default the PDF font to the app's current Font Appearance setting.
    try {
      const settings = await this.storage.getAppSettings();
      this.selectedFont = (settings.font_family ?? 'default') as FontKey;
    } catch { /* keep default */ }
    if (this.isOpen) this.updateBody();
  }

  private getMapBounds(): MapBounds | null {
    try {
      const b = this.mapManager.getMap().getBounds();
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    } catch { return null; }
  }

  private getFilteredFeatures(): FieldFeature[] {
    let features = this.allPhotoFeatures;

    if (this.dateFrom) {
      features = features.filter(f => f.created_at.substring(0, 10) >= this.dateFrom);
    }
    if (this.dateTo) {
      features = features.filter(f => f.created_at.substring(0, 10) <= this.dateTo);
    }

    if (this.spatialFilter === 'extent') {
      const b = this.getMapBounds();
      if (b) {
        features = features.filter(f => {
          const lon = f.lon ?? 0;
          const lat = f.lat ?? 0;
          return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
        });
      }
    }

    if (!this.selectedObservers.has('all')) {
      features = features.filter(f => {
        const obs = f.photo_data?.observer ?? f.created_by ?? '';
        return this.selectedObservers.has(obs);
      });
    }

    return features;
  }

  private getObservers(): string[] {
    const obs = new Set<string>();
    for (const f of this.allPhotoFeatures) {
      const o = f.photo_data?.observer ?? f.created_by ?? '';
      if (o) obs.add(o);
    }
    return [...obs].sort();
  }

  private updateBody(): void {
    const body = this.panel.querySelector<HTMLElement>('#photo-report-body');
    if (body) {
      body.innerHTML = this.renderBody();
      this.wireBody(body);
    }
  }

  private renderBody(): string {
    const n = this.getFilteredFeatures().length;
    const total = this.allPhotoFeatures.length;
    const observers = this.getObservers();
    const loading = total === 0 && this.isOpen;

    const today = new Date().toLocaleDateString('en-CA');

    const observerRows = observers.map(obs => `
      <label class="export-date-row export-date-row-indent">
        <input type="checkbox" class="photo-observer-cb" value="${obs}"
          ${!this.selectedObservers.has('all') && this.selectedObservers.has(obs) ? 'checked' : ''} />
        <span>${obs}</span>
      </label>`).join('');

    return `
      <div class="export-section">

        <div class="settings-section">
          <h4>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM112,184a8,8,0,0,1-16,0V132.94l-4.42,2.22a8,8,0,0,1-7.16-14.32l16-8A8,8,0,0,1,112,120Zm56-8a8,8,0,0,1,0,16H136a8,8,0,0,1-6.4-12.8l28.78-38.37A8,8,0,1,0,145.07,132a8,8,0,1,1-13.85-8A24,24,0,0,1,176,136a23.76,23.76,0,0,1-4.84,14.45L152,176ZM48,80V48H72v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80Z"/></svg>
            Date Range
          </h4>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div style="display:flex;flex-direction:column;gap:3px;flex:1">
              <label style="font-size:11px;color:var(--color-text-dim)">From</label>
              <input type="date" id="photo-date-from" class="felt-input" value="${this.dateFrom}" max="${today}" style="font-size:12px;padding:4px 8px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;flex:1">
              <label style="font-size:11px;color:var(--color-text-dim)">To</label>
              <input type="date" id="photo-date-to" class="felt-input" value="${this.dateTo}" max="${today}" style="font-size:12px;padding:4px 8px" />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h4>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M228.92,49.69a8,8,0,0,0-6.86-1.45L160.93,63.52,99.58,32.84a8,8,0,0,0-5.52-.6l-64,16A8,8,0,0,0,24,56V200a8,8,0,0,0,9.94,7.76l61.13-15.28,61.35,30.68A8.15,8.15,0,0,0,160,224a8,8,0,0,0,1.94-.24l64-16A8,8,0,0,0,232,200V56A8,8,0,0,0,228.92,49.69ZM96,176a8,8,0,0,0-1.94.24L40,189.75V62.25L95.07,48.48l.93.46Zm120,17.75-55.07,13.77-.93-.46V80a8,8,0,0,0,1.94-.23L216,66.25Z"/></svg>
            Spatial Filter
          </h4>
          <div class="felt-radio-group">
            <label class="felt-radio">
              <input type="radio" name="photo-spatial" value="all" ${this.spatialFilter === 'all' ? 'checked' : ''} />
              <span>All photo points</span>
            </label>
            <label class="felt-radio">
              <input type="radio" name="photo-spatial" value="extent" ${this.spatialFilter === 'extent' ? 'checked' : ''} />
              <span>Current map view</span>
            </label>
          </div>
        </div>

        ${observers.length > 0 ? `
        <div class="settings-section">
          <h4>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>
            Observer
          </h4>
          <label class="export-date-row">
            <input type="checkbox" class="photo-observer-cb" value="all" ${this.selectedObservers.has('all') ? 'checked' : ''} />
            <span>All observers <span class="export-date-count">(${total})</span></span>
          </label>
          ${observerRows}
        </div>` : ''}

        <div class="settings-section">
          <h4>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M208,32H48A16,16,0,0,0,32,48V80a8,8,0,0,0,16,0V48h72V208H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V48h72V80a8,8,0,0,0,16,0V48A16,16,0,0,0,208,32Z"/></svg>
            Font
          </h4>
          <select id="photo-font" class="felt-input" style="width:100%;font-size:12px;padding:5px 8px">
            <option value="default" ${this.selectedFont === 'default' ? 'selected' : ''}>Default (System)</option>
            <option value="oswald" ${this.selectedFont === 'oswald' ? 'selected' : ''}>Oswald</option>
            <option value="lato" ${this.selectedFont === 'lato' ? 'selected' : ''}>Lato</option>
            <option value="roboto-condensed" ${this.selectedFont === 'roboto-condensed' ? 'selected' : ''}>Roboto Condensed</option>
          </select>
        </div>

        ${loading ? '' : `
        <p class="settings-hint" id="photo-report-count" style="margin:0 0 8px;font-weight:500;text-align:center">
          ${n} photo${n !== 1 ? 's' : ''} match
        </p>`}

      </div>`;
  }

  private wireBody(scope: HTMLElement): void {
    const updateCount = () => {
      const countEl = scope.querySelector<HTMLElement>('#photo-report-count');
      if (countEl) {
        const n = this.getFilteredFeatures().length;
        countEl.textContent = `${n} photo${n !== 1 ? 's' : ''} match`;
      }
    };

    scope.querySelector<HTMLInputElement>('#photo-date-from')?.addEventListener('change', (e) => {
      this.dateFrom = (e.target as HTMLInputElement).value;
      updateCount();
    });
    scope.querySelector<HTMLInputElement>('#photo-date-to')?.addEventListener('change', (e) => {
      this.dateTo = (e.target as HTMLInputElement).value;
      updateCount();
    });

    scope.querySelectorAll<HTMLInputElement>('input[name="photo-spatial"]').forEach(r => {
      r.addEventListener('change', () => {
        this.spatialFilter = r.value as 'all' | 'extent';
        updateCount();
      });
    });

    scope.querySelector<HTMLSelectElement>('#photo-font')?.addEventListener('change', (e) => {
      this.selectedFont = (e.target as HTMLSelectElement).value as FontKey;
    });

    scope.querySelectorAll<HTMLInputElement>('.photo-observer-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.value === 'all') {
          if (cb.checked) {
            this.selectedObservers = new Set(['all']);
            scope.querySelectorAll<HTMLInputElement>('.photo-observer-cb:not([value="all"])').forEach(o => { o.checked = false; });
          } else {
            this.selectedObservers.delete('all');
          }
        } else {
          const allCb = scope.querySelector<HTMLInputElement>('.photo-observer-cb[value="all"]');
          if (allCb) allCb.checked = false;
          this.selectedObservers.delete('all');
          if (cb.checked) this.selectedObservers.add(cb.value);
          else this.selectedObservers.delete(cb.value);
        }
        updateCount();
      });
    });
  }

  private render(): void {
    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Photo Log Report</h2>
          <button class="panel-close" id="photo-report-close">✕</button>
        </div>
        <div class="panel-body">
          <div id="photo-report-body">${this.renderBody()}</div>
        </div>
        <div class="panel-footer" style="gap:8px">
          <button class="btn-primary" id="photo-report-generate" style="flex:1">Generate PDF</button>
          <button class="btn-outline" id="photo-report-cancel" style="flex:0 0 auto">Cancel</button>
        </div>
      </div>`;

    this.panel.querySelector('#photo-report-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#photo-report-cancel')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#photo-report-generate')?.addEventListener('click', () => void this.generate());

    const body = this.panel.querySelector<HTMLElement>('#photo-report-body');
    if (body) this.wireBody(body);
  }

  private async generate(): Promise<void> {
    const features = this.getFilteredFeatures();
    if (features.length === 0) {
      EventBus.emit('toast', { message: 'No photo points match the current filters', type: 'warning' });
      return;
    }

    const btn = this.panel.querySelector<HTMLButtonElement>('#photo-report-generate');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

    try {
      // Masthead / footer metadata, derived from the active project & map.
      const settings = await this.storage.getAppSettings();
      let project: string | undefined;
      let site: string | undefined;
      try {
        const map = settings.active_map_id ? await this.storage.getMap(settings.active_map_id) : undefined;
        const proj = await this.storage.getProject(map?.project_id ?? settings.active_project_id ?? 'default');
        project = proj?.name;
        site = map?.name;
      } catch { /* metadata is best-effort */ }

      const basemapUrl = BASEMAPS.find(b => b.id === settings.basemap_id)?.url;

      await generatePhotoLogPdf(features, {
        project,
        site,
        preparedBy: settings.user_id || undefined,
        basemapUrl,
        fontKey: this.selectedFont,
      });
      EventBus.emit('toast', { message: 'Photo log PDF downloaded', type: 'success' });
      this.close();
    } catch (err) {
      console.error('Photo log PDF failed:', err);
      EventBus.emit('toast', { message: 'PDF generation failed', type: 'error' });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate PDF'; }
    }
  }
}
