// ============================================================
// Felt Export Dialog
// Multi-step dialog: export options → Felt destination picker
// API patterns confirmed against https://github.com/fraxinusenviro/FELT
// ============================================================

import { FeltService } from '../io/FeltService';
import type { FeltProject, FeltMap } from '../io/FeltService';
import { EventBus } from '../utils/EventBus';

// Match the localStorage key used in the companion FELT repo
const API_KEY_STORAGE = 'felt_key';

type Step = 'options' | 'destination';

export class FeltExportDialog {
  private overlay: HTMLElement;

  // State
  private step: Step = 'options';
  private apiKey = '';
  private saveKey = true;
  private saveLocally = true;
  private uploadToFelt = true;
  private felt?: FeltService;
  private projects: FeltProject[] = [];
  private maps: FeltMap[] = [];
  private selectedProjectId = '';
  private createNew = false;

  // Payload
  private geojsonStr = '';
  private onLocalSave?: () => void;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'felt-overlay';
    this.overlay.style.display = 'none';
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  /** Open the dialog with the GeoJSON string and a callback for the local-save action. */
  show(geojsonStr: string, onLocalSave: () => void): void {
    this.geojsonStr = geojsonStr;
    this.onLocalSave = onLocalSave;
    this.step = 'options';
    this.apiKey = localStorage.getItem(API_KEY_STORAGE) ?? '';
    this.projects = [];
    this.maps = [];
    this.selectedProjectId = '';
    this.createNew = false;
    this.felt = undefined;

    this.render();
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('open'));
  }

  hide(): void {
    this.overlay.classList.remove('open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 200);
  }

  // ── Rendering ─────────────────────────────────────────────

  private render(): void {
    if (this.step === 'options') this.renderOptions();
    else this.renderDestination();
  }

  private renderOptions(): void {
    this.overlay.innerHTML = `
      <div class="felt-dialog">
        <div class="felt-dialog-header">
          <div class="felt-dialog-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Export GeoJSON
          </div>
          <button class="panel-close" id="fd-close">✕</button>
        </div>
        <div class="felt-dialog-body">

          <div class="felt-section">
            <div class="felt-section-title">Export Options</div>
            <label class="toggle-label">
              <span>Save to device</span>
              <input type="checkbox" id="fd-opt-local" ${this.saveLocally ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <label class="toggle-label" style="margin-top:10px">
              <span>Upload to Felt</span>
              <input type="checkbox" id="fd-opt-felt" ${this.uploadToFelt ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div id="fd-api-section" class="felt-section" style="${this.uploadToFelt ? '' : 'display:none'}">
            <div class="felt-section-title">Felt API Key</div>
            <input type="password" id="fd-api-key" class="felt-input"
              value="${this.esc(this.apiKey)}"
              placeholder="felt_pat_..."
              autocomplete="off"
              spellcheck="false" />
            <label class="toggle-label" style="margin-top:10px">
              <span>Remember key on this device</span>
              <input type="checkbox" id="fd-save-key" ${this.saveKey ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <p class="settings-hint" style="margin-top:8px">
              Felt → Workspace Settings → Developers → Create token
            </p>
          </div>

        </div>
        <div class="felt-dialog-footer">
          <button class="btn-outline" id="fd-cancel">Cancel</button>
          <button class="btn-primary" id="fd-next">
            ${this.uploadToFelt ? 'Next →' : 'Export'}
          </button>
        </div>
      </div>
    `;

    const closeBtn = this.overlay.querySelector('#fd-close')!;
    const cancelBtn = this.overlay.querySelector('#fd-cancel')!;
    const nextBtn = this.overlay.querySelector<HTMLButtonElement>('#fd-next')!;
    const optFelt = this.overlay.querySelector<HTMLInputElement>('#fd-opt-felt')!;
    const optLocal = this.overlay.querySelector<HTMLInputElement>('#fd-opt-local')!;
    const apiSection = this.overlay.querySelector<HTMLElement>('#fd-api-section')!;

    closeBtn.addEventListener('click', () => this.hide());
    cancelBtn.addEventListener('click', () => this.hide());

    optFelt.addEventListener('change', () => {
      this.uploadToFelt = optFelt.checked;
      apiSection.style.display = this.uploadToFelt ? '' : 'none';
      nextBtn.textContent = this.uploadToFelt ? 'Next →' : 'Export';
    });

    optLocal.addEventListener('change', () => { this.saveLocally = optLocal.checked; });

    nextBtn.addEventListener('click', async () => {
      this.saveLocally = optLocal.checked;
      this.uploadToFelt = optFelt.checked;
      this.apiKey = (this.overlay.querySelector<HTMLInputElement>('#fd-api-key')?.value ?? '').trim();
      this.saveKey = this.overlay.querySelector<HTMLInputElement>('#fd-save-key')?.checked ?? false;

      if (!this.uploadToFelt) {
        if (!this.saveLocally) {
          EventBus.emit('toast', { message: 'Select at least one export option', type: 'warning' });
          return;
        }
        this.onLocalSave?.();
        this.hide();
        EventBus.emit('toast', { message: 'GeoJSON saved to device', type: 'success' });
        return;
      }

      if (!this.apiKey) {
        EventBus.emit('toast', { message: 'Enter your Felt API key', type: 'warning' });
        return;
      }

      nextBtn.textContent = 'Validating…';
      nextBtn.disabled = true;

      try {
        this.felt = new FeltService(this.apiKey);
        await this.felt.validateKey();

        if (this.saveKey) {
          localStorage.setItem(API_KEY_STORAGE, this.apiKey);
        } else {
          localStorage.removeItem(API_KEY_STORAGE);
        }

        this.projects = await this.felt.getProjects();
        this.selectedProjectId = this.projects[0]?.id ?? '';
        this.maps = await this.felt.getMaps(this.selectedProjectId || undefined);
        this.createNew = this.maps.length === 0;

        this.step = 'destination';
        this.render();
      } catch (err) {
        EventBus.emit('toast', { message: `Felt: ${(err as Error).message}`, type: 'error' });
        nextBtn.textContent = 'Next →';
        nextBtn.disabled = false;
      }
    });
  }

  private renderDestination(): void {
    const defaultTitle = `Field Map Export ${new Date().toLocaleDateString('en-CA')}`;
    const hasProject = Boolean(this.selectedProjectId);
    const hasExistingMaps = this.maps.length > 0;

    const projectOpts = [
      `<option value="">— No Project / Personal —</option>`,
      ...this.projects.map(p =>
        `<option value="${this.esc(p.id)}" ${p.id === this.selectedProjectId ? 'selected' : ''}>${this.esc(p.name)}</option>`
      )
    ].join('');

    const mapOpts = this.maps.map(m =>
      `<option value="${this.esc(m.id)}">${this.esc(m.title)}</option>`
    ).join('');

    // If no project selected, existing maps can't be listed — force create new
    const forceNew = !hasProject || !hasExistingMaps;

    this.overlay.innerHTML = `
      <div class="felt-dialog">
        <div class="felt-dialog-header">
          <div class="felt-dialog-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Upload to Felt
          </div>
          <button class="panel-close" id="fd-close">✕</button>
        </div>
        <div class="felt-dialog-body">

          <div class="felt-field">
            <label class="felt-label">Project</label>
            <select id="fd-project" class="felt-select">
              ${projectOpts}
            </select>
            ${!hasProject ? '<p class="settings-hint" style="margin-top:4px">Select a project to see existing maps, or create a new map below.</p>' : ''}
          </div>

          <div class="felt-field">
            <label class="felt-label">Destination Map</label>
            <div class="felt-radio-group">
              <label class="felt-radio ${forceNew ? 'felt-radio-disabled' : ''}">
                <input type="radio" name="fd-map-mode" value="existing"
                  ${!forceNew ? 'checked' : ''}
                  ${forceNew ? 'disabled' : ''} />
                <span>Use existing map${!hasProject ? ' (select a project first)' : hasExistingMaps ? '' : ' (none in this project)'}</span>
              </label>
              <label class="felt-radio">
                <input type="radio" name="fd-map-mode" value="new"
                  ${forceNew ? 'checked' : ''} />
                <span>Create new map</span>
              </label>
            </div>
          </div>

          <div id="fd-existing-map" class="felt-field" style="${forceNew ? 'display:none' : ''}">
            <label class="felt-label">Select Map</label>
            <select id="fd-map-sel" class="felt-select">
              ${mapOpts}
            </select>
          </div>

          <div id="fd-new-map" class="felt-field" style="${!forceNew ? 'display:none' : ''}">
            <label class="felt-label">New Map Title</label>
            <input type="text" id="fd-new-title" class="felt-input"
              value="${this.esc(defaultTitle)}"
              placeholder="${this.esc(defaultTitle)}" />
          </div>

          <div class="felt-field">
            <label class="felt-label">Layer Name</label>
            <input type="text" id="fd-layer-name" class="felt-input" value="Field Data" />
          </div>

          ${this.saveLocally
            ? '<div class="felt-local-note">✓ GeoJSON will also be saved to device</div>'
            : ''}

        </div>
        <div class="felt-dialog-footer">
          <button class="btn-outline" id="fd-back">← Back</button>
          <button class="btn-primary" id="fd-upload">Upload to Felt</button>
        </div>
      </div>
    `;

    this.overlay.querySelector('#fd-close')!.addEventListener('click', () => this.hide());
    this.overlay.querySelector('#fd-back')!.addEventListener('click', () => {
      this.step = 'options';
      this.render();
    });

    // Project change → reload maps
    this.overlay.querySelector('#fd-project')?.addEventListener('change', async (e) => {
      this.selectedProjectId = (e.target as HTMLSelectElement).value;
      const uploadBtn = this.overlay.querySelector<HTMLButtonElement>('#fd-upload')!;
      uploadBtn.textContent = 'Loading maps…';
      uploadBtn.disabled = true;
      try {
        this.maps = await this.felt!.getMaps(this.selectedProjectId || undefined);
        this.createNew = this.maps.length === 0 || !this.selectedProjectId;
        this.renderDestination();
      } catch (err) {
        EventBus.emit('toast', { message: `Failed to load maps: ${(err as Error).message}`, type: 'error' });
        uploadBtn.textContent = 'Upload to Felt';
        uploadBtn.disabled = false;
      }
    });

    // Map mode toggle
    this.overlay.querySelectorAll<HTMLInputElement>('input[name="fd-map-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        this.createNew = radio.value === 'new';
        (this.overlay.querySelector<HTMLElement>('#fd-existing-map')!).style.display = this.createNew ? 'none' : '';
        (this.overlay.querySelector<HTMLElement>('#fd-new-map')!).style.display = this.createNew ? '' : 'none';
      });
    });

    // Upload
    this.overlay.querySelector('#fd-upload')?.addEventListener('click', async () => {
      const uploadBtn = this.overlay.querySelector<HTMLButtonElement>('#fd-upload')!;
      const layerName = (this.overlay.querySelector<HTMLInputElement>('#fd-layer-name')?.value ?? '').trim() || 'Field Data';
      const mode = this.overlay.querySelector<HTMLInputElement>('input[name="fd-map-mode"]:checked')?.value ?? 'new';

      uploadBtn.textContent = 'Uploading…';
      uploadBtn.disabled = true;

      try {
        let mapId: string;

        if (mode === 'new') {
          const title = (this.overlay.querySelector<HTMLInputElement>('#fd-new-title')?.value ?? '').trim() || defaultTitle;
          const newMap = await this.felt!.createMap(title, this.selectedProjectId || undefined);
          mapId = newMap.id;
        } else {
          mapId = this.overlay.querySelector<HTMLSelectElement>('#fd-map-sel')?.value ?? '';
          if (!mapId) throw new Error('No map selected');
        }

        if (this.saveLocally) this.onLocalSave?.();

        await this.felt!.uploadGeoJSON(mapId, this.geojsonStr, layerName);

        EventBus.emit('toast', { message: 'Uploaded to Felt successfully!', type: 'success' });
        this.hide();
      } catch (err) {
        EventBus.emit('toast', { message: `Upload failed: ${(err as Error).message}`, type: 'error' });
        uploadBtn.textContent = 'Upload to Felt';
        uploadBtn.disabled = false;
      }
    });
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
