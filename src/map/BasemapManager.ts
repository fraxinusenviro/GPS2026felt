import maplibregl from 'maplibre-gl';
import { BASEMAPS, BASEMAP_OVERLAYS, COG_RAMPS } from '../constants';
import type { BasemapDef, ImportedLayer, OnlineLayer, VectorLayerConfig, TileCacheLayerDef, GeoJSONGeometry, LayerPreset, TypePreset, GeometryType, FieldFeature } from '../types';
import type { HrdemContourLayerInfo } from '../io/VectorTileRenderer';
import { MapManager } from './MapManager';
import { NSPRDVectorLayer } from './NSPRDVectorLayer';
import { NSHNVectorLayer } from './NSHNVectorLayer';
import { HRDEMLayer, type HRDEMProduct } from './HRDEMLayer';
import { CogContourLayer } from './CogContourLayer';
import { HRDEM_RAMPS, SLOPE_RAMPS, TPI_RAMPS, CHM_RAMPS, CHM_CLASSES, CHM_CLASS_PALETTES, invertRamp, rampToHorizontalGradient, type ColorRamp } from '../lib/elevationRenderer';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';
import { StylePicker } from '../ui/StylePicker';
import { renderSwatchDataUrl } from '../ui/SymbolRenderer';
import { CutFillLayer } from './CutFillLayer';
import { CutFillRunStore, type CutFillRun } from './CutFillRunStore';
import { computeCutFill, computeDaylightFeatures } from '../lib/cutFillEngine';

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
  hrdemProduct?: string;          // 'elevation'|'slope'|'aspect'|'tpi'|'chm' — default 'elevation'
  hrdemSurface?: string;          // 'dtm'|'dsm' — default 'dtm'
  // Slope styling
  hrdemSlopeRampId?:  string;    // key of SLOPE_RAMPS, default 'classic'
  hrdemSlopeUnit?:    string;    // 'degrees'|'percent', default 'degrees'
  hrdemSlopeStretch?: string;    // 'auto'|'full'|'0-45'|'0-90', default 'auto'
  hrdemSlopeInvert?:  boolean;
  // Aspect styling
  hrdemAspectSat?:    number;    // 0–100, default 80
  hrdemAspectLight?:  number;    // 0–100, default 50
  // TPI styling
  hrdemTpiRampId?:    string;    // key of TPI_RAMPS, default 'rdylbu'
  hrdemTpiStretch?:   string;    // 'symmetric'|'auto', default 'symmetric'
  hrdemTpiInvert?:    boolean;
  // CHM styling
  hrdemChmMode?:      string;    // 'stretch'|'classified', default 'classified'
  hrdemChmRampId?:    string;    // key of CHM_RAMPS, default 'canopy_green'
  hrdemChmInvert?:    boolean;
  hrdemChmClassPaletteId?: string;        // key of CHM_CLASS_PALETTES, default 'structural'
  // COG threshold contour
  cogContourThreshold?:   number;  // default 0.5 (metres for DTW)
  cogContourLineColor?:   string;  // default '#1565c0'
  cogContourLineWidth?:   number;  // default 2.0
  cogContourFillEnabled?: boolean; // default false
  cogContourFillColor?:   string;  // default '#1565c0'
  cogContourFillOpacity?: number;  // default 0.30
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
    'basemaps', 'pdfs', 'lidar', 'userlayers', 'cutfill-runs',
    ...[...new Set(
      BASEMAP_OVERLAYS.filter(o => o.group)
        .map(o => `group-${o.group!.replace(/\s+/g, '-').toLowerCase()}`)
    )],
  ]);

  private nsprdLayer: NSPRDVectorLayer | null = null;
  private nshnLayers = new Map<string, NSHNVectorLayer>();
  private hrdemLayers = new Map<string, HRDEMLayer>();
  private cogContourLayers = new Map<string, CogContourLayer>();
  private cutFillResultProvider: (() => import('../lib/cutFillEngine').CutFillResult | null) | null = null;
  private cutFillLayers = new Map<string, CutFillLayer>();
  private collapsedRuns = new Set<string>();
  private collapsedRunSettings = new Set<string>();
  private panelState: { container: HTMLElement; onClose: () => void } | null = null;
  private unifiedLegendEl: HTMLElement | null = null;
  private unifiedLegendCollapsed = true;

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
  private mapBgColor = '#000000';

  private currentProjectId: string = '';

  constructor(private mapManager: MapManager) {
    // Load persisted background color
    StorageManager.getInstance().getAppSettings().then(s => {
      if (s.map_bg_color) {
        this.mapBgColor = s.map_bg_color;
        this.mapManager.setBackgroundColor(s.map_bg_color);
      }
    }).catch(() => {/* ignore */});

    // Subscribe to C/F run store — sync map layers and re-render open panel
    CutFillRunStore.getInstance().subscribe(() => {
      this.syncCutFillLayers();
      if (this.panelState) {
        this.renderContent(this.panelState.container, this.panelState.onClose);
      }
    });
  }

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
  /** Returns the last-fetched HRDEMResult from the first active HRDEM layer (for elevation picking). */
  getFirstHrdemResult(): import('../lib/hrdemWCS').HRDEMResult | null {
    for (const layer of this.hrdemLayers.values()) {
      const r = layer.getLastResult();
      if (r) return r;
    }
    return null;
  }

  /** Registers a function that returns the current Cut/Fill result for profile overlay. */
  setCutFillResultProvider(fn: (() => import('../lib/cutFillEngine').CutFillResult | null) | null): void {
    this.cutFillResultProvider = fn;
    for (const layer of this.hrdemLayers.values()) {
      layer.setCutFillResultProvider(fn);
    }
  }

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

  /** Returns true if the given definition ID is already present in the active stack. */
  isDefInStack(defId: string): boolean {
    return this.stack.some(l => l.defId === defId);
  }

  /** Public entry-point used by DataLibraryModal to add a layer to the active stack. */
  addDefToStack(def: BasemapDef): void {
    this.addToStack(def);
  }

  private addToStack(def: BasemapDef): void {
    const instanceId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const base: StackLayer = {
      instanceId, defId: def.id, label: def.label, url: def.url,
      type: def.type, vector_config: def.vector_config,
      tileSize: def.tile_size ?? 256, maxZoom: def.max_zoom ?? 19,
      opacity: 1.0, visible: true,
      hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    };
    // Set defaults for COG contour layers
    if (def.type === 'cog-contour') {
      base.cogContourThreshold = def.cog_contour_threshold ?? 50;
    }
    // Apply vector fill opacity default from definition
    if ((def.type === 'nshn-vector' || def.type === 'nsprd-vector') && def.vector_config?.fillOpacity !== undefined) {
      base.vecFillOpacityOverride = def.vector_config.fillOpacity;
    }
    // Set per-product defaults for HRDEM layers
    if (def.type === 'hrdem-wcs') {
      const productMap: Record<string, string> = {
        'hrdem-slope': 'slope', 'hrdem-aspect': 'aspect',
        'hrdem-tpi': 'tpi', 'hrdem-contours': 'elevation',
        'hrdem-chm': 'chm',
      };
      const surfaceMap: Record<string, string> = {
        'hrdem-dsm-elevation': 'dsm',
      };
      base.hrdemProduct = productMap[def.id] ?? 'elevation';
      base.hrdemSurface = surfaceMap[def.id] ?? 'dtm';
      const isContours = def.id === 'hrdem-contours';
      if (isContours) {
        base.hrdemRasterVisible   = false;
        base.hrdemContourEnabled  = true;
        base.hrdemContourInterval = 1;
        base.hrdemContourColor    = '#000000';
        base.hrdemContourWidth    = 0.5;
      } else {
        base.hrdemRasterVisible  = true;
        base.hrdemContourEnabled = false;
      }
    }
    this.stack.unshift(base);
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

  private refreshUnifiedLegend(): void {
    try {
      const visible = this.stack.filter(l => this.getLayerType(l) === 'hrdem-wcs' && l.visible);
      if (visible.length === 0) {
        this.unifiedLegendEl?.remove();
        this.unifiedLegendEl = null;
        return;
      }
      if (!this.unifiedLegendEl) {
        const container = this.mapManager.getMap().getContainer();
        const el = document.createElement('div');
        el.id = 'hrdem-unified-legend';
        el.style.cssText = [
          'position:absolute', 'bottom:36px', 'left:68px', 'z-index:10',
          'background:rgba(18,36,26,0.78)',
          'border:1px solid rgba(255,255,255,0.12)',
          'border-radius:6px', 'overflow:hidden',
          'font-family:inherit', 'font-size:11px', 'color:#c8d8c8',
          'min-width:90px', 'pointer-events:auto',
          'backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)',
          'box-shadow:0 2px 12px rgba(0,0,0,0.45)',
        ].join(';');
        container.appendChild(el);
        this.unifiedLegendEl = el;
      }
      const el = this.unifiedLegendEl;
      const collapsed = this.unifiedLegendCollapsed;

      const headerHtml = `<div class="hrdem-legend-hdr" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px 4px 10px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer;user-select:none">
        <span style="font-size:8px;opacity:0.45;letter-spacing:.07em;text-transform:uppercase">Legend</span>
        <button class="hrdem-legend-collapse" style="background:none;border:none;color:#9cb;cursor:pointer;font-size:11px;padding:0 0 0 6px;line-height:1">${collapsed ? '▸' : '▾'}</button>
      </div>`;

      let bodyHtml = '';
      if (!collapsed) {
        const blocks = visible.map(l => {
          const inst = this.hrdemLayers.get(l.instanceId);
          if (!inst) return '';
          const blockInner = inst.getLegendHTML();
          if (!blockInner) return '';   // ← skip layers with no legend content yet
          return `<div style="padding:6px 10px;${visible.indexOf(l) < visible.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.06)' : ''}">
            <div style="font-size:8px;opacity:0.4;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${l.label}</div>
            ${blockInner}
          </div>`;
        }).filter(Boolean).join('');
        bodyHtml = blocks;
      }

      // If all blocks ended up empty, remove the legend container
      if (!bodyHtml && !collapsed) {
        this.unifiedLegendEl?.remove();
        this.unifiedLegendEl = null;
        return;
      }

      el.innerHTML = headerHtml + bodyHtml;

      el.querySelector<HTMLElement>('.hrdem-legend-hdr')?.addEventListener('click', () => {
        this.unifiedLegendCollapsed = !this.unifiedLegendCollapsed;
        this.refreshUnifiedLegend();
      });
    } catch { /* map not ready yet */ }
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

  getVisibleRasterLayers(): { url: string; opacity: number }[] {
    return [...this.stack]
      .reverse()
      .filter(l => l.visible && this.getLayerType(l) === 'raster')
      .map(l => ({
        url: this.activeCacheLayers.get(l.defId) ?? l.url,
        opacity: l.opacity,
      }));
  }

  getVisibleVectorLayers(): Array<{
    opacity: number;
    config: VectorLayerConfig;
    lineColorOverride?: string;
    fillColorOverride?: string;
    lineWidthOverride?: number;
    fillOpacityOverride?: number;
  }> {
    return [...this.stack]
      .reverse()
      .filter(l => {
        if (!l.visible || !l.vector_config) return false;
        const t = this.getLayerType(l);
        return t === 'nsprd-vector' || t === 'nshn-vector';
      })
      .map(l => ({
        opacity: l.opacity,
        config: l.vector_config!,
        lineColorOverride: l.vecLineColor,
        fillColorOverride: l.vecFillColor,
        lineWidthOverride: l.vecLineWidth,
        fillOpacityOverride: l.vecFillOpacityOverride,
      }));
  }

  getVisibleHrdemContourLayers(): HrdemContourLayerInfo[] {
    return [...this.stack]
      .reverse()
      .filter(l => l.visible && this.getLayerType(l) === 'hrdem-wcs' && l.hrdemContourEnabled)
      .map(l => ({
        opacity: l.opacity,
        surface: (l.hrdemSurface ?? 'dtm') as 'dtm' | 'dsm',
        contourInterval: l.hrdemContourInterval ?? 10,
        contourColor: l.hrdemContourColor ?? '#ffffff',
        contourWidth: l.hrdemContourWidth ?? 1.2,
      }));
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

    // Deactivate COG contour layers that are no longer in the stack
    const activeCcIds = new Set(
      overlays.filter(l => this.getLayerType(l) === 'cog-contour').map(e => e.instanceId)
    );
    for (const [iid, layer] of this.cogContourLayers) {
      if (!activeCcIds.has(iid)) {
        layer.deactivate();
        this.cogContourLayers.delete(iid);
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
          const newLayer = new HRDEMLayer(this.mapManager);
          newLayer.setCutFillResultProvider(this.cutFillResultProvider);
          this.hrdemLayers.set(l.instanceId, newLayer);
        }
        const hrdemInst = this.hrdemLayers.get(l.instanceId)!;
        hrdemInst.onLegendUpdate = () => this.refreshUnifiedLegend();
        const isContourLayer = l.defId === 'hrdem-contours' || l.defId === 'hrdem-dsm-contours';
        hrdemInst.activate(l.instanceId, l.opacity, l.visible, this.resolveHrdemRamp(l));
        hrdemInst.setRasterVisible(l.hrdemRasterVisible ?? true);
        hrdemInst.setContour(
          l.hrdemContourEnabled  ?? false,
          l.hrdemContourInterval ?? (isContourLayer ? 1 : 10),
          l.hrdemContourColor    ?? (isContourLayer ? '#000000' : '#ffffff'),
          l.hrdemContourWidth    ?? (isContourLayer ? 0.5 : 1.2),
        );
        hrdemInst.setSurface(l.hrdemSurface ?? 'dtm');
        hrdemInst.setProduct((l.hrdemProduct ?? 'elevation') as HRDEMProduct);
        hrdemInst.setProductStyle({
          slopeRampId:  l.hrdemSlopeRampId  ?? 'classic',
          slopeUnit:    (l.hrdemSlopeUnit    ?? 'degrees') as 'degrees' | 'percent',
          slopeStretch: (l.hrdemSlopeStretch ?? 'auto') as 'auto' | 'full' | '0-45' | '0-90',
          slopeInvert:  l.hrdemSlopeInvert   ?? false,
          aspectSat:    (l.hrdemAspectSat    ?? 80) / 100,
          aspectLight:  (l.hrdemAspectLight  ?? 50) / 100,
          tpiRampId:    l.hrdemTpiRampId     ?? 'rdylbu',
          tpiStretch:   (l.hrdemTpiStretch   ?? 'symmetric') as 'symmetric' | 'auto',
          tpiInvert:    l.hrdemTpiInvert     ?? false,
          chmMode:      (l.hrdemChmMode      ?? 'classified') as 'stretch' | 'classified',
          chmRampId:    l.hrdemChmRampId     ?? 'canopy_green',
          chmInvert:    l.hrdemChmInvert     ?? false,
        });
      } else if (ltype === 'cog-contour') {
        if (!this.cogContourLayers.has(l.instanceId)) {
          this.cogContourLayers.set(l.instanceId, new CogContourLayer(this.mapManager, l.url));
        }
        const cc = this.cogContourLayers.get(l.instanceId)!;
        cc.activate(l.instanceId, l.opacity, l.visible);
        cc.setThreshold(l.cogContourThreshold ?? 50);
        cc.setLineStyle(l.cogContourLineColor ?? '#1565c0', l.cogContourLineWidth ?? 2.0);
        cc.setFill(
          l.cogContourFillEnabled ?? false,
          l.cogContourFillColor   ?? '#1565c0',
          l.cogContourFillOpacity ?? 0.30,
        );
      }
    }
    this.refreshUnifiedLegend();
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
    this.panelState = { container, onClose };
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

  private renderMapDisplaySection(): string {
    return this.sectionToggle('map-display', 'Map Display', 'appearance settings') +
      this.sectionBody('map-display', `
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0 2px">
          <span style="font-size:11px;color:var(--color-text-muted);flex:1">Background color</span>
          <input type="color" id="bm-bg-color-input" value="${this.mapBgColor}"
            style="width:32px;height:22px;padding:1px 2px;border:1px solid rgba(91,175,130,0.3);border-radius:4px;cursor:pointer;background:none" />
          <span id="bm-bg-color-value" style="font-size:10px;color:var(--color-text-muted);width:48px">${this.mapBgColor}</span>
        </div>
      `);
  }

  private wireMapDisplay(container: HTMLElement): void {
    const input = container.querySelector<HTMLInputElement>('#bm-bg-color-input');
    const label = container.querySelector<HTMLElement>('#bm-bg-color-value');
    input?.addEventListener('input', async () => {
      const color = input.value;
      this.mapBgColor = color;
      if (label) label.textContent = color;
      this.mapManager.setBackgroundColor(color);
      const settings = await StorageManager.getInstance().getAppSettings();
      settings.map_bg_color = color;
      await StorageManager.getInstance().saveAppSettings(settings);
    });
  }

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
          <span class="fl-geom-icon">${geomIcon(geomType)}</span>
          <span class="fl-name">${lp.name}</span>
        </div>`;
    }).join('');

    return this.sectionToggle('feature-layers', 'Field Data', `${presets.length} layers`) +
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
          <input type="number" class="bm-width-num bm-vec-lw" data-iid="${layer.instanceId}"
            min="0.5" max="8" step="0.5" value="${currentLineWidth}" title="Stroke width"
            inputmode="decimal" style="width:44px" />` : ''}
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

    const isCogContour = ltype === 'cog-contour';
    const ccThreshold   = layer.cogContourThreshold   ?? 50;
    const ccLineColor   = layer.cogContourLineColor   ?? '#1565c0';
    const ccLineWidth   = layer.cogContourLineWidth   ?? 2.0;
    const ccFillEn      = layer.cogContourFillEnabled ?? false;
    const ccFillColor   = layer.cogContourFillColor   ?? '#1565c0';
    const ccFillOpacity = layer.cogContourFillOpacity ?? 0.30;

    const inSt = `background:var(--input-bg,#1a2a1e);color:var(--fg,#e8f5e9);border:1px solid var(--border,#444);border-radius:3px;padding:2px 4px;font-size:11px`;
    const cogContourAdjPanel = isCogContour ? `
      <div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
        <div class="bm-adj-row">
          <label class="bm-adj-label">Threshold</label>
          <input type="number" class="bm-cc-threshold" data-iid="${layer.instanceId}"
            value="${ccThreshold}" min="1" max="10000" step="0.5" style="width:54px;${inSt}"
            inputmode="decimal" />
          <span style="font-size:10px;opacity:.55;margin-left:3px">cm</span>
        </div>
        <div class="bm-adj-row">
          <label class="bm-adj-label">Line</label>
          <input type="color" class="bm-cc-line-color" data-iid="${layer.instanceId}"
            value="${ccLineColor}" title="Line colour"
            style="width:26px;height:22px;padding:1px;border-radius:3px;border:1px solid var(--border,#444);cursor:pointer;background:none" />
          <input type="number" class="bm-width-num bm-cc-line-width" data-iid="${layer.instanceId}"
            min="0.5" max="6" step="0.5" value="${ccLineWidth}" title="Line width"
            inputmode="decimal" />
        </div>
        <div class="bm-adj-row">
          <label class="bm-adj-label">Fill ≤ t</label>
          <input type="checkbox" class="bm-cc-fill-en" data-iid="${layer.instanceId}"${ccFillEn ? ' checked' : ''}
            style="margin-right:4px" />
          <input type="color" class="bm-cc-fill-color" data-iid="${layer.instanceId}"
            value="${ccFillColor}" title="Fill colour"
            style="width:26px;height:22px;padding:1px;border-radius:3px;border:1px solid var(--border,#444);cursor:pointer;background:none" />
          <input type="range" class="bm-cc-fill-opacity" data-iid="${layer.instanceId}"
            min="0" max="100" step="5" value="${Math.round(ccFillOpacity * 100)}"
            style="flex:1;accent-color:var(--color-accent);height:14px" />
          <span class="bm-cc-fo-val" data-iid="${layer.instanceId}"
            style="font-size:10px;opacity:.55;width:30px">${Math.round(ccFillOpacity * 100)}%</span>
        </div>
      </div>` : '';

    const isHrdem = ltype === 'hrdem-wcs';
    const hrdemProduct      = layer.hrdemProduct         ?? (layer.defId === 'hrdem-slope' ? 'slope' : layer.defId === 'hrdem-aspect' ? 'aspect' : layer.defId === 'hrdem-tpi' ? 'tpi' : 'elevation');
    const hrdemRampId       = layer.hrdemRampId          ?? 'terrain';
    const hrdemInvert       = layer.hrdemRampInvert      ?? false;
    const hrdemRasterVis    = layer.hrdemRasterVisible   ?? (layer.defId === 'hrdem-contours' ? false : true);
    const hrdemContourEn    = layer.hrdemContourEnabled  ?? (layer.defId === 'hrdem-contours' ? true : false);
    const isContourDef      = layer.defId === 'hrdem-contours' || layer.defId === 'hrdem-dsm-contours';
    const hrdemContourIvl   = layer.hrdemContourInterval ?? (isContourDef ? 1 : 10);
    const hrdemContourCol   = layer.hrdemContourColor    ?? (isContourDef ? '#000000' : '#ffffff');
    const hrdemContourWid   = layer.hrdemContourWidth    ?? (isContourDef ? 0.5 : 1.2);
    const hrdemSlopeRampId  = layer.hrdemSlopeRampId     ?? 'classic';
    const hrdemSlopeUnit    = layer.hrdemSlopeUnit        ?? 'degrees';
    const hrdemSlopeStretch = layer.hrdemSlopeStretch    ?? 'auto';
    const hrdemSlopeInvert  = layer.hrdemSlopeInvert     ?? false;
    const hrdemAspectSat    = layer.hrdemAspectSat       ?? 80;
    const hrdemAspectLight  = layer.hrdemAspectLight     ?? 50;
    const hrdemTpiRampId    = layer.hrdemTpiRampId       ?? 'rdylbu';
    const hrdemTpiStretch   = layer.hrdemTpiStretch      ?? 'symmetric';
    const hrdemTpiInvert    = layer.hrdemTpiInvert       ?? false;

    const hrdemRampEntry    = HRDEM_RAMPS[hrdemRampId] ?? HRDEM_RAMPS['terrain'];
    const hrdemGradient     = rampToHorizontalGradient(hrdemInvert ? invertRamp(hrdemRampEntry.ramp) : hrdemRampEntry.ramp);
    const slopeRampEntry    = SLOPE_RAMPS[hrdemSlopeRampId] ?? SLOPE_RAMPS['classic'];
    const slopeGradient     = rampToHorizontalGradient(hrdemSlopeInvert ? invertRamp(slopeRampEntry.ramp) : slopeRampEntry.ramp);
    const tpiRampEntry      = TPI_RAMPS[hrdemTpiRampId] ?? TPI_RAMPS['rdylbu'];
    const tpiGradient       = rampToHorizontalGradient(hrdemTpiInvert ? invertRamp(tpiRampEntry.ramp) : tpiRampEntry.ramp);

    const iid = layer.instanceId;
    const S = 'font-size:11px;background:var(--bg-2,#1a2a1a);color:var(--fg-1,#ccc);border:1px solid var(--border,#444);border-radius:3px;padding:2px 4px'; // shared input style

    // Compact reusable chip helper
    const chip = (label: string, active: boolean, cls: string, dataAttrs = '') =>
      `<button class="hdem-chip${active?' hdem-active':''} ${cls}" data-iid="${iid}" ${dataAttrs}>${label}</button>`;

    // Per-product inner panel content
    let hrdemInnerContent = '';

    if (layer.defId === 'hrdem-contours' || layer.defId === 'hrdem-dsm-contours') {
      // Contours-only panel
      hrdemInnerContent = `
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-size:9px;opacity:.55">Interval</span>
          <input type="number" class="bm-hrdem-contour-ivl" data-iid="${iid}" value="${hrdemContourIvl}" min="0.1" max="500" step="0.1" style="width:52px;${S}" inputmode="decimal" />
          <span style="font-size:10px;opacity:.55">m</span>
          <input type="color" class="bm-hrdem-contour-col" data-iid="${iid}" value="${hrdemContourCol}" title="Line colour" style="width:26px;height:22px;padding:1px;border-radius:3px;border:1px solid var(--border,#444);cursor:pointer;background:none" />
        </div>
        <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
          <span style="font-size:9px;opacity:.55">Width</span>
          <input type="number" class="bm-width-num bm-hrdem-contour-wid" data-iid="${iid}" min="0.5" max="5" step="0.5" value="${hrdemContourWid}" inputmode="decimal" style="width:44px" />
        </div>`;

    } else if (layer.defId === 'hrdem-slope' || layer.defId === 'hrdem-dsm-slope') {
      hrdemInnerContent = `
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:5px">
          ${Object.entries(SLOPE_RAMPS).map(([k,r]) => chip(r.label, hrdemSlopeRampId===k, 'bm-hrdem-slope-ramp-chip', `data-ramp="${k}"`)).join('')}
        </div>
        <div class="bm-hrdem-slope-preview" data-iid="${iid}" style="height:7px;border-radius:2px;border:1px solid var(--border,#444);background:${slopeGradient};margin-bottom:6px"></div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-slope-invert" data-iid="${iid}"${hrdemSlopeInvert?' checked':''} /> Invert
          </label>
          <span style="font-size:10px;opacity:.25">|</span>
          <span style="font-size:9px;opacity:.55">Unit</span>
          ${chip('°', hrdemSlopeUnit==='degrees', 'bm-hrdem-slope-unit', 'data-unit="degrees"')}
          ${chip('%', hrdemSlopeUnit==='percent',  'bm-hrdem-slope-unit', 'data-unit="percent"')}
          <span style="font-size:10px;opacity:.25">|</span>
          <span style="font-size:9px;opacity:.55">Stretch</span>
          ${chip('Auto', hrdemSlopeStretch==='auto', 'bm-hrdem-slope-stretch', 'data-stretch="auto"')}
          ${chip('0–45', hrdemSlopeStretch==='0-45', 'bm-hrdem-slope-stretch', 'data-stretch="0-45"')}
          ${chip('Full', hrdemSlopeStretch==='full', 'bm-hrdem-slope-stretch', 'data-stretch="full"')}
        </div>`;

    } else if (layer.defId === 'hrdem-aspect' || layer.defId === 'hrdem-dsm-aspect') {
      hrdemInnerContent = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:40px;height:40px;border-radius:50%;flex-shrink:0;
            background:conic-gradient(from -90deg,hsl(0,${hrdemAspectSat}%,${hrdemAspectLight}%) 0deg,hsl(90,${hrdemAspectSat}%,${hrdemAspectLight}%) 90deg,hsl(180,${hrdemAspectSat}%,${hrdemAspectLight}%) 180deg,hsl(270,${hrdemAspectSat}%,${hrdemAspectLight}%) 270deg,hsl(360,${hrdemAspectSat}%,${hrdemAspectLight}%) 360deg);
            border:1px solid rgba(255,255,255,0.12)" class="bm-hrdem-aspect-rose" data-iid="${iid}"></div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
              <span style="font-size:9px;opacity:.55;width:20px">Sat</span>
              <input type="range" class="bm-hrdem-aspect-sat" data-iid="${iid}" min="0" max="100" step="5" value="${hrdemAspectSat}" style="flex:1;accent-color:var(--color-accent);height:14px" />
              <span class="bm-hrdem-aspect-sat-val" data-iid="${iid}" style="font-size:10px;opacity:.55;width:26px;text-align:right">${hrdemAspectSat}%</span>
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;opacity:.55;width:20px">Lgt</span>
              <input type="range" class="bm-hrdem-aspect-light" data-iid="${iid}" min="20" max="80" step="5" value="${hrdemAspectLight}" style="flex:1;accent-color:var(--color-accent);height:14px" />
              <span class="bm-hrdem-aspect-light-val" data-iid="${iid}" style="font-size:10px;opacity:.55;width:26px;text-align:right">${hrdemAspectLight}%</span>
            </div>
          </div>
        </div>`;

    } else if (layer.defId === 'hrdem-tpi' || layer.defId === 'hrdem-dsm-tpi') {
      hrdemInnerContent = `
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:5px">
          ${Object.entries(TPI_RAMPS).map(([k,r]) => chip(r.label, hrdemTpiRampId===k, 'bm-hrdem-tpi-ramp-chip', `data-ramp="${k}"`)).join('')}
        </div>
        <div class="bm-hrdem-tpi-preview" data-iid="${iid}" style="height:7px;border-radius:2px;border:1px solid var(--border,#444);background:${tpiGradient};margin-bottom:6px"></div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-tpi-invert" data-iid="${iid}"${hrdemTpiInvert?' checked':''} /> Invert
          </label>
          <span style="font-size:10px;opacity:.25">|</span>
          <span style="font-size:9px;opacity:.55">Stretch</span>
          ${chip('Symmetric', hrdemTpiStretch==='symmetric', 'bm-hrdem-tpi-stretch', 'data-stretch="symmetric"')}
          ${chip('Auto',      hrdemTpiStretch==='auto',      'bm-hrdem-tpi-stretch', 'data-stretch="auto"')}
        </div>`;

    } else if (layer.defId === 'hrdem-chm') {
      const chmMode    = layer.hrdemChmMode   ?? 'classified';
      const chmRampId  = layer.hrdemChmRampId ?? 'canopy_green';
      const chmInvert  = layer.hrdemChmInvert ?? false;
      const chmEntry   = CHM_RAMPS[chmRampId] ?? CHM_RAMPS['canopy_green'];
      const chmGrad    = rampToHorizontalGradient(chmInvert ? invertRamp(chmEntry.ramp) : chmEntry.ramp);
      const chmClassPaletteId = layer.hrdemChmClassPaletteId ?? 'structural';
      hrdemInnerContent = `
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px">
          <span style="font-size:9px;opacity:.55">Mode</span>
          ${chip('Stretch',    chmMode==='stretch',    'bm-hrdem-chm-mode', 'data-mode="stretch"')}
          ${chip('Classified', chmMode==='classified', 'bm-hrdem-chm-mode', 'data-mode="classified"')}
        </div>
        <div class="bm-hrdem-chm-stretch-opts" data-iid="${iid}" style="${chmMode==='stretch'?'':'display:none'}">
          <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">
            ${Object.entries(CHM_RAMPS).map(([k,r]) => chip(r.label, chmRampId===k, 'bm-hrdem-chm-ramp-chip', `data-ramp="${k}"`)).join('')}
          </div>
          <div class="bm-hrdem-chm-preview" data-iid="${iid}" style="height:7px;border-radius:2px;border:1px solid var(--border,#444);background:${chmGrad};margin-bottom:4px"></div>
          <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-chm-invert" data-iid="${iid}"${chmInvert?' checked':''} /> Invert
          </label>
        </div>
        <div class="bm-hrdem-chm-class-opts" data-iid="${iid}" style="${chmMode==='classified'?'':'display:none'}">
          <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:5px">
            ${Object.entries(CHM_CLASS_PALETTES).map(([k,p]) => chip(p.label, chmClassPaletteId===k, 'bm-hrdem-chm-class-chip', `data-pal="${k}"`)).join('')}
          </div>
          <div class="bm-hrdem-chm-class-swatches" data-iid="${iid}" style="display:grid;grid-template-columns:14px 1fr;gap:2px 6px;align-items:center">
            ${(CHM_CLASS_PALETTES[chmClassPaletteId]?.classes ?? CHM_CLASSES).map(c=>`<div style="width:14px;height:9px;border-radius:2px;background:rgb(${c.r},${c.g},${c.b})"></div><span style="font-size:9px;opacity:.7">${c.label}</span>`).join('')}
          </div>
        </div>`;

    } else {
      // Default: elevation panel (DTM or DSM elevation)
      hrdemInnerContent = `
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:5px">
          ${Object.entries(HRDEM_RAMPS).map(([k,r]) => chip(r.label, hrdemRampId===k, 'bm-hrdem-ramp-chip', `data-ramp="${k}"`)).join('')}
        </div>
        <div class="bm-hrdem-ramp-preview" data-iid="${iid}" style="height:7px;border-radius:2px;border:1px solid var(--border,#444);background:${hrdemGradient};margin-bottom:6px"></div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--fg-2,#888);cursor:pointer">
            <input type="checkbox" class="bm-hrdem-invert" data-iid="${iid}"${hrdemInvert?' checked':''} /> Invert
          </label>
          <span style="font-size:10px;opacity:.25">|</span>
          <span style="font-size:9px;opacity:.55;font-style:italic">auto stretch per view</span>
        </div>`;
    }

    const hrdemAdjPanel = isHrdem ? `
      <div class="bm-adj-panel" data-iid="${iid}" style="display:none">
        ${hrdemInnerContent}
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
    const adjTitle = isVectorLayer ? 'Style options'
      : isHrdem ? 'Elevation style'
      : isCogContour ? 'Contour options'
      : 'Image adjustments';

    return `
      <div class="bm-stack-item ${isBase ? 'bm-base-item' : ''}"
           draggable="true" data-idx="${idx}" data-iid="${layer.instanceId}">
        <div class="bm-item-row">
          <div class="bm-drag-handle" title="Drag to reorder">${dragSvg}</div>
          <span class="bm-layer-label" title="${layer.label}">${layer.label}</span>
          ${isBase ? '<span class="bm-base-badge">B</span>' : ''}
          <input type="number" class="bm-opacity-num" data-iid="${layer.instanceId}"
            min="0" max="100" value="${Math.round(layer.opacity * 100)}" title="Opacity %"
            inputmode="decimal" />
          <button class="bm-vis-btn ${layer.visible ? 'active' : ''}" data-iid="${layer.instanceId}" title="${layer.visible ? 'Hide' : 'Show'}">${eyeSvg}</button>
          ${hasStylePanel ? `<button class="bm-adj-toggle" data-iid="${layer.instanceId}" title="${adjTitle}">${adjSvg}</button>` : ''}
          ${this.stack.length > 1 ? `<button class="bm-del-btn" data-iid="${layer.instanceId}" title="Remove">✕</button>` : ''}
        </div>
        ${isVectorLayer ? vecStylePanel : isHrdem ? hrdemAdjPanel : isCogContour ? cogContourAdjPanel : `<div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
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

  // ---- Cut & Fill section ----

  private syncCutFillLayers(): void {
    const runs = CutFillRunStore.getInstance().getRuns();
    const runIds = new Set(runs.map(r => r.id));

    for (const run of runs) {
      if (!this.cutFillLayers.has(run.id)) {
        const layer = new CutFillLayer(this.mapManager, `cf-${run.id}`);
        const ds = run.displayState;
        layer.showBoth(run.result, undefined, ds.hillshade);
        layer.setElevVisible(ds.elevVisible);
        layer.setDiffVisible(ds.diffVisible);
        layer.setElevOpacity(ds.elevOpacity);
        layer.setDiffOpacity(ds.diffOpacity);
        if (ds.contours) layer.updateContours(run.result, ds.contourInterval);
        if (ds.daylight && run.daylightFC) layer.setDaylight(run.daylightFC);
        this.cutFillLayers.set(run.id, layer);
      }
    }

    for (const [id, layer] of this.cutFillLayers.entries()) {
      if (!runIds.has(id)) { layer.clear(); this.cutFillLayers.delete(id); }
    }
  }

  private renderCutFillSection(): string {
    const runs = CutFillRunStore.getInstance().getRuns();
    const cutIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="flex-shrink:0;opacity:0.65"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><line x1="20.5" y1="3.5" x2="3.5" y2="20.5"/></svg>`;
    const toggle = `<button class="bm-section-toggle" data-section="cutfill-runs" data-open="${!this.collapsedSections.has('cutfill-runs')}">
      ${cutIcon}<span class="bm-toggle-label">Cut &amp; Fill</span>
      <span class="bm-section-hint">${runs.length} run${runs.length !== 1 ? 's' : ''}</span>
      <span class="bm-toggle-chevron">▾</span>
    </button>`;

    const fmtVol = (m3: number) =>
      m3 >= 1000 ? `${(m3 / 1000).toFixed(2)} km³` : `${m3.toFixed(0)} m³`;

    const eyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const eyeOffSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M96.68,57.87a4,4,0,0,1,2.08-6.6A130.13,130.13,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41a8,8,0,0,1,0,6.5c-.35.79-8.82,19.57-27.65,38.4q-4.28,4.26-8.79,8.07a4,4,0,0,1-5.55-.36ZM213.92,210.62a8,8,0,1,1-11.84,10.76L180,197.13A127.21,127.21,0,0,1,128,208c-34.88,0-66.57-13.26-91.66-38.34C17.51,150.83,9,132.05,8.69,131.26a8,8,0,0,1,0-6.5C9,124,17.51,105.18,36.34,86.35a135,135,0,0,1,25-19.78L42.08,45.38A8,8,0,1,1,53.92,34.62Zm-65.49-48.25-52.69-58a40,40,0,0,0,52.69,58Z"/></svg>`;

    const content = runs.length === 0
      ? `<div class="cf-lyr-empty">No runs saved. Use the Cut/Fill tool and click "Save to Layer Manager".</div>`
      : runs.map((run, i) => {
          const ds = run.displayState;
          const isCollapsed = this.collapsedRuns.has(run.id);
          const isSettingsCollapsed = this.collapsedRunSettings.has(run.id);
          const date = new Date(run.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
          const slope = run.params.slopeRatio != null ? `${run.params.slopeRatio}:1` : 'vert';
          const isFirst = i === 0;
          const isLast = i === runs.length - 1;

          return `<div class="cf-run-group">
            <div class="cf-run-hdr">
              <div class="cf-run-reorder">
                <button class="cf-reorder-btn" data-run="${run.id}" data-action="move-up"${isFirst ? ' disabled' : ''} title="Move up">▲</button>
                <button class="cf-reorder-btn" data-run="${run.id}" data-action="move-down"${isLast ? ' disabled' : ''} title="Move down">▼</button>
              </div>
              <button class="cf-run-toggle" data-run-toggle="${run.id}" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                <span class="cf-run-chevron" style="${isCollapsed ? 'transform:rotate(-90deg)' : ''}">▾</span>
                <span class="cf-run-name-disp" data-run-name-disp="${run.id}">${run.name}</span>
                <input type="text" class="cf-run-rename-input" data-run="${run.id}" data-action="rename" value="${run.name}" style="display:none">
              </button>
              <button class="cf-rename-btn" data-run="${run.id}" data-action="rename-toggle" title="Rename">✎</button>
              <button class="cf-del-run-btn" data-run="${run.id}" data-action="delete" title="Remove run">✕</button>
            </div>
            <div class="cf-run-meta-bar">${run.params.targetElevation.toFixed(1)}m · ${slope} · ${date}</div>
            <div class="cf-run-body" data-run-body="${run.id}" style="${isCollapsed ? 'display:none' : ''}">

              <!-- Settings sub-section -->
              <button class="cf-settings-toggle" data-run-settings-toggle="${run.id}">
                <span class="cf-settings-chevron" style="${isSettingsCollapsed ? 'transform:rotate(-90deg)' : ''}">▾</span>
                Settings
              </button>
              <div class="cf-settings-body" data-run-settings="${run.id}" style="${isSettingsCollapsed ? 'display:none' : ''}">
                <div class="cf-lyr-row">
                  <span class="cf-lyr-label">Target</span>
                  <input type="number" class="cf-lyr-input" value="${run.params.targetElevation}" step="0.1" data-run="${run.id}" data-action="target-elev" style="width:54px">m
                  <span class="cf-lyr-label" style="margin-left:4px">Slope</span>
                  <input type="number" class="cf-lyr-input" value="${run.params.slopeRatio ?? ''}" step="0.5" min="0" placeholder="vert" data-run="${run.id}" data-action="slope" style="width:46px">
                  <button class="cf-lyr-btn" data-run="${run.id}" data-action="recompute">Apply</button>
                </div>
                <div class="cf-lyr-row">
                  <label class="cf-lyr-check"><input type="checkbox" data-run="${run.id}" data-action="hillshade" ${ds.hillshade ? 'checked' : ''}> Hillshade</label>
                </div>
                <div class="cf-run-stats">Cut: ${fmtVol(run.result.cutVolume)} · Fill: ${fmtVol(run.result.fillVolume)}</div>
              </div>

              <!-- Layer stack: Daylight → Contours → Elevation → Difference -->
              <div class="cf-lyr-stack">
                <div class="cf-lyr-stack-item">
                  <button class="cf-vis-btn${ds.daylight ? ' cf-vis-on' : ''}" data-run="${run.id}" data-action="daylight" title="${ds.daylight ? 'Hide' : 'Show'} daylight lines">
                    ${ds.daylight ? eyeSvg : eyeOffSvg}
                  </button>
                  <span class="cf-lyr-stack-label">Daylight</span>
                </div>
                <div class="cf-lyr-stack-item">
                  <button class="cf-vis-btn${ds.contours ? ' cf-vis-on' : ''}" data-run="${run.id}" data-action="contours" title="${ds.contours ? 'Hide' : 'Show'} contours">
                    ${ds.contours ? eyeSvg : eyeOffSvg}
                  </button>
                  <span class="cf-lyr-stack-label">Contours</span>
                  <input type="number" class="cf-lyr-input" value="${ds.contourInterval}" min="0.1" step="0.5" data-run="${run.id}" data-action="contour-interval" style="width:40px">m
                </div>
                <div class="cf-lyr-stack-item">
                  <button class="cf-vis-btn${ds.elevVisible ? ' cf-vis-on' : ''}" data-run="${run.id}" data-action="elev-vis" title="${ds.elevVisible ? 'Hide' : 'Show'} elevation surface">
                    ${ds.elevVisible ? eyeSvg : eyeOffSvg}
                  </button>
                  <span class="cf-lyr-stack-label">Elevation</span>
                  <input type="range" min="0" max="100" value="${Math.round(ds.elevOpacity * 100)}" data-run="${run.id}" data-action="elev-opacity" class="cf-lyr-range">
                  <span class="cf-lyr-opacity-val" data-run="${run.id}" data-opacity-label="elev">${Math.round(ds.elevOpacity * 100)}%</span>
                </div>
                <div class="cf-lyr-stack-item">
                  <button class="cf-vis-btn${ds.diffVisible ? ' cf-vis-on' : ''}" data-run="${run.id}" data-action="diff-vis" title="${ds.diffVisible ? 'Hide' : 'Show'} difference surface">
                    ${ds.diffVisible ? eyeSvg : eyeOffSvg}
                  </button>
                  <span class="cf-lyr-stack-label">Difference</span>
                  <input type="range" min="0" max="100" value="${Math.round(ds.diffOpacity * 100)}" data-run="${run.id}" data-action="diff-opacity" class="cf-lyr-range">
                  <span class="cf-lyr-opacity-val" data-run="${run.id}" data-opacity-label="diff">${Math.round(ds.diffOpacity * 100)}%</span>
                </div>
              </div>

            </div>
          </div>`;
        }).join('');

    return toggle + this.sectionBody('cutfill-runs', content);
  }

  private wireCutFillSection(container: HTMLElement): void {
    const store = CutFillRunStore.getInstance();
    const eyeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const eyeOffSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M96.68,57.87a4,4,0,0,1,2.08-6.6A130.13,130.13,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41a8,8,0,0,1,0,6.5c-.35.79-8.82,19.57-27.65,38.4q-4.28,4.26-8.79,8.07a4,4,0,0,1-5.55-.36ZM213.92,210.62a8,8,0,1,1-11.84,10.76L180,197.13A127.21,127.21,0,0,1,128,208c-34.88,0-66.57-13.26-91.66-38.34C17.51,150.83,9,132.05,8.69,131.26a8,8,0,0,1,0-6.5C9,124,17.51,105.18,36.34,86.35a135,135,0,0,1,25-19.78L42.08,45.38A8,8,0,1,1,53.92,34.62Zm-65.49-48.25-52.69-58a40,40,0,0,0,52.69,58Z"/></svg>`;

    // Run group body collapse toggles
    container.querySelectorAll<HTMLButtonElement>('[data-run-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.runToggle!;
        if (this.collapsedRuns.has(id)) this.collapsedRuns.delete(id);
        else this.collapsedRuns.add(id);
        const body = container.querySelector<HTMLElement>(`[data-run-body="${id}"]`);
        const chevron = btn.querySelector<HTMLElement>('.cf-run-chevron');
        if (body) body.style.display = this.collapsedRuns.has(id) ? 'none' : '';
        if (chevron) chevron.style.transform = this.collapsedRuns.has(id) ? 'rotate(-90deg)' : '';
      });
    });

    // Settings sub-section collapse toggles
    container.querySelectorAll<HTMLButtonElement>('[data-run-settings-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.runSettingsToggle!;
        if (this.collapsedRunSettings.has(id)) this.collapsedRunSettings.delete(id);
        else this.collapsedRunSettings.add(id);
        const body = container.querySelector<HTMLElement>(`[data-run-settings="${id}"]`);
        const chevron = btn.querySelector<HTMLElement>('.cf-settings-chevron');
        if (body) body.style.display = this.collapsedRunSettings.has(id) ? 'none' : '';
        if (chevron) chevron.style.transform = this.collapsedRunSettings.has(id) ? 'rotate(-90deg)' : '';
      });
    });

    // Rename toggle: show/hide input
    container.querySelectorAll<HTMLButtonElement>('[data-action="rename-toggle"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const runId = btn.dataset.run!;
        const nameDisp = container.querySelector<HTMLElement>(`[data-run-name-disp="${runId}"]`);
        const input = container.querySelector<HTMLInputElement>(`[data-run="${runId}"][data-action="rename"]`);
        if (!nameDisp || !input) return;
        const isEditing = input.style.display !== 'none';
        if (isEditing) {
          const newName = input.value.trim();
          if (newName) store.renameRun(runId, newName); // triggers re-render
        } else {
          nameDisp.style.display = 'none';
          input.style.display = '';
          input.focus();
          input.select();
        }
      });
    });

    // Rename input: commit on blur or Enter
    container.querySelectorAll<HTMLInputElement>('[data-action="rename"]').forEach(input => {
      const commit = () => {
        const runId = input.dataset.run!;
        const newName = input.value.trim();
        if (newName) store.renameRun(runId, newName); // triggers re-render
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { store.renameRun(input.dataset.run!, input.dataset.run!); } // re-render to reset
      });
    });

    // Run action controls
    container.querySelectorAll<HTMLElement>('[data-run][data-action]').forEach(el => {
      const runId  = el.dataset.run!;
      const action = el.dataset.action!;

      if (['rename', 'rename-toggle'].includes(action)) return; // handled above

      const eventType = el.tagName === 'INPUT'
        ? ((el as HTMLInputElement).type === 'checkbox' ? 'change' : 'input')
        : 'click';

      el.addEventListener(eventType, () => {
        const run   = store.getById(runId);
        const layer = this.cutFillLayers.get(runId);

        switch (action) {
          case 'move-up':
            store.moveRun(runId, 'up'); // triggers re-render via subscription
            return;
          case 'move-down':
            store.moveRun(runId, 'down');
            return;
          case 'delete':
            if (layer) layer.clear();
            store.removeRun(runId);
            return;
        }

        if (!run || !layer) return;
        const ds = run.displayState;

        switch (action) {
          case 'hillshade': {
            ds.hillshade = (el as HTMLInputElement).checked;
            layer.showBoth(run.result, undefined, ds.hillshade);
            layer.setElevVisible(ds.elevVisible);
            layer.setDiffVisible(ds.diffVisible);
            break;
          }
          case 'contours':
            ds.contours = !ds.contours;
            if (ds.contours) layer.updateContours(run.result, ds.contourInterval);
            else layer.setContoursVisible(false);
            el.classList.toggle('cf-vis-on', ds.contours);
            el.innerHTML = ds.contours ? eyeSvg : eyeOffSvg;
            break;
          case 'contour-interval': {
            const iv = parseFloat((el as HTMLInputElement).value);
            if (isFinite(iv) && iv > 0) {
              ds.contourInterval = iv;
              if (ds.contours) layer.updateContours(run.result, iv);
            }
            break;
          }
          case 'daylight':
            ds.daylight = !ds.daylight;
            if (ds.daylight) {
              if (!run.daylightFC) run.daylightFC = computeDaylightFeatures(run.result);
              layer.setDaylight(run.daylightFC);
            } else {
              layer.setDaylightVisible(false);
            }
            el.classList.toggle('cf-vis-on', ds.daylight);
            el.innerHTML = ds.daylight ? eyeSvg : eyeOffSvg;
            break;
          case 'elev-vis':
            ds.elevVisible = !ds.elevVisible;
            layer.setElevVisible(ds.elevVisible);
            el.classList.toggle('cf-vis-on', ds.elevVisible);
            el.innerHTML = ds.elevVisible ? eyeSvg : eyeOffSvg;
            break;
          case 'diff-vis':
            ds.diffVisible = !ds.diffVisible;
            layer.setDiffVisible(ds.diffVisible);
            el.classList.toggle('cf-vis-on', ds.diffVisible);
            el.innerHTML = ds.diffVisible ? eyeSvg : eyeOffSvg;
            break;
          case 'elev-opacity': {
            const opacity = parseInt((el as HTMLInputElement).value) / 100;
            ds.elevOpacity = opacity;
            layer.setElevOpacity(opacity);
            const valEl = container.querySelector<HTMLElement>(`[data-run="${runId}"][data-opacity-label="elev"]`);
            if (valEl) valEl.textContent = `${Math.round(opacity * 100)}%`;
            break;
          }
          case 'diff-opacity': {
            const opacity = parseInt((el as HTMLInputElement).value) / 100;
            ds.diffOpacity = opacity;
            layer.setDiffOpacity(opacity);
            const valEl = container.querySelector<HTMLElement>(`[data-run="${runId}"][data-opacity-label="diff"]`);
            if (valEl) valEl.textContent = `${Math.round(opacity * 100)}%`;
            break;
          }
          case 'recompute': {
            const targetEl  = container.querySelector<HTMLInputElement>(`[data-run="${runId}"][data-action="target-elev"]`);
            const slopeEl   = container.querySelector<HTMLInputElement>(`[data-run="${runId}"][data-action="slope"]`);
            const targetElev = parseFloat(targetEl?.value ?? '');
            const slopeStr   = slopeEl?.value.trim() ?? '';
            const slopeRaw   = slopeStr === '' ? null : parseFloat(slopeStr);
            const slopeRatio = slopeRaw !== null && isFinite(slopeRaw) && slopeRaw > 0 ? slopeRaw : null;
            if (!isFinite(targetElev)) break;
            const newResult = computeCutFill(run.hrdem, {
              polygon: run.params.polygon as { type: 'Polygon'; coordinates: [number, number][][] },
              targetElevation: targetElev,
              slopeRatio,
            });
            run.result = newResult;
            run.params.targetElevation = targetElev;
            run.params.slopeRatio = slopeRatio;
            run.daylightFC = null;
            layer.showBoth(newResult, undefined, ds.hillshade);
            layer.setElevVisible(ds.elevVisible);
            layer.setDiffVisible(ds.diffVisible);
            if (ds.contours) layer.updateContours(newResult, ds.contourInterval);
            if (ds.daylight) {
              run.daylightFC = computeDaylightFeatures(newResult);
              layer.setDaylight(run.daylightFC);
            }
            break;
          }
        }
      });
    });
  }

  // ---- Main render ----

  private renderContent(container: HTMLElement, onClose: () => void): void {
    container.innerHTML = `
      <div class="panel-header">
        <h3>Active Layers</h3>
        <button class="panel-close" id="bm-close">✕</button>
      </div>
      <div class="panel-body bm-panel-body">

        ${this.sectionToggle('active-layers', 'Basemap Stack', 'drag to reorder · top = drawn on top', false)}
        ${this.sectionBody('active-layers', `<div class="bm-stack" id="bm-stack">
          ${this.stack.map((layer, idx) => this.renderStackItem(layer, idx)).join('')}
        </div>`)}

        ${this.renderFeatureLayersSection()}
        ${this.renderCollectedDataSection()}
        ${this.renderCutFillSection()}
        ${this.renderUserLayersSection()}
        ${this.renderPDFSection()}
        ${this.renderMapDisplaySection()}

      </div>
    `;

    container.querySelector('#bm-close')?.addEventListener('click', onClose);
    this.wireCollectedData(container);
    this.wireFeatureLayers(container);
    this.wireMapDisplay(container);
    this.wireCutFillSection(container);
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

    // Opacity number inputs (stack items)
    container.querySelectorAll<HTMLInputElement>('.bm-opacity-num').forEach(input => {
      input.addEventListener('change', () => {
        const iid = input.dataset.iid!;
        const rawVal = parseInt(input.value);
        const clamped = isNaN(rawVal) ? 100 : Math.min(100, Math.max(0, rawVal));
        input.value = String(clamped);
        const opacity = clamped / 100;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.opacity = opacity;
        const isBase = iid === this.stack[this.stack.length - 1]?.instanceId;
        const ltype = this.getLayerType(layer);
        if (isBase) this.mapManager.setBasemapOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'nsprd-vector') this.nsprdLayer?.setOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'nshn-vector') this.nshnLayers.get(iid)?.setOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'hrdem-wcs') this.hrdemLayers.get(iid)?.setOpacity(layer.visible ? opacity : 0);
        else if (ltype === 'cog-contour') this.cogContourLayers.get(iid)?.setOpacity(layer.visible ? opacity : 0);
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
        else if (ltype2 === 'hrdem-wcs') {
          this.hrdemLayers.get(iid)?.setVisible(layer.visible);
          this.refreshUnifiedLegend();
        }
        else if (ltype2 === 'cog-contour') this.cogContourLayers.get(iid)?.setVisible(layer.visible);
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

    // ---- HRDEM elevation ramp chips ----
    const updateHrdemPreview = (iid: string, layer: StackLayer) => {
      const entry = HRDEM_RAMPS[layer.hrdemRampId ?? 'terrain'] ?? HRDEM_RAMPS['terrain'];
      const ramp = layer.hrdemRampInvert ? invertRamp(entry.ramp) : entry.ramp;
      const gradient = rampToHorizontalGradient(ramp);
      const preview = container.querySelector<HTMLElement>(`.bm-hrdem-ramp-preview[data-iid="${iid}"]`);
      if (preview) preview.style.background = gradient;
    };

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-ramp-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemRampId = btn.dataset.ramp!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-ramp-chip[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.ramp === layer.hrdemRampId));
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

    // ---- HRDEM slope styling ----
    const applySlope = (iid: string, layer: StackLayer) => {
      const entry = SLOPE_RAMPS[layer.hrdemSlopeRampId ?? 'classic'] ?? SLOPE_RAMPS['classic'];
      const ramp = layer.hrdemSlopeInvert ? invertRamp(entry.ramp) : entry.ramp;
      const preview = container.querySelector<HTMLElement>(`.bm-hrdem-slope-preview[data-iid="${iid}"]`);
      if (preview) preview.style.background = rampToHorizontalGradient(ramp);
      this.hrdemLayers.get(iid)?.setProductStyle({
        slopeRampId:  layer.hrdemSlopeRampId  ?? 'classic',
        slopeUnit:    (layer.hrdemSlopeUnit    ?? 'degrees') as 'degrees' | 'percent',
        slopeStretch: (layer.hrdemSlopeStretch ?? 'auto') as 'auto' | 'full' | '0-45' | '0-90',
        slopeInvert:  layer.hrdemSlopeInvert   ?? false,
      });
    };

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-slope-ramp-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemSlopeRampId = btn.dataset.ramp!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-slope-ramp-chip[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.ramp === layer.hrdemSlopeRampId));
        applySlope(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-slope-unit').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemSlopeUnit = btn.dataset.unit!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-slope-unit[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.unit === layer.hrdemSlopeUnit));
        applySlope(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-slope-stretch').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemSlopeStretch = btn.dataset.stretch!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-slope-stretch[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.stretch === layer.hrdemSlopeStretch));
        applySlope(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-slope-invert').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemSlopeInvert = chk.checked;
        applySlope(iid, layer);
        this.saveStack();
      });
    });

    // ---- HRDEM aspect styling ----
    const applyAspect = (iid: string, layer: StackLayer) => {
      const sat = layer.hrdemAspectSat ?? 80, light = layer.hrdemAspectLight ?? 50;
      const rose = container.querySelector<HTMLElement>(`.bm-hrdem-aspect-rose[data-iid="${iid}"]`);
      if (rose) rose.style.background = `conic-gradient(from -90deg,hsl(0,${sat}%,${light}%) 0deg,hsl(90,${sat}%,${light}%) 90deg,hsl(180,${sat}%,${light}%) 180deg,hsl(270,${sat}%,${light}%) 270deg,hsl(360,${sat}%,${light}%) 360deg)`;
      this.hrdemLayers.get(iid)?.setProductStyle({ aspectSat: sat / 100, aspectLight: light / 100 });
    };

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-aspect-sat').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemAspectSat = Number(slider.value);
        const lbl = container.querySelector<HTMLElement>(`.bm-hrdem-aspect-sat-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${layer.hrdemAspectSat}%`;
        applyAspect(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-aspect-light').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemAspectLight = Number(slider.value);
        const lbl = container.querySelector<HTMLElement>(`.bm-hrdem-aspect-light-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${layer.hrdemAspectLight}%`;
        applyAspect(iid, layer);
        this.saveStack();
      });
    });

    // ---- HRDEM TPI styling ----
    const applyTpi = (iid: string, layer: StackLayer) => {
      const entry = TPI_RAMPS[layer.hrdemTpiRampId ?? 'rdylbu'] ?? TPI_RAMPS['rdylbu'];
      const ramp = layer.hrdemTpiInvert ? invertRamp(entry.ramp) : entry.ramp;
      const preview = container.querySelector<HTMLElement>(`.bm-hrdem-tpi-preview[data-iid="${iid}"]`);
      if (preview) preview.style.background = rampToHorizontalGradient(ramp);
      this.hrdemLayers.get(iid)?.setProductStyle({
        tpiRampId:  layer.hrdemTpiRampId  ?? 'rdylbu',
        tpiStretch: (layer.hrdemTpiStretch ?? 'symmetric') as 'symmetric' | 'auto',
        tpiInvert:  layer.hrdemTpiInvert   ?? false,
      });
    };

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-tpi-ramp-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemTpiRampId = btn.dataset.ramp!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-tpi-ramp-chip[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.ramp === layer.hrdemTpiRampId));
        applyTpi(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-tpi-stretch').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemTpiStretch = btn.dataset.stretch!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-tpi-stretch[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.stretch === layer.hrdemTpiStretch));
        applyTpi(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-tpi-invert').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemTpiInvert = chk.checked;
        applyTpi(iid, layer);
        this.saveStack();
      });
    });

    // ---- HRDEM CHM styling ----
    const applyChmRamp = (iid: string, layer: StackLayer) => {
      const entry = CHM_RAMPS[layer.hrdemChmRampId ?? 'canopy_green'] ?? CHM_RAMPS['canopy_green'];
      const ramp = layer.hrdemChmInvert ? invertRamp(entry.ramp) : entry.ramp;
      const preview = container.querySelector<HTMLElement>(`.bm-hrdem-chm-preview[data-iid="${iid}"]`);
      if (preview) preview.style.background = rampToHorizontalGradient(ramp);
      this.hrdemLayers.get(iid)?.setProductStyle({ chmRampId: layer.hrdemChmRampId ?? 'canopy_green', chmInvert: layer.hrdemChmInvert ?? false });
    };

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-chm-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemChmMode = btn.dataset.mode!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-chm-mode[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.mode === layer.hrdemChmMode));
        const stretchOpts = container.querySelector<HTMLElement>(`.bm-hrdem-chm-stretch-opts[data-iid="${iid}"]`);
        const classOpts   = container.querySelector<HTMLElement>(`.bm-hrdem-chm-class-opts[data-iid="${iid}"]`);
        if (stretchOpts) stretchOpts.style.display = layer.hrdemChmMode === 'stretch' ? '' : 'none';
        if (classOpts)   classOpts.style.display   = layer.hrdemChmMode === 'classified' ? '' : 'none';
        this.hrdemLayers.get(iid)?.setProductStyle({ chmMode: layer.hrdemChmMode as 'stretch' | 'classified' });
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-chm-ramp-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemChmRampId = btn.dataset.ramp!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-chm-ramp-chip[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.ramp === layer.hrdemChmRampId));
        applyChmRamp(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-chm-invert').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemChmInvert = chk.checked;
        applyChmRamp(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-hrdem-chm-class-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemChmClassPaletteId = btn.dataset.pal!;
        container.querySelectorAll<HTMLButtonElement>(`.bm-hrdem-chm-class-chip[data-iid="${iid}"]`).forEach(b => b.classList.toggle('hdem-active', b.dataset.pal === layer.hrdemChmClassPaletteId));
        // Update swatches
        const swatches = container.querySelector<HTMLElement>(`.bm-hrdem-chm-class-swatches[data-iid="${iid}"]`);
        if (swatches) {
          const pal = CHM_CLASS_PALETTES[layer.hrdemChmClassPaletteId] ?? CHM_CLASS_PALETTES['structural'];
          swatches.innerHTML = pal.classes.map(c => `<div style="width:14px;height:9px;border-radius:2px;background:rgb(${c.r},${c.g},${c.b})"></div><span style="font-size:9px;opacity:.7">${c.label}</span>`).join('');
        }
        this.hrdemLayers.get(iid)?.setProductStyle({ chmClassPaletteId: layer.hrdemChmClassPaletteId });
        this.saveStack();
      });
    });

    const applyContour = (iid: string, layer: StackLayer) => {
      const isCtour = layer.defId === 'hrdem-contours' || layer.defId === 'hrdem-dsm-contours';
      this.hrdemLayers.get(iid)?.setContour(
        layer.hrdemContourEnabled  ?? false,
        layer.hrdemContourInterval ?? (isCtour ? 1 : 10),
        layer.hrdemContourColor    ?? (isCtour ? '#000000' : '#ffffff'),
        layer.hrdemContourWidth    ?? (isCtour ? 0.5 : 1.2),
      );
    };

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-ivl').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemContourInterval = Math.max(0.1, Number(inp.value) || 1);
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

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-wid').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const w = Number(inp.value);
        if (!isFinite(w) || w <= 0) return;
        layer.hrdemContourWidth = w;
        applyContour(iid, layer);
        this.saveStack();
      });
    });

    // COG contour — threshold
    container.querySelectorAll<HTMLInputElement>('.bm-cc-threshold').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid   = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const t = parseFloat(inp.value);
        if (!isFinite(t) || t <= 0) return;
        layer.cogContourThreshold = t;
        this.cogContourLayers.get(iid)?.setThreshold(t);
        this.saveStack();
      });
    });

    // COG contour — line colour
    container.querySelectorAll<HTMLInputElement>('.bm-cc-line-color').forEach(inp => {
      inp.addEventListener('input', () => {
        const iid   = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.cogContourLineColor = inp.value;
        this.cogContourLayers.get(iid)?.setLineStyle(
          inp.value, layer.cogContourLineWidth ?? 2.0);
        this.saveStack();
      });
    });

    // COG contour — line width
    container.querySelectorAll<HTMLInputElement>('.bm-cc-line-width').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid   = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const w = parseFloat(inp.value);
        if (!isFinite(w) || w <= 0) return;
        layer.cogContourLineWidth = w;
        this.cogContourLayers.get(iid)?.setLineStyle(
          layer.cogContourLineColor ?? '#1565c0', w);
        this.saveStack();
      });
    });

    // COG contour — fill enable
    container.querySelectorAll<HTMLInputElement>('.bm-cc-fill-en').forEach(chk => {
      chk.addEventListener('change', () => {
        const iid   = chk.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.cogContourFillEnabled = chk.checked;
        this.cogContourLayers.get(iid)?.setFill(
          chk.checked,
          layer.cogContourFillColor   ?? '#1565c0',
          layer.cogContourFillOpacity ?? 0.30,
        );
        this.saveStack();
      });
    });

    // COG contour — fill colour
    container.querySelectorAll<HTMLInputElement>('.bm-cc-fill-color').forEach(inp => {
      inp.addEventListener('input', () => {
        const iid   = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.cogContourFillColor = inp.value;
        this.cogContourLayers.get(iid)?.setFill(
          layer.cogContourFillEnabled ?? false,
          inp.value,
          layer.cogContourFillOpacity ?? 0.30,
        );
        this.saveStack();
      });
    });

    // COG contour — fill opacity
    container.querySelectorAll<HTMLInputElement>('.bm-cc-fill-opacity').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid   = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const fo = parseInt(slider.value) / 100;
        layer.cogContourFillOpacity = fo;
        const lbl = container.querySelector<HTMLElement>(`.bm-cc-fo-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${Math.round(fo * 100)}%`;
        this.cogContourLayers.get(iid)?.setFill(
          layer.cogContourFillEnabled ?? false,
          layer.cogContourFillColor   ?? '#1565c0',
          fo,
        );
        this.saveStack();
      });
    });

    // Vector style — line width
    container.querySelectorAll<HTMLInputElement>('.bm-vec-lw').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid = inp.dataset.iid!;
        const w = parseFloat(inp.value);
        if (!isFinite(w) || w <= 0) return;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.vecLineWidth = w;
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
