import type { AppSettings, FieldFeature, ToolMode, GeometryType, GeoJSONGeometry, LayerPreset, GPSState, ProjectBundle, ProjectMap } from './types';
import { StorageManager } from './storage/StorageManager';
import { MapManager } from './map/MapManager';
import { BasemapManager } from './map/BasemapManager';
import { GridOverlay } from './map/GridOverlay';
import { CaptureManager } from './capture/CaptureManager';
import { ImportManager } from './io/ImportManager';
import { ExportManager } from './io/ExportManager';
import { HUD } from './ui/HUD';
import { PresetManager } from './ui/PresetManager';
import { SettingsPanel } from './ui/SettingsPanel';
import { FeatureEditor } from './ui/FeatureEditor';
import { GeometryEditor } from './ui/GeometryEditor';
import { ImportDataPanel } from './ui/ImportDataPanel';
import { ExportPanel } from './ui/ExportPanel';
import { CachePanel } from './ui/CachePanel';
import { ProjectPanel } from './ui/ProjectPanel';
import { ProjectLibraryModal, ALL_DATA_MAP_ID } from './ui/ProjectLibraryModal';
import { Toast } from './ui/Toast';
import { Modal } from './ui/Modal';
import { LogConsole } from './ui/LogConsole';
import { EventBus } from './utils/EventBus';
import { DEFAULT_PROJECT_LAYER_PRESETS, buildDefaultProjectStack, PROJECT_TEMPLATES } from './constants';
import { MeasurePanel }  from './ui/MeasurePanel';
import { CutFillPanel }  from './ui/CutFillPanel';
import { ProfilePanel }  from './ui/ProfilePanel';
import { FeatureListPanel } from './ui/FeatureListPanel';
import { StatsPanel } from './ui/StatsPanel';
import { UndoManager } from './utils/UndoManager';
import { SymbolRenderer } from './ui/SymbolRenderer';
import { LayoutMode } from './ui/LayoutMode';
import { DataLibraryModal } from './ui/DataLibraryModal';
import type { UserDataEntry } from './ui/DataLibraryModal';
import { MasterDataPanel } from './ui/MasterDataPanel';
import { BackendClient } from './sync/BackendClient';
import { SyncManager } from './sync/SyncManager';
import { userIdFromEmail, USERID_SOURCE_KEY } from './utils/userId';
import { WetlandsManager } from './wetlands/WetlandsManager';
import { InventoryManager } from './inventory/InventoryManager';
import { PhotoCapturePanel } from './photos/PhotoCapturePanel';
import { PhotoReportPanel } from './photos/PhotoReportPanel';
import { AttributeTablePanel } from './ui/AttributeTablePanel';
import type { SharedLayer, BasemapDef, ImportedLayer } from './types';
import { sharedLayerToDef } from './data/sharedLayerDefs';
import * as turf from '@turf/turf';

export class App {
  private storage = StorageManager.getInstance();
  private mapManager = new MapManager();
  private basemapManager!: BasemapManager;
  private gridOverlay!: GridOverlay;
  private captureManager!: CaptureManager;
  private importManager!: ImportManager;
  private exportManager!: ExportManager;
  private hud!: HUD;
  private presetManager!: PresetManager;
  private settingsPanel!: SettingsPanel;
  private featureEditor!: FeatureEditor;
  private geometryEditor!: GeometryEditor;
  private importDataPanel!: ImportDataPanel;
  private exportPanel!: ExportPanel;
  private cachePanel!: CachePanel;
  private projectPanel!: ProjectPanel;
  private projectLibraryModal!: ProjectLibraryModal;
  private activeMapId = '';     // currently loaded ProjectMap.id (or ALL_DATA_MAP_ID)
  private allDataMode = false;  // true when the "All Data" virtual map is active
  private toast!: Toast;
  private modal!: Modal;
  private logConsole!: LogConsole;
  private freehandCleanup: (() => void) | null = null;
  private freehandGeomType: 'LineString' | 'Polygon' = 'LineString';
  private freehandToleranceM = 5;
  private lassoCleanup: (() => void) | null = null;
  private lassoSelection: FieldFeature[] = [];
  private attrTablePanel = new AttributeTablePanel();

  private measurePanel!:  MeasurePanel;
  private cutFillPanel!:  CutFillPanel;
  private profilePanel!:  ProfilePanel;
  private featureListPanel!: FeatureListPanel;
  private statsPanel!: StatsPanel;
  private dataLibraryModal!: DataLibraryModal;
  private masterDataPanel!: MasterDataPanel;
  private sharedDefsCache: BasemapDef[] = [];
  private stackPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private undoManager = UndoManager.getInstance();
  private symbolRenderer!: SymbolRenderer;
  private layoutMode!: LayoutMode;
  private syncManager!: SyncManager;
  private wetlandsManager!: WetlandsManager;
  private inventoryManager!: InventoryManager;
  private photoCapturePanel!: PhotoCapturePanel;
  private photoReportPanel!: PhotoReportPanel;

  private settings!: AppSettings;
  private features: FieldFeature[] = [];
  private projectLayerPresets: LayerPreset[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private followUser = false;

  async init(): Promise<void> {
    await this.storage.init();
    this.settings = await this.storage.getAppSettings();

    // Force the User identity to the logged-in email prefix before the rest of
    // init consumes settings (feature stamps, point IDs, map labels).
    await this.syncUserIdFromAccess();

    // session-label removed; project name shown in header once project loads

    this.toast = new Toast();
    this.modal = new Modal();
    this.logConsole = new LogConsole();

    await this.mapManager.init('map', this.settings);

    // SymbolRenderer must be created after map init (needs the map instance)
    this.symbolRenderer = new SymbolRenderer(this.mapManager.getMap());
    this.layoutMode = new LayoutMode(
      () => this.mapManager.getCanvas(),
      () => ({
        zoom:    this.mapManager.getZoom(),
        lat:     this.mapManager.getCenter().lat,
        lng:     this.mapManager.getCenter().lng,
        bearing: this.mapManager.getBearing(),
        canvasW: this.mapManager.getCanvas().width,
        canvasH: this.mapManager.getCanvas().height,
      }),
      async () => {
        // Capture at higher zoom for sharper tiles, then restore
        const map = this.mapManager.getMap();
        const origZoom = map.getZoom();
        const targetZoom = Math.min(origZoom + 1, 22);
        await new Promise<void>(resolve => {
          const onIdle = () => { map.off('idle', onIdle); resolve(); };
          map.on('idle', onIdle);
          map.setZoom(targetZoom);
          setTimeout(resolve, 2500);
        });
        const dataUrl = this.mapManager.getCanvas().toDataURL('image/png');
        // Restore zoom
        await new Promise<void>(resolve => {
          const onIdle = () => { map.off('idle', onIdle); resolve(); };
          map.on('idle', onIdle);
          map.setZoom(origZoom);
          setTimeout(resolve, 1500);
        });
        return dataUrl;
      },
      () => this.mapManager.zoomIn(),
      () => this.mapManager.zoomOut(),
      () => this.projectLayerPresets.map(lp => ({
        id: lp.id,
        name: lp.name,
        color: lp.color,
        visible: lp.visible !== false,
        geometryType: lp.geometry_type,
      })),
      (id: string, visible: boolean) => {
        const lp = this.projectLayerPresets.find(l => l.id === id);
        if (lp) EventBus.emit('layer-preset-updated', { ...lp, visible });
      },
    );

    this.basemapManager = new BasemapManager(this.mapManager);
    this.basemapManager.setUserId(this.settings.user_id ?? '');
    this.basemapManager.init(this.settings.basemap_id);
    this.gridOverlay = new GridOverlay(this.mapManager);
    this.captureManager = new CaptureManager(this.mapManager);
    this.captureManager.setSettings(this.settings);
    this.importManager = new ImportManager(this.mapManager);
    this.exportManager = new ExportManager();
    this.presetManager = new PresetManager();
    this.featureEditor = new FeatureEditor(this.presetManager);
    // Created after FeatureEditor so its 'feature-selected' handler runs after the
    // editor's — it then suppresses the generic editor for wetland plots.
    this.wetlandsManager = new WetlandsManager(
      this.mapManager,
      this.captureManager,
      () => this.settings,
      () => this.refreshProjectLayers(),
    );
    this.inventoryManager = new InventoryManager(
      this.mapManager,
      this.captureManager,
      () => this.settings,
      () => this.refreshProjectLayers(),
    );
    this.photoCapturePanel = new PhotoCapturePanel(this.captureManager, () => this.settings);
    this.photoReportPanel = new PhotoReportPanel(this.mapManager);
    this.geometryEditor = new GeometryEditor(this.mapManager);
    this.importDataPanel = new ImportDataPanel(this.importManager, this.mapManager);
    this.cachePanel = new CachePanel(this.mapManager, this.importManager);
    this.projectPanel = new ProjectPanel(
      id => this.loadProject(id),
      (name, desc, templateId) => this.createProject(name, desc, templateId),
      id => this.deleteProject(id),
      (id, name) => this.renameProject(id, name),
      id => this.duplicateProject(id),
    );
    this.exportPanel = new ExportPanel(this.exportManager, () => {
      const b = this.mapManager.getBounds();
      if (!b) return null;
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    });

    this.hud = new HUD();
    this.hud.applySettings(this.settings);

    this.settingsPanel = new SettingsPanel(this.presetManager);
    await this.settingsPanel.init(this.settings);

    await this.presetManager.init(this.settings);
    // Register canvas symbol images for all presets into MapLibre
    this.symbolRenderer.registerAll(this.presetManager.getPresets());
    await this.importDataPanel.init();

    this.measurePanel = new MeasurePanel(this.mapManager);
    this.cutFillPanel = new CutFillPanel(this.mapManager, this.basemapManager);
    this.basemapManager.setCutFillResultProvider(() => this.cutFillPanel.getLastResult());
    this.profilePanel = new ProfilePanel(
      this.mapManager,
      this.basemapManager,
      () => this.cutFillPanel.getLastResult(),
    );
    this.featureListPanel = new FeatureListPanel(
      (lat, lon) => this.mapManager.flyTo(lat, lon, 17),
      (f) => EventBus.emit('feature-selected', { feature: f }),
    );
    this.statsPanel = new StatsPanel();
    this.dataLibraryModal = new DataLibraryModal();
    this.masterDataPanel = new MasterDataPanel();
    this.projectLibraryModal = new ProjectLibraryModal();

    // Resolve the active project and map.
    // Prefer active_map_id (new model); fall back to active_project_id (legacy).
    const activeMapId = this.settings.active_map_id;
    let activeProjectId = this.settings.active_project_id || 'default';
    let activeMap: ProjectMap | undefined;

    if (activeMapId && activeMapId !== ALL_DATA_MAP_ID) {
      activeMap = await this.storage.getMap(activeMapId);
      if (activeMap) activeProjectId = activeMap.project_id;
    }

    if (!activeMap) {
      // Fall back: pick the most-recently updated map for the active project
      const maps = await this.storage.getMapsByProject(activeProjectId);
      maps.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      activeMap = maps[0];
    }

    if (activeMap) {
      this.activeMapId = activeMap.id;
      this.settings.active_map_id = activeMap.id;
      activeProjectId = activeMap.project_id;
    }

    const activeProject = await this.storage.getProject(activeProjectId);

    // For the basemap stack: prefer the active map's per-user view, then the map's shared stack,
    // then localStorage (session snapshot), then project fallback.
    const uid = this.settings.user_id || 'USER';
    const mapStack = activeMap
      ? (activeMap.user_layer_views?.[uid] ?? activeMap.basemap_stack_json)
      : (activeProject ? this.projectStackForUser(activeProject) : undefined);

    this.basemapManager.initForProject(activeProjectId, mapStack);
    // Persist user-driven stack changes (layers/symbology/labels) to the active map.
    this.basemapManager.onStackPersist = (stackJson) => this.persistStackToProject(stackJson);
    this.features = await this.storage.getFeaturesByProject(activeProjectId);
    this.projectLayerPresets = await this.storage.getLayersByProject(activeProjectId);
    this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    this.projectPanel.setActiveProjectId(activeProjectId);
    this.updateHeaderNames(activeProject?.name, activeMap?.name);
    void this.wetlandsManager.renderLegend();
    void this.inventoryManager.renderLegend();

    this.applySettings(this.settings);
    this.captureManager.startGPSWatch();

    this.wireEvents();
    this.wireToolbar();
    this.initToolbarCollapse();
    this.initRightToolbarCollapse();
    this.initLeftToolbarCollapse();
    this.wireMapLegend();
    this.initHudDraggable();
    this.wireMapInteractions();
    this.wireCaptureControls();
    this.wireFreehandPill();
    this.wireLassoHud();

    this.gridOverlay.setVisible(this.settings.grid_visible);

    // North arrow: rotate SVG opposite to map bearing; tap to reset north
    this.mapManager.onRotate(() => {
      const svg = document.getElementById('north-arrow-svg');
      if (svg) svg.style.transform = `rotate(${-this.mapManager.getBearing()}deg)`;
    });
    document.getElementById('north-arrow')?.addEventListener('click', () => {
      this.mapManager.resetNorthPitch();
    });

    // Restore view: URL permalink wins → per-user viewport on active map → map shared defaults → project defaults.
    const appliedPermalink = this.restorePermalinkView();
    if (!appliedPermalink) {
      const userViewport = activeMap?.user_viewports?.[uid];
      const center = userViewport?.center ?? activeMap?.map_center ?? activeProject?.map_center;
      const zoom = userViewport?.zoom ?? activeMap?.map_zoom ?? activeProject?.map_zoom;
      if (center && typeof zoom === 'number') {
        const [lng, lat] = center;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          this.mapManager.flyTo(lat, lng, zoom);
        }
      }
    }

    // Permalink: update URL hash on map move + persist the view to the project.
    EventBus.on<{ center: { lat: number; lng: number }; zoom: number }>('map-moveend', ({ center, zoom }) => {
      const stackParam = this.basemapManager.getUrlStackParam();
      const hash = `#${zoom.toFixed(2)}/${center.lng.toFixed(5)}/${center.lat.toFixed(5)}${stackParam ? '/' + stackParam : ''}`;
      history.replaceState(null, '', hash);
      this.saveProjectViewDebounced(center.lng, center.lat, zoom);
    });

    // Also update URL when stack changes
    EventBus.on('basemap-stack-changed', () => {
      const center = this.mapManager.getCenter();
      const zoom   = this.mapManager.getZoom();
      const stackParam = this.basemapManager.getUrlStackParam();
      const hash = `#${zoom.toFixed(2)}/${center.lng.toFixed(5)}/${center.lat.toFixed(5)}${stackParam ? '/' + stackParam : ''}`;
      history.replaceState(null, '', hash);
    });

    // Cloud sync (opt-in; no-op unless enabled in Settings). Registered after
    // all managers exist so a pull can safely refresh the UI.
    this.syncManager = new SyncManager(this.storage);
    this.storage.setSyncHook(this.syncManager);
    this.syncManager.start();

    EventBus.emit('toast', { message: 'Field Mapper ready', type: 'success', duration: 2000 });
  }

  /**
   * Force the User identity (user_id) to the Cloudflare Access email prefix —
   * e.g. ibryson@fraxinusenviro.com → IBRYSON — so feature stamps and point IDs
   * always match the authenticated user. Best-effort: when the identity is
   * unavailable (offline, local dev, or not behind Access) the existing user_id
   * is left untouched and the field stays manually editable.
   */
  private async syncUserIdFromAccess(): Promise<void> {
    try {
      const who = await new BackendClient(SyncManager.getConfig().url).getWhoami();
      if (!who?.email) return;
      const derived = userIdFromEmail(who.email);
      if (!derived) return;
      localStorage.setItem(USERID_SOURCE_KEY, 'access');
      if (derived !== this.settings.user_id) {
        this.settings.user_id = derived;
        await this.storage.saveAppSettings(this.settings);
      }
    } catch {
      // best-effort; leave user_id as-is
    }
  }

  /**
   * Read-only refresh after a cloud pull applies remote changes: reload presets
   * and the active project's features/layers, then re-render. Does not write, so
   * it cannot trigger a sync feedback loop.
   */
  async refreshAfterSync(): Promise<void> {
    const activeId = this.settings.active_project_id || 'default';
    await this.presetManager.init(this.settings);
    this.features = await this.storage.getFeaturesByProject(activeId);
    this.projectLayerPresets = await this.storage.getLayersByProject(activeId);
    this.symbolRenderer.registerAll(this.presetManager.getPresets());
    this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());

    // Adopt a synced basemap stack (loaded layers/symbology/labels) if the active
    // project's stored stack now differs from what's on the map. setActiveProjectStack
    // suppresses re-persist, so this can't loop back into sync.
    //
    // Guard: if the user made stack changes (e.g. added shared layers) more
    // recently than the remote project's updated_at, keep the local version.
    // Without this, a sync pull arriving after startup can overwrite a
    // locally-fresh stack with a stale remote snapshot — specifically when a
    // version-update reload happened inside the 1.5 s persistStackToProject
    // debounce window, leaving the remote without the latest changes.
    const project = await this.storage.getProject(activeId);
    if (project?.basemap_stack_json) {
      let view = this.projectStackForUser(project);
      if (view && this.stackLayersDiffer(view)) {
        const localTs = localStorage.getItem('fm2026_bm_stack_ts');
        const remoteTs = project.updated_at;
        if (localTs && remoteTs && localTs > remoteTs) {
          console.info('[App] refreshAfterSync: keeping local stack — it is newer than remote', { localTs, remoteTs });
          return;
        }
        // Merge any shared/static-library layers from the local stack that are absent
        // from the incoming remote view. Shared layers are org-wide references; another
        // user's save (which may predate this user's addition of the layer) must not
        // silently drop them. No permission check applies to shared layers — if the
        // user could see them when added they remain valid references.
        try {
          const localObj = JSON.parse(this.basemapManager.getCurrentStackJson()) as { stack?: Array<{ defId: string; label: string }> };
          const localShared = (localObj.stack ?? []).filter(l => l.defId?.startsWith('shared:'));
          if (localShared.length > 0) {
            const remoteObj = JSON.parse(view) as { stack?: Array<{ defId?: string }>; collapsed?: unknown[] };
            const remoteSharedIds = new Set(
              (remoteObj.stack ?? [])
                .filter(l => l.defId?.startsWith('shared:'))
                .map(l => l.defId as string)
            );
            const missing = localShared.filter(l => !remoteSharedIds.has(l.defId));
            if (missing.length > 0) {
              console.info(
                `[App] refreshAfterSync: merging ${missing.length} shared layer(s) absent from remote stack — ` +
                `treated as shared-library references (not user-owned, no permission check): ` +
                missing.map(l => l.label).join(', ')
              );
              remoteObj.stack = [...missing, ...(remoteObj.stack ?? [])] as typeof remoteObj.stack;
              view = JSON.stringify(remoteObj);
            }
          }
        } catch (e) {
          console.warn('[App] refreshAfterSync: could not merge shared layers into remote stack', e);
        }
        this.basemapManager.setActiveProjectStack(view, activeId);
      }
    }
  }

  /** Reload the active project's layer presets and re-render (e.g. after a new
   *  wetlands layer is created). Read-only with respect to feature data. */
  async refreshProjectLayers(): Promise<void> {
    const activeId = this.settings.active_project_id || 'default';
    this.projectLayerPresets = await this.storage.getLayersByProject(activeId);
    this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    void this.wetlandsManager.renderLegend();
    void this.inventoryManager.renderLegend();
  }

  /** True if the incoming stack's layers differ from what's currently on the map. */
  private stackLayersDiffer(incomingJson: string): boolean {
    try {
      const incoming = JSON.stringify((JSON.parse(incomingJson) as { stack?: unknown }).stack ?? []);
      const current = JSON.stringify((JSON.parse(this.basemapManager.getCurrentStackJson()) as { stack?: unknown }).stack ?? []);
      return incoming !== current;
    } catch { return false; }
  }

  /** Debounced: persist the basemap stack to the active map (and project for compat). */
  private persistStackToProject(stackJson: string): void {
    // Don't persist while previewing another user's view (read-only) or in All Data mode.
    if (this.viewingAsUser || this.allDataMode) return;
    if (this.stackPersistTimer) clearTimeout(this.stackPersistTimer);
    this.stackPersistTimer = setTimeout(() => {
      void (async () => {
        const projectId = this.settings.active_project_id || 'default';
        const uid = this.settings.user_id || 'USER';

        // Save to the active ProjectMap (per-user layer view).
        if (this.activeMapId && this.activeMapId !== ALL_DATA_MAP_ID) {
          const map = await this.storage.getMap(this.activeMapId);
          if (map) {
            if (map.user_layer_views?.[uid] !== stackJson) {
              map.user_layer_views = { ...(map.user_layer_views ?? {}), [uid]: stackJson };
              map.basemap_stack_json = stackJson;
              await this.storage.saveMap(map);
            }
          }
        }

        // Also keep the project record in sync (backward compat + cloud sync of project).
        const project = await this.storage.getProject(projectId);
        if (!project) return;
        if (project.basemap_stack_json === stackJson && project.user_layer_views?.[uid] === stackJson) return;
        project.user_layer_views = { ...(project.user_layer_views ?? {}), [uid]: stackJson };
        project.basemap_stack_json = stackJson;
        project.updated_at = new Date().toISOString();
        try {
          const sharedCount = (JSON.parse(stackJson) as { stack?: Array<{ defId: string }> })
            .stack?.filter(l => l.defId?.startsWith('shared:')).length ?? 0;
          console.info(`[App] persistStackToProject: writing project "${projectId}" for user "${uid}" — ${sharedCount} shared-library layer(s) in payload`);
        } catch { /* non-fatal */ }
        await this.storage.saveProject(project);
      })();
    }, 1500);
  }

  /** The active user's stack view for a project (personal view → shared baseline). */
  private projectStackForUser(project: { basemap_stack_json: string; user_layer_views?: Record<string, string> }): string {
    const uid = this.settings.user_id || 'USER';
    return project.user_layer_views?.[uid] ?? project.basemap_stack_json;
  }

  private viewingAsUser: string | null = null;

  /**
   * Temporarily preview another teammate's layer view (read-only), or pass null
   * to return to your own. While previewing, stack changes are not persisted.
   */
  private async applyUserView(uid: string | null): Promise<void> {
    const myUid = this.settings.user_id || 'USER';
    const id = this.settings.active_project_id || 'default';
    const project = await this.storage.getProject(id);
    if (!project) return;

    if (uid && uid !== myUid) {
      const theirJson = project.user_layer_views?.[uid];
      if (!theirJson) {
        EventBus.emit('toast', { message: `No saved view for ${uid}`, type: 'warning' });
        return;
      }
      // Persist my own current view once before previewing someone else's.
      if (!this.viewingAsUser) {
        project.user_layer_views = { ...(project.user_layer_views ?? {}), [myUid]: this.basemapManager.getCurrentStackJson() };
        project.updated_at = new Date().toISOString();
        await this.storage.saveProject(project);
      }
      this.viewingAsUser = uid;
      this.basemapManager.setViewOnly(true);
      this.basemapManager.applyStackEphemeral(theirJson);
      EventBus.emit('toast', { message: `Viewing as ${uid} — read-only`, type: 'info', duration: 2500 });
    } else {
      this.viewingAsUser = null;
      this.basemapManager.setViewOnly(false);
      this.basemapManager.setActiveProjectStack(this.projectStackForUser(project), id);
    }
    this.refreshViewAsControl();
  }

  /** Push the current project's roster of saved-view users into the TOC control. */
  private async refreshViewAsControl(): Promise<void> {
    const id = this.settings.active_project_id || 'default';
    const project = await this.storage.getProject(id);
    const myUid = this.settings.user_id || 'USER';
    const users = Object.keys(project?.user_layer_views ?? {}).filter(u => u !== myUid).sort();
    this.basemapManager.setViewAsControl(users, myUid, this.viewingAsUser, (u) => void this.applyUserView(u));
  }

  /**
   * Rebuild the synthetic BasemapDefs for shared layers. Unions the local store
   * with the backend's org-wide catalogue (GET /shared-layers) so every user
   * sees every shared layer regardless of project or whether per-device sync is
   * enabled. The backend fetch is best-effort (falls back to local when offline
   * or not served by the Worker).
   */
  private async reloadSharedDefs(): Promise<void> {
    const base = SyncManager.getConfig().url;
    const byId = new Map<string, SharedLayer>();
    for (const l of await this.storage.getAllSharedLayers()) byId.set(l.id, l);
    try {
      const remote = await new BackendClient(base).getSharedLayers();
      for (const l of remote) byId.set(l.id, l); // backend is authoritative for the org catalogue
    } catch { /* offline / not behind the Worker — local catalogue only */ }
    this.sharedDefsCache = [...byId.values()]
      .sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.name.localeCompare(b.name))
      .map((l) => sharedLayerToDef(l, base));
  }

  /**
   * Imported layers for the Table of Contents. Imported files (GeoJSON/KML/SHP/
   * GPX vectors and offline MBTiles) are saved globally with no project_id, so
   * they are surfaced in every project's TOC. Project-scoped imports (if any)
   * are merged in first so their order is preserved.
   */
  private async loadTocImported(projectId: string): Promise<ImportedLayer[]> {
    const [scoped, all] = await Promise.all([
      this.storage.getImportedLayersByProject(projectId),
      this.storage.getAllImportedLayers(),
    ]);
    const seen = new Set(scoped.map(l => l.id));
    return [...scoped, ...all.filter(l => !seen.has(l.id))];
  }

  /** Infer (kind, format, ext) from a filename for shared uploads. */
  private classifyShared(name: string): { kind: 'vector' | 'raster'; format: string; ext: string } | null {
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

  /**
   * Upload a file to R2 under static/<folder>/<slug>.<ext> and register it as a
   * SharedLayer (synced org-wide; also matched by the R2→D1 reconciler).
   */
  private async uploadSharedLayer(data: { name: string; folder: string; file: File }): Promise<void> {
    const { name, folder, file } = data;
    const meta = this.classifyShared(file.name);
    if (!meta) throw new Error('Unsupported file type (use .geojson, .pmtiles, or .tif/.tiff).');
    const id = crypto.randomUUID();
    const slug = (name || file.name.replace(/\.[^.]+$/, '')).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'layer';
    const folderPath = folder.trim().replace(/^\/+|\/+$/g, '');
    const key = `static/${folderPath ? folderPath + '/' : ''}${slug}-${id.slice(0, 8)}.${meta.ext}`;

    EventBus.emit('toast', { message: `Uploading ${name}…`, type: 'info', duration: 2000 });
    await new BackendClient(SyncManager.getConfig().url).putBlob(key, file);
    const now = new Date().toISOString();
    const layer: SharedLayer = {
      id, name: name || file.name, folder: folderPath || undefined,
      kind: meta.kind, format: meta.format, r2_key: key, size: file.size,
      added_by: this.settings.user_id, added_at: now, updated_at: now,
    };
    await this.storage.saveSharedLayer(layer); // marks dirty → syncs to the team
    EventBus.emit('sync-now');
    await this.reloadSharedDefs();
    EventBus.emit('toast', { message: `Added ${layer.name} to the shared library`, type: 'success' });
  }

  /** Remove a shared layer org-wide (and from the active map stack if present). */
  private async deleteSharedLayer(sharedId: string): Promise<void> {
    this.basemapManager.removeDefFromStack(`shared:${sharedId}`);
    await this.storage.deleteSharedLayer(sharedId);
    EventBus.emit('sync-now');
    await this.reloadSharedDefs();
  }

  // ============================================================
  // Settings
  // ============================================================
  private applySettings(settings: AppSettings): void {
    this.settings = settings;
    this.captureManager.setSettings(settings);
    this.hud.applySettings(settings);
    this.followUser = settings.follow_user;

    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = settings.crosshair_visible ? 'block' : 'none';

    if (settings.outdoor_mode) document.documentElement.setAttribute('data-outdoor', '');
    else document.documentElement.removeAttribute('data-outdoor');

    const theme = settings.theme ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const darkIcon = document.getElementById('theme-icon-dark');
    const lightIcon = document.getElementById('theme-icon-light');
    if (darkIcon) darkIcon.style.display = theme === 'dark' ? '' : 'none';
    if (lightIcon) lightIcon.style.display = theme === 'light' ? '' : 'none';

    // UI Style (Topograph experimental mode)
    if ((settings.ui_style ?? 'default') === 'topograph') document.documentElement.setAttribute('data-ui-style', 'topograph');
    else document.documentElement.removeAttribute('data-ui-style');

    // Font family
    const root = document.documentElement;
    if (settings.font_family === 'oswald') {
      root.style.setProperty('--font', "'Oswald', system-ui, sans-serif");
      root.setAttribute('data-font', 'oswald');
    } else if (settings.font_family === 'lato') {
      root.style.setProperty('--font', "'Lato', system-ui, sans-serif");
      root.setAttribute('data-font', 'lato');
    } else if (settings.font_family === 'roboto-condensed') {
      root.style.setProperty('--font', "'Roboto Condensed', system-ui, sans-serif");
      root.setAttribute('data-font', 'roboto-condensed');
    } else {
      root.style.removeProperty('--font');
      root.removeAttribute('data-font');
    }

    // Theme accent color
    const accent = settings.theme_color ?? '#4ade80';
    this.applyAccentColor(accent);

    // User ID in TOC
    this.basemapManager.setUserId(settings.user_id ?? '');

    this.gridOverlay.setVisible(settings.grid_visible);
    this.updateButtonState('btn-grid', settings.grid_visible);
    this.updateButtonState('btn-follow', settings.follow_user);
    this.updateActiveLayerIndicator();
  }

  private applyAccentColor(hex: string): void {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return;
    const root = document.documentElement;
    root.style.setProperty('--color-accent', hex);
    root.style.setProperty('--color-accent-dim', `rgba(${r},${g},${b},0.15)`);
    root.style.setProperty('--color-accent-subtle', `rgba(${r},${g},${b},0.08)`);
    root.style.setProperty('--color-accent-dark', `rgb(${Math.round(r*0.6)},${Math.round(g*0.6)},${Math.round(b*0.6)})`);
    root.style.setProperty('--color-accent-border', `rgba(${r},${g},${b},0.4)`);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    root.style.setProperty('--color-accent-text', luminance > 140 ? '#1a1a1a' : '#ffffff');
  }

  // ============================================================
  // Event wiring
  // ============================================================
  private wireEvents(): void {
    EventBus.on<{ settings: AppSettings }>('settings-changed', ({ settings }) => {
      this.applySettings(settings);
    });

    EventBus.on<{ feature: FieldFeature }>('feature-added', ({ feature }) => {
      if (!this.undoManager.locked) {
        const snap = JSON.parse(JSON.stringify(feature)) as FieldFeature;
        this.undoManager.push({
          description: `Add ${snap.type || snap.geometry_type}`,
          undo: async () => {
            await this.storage.deleteFeature(snap.id);
            EventBus.emit('feature-deleted', { id: snap.id });
          },
          redo: async () => {
            await this.storage.saveFeature(snap);
            EventBus.emit('feature-added', { feature: snap });
          },
        });
      }
      this.features.push(feature);
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });

    EventBus.on<{ feature: FieldFeature }>('feature-updated', ({ feature }) => {
      if (!this.undoManager.locked) {
        const old = this.features.find(f => f.id === feature.id);
        if (old) {
          const oldSnap = JSON.parse(JSON.stringify(old)) as FieldFeature;
          const newSnap = JSON.parse(JSON.stringify(feature)) as FieldFeature;
          this.undoManager.push({
            description: `Edit ${newSnap.type || newSnap.geometry_type}`,
            undo: async () => {
              await this.storage.saveFeature(oldSnap);
              EventBus.emit('feature-updated', { feature: oldSnap });
            },
            redo: async () => {
              await this.storage.saveFeature(newSnap);
              EventBus.emit('feature-updated', { feature: newSnap });
            },
          });
        }
      }
      const idx = this.features.findIndex(f => f.id === feature.id);
      if (idx >= 0) this.features[idx] = feature;
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });

    EventBus.on<{ id: string }>('feature-deleted', ({ id }) => {
      if (!this.undoManager.locked) {
        const deleted = this.features.find(f => f.id === id);
        if (deleted) {
          const snap = JSON.parse(JSON.stringify(deleted)) as FieldFeature;
          this.undoManager.push({
            description: `Delete ${snap.type || snap.geometry_type}`,
            undo: async () => {
              await this.storage.saveFeature(snap);
              EventBus.emit('feature-added', { feature: snap });
            },
            redo: async () => {
              await this.storage.deleteFeature(snap.id);
              EventBus.emit('feature-deleted', { id: snap.id });
            },
          });
        }
      }
      this.features = this.features.filter(f => f.id !== id);
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });

    EventBus.on('features-cleared', () => {
      this.features = [];
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });

    // A feature moved to another project leaves the current project's view.
    EventBus.on<{ ids: string[] }>('features-reassigned', ({ ids }) => {
      const idSet = new Set(ids);
      this.features = this.features.filter(f => !idSet.has(f.id));
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });

    EventBus.on<{ tool: ToolMode }>('tool-changed', ({ tool }) => {
      this.updateToolButtonStates(tool);
      this.presetManager.updatePresetsForTool(tool);

      // Show persistent point entry HUD for point and sketch-line/polygon tools
      const pointHud = document.getElementById('point-entry-hud');
      if (pointHud) {
        const showHud = ['gps-point', 'sketch-point', 'sketch-line', 'sketch-polygon'].includes(tool);
        pointHud.style.display = showHud ? 'flex' : 'none';
        const titleEl = document.getElementById('point-hud-title-text');
        if (titleEl) {
          if (tool === 'gps-point')          titleEl.textContent = 'GPS Point Capture';
          else if (tool === 'sketch-point')  titleEl.textContent = 'Sketch Point';
          else if (tool === 'sketch-line')   titleEl.textContent = 'Sketch Line';
          else if (tool === 'sketch-polygon') titleEl.textContent = 'Sketch Polygon';
        }
        // GPS-specific elements: coords bar, presets, drop button
        const isGps = tool === 'gps-point';
        const coordsEl = document.getElementById('point-hud-coords');
        const presetsEl = document.getElementById('point-hud-presets');
        const dropBtn = document.getElementById('btn-drop-gps-point');
        if (coordsEl) coordsEl.style.display = isGps ? '' : 'none';
        if (presetsEl) presetsEl.style.display = isGps ? '' : 'none';
        if (dropBtn) dropBtn.style.display = isGps ? '' : 'none';
      }
    });

    EventBus.on<{
      geometryType: string;
      captureMethod: string;
      onSave: (type: string, desc: string) => void;
      onCancel: () => void;
    }>('prompt-feature-attrs', ({ geometryType, onSave, onCancel }) => {
      this.showFeatureAttributeDialog(geometryType, onSave, onCancel);
    });

    // After edit-geometry completes, reset tool to select
    EventBus.on('edit-geometry-done', () => {
      this.captureManager.setTool('select');
    });

    // Re-render map when type presets change (re-register symbols + redraw features)
    EventBus.on('presets-changed', () => {
      this.symbolRenderer.registerAll(this.presetManager.getPresets());
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });

    // Cloud sync pulled remote changes — reload + redraw the active project.
    EventBus.on('cloud-data-changed', () => {
      void this.refreshAfterSync();
      // Refresh shared static-data layers so newly-synced ones appear without a reload.
      void this.reloadSharedDefs().then(() => this.dataLibraryModal.refreshIfOpen());
    });

    // Cloud sync config/actions from the Settings panel.
    EventBus.on<{ enabled: boolean; url: string }>('sync-config-changed', ({ enabled, url }) => {
      this.syncManager.setConfig(enabled, url);
    });
    EventBus.on('sync-now', () => { void this.syncManager.syncNow(); });

    // Persist updated feature properties from the attribute table panel.
    EventBus.on<{ id: string; features: { properties: Record<string, unknown> }[] }>('user-layer-attrs-saved', async ({ id, features }) => {
      const layers = await this.storage.getAllImportedLayers();
      const il = layers.find((l: ImportedLayer) => l.id === id);
      if (!il || !il.data) return;
      il.data.features.forEach((f: { properties: Record<string, unknown> | null }, i: number) => {
        if (features[i] !== undefined && f.properties) {
          f.properties = { ...(features[i] as { properties: Record<string, unknown> }).properties };
        }
      });
      await this.storage.saveImportedLayer(il);
    });

    // Master Data (read-only cross-project view).
    EventBus.on('open-master-data', () => { void this.masterDataPanel.open(); });
    EventBus.on<{ features: FieldFeature[] }>('master-data-show', async ({ features }) => {
      const allLayers = await this.storage.getAllLayerPresets();
      this.mapManager.updateCollectedFeatures(features, allLayers, this.presetManager.getPresets());
    });
    EventBus.on('master-data-hide', () => {
      // Restore the active project's features on the map.
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
    });


    // Project bundle import (triggered by ImportDataPanel)
    EventBus.on<{ bundle: ProjectBundle; mode: 'new' | 'merge' }>('import-project-bundle', async ({ bundle, mode }) => {
      await this.importProjectBundle(bundle, mode);
    });

    // Project bundle export (triggered by ProjectPanel)
    EventBus.on<{ projectId: string }>('export-project-bundle', async ({ projectId }) => {
      await this.exportManager.exportProjectBundle(projectId);
    });

    // Buffer feature: create a Turf buffer polygon and save directly to the project polygon layer
    EventBus.on<{ geometry: GeoJSONGeometry; distanceM: number; typeLabel?: string }>('buffer-feature', async ({ geometry, distanceM, typeLabel }) => {
      let buffGeom: GeoJSONGeometry | null = null;
      try {
        const result = turf.buffer(geometry as unknown as Parameters<typeof turf.buffer>[0], distanceM / 1000, { units: 'kilometers' });
        if (result && 'geometry' in result && result.geometry) {
          buffGeom = result.geometry as GeoJSONGeometry;
        }
      } catch {
        EventBus.emit('toast', { message: 'Buffer calculation failed', type: 'error' });
        return;
      }
      if (!buffGeom) {
        EventBus.emit('toast', { message: 'Buffer produced no geometry', type: 'warning' });
        return;
      }

      const projectId = this.settings.active_project_id || 'default';
      const now = new Date().toISOString();
      const feature: FieldFeature = {
        id: crypto.randomUUID(),
        point_id: generatePointId(this.settings),
        type: typeLabel || 'Buffer',
        desc: `${distanceM}m buffer`,
        geometry_type: 'Polygon',
        geometry: buffGeom,
        capture_method: 'sketch',
        created_at: now, updated_at: now,
        created_by: this.settings.user_id,
        lat: null, lon: null, elevation: null, accuracy: null,
        layer_id: `${projectId}-polygons`,
        notes: '',
        photos: [],
        project_id: projectId,
      };
      await this.storage.saveFeature(feature);
      EventBus.emit('feature-added', { feature });
      EventBus.emit('toast', { message: `${distanceM}m buffer added to Polygons`, type: 'success', duration: 2500 });
    });

    // Layer preset style/visibility changed from basemap TOC
    EventBus.on<LayerPreset>('layer-preset-updated', async (updatedPreset) => {
      await this.storage.saveLayerPreset(updatedPreset);
      const idx = this.projectLayerPresets.findIndex(lp => lp.id === updatedPreset.id);
      if (idx >= 0) this.projectLayerPresets[idx] = updatedPreset;
      else this.projectLayerPresets.push(updatedPreset);
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
      this.updateActiveLayerIndicator();
    });

    // Add identified feature directly to the project's geometry-type layer
    EventBus.on<{ geometry: GeoJSONGeometry | null; label: string; props: Record<string, unknown>; typeLabel?: string }>(
      'add-identify-feature',
      async ({ geometry, typeLabel }) => {
        if (!geometry) {
          EventBus.emit('toast', { message: 'No geometry available for this feature', type: 'warning' });
          return;
        }
        const projectId = this.settings.active_project_id || 'default';
        const geomType = mapGeoJSONTypeToFieldType(geometry.type);
        const suffix = geomType === 'Point' ? 'points' : geomType === 'LineString' ? 'lines' : 'polygons';
        const layerId = `${projectId}-${suffix}`;
        const now = new Date().toISOString();
        const feature: FieldFeature = {
          id: crypto.randomUUID(),
          point_id: generatePointId(this.settings),
          type: typeLabel ?? '', desc: '',
          geometry_type: geomType,
          geometry: normalizeGeometry(geometry),
          capture_method: 'sketch',
          created_at: now, updated_at: now,
          created_by: this.settings.user_id,
          lat: null, lon: null, elevation: null, accuracy: null,
          layer_id: layerId, notes: '', photos: [],
          project_id: projectId,
        };
        await this.storage.saveFeature(feature);
        EventBus.emit('feature-added', { feature });
        EventBus.emit('toast', { message: `Feature added to ${geomType === 'Point' ? 'Points' : geomType === 'LineString' ? 'Lines' : 'Polygons'}`, type: 'success' });
      },
    );
  }

  // ============================================================
  // Toolbar wiring
  // ============================================================

  private initToolbarCollapse(): void {
    const STORAGE_KEY = 'toolbar-collapsed-sections';
    const stored: Record<string, boolean> = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('#left-toolbar .toolbar-section')
    );

    const saveState = (state: Record<string, boolean>) =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    const collapseSection = (section: HTMLElement) => {
      if (section.classList.contains('collapsed')) return;
      const label = section.querySelector<HTMLElement>('.toolbar-section-label');
      const id = (label?.textContent || '').trim().toLowerCase();
      section.classList.add('collapsed');
      label?.setAttribute('aria-expanded', 'false');
      this.deactivateSectionTools(id);
    };

    // Apply stored / default state
    sections.forEach(section => {
      const label = section.querySelector<HTMLElement>('.toolbar-section-label');
      if (!label) return;
      const id = (label.textContent || '').trim().toLowerCase();
      if (id in stored) {
        section.classList.toggle('collapsed', stored[id]);
        label.setAttribute('aria-expanded', stored[id] ? 'false' : 'true');
      }
    });

    // Wire click handlers
    sections.forEach(section => {
      const label = section.querySelector<HTMLElement>('.toolbar-section-label');
      if (!label) return;
      const id = (label.textContent || '').trim().toLowerCase();

      label.addEventListener('click', () => {
        const isCurrentlyCollapsed = section.classList.contains('collapsed');
        const state: Record<string, boolean> = JSON.parse(
          localStorage.getItem(STORAGE_KEY) || '{}'
        );

        if (isCurrentlyCollapsed) {
          // Accordion: collapse all others first
          sections.forEach(other => {
            if (other !== section) collapseSection(other);
          });
          // Expand this one
          section.classList.remove('collapsed');
          label.setAttribute('aria-expanded', 'true');
          state[id] = false;
        } else {
          // Collapse this one
          collapseSection(section);
          state[id] = true;
        }

        // Persist state for all sections
        sections.forEach(s => {
          const l = s.querySelector<HTMLElement>('.toolbar-section-label');
          const sid = (l?.textContent || '').trim().toLowerCase();
          state[sid] = s.classList.contains('collapsed');
        });
        saveState(state);
      });
    });
  }

  private initRightToolbarCollapse(): void {
    const btn = document.getElementById('btn-collapse-right');
    const panel = document.getElementById('right-controls');
    if (!btn || !panel) return;
    const KEY = 'right-toolbar-collapsed';
    if (localStorage.getItem(KEY) === 'true') panel.classList.add('right-collapsed');
    btn.addEventListener('click', () => {
      panel.classList.toggle('right-collapsed');
      localStorage.setItem(KEY, panel.classList.contains('right-collapsed') ? 'true' : 'false');
    });
  }

  private wireMapLegend(): void {
    const drawer = document.getElementById('map-legend-drawer');
    const body = document.getElementById('map-legend-body');
    const pill = document.getElementById('btn-legend');
    const closeBtn = document.getElementById('map-legend-close');
    const toolbar = document.getElementById('left-toolbar');
    if (!drawer || !body || !pill) return;
    this.basemapManager.setLegendContainer(body);
    const setOpen = (open: boolean) => {
      if (open && toolbar instanceof HTMLElement) {
        // Sit flush against the right edge of the left toolbar
        drawer.style.left = `${toolbar.offsetLeft + toolbar.offsetWidth}px`;
      }
      drawer.style.display = open ? 'flex' : 'none';
      pill.classList.toggle('active', open);
      pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    pill.addEventListener('click', () => setOpen(drawer.style.display === 'none'));
    closeBtn?.addEventListener('click', () => setOpen(false));
  }

  private initLeftToolbarCollapse(): void {
    const btn = document.getElementById('btn-collapse-left');
    const panel = document.getElementById('left-toolbar');
    if (!btn || !panel) return;
    const KEY = 'left-toolbar-collapsed';
    if (localStorage.getItem(KEY) === 'true') panel.classList.add('left-collapsed');
    btn.addEventListener('click', () => {
      panel.classList.toggle('left-collapsed');
      localStorage.setItem(KEY, panel.classList.contains('left-collapsed') ? 'true' : 'false');
    });
  }

  private deactivateSectionTools(sectionId: string): void {
    const currentTool = this.captureManager.getCurrentTool();
    const gpsTools    = ['gps-point', 'gps-point-stream', 'gps-line', 'gps-polygon'];
    const sketchTools = ['sketch-point', 'sketch-line', 'sketch-polygon', 'sketch-freehand'];
    const editTools   = ['select', 'lasso-select', 'edit-attrs', 'delete', 'edit-geometry'];

    switch (sectionId) {
      case 'gps': {
        const hudEl = document.getElementById('point-entry-hud');
        if (hudEl) hudEl.style.display = 'none';
        const captureEl = document.getElementById('capture-controls');
        if (captureEl) captureEl.style.display = 'none';
        break;
      }
      case 'sketch': {
        const hudEl2 = document.getElementById('point-entry-hud');
        if (hudEl2 && sketchTools.includes(currentTool)) hudEl2.style.display = 'none';
        if (sketchTools.includes(currentTool)) this.activateTool('none');
        break;
      }
      case 'edit':
        if (editTools.includes(currentTool)) this.activateTool('none');
        this.featureListPanel.close();
        break;
      case 'info': {
        if (currentTool === 'measure') {
          this.measurePanel.stop();
          this.captureManager.setTool('none');
        }
        const identifyBtn = document.getElementById('btn-identify');
        if (identifyBtn?.classList.contains('active')) identifyBtn.click();
        this.statsPanel.close();
        this.logConsole.hide();
        break;
      }
      case 'elev':
        EventBus.emit('elev:cancel');
        if (this.cutFillPanel.isOpen()) this.cutFillPanel.close();
        break;
      case 'cache':
        this.cachePanel.close();
        break;
    }
  }

  private initHudDraggable(): void {
    const pointHud    = document.getElementById('point-entry-hud');
    const captureHud  = document.getElementById('capture-controls');
    const freehandPill = document.getElementById('freehand-options');
    const pointHandle   = pointHud?.querySelector<HTMLElement>('.hud-drag-handle');
    const captureHandle = captureHud?.querySelector<HTMLElement>('.hud-drag-handle');
    const fhHandle      = freehandPill?.querySelector<HTMLElement>('.fh-drag-handle');
    if (pointHud    && pointHandle)   this.makeDraggable(pointHud,    pointHandle);
    if (captureHud  && captureHandle) this.makeDraggable(captureHud,  captureHandle);
    if (freehandPill && fhHandle)     this.makeDraggable(freehandPill, fhHandle);
  }

  private makeDraggable(el: HTMLElement, handle: HTMLElement): void {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let containerW = 0, containerH = 0;
    let active = false;

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const snapToPixels = () => {
      const parent = el.offsetParent as HTMLElement | null;
      const parentRect = parent?.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      containerW = parentRect?.width  ?? window.innerWidth;
      containerH = parentRect?.height ?? window.innerHeight;
      startLeft = elRect.left - (parentRect?.left ?? 0);
      startTop  = elRect.top  - (parentRect?.top  ?? 0);
      el.style.left      = startLeft + 'px';
      el.style.top       = startTop  + 'px';
      el.style.transform = 'none';
    };

    const move = (cx: number, cy: number) => {
      if (!active) return;
      el.style.left = clamp(startLeft + cx - startX, 0, containerW - el.offsetWidth)  + 'px';
      el.style.top  = clamp(startTop  + cy - startY, 0, containerH - el.offsetHeight) + 'px';
    };

    const end = () => {
      if (!active) return;
      active = false;
      el.classList.remove('hud-dragging');
      document.removeEventListener('mousemove', onMM);
      document.removeEventListener('mouseup',   onMU);
      document.removeEventListener('touchmove', onTM);
      document.removeEventListener('touchend',  onTE);
    };

    const onMM = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onMU = () => end();
    const onTM = (e: TouchEvent) => { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); };
    const onTE = () => end();

    const begin = (cx: number, cy: number) => {
      snapToPixels();
      startX = cx; startY = cy;
      active = true;
      el.classList.add('hud-dragging');
      document.addEventListener('mousemove', onMM);
      document.addEventListener('mouseup',   onMU);
      document.addEventListener('touchmove', onTM, { passive: false });
      document.addEventListener('touchend',  onTE);
    };

    handle.addEventListener('mousedown',  (e) => { e.preventDefault(); begin(e.clientX, e.clientY); });
    handle.addEventListener('touchstart', (e) => { e.preventDefault(); begin(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  }

  private wireToolbar(): void {
    // Tool buttons — toggle-aware
    document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool as ToolMode;
        const currentTool = this.captureManager.getCurrentTool();

        // Toggle tools: tapping an already-active tool completes/stops it
        // gps-point is two-phase: first click = activate HUD, second click = drop point
        const isToggle = ['sketch-line', 'sketch-polygon', 'sketch-freehand', 'lasso-select', 'gps-line', 'gps-polygon', 'gps-point-stream', 'measure'].includes(tool);
        if (isToggle && currentTool === tool) {
          if (tool === 'measure') {
            this.measurePanel.stop();
            this.captureManager.setTool('none');
          } else {
            this.completeCurrentCapture(tool);
          }
        } else {
          if (currentTool === 'measure') this.measurePanel.stop();
          this.activateTool(tool);
        }
      });
    });

    // Identify button
    const identifyBtn = document.getElementById('btn-identify') as HTMLButtonElement | null;
    if (identifyBtn) this.basemapManager.setupIdentify(identifyBtn);
    const rasterSampleBtn = document.getElementById('btn-raster-sample') as HTMLButtonElement | null;
    if (rasterSampleBtn) this.basemapManager.setupRasterSample(rasterSampleBtn);

    // Location buttons
    document.getElementById('btn-locate')?.addEventListener('click', () => {
      const gps = this.captureManager.getGPSState();
      if (gps.available) {
        this.mapManager.flyTo(gps.lat, gps.lon, 16);
      } else {
        EventBus.emit('toast', { message: 'No GPS fix yet', type: 'warning' });
      }
    });

    document.getElementById('btn-follow')?.addEventListener('click', () => {
      this.followUser = !this.followUser;
      this.settings.follow_user = this.followUser;
      this.captureManager.setSettings(this.settings);
      this.updateButtonState('btn-follow', this.followUser);
      this.storage.saveAppSettings(this.settings);
      EventBus.emit('toast', {
        message: this.followUser ? 'Following location' : 'Follow disabled',
        type: 'info', duration: 1500
      });
    });

    document.getElementById('btn-crosshair')?.addEventListener('click', () => {
      this.settings.crosshair_visible = !this.settings.crosshair_visible;
      const crosshair = document.getElementById('crosshair');
      if (crosshair) crosshair.style.display = this.settings.crosshair_visible ? 'block' : 'none';
      this.updateButtonState('btn-crosshair', this.settings.crosshair_visible);
      this.storage.saveAppSettings(this.settings);
    });

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      this.settings.theme = this.settings.theme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', this.settings.theme);
      const darkIcon = document.getElementById('theme-icon-dark');
      const lightIcon = document.getElementById('theme-icon-light');
      if (darkIcon) darkIcon.style.display = this.settings.theme === 'dark' ? '' : 'none';
      if (lightIcon) lightIcon.style.display = this.settings.theme === 'light' ? '' : 'none';
      this.storage.saveAppSettings(this.settings);
    });

    const basemapPanel = document.getElementById('basemap-panel')!;
    document.getElementById('btn-basemap')?.addEventListener('click', async () => {
      const open = basemapPanel.style.display !== 'none';
      if (open) {
        basemapPanel.style.display = 'none';
      } else {
        basemapPanel.style.display = 'block';
        const activeProjectId = this.settings.active_project_id || 'default';
        const [imported, online] = await Promise.all([
          this.loadTocImported(activeProjectId),
          this.storage.getAllOnlineLayers(),
        ]);

        // GeoPDF layers go into the basemap mixer's PDF section
        const pdfLayers = imported
          .filter(l => l.file_type === 'geopdf' && l.image_data_url && l.bounds)
          .map(l => ({
            id: l.id,
            name: l.name,
            visible: l.visible,
            opacity: l.opacity,
            bounds: l.bounds,
          }));

        // All other imported layers + online layers go into "Your Layers"
        const userLayers = [
          ...imported
            .filter(l => l.file_type !== 'geopdf')
            .map(l => ({
              id: l.id,
              name: l.name,
              kind: (l.file_type === 'mbtiles' ? 'raster' : 'vector') as 'vector' | 'raster',
              visible: l.visible,
              opacity: l.opacity,
              mapLayerId: l.file_type === 'mbtiles' ? l.id : `${l.id}-fill`,
              bounds: l.bounds,
              fileType: l.file_type,
              tileUrl: l.file_type === 'mbtiles' ? `mbtiles://${l.id}/{z}/{x}/{y}` : undefined,
              features: l.data?.features.map(f => ({ geometry: f.geometry, properties: (f.properties ?? {}) as Record<string, unknown> })),
              symbologyState: l.symbologyState,
              originalColor: l.color,
            })),
          ...online.map(l => ({
            id: l.id,
            name: l.name,
            kind: 'raster' as 'vector' | 'raster',
            visible: l.visible,
            opacity: l.opacity,
            mapLayerId: l.map_layer_id,
            fileType: l.type,
            tileUrl: l.tileUrl,
          })),
        ];

        const onDeletePDF = async (id: string) => {
          const layer = imported.find(l => l.id === id);
          if (layer) this.importManager.removeImportedLayer(layer);
          await this.storage.deleteImportedLayer(id);
          EventBus.emit('layer-deleted', { id });
        };

        const onDeleteUserLayer = async (id: string) => {
          // Check if it's an imported file layer
          const importedLayer = imported.find(l => l.id === id);
          if (importedLayer) {
            this.importManager.removeImportedLayer(importedLayer);
            await this.storage.deleteImportedLayer(id);
            if (importedLayer.file_type === 'mbtiles') await this.storage.clearTilesForLayer(id);
            EventBus.emit('layer-deleted', { id });
            return;
          }
          // Otherwise it's an online layer
          const onlineLayer = online.find(l => l.id === id);
          if (onlineLayer) {
            this.mapManager.removeLayer(onlineLayer.map_layer_id);
            await this.storage.deleteOnlineLayer(id);
          }
        };

        // Persist visibility/opacity/symbology changes for user layers and PDF layers
        const onLayerStateChange = (id: string, updates: { visible?: boolean; opacity?: number; symbologyState?: import('./types').SymbologyState | null }) => {
          const il = imported.find(l => l.id === id);
          if (il) {
            if (updates.visible !== undefined) il.visible = updates.visible;
            if (updates.opacity !== undefined) il.opacity = updates.opacity;
            if ('symbologyState' in updates) il.symbologyState = updates.symbologyState ?? undefined;
            void this.storage.saveImportedLayer(il);
            return;
          }
          const ol = online.find(l => l.id === id);
          if (ol) {
            if (updates.visible !== undefined) ol.visible = updates.visible;
            if (updates.opacity !== undefined) ol.opacity = updates.opacity;
            void this.storage.saveOnlineLayer(ol);
          }
        };

        this.basemapManager.renderPanel(basemapPanel, () => {
          basemapPanel.style.display = 'none';
        }, userLayers, pdfLayers, onDeletePDF, onDeleteUserLayer, onLayerStateChange,
        this.projectLayerPresets,
        (updatedPreset) => { EventBus.emit('layer-preset-updated', updatedPreset); },
        this.presetManager.getPresets(),
        async (updatedTypePreset) => {
          await this.storage.saveTypePreset(updatedTypePreset);
          const idx = this.presetManager.getPresets().findIndex(p => p.id === updatedTypePreset.id);
          if (idx >= 0) this.presetManager.getPresets()[idx] = updatedTypePreset;
          EventBus.emit('presets-changed', {});
        },
        this.features,
        );
        void this.refreshViewAsControl();
      }
    });

    document.getElementById('btn-grid')?.addEventListener('click', () => {
      this.settings.grid_visible = !this.settings.grid_visible;
      this.gridOverlay.setVisible(this.settings.grid_visible);
      this.updateButtonState('btn-grid', this.settings.grid_visible);
      this.storage.saveAppSettings(this.settings);
    });

    document.getElementById('btn-wakelock')?.addEventListener('click', () => {
      this.toggleWakeLock();
    });

    document.getElementById('btn-data-library')?.addEventListener('click', () => { void this.openDataLibrary(); });
    EventBus.on<{ group?: string }>('open-data-library', ({ group }) => { void this.openDataLibrary(group); });
    this.setupMoreEventListeners();
  }

  /** Build per-user collected feature counts for the User Data panel in the Data Library. */
  private buildUserDataEntries(features: import('./types').FieldFeature[]): UserDataEntry[] {
    const map = new Map<string, UserDataEntry>();
    for (const f of features) {
      const userId = f.created_by || 'UNKNOWN';
      if (!map.has(userId)) {
        map.set(userId, { userId, points: 0, lines: 0, polygons: 0, wetlands: 0, inventory: 0, total: 0, lastUpdated: '' });
      }
      const e = map.get(userId)!;
      const isWetland = f.layer_id?.endsWith('-wetlands') || !!f.wetland_data;
      const isInventory = f.layer_id?.endsWith('-inventory') || !!f.inventory_data;
      if (isInventory) {
        e.inventory++;
      } else if (isWetland) {
        e.wetlands++;
      } else if (f.geometry_type === 'Point') {
        e.points++;
      } else if (f.geometry_type === 'LineString') {
        e.lines++;
      } else if (f.geometry_type === 'Polygon') {
        e.polygons++;
      }
      e.total++;
      if (!e.lastUpdated || (f.updated_at && f.updated_at > e.lastUpdated)) e.lastUpdated = f.updated_at;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  /** Open the Data Library modal, optionally landing on a specific group. */
  private async openDataLibrary(initialGroup = 'all'): Promise<void> {
      this.closeAllPanels();
      const [, allFeatures] = await Promise.all([
        this.reloadSharedDefs(),
        this.storage.getAllFeatures(),
      ]);
      const userDataEntries = this.buildUserDataEntries(allFeatures);
      this.dataLibraryModal.open({
        onAddToMap: (def) => {
          this.basemapManager.addDefToStack(def);
          // Refresh the basemap panel if it's open
          const basemapPanel = document.getElementById('basemap-panel');
          if (basemapPanel && basemapPanel.style.display !== 'none') {
            void (async () => {
              const activeProjectId = this.settings.active_project_id || 'default';
              const [imported, online] = await Promise.all([
                this.loadTocImported(activeProjectId),
                this.storage.getAllOnlineLayers(),
              ]);
              const pdfLayers = imported
                .filter(l => l.file_type === 'geopdf' && l.image_data_url && l.bounds)
                .map(l => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, bounds: l.bounds }));
              const userLayers = imported
                .filter(l => l.file_type !== 'geopdf')
                .map(l => ({
                  id: l.id, name: l.name,
                  kind: (l.file_type === 'mbtiles' ? 'raster' : 'vector') as 'vector' | 'raster',
                  visible: l.visible, opacity: l.opacity,
                  mapLayerId: l.file_type === 'mbtiles' ? l.id : `${l.id}-fill`,
                  bounds: l.bounds, fileType: l.file_type,
                  tileUrl: l.file_type === 'mbtiles' ? `mbtiles://${l.id}/{z}/{x}/{y}` : undefined,
                  features: l.data?.features.map(f => ({ geometry: f.geometry, properties: (f.properties ?? {}) as Record<string, unknown> })),
                  symbologyState: l.symbologyState,
                  originalColor: l.color,
                }));
              const onlineUserLayers = online.map(l => ({
                id: l.id, name: l.name, kind: 'raster' as 'vector' | 'raster',
                visible: l.visible, opacity: l.opacity,
                mapLayerId: l.map_layer_id, fileType: l.type, tileUrl: l.tileUrl,
              }));
              this.basemapManager.renderPanel(basemapPanel, () => { basemapPanel.style.display = 'none'; },
                [...userLayers, ...onlineUserLayers], pdfLayers, undefined, undefined, undefined,
                this.projectLayerPresets, (p) => EventBus.emit('layer-preset-updated', p),
                this.presetManager.getPresets(),
                async (p) => {
                  await this.storage.saveTypePreset(p);
                  const idx = this.presetManager.getPresets().findIndex(x => x.id === p.id);
                  if (idx >= 0) this.presetManager.getPresets()[idx] = p;
                  EventBus.emit('presets-changed', {});
                },
                this.features,
              );
            })();
          }
        },
        onAddToMapWithParams: (def, params) => {
          this.basemapManager.addDefToStack(def, params);
          const basemapPanel = document.getElementById('basemap-panel');
          if (basemapPanel && basemapPanel.style.display !== 'none') {
            void (async () => {
              const activeProjectId = this.settings.active_project_id || 'default';
              const [imported, online] = await Promise.all([
                this.loadTocImported(activeProjectId),
                this.storage.getAllOnlineLayers(),
              ]);
              const pdfLayers = imported
                .filter(l => l.file_type === 'geopdf' && l.image_data_url && l.bounds)
                .map(l => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, bounds: l.bounds }));
              const userLayers = imported
                .filter(l => l.file_type !== 'geopdf')
                .map(l => ({
                  id: l.id, name: l.name,
                  kind: (l.file_type === 'mbtiles' ? 'raster' : 'vector') as 'vector' | 'raster',
                  visible: l.visible, opacity: l.opacity,
                  mapLayerId: l.file_type === 'mbtiles' ? l.id : `${l.id}-fill`,
                  bounds: l.bounds, fileType: l.file_type,
                  tileUrl: l.file_type === 'mbtiles' ? `mbtiles://${l.id}/{z}/{x}/{y}` : undefined,
                  features: l.data?.features.map(f => ({ geometry: f.geometry, properties: (f.properties ?? {}) as Record<string, unknown> })),
                  symbologyState: l.symbologyState,
                  originalColor: l.color,
                }));
              const onlineUserLayers = online.map(l => ({
                id: l.id, name: l.name, kind: 'raster' as 'vector' | 'raster',
                visible: l.visible, opacity: l.opacity,
                mapLayerId: l.map_layer_id, fileType: l.type, tileUrl: l.tileUrl,
              }));
              this.basemapManager.renderPanel(basemapPanel, () => { basemapPanel.style.display = 'none'; },
                [...userLayers, ...onlineUserLayers], pdfLayers, undefined, undefined, undefined,
                this.projectLayerPresets, (p) => EventBus.emit('layer-preset-updated', p),
                this.presetManager.getPresets(),
                async (p) => {
                  await this.storage.saveTypePreset(p);
                  const idx = this.presetManager.getPresets().findIndex(x => x.id === p.id);
                  if (idx >= 0) this.presetManager.getPresets()[idx] = p;
                  EventBus.emit('presets-changed', {});
                },
                this.features,
              );
            })();
          }
        },
        onRenderImport: (container: HTMLElement) => { this.importDataPanel.renderToContainer(container); },
        onRenderExport: (container: HTMLElement) => { this.exportPanel.renderToContainer(container); },
        isInStack: (defId) => this.basemapManager.isDefInStack(defId),
        getSharedDefs: () => this.sharedDefsCache,
        onUploadShared: (data) => this.uploadSharedLayer(data),
        onDeleteShared: (sharedId) => this.deleteSharedLayer(sharedId),
        getUserDataEntries: () => userDataEntries,
      }, initialGroup);
  }

  private setupMoreEventListeners(): void {
    document.getElementById('btn-import')?.addEventListener('click', () => {
      this.closeAllPanels();
      this.importDataPanel.toggle();
    });

    document.getElementById('btn-export')?.addEventListener('click', () => {
      this.closeAllPanels();
      this.exportPanel.toggle();
    });

    // WETLANDS group (left toolbar)
    document.getElementById('btn-wetlands-add-plot')?.addEventListener('click', () => {
      void this.wetlandsManager.startAddPlot();
    });
    document.getElementById('btn-wetlands-edit-plot')?.addEventListener('click', () => {
      void this.wetlandsManager.openEditList();
    });
    document.getElementById('btn-wetlands-report')?.addEventListener('click', () => {
      void this.wetlandsManager.openReportPicker();
    });

    // INVENTORY group (left toolbar)
    document.getElementById('btn-inventory-new')?.addEventListener('click', () => {
      this.inventoryManager.startNewSurvey();
    });
    document.getElementById('btn-inventory-drafts')?.addEventListener('click', () => {
      void this.inventoryManager.openDrafts();
    });
    document.getElementById('btn-inventory-submitted')?.addEventListener('click', () => {
      void this.inventoryManager.openSubmitted();
    });

    // PHOTOS group (left toolbar)
    // btn-photo-point is handled by the data-tool wiring above (activateTool)
    document.getElementById('btn-photo-log')?.addEventListener('click', () => {
      this.photoReportPanel.open();
    });


    // HUD close buttons
    document.getElementById('btn-point-hud-close')?.addEventListener('click', () => {
      const hud = document.getElementById('point-entry-hud');
      if (hud) hud.style.display = 'none';
    });

    // Drop GPS Point button inside the HUD card
    document.getElementById('btn-drop-gps-point')?.addEventListener('click', () => {
      this.completeCurrentCapture('gps-point');
    });

    // Feed live GPS into the point HUD card coords display
    EventBus.on<GPSState>('gps-update', (state) => {
      const latlonEl = document.getElementById('point-hud-latlon');
      const accEl = document.getElementById('point-hud-acc');
      if (!latlonEl) return;
      if (state.available) {
        latlonEl.textContent = `${state.lat.toFixed(5)}, ${state.lon.toFixed(5)}`;
        if (accEl) {
          accEl.textContent = `±${Math.round(state.accuracy ?? 0)}m`;
          accEl.style.color = (state.accuracy ?? 999) <= 5 ? '#4ade80' : (state.accuracy ?? 999) <= 15 ? '#facc15' : '#f87171';
        }
      } else {
        latlonEl.textContent = 'GPS unavailable';
        if (accEl) accEl.textContent = '±--';
      }
    });

    document.getElementById('btn-capture-hud-close')?.addEventListener('click', () => {
      const hud = document.getElementById('capture-controls');
      if (hud) hud.style.display = 'none';
    });

    document.getElementById('btn-cut-fill')?.addEventListener('click', () => {
      this.cutFillPanel.toggle();
    });

    // ELEV group (left toolbar)
    document.getElementById('btn-elev-export-contour')?.addEventListener('click', () => {
      EventBus.emit('elev:export-modal');
    });
    document.getElementById('btn-elev-sample')?.addEventListener('click', () => {
      EventBus.emit('elev:sample-activate');
    });
    document.getElementById('btn-elev-profile')?.addEventListener('click', () => {
      EventBus.emit('elev:profile-activate');
    });
    document.getElementById('btn-elev-cutfill')?.addEventListener('click', () => {
      this.cutFillPanel.toggle();
    });

    // INFO group additions (left toolbar)
    document.getElementById('btn-info-goto')?.addEventListener('click', () => {
      this.showGoToModal();
    });
    document.getElementById('btn-info-stats')?.addEventListener('click', () => {
      void this.statsPanel.toggle();
    });
    document.getElementById('btn-info-console')?.addEventListener('click', () => {
      this.logConsole.toggle();
    });

    document.getElementById('btn-cache')?.addEventListener('click', () => {
      this.closeAllPanels();
      this.cachePanel.toggle();
    });

    document.getElementById('btn-project')?.addEventListener('click', () => {
      this.closeAllPanels();
      this.projectLibraryModal.open({
        onLoadMap: (mapId) => this.loadMap(mapId),
        onLoadProject: (projectId) => this.loadProject(projectId),
        onCreateProject: (name, desc, templateId) => this.createProject(name, desc, templateId),
        onCreateMap: (projectId, name) => this.createMap(projectId, name),
        onDeleteProject: (id) => this.deleteProject(id),
        onDeleteMap: (id) => this.deleteMap(id),
        onRenameProject: (id, name) => this.renameProject(id, name),
        onRenameMap: (id, name) => this.renameMap(id, name),
        onDuplicateMap: (id) => this.duplicateMap(id),
        onExportBundle: (projectId) => EventBus.emit('export-project-bundle', { projectId }),
        getActiveMapId: () => this.activeMapId,
      });
    });

    // PID search bar
    const pidBar = document.getElementById('pid-search-bar');
    const pidInput = document.getElementById('pid-input') as HTMLInputElement | null;
    document.getElementById('btn-search-pid')?.addEventListener('click', () => {
      if (!pidBar) return;
      const isVisible = pidBar.style.display === 'flex';
      pidBar.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) pidInput?.focus();
    });
    document.getElementById('pid-close')?.addEventListener('click', () => {
      if (pidBar) pidBar.style.display = 'none';
    });
    const doSearch = () => {
      const pid = pidInput?.value.trim() ?? '';
      if (!pid) return;
      if (pidBar) pidBar.style.display = 'none';
      void this.basemapManager.searchPID(pid);
    };
    document.getElementById('pid-submit')?.addEventListener('click', doSearch);
    pidInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    document.getElementById('btn-console')?.addEventListener('click', () => {
      this.logConsole.toggle();
    });

    document.getElementById('btn-goto')?.addEventListener('click', () => {
      this.showGoToModal();
    });

    document.getElementById('btn-screenshot')?.addEventListener('click', () => {
      this.captureMapScreenshot();
    });

    document.getElementById('btn-layout-mode')?.addEventListener('click', () => {
      this.layoutMode.startExtentSelection();
    });

    document.getElementById('btn-save-preview')?.addEventListener('click', () => {
      void this.captureMapPreview();
    });

    document.getElementById('btn-share')?.addEventListener('click', () => {
      this.shareCurrentView();
    });

    document.getElementById('btn-feature-list')?.addEventListener('click', () => {
      this.closeAllPanels();
      void this.featureListPanel.toggle();
    });

    document.getElementById('btn-edit-feature-list')?.addEventListener('click', () => {
      this.closeAllPanels();
      void this.featureListPanel.toggle();
    });

    document.getElementById('btn-stats')?.addEventListener('click', () => {
      void this.statsPanel.toggle();
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => void this.undoManager.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => void this.undoManager.redo());

    document.addEventListener('keydown', (e) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        void this.undoManager.undo();
      } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        void this.undoManager.redo();
      }
    });

    // Quick entry buttons — slots 0, 1, 2
    const qeSlots: Array<{ btnId: string; slot: number }> = [
      { btnId: 'btn-quick-entry',   slot: 0 },
      { btnId: 'btn-quick-entry-2', slot: 1 },
      { btnId: 'btn-quick-entry-3', slot: 2 },
    ];
    for (const { btnId, slot } of qeSlots) {
      document.getElementById(btnId)?.addEventListener('click', () => {
        const type = this.presetManager.getQuickEntryType(slot);
        if (!type) {
          EventBus.emit('toast', { message: 'No preset assigned to this button', type: 'warning' });
          return;
        }
        void this.captureManager.quickEntry(type);
      });
    }

  }

  private activateTool(tool: ToolMode): void {
    this.captureManager.setTool(tool);

    const map = this.mapManager.getMap();
    this.detachFreehandPointerEvents();
    const pill = document.getElementById('freehand-options');
    if (tool === 'sketch-freehand') {
      map.dragPan.disable();
      this.attachFreehandPointerEvents();
      pill?.classList.remove('hidden');
    } else if (tool === 'lasso-select') {
      map.dragPan.disable();
      this.attachLassoPointerEvents();
    } else {
      map.dragPan.enable();
      pill?.classList.add('hidden');
      this.clearLassoSelection();
    }

    if (tool === 'photo-point') {
      this.photoCapturePanel.open();
    } else if (tool === 'gps-point') {
      // Two-phase: first click raises the point HUD; second click (completeCurrentCapture) drops the point
      // HUD is shown via the 'tool-changed' event handler — nothing more needed here
    } else if (['gps-line', 'gps-polygon', 'gps-point-stream'].includes(tool)) {
      // Show capture HUD in setup mode — user must select type then tap Start
      this.captureManager.setupForStreaming(tool);
      this.presetManager.populateCaptureTypeSelector(tool);
    }
    // sketch-line / sketch-polygon / select / edit-attrs / delete / edit-geometry:
    // tool is set, no session started here
  }

  /** Called when user taps an already-active toggle tool — completes/stops the capture. */
  private completeCurrentCapture(tool: ToolMode): void {
    if (tool === 'gps-point') {
      // Second click: drop a GPS point using current HUD values
      const type = (document.getElementById('type-selector') as HTMLSelectElement)?.value ?? '';
      const desc = (document.getElementById('point-entry-desc') as HTMLInputElement)?.value ?? '';
      this.captureManager.startGPSCapture(type, desc);
      // Tool stays active ('gps-point') so the HUD remains and user can drop more points
      return;
    }

    if (tool === 'sketch-line' || tool === 'sketch-polygon') {
      const type = (document.getElementById('type-selector') as HTMLSelectElement)?.value ?? '';
      const desc = (document.getElementById('point-entry-desc') as HTMLInputElement)?.value ?? '';
      this.captureManager.completeSketch(type, desc);
    } else if (tool === 'sketch-freehand') {
      // With press-drag-release, re-tapping the button cancels/deactivates the tool
      this.activateTool('none');
      return;
    } else if (tool === 'lasso-select') {
      this.clearLassoSelection();
      this.activateTool('none');
      return;
    } else if (tool === 'gps-line' || tool === 'gps-polygon') {
      const session = this.captureManager.getActiveSession();
      if (!session) {
        // Still in setup mode — cancel
        this.captureManager.cancelSetup();
        this.captureManager.setTool('gps-point');
        return;
      }
      const minPts = tool === 'gps-line' ? 2 : 3;
      if (session.coordinates.length >= minPts) {
        // Type/desc already captured at session start — save directly
        this.captureManager.stopCapture(true);
      } else {
        EventBus.emit('toast', { message: 'Not enough GPS points — keep moving or check accuracy settings', type: 'warning' });
        this.captureManager.stopCapture(false);
      }
      this.captureManager.setTool('gps-point');
    } else if (tool === 'gps-point-stream') {
      if (this.captureManager.isInSetupMode()) {
        this.captureManager.cancelSetup();
        this.captureManager.setTool('gps-point');
        return;
      }
      const session = this.captureManager.getActiveSession();
      const count = session?.point_count ?? 0;
      this.captureManager.stopCapture(false); // points already saved individually
      this.captureManager.setTool('gps-point');
      EventBus.emit('toast', { message: `GPS stream stopped — ${count} points saved`, type: 'success', duration: 3000 });
    }
  }

  // ============================================================
  // Map interactions
  // ============================================================
  private wireMapInteractions(): void {
    EventBus.on<{ lngLat: { lat: number; lng: number } }>('map-click', ({ lngLat }) => {
      // Cut/fill panel consumes clicks when in draw or pick-elevation mode
      if (this.cutFillPanel.handleMapClick(lngLat.lng, lngLat.lat)) return;

      const tool = this.captureManager.getCurrentTool();

      if (tool === 'edit-geometry') return; // GeometryEditor handles its own clicks

      if (tool === 'measure') {
        this.measurePanel.handleClick(lngLat.lng, lngLat.lat);
      } else if (tool === 'sketch-point') {
        // Use persistent point entry HUD values — no modal
        const type = (document.getElementById('type-selector') as HTMLSelectElement)?.value ?? '';
        const desc = (document.getElementById('point-entry-desc') as HTMLInputElement)?.value ?? '';
        void this.captureManager.saveSketchPointDirect(lngLat.lng, lngLat.lat, type, desc);
      } else if (['sketch-line', 'sketch-polygon'].includes(tool)) {
        this.captureManager.handleSketchClick(lngLat.lng, lngLat.lat);
      } else if (tool === 'select' || tool === 'edit-attrs') {
        this.captureManager.handleSelectOrDelete(lngLat.lng, lngLat.lat, false);
      } else if (tool === 'delete') {
        this.captureManager.handleSelectOrDelete(lngLat.lng, lngLat.lat, true);
      }
    });

    EventBus.on<{ lngLat: { lat: number; lng: number } }>('map-mousemove', ({ lngLat }) => {
      const tool = this.captureManager.getCurrentTool();
      if (['sketch-line', 'sketch-polygon'].includes(tool)) {
        this.captureManager.handleSketchMouseMove(lngLat.lng, lngLat.lat);
      }
    });
  }

  private attachFreehandPointerEvents(): void {
    const map = this.mapManager.getMap();
    const canvas = map.getCanvas();

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      this.captureManager.startFreehandDraw(ll.lng, ll.lat);
    };

    const onMove = (e: PointerEvent) => {
      if (!e.buttons) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      this.captureManager.handleSketchMouseMove(ll.lng, ll.lat);
    };

    const onUp = (_e: PointerEvent) => {
      this.captureManager.completeFreehand(this.freehandToleranceM, this.freehandGeomType);
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    this.freehandCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }

  private detachFreehandPointerEvents(): void {
    this.freehandCleanup?.();
    this.freehandCleanup = null;
  }

  private wireFreehandPill(): void {
    const btnLine = document.getElementById('fh-btn-line');
    const btnPoly = document.getElementById('fh-btn-polygon');
    const slider  = document.getElementById('fh-tolerance') as HTMLInputElement | null;
    const valLbl  = document.getElementById('fh-tolerance-val');

    btnLine?.addEventListener('click', () => {
      this.freehandGeomType = 'LineString';
      btnLine.classList.add('active');
      btnPoly?.classList.remove('active');
    });

    btnPoly?.addEventListener('click', () => {
      this.freehandGeomType = 'Polygon';
      btnPoly.classList.add('active');
      btnLine?.classList.remove('active');
    });

    slider?.addEventListener('input', () => {
      this.freehandToleranceM = parseInt(slider.value, 10);
      if (valLbl) valLbl.textContent = `${slider.value} m`;
    });
  }

  private attachLassoPointerEvents(): void {
    const map = this.mapManager.getMap();
    const canvas = map.getCanvas();
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';

    const mapContainer = document.getElementById('map-container') ?? document.body;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:200';
    mapContainer.appendChild(svg);
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('stroke', '#00eaff');
    polygon.setAttribute('stroke-width', '2');
    polygon.setAttribute('stroke-dasharray', '6 3');
    polygon.setAttribute('fill', 'rgba(0,234,255,0.08)');
    svg.appendChild(polygon);

    let isDrawing = false;
    const geoStroke: [number, number][] = [];
    const screenPts: string[] = [];

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      isDrawing = true;
      geoStroke.length = 0;
      screenPts.length = 0;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const ll = map.unproject([px, py]);
      geoStroke.push([ll.lng, ll.lat]);
      screenPts.push(`${px},${py}`);
      polygon.setAttribute('points', screenPts[0]);
    };

    const onMove = (e: PointerEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const ll = map.unproject([px, py]);
      geoStroke.push([ll.lng, ll.lat]);
      screenPts.push(`${px},${py}`);
      polygon.setAttribute('points', screenPts.join(' '));
    };

    const onUp = (_e: PointerEvent) => {
      if (!isDrawing) return;
      isDrawing = false;
      svg.remove();
      this.performLassoSelect([...geoStroke]);
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    this.lassoCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.style.touchAction = '';
      canvas.style.cursor = '';
      svg.remove();
    };
  }

  private detachLassoPointerEvents(): void {
    this.lassoCleanup?.();
    this.lassoCleanup = null;
  }

  private performLassoSelect(stroke: [number, number][]): void {
    if (stroke.length < 3) {
      EventBus.emit('toast', { message: 'Draw a closed area to select features', type: 'info', duration: 2000 });
      return;
    }
    // Re-attach pointer events for next draw
    this.detachLassoPointerEvents();
    this.attachLassoPointerEvents();

    let lassoPoly: ReturnType<typeof turf.polygon>;
    try {
      lassoPoly = turf.polygon([[...stroke, stroke[0]]]);
    } catch (_) {
      EventBus.emit('toast', { message: 'Invalid lasso shape', type: 'warning' });
      return;
    }

    const selected: FieldFeature[] = [];
    for (const feature of this.features) {
      try {
        if (turf.booleanIntersects(lassoPoly, feature.geometry as Parameters<typeof turf.booleanIntersects>[1])) {
          selected.push(feature);
        }
      } catch (_) { /* skip invalid geometry */ }
    }

    this.lassoSelection = selected;
    this.mapManager.highlightFeatures(selected);

    const hud = document.getElementById('lasso-hud');
    const countEl = document.getElementById('lasso-count');
    if (countEl) countEl.textContent = `${selected.length} selected`;
    if (selected.length > 0) {
      hud?.classList.remove('hidden');
    } else {
      hud?.classList.add('hidden');
      EventBus.emit('toast', { message: 'No features in selection', type: 'info', duration: 1500 });
    }
  }

  private clearLassoSelection(): void {
    this.lassoSelection = [];
    this.mapManager.highlightFeatures([]);
    document.getElementById('lasso-hud')?.classList.add('hidden');
    this.detachLassoPointerEvents();
  }

  private wireLassoHud(): void {
    document.getElementById('lasso-edit-attrs')?.addEventListener('click', () => {
      if (this.lassoSelection.length === 0) return;
      const rows = this.lassoSelection.map(f => ({
        id: f.id,
        properties: {
          point_id: f.point_id,
          type: f.type,
          desc: f.desc,
          notes: f.notes,
          layer_id: f.layer_id,
          geometry_type: f.geometry_type as string,
          created_by: f.created_by,
          created_at: f.created_at,
          project_id: f.project_id,
        } as Record<string, unknown>,
      }));
      this.attrTablePanel.open({
        layerName: `Lasso Selection (${this.lassoSelection.length} features)`,
        rows,
        onSave: async (savedRows) => {
          for (const row of savedRows) {
            const feat = this.lassoSelection.find(f => f.id === row.id);
            if (!feat) continue;
            const p = row.properties;
            if (p.type !== undefined)  feat.type  = String(p.type);
            if (p.desc !== undefined)  feat.desc  = String(p.desc);
            if (p.notes !== undefined) feat.notes = String(p.notes);
            await this.storage.saveFeature(feat);
            EventBus.emit('feature-updated', { feature: feat });
          }
          this.mapManager.updateCollectedFeatures(this.features);
        },
      });
    });

    document.getElementById('lasso-export')?.addEventListener('click', () => {
      if (this.lassoSelection.length === 0) return;
      const geojson = {
        type: 'FeatureCollection',
        features: this.lassoSelection.map(f => ({
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            point_id: f.point_id, type: f.type, desc: f.desc,
            notes: f.notes, created_by: f.created_by, created_at: f.created_at,
            layer_id: f.layer_id, project_id: f.project_id,
          },
        })),
      };
      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `lasso_selection_${Date.now()}.geojson`;
      a.click();
      URL.revokeObjectURL(url);
      EventBus.emit('toast', { message: `${this.lassoSelection.length} features exported`, type: 'success', duration: 2000 });
    });

    document.getElementById('lasso-move')?.addEventListener('click', async () => {
      if (this.lassoSelection.length === 0) return;
      if (this.allDataMode) {
        EventBus.emit('toast', { message: 'Switch out of All Data view to move features', type: 'warning', duration: 2500 });
        return;
      }
      const currentProjectId = this.settings.active_project_id || 'default';
      const projects = (await this.storage.getAllProjects()).filter(p => p.id !== currentProjectId);
      if (projects.length === 0) {
        EventBus.emit('toast', { message: 'No other project to move into — create one first', type: 'info', duration: 3000 });
        return;
      }
      const count = this.lassoSelection.length;
      const options = projects.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
      EventBus.emit('show-modal', {
        title: `Move ${count} feature${count !== 1 ? 's' : ''}`,
        html: `
          <p style="margin:0 0 8px">Move the selected feature${count !== 1 ? 's' : ''} to another project:</p>
          <select id="move-target-project" style="width:100%;padding:6px">${options}</select>
        `,
        confirmLabel: 'Move',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          const sel = document.getElementById('move-target-project') as HTMLSelectElement | null;
          const targetId = sel?.value;
          if (!targetId) return;
          const target = projects.find(p => p.id === targetId);
          const toMove = [...this.lassoSelection];
          const moved = await this.storage.reassignFeaturesToProject(toMove, targetId);
          EventBus.emit('features-reassigned', { ids: toMove.map(f => f.id) });
          this.clearLassoSelection();
          EventBus.emit('toast', {
            message: `${moved} feature${moved !== 1 ? 's' : ''} moved to "${target?.name ?? 'project'}"`,
            type: 'success', duration: 2500,
          });
        },
      });
    });

    document.getElementById('lasso-zoom')?.addEventListener('click', () => {
      if (this.lassoSelection.length === 0) return;
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const f of this.lassoSelection) {
        const coords: number[][] = [];
        const collect = (g: unknown): void => {
          if (!g || typeof g !== 'object') return;
          const geom = g as { type: string; coordinates?: unknown };
          if (geom.type === 'Point') { coords.push(geom.coordinates as number[]); }
          else if (geom.type === 'LineString') { (geom.coordinates as number[][]).forEach(c => coords.push(c)); }
          else if (geom.type === 'Polygon') { (geom.coordinates as number[][][]).forEach(r => r.forEach(c => coords.push(c))); }
        };
        collect(f.geometry);
        for (const [lng, lat] of coords) {
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
      }
      if (isFinite(minLng)) this.mapManager.fitBounds([[minLng, minLat], [maxLng, maxLat]], 80);
    });

    document.getElementById('lasso-delete')?.addEventListener('click', async () => {
      const toDelete = [...this.lassoSelection];
      if (toDelete.length === 0) return;
      this.clearLassoSelection();
      for (const feature of toDelete) {
        await this.storage.deleteFeature(feature.id);
        EventBus.emit('feature-deleted', { id: feature.id });
      }
      EventBus.emit('toast', { message: `${toDelete.length} feature${toDelete.length !== 1 ? 's' : ''} deleted`, type: 'success', duration: 2000 });
    });

    document.getElementById('lasso-dismiss')?.addEventListener('click', () => {
      this.clearLassoSelection();
    });
  }

  // ============================================================
  // Capture controls (start / pause / stop buttons + meta fields)
  // ============================================================
  private wireCaptureControls(): void {
    // START / RESUME button
    document.getElementById('btn-capture-start')?.addEventListener('click', () => {
      const session = this.captureManager.getActiveSession();

      // If paused, resume
      if (session?.paused) {
        this.captureManager.pauseCapture();
        return;
      }

      // If in setup mode, validate and start streaming
      const captureType = document.getElementById('capture-type') as HTMLSelectElement | null;
      const captureDesc = document.getElementById('capture-desc') as HTMLInputElement | null;
      const type = captureType?.value ?? '';
      const desc = captureDesc?.value ?? '';

      if (!type) {
        EventBus.emit('toast', { message: 'Select a type before starting', type: 'warning' });
        return;
      }
      this.captureManager.startGPSCapture(type, desc);

      // Lock type/desc for line and polygon once started
      const tool = this.captureManager.getCurrentTool();
      if (tool === 'gps-line' || tool === 'gps-polygon') {
        if (captureType) captureType.disabled = true;
        if (captureDesc) captureDesc.disabled = true;
      }
    });

    // PAUSE button
    document.getElementById('btn-capture-pause')?.addEventListener('click', () => {
      this.captureManager.pauseCapture();
    });

    // STOP button
    document.getElementById('btn-capture-stop')?.addEventListener('click', () => {
      const session = this.captureManager.getActiveSession();
      const isSetup = this.captureManager.isInSetupMode();

      if (!session && !isSetup) return;

      if (!session || isSetup) {
        // Cancel setup
        this.captureManager.stopCapture(false);
        this.captureManager.setTool('gps-point');
        return;
      }

      if (session.tool_mode === 'gps-point-stream') {
        this.completeCurrentCapture('gps-point-stream');
        return;
      }

      // Line or polygon — type/desc already in session
      const minPts = session.geometry_type === 'LineString' ? 2 : 3;
      if (session.coordinates.length >= minPts) {
        this.captureManager.stopCapture(true);
      } else {
        EventBus.emit('toast', { message: 'Not enough GPS points to save', type: 'warning' });
        this.captureManager.stopCapture(false);
      }
      this.captureManager.setTool('gps-point');
    });

    // Type change — update start button state and sync to session (point stream only)
    document.getElementById('capture-type')?.addEventListener('change', (e) => {
      const typeVal = (e.target as HTMLSelectElement).value;
      const descVal = (document.getElementById('capture-desc') as HTMLInputElement)?.value ?? '';
      // Enable/disable Start if in setup mode
      const startBtn = document.getElementById('btn-capture-start') as HTMLButtonElement | null;
      if (startBtn && this.captureManager.isInSetupMode()) {
        startBtn.disabled = !typeVal;
      }
      // During point stream: update on the fly
      this.captureManager.updateSessionTypeDesc(typeVal, descVal);
    });

    // Description change — sync to session (point stream only)
    document.getElementById('capture-desc')?.addEventListener('input', (e) => {
      const typeVal = (document.getElementById('capture-type') as HTMLSelectElement)?.value ?? '';
      const descVal = (e.target as HTMLInputElement).value;
      this.captureManager.updateSessionTypeDesc(typeVal, descVal);
    });
  }

  // ============================================================
  // Feature attribute dialog
  // ============================================================
  private showFeatureAttributeDialog(
    geomType: string,
    onSave: (type: string, desc: string) => void,
    onCancel: () => void
  ): void {
    const presets = this.presetManager.getPresets().filter(
      p => p.geometry_type === geomType || p.geometry_type === 'all'
    );

    EventBus.emit('show-modal', {
      title: `Save ${geomType}`,
      html: `
        <div class="form-group">
          <label>Type
            <select id="attr-type">
              <option value="">None</option>
              ${presets.map(p => `<option value="${p.label}">${p.label}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="form-group">
          <label>Description
            <input type="text" id="attr-desc" placeholder="Enter description..." />
          </label>
        </div>
      `,
      confirmLabel: 'Save Feature',
      onConfirm: () => {
        const type = (document.getElementById('attr-type') as HTMLSelectElement)?.value ?? '';
        const desc = (document.getElementById('attr-desc') as HTMLInputElement)?.value ?? '';
        onSave(type, desc);
      },
      onCancel
    });
  }

  // ============================================================
  // Wake lock
  // ============================================================
  private async toggleWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      EventBus.emit('toast', { message: 'Screen Wake Lock not supported', type: 'warning' });
      return;
    }
    if (this.wakeLock) {
      await this.wakeLock.release();
      this.wakeLock = null;
      this.updateButtonState('btn-wakelock', false);
      EventBus.emit('toast', { message: 'Screen lock disabled', type: 'info', duration: 1500 });
    } else {
      try {
        this.wakeLock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen');
        this.updateButtonState('btn-wakelock', true);
        EventBus.emit('toast', { message: 'Screen will stay awake', type: 'success', duration: 1500 });
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
          this.updateButtonState('btn-wakelock', false);
        });
      } catch (err) {
        EventBus.emit('toast', { message: `Wake lock failed: ${(err as Error).message}`, type: 'error' });
      }
    }
  }

  // ============================================================
  // Utility helpers
  // ============================================================
  private updateToolButtonStates(activeTool: ToolMode): void {
    document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === activeTool);
    });
    // Highlight the section header that contains the active tool
    document.querySelectorAll<HTMLElement>('.toolbar-section').forEach(sec => {
      sec.classList.remove('has-active-tool');
    });
    if (activeTool && activeTool !== 'none') {
      const activeBtn = document.querySelector<HTMLElement>(`.tool-btn[data-tool="${activeTool}"]`);
      activeBtn?.closest('.toolbar-section')?.classList.add('has-active-tool');
    }
  }

  private updateButtonState(btnId: string, active: boolean): void {
    const btn = document.getElementById(btnId);
    if (btn) btn.dataset.active = String(active);
    btn?.classList.toggle('active', active);
  }

  private viewSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Persist the current viewport onto the active map (per-user) and project (debounced). */
  private saveProjectViewDebounced(lng: number, lat: number, zoom: number): void {
    if (this.allDataMode) return;
    if (this.viewSaveTimer) clearTimeout(this.viewSaveTimer);
    this.viewSaveTimer = setTimeout(async () => {
      const uid = this.settings.user_id || 'USER';

      // Save to the active ProjectMap as a per-user viewport override.
      if (this.activeMapId && this.activeMapId !== ALL_DATA_MAP_ID) {
        const map = await this.storage.getMap(this.activeMapId);
        if (map) {
          map.user_viewports = {
            ...(map.user_viewports ?? {}),
            [uid]: { center: [lng, lat], zoom },
          };
          await this.storage.saveMap(map);
        }
      }

      // Also keep project map_center/map_zoom in sync for legacy compat.
      const id = this.settings.active_project_id || 'default';
      const proj = await this.storage.getProject(id);
      if (!proj) return;
      proj.map_center = [lng, lat];
      proj.map_zoom = zoom;
      proj.updated_at = new Date().toISOString();
      await this.storage.saveProject(proj);
    }, 1500);
  }

  /** @returns true if a map view was applied from the URL permalink. */
  private restorePermalinkView(): boolean {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;
    const parts = hash.split('/');
    if (parts.length < 3) return false;
    const zoom = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    const lat = parseFloat(parts[2]);
    let applied = false;
    if (!isNaN(zoom) && !isNaN(lng) && !isNaN(lat)) {
      this.mapManager.flyTo(lat, lng, zoom);
      applied = true;
    }
    // Restore layer stack if encoded in URL (part 3)
    if (parts[3]) {
      this.basemapManager.restoreFromUrlStack(parts[3]);
    }
    return applied;
  }

  private shareCurrentView(): void {
    const center = this.mapManager.getCenter();
    const zoom   = this.mapManager.getZoom();
    const stackParam = this.basemapManager.getUrlStackParam();
    const hash = `#${zoom.toFixed(2)}/${center.lng.toFixed(5)}/${center.lat.toFixed(5)}${stackParam ? '/' + stackParam : ''}`;
    const shareUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    history.replaceState(null, '', hash);

    EventBus.emit('show-modal', {
      title: 'Share Map View',
      html: `
        <p class="modal-hint">This link encodes the current map position and layer stack.
           Anyone with app access will see the same view.</p>
        <div class="share-url-row">
          <input id="share-url-input" type="text" readonly value="${shareUrl}" class="share-url-input" />
          <button id="share-copy-btn" class="btn-primary share-copy-btn">Copy Link</button>
        </div>`,
    });

    requestAnimationFrame(() => {
      const input = document.getElementById('share-url-input') as HTMLInputElement | null;
      input?.select();
      document.getElementById('share-copy-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrl)
          .then(() => EventBus.emit('toast', { message: 'Link copied to clipboard', type: 'success', duration: 2000 }))
          .catch(() => input?.select());
      });
    });
  }

  private showGoToModal(): void {
    EventBus.emit('show-modal', {
      title: 'Go To Coordinates',
      html: `
        <div class="goto-keypad">
          <input type="text" id="goto-input" class="goto-kp-display"
            placeholder="Lat, Lon  ·  DMS  ·  UTM zone E N" autocomplete="off" />
          <div class="goto-kp-hint">e.g. 44.562, −63.755 &nbsp;·&nbsp; 45°20′N 63°45′W</div>
          <div class="goto-kp-grid">
            <button class="goto-kp-key" data-val="7">7</button>
            <button class="goto-kp-key" data-val="8">8</button>
            <button class="goto-kp-key" data-val="9">9</button>
            <button class="goto-kp-key goto-kp-fn" data-val="back">⌫</button>
            <button class="goto-kp-key" data-val="4">4</button>
            <button class="goto-kp-key" data-val="5">5</button>
            <button class="goto-kp-key" data-val="6">6</button>
            <button class="goto-kp-key goto-kp-sym" data-val="-">−</button>
            <button class="goto-kp-key" data-val="1">1</button>
            <button class="goto-kp-key" data-val="2">2</button>
            <button class="goto-kp-key" data-val="3">3</button>
            <button class="goto-kp-key goto-kp-sym" data-val=".">.</button>
            <button class="goto-kp-key goto-kp-wide" data-val="0">0</button>
            <button class="goto-kp-key goto-kp-sym" data-val=",">,</button>
            <button class="goto-kp-key goto-kp-fn" data-val="clear">C</button>
          </div>
        </div>`,
      confirmLabel: 'Go',
      onConfirm: () => {
        const val = (document.getElementById('goto-input') as HTMLInputElement)?.value.trim() ?? '';
        if (!val) return;
        const parsed = this.parseCoords(val);
        if (!parsed) {
          EventBus.emit('toast', { message: 'Could not parse coordinates', type: 'error' });
          return;
        }
        this.mapManager.flyTo(parsed.lat, parsed.lng, 16);
        EventBus.emit('toast', { message: `Navigating to ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`, type: 'success', duration: 2000 });
      },
      onCancel: () => {},
    });
    requestAnimationFrame(() => {
      const input = document.getElementById('goto-input') as HTMLInputElement | null;
      if (input) input.focus();
      document.querySelectorAll<HTMLButtonElement>('.goto-kp-key').forEach(btn => {
        btn.addEventListener('pointerdown', e => e.preventDefault()); // keep focus on input
        btn.addEventListener('click', () => {
          const inp = document.getElementById('goto-input') as HTMLInputElement | null;
          if (!inp) return;
          const val = btn.dataset.val ?? '';
          if (val === 'back') {
            const s = inp.value, start = inp.selectionStart ?? s.length;
            if (start > 0) inp.value = s.slice(0, start - 1) + s.slice(start);
          } else if (val === 'clear') {
            inp.value = '';
          } else {
            const s = inp.value, start = inp.selectionStart ?? s.length;
            inp.value = s.slice(0, start) + val + s.slice(start);
            inp.setSelectionRange(start + 1, start + 1);
          }
          inp.focus();
        });
      });
    });
  }

  private parseCoords(s: string): { lat: number; lng: number } | null {
    // Try decimal degrees: lat, lon
    const dd = s.match(/(-?\d+\.?\d*)[°,\s]+(-?\d+\.?\d*)/);
    if (dd) {
      const lat = parseFloat(dd[1]), lng = parseFloat(dd[2]);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
    return null;
  }

  private captureMapScreenshot(): void {
    const srcCanvas = this.mapManager.getCanvas();
    const out = document.createElement('canvas');
    out.width  = srcCanvas.width;
    out.height = srcCanvas.height;
    const ctx = out.getContext('2d')!;

    ctx.drawImage(srcCanvas, 0, 0);

    const map     = this.mapManager.getMap();
    const zoom    = map.getZoom();
    const lat     = map.getCenter().lat;
    const bearing = map.getBearing();
    const W       = out.width;
    const H       = out.height;

    this.snapshotDrawScaleBar(ctx, zoom, lat, W, H);
    this.snapshotDrawNorthArrow(ctx, bearing, W, H);

    // Load and draw Fraxinus logo (80px, bottom right)
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = () => {
      const size   = 80;
      const margin = 12;
      ctx.globalAlpha = 0.88;
      ctx.drawImage(logoImg, W - size - margin, H - size - margin, size, size);
      ctx.globalAlpha = 1.0;
      this.snapshotDownload(out);
    };
    logoImg.onerror = () => {
      // Proceed without logo
      this.snapshotDownload(out);
    };
    logoImg.src = '/logo.png';
  }

  /**
   * Capture a size-reduced preview of the current map view and let the user
   * assign it to the active map, the active project, or both. Stored as a small
   * JPEG data URL on the ProjectMap / Project records (rides through sync).
   */
  private async captureMapPreview(): Promise<void> {
    const src = this.mapManager.getCanvas();
    if (!src.width || !src.height) {
      EventBus.emit('toast', { message: 'Map not ready for preview', type: 'error' });
      return;
    }

    // Downscale to a thumbnail (max 360px on the long edge) and encode as JPEG.
    const maxEdge = 360;
    const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0, out.width, out.height);

    let dataUrl: string;
    try {
      dataUrl = out.toDataURL('image/jpeg', 0.72);
    } catch (err) {
      EventBus.emit('toast', { message: `Preview failed: ${(err as Error).message}`, type: 'error' });
      return;
    }

    const projectId = this.settings.active_project_id || 'default';
    const mapId = this.activeMapId;
    const hasMap = !!mapId && mapId !== ALL_DATA_MAP_ID;

    EventBus.emit('show-modal', {
      title: 'Save Preview',
      confirmLabel: 'Save Preview',
      cancelLabel: 'Cancel',
      html: `
        <div style="display:flex;flex-direction:column;gap:14px">
          <img src="${dataUrl}" alt="Map preview" style="width:100%;border-radius:8px;border:1px solid var(--color-border)" />
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:${hasMap ? 'pointer' : 'not-allowed'};opacity:${hasMap ? '1' : '0.5'}">
              <input type="radio" name="preview-target" value="map" ${hasMap ? 'checked' : 'disabled'} />
              <span>This map only</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="radio" name="preview-target" value="project" ${hasMap ? '' : 'checked'} />
              <span>This project only</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:${hasMap ? 'pointer' : 'not-allowed'};opacity:${hasMap ? '1' : '0.5'}">
              <input type="radio" name="preview-target" value="both" ${hasMap ? '' : 'disabled'} />
              <span>Both map and project</span>
            </label>
          </div>
        </div>`,
      onConfirm: async () => {
        const sel = document.querySelector<HTMLInputElement>('input[name="preview-target"]:checked')?.value ?? 'project';
        const assignMap = (sel === 'map' || sel === 'both') && hasMap;
        const assignProject = sel === 'project' || sel === 'both';

        if (assignMap) {
          const map = await this.storage.getMap(mapId);
          if (map) { map.thumbnail_url = dataUrl; await this.storage.saveMap(map); }
        }
        if (assignProject) {
          const project = await this.storage.getProject(projectId);
          if (project) { project.thumbnail_url = dataUrl; await this.storage.saveProject(project); }
        }
        this.projectLibraryModal.refreshIfOpen();
        EventBus.emit('toast', { message: 'Preview saved', type: 'success', duration: 2000 });
      },
    });
  }

  private snapshotDownload(canvas: HTMLCanvasElement): void {
    try {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `map-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      EventBus.emit('toast', { message: 'Map screenshot saved', type: 'success', duration: 2000 });
    } catch (err) {
      EventBus.emit('toast', { message: `Screenshot failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  private snapshotDrawScaleBar(ctx: CanvasRenderingContext2D, zoom: number, lat: number, W: number, H: number): void {
    const metersPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    const targetMeters = W * 0.18 * metersPerPx;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetMeters, 1))));
    let niceMeters = magnitude;
    for (const m of [1, 2, 5, 10]) {
      if (magnitude * m <= targetMeters * 1.4) niceMeters = magnitude * m;
    }
    const barPx = niceMeters / metersPerPx;
    const label  = niceMeters >= 1000 ? `${niceMeters / 1000} km` : `${Math.round(niceMeters)} m`;
    const barX = 14, barY = H - 32, barH = 7;

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(barX - 6, barY - 18, barPx + 20, barH + 26);
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barPx / 2, barH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(barX + barPx / 2, barY, barPx / 2, barH);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barPx, barH);
    ctx.beginPath();
    ctx.moveTo(barX, barY - 3); ctx.lineTo(barX, barY + barH + 3);
    ctx.moveTo(barX + barPx, barY - 3); ctx.lineTo(barX + barPx, barY + barH + 3);
    ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.font = `bold ${Math.max(10, W * 0.008)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', barX, barY - 1);
    ctx.fillText(label, barX + barPx, barY - 1);
    ctx.restore();
  }

  private snapshotDrawNorthArrow(ctx: CanvasRenderingContext2D, bearing: number, W: number, H: number): void {
    const r  = Math.max(18, W * 0.018);
    const cx = W - r - 14;
    const cy = r + 14;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((bearing * Math.PI) / 180);
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.38, 0); ctx.lineTo(0, -r * 0.18);
    ctx.closePath();
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, r); ctx.lineTo(r * 0.38, 0); ctx.lineTo(0, -r * 0.18);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.restore();

    const fontSize = Math.max(9, r * 0.7);
    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', cx, cy - r - 4);
    ctx.restore();
  }

  private closeAllPanels(): void {
    document.querySelectorAll('.side-panel.open').forEach(p => {
      (p as HTMLElement).classList.remove('open');
      setTimeout(() => { (p as HTMLElement).style.display = 'none'; }, 300);
    });
  }

  // ============================================================
  // Active sketch layer indicator + manager popover
  // ============================================================
  private updateActiveLayerIndicator(): void {
    const layers = this.projectLayerPresets.length
      ? this.projectLayerPresets
      : [];
    const active = layers.find(l => l.id === this.settings.default_layer_id) ?? layers[0];
    const dot  = document.getElementById('active-layer-dot');
    const name = document.getElementById('active-layer-name');
    if (dot)  dot.style.background = active?.color ?? '#888';
    if (name) name.textContent = active?.name ?? '—';
  }

  /** Update the header breadcrumb showing "ProjectName / MapName". */
  private updateHeaderNames(projectName?: string, mapName?: string): void {
    const projEl = document.getElementById('header-project-name');
    const mapEl = document.getElementById('header-map-name');
    const sepProj = document.getElementById('header-crumb-sep');
    const sepMap = document.getElementById('header-map-sep');

    if (projEl) projEl.textContent = projectName ?? '';
    if (sepProj) sepProj.style.display = projectName ? '' : 'none';

    if (mapEl) mapEl.textContent = mapName ?? '';
    if (sepMap) sepMap.style.display = mapName ? '' : 'none';
  }

  // ============================================================
  // Map management (the new primary navigation unit)
  // ============================================================

  /** Load a specific ProjectMap by ID. Handles the special "All Data" virtual map. */
  async loadMap(mapId: string): Promise<void> {
    if (mapId === ALL_DATA_MAP_ID) {
      this.allDataMode = true;
      this.activeMapId = ALL_DATA_MAP_ID;
      this.settings.active_map_id = ALL_DATA_MAP_ID;
      await this.storage.saveAppSettings(this.settings);

      // Load ALL features from all projects (read-only overview)
      this.features = await this.storage.getAllFeatures();
      const allLayers = await this.storage.getAllLayerPresets();
      this.mapManager.updateCollectedFeatures(this.features, allLayers, this.presetManager.getPresets());
      this.updateHeaderNames(undefined, 'All Data');
      this.projectLibraryModal.refreshIfOpen();

      EventBus.emit('toast', { message: 'All Data — read-only overview', type: 'success', duration: 2000 });
      return;
    }

    const map = await this.storage.getMap(mapId);
    if (!map) return;

    const projectId = map.project_id;
    const wasPreviewing = !!this.viewingAsUser;
    if (wasPreviewing) { this.viewingAsUser = null; this.basemapManager.setViewOnly(false); }

    // Save current map's stack before switching (unless previewing or in All Data mode).
    if (!wasPreviewing && this.activeMapId && this.activeMapId !== ALL_DATA_MAP_ID && !this.allDataMode) {
      const currentMap = await this.storage.getMap(this.activeMapId);
      if (currentMap) {
        const uid = this.settings.user_id || 'USER';
        const json = this.basemapManager.getCurrentStackJson();
        currentMap.user_layer_views = { ...(currentMap.user_layer_views ?? {}), [uid]: json };
        currentMap.basemap_stack_json = json;
        await this.storage.saveMap(currentMap);
      }
    }

    this.allDataMode = false;
    this.activeMapId = mapId;

    // If switching projects, reload features and layers.
    const projectChanged = projectId !== (this.settings.active_project_id || 'default');
    if (projectChanged) {
      this.settings.active_project_id = projectId;
      this.features = await this.storage.getFeaturesByProject(projectId);
      this.projectLayerPresets = await this.storage.getLayersByProject(projectId);
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
      void this.wetlandsManager.renderLegend();
      void this.inventoryManager.renderLegend();
    }

    // Restore this map's basemap stack (user's personal view → shared stack).
    const uid = this.settings.user_id || 'USER';
    const stackJson = map.user_layer_views?.[uid] ?? map.basemap_stack_json;
    if (stackJson) this.basemapManager.setActiveProjectStack(stackJson, projectId);

    // Restore viewport: per-user override → map shared defaults.
    const userViewport = map.user_viewports?.[uid];
    const center = userViewport?.center ?? map.map_center;
    const zoom = userViewport?.zoom ?? map.map_zoom;
    if (center && typeof zoom === 'number') {
      const [lng, lat] = center;
      if (Number.isFinite(lat) && Number.isFinite(lng)) this.mapManager.flyTo(lat, lng, zoom);
    }

    // Update settings
    this.settings.active_map_id = mapId;
    this.settings.default_layer_id = map.default_layer_id;
    await this.storage.saveAppSettings(this.settings);

    // Update UI
    const project = await this.storage.getProject(projectId);
    this.captureManager.setSettings(this.settings);
    this.updateActiveLayerIndicator();
    this.projectPanel.setActiveProjectId(projectId);
    this.projectPanel.refresh();
    this.updateHeaderNames(project?.name, map.name);
    this.projectLibraryModal.refreshIfOpen();

    // Force basemap panel refresh if open
    const basemapPanel = document.getElementById('basemap-panel');
    if (basemapPanel && basemapPanel.style.display !== 'none') {
      basemapPanel.style.display = 'none';
      document.getElementById('btn-basemap')?.click();
    }

    EventBus.emit('toast', { message: `Map: ${map.name}`, type: 'success', duration: 2000 });
  }

  /** Create a new map within a project, cloning the current basemap stack as its starting point. */
  async createMap(projectId: string, name: string): Promise<void> {
    const now = new Date().toISOString();
    const uid = this.settings.user_id || 'USER';

    // Use the current stack as the new map's starting point if we're in the same project.
    const currentStack = this.settings.active_project_id === projectId
      ? this.basemapManager.getCurrentStackJson()
      : buildDefaultProjectStack();

    // Copy active layer preset id (or use project's first layer).
    const layers = await this.storage.getLayersByProject(projectId);
    const defaultLayerId = layers[0]?.id ?? '';

    // Inherit the current map's viewport as the new map's shared defaults.
    const center = this.mapManager.getCenter();
    const zoom = this.mapManager.getZoom();

    const newMap: ProjectMap = {
      id: crypto.randomUUID(),
      project_id: projectId,
      name,
      basemap_stack_json: currentStack,
      user_layer_views: { [uid]: currentStack },
      map_center: [center.lng, center.lat],
      map_zoom: zoom,
      default_layer_id: defaultLayerId,
      created_at: now,
      updated_at: now,
      created_by: uid,
    };
    await this.storage.saveMap(newMap);
    await this.loadMap(newMap.id);
  }

  async deleteMap(mapId: string): Promise<void> {
    const map = await this.storage.getMap(mapId);
    if (!map) return;
    await this.storage.deleteMap(mapId);

    // If deleted map was active, switch to another map in same project.
    if (this.activeMapId === mapId) {
      const remainingMaps = await this.storage.getMapsByProject(map.project_id);
      remainingMaps.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (remainingMaps.length > 0) {
        await this.loadMap(remainingMaps[0].id);
      } else {
        // Last map deleted — load project's first available, or All Data.
        const allMaps = await this.storage.getAllMaps();
        if (allMaps.length > 0) {
          allMaps.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
          await this.loadMap(allMaps[0].id);
        } else {
          await this.loadMap(ALL_DATA_MAP_ID);
        }
      }
    }
    this.projectLibraryModal.refreshIfOpen();
  }

  async renameMap(mapId: string, name: string): Promise<void> {
    const map = await this.storage.getMap(mapId);
    if (!map) return;
    map.name = name;
    await this.storage.saveMap(map);
    if (this.activeMapId === mapId) {
      const project = await this.storage.getProject(this.settings.active_project_id || 'default');
      this.updateHeaderNames(project?.name, name);
    }
    this.projectLibraryModal.refreshIfOpen();
  }

  async duplicateMap(mapId: string): Promise<void> {
    const src = await this.storage.getMap(mapId);
    if (!src) return;
    const now = new Date().toISOString();
    const copy: ProjectMap = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
      created_at: now,
      updated_at: now,
      user_layer_views: {},
      user_viewports: {},
    };
    await this.storage.saveMap(copy);
    EventBus.emit('toast', { message: `"${copy.name}" created`, type: 'success', duration: 2000 });
    this.projectLibraryModal.refreshIfOpen();
  }

  // ============================================================
  // Project management
  // ============================================================
  async loadProject(id: string): Promise<void> {
    // Load the most-recently updated map for this project.
    const maps = await this.storage.getMapsByProject(id);
    maps.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (maps.length > 0) {
      await this.loadMap(maps[0].id);
      return;
    }

    // No maps exist yet (edge case post-migration) — create a default one.
    const project = await this.storage.getProject(id);
    if (!project) return;
    await this.createMap(id, project.name);
  }

  async createProject(name: string, description: string, templateId?: string): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create default layer presets for this project
    const presets = DEFAULT_PROJECT_LAYER_PRESETS(id);
    for (const lp of presets) await this.storage.saveLayerPreset(lp);

    // Pick the template's basemap stack (falls back to the General default).
    const template = templateId ? PROJECT_TEMPLATES.find(t => t.id === templateId) : undefined;
    const basemap_stack_json = template
      ? BasemapManager.buildStackJson(template.stackSpecs)
      : buildDefaultProjectStack();

    const uid = this.settings.user_id || 'USER';
    const project = {
      id,
      name,
      description,
      created_at: now,
      updated_at: now,
      default_layer_id: presets[0].id, // Points layer
      basemap_stack_json,
      map_center: [-63.5, 45.0] as [number, number],
      map_zoom: 10,
    };
    await this.storage.saveProject(project);

    // Create a default map for this project.
    const defaultMap: ProjectMap = {
      id: crypto.randomUUID(),
      project_id: id,
      name,
      basemap_stack_json,
      user_layer_views: { [uid]: basemap_stack_json },
      map_center: [-63.5, 45.0],
      map_zoom: 10,
      default_layer_id: presets[0].id,
      created_at: now,
      updated_at: now,
    };
    await this.storage.saveMap(defaultMap);
    await this.loadMap(defaultMap.id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.storage.deleteFeaturesByProject(id);
    await this.storage.deleteLayersByProject(id);
    await this.storage.deleteImportedLayersByProject(id);
    await this.storage.deleteMapsByProject(id);
    await this.storage.deleteProject(id);

    // If deleted project was active, switch to default
    if ((this.settings.active_project_id || 'default') === id) {
      await this.loadProject('default');
    }
    this.projectPanel.refresh();
    this.projectLibraryModal.refreshIfOpen();
  }

  async renameProject(id: string, name: string): Promise<void> {
    const project = await this.storage.getProject(id);
    if (!project) return;
    project.name = name;
    project.updated_at = new Date().toISOString();
    await this.storage.saveProject(project);
    this.projectPanel.refresh();
    this.projectLibraryModal.refreshIfOpen();
    if ((this.settings.active_project_id || 'default') === id) {
      const activeMap = this.activeMapId ? await this.storage.getMap(this.activeMapId) : undefined;
      this.updateHeaderNames(name, activeMap?.name);
      EventBus.emit('toast', { message: `Project renamed to "${name}"`, type: 'success', duration: 2000 });
    }
  }

  async duplicateProject(id: string): Promise<void> {
    const src = await this.storage.getProject(id);
    if (!src) return;
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const copy = { ...src, id: newId, name: `${src.name} (copy)`, created_at: now, updated_at: now, user_layer_views: {} };
    await this.storage.saveProject(copy);
    // Copy layer presets
    const srcPresets = await this.storage.getLayersByProject(id);
    for (const lp of srcPresets) {
      await this.storage.saveLayerPreset({ ...lp, id: crypto.randomUUID(), project_id: newId });
    }
    // Copy maps
    const srcMaps = await this.storage.getMapsByProject(id);
    for (const m of srcMaps) {
      await this.storage.saveMap({ ...m, id: crypto.randomUUID(), project_id: newId, created_at: now, updated_at: now, user_layer_views: {}, user_viewports: {} });
    }
    EventBus.emit('toast', { message: `"${copy.name}" created`, type: 'success', duration: 2000 });
    this.projectPanel.refresh();
    this.projectLibraryModal.refreshIfOpen();
  }

  async importProjectBundle(bundle: ProjectBundle, mode: 'new' | 'merge'): Promise<void> {
    try {
    console.log(`[import] starting mode=${mode} features=${bundle.features.length} layers=${bundle.layer_presets.length} typePresets=${bundle.type_presets.length}`);
    const now = new Date().toISOString();

    // Upsert type presets globally (shared across all projects)
    for (const tp of bundle.type_presets) {
      await this.storage.saveTypePreset(tp);
    }
    console.log(`[import] saved ${bundle.type_presets.length} type presets`);

    // Refresh in-memory preset cache so newly imported types are immediately available
    await this.presetManager.init(this.settings);
    this.symbolRenderer.registerAll(this.presetManager.getPresets());
    console.log('[import] preset cache refreshed');

    if (mode === 'new') {
      const newProjectId = crypto.randomUUID();
      console.log(`[import] new project id: ${newProjectId}`);

      // Map old layer preset IDs → new IDs
      const lpIdMap = new Map<string, string>();
      for (const lp of bundle.layer_presets) {
        lpIdMap.set(lp.id, crypto.randomUUID());
      }

      // Determine new default_layer_id (remap from old project default)
      const newDefaultLayerId = lpIdMap.get(bundle.project.default_layer_id) ?? '';
      console.log(`[import] default_layer_id: ${bundle.project.default_layer_id} → ${newDefaultLayerId}`);

      // Save layer presets with new IDs scoped to new project
      for (const lp of bundle.layer_presets) {
        const saved = { ...lp, id: lpIdMap.get(lp.id)!, project_id: newProjectId };
        await this.storage.saveLayerPreset(saved);
        console.log(`[import] saved layer preset: ${lp.name} → id=${saved.id}`);
      }

      // Save features with fresh UUIDs so the originals in the source project are not overwritten
      for (const f of bundle.features) {
        const saved = { ...f, id: crypto.randomUUID(), project_id: newProjectId, layer_id: lpIdMap.get(f.layer_id) ?? f.layer_id };
        await this.storage.saveFeature(saved);
        console.log(`[import] saved feature: ${f.id} → ${saved.id} project=${saved.project_id} layer=${saved.layer_id}`);
      }

      // Verify counts from DB immediately after saving
      const layersInDB = await this.storage.getLayersByProject(newProjectId);
      const featuresInDB = await this.storage.getFeaturesByProject(newProjectId);
      console.log(`[import] DB verify: ${layersInDB.length} layers, ${featuresInDB.length} features for project ${newProjectId}`);

      // Save the project record
      await this.storage.saveProject({
        ...bundle.project,
        id: newProjectId,
        name: bundle.bundle_name + ' — imported',
        created_at: now,
        updated_at: now,
        default_layer_id: newDefaultLayerId,
      });
      console.log('[import] project saved, calling loadProject');

      await this.loadProject(newProjectId);
      console.log('[import] loadProject done');
      EventBus.emit('toast', {
        message: `Imported "${bundle.bundle_name}": ${bundle.features.length} feature${bundle.features.length !== 1 ? 's' : ''}`,
        type: 'success', duration: 4000,
      });

    } else {
      // Merge into current project
      const currentProjectId = this.settings.active_project_id || 'default';
      console.log(`[import] merge into project: ${currentProjectId}`);
      const existingLayers = await this.storage.getLayersByProject(currentProjectId);
      console.log(`[import] existing layers: ${existingLayers.length}`);

      // Match bundle layers to existing layers by name; create missing ones
      const lpIdMap = new Map<string, string>();
      for (const bundleLp of bundle.layer_presets) {
        const match = existingLayers.find(el => el.name === bundleLp.name && el.geometry_type === bundleLp.geometry_type);
        if (match) {
          lpIdMap.set(bundleLp.id, match.id);
          console.log(`[import] layer matched: ${bundleLp.name} → ${match.id}`);
        } else {
          const newId = crypto.randomUUID();
          lpIdMap.set(bundleLp.id, newId);
          await this.storage.saveLayerPreset({ ...bundleLp, id: newId, project_id: currentProjectId });
          console.log(`[import] layer created: ${bundleLp.name} → ${newId}`);
        }
      }

      // Upsert features — skip if the locally stored version is newer
      let imported = 0;
      for (const f of bundle.features) {
        const existing = await this.storage.getFeature(f.id);
        if (existing && existing.updated_at >= f.updated_at) {
          console.log(`[import] feature skipped (not newer): ${f.id}`);
          continue;
        }
        await this.storage.saveFeature({
          ...f,
          project_id: currentProjectId,
          layer_id: lpIdMap.get(f.layer_id) ?? f.layer_id,
        });
        console.log(`[import] feature saved: ${f.id} → project=${currentProjectId}`);
        imported++;
      }

      // Reload map display
      this.features = await this.storage.getFeaturesByProject(currentProjectId);
      this.projectLayerPresets = await this.storage.getLayersByProject(currentProjectId);
      this.mapManager.updateCollectedFeatures(this.features, this.projectLayerPresets, this.presetManager.getPresets());
      this.updateActiveLayerIndicator();
      EventBus.emit('presets-changed', undefined);
      EventBus.emit('toast', {
        message: `Merged: ${imported} new/updated feature${imported !== 1 ? 's' : ''} added`,
        type: 'success', duration: 4000,
      });
    }
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.error('importProjectBundle failed:', err);
      EventBus.emit('show-modal', {
        title: 'Import Failed',
        html: `<p style="color:var(--color-danger);margin:0 0 8px">Bundle import encountered an error:</p><pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;background:var(--bg-secondary);padding:8px;border-radius:4px;max-height:120px;overflow-y:auto">${msg}</pre>`,
        confirmLabel: 'OK',
        cancelLabel: 'OK',
      });
    }
  }

  wireLayerMgr(): void {
    const btn = document.getElementById('btn-active-layer');
    const popover = document.getElementById('layer-mgr-popover') as HTMLElement | null;
    if (!btn || !popover) return;

    const closePopover = () => { popover.style.display = 'none'; };

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (popover.style.display !== 'none') { closePopover(); return; }

      const layers = await this.storage.getLayersByProject(this.settings.active_project_id || 'default');
      const btnRect = btn.getBoundingClientRect();
      const containerRect = btn.closest('#map-container, .app-container, body')?.getBoundingClientRect()
        ?? { left: 0, top: 0 };

      popover.style.left = `${btnRect.right - containerRect.left + 4}px`;
      popover.style.top  = `${btnRect.top  - containerRect.top}px`;

      const geomBadge = (g: string) =>
        g === 'Point' ? 'Pt' : g === 'LineString' ? 'Ln' : 'Pg';

      popover.innerHTML = `
        <button class="layer-mgr-close" id="lm-close">✕</button>
        <h4>Sketch Layers</h4>
        <div class="layer-mgr-list">
          ${layers.map(l => `
            <button class="layer-mgr-item${l.id === this.settings.default_layer_id ? ' active' : ''}"
                    data-layer-id="${l.id}">
              <span class="lm-dot" style="background:${l.color}"></span>
              <span class="lm-name">${l.name}</span>
              <span class="lm-badge">${geomBadge(l.geometry_type)}</span>
              ${l.id.startsWith('default') ? '' : `<button class="lm-del" data-del-id="${l.id}" title="Delete">✕</button>`}
            </button>`).join('')}
        </div>
        <div class="layer-mgr-new">
          <div class="layer-mgr-new-row">
            <input type="text" id="lm-new-name" placeholder="New layer name…" maxlength="40" />
            <select id="lm-new-geom">
              <option value="Point">Points</option>
              <option value="LineString">Lines</option>
              <option value="Polygon">Polygons</option>
            </select>
          </div>
          <div class="layer-mgr-new-row">
            <input type="color" id="lm-new-color" value="#4ade80" style="width:32px;height:28px;padding:0;border:none;background:none;cursor:pointer;" />
            <button class="btn btn-sm btn-primary" id="lm-new-add" style="flex:1">+ Add Layer</button>
          </div>
        </div>`;

      popover.style.display = 'block';

      document.getElementById('lm-close')?.addEventListener('click', closePopover);

      // Activate layer on item click
      popover.querySelectorAll<HTMLButtonElement>('.layer-mgr-item').forEach(item => {
        item.addEventListener('click', async (ev) => {
          const delBtn = (ev.target as HTMLElement).closest('.lm-del');
          if (delBtn) return; // handled by delete handler below
          const id = item.dataset.layerId;
          if (!id) return;
          this.settings.default_layer_id = id;
          await this.storage.saveAppSettings(this.settings);
          this.captureManager.setSettings(this.settings);
          this.updateActiveLayerIndicator();
          closePopover();
          const layer = layers.find(l => l.id === id);
          EventBus.emit('toast', { message: `Active layer: ${layer?.name ?? id}`, type: 'info', duration: 1500 });
        });
      });

      // Delete layer
      popover.querySelectorAll<HTMLButtonElement>('.lm-del').forEach(delBtn => {
        delBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const id = delBtn.dataset.delId;
          if (!id) return;
          if (!confirm('Delete this sketch layer? Its recorded features will not be deleted.')) return;
          await this.storage.deleteLayerPreset(id);
          this.projectLayerPresets = await this.storage.getLayersByProject(this.settings.active_project_id || 'default');
          if (this.settings.default_layer_id === id) {
            const remaining = layers.filter(l => l.id !== id);
            this.settings.default_layer_id = remaining[0]?.id ?? 'default';
            await this.storage.saveAppSettings(this.settings);
            this.captureManager.setSettings(this.settings);
            this.updateActiveLayerIndicator();
          }
          closePopover();
          EventBus.emit('toast', { message: 'Layer deleted', type: 'info', duration: 1500 });
        });
      });

      // Add new layer
      document.getElementById('lm-new-add')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('lm-new-name') as HTMLInputElement;
        const geomSel   = document.getElementById('lm-new-geom') as HTMLSelectElement;
        const colorIn   = document.getElementById('lm-new-color') as HTMLInputElement;
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const geomType = geomSel.value as GeometryType;
        const color = colorIn.value;
        const newLayer = {
          id: crypto.randomUUID(),
          name,
          geometry_type: geomType,
          color,
          stroke_color: color,
          stroke_width: 2,
          fill_opacity: geomType === 'Polygon' ? 0.4 : 1.0,
          types: [],
          project_id: this.settings.active_project_id || 'default',
          visible: true,
        };
        await this.storage.saveLayerPreset(newLayer);
        this.settings.default_layer_id = newLayer.id;
        await this.storage.saveAppSettings(this.settings);
        this.projectLayerPresets = await this.storage.getLayersByProject(this.settings.active_project_id || 'default');
        this.captureManager.setSettings(this.settings);
        this.updateActiveLayerIndicator();
        closePopover();
        EventBus.emit('toast', { message: `Layer "${name}" created and activated`, type: 'success' });
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (popover.style.display !== 'none' && !popover.contains(e.target as Node) && e.target !== btn) {
        closePopover();
      }
    });
  }
}

// ---- Geometry helpers for add-to-sketch ----

function mapGeoJSONTypeToFieldType(type: string): GeometryType {
  if (type === 'Point' || type === 'MultiPoint') return 'Point';
  if (type.includes('Line')) return 'LineString';
  return 'Polygon';
}

function normalizeGeometry(g: GeoJSONGeometry): GeoJSONGeometry {
  const t = g.type as string;
  if (t === 'MultiPoint')      return { type: 'Point',      coordinates: ((g as unknown as { coordinates: unknown[][] }).coordinates[0] as unknown) as [number,number] } as GeoJSONGeometry;
  if (t === 'MultiLineString') return { type: 'LineString',  coordinates: (g as unknown as { coordinates: [number,number][][] }).coordinates[0] } as GeoJSONGeometry;
  if (t === 'MultiPolygon')    return { type: 'Polygon',     coordinates: (g as unknown as { coordinates: [number,number][][][] }).coordinates[0] } as GeoJSONGeometry;
  return g;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generatePointId(settings: AppSettings): string {
  const now = new Date();
  const y  = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const h  = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${settings.user_id}_${y}_${mo}_${d}_${h}${mi}`;
}

// WakeLock types extension
interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
}
