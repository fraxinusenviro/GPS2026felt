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
            <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>User Identity</h4>
            <label>User ID / Initials
              <input type="text" id="s-user-id" value="${this.settings.user_id}" maxlength="10" placeholder="e.g. IB" />
              <span class="settings-hint">Used in feature IDs, e.g. IB_2026_05_01_1241</span>
            </label>
          </div>

          <!-- GPS Capture -->
          <div class="settings-section">
            <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>GPS Capture</h4>
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
            <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>Display</h4>
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

          <!-- Data Management -->
          <div class="settings-section">
            <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>Data Management</h4>
            <div class="btn-group">
              <button class="btn-outline" id="s-export-backup">Export Full Backup</button>
              <button class="btn-outline btn-danger" id="s-clear-data">Clear All Features</button>
            </div>
            <div id="s-feature-count" class="settings-hint"></div>
          </div>

          <!-- About -->
          <div class="settings-section settings-about">
            <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>About</h4>
            <p>Fraxinus Field Mapper v1.0</p>
            <p>Offline-first GPS data collector PWA</p>
            <p>Storage: IndexedDB (persistent across sessions)</p>
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
