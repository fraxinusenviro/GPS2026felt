import type { ImportedLayer, FieldFeature, GeoJSONGeometry } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { ImportManager } from '../io/ImportManager';
import type { ExportManager } from '../io/ExportManager';
import { FeltExportDialog } from './FeltExportDialog';

type MapBounds = { west: number; south: number; east: number; north: number };

export class LayersPanel {
  private panel = document.getElementById('layers-panel')!;
  private isOpen = false;
  private importedLayers: ImportedLayer[] = [];
  private storage = StorageManager.getInstance();
  private fileInput!: HTMLInputElement;
  private feltDialog = new FeltExportDialog();

  // Export state
  private exportFeatures: FieldFeature[] = [];
  private exportSelectedDates = new Set<string>(['all']);
  private exportSpatialFilter: 'all' | 'extent' = 'all';

  constructor(
    private importManager: ImportManager,
    private exportManager: ExportManager,
    private getMapBounds: () => MapBounds | null = () => null
  ) {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.geojson,.json,.kml,.shp,.zip,.mbtiles,.pdf,.gpx';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);

    this.fileInput.addEventListener('change', async () => {
      const files = this.fileInput.files;
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        const layer = await this.importManager.importFile(file);
        if (layer) this.importedLayers.push(layer);
      }
      this.fileInput.value = '';
      if (this.isOpen) this.render();
    });

    EventBus.on<{ layer: ImportedLayer }>('layer-added', ({ layer }) => {
      if (!this.importedLayers.find(l => l.id === layer.id)) {
        this.importedLayers.push(layer);
        if (this.isOpen) this.render();
      }
    });

    EventBus.on<{ id: string }>('layer-deleted', ({ id }) => {
      this.importedLayers = this.importedLayers.filter(l => l.id !== id);
      if (this.isOpen) this.render();
    });
  }

  async init(): Promise<void> {
    this.importedLayers = await this.storage.getAllImportedLayers();
    for (const layer of this.importedLayers) {
      if (layer.visible) this.importManager.renderImportedLayer(layer);
    }
  }

  toggleLayers(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  toggleImport(): void {
    this.open();
    this.activeTab = 'import';
    this.render();
  }

  toggleExport(): void {
    this.activeTab = 'export';
    this.exportFeatures = [];
    this.open();
    void this.reloadExportFeatures();
  }

  private activeTab: 'layers' | 'import' | 'export' = 'layers';

  open(): void {
    this.isOpen = true;
    this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
  }

  close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  private async reloadExportFeatures(): Promise<void> {
    const features = await this.storage.getAllFeatures();
    this.exportFeatures = features;
    if (this.isOpen && this.activeTab === 'export') {
      const content = this.panel.querySelector<HTMLElement>('#layer-tab-content');
      if (content) {
        content.innerHTML = this.renderExportTab();
        this.wireExportButtons();
      }
    }
  }

  private render(): void {
    const tabs = [
      { id: 'layers', label: 'Layers' },
      { id: 'import', label: 'Import' },
      { id: 'export', label: 'Export' }
    ];

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Data</h2>
          <button class="panel-close" id="layers-close">✕</button>
        </div>
        <div class="panel-body">
          <div class="tab-bar">
            ${tabs.map(t => `<button class="tab-btn ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
          </div>
          <div id="layer-tab-content">
            ${this.activeTab === 'layers' ? this.renderLayersTab() :
              this.activeTab === 'import' ? this.renderImportTab() :
              this.renderExportTab()}
          </div>
        </div>
        <div class="panel-footer">
          <button class="btn-primary panel-done-btn" id="layers-done">Done</button>
        </div>
      </div>
    `;

    this.panel.querySelector('#layers-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#layers-done')?.addEventListener('click', () => this.close());

    this.panel.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.activeTab = btn.dataset.tab as 'layers' | 'import' | 'export';
        if (this.activeTab === 'export') {
          this.exportFeatures = [];
          this.render();
          await this.reloadExportFeatures();
        } else {
          this.render();
        }
      });
    });

    this.wireTab();
  }

  // ── Feature filtering ────────────────────────────────────

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

  private countFiltered(): number {
    return this.getFilteredFeatures().length;
  }

  // ── Export tab rendering ─────────────────────────────────

  private formatDateLabel(isoDate: string): string {
    return new Date(isoDate + 'T12:00:00').toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  private renderExportTab(): string {
    const features = this.exportFeatures;
    const today = new Date().toLocaleDateString('en-CA');
    const todayCount = features.filter(f => f.created_at.startsWith(today)).length;
    const uniqueDates = [...new Set(features.map(f => f.created_at.substring(0, 10)))].sort().reverse();
    const isLoading = features.length === 0;
    const isAllSelected = this.exportSelectedDates.has('all');

    const dateRows = isLoading ? '' : [
      // "All Dates" master checkbox
      `<label class="export-date-row">
        <input type="checkbox" class="export-date-cb" value="all" ${isAllSelected ? 'checked' : ''} />
        <span>All Dates <span class="export-date-count">(${features.length})</span></span>
      </label>`,
      // "Today" shortcut
      `<label class="export-date-row export-date-row-indent">
        <input type="checkbox" class="export-date-cb" value="today"
          ${!isAllSelected && this.exportSelectedDates.has('today') ? 'checked' : ''} />
        <span>Today <span class="export-date-count">(${todayCount})</span></span>
      </label>`,
      // Individual dates
      ...uniqueDates.map(d => {
        const df = features.filter(f => f.created_at.startsWith(d));
        const types = [...new Set(df.map(f => f.type).filter(Boolean))].slice(0, 3).join(', ');
        return `<label class="export-date-row export-date-row-indent">
          <input type="checkbox" class="export-date-cb" value="${d}"
            ${!isAllSelected && this.exportSelectedDates.has(d) ? 'checked' : ''} />
          <span>${this.formatDateLabel(d)} <span class="export-date-count">(${df.length}${types ? ' · ' + types : ''})</span></span>
        </label>`;
      })
    ].join('');

    const n = this.countFiltered();

    return `
      <div class="export-section">

        <!-- Date filter -->
        <div class="felt-field">
          <label class="felt-label">Date Filter</label>
          ${isLoading
            ? `<div class="settings-hint">Loading…</div>`
            : `<div class="export-date-list">${dateRows}</div>`
          }
        </div>

        <!-- Spatial filter -->
        <div class="felt-field">
          <label class="felt-label">Spatial Filter</label>
          <div class="felt-radio-group">
            <label class="felt-radio">
              <input type="radio" name="export-spatial" value="all"
                ${this.exportSpatialFilter === 'all' ? 'checked' : ''} />
              <span>All features</span>
            </label>
            <label class="felt-radio">
              <input type="radio" name="export-spatial" value="extent"
                ${this.exportSpatialFilter === 'extent' ? 'checked' : ''} />
              <span>Current map view</span>
            </label>
          </div>
        </div>

        <!-- Selection count -->
        <p class="settings-hint" id="export-count" style="margin:0 0 14px;font-weight:500">
          ${isLoading ? '' : `${n} feature${n !== 1 ? 's' : ''} selected`}
        </p>

        <!-- Local save -->
        <div>
          <h4 style="margin:0 0 8px">Save to Device</h4>
          <div class="export-btn-grid">
            <button class="btn-outline export-btn" data-format="geojson">
              <span class="export-icon">{ }</span>GeoJSON
            </button>
            <button class="btn-outline export-btn" data-format="kml">
              <span class="export-icon">KML</span>KML
            </button>
            <button class="btn-outline export-btn" data-format="shp">
              <span class="export-icon">SHP</span>Shapefile
            </button>
            <button class="btn-outline export-btn" data-format="csv">
              <span class="export-icon">CSV</span>CSV
            </button>
          </div>
        </div>

        <!-- Felt upload -->
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border,#333)">
          <h4 style="margin:0 0 6px">Upload to Felt</h4>
          <p class="settings-hint" style="margin-bottom:10px">Uploads the selected features as a GeoJSON layer.</p>
          <button class="btn-primary export-btn" data-format="felt" style="width:100%">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;margin-right:6px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload to Felt
          </button>
        </div>

      </div>
    `;
  }

  private wireExportButtons(): void {
    const countEl = this.panel.querySelector<HTMLElement>('#export-count');

    const updateCount = () => {
      if (countEl) {
        const n = this.countFiltered();
        countEl.textContent = `${n} feature${n !== 1 ? 's' : ''} selected`;
      }
    };

    // Date checkboxes
    this.panel.querySelectorAll<HTMLInputElement>('.export-date-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.value === 'all') {
          if (cb.checked) {
            // Select all — uncheck individual dates
            this.exportSelectedDates = new Set(['all']);
            this.panel.querySelectorAll<HTMLInputElement>('.export-date-cb:not([value="all"])').forEach(o => { o.checked = false; });
          } else {
            this.exportSelectedDates.delete('all');
          }
        } else {
          // Individual date or "today"
          const allCb = this.panel.querySelector<HTMLInputElement>('.export-date-cb[value="all"]');
          if (allCb) allCb.checked = false;
          this.exportSelectedDates.delete('all');
          if (cb.checked) this.exportSelectedDates.add(cb.value);
          else this.exportSelectedDates.delete(cb.value);
        }
        updateCount();
      });
    });

    // Spatial filter radios
    this.panel.querySelectorAll<HTMLInputElement>('input[name="export-spatial"]').forEach(r => {
      r.addEventListener('change', () => {
        this.exportSpatialFilter = r.value as 'all' | 'extent';
        updateCount();
      });
    });

    // Export buttons
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

  // ── Layers tab ───────────────────────────────────────────

  private getFieldNames(layer: ImportedLayer): string[] {
    if (!layer.data || layer.data.features.length === 0) return [];
    const props = layer.data.features[0].properties ?? {};
    return Object.keys(props).filter(k => typeof props[k] === 'string' || typeof props[k] === 'number');
  }

  private renderLayersTab(): string {
    if (this.importedLayers.length === 0) {
      return '<p class="empty-state">No imported layers. Use Import tab to add data.</p>';
    }
    return `
      <div id="imported-layers-list">
        ${this.importedLayers.map(l => {
          const fields = this.getFieldNames(l);
          return `
          <div class="layer-row" data-id="${l.id}">
            <div class="layer-row-main">
              <button class="layer-vis-btn ${l.visible ? 'active' : ''}" data-id="${l.id}" title="Toggle visibility">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <div class="layer-info">
                <span class="layer-name">${l.name}</span>
                <span class="layer-badge">${l.file_type.toUpperCase()}</span>
                ${l.data ? `<span class="layer-count">${l.data.features.length} ft</span>` : ''}
              </div>
              <div class="layer-color-dot" style="background:${l.color}"></div>
              <button class="layer-zoom-btn" data-id="${l.id}" title="Zoom to layer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                </svg>
                <span>Zoom</span>
              </button>
              <button class="layer-del-btn btn-sm btn-danger" data-id="${l.id}" title="Remove layer">✕</button>
            </div>
            ${l.data && fields.length > 0 ? `
            <div class="layer-row-label">
              <label class="layer-label-row">
                <span class="layer-label-text">Label:</span>
                <select class="layer-label-select" data-id="${l.id}">
                  <option value="">None</option>
                  ${fields.map(f => `<option value="${f}" ${f === l.label_field ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
              </label>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `;
  }

  // ── Import tab ───────────────────────────────────────────

  private renderImportTab(): string {
    return `
      <div class="import-section">
        <h4>Import Vector Data</h4>
        <p class="settings-hint">Supported: GeoJSON, KML, GPX, Shapefile (.shp or .zip)</p>
        <button class="btn-primary" id="import-vector-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Choose Vector File(s)
        </button>

        <h4 style="margin-top:20px">Import Raster Tiles</h4>
        <p class="settings-hint">MBTiles (.mbtiles) — offline tile packages. File is cached locally.</p>
        <button class="btn-outline" id="import-mbtiles-btn">Choose MBTiles File</button>

        <h4 style="margin-top:20px">GeoPDF Map</h4>
        <p class="settings-hint">Georeferenced PDF maps are overlaid directly on the map.</p>
        <button class="btn-outline" id="import-geopdf-btn">Import GeoPDF</button>

        <div class="import-drag-area" id="drag-drop-area">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;opacity:0.4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p>Or drag &amp; drop files here</p>
        </div>
      </div>
    `;
  }

  // ── Tab wiring ───────────────────────────────────────────

  private wireTab(): void {
    if (this.activeTab === 'layers') {
      this.panel.querySelectorAll<HTMLButtonElement>('.layer-vis-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const layer = this.importedLayers.find(l => l.id === btn.dataset.id);
          if (!layer) return;
          layer.visible = !layer.visible;
          this.importManager.toggleLayerVisibility(layer);
          await this.storage.saveImportedLayer(layer);
          btn.classList.toggle('active', layer.visible);
        });
      });

      this.panel.querySelectorAll<HTMLButtonElement>('.layer-zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const layer = this.importedLayers.find(l => l.id === btn.dataset.id);
          if (layer) this.importManager.zoomToLayer(layer);
        });
      });

      this.panel.querySelectorAll<HTMLSelectElement>('.layer-label-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const layer = this.importedLayers.find(l => l.id === sel.dataset.id);
          if (!layer) return;
          layer.label_field = sel.value || undefined;
          this.importManager.setLayerLabel(layer);
          await this.storage.saveImportedLayer(layer);
        });
      });

      this.panel.querySelectorAll<HTMLButtonElement>('.layer-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const layer = this.importedLayers.find(l => l.id === btn.dataset.id);
          if (!layer) return;
          this.importManager.removeImportedLayer(layer);
          await this.storage.deleteImportedLayer(layer.id);
          this.importedLayers = this.importedLayers.filter(l => l.id !== layer.id);
          this.render();
        });
      });
    }

    if (this.activeTab === 'import') {
      document.getElementById('import-vector-btn')?.addEventListener('click', () => {
        this.fileInput.accept = '.geojson,.json,.kml,.gpx,.shp,.zip';
        this.fileInput.click();
      });
      document.getElementById('import-mbtiles-btn')?.addEventListener('click', () => {
        this.fileInput.accept = '.mbtiles';
        this.fileInput.click();
      });
      document.getElementById('import-geopdf-btn')?.addEventListener('click', () => {
        this.fileInput.accept = '.pdf';
        this.fileInput.click();
      });

      const dropArea = document.getElementById('drag-drop-area');
      dropArea?.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('drag-over'); });
      dropArea?.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
      dropArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropArea.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (!files) return;
        for (const file of Array.from(files)) {
          const layer = await this.importManager.importFile(file);
          if (layer) this.importedLayers.push(layer);
        }
        this.render();
      });
    }

    if (this.activeTab === 'export') {
      this.wireExportButtons();
    }
  }
}
