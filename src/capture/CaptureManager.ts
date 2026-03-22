import { v4 as uuidv4 } from 'uuid';
import type { FieldFeature, CaptureSession, ToolMode, GeometryType, GeoJSONGeometry, GPSState, AppSettings } from '../types';
import { haversineDistance } from '../utils/coordinates';
import { EventBus } from '../utils/EventBus';
import { StorageManager } from '../storage/StorageManager';
import type { MapManager } from '../map/MapManager';

export class CaptureManager {
  private session: CaptureSession | null = null;
  private gpsWatchId: number | null = null;
  private gpsState: GPSState = {
    lat: 0, lon: 0, elevation: null, accuracy: null,
    heading: null, speed: null, timestamp: 0, available: false
  };
  private settings!: AppSettings;
  private storage = StorageManager.getInstance();
  private sketchVertices: Array<[number, number]> = [];
  private currentTool: ToolMode = 'gps-point';
  /** True when a streaming tool is selected but streaming has not yet started */
  private captureSetupMode = false;

  constructor(private mapManager: MapManager) {}

  setSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  getCurrentTool(): ToolMode { return this.currentTool; }

  setTool(tool: ToolMode): void {
    // Cancel any active session/sketch when switching to a DIFFERENT tool
    if (tool !== this.currentTool) {
      if (this.session?.active) this.stopCapture(false);
      if (this.sketchVertices.length > 0) this.clearSketch();
    }
    this.currentTool = tool;
    EventBus.emit('tool-changed', { tool });
    this.mapManager.getMap().getCanvas().style.cursor =
      tool === 'select' || tool === 'edit-attrs' ? 'default' :
      tool === 'delete' ? 'crosshair' :
      tool === 'edit-geometry' ? 'crosshair' :
      ['sketch-point','sketch-line','sketch-polygon'].includes(tool) ? 'crosshair' :
      'default';
  }

  // ============================================================
  // GPS Location Watching
  // ============================================================
  startGPSWatch(): void {
    if (!navigator.geolocation) {
      EventBus.emit('toast', { message: 'Geolocation not available', type: 'error' });
      return;
    }
    if (this.gpsWatchId !== null) return;
    this.gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => this.onGPSUpdate(pos),
      (err) => this.onGPSError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  stopGPSWatch(): void {
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    this.gpsState.available = false;
    EventBus.emit('gps-update', this.gpsState);
  }

  getGPSState(): GPSState { return { ...this.gpsState }; }

  private onGPSUpdate(pos: GeolocationPosition): void {
    this.gpsState = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      elevation: pos.coords.altitude,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: pos.timestamp,
      available: true
    };
    EventBus.emit('gps-update', { ...this.gpsState });
    this.mapManager.updateUserLocation(this.gpsState.lat, this.gpsState.lon, this.gpsState.accuracy);

    if (this.session?.active && !this.session.paused && this.isGPSTool()) {
      this.handleGPSStream();
    }

    if (this.settings?.follow_user) {
      this.mapManager.flyTo(this.gpsState.lat, this.gpsState.lon);
    }
  }

  private onGPSError(err: GeolocationPositionError): void {
    this.gpsState.available = false;
    EventBus.emit('gps-update', this.gpsState);
    EventBus.emit('toast', { message: `GPS error: ${err.message}`, type: 'warning' });
  }

  private isGPSTool(): boolean {
    return ['gps-point', 'gps-point-stream', 'gps-line', 'gps-polygon'].includes(this.currentTool);
  }

  // ============================================================
  // GPS Capture — two-phase: setup then start
  // ============================================================

  /** Show the capture HUD in setup state without starting a session. */
  setupForStreaming(tool: ToolMode): void {
    this.captureSetupMode = true;
    this.updateCaptureUI();
  }

  /** Cancel setup mode without starting. */
  cancelSetup(): void {
    this.captureSetupMode = false;
    this.updateCaptureUI();
  }

  /** Returns true if the HUD is in setup state (tool selected, not yet streaming). */
  isInSetupMode(): boolean { return this.captureSetupMode && !this.session; }

  startGPSCapture(typePreset: string, description = ''): void {
    if (!this.gpsState.available) {
      EventBus.emit('toast', { message: 'Waiting for GPS fix...', type: 'warning' });
    }

    const geomType: GeometryType =
      this.currentTool === 'gps-line' ? 'LineString' :
      this.currentTool === 'gps-polygon' ? 'Polygon' : 'Point';

    this.captureSetupMode = false;
    this.session = {
      id: uuidv4(),
      tool_mode: this.currentTool,
      geometry_type: geomType,
      capture_method: 'gps',
      type: typePreset,
      desc: description,
      coordinates: [],
      start_time: Date.now(),
      last_point_time: 0,
      last_point_coords: null,
      point_count: 0,
      total_distance: 0,
      paused: false,
      active: true
    };

    // GPS single point: capture immediately if GPS available
    if (this.currentTool === 'gps-point' && this.gpsState.available) {
      this.addGPSPoint();
      this.finalizeCapture(typePreset, description);
      return;
    }

    // GPS point stream: show running counter, no modal until stop
    if (this.currentTool === 'gps-point-stream') {
      EventBus.emit('capture-started', { session: this.session });
      this.updateCaptureUI();
      return;
    }

    // GPS line/polygon: start streaming session
    EventBus.emit('capture-started', { session: this.session });
    this.updateCaptureUI();
  }

  private handleGPSStream(): void {
    if (!this.session) return;
    const { lat, lon, accuracy } = this.gpsState;
    if (!this.settings) return;

    if (accuracy !== null && accuracy > this.settings.gps_min_accuracy) return;

    const now = Date.now();
    const timeDelta = (now - this.session.last_point_time) / 1000;
    const coords: [number, number] = [lon, lat];

    let shouldAdd = false;

    if (this.session.point_count === 0) {
      shouldAdd = true;
    } else if (this.session.last_point_coords) {
      const distDelta = haversineDistance(
        this.session.last_point_coords[1], this.session.last_point_coords[0], lat, lon
      );
      const distOk = distDelta >= this.settings.gps_distance_tolerance;
      const timeOk = timeDelta >= this.settings.gps_time_tolerance;
      shouldAdd = distOk || timeOk;
      if (shouldAdd) this.session.total_distance += distDelta;
    }

    if (shouldAdd) {
      const coord: [number, number, number] | [number, number] =
        this.gpsState.elevation !== null
          ? [lon, lat, this.gpsState.elevation]
          : [lon, lat];

      // GPS stream points: save each as individual FieldFeature immediately
      if (this.currentTool === 'gps-point-stream') {
        void this.saveStreamedPoint(coord);
      } else {
        // GPS line/polygon: accumulate for later finalisation
        this.session.coordinates.push(coord);
        this.updateSketchPreview();
      }

      this.session.last_point_coords = coords;
      this.session.last_point_time = now;
      this.session.point_count++;
      this.updateCaptureUI();
    }
  }

  private async saveStreamedPoint(coord: [number, number] | [number, number, number]): Promise<void> {
    if (!this.session) return;
    const [lon, lat] = coord;
    const now = new Date().toISOString();
    const feature: FieldFeature = {
      id: uuidv4(),
      point_id: this.generatePointId(),
      type: this.session.type ?? '',
      desc: this.session.desc ?? '',
      geometry_type: 'Point',
      geometry: { type: 'Point', coordinates: coord as [number, number] },
      capture_method: 'gps',
      created_at: now,
      updated_at: now,
      created_by: this.settings?.user_id ?? 'USER',
      lat,
      lon,
      elevation: this.gpsState.elevation,
      accuracy: this.gpsState.accuracy,
      layer_id: this.settings?.default_layer_id ?? 'default',
      notes: '',
      photos: []
    };
    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
  }

  private addGPSPoint(): void {
    if (!this.session) return;
    const coord: [number, number, number] | [number, number] =
      this.gpsState.elevation !== null
        ? [this.gpsState.lon, this.gpsState.lat, this.gpsState.elevation]
        : [this.gpsState.lon, this.gpsState.lat];
    this.session.coordinates.push(coord);
    this.session.point_count++;
  }

  /** Update type and description on-the-fly (point stream only). */
  updateSessionTypeDesc(type: string, desc: string): void {
    if (this.session && this.session.tool_mode === 'gps-point-stream') {
      this.session.type = type;
      this.session.desc = desc;
    }
  }

  pauseCapture(): void {
    if (this.session) {
      this.session.paused = !this.session.paused;
      EventBus.emit('capture-paused', { paused: this.session.paused });
    }
  }

  stopCapture(save = true): void {
    // Handle case where we are in setup mode but no session started
    if (!this.session) {
      this.captureSetupMode = false;
      this.updateCaptureUI();
      return;
    }
    this.session.active = false;
    this.captureSetupMode = false;

    if (save && this.session.coordinates.length >= 1) {
      this.finalizeCapture(this.session.type, this.session.desc);
    }

    this.session = null;
    this.mapManager.clearSketchPreview();
    EventBus.emit('capture-stopped', {});
    this.updateCaptureUI();
  }

  private async finalizeCapture(typePreset: string, description: string): Promise<void> {
    if (!this.session) return;
    const coords = this.session.coordinates;
    if (coords.length === 0) return;

    let geometry: GeoJSONGeometry;
    if (this.session.geometry_type === 'Point') {
      geometry = { type: 'Point', coordinates: coords[0] as [number, number] };
    } else if (this.session.geometry_type === 'LineString') {
      if (coords.length < 2) return;
      geometry = { type: 'LineString', coordinates: coords as Array<[number, number]> };
    } else {
      if (coords.length < 3) return;
      const ring = [...coords, coords[0]] as Array<[number, number]>;
      geometry = { type: 'Polygon', coordinates: [ring] };
    }

    const now = new Date().toISOString();
    const centerCoord = coords[Math.floor(coords.length / 2)] as [number, number];
    const feature: FieldFeature = {
      id: uuidv4(),
      point_id: this.generatePointId(),
      type: typePreset,
      desc: description,
      geometry_type: this.session.geometry_type,
      geometry,
      capture_method: this.session.capture_method,
      created_at: now,
      updated_at: now,
      created_by: this.settings?.user_id ?? 'USER',
      lat: centerCoord[1],
      lon: centerCoord[0],
      elevation: this.gpsState.elevation,
      accuracy: this.gpsState.accuracy,
      layer_id: this.settings?.default_layer_id ?? 'default',
      notes: '',
      photos: []
    };

    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
  }

  private generatePointId(): string {
    const userId = this.settings?.user_id ?? 'USER';
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    return `${userId}_${y}_${mo}_${d}_${h}${mi}`;
  }

  // ============================================================
  // Sketch Capture
  // ============================================================
  /** Capture a sketch point immediately using pre-supplied type/desc (no modal). */
  async saveSketchPointDirect(lng: number, lat: number, type: string, desc: string): Promise<void> {
    this.sketchVertices = [[lng, lat]];
    await this.saveSketchFeature('Point', type, desc);
  }

  handleSketchClick(lng: number, lat: number): void {
    const tool = this.currentTool;
    if (!['sketch-line', 'sketch-polygon'].includes(tool)) return;

    this.sketchVertices.push([lng, lat]);
    this.updateSketchPreviewFromVertices();
  }

  /** Called when user taps the active sketch-line/polygon button to complete it. */
  completeSketch(): void {
    const tool = this.currentTool;
    if (tool === 'sketch-line') {
      if (this.sketchVertices.length >= 2) {
        this.promptFeatureAttributes('LineString', 'sketch');
      } else {
        EventBus.emit('toast', { message: 'Add at least 2 vertices first', type: 'warning' });
      }
    } else if (tool === 'sketch-polygon') {
      if (this.sketchVertices.length >= 3) {
        this.promptFeatureAttributes('Polygon', 'sketch');
      } else {
        EventBus.emit('toast', { message: 'Add at least 3 vertices first', type: 'warning' });
      }
    }
  }

  handleSketchMouseMove(lng: number, lat: number): void {
    const tool = this.currentTool;
    if (!['sketch-line', 'sketch-polygon'].includes(tool)) return;
    if (this.sketchVertices.length === 0) return;
    const preview: Array<[number, number]> = [...this.sketchVertices, [lng, lat]];
    this.updateSketchPreviewFromVertices(preview);
  }

  private updateSketchPreviewFromVertices(vertices?: Array<[number, number]>): void {
    const verts = vertices ?? this.sketchVertices;
    if (verts.length === 0) { this.mapManager.clearSketchPreview(); return; }

    const features: object[] = [];

    if (verts.length === 1) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: verts[0] }, properties: {} });
    } else {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: verts }, properties: {} });
      if (this.currentTool === 'sketch-polygon' && verts.length >= 3) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...verts, verts[0]]] },
          properties: {}
        });
      }
    }

    verts.forEach(v => {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: v }, properties: {} });
    });

    this.mapManager.updateSketchPreview(features);
  }

  private updateSketchPreview(): void {
    if (!this.session) return;
    const coords = this.session.coordinates;
    const features: object[] = [];

    if (coords.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
    }
    if (this.session.geometry_type === 'Polygon' && coords.length >= 3) {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }, properties: {} });
    }
    coords.forEach(c => {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} });
    });

    this.mapManager.updateSketchPreview(features);
  }

  private clearSketch(): void {
    this.sketchVertices = [];
    this.mapManager.clearSketchPreview();
  }

  undoLastVertex(): void {
    if (this.sketchVertices.length > 0) {
      this.sketchVertices.pop();
      this.updateSketchPreviewFromVertices();
    }
  }

  hasSketchVertices(): boolean {
    return this.sketchVertices.length > 0;
  }

  // ============================================================
  // Attribute prompt + save
  // ============================================================
  private promptFeatureAttributes(geomType: GeometryType, method: 'gps' | 'sketch'): void {
    EventBus.emit('prompt-feature-attrs', {
      geometryType: geomType,
      captureMethod: method,
      onSave: (typePreset: string, description: string) => {
        if (method === 'sketch') {
          this.saveSketchFeature(geomType, typePreset, description);
        }
      },
      onCancel: () => {
        this.clearSketch();
      }
    });
  }

  async saveSketchFeature(geomType: GeometryType, typePreset: string, description: string): Promise<void> {
    const vertices = [...this.sketchVertices];
    this.clearSketch();

    let geometry: GeoJSONGeometry;
    if (geomType === 'Point') {
      geometry = { type: 'Point', coordinates: vertices[0] as [number, number] };
    } else if (geomType === 'LineString') {
      geometry = { type: 'LineString', coordinates: vertices as Array<[number, number]> };
    } else {
      geometry = { type: 'Polygon', coordinates: [[...vertices, vertices[0]] as Array<[number, number]>] };
    }

    const now = new Date().toISOString();
    const feature: FieldFeature = {
      id: uuidv4(),
      point_id: this.generatePointId(),
      type: typePreset,
      desc: description,
      geometry_type: geomType,
      geometry,
      capture_method: 'sketch',
      created_at: now,
      updated_at: now,
      created_by: this.settings?.user_id ?? 'USER',
      lat: geomType === 'Point' ? vertices[0][1] : null,
      lon: geomType === 'Point' ? vertices[0][0] : null,
      elevation: null,
      accuracy: null,
      layer_id: this.settings?.default_layer_id ?? 'default',
      notes: '',
      photos: []
    };

    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
  }

  // ============================================================
  // Quick Entry (point at GPS location)
  // ============================================================
  async quickEntry(typePreset: string, description = ''): Promise<void> {
    if (!this.gpsState.available) {
      EventBus.emit('toast', { message: 'No GPS fix available', type: 'warning' });
      return;
    }

    const now = new Date().toISOString();
    const feature: FieldFeature = {
      id: uuidv4(),
      point_id: this.generatePointId(),
      type: typePreset,
      desc: description,
      geometry_type: 'Point',
      geometry: {
        type: 'Point',
        coordinates: [this.gpsState.lon, this.gpsState.lat,
          ...(this.gpsState.elevation !== null ? [this.gpsState.elevation] : [])] as [number, number]
      },
      capture_method: 'gps',
      created_at: now,
      updated_at: now,
      created_by: this.settings?.user_id ?? 'USER',
      lat: this.gpsState.lat,
      lon: this.gpsState.lon,
      elevation: this.gpsState.elevation,
      accuracy: this.gpsState.accuracy,
      layer_id: this.settings?.default_layer_id ?? 'default',
      notes: '',
      photos: []
    };

    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
    EventBus.emit('toast', {
      message: `Quick entry saved: ${typePreset || 'Point'} (±${Math.round(this.gpsState.accuracy ?? 0)}m)`,
      type: 'success'
    });
  }

  // ============================================================
  // Feature selection / deletion
  // ============================================================
  async handleSelectOrDelete(lng: number, lat: number, isDelete: boolean): Promise<void> {
    const map = this.mapManager.getMap();
    const point = map.project([lng, lat]);
    const features = this.mapManager.queryFeaturesAtPoint(point);

    if (features.length === 0) {
      EventBus.emit('feature-deselected', {});
      this.mapManager.highlightFeature(null);
      return;
    }

    const featureId = features[0].properties?.id as string;
    if (!featureId) return;

    const feature = await this.storage.getFeature(featureId);
    if (!feature) return;

    if (isDelete) {
      if (confirm(`Delete ${feature.point_id} (${feature.type})?`)) {
        await this.storage.deleteFeature(featureId);
        EventBus.emit('feature-deleted', { id: featureId });
        this.mapManager.highlightFeature(null);
      }
    } else {
      EventBus.emit('feature-selected', { feature });
      this.mapManager.highlightFeature(feature);
    }
  }

  private updateCaptureUI(): void {
    const container = document.getElementById('capture-controls');
    const startBtn  = document.getElementById('btn-capture-start')  as HTMLButtonElement | null;
    const pauseBtn  = document.getElementById('btn-capture-pause')  as HTMLButtonElement | null;
    const stopBtn   = document.getElementById('btn-capture-stop')   as HTMLButtonElement | null;
    const captureType = document.getElementById('capture-type')     as HTMLSelectElement | null;
    const captureDesc = document.getElementById('capture-desc')     as HTMLInputElement  | null;
    const statsEl   = document.getElementById('capture-stats');
    const pointsEl  = document.getElementById('capture-points');
    const distEl    = document.getElementById('capture-distance');

    // Nothing active and not in setup — hide
    if (!this.session?.active && !this.captureSetupMode) {
      if (container) container.style.display = 'none';
      return;
    }

    if (container) container.style.display = 'flex';

    const isStreaming = this.session?.active === true;
    const isPaused    = isStreaming && this.session!.paused;
    const isPointStream = this.currentTool === 'gps-point-stream';

    // ---- Button enable/disable ----
    if (startBtn) {
      // Enabled: setup mode, or paused; disabled during active streaming
      startBtn.disabled = isStreaming && !isPaused;
    }
    if (pauseBtn) {
      // Enabled only during active (non-paused) streaming
      pauseBtn.disabled = !isStreaming || isPaused;
    }
    if (stopBtn) {
      // Enabled once a session exists or in setup (cancel)
      stopBtn.disabled = false;
    }

    // ---- Meta fields locked/unlocked ----
    // Points: always editable. Line/polygon: locked once streaming starts
    const metaLocked = isStreaming && !isPaused && !isPointStream;
    if (captureType) captureType.disabled = metaLocked;
    if (captureDesc) captureDesc.disabled = metaLocked;

    // ---- Start button needs a type selected ----
    if (startBtn && !isStreaming) {
      const typeVal = captureType?.value ?? '';
      startBtn.disabled = !typeVal;
    }

    // ---- Stats ----
    if (statsEl) statsEl.style.display = isStreaming ? '' : 'none';

    if (isStreaming && pointsEl) {
      pointsEl.textContent = `${this.session!.point_count} pts`;
    }
    if (isStreaming && distEl) {
      if (isPointStream) {
        distEl.textContent = 'streaming';
      } else {
        const d = this.session!.total_distance;
        distEl.textContent = d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
      }
    }
  }

  getActiveSession(): CaptureSession | null { return this.session; }
}
