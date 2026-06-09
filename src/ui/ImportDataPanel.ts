import { v4 as uuidv4 } from 'uuid';
import type { ImportedLayer, SavedConnection, OnlineLayer, ProjectBundle } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { MapManager } from '../map/MapManager';
import type { ImportManager } from '../io/ImportManager';

type TabId = 'file' | 'service' | 'cog' | 'xyz' | 'bundle';

export class ImportDataPanel {
  private panel = document.getElementById('import-panel')!;
  private isOpen = false;
  private connections: SavedConnection[] = [];
  private onlineLayers: OnlineLayer[] = [];
  private storage = StorageManager.getInstance();
  private activeTab: TabId = 'file';
  private fileInput!: HTMLInputElement;

  constructor(
    private importManager: ImportManager,
    private mapManager: MapManager,
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
        await this.importManager.importFile(file);
      }
      this.fileInput.value = '';
    });
  }

  async init(): Promise<void> {
    this.connections = await this.storage.getAllConnections();
    this.onlineLayers = await this.storage.getAllOnlineLayers();
    // Reload persistent online layers onto map
    for (const layer of this.onlineLayers) {
      const tileUrl = layer.tileUrl;
      if (layer.visible && tileUrl) {
        this.mapManager.addRasterLayer(layer.map_layer_id, tileUrl, layer.opacity);
      }
    }
    // Reload imported file layers onto map
    const importedLayers = await this.storage.getAllImportedLayers();
    for (const layer of importedLayers) {
      if (layer.visible) this.importManager.renderImportedLayer(layer);
    }
  }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

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

  /** Renders the import UI into an arbitrary container (for embedding in the Data Library). */
  renderToContainer(container: HTMLElement): void {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'file', label: 'File' },
      { id: 'service', label: 'Service' },
      { id: 'cog', label: 'COG' },
      { id: 'xyz', label: 'XYZ Tiles' },
      { id: 'bundle', label: 'Bundle' },
    ];
    container.innerHTML = `
      <div class="dl-io-view">
        <div class="tab-bar">
          ${tabs.map(t => `<button class="tab-btn ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div class="dl-io-tab-content">
          ${this.renderTab(this.activeTab)}
        </div>
      </div>`;
    container.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as TabId;
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const content = container.querySelector<HTMLElement>('.dl-io-tab-content')!;
        content.innerHTML = this.renderTab(this.activeTab);
        this.wireTab(content);
      });
    });
    this.wireTab(container.querySelector<HTMLElement>('.dl-io-tab-content')!);
  }

  private render(): void {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'file', label: 'File' },
      { id: 'service', label: 'Service' },
      { id: 'cog', label: 'COG' },
      { id: 'xyz', label: 'XYZ Tiles' },
      { id: 'bundle', label: 'Bundle' },
    ];

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Import Data</h2>
          <button class="panel-close" id="import-close">✕</button>
        </div>
        <div class="panel-body">
          <div class="tab-bar">
            ${tabs.map(t => `<button class="tab-btn ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
          </div>
          <div id="import-tab-content">
            ${this.renderTab(this.activeTab)}
          </div>
        </div>
        <div class="panel-footer">
          <button class="panel-done-btn" id="import-done">Done</button>
        </div>
      </div>
    `;

    this.panel.querySelector('#import-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#import-done')?.addEventListener('click', () => this.close());

    this.panel.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as TabId;
        this.panel.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const content = this.panel.querySelector<HTMLElement>('#import-tab-content')!;
        content.innerHTML = this.renderTab(this.activeTab);
        this.wireTab(content);
      });
    });

    this.wireTab(this.panel.querySelector<HTMLElement>('#import-tab-content')!);
  }

  // ================================================================
  // Tab rendering
  // ================================================================
  private renderTab(tab: TabId): string {
    if (tab === 'file') return this.renderFileTab();
    if (tab === 'service') return this.renderServiceTab();
    if (tab === 'cog') return this.renderCOGTab();
    if (tab === 'bundle') return this.renderBundleTab();
    return this.renderXYZTab();
  }

  private renderBundleTab(): string {
    return `
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M253.66,133.66l-24,24a8,8,0,0,1-11.32-11.32L228.69,136H176a8,8,0,0,1,0-16h52.69l-10.35-10.34a8,8,0,0,1,11.32-11.32l24,24A8,8,0,0,1,253.66,133.66ZM176,192H48V64H176a8,8,0,0,0,0-16H48A16,16,0,0,0,32,64V192a16,16,0,0,0,16,16H176a8,8,0,0,0,0-16Z"/></svg>Import Project Bundle</h4>
        <p class="settings-hint">Open a <code>.fm2026</code> file shared by another user to receive their collected features, layer styles, and presets.</p>
        <button class="btn-primary" id="import-bundle-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:16px;height:16px;margin-right:6px"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
          Choose Bundle File (.fm2026)
        </button>
        <div id="bundle-status" class="bundle-status" style="display:none"></div>
      </div>
    `;
  }

  private renderFileTab(): string {
    return `
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM112,168a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm0-120H96V40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8Z"/></svg>Vector Data</h4>
        <p class="settings-hint">GeoJSON, KML, GPX, Shapefile (.shp or .zip)</p>
        <button class="btn-primary" id="import-vector-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:16px;height:16px;margin-right:6px"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
          Choose Vector File(s)
        </button>
      </div>

      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M216,56v60a4,4,0,0,1-4,4H136V44a4,4,0,0,1,4-4h60A16,16,0,0,1,216,56ZM116,40H56A16,16,0,0,0,40,56v60a4,4,0,0,0,4,4h76V44A4,4,0,0,0,116,40Zm96,96H136v76a4,4,0,0,0,4,4h60a16,16,0,0,0,16-16V140A4,4,0,0,0,212,136ZM40,140v60a16,16,0,0,0,16,16h60a4,4,0,0,0,4-4V136H44A4,4,0,0,0,40,140Z"/></svg>Raster Tiles</h4>
        <p class="settings-hint">MBTiles (.mbtiles) — offline tile packages, cached locally.</p>
        <button class="btn-outline" id="import-mbtiles-btn">Choose MBTiles File</button>
      </div>

      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,176H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm-8-56V44l44,44Z"/></svg>GeoPDF Map</h4>
        <p class="settings-hint">Georeferenced PDF maps overlaid directly on the map.</p>
        <button class="btn-outline" id="import-geopdf-btn">Import GeoPDF</button>
      </div>

      <div class="import-drag-area" id="import-drag-area">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:40px;height:40px;opacity:0.4"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
        <p>Or drag &amp; drop files here</p>
      </div>
    `;
  }

  private renderServiceTab(): string {
    const savedConns = this.connections.filter(c => c.type !== 'cog' && c.type !== 'xyz');
    return `
      <div class="online-add-form settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm78.36,64H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM216,128a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM128,43a115.27,115.27,0,0,1,26,45H102A115.11,115.11,0,0,1,128,43ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48Zm50.35,61.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z"/></svg>Add Web Service Layer</h4>
        <p class="settings-hint">Enter any WMS, WMTS, WFS, WCS, or ESRI REST URL — type is auto-detected.</p>
        <label>Service URL
          <input type="url" id="service-url" placeholder="https://example.com/wms?service=WMS&request=GetCapabilities" />
        </label>
        <button class="btn-primary" id="btn-detect">Detect &amp; Browse</button>
        <div id="service-browse-result" class="service-browse-result"></div>
      </div>
      ${savedConns.length > 0 ? `
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32ZM132.23,177.22a8,8,0,0,0-8.48,0L72,209.57V180.43l56-35,56,35v29.14Z"/></svg>Saved Connections</h4>
        ${this.renderGroupedConnections(savedConns)}
      </div>` : ''}
    `;
  }

  private renderGroupedConnections(conns: SavedConnection[]): string {
    const ungrouped = conns.filter(c => !c.group);
    const groupNames = [...new Set(conns.filter(c => c.group).map(c => c.group!))].sort();
    let html = '';
    if (ungrouped.length) html += ungrouped.map(c => this.renderConnectionRow(c)).join('');
    for (const g of groupNames) {
      const items = conns.filter(c => c.group === g);
      html += `
        <div class="conn-group-header">
          <span class="conn-group-title">${g}</span>
          <span class="conn-group-count">${items.length}</span>
        </div>
        <div class="conn-group-body">
          ${items.map(c => this.renderConnectionRow(c)).join('')}
        </div>`;
    }
    return html;
  }

  private renderConnectionRow(c: SavedConnection): string {
    return `
      <div class="connection-row" data-id="${c.id}" data-url="${encodeURIComponent(c.url)}" data-type="${c.type}">
        <div class="conn-row-view">
          <button class="conn-expand-btn btn-sm" data-id="${c.id}" title="Browse layers">
            <svg class="conn-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <span class="conn-name">${c.name}</span>
          <div class="conn-actions">
            <button class="conn-rename-btn btn-sm" data-id="${c.id}" title="Rename">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="conn-del-btn btn-sm btn-danger" data-id="${c.id}">✕</button>
          </div>
        </div>
        <div class="conn-row-edit" style="display:none">
          <input class="conn-name-input" type="text" value="${c.name.replace(/"/g, '&quot;')}" />
          <button class="conn-save-name btn-sm btn-primary" data-id="${c.id}">Save</button>
          <button class="conn-cancel-name btn-sm" data-id="${c.id}">Cancel</button>
        </div>
        <div class="conn-layers-panel" style="display:none" data-loaded="false"></div>
      </div>`;
  }

  private renderCOGTab(): string {
    const cogConns = this.connections.filter(c => c.type === 'cog');
    return `
      <div class="online-add-form settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M160.06,40A88.1,88.1,0,0,0,81.29,88.67h0A87.48,87.48,0,0,0,72,127.73,8.18,8.18,0,0,1,64.57,136,8,8,0,0,1,56,128a103.66,103.66,0,0,1,5.34-32.92,4,4,0,0,0-4.75-5.18A64.09,64.09,0,0,0,8,152c0,35.19,29.75,64,65,64H160a88.09,88.09,0,0,0,87.93-91.48C246.11,77.54,207.07,40,160.06,40Z"/></svg>Cloud-Optimized GeoTIFF (COG)</h4>
        <p class="settings-hint">Direct URL to a .tif COG file. Reads via HTTP range requests.</p>
        <label>COG URL
          <input type="url" id="cog-url" placeholder="https://example.com/data.tif" />
        </label>
        <label>Layer Name
          <input type="text" id="cog-name" placeholder="My COG Layer" />
        </label>
        <div class="btn-group">
          <button class="btn-primary" id="btn-add-cog">Add COG Layer</button>
          <button class="btn-outline" id="btn-save-cog">Save Connection</button>
        </div>
        <p class="settings-hint" style="color:var(--color-warn)">COG must be in EPSG:4326 or EPSG:3857 with CORS enabled.</p>
      </div>
      ${cogConns.length > 0 ? `
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32ZM132.23,177.22a8,8,0,0,0-8.48,0L72,209.57V180.43l56-35,56,35v29.14Z"/></svg>Saved COG Connections</h4>
        ${cogConns.map(c => `
          <div class="connection-row" data-id="${c.id}">
            <span class="conn-name">${c.name}</span>
            <div class="conn-actions">
              <button class="conn-load-btn btn-sm" data-id="${c.id}" data-url="${c.url}" data-type="cog" data-name="${c.name}">Load</button>
              <button class="conn-del-btn btn-sm btn-danger" data-id="${c.id}">✕</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
    `;
  }

  private renderXYZTab(): string {
    const xyzConns = this.connections.filter(c => c.type === 'xyz');
    return `
      <div class="online-add-form settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M216,56v60a4,4,0,0,1-4,4H136V44a4,4,0,0,1,4-4h60A16,16,0,0,1,216,56ZM116,40H56A16,16,0,0,0,40,56v60a4,4,0,0,0,4,4h76V44A4,4,0,0,0,116,40Zm96,96H136v76a4,4,0,0,0,4,4h60a16,16,0,0,0,16-16V140A4,4,0,0,0,212,136ZM40,140v60a16,16,0,0,0,16,16h60a4,4,0,0,0,4-4V136H44A4,4,0,0,0,40,140Z"/></svg>XYZ Tile Layer</h4>
        <p class="settings-hint">Tile URL template with {z}, {x}, {y} placeholders.</p>
        <label>Tile URL Template
          <input type="url" id="xyz-url" placeholder="https://tiles.example.com/{z}/{x}/{y}.png" />
        </label>
        <label>Layer Name
          <input type="text" id="xyz-name" placeholder="My Tile Layer" />
        </label>
        <div class="btn-group">
          <button class="btn-primary" id="btn-add-xyz">Add XYZ Layer</button>
          <button class="btn-outline" id="btn-save-xyz">Save Connection</button>
        </div>
      </div>
      ${xyzConns.length > 0 ? `
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32ZM132.23,177.22a8,8,0,0,0-8.48,0L72,209.57V180.43l56-35,56,35v29.14Z"/></svg>Saved XYZ Connections</h4>
        ${xyzConns.map(c => `
          <div class="connection-row" data-id="${c.id}">
            <span class="conn-name">${c.name}</span>
            <div class="conn-actions">
              <button class="conn-load-btn btn-sm" data-id="${c.id}" data-url="${c.url}" data-type="xyz" data-name="${c.name}">Load</button>
              <button class="conn-del-btn btn-sm btn-danger" data-id="${c.id}">✕</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
    `;
  }

  // ================================================================
  // Tab wiring
  // ================================================================
  private wireTab(container: HTMLElement): void {
    // ---- File tab ----
    container.querySelector('#import-vector-btn')?.addEventListener('click', () => {
      this.fileInput.accept = '.geojson,.json,.kml,.gpx,.shp,.zip';
      this.fileInput.click();
    });
    container.querySelector('#import-mbtiles-btn')?.addEventListener('click', () => {
      this.fileInput.accept = '.mbtiles';
      this.fileInput.click();
    });
    container.querySelector('#import-geopdf-btn')?.addEventListener('click', () => {
      this.fileInput.accept = '.pdf';
      this.fileInput.click();
    });
    const dropArea = container.querySelector<HTMLElement>('#import-drag-area');
    dropArea?.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea?.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
    dropArea?.addEventListener('drop', async e => {
      e.preventDefault();
      dropArea.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        await this.importManager.importFile(file);
      }
    });

    // ---- Bundle tab ----
    container.querySelector('#import-bundle-btn')?.addEventListener('click', () => {
      const bundleInput = document.createElement('input');
      bundleInput.type = 'file';
      bundleInput.accept = '.fm2026,.json';
      bundleInput.style.display = 'none';
      document.body.appendChild(bundleInput);
      bundleInput.addEventListener('change', async () => {
        const file = bundleInput.files?.[0];
        document.body.removeChild(bundleInput);
        if (!file) return;
        const statusEl = container.querySelector<HTMLElement>('#bundle-status');
        if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Reading file…'; }
        try {
          const text = await file.text();
          const bundle = JSON.parse(text) as ProjectBundle;
          if (bundle.format !== 'fm2026-bundle') throw new Error('Not a valid .fm2026 bundle file.');
          const exportedDate = new Date(bundle.exported_at).toLocaleString();
          if (statusEl) statusEl.style.display = 'none';
          EventBus.emit('show-modal', {
            title: 'Import Project Bundle',
            html: `
              <div class="bundle-import-summary">
                <strong>${bundle.bundle_name}</strong>
                <div class="bundle-import-meta">
                  ${bundle.features.length} feature${bundle.features.length !== 1 ? 's' : ''}
                  &nbsp;·&nbsp; ${bundle.layer_presets.length} layer${bundle.layer_presets.length !== 1 ? 's' : ''}
                  &nbsp;·&nbsp; ${bundle.type_presets.length} type${bundle.type_presets.length !== 1 ? 's' : ''}
                </div>
                <div class="bundle-import-date">Exported ${exportedDate}</div>
              </div>
              <div class="bundle-import-actions">
                <button id="bundle-import-new" class="btn btn-primary" style="width:100%;margin-bottom:8px">
                  Create as new project
                </button>
                <button id="bundle-import-merge" class="btn btn-outline" style="width:100%">
                  Merge into current project
                </button>
              </div>`,
          });
          requestAnimationFrame(() => {
            const closeModal = () => document.getElementById('modal-cancel')?.click();
            document.getElementById('bundle-import-new')?.addEventListener('click', () => {
              EventBus.emit('import-project-bundle', { bundle, mode: 'new' });
              closeModal();
            });
            document.getElementById('bundle-import-merge')?.addEventListener('click', () => {
              EventBus.emit('import-project-bundle', { bundle, mode: 'merge' });
              closeModal();
            });
          });
        } catch (err) {
          if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = `Error: ${(err as Error).message}`; }
        }
      });
      bundleInput.click();
    });

    // ---- Service tab ----
    container.querySelector('#btn-detect')?.addEventListener('click', () => {
      const url = container.querySelector<HTMLInputElement>('#service-url')?.value.trim() ?? '';
      if (url) void this.detectAndBrowseService(url, container);
    });
    container.querySelector<HTMLInputElement>('#service-url')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const url = container.querySelector<HTMLInputElement>('#service-url')?.value.trim() ?? '';
        if (url) void this.detectAndBrowseService(url, container);
      }
    });

    // Saved connection expand/collapse
    container.querySelectorAll<HTMLButtonElement>('.conn-expand-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest<HTMLElement>('.connection-row')!;
        const layersPanel = row.querySelector<HTMLElement>('.conn-layers-panel')!;
        const isOpen = layersPanel.style.display !== 'none';
        if (isOpen) {
          layersPanel.style.display = 'none';
          btn.querySelector('.conn-expand-icon')?.setAttribute('transform', '');
          return;
        }
        layersPanel.style.display = 'block';
        btn.querySelector('.conn-expand-icon')?.setAttribute('transform', 'rotate(90,12,12)');
        if (layersPanel.dataset.loaded === 'true') return;
        const url = decodeURIComponent(row.dataset.url!);
        const type = row.dataset.type!;
        layersPanel.innerHTML = '<div class="conn-layers-loading">Loading layers…</div>';
        try {
          let html = '';
          if (type === 'wms') html = await this.browseWMS(url);
          else if (type === 'wmts') html = await this.browseWMTS(url);
          else if (type === 'wfs') html = await this.browseWFS(url);
          else if (type === 'esri-rest') html = await this.browseESRIRest(url);
          else html = '<div class="conn-layers-hint">No layer browser for this type.</div>';
          layersPanel.innerHTML = html;
          layersPanel.dataset.loaded = 'true';
          this.wireLayerPanel(layersPanel, url);
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          layersPanel.innerHTML = `
            <div class="conn-layers-error">
              <span>Failed: ${msg}</span>
              <button class="conn-layers-retry btn-sm">Retry</button>
            </div>`;
          layersPanel.querySelector('.conn-layers-retry')?.addEventListener('click', () => {
            layersPanel.dataset.loaded = 'false';
            btn.click();
          });
        }
      });
    });

    // Delete saved connection
    container.querySelectorAll<HTMLButtonElement>('.conn-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await this.storage.deleteConnection(btn.dataset.id!);
        this.connections = this.connections.filter(c => c.id !== btn.dataset.id);
        this.render();
      });
    });

    // Rename saved connection
    container.querySelectorAll<HTMLButtonElement>('.conn-rename-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('.connection-row')!;
        row.querySelector<HTMLElement>('.conn-row-view')!.style.display = 'none';
        row.querySelector<HTMLElement>('.conn-row-edit')!.style.display = 'flex';
        row.querySelector<HTMLInputElement>('.conn-name-input')?.focus();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('.conn-cancel-name').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('.connection-row')!;
        row.querySelector<HTMLElement>('.conn-row-view')!.style.display = 'flex';
        row.querySelector<HTMLElement>('.conn-row-edit')!.style.display = 'none';
      });
    });
    container.querySelectorAll<HTMLButtonElement>('.conn-save-name').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id!;
        const row = btn.closest<HTMLElement>('.connection-row')!;
        const newName = row.querySelector<HTMLInputElement>('.conn-name-input')?.value.trim();
        if (!newName) return;
        const conn = this.connections.find(c => c.id === id);
        if (!conn) return;
        conn.name = newName;
        await this.storage.saveConnection(conn);
        row.querySelector<HTMLElement>('.conn-name')!.textContent = newName;
        row.querySelector<HTMLElement>('.conn-row-view')!.style.display = 'flex';
        row.querySelector<HTMLElement>('.conn-row-edit')!.style.display = 'none';
        EventBus.emit('toast', { message: 'Renamed', type: 'success', duration: 1500 });
      });
    });
    container.querySelectorAll<HTMLInputElement>('.conn-name-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.closest<HTMLElement>('.connection-row')?.querySelector<HTMLButtonElement>('.conn-save-name')?.click();
        else if (e.key === 'Escape') input.closest<HTMLElement>('.connection-row')?.querySelector<HTMLButtonElement>('.conn-cancel-name')?.click();
      });
    });

    // COG tab
    container.querySelector('#btn-add-cog')?.addEventListener('click', () => {
      const url = container.querySelector<HTMLInputElement>('#cog-url')?.value.trim() ?? '';
      const name = container.querySelector<HTMLInputElement>('#cog-name')?.value.trim() || 'COG Layer';
      if (url) this.addCOGLayer(name, url);
    });
    container.querySelector('#btn-save-cog')?.addEventListener('click', async () => {
      const url = container.querySelector<HTMLInputElement>('#cog-url')?.value.trim() ?? '';
      const name = container.querySelector<HTMLInputElement>('#cog-name')?.value.trim() || url;
      if (!url) return;
      await this.saveConn({ id: uuidv4(), name, type: 'cog', url, added_at: new Date().toISOString() });
    });

    // XYZ tab
    container.querySelector('#btn-add-xyz')?.addEventListener('click', () => {
      const url = container.querySelector<HTMLInputElement>('#xyz-url')?.value.trim() ?? '';
      const name = container.querySelector<HTMLInputElement>('#xyz-name')?.value.trim() || 'XYZ Layer';
      if (url) this.addXYZLayer(name, url);
    });
    container.querySelector('#btn-save-xyz')?.addEventListener('click', async () => {
      const url = container.querySelector<HTMLInputElement>('#xyz-url')?.value.trim() ?? '';
      const name = container.querySelector<HTMLInputElement>('#xyz-name')?.value.trim() || url;
      if (!url) return;
      await this.saveConn({ id: uuidv4(), name, type: 'xyz', url, added_at: new Date().toISOString() });
    });

    // Load saved COG/XYZ connections
    container.querySelectorAll<HTMLButtonElement>('.conn-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type!;
        const url = btn.dataset.url!;
        const name = btn.dataset.name || 'Layer';
        if (type === 'cog') this.addCOGLayer(name, url);
        else if (type === 'xyz') this.addXYZLayer(name, url);
      });
    });
  }

  private wireLayerPanel(panel: HTMLElement, serviceUrl: string): void {
    panel.querySelectorAll<HTMLButtonElement>('.svc-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tileUrl = btn.dataset.tileUrl!;
        const displayName = btn.dataset.displayName || btn.dataset.layer || 'Layer';
        this.addTileLayer(displayName, tileUrl);
      });
    });
    panel.querySelectorAll<HTMLButtonElement>('.wfs-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const baseUrl = btn.dataset.base!;
        const typeName = btn.dataset.type!;
        const name = btn.dataset.name || typeName;
        const geoJsonUrl = `${baseUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=${encodeURIComponent(typeName)}&outputFormat=application/json`;
        btn.textContent = 'Loading…';
        btn.disabled = true;
        try {
          const resp = await fetch(geoJsonUrl);
          const geojson = await resp.json();
          this.mapManager.addGeoJSONLayer(name, geojson, '#4ade80');
          EventBus.emit('toast', { message: `Added WFS: ${name}`, type: 'success' });
        } catch (err) {
          EventBus.emit('toast', { message: `WFS failed: ${(err as Error).message}`, type: 'error' });
        } finally {
          btn.textContent = 'Add';
          btn.disabled = false;
        }
      });
    });
    const manualBtn = panel.querySelector<HTMLButtonElement>('#btn-manual-add');
    if (manualBtn) {
      manualBtn.addEventListener('click', () => {
        const layerName = panel.querySelector<HTMLInputElement>('#manual-layer-name')?.value.trim() ?? '';
        const tileUrl = this.buildWMSTileUrl(serviceUrl, layerName);
        this.addTileLayer(layerName || 'Layer', tileUrl);
      });
    }
  }

  // ================================================================
  // Service detection + browsing
  // ================================================================
  private async detectAndBrowseService(url: string, container: HTMLElement): Promise<void> {
    const resultEl = container.querySelector<HTMLElement>('#service-browse-result');
    if (!resultEl) return;
    resultEl.innerHTML = '<div class="service-detecting">Detecting service type…</div>';
    try {
      const type = this.detectServiceType(url);
      resultEl.innerHTML = `<div class="service-type-badge">Detected: <strong>${type.toUpperCase()}</strong></div><div class="service-loading">Loading capabilities…</div>`;
      let html = '';
      if (type === 'wms') html = await this.browseWMS(url);
      else if (type === 'wmts') html = await this.browseWMTS(url);
      else if (type === 'wfs') html = await this.browseWFS(url);
      else if (type === 'esri-rest') html = await this.browseESRIRest(url);
      else if (type === 'wcs') html = `<div class="service-hint">WCS detected. Enter coverage name below.</div>${this.renderManualWMSForm(url)}`;
      else html = this.renderManualWMSForm(url);
      resultEl.innerHTML = `
        <div class="service-type-badge">Service: <strong>${type.toUpperCase()}</strong>
          <button class="btn-sm btn-outline" id="btn-save-service">Save Connection</button>
        </div>${html}`;
      resultEl.querySelector('#btn-save-service')?.addEventListener('click', async () => {
        const name = url.split('/').pop()?.split('?')[0] || 'Service';
        await this.saveConn({ id: uuidv4(), name, type: type as never, url, added_at: new Date().toISOString() });
      });
      resultEl.querySelectorAll<HTMLButtonElement>('.svc-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tileUrl = btn.dataset.tileUrl!;
          const displayName = btn.dataset.displayName || btn.dataset.layer || 'Layer';
          this.addTileLayer(displayName, tileUrl);
        });
      });
      resultEl.querySelector<HTMLButtonElement>('#btn-manual-add')?.addEventListener('click', () => {
        const layerName = resultEl.querySelector<HTMLInputElement>('#manual-layer-name')?.value.trim() ?? '';
        const tileUrl = this.buildWMSTileUrl(url, layerName);
        this.addTileLayer(layerName || 'Layer', tileUrl);
      });
    } catch (err) {
      resultEl.innerHTML = `
        <div class="service-error">Failed: ${(err as Error).message}</div>
        ${this.renderManualWMSForm(url)}`;
      resultEl.querySelector<HTMLButtonElement>('#btn-manual-add')?.addEventListener('click', () => {
        const layerName = resultEl.querySelector<HTMLInputElement>('#manual-layer-name')?.value.trim() ?? '';
        const tileUrl = this.buildWMSTileUrl(url, layerName);
        this.addTileLayer(layerName || 'Layer', tileUrl);
      });
    }
  }

  private detectServiceType(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('service=wms') || lower.includes('wms')) return 'wms';
    if (lower.includes('wmtscapabilities') || lower.includes('service=wmts')) return 'wmts';
    if (lower.includes('service=wfs') || lower.includes('wfs')) return 'wfs';
    if (lower.includes('service=wcs') || lower.includes('wcs')) return 'wcs';
    if (lower.includes('/rest/services') || lower.includes('mapserver') || lower.includes('featureserver')) return 'esri-rest';
    if (lower.includes('.tif') || lower.includes('.tiff')) return 'cog';
    if (lower.includes('{z}') || lower.includes('{x}') || lower.includes('{y}')) return 'xyz';
    return 'wms';
  }

  private async browseWMS(url: string): Promise<string> {
    const baseUrl = url.split('?')[0];
    const resp = await fetch(`${baseUrl}?SERVICE=WMS&REQUEST=GetCapabilities`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = new DOMParser().parseFromString(await resp.text(), 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('Invalid XML');
    const layers: { name: string; title: string }[] = [];
    for (const el of Array.from(xml.getElementsByTagName('Layer'))) {
      const nameEl = Array.from(el.childNodes).find(n => n.nodeName === 'Name' || n.nodeName === 'wms:Name');
      const titleEl = Array.from(el.childNodes).find(n => n.nodeName === 'Title' || n.nodeName === 'wms:Title');
      const name = nameEl?.textContent?.trim();
      const title = titleEl?.textContent?.trim();
      if (name) layers.push({ name, title: title || name });
    }
    if (layers.length === 0) return this.renderManualWMSForm(baseUrl);
    return `<div class="service-layer-list"><p class="settings-hint">${layers.length} layer(s) found.</p>
      ${layers.map(l => `
        <div class="service-layer-row">
          <div class="service-layer-info"><span class="service-layer-name">${l.title}</span><span class="service-layer-id">${l.name}</span></div>
          <button class="svc-add-btn btn-sm btn-primary" data-layer="${l.name}" data-display-name="${l.title.replace(/"/g, '&quot;')}" data-tile-url="${this.buildWMSTileUrl(baseUrl, l.name)}">Add</button>
        </div>`).join('')}
    </div>`;
  }

  private async browseWMTS(url: string): Promise<string> {
    const capUrl = url.includes('WMTSCapabilities') ? url : `${url.split('?')[0]}?SERVICE=WMTS&REQUEST=GetCapabilities`;
    const resp = await fetch(capUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = new DOMParser().parseFromString(await resp.text(), 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('Invalid XML');
    const layers: { id: string; title: string; tms: string }[] = [];
    for (const el of Array.from(xml.getElementsByTagName('Layer'))) {
      const idEl = el.getElementsByTagName('ows:Identifier')[0] ?? el.getElementsByTagName('Identifier')[0];
      const titleEl = el.getElementsByTagName('ows:Title')[0] ?? el.getElementsByTagName('Title')[0];
      const tmsEl = el.getElementsByTagName('TileMatrixSet')[0];
      const id = idEl?.textContent?.trim();
      if (id) layers.push({ id, title: titleEl?.textContent?.trim() || id, tms: tmsEl?.textContent?.trim() ?? 'WebMercatorQuad' });
    }
    const baseUrl = url.split('?')[0].replace('WMTSCapabilities.xml', '');
    if (layers.length === 0) return this.renderManualWMSForm(url);
    return `<div class="service-layer-list">
      ${layers.map(l => {
        const tileUrl = `${baseUrl}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(l.id)}&STYLE=default&TILEMATRIXSET=${l.tms}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`;
        return `<div class="service-layer-row">
          <div class="service-layer-info"><span class="service-layer-name">${l.title}</span><span class="service-layer-id">${l.id}</span></div>
          <button class="svc-add-btn btn-sm btn-primary" data-layer="${l.id}" data-display-name="${l.title.replace(/"/g, '&quot;')}" data-tile-url="${tileUrl}">Add</button>
        </div>`;
      }).join('')}
    </div>`;
  }

  private async browseWFS(url: string): Promise<string> {
    const baseUrl = url.split('?')[0];
    const resp = await fetch(`${baseUrl}?service=WFS&version=2.0.0&request=GetCapabilities`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = new DOMParser().parseFromString(await resp.text(), 'text/xml');
    if (xml.querySelector('parsererror')) throw new Error('Invalid XML');
    const types: { name: string; title: string }[] = [];
    for (const el of Array.from(xml.getElementsByTagName('FeatureType'))) {
      const name = (el.getElementsByTagName('Name')[0] ?? el.getElementsByTagName('wfs:Name')[0])?.textContent?.trim();
      const title = (el.getElementsByTagName('Title')[0] ?? el.getElementsByTagName('wfs:Title')[0])?.textContent?.trim();
      if (name) types.push({ name, title: title || name });
    }
    return `<div class="service-layer-list"><p class="settings-hint">${types.length} feature type(s). Loaded as GeoJSON.</p>
      ${types.map(t => `
        <div class="service-layer-row">
          <div class="service-layer-info"><span class="service-layer-name">${t.title}</span><span class="service-layer-id">${t.name}</span></div>
          <button class="wfs-add-btn btn-sm btn-primary" data-base="${baseUrl}" data-type="${t.name}" data-name="${t.title.replace(/"/g, '&quot;')}">Add</button>
        </div>`).join('')}
    </div>`;
  }

  private async browseESRIRest(url: string): Promise<string> {
    const baseUrl = url.split('?')[0];
    const data = await (await fetch(`${baseUrl}?f=json`)).json() as { layers?: { id: number; name: string }[]; name?: string };
    if (data.layers?.length) {
      return `<div class="service-layer-list">
        ${data.layers.map(l => `
          <div class="service-layer-row">
            <div class="service-layer-info"><span class="service-layer-name">${l.name}</span><span class="service-layer-id">ID: ${l.id}</span></div>
            <button class="svc-add-btn btn-sm btn-primary" data-layer="${l.id}" data-display-name="${l.name}" data-tile-url="${baseUrl}/${l.id}/tile/{z}/{y}/{x}">Add</button>
          </div>`).join('')}
      </div>`;
    }
    return `<div class="service-layer-row">
      <span class="service-layer-name">${data.name ?? 'ESRI Service'}</span>
      <button class="svc-add-btn btn-sm btn-primary" data-layer="0" data-display-name="${data.name ?? 'ESRI Service'}" data-tile-url="${baseUrl}/tile/{z}/{y}/{x}">Add</button>
    </div>`;
  }

  private renderManualWMSForm(baseUrl: string): string {
    return `<div class="manual-wms-form">
      <p class="settings-hint">Could not auto-detect layers. Enter layer name manually:</p>
      <label>Layer Name <input type="text" id="manual-layer-name" placeholder="e.g. 0 or layer_name" /></label>
      <button class="btn-primary" id="btn-manual-add">Add Layer</button>
    </div>`;
  }

  private buildWMSTileUrl(baseUrl: string, layerName: string): string {
    const base = baseUrl.split('?')[0];
    return `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(layerName)}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;
  }

  // ================================================================
  // Adding layers
  // ================================================================
  private addTileLayer(name: string, tileUrl: string): void {
    const layerId = `online-${uuidv4()}`;
    const layer: OnlineLayer = {
      id: layerId, connection_id: '', name, type: 'wms',
      visible: true, opacity: 0.9, blend_mode: 'normal', map_layer_id: layerId, tileUrl,
    };
    this.mapManager.addRasterLayer(layerId, tileUrl, 0.9);
    this.onlineLayers.push(layer);
    void this.storage.saveOnlineLayer(layer);
    EventBus.emit('toast', { message: `Added: ${name}`, type: 'success' });
  }

  private addCOGLayer(name: string, cogUrl: string): void {
    const layerId = `online-${uuidv4()}`;
    const tileUrl = `cog://${encodeURIComponent(cogUrl)}/{z}/{x}/{y}`;
    const layer: OnlineLayer = {
      id: layerId, connection_id: '', name, type: 'cog',
      visible: true, opacity: 1, blend_mode: 'normal', map_layer_id: layerId, tileUrl,
    };
    this.mapManager.addRasterLayer(layerId, tileUrl, 1);
    this.onlineLayers.push(layer);
    void this.storage.saveOnlineLayer(layer);
    EventBus.emit('toast', { message: `COG added: ${name}. Loading tiles…`, type: 'info' });
  }

  private addXYZLayer(name: string, tileUrl: string): void {
    const layerId = `online-${uuidv4()}`;
    const layer: OnlineLayer = {
      id: layerId, connection_id: '', name, type: 'xyz',
      visible: true, opacity: 0.9, blend_mode: 'normal', map_layer_id: layerId, tileUrl,
    };
    this.mapManager.addRasterLayer(layerId, tileUrl, 0.9);
    this.onlineLayers.push(layer);
    void this.storage.saveOnlineLayer(layer);
    EventBus.emit('toast', { message: `Added: ${name}`, type: 'success' });
  }

  private async saveConn(conn: SavedConnection): Promise<void> {
    await this.storage.saveConnection(conn);
    this.connections.push(conn);
    EventBus.emit('toast', { message: `Saved: ${conn.name}`, type: 'success' });
    this.render();
  }
}
