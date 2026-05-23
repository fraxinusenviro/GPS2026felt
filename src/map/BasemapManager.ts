import maplibregl from 'maplibre-gl';
import { BASEMAPS, BASEMAP_OVERLAYS, COG_RAMPS } from '../constants';
import type { BasemapDef, ImportedLayer, OnlineLayer, VectorLayerConfig, TileCacheLayerDef, GeoJSONGeometry, LayerPreset, TypePreset, GeometryType, FieldFeature } from '../types';
import { MapManager } from './MapManager';
import { NSPRDVectorLayer } from './NSPRDVectorLayer';
import { NSHNVectorLayer } from './NSHNVectorLayer';
import { HRDEMLayer } from './HRDEMLayer';
import { HRDEM_RAMPS, invertRamp, rampToHorizontalGradient, type ColorRamp } from '../lib/elevationRenderer';
import { EventBus } from '../utils/EventBus';
import { StylePicker } from '../ui/StylePicker';
import { renderSwatchDataUrl } from '../ui/SymbolRenderer';

const BM_STACK_KEY = 'fm2026_bm_stack';
const BM_STACK_PROJECT_KEY = 'fm2026_bm_stack_project';

interface StackLayer {
  instanceId: string;
  defId: string;
  label: string;
  url: string;
  type?: string;
  vector_config?: VectorLayerConfig;
  tileSize: number;
  maxZoom: number;
  opacity: number;
  visible: boolean;
  hueRotate: number;
  saturation: number;
  contrast: number;
  brightness: number;
  vecLineWidth?: number;
  vecFillOpacityOverride?: number;
  vecLineColor?: string;
  vecFillColor?: string;
  cogRampId?: string; // 'original' | key of COG_RAMPS
  cogRampInvert?: boolean;
  cogSmooth?: boolean;
  hrdemRampId?: string;    // key of HRDEM_RAMPS, default 'terrain'
  hrdemRampInvert?: boolean;
  hrdemRasterVisible?:   boolean; // default true
  hrdemContourEnabled?:  boolean; // default false
  hrdemContourInterval?: number;  // default 10 (metres)
  hrdemContourColor?:    string;  // default '#ffffff'
  hrdemContourWidth?:    number;  // default 1.2 (px)
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
  tileUrl?: string; // used when promoting raster layer to the active stack
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
  private onLayerStateChange: ((id: string, updates: { visible?: boolean; opacity?: number }) => void) | null = null;
  // All sections collapsed by default; user expands what they need
  private collapsedSections = new Set<string>([
    'active-layers', 'collected-data', 'feature-layers',
    'basemaps', 'pdfs', 'lidar', 'userlayers',
    ...[...new Set(
      BASEMAP_OVERLAYS.filter(o => o.group)
        .map(o => `group-${o.group!.replace(/\s+/g, '-').toLowerCase()}`)
    )],
  ]);

  private nsprdLayer: NSPRDVectorLayer | null = null;
  private nshnLayers = new Map<string, NSHNVectorLayer>();
  private hrdemLayers = new Map<string, HRDEMLayer>();

  private identifyActive = false;
  private identifyClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private identifyPopup: maplibregl.Popup | null = null;
  private identifyButton: HTMLButtonElement | null = null;

  // Active tile cache — maps defId → bmcache:// URL template
  private activeCacheId: string | null = null;
  private activeCacheLayers: Map<string, string> = new Map();

  // Feature layer presets for the basemap TOC
  private featureLayerPresets: LayerPreset[] = [];
  private onFeatureLayerChange: ((preset: LayerPreset) => void) | null = null;

  // TypePresets for collected data symbology TOC
  private typePresets: TypePreset[] = [];
  private collectedFeatures: FieldFeature[] = [];
  private onTypePresetChange: ((preset: TypePreset) => void) | null = null;
  private stylePicker = new StylePicker();

  private currentProjectId: string = '';

  constructor(private mapManager: MapManager) {}

  // ---- State persistence ----

  private saveStack(): void {
    try {
      // Only persist layers whose defId matches a known definition (not promoted user layers)
      const knownIds = new Set(ALL_DEFS().map(d => d.id));
      const data = JSON.stringify({
        stack: this.stack.filter(l => knownIds.has(l.defId)),
        collapsed: [...this.collapsedSections],
      });
      localStorage.setItem(BM_STACK_KEY, data);
      // Record which project this stack belongs to so reload can detect it
      if (this.currentProjectId) {
        localStorage.setItem(BM_STACK_PROJECT_KEY, this.currentProjectId);
      }
    } catch { /* ignore QuotaExceededError */ }
  }

  private restoreStack(): boolean {
    try {
      const raw = localStorage.getItem(BM_STACK_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { stack?: StackLayer[]; collapsed?: string[] };
      if (!Array.isArray(parsed.stack) || parsed.stack.length === 0) return false;
      this.stack = parsed.stack;
      if (Array.isArray(parsed.collapsed)) {
        this.collapsedSections = new Set(parsed.collapsed);
      }
      return true;
    } catch { return false; }
  }

  /**
   * Called on app startup. Restores from localStorage if it contains data for
   * this project (most-recent session state). Falls back to the project's stored
   * JSON from IndexedDB only when localStorage is empty or belongs to a different
   * project, preventing stale IndexedDB data from overwriting recent changes.
   */
  initForProject(projectId: string, fallbackStackJson?: string): void {
    this.currentProjectId = projectId;
    try {
      const raw = localStorage.getItem(BM_STACK_KEY);
      const lsProjectId = localStorage.getItem(BM_STACK_PROJECT_KEY);
      if (raw && lsProjectId === projectId) {
        const parsed = JSON.parse(raw) as { stack?: StackLayer[]; collapsed?: string[] };
        if (Array.isArray(parsed.stack) && parsed.stack.length > 0) {
          this.stack = parsed.stack;
          if (Array.isArray(parsed.collapsed)) {
            this.collapsedSections = new Set(parsed.collapsed);
          }
          this.rebuildMap();
          return;
        }
      }
    } catch { /* fall through to project JSON */ }

    // No usable localStorage data for this project; use the stored project stack
    if (fallbackStackJson) {
      this.setActiveProjectStack(fallbackStackJson);
    }
  }

  /** Returns the current stack serialized to JSON (for project persistence). */
  getCurrentStackJson(): string {
    try {
      const knownIds = new Set(ALL_DEFS().map(d => d.id));
      return JSON.stringify({
        stack: this.stack.filter(l => knownIds.has(l.defId)),
        collapsed: [...this.collapsedSections],
      });
    } catch { return '{}'; }
  }

  /** Replaces the active stack from a project's stored JSON and mirrors to localStorage. */
  setActiveProjectStack(stackJson: string, projectId?: string): void {
    try {
      const parsed = JSON.parse(stackJson) as { stack?: StackLayer[]; collapsed?: string[] };
      if (Array.isArray(parsed.stack) && parsed.stack.length > 0) {
        if (projectId) this.currentProjectId = projectId;
        this.stack = parsed.stack;
        if (Array.isArray(parsed.collapsed)) {
          this.collapsedSections = new Set(parsed.collapsed);
        }
        this.rebuildMap();
        this.saveStack(); // mirror to localStorage for live buffer
      }
    } catch { /* keep existing stack */ }
  }

  init(basemapId: string): void {
    if (this.restoreStack()) {
      try {
        this.rebuildMap();
        return;
      } catch (e) {
        console.error('[BasemapManager] Saved stack failed to restore, resetting to default:', e);
        try { localStorage.removeItem(BM_STACK_KEY); } catch { /* ignore */ }
      }
    }
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

  setupIdentify(btn: HTMLButtonElement): void {
    this.identifyButton = btn;
    const map = this.mapManager.getMap();

    btn.addEventListener('click', () => {
      this.identifyActive = !this.identifyActive;
      btn.classList.toggle('active', this.identifyActive);
      map.getCanvas().style.cursor = this.identifyActive ? 'crosshair' : '';

      if (this.identifyActive) {
        this.identifyClickHandler = (e) => this.handleIdentifyClick(e);
        map.on('click', this.identifyClickHandler);
      } else {
        if (this.identifyClickHandler) {
          map.off('click', this.identifyClickHandler);
          this.identifyClickHandler = null;
        }
        this.identifyPopup?.remove();
        this.identifyPopup = null;
        this.nsprdLayer?.clearHighlight();
      }
    });
  }

  private getActiveVectorLayerIds(): string[] {
    const map = this.mapManager.getMap();
    const ids: string[] = [];
    if (this.nsprdLayer) ids.push(...this.nsprdLayer.getLayerIds());
    for (const layer of this.nshnLayers.values()) ids.push(...layer.getLayerIds());
    return ids.filter(id => map.getLayer(id));
  }

  private handleIdentifyClick(e: maplibregl.MapMouseEvent): void {
    const map = this.mapManager.getMap();
    const layerIds = this.getActiveVectorLayerIds();
    if (layerIds.length === 0) return;

    const pt = e.point;
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [pt.x - 6, pt.y - 6],
      [pt.x + 6, pt.y + 6],
    ];
    const features = map.queryRenderedFeatures(bbox, { layers: layerIds });
    if (features.length === 0) return;

    // Group by layer instance, deduplicate by OBJECTID within each instance
    const allDefs = ALL_DEFS();
    const groupMap = new Map<string, {
      label: string;
      fieldLabels?: Record<string, string>;
      features: Array<{ props: Record<string, unknown>; geometry: GeoJSONGeometry | null }>;
    }>();
    const nsprdOids: number[] = [];

    for (const feat of features) {
      const rawLayerId = feat.layer.id;
      const iid = rawLayerId.replace(/^bm-ov-/, '').replace(/-stroke$/, '');
      const stackLayer = this.stack.find(l => l.instanceId === iid);

      // Collect NSPRD OIDs for polygon highlight
      if (stackLayer && this.getLayerType(stackLayer) === 'nsprd-vector') {
        const oid = feat.properties?.OBJECTID;
        if (oid !== undefined && oid !== null) {
          const numOid = Number(oid);
          if (!isNaN(numOid) && !nsprdOids.includes(numOid)) nsprdOids.push(numOid);
        }
      }

      const props = (feat.properties ?? {}) as Record<string, unknown>;
      const geometry = (feat.geometry ?? null) as GeoJSONGeometry | null;

      if (groupMap.has(iid)) {
        const existing = groupMap.get(iid)!;
        const oid = props.OBJECTID;
        if (oid && existing.features.some(f => f.props.OBJECTID === oid)) continue;
        existing.features.push({ props, geometry });
      } else {
        const def = stackLayer ? allDefs.find(d => d.id === stackLayer.defId) : undefined;
        groupMap.set(iid, {
          label: def?.label ?? 'Layer',
          fieldLabels: def?.vector_config?.fieldLabels,
          features: [{ props, geometry }],
        });
      }
    }

    // Apply NSPRD polygon highlight
    this.nsprdLayer?.clearHighlight();
    if (nsprdOids.length > 0) this.nsprdLayer?.highlightFeatures(nsprdOids);

    const groups = [...groupMap.values()];
    const html = this.buildIdentifyHtml(groups);

    this.identifyPopup?.remove();
    this.identifyPopup = new maplibregl.Popup({ className: 'fm-identify-popup', maxWidth: '320px', closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);

    const el = this.identifyPopup.getElement();

    // Wire close button
    el?.querySelector<HTMLElement>('.fm-popup-close')?.addEventListener('click', () => {
      this.identifyPopup?.remove();
      this.identifyPopup = null;
      this.nsprdLayer?.clearHighlight();
    });

    // Wire tab switching
    el?.querySelectorAll<HTMLButtonElement>('.fm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.fm-tab, .fm-tab-panel').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        el.querySelector(`.fm-tab-panel[data-tab="${tab.dataset.tab}"]`)?.classList.add('active');
      });
    });

    // Wire add-to-sketch buttons
    el?.querySelectorAll<HTMLButtonElement>('.fm-add-sketch').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabIdx = Number(btn.dataset.tab);
        const featIdx = Number(btn.dataset.feat ?? 0);
        const group = groups[tabIdx];
        const feat = group?.features[featIdx];
        if (!feat) return;
        EventBus.emit('add-identify-feature', {
          geometry: feat.geometry,
          label: group.label,
          props: feat.props,
        });
      });
    });
  }

  private buildIdentifyHtml(
    groups: Array<{
      label: string;
      fieldLabels?: Record<string, string>;
      features: Array<{ props: Record<string, unknown>; geometry: GeoJSONGeometry | null }>;
    }>,
  ): string {
    const renderFeatureRows = (feat: { props: Record<string, unknown> }, fieldLabels?: Record<string, string>) => {
      const entries = Object.entries(feat.props).filter(([k]) => k !== 'Shape' && !k.startsWith('SHAPE'));
      const rows = entries.map(([k, v]) => {
        const label = fieldLabels?.[k] ?? k;
        return `<div class="fm-popup-row"><span class="fm-popup-key">${label}</span><span class="fm-popup-val">${v ?? ''}</span></div>`;
      }).join('');
      return rows || '<div class="fm-popup-row fm-popup-empty">No attributes</div>';
    };

    if (groups.length <= 1) {
      // Single-group: flat layout with add-to-sketch
      const g = groups[0];
      if (!g) return '<div class="fm-popup-body"><button class="fm-popup-close" title="Close">✕</button><div class="fm-popup-empty">No features</div></div>';
      const featureBlocks = g.features.map((feat, fi) => `
        <div class="fm-popup-feat-block">
          ${renderFeatureRows(feat, g.fieldLabels)}
          <button class="fm-add-sketch" data-tab="0" data-feat="${fi}" title="Add to sketch layer">＋ Add to sketch</button>
        </div>`).join('<div class="fm-popup-feature-sep"></div>');
      return `<div class="fm-popup-body">
        <button class="fm-popup-close" title="Close">✕</button>
        <div class="fm-popup-title">${g.label}</div>
        ${featureBlocks}
      </div>`;
    }

    // Multi-group: tabs
    const tabs = groups.map((g, i) =>
      `<button class="fm-tab${i === 0 ? ' active' : ''}" data-tab="${i}">${g.label}</button>`
    ).join('');

    const panels = groups.map((g, i) => {
      const featureBlocks = g.features.map((feat, fi) => `
        <div class="fm-popup-feat-block">
          ${renderFeatureRows(feat, g.fieldLabels)}
          <button class="fm-add-sketch" data-tab="${i}" data-feat="${fi}" title="Add to sketch layer">＋ Add to sketch</button>
        </div>`).join('<div class="fm-popup-feature-sep"></div>');
      return `<div class="fm-tab-panel${i === 0 ? ' active' : ''}" data-tab="${i}">
        <div class="fm-popup-title">${g.label}</div>
        ${featureBlocks}
      </div>`;
    }).join('');

    return `<div class="fm-popup-body fm-popup-tabbed">
      <button class="fm-popup-close" title="Close">✕</button>
      <div class="fm-popup-tabs">${tabs}</div>
      ${panels}
    </div>`;
  }

  private addToStack(def: BasemapDef): void {
    const instanceId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    this.stack.unshift({
      instanceId, defId: def.id, label: def.label, url: def.url,
      type: def.type, vector_config: def.vector_config,
      tileSize: def.tile_size ?? 256, maxZoom: def.max_zoom ?? 19,
      opacity: 1.0, visible: true,
      hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    });
    this.rebuildMap();
    this.saveStack();
  }

  private removeFromStack(instanceId: string): void {
    if (this.stack.length <= 1) return;
    this.stack = this.stack.filter(l => l.instanceId !== instanceId);
    this.rebuildMap();
    this.saveStack();
  }

  private addUserLayerToStack(ul: UserLayerInfo, container: HTMLElement, onClose: () => void): void {
    if (!ul.tileUrl) return;
    const instanceId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    this.stack.unshift({
      instanceId, defId: ul.id, label: ul.name, url: ul.tileUrl,
      tileSize: 256, maxZoom: 22,
      opacity: ul.opacity, visible: ul.visible,
      hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    });
    // Remove the original standalone map entry
    try { this.mapManager.removeLayer(ul.mapLayerId); } catch { /* ignore */ }
    try { this.mapManager.getMap().removeSource(`src-${ul.mapLayerId}`); } catch { /* ignore */ }
    this.userLayers = this.userLayers.filter(l => l.id !== ul.id);
    this.rebuildMap();
    this.saveStack();
    this.renderContent(container, onClose);
  }

  private applyVectorStyleOverrides(entry: StackLayer): void {
    const ltype = this.getLayerType(entry);
    if (ltype === 'nsprd-vector') {
      if (entry.vecLineWidth !== undefined) this.nsprdLayer?.setLineWidth(entry.vecLineWidth);
      if (entry.vecLineColor !== undefined) this.nsprdLayer?.setLineColor(entry.vecLineColor);
      if (entry.vecFillColor !== undefined) this.nsprdLayer?.setFillColor(entry.vecFillColor);
      if (entry.vecFillOpacityOverride !== undefined) {
        this.nsprdLayer?.setFillOpacity(entry.vecFillOpacityOverride);
        this.nsprdLayer?.setOpacity(entry.visible ? entry.opacity : 0);
      }
    } else if (ltype === 'nshn-vector') {
      const nshn = this.nshnLayers.get(entry.instanceId);
      if (nshn) {
        if (entry.vecLineWidth !== undefined) nshn.setLineWidth(entry.vecLineWidth);
        if (entry.vecLineColor !== undefined) nshn.setLineColor(entry.vecLineColor);
        if (entry.vecFillColor !== undefined) nshn.setFillColor(entry.vecFillColor);
        if (entry.vecFillOpacityOverride !== undefined) {
          nshn.setFillOpacityOverride(entry.vecFillOpacityOverride);
          nshn.setOpacity(entry.visible ? entry.opacity : 0);
        }
      }
    }
  }

  private getLayerType(l: StackLayer): string {
    const allDefs = ALL_DEFS();
    return allDefs.find(d => d.id === l.defId)?.type ?? l.type ?? 'raster';
  }

  private getVectorConfig(l: StackLayer): VectorLayerConfig | undefined {
    const allDefs = ALL_DEFS();
    return allDefs.find(d => d.id === l.defId)?.vector_config ?? l.vector_config;
  }

  // ---- COG ramp helpers ----

  private static cogUrlFromLayer(layer: StackLayer): string {
    return MapManager.cogUrlFromTemplate(layer.url);
  }

  private applyCogRamp(layer: StackLayer): void {
    const rampId = layer.cogRampId ?? 'original';
    const invert = layer.cogRampInvert ?? false;
    const def = ALL_DEFS().find(d => d.id === layer.defId);
    const origColormap = def?.cog_colormap;
    if (!origColormap) return;

    const cogUrl = BasemapManager.cogUrlFromLayer(layer);
    if (rampId === 'original') {
      const stops = origColormap as [number,number,number,number,number][];
      if (invert) {
        const colors = stops.map(s => [s[1], s[2], s[3], s[4]] as [number,number,number,number]);
        colors.reverse();
        this.mapManager.setCogColormap(cogUrl, stops.map((s, i): [number,number,number,number,number] =>
          [s[0], colors[i][0], colors[i][1], colors[i][2], colors[i][3]]));
      } else {
        this.mapManager.setCogColormap(cogUrl, stops);
      }
      return;
    }
    const ramp = COG_RAMPS[rampId];
    if (!ramp) return;
    const minVal = origColormap[0][0];
    const maxVal = origColormap[origColormap.length - 1][0];
    const srcStops = invert ? [...ramp.stops].reverse() : ramp.stops;
    const stops = srcStops.map((c, i, arr): [number,number,number,number,number] => {
      const t = arr.length > 1 ? i / (arr.length - 1) : 0;
      return [minVal + t * (maxVal - minVal), c[0], c[1], c[2], 255];
    });
    this.mapManager.setCogColormap(cogUrl, stops);
  }

  private applyCogSmooth(layer: StackLayer): void {
    const cogUrl = BasemapManager.cogUrlFromLayer(layer);
    this.mapManager.setCogSmooth(cogUrl, layer.cogSmooth ?? false);
  }

  // ---- HRDEM ramp helpers ----

  private resolveHrdemRamp(layer: StackLayer): ColorRamp {
    const entry = HRDEM_RAMPS[layer.hrdemRampId ?? 'terrain'] ?? HRDEM_RAMPS['terrain'];
    return layer.hrdemRampInvert ? invertRamp(entry.ramp) : entry.ramp;
  }

  private refreshRasterOverlays(): void {
    const overlays = this.stack.slice(0, this.stack.length - 1).reverse();
    this.mapManager.clearAllRasterOverlays();
    for (const l of overlays) {
      const ltype = this.getLayerType(l);
      if (ltype === 'raster') {
        this.mapManager.addSingleRasterOverlay({
          instanceId: l.instanceId,
          url: this.activeCacheLayers.get(l.defId) ?? l.url,
          opacity: l.opacity, visible: l.visible,
          hueRotate: l.hueRotate, saturation: l.saturation, contrast: l.contrast, brightness: l.brightness,
        });
      } else if (ltype === 'nsprd-vector') {
        this.nsprdLayer?.activate(l.instanceId, l.opacity, l.visible);
      } else if (ltype === 'nshn-vector') {
        this.nshnLayers.get(l.instanceId)?.activate(l.instanceId, l.opacity, l.visible);
      }
    }
  }

  // ---- Tile Cache activation ----

  getCacheableLayers(): TileCacheLayerDef[] {
    return this.stack
      .filter(l => {
        const type = this.getLayerType(l);
        return type === 'raster' && !l.url.startsWith('cog://') && !l.url.startsWith('mbtiles://') && !l.url.startsWith('bmcache://');
      })
      .map(l => {
        const isWms = l.url.includes('{bbox-epsg-3857}');
        return {
          defId: l.defId,
          label: l.label,
          urlTemplate: l.url,
          type: isWms ? 'wms' : 'xyz',
        } satisfies TileCacheLayerDef;
      });
  }

  activateCache(cacheId: string, layers: TileCacheLayerDef[]): void {
    this.activeCacheId = cacheId;
    this.activeCacheLayers.clear();
    for (const layer of layers) {
      // bmcache://cacheId/defId/{z}/{x}/{y}
      this.activeCacheLayers.set(layer.defId, `bmcache://${cacheId}/${layer.defId}/{z}/{x}/{y}`);
    }
    this.refreshRasterOverlays();
  }

  deactivateCache(): void {
    this.activeCacheId = null;
    this.activeCacheLayers.clear();
    this.refreshRasterOverlays();
  }

  // ---- PID Search ----

  async searchPID(pid: string): Promise<void> {
    if (!this.nsprdLayer) {
      EventBus.emit('toast', { message: 'Add the NS Property Registry (NSPRD) layer first', type: 'warning' });
      return;
    }
    const result = await this.nsprdLayer.searchByPID(pid);
    if (!result.found || !result.bbox) {
      EventBus.emit('toast', { message: `PID "${pid}" not found`, type: 'warning' });
      return;
    }
    const [w, s, e, n] = result.bbox;
    this.mapManager.fitBounds([[w, s], [e, n]], 80);
    if (result.objectId !== undefined) {
      this.nsprdLayer.highlightFeatures([result.objectId]);
    }
  }

  private rebuildMap(): void {
    if (this.stack.length === 0) return;
    const allDefs = ALL_DEFS();
    const baseLayer = this.stack[this.stack.length - 1];
    const baseDef = allDefs.find(d => d.id === baseLayer.defId) ?? BASEMAPS[0];
    this.mapManager.setBasemap(baseDef);
    this.mapManager.setBasemapOpacity(baseLayer.visible ? (baseLayer.opacity ?? 1) : 0);
    this.mapManager.setBasemapPaint('raster-hue-rotate', baseLayer.hueRotate ?? 0);
    this.mapManager.setBasemapPaint('raster-saturation', baseLayer.saturation ?? 0);
    this.mapManager.setBasemapPaint('raster-contrast', baseLayer.contrast ?? 0);
    this.mapManager.setBasemapPaint('raster-brightness-max', baseLayer.brightness ?? 1);

    // overlays ordered bottom-to-top (index 0 = lowest in UI stack, last = highest)
    const overlays = this.stack.slice(0, this.stack.length - 1).reverse();

    // Clear all raster overlays so they can be re-inserted in the correct unified order
    this.mapManager.clearAllRasterOverlays();

    // Deactivate NSHN layers that are no longer in the stack
    const activeNshnIds = new Set(
      overlays.filter(l => this.getLayerType(l) === 'nshn-vector').map(e => e.instanceId)
    );
    for (const [iid, layer] of this.nshnLayers) {
      if (!activeNshnIds.has(iid)) {
        layer.deactivate();
        this.nshnLayers.delete(iid);
      }
    }

    // Deactivate NSPRD if not in stack
    const hasNsprd = overlays.some(l => this.getLayerType(l) === 'nsprd-vector');
    if (!hasNsprd) this.nsprdLayer?.deactivate();

    // Deactivate HRDEM layers that are no longer in the stack
    const activeHrdemIds = new Set(
      overlays.filter(l => this.getLayerType(l) === 'hrdem-wcs').map(e => e.instanceId)
    );
    for (const [iid, layer] of this.hrdemLayers) {
      if (!activeHrdemIds.has(iid)) {
        layer.deactivate();
        this.hrdemLayers.delete(iid);
      }
    }

    // Process all overlay types in unified bottom-to-top order so map layer positions
    // match the UI stack exactly (last activated ends up closest to user features)
    for (const l of overlays) {
      const ltype = this.getLayerType(l);
      if (ltype === 'raster') {
        this.mapManager.addSingleRasterOverlay({
          instanceId: l.instanceId,
          url: this.activeCacheLayers.get(l.defId) ?? l.url,
          opacity: l.opacity, visible: l.visible,
          hueRotate: l.hueRotate, saturation: l.saturation, contrast: l.contrast, brightness: l.brightness,
        });
        // Re-apply COG ramp / invert / smooth overrides (needed after page reload or project switch)
        if (l.url.startsWith('cog://')) {
          if (l.cogRampId || l.cogRampInvert) this.applyCogRamp(l);
          if (l.cogSmooth) this.applyCogSmooth(l);
        }
      } else if (ltype === 'nsprd-vector') {
        if (!this.nsprdLayer) this.nsprdLayer = new NSPRDVectorLayer(this.mapManager);
        this.nsprdLayer.activate(l.instanceId, l.opacity, l.visible);
        this.applyVectorStyleOverrides(l);
      } else if (ltype === 'nshn-vector') {
        const cfg = this.getVectorConfig(l);
        if (!cfg) continue;
        if (!this.nshnLayers.has(l.instanceId)) {
          this.nshnLayers.set(l.instanceId, new NSHNVectorLayer(this.mapManager, cfg));
        }
        this.nshnLayers.get(l.instanceId)!.activate(l.instanceId, l.opacity, l.visible);
        this.applyVectorStyleOverrides(l);
      } else if (ltype === 'hrdem-wcs') {
        if (!this.hrdemLayers.has(l.instanceId)) {
          this.hrdemLayers.set(l.instanceId, new HRDEMLayer(this.mapManager));
        }
        const hrdemInst = this.hrdemLayers.get(l.instanceId)!;
        hrdemInst.activate(l.instanceId, l.opacity, l.visible, this.resolveHrdemRamp(l));
        hrdemInst.setRasterVisible(l.hrdemRasterVisible ?? true);
        hrdemInst.setContour(
          l.hrdemContourEnabled  ?? false,
          l.hrdemContourInterval ?? 10,
          l.hrdemContourColor    ?? '#ffffff',
          l.hrdemContourWidth    ?? 1.2,
        );
      }
    }
  }

  renderPanel(
    container: HTMLElement,
    onClose: () => void,
    userLayers: UserLayerInfo[] = [],
    pdfLayers: PDFLayerInfo[] = [],
    onDeletePDF?: (id: string) => void,
    onDeleteUserLayer?: (id: string) => void,
    onLayerStateChange?: (id: string, updates: { visible?: boolean; opacity?: number }) => void,
    layerPresets?: LayerPreset[],
    onFeatureLayerChange?: (preset: LayerPreset) => void,
    typePresets?: TypePreset[],
    onTypePresetChange?: (preset: TypePreset) => void,
    features?: FieldFeature[],
  ): void {
    this.userLayers = userLayers;
    this.pdfLayers = pdfLayers;
    this.onDeletePDF = onDeletePDF ?? null;
    this.onDeleteUserLayer = onDeleteUserLayer ?? null;
    this.onLayerStateChange = onLayerStateChange ?? null;
    if (layerPresets !== undefined) this.featureLayerPresets = layerPresets;
    if (onFeatureLayerChange !== undefined) this.onFeatureLayerChange = onFeatureLayerChange;
    if (typePresets !== undefined) this.typePresets = typePresets;
    if (onTypePresetChange !== undefined) this.onTypePresetChange = onTypePresetChange;
    if (features !== undefined) this.collectedFeatures = features;
    if (this.stack.length === 0) this.init('esri-imagery');
    this.renderContent(container, onClose);
  }

  // ---- Palette helpers ----

  private sectionToggle(id: string, label: string, hint: string, isLibrary = false): string {
    const open = !this.collapsedSections.has(id);
    // pencil-ruler for active/collected sections; map+plus for library sections
    const iconSvg = isLibrary
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="flex-shrink:0;opacity:0.65"><path d="M128,16a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm32,96H136v24a8,8,0,0,1-16,0V112H96a8,8,0,0,1,0-16h24V72a8,8,0,0,1,16,0V96h24a8,8,0,0,1,0,16Z"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="flex-shrink:0;opacity:0.8"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>`;
    return `<button class="bm-section-toggle${isLibrary ? ' bm-section-library' : ''}" data-section="${id}" data-open="${open}">
      ${iconSvg}<span class="bm-toggle-label">${label}</span> <span class="bm-section-hint">${hint}</span>
      <span class="bm-toggle-chevron">▾</span>
    </button>`;
  }

  private sectionBody(id: string, content: string): string {
    const open = !this.collapsedSections.has(id);
    return `<div class="bm-section-body" data-section-body="${id}" data-open="${open}">${content}</div>`;
  }

  private renderOverlayPalette(): string {
    const ungrouped = BASEMAP_OVERLAYS.filter(o => !o.group);
    const groupNames = [...new Set(BASEMAP_OVERLAYS.filter(o => o.group).map(o => o.group!))]
      .sort((a, b) => a.localeCompare(b));

    const paletteRows = (items: BasemapDef[]) =>
      `<div class="bm-palette">${items.map(ov => `
        <div class="bm-palette-row">
          <span class="bm-palette-label">${ov.label}</span>
          <button class="bm-add-btn" data-def-id="${ov.id}" title="Add to stack">+</button>
        </div>`).join('')}</div>`;

    let result = '';
    // LiDAR (ungrouped overlays) — own top-level section
    if (ungrouped.length) {
      result += this.sectionToggle('lidar', 'LiDAR Hillshades', 'click + to add', true) +
        this.sectionBody('lidar', paletteRows(ungrouped));
    }
    // Each named group gets its own top-level collapsible section
    for (const g of groupNames) {
      const key = `group-${g.replace(/\s+/g, '-').toLowerCase()}`;
      const items = BASEMAP_OVERLAYS.filter(o => o.group === g);
      result += this.sectionToggle(key, g, 'click + to add', true) +
        this.sectionBody(key, paletteRows(items));
    }
    return result;
  }

  private renderUserLayersSection(): string {
    if (this.userLayers.length === 0) return '';
    const eyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const zoomSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M229.66,218.34,179.6,168.28a88.21,88.21,0,1,0-11.32,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM144,120H120v24a8,8,0,0,1-16,0V120H80a8,8,0,0,1,0-16h24V80a8,8,0,0,1,16,0v24h24a8,8,0,0,1,0,16Z"/></svg>`;

    const body = `<div class="bm-pdf-layers">
      ${this.userLayers.map(l => {
        const badge = (l.fileType ?? l.kind).toUpperCase();
        const canStack = l.kind === 'raster' && !!l.tileUrl;
        return `
        <div class="bm-stack-item" data-ulid="${l.id}">
          <div class="bm-item-main">
            <span class="bm-layer-label" title="${l.name}">${l.name}</span>
            <span class="bm-base-badge" style="background:var(--color-accent-dim,#1a3a2a);color:var(--color-accent,#4ade80);border:1px solid var(--color-accent,#4ade80)">${badge}</span>
            <div class="bm-layer-controls">
              <input type="range" class="bm-opacity-slider bm-ul-opacity" data-ulid="${l.mapLayerId}"
                min="0" max="100" value="${Math.round(l.opacity * 100)}" title="Opacity" />
              <span class="bm-opacity-val">${Math.round(l.opacity * 100)}%</span>
              <button class="bm-vis-btn ${l.visible ? 'active' : ''} bm-ul-vis" data-ulid="${l.mapLayerId}" title="${l.visible ? 'Hide' : 'Show'}">${eyeSvg}</button>
              ${l.bounds ? `<button class="bm-adj-toggle bm-ul-zoom" data-ulid="${l.id}" title="Zoom to layer">${zoomSvg}</button>` : ''}
              ${canStack ? `<button class="bm-add-btn bm-ul-stack" data-ulid="${l.id}" title="Add to active stack" style="width:22px;height:22px;font-size:14px">+</button>` : ''}
              <button class="bm-del-btn bm-ul-del" data-ulid="${l.id}" title="Remove layer">✕</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;

    return this.sectionToggle('userlayers', 'Your Layers', 'imported &amp; online') +
      this.sectionBody('userlayers', body);
  }

  // ---- PDF overlay section ----

  private renderPDFSection(): string {
    if (this.pdfLayers.length === 0) return '';
    const eyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const zoomSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M229.66,218.34,179.6,168.28a88.21,88.21,0,1,0-11.32,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM144,120H120v24a8,8,0,0,1-16,0V120H80a8,8,0,0,1,0-16h24V80a8,8,0,0,1,16,0v24h24a8,8,0,0,1,0,16Z"/></svg>`;
    const body = `<div class="bm-pdf-layers">
      ${this.pdfLayers.map(l => `
        <div class="bm-stack-item" data-pdfid="${l.id}">
          <div class="bm-item-row1">
            <span class="bm-layer-label" title="${l.name}">${l.name}</span>
            <span class="bm-base-badge" style="background:var(--green-mid,#2d6a4f)">PDF</span>
          </div>
          <div class="bm-item-row2">
            <input type="range" class="bm-opacity-slider bm-pdf-opacity" data-pdfid="${l.id}"
              min="0" max="100" value="${Math.round(l.opacity * 100)}" title="Opacity" />
            <span class="bm-opacity-val">${Math.round(l.opacity * 100)}%</span>
            <button class="bm-vis-btn bm-pdf-vis ${l.visible ? 'active' : ''}" data-pdfid="${l.id}" title="${l.visible ? 'Hide' : 'Show'}">${eyeSvg}</button>
            ${l.bounds ? `<button class="bm-adj-toggle bm-pdf-zoom" data-pdfid="${l.id}" title="Zoom to map">${zoomSvg}</button>` : ''}
            <button class="bm-del-btn bm-pdf-del" data-pdfid="${l.id}" title="Delete PDF">✕</button>
          </div>
        </div>
      `).join('')}
    </div>`;
    return this.sectionToggle('pdfs', 'GeoPDF Layers', `${this.pdfLayers.length} loaded`) +
      this.sectionBody('pdfs', body);
  }

  // ---- Collected Data section — stacked type list with feature counts ----

  private renderCollectedDataSection(): string {
    if (this.typePresets.length === 0 && this.collectedFeatures.length === 0) return '';

    // Count features by type label
    const countByType = new Map<string, number>();
    for (const f of this.collectedFeatures) {
      const key = f.type || '(untyped)';
      countByType.set(key, (countByType.get(key) ?? 0) + 1);
    }

    const totalCount = this.collectedFeatures.length;

    const eyeOnSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const eyeOffSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M96.68,57.87a4,4,0,0,1,2.08-6.6A130.13,130.13,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41a8,8,0,0,1,0,6.5c-.35.79-8.82,19.57-27.65,38.4q-4.28,4.26-8.79,8.07a4,4,0,0,1-5.55-.36ZM213.92,210.62a8,8,0,1,1-11.84,10.76L180,197.13A127.21,127.21,0,0,1,128,208c-34.88,0-66.57-13.26-91.66-38.34C17.51,150.83,9,132.05,8.69,131.26a8,8,0,0,1,0-6.5C9,124,17.51,105.18,36.34,86.35a135,135,0,0,1,25-19.78L42.08,45.38A8,8,0,1,1,53.92,34.62Zm-65.49-48.25-52.69-58a40,40,0,0,0,52.69,58Z"/></svg>`;
    const labelOnSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M216,48H40A16,16,0,0,0,24,64V224a15.84,15.84,0,0,0,9.25,14.5A16.05,16.05,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.09-.07L83,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM84,140a12,12,0,1,1,12-12A12,12,0,0,1,84,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,128,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,172,140Z"/></svg>`;

    // Build one row per TypePreset (only those that have matching geometry)
    const rows = this.typePresets.map(p => {
      const count = countByType.get(p.label) ?? 0;
      const swatchUrl = renderSwatchDataUrl(p, 22);
      const geomIcon =
        p.geometry_type === 'Point'      ? '●' :
        p.geometry_type === 'LineString' ? '╌' :
        p.geometry_type === 'Polygon'    ? '▭' : '◈';
      const isVisible = p.visible !== false;
      const showLabels = p.show_labels !== false;

      return `
        <div class="cd-type-row${!isVisible ? ' cd-type-hidden' : ''}">
          <button class="cd-swatch-btn" data-cd-preset-id="${p.id}" title="${p.label} — click to edit style">
            <img src="${swatchUrl}" width="22" height="22" alt="${p.label}" />
          </button>
          <span class="cd-type-geom" title="${p.geometry_type}">${geomIcon}</span>
          <span class="cd-type-label">${p.label}</span>
          <span class="cd-type-count">${count > 0 ? count : '—'}</span>
          <button class="cd-toggle-btn cd-vis-btn${isVisible ? ' active' : ''}" data-cd-vis="${p.id}" title="${isVisible ? 'Hide on map' : 'Show on map'}">${isVisible ? eyeOnSvg : eyeOffSvg}</button>
          <button class="cd-toggle-btn cd-label-btn${showLabels ? ' active' : ''}" data-cd-label="${p.id}" title="${showLabels ? 'Hide labels' : 'Show labels'}">${labelOnSvg}</button>
        </div>`;
    }).join('');

    // Show untyped features if any exist
    const untypedCount = countByType.get('(untyped)') ?? 0;
    const untypedRow = untypedCount > 0 ? `
      <div class="cd-type-row cd-untyped-row">
        <span class="cd-type-geom">◈</span>
        <span class="cd-type-label" style="color:var(--color-text-muted)">(untyped)</span>
        <span class="cd-type-count">${untypedCount}</span>
      </div>` : '';

    const hint = totalCount > 0 ? `${totalCount} features` : 'click swatch to style';

    return this.sectionToggle('collected-data', 'Collected Features', hint) +
      this.sectionBody('collected-data', `<div class="cd-type-list">${rows}${untypedRow}</div>`);
  }

  private wireCollectedData(container: HTMLElement): void {
    const eyeOnSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const eyeOffSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M96.68,57.87a4,4,0,0,1,2.08-6.6A130.13,130.13,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41a8,8,0,0,1,0,6.5c-.35.79-8.82,19.57-27.65,38.4q-4.28,4.26-8.79,8.07a4,4,0,0,1-5.55-.36ZM213.92,210.62a8,8,0,1,1-11.84,10.76L180,197.13A127.21,127.21,0,0,1,128,208c-34.88,0-66.57-13.26-91.66-38.34C17.51,150.83,9,132.05,8.69,131.26a8,8,0,0,1,0-6.5C9,124,17.51,105.18,36.34,86.35a135,135,0,0,1,25-19.78L42.08,45.38A8,8,0,1,1,53.92,34.62Zm-65.49-48.25-52.69-58a40,40,0,0,0,52.69,58Z"/></svg>`;

    container.querySelectorAll<HTMLButtonElement>('[data-cd-preset-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.cdPresetId!;
        const preset = this.typePresets.find(p => p.id === presetId);
        if (!preset) return;
        this.stylePicker.open(preset, (updated: TypePreset) => {
          Object.assign(preset, updated);
          this.onTypePresetChange?.(preset);
        });
      });
    });

    // Visibility toggles
    container.querySelectorAll<HTMLButtonElement>('[data-cd-vis]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cdVis!;
        const preset = this.typePresets.find(p => p.id === id);
        if (!preset) return;
        preset.visible = preset.visible === false ? true : false;
        const isVisible = preset.visible !== false;
        btn.classList.toggle('active', isVisible);
        btn.innerHTML = isVisible ? eyeOnSvg : eyeOffSvg;
        btn.title = isVisible ? 'Hide on map' : 'Show on map';
        btn.closest('.cd-type-row')?.classList.toggle('cd-type-hidden', !isVisible);
        this.onTypePresetChange?.(preset);
      });
    });

    // Label toggles
    container.querySelectorAll<HTMLButtonElement>('[data-cd-label]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.cdLabel!;
        const preset = this.typePresets.find(p => p.id === id);
        if (!preset) return;
        preset.show_labels = preset.show_labels === false ? true : false;
        const showLabels = preset.show_labels !== false;
        btn.classList.toggle('active', showLabels);
        btn.title = showLabels ? 'Hide labels' : 'Show labels';
        this.onTypePresetChange?.(preset);
      });
    });
  }

  // ---- Feature Layers section (collected GPS/sketch data) ----

  private renderFeatureLayersSection(): string {
    const presets = this.featureLayerPresets;
    if (presets.length === 0) return '';

    const geomIcon = (g: string) =>
      g === 'Point'      ? '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="8" cy="8" r="5"/></svg>' :
      g === 'LineString' ? '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 14 L8 4 L14 10"/></svg>' :
                           '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12 L8 2 L14 12 Z"/></svg>';

    const rows = presets.map(lp => {
      const vis = lp.visible !== false;
      const geomType = lp.geometry_type;
      return `
        <div class="fl-row" data-fl-id="${lp.id}">
          <button class="fl-vis-btn${vis ? '' : ' fl-hidden'}" data-fl-vis="${lp.id}" title="Toggle visibility">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              ${vis
                ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'}
            </svg>
          </button>
          <span class="fl-geom-icon" style="color:${lp.color}">${geomIcon(geomType)}</span>
          <span class="fl-name">${lp.name}</span>
          <input type="color" class="fl-color-swatch" data-fl-color="${lp.id}" value="${lp.color}" title="Feature colour" />
          <input type="range" class="fl-opacity-slider" data-fl-opacity="${lp.id}"
            min="0" max="100" step="5" value="${Math.round(lp.fill_opacity * 100)}" title="Opacity" />
          ${geomType === 'LineString' ? `
          <input type="range" class="fl-width-slider" data-fl-width="${lp.id}"
            min="1" max="10" step="0.5" value="${lp.stroke_width}" title="Line width" style="display:none" />` : ''}
        </div>`;
    }).join('');

    return this.sectionToggle('feature-layers', 'Feature Layers', `${presets.length} layers`) +
      this.sectionBody('feature-layers', `<div class="fl-list">${rows}</div>`);
  }

  private wireFeatureLayers(container: HTMLElement): void {
    const findPreset = (id: string) => this.featureLayerPresets.find(lp => lp.id === id);
    const emit = (lp: LayerPreset) => this.onFeatureLayerChange?.(lp);

    container.querySelectorAll<HTMLButtonElement>('[data-fl-vis]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lp = findPreset(btn.dataset.flVis!);
        if (!lp) return;
        lp.visible = !(lp.visible !== false);
        btn.classList.toggle('fl-hidden', !lp.visible);
        btn.innerHTML = lp.visible
          ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M96.68,57.87a4,4,0,0,1,2.08-6.6A130.13,130.13,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41a8,8,0,0,1,0,6.5c-.35.79-8.82,19.57-27.65,38.4q-4.28,4.26-8.79,8.07a4,4,0,0,1-5.55-.36ZM213.92,210.62a8,8,0,1,1-11.84,10.76L180,197.13A127.21,127.21,0,0,1,128,208c-34.88,0-66.57-13.26-91.66-38.34C17.51,150.83,9,132.05,8.69,131.26a8,8,0,0,1,0-6.5C9,124,17.51,105.18,36.34,86.35a135,135,0,0,1,25-19.78L42.08,45.38A8,8,0,1,1,53.92,34.62Zm-65.49-48.25-52.69-58a40,40,0,0,0,52.69,58Z"/></svg>';
        emit(lp);
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-fl-color]').forEach(inp => {
      inp.addEventListener('change', () => {
        const lp = findPreset(inp.dataset.flColor!);
        if (!lp) return;
        lp.color = inp.value;
        lp.stroke_color = inp.value;
        const icon = inp.closest('.fl-row')?.querySelector<HTMLElement>('.fl-geom-icon');
        if (icon) icon.style.color = inp.value;
        emit(lp);
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-fl-opacity]').forEach(inp => {
      inp.addEventListener('input', () => {
        const lp = findPreset(inp.dataset.flOpacity!);
        if (!lp) return;
        lp.fill_opacity = Number(inp.value) / 100;
        emit(lp);
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-fl-width]').forEach(inp => {
      inp.addEventListener('input', () => {
        const lp = findPreset(inp.dataset.flWidth!);
        if (!lp) return;
        lp.stroke_width = Number(inp.value);
        emit(lp);
      });
    });
  }

  // ---- Stack item rendering ----

  private renderStackItem(layer: StackLayer, idx: number): string {
    const isBase = idx === this.stack.length - 1;
    const ltype = this.getLayerType(layer);
    const isVectorLayer = ['nsprd-vector', 'nshn-vector'].includes(ltype);
    const cfg = isVectorLayer ? this.getVectorConfig(layer) : undefined;
    const eyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const adjSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M32,80a8,8,0,0,1,8-8H77.17a28,28,0,0,1,53.66,0H216a8,8,0,0,1,0,16H130.83a28,28,0,0,1-53.66,0H40A8,8,0,0,1,32,80Zm184,88H194.83a28,28,0,0,0-53.66,0H40a8,8,0,0,0,0,16H141.17a28,28,0,0,0,53.66,0H216a8,8,0,0,0,0-16Z"/></svg>`;
    const dragSvg = `<svg viewBox="0 0 10 16" fill="currentColor" width="14" height="22"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="6" r="1.5"/><circle cx="7" cy="6" r="1.5"/><circle cx="3" cy="10" r="1.5"/><circle cx="7" cy="10" r="1.5"/><circle cx="3" cy="14" r="1.5"/><circle cx="7" cy="14" r="1.5"/></svg>`;

    const defaultLineWidth = typeof cfg?.lineWidth === 'number' ? cfg.lineWidth : 1;
    const currentLineWidth = layer.vecLineWidth ?? defaultLineWidth;
    const currentFillOpacity = layer.vecFillOpacityOverride ?? 1.0;
    const defaultLineHex = typeof cfg?.lineColor === 'string' ? cfg.lineColor : '#888888';
    const defaultFillHex = cfg?.fillColor
      ? (typeof cfg.fillColor === 'string' ? cfg.fillColor : '#4488cc')
      : defaultLineHex;
    const currentLineHex = layer.vecLineColor ?? defaultLineHex;
    const currentFillHex = layer.vecFillColor ?? defaultFillHex;

    const vecStylePanel = isVectorLayer ? `
      <div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
        <div class="bm-adj-row">
          <label class="bm-adj-label">Stroke</label>
          <input type="color" class="bm-vec-color bm-vec-lc" data-iid="${layer.instanceId}" value="${currentLineHex}" title="Stroke colour" />
          ${cfg ? `
          <input type="range" class="bm-adj-slider bm-vec-lw" data-iid="${layer.instanceId}"
            min="0.5" max="8" step="0.5" value="${currentLineWidth}" title="Stroke width" />
          <span class="bm-adj-val">${currentLineWidth}px</span>` : ''}
        </div>
        ${cfg?.geomType === 'polygon' ? `
        <div class="bm-adj-row">
          <label class="bm-adj-label">Fill</label>
          <input type="color" class="bm-vec-color bm-vec-fc" data-iid="${layer.instanceId}" value="${currentFillHex}" title="Fill colour" />
          <input type="range" class="bm-adj-slider bm-vec-fo" data-iid="${layer.instanceId}"
            min="0" max="100" step="5" value="${Math.round(currentFillOpacity * 100)}" title="Fill opacity" />
          <span class="bm-adj-val">${Math.round(currentFillOpacity * 100)}%</span>
        </div>` : ''}
      </div>` : '';

    const isHrdem = ltype === 'hrdem-wcs';
    const hrdemRampId       = layer.hrdemRampId          ?? 'terrain';
    const hrdemInvert       = layer.hrdemRampInvert      ?? false;
    const hrdemRasterVis    = layer.hrdemRasterVisible   ?? true;
    const hrdemContourEn    = layer.hrdemContourEnabled  ?? false;
    const hrdemContourIvl   = layer.hrdemContourInterval ?? 10;
    const hrdemContourCol   = layer.hrdemContourColor    ?? '#ffffff';
    const hrdemContourWid   = layer.hrdemContourWidth    ?? 1.2;
    const hrdemRampEntry    = HRDEM_RAMPS[hrdemRampId] ?? HRDEM_RAMPS['terrain'];
    const hrdemGradient     = rampToHorizontalGradient(hrdemInvert ? invertRamp(hrdemRampEntry.ramp) : hrdemRampEntry.ramp);
    const inputStyle        = 'font-size:11px;background:var(--bg-2,#1a2a1a);color:var(--fg-1,#ccc);border:1px solid var(--border,#444);border-radius:3px;padding:2px 4px';
    const hrdemAdjPanel = isHrdem ? `
      <div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
        <div class="bm-adj-row">
          <label class="bm-adj-label">Ramp</label>
          <select class="bm-hrdem-ramp" data-iid="${layer.instanceId}" style="flex:1;min-width:0;${inputStyle}">
            ${Object.entries(HRDEM_RAMPS).map(([k, r]) => `<option value="${k}"${hrdemRampId === k ? ' selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </div>
        <div class="bm-adj-row">
          <label class="bm-adj-label"></label>
          <div class="bm-hrdem-ramp-preview" data-iid="${layer.instanceId}" style="flex:1;height:10px;border-radius:3px;border:1px solid var(--border,#444);background:${hrdemGradient}"></div>
        </div>
        <div class="bm-adj-row">
          <label class="bm-adj-label"></label>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-invert" data-iid="${layer.instanceId}"${hrdemInvert ? ' checked' : ''} />
            Invert ramp
          </label>
        </div>
        <div class="bm-adj-row" style="font-size:10px;color:var(--fg-2,#888);opacity:0.7;padding-top:2px">
          <label class="bm-adj-label"></label>
          <span>Stretch: auto min–max per view</span>
        </div>
        <div class="bm-adj-row">
          <label class="bm-adj-label"></label>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-raster-vis" data-iid="${layer.instanceId}"${hrdemRasterVis ? ' checked' : ''} />
            Show raster
          </label>
        </div>
        <div class="bm-adj-row" style="margin-top:6px;border-top:1px solid var(--border,#444);padding-top:5px">
          <label class="bm-adj-label" style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;opacity:.55">Contours</label>
        </div>
        <div class="bm-adj-row">
          <label class="bm-adj-label"></label>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-contour-en" data-iid="${layer.instanceId}"${hrdemContourEn ? ' checked' : ''} />
            Show contour lines
          </label>
        </div>
        <div class="bm-hrdem-contour-cfg" data-iid="${layer.instanceId}" style="${hrdemContourEn ? '' : 'display:none'}">
          <div class="bm-adj-row">
            <label class="bm-adj-label">Interval</label>
            <input type="number" class="bm-hrdem-contour-ivl" data-iid="${layer.instanceId}"
              value="${hrdemContourIvl}" min="0.1" max="500" step="0.1"
              style="width:52px;${inputStyle}" />
            <span style="font-size:10px;opacity:.6;margin-left:3px">m</span>
          </div>
          <div class="bm-adj-row">
            <label class="bm-adj-label">Line colour</label>
            <input type="color" class="bm-hrdem-contour-col" data-iid="${layer.instanceId}" value="${hrdemContourCol}" />
          </div>
          <div class="bm-adj-row">
            <label class="bm-adj-label">Width</label>
            <input type="range" class="bm-adj-slider bm-hrdem-contour-wid" data-iid="${layer.instanceId}"
              min="0.5" max="5" step="0.5" value="${hrdemContourWid}" />
            <span class="bm-adj-val bm-hrdem-contour-wid-val" data-iid="${layer.instanceId}">${hrdemContourWid}px</span>
          </div>
        </div>
      </div>` : '';

    const isCog = layer.url.startsWith('cog://');
    const cogRampId = layer.cogRampId ?? 'original';
    const cogRampInvert = layer.cogRampInvert ?? false;
    const cogSmooth = layer.cogSmooth ?? false;
    const buildGradient = (rampId: string, invert: boolean): string => {
      let stops: string[];
      if (rampId === 'original') {
        const def = ALL_DEFS().find(d => d.id === layer.defId);
        const cm = def?.cog_colormap;
        if (!cm) return '';
        stops = cm.map(s => `rgba(${s[1]},${s[2]},${s[3]},${s[4]/255})`);
      } else {
        const ramp = COG_RAMPS[rampId];
        if (!ramp) return '';
        stops = ramp.stops.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
      }
      if (invert) stops = [...stops].reverse();
      return `linear-gradient(to right,${stops.join(',')})`;
    };
    const cogRampGradient = isCog ? buildGradient(cogRampId, cogRampInvert) : '';
    const cogRampRow = isCog ? `
      <div class="bm-adj-row">
        <label class="bm-adj-label">Ramp</label>
        <select class="bm-cog-ramp" data-iid="${layer.instanceId}" style="flex:1;min-width:0;font-size:11px;background:var(--bg-2,#1a2a1a);color:var(--fg-1,#ccc);border:1px solid var(--border,#444);border-radius:3px;padding:2px 4px">
          <option value="original"${cogRampId==='original'?' selected':''}>Original</option>
          ${Object.entries(COG_RAMPS).map(([k,r])=>`<option value="${k}"${cogRampId===k?' selected':''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="bm-adj-row">
        <label class="bm-adj-label"></label>
        <div class="bm-ramp-preview" data-iid="${layer.instanceId}" style="flex:1;height:10px;border-radius:3px;border:1px solid var(--border,#444);background:${cogRampGradient}"></div>
      </div>
      <div class="bm-adj-row">
        <label class="bm-adj-label"></label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg-2,#888);cursor:pointer">
          <input type="checkbox" class="bm-cog-invert" data-iid="${layer.instanceId}"${cogRampInvert?' checked':''} />
          Invert ramp
        </label>
      </div>
      <div class="bm-adj-row">
        <label class="bm-adj-label"></label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg-2,#888);cursor:pointer">
          <input type="checkbox" class="bm-cog-smooth" data-iid="${layer.instanceId}"${cogSmooth?' checked':''} />
          Smooth
        </label>
      </div>` : '';

    const hasStylePanel = isVectorLayer ? (cfg !== undefined) : true;
    const adjTitle = isVectorLayer ? 'Style options' : isHrdem ? 'Elevation style' : 'Image adjustments';

    return `
      <div class="bm-stack-item ${isBase ? 'bm-base-item' : ''}"
           draggable="true" data-idx="${idx}" data-iid="${layer.instanceId}">
        <div class="bm-item-row1">
          <div class="bm-drag-handle" title="Drag to reorder">${dragSvg}</div>
          <span class="bm-layer-label" title="${layer.label}">${layer.label}</span>
          ${isBase ? '<span class="bm-base-badge">BASE</span>' : ''}
        </div>
        <div class="bm-item-row2">
          <input type="range" class="bm-opacity-slider" data-iid="${layer.instanceId}"
            min="0" max="100" value="${Math.round(layer.opacity * 100)}" title="Opacity" />
          <span class="bm-opacity-val">${Math.round(layer.opacity * 100)}%</span>
          <button class="bm-vis-btn ${layer.visible ? 'active' : ''}" data-iid="${layer.instanceId}" title="${layer.visible ? 'Hide' : 'Show'}">${eyeSvg}</button>
          ${hasStylePanel ? `<button class="bm-adj-toggle" data-iid="${layer.instanceId}" title="${adjTitle}">${adjSvg}</button>` : ''}
          ${this.stack.length > 1 ? `<button class="bm-del-btn" data-iid="${layer.instanceId}" title="Remove">✕</button>` : ''}
        </div>
        ${isVectorLayer ? vecStylePanel : isHrdem ? hrdemAdjPanel : `<div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
          ${cogRampRow}
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
        </div>`}
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

        ${this.sectionToggle('active-layers', 'Active Layers', 'drag to reorder · top = drawn on top', false)}
        ${this.sectionBody('active-layers', `<div class="bm-stack" id="bm-stack">
          ${this.stack.map((layer, idx) => this.renderStackItem(layer, idx)).join('')}
        </div>`)}

        ${this.renderCollectedDataSection()}
        ${this.renderUserLayersSection()}

        ${this.sectionToggle('basemaps', 'Standard Basemaps', 'click + to add', true)}
        ${this.sectionBody('basemaps', `<div class="bm-palette">
          ${BASEMAPS.map(bm => `
            <div class="bm-palette-row">
              <img class="bm-thumb" src="${thumbUrl(bm.url)}" loading="lazy"
                onerror="this.style.display='none'" alt="" />
              <span class="bm-palette-label">${bm.label}</span>
              <button class="bm-add-btn" data-def-id="${bm.id}" title="Add to stack">+</button>
            </div>
          `).join('')}
        </div>`)}

        ${this.renderOverlayPalette()}
        ${this.renderPDFSection()}

      </div>
    `;

    container.querySelector('#bm-close')?.addEventListener('click', onClose);
    this.wireCollectedData(container);
    this.wireContent(container, onClose);
  }

  // ---- Event wiring ----

  private wireContent(container: HTMLElement, onClose: () => void): void {
    const allDefs = ALL_DEFS();

    // Collapse section toggles
    container.querySelectorAll<HTMLButtonElement>('.bm-section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.section!;
        if (this.collapsedSections.has(id)) this.collapsedSections.delete(id);
        else this.collapsedSections.add(id);
        this.saveStack();
        this.renderContent(container, onClose);
      });
    });

    // Add to stack from palette
    container.querySelectorAll<HTMLButtonElement>('.bm-add-btn:not(.bm-ul-stack)').forEach(btn => {
      btn.addEventListener('click', () => {
        const def = allDefs.find(d => d.id === btn.dataset.defId);
        if (def) { this.addToStack(def); this.renderContent(container, onClose); }
      });
    });

    // Promote user layer to active stack
    container.querySelectorAll<HTMLButtonElement>('.bm-ul-stack').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ulid!;
        const ul = this.userLayers.find(l => l.id === id);
        if (ul) this.addUserLayerToStack(ul, container, onClose);
      });
    });

    // Opacity sliders (stack items)
    container.querySelectorAll<HTMLInputElement>('.bm-opacity-slider:not(.bm-pdf-opacity):not(.bm-ul-opacity)').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const opacity = parseInt(slider.value) / 100;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.opacity = opacity;
        const valEl = slider.closest('.bm-stack-item')?.querySelector('.bm-opacity-val');
        if (valEl) valEl.textContent = `${Math.round(opacity * 100)}%`;
        const isBase = iid === this.stack[this.stack.length - 1]?.instanceId;
        const ltype = this.getLayerType(layer);
        if (isBase) this.mapManager.setBasemapOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'nsprd-vector') this.nsprdLayer?.setOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'nshn-vector') this.nshnLayers.get(iid)?.setOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'hrdem-wcs') this.hrdemLayers.get(iid)?.setOpacity(layer.visible ? opacity : 0);
        else this.mapManager.setBasemapOverlayOpacity(iid, layer.visible ? opacity : 0);
        this.saveStack();
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
        const ltype2 = this.getLayerType(layer);
        if (isBase) this.mapManager.setBasemapOpacity(layer.visible ? layer.opacity : 0);
        else if (ltype2 === 'nsprd-vector') this.nsprdLayer?.setVisible(layer.visible);
        else if (ltype2 === 'nshn-vector') this.nshnLayers.get(iid)?.setVisible(layer.visible);
        else if (ltype2 === 'hrdem-wcs') this.hrdemLayers.get(iid)?.setVisible(layer.visible);
        else this.mapManager.setBasemapOverlayVisible(iid, layer.visible);
        this.saveStack();
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
        this.saveStack();
      });
    });

    // COG ramp picker
    const updateCogPreview = (iid: string) => {
      const layer = this.stack.find(l => l.instanceId === iid);
      if (!layer) return;
      const rampId = layer.cogRampId ?? 'original';
      const invert = layer.cogRampInvert ?? false;
      let stops: string[];
      if (rampId === 'original') {
        const def = ALL_DEFS().find(d => d.id === layer.defId);
        const cm = def?.cog_colormap;
        stops = cm ? cm.map(s => `rgba(${s[1]},${s[2]},${s[3]},${s[4]/255})`) : [];
      } else {
        const ramp = COG_RAMPS[rampId];
        stops = ramp ? ramp.stops.map(c => `rgb(${c[0]},${c[1]},${c[2]})`) : [];
      }
      if (invert) stops = [...stops].reverse();
      const gradient = stops.length ? `linear-gradient(to right,${stops.join(',')})` : '';
      const preview = container.querySelector<HTMLElement>(`.bm-ramp-preview[data-iid="${iid}"]`);
      if (preview && gradient) preview.style.background = gradient;
    };

    container.querySelectorAll<HTMLSelectElement>('.bm-cog-ramp').forEach(sel => {
      sel.addEventListener('change', () => {
        const iid = sel.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.cogRampId = sel.value;
        updateCogPreview(iid);
        this.applyCogRamp(layer);
        this.refreshRasterOverlays();
        this.saveStack();
      });
    });

    // COG ramp invert toggle
    container.querySelectorAll<HTMLInputElement>('.bm-cog-invert').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.cogRampInvert = chk.checked;
        updateCogPreview(iid);
        this.applyCogRamp(layer);
        this.refreshRasterOverlays();
        this.saveStack();
      });
    });

    // COG smooth toggle
    container.querySelectorAll<HTMLInputElement>('.bm-cog-smooth').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.cogSmooth = chk.checked;
        this.applyCogSmooth(layer);
        this.refreshRasterOverlays();
        this.saveStack();
      });
    });

    // HRDEM ramp picker
    const updateHrdemPreview = (iid: string, layer: StackLayer) => {
      const entry = HRDEM_RAMPS[layer.hrdemRampId ?? 'terrain'] ?? HRDEM_RAMPS['terrain'];
      const ramp = layer.hrdemRampInvert ? invertRamp(entry.ramp) : entry.ramp;
      const gradient = rampToHorizontalGradient(ramp);
      const preview = container.querySelector<HTMLElement>(`.bm-hrdem-ramp-preview[data-iid="${iid}"]`);
      if (preview) preview.style.background = gradient;
    };

    container.querySelectorAll<HTMLSelectElement>('.bm-hrdem-ramp').forEach(sel => {
      sel.addEventListener('change', () => {
        const iid = sel.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemRampId = sel.value;
        updateHrdemPreview(iid, layer);
        this.hrdemLayers.get(iid)?.setRamp(this.resolveHrdemRamp(layer));
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-invert').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemRampInvert = chk.checked;
        updateHrdemPreview(iid, layer);
        this.hrdemLayers.get(iid)?.setRamp(this.resolveHrdemRamp(layer));
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-raster-vis').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemRasterVisible = chk.checked;
        this.hrdemLayers.get(iid)?.setRasterVisible(chk.checked);
        this.saveStack();
      });
    });

    const applyContour = (iid: string, layer: StackLayer) => {
      this.hrdemLayers.get(iid)?.setContour(
        layer.hrdemContourEnabled  ?? false,
        layer.hrdemContourInterval ?? 10,
        layer.hrdemContourColor    ?? '#ffffff',
        layer.hrdemContourWidth    ?? 1.2,
      );
    };

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-en').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemContourEnabled = chk.checked;
        const cfg = container.querySelector<HTMLElement>(`.bm-hrdem-contour-cfg[data-iid="${iid}"]`);
        if (cfg) cfg.style.display = chk.checked ? '' : 'none';
        applyContour(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-ivl').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemContourInterval = Math.max(0.1, Number(inp.value) || 10);
        applyContour(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-col').forEach(inp => {
      inp.addEventListener('input', () => {
        const iid = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemContourColor = inp.value;
        applyContour(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-wid').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const w = Number(slider.value);
        layer.hrdemContourWidth = w;
        const lbl = container.querySelector<HTMLElement>(`.bm-hrdem-contour-wid-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${w}px`;
        applyContour(iid, layer);
        this.saveStack();
      });
    });

    // Vector style — line width
    container.querySelectorAll<HTMLInputElement>('.bm-vec-lw').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const w = parseFloat(slider.value);
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.vecLineWidth = w;
        const valEl = slider.nextElementSibling as HTMLElement;
        if (valEl) valEl.textContent = `${w}px`;
        const ltype = this.getLayerType(layer);
        if (ltype === 'nsprd-vector') this.nsprdLayer?.setLineWidth(w);
        else if (ltype === 'nshn-vector') this.nshnLayers.get(iid)?.setLineWidth(w);
        this.saveStack();
      });
    });

    // Vector style — fill opacity
    container.querySelectorAll<HTMLInputElement>('.bm-vec-fo').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const fo = parseInt(slider.value) / 100;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.vecFillOpacityOverride = fo;
        const valEl = slider.nextElementSibling as HTMLElement;
        if (valEl) valEl.textContent = `${Math.round(fo * 100)}%`;
        const ltype = this.getLayerType(layer);
        if (ltype === 'nsprd-vector' && this.nsprdLayer) {
          this.nsprdLayer.setFillOpacity(fo);
          this.nsprdLayer.setOpacity(layer.visible ? layer.opacity : 0);
        } else if (ltype === 'nshn-vector') {
          const nshn = this.nshnLayers.get(iid);
          if (nshn) {
            nshn.setFillOpacityOverride(fo);
            nshn.setOpacity(layer.visible ? layer.opacity : 0);
          }
        }
        this.saveStack();
      });
    });

    // Vector style — line/stroke colour
    container.querySelectorAll<HTMLInputElement>('.bm-vec-lc').forEach(input => {
      input.addEventListener('input', () => {
        const iid = input.dataset.iid!;
        const color = input.value;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.vecLineColor = color;
        const ltype = this.getLayerType(layer);
        if (ltype === 'nsprd-vector') this.nsprdLayer?.setLineColor(color);
        else if (ltype === 'nshn-vector') this.nshnLayers.get(iid)?.setLineColor(color);
        this.saveStack();
      });
    });

    // Vector style — fill colour
    container.querySelectorAll<HTMLInputElement>('.bm-vec-fc').forEach(input => {
      input.addEventListener('input', () => {
        const iid = input.dataset.iid!;
        const color = input.value;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.vecFillColor = color;
        const ltype = this.getLayerType(layer);
        if (ltype === 'nsprd-vector') this.nsprdLayer?.setFillColor(color);
        else if (ltype === 'nshn-vector') this.nshnLayers.get(iid)?.setFillColor(color);
        this.saveStack();
      });
    });

    // PDF layer opacity
    container.querySelectorAll<HTMLInputElement>('.bm-pdf-opacity').forEach(slider => {
      slider.addEventListener('input', () => {
        const id = slider.dataset.pdfid!;
        const opacity = parseInt(slider.value) / 100;
        const layer = this.pdfLayers.find(l => l.id === id);
        if (layer) layer.opacity = opacity;
        const valEl = slider.closest('.bm-stack-item')?.querySelector('.bm-opacity-val');
        if (valEl) valEl.textContent = `${Math.round(opacity * 100)}%`;
        this.mapManager.setLayerOpacity(id, opacity);
        this.onLayerStateChange?.(id, { opacity });
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
        this.onLayerStateChange?.(id, { visible: layer.visible });
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
        this.onLayerStateChange?.(ul.id, { visible: ul.visible });
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-ul-opacity').forEach(slider => {
      slider.addEventListener('input', () => {
        const ulid = slider.dataset.ulid!;
        const opacity = parseInt(slider.value) / 100;
        const ul = this.userLayers.find(l => l.mapLayerId === ulid);
        if (ul) ul.opacity = opacity;
        const valEl = slider.closest('.bm-stack-item')?.querySelector('.bm-opacity-val');
        if (valEl) valEl.textContent = `${Math.round(opacity * 100)}%`;
        this.mapManager.setLayerOpacity(ulid, opacity);
        if (ul) this.onLayerStateChange?.(ul.id, { opacity });
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
