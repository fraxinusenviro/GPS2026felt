import type { AppSettings } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import { SwUpdate } from '../utils/SwUpdate';
import { normalizeUserId, USERID_SOURCE_KEY } from '../utils/userId';
import { SyncManager } from '../sync/SyncManager';
import { BackendClient } from '../sync/BackendClient';
import type { SyncStatus } from '../sync/types';
import type { PresetManager } from './PresetManager';

const CHEVRON_SVG = `<svg class="section-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>`;

export class SettingsPanel {
  private panel = document.getElementById('settings-panel')!;
  private isOpen = false;
  private settings!: AppSettings;
  private storage = StorageManager.getInstance();
  private lastSyncStatus: SyncStatus | null = null;
  private collapsedSections = new Set<string>(['gps', 'display', 'presets', 'quick-entry', 'integrations', 'inventory', 'crs', 'sync', 'data']);

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
    EventBus.on<SyncStatus>('sync-status', (s) => {
      this.lastSyncStatus = s;
      this.updateSyncStatusUI();
    });
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
    const syncCfg = SyncManager.getConfig();
    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Settings</h2>
          <button class="panel-close" id="settings-close">✕</button>
        </div>
        <div class="panel-body settings-body">

          <!-- User Identity (expanded by default) -->
          <div class="settings-section" data-section="user-identity">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z"/></svg>User Identity${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <label>User ID / Initials
                <input type="text" id="s-user-id" value="${this.settings.user_id}" maxlength="10" placeholder="e.g. IB"${localStorage.getItem(USERID_SOURCE_KEY) === 'access' ? ' readonly' : ''} />
                <span class="settings-hint">${localStorage.getItem(USERID_SOURCE_KEY) === 'access'
                  ? 'Set automatically from your login (the name before @). Used in feature IDs, e.g. IB_2026_05_01_1241.'
                  : 'Used in feature IDs, e.g. IB_2026_05_01_1241'}</span>
              </label>
            </div>
          </div>

          <!-- GPS Capture -->
          <div class="settings-section" data-section="gps">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,16a88.1,88.1,0,0,0-88,88c0,75.3,80,132.17,83.41,134.55a8,8,0,0,0,9.18,0C136,236.17,216,179.3,216,104A88.1,88.1,0,0,0,128,16Zm0,56a32,32,0,1,1-32,32A32,32,0,0,1,128,72Z"/></svg>GPS Capture${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
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
          </div>

          <!-- Display -->
          <div class="settings-section" data-section="display">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M232,64V176a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V64A24,24,0,0,1,48,40H208A24,24,0,0,1,232,64ZM160,216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Z"/></svg>DISPLAY & APPEARANCE${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
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
              <label class="toggle-label">
                <span>☀ Outdoor Mode</span>
                <input type="checkbox" id="s-outdoor" ${this.settings.outdoor_mode ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <label class="toggle-label">
                <span>☽ Light Theme</span>
                <input type="checkbox" id="s-theme-light" ${this.settings.theme === 'light' ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <label class="toggle-label">
                <span>✦ Topograph <span class="badge-experimental">Experimental</span></span>
                <input type="checkbox" id="s-ui-style" ${(this.settings.ui_style ?? 'default') === 'topograph' ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <label>Font Appearance
                <select id="s-font-family">
                  <option value="default" ${(this.settings.font_family ?? 'default') === 'default' ? 'selected' : ''}>Default (System)</option>
                  <option value="oswald" ${this.settings.font_family === 'oswald' ? 'selected' : ''}>Oswald</option>
                  <option value="lato" ${this.settings.font_family === 'lato' ? 'selected' : ''}>Lato</option>
                  <option value="roboto-condensed" ${this.settings.font_family === 'roboto-condensed' ? 'selected' : ''}>Roboto Condensed</option>
                </select>
              </label>
              <label>Accent Colour
                <input type="color" id="s-theme-color" value="${this.settings.theme_color ?? '#4ade80'}" style="width:100%;height:32px;border-radius:4px;border:1px solid var(--color-border);background:none;cursor:pointer;padding:2px;" />
                <span class="settings-hint">Changes the highlight colour throughout the app. Default: #4ade80</span>
              </label>
            </div>
          </div>

          <!-- Presets (rendered by PresetManager) -->
          <div id="presets-settings-container"></div>

          <!-- Integrations -->
          <div class="settings-section" data-section="integrations">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM144.56,173.66l-21.45,21.45a44,44,0,0,1-62.22-62.22l21.45-21.46a8,8,0,0,1,11.32,11.31L72.2,144.2a28,28,0,0,0,39.6,39.6l21.45-21.46a8,8,0,0,1,11.31,11.32Zm-34.9-16a8,8,0,0,1-11.32-11.32l48-48a8,8,0,0,1,11.32,11.32Zm85.45-34.55-21.45,21.45a8,8,0,0,1-11.32-11.31L183.8,111.8a28,28,0,0,0-39.6-39.6L122.74,93.66a8,8,0,0,1-11.31-11.32l21.46-21.45a44,44,0,0,1,62.22,62.22Z"/></svg>Integrations${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <label>Felt API Key
                <input type="password" id="s-felt-key"
                  value="${localStorage.getItem('felt_key') ?? ''}"
                  placeholder="felt_pat_…"
                  autocomplete="off" spellcheck="false" />
                <span class="settings-hint">Used for uploading to Felt. Get from Felt → Workspace Settings → Developers → Create token.</span>
              </label>
            </div>
          </div>

          <!-- Inventory -->
          ${this.renderInventorySection()}

          <!-- Coordinate Reference Systems -->
          <div class="settings-section" data-section="crs">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM48.57,112H80.1A128.17,128.17,0,0,1,96,51.06,88.31,88.31,0,0,0,48.57,112ZM128,40c12.28,0,30.91,18.06,40.7,72H87.3C97.09,58.06,115.72,40,128,40ZM80.1,144H48.57A88.31,88.31,0,0,0,96,204.94,128.17,128.17,0,0,1,80.1,144Zm47.9,72c-12.28,0-30.91-18.06-40.7-72h81.4C158.91,197.94,140.28,216,128,216Zm32-11.06A128.17,128.17,0,0,1,175.9,144h31.53A88.31,88.31,0,0,1,160,204.94ZM175.9,112a128.17,128.17,0,0,1-15.9-60.94A88.31,88.31,0,0,1,207.43,112Z"/></svg>Coordinate Reference Systems${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px">CRS supported in this version. PROJ4 expansion is planned for future releases.</p>
              <table style="width:100%;border-collapse:collapse;font-size:11px">
                <thead>
                  <tr style="color:var(--color-text-muted);text-align:left">
                    <th style="padding:4px 6px 4px 0;border-bottom:1px solid var(--color-border)">EPSG</th>
                    <th style="padding:4px 6px;border-bottom:1px solid var(--color-border)">Name</th>
                    <th style="padding:4px 0 4px 6px;border-bottom:1px solid var(--color-border)">Use</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="padding:5px 6px 5px 0;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))"><code>4326</code></td>
                    <td style="padding:5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))">WGS 84</td>
                    <td style="padding:5px 0 5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06));color:var(--color-text-muted)">GPS / storage</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 6px 5px 0;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))"><code>3857</code></td>
                    <td style="padding:5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))">Web Mercator</td>
                    <td style="padding:5px 0 5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06));color:var(--color-text-muted)">Map display</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 6px 5px 0;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))"><code>32618–20</code></td>
                    <td style="padding:5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))">UTM 18–20N (WGS84)</td>
                    <td style="padding:5px 0 5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06));color:var(--color-text-muted)">Coordinate display</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 6px 5px 0;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))"><code>4617</code></td>
                    <td style="padding:5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06))">NAD83(CSRS)</td>
                    <td style="padding:5px 0 5px 6px;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06));color:var(--color-text-muted)">Canadian datum</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 6px 5px 0"><code>2950–54</code></td>
                    <td style="padding:5px 6px">MTM (NAD83 CSRS)</td>
                    <td style="padding:5px 0 5px 6px;color:var(--color-text-muted)">Quebec / Maritimes</td>
                  </tr>
                </tbody>
              </table>
              <p class="settings-hint" style="margin-top:8px">All feature coordinates are stored in WGS84 (EPSG:4326). Re-projection via PROJ4 will be available in a future update.</p>
            </div>
          </div>

          <!-- Cloud Sync -->
          <div class="settings-section" data-section="sync">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M160,40a88.08,88.08,0,0,0-78.71,48.68A64,64,0,1,0,72,216h88a88,88,0,0,0,0-176Z"/></svg>Cloud Sync${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <label class="toggle-label">
                <span>Enable team sync</span>
                <input type="checkbox" id="s-sync-enabled" ${syncCfg.enabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
              <label>Backend URL
                <input type="url" id="s-sync-url" value="${syncCfg.url}"
                  placeholder="leave blank if using the Cloudflare-hosted app"
                  autocomplete="off" spellcheck="false" />
                <span class="settings-hint">Leave blank when running the Cloudflare-hosted app (same origin). Set a full URL only for a separate-origin backend.</span>
              </label>
              <div class="btn-group">
                <button class="btn-outline" id="s-sync-now">Sync Now</button>
              </div>
              <div id="s-sync-status" class="settings-hint"></div>
              <div id="s-auth-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">
                <span id="s-auth-label" class="settings-hint" style="flex:1;min-width:0"></span>
                <button class="btn-outline" id="s-auth-btn" style="flex-shrink:0;font-size:0.8em;padding:4px 8px;display:none"></button>
              </div>
            </div>
          </div>

          <!-- Data Management -->
          <div class="settings-section" data-section="data">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,24C74.17,24,32,48.6,32,80v96c0,31.4,42.17,56,96,56s96-24.6,96-56V80C224,48.6,181.83,24,128,24Zm80,104c0,9.62-7.88,19.43-21.61,26.92C170.93,163.35,150.19,168,128,168s-42.93-4.65-58.39-13.08C55.88,147.43,48,137.62,48,128V111.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64Zm-21.61,74.92C170.93,211.35,150.19,216,128,216s-42.93-4.65-58.39-13.08C55.88,195.43,48,185.62,48,176V159.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64V176C208,185.62,200.12,195.43,186.39,202.92Z"/></svg>Data Management${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <div class="btn-group">
                <button class="btn-outline" id="s-export-backup">Export Full Backup</button>
                <button class="btn-outline btn-danger" id="s-clear-data">Clear All Features</button>
              </div>
              <div id="s-feature-count" class="settings-hint"></div>
            </div>
          </div>

          <!-- About / Version (expanded by default) -->
          <div class="settings-section settings-about" data-section="about">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z"/></svg>About${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <p>Fraxinus Field Mapper v${__APP_VERSION__}</p>
              <p>Offline-first GPS data collector PWA</p>
              <p>Storage: IndexedDB (persistent across sessions)</p>
              <p class="settings-hint" style="margin-top:4px;font-size:0.8em">Build: ${new Date(__APP_BUILD_DATE__).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
              <div id="s-sw-status" style="margin-top:8px">
                ${SwUpdate.hasUpdate
                  ? `<button id="s-sw-reload" class="btn-primary" style="width:100%;background:#f59e0b;border-color:#f59e0b;color:#000">↺ Update available — tap to reload</button>`
                  : `<span style="font-size:0.8em;color:var(--color-text-muted,#6b7280)">✓ App is up to date</span>`
                }
              </div>
              <button id="s-force-reload" class="btn-outline" style="width:100%;margin-top:8px">↻ Force Reload App</button>
              <p class="settings-hint" style="margin-top:4px;font-size:0.8em">Clears cached files and fetches the latest version. On an installed iOS home-screen icon, use this button (or remove &amp; re-add the icon) — the external reload link only refreshes Safari, not the installed app.</p>
            </div>
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

    // Wire collapsible sections (must run after presets are rendered)
    this._wireCollapse();

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

    // Cloud sync: trigger an immediate sync; App relays to the SyncManager.
    this.panel.querySelector('#s-sync-now')?.addEventListener('click', () => EventBus.emit('sync-now'));
    this.updateSyncStatusUI();

    // Auth status row
    this.refreshAuthStatus();
    this.panel.querySelector('#s-auth-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const label = this.panel.querySelector('#s-auth-label');
      if (btn.dataset.action === 'signout') {
        window.open('./logout', '_blank');
        if (label) label.textContent = 'Signing out… tap Check status when done.';
        btn.textContent = 'Check status';
        btn.dataset.action = 'check';
      } else if (btn.dataset.action === 'signin') {
        window.open(window.location.origin, '_blank');
        if (label) label.textContent = 'Complete sign-in in the browser tab, then:';
        btn.textContent = 'Check status';
        btn.dataset.action = 'check';
      } else {
        await this.refreshAuthStatus();
      }
    });

    // Wire update-reload button (may already be rendered if update arrived before panel opened)
    this.panel.querySelector('#s-sw-reload')?.addEventListener('click', () => SwUpdate.reload());

    // Force reload: cache-bust and grab the latest version / service worker
    this.panel.querySelector('#s-force-reload')?.addEventListener('click', async () => {
      if (!confirm('Force reload the app? This clears cached files and re-downloads the latest version.')) return;
      EventBus.emit('toast', { message: 'Clearing cache and reloading…', type: 'info' });
      await SwUpdate.forceReload();
    });

    // If an update arrives while the panel is open, swap the status row live
    const onSwUpdate = () => {
      const statusEl = this.panel.querySelector('#s-sw-status');
      if (!statusEl) return;
      statusEl.innerHTML = `<button id="s-sw-reload" class="btn-primary" style="width:100%;background:#f59e0b;border-color:#f59e0b;color:#000">↺ Update available — tap to reload</button>`;
      statusEl.querySelector('#s-sw-reload')?.addEventListener('click', () => SwUpdate.reload());
    };
    window.addEventListener('sw-update-ready', onSwUpdate, { once: true });
  }

  private _wireCollapse(): void {
    this.panel.querySelectorAll<HTMLElement>('.settings-section[data-section]').forEach(section => {
      const id = section.dataset.section!;
      if (this.collapsedSections.has(id)) section.classList.add('is-collapsed');
      const h4 = section.querySelector<HTMLElement>('h4.section-toggle');
      if (!h4) return;
      h4.addEventListener('click', () => {
        const isNowCollapsed = section.classList.toggle('is-collapsed');
        if (isNowCollapsed) this.collapsedSections.add(id);
        else this.collapsedSections.delete(id);
      });
    });
  }

  private renderInventorySection(): string {
    const s = this.settings;
    const rpt = s.inventory_report ?? {
      title: 'Biodiversity Inventory Report', subtitle: '-', sortOrder: 'time',
      includeMap: false, includeCurve: false, labelObsNumbers: true, colorScheme: 'fraxinus',
      fields: { family: true, code: true, scientificName: true, srank: true, sprot: true, nprot: true, grank: true, latitude: true, longitude: true, time: true, notes: true },
    };
    const ck = (v: boolean | undefined) => (v ? 'checked' : '');
    const opt = (val: string, cur: string, label: string) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
    const fieldToggle = (key: string, label: string) =>
      `<label class="toggle-label"><span>${label}</span><input type="checkbox" id="s-inv-fld-${key}" ${ck((rpt.fields as unknown as Record<string, boolean>)[key])} /><span class="toggle-slider"></span></label>`;
    return `
          <div class="settings-section" data-section="inventory">
            <h4 class="section-toggle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>Inventory${CHEVRON_SVG}</h4>
            <div class="settings-section-body">
              <p class="settings-hint" style="margin-bottom:6px">Species databases (ACCDC Nova Scotia) used by the inventory species search.</p>
              <label class="toggle-label"><span>Vertebrates</span><input type="checkbox" id="s-inv-db-vert" ${ck(s.inventory_db_vertebrates)} /><span class="toggle-slider"></span></label>
              <label class="toggle-label"><span>Vascular plants</span><input type="checkbox" id="s-inv-db-vasc" ${ck(s.inventory_db_vascular)} /><span class="toggle-slider"></span></label>
              <label class="toggle-label"><span>Non-vascular plants</span><input type="checkbox" id="s-inv-db-nvas" ${ck(s.inventory_db_nonvascular)} /><span class="toggle-slider"></span></label>
              <label class="toggle-label"><span>Invertebrates <small>(~2.5&nbsp;MB, loads on enable)</small></span><input type="checkbox" id="s-inv-db-invt" ${ck(s.inventory_db_invertebrates)} /><span class="toggle-slider"></span></label>

              <p class="settings-hint" style="margin:10px 0 6px">Report</p>
              <label>Title<input type="text" id="s-inv-rpt-title" value="${(rpt.title || '').replace(/"/g, '&quot;')}" /></label>
              <label>Subtitle<input type="text" id="s-inv-rpt-subtitle" value="${(rpt.subtitle || '').replace(/"/g, '&quot;')}" /></label>
              <label>Sort order
                <select id="s-inv-rpt-sort">
                  ${opt('time', rpt.sortOrder, 'Time recorded')}
                  ${opt('family', rpt.sortOrder, 'Family')}
                  ${opt('commonName', rpt.sortOrder, 'Common name')}
                  ${opt('scientificName', rpt.sortOrder, 'Scientific name')}
                </select>
              </label>
              <label>Colour scheme
                <select id="s-inv-rpt-scheme">
                  ${opt('fraxinus', rpt.colorScheme, 'Fraxinus (green)')}
                  ${opt('slate', rpt.colorScheme, 'Slate (blue)')}
                  ${opt('terracotta', rpt.colorScheme, 'Terracotta')}
                </select>
              </label>
              <p class="settings-hint" style="margin:8px 0 4px">Report columns</p>
              ${fieldToggle('family', 'Family')}
              ${fieldToggle('code', 'Code (mcode)')}
              ${fieldToggle('scientificName', 'Scientific name')}
              ${fieldToggle('srank', 'S-Rank')}
              ${fieldToggle('sprot', 'Provincial status')}
              ${fieldToggle('nprot', 'COSEWIC')}
              ${fieldToggle('grank', 'G-Rank')}
              ${fieldToggle('latitude', 'Latitude')}
              ${fieldToggle('longitude', 'Longitude')}
              ${fieldToggle('time', 'Time')}
              ${fieldToggle('notes', 'Notes')}
              <p class="settings-hint" style="margin:8px 0 4px">Report extras</p>
              <label class="toggle-label"><span>Include satellite overview map</span><input type="checkbox" id="s-inv-rpt-map" ${ck(rpt.includeMap)} /><span class="toggle-slider"></span></label>
              <label class="toggle-label"><span>Include species–time curve</span><input type="checkbox" id="s-inv-rpt-curve" ${ck(rpt.includeCurve)} /><span class="toggle-slider"></span></label>
              <label class="toggle-label"><span>Label observation numbers</span><input type="checkbox" id="s-inv-rpt-labels" ${ck(rpt.labelObsNumbers)} /><span class="toggle-slider"></span></label>
            </div>
          </div>`;
  }

  private async save(): Promise<void> {
    const get = <T extends HTMLElement>(id: string) => this.panel.querySelector<T>(`#${id}`);

    // When the User ID is managed by the Cloudflare login, keep the synced
    // value; otherwise normalize whatever was typed.
    if (localStorage.getItem(USERID_SOURCE_KEY) !== 'access') {
      this.settings.user_id = normalizeUserId(get<HTMLInputElement>('s-user-id')?.value ?? 'USER') || 'USER';
    }
    this.settings.gps_distance_tolerance = parseFloat(get<HTMLInputElement>('s-gps-dist')?.value ?? '5');
    this.settings.gps_time_tolerance = parseFloat(get<HTMLInputElement>('s-gps-time')?.value ?? '3');
    this.settings.gps_min_accuracy = parseFloat(get<HTMLInputElement>('s-gps-acc')?.value ?? '20');
    this.settings.coord_format = (get<HTMLSelectElement>('s-coord-fmt')?.value ?? 'dd') as 'dd' | 'dms' | 'utm';
    this.settings.crosshair_visible = get<HTMLInputElement>('s-crosshair')?.checked ?? true;
    this.settings.grid_visible = get<HTMLInputElement>('s-grid')?.checked ?? false;
    this.settings.follow_user = get<HTMLInputElement>('s-follow')?.checked ?? false;
    this.settings.auto_save = get<HTMLInputElement>('s-autosave')?.checked ?? true;
    this.settings.outdoor_mode = get<HTMLInputElement>('s-outdoor')?.checked ?? false;
    if (this.settings.outdoor_mode) document.documentElement.setAttribute('data-outdoor', '');
    else document.documentElement.removeAttribute('data-outdoor');

    this.settings.theme = get<HTMLInputElement>('s-theme-light')?.checked ? 'light' : 'dark';
    this.settings.ui_style = get<HTMLInputElement>('s-ui-style')?.checked ? 'topograph' : 'default';
    if (this.settings.ui_style === 'topograph') document.documentElement.setAttribute('data-ui-style', 'topograph');
    else document.documentElement.removeAttribute('data-ui-style');
    this.settings.font_family = (get<HTMLSelectElement>('s-font-family')?.value ?? 'default') as 'default' | 'oswald';
    this.settings.theme_color = get<HTMLInputElement>('s-theme-color')?.value ?? '#4ade80';
    document.documentElement.setAttribute('data-theme', this.settings.theme);
    const darkIcon = document.getElementById('theme-icon-dark');
    const lightIcon = document.getElementById('theme-icon-light');
    if (darkIcon) darkIcon.style.display = this.settings.theme === 'dark' ? '' : 'none';
    if (lightIcon) lightIcon.style.display = this.settings.theme === 'light' ? '' : 'none';

    // Felt API key — stored directly in localStorage, not in AppSettings
    const feltKey = (get<HTMLInputElement>('s-felt-key')?.value ?? '').trim();
    if (feltKey) localStorage.setItem('felt_key', feltKey);
    else localStorage.removeItem('felt_key');

    // Inventory: species databases + report settings
    this.settings.inventory_db_vertebrates = get<HTMLInputElement>('s-inv-db-vert')?.checked ?? true;
    this.settings.inventory_db_vascular = get<HTMLInputElement>('s-inv-db-vasc')?.checked ?? true;
    this.settings.inventory_db_nonvascular = get<HTMLInputElement>('s-inv-db-nvas')?.checked ?? true;
    this.settings.inventory_db_invertebrates = get<HTMLInputElement>('s-inv-db-invt')?.checked ?? false;
    const fld = (k: string) => get<HTMLInputElement>(`s-inv-fld-${k}`)?.checked ?? true;
    this.settings.inventory_report = {
      title: (get<HTMLInputElement>('s-inv-rpt-title')?.value ?? 'Biodiversity Inventory Report').trim() || 'Biodiversity Inventory Report',
      subtitle: (get<HTMLInputElement>('s-inv-rpt-subtitle')?.value ?? '-').trim() || '-',
      sortOrder: (get<HTMLSelectElement>('s-inv-rpt-sort')?.value ?? 'time') as 'time' | 'family' | 'commonName' | 'scientificName',
      colorScheme: (get<HTMLSelectElement>('s-inv-rpt-scheme')?.value ?? 'fraxinus') as 'fraxinus' | 'slate' | 'terracotta',
      includeMap: get<HTMLInputElement>('s-inv-rpt-map')?.checked ?? false,
      includeCurve: get<HTMLInputElement>('s-inv-rpt-curve')?.checked ?? false,
      labelObsNumbers: get<HTMLInputElement>('s-inv-rpt-labels')?.checked ?? true,
      fields: {
        family: fld('family'), code: fld('code'), scientificName: fld('scientificName'),
        srank: fld('srank'), sprot: fld('sprot'), nprot: fld('nprot'), grank: fld('grank'),
        latitude: fld('latitude'), longitude: fld('longitude'), time: fld('time'), notes: fld('notes'),
      },
    };
    // Rebuild the cached species list to reflect DB toggle changes.
    const { invalidateSpeciesList, loadInvertebratesDB } = await import('../inventory/inventorySurvey');
    invalidateSpeciesList();
    if (this.settings.inventory_db_invertebrates && !window.DB_INVERTEBRATES) {
      void loadInvertebratesDB(import.meta.env.BASE_URL);
    }

    // Cloud sync config — App relays {enabled, url} to the SyncManager.
    const syncEnabled = get<HTMLInputElement>('s-sync-enabled')?.checked ?? false;
    const syncUrl = (get<HTMLInputElement>('s-sync-url')?.value ?? '').trim();
    EventBus.emit('sync-config-changed', { enabled: syncEnabled, url: syncUrl });

    const ids = this.presetManager['quickEntryPresetIds'] as [string, string, string];
    this.settings.quick_entry_preset_id   = ids[0];
    this.settings.quick_entry_preset_id_2 = ids[1];
    this.settings.quick_entry_preset_id_3 = ids[2];

    await this.storage.saveAppSettings(this.settings);
    EventBus.emit('settings-changed', { settings: this.settings });
    EventBus.emit('toast', { message: 'Settings saved', type: 'success' });
    this.close();
  }

  private updateSyncStatusUI(): void {
    const el = this.panel.querySelector('#s-sync-status');
    if (!el) return;
    const s = this.lastSyncStatus;
    if (!s || !s.enabled) { el.textContent = 'Sync disabled'; return; }
    const bits = [s.online ? 'online' : 'offline'];
    if (s.syncing) bits.push('syncing…');
    if (s.pending > 0) bits.push(`${s.pending} pending`);
    if (s.lastSync) bits.push(`last ${new Date(s.lastSync).toLocaleTimeString()}`);
    if (s.lastError) bits.push(`error: ${s.lastError}`);
    el.textContent = bits.join(' · ');
  }

  private async refreshAuthStatus(): Promise<void> {
    const label = this.panel.querySelector('#s-auth-label');
    const btn = this.panel.querySelector<HTMLButtonElement>('#s-auth-btn');
    if (!label || !btn) return;
    label.textContent = 'Checking…';
    btn.style.display = 'none';
    const who = await new BackendClient(SyncManager.getConfig().url).getWhoami();
    if (who?.email) {
      label.textContent = `Signed in as ${who.email}`;
      btn.textContent = 'Sign Out';
      btn.style.display = '';
      btn.dataset.action = 'signout';
    } else {
      label.textContent = 'Not signed in';
      btn.textContent = 'Sign In';
      btn.style.display = '';
      btn.dataset.action = 'signin';
    }
  }

  getSettings(): AppSettings { return { ...this.settings }; }
}
