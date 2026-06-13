import type { SharedLayer } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { BackendClient } from '../sync/BackendClient';
import { SyncManager } from '../sync/SyncManager';
import { EventBus } from '../utils/EventBus';

/**
 * Shared Data Library (Phase 3) — upload vector/raster datasets to the org's
 * Cloudflare storage (R2) and share them across the team. The file bytes go to
 * R2 via the backend; a synced `shared_layers` metadata row makes the dataset
 * appear for every user. Vector layers can be added to the map (rendered through
 * the existing import pipeline, via App); raster rendering is a follow-up.
 */
export class SharedLibraryPanel {
  private panel = document.getElementById('shared-library-panel')!;
  private storage = StorageManager.getInstance();
  private isOpen = false;
  private layers: SharedLayer[] = [];
  private busy = false;

  toggle(): void { this.isOpen ? this.close() : void this.open(); }

  async open(): Promise<void> {
    this.isOpen = true;
    this.layers = await this.storage.getAllSharedLayers();
    this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
  }

  close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  private client(): BackendClient {
    return new BackendClient(SyncManager.getConfig().url);
  }

  /** Infer (kind, format, ext) from a filename. */
  private classify(name: string): { kind: 'vector' | 'raster'; format: string; ext: string } | null {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    switch (ext) {
      case 'geojson':
      case 'json': return { kind: 'vector', format: 'geojson', ext };
      case 'pmtiles': return { kind: 'vector', format: 'pmtiles', ext };
      case 'tif':
      case 'tiff': return { kind: 'raster', format: 'cog', ext };
      default: return null;
    }
  }

  private async upload(file: File, name: string): Promise<void> {
    const meta = this.classify(file.name);
    if (!meta) throw new Error('Unsupported file type (use .geojson, .pmtiles, or .tif/.tiff).');
    const id = crypto.randomUUID();
    const key = `shared/${id}.${meta.ext}`;
    await this.client().putBlob(key, file);
    const now = new Date().toISOString();
    const layer: SharedLayer = {
      id, name: name || file.name, kind: meta.kind, format: meta.format,
      r2_key: key, size: file.size, added_at: now, updated_at: now,
    };
    await this.storage.saveSharedLayer(layer); // marks dirty → syncs to the team
    EventBus.emit('sync-now');
  }

  private render(): void {
    const fmtSize = (n?: number) => n == null ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const syncOn = SyncManager.getConfig().enabled;

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Shared Data Library</h2>
          <button class="panel-close" id="sl-close">✕</button>
        </div>
        <div class="panel-body">
          ${syncOn ? '' : '<p class="settings-hint" style="color:var(--color-warning,#f59e0b)">Enable Cloud Sync in Settings so uploads are shared with the team.</p>'}

          <div class="settings-section">
            <h4>Upload</h4>
            <label>Name
              <input type="text" id="sl-name" placeholder="e.g. 2026 Orthomosaic" />
            </label>
            <label>File
              <input type="file" id="sl-file" accept=".geojson,.json,.pmtiles,.tif,.tiff" />
              <span class="settings-hint">Vector: GeoJSON or PMTiles. Raster: Cloud-Optimized GeoTIFF (.tif).</span>
            </label>
            <button class="btn-primary" id="sl-upload" style="width:100%">Upload to Cloudflare</button>
            <div id="sl-status" class="settings-hint" style="margin-top:6px"></div>
          </div>

          <div class="settings-section">
            <h4>Shared layers (${this.layers.length})</h4>
            <div class="sl-list">
              ${this.layers.length === 0
                ? '<p class="settings-hint">No shared layers yet.</p>'
                : this.layers.map(l => `
                  <div class="sl-item" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--color-border,#333)">
                    <div style="flex:1;min-width:0">
                      <div style="font-weight:600">${escHtml(l.name)}</div>
                      <div class="settings-hint">${l.kind} · ${escHtml(l.format)} · ${fmtSize(l.size)}</div>
                    </div>
                    <button class="btn-outline sl-add" data-id="${l.id}">Add to map</button>
                    <button class="btn-outline btn-danger sl-del" data-id="${l.id}">✕</button>
                  </div>`).join('')}
            </div>
          </div>
        </div>
        <div class="panel-footer">
          <button class="btn btn-primary panel-done-btn" id="sl-done">Done</button>
        </div>
      </div>`;

    this.wire();
  }

  private wire(): void {
    this.panel.querySelector('#sl-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#sl-done')?.addEventListener('click', () => this.close());

    const statusEl = this.panel.querySelector<HTMLElement>('#sl-status');
    this.panel.querySelector('#sl-upload')?.addEventListener('click', async () => {
      if (this.busy) return;
      const fileInput = this.panel.querySelector<HTMLInputElement>('#sl-file');
      const nameInput = this.panel.querySelector<HTMLInputElement>('#sl-name');
      const file = fileInput?.files?.[0];
      if (!file) { if (statusEl) statusEl.textContent = 'Choose a file first.'; return; }
      this.busy = true;
      if (statusEl) statusEl.textContent = 'Uploading…';
      try {
        await this.upload(file, nameInput?.value.trim() ?? '');
        this.layers = await this.storage.getAllSharedLayers();
        this.render();
        EventBus.emit('toast', { message: 'Uploaded to shared library', type: 'success' });
      } catch (err) {
        if (statusEl) statusEl.textContent = `Error: ${(err as Error).message}`;
      } finally {
        this.busy = false;
      }
    });

    this.panel.querySelectorAll<HTMLButtonElement>('.sl-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = this.layers.find(l => l.id === btn.dataset.id);
        if (layer) EventBus.emit('shared-layer-add', { layer });
      });
    });

    this.panel.querySelectorAll<HTMLButtonElement>('.sl-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id!;
        if (!confirm('Remove this shared layer for the whole team?')) return;
        await this.storage.deleteSharedLayer(id);
        EventBus.emit('sync-now');
        this.layers = await this.storage.getAllSharedLayers();
        this.render();
      });
    });
  }
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
