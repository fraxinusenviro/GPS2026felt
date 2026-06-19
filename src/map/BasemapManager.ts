import maplibregl from 'maplibre-gl';
import { BASEMAPS, BASEMAP_OVERLAYS, LAYER_IDS } from '../constants';
import { NS_REST_ALL_DEFS } from '../data/nsRestAll';
import type { BasemapDef, ImportedLayer, OnlineLayer, VectorLayerConfig, GeoJSONGeometry, LayerPreset, TypePreset, GeometryType, FieldFeature, SymbologyState, RasterSymbologyState, RasterStretchMode, ClassifierName } from '../types';
import { SymbologyStudio } from '../ui/SymbologyStudio';
import { RasterSymbologyStudio } from '../ui/RasterSymbologyStudio';
import { RASTER_RAMPS, EXTENDED_COLOR_RAMPS, buildRgbLut, buildCogColormap, computeClassBreaks } from '../lib/rasterRamps';
import { equalIntervalClasses, breaksToClasses, classifiedRowsHtml } from '../lib/rasterLegend';
import { MapManager } from './MapManager';
import { NSPRDVectorLayer } from './NSPRDVectorLayer';
import { NSHNVectorLayer } from './NSHNVectorLayer';
import { HRDEMLayer, type HRDEMProduct, type ChmFocalParams } from './HRDEMLayer';
import { CogContourLayer } from './CogContourLayer';
import { HRDEM_RAMPS, SLOPE_RAMPS, TPI_RAMPS, CHM_RAMPS, CHM_CLASSES, CHM_CLASS_PALETTES, invertRamp, rampToHorizontalGradient, type ColorRamp } from '../lib/elevationRenderer';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';
import { StylePicker } from '../ui/StylePicker';
import { renderSwatchDataUrl, renderLineSwatchDataUrl, renderPolygonSwatchDataUrl } from '../ui/SymbolRenderer';
import { CutFillLayer } from './CutFillLayer';
import { sampleElevationBilinear } from '../lib/cutFillEngine';
import { CutFillRunStore, type CutFillRun } from './CutFillRunStore';
import { computeCutFill, computeDaylightFeatures } from '../lib/cutFillEngine';
import { WebGLBlendLayer } from './WebGLBlendLayer';

const BM_STACK_KEY = 'fm2026_bm_stack';
const BM_STACK_PROJECT_KEY = 'fm2026_bm_stack_project';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  blendMode?: string;
  vecLineWidth?: number;
  vecFillOpacityOverride?: number;
  vecLineColor?: string;
  vecFillColor?: string;
  cogRampId?: string; // 'original' | key of RASTER_RAMPS
  cogRampInvert?: boolean;
  cogSmooth?: boolean;
  cogClasses?: number;  // ≥2 = classified COG rendering
  cogClassifier?: string;  // ClassifierName — 'Equal interval' | 'Natural breaks' | 'Quantile'
  cogBreaks?: number[];    // data-driven class breaks (Natural breaks / Quantile)
  cogMin?: number;      // custom value range override (native units)
  cogMax?: number;
  // RGB tile recolouring (rampify:// luminance LUT) for plain raster / web sources
  rasterSymbology?: RasterSymbologyState;
  hrdemRampId?: string;    // key of HRDEM_RAMPS / RASTER_RAMPS, default 'terrain'
  hrdemRampInvert?: boolean;
  // Generic stretch + classification (Raster Symbology Studio)
  hrdemStretch?: string;      // RasterStretchMode, default 'percentile'
  hrdemStretchMin?: number;   // custom stretch range (m)
  hrdemStretchMax?: number;
  hrdemClassify?: boolean;
  hrdemClassifier?: string;   // ClassifierName, default 'Natural breaks'
  hrdemClassCount?: number;   // 3–9, default 5
  hrdemRasterVisible?:   boolean; // default true
  hrdemContourEnabled?:  boolean; // default false
  hrdemContourInterval?: number;  // default 10 (metres)
  hrdemContourColor?:    string;  // default '#ffffff'
  hrdemContourWidth?:    number;  // default 1.2 (px)
  hrdemContourMinZoom?:  number;  // default 14
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
  // Hillshade parameters (for raster-fn-hillshade)
  hrdemHillshadeAzimuth?:  number;        // default 315
  hrdemHillshadeAltitude?: number;        // default 45
  hrdemHillshadeZFactor?:  number;        // default 1
  // CHM Focal Statistics parameters (for raster-fn-chm-focal)
  hrdemChmFocalNeighborhood?: string;     // 'rectangle'|'circle', default 'circle'
  hrdemChmFocalWidth?:  number;           // cells (rectangle only), default 3
  hrdemChmFocalHeight?: number;           // cells (rectangle only), default 3
  hrdemChmFocalRadius?: number;           // cells (circle only), default 3
  hrdemChmFocalStat?:   string;           // 'mean'|'min'|'max'|'median'|'sum'|'percentile', default 'mean'
  hrdemChmFocalPercentile?: number;       // 0–100, default 50
  // COG threshold contour
  cogContourThreshold?:   number;  // default 0.5 (metres for DTW)
  cogContourLineColor?:   string;  // default '#1565c0'
  cogContourLineWidth?:   number;  // default 2.0
  cogContourFillEnabled?: boolean; // default false
  cogContourFillColor?:   string;  // default '#1565c0'
  cogContourFillOpacity?: number;  // default 0.30
  symbologyState?: SymbologyState; // data-driven symbology override
  showInLegend?: boolean;          // default true (non-base layers); base layers excluded
  customLabel?: string;            // user-edited display name (does not affect library name)
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
  features?: { properties: Record<string, unknown> }[];
  symbologyState?: SymbologyState;
  originalColor?: string;
}

interface PDFLayerInfo {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  bounds?: [number, number, number, number];
}

const ALL_DEFS = (): BasemapDef[] => [...BASEMAPS, ...BASEMAP_OVERLAYS, ...NS_REST_ALL_DEFS];

/** Generate a thumbnail URL from a tile URL template (z=4, x=4, y=5 ≈ eastern Canada) */
const thumbUrl = (url: string) =>
  url.replace('{z}', '4').replace('{x}', '4').replace('{y}', '5').replace('{r}', '');

export class BasemapManager {
  private stack: StackLayer[] = [];
  // Remembers which stack layers were visible before a "hide all" master toggle,
  // so the next click restores the exact prior visibility combo.
  private stackVisSnapshot: string[] | null = null;
  private renamingIid: string | null = null;

  // "View as" (preview another user's layer view, read-only). When viewOnly is
  // set, stack changes are not persisted to localStorage/cloud.
  private viewOnly = false;
  private viewAsUsers: string[] = [];
  private viewAsCurrentUser = '';
  private viewingAs: string | null = null;
  private onViewAs: ((uid: string | null) => void) | null = null;
  private dragSrcIdx: number | null = null;
  private userLayers: UserLayerInfo[] = [];
  private pdfLayers: PDFLayerInfo[] = [];
  private onDeletePDF: ((id: string) => void) | null = null;
  private onDeleteUserLayer: ((id: string) => void) | null = null;
  private onLayerStateChange: ((id: string, updates: { visible?: boolean; opacity?: number; symbologyState?: SymbologyState | null }) => void) | null = null;
  // All sections collapsed by default; user expands what they need
  private collapsedSections = new Set<string>([
    'active-layers', 'field-data',
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
  private webglBlendLayers = new Map<string, WebGLBlendLayer>();
  // Static GeoJSON overlays (shared data library, type 'geojson'): cache the  // fetched features per instance so symbology + identify can reuse them, and
  // track which are loaded onto the map.
  private geojsonOverlays = new Map<string, { properties: Record<string, unknown> }[]>();
  private geojsonGeomType = new Map<string, 'point' | 'line' | 'polygon'>();
  private geojsonLoading = new Set<string>();
  // Persist hook for cross-device sync: fires (debounced by the host) on
  // user-driven stack changes with the serialized stack. Suppressed while
  // loading a stack from a project/remote so loads don't re-mark the project dirty.
  onStackPersist: ((stackJson: string) => void) | null = null;
  private suppressPersist = false;
  private cutFillResultProvider: (() => import('../lib/cutFillEngine').CutFillResult | null) | null = null;
  private cutFillLayers = new Map<string, CutFillLayer>();
  private collapsedFdGroups = new Set<string>();
  private collapsedRuns = new Set<string>();
  private collapsedRunSettings = new Set<string>();
  private panelState: { container: HTMLElement; onClose: () => void } | null = null;
  private symbologyStudio = new SymbologyStudio();
  private rasterSymbologyStudio = new RasterSymbologyStudio();
  // Bumped whenever an RGB recolour LUT changes so rampify:// tile URLs cache-bust
  private rasterStyleVersion = 0;
  // Map Legend drawer
  private legendBodyEl: HTMLElement | null = null;
  private collapsedLegendItems = new Set<string>();

  private identifyActive = false;
  private identifyClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private identifyPopup: maplibregl.Popup | null = null;
  private identifyButton: HTMLButtonElement | null = null;
  private rasterSampleActive = false;
  private rasterSampleClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private rasterSampleButton: HTMLButtonElement | null = null;
  private rasterSamplePopup: maplibregl.Popup | null = null;

  // Feature layer presets for the basemap TOC
  private featureLayerPresets: LayerPreset[] = [];
  private onFeatureLayerChange: ((preset: LayerPreset) => void) | null = null;

  // TypePresets for collected data symbology TOC
  private typePresets: TypePreset[] = [];
  private collectedFeatures: FieldFeature[] = [];
  private onTypePresetChange: ((preset: TypePreset) => void) | null = null;
  private stylePicker = new StylePicker();
  private mapBgColor = '#000000';
  private userId = '';

  private currentProjectId: string = '';

  setUserId(id: string): void { this.userId = id; }

  constructor(private mapManager: MapManager) {
    // Load persisted background color and userId
    StorageManager.getInstance().getAppSettings().then(s => {
      if (s.map_bg_color) {
        this.mapBgColor = s.map_bg_color;
        this.mapManager.setBackgroundColor(s.map_bg_color);
      }
      if (s.user_id) this.userId = s.user_id;
    }).catch(() => {/* ignore */});

    // Subscribe to C/F run store — sync map layers and re-render open panel
    CutFillRunStore.getInstance().subscribe(() => {
      this.syncCutFillLayers();
      if (this.panelState) {
        this.renderContent(this.panelState.container, this.panelState.onClose);
      }
    });

    // Load persisted runs on startup
    CutFillRunStore.getInstance().loadRuns();
  }

  // ---- State persistence ----

  /**
   * Layers worth persisting: catalogue layers (defId in ALL_DEFS) plus shared
   * static-data layers (defId `shared:…`), which are self-describing (type, url,
   * vector_config, symbologyState all live on the StackLayer) so they rebuild
   * without a catalogue entry. Promoted user-import layers are excluded.
   */
  private persistableStack(): StackLayer[] {
    const knownIds = new Set(ALL_DEFS().map(d => d.id));
    return this.stack.filter(l => knownIds.has(l.defId) || l.defId.startsWith('shared:'));
  }

  /** Enable/disable read-only "view as" mode (suppresses persistence). */
  setViewOnly(on: boolean): void {
    this.viewOnly = on;
  }

  /** Apply a stack JSON to the live map WITHOUT persisting (for "view as" preview). */
  applyStackEphemeral(stackJson: string): void {
    try {
      const parsed = JSON.parse(stackJson) as { stack?: StackLayer[]; collapsed?: string[] };
      if (!Array.isArray(parsed.stack) || parsed.stack.length === 0) return;
      this.stack = parsed.stack;
      if (Array.isArray(parsed.collapsed)) this.collapsedSections = new Set(parsed.collapsed);
      this.rebuildMap();
      if (this.panelState) this.renderContent(this.panelState.container, this.panelState.onClose);
    } catch { /* keep existing stack */ }
  }

  /** Configure the "View as" control shown in the TOC. */
  setViewAsControl(users: string[], currentUser: string, viewingAs: string | null, onChange: (uid: string | null) => void): void {
    this.viewAsUsers = users;
    this.viewAsCurrentUser = currentUser;
    this.viewingAs = viewingAs;
    this.onViewAs = onChange;
    if (this.panelState) this.renderContent(this.panelState.container, this.panelState.onClose);
  }

  private saveStack(): void {
    const data = JSON.stringify({
      stack: this.persistableStack(),
      collapsed: [...this.collapsedSections],
    });
    // In read-only preview, reflect changes on the map but never persist them.
    if (this.viewOnly) {
      this.refreshLegend();
      EventBus.emit('basemap-stack-changed');
      return;
    }
    try {
      localStorage.setItem(BM_STACK_KEY, data);
      // Record which project this stack belongs to so reload can detect it
      if (this.currentProjectId) {
        localStorage.setItem(BM_STACK_PROJECT_KEY, this.currentProjectId);
      }
    } catch { /* ignore QuotaExceededError */ }
    this.refreshLegend();
    EventBus.emit('basemap-stack-changed');
    // Persist to the active project (→ cloud sync) on user-driven changes only.
    if (!this.suppressPersist) this.onStackPersist?.(data);
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
      return JSON.stringify({
        stack: this.persistableStack(),
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
        // Mirror to localStorage but don't re-persist to the project/cloud —
        // this load IS the project/remote state.
        this.suppressPersist = true;
        try { this.saveStack(); } finally { this.suppressPersist = false; }
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
        // Mutually exclusive with the raster-sample tool.
        if (this.rasterSampleActive && this.rasterSampleButton) this.rasterSampleButton.click();
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

  /** INFO tool: sample raster values (COG / elevation) at a clicked point. */
  setupRasterSample(btn: HTMLButtonElement): void {
    this.rasterSampleButton = btn;
    const map = this.mapManager.getMap();
    btn.addEventListener('click', () => {
      this.rasterSampleActive = !this.rasterSampleActive;
      btn.classList.toggle('active', this.rasterSampleActive);
      map.getCanvas().style.cursor = this.rasterSampleActive ? 'crosshair' : '';
      if (this.rasterSampleActive) {
        if (this.identifyActive && this.identifyButton) this.identifyButton.click();
        this.rasterSampleClickHandler = (e) => { void this.handleRasterSampleClick(e); };
        map.on('click', this.rasterSampleClickHandler);
      } else {
        if (this.rasterSampleClickHandler) {
          map.off('click', this.rasterSampleClickHandler);
          this.rasterSampleClickHandler = null;
        }
        this.rasterSamplePopup?.remove();
        this.rasterSamplePopup = null;
      }
    });
  }

  /** Visible raster layers that can return a numeric value at a point. */
  private getActiveRasterLayers(): Array<{ instanceId: string; label: string; kind: 'cog' | 'hrdem'; cogUrl?: string }> {
    const out: Array<{ instanceId: string; label: string; kind: 'cog' | 'hrdem'; cogUrl?: string }> = [];
    for (const l of this.stack) {
      if (!l.visible) continue;
      const t = this.getLayerType(l);
      if (t === 'raster' && l.url.startsWith('cog://')) {
        out.push({ instanceId: l.instanceId, label: l.label, kind: 'cog', cogUrl: BasemapManager.cogUrlFromLayer(l) });
      } else if (t === 'hrdem-wcs') {
        out.push({ instanceId: l.instanceId, label: l.label, kind: 'hrdem' });
      }
    }
    return out;
  }

  private async handleRasterSampleClick(e: maplibregl.MapMouseEvent): Promise<void> {
    const { lng, lat } = e.lngLat;
    const layers = this.getActiveRasterLayers();
    if (layers.length === 0) {
      this.showRasterSamplePopup(e.lngLat, '<div class="rs-popup"><div class="rs-empty">No sampleable raster layers active.<br><span style="opacity:.7">Add a COG or elevation layer.</span></div></div>');
      return;
    }
    this.showRasterSamplePopup(e.lngLat, '<div class="rs-popup"><div class="rs-empty">Sampling…</div></div>');

    const rows: Array<{ label: string; value: number | null; unit: string }> = [];
    for (const ly of layers) {
      let value: number | null = null;
      let unit = '';
      if (ly.kind === 'cog' && ly.cogUrl) {
        value = await this.mapManager.sampleCogAtPoint(ly.cogUrl, lng, lat);
      } else if (ly.kind === 'hrdem') {
        const res = this.hrdemLayers.get(ly.instanceId)?.getLastResult();
        if (res) { value = sampleElevationBilinear(res.grid, res.width, res.height, res.bbox, res.nodata, lng, lat); unit = 'm'; }
      }
      rows.push({ label: ly.label, value, unit });
    }

    const popup = this.showRasterSamplePopup(e.lngLat, this.buildRasterSampleHtml(rows, lng, lat));
    // Wire the layer filter dropdown.
    const el = popup.getElement();
    const sel = el?.querySelector<HTMLSelectElement>('.rs-select');
    sel?.addEventListener('change', () => {
      const v = sel.value;
      el?.querySelectorAll<HTMLElement>('[data-rs-row]').forEach(r => {
        r.style.display = (v === 'all' || r.dataset.rsRow === v) ? '' : 'none';
      });
    });
  }

  private buildRasterSampleHtml(
    rows: Array<{ label: string; value: number | null; unit: string }>,
    lng: number, lat: number,
  ): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmt = (v: number | null, u: string) =>
      v == null ? '<span class="rs-nd">no data</span>'
        : `${(+v.toFixed(3)).toLocaleString()}${u ? ` ${u}` : ''}`;
    const opts = ['<option value="all">All layers</option>',
      ...rows.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`)].join('');
    const rowHtml = rows.map((r, i) =>
      `<div class="rs-row" data-rs-row="${i}"><span class="rs-label">${esc(r.label)}</span><span class="rs-val">${fmt(r.value, r.unit)}</span></div>`
    ).join('');
    return `<div class="rs-popup">
      <div class="rs-head">Raster values <span class="rs-coord">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
      ${rows.length > 1 ? `<select class="rs-select">${opts}</select>` : ''}
      <div class="rs-rows">${rowHtml}</div>
    </div>`;
  }

  private showRasterSamplePopup(lngLat: maplibregl.LngLatLike, html: string): maplibregl.Popup {
    this.rasterSamplePopup?.remove();
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', className: 'rs-maplibre-popup' })
      .setLngLat(lngLat).setHTML(html).addTo(this.mapManager.getMap());
    this.rasterSamplePopup = popup;
    return popup;
  }

  private getActiveVectorLayerIds(): string[] {
    const map = this.mapManager.getMap();
    const ids: string[] = [];
    if (this.nsprdLayer) ids.push(...this.nsprdLayer.getLayerIds());
    for (const layer of this.nshnLayers.values()) ids.push(...layer.getLayerIds());
    for (const iid of this.geojsonOverlays.keys()) {
      for (const suffix of ['fill', 'line', 'point']) ids.push(`bm-ov-${iid}-${suffix}`);
    }
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
      const iid = rawLayerId.replace(/^bm-ov-/, '').replace(/-(?:stroke|fill|line|point)$/, '');
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
          label: def?.label ?? stackLayer?.label ?? 'Layer',
          fieldLabels: def?.vector_config?.fieldLabels ?? (stackLayer ? this.getVectorConfig(stackLayer)?.fieldLabels : undefined),
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
        const block = btn.closest<HTMLElement>('.fm-popup-feat-block');
        const typeLabel = block?.querySelector<HTMLSelectElement>('.fm-type-select')?.value ?? '';
        EventBus.emit('add-identify-feature', {
          geometry: feat.geometry,
          label: group.label,
          props: feat.props,
          typeLabel,
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
    const typeSelectHtml = (geomType: string | null | undefined): string => {
      if (!geomType) return '';
      const appType = geomType === 'Point' ? 'Point' : geomType === 'LineString' ? 'LineString' : 'Polygon';
      const presets = this.typePresets.filter(p => p.geometry_type === appType || p.geometry_type === 'all');
      if (presets.length === 0) return '';
      return `<select class="fm-type-select">
        <option value="">Type: None</option>
        ${presets.map(p => `<option value="${p.label}">${p.label}</option>`).join('')}
      </select>`;
    };

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
          <div class="fm-add-sketch-row">
            ${typeSelectHtml(feat.geometry?.type)}
            <button class="fm-add-sketch" data-tab="0" data-feat="${fi}" title="Add to sketch layer">＋ Add to sketch</button>
          </div>
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
          <div class="fm-add-sketch-row">
            ${typeSelectHtml(feat.geometry?.type)}
            <button class="fm-add-sketch" data-tab="${i}" data-feat="${fi}" title="Add to sketch layer">＋ Add to sketch</button>
          </div>
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
  addDefToStack(def: BasemapDef, params?: Record<string, unknown>): void {
    this.addToStack(def, params);
  }

  /**
   * Convert a BasemapDef into a StackLayer with all type-specific defaults
   * (COG, NSHN/NSPRD vector, HRDEM-WCS). Pure + static so it can also build a
   * stack JSON for project templates without mutating the live stack.
   * `overrides` are applied last (e.g. opacity, visible, vector overrides).
   */
  static defToStackLayer(def: BasemapDef, overrides?: Partial<StackLayer>): StackLayer {
    const instanceId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const base: StackLayer = {
      instanceId, defId: def.id, label: def.label, url: def.url,
      type: def.type, vector_config: def.vector_config,
      tileSize: def.tile_size ?? 256, maxZoom: def.max_zoom ?? 19,
      opacity: 1.0, visible: true,
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
      BasemapManager.applyHrdemDefaults(base, def);
    }
    return overrides ? { ...base, ...overrides } : base;
  }

  /**
   * Build a serialized basemap stack from template specs (defId + overrides),
   * resolving each id against the full catalogue. Unknown ids are skipped.
   * Returns the same `{ stack, collapsed }` JSON shape projects persist.
   */
  static buildStackJson(specs: Array<{ defId: string; overrides?: Record<string, unknown> }>): string {
    const all = ALL_DEFS();
    const stack: StackLayer[] = [];
    for (const spec of specs) {
      const def = all.find(d => d.id === spec.defId);
      if (!def) { console.warn(`[BasemapManager] template defId not found: ${spec.defId}`); continue; }
      stack.push(BasemapManager.defToStackLayer(def, spec.overrides as Partial<StackLayer> | undefined));
    }
    return JSON.stringify({ stack, collapsed: [] });
  }

  private static applyHrdemDefaults(base: StackLayer, def: BasemapDef): void {
      const productMap: Record<string, string> = {
        'hrdem-slope': 'slope', 'hrdem-aspect': 'aspect',
        'hrdem-tpi': 'tpi', 'hrdem-contours': 'elevation',
        'hrdem-chm': 'chm',
        'raster-fn-hillshade':     'hillshade',
        'raster-fn-dsm-hillshade': 'hillshade',
        'raster-fn-roughness':     'roughness',
        'raster-fn-slope-pct':     'slope',
        'raster-fn-aspect':        'aspect',
        'raster-fn-tpi':           'tpi',
        'raster-fn-chm-focal':     'chm-focal',
      };
      const surfaceMap: Record<string, string> = {
        'hrdem-dsm-elevation': 'dsm',
        'raster-fn-dsm-hillshade': 'dsm',
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
      // Slope % grade default
      if (def.id === 'raster-fn-slope-pct') base.hrdemSlopeUnit = 'percent';
  }

  private addToStack(def: BasemapDef, params?: Record<string, unknown>): void {
    const base = BasemapManager.defToStackLayer(def);
    // Apply configure-time parameter overrides for raster functions
    if (params && def.group === 'Raster Functions') {
      const n = (k: string) => typeof params[k] === 'number' ? params[k] as number : undefined;
      const s = (k: string) => typeof params[k] === 'string' ? params[k] as string : undefined;
      if (def.id === 'raster-fn-hillshade' || def.id === 'raster-fn-dsm-hillshade') {
        if (n('azimuth')  !== undefined) base.hrdemHillshadeAzimuth  = n('azimuth');
        if (n('altitude') !== undefined) base.hrdemHillshadeAltitude = n('altitude');
        if (n('zFactor')  !== undefined) base.hrdemHillshadeZFactor  = n('zFactor');
      }
      if (def.id === 'raster-fn-slope-pct') {
        if (s('unit')    !== undefined) base.hrdemSlopeUnit    = s('unit');
        if (s('stretch') !== undefined) base.hrdemSlopeStretch = s('stretch');
      }
      if (def.id === 'raster-fn-tpi') {
        if (s('stretch') !== undefined) base.hrdemTpiStretch = s('stretch');
      }
      if (def.id === 'raster-fn-chm-focal') {
        if (s('neighborhood') !== undefined) base.hrdemChmFocalNeighborhood = s('neighborhood');
        if (n('width')        !== undefined) base.hrdemChmFocalWidth        = n('width');
        if (n('height')       !== undefined) base.hrdemChmFocalHeight       = n('height');
        if (n('radius')       !== undefined) base.hrdemChmFocalRadius       = n('radius');
        if (s('stat')         !== undefined) base.hrdemChmFocalStat         = s('stat');
        if (n('percentile')   !== undefined) base.hrdemChmFocalPercentile   = n('percentile');
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

  /** Remove every stack layer matching a defId (used when a shared layer is deleted). */
  removeDefFromStack(defId: string): void {
    for (const l of this.stack.filter(l => l.defId === defId)) this.removeFromStack(l.instanceId);
  }

  /** Encode current stack as a compact base64 string for URL sharing. */
  getUrlStackParam(): string {
    try {
      const knownIds = new Set(ALL_DEFS().map(d => d.id));
      const compact = this.stack
        .filter(l => knownIds.has(l.defId))
        .map(l => {
          const e: Record<string, unknown> = { d: l.defId };
          // Core
          if (Math.round(l.opacity * 100) !== 100) e.o = Math.round(l.opacity * 100);
          if (!l.visible) e.v = 0;
          // Blend mode
          if (l.blendMode && l.blendMode !== 'normal') e.bm = l.blendMode;
          // Vector colour/stroke overrides
          if (l.vecLineColor) e.vlc = l.vecLineColor;
          if (l.vecLineWidth !== undefined) e.vlw = l.vecLineWidth;
          if (l.vecFillColor) e.vfc = l.vecFillColor;
          if (l.vecFillOpacityOverride !== undefined) e.vfo = Math.round(l.vecFillOpacityOverride * 100);
          // COG
          if (l.cogRampId) e.cr = l.cogRampId;
          if (l.cogRampInvert) e.cri = 1;
          if (l.cogSmooth) e.cs = 1;
          if (l.cogClasses) e.ckl = l.cogClasses;
          if (l.cogMin !== undefined) e.cmn = l.cogMin;
          if (l.cogMax !== undefined) e.cmx = l.cogMax;
          // RGB recolouring
          if (l.rasterSymbology) e.rsy = l.rasterSymbology;
          if (l.cogContourThreshold !== undefined && l.cogContourThreshold !== 0.5) e.cct = l.cogContourThreshold;
          if (l.cogContourLineColor && l.cogContourLineColor !== '#1565c0') e.ccl = l.cogContourLineColor;
          if (l.cogContourLineWidth !== undefined && l.cogContourLineWidth !== 2.0) e.cclw = l.cogContourLineWidth;
          if (l.cogContourFillEnabled) e.ccf = 1;
          if (l.cogContourFillColor && l.cogContourFillColor !== '#1565c0') e.ccfc = l.cogContourFillColor;
          if (l.cogContourFillOpacity !== undefined && l.cogContourFillOpacity !== 0.30) e.ccfo = Math.round(l.cogContourFillOpacity * 100);
          // HRDEM core
          if (l.hrdemProduct && l.hrdemProduct !== 'elevation') e.p = l.hrdemProduct;
          if (l.hrdemSurface && l.hrdemSurface !== 'dtm') e.hs = l.hrdemSurface;
          if (l.hrdemRampId) e.r = l.hrdemRampId;
          if (l.hrdemRampInvert) e.ri = 1;
          if (l.hrdemRasterVisible === false) e.hrv = 0;
          // HRDEM stretch + classification
          if (l.hrdemStretch && l.hrdemStretch !== 'percentile') e.hstr = l.hrdemStretch;
          if (l.hrdemStretchMin !== undefined) e.hsmn = l.hrdemStretchMin;
          if (l.hrdemStretchMax !== undefined) e.hsmx = l.hrdemStretchMax;
          if (l.hrdemClassify) e.hkls = 1;
          if (l.hrdemClassifier && l.hrdemClassifier !== 'Natural breaks') e.hklf = l.hrdemClassifier;
          if (l.hrdemClassCount !== undefined && l.hrdemClassCount !== 5) e.hknt = l.hrdemClassCount;
          // HRDEM contours
          if (l.hrdemContourEnabled) e.ce = 1;
          if (l.hrdemContourInterval) e.ci = l.hrdemContourInterval;
          if (l.hrdemContourColor && l.hrdemContourColor !== '#ffffff') e.hcc = l.hrdemContourColor;
          if (l.hrdemContourWidth !== undefined && l.hrdemContourWidth !== 1.2) e.hcw = l.hrdemContourWidth;
          if (l.hrdemContourMinZoom !== undefined && l.hrdemContourMinZoom !== 14) e.hcmz = l.hrdemContourMinZoom;
          // HRDEM hillshade
          if (l.hrdemHillshadeAzimuth !== undefined && l.hrdemHillshadeAzimuth !== 315) e.hha = l.hrdemHillshadeAzimuth;
          if (l.hrdemHillshadeAltitude !== undefined && l.hrdemHillshadeAltitude !== 45) e.hhalt = l.hrdemHillshadeAltitude;
          if (l.hrdemHillshadeZFactor !== undefined && l.hrdemHillshadeZFactor !== 1) e.hhz = l.hrdemHillshadeZFactor;
          // HRDEM slope
          if (l.hrdemSlopeRampId && l.hrdemSlopeRampId !== 'classic') e.hsr = l.hrdemSlopeRampId;
          if (l.hrdemSlopeUnit && l.hrdemSlopeUnit !== 'degrees') e.hsu = l.hrdemSlopeUnit;
          if (l.hrdemSlopeStretch && l.hrdemSlopeStretch !== 'auto') e.hss = l.hrdemSlopeStretch;
          if (l.hrdemSlopeInvert) e.hsi = 1;
          // HRDEM aspect
          if (l.hrdemAspectSat !== undefined && l.hrdemAspectSat !== 80) e.hasat = l.hrdemAspectSat;
          if (l.hrdemAspectLight !== undefined && l.hrdemAspectLight !== 50) e.halit = l.hrdemAspectLight;
          // HRDEM TPI
          if (l.hrdemTpiRampId && l.hrdemTpiRampId !== 'rdylbu') e.htr = l.hrdemTpiRampId;
          if (l.hrdemTpiStretch && l.hrdemTpiStretch !== 'symmetric') e.hts = l.hrdemTpiStretch;
          if (l.hrdemTpiInvert) e.hti = 1;
          // HRDEM CHM
          if (l.hrdemChmMode && l.hrdemChmMode !== 'classified') e.hcm = l.hrdemChmMode;
          if (l.hrdemChmRampId && l.hrdemChmRampId !== 'canopy_green') e.hcr = l.hrdemChmRampId;
          if (l.hrdemChmInvert) e.hci = 1;
          if (l.hrdemChmClassPaletteId && l.hrdemChmClassPaletteId !== 'structural') e.hcp = l.hrdemChmClassPaletteId;
          // HRDEM CHM focal stats
          if (l.hrdemChmFocalNeighborhood && l.hrdemChmFocalNeighborhood !== 'circle') e.hcfn = l.hrdemChmFocalNeighborhood;
          if (l.hrdemChmFocalWidth !== undefined && l.hrdemChmFocalWidth !== 3) e.hcfw = l.hrdemChmFocalWidth;
          if (l.hrdemChmFocalHeight !== undefined && l.hrdemChmFocalHeight !== 3) e.hcfh = l.hrdemChmFocalHeight;
          if (l.hrdemChmFocalRadius !== undefined && l.hrdemChmFocalRadius !== 3) e.hcfr = l.hrdemChmFocalRadius;
          if (l.hrdemChmFocalStat && l.hrdemChmFocalStat !== 'mean') e.hcfs = l.hrdemChmFocalStat;
          if (l.hrdemChmFocalPercentile !== undefined && l.hrdemChmFocalPercentile !== 50) e.hcfp = l.hrdemChmFocalPercentile;
          return e;
        });
      return btoa(JSON.stringify(compact));
    } catch { return ''; }
  }

  /** Restore stack from a base64 URL param (does not clobber if param is empty). */
  restoreFromUrlStack(encoded: string): void {
    if (!encoded) return;
    try {
      const compact = JSON.parse(atob(encoded)) as Array<Record<string, unknown>>;
      if (!Array.isArray(compact) || compact.length === 0) return;
      const allDefs = ALL_DEFS();
      const stack: StackLayer[] = [];
      for (const e of compact) {
        const defId = e['d'] as string;
        const def = allDefs.find(d => d.id === defId);
        if (!def) continue;
        const opacity  = typeof e['o'] === 'number' ? (e['o'] as number) / 100 : 1;
        const visible  = e['v'] !== 0;
        const layer: StackLayer = {
          instanceId: `${defId}-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
          defId, label: def.label, url: def.url,
          type: def.type, tileSize: def.tile_size ?? 256, maxZoom: def.max_zoom ?? 22,
          opacity, visible,
        };
        if (e['bm'] && typeof e['bm'] === 'string') layer.blendMode = e['bm'] as string;
        // Vector colours
        if (e['vlc']) layer.vecLineColor = e['vlc'] as string;
        if (typeof e['vlw'] === 'number') layer.vecLineWidth = e['vlw'] as number;
        if (e['vfc']) layer.vecFillColor = e['vfc'] as string;
        if (typeof e['vfo'] === 'number') layer.vecFillOpacityOverride = (e['vfo'] as number) / 100;
        // COG
        if (e['cr'])  layer.cogRampId = e['cr'] as string;
        if (e['cri']) layer.cogRampInvert = true;
        if (e['cs'])  layer.cogSmooth = true;
        if (typeof e['ckl'] === 'number') layer.cogClasses = e['ckl'] as number;
        if (typeof e['cmn'] === 'number') layer.cogMin = e['cmn'] as number;
        if (typeof e['cmx'] === 'number') layer.cogMax = e['cmx'] as number;
        // RGB recolouring
        if (e['rsy'] && typeof e['rsy'] === 'object') layer.rasterSymbology = e['rsy'] as RasterSymbologyState;
        if (typeof e['cct']  === 'number') layer.cogContourThreshold   = e['cct']  as number;
        if (e['ccl'])                      layer.cogContourLineColor    = e['ccl']  as string;
        if (typeof e['cclw'] === 'number') layer.cogContourLineWidth    = e['cclw'] as number;
        if (e['ccf'])                      layer.cogContourFillEnabled  = true;
        if (e['ccfc'])                     layer.cogContourFillColor    = e['ccfc'] as string;
        if (typeof e['ccfo'] === 'number') layer.cogContourFillOpacity  = (e['ccfo'] as number) / 100;
        // HRDEM core
        if (e['p'])   layer.hrdemProduct       = e['p']  as string;
        if (e['hs'])  layer.hrdemSurface        = e['hs'] as string;
        if (e['r'])   layer.hrdemRampId         = e['r']  as string;
        if (e['ri'])  layer.hrdemRampInvert      = true;
        if (e['hrv'] === 0) layer.hrdemRasterVisible = false;
        // HRDEM stretch + classification
        if (e['hstr'])                      layer.hrdemStretch    = e['hstr'] as string;
        if (typeof e['hsmn'] === 'number')  layer.hrdemStretchMin = e['hsmn'] as number;
        if (typeof e['hsmx'] === 'number')  layer.hrdemStretchMax = e['hsmx'] as number;
        if (e['hkls'])                      layer.hrdemClassify   = true;
        if (e['hklf'])                      layer.hrdemClassifier = e['hklf'] as string;
        if (typeof e['hknt'] === 'number')  layer.hrdemClassCount = e['hknt'] as number;
        // HRDEM contours
        if (e['ce'])                       layer.hrdemContourEnabled  = true;
        if (e['ci'])                       layer.hrdemContourInterval = e['ci']  as number;
        if (e['hcc'])                      layer.hrdemContourColor    = e['hcc'] as string;
        if (typeof e['hcw']  === 'number') layer.hrdemContourWidth    = e['hcw']  as number;
        if (typeof e['hcmz'] === 'number') layer.hrdemContourMinZoom  = e['hcmz'] as number;
        // HRDEM hillshade
        if (typeof e['hha']  === 'number') layer.hrdemHillshadeAzimuth  = e['hha']  as number;
        if (typeof e['hhalt'] === 'number') layer.hrdemHillshadeAltitude = e['hhalt'] as number;
        if (typeof e['hhz']  === 'number') layer.hrdemHillshadeZFactor   = e['hhz']  as number;
        // HRDEM slope
        if (e['hsr']) layer.hrdemSlopeRampId  = e['hsr'] as string;
        if (e['hsu']) layer.hrdemSlopeUnit     = e['hsu'] as string;
        if (e['hss']) layer.hrdemSlopeStretch  = e['hss'] as string;
        if (e['hsi']) layer.hrdemSlopeInvert   = true;
        // HRDEM aspect
        if (typeof e['hasat'] === 'number') layer.hrdemAspectSat   = e['hasat'] as number;
        if (typeof e['halit'] === 'number') layer.hrdemAspectLight  = e['halit'] as number;
        // HRDEM TPI
        if (e['htr']) layer.hrdemTpiRampId  = e['htr'] as string;
        if (e['hts']) layer.hrdemTpiStretch  = e['hts'] as string;
        if (e['hti']) layer.hrdemTpiInvert   = true;
        // HRDEM CHM
        if (e['hcm'])  layer.hrdemChmMode           = e['hcm']  as string;
        if (e['hcr'])  layer.hrdemChmRampId          = e['hcr']  as string;
        if (e['hci'])  layer.hrdemChmInvert           = true;
        if (e['hcp'])  layer.hrdemChmClassPaletteId   = e['hcp']  as string;
        // HRDEM CHM focal stats
        if (e['hcfn'])                      layer.hrdemChmFocalNeighborhood = e['hcfn'] as string;
        if (typeof e['hcfw'] === 'number')  layer.hrdemChmFocalWidth        = e['hcfw'] as number;
        if (typeof e['hcfh'] === 'number')  layer.hrdemChmFocalHeight       = e['hcfh'] as number;
        if (typeof e['hcfr'] === 'number')  layer.hrdemChmFocalRadius       = e['hcfr'] as number;
        if (e['hcfs'])                      layer.hrdemChmFocalStat         = e['hcfs'] as string;
        if (typeof e['hcfp'] === 'number')  layer.hrdemChmFocalPercentile   = e['hcfp'] as number;
        stack.push(layer);
      }
      if (stack.length === 0) return;
      this.stack = stack;
      this.rebuildMap();
      this.saveStack();
    } catch { /* ignore malformed */ }
  }

  private addUserLayerToStack(ul: UserLayerInfo, container: HTMLElement, onClose: () => void): void {
    if (!ul.tileUrl) return;
    const instanceId = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    this.stack.unshift({
      instanceId, defId: ul.id, label: ul.name, url: ul.tileUrl,
      tileSize: 256, maxZoom: 22,
      opacity: ul.opacity, visible: ul.visible,
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

  /** The base symbology color for a static GeoJSON overlay. */
  private geojsonColor(l: StackLayer): string {
    const cfg = this.getVectorConfig(l);
    if (l.vecFillColor) return l.vecFillColor;
    if (typeof cfg?.fillColor === 'string') return cfg.fillColor;
    if (typeof cfg?.lineColor === 'string') return cfg.lineColor;
    return '#3388ff';
  }

  /**
   * Render (or refresh) a static GeoJSON overlay from the shared data library.
   * Fetches the file from R2 once, caches its features for symbology/identify,
   * and renders as a non-editable fill/line/point overlay.
   */
  private renderGeojsonOverlay(l: StackLayer): void {
    const baseId = `bm-ov-${l.instanceId}`;
    const color = this.geojsonColor(l);

    const applyState = () => {
      if (l.symbologyState) {
        const feats = this.geojsonOverlays.get(l.instanceId) ?? [];
        this.mapManager.setImportedLayerSymbology(baseId, l.symbologyState, feats, color);
      }
      // Labels by any attribute (also removes the label layer when cleared).
      this.mapManager.setLayerLabels(`src-${baseId}`, `${baseId}-labels`, l.symbologyState ?? null);
      this.applyGeojsonOpacityVisibility(l, baseId);
    };

    if (this.geojsonOverlays.has(l.instanceId)) {
      const map = this.mapManager.getMap();
      const beforeExists = !!map.getLayer(LAYER_IDS.USER_ACCURACY);
      for (const suffix of ['fill', 'casing', 'line', 'point']) {
        const lid = `${baseId}-${suffix}`;
        if (map.getLayer(lid) && beforeExists) map.moveLayer(lid, LAYER_IDS.USER_ACCURACY);
      }
      applyState();
      return;
    }
    if (this.geojsonLoading.has(l.instanceId)) return;
    this.geojsonLoading.add(l.instanceId);

    void (async () => {
      try {
        const res = await fetch(l.url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string } }> };
        const feats = (data.features ?? []).map(f => ({ properties: (f.properties ?? {}) as Record<string, unknown> }));
        this.geojsonOverlays.set(l.instanceId, feats);
        this.geojsonGeomType.set(l.instanceId, this.detectGeomType(data.features));
        this.mapManager.addGeoJSONLayer(baseId, data, color, l.opacity ?? 1);
        applyState();
        this.refreshLegend();
      } catch (err) {
        console.warn(`[BasemapManager] failed to load shared layer "${l.label}":`, err);
        EventBus.emit('toast', { message: `Couldn't load ${l.label}`, type: 'error' });
      } finally {
        this.geojsonLoading.delete(l.instanceId);
      }
    })();
  }

  /** Dominant geometry class of a GeoJSON feature array (for the Symbology Studio). */
  private detectGeomType(features?: Array<{ geometry?: { type?: string } }>): 'point' | 'line' | 'polygon' {
    for (const f of features ?? []) {
      const t = f.geometry?.type ?? '';
      if (t.includes('Polygon')) return 'polygon';
      if (t.includes('LineString')) return 'line';
      if (t.includes('Point')) return 'point';
    }
    return 'polygon';
  }

  private applyGeojsonOpacityVisibility(l: StackLayer, baseId: string): void {
    const map = this.mapManager.getMap();
    const vis = l.visible ? 'visible' : 'none';
    const op = l.opacity ?? 1;
    for (const suffix of ['fill', 'line', 'point'] as const) {
      const id = `${baseId}-${suffix}`;
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, 'visibility', vis);
      if (!l.symbologyState) {
        if (suffix === 'fill') map.setPaintProperty(id, 'fill-opacity', op * 0.4);
        else if (suffix === 'line') map.setPaintProperty(id, 'line-opacity', op);
        else map.setPaintProperty(id, 'circle-opacity', op);
      }
    }
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
    const origMin = origColormap[0][0];
    const origMax = origColormap[origColormap.length - 1][0];
    const minVal = layer.cogMin ?? origMin;
    const maxVal = layer.cogMax ?? origMax;

    if (rampId === 'original') {
      // Remap original stop values into the (possibly custom) range, keep colours
      const origRange = origMax - origMin || 1;
      const scale = (maxVal - minVal) / origRange;
      let stops = (origColormap as [number,number,number,number,number][]).map(
        (s): [number,number,number,number,number] =>
          [minVal + (s[0] - origMin) * scale, s[1], s[2], s[3], s[4]]);
      if (invert) {
        const colors = stops.map(s => [s[1], s[2], s[3], s[4]] as [number,number,number,number]);
        colors.reverse();
        stops = stops.map((s, i): [number,number,number,number,number] =>
          [s[0], colors[i][0], colors[i][1], colors[i][2], colors[i][3]]);
      }
      this.mapManager.setCogColormap(cogUrl, stops);
      return;
    }
    const stops = buildCogColormap(rampId, invert, minVal, maxVal, layer.cogClasses, layer.cogBreaks);
    if (stops) this.mapManager.setCogColormap(cogUrl, stops);
  }

  private applyCogSmooth(layer: StackLayer): void {
    const cogUrl = BasemapManager.cogUrlFromLayer(layer);
    this.mapManager.setCogSmooth(cogUrl, layer.cogSmooth ?? false);
  }

  // ---- HRDEM ramp helpers ----

  private resolveHrdemRamp(layer: StackLayer): ColorRamp {
    const id = layer.hrdemRampId ?? 'terrain';
    const entry = HRDEM_RAMPS[id] ?? EXTENDED_COLOR_RAMPS[id] ?? HRDEM_RAMPS['terrain'];
    return layer.hrdemRampInvert ? invertRamp(entry.ramp) : entry.ramp;
  }

  // ---- RGB tile recolouring (rampify://) ----

  /**
   * Resolve the tile URL for a plain raster stack layer, wrapping it in the
   * rampify:// recolour protocol when a colour ramp is applied. Also registers
   * (or clears) the layer's luminance LUT with the MapManager.
   */
  private resolveRasterUrl(layer: StackLayer): string {
    const baseUrl = layer.url;
    const sym = layer.rasterSymbology;
    const unsupported = baseUrl.startsWith('cog://') || baseUrl.startsWith('mbtiles://')
      || baseUrl.startsWith('rampify://');
    if (!sym || sym.rampId === 'original' || unsupported) {
      this.mapManager.setRasterRecolorLut(layer.instanceId, null);
      return baseUrl;
    }
    const lut = buildRgbLut(sym);
    if (!lut) {
      this.mapManager.setRasterRecolorLut(layer.instanceId, null);
      return baseUrl;
    }
    this.mapManager.setRasterRecolorLut(layer.instanceId, lut);
    return MapManager.rampifyUrl(layer.instanceId, baseUrl, this.rasterStyleVersion);
  }

  /** Effective HRDEM product for a stack layer (mirrors rebuildMap's resolution). */
  private effectiveHrdemProduct(layer: StackLayer): string {
    return layer.hrdemProduct ?? (
      layer.defId === 'hrdem-slope'               ? 'slope'
      : layer.defId === 'hrdem-aspect'            ? 'aspect'
      : layer.defId === 'hrdem-tpi'               ? 'tpi'
      : layer.defId === 'hrdem-chm'               ? 'chm'
      : layer.defId === 'raster-fn-hillshade'     ? 'hillshade'
      : layer.defId === 'raster-fn-dsm-hillshade' ? 'hillshade'
      : layer.defId === 'raster-fn-roughness'     ? 'roughness'
      : layer.defId === 'raster-fn-slope-pct'     ? 'slope'
      : layer.defId === 'raster-fn-aspect'        ? 'aspect'
      : layer.defId === 'raster-fn-tpi'           ? 'tpi'
      : layer.defId === 'raster-fn-chm-focal'     ? 'chm-focal'
      : 'elevation'
    );
  }

  /** Open the Raster Symbology Studio for a raster / COG / HRDEM stack layer. */
  private async openRasterSymbology(layer: StackLayer, container: HTMLElement, onClose: () => void): Promise<void> {
    const ltype = this.getLayerType(layer);
    const rerender = () => this.renderContent(container, onClose);

    if (ltype === 'hrdem-wcs') {
      const product = this.effectiveHrdemProduct(layer);
      const rampId = product === 'slope' ? (layer.hrdemSlopeRampId ?? 'classic')
        : product === 'tpi'       ? (layer.hrdemTpiRampId ?? 'rdylbu')
        : product === 'chm-focal' ? (layer.hrdemChmRampId ?? 'canopy_green')
        : (layer.hrdemRampId ?? 'terrain');
      const invert = product === 'slope' ? (layer.hrdemSlopeInvert ?? false)
        : product === 'tpi'       ? (layer.hrdemTpiInvert ?? false)
        : product === 'chm-focal' ? (layer.hrdemChmInvert ?? false)
        : (layer.hrdemRampInvert ?? false);
      const res = this.hrdemLayers.get(layer.instanceId)?.getLastResult() ?? null;

      this.rasterSymbologyStudio.open({
        title: layer.label,
        kind: 'dem',
        hasOriginal: false,
        dataDriven: true,
        demStretch: product === 'elevation',
        valueUnit: product === 'elevation' ? 'm' : '',
        valueRange: res
          ? [Math.round(res.stretchMin), Math.round(res.stretchMax)]
          : [layer.hrdemStretchMin ?? 0, layer.hrdemStretchMax ?? 100],
        initial: {
          rampId,
          invert,
          mode: layer.hrdemClassify ? 'classified' : 'continuous',
          classifier: (layer.hrdemClassifier ?? 'Natural breaks') as ClassifierName,
          classes: layer.hrdemClassCount ?? 5,
          stretch: (layer.hrdemStretch ?? 'percentile') as RasterStretchMode,
          stretchMin: layer.hrdemStretchMin,
          stretchMax: layer.hrdemStretchMax,
        },
        onApply: (s) => {
          if (product === 'slope')          { layer.hrdemSlopeRampId = s.rampId; layer.hrdemSlopeInvert = s.invert; }
          else if (product === 'tpi')       { layer.hrdemTpiRampId   = s.rampId; layer.hrdemTpiInvert   = s.invert; }
          else if (product === 'chm-focal') { layer.hrdemChmRampId   = s.rampId; layer.hrdemChmInvert   = s.invert; }
          else                              { layer.hrdemRampId      = s.rampId; layer.hrdemRampInvert  = s.invert; }
          layer.hrdemClassify   = s.mode === 'classified';
          layer.hrdemClassifier = s.classifier;
          layer.hrdemClassCount = s.classes;
          if (product === 'elevation') {
            layer.hrdemStretch    = s.stretch;
            layer.hrdemStretchMin = s.stretchMin;
            layer.hrdemStretchMax = s.stretchMax;
          }
          const inst = this.hrdemLayers.get(layer.instanceId);
          if (inst) {
            inst.setRenderOptions({
              stretchMode: (layer.hrdemStretch ?? 'percentile') as RasterStretchMode,
              stretchMin:  layer.hrdemStretchMin,
              stretchMax:  layer.hrdemStretchMax,
              classify:    layer.hrdemClassify ?? false,
              classifier:  (layer.hrdemClassifier ?? 'Natural breaks') as ClassifierName,
              classes:     layer.hrdemClassCount ?? 5,
            });
            if (product === 'slope') {
              inst.setProductStyle({ slopeRampId: s.rampId, slopeInvert: s.invert ?? false });
            } else if (product === 'tpi') {
              inst.setProductStyle({ tpiRampId: s.rampId, tpiInvert: s.invert ?? false });
            } else if (product === 'chm-focal') {
              inst.setProductStyle({ chmRampId: s.rampId, chmInvert: s.invert ?? false });
            } else {
              inst.setRamp(this.resolveHrdemRamp(layer));
            }
          }
          this.saveStack();
          rerender();
        },
      });
      return;
    }

    if (layer.url.startsWith('cog://')) {
      const def = ALL_DEFS().find(d => d.id === layer.defId);
      const cm = def?.cog_colormap;
      const origMin = cm?.[0][0] ?? 0;
      const origMax = cm?.[cm.length - 1][0] ?? 1;
      const originalCss = cm
        ? `linear-gradient(to right,${cm.map(s => `rgba(${s[1]},${s[2]},${s[3]},${s[4] / 255})`).join(',')})`
        : undefined;

      // COGs have intrinsic pixel access — sample a coarse overview so the studio
      // can offer data-driven classifiers (Natural breaks / Quantile), not just equal interval.
      const dataValues = await this.mapManager.sampleCogValues(BasemapManager.cogUrlFromLayer(layer));
      const dataDriven = dataValues.length >= 50;

      this.rasterSymbologyStudio.open({
        title: layer.label,
        kind: 'cog',
        hasOriginal: true,
        originalCss,
        dataDriven,
        dataValues,
        valueRange: [layer.cogMin ?? origMin, layer.cogMax ?? origMax],
        initial: {
          rampId: layer.cogRampId ?? 'original',
          invert: layer.cogRampInvert ?? false,
          mode: (layer.cogClasses ?? 0) >= 2 ? 'classified' : 'continuous',
          classifier: (layer.cogClassifier ?? 'Natural breaks') as ClassifierName,
          classes: layer.cogClasses ?? 5,
          stretchMin: layer.cogMin ?? origMin,
          stretchMax: layer.cogMax ?? origMax,
        },
        onApply: (s) => {
          layer.cogRampId = s.rampId;
          layer.cogRampInvert = s.invert;
          layer.cogClasses = s.mode === 'classified' ? (s.classes ?? 5) : undefined;
          layer.cogClassifier = s.classifier;
          layer.cogMin = s.stretchMin;
          layer.cogMax = s.stretchMax;
          // Data-driven classifiers compute real breaks from the sampled pixels;
          // equal interval leaves breaks unset (buildCogColormap bins evenly).
          if (s.mode === 'classified' && dataDriven && s.classifier && s.classifier !== 'Equal interval') {
            layer.cogBreaks = computeClassBreaks(dataValues, s.classes ?? 5, s.classifier);
          } else {
            layer.cogBreaks = undefined;
          }
          this.applyCogRamp(layer);
          this.refreshRasterOverlays();
          this.saveStack();
          rerender();
        },
      });
      return;
    }

    // Plain RGB tile layer / web source — luminance recolouring
    this.rasterSymbologyStudio.open({
      title: layer.label,
      kind: 'rgb',
      hasOriginal: true,
      dataDriven: false,
      initial: layer.rasterSymbology ?? { rampId: 'original' },
      onApply: (s) => {
        layer.rasterSymbology = s.rampId === 'original' ? undefined : s;
        this.rasterStyleVersion++;
        this.rebuildMap();
        this.saveStack();
        rerender();
      },
    });
  }

  // ---- Map Legend drawer ----

  /** App registers the legend drawer body element here; legend re-renders into it. */
  setLegendContainer(el: HTMLElement): void {
    this.legendBodyEl = el;
    this.refreshLegend();
  }

  /** True for layers eligible to appear in the legend (visible, non-base, toggled on). */
  private isLegendEligible(layer: StackLayer, idx: number): boolean {
    if (idx === this.stack.length - 1) return false; // base / basemap excluded
    if (!layer.visible) return false;
    return layer.showInLegend !== false;
  }

  /** Build the legend content block for a single stack layer. Returns '' if none. */
  private buildLegendBody(layer: StackLayer): string {
    const ltype = this.getLayerType(layer);

    if (ltype === 'hrdem-wcs') {
      // Contour layers are symbolised as vector lines — show a line swatch, not a raster ramp.
      const isContourDef = layer.defId === 'hrdem-contours' || layer.defId === 'hrdem-dsm-contours';
      const contourOnly = isContourDef || (layer.hrdemContourEnabled === true && layer.hrdemRasterVisible === false);
      if (contourOnly) {
        const col = layer.hrdemContourColor ?? (isContourDef ? '#000000' : '#ffffff');
        const ivl = layer.hrdemContourInterval ?? (isContourDef ? 1 : 10);
        const ivlLbl = ivl % 1 === 0 ? ivl.toFixed(0) : String(ivl);
        return `<div class="legend-row"><span class="legend-swatch-line" style="border-top:3px solid ${col}"></span><span class="legend-row-label">${ivlLbl} m contours</span></div>`;
      }
      return this.hrdemLayers.get(layer.instanceId)?.getLegendHTML() ?? '';
    }

    if (ltype === 'nsprd-vector' || ltype === 'nshn-vector') {
      const cfg = this.getVectorConfig(layer);
      const line = layer.vecLineColor ?? (typeof cfg?.lineColor === 'string' ? cfg.lineColor : '#888888');
      const fill = layer.vecFillColor ?? (cfg?.fillColor && typeof cfg.fillColor === 'string' ? cfg.fillColor : line);
      if (cfg?.geomType === 'line') {
        return `<div class="legend-row"><span class="legend-swatch-line" style="border-top:3px solid ${line}"></span><span class="legend-row-label">Line feature</span></div>`;
      }
      return `<div class="legend-row"><span class="legend-swatch" style="background:${fill};border-color:${line}"></span><span class="legend-row-label">Polygon feature</span></div>`;
    }

    if (ltype === 'cog-contour') {
      const col = layer.cogContourLineColor ?? '#1565c0';
      const thr = layer.cogContourThreshold ?? 50;
      return `<div class="legend-row"><span class="legend-swatch-line" style="border-top:3px solid ${col}"></span><span class="legend-row-label">Contour ≤ ${thr} cm</span></div>`;
    }

    // COG raster
    if (layer.url.startsWith('cog://')) {
      const rampId = layer.cogRampId ?? 'original';
      const invert = layer.cogRampInvert ?? false;
      const def = ALL_DEFS().find(d => d.id === layer.defId);
      const cm = def?.cog_colormap;
      const min = layer.cogMin ?? cm?.[0]?.[0] ?? 0;
      const max = layer.cogMax ?? cm?.[cm.length - 1]?.[0] ?? 1;
      if ((layer.cogClasses ?? 0) >= 2 && rampId !== 'original') {
        const ramp = RASTER_RAMPS[rampId];
        if (ramp) {
          const classes = (layer.cogBreaks && layer.cogBreaks.length)
            ? breaksToClasses(ramp.stops, invert, layer.cogBreaks, min, max, '', 1)
            : equalIntervalClasses(ramp.stops, invert, layer.cogClasses!, min, max, '', 1);
          return classifiedRowsHtml(classes);
        }
      }
      let grad: string;
      if (rampId === 'original' && cm) {
        grad = `linear-gradient(to top,${cm.map(s => `rgba(${s[1]},${s[2]},${s[3]},${s[4] / 255})`).join(',')})`;
      } else {
        const ramp = RASTER_RAMPS[rampId];
        grad = ramp ? `linear-gradient(to top,${(invert ? [...ramp.stops].reverse() : ramp.stops).map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(',')})` : '';
      }
      if (!grad) return '';
      return `<div class="legend-bar"><div class="legend-bar-gradient" style="background:${grad}"></div>
        <div class="legend-bar-labels"><span>${Number(max.toFixed(1))}</span><span>${Number(min.toFixed(1))}</span></div></div>`;
    }

    // Plain RGB tile / web raster with a recolour ramp
    if (ltype === 'raster' && layer.rasterSymbology && layer.rasterSymbology.rampId !== 'original') {
      const s = layer.rasterSymbology;
      const ramp = RASTER_RAMPS[s.rampId];
      if (!ramp) return '';
      const min = s.stretchMin ?? 0;
      const max = s.stretchMax ?? 255;
      if (s.mode === 'classified') {
        return classifiedRowsHtml(equalIntervalClasses(ramp.stops, s.invert ?? false, s.classes ?? 5, min, max, '', 0));
      }
      const grad = `linear-gradient(to top,${(s.invert ? [...ramp.stops].reverse() : ramp.stops).map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(',')})`;
      return `<div class="legend-bar"><div class="legend-bar-gradient" style="background:${grad}"></div>
        <div class="legend-bar-labels"><span>high</span><span>low</span></div></div>`;
    }

    // Plain image layer with no symbology — just note the layer type.
    return `<div class="legend-row-label" style="opacity:0.6">Image layer</div>`;
  }

  /** Rebuild the Map Legend drawer body from the current stack. */
  private refreshLegend(): void {
    const body = this.legendBodyEl;
    if (!body) return;
    try {
      const items = this.stack
        .map((layer, idx) => ({ layer, idx }))
        .filter(({ layer, idx }) => this.isLegendEligible(layer, idx))
        .reverse(); // top-most layer first

      if (items.length === 0) {
        body.innerHTML = `<div class="map-legend-empty">No layers in the legend.<br>Turn on “Show in legend” for a layer in the Table of Contents.</div>`;
        return;
      }

      body.innerHTML = items.map(({ layer }) => {
        const inner = this.buildLegendBody(layer);
        const collapsed = this.collapsedLegendItems.has(layer.instanceId);
        const badge = this.legendBadge(layer);
        return `<div class="legend-item${collapsed ? ' collapsed' : ''}" data-legend-iid="${layer.instanceId}">
          <button class="legend-item-header" data-legend-toggle="${layer.instanceId}">
            <span class="legend-chevron">▾</span>
            <span class="legend-item-title" title="${escHtml(layer.customLabel ?? layer.label)}">${escHtml(layer.customLabel ?? layer.label)}</span>
            ${badge ? `<span class="legend-item-badge">${badge}</span>` : ''}
          </button>
          <div class="legend-item-body">${inner || '<div class="legend-row-label" style="opacity:0.6">—</div>'}</div>
        </div>`;
      }).join('');

      body.querySelectorAll<HTMLButtonElement>('[data-legend-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          const iid = btn.dataset.legendToggle!;
          if (this.collapsedLegendItems.has(iid)) this.collapsedLegendItems.delete(iid);
          else this.collapsedLegendItems.add(iid);
          btn.closest('.legend-item')?.classList.toggle('collapsed', this.collapsedLegendItems.has(iid));
        });
      });
    } catch { /* map not ready yet */ }
  }

  private legendBadge(layer: StackLayer): string {
    const ltype = this.getLayerType(layer);
    if (layer.defId === 'hrdem-contours' || layer.defId === 'hrdem-dsm-contours') return 'CONTOUR';
    if (ltype === 'hrdem-wcs') return 'DEM';
    if (ltype === 'nsprd-vector' || ltype === 'nshn-vector') return 'VEC';
    if (ltype === 'cog-contour') return 'CONTOUR';
    if (layer.url.startsWith('cog://')) return 'COG';
    return 'RASTER';
  }

  private refreshRasterOverlays(): void {
    const overlays = this.stack.slice(0, this.stack.length - 1).reverse();
    this.mapManager.clearAllRasterOverlays();
    for (const l of overlays) {
      const ltype = this.getLayerType(l);
      if (ltype === 'raster') {
        this.mapManager.addSingleRasterOverlay({
          instanceId: l.instanceId,
          url: this.resolveRasterUrl(l),
          opacity: l.opacity, visible: l.visible,
        });
      } else if (ltype === 'nsprd-vector') {
        this.nsprdLayer?.activate(l.instanceId, l.opacity, l.visible);
      } else if (ltype === 'nshn-vector') {
        this.nshnLayers.get(l.instanceId)?.activate(l.instanceId, l.opacity, l.visible);
      }
    }
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
    if (this.getLayerType(baseLayer) === 'raster' && baseLayer.rasterSymbology) {
      this.mapManager.setBasemap({ ...baseDef, url: this.resolveRasterUrl(baseLayer) });
    } else {
      this.mapManager.setBasemap(baseDef);
    }
    this.mapManager.setBasemapOpacity(baseLayer.visible ? (baseLayer.opacity ?? 1) : 0);

    // overlays ordered bottom-to-top (index 0 = lowest in UI stack, last = highest)
    const overlays = this.stack.slice(0, this.stack.length - 1).reverse();

    // Clear all raster overlays so they can be re-inserted in the correct unified order.
    // This also removes any WebGLBlendLayer custom layers (same id convention: bm-ov-{iid}).
    this.mapManager.clearAllRasterOverlays();
    this.webglBlendLayers.clear();

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

    // Remove static GeoJSON overlays no longer in the stack
    const activeGeojsonIds = new Set(
      overlays.filter(l => this.getLayerType(l) === 'geojson').map(e => e.instanceId)
    );
    for (const iid of [...this.geojsonOverlays.keys()]) {
      if (!activeGeojsonIds.has(iid)) {
        this.mapManager.removeGeoJSONLayer(`bm-ov-${iid}`);
        this.geojsonOverlays.delete(iid);
        this.geojsonGeomType.delete(iid);
      }
    }

    // Process all overlay types in unified bottom-to-top order so map layer positions
    // match the UI stack exactly (last activated ends up closest to user features)
    for (const l of overlays) {
      const ltype = this.getLayerType(l);
      if (ltype === 'raster') {
        const blendMode = l.blendMode ?? 'normal';
        const resolvedUrl = this.resolveRasterUrl(l);
        const isTiledHttpUrl = !resolvedUrl.startsWith('cog://') && !resolvedUrl.startsWith('mbtiles://')
          && (resolvedUrl.includes('{x}') || resolvedUrl.includes('{bbox-epsg-3857}'));

        if (blendMode !== 'normal' && isTiledHttpUrl) {
          // Insert a WebGL custom layer at the correct z-position so blend composites
          // against the actual background at that point in the layer stack.
          const wbl = new WebGLBlendLayer(
            `bm-ov-${l.instanceId}`,
            resolvedUrl,
            blendMode,
            l.opacity,
            l.visible,
          );
          this.mapManager.addCustomBlendOverlay(wbl);
          this.webglBlendLayers.set(l.instanceId, wbl);
        } else {
          this.mapManager.addSingleRasterOverlay({
            instanceId: l.instanceId,
            url: resolvedUrl,
            opacity: l.opacity, visible: l.visible,
          });
        }
        // Re-apply COG ramp / invert / smooth overrides (needed after page reload or project switch)
        if (l.url.startsWith('cog://')) {
          if (l.cogRampId || l.cogRampInvert || l.cogClasses || l.cogMin !== undefined || l.cogMax !== undefined) this.applyCogRamp(l);
          if (l.cogSmooth) this.applyCogSmooth(l);
        }
      } else if (ltype === 'nsprd-vector') {
        if (!this.nsprdLayer) this.nsprdLayer = new NSPRDVectorLayer(this.mapManager);
        this.nsprdLayer.activate(l.instanceId, l.opacity, l.visible);
        this.applyVectorStyleOverrides(l);
        if (l.symbologyState) {
          this.mapManager.setVectorOverlaySymbology(l.instanceId, l.symbologyState, this.nsprdLayer.getLoadedFeatureProps(), 'polygon');
        }
      } else if (ltype === 'nshn-vector') {
        const cfg = this.getVectorConfig(l);
        if (!cfg) continue;
        if (!this.nshnLayers.has(l.instanceId)) {
          this.nshnLayers.set(l.instanceId, new NSHNVectorLayer(this.mapManager, cfg));
        }
        const nshnInst = this.nshnLayers.get(l.instanceId)!;
        nshnInst.activate(l.instanceId, l.opacity, l.visible);
        this.applyVectorStyleOverrides(l);
        if (l.symbologyState) {
          this.mapManager.setVectorOverlaySymbology(l.instanceId, l.symbologyState, nshnInst.getLoadedFeatureProps(), cfg.geomType === 'line' ? 'line' : 'polygon');
        }
      } else if (ltype === 'hrdem-wcs') {
        if (!this.hrdemLayers.has(l.instanceId)) {
          const newLayer = new HRDEMLayer(this.mapManager);
          newLayer.setCutFillResultProvider(this.cutFillResultProvider);
          this.hrdemLayers.set(l.instanceId, newLayer);
        }
        const hrdemInst = this.hrdemLayers.get(l.instanceId)!;
        hrdemInst.onLegendUpdate = () => this.refreshLegend();
        const isContourLayer = l.defId === 'hrdem-contours' || l.defId === 'hrdem-dsm-contours';
        hrdemInst.activate(l.instanceId, l.opacity, l.visible, this.resolveHrdemRamp(l));
        hrdemInst.setRasterVisible(l.hrdemRasterVisible ?? true);
        hrdemInst.setContour(
          l.hrdemContourEnabled  ?? false,
          l.hrdemContourInterval ?? (isContourLayer ? 1 : 10),
          l.hrdemContourColor    ?? (isContourLayer ? '#000000' : '#ffffff'),
          l.hrdemContourWidth    ?? (isContourLayer ? 0.5 : 1.2),
          l.hrdemContourMinZoom  ?? 14,
        );
        // Determine surface from defId for raster function layers
        const rasterFnSurface = l.defId === 'raster-fn-dsm-hillshade' ? 'dsm' : (l.hrdemSurface ?? 'dtm');
        hrdemInst.setSurface(rasterFnSurface);
        // Determine product from defId if not explicitly stored
        const effectiveProduct = l.hrdemProduct ?? (
          l.defId === 'raster-fn-hillshade'     ? 'hillshade'
          : l.defId === 'raster-fn-dsm-hillshade' ? 'hillshade'
          : l.defId === 'raster-fn-roughness'   ? 'roughness'
          : l.defId === 'raster-fn-slope-pct'   ? 'slope'
          : l.defId === 'raster-fn-aspect'      ? 'aspect'
          : l.defId === 'raster-fn-tpi'         ? 'tpi'
          : l.defId === 'raster-fn-chm-focal'   ? 'chm-focal'
          : 'elevation'
        );
        hrdemInst.setProduct(effectiveProduct as HRDEMProduct);
        if (effectiveProduct === 'hillshade') {
          hrdemInst.setHillshadeParams(
            l.hrdemHillshadeAzimuth  ?? 315,
            l.hrdemHillshadeAltitude ?? 45,
            l.hrdemHillshadeZFactor  ?? 1,
          );
        }
        if (effectiveProduct === 'chm-focal') {
          hrdemInst.setChmFocalParams({
            neighborhood: (l.hrdemChmFocalNeighborhood ?? 'circle') as ChmFocalParams['neighborhood'],
            width:      l.hrdemChmFocalWidth        ?? 3,
            height:     l.hrdemChmFocalHeight       ?? 3,
            radius:     l.hrdemChmFocalRadius       ?? 3,
            stat:       (l.hrdemChmFocalStat ?? 'mean') as ChmFocalParams['stat'],
            percentile: l.hrdemChmFocalPercentile   ?? 50,
          });
        }
        hrdemInst.setProductStyle({
          slopeRampId:  l.hrdemSlopeRampId  ?? 'classic',
          slopeUnit:    (l.hrdemSlopeUnit ?? (l.defId === 'raster-fn-slope-pct' ? 'percent' : 'degrees')) as 'degrees' | 'percent',
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
        hrdemInst.setRenderOptions({
          stretchMode: (l.hrdemStretch ?? 'percentile') as RasterStretchMode,
          stretchMin:  l.hrdemStretchMin,
          stretchMax:  l.hrdemStretchMax,
          classify:    l.hrdemClassify ?? false,
          classifier:  (l.hrdemClassifier ?? 'Natural breaks') as ClassifierName,
          classes:     l.hrdemClassCount ?? 5,
        });
      } else if (ltype === 'geojson') {
        this.renderGeojsonOverlay(l);
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
    this.refreshLegend();
  }

  renderPanel(
    container: HTMLElement,
    onClose: () => void,
    userLayers: UserLayerInfo[] = [],
    pdfLayers: PDFLayerInfo[] = [],
    onDeletePDF?: (id: string) => void,
    onDeleteUserLayer?: (id: string) => void,
    onLayerStateChange?: (id: string, updates: { visible?: boolean; opacity?: number; symbologyState?: SymbologyState | null }) => void,
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
    // Re-apply any saved symbology for user layers
    for (const ul of this.userLayers) {
      if (ul.symbologyState && ul.kind === 'vector' && ul.features?.length) {
        this.mapManager.setImportedLayerSymbology(
          ul.id, ul.symbologyState,
          ul.features as { properties: Record<string, unknown> }[],
          ul.originalColor ?? '#888888',
        );
      }
    }
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

  private renderUserLayerRow(l: UserLayerInfo): string {
    const zoomSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M229.66,218.34,179.6,168.28a88.21,88.21,0,1,0-11.32,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM144,120H120v24a8,8,0,0,1-16,0V120H80a8,8,0,0,1,0-16h24V80a8,8,0,0,1,16,0v24h24a8,8,0,0,1,0,16Z"/></svg>`;
    const badge = (l.fileType ?? l.kind).toUpperCase();
    const canStack = l.kind === 'raster' && !!l.tileUrl;
    const canStyle = l.kind === 'vector' && (l.features?.length ?? 0) > 0;
    return `
        <div class="bm-stack-item" data-ulid="${l.id}">
          <div class="bm-item-main">
            <span class="bm-layer-label" title="${l.name}">${l.name}</span>
            <span class="bm-base-badge" style="background:var(--color-accent-dim,#1a3a2a);color:var(--color-accent,#4ade80);border:1px solid var(--color-accent,#4ade80)">${badge}</span>
            <div class="bm-layer-controls">
              <input type="range" class="bm-opacity-slider bm-ul-opacity" data-ulid="${l.mapLayerId}"
                min="0" max="100" value="${Math.round(l.opacity * 100)}" title="Opacity" />
              <span class="bm-opacity-val">${Math.round(l.opacity * 100)}%</span>
              <button class="vis-tog bm-vis-btn ${l.visible ? 'active' : ''} bm-ul-vis" data-ulid="${l.mapLayerId}" title="${l.visible ? 'Hide' : 'Show'}"></button>
              ${l.bounds ? `<button class="bm-adj-toggle bm-ul-zoom" data-ulid="${l.id}" title="Zoom to layer">${zoomSvg}</button>` : ''}
              ${canStack ? `<button class="bm-add-btn bm-ul-stack" data-ulid="${l.id}" title="Add to active stack" style="width:22px;height:22px;font-size:14px">+</button>` : ''}
              ${canStyle ? `<button class="bm-adj-toggle bm-ul-symbology" data-ulid="${l.id}" title="Edit symbology">⊛</button>` : ''}
              <button class="bm-del-btn bm-ul-del" data-ulid="${l.id}" title="Remove layer">✕</button>
            </div>
          </div>
        </div>`;
  }

  private renderUserLayersSection(): string {
    if (this.userLayers.length === 0) return '';
    const offline = this.userLayers.filter(l => l.fileType === 'mbtiles');
    const other = this.userLayers.filter(l => l.fileType !== 'mbtiles' && l.fileType !== 'geopdf');

    let html = '';
    if (other.length > 0) {
      const body = `<div class="bm-pdf-layers">${other.map(l => this.renderUserLayerRow(l)).join('')}</div>`;
      html += this.sectionToggle('userlayers', 'Your Layers', 'imported &amp; online') +
        this.sectionBody('userlayers', body);
    }
    if (offline.length > 0) {
      const body = `<div class="bm-pdf-layers">${offline.map(l => this.renderUserLayerRow(l)).join('')}</div>`;
      html += this.sectionToggle('offline-maps', 'Offline Maps', `${offline.length} map${offline.length !== 1 ? 's' : ''}`) +
        this.sectionBody('offline-maps', body);
    }
    return html;
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
            <button class="vis-tog bm-vis-btn bm-pdf-vis ${l.visible ? 'active' : ''}" data-pdfid="${l.id}" title="${l.visible ? 'Hide' : 'Show'}"></button>
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

  // ---- Combined Field Data section (Points / Lines / Polygons groups) ----

  private renderFieldDataSection(): string {
    const hasLayers = this.featureLayerPresets.length > 0;
    const hasTypes  = this.typePresets.length > 0;
    const hasFeats  = this.collectedFeatures.length > 0;
    if (!hasLayers && !hasTypes && !hasFeats) return '';

    const countByType = new Map<string, number>();
    for (const f of this.collectedFeatures) {
      const key = f.type || '(untyped)';
      countByType.set(key, (countByType.get(key) ?? 0) + 1);
    }

    const labelOnSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="11" height="11"><path d="M216,48H40A16,16,0,0,0,24,64V224a15.84,15.84,0,0,0,9.25,14.5A16.05,16.05,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.09-.07L83,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM84,140a12,12,0,1,1,12-12A12,12,0,0,1,84,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,128,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,172,140Z"/></svg>`;

    const geomGroups: Array<{ id: string; label: string; icon: string; geomType: 'Point' | 'LineString' | 'Polygon' }> = [
      { id: 'Point',      label: 'Points',   icon: '●', geomType: 'Point' },
      { id: 'LineString', label: 'Lines',    icon: '╌', geomType: 'LineString' },
      { id: 'Polygon',    label: 'Polygons', icon: '▭', geomType: 'Polygon' },
    ];

    const isWetland = (f: FieldFeature) => f.layer_id?.endsWith('-wetlands') || !!f.wetland_data;

    const body = geomGroups.map(({ id, label, icon, geomType }) => {
      // Wetland plots are their own class below — keep them out of the Point group.
      const layerPreset = this.featureLayerPresets.find(lp =>
        lp.geometry_type === geomType && !lp.id.endsWith('-wetlands'));
      const types = this.typePresets.filter(p => p.geometry_type === geomType || p.geometry_type === 'all');

      // Count features in this geometry group (excluding wetland plots)
      const groupCount = this.collectedFeatures.filter(f => f.geometry_type === geomType && !isWetland(f)).length;

      if (types.length === 0 && groupCount === 0) return '';

      const isGroupCollapsed = this.collapsedFdGroups.has(geomType);
      const layerVis = layerPreset ? layerPreset.visible !== false : true;

      const typeRows = types.map(p => {
        const count = countByType.get(p.label) ?? 0;
        const swatchUrl =
          geomType === 'LineString' ? renderLineSwatchDataUrl(p, 20)
          : geomType === 'Polygon'  ? renderPolygonSwatchDataUrl(p, 20)
          : renderSwatchDataUrl(p, 20);
        const isVisible = p.visible !== false;
        const showLabels = p.show_labels !== false;
        return `
          <div class="fd-type-row${!isVisible ? ' fd-hidden' : ''}">
            <button class="fd-swatch-btn" data-fd-preset-id="${p.id}" title="${p.label} — click to edit style">
              <img src="${swatchUrl}" width="20" height="20" alt="${p.label}" />
            </button>
            <span class="fd-type-label">${p.label}</span>
            <span class="fd-type-count">${count > 0 ? count : '—'}</span>
            <button class="fd-label-btn${showLabels ? ' active' : ''}" data-fd-label="${p.id}" title="${showLabels ? 'Hide labels' : 'Show labels'}">${labelOnSvg}</button>
            <button class="vis-tog fd-type-vis fd-vis-lg${isVisible ? ' active' : ''}" data-fd-type="${p.id}" title="Toggle type"></button>
          </div>`;
      }).join('');

      return `
        <div class="fd-geom-group" data-fd-geom="${geomType}">
          <div class="fd-geom-header fd-geom-collapsible" data-fd-collapse="${geomType}">
            <span class="fd-geom-chevron${isGroupCollapsed ? ' fd-collapsed' : ''}">▾</span>
            <span class="fd-geom-icon">${icon}</span>
            <span class="fd-geom-label">${label}</span>
            ${groupCount > 0 ? `<span class="fd-geom-count">${groupCount}</span>` : ''}
            <button class="fd-symbology-btn" data-fd-symbology="${geomType}" title="Edit symbology" onclick="event.stopPropagation()">⊛</button>
            <button class="vis-tog fd-group-vis fd-vis-lg${layerVis ? ' active' : ''}" data-fd-group="${layerPreset?.id ?? ''}" title="Toggle group" onclick="event.stopPropagation()"></button>
          </div>
          <div class="fd-geom-body${isGroupCollapsed ? ' fd-geom-body-collapsed' : ''}">
            ${typeRows}
          </div>
        </div>`;
    }).join('');

    // Wetland Plots — dedicated class (own map layers + symbology/labeling)
    const wetlandFeats = this.collectedFeatures.filter(isWetland);
    const wetlandPreset = this.featureLayerPresets.find(lp => lp.id.endsWith('-wetlands'));
    const wetlandGroup = (wetlandFeats.length > 0 || wetlandPreset) ? `
      <div class="fd-geom-group" data-fd-geom="WetlandPlot">
        <div class="fd-geom-header fd-geom-collapsible" data-fd-collapse="WetlandPlot">
          <span class="fd-geom-chevron${this.collapsedFdGroups.has('WetlandPlot') ? ' fd-collapsed' : ''}">▾</span>
          <span class="fd-geom-icon">◆</span>
          <span class="fd-geom-label">Wetland Plots</span>
          ${wetlandFeats.length > 0 ? `<span class="fd-geom-count">${wetlandFeats.length}</span>` : ''}
          <button class="fd-symbology-btn" data-fd-symbology="WetlandPlot" title="Edit symbology" onclick="event.stopPropagation()">⊛</button>
          <button class="fd-label-btn${wetlandPreset?.show_labels !== false ? ' active' : ''}" data-fd-wetland-label="1" title="Toggle labels" onclick="event.stopPropagation()">${labelOnSvg}</button>
          <button class="vis-tog fd-group-vis fd-vis-lg${wetlandPreset?.visible !== false ? ' active' : ''}" data-fd-wetland-vis="1" title="Toggle Wetland Plots" onclick="event.stopPropagation()"></button>
        </div>
      </div>` : '';

    // Untyped features row
    const untypedCount = countByType.get('(untyped)') ?? 0;
    const untypedRow = untypedCount > 0 ? `
      <div class="cd-type-row cd-untyped-row" style="padding-left:8px">
        <span class="cd-type-geom">◈</span>
        <span class="cd-type-label" style="color:var(--color-text-muted)">(untyped)</span>
        <span class="cd-type-count">${untypedCount}</span>
      </div>` : '';

    const totalCount = this.collectedFeatures.length;
    const hint = totalCount > 0 ? `${totalCount} features` : '';

    const fdLabel = (this.userId ? this.userId.toUpperCase() : 'Field') + ' Data';
    return this.sectionToggle('field-data', fdLabel, hint) +
      this.sectionBody('field-data', `<div class="fd-body">${body}${wetlandGroup}${untypedRow}</div>`);
  }

  private wireFieldData(container: HTMLElement): void {
    // fd-geom-group collapse/expand
    container.querySelectorAll<HTMLElement>('.fd-geom-collapsible').forEach(header => {
      header.addEventListener('click', () => {
        const geomType = header.dataset.fdCollapse!;
        if (this.collapsedFdGroups.has(geomType)) this.collapsedFdGroups.delete(geomType);
        else this.collapsedFdGroups.add(geomType);
        const group = header.closest('.fd-geom-group')!;
        const body = group.querySelector<HTMLElement>('.fd-geom-body');
        const chevron = header.querySelector<HTMLElement>('.fd-geom-chevron');
        const collapsed = this.collapsedFdGroups.has(geomType);
        body?.classList.toggle('fd-geom-body-collapsed', collapsed);
        chevron?.classList.toggle('fd-collapsed', collapsed);
      });
    });

    // Swatch → open style picker
    container.querySelectorAll<HTMLButtonElement>('[data-fd-preset-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = this.typePresets.find(p => p.id === btn.dataset.fdPresetId);
        if (!preset) return;
        this.stylePicker.open(preset, (updated: TypePreset) => {
          Object.assign(preset, updated);
          this.onTypePresetChange?.(preset);
        });
      });
    });

    // Type preset visibility toggle
    container.querySelectorAll<HTMLButtonElement>('[data-fd-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = this.typePresets.find(p => p.id === btn.dataset.fdType);
        if (!preset) return;
        preset.visible = preset.visible === false;
        const on = preset.visible !== false;
        btn.classList.toggle('active', on);
        btn.closest('.fd-type-row')?.classList.toggle('fd-hidden', !on);
        this.onTypePresetChange?.(preset);
      });
    });

    // Layer preset visibility toggle
    container.querySelectorAll<HTMLButtonElement>('[data-fd-layer]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lp = this.featureLayerPresets.find(l => l.id === btn.dataset.fdLayer);
        if (!lp) return;
        lp.visible = !(lp.visible !== false);
        btn.classList.toggle('active', lp.visible !== false);
        this.onFeatureLayerChange?.(lp);
      });
    });

    // Group visibility toggle (mirrors the layer toggle)
    container.querySelectorAll<HTMLButtonElement>('[data-fd-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lpId = btn.dataset.fdGroup;
        if (!lpId) return;
        const lp = this.featureLayerPresets.find(l => l.id === lpId);
        if (!lp) return;
        lp.visible = !(lp.visible !== false);
        const on = lp.visible !== false;
        btn.classList.toggle('active', on);
        // Mirror state onto the layer row toggle inside this group
        const geomType = lp.geometry_type;
        const group = btn.closest(`.fd-geom-group[data-fd-geom="${geomType}"]`);
        group?.querySelector<HTMLButtonElement>('[data-fd-layer]')?.classList.toggle('active', on);
        this.onFeatureLayerChange?.(lp);
      });
    });

    // Label toggle
    container.querySelectorAll<HTMLButtonElement>('[data-fd-label]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = this.typePresets.find(p => p.id === btn.dataset.fdLabel);
        if (!preset) return;
        preset.show_labels = preset.show_labels === false ? true : false;
        btn.classList.toggle('active', preset.show_labels !== false);
        this.onTypePresetChange?.(preset);
      });
    });

    // Symbology studio button per geometry group
    container.querySelectorAll<HTMLButtonElement>('[data-fd-symbology]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.fdSymbology!;

        // Wetland Plots — dedicated class with its own map layers.
        if (key === 'WetlandPlot') {
          const preset = this.featureLayerPresets.find(lp => lp.id.endsWith('-wetlands'));
          const feats = this.collectedFeatures
            .filter(f => f.layer_id?.endsWith('-wetlands') || !!f.wetland_data)
            .map(f => ({
              properties: {
                PLOT_TYPE: f.wetland_data?.PLOT_TYPE ?? '',
                PLOT_ID: f.wetland_data?.PLOT_ID ?? f.point_id,
                observer: f.wetland_data?.observer ?? '',
                type: f.type, elevation: f.elevation, accuracy: f.accuracy,
              } as Record<string, unknown>,
            }));
          this.symbologyStudio.open({
            title: 'Wetland Plots',
            geomType: 'point',
            features: feats,
            initialState: preset?.symbologyState,
            onApply: (state: SymbologyState) => {
              if (preset) preset.symbologyState = state;
              this.mapManager.setWetlandPlotSymbology(state, feats);
              if (preset) this.onFeatureLayerChange?.(preset);
            },
          });
          return;
        }

        const geomType = key as GeometryType;
        const geomStr = geomType === 'Point' ? 'point' : geomType === 'LineString' ? 'line' : 'polygon';
        const features = this.collectedFeatures
          .filter(f => f.geometry_type === geomType)
          .map(f => ({
            properties: {
              type: f.type,
              elevation: f.elevation,
              accuracy: f.accuracy,
              desc: f.desc,
              created_by: f.created_by,
            } as Record<string, unknown>,
          }));
        const layerPreset = this.featureLayerPresets.find(lp => lp.geometry_type === geomType && !lp.id.endsWith('-wetlands'));
        const title = geomType === 'Point' ? 'Points' : geomType === 'LineString' ? 'Lines' : 'Polygons';

        this.symbologyStudio.open({
          title,
          geomType: geomStr as 'point' | 'line' | 'polygon',
          features,
          initialState: layerPreset?.symbologyState,
          onApply: (state: SymbologyState) => {
            if (layerPreset) layerPreset.symbologyState = state;
            this.mapManager.setCollectedLayerSymbology(geomType, state, features);
            if (layerPreset) this.onFeatureLayerChange?.(layerPreset);
          },
        });
      });
    });

    // Wetland Plots — group visibility
    container.querySelector<HTMLButtonElement>('[data-fd-wetland-vis]')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const lp = this.featureLayerPresets.find(l => l.id.endsWith('-wetlands'));
      if (!lp) return;
      lp.visible = !(lp.visible !== false);
      btn.classList.toggle('active', lp.visible !== false);
      this.onFeatureLayerChange?.(lp);
    });

    // Wetland Plots — labels toggle
    container.querySelector<HTMLButtonElement>('[data-fd-wetland-label]')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const lp = this.featureLayerPresets.find(l => l.id.endsWith('-wetlands'));
      if (!lp) return;
      lp.show_labels = lp.show_labels === false;
      btn.classList.toggle('active', lp.show_labels !== false);
      this.mapManager.setLayerVisibility('wetland-plots-labels', lp.show_labels !== false);
      this.onFeatureLayerChange?.(lp);
    });
  }

  // ---- Stack item rendering ----

  private renderStackItem(layer: StackLayer, idx: number): string {
    const isBase = idx === this.stack.length - 1;
    const ltype = this.getLayerType(layer);
    // "Show in legend" row — every non-base data layer gets this in its settings panel
    const showInLegend = layer.showInLegend !== false;
    const legendRow = isBase ? '' : `
        <div class="bm-adj-row" style="margin-top:4px">
          <label class="bm-adj-label" style="flex:1;text-align:left">Show in legend</label>
          <button class="vis-tog bm-legend-tog ${showInLegend ? 'active' : ''}" data-iid="${layer.instanceId}" title="Toggle legend entry"></button>
        </div>`;
    const isVectorLayer = ['nsprd-vector', 'nshn-vector', 'geojson'].includes(ltype);
    const eyeSvg =`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"/></svg>`;
    const adjSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M32,80a8,8,0,0,1,8-8H77.17a28,28,0,0,1,53.66,0H216a8,8,0,0,1,0,16H130.83a28,28,0,0,1-53.66,0H40A8,8,0,0,1,32,80Zm184,88H194.83a28,28,0,0,0-53.66,0H40a8,8,0,0,0,0,16H141.17a28,28,0,0,0,53.66,0H216a8,8,0,0,0,0-16Z"/></svg>`;
    const dragSvg = `<svg viewBox="0 0 10 16" fill="currentColor" width="14" height="22"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="6" r="1.5"/><circle cx="7" cy="6" r="1.5"/><circle cx="3" cy="10" r="1.5"/><circle cx="7" cy="10" r="1.5"/><circle cx="3" cy="14" r="1.5"/><circle cx="7" cy="14" r="1.5"/></svg>`;
    const refreshSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16h28.69L197.31,80.69A96.09,96.09,0,0,0,43.81,116.8a8,8,0,1,1-15.62-3.6A112.11,112.11,0,0,1,208,70.69l15.33,15.32V56a8,8,0,0,1,16,0Zm-16.19,82.8a8,8,0,0,0-10,5.39A96.09,96.09,0,0,1,58.69,175.31L71.31,162.69A8,8,0,0,0,65.82,149H16a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V176.69l15.32,15.32a112.11,112.11,0,0,0,179.81-45.21A8,8,0,0,0,223.81,138.8Z"/></svg>`;

    const vecStylePanel = isVectorLayer ? `
      <div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
        <div class="bm-adj-row">
          <label class="bm-adj-label">Opac</label>
          <input type="range" class="bm-adj-slider bm-opacity-slider" data-iid="${layer.instanceId}" min="0" max="100" step="1" value="${Math.round(layer.opacity * 100)}" />
          <span class="bm-adj-val">${Math.round(layer.opacity * 100)}%</span>
        </div>
        <div class="bm-adj-row" style="margin-top:4px">
          <button class="bm-vec-symbology btn-outline" data-iid="${layer.instanceId}"
            style="font-size:10px;padding:4px 8px;flex:1" title="Open Symbology Studio">⊛ Symbology</button>
        </div>
        ${legendRow}
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
          <label class="bm-adj-label">Opac</label>
          <input type="range" class="bm-adj-slider bm-opacity-slider" data-iid="${layer.instanceId}" min="0" max="100" step="1" value="${Math.round(layer.opacity * 100)}" />
          <span class="bm-adj-val">${Math.round(layer.opacity * 100)}%</span>
        </div>
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
        ${legendRow}
      </div>` : '';

    const isHrdem = ltype === 'hrdem-wcs';
    const hrdemProduct      = layer.hrdemProduct         ?? (
      layer.defId === 'hrdem-slope'            ? 'slope'
      : layer.defId === 'hrdem-aspect'         ? 'aspect'
      : layer.defId === 'hrdem-tpi'            ? 'tpi'
      : layer.defId === 'hrdem-chm'            ? 'chm'
      : layer.defId === 'raster-fn-hillshade'  ? 'hillshade'
      : layer.defId === 'raster-fn-dsm-hillshade' ? 'hillshade'
      : layer.defId === 'raster-fn-roughness'  ? 'roughness'
      : layer.defId === 'raster-fn-slope-pct'  ? 'slope'
      : layer.defId === 'raster-fn-aspect'     ? 'aspect'
      : layer.defId === 'raster-fn-tpi'        ? 'tpi'
      : 'elevation'
    );
    const hrdemRampId       = layer.hrdemRampId          ?? 'terrain';
    const hrdemInvert       = layer.hrdemRampInvert      ?? false;
    const hrdemRasterVis    = layer.hrdemRasterVisible   ?? (layer.defId === 'hrdem-contours' ? false : true);
    const hrdemContourEn    = layer.hrdemContourEnabled  ?? (layer.defId === 'hrdem-contours' ? true : false);
    const isContourDef      = layer.defId === 'hrdem-contours' || layer.defId === 'hrdem-dsm-contours';
    const hrdemContourIvl   = layer.hrdemContourInterval ?? (isContourDef ? 1 : 10);
    const hrdemContourCol   = layer.hrdemContourColor    ?? (isContourDef ? '#000000' : '#ffffff');
    const hrdemContourWid   = layer.hrdemContourWidth    ?? (isContourDef ? 0.5 : 1.2);
    const hrdemContourMnZ   = layer.hrdemContourMinZoom  ?? 14;
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
        </div>
        <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
          <span style="font-size:9px;opacity:.55">Min zoom</span>
          <input type="number" class="bm-hrdem-contour-mnz" data-iid="${iid}" min="1" max="22" step="1" value="${hrdemContourMnZ}" inputmode="decimal" style="width:44px;${S}" title="Contours only draw at this zoom level and above (default 14)" />
        </div>`;

    } else if (layer.defId === 'hrdem-slope' || layer.defId === 'hrdem-dsm-slope') {
      // Colour ramp / invert moved to the Symbology Studio (⊛). Only slope-specific
      // controls (display unit + stretch) remain inline.
      hrdemInnerContent = `
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
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
      // Colour ramp / invert moved to the Symbology Studio (⊛). Only the TPI
      // stretch control remains inline.
      hrdemInnerContent = `
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
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

    } else if (layer.defId === 'raster-fn-hillshade' || layer.defId === 'raster-fn-dsm-hillshade') {
      const hsAz  = layer.hrdemHillshadeAzimuth  ?? 315;
      const hsAlt = layer.hrdemHillshadeAltitude ?? 45;
      const hsZ   = layer.hrdemHillshadeZFactor  ?? 1;
      hrdemInnerContent = `
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;align-items:center;gap:5px">
            <span style="font-size:9px;opacity:.55;width:54px">Azimuth</span>
            <input type="range" class="bm-hrdem-hs-az" data-iid="${iid}" min="0" max="360" step="15" value="${hsAz}" style="flex:1;accent-color:var(--color-accent);height:14px" />
            <span class="bm-hrdem-hs-az-val" data-iid="${iid}" style="font-size:10px;opacity:.55;width:30px;text-align:right">${hsAz}°</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px">
            <span style="font-size:9px;opacity:.55;width:54px">Altitude</span>
            <input type="range" class="bm-hrdem-hs-alt" data-iid="${iid}" min="1" max="90" step="5" value="${hsAlt}" style="flex:1;accent-color:var(--color-accent);height:14px" />
            <span class="bm-hrdem-hs-alt-val" data-iid="${iid}" style="font-size:10px;opacity:.55;width:30px;text-align:right">${hsAlt}°</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px">
            <span style="font-size:9px;opacity:.55;width:54px">Z-factor</span>
            <input type="range" class="bm-hrdem-hs-zf" data-iid="${iid}" min="0.1" max="5" step="0.1" value="${hsZ}" style="flex:1;accent-color:var(--color-accent);height:14px" />
            <span class="bm-hrdem-hs-zf-val" data-iid="${iid}" style="font-size:10px;opacity:.55;width:30px;text-align:right">${hsZ}×</span>
          </div>
        </div>`;

    } else if (layer.defId === 'raster-fn-roughness') {
      hrdemInnerContent = `<div style="font-size:10px;opacity:.65">Terrain roughness — elevation range within a 3×3 cell window. No configurable parameters; colour ramp is fixed green→yellow→red.</div>`;

    } else if (layer.defId === 'raster-fn-slope-pct') {
      // Colour ramp moved to the Symbology Studio (⊛).
      hrdemInnerContent = `
        <div style="font-size:10px;opacity:.55;font-style:italic">Displaying slope as % grade (0–100%). Use ⊛ Symbology for colour ramp &amp; classification.</div>`;

    } else if (layer.defId === 'raster-fn-aspect') {
      hrdemInnerContent = `<div style="font-size:10px;opacity:.65">Terrain aspect (slope direction). Rendered as a directional colour wheel — N cool blue, E orange, S warm red, W purple.</div>`;

    } else if (layer.defId === 'raster-fn-tpi') {
      // Colour ramp moved to the Symbology Studio (⊛).
      hrdemInnerContent = `
        <div style="font-size:10px;opacity:.55;font-style:italic">Topographic Position Index — ridges vs valleys. Use ⊛ Symbology for colour ramp &amp; classification.</div>`;

    } else {
      // Default: elevation panel (DTM or DSM elevation).
      // Colour ramp, invert, classification & stretch all live in the Symbology Studio (⊛).
      hrdemInnerContent = `
        <div style="font-size:10px;opacity:.55;font-style:italic">Use ⊛ Symbology for colour ramp, classification &amp; stretch.</div>`;
    }

    // Contour layers are symbolised as vector lines (interval/colour/width inline),
    // so they don't get the raster Symbology Studio button.
    const hrdemStudioOk = ['elevation', 'slope', 'tpi', 'chm-focal'].includes(hrdemProduct) && !isContourDef;
    const hrdemAdjPanel = isHrdem ? `
      <div class="bm-adj-panel" data-iid="${iid}" style="display:none">
        <div class="bm-adj-row">
          <label class="bm-adj-label">Opac</label>
          <input type="range" class="bm-adj-slider bm-opacity-slider" data-iid="${iid}" min="0" max="100" step="1" value="${Math.round(layer.opacity * 100)}" />
          <span class="bm-adj-val">${Math.round(layer.opacity * 100)}%</span>
        </div>
        ${hrdemInnerContent}
        ${hrdemStudioOk ? `
        <div class="bm-adj-row" style="margin-top:4px">
          <button class="bm-raster-symbology btn-outline" data-iid="${iid}"
            style="font-size:10px;padding:4px 8px;flex:1" title="Colour ramps, classification &amp; stretch">⊛ Symbology</button>
        </div>` : ''}
        ${legendRow}
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
        const ramp = RASTER_RAMPS[rampId];
        if (!ramp) return '';
        stops = ramp.stops.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
      }
      if (invert) stops = [...stops].reverse();
      return `linear-gradient(to right,${stops.join(',')})`;
    };
    // Colour ramp / invert / classification & stretch for COG rasters live in the
    // Symbology Studio (⊛). Only the Smooth toggle (not a symbology feature) stays inline.
    const cogRampRow = isCog ? `
      <div class="bm-adj-row">
        <label class="bm-adj-label"></label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg-2,#888);cursor:pointer">
          <input type="checkbox" class="bm-cog-smooth" data-iid="${layer.instanceId}"${cogSmooth?' checked':''} />
          Smooth
        </label>
      </div>` : '';

    const hasStylePanel = true;
    const adjTitle = isVectorLayer ? 'Style options'
      : isHrdem ? 'Elevation style'
      : isCogContour ? 'Contour options'
      : 'Image adjustments';

    return `
      <div class="bm-stack-item ${isBase ? 'bm-base-item' : ''}"
           draggable="true" data-idx="${idx}" data-iid="${layer.instanceId}">
        <div class="bm-item-row">
          <div class="bm-drag-handle" title="Drag to reorder">${dragSvg}</div>
          ${this.renamingIid === layer.instanceId
            ? `<input type="text" class="bm-label-rename-input" data-iid="${layer.instanceId}"
                 value="${escHtml(layer.customLabel ?? layer.label)}" maxlength="80" />`
            : `<span class="bm-layer-label bm-label-editable" data-iid="${layer.instanceId}"
                 title="${escHtml(layer.customLabel ?? layer.label)}">${escHtml(layer.customLabel ?? layer.label)}</span>`
          }
          ${isBase ? '<span class="bm-base-badge">B</span>' : ''}
          <button class="vis-tog bm-vis-btn ${layer.visible ? 'active' : ''}" data-iid="${layer.instanceId}" title="${layer.visible ? 'Hide' : 'Show'}"></button>
          ${hasStylePanel ? `<button class="bm-adj-toggle" data-iid="${layer.instanceId}" title="${adjTitle}">${adjSvg}</button>` : ''}
          <button class="bm-dup-btn" data-iid="${layer.instanceId}" title="Duplicate layer" style="background:none;border:1px solid var(--color-border);border-radius:4px;color:var(--color-text-dim);cursor:pointer;padding:2px 5px;font-size:12px;flex-shrink:0">⧉</button>
          ${this.stack.length > 1 ? `<button class="bm-del-btn" data-iid="${layer.instanceId}" title="Remove">✕</button>` : ''}
        </div>
        ${isVectorLayer ? vecStylePanel : isHrdem ? hrdemAdjPanel : isCogContour ? cogContourAdjPanel : `<div class="bm-adj-panel" data-iid="${layer.instanceId}" style="display:none">
          <div class="bm-adj-row">
            <label class="bm-adj-label">Opac</label>
            <input type="range" class="bm-adj-slider bm-opacity-slider" data-iid="${layer.instanceId}" min="0" max="100" step="1" value="${Math.round(layer.opacity * 100)}" />
            <span class="bm-adj-val">${Math.round(layer.opacity * 100)}%</span>
          </div>
          ${cogRampRow}
          ${!isBase ? `<div class="bm-adj-row">
            <label class="bm-adj-label">Blend</label>
            <select class="bm-blend-select" data-iid="${layer.instanceId}" style="flex:1;font-size:11px;background:var(--color-bg-2,#1a2a1a);color:var(--color-text,#ccc);border:1px solid var(--color-border);border-radius:3px;padding:2px 4px">
              ${['normal','multiply','screen','overlay','darken','lighten','hard-light','soft-light','difference'].map(m =>
                `<option value="${m}"${(layer.blendMode ?? 'normal') === m ? ' selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
              ).join('')}
            </select>
          </div>` : ''}
          ${ltype === 'raster' && !layer.url.startsWith('mbtiles://') ? `
          <div class="bm-adj-row" style="margin-top:4px">
            <button class="bm-raster-symbology btn-outline" data-iid="${layer.instanceId}"
              style="font-size:10px;padding:4px 8px;flex:1" title="Colour ramps, classification &amp; stretch">⊛ Symbology</button>
          </div>` : ''}
          ${legendRow}
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
        layer.showBoth(run.result, undefined, ds.hillshade, ds.hillshadeAzimuth, ds.hillshadeAltitude, ds.hillshadeZFactor);
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
      `${m3.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`;

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
              <button class="cf-zoom-run-btn" data-run="${run.id}" data-action="zoom-to" title="Zoom to run extent">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M229.66,218.34,179.6,168.28a88.21,88.21,0,1,0-11.32,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM144,120H120v24a8,8,0,0,1-16,0V120H80a8,8,0,0,1,0-16h24V80a8,8,0,0,1,16,0v24h24a8,8,0,0,1,0,16Z"/></svg>
              </button>
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
                <div class="cf-lyr-stack-item cf-lyr-stack-item--hillshade">
                  <button class="cf-vis-btn${ds.hillshade ? ' cf-vis-on' : ''}" data-run="${run.id}" data-action="hillshade" title="${ds.hillshade ? 'Hide' : 'Show'} hillshade">
                    ${ds.hillshade ? eyeSvg : eyeOffSvg}
                  </button>
                  <span class="cf-lyr-stack-label">Hillshade</span>
                  <div class="cf-hillshade-params" style="${ds.hillshade ? '' : 'opacity:0.4;pointer-events:none'}">
                    <div class="cf-hs-param-row">
                      <label class="cf-hs-label">Az</label>
                      <input type="number" class="cf-lyr-input" value="${ds.hillshadeAzimuth}" min="0" max="360" step="15" data-run="${run.id}" data-action="hs-azimuth" style="width:44px" title="Azimuth (°)">°
                    </div>
                    <div class="cf-hs-param-row">
                      <label class="cf-hs-label">Alt</label>
                      <input type="number" class="cf-lyr-input" value="${ds.hillshadeAltitude}" min="1" max="90" step="5" data-run="${run.id}" data-action="hs-altitude" style="width:40px" title="Sun altitude (°)">°
                    </div>
                    <div class="cf-hs-param-row">
                      <label class="cf-hs-label">Z</label>
                      <input type="number" class="cf-lyr-input" value="${ds.hillshadeZFactor}" min="0.1" max="10" step="0.1" data-run="${run.id}" data-action="hs-zfactor" style="width:40px" title="Z-factor">
                    </div>
                  </div>
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
          case 'zoom-to': {
            const bbox = run.result.bbox;
            this.mapManager.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], 40);
            return;
          }
          case 'hillshade': {
            ds.hillshade = !ds.hillshade;
            layer.showBoth(run.result, undefined, ds.hillshade, ds.hillshadeAzimuth, ds.hillshadeAltitude, ds.hillshadeZFactor);
            layer.setElevVisible(ds.elevVisible);
            layer.setDiffVisible(ds.diffVisible);
            el.classList.toggle('cf-vis-on', ds.hillshade);
            el.innerHTML = ds.hillshade ? eyeSvg : eyeOffSvg;
            // Toggle the params opacity
            const paramsEl = container.querySelector<HTMLElement>(`[data-run="${runId}"][data-action="hillshade"]`)
              ?.closest('.cf-lyr-stack-item--hillshade')
              ?.querySelector<HTMLElement>('.cf-hillshade-params');
            if (paramsEl) {
              paramsEl.style.opacity = ds.hillshade ? '' : '0.4';
              paramsEl.style.pointerEvents = ds.hillshade ? '' : 'none';
            }
            break;
          }
          case 'hs-azimuth': {
            const v = parseFloat((el as HTMLInputElement).value);
            if (isFinite(v)) {
              ds.hillshadeAzimuth = v;
              if (ds.hillshade) {
                layer.showBoth(run.result, undefined, true, ds.hillshadeAzimuth, ds.hillshadeAltitude, ds.hillshadeZFactor);
                layer.setElevVisible(ds.elevVisible);
                layer.setDiffVisible(ds.diffVisible);
              }
            }
            break;
          }
          case 'hs-altitude': {
            const v = parseFloat((el as HTMLInputElement).value);
            if (isFinite(v)) {
              ds.hillshadeAltitude = v;
              if (ds.hillshade) {
                layer.showBoth(run.result, undefined, true, ds.hillshadeAzimuth, ds.hillshadeAltitude, ds.hillshadeZFactor);
                layer.setElevVisible(ds.elevVisible);
                layer.setDiffVisible(ds.diffVisible);
              }
            }
            break;
          }
          case 'hs-zfactor': {
            const v = parseFloat((el as HTMLInputElement).value);
            if (isFinite(v) && v > 0) {
              ds.hillshadeZFactor = v;
              if (ds.hillshade) {
                layer.showBoth(run.result, undefined, true, ds.hillshadeAzimuth, ds.hillshadeAltitude, ds.hillshadeZFactor);
                layer.setElevVisible(ds.elevVisible);
                layer.setDiffVisible(ds.diffVisible);
              }
            }
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
            layer.showBoth(newResult, undefined, ds.hillshade, ds.hillshadeAzimuth, ds.hillshadeAltitude, ds.hillshadeZFactor);
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

  /** "View as <user>" dropdown — only shown when teammates have saved views. */
  private renderViewAsControl(): string {
    if (this.viewAsUsers.length === 0 && !this.viewingAs) return '';
    const opts = ['<option value="">You</option>']
      .concat(this.viewAsUsers.map(u => `<option value="${u}"${this.viewingAs === u ? ' selected' : ''}>${u}</option>`))
      .join('');
    return `<div class="bm-viewas-row${this.viewingAs ? ' active' : ''}">
      <span class="bm-viewas-label">View as</span>
      <select id="bm-viewas" class="bm-viewas-select">${opts}</select>
      ${this.viewingAs ? '<span class="bm-viewas-badge">read-only</span>' : ''}
    </div>`;
  }

  /** Apply a stack layer's current `visible` state to the corresponding map layer. */
  private applyStackLayerVisibility(layer: StackLayer): void {
    const iid = layer.instanceId;
    const isBase = iid === this.stack[this.stack.length - 1]?.instanceId;
    const ltype = this.getLayerType(layer);
    if (isBase) this.mapManager.setBasemapOpacity(layer.visible ? layer.opacity : 0);
    else if (ltype === 'nsprd-vector') this.nsprdLayer?.setVisible(layer.visible);
    else if (ltype === 'nshn-vector') this.nshnLayers.get(iid)?.setVisible(layer.visible);
    else if (ltype === 'hrdem-wcs') {
      this.hrdemLayers.get(iid)?.setVisible(layer.visible);
      this.refreshLegend();
    }
    else if (ltype === 'cog-contour') this.cogContourLayers.get(iid)?.setVisible(layer.visible);
    else if (ltype === 'geojson') this.applyGeojsonOpacityVisibility(layer, `bm-ov-${iid}`);
    else if (this.webglBlendLayers.has(iid)) this.webglBlendLayers.get(iid)!.setOpacityAndVisible(layer.opacity, layer.visible);
    else this.mapManager.setBasemapOverlayVisible(iid, layer.visible);
  }

  private renderContent(container: HTMLElement, onClose: () => void): void {
    container.innerHTML = `
      <div class="panel-header">
        <h3>Table of Contents</h3>
        <button class="panel-close" id="bm-close">✕</button>
      </div>
      <div class="panel-body bm-panel-body">

        ${this.renderViewAsControl()}
        ${this.renderFieldDataSection()}
        ${this.renderCutFillSection()}

        <div class="bm-section-header-row">
          ${this.sectionToggle('active-layers', 'Basemap Stack', '', false)}
          <button id="bm-stack-vis-all" class="vis-tog bm-stack-vis-all ${this.stack.some(l => l.visible) ? 'active' : ''}" title="Show/hide all layers"></button>
          <button id="bm-refresh-all" class="bm-refresh-all-btn" title="Reload all basemap layers"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16h28.69L197.31,80.69A96.09,96.09,0,0,0,43.81,116.8a8,8,0,1,1-15.62-3.6A112.11,112.11,0,0,1,208,70.69l15.33,15.32V56a8,8,0,0,1,16,0Zm-16.19,82.8a8,8,0,0,0-10,5.39A96.09,96.09,0,0,1,58.69,175.31L71.31,162.69A8,8,0,0,0,65.82,149H16a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V176.69l15.32,15.32a112.11,112.11,0,0,0,179.81-45.21A8,8,0,0,0,223.81,138.8Z"/></svg></button>
        </div>
        ${this.sectionBody('active-layers', `
          <div class="bm-stack" id="bm-stack">
            ${this.stack.map((layer, idx) => this.renderStackItem(layer, idx)).join('')}
          </div>`)}

        ${this.renderUserLayersSection()}
        ${this.renderPDFSection()}
        ${this.renderMapDisplaySection()}

      </div>
    `;

    container.querySelector('#bm-close')?.addEventListener('click', onClose);
    this.wireFieldData(container);
    this.wireMapDisplay(container);
    this.wireCutFillSection(container);
    this.wireContent(container, onClose);
  }

  // ---- Event wiring ----

  private wireContent(container: HTMLElement, onClose: () => void): void {
    const allDefs = ALL_DEFS();

    // Master refresh
    container.querySelector<HTMLButtonElement>('#bm-refresh-all')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.rebuildMap();
      this.saveStack();
    });

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

    // Opacity sliders (in expanded settings panel)
    container.querySelectorAll<HTMLInputElement>('.bm-opacity-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const val = parseInt(slider.value);
        const opacity = val / 100;
        const valEl = slider.parentElement?.querySelector<HTMLElement>('.bm-adj-val');
        if (valEl) valEl.textContent = `${val}%`;
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
        else if (ltype === 'geojson') this.applyGeojsonOpacityVisibility(layer, `bm-ov-${iid}`);
        else if (this.webglBlendLayers.has(iid)) this.webglBlendLayers.get(iid)!.setOpacityAndVisible(opacity, layer.visible);
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
        this.applyStackLayerVisibility(layer);
        this.saveStack();
      });
    });

    // "View as" another user's layer view (read-only)
    container.querySelector<HTMLSelectElement>('#bm-viewas')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.onViewAs?.(v || null);
    });

    // Master "show/hide all" toggle on the Basemap Stack header
    container.querySelector<HTMLButtonElement>('#bm-stack-vis-all')?.addEventListener('click', () => {
      const anyVisible = this.stack.some(l => l.visible);
      if (anyVisible) {
        // Snapshot the current combo, then hide everything.
        this.stackVisSnapshot = this.stack.filter(l => l.visible).map(l => l.instanceId);
        for (const l of this.stack) {
          if (l.visible) { l.visible = false; this.applyStackLayerVisibility(l); }
        }
      } else {
        // Restore the remembered combo (or show all if none was saved).
        const snap = this.stackVisSnapshot;
        for (const l of this.stack) {
          const want = snap ? snap.includes(l.instanceId) : true;
          if (l.visible !== want) { l.visible = want; this.applyStackLayerVisibility(l); }
        }
        this.stackVisSnapshot = null;
      }
      this.saveStack();
      this.renderContent(container, onClose);
    });

    // "Show in legend" toggles
    container.querySelectorAll<HTMLButtonElement>('.bm-legend-tog').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.showInLegend = layer.showInLegend === false; // toggle (default true → false)
        btn.classList.toggle('active', layer.showInLegend !== false);
        this.saveStack(); // refreshes the legend
      });
    });

    // Remove buttons
    container.querySelectorAll<HTMLButtonElement>('.bm-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeFromStack(btn.dataset.iid!);
        this.renderContent(container, onClose);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-dup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const src = this.stack.find(l => l.instanceId === iid);
        if (!src) return;
        const clone: StackLayer = { ...src, instanceId: `${src.defId}-${Date.now()}`, label: `${src.label} (copy)` };
        const idx = this.stack.indexOf(src);
        this.stack.splice(idx, 0, clone);
        this.saveStack();
        this.rebuildMap();
        this.renderContent(container, onClose);
      });
    });

    // Inline label rename — tap the label to enter edit mode
    container.querySelectorAll<HTMLSpanElement>('.bm-label-editable').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renamingIid = span.dataset.iid!;
        this.renderContent(container, onClose);
        requestAnimationFrame(() => {
          const input = container.querySelector<HTMLInputElement>(`.bm-label-rename-input[data-iid="${this.renamingIid}"]`);
          if (input) { input.focus(); input.select(); }
        });
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-label-rename-input').forEach(input => {
      const commitRename = () => {
        const iid = input.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (layer) {
          const val = input.value.trim();
          layer.customLabel = val || undefined; // blank = revert to library name
          this.saveStack();
        }
        this.renamingIid = null;
        this.renderContent(container, onClose);
      };
      input.addEventListener('blur', commitRename);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
          this.renamingIid = null;
          this.renderContent(container, onClose);
        }
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

    // Blend mode selector
    container.querySelectorAll<HTMLSelectElement>('.bm-blend-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const iid = sel.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.blendMode = sel.value;
        // Rebuild the raster layer in the correct mode (normal ↔ canvas blend)
        this.rebuildMap();
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
        const ramp = RASTER_RAMPS[rampId];
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
        layer.hrdemContourMinZoom  ?? 14,
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

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-contour-mnz').forEach(inp => {
      inp.addEventListener('change', () => {
        const iid = inp.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const z = Math.round(Number(inp.value));
        if (!isFinite(z) || z < 1 || z > 22) return;
        layer.hrdemContourMinZoom = z;
        applyContour(iid, layer);
        this.saveStack();
      });
    });

    // Hillshade sliders (azimuth, altitude, z-factor)
    const applyHillshadeParams = (iid: string, layer: StackLayer) => {
      this.hrdemLayers.get(iid)?.setHillshadeParams(
        layer.hrdemHillshadeAzimuth  ?? 315,
        layer.hrdemHillshadeAltitude ?? 45,
        layer.hrdemHillshadeZFactor  ?? 1,
      );
    };

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-hs-az').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemHillshadeAzimuth = parseInt(slider.value);
        const lbl = container.querySelector<HTMLElement>(`.bm-hrdem-hs-az-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${slider.value}°`;
        applyHillshadeParams(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-hs-alt').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemHillshadeAltitude = parseInt(slider.value);
        const lbl = container.querySelector<HTMLElement>(`.bm-hrdem-hs-alt-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${slider.value}°`;
        applyHillshadeParams(iid, layer);
        this.saveStack();
      });
    });

    container.querySelectorAll<HTMLInputElement>('.bm-hrdem-hs-zf').forEach(slider => {
      slider.addEventListener('input', () => {
        const iid = slider.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        layer.hrdemHillshadeZFactor = parseFloat(slider.value);
        const lbl = container.querySelector<HTMLElement>(`.bm-hrdem-hs-zf-val[data-iid="${iid}"]`);
        if (lbl) lbl.textContent = `${parseFloat(slider.value).toFixed(1)}×`;
        applyHillshadeParams(iid, layer);
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

    // Vector layer — Symbology Studio button
    // Raster Symbology Studio (RGB tiles, COG rasters, HRDEM products)
    container.querySelectorAll<HTMLButtonElement>('.bm-raster-symbology').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = this.stack.find(l => l.instanceId === btn.dataset.iid);
        if (layer) this.openRasterSymbology(layer, container, onClose);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.bm-vec-symbology').forEach(btn => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.iid!;
        const layer = this.stack.find(l => l.instanceId === iid);
        if (!layer) return;
        const ltype = this.getLayerType(layer);
        const cfg = this.getVectorConfig(layer);

        let feats: { properties: Record<string, unknown> }[] = [];
        // Static GeoJSON uses the geometry detected from the loaded file so the
        // studio offers point/line/polygon controls correctly (not always polygon).
        let geomStr: 'point' | 'line' | 'polygon' = (cfg?.geomType ?? 'polygon');
        if (ltype === 'nsprd-vector') {
          feats = this.nsprdLayer?.getLoadedFeatureProps() ?? [];
        } else if (ltype === 'nshn-vector') {
          feats = this.nshnLayers.get(iid)?.getLoadedFeatureProps() ?? [];
        } else if (ltype === 'geojson') {
          feats = this.geojsonOverlays.get(iid) ?? [];
          geomStr = this.geojsonGeomType.get(iid) ?? 'polygon';
        }

        this.symbologyStudio.open({
          title: layer.label,
          geomType: geomStr,
          features: feats,
          initialState: layer.symbologyState,
          onApply: (state: SymbologyState) => {
            layer.symbologyState = state;
            if (ltype === 'geojson') {
              this.mapManager.setImportedLayerSymbology(`bm-ov-${iid}`, state, feats, this.geojsonColor(layer));
            } else {
              this.mapManager.setVectorOverlaySymbology(iid, state, feats, geomStr as 'line' | 'polygon');
            }
            this.saveStack();
            // Force a full re-render so the new symbology/labels reliably apply.
            this.rebuildMap();
          },
        });
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
        // Vector imports render as three sub-layers (-fill/-line/-point); toggle
        // all of them, not just the -fill that mapLayerId points at.
        if (ul.kind === 'vector') {
          for (const suffix of ['fill', 'line', 'point', 'labels']) {
            this.mapManager.setLayerVisibility(`${ul.id}-${suffix}`, ul.visible);
          }
        } else {
          this.mapManager.setLayerVisibility(ulid, ul.visible);
        }
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

    // User layer symbology
    container.querySelectorAll<HTMLButtonElement>('.bm-ul-symbology').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ulid!;
        const ul = this.userLayers.find(l => l.id === id);
        if (!ul || !ul.features?.length) return;
        const features = ul.features;
        const geomTypes = new Set(features.map(f => (f as any).geometry?.type as string).filter(Boolean));
        const geomType: 'point' | 'line' | 'polygon' =
          geomTypes.has('Polygon') || geomTypes.has('MultiPolygon') ? 'polygon' :
          geomTypes.has('LineString') || geomTypes.has('MultiLineString') ? 'line' : 'point';
        this.symbologyStudio.open({
          title: ul.name,
          geomType,
          features: features as { properties: Record<string, unknown> }[],
          initialState: ul.symbologyState,
          onApply: (state) => {
            ul.symbologyState = state;
            this.mapManager.setImportedLayerSymbology(ul.id, state, features as { properties: Record<string, unknown> }[], ul.originalColor ?? '#888888');
            this.onLayerStateChange?.(ul.id, { symbologyState: state });
          },
        });
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
