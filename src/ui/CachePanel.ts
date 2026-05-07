import { BBoxSelector } from '../cache/BBoxSelector';
import { TileCacheManager } from '../cache/TileCacheManager';
import type { TileCacheLayerDef, TileCacheRecord } from '../types';
import type { MapManager } from '../map/MapManager';
import type { BasemapManager } from '../map/BasemapManager';
import { EventBus } from '../utils/EventBus';

export class CachePanel {
  private panel: HTMLElement;
  private isOpen = false;
  private bboxSelector: BBoxSelector | null = null;
  private currentBBox: [number, number, number, number] | null = null;
  private cacheManager = new TileCacheManager();
  private activeTab: 'download' | 'library' = 'download';
  private abortController: AbortController | null = null;
  private activeCacheId: string | null = null;

  constructor(
    private mapManager: MapManager,
    private basemapManager: BasemapManager,
  ) {
    this.panel = document.getElementById('cache-panel')!;
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
    this.bboxSelector?.deactivate();
    setTimeout(() => {
      if (!this.isOpen) this.panel.style.display = 'none';
    }, 300);
  }

  private render(): void {
    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Tile Cache</h2>
          <button class="panel-close" id="cache-close">✕</button>
        </div>
        <div class="cache-tabs">
          <button class="cache-tab${this.activeTab === 'download' ? ' active' : ''}" data-tab="download">Download</button>
          <button class="cache-tab${this.activeTab === 'library' ? ' active' : ''}" data-tab="library">Library</button>
        </div>
        <div class="panel-body cache-panel-body">
          ${this.activeTab === 'download' ? this.renderDownloadTab() : this.renderLibraryTab()}
        </div>
        <div class="panel-footer">
          <button class="btn btn-primary panel-done-btn" id="cache-done">Done</button>
        </div>
      </div>`;

    document.getElementById('cache-close')?.addEventListener('click', () => this.close());
    document.getElementById('cache-done')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLButtonElement>('.cache-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as 'download' | 'library';
        this.render();
        this.wirePanel();
      });
    });
    this.wirePanel();
  }

  private renderDownloadTab(): string {
    const layers = this.basemapManager.getCacheableLayers();
    const zoom = Math.floor(this.mapManager.getZoom());
    const bboxText = this.currentBBox
      ? `W:${this.currentBBox[0].toFixed(4)} S:${this.currentBBox[1].toFixed(4)} E:${this.currentBBox[2].toFixed(4)} N:${this.currentBBox[3].toFixed(4)}`
      : 'Not set';

    const layerRows = layers.length
      ? layers.map(l => `
          <label class="cache-layer-row">
            <input type="checkbox" class="cache-layer-check" data-def-id="${l.defId}"
              data-url="${encodeURIComponent(l.urlTemplate)}" data-type="${l.type}" data-label="${l.label}"
              checked />
            <span>${l.label}</span>
          </label>`).join('')
      : '<div class="cache-empty">No cacheable layers in current stack.<br>Add a raster layer first.</div>';

    const today = new Date().toISOString().slice(0, 10);

    return `
      <div class="settings-section">
        <h4>Extent</h4>
        <div class="cache-bbox-row">
          <span class="cache-bbox-text" id="cache-bbox-text">${bboxText}</span>
          <button class="btn-sm" id="cache-set-extent">${this.bboxSelector ? 'Confirm' : 'Set Extent'}</button>
        </div>
      </div>
      <div class="settings-section">
        <h4>Layers</h4>
        ${layerRows}
      </div>
      <div class="settings-section">
        <h4>Zoom Levels</h4>
        <div class="cache-zoom-row">
          <span>Current: z${zoom}</span>
          <label>+Additional levels:
            <input type="range" id="cache-extra-zoom" min="0" max="4" value="1" step="1" />
            <span id="cache-extra-zoom-val">1</span>
          </label>
        </div>
        <div class="cache-zoom-info">Range: z${zoom} – z<span id="cache-zoom-max">${zoom + 1}</span></div>
      </div>
      <div class="settings-section">
        <h4>Estimate</h4>
        <div id="cache-estimate" class="cache-estimate">—</div>
      </div>
      <div class="settings-section">
        <label>Cache name
          <input type="text" id="cache-name" value="Cache – ${today}" />
        </label>
      </div>
      <div id="cache-progress-wrap" style="display:none">
        <div class="cache-progress-bar"><div class="cache-progress-fill" id="cache-progress-fill"></div></div>
        <div id="cache-progress-text" class="cache-progress-text">0 / 0 tiles</div>
      </div>
      <div class="cache-actions">
        <button class="btn-primary" id="cache-download-btn">Download</button>
        <button class="btn-secondary" id="cache-cancel-btn" style="display:none">Cancel</button>
      </div>`;
  }

  private renderLibraryTab(): string {
    // Rendered async — show placeholder then async render
    return `<div id="cache-library-content"><div class="cache-loading">Loading…</div></div>`;
  }

  private async renderLibraryAsync(): Promise<void> {
    const caches = await this.cacheManager.getAllCaches();
    const container = document.getElementById('cache-library-content');
    if (!container) return;

    if (caches.length === 0) {
      container.innerHTML = '<div class="cache-empty">No cached areas yet.</div>';
      return;
    }

    container.innerHTML = caches.map(c => {
      const isActive = c.id === this.activeCacheId;
      const sizeMb = (c.size_bytes / 1024 / 1024).toFixed(1);
      const date = c.created_at.slice(0, 10);
      return `
        <div class="cache-library-item" data-cache-id="${c.id}">
          <div class="cache-lib-name">${c.name}</div>
          <div class="cache-lib-meta">${date} · ${c.layers.length} layer${c.layers.length !== 1 ? 's' : ''} · ${c.tile_count.toLocaleString()} tiles · ${sizeMb} MB</div>
          <div class="cache-lib-actions">
            <button class="btn-sm cache-lib-activate" data-cache-id="${c.id}" title="${isActive ? 'Deactivate' : 'Activate'}">
              ${isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button class="btn-sm cache-lib-zoom" data-cache-id="${c.id}" title="Zoom to extent">Zoom to</button>
            <button class="btn-sm btn-danger cache-lib-delete" data-cache-id="${c.id}" title="Delete">Delete</button>
          </div>
        </div>`;
    }).join('');

    // Wire library buttons
    container.querySelectorAll<HTMLButtonElement>('.cache-lib-activate').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.cacheId!;
        if (this.activeCacheId === id) {
          this.basemapManager.deactivateCache();
          this.activeCacheId = null;
          EventBus.emit('toast', { message: 'Cache deactivated — using live tiles', type: 'info', duration: 2000 });
        } else {
          const record = (await this.cacheManager.getAllCaches()).find(c => c.id === id);
          if (!record) return;
          this.basemapManager.activateCache(id, record.layers);
          this.activeCacheId = id;
          EventBus.emit('toast', { message: `Cache "${record.name}" activated`, type: 'success', duration: 2000 });
        }
        this.renderLibraryAsync();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.cache-lib-zoom').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.cacheId!;
        const record = (await this.cacheManager.getAllCaches()).find(c => c.id === id);
        if (!record) return;
        const [w, s, e, n] = record.bbox;
        this.mapManager.fitBounds([[w, s], [e, n]], 60);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.cache-lib-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.cacheId!;
        const record = (await this.cacheManager.getAllCaches()).find(c => c.id === id);
        if (!record) return;
        if (!confirm(`Delete cache "${record.name}"?\nThis will remove all ${record.tile_count.toLocaleString()} stored tiles.`)) return;
        if (this.activeCacheId === id) {
          this.basemapManager.deactivateCache();
          this.activeCacheId = null;
        }
        await this.cacheManager.deleteCache(id);
        EventBus.emit('toast', { message: `Cache "${record.name}" deleted`, type: 'info', duration: 2000 });
        this.renderLibraryAsync();
      });
    });
  }

  private wirePanel(): void {
    if (this.activeTab === 'library') {
      void this.renderLibraryAsync();
      return;
    }

    // --- Download tab ---
    const extraZoomSlider = document.getElementById('cache-extra-zoom') as HTMLInputElement | null;
    const extraZoomVal    = document.getElementById('cache-extra-zoom-val');
    const zoomMaxEl       = document.getElementById('cache-zoom-max');
    const estimateEl      = document.getElementById('cache-estimate');
    const bboxTextEl      = document.getElementById('cache-bbox-text');
    const setExtentBtn    = document.getElementById('cache-set-extent');
    const downloadBtn     = document.getElementById('cache-download-btn') as HTMLButtonElement | null;
    const cancelBtn       = document.getElementById('cache-cancel-btn') as HTMLButtonElement | null;

    const currentZoom = Math.floor(this.mapManager.getZoom());

    const updateEstimate = () => {
      if (!estimateEl) return;
      const extra = parseInt(extraZoomSlider?.value ?? '1');
      const zMax = currentZoom + extra;
      if (zoomMaxEl) zoomMaxEl.textContent = String(zMax);

      const layers = this.getCheckedLayers();
      if (!this.currentBBox || layers.length === 0) {
        estimateEl.textContent = '—';
        return;
      }
      const { tileCount, estimatedBytes } = this.cacheManager.estimateTileCount(
        this.currentBBox, layers, currentZoom, zMax,
      );
      const mb = (estimatedBytes / 1024 / 1024).toFixed(1);
      estimateEl.textContent = `~${tileCount.toLocaleString()} tiles · ~${mb} MB`;
    };

    extraZoomSlider?.addEventListener('input', () => {
      if (extraZoomVal) extraZoomVal.textContent = extraZoomSlider.value;
      updateEstimate();
    });

    this.panel.querySelectorAll<HTMLInputElement>('.cache-layer-check').forEach(cb => {
      cb.addEventListener('change', updateEstimate);
    });

    setExtentBtn?.addEventListener('click', () => {
      if (this.bboxSelector) {
        // Confirm: freeze bbox
        this.currentBBox = this.bboxSelector.getBounds();
        this.bboxSelector.deactivate();
        this.bboxSelector = null;
        if (bboxTextEl) {
          const [w, s, e, n] = this.currentBBox;
          bboxTextEl.textContent = `W:${w.toFixed(4)} S:${s.toFixed(4)} E:${e.toFixed(4)} N:${n.toFixed(4)}`;
        }
        setExtentBtn.textContent = 'Set Extent';
        updateEstimate();
      } else {
        const mapContainer = document.getElementById('map-container');
        if (!mapContainer) return;
        this.bboxSelector = new BBoxSelector(mapContainer, this.mapManager.getMap());
        this.bboxSelector.activate();
        setExtentBtn.textContent = 'Confirm';

        mapContainer.addEventListener('bbox-change', ((e: Event) => {
          const bounds = (e as CustomEvent).detail as [number, number, number, number];
          this.currentBBox = bounds;
          if (bboxTextEl) {
            const [w, s, el, n] = bounds;
            bboxTextEl.textContent = `W:${w.toFixed(4)} S:${s.toFixed(4)} E:${el.toFixed(4)} N:${n.toFixed(4)}`;
          }
          updateEstimate();
        }) as EventListener, { once: false });
      }
    });

    downloadBtn?.addEventListener('click', async () => {
      if (!this.currentBBox) {
        EventBus.emit('toast', { message: 'Set an extent first', type: 'warning' });
        return;
      }
      const layers = this.getCheckedLayers();
      if (layers.length === 0) {
        EventBus.emit('toast', { message: 'Select at least one layer', type: 'warning' });
        return;
      }
      const name = (document.getElementById('cache-name') as HTMLInputElement)?.value.trim() || 'Cache';
      const extra = parseInt(extraZoomSlider?.value ?? '1');
      const zMax = currentZoom + extra;

      downloadBtn.disabled = true;
      if (cancelBtn) cancelBtn.style.display = '';
      const progressWrap = document.getElementById('cache-progress-wrap');
      const progressFill = document.getElementById('cache-progress-fill');
      const progressText = document.getElementById('cache-progress-text');
      if (progressWrap) progressWrap.style.display = '';

      this.abortController = new AbortController();

      try {
        await this.cacheManager.downloadCache(
          { name, bbox: this.currentBBox, layers, zMin: currentZoom, zMax },
          (done, total) => {
            const pct = total ? Math.round((done / total) * 100) : 0;
            if (progressFill) progressFill.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `${done} / ${total} tiles`;
          },
          this.abortController.signal,
        );
        EventBus.emit('toast', { message: `"${name}" cached successfully`, type: 'success' });
        this.activeTab = 'library';
        this.render();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          EventBus.emit('toast', { message: 'Cache download failed', type: 'error' });
        } else {
          EventBus.emit('toast', { message: 'Download cancelled', type: 'info', duration: 1500 });
        }
        downloadBtn.disabled = false;
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (progressWrap) progressWrap.style.display = 'none';
      }
    });

    cancelBtn?.addEventListener('click', () => {
      this.abortController?.abort();
    });

    updateEstimate();
  }

  private getCheckedLayers(): TileCacheLayerDef[] {
    return [...this.panel.querySelectorAll<HTMLInputElement>('.cache-layer-check:checked')].map(cb => ({
      defId: cb.dataset.defId!,
      label: cb.dataset.label!,
      urlTemplate: decodeURIComponent(cb.dataset.url!),
      type: (cb.dataset.type ?? 'xyz') as 'xyz' | 'wms',
    }));
  }
}
