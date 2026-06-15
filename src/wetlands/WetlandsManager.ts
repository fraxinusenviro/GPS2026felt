/**
 * Orchestrates the Wetlands module: dropping plots, editing the survey form,
 * and generating the per-plot PDF report. A wetland plot is a point FieldFeature
 * in the dedicated per-project `{projectId}-wetlands` layer, carrying the full
 * delineation survey in its wetland_data field (persisted locally + synced).
 */
import type { AppSettings, FieldFeature } from '../types';
import { StorageManager } from '../storage/StorageManager';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from '../capture/CaptureManager';
import { EventBus } from '../utils/EventBus';
import { WetlandForm } from './WetlandForm';
import { exportRecordPdf, reportBaseName } from './WetlandReport';
import { defaultWetlandSurvey, str } from './wetlandSurvey';

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
    });

    // Intercept selection of wetland plots: open the survey form instead of the
    // generic feature editor (which we hide so two panels don't stack).
    EventBus.on<{ feature: FieldFeature }>('feature-selected', ({ feature }) => {
      if (!this.isWetlandPlot(feature)) { this.selectedPlot = null; return; }
      this.selectedPlot = feature;
      hideFeatureEditorPanel();
      void this.form.open(feature);
    });
    EventBus.on('feature-deselected', () => { this.selectedPlot = null; });
    EventBus.on<{ id: string }>('feature-deleted', ({ id }) => { if (this.selectedPlot?.id === id) this.selectedPlot = null; });
  }

  private activeProjectId(): string { return this.getSettings().active_project_id || 'default'; }

  private isWetlandPlot(f: FieldFeature): boolean {
    return f.layer_id.endsWith('-wetlands') || !!f.wetland_data;
  }

  /** Ensure the active project has its `{projectId}-wetlands` LayerPreset. */
  async ensureWetlandsLayer(projectId: string): Promise<string> {
    const layerId = `${projectId}-wetlands`;
    if (!(await this.storage.getLayerPreset(layerId))) {
      await this.storage.saveLayerPreset({
        id: layerId, name: 'Wetland Plots', geometry_type: 'Point',
        color: '#0b6b50', stroke_color: '#ffffff', stroke_width: 2, fill_opacity: 0.9,
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

  /** Report button: PDF for the selected plot, or pick from the project's plots. */
  async openReportPicker(): Promise<void> {
    if (this.selectedPlot && this.isWetlandPlot(this.selectedPlot)) {
      await this.generateReport(this.selectedPlot);
      return;
    }
    const plots = (await this.storage.getFeaturesByLayer(`${this.activeProjectId()}-wetlands`))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    if (plots.length === 0) {
      EventBus.emit('toast', { message: 'No wetland plots in this project yet', type: 'warning' });
      return;
    }
    if (plots.length === 1) { await this.generateReport(plots[0]); return; }

    const options = plots.map(p => {
      const d = p.wetland_data;
      const label = `${str(d?.SiteID) || 'Untitled'} · ${str(d?.PLOT_ID) || p.point_id}`;
      return `<option value="${p.id}">${escapeHtml(label)}</option>`;
    }).join('');
    EventBus.emit('show-modal', {
      title: 'Wetland Plot Report',
      html: `<div class="form-group"><label>Select a plot<select id="wl-report-select" style="width:100%">${options}</select></label></div>`,
      confirmLabel: 'Generate PDF',
      onConfirm: () => {
        const id = (document.getElementById('wl-report-select') as HTMLSelectElement | null)?.value;
        const plot = plots.find(p => p.id === id);
        if (plot) void this.generateReport(plot);
      },
      onCancel: () => {},
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
}

function hideFeatureEditorPanel(): void {
  const fe = document.getElementById('feature-editor-panel');
  if (fe) { fe.classList.remove('open'); fe.style.display = 'none'; }
}

function escapeHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
