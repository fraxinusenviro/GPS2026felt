import { BASEMAPS, BASEMAP_OVERLAYS } from '../constants';
import type { BasemapDef, ImportedLayer, OnlineLayer } from '../types';
import type { MapManager } from './MapManager';

interface StackLayer {
  instanceId: string;
  defId: string;
  label: string;
  url: string;
  tileSize: number;
  maxZoom: number;
  opacity: number;
  visible: boolean;
  hueRotate: number;
  saturation: number;
  contrast: number;
  brightness: number;
}

interface UserLayerInfo {
  id: string;
  name: string;
  kind: 'vector' | 'raster';
  visible: boolean;
  opacity: number;
  mapLayerId: string;
  bounds?: [number, number, number, number];
  fileType?: string;
}

interface PDFLayerInfo {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  bounds?: [number, number, number, number];
}

const ALL_DEFS = (): BasemapDef[] => [...BASEMAPS, ...BASEMAP_OVERLAYS];

/** Generate a thumbnail URL from a tile URL template (z=4, x=4, y=5 ≈ eastern Canada) */
const thumbUrl = (url: string) =>
  url.replace('{z}', '4').replace('{x}', '4').replace('{y}', '5').replace('{r}', '');

export class BasemapManager {
  private stack: StackLayer[] = [];
  private dragSrcIdx: number | null = null;
  private userLayers: UserLayerInfo[] = [];
  private pdfLayers: PDFLayerInfo[] = [];
  private onDeletePDF: ((id: string) => void) | null = null;
  private onDeleteUserLayer: ((id: string) => void) | null = null;

  constructor(private mapManager: MapManager) {}

  init(basemapId: string): void {
    const def = ALL_DEFS().find(b => b.id === basemapId) ?? BASEMAPS[0];
    this.stack = [{
      instanceId: 'base-0',
      defId: def.id,
      label: def.label,
      url: def.url,
      tileSize: def.tile_size ?? 256,
      maxZoom: def.max_zoom ?? 19,
      opacity: 1,
      visible: true,
      hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    }];
  }

  private addToStack(def: BasemapDef): void {
    const instanceId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    this.stack.unshift({
      instanceId, defId: def.id, label: def.label, url: def.url,
      tileSize: def.tile_size ?? 256, maxZoom: def.max_zoom ?? 19,
      opacity: 0.8, visible: true,
      hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    });
    this.rebuildMap();
  }

  private removeFromStack(instanceId: string): void {
    if (this.stack.length <= 1) return;
    this.stack = this.stack.filter(l => l.instanceId !== instanceId);
    this.rebuildMap();
  }

  private rebuildMap(): void {
    if (this.stack.length === 0) return;
    const allDefs = ALL_DEFS();
    const baseLayer = this.stack[this.stack.length - 1];
    const baseDef = allDefs.find(d => d.id === baseLayer.defId) ?? BASEMAPS[0];
    this.mapManager.setBasemap(baseDef);
    this.mapManager.setBasemapOpacity(baseLayer.visible ? baseLayer.opacity : 0);
    this.mapManager.setBasemapPaint('raster-hue-rotate', baseLayer.hueRotate);
    this.mapManager.setBasemapPaint('raster-saturation', baseLayer.saturation);
    this.mapManager.setBasemapPaint('raster-contrast', baseLayer.contrast);
    this.mapManager.setBasemapPaint('raster-brightness-max', baseLayer.brightness);

    const overlays = this.stack.slice(0, this.stack.length - 1).reverse();
    this.mapManager.rebuildBasemapOverlays(overlays.map(l => ({
      instanceId: l.instanceId, url: l.url, opacity: l.opacity, visible: l.visible,
      hueRotate: l.hueRotate, saturation: l.saturation, contrast: l.contrast, brightness: l.brightness,
    })));
  }

  renderPanel(
    container: HTMLElement,
    onClose: () => void,
    userLayers: UserLayerInfo[] = [],
    pdfLayers: PDFLayerInfo[] = [],
    onDeletePDF?: (id: string) => void,
    onDeleteUserLayer?: (id: string) => void,
  ): void {
    this.userLayers = userLayers;
    this.pdfLayers = pdfLayers;
    this.onDeletePDF = onDeletePDF ?? null;
    this.onDeleteUserLayer = onDeleteUserLayer ?? null;
    if (this.stack.length === 0) this.init('esri-imagery');
    this.renderContent(container, onClose);
  }

  // ---- Palette helpers ----

  private renderOverlayPalette(): string {
    const ungrouped = BASEMAP_OVERLAYS.filter(o => !o.group);
    const groupNames = [...new Set(BASEMAP_OVERLAYS.filter(o => o.group).map(o => o.group!))]
      .sort((a, b) => a.localeCompare(b));

    const rows = (items: BasemapDef[]) => items.map(ov => `
      <div class="bm-palette-row">
        <span class="bm-palette-label">${ov.label}</span>
        <button class="bm-add-btn" data-def-id="${ov.id}" title="Add to stack">+</button>
      </div>`).join('');

    let html = `<div class="bm-section-title">LiDAR Hillshades <span class="bm-section-hint">click + to add</span></div>`;
    if (ungrouped.length) html += `<div class="bm-palette">${rows(ungrouped)}</div>`;
    for (const g of groupNames) {
      const items = BASEMAP_OVERLAYS.filter(o => o.group === g);
      html += `
        <div class="bm-overlay-group-header">${g} <span class="bm-section-hint">${items.length} layers</span></div>
        <div class="bm-palette bm-palette-group">${rows(items)}</div>`;
    }
    return html;
  }

  private renderUserLayersSection(): string {
    if (this.userLayers.length === 0) return '';
    const eyeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const zoomSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
    const dragDots = `<svg viewBox="0 0 10 16" fill="currentColor" width="10" height="16"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="6" r="1.5"/><circle cx="7" cy="6" r="1.5"/><circle cx="3" cy="10" r="1.5"/><circle cx="7" cy="10" r="1.5"/><circle cx="3" cy="14" r="1.5"/><circle cx="7" cy="14" r="1.5"/></svg>`;
    return `
      <div class="bm-section-title">Your Layers <span class="bm-section-hint">imported &amp; online</span></div>
      <div class="bm-pdf-layers">
        ${this.userLayers.map(l => {
          const badge = (l.fileType ?? l.kind).toUpperCase();
          return `
          <div class="bm-stack-item" data-ulid="${l.id}">
            <div class="bm-item-main">
              <div class="bm-drag-handle" style="pointer-events:none;opacity:0.3">${dragDots}</div>
              <span class="bm-layer-label" title="${l.name}">${l.name}</span>
              <span class="bm-base-badge" style="background:var(--color-accent-dim,#1a3a2a);color:var(--color-accent,#4ade80);border:1px solid var(--color-accent,#4ade80)">${badge}</span>
              <div class="bm-layer-controls">
                <input type="range" class="bm-opacity-slider bm-ul-opacity" data-ulid="${l.mapLayerId}"
                  min="0" max="100" value="${Math.round(l.opacity * 100)}" title="Opacity" />
                <span class="bm-opacity-val">${Math.round(l.opacity * 100)}%</span>
                <button class="bm-vis-btn ${l.visible ? 'active' : ''} bm-ul-vis" data-ulid="${l.mapLayerId}" title="${l.visible ? 'Hide' : 'Show'}">${eyeSvg}</button>
                ${l.bounds ? `<button class="bm-adj-toggle bm-ul-zoom" data-ulid="${l.id}" title="Zoom to layer">${zoomSvg}</button>` : ''}
                <button class="bm-del-btn bm-ul-del" data-ulid="${l.id}" title="Remove layer">✕</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ---- PDF overlay section ----

  private renderPDFSection(): string {
    if (this.pdfLayers.length === 0) return '';
    return `
      <div class="bm-pdf-layers">
        ${this.pdfLayers.map(l => `
          <div class="bm-stack-item" data-pdfid="${l.id}">
            <div class="bm-item-main">
              <div class="bm-drag-handle" style="pointer-events:none;opacity:0.3">
                <svg viewBox="0 0 10 16" fill="currentColor" width="10" height="16">
                  <circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/>
                  <circle cx="3" cy="6" r="1.5"/><circle cx="7" cy="6" r="1.5"/>
                  <circle cx="3" cy="10" r="1.5"/><circle cx="7" cy="10" r="1.5"/>
                  <circle cx="3" cy="14" r="1.5"/><circle cx="7" cy="14" r="1.5"/>
                </svg>
              </div>
              <span class="bm-layer-label" title="${l.name}">${l.name}</span>
              <span class="bm-base-badge" style="background:var(--green-mid,#2d6a4f)">PDF</span>
              <div class="bm-layer-controls">
                <input type="range" class="bm-opacity-slider bm-pdf-opacity" data-pdfid="${l.id}"
                  min="0" max="100" value="${Math.round(l.opacity * 100)}" title="Opacity" />
                <span class="bm-opacity-val">${Math.round(l.opacity * 100)}%</span>
                <button class="bm-vis-btn bm-pdf-vis ${l.visible ? 'active' : ''}" data-pdfid="${l.id}" title="${l.visible ? 'Hide' : 'Show'}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                ${l.bounds ? `
                <button class="bm-adj-toggle bm-pdf-zoom" data-pdfid="${l.id}" title="Zoom to map">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                  </svg>
                </button>` : ''}
                <button class="bm-del-btn bm-pdf-del" data-pdfid="${l.id}" title="Delete PDF">✕</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  // ---- Stack item rendering ----

  private renderStackItem(layer: StackLayer, idx: number): string {
    const isBase = idx === this.stack.length - 1;
    return `
      <div class="bm-stack-item ${isBase ? 'bm-base-item' : ''}"
           draggable="true" data-idx="${idx}" data-iid="${layer.instanceId}">
        <div class="bm-item-main">
          <div class="bm-drag-handle" title="Drag to reorder">
            <svg viewBox="0 0 10 16" fill="currentColor" width="10" height="16">
              <circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/>
              <circle cx="3" cy="6" r="1.5"/><circle cx="7" cy="6" r="1.5"/>
              <circle cx="3" cy="10" r="1.5"/><circle cx="7" cy="10" r="1.5"/>
              <circle cx="3" cy="14" r="1.5"/><circle cx="7" cy="14" r="1.5"/>
            </svg>
          </div>
          <span class="bm-layer-label" title="${layer.label}">${layer.label}</span>
          ${isBase ? '<span class="bm-base-badge">BASE</span>' : ''}
          <div class="bm-layer-controls">
            <input type="range" class="bm-opacity-slider" data-iid="${layer.instanceId}"
              min="0" max="100" value="${Math.round(layer.opacity * 100)}" title="Opacity" />
            <span class="bm-opacity-val">${Math.round(layer.opacity * 100)}%</span>
            <button class="bm-vis-btn ${layer.visible ? 'active' : ''}" data-iid="${layer.instanceId}" title="${layer.visible ? 'Hide' : 'Show'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button class="bm-adj-toggle" data-iid="${layer.instanceId}" title="Image adjustments">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
                <line x1="4" y1="6" x2="20" y2="6"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/>
                <line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/>
                <line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>
              </svg>
            </button>
            ${this.stack.length > 1 ? `<button class="bm-del-btn" data-iid="${layer.instanceId}" title="Remove">✕</button>` : ''}
          </div>
        </div>
        <div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
          <div class="bm-adj-row">
            <label class="bm-adj-label">Hue</label>
            <input type="range" class="bm-adj-slider bm-hue" data-iid="${layer.instanceId}" min="-180" max="180" step="1" value="${layer.hueRotate}" />
            <span class="bm-adj-val">${layer.hueRotate}°</span>
          </div>
          <div class="bm-adj-row">
            <label class="bm-adj-label">Sat</label>
            <input type="range" class="bm-adj-slider bm-sat" data-iid="${layer.instanceId}" min="-100" max="100" step="1" value="${Math.round(layer.saturation * 100)}" />
            <span class="bm-adj-val">${Math.round(layer.saturation * 100)}</span>
          </div>
          <div class="bm-adj-row">
            <label class="bm-adj-label">Con</label>
            <input type="range" class="bm-adj-slider bm-con" data-iid="${layer.instanceId}" min="-100" max="100" step="1" value="${Math.round(layer.contrast * 100)}" />
            <span class="bm-adj-val">${Math.round(layer.contrast * 100)}</span>
          </div>
          <div class="bm-adj-row">
            <label class="bm-adj-label">Bri</label>
            <input type="range" class="bm-adj-slider bm-bri" data-iid="${layer.instanceId}" min="0" max="200" step="5" value="${Math.round(layer.brightness * 100)}" />
            <span class="bm-adj-val">${Math.round(layer.brightness * 100)}%</span>
          </div>
        </div>
      </div>`;
  }

  // ---- Main render ----

  private renderContent(container: HTMLElement, onClose: () => void): void {
    container.innerHTML = `
      <div class="panel-header">
        <h3>Basemap &amp; Overlays</h3>
        <button class="panel-close" id="bm-close">✕</button>
      </div>
      <div class="panel-body bm-panel-body">

        <div class="bm-section-title">
          Active Layers
          <span class="bm-section-hint">drag to reorder · top = drawn on top</span>
        </div>
        <div class="bm-stack" id="bm-stack">
          ${this.stack.map((layer, idx) => this.renderStackItem(layer, idx)).join('')}
        </div>

        ${this.renderPDFSection()}

        <div class="bm-section-title">Standard Basemaps <span class="bm-section-hint">click + to add</span></div>
        <div class="bm-palette">
          ${BASEMAPS.map(bm => `
            <div class="bm-palette-row">
              <img class="bm-thumb" src="${thumbUrl(bm.url)}" loading="lazy"
                onerror="this.style.display='none'" alt="" />
              <span class="bm-palette-label">${bm.label}</span>
              <button class="bm-add-btn" data-def-id="${bm.id}" title="Add to stack">+</button>
            </div>
          `).join('')}
        </div>

        ${this.renderOverlayPalette()}
        ${this.renderUserLayersSection()}

      </div>
    `;

    container.querySelector('#bm-close')?.addEventListener('click', onClose);
    this.wireContent(container, onClose);
  }

  // ---- Event wiring ----

  private wireContent(container: HTMLElement, onClose: () => void): void {
    const allDefs = ALL_DEFS();

    // Add to stack
    container.querySelectorAll<HTMLButtonElement>('.bm-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const def = allDefs.find(d => d.id === btn.dataset.defId);
        if (def) { this.addToStack(def); this.renderContent(container, onClose); }
      });
    });

    // Opacity sliders
    container.querySelectorAll<HTMLInputElement>('.bm-opacity-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const opacity = parseInt(slider.value) / 100;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.opacity = opacity;
        slider.closest('.bm-item-main')?.querySelector('.bm-opacity-val')!
          && (slider.closest('.bm-item-main')!.querySelector('.bm-opacity-val')!.textContent = `${Math.round(opacity * 100)}%`);
        const isBase = iid === this.stack[this.stack.length - 1]?.instanceId;
        if (isBase) this.mapManager.setBasemapOpacity(layer.visible ? opacity : 0);
        else this.mapManager.setBasemapOverlayOpacity(iid, layer.visible ? opacity : 0);
      });
    });

    // Visibility toggles
    container.querySelectorAll<HTMLButtonElement>('.bm-vis-btn:not(.bm-ul-vis)').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.visible = !layer.visible;
        btn.classList.toggle('active', layer.visible);
        const isBase = iid === this.stack[this.stack.length - 1]?.instanceId;
        if (isBase) this.mapManager.setBasemapOpacity(layer.visible ? layer.opacity : 0);
        else this.mapManager.setBasemapOverlayVisible(iid, layer.visible);
      });
    });

    // Remove buttons
    container.querySelectorAll<HTMLButtonElement>('.bm-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeFromStack(btn.dataset.iid!);
        this.renderContent(container, onClose);
      });
    });

    // Adjustment panel toggles
    container.querySelectorAll<HTMLButtonElement>('.bm-adj-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const panel = container.querySelector<HTMLElement>(`.bm-adj-panel[data-iid="${iid}"]`);
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        btn.classList.toggle('active', panel?.style.display !== 'none');
      });
    });

    // Adjustment sliders
    container.querySelectorAll<HTMLInputElement>('.bm-adj-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const val = parseInt(slider.value);
        const valEl = slider.nextElementSibling as HTMLElement;
        const isBase = iid === this.stack[this.stack.length - 1]?.instanceId;

        if (slider.classList.contains('bm-hue')) {
          layer.hueRotate = val;
          if (valEl) valEl.textContent = `${val}°`;
          if (isBase) this.mapManager.setBasemapPaint('raster-hue-rotate', val);
          else this.mapManager.setBasemapOverlayPaint(iid, 'raster-hue-rotate', val);
        } else if (slider.classList.contains('bm-sat')) {
          layer.saturation = val / 100;
          if (valEl) valEl.textContent = `${val}`;
          if (isBase) this.mapManager.setBasemapPaint('raster-saturation', val / 100);
          else this.mapManager.setBasemapOverlayPaint(iid, 'raster-saturation', val / 100);
        } else if (slider.classList.contains('bm-con')) {
          layer.contrast = val / 100;
          if (valEl) valEl.textContent = `${val}`;
          if (isBase) this.mapManager.setBasemapPaint('raster-contrast', val / 100);
          else this.mapManager.setBasemapOverlayPaint(iid, 'raster-contrast', val / 100);
        } else if (slider.classList.contains('bm-bri')) {
          layer.brightness = val / 100;
          if (valEl) valEl.textContent = `${val}%`;
          if (isBase) this.mapManager.setBasemapPaint('raster-brightness-max', val / 100);
          else this.mapManager.setBasemapOverlayPaint(iid, 'raster-brightness-max', val / 100);
        }
      });
    });

    // PDF layer opacity
    container.querySelectorAll<HTMLInputElement>('.bm-pdf-opacity').forEach(slider => {
      slider.addEventListener('input', () => {
        const id = slider.dataset.pdfid!;
        const opacity = parseInt(slider.value) / 100;
        const layer = this.pdfLayers.find(l => l.id === id);
        if (layer) layer.opacity = opacity;
        slider.closest('.bm-item-main')?.querySelector('.bm-opacity-val')!
          && (slider.closest('.bm-item-main')!.querySelector('.bm-opacity-val')!.textContent = `${Math.round(opacity * 100)}%`);
        this.mapManager.setLayerOpacity(id, opacity);
      });
    });

    // PDF layer visibility
    container.querySelectorAll<HTMLButtonElement>('.bm-pdf-vis').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pdfid!;
        const layer = this.pdfLayers.find(l => l.id === id);
        if (!layer) return;
        layer.visible = !layer.visible;
        btn.classList.toggle('active', layer.visible);
        this.mapManager.setLayerVisibility(id, layer.visible);
      });
    });

    // PDF layer zoom
    container.querySelectorAll<HTMLButtonElement>('.bm-pdf-zoom').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pdfid!;
        const layer = this.pdfLayers.find(l => l.id === id);
        if (layer?.bounds) {
          const [w, s, e, n] = layer.bounds;
          this.mapManager.fitBounds([[w, s], [e, n]], 50);
        }
      });
    });

    // PDF layer delete
    container.querySelectorAll<HTMLButtonElement>('.bm-pdf-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pdfid!;
        // Remove from map
        this.mapManager.removeLayer(id);
        try { this.mapManager.getMap().removeSource(`src-${id}`); } catch { /* already gone */ }
        // Remove from local list and re-render
        this.pdfLayers = this.pdfLayers.filter(l => l.id !== id);
        this.onDeletePDF?.(id);
        this.renderContent(container, onClose);
      });
    });

    // User layer visibility/opacity/zoom/delete
    container.querySelectorAll<HTMLButtonElement>('.bm-ul-vis').forEach(btn => {
      btn.addEventListener('click', () => {
        const ulid = btn.dataset.ulid!;
        const ul = this.userLayers.find(l => l.mapLayerId === ulid);
        if (!ul) return;
        ul.visible = !ul.visible;
        btn.classList.toggle('active', ul.visible);
        this.mapManager.setLayerVisibility(ulid, ul.visible);
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-ul-opacity').forEach(slider => {
      slider.addEventListener('input', () => {
        const ulid = slider.dataset.ulid!;
        const opacity = parseInt(slider.value) / 100;
        slider.closest('.bm-item-main')?.querySelector('.bm-opacity-val') &&
          (slider.closest('.bm-item-main')!.querySelector('.bm-opacity-val')!.textContent = `${Math.round(opacity * 100)}%`);
        this.mapManager.setLayerOpacity(ulid, opacity);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-ul-zoom').forEach(btn => {
      btn.addEventListener('click', () => {
        const ul = this.userLayers.find(l => l.id === btn.dataset.ulid);
        if (ul?.bounds) {
          const [w, s, e, n] = ul.bounds;
          this.mapManager.fitBounds([[w, s], [e, n]], 50);
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-ul-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ulid!;
        const ul = this.userLayers.find(l => l.id === id);
        if (!ul) return;
        // Remove map layers
        this.mapManager.removeLayer(ul.mapLayerId);
        try { this.mapManager.getMap().removeSource(`src-${ul.mapLayerId}`); } catch { /* already gone */ }
        // Remove sub-layers for vector data
        ['fill', 'line', 'point', 'labels'].forEach(suffix => {
          try { this.mapManager.removeLayer(`${ul.mapLayerId}-${suffix}`); } catch { /* ignore */ }
        });
        this.userLayers = this.userLayers.filter(l => l.id !== id);
        this.onDeleteUserLayer?.(id);
        this.renderContent(container, onClose);
      });
    });

    // Drag-and-drop (mouse)
    const stackEl = container.querySelector<HTMLElement>('#bm-stack')!;
    container.querySelectorAll<HTMLElement>('.bm-stack-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        if (!(e.target as HTMLElement).closest('.bm-drag-handle') &&
            !(e.target as HTMLElement).classList.contains('bm-stack-item')) return;
        this.dragSrcIdx = parseInt(item.dataset.idx!);
        item.classList.add('dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        stackEl.querySelectorAll('.bm-stack-item').forEach(i => i.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        stackEl.querySelectorAll('.bm-stack-item').forEach(i => i.classList.remove('drag-over'));
        item.classList.add('drag-over');
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        const dropIdx = parseInt(item.dataset.idx!);
        if (this.dragSrcIdx === null || this.dragSrcIdx === dropIdx) return;
        const [moved] = this.stack.splice(this.dragSrcIdx, 1);
        this.stack.splice(dropIdx, 0, moved);
        this.dragSrcIdx = null;
        this.rebuildMap();
        this.renderContent(container, onClose);
      });

      // Touch drag
      let touchSrcIdx: number | null = null;
      item.addEventListener('touchstart', e => {
        if (!(e.target as HTMLElement).closest('.bm-drag-handle')) return;
        e.preventDefault();
        touchSrcIdx = parseInt(item.dataset.idx!);
        item.classList.add('dragging');
      }, { passive: false });
      item.addEventListener('touchmove', e => {
        if (touchSrcIdx === null) return;
        e.preventDefault();
        const touch = e.touches[0];
        const items = Array.from(stackEl.querySelectorAll<HTMLElement>('.bm-stack-item'));
        stackEl.querySelectorAll('.bm-stack-item').forEach(i => i.classList.remove('drag-over'));
        for (const other of items) {
          const r = other.getBoundingClientRect();
          if (touch.clientY >= r.top && touch.clientY <= r.bottom) {
            other.classList.add('drag-over'); break;
          }
        }
      }, { passive: false });
      item.addEventListener('touchend', e => {
        if (touchSrcIdx === null) return;
        const touch = e.changedTouches[0];
        const items = Array.from(stackEl.querySelectorAll<HTMLElement>('.bm-stack-item'));
        for (const other of items) {
          const r = other.getBoundingClientRect();
          if (touch.clientY >= r.top && touch.clientY <= r.bottom) {
            const dropIdx = parseInt(other.dataset.idx!);
            if (dropIdx !== touchSrcIdx) {
              const [moved] = this.stack.splice(touchSrcIdx, 1);
              this.stack.splice(dropIdx, 0, moved);
              this.rebuildMap();
              this.renderContent(container, onClose);
            }
            break;
          }
        }
        touchSrcIdx = null;
        item.classList.remove('dragging');
        stackEl.querySelectorAll('.bm-stack-item').forEach(i => i.classList.remove('drag-over'));
      });
    });
  }
}
