import { MapCompositeExporter } from '../io/MapCompositeExporter';
import { buildTileCoords, clampBboxLat } from '../cache/tileUtils';
import type { MapManager } from '../map/MapManager';
import type { ImportManager } from '../io/ImportManager';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';

// Composited tiles vary a lot in size; ~45 KB is a reasonable average for a
// PNG mixing imagery + vector overlays.
const AVG_TILE_BYTES = 45 * 1024;

export class CachePanel {
  private panel: HTMLElement;
  private isOpen = false;
  private exporter: MapCompositeExporter;
  private storage = StorageManager.getInstance();
  private abortController: AbortController | null = null;
  private onMoveEnd = () => { if (this.isOpen) this.refreshExtent(); };

  constructor(
    private mapManager: MapManager,
    private importManager: ImportManager,
  ) {
    this.panel = document.getElementById('cache-panel')!;
    this.exporter = new MapCompositeExporter(mapManager);
    EventBus.on('map-moveend', this.onMoveEnd);
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

  /** Current viewport as [west, south, east, north], clamped to valid Mercator. */
  private viewportBbox(): [number, number, number, number] {
    const b = this.mapManager.getBounds();
    return clampBboxLat([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  private render(): void {
    const zoom = Math.floor(this.mapManager.getZoom());
    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Offline Map</h2>
          <button class="panel-close" id="cache-close">✕</button>
        </div>
        <div class="panel-body cache-panel-body">
          <div class="settings-section">
            <p class="cache-help">Flattens the current map view — basemap stack plus every visible overlay — into an MBTiles package for offline use. The export covers the <strong>current viewport</strong>.</p>
          </div>
          <div class="settings-section">
            <h4>Extent (current view)</h4>
            <div class="cache-bbox-text" id="cache-bbox-text">—</div>
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
            <label>Map name
              <input type="text" id="cache-name" value="Offline – ${new Date().toISOString().slice(0, 10)}" />
            </label>
            <label class="cache-check-row">
              <input type="checkbox" id="cache-download" checked />
              <span>Download .mbtiles file</span>
            </label>
          </div>
          <div id="cache-progress-wrap" style="display:none">
            <div class="cache-progress-bar"><div class="cache-progress-fill" id="cache-progress-fill"></div></div>
            <div id="cache-progress-text" class="cache-progress-text">0 / 0 tiles</div>
          </div>
          <div class="cache-actions">
            <button class="btn-primary" id="cache-export-btn">Export Offline Map</button>
          </div>
          <div class="settings-section">
            <h4>Saved offline maps</h4>
            <div id="cache-saved-list" class="cache-saved-list"><div class="cache-loading">Loading…</div></div>
          </div>
        </div>
        <div class="panel-footer">
          <button class="btn btn-primary panel-done-btn" id="cache-done">Done</button>
        </div>
      </div>`;

    document.getElementById('cache-close')?.addEventListener('click', () => this.close());
    document.getElementById('cache-done')?.addEventListener('click', () => this.close());
    this.wirePanel();
    this.refreshExtent();
    void this.renderSavedList();
  }

  /** List MBTiles layers stored in-app, with zoom-to + delete (purges tiles). */
  private async renderSavedList(): Promise<void> {
    const container = document.getElementById('cache-saved-list');
    if (!container) return;
    const maps = (await this.storage.getAllImportedLayers()).filter(l => l.file_type === 'mbtiles');

    if (maps.length === 0) {
      container.innerHTML = '<div class="cache-empty">No offline maps saved yet.</div>';
      return;
    }

    container.innerHTML = maps.map(m => {
      const date = (m.added_at ?? '').slice(0, 10);
      return `
        <div class="cache-saved-item" data-id="${m.id}">
          <div class="cache-saved-info">
            <div class="cache-saved-name">${m.name}</div>
            <div class="cache-saved-meta">${date}${m.bounds ? ' · has extent' : ''}</div>
          </div>
          <div class="cache-saved-actions">
            <button class="btn-sm cache-saved-zoom" data-id="${m.id}" title="Zoom to extent"${m.bounds ? '' : ' disabled'}>Zoom to</button>
            <button class="btn-sm btn-danger cache-saved-del" data-id="${m.id}" title="Delete offline map">Delete</button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll<HTMLButtonElement>('.cache-saved-zoom').forEach(btn => {
      btn.addEventListener('click', async () => {
        const m = maps.find(l => l.id === btn.dataset.id);
        if (!m?.bounds) return;
        const [w, s, e, n] = m.bounds;
        this.mapManager.fitBounds([[w, s], [e, n]], 60);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.cache-saved-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const m = maps.find(l => l.id === btn.dataset.id);
        if (!m) return;
        if (!confirm(`Delete offline map "${m.name}"?\nThis removes it from the map and frees its cached tiles.`)) return;
        this.importManager.removeImportedLayer(m);
        await this.storage.deleteImportedLayer(m.id);
        await this.storage.clearTilesForLayer(m.id);
        EventBus.emit('layer-deleted', { id: m.id });
        EventBus.emit('toast', { message: `Offline map "${m.name}" deleted`, type: 'info', duration: 2000 });
        this.renderSavedList();
      });
    });
  }

  private refreshExtent(): void {
    const el = document.getElementById('cache-bbox-text');
    if (!el) return;
    const [w, s, e, n] = this.viewportBbox();
    el.textContent = `W:${w.toFixed(4)} S:${s.toFixed(4)} E:${e.toFixed(4)} N:${n.toFixed(4)}`;
    this.updateEstimate();
  }

  private updateEstimate(): void {
    const estimateEl = document.getElementById('cache-estimate');
    const zoomMaxEl = document.getElementById('cache-zoom-max');
    const slider = document.getElementById('cache-extra-zoom') as HTMLInputElement | null;
    if (!estimateEl) return;

    const currentZoom = Math.floor(this.mapManager.getZoom());
    const extra = parseInt(slider?.value ?? '1');
    const zMax = currentZoom + extra;
    if (zoomMaxEl) zoomMaxEl.textContent = String(zMax);

    const tileCount = buildTileCoords(this.viewportBbox(), currentZoom, zMax).length;
    const mb = (tileCount * AVG_TILE_BYTES / 1024 / 1024).toFixed(1);
    estimateEl.textContent = `~${tileCount.toLocaleString()} tiles · ~${mb} MB`;
  }

  private wirePanel(): void {
    const slider = document.getElementById('cache-extra-zoom') as HTMLInputElement | null;
    const sliderVal = document.getElementById('cache-extra-zoom-val');
    const exportBtn = document.getElementById('cache-export-btn') as HTMLButtonElement | null;

    slider?.addEventListener('input', () => {
      if (sliderVal) sliderVal.textContent = slider.value;
      this.updateEstimate();
    });

    exportBtn?.addEventListener('click', () => this.runExport());
  }

  private async runExport(): Promise<void> {
    const exportBtn = document.getElementById('cache-export-btn') as HTMLButtonElement | null;
    const progressWrap = document.getElementById('cache-progress-wrap');
    const progressFill = document.getElementById('cache-progress-fill');
    const progressText = document.getElementById('cache-progress-text');
    const slider = document.getElementById('cache-extra-zoom') as HTMLInputElement | null;
    const name = (document.getElementById('cache-name') as HTMLInputElement)?.value.trim() || 'Offline Map';

    const bbox = this.viewportBbox();
    const zMin = Math.floor(this.mapManager.getZoom());
    const zMax = zMin + parseInt(slider?.value ?? '1');

    if (exportBtn) exportBtn.disabled = true;
    if (progressWrap) progressWrap.style.display = '';
    this.abortController = new AbortController();

    try {
      const { blob, tileCount } = await this.exporter.export(
        bbox, zMin, zMax, name,
        (done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 0;
          if (progressFill) progressFill.style.width = `${pct}%`;
          if (progressText) progressText.textContent = `${done} / ${total} tiles`;
        },
        this.abortController,
      );

      // 1) Save to device (optional)
      const doDownload = (document.getElementById('cache-download') as HTMLInputElement | null)?.checked ?? true;
      if (doDownload) this.downloadBlob(blob, `${name}.mbtiles`);

      // 2) Save in-app: feed the same blob through the existing MBTiles import
      //    path so it persists and shows up as an offline layer.
      EventBus.emit('toast', {
        message: doDownload
          ? `Exported ${tileCount.toLocaleString()} tiles — downloaded & adding offline layer…`
          : `Exported ${tileCount.toLocaleString()} tiles — adding offline layer…`,
        type: 'success',
      });
      const file = new File([blob], `${name}.mbtiles`, { type: 'application/x-sqlite3' });
      await this.importManager.importFile(file);

      void this.renderSavedList();
      this.close();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        EventBus.emit('toast', { message: 'Export cancelled', type: 'info', duration: 1500 });
      } else {
        console.error('[CachePanel] export failed', err);
        EventBus.emit('toast', { message: 'Offline map export failed', type: 'error' });
      }
    } finally {
      if (exportBtn) exportBtn.disabled = false;
      if (progressWrap) progressWrap.style.display = 'none';
      this.abortController = null;
    }
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
