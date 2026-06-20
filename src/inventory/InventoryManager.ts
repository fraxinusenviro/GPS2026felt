/**
 * Orchestrates the Inventory module: timed biodiversity surveys whose
 * observations become point FieldFeatures in the per-project
 * `{projectId}-inventory` layer (species + survey context in `inventory_data`).
 *
 * Mirrors WetlandsManager. Draft (in-progress) surveys live device-local in the
 * `inventory_surveys` IndexedDB store and are NOT synced; submitted surveys are
 * reconstructed by grouping inventory features on `inventory_data.surveyId`, so
 * they sync automatically through the existing features pipeline.
 */
import type { AppSettings, FieldFeature, InventorySurvey, InventoryObservation, SpeciesRecord, Project } from '../types';
import { StorageManager } from '../storage/StorageManager';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from '../capture/CaptureManager';
import { EventBus } from '../utils/EventBus';
import { InventoryHUD } from './InventoryHUD';
import { InventorySpeciesSearch } from './InventorySpeciesSearch';
import { InventorySurveyForm, type SurveyMeta } from './InventorySurveyForm';
import { exportCSV, exportGeoJSON, exportMarkdown, exportHTML, exportPDF } from './InventoryExport';
import {
  defaultSurvey, isSoCI, getElapsed, realObservations, uniqueSpeciesCount,
  INVENTORY_POINT_COLOR, downloadText, escapeHtml, dateStamp, loadInvertebratesDB,
} from './inventorySurvey';

interface MapLngLat { lngLat: { lng: number; lat: number } }

export class InventoryManager {
  private storage = StorageManager.getInstance();
  private active: InventorySurvey | null = null;
  private hud: InventoryHUD;
  private speciesSearch: InventorySpeciesSearch;
  private form = new InventorySurveyForm();

  // map-face Add Obs button state
  private tapMode = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private addObsBound = false;
  private tapHandler: ((e: MapLngLat) => void) | null = null;

  constructor(
    private mapManager: MapManager,
    private captureManager: CaptureManager,
    private getSettings: () => AppSettings,
    private refreshProjectLayers: () => Promise<void>,
  ) {
    this.speciesSearch = new InventorySpeciesSearch(getSettings);
    this.hud = new InventoryHUD({
      onAddObs: () => void this.addObservationAtCurrentLocation(),
      onTogglePause: () => this.togglePause(),
      onSaveDraft: () => void this.saveDraft(),
      onSubmit: () => void this.submitSurvey(),
      onDeleteObs: (id) => void this.deleteObservation(id),
      onUpdateNotes: (id, notes) => void this.updateNotes(id, notes),
      onZoomObs: (id) => this.zoomToObservation(id),
    });

    EventBus.on('feature-added', () => void this.renderLegend());
    EventBus.on('feature-updated', () => void this.renderLegend());
    EventBus.on('feature-deleted', () => void this.renderLegend());

    // If the invertebrate DB was left enabled, load it now (only the three
    // smaller DBs are injected eagerly by index.html).
    if (getSettings().inventory_db_invertebrates && !window.DB_INVERTEBRATES) {
      void loadInvertebratesDB(import.meta.env.BASE_URL);
    }
  }

  private activeProjectId(): string { return this.getSettings().active_project_id || 'default'; }
  private inventoryLayerId(projectId = this.activeProjectId()): string { return `${projectId}-inventory`; }

  private isInventoryObs(f: FieldFeature): boolean {
    return f.layer_id.endsWith('-inventory') || !!f.inventory_data;
  }

  /** Ensure the active project has its `{projectId}-inventory` LayerPreset. */
  async ensureInventoryLayer(projectId: string): Promise<string> {
    const layerId = this.inventoryLayerId(projectId);
    if (!(await this.storage.getLayerPreset(layerId))) {
      await this.storage.saveLayerPreset({
        id: layerId, name: 'Inventory Observations', geometry_type: 'Point',
        color: INVENTORY_POINT_COLOR, stroke_color: '#ffffff', stroke_width: 2, fill_opacity: 0.9,
        types: [], project_id: projectId, visible: true,
      });
      await this.refreshProjectLayers();
    }
    return layerId;
  }

  private generatePointId(surveyor: string, obsId: string): string {
    const who = (surveyor || this.getSettings().user_id || 'USER').replace(/\s+/g, '');
    return `${who}_INV_${obsId.slice(0, 8)}`;
  }

  // ── Survey lifecycle ──────────────────────────────────────────────
  startNewSurvey(): void {
    if (this.active) {
      EventBus.emit('toast', { message: 'A survey is already in progress — save or submit it first', type: 'warning' });
      this.hud.show(this.active);
      return;
    }
    this.form.open((meta: SurveyMeta) => void this.beginSurvey(meta));
  }

  private async beginSurvey(meta: SurveyMeta): Promise<void> {
    this.active = defaultSurvey(this.activeProjectId(), meta);
    await this.storage.saveInventorySurvey(this.active);
    this.hud.show(this.active);
    this.showAddObsButton();
    EventBus.emit('toast', { message: 'Survey started — timer running', type: 'success', duration: 1800 });
  }

  async resumeDraft(id: string): Promise<void> {
    const draft = await this.storage.getInventorySurvey(id);
    if (!draft) { EventBus.emit('toast', { message: 'Draft not found', type: 'error' }); return; }
    this.active = draft;
    this.hud.show(draft);
    this.hud.setPauseLabel(!!draft.pausedAt);
    this.showAddObsButton();
  }

  // ── Observations ──────────────────────────────────────────────────
  async addObservationAtCurrentLocation(): Promise<void> {
    if (!this.active) return;
    const gps = this.captureManager.getGPSState();
    if (gps.available) {
      await this.addObservationAtCoords(gps.lon, gps.lat);
    } else {
      const c = this.mapManager.getMap().getCenter();
      EventBus.emit('toast', { message: 'No GPS fix — using map centre', type: 'info', duration: 1800 });
      await this.addObservationAtCoords(c.lng, c.lat);
    }
  }

  async addObservationAtCoords(lng: number, lat: number): Promise<void> {
    if (!this.active) return;
    this.speciesSearch.open((sp: SpeciesRecord) => void this.recordObservation(sp, lng, lat));
  }

  private async recordObservation(sp: SpeciesRecord, lng: number, lat: number): Promise<void> {
    if (!this.active) return;
    const obs: InventoryObservation = {
      id: crypto.randomUUID(), species: sp, timestamp: Date.now(),
      lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lng.toFixed(6)), notes: '',
    };
    this.active.observations.push(obs);
    await this.storage.saveInventorySurvey(this.active);
    this.hud.setSurvey(this.active);
    this.hud.update();
    EventBus.emit('toast', { message: `Added: ${sp.commonName || sp.mcode || sp.taxon}`, type: 'success', duration: 1400 });
  }

  private async deleteObservation(obsId: string): Promise<void> {
    if (!this.active) return;
    this.active.observations = this.active.observations.filter(o => o.id !== obsId);
    await this.storage.saveInventorySurvey(this.active);
    this.hud.setSurvey(this.active);
    this.hud.update();
  }

  private async updateNotes(obsId: string, notes: string): Promise<void> {
    if (!this.active) return;
    const o = this.active.observations.find(x => x.id === obsId);
    if (!o) return;
    o.notes = notes;
    await this.storage.saveInventorySurvey(this.active);
  }

  private zoomToObservation(obsId: string): void {
    const o = this.active?.observations.find(x => x.id === obsId);
    if (o) this.mapManager.flyTo(o.lat, o.lon, 17);
  }

  togglePause(): void {
    if (!this.active) return;
    if (!this.active.pausedAt) {
      this.active.pausedAt = Date.now();
      this.hud.setPauseLabel(true);
    } else {
      this.active.pausedDuration = (this.active.pausedDuration || 0) + (Date.now() - this.active.pausedAt);
      this.active.pausedAt = null;
      this.hud.setPauseLabel(false);
    }
    void this.storage.saveInventorySurvey(this.active);
  }

  async saveDraft(): Promise<void> {
    if (!this.active) return;
    this.active.status = 'draft';
    await this.storage.saveInventorySurvey(this.active);
    this.hud.hide();
    this.hideAddObsButton();
    this.active = null;
    EventBus.emit('toast', { message: 'Draft saved', type: 'success', duration: 1800 });
  }

  async submitSurvey(): Promise<void> {
    if (!this.active) return;
    const survey = this.active;
    const real = realObservations(survey);
    if (!real.length) {
      EventBus.emit('toast', { message: 'No observations to submit', type: 'warning' });
      return;
    }
    if (!confirm(`Submit "${survey.siteName || survey.surveyID || 'survey'}" with ${real.length} observation(s)? Observations become map features.`)) return;

    survey.status = 'submitted';
    survey.endTime = Date.now();
    const projectId = survey.project_id || this.activeProjectId();
    const layerId = await this.ensureInventoryLayer(projectId);

    for (const o of real) {
      const iso = new Date(o.timestamp).toISOString();
      const feature: FieldFeature = {
        id: crypto.randomUUID(),
        point_id: this.generatePointId(survey.surveyor, o.id),
        type: o.species.taxon, desc: o.species.commonName || o.species.mcode || '',
        geometry_type: 'Point', geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
        capture_method: 'gps', lat: o.lat, lon: o.lon, elevation: null, accuracy: null,
        layer_id: layerId, project_id: projectId,
        notes: o.notes, photos: [],
        created_at: iso, updated_at: iso,
        created_by: survey.surveyor || this.getSettings().user_id || 'USER',
        inventory_data: {
          surveyId: survey.id, surveyID: survey.surveyID, siteName: survey.siteName,
          surveyor: survey.surveyor, locale: survey.locale, county: survey.county, date: survey.date,
          startTime: survey.startTime, endTime: survey.endTime,
          elcode: o.species.elcode, mcode: o.species.mcode, taxon: o.species.taxon,
          taxonGroup: o.species.taxonGroup, family: o.species.family,
          commonName: o.species.commonName, scientificName: o.species.scientificName,
          srank: o.species.srank, sprot: o.species.sprot ?? null, nprot: o.species.nprot ?? null,
          grank: o.species.grank ?? '', isSoCI: isSoCI(o.species), obsTimestamp: o.timestamp,
        },
      };
      await this.storage.saveFeature(feature);
      EventBus.emit('feature-added', { feature });
    }

    await this.storage.deleteInventorySurvey(survey.id);
    this.hud.hide();
    this.hideAddObsButton();
    this.active = null;
    await this.refreshProjectLayers();
    void this.renderLegend();
    EventBus.emit('toast', { message: `Survey submitted — ${real.length} observation(s) added to map`, type: 'success', duration: 2400 });
  }

  // ── Drafts list ───────────────────────────────────────────────────
  async openDrafts(): Promise<void> {
    const drafts = (await this.storage.getAllInventorySurveys())
      .filter(s => s.status === 'draft')
      .sort((a, b) => b.startTime - a.startTime);
    if (!drafts.length) {
      EventBus.emit('toast', { message: 'No draft surveys', type: 'info' });
      return;
    }
    const rows = drafts.map(d => {
      const obsN = realObservations(d).length;
      const elapsed = Math.round(getElapsed(d) / 60000);
      return `<div class="inv-list-row">
        <div class="inv-list-info">
          <strong>${escapeHtml(d.siteName || d.surveyID || 'Untitled')}</strong>
          <span class="inv-list-meta">${escapeHtml(d.date)} · ${obsN} obs · ${elapsed} min${d.pausedAt ? ' · paused' : ''}</span>
        </div>
        <div class="inv-list-actions">
          <button class="btn-sm inv-list-act" data-act="resume" data-id="${d.id}">Resume</button>
          <button class="btn-sm btn-danger inv-list-act" data-act="delete" data-id="${d.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
    EventBus.emit('show-modal', {
      title: `Draft Surveys (${drafts.length})`,
      html: `<div class="inv-list">${rows}</div>`,
      confirmLabel: 'Close',
    });
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLButtonElement>('.inv-list-act').forEach(btn => {
        btn.addEventListener('click', () => void this.handleDraftAction(btn.dataset.act!, btn.dataset.id!));
      });
    });
  }

  private async handleDraftAction(act: string, id: string): Promise<void> {
    if (act === 'resume') {
      (document.getElementById('modal-close') as HTMLButtonElement | null)?.click();
      await this.resumeDraft(id);
    } else if (act === 'delete') {
      if (!confirm('Delete this draft survey? This cannot be undone.')) return;
      await this.storage.deleteInventorySurvey(id);
      EventBus.emit('toast', { message: 'Draft deleted', type: 'warning', duration: 1600 });
      void this.openDrafts();
    }
  }

  // ── Submitted list (reconstructed from features) ──────────────────
  async getAllObservations(): Promise<FieldFeature[]> {
    const all = await this.storage.getAllFeatures();
    return all.filter(f => this.isInventoryObs(f));
  }

  /** Group inventory features back into submitted surveys, newest first. */
  private async reconstructSubmitted(): Promise<InventorySurvey[]> {
    const feats = await this.getAllObservations();
    const map = new Map<string, InventorySurvey>();
    for (const f of feats) {
      const d = f.inventory_data;
      if (!d) continue;
      let s = map.get(d.surveyId);
      if (!s) {
        s = {
          id: d.surveyId, surveyID: d.surveyID, siteName: d.siteName, surveyor: d.surveyor,
          locale: d.locale, county: d.county, date: d.date, reportNote: '',
          startTime: d.startTime, endTime: d.endTime, pausedAt: null, pausedDuration: 0,
          status: 'submitted', project_id: f.project_id, observations: [],
        };
        map.set(d.surveyId, s);
      }
      s.observations.push({
        id: f.id,
        species: {
          elcode: d.elcode, taxon: d.taxon, taxonGroup: d.taxonGroup, family: d.family, mcode: d.mcode,
          commonName: d.commonName, scientificName: d.scientificName, srank: d.srank,
          grank: d.grank, sprot: d.sprot, nprot: d.nprot,
        },
        timestamp: d.obsTimestamp, lat: f.lat ?? 0, lon: f.lon ?? 0, notes: f.notes || '',
      });
    }
    return [...map.values()].sort((a, b) => b.startTime - a.startTime);
  }

  async openSubmitted(): Promise<void> {
    const surveys = await this.reconstructSubmitted();
    if (!surveys.length) {
      EventBus.emit('toast', { message: 'No submitted surveys yet', type: 'info' });
      return;
    }
    const rows = surveys.map(s => {
      const obsN = realObservations(s).length;
      const uniq = uniqueSpeciesCount(realObservations(s));
      return `<div class="inv-sub-row" data-id="${s.id}">
        <div class="inv-list-info">
          <strong>${escapeHtml(s.siteName || s.surveyID || 'Untitled')}</strong>
          <span class="inv-list-meta">${escapeHtml(s.date)} · ${escapeHtml(s.surveyor)} · ${obsN} obs · ${uniq} spp</span>
        </div>
        <div class="inv-sub-actions">
          <button class="btn-sm inv-sub-act" data-act="zoom" data-id="${s.id}">Zoom</button>
          <select class="inv-sub-export" data-id="${s.id}" aria-label="Export">
            <option value="">Export…</option>
            <option value="pdf">PDF report</option>
            <option value="csv">CSV log</option>
            <option value="geojson">GeoJSON</option>
            <option value="md">Markdown</option>
            <option value="html">HTML report</option>
          </select>
          <button class="btn-sm btn-danger inv-sub-act" data-act="delete" data-id="${s.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
    EventBus.emit('show-modal', {
      title: `Submitted Surveys (${surveys.length})`,
      html: `<div class="inv-list-toolbar"><button class="btn-outline btn-sm" id="inv-export-master">Export Master GeoJSON</button></div>
             <div class="inv-list">${rows}</div>`,
      confirmLabel: 'Close',
    });
    requestAnimationFrame(() => {
      document.getElementById('inv-export-master')?.addEventListener('click', () => void this.exportMaster());
      document.querySelectorAll<HTMLButtonElement>('.inv-sub-act').forEach(btn => {
        btn.addEventListener('click', () => void this.handleSubmittedAction(btn.dataset.act!, btn.dataset.id!, surveys));
      });
      document.querySelectorAll<HTMLSelectElement>('.inv-sub-export').forEach(sel => {
        sel.addEventListener('change', () => {
          const fmt = sel.value; sel.value = '';
          if (fmt) void this.exportSurvey(sel.dataset.id!, fmt, surveys);
        });
      });
    });
  }

  private async handleSubmittedAction(act: string, id: string, surveys: InventorySurvey[]): Promise<void> {
    const survey = surveys.find(s => s.id === id);
    if (!survey) return;
    if (act === 'zoom') {
      const o = survey.observations[0];
      (document.getElementById('modal-close') as HTMLButtonElement | null)?.click();
      if (o) this.mapManager.flyTo(o.lat, o.lon, 15);
    } else if (act === 'delete') {
      if (!confirm(`Delete submitted survey "${survey.siteName || survey.surveyID}" and its ${survey.observations.length} map feature(s)? This cannot be undone.`)) return;
      for (const o of survey.observations) {
        await this.storage.deleteFeature(o.id);
        EventBus.emit('feature-deleted', { id: o.id });
      }
      await this.refreshProjectLayers();
      void this.renderLegend();
      EventBus.emit('toast', { message: 'Survey deleted', type: 'warning', duration: 1800 });
      void this.openSubmitted();
    }
  }

  private async exportSurvey(id: string, fmt: string, surveys: InventorySurvey[]): Promise<void> {
    const survey = surveys.find(s => s.id === id);
    if (!survey) return;
    const settings = this.getSettings();
    try {
      if (fmt === 'csv') exportCSV(survey);
      else if (fmt === 'geojson') exportGeoJSON(survey);
      else if (fmt === 'md') exportMarkdown(survey, settings);
      else if (fmt === 'html') exportHTML(survey, settings);
      else if (fmt === 'pdf') { EventBus.emit('toast', { message: 'Generating PDF…', type: 'info', duration: 1500 }); await exportPDF(survey, settings); }
    } catch (err) {
      console.error('[inventory] export failed:', err);
      EventBus.emit('toast', { message: 'Export failed in this browser', type: 'error' });
    }
  }

  /** Export every inventory observation (all projects) as one master GeoJSON. */
  private async exportMaster(): Promise<void> {
    const feats = await this.getAllObservations();
    const projects = await this.storage.getAllProjects();
    const names = new Map<string, string>(projects.map((p: Project) => [p.id, p.name]));
    const features = feats.filter(f => f.geometry).map(f => {
      const d = f.inventory_data;
      const props: Record<string, unknown> = {
        Project: names.get(f.project_id) ?? f.project_id, project_id: f.project_id, point_id: f.point_id,
        ...(d ? { ...d } : {}),
      };
      return { type: 'Feature', geometry: f.geometry, properties: props };
    });
    const fc = { type: 'FeatureCollection', features };
    downloadText(JSON.stringify(fc, null, 2), `Inventory_Master_${dateStamp()}.geojson`, 'application/geo+json');
    EventBus.emit('toast', { message: `Master export: ${features.length} observation(s)`, type: 'success', duration: 2000 });
  }

  // ── Legend (own container — does not clobber wetlands) ────────────
  async renderLegend(): Promise<void> {
    const root = document.getElementById('inventory-data-legend');
    if (!root) return;
    const projectId = this.activeProjectId();
    const layer = await this.storage.getLayerPreset(this.inventoryLayerId(projectId));
    const obs = await this.storage.getFeaturesByLayer(this.inventoryLayerId(projectId));
    if (!layer || obs.length === 0) { root.innerHTML = ''; return; }
    const soci = obs.filter(o => o.inventory_data?.isSoCI).length;
    const visible = layer.visible !== false;
    root.innerHTML = `
      <div class="ud-item">
        <div class="ud-head">
          <button class="ud-vis ${visible ? 'active' : ''}" id="ud-inventory-vis" title="Toggle Inventory Observations">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <span class="ud-name">Inventory Observations</span>
          <span class="ud-count">${obs.length}</span>
        </div>
        <div class="ud-legend">
          <div class="ud-legend-row"><span class="ud-swatch" style="background:${INVENTORY_POINT_COLOR}"></span>Observations (${obs.length})</div>
          ${soci ? `<div class="ud-legend-row"><span class="ud-swatch" style="background:#dc2626"></span>SoCI (${soci})</div>` : ''}
        </div>
      </div>`;
    document.getElementById('ud-inventory-vis')?.addEventListener('click', () => void this.toggleVisibility());
  }

  private async toggleVisibility(): Promise<void> {
    const layer = await this.storage.getLayerPreset(this.inventoryLayerId());
    if (!layer) return;
    layer.visible = layer.visible === false;
    await this.storage.saveLayerPreset(layer);
    await this.refreshProjectLayers();
    await this.renderLegend();
  }

  // ── Map-face "Add Obs" button ─────────────────────────────────────
  private showAddObsButton(): void {
    const btn = document.getElementById('inv-add-obs-btn');
    if (!btn) return;
    btn.style.display = 'flex';
    this.bindAddObsButton(btn);
  }

  private hideAddObsButton(): void {
    const btn = document.getElementById('inv-add-obs-btn');
    if (btn) btn.style.display = 'none';
    this.cancelTapMode();
  }

  private bindAddObsButton(btn: HTMLElement): void {
    if (this.addObsBound) return;
    this.addObsBound = true;
    const startLP = () => { this.longPressTimer = setTimeout(() => this.setTapMode(true), 650); };
    const cancelLP = () => { if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; } };
    btn.addEventListener('mousedown', startLP);
    btn.addEventListener('touchstart', startLP, { passive: true });
    btn.addEventListener('mouseup', cancelLP);
    btn.addEventListener('mouseleave', cancelLP);
    btn.addEventListener('touchend', cancelLP);
    btn.addEventListener('touchmove', cancelLP, { passive: true });
    btn.addEventListener('click', () => {
      if (this.tapMode) return; // tap-mode placement is handled via the map-click listener
      void this.addObservationAtCurrentLocation();
    });
  }

  private setTapMode(enabled: boolean): void {
    this.tapMode = enabled;
    document.getElementById('inv-add-obs-btn')?.classList.toggle('tap-mode', enabled);
    if (enabled) {
      EventBus.emit('toast', { message: 'Tap the map to place the observation', type: 'info', duration: 2000 });
      this.tapHandler = (e: MapLngLat) => {
        this.cancelTapMode();
        if (this.active) void this.addObservationAtCoords(e.lngLat.lng, e.lngLat.lat);
      };
      EventBus.on<MapLngLat>('map-click', this.tapHandler);
    } else {
      this.cancelTapMode();
    }
  }

  private cancelTapMode(): void {
    this.tapMode = false;
    if (this.tapHandler) { EventBus.off('map-click', this.tapHandler); this.tapHandler = null; }
    document.getElementById('inv-add-obs-btn')?.classList.remove('tap-mode');
  }
}
