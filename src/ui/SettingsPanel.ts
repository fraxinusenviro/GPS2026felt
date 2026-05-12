import type { AppSettings } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { PresetManager } from './PresetManager';

export class SettingsPanel {
  private panel = document.getElementById('settings-panel')!;
  private isOpen = false;
  private settings!: AppSettings;
  private storage = StorageManager.getInstance();

  constructor(private presetManager: PresetManager) {
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.toggle();
    });

    // Close on overlay click
    this.panel?.addEventListener('click', (e) => {
      if (e.target === this.panel) this.close();
    });
  }

  async init(settings: AppSettings): Promise<void> {
    this.settings = { ...settings };
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.isOpen = true;
    this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
  }

  close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    setTimeout(() => {
      if (!this.isOpen) this.panel.style.display = 'none';
    }, 300);
  }

  private render(): void {
    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Settings</h2>
          <button class="panel-close" id="settings-close">✕</button>
        </div>
        <div class="panel-body settings-body">

          <!-- User Identity -->
          <div class="settings-section">
            <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z"/></svg>User Identity</h4>
            <label>User ID / Initials
              <input type="text" id="s-user-id" value="${this.settings.user_id}" maxlength="10" placeholder="e.g. IB" />
              <span class="settings-hint">Used in feature IDs, e.g. IB_2026_05_01_1241</span>
            </label>
          </div>

          <!-- GPS Capture -->
          <div class="settings-section">
            <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,16a88.1,88.1,0,0,0-88,88c0,75.3,80,132.17,83.41,134.55a8,8,0,0,0,9.18,0C136,236.17,216,179.3,216,104A88.1,88.1,0,0,0,128,16Zm0,56a32,32,0,1,1-32,32A32,32,0,0,1,128,72Z"/></svg>GPS Capture</h4>
            <label>Distance Tolerance (m)
              <input type="number" id="s-gps-dist" value="${this.settings.gps_distance_tolerance}" min="1" max="1000" step="1" />
              <span class="settings-hint">Minimum distance between streaming GPS points</span>
            </label>
            <label>Time Tolerance (s)
              <input type="number" id="s-gps-time" value="${this.settings.gps_time_tolerance}" min="1" max="300" step="1" />
              <span class="settings-hint">Minimum time interval between streaming GPS points</span>
            </label>
            <label>Min GPS Accuracy (m)
              <input type="number" id="s-gps-acc" value="${this.settings.gps_min_accuracy}" min="1" max="100" step="1" />
              <span class="settings-hint">Discard GPS fixes worse than this accuracy</span>
            </label>
          </div>

          <!-- Display -->
          <div class="settings-section">
            <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M232,64V176a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V64A24,24,0,0,1,48,40H208A24,24,0,0,1,232,64ZM160,216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Z"/></svg>Display</h4>
            <label>Coordinate Format
              <select id="s-coord-fmt">
                <option value="dd" ${this.settings.coord_format === 'dd' ? 'selected' : ''}>Decimal Degrees</option>
                <option value="dms" ${this.settings.coord_format === 'dms' ? 'selected' : ''}>DMS</option>
                <option value="utm" ${this.settings.coord_format === 'utm' ? 'selected' : ''}>UTM</option>
              </select>
            </label>
            <label class="toggle-label">
              <span>Show Crosshair</span>
              <input type="checkbox" id="s-crosshair" ${this.settings.crosshair_visible ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <label class="toggle-label">
              <span>Show Grid</span>
              <input type="checkbox" id="s-grid" ${this.settings.grid_visible ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <label class="toggle-label">
              <span>Follow User Location</span>
              <input type="checkbox" id="s-follow" ${this.settings.follow_user ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <label class="toggle-label">
              <span>Auto-save</span>
              <input type="checkbox" id="s-autosave" ${this.settings.auto_save ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Presets (rendered by PresetManager) -->
          <div id="presets-settings-container"></div>

          <!-- Integrations -->
          <div class="settings-section">
            <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM144.56,173.66l-21.45,21.45a44,44,0,0,1-62.22-62.22l21.45-21.46a8,8,0,0,1,11.32,11.31L72.2,144.2a28,28,0,0,0,39.6,39.6l21.45-21.46a8,8,0,0,1,11.31,11.32Zm-34.9-16a8,8,0,0,1-11.32-11.32l48-48a8,8,0,0,1,11.32,11.32Zm85.45-34.55-21.45,21.45a8,8,0,0,1-11.32-11.31L183.8,111.8a28,28,0,0,0-39.6-39.6L122.74,93.66a8,8,0,0,1-11.31-11.32l21.46-21.45a44,44,0,0,1,62.22,62.22Z"/></svg>Integrations</h4>
            <label>Felt API Key
              <input type="password" id="s-felt-key"
                value="${localStorage.getItem('felt_key') ?? ''}"
                placeholder="felt_pat_…"
                autocomplete="off" spellcheck="false" />
              <span class="settings-hint">Used for uploading to Felt. Get from Felt → Workspace Settings → Developers → Create token.</span>
            </label>
          </div>

          <!-- Data Management -->
          <div class="settings-section">
            <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,24C74.17,24,32,48.6,32,80v96c0,31.4,42.17,56,96,56s96-24.6,96-56V80C224,48.6,181.83,24,128,24Zm80,104c0,9.62-7.88,19.43-21.61,26.92C170.93,163.35,150.19,168,128,168s-42.93-4.65-58.39-13.08C55.88,147.43,48,137.62,48,128V111.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64Zm-21.61,74.92C170.93,211.35,150.19,216,128,216s-42.93-4.65-58.39-13.08C55.88,195.43,48,185.62,48,176V159.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64V176C208,185.62,200.12,195.43,186.39,202.92Z"/></svg>Data Management</h4>
            <div class="btn-group">
              <button class="btn-outline" id="s-export-backup">Export Full Backup</button>
              <button class="btn-outline btn-danger" id="s-clear-data">Clear All Features</button>
            </div>
            <div id="s-feature-count" class="settings-hint"></div>
          </div>

          <!-- About -->
          <div class="settings-section settings-about">
            <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z"/></svg>About</h4>
            <p>Fraxinus Field Mapper v1.0</p>
            <p>Offline-first GPS data collector PWA</p>
            <p>Storage: IndexedDB (persistent across sessions)</p>
            <p class="settings-hint" style="margin-top:4px;font-size:0.8em">Build: ${new Date(__APP_BUILD_DATE__).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>

          <div class="settings-actions">
            <button class="btn-primary" id="s-save">Save Settings</button>
            <button class="btn-outline" id="s-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Render presets sub-section
    const presetsContainer = this.panel.querySelector('#presets-settings-container') as HTMLElement;
    this.presetManager.renderPresetsSettings(presetsContainer, () => {
      const ids = this.presetManager['quickEntryPresetIds'] as [string, string, string];
      this.settings.quick_entry_preset_id   = ids[0];
      this.settings.quick_entry_preset_id_2 = ids[1];
      this.settings.quick_entry_preset_id_3 = ids[2];
    });

    // Load feature count
    this.storage.getFeatureCount().then(count => {
      const el = this.panel.querySelector('#s-feature-count');
      if (el) el.textContent = `${count} features stored`;
    });

    // Wire up events
    this.panel.querySelector('#settings-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#s-cancel')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#s-save')?.addEventListener('click', () => this.save());

    this.panel.querySelector('#s-export-backup')?.addEventListener('click', async () => {
      const { ExportManager } = await import('../io/ExportManager');
      await new ExportManager().exportBackup();
    });

    this.panel.querySelector('#s-clear-data')?.addEventListener('click', async () => {
      if (confirm('Delete ALL collected features? This cannot be undone.')) {
        await this.storage.clearAllFeatures();
        EventBus.emit('features-cleared', {});
        EventBus.emit('toast', { message: 'All features deleted', type: 'warning' });
        this.close();
      }
    });
  }

  private async save(): Promise<void> {
    const get = <T extends HTMLElement>(id: string) => this.panel.querySelector<T>(`#${id}`);

    this.settings.user_id = (get<HTMLInputElement>('s-user-id')?.value ?? 'USER').toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.settings.gps_distance_tolerance = parseFloat(get<HTMLInputElement>('s-gps-dist')?.value ?? '5');
    this.settings.gps_time_tolerance = parseFloat(get<HTMLInputElement>('s-gps-time')?.value ?? '3');
    this.settings.gps_min_accuracy = parseFloat(get<HTMLInputElement>('s-gps-acc')?.value ?? '20');
    this.settings.coord_format = (get<HTMLSelectElement>('s-coord-fmt')?.value ?? 'dd') as 'dd' | 'dms' | 'utm';
    this.settings.crosshair_visible = get<HTMLInputElement>('s-crosshair')?.checked ?? true;
    this.settings.grid_visible = get<HTMLInputElement>('s-grid')?.checked ?? false;
    this.settings.follow_user = get<HTMLInputElement>('s-follow')?.checked ?? false;
    this.settings.auto_save = get<HTMLInputElement>('s-autosave')?.checked ?? true;

    // Felt API key — stored directly in localStorage, not in AppSettings
    const feltKey = (get<HTMLInputElement>('s-felt-key')?.value ?? '').trim();
    if (feltKey) localStorage.setItem('felt_key', feltKey);
    else localStorage.removeItem('felt_key');

    const ids = this.presetManager['quickEntryPresetIds'] as [string, string, string];
    this.settings.quick_entry_preset_id   = ids[0];
    this.settings.quick_entry_preset_id_2 = ids[1];
    this.settings.quick_entry_preset_id_3 = ids[2];

    await this.storage.saveAppSettings(this.settings);
    EventBus.emit('settings-changed', { settings: this.settings });
    EventBus.emit('toast', { message: 'Settings saved', type: 'success' });
    this.close();
  }

  getSettings(): AppSettings { return { ...this.settings }; }
}
