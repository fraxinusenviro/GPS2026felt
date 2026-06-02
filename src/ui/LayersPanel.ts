import type { ImportedLayer, FieldFeature, GeoJSONGeometry, GeometryType, TypePreset, AppSettings } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { ImportManager } from '../io/ImportManager';
import type { ExportManager } from '../io/ExportManager';
import { FeltExportDialog } from './FeltExportDialog';
import { StylePicker } from './StylePicker';
import { renderSwatchDataUrl, renderLineSwatchDataUrl, renderPolygonSwatchDataUrl } from './SymbolRenderer';
import type { PresetManager } from './PresetManager';

type MapBounds = { west: number; south: number; east: number; north: number };

export class LayersPanel {
  private panel = document.getElementById('layers-panel')!;
  private isOpen = false;
  private importedLayers: ImportedLayer[] = [];
  private storage = StorageManager.getInstance();
  private fileInput!: HTMLInputElement;
  private feltDialog = new FeltExportDialog();
  private stylePicker = new StylePicker();

  private mapBgColor = '#000000';

  // Collected data visibility state per geometry type
  private geomVisible: Record<GeometryType, boolean> = {
    Point: true,
    LineString: true,
    Polygon: true,
  };

  // Export state
  private exportFeatures: FieldFeature[] = [];
  private exportSelectedDates = new Set<string>(['all']);
  private exportSpatialFilter: 'all' | 'extent' = 'all';

  constructor(
    private importManager: ImportManager,
    private exportManager: ExportManager,
    private getMapBounds: () => MapBounds | null = () => null,
    private presetManager?: PresetManager,
    private onGeomVisibilityChange?: (geom: GeometryType, visible: boolean) => void,
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
    const settings = await this.storage.getAppSettings();
    if (settings.map_bg_color) this.mapBgColor = settings.map_bg_color;
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:15px;height:15px;margin-right:6px;vertical-align:-2px"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
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

  private renderCollectedDataSection(): string {
    const presets = this.presetManager?.getPresets() ?? [];
    const geomDefs: Array<{ geom: GeometryType; label: string; icon: string }> = [
      { geom: 'Point',      label: 'Points',   icon: '<circle cx="12" cy="12" r="7" fill="currentColor"/>' },
      { geom: 'LineString', label: 'Lines',    icon: '<polyline points="3,18 9,7 15,13 21,6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' },
      { geom: 'Polygon',    label: 'Polygons', icon: '<polygon points="12,3 21,9 18,20 6,20 3,9" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1.5"/>' },
    ];

    return `
      <div class="collected-section">
        <div class="collected-section-title">Collected Features</div>
        ${geomDefs.map(({ geom, label, icon }) => {
          const visiblePresets = presets.filter(p =>
            p.geometry_type === geom || p.geometry_type === 'all'
          );
          const visible = this.geomVisible[geom];
          const swatchFor = (p: TypePreset) =>
            geom === 'LineString' ? renderLineSwatchDataUrl(p, 20)
            : geom === 'Polygon'  ? renderPolygonSwatchDataUrl(p, 20)
            : renderSwatchDataUrl(p, 20);
          return `
          <div class="collected-layer-row" data-geom="${geom}">
            <button class="layer-vis-btn collected-vis-btn ${visible ? 'active' : ''}" data-geom="${geom}" title="Toggle ${label}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <svg class="collected-geom-icon" viewBox="0 0 24 24" width="18" height="18">${icon}</svg>
            <span class="collected-label">${label}</span>
            <div class="collected-presets">
              ${visiblePresets.map(p => `
                <button class="collected-preset-swatch" data-preset-id="${p.id}" title="${p.label} — click to edit style">
                  <img src="${swatchFor(p)}" width="20" height="20" alt="${p.label}" />
                </button>
              `).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  private renderMapSettingsSection(): string {
    return `
      <div class="collected-section" style="margin-top:10px">
        <div class="collected-section-title">Map Display</div>
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--color-text-dim)">
            <span>Background Color</span>
            <input type="color" id="map-bg-color-input" value="${this.mapBgColor}"
              style="width:32px;height:22px;border:1px solid rgba(91,175,130,0.3);border-radius:4px;cursor:pointer;background:none;padding:1px 2px" />
          </label>
          <span id="map-bg-color-value" style="font-size:11px;color:var(--color-text-muted)">${this.mapBgColor}</span>
        </div>
      </div>
    `;
  }

  private renderLayersTab(): string {
    const importedSection = this.importedLayers.length === 0
      ? '<p class="empty-state" style="margin-top:8px">No imported layers. Use Import tab to add data.</p>'
      : `<div id="imported-layers-list">
        ${this.importedLayers.map(l => {
          const fields = this.getFieldNames(l);
          return `
          <div class="layer-row" data-id="${l.id}">
            <div class="layer-row-main">
              <button class="layer-vis-btn ${l.visible ? 'active' : ''}" data-id="${l.id}" title="Toggle visibility">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>
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
      </div>`;

    return `
      ${this.renderCollectedDataSection()}
      ${this.renderMapSettingsSection()}
      <div class="imported-section-title" style="margin-top:14px">Imported Layers</div>
      ${importedSection}
    `;
  }

  // ── Import tab ───────────────────────────────────────────

  private renderImportTab(): string {
    return `
      <div class="import-section">
        <h4>Import Vector Data</h4>
        <p class="settings-hint">Supported: GeoJSON, KML, GPX, Shapefile (.shp or .zip)</p>
        <button class="btn-primary" id="import-vector-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:16px;height:16px;margin-right:6px"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
          Choose Vector File(s)
        </button>

        <h4 style="margin-top:20px">Import Raster Tiles</h4>
        <p class="settings-hint">MBTiles (.mbtiles) — offline tile packages. File is cached locally.</p>
        <button class="btn-outline" id="import-mbtiles-btn">Choose MBTiles File</button>

        <h4 style="margin-top:20px">GeoPDF Map</h4>
        <p class="settings-hint">Georeferenced PDF maps are overlaid directly on the map.</p>
        <button class="btn-outline" id="import-geopdf-btn">Import GeoPDF</button>

        <div class="import-drag-area" id="drag-drop-area">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:40px;height:40px;opacity:0.4"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
          <p>Or drag &amp; drop files here</p>
        </div>
      </div>
    `;
  }

  // ── Tab wiring ───────────────────────────────────────────

  private wireTab(): void {
    if (this.activeTab === 'layers') {
      // Map background color picker
      const bgInput = this.panel.querySelector<HTMLInputElement>('#map-bg-color-input');
      const bgValue = this.panel.querySelector<HTMLElement>('#map-bg-color-value');
      bgInput?.addEventListener('input', async () => {
        const color = bgInput.value;
        this.mapBgColor = color;
        if (bgValue) bgValue.textContent = color;
        EventBus.emit('map-background-color', { color });
        const settings = await this.storage.getAppSettings();
        settings.map_bg_color = color;
        await this.storage.saveAppSettings(settings);
      });

      // Collected data: geometry visibility toggles
      this.panel.querySelectorAll<HTMLButtonElement>('.collected-vis-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const geom = btn.dataset.geom as GeometryType;
          if (!geom) return;
          this.geomVisible[geom] = !this.geomVisible[geom];
          btn.classList.toggle('active', this.geomVisible[geom]);
          this.onGeomVisibilityChange?.(geom, this.geomVisible[geom]);
        });
      });

      // Collected data: preset swatch → open StylePicker
      this.panel.querySelectorAll<HTMLButtonElement>('.collected-preset-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          const presetId = btn.dataset.presetId;
          const preset = this.presetManager?.getPreset(presetId ?? '');
          if (!preset || !this.presetManager) return;
          this.stylePicker.open(preset, async (updated: TypePreset) => {
            Object.assign(preset, updated);
            await StorageManager.getInstance().saveTypePreset(preset);
            const idx = this.presetManager!.getPresets().findIndex((p: TypePreset) => p.id === preset.id);
            if (idx >= 0) this.presetManager!.getPresets()[idx] = preset;
            EventBus.emit('presets-changed', {});
            // Re-render to refresh swatches
            if (this.isOpen) this.render();
          });
        });
      });

      // Imported layer visibility toggles
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
