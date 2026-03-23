import type { AppSettings, FieldFeature, ToolMode } from './types';
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
import { Toast } from './ui/Toast';
import { Modal } from './ui/Modal';
import { LogConsole } from './ui/LogConsole';
import { EventBus } from './utils/EventBus';
import { generateSessionId } from './constants';

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
  private toast!: Toast;
  private modal!: Modal;
  private logConsole!: LogConsole;

  private settings!: AppSettings;
  private features: FieldFeature[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private followUser = false;

  async init(): Promise<void> {
    await this.storage.init();
    this.settings = await this.storage.getAppSettings();

    const sessionLabel = document.getElementById('session-label');
    if (sessionLabel) sessionLabel.textContent = generateSessionId();

    this.toast = new Toast();
    this.modal = new Modal();
    this.logConsole = new LogConsole();

    await this.mapManager.init('map', this.settings);

    this.basemapManager = new BasemapManager(this.mapManager);
    this.basemapManager.init(this.settings.basemap_id);
    this.gridOverlay = new GridOverlay(this.mapManager);
    this.captureManager = new CaptureManager(this.mapManager);
    this.captureManager.setSettings(this.settings);
    this.importManager = new ImportManager(this.mapManager);
    this.exportManager = new ExportManager();
    this.presetManager = new PresetManager();
    this.featureEditor = new FeatureEditor(this.presetManager);
    this.geometryEditor = new GeometryEditor(this.mapManager);
    this.importDataPanel = new ImportDataPanel(this.importManager, this.mapManager);
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
    await this.importDataPanel.init();

    this.features = await this.storage.getAllFeatures();
    this.mapManager.updateCollectedFeatures(this.features);

    this.applySettings(this.settings);
    this.captureManager.startGPSWatch();

    this.wireEvents();
    this.wireToolbar();
    this.wireMapInteractions();
    this.wireCaptureControls();

    this.gridOverlay.setVisible(this.settings.grid_visible);

    EventBus.emit('toast', { message: 'Field Mapper ready', type: 'success', duration: 2000 });
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

    this.gridOverlay.setVisible(settings.grid_visible);
    this.updateButtonState('btn-grid', settings.grid_visible);
    this.updateButtonState('btn-follow', settings.follow_user);
  }

  // ============================================================
  // Event wiring
  // ============================================================
  private wireEvents(): void {
    EventBus.on<{ settings: AppSettings }>('settings-changed', ({ settings }) => {
      this.applySettings(settings);
    });

    EventBus.on<{ feature: FieldFeature }>('feature-added', ({ feature }) => {
      this.features.push(feature);
      this.mapManager.updateCollectedFeatures(this.features);
    });

    EventBus.on<{ feature: FieldFeature }>('feature-updated', ({ feature }) => {
      const idx = this.features.findIndex(f => f.id === feature.id);
      if (idx >= 0) this.features[idx] = feature;
      this.mapManager.updateCollectedFeatures(this.features);
    });

    EventBus.on<{ id: string }>('feature-deleted', ({ id }) => {
      this.features = this.features.filter(f => f.id !== id);
      this.mapManager.updateCollectedFeatures(this.features);
    });

    EventBus.on('features-cleared', () => {
      this.features = [];
      this.mapManager.updateCollectedFeatures(this.features);
    });

    EventBus.on<{ tool: ToolMode }>('tool-changed', ({ tool }) => {
      this.updateToolButtonStates(tool);
      this.presetManager.updatePresetsForTool(tool);

      // Show persistent point entry HUD for single-point tools; hide otherwise
      const pointHud = document.getElementById('point-entry-hud');
      if (pointHud) {
        const isPointTool = tool === 'gps-point' || tool === 'sketch-point';
        pointHud.style.display = isPointTool ? 'flex' : 'none';
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
  }

  // ============================================================
  // Toolbar wiring
  // ============================================================
  private wireToolbar(): void {
    // Tool buttons — toggle-aware
    document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool as ToolMode;
        const currentTool = this.captureManager.getCurrentTool();

        // Toggle tools: tapping an already-active tool completes/stops it
        // gps-point is two-phase: first click = activate HUD, second click = drop point
        const isToggle = ['sketch-line', 'sketch-polygon', 'gps-line', 'gps-polygon', 'gps-point-stream', 'gps-point'].includes(tool);
        if (isToggle && currentTool === tool) {
          this.completeCurrentCapture(tool);
        } else {
          this.activateTool(tool);
        }
      });
    });

    // Zoom controls
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.mapManager.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.mapManager.zoomOut());

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

    const basemapPanel = document.getElementById('basemap-panel')!;
    document.getElementById('btn-basemap')?.addEventListener('click', async () => {
      const open = basemapPanel.style.display !== 'none';
      if (open) {
        basemapPanel.style.display = 'none';
      } else {
        basemapPanel.style.display = 'block';
        const [imported, online] = await Promise.all([
          this.storage.getAllImportedLayers(),
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

        // Persist visibility/opacity changes for user layers and PDF layers
        const onLayerStateChange = (id: string, updates: { visible?: boolean; opacity?: number }) => {
          const il = imported.find(l => l.id === id);
          if (il) {
            if (updates.visible !== undefined) il.visible = updates.visible;
            if (updates.opacity !== undefined) il.opacity = updates.opacity;
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
        }, userLayers, pdfLayers, onDeletePDF, onDeleteUserLayer, onLayerStateChange);
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

    document.getElementById('btn-import')?.addEventListener('click', () => {
      this.closeAllPanels();
      this.importDataPanel.toggle();
    });

    document.getElementById('btn-export')?.addEventListener('click', () => {
      this.closeAllPanels();
      this.exportPanel.toggle();
    });

    document.getElementById('btn-console')?.addEventListener('click', () => {
      this.logConsole.toggle();
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

    if (tool === 'gps-point') {
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
      this.captureManager.completeSketch();
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
      const tool = this.captureManager.getCurrentTool();

      if (tool === 'edit-geometry') return; // GeometryEditor handles its own clicks

      if (tool === 'sketch-point') {
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
  }

  private updateButtonState(btnId: string, active: boolean): void {
    const btn = document.getElementById(btnId);
    if (btn) btn.dataset.active = String(active);
    btn?.classList.toggle('active', active);
  }

  private closeAllPanels(): void {
    document.querySelectorAll('.side-panel.open').forEach(p => {
      (p as HTMLElement).classList.remove('open');
      setTimeout(() => { (p as HTMLElement).style.display = 'none'; }, 300);
    });
  }
}

// WakeLock types extension
interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
}
