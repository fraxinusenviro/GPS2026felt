/**
 * Orchestrates the Wetlands module: dropping plots, editing the survey form,
 * generating per-plot PDF reports, and surfacing the plots in the map legend.
 *
 * A wetland plot is a point FieldFeature in the per-project `{projectId}-wetlands`
 * layer, carrying the full delineation survey in its wetland_data field. Every
 * plot is also part of a cross-project "master" set (all wetland features across
 * projects), with each plot tagged by its Project — this backs the Edit Plot
 * list, the Report picker, and the master export.
 */
import type { AppSettings, FieldFeature, Project } from '../types';
import { StorageManager } from '../storage/StorageManager';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from '../capture/CaptureManager';
import { EventBus } from '../utils/EventBus';
import { WetlandForm } from './WetlandForm';
import { exportRecordPdf, reportBaseName } from './WetlandReport';
import {
  defaultWetlandSurvey, str, dateStamp, displayLabel,
  WETLAND_PLOT_COLOR, UPLAND_PLOT_COLOR,
} from './wetlandSurvey';

interface PlotAction { act: string; label: string; cls?: string; }

export class WetlandsManager {
  private storage = StorageManager.getInstance();
  private form: WetlandForm;
  private selectedPlot: FieldFeature | null = null;

  constructor(
    private mapManager: MapManager,
    private captureManager: CaptureManager,
    private getSettings: () => AppSettings,
    private refreshProjectLayers: () => Promise<void>,
  ) {
    this.form = new WetlandForm(async (feature) => {
      await this.storage.saveFeature(feature);
      EventBus.emit('feature-updated', { feature });
      EventBus.emit('toast', { message: 'Wetland plot saved', type: 'success', duration: 1800 });
      void this.renderLegend();
    });

    // Open the survey form (not the generic editor) when a wetland plot is selected.
    EventBus.on<{ feature: FieldFeature }>('feature-selected', ({ feature }) => {
      if (!this.isWetlandPlot(feature)) { this.selectedPlot = null; return; }
      this.selectedPlot = feature;
      hideFeatureEditorPanel();
      void this.form.open(feature);
    });
    EventBus.on('feature-deselected', () => { this.selectedPlot = null; });
    EventBus.on<{ id: string }>('feature-deleted', ({ id }) => {
      if (this.selectedPlot?.id === id) this.selectedPlot = null;
      void this.renderLegend();
    });
    EventBus.on('feature-added', () => void this.renderLegend());
    EventBus.on('feature-updated', () => void this.renderLegend());
  }

  private activeProjectId(): string { return this.getSettings().active_project_id || 'default'; }
  private wetlandsLayerId(projectId = this.activeProjectId()): string { return `${projectId}-wetlands`; }

  private isWetlandPlot(f: FieldFeature): boolean {
    return f.layer_id.endsWith('-wetlands') || !!f.wetland_data;
  }

  /** Ensure the active project has its `{projectId}-wetlands` LayerPreset. */
  async ensureWetlandsLayer(projectId: string): Promise<string> {
    const layerId = this.wetlandsLayerId(projectId);
    if (!(await this.storage.getLayerPreset(layerId))) {
      await this.storage.saveLayerPreset({
        id: layerId, name: 'Wetland Plots', geometry_type: 'Point',
        color: WETLAND_PLOT_COLOR, stroke_color: '#ffffff', stroke_width: 2, fill_opacity: 0.9,
        types: [], project_id: projectId, visible: true,
      });
      await this.refreshProjectLayers();
    }
    return layerId;
  }

  private generatePointId(): string {
    const userId = this.getSettings().user_id || 'USER';
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${userId}_${now.getFullYear()}_${p(now.getMonth() + 1)}_${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  }

  // ---- master data (all wetland plots across all projects) ----

  private async projectNameMap(): Promise<Map<string, string>> {
    const projects: Project[] = await this.storage.getAllProjects();
    const m = new Map<string, string>();
    projects.forEach(p => m.set(p.id, p.name));
    return m;
  }

  /** Every wetland plot across all projects, newest first. */
  private async getAllPlots(): Promise<FieldFeature[]> {
    const all = await this.storage.getAllFeatures();
    return all.filter(f => this.isWetlandPlot(f))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  // ---- add ----

  /** Drop a new wetland plot (at GPS fix or map centre) and open the form. */
  async startAddPlot(): Promise<void> {
    const projectId = this.activeProjectId();
    const layerId = await this.ensureWetlandsLayer(projectId);

    const gps = this.captureManager.getGPSState();
    let lat: number;
    let lon: number;
    let elevation: number | null = null;
    let accuracy: number | null = null;
    let method: 'gps' | 'sketch' = 'sketch';
    if (gps.available) {
      lat = gps.lat; lon = gps.lon; elevation = gps.elevation; accuracy = gps.accuracy; method = 'gps';
    } else {
      const c = this.mapManager.getMap().getCenter();
      lat = c.lat; lon = c.lng;
      EventBus.emit('toast', { message: 'No GPS fix — plot dropped at map centre', type: 'info', duration: 2200 });
    }

    const now = new Date().toISOString();
    const survey = defaultWetlandSurvey();
    survey.latitude = lat;
    survey.longitude = lon;
    survey.Project = (await this.storage.getProject(projectId))?.name ?? projectId;

    const feature: FieldFeature = {
      id: crypto.randomUUID(),
      point_id: this.generatePointId(),
      type: 'Wetland Plot',
      desc: '',
      geometry_type: 'Point',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      capture_method: method,
      created_at: now,
      updated_at: now,
      created_by: this.getSettings().user_id || 'USER',
      lat, lon, elevation, accuracy,
      layer_id: layerId,
      project_id: projectId,
      notes: '',
      photos: [],
      wetland_data: survey,
    };

    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
    this.mapManager.flyTo(lat, lon);
    this.selectedPlot = feature;
    await this.form.open(feature);
  }

  // ---- edit list (all submitted plots) ----

  async openEditList(): Promise<void> {
    const plots = await this.getAllPlots();
    if (plots.length === 0) {
      EventBus.emit('toast', { message: 'No wetland plots collected yet', type: 'warning' });
      return;
    }
    const names = await this.projectNameMap();
    const actions: PlotAction[] = [
      { act: 'edit', label: 'Edit' },
      { act: 'zoom', label: 'Zoom' },
      { act: 'delete', label: 'Delete', cls: 'btn-danger' },
    ];
    const rows = plots.map(p => this.plotRowHtml(p, names.get(p.project_id) ?? p.project_id, actions)).join('');
    EventBus.emit('show-modal', {
      title: `Wetland Plots — Master (${plots.length})`,
      html: `
        <div class="wl-list-toolbar">
          <button class="btn-outline btn-sm" id="wl-export-master">Export Master GeoJSON</button>
        </div>
        <div class="wl-list">${rows}</div>`,
      confirmLabel: 'Close',
    });
    this.wirePlotActions(plots, (act, plot) => void this.handleListAction(act, plot));
    requestAnimationFrame(() => {
      document.getElementById('wl-export-master')?.addEventListener('click', () => void this.exportMaster());
    });
  }

  /** Open the wetland survey form for a specific plot by feature id (used by the
   *  Project Library "Edit" action). */
  async editPlotById(featureId: string): Promise<void> {
    const plot = (await this.storage.getAllFeatures()).find(f => f.id === featureId && this.isWetlandPlot(f));
    if (!plot) { EventBus.emit('toast', { message: 'Wetland plot not found', type: 'error' }); return; }
    closeActiveModal();
    this.selectedPlot = plot;
    hideFeatureEditorPanel();
    if (plot.lat != null && plot.lon != null) this.mapManager.flyTo(plot.lat, plot.lon);
    await this.form.open(plot);
  }

  private async handleListAction(act: string, plot: FieldFeature): Promise<void> {    if (act === 'edit') {
      closeActiveModal();
      this.selectedPlot = plot;
      hideFeatureEditorPanel();
      if (plot.lat != null && plot.lon != null) this.mapManager.flyTo(plot.lat, plot.lon);
      await this.form.open(plot);
    } else if (act === 'zoom') {
      closeActiveModal();
      if (plot.lat != null && plot.lon != null) this.mapManager.flyTo(plot.lat, plot.lon, 17);
      else EventBus.emit('toast', { message: 'Plot has no location', type: 'warning' });
    } else if (act === 'delete') {
      const d = plot.wetland_data;
      const label = str(d?.SiteID) || str(d?.PLOT_ID) || plot.point_id;
      if (!confirm(`Delete wetland plot "${label}"? This cannot be undone.`)) return;
      await this.storage.deleteFeature(plot.id);
      EventBus.emit('feature-deleted', { id: plot.id });
      if (this.selectedPlot?.id === plot.id) this.selectedPlot = null;
      EventBus.emit('toast', { message: 'Wetland plot deleted', type: 'warning', duration: 1800 });
      void this.openEditList(); // refresh the list in place
    }
  }

  // ---- report (always presents the list of available plots) ----

  async openReportPicker(): Promise<void> {
    const plots = await this.getAllPlots();
    if (plots.length === 0) {
      EventBus.emit('toast', { message: 'No wetland plots available for export', type: 'warning' });
      return;
    }
    const names = await this.projectNameMap();
    const rows = plots.map(p => this.plotRowHtml(p, names.get(p.project_id) ?? p.project_id, [{ act: 'pdf', label: 'PDF' }])).join('');
    EventBus.emit('show-modal', {
      title: 'Wetland Plot Report — select a plot',
      html: `<div class="wl-list">${rows}</div>`,
      confirmLabel: 'Close',
    });
    this.wirePlotActions(plots, (_act, plot) => { closeActiveModal(); void this.generateReport(plot); });
  }

  private plotRowHtml(f: FieldFeature, projectName: string, actions: PlotAction[]): string {
    const d = f.wetland_data;
    const site = str(d?.SiteID) || 'Untitled Site';
    const plotId = str(d?.PLOT_ID) || f.point_id;
    const ptype = str(d?.PLOT_TYPE) || '—';
    const isUpland = ptype.toLowerCase().includes('upland');
    const dot = isUpland ? UPLAND_PLOT_COLOR : WETLAND_PLOT_COLOR;
    const when = f.updated_at ? new Date(f.updated_at).toLocaleDateString('en-CA') : '';
    const btns = actions.map(a => `<button class="btn-sm wl-list-act ${a.cls ?? ''}" data-act="${a.act}" data-id="${f.id}">${a.label}</button>`).join('');
    return `
      <div class="wl-list-row">
        <span class="wl-dot" style="background:${dot}" title="${escapeHtml(ptype)}"></span>
        <div class="wl-list-info">
          <strong>${escapeHtml(site)}</strong>
          <span class="wl-list-meta">${escapeHtml(projectName)} · ${escapeHtml(plotId)} · ${escapeHtml(ptype)}${when ? ' · ' + when : ''}</span>
        </div>
        <div class="wl-list-actions">${btns}</div>
      </div>`;
  }

  private wirePlotActions(plots: FieldFeature[], handler: (act: string, f: FieldFeature) => void): void {
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLButtonElement>('.wl-list-act').forEach(btn => {
        btn.addEventListener('click', () => {
          const plot = plots.find(p => p.id === btn.dataset.id);
          if (!plot) return;
          handler(btn.dataset.act ?? '', plot);
        });
      });
    });
  }

  private async generateReport(feature: FieldFeature): Promise<void> {
    const survey = feature.wetland_data ?? defaultWetlandSurvey();
    try {
      EventBus.emit('toast', { message: 'Generating PDF…', type: 'info', duration: 1500 });
      await exportRecordPdf(survey, reportBaseName(survey));
    } catch (err) {
      console.error('[wetlands] PDF export failed:', err);
      EventBus.emit('toast', { message: 'PDF export failed in this browser', type: 'error' });
    }
  }

  /** Export every wetland plot (all projects) as one master GeoJSON file. */
  private async exportMaster(): Promise<void> {
    const plots = await this.getAllPlots();
    const names = await this.projectNameMap();
    const features = plots.map(f => {
      const d = f.wetland_data ?? defaultWetlandSurvey();
      const props: Record<string, unknown> = { Project: names.get(f.project_id) ?? f.project_id, project_id: f.project_id, point_id: f.point_id };
      for (const [k, v] of Object.entries(d)) {
        if (k === 'photos') { props.photo_count = Array.isArray(v) ? v.length : 0; continue; }
        props[k] = Array.isArray(v) ? v.join('; ') : v;
      }
      return { type: 'Feature', geometry: f.geometry, properties: props };
    });
    const fc = { type: 'FeatureCollection', features };
    downloadText(JSON.stringify(fc, null, 2), `Wetland_Master_${dateStamp()}.geojson`, 'application/geo+json');
    EventBus.emit('toast', { message: `Master export: ${plots.length} plot(s)`, type: 'success', duration: 2000 });
  }

  // ---- map legend "User Data" section ----

  /** Render the Wetland Plots item into the legend drawer's User Data section. */
  async renderLegend(): Promise<void> {
    const root = document.getElementById('user-data-legend');
    if (!root) return;
    const projectId = this.activeProjectId();
    const layer = await this.storage.getLayerPreset(this.wetlandsLayerId(projectId));
    if (!layer) { root.innerHTML = ''; return; }
    const plots = await this.storage.getFeaturesByLayer(this.wetlandsLayerId(projectId));
    const upland = plots.filter(p => str(p.wetland_data?.PLOT_TYPE).toLowerCase().includes('upland')).length;
    const wetland = plots.length - upland;
    const visible = layer.visible !== false;

    root.innerHTML = `
      <div class="ud-section-title">User Data</div>
      <div class="ud-item">
        <div class="ud-head">
          <button class="ud-vis ${visible ? 'active' : ''}" id="ud-wetlands-vis" title="Toggle Wetland Plots">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <span class="ud-name">Wetland Plots</span>
          <span class="ud-count">${plots.length}</span>
        </div>
        <div class="ud-legend">
          <div class="ud-legend-row"><span class="ud-swatch" style="background:${WETLAND_PLOT_COLOR}"></span>Wetland Plot (${wetland})</div>
          <div class="ud-legend-row"><span class="ud-swatch" style="background:${UPLAND_PLOT_COLOR}"></span>Upland Plot (${upland})</div>
        </div>
        <div class="ud-note">Labelled by ${displayLabel('PLOT_ID')}</div>
      </div>`;

    document.getElementById('ud-wetlands-vis')?.addEventListener('click', () => void this.toggleWetlandsVisibility());
  }

  private async toggleWetlandsVisibility(): Promise<void> {
    const layer = await this.storage.getLayerPreset(this.wetlandsLayerId());
    if (!layer) return;
    layer.visible = layer.visible === false;
    await this.storage.saveLayerPreset(layer);
    await this.refreshProjectLayers();
    await this.renderLegend();
  }
}

function hideFeatureEditorPanel(): void {
  const fe = document.getElementById('feature-editor-panel');
  if (fe) { fe.classList.remove('open'); fe.style.display = 'none'; }
}

function closeActiveModal(): void {
  (document.getElementById('modal-close') as HTMLButtonElement | null)?.click();
}

function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function escapeHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
