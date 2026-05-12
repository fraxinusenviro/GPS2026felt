// ============================================================
// Felt Export Dialog — upload GeoJSON to a Felt map
// API key is configured in Settings → Integrations.
// ============================================================

import { FeltService } from '../io/FeltService';
import type { FeltProject, FeltMap } from '../io/FeltService';
import { EventBus } from '../utils/EventBus';

const API_KEY_STORAGE = 'felt_key';

type Step = 'loading' | 'destination' | 'no-key';

export class FeltExportDialog {
  private overlay: HTMLElement;

  private step: Step = 'no-key';
  private felt?: FeltService;
  private projects: FeltProject[] = [];
  private maps: FeltMap[] = [];
  private selectedProjectId = '';
  private createNew = false;
  private geojsonStr = '';
  private typeColors: Record<string, string> = {};

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'felt-overlay';
    this.overlay.style.display = 'none';
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(geojsonStr: string, typeColors: Record<string, string> = {}): void {
    this.geojsonStr = geojsonStr;
    this.typeColors = typeColors;
    this.projects = [];
    this.maps = [];
    this.selectedProjectId = '';
    this.createNew = false;
    this.felt = undefined;

    const apiKey = localStorage.getItem(API_KEY_STORAGE) ?? '';
    if (!apiKey) {
      this.step = 'no-key';
      this.render();
    } else {
      this.step = 'loading';
      this.render();
      void this.loadDestinations(apiKey);
    }

    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('open'));
  }

  hide(): void {
    this.overlay.classList.remove('open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 200);
  }

  // ── Data loading ──────────────────────────────────────────

  private async loadDestinations(apiKey: string): Promise<void> {
    try {
      this.felt = new FeltService(apiKey);
      this.projects = await this.felt.getProjects();
      this.selectedProjectId = this.projects[0]?.id ?? '';
      this.maps = await this.felt.getMaps(this.selectedProjectId || undefined);
      this.createNew = this.maps.length === 0;
      this.step = 'destination';
      this.render();
    } catch (err) {
      EventBus.emit('toast', { message: `Felt: ${(err as Error).message}`, type: 'error', duration: 6000 });
      this.hide();
    }
  }

  // ── Rendering ─────────────────────────────────────────────

  private render(): void {
    switch (this.step) {
      case 'no-key':    return this.renderNoKey();
      case 'loading':   return this.renderLoading();
      case 'destination': return this.renderDestination();
    }
  }

  private renderNoKey(): void {
    this.overlay.innerHTML = `
      <div class="felt-dialog">
        <div class="felt-dialog-header">
          <div class="felt-dialog-title">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
            Upload to Felt
          </div>
          <button class="panel-close" id="fd-close">✕</button>
        </div>
        <div class="felt-dialog-body">
          <div style="text-align:center;padding:24px 8px">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="40" height="40" style="opacity:0.4;display:block;margin:0 auto 16px"><path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM144.56,173.66l-21.45,21.45a44,44,0,0,1-62.22-62.22l21.45-21.46a8,8,0,0,1,11.32,11.31L72.2,144.2a28,28,0,0,0,39.6,39.6l21.45-21.46a8,8,0,0,1,11.31,11.32Zm-34.9-16a8,8,0,0,1-11.32-11.32l48-48a8,8,0,0,1,11.32,11.32Zm85.45-34.55-21.45,21.45a8,8,0,0,1-11.32-11.31L183.8,111.8a28,28,0,0,0-39.6-39.6L122.74,93.66a8,8,0,0,1-11.31-11.32l21.46-21.45a44,44,0,0,1,62.22,62.22Z"/></svg>
            <p style="margin:0 0 8px;font-weight:500">No Felt API key configured</p>
            <p class="settings-hint" style="margin:0">Add your key in <strong>Settings → Integrations</strong>, then try again.</p>
          </div>
        </div>
        <div class="felt-dialog-footer">
          <button class="btn-primary" id="fd-close-btn">Close</button>
        </div>
      </div>
    `;
    this.overlay.querySelector('#fd-close')!.addEventListener('click', () => this.hide());
    this.overlay.querySelector('#fd-close-btn')!.addEventListener('click', () => this.hide());
  }

  private renderLoading(): void {
    this.overlay.innerHTML = `
      <div class="felt-dialog">
        <div class="felt-dialog-header">
          <div class="felt-dialog-title">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
            Upload to Felt
          </div>
          <button class="panel-close" id="fd-close">✕</button>
        </div>
        <div class="felt-dialog-body">
          <div style="text-align:center;padding:32px 8px;opacity:0.6">
            Loading projects…
          </div>
        </div>
        <div class="felt-dialog-footer">
          <button class="btn-outline" id="fd-cancel">Cancel</button>
        </div>
      </div>
    `;
    this.overlay.querySelector('#fd-close')!.addEventListener('click', () => this.hide());
    this.overlay.querySelector('#fd-cancel')!.addEventListener('click', () => this.hide());
  }

  private renderDestination(): void {
    const defaultTitle = `Field Map Export ${new Date().toLocaleDateString('en-CA')}`;
    const hasProject = Boolean(this.selectedProjectId);
    const forceNew = !hasProject || this.maps.length === 0;

    const projectOpts = [
      `<option value="">— No Project / Personal —</option>`,
      ...this.projects.map(p =>
        `<option value="${this.esc(p.id)}" ${p.id === this.selectedProjectId ? 'selected' : ''}>${this.esc(p.name)}</option>`
      )
    ].join('');

    const mapOpts = this.maps.map(m =>
      `<option value="${this.esc(m.id)}">${this.esc(m.title)}</option>`
    ).join('');

    this.overlay.innerHTML = `
      <div class="felt-dialog">
        <div class="felt-dialog-header">
          <div class="felt-dialog-title">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18"><path d="M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z"/></svg>
            Upload to Felt
          </div>
          <button class="panel-close" id="fd-close">✕</button>
        </div>
        <div class="felt-dialog-body">

          <div class="felt-field">
            <label class="felt-label">Project</label>
            <select id="fd-project" class="felt-select">${projectOpts}</select>
            ${!hasProject ? '<p class="settings-hint" style="margin-top:4px">Select a project to see existing maps.</p>' : ''}
          </div>

          <div class="felt-field">
            <label class="felt-label">Destination Map</label>
            <div class="felt-radio-group">
              <label class="felt-radio ${forceNew ? 'felt-radio-disabled' : ''}">
                <input type="radio" name="fd-map-mode" value="existing"
                  ${!forceNew ? 'checked' : ''} ${forceNew ? 'disabled' : ''} />
                <span>${!hasProject ? 'Use existing map (select a project first)' : this.maps.length === 0 ? 'Use existing map (none in this project)' : 'Use existing map'}</span>
              </label>
              <label class="felt-radio">
                <input type="radio" name="fd-map-mode" value="new" ${forceNew ? 'checked' : ''} />
                <span>Create new map</span>
              </label>
            </div>
          </div>

          <div id="fd-existing-map" class="felt-field" style="${forceNew ? 'display:none' : ''}">
            <label class="felt-label">Select Map</label>
            <select id="fd-map-sel" class="felt-select">${mapOpts}</select>
          </div>

          <div id="fd-new-map" class="felt-field" style="${!forceNew ? 'display:none' : ''}">
            <label class="felt-label">New Map Title</label>
            <input type="text" id="fd-new-title" class="felt-input"
              value="${this.esc(defaultTitle)}" placeholder="${this.esc(defaultTitle)}" />
          </div>

          <div class="felt-field">
            <label class="felt-label">Layer Name</label>
            <input type="text" id="fd-layer-name" class="felt-input" value="Field Data" />
          </div>

        </div>
        <div class="felt-dialog-footer">
          <button class="btn-outline" id="fd-cancel">Cancel</button>
          <button class="btn-primary" id="fd-upload">Upload to Felt</button>
        </div>
      </div>
    `;

    this.overlay.querySelector('#fd-close')!.addEventListener('click', () => this.hide());
    this.overlay.querySelector('#fd-cancel')!.addEventListener('click', () => this.hide());

    // Project change → reload maps
    this.overlay.querySelector('#fd-project')?.addEventListener('change', async (e) => {
      this.selectedProjectId = (e.target as HTMLSelectElement).value;
      const uploadBtn = this.overlay.querySelector<HTMLButtonElement>('#fd-upload')!;
      uploadBtn.textContent = 'Loading…';
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
    this.overlay.querySelectorAll<HTMLInputElement>('input[name="fd-map-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        this.createNew = r.value === 'new';
        (this.overlay.querySelector<HTMLElement>('#fd-existing-map')!).style.display = this.createNew ? 'none' : '';
        (this.overlay.querySelector<HTMLElement>('#fd-new-map')!).style.display = this.createNew ? '' : 'none';
      });
    });

    // Upload
    this.overlay.querySelector('#fd-upload')?.addEventListener('click', async () => {
      const uploadBtn = this.overlay.querySelector<HTMLButtonElement>('#fd-upload')!;
      const layerName = (this.overlay.querySelector<HTMLInputElement>('#fd-layer-name')?.value ?? '').trim() || 'Field Data';
      const mode = this.overlay.querySelector<HTMLInputElement>('input[name="fd-map-mode"]:checked')?.value ?? 'new';

      uploadBtn.disabled = true;

      try {
        let mapId: string;
        let mapUrl = '';

        if (mode === 'new') {
          const title = (this.overlay.querySelector<HTMLInputElement>('#fd-new-title')?.value ?? '').trim() || defaultTitle;
          uploadBtn.textContent = 'Creating map…';
          const newMap = await this.felt!.createMap(title, this.selectedProjectId || undefined);
          mapId = newMap.id;
          mapUrl = newMap.url;
        } else {
          mapId = this.overlay.querySelector<HTMLSelectElement>('#fd-map-sel')?.value ?? '';
          if (!mapId) throw new Error('No map selected');
          mapUrl = this.maps.find(m => m.id === mapId)?.url ?? '';
        }

        uploadBtn.textContent = 'Uploading data…';
        const layerId = await this.felt!.uploadGeoJSON(mapId, this.geojsonStr, layerName);

        this.hide();

        EventBus.emit('toast', {
          message: mapUrl
            ? `Uploaded to Felt! <a href="${mapUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">Open map ↗</a>`
            : 'Uploaded to Felt successfully!',
          type: 'success',
          duration: 8000,
        });

        // Apply categorical symbology in background — never blocks upload success
        if (layerId) {
          this.felt!.applyStyleToUploadedLayers(mapId, layerId, this.typeColors)
            .catch(() => undefined);
        }
      } catch (err) {
        console.error('[FeltExportDialog] Upload error:', err);
        EventBus.emit('toast', { message: `Upload failed: ${(err as Error).message}`, type: 'error', duration: 6000 });
        uploadBtn.textContent = 'Upload to Felt';
        uploadBtn.disabled = false;
      }
    });
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
