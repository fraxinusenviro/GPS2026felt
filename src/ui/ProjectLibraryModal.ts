import type { Project, ProjectMap, FieldFeature, LayerPreset, InventorySurvey, AppSettings } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { PROJECT_TEMPLATES } from '../constants';
import { ExportManager } from '../io/ExportManager';
import { exportRecordPdf, reportBaseName } from '../wetlands/WetlandReport';
import {
  exportCSV as invExportCSV,
  exportGeoJSON as invExportGeoJSON,
  exportPDF as invExportPDF,
} from '../inventory/InventoryExport';
import { realObservations, uniqueSpeciesCount } from '../inventory/inventorySurvey';
import { EventBus } from '../utils/EventBus';

export const ALL_DATA_MAP_ID = '__all_data__';

export interface ProjectLibraryCallbacks {
  onLoadMap: (mapId: string) => Promise<void>;
  onLoadProject: (projectId: string) => Promise<void>;
  onCreateProject: (name: string, description: string, templateId?: string) => Promise<void>;
  onCreateMap: (projectId: string, name: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onDeleteMap: (id: string) => Promise<void>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onRenameMap: (id: string, name: string) => Promise<void>;
  onDuplicateMap: (id: string) => Promise<void>;
  onExportBundle: (projectId: string) => void;
  onEditWetlandPlot: (featureId: string) => Promise<void> | void;
  onEditInventorySurvey: (surveyId: string) => Promise<void> | void;
  getActiveMapId: () => string;
}

type SectionKey = 'maps' | 'collected' | 'wetland' | 'inventory';

type View = 'projects' | 'project-detail' | 'new-project' | 'new-map';

/** A feature TYPE preset that has at least one collected feature in the project. */
interface CollectedDataset {
  key: string;          // preset type label (stable id within the project)
  label: string;        // display name
  layerId: string;
  layerName: string;
  color: string;
  geomLabel: string;    // 'Point' | 'Line' | 'Polygon' | 'Mixed'
  count: number;
  updatedAt: string;
  collectors: string[]; // distinct created_by initials
}

interface WetlandPlotRow {
  feature: FieldFeature;
  plotId: string;
  collector: string;
  date: string;
  isUpland: boolean;
}

interface InventorySurveyRow {
  survey: InventorySurvey;   // reconstructed, with observations
  obsCount: number;
  speciesCount: number;
}

/** Aggregated, render-ready data for a project's detail view. */
interface DetailData {
  featureCount: number;
  users: string[];
  collected: CollectedDataset[];
  wetlandPlots: WetlandPlotRow[];
  inventorySurveys: InventorySurveyRow[];
}

const PROJECT_COLORS = [
  '#4f8ef7', '#34c97e', '#f5a623', '#e84393', '#9b59b6',
  '#1abc9c', '#e67e22', '#e74c3c', '#3498db', '#2ecc71',
];

export class ProjectLibraryModal {
  private overlay: HTMLElement;
  private storage = StorageManager.getInstance();
  private exporter = new ExportManager();
  private callbacks!: ProjectLibraryCallbacks;

  // Cached detail-view aggregation for the currently selected project, so export
  // handlers wired after render can resolve features without re-querying.
  private detailData: DetailData | null = null;
  private detailFeatures: FieldFeature[] = [];

  private view: View = 'projects';
  private selectedProjectId: string | null = null;
  private searchQuery = '';
  private sortMode: 'name' | 'updated' | 'created' = 'name';
  private renamingId: string | null = null;
  private renamingKind: 'project' | 'map' | null = null;

  // Per-section collapse state in the detail view. Maps open by default, the
  // collected-data / wetland / inventory sections collapsed. Persists across re-renders.
  private sectionOpen: Record<SectionKey, boolean> = { maps: true, collected: false, wetland: false, inventory: false };

  constructor() {
    this.overlay = document.getElementById('project-library-overlay')!;
  }

  open(callbacks: ProjectLibraryCallbacks): void {
    this.callbacks = callbacks;
    this.view = 'projects';
    this.selectedProjectId = null;
    this.searchQuery = '';
    this.renamingId = null;
    this.renamingKind = null;
    this.sortMode = 'name';
    this.sectionOpen = { maps: true, collected: false, wetland: false, inventory: false };
    void this.render();
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('pl-open'));
  }

  close(): void {
    this.overlay.classList.remove('pl-open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 250);
  }

  refreshIfOpen(): void {
    if (this.overlay.style.display !== 'none' && this.callbacks) void this.render();
  }

  private async render(): Promise<void> {
    const projects = await this.storage.getAllProjects();
    const allMaps = await this.storage.getAllMaps();
    const activeMapId = this.callbacks.getActiveMapId();

    const mapsByProject = new Map<string, ProjectMap[]>();
    for (const m of allMaps) {
      const arr = mapsByProject.get(m.project_id) ?? [];
      arr.push(m);
      mapsByProject.set(m.project_id, arr);
    }
    for (const [, maps] of mapsByProject) maps.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    const selectedProject = projects.find(p => p.id === this.selectedProjectId) ?? null;
    const mapsForSelected = this.selectedProjectId ? (mapsByProject.get(this.selectedProjectId) ?? []) : [];

    // Aggregate the selected project's collected data for the detail view.
    this.detailData = null;
    this.detailFeatures = [];
    if (this.view === 'project-detail' && this.selectedProjectId) {
      try {
        this.detailData = await this.buildDetailData(this.selectedProjectId);
      } catch (err) {
        console.error('[project-library] detail aggregation failed:', err);
      }
    }

    this.overlay.innerHTML = `
      <div class="pl-modal">
        <div class="pl-header">
          <div class="pl-header-left">
            ${this.view === 'project-detail' || this.view === 'new-map' || this.view === 'new-project'
              ? `<button class="pl-back-btn" id="pl-back">← Projects</button>`
              : `<span class="pl-title">Project Library</span>`
            }
            ${this.view === 'project-detail' && selectedProject
              ? `<span class="pl-breadcrumb">${escHtml(selectedProject.name)}</span>`
              : ''
            }
          </div>
          <div class="pl-header-right">
            <button class="pl-close-btn" id="pl-close">✕</button>
          </div>
        </div>

        <div class="pl-body" data-view="${this.view}">
          <aside class="pl-sidebar">
            <div class="pl-sidebar-section">
              <button class="pl-sidebar-item pl-all-data${activeMapId === ALL_DATA_MAP_ID ? ' active' : ''}" id="pl-all-data">
                <span class="pl-sidebar-icon">🌐</span>
                <span>All Data</span>
              </button>
            </div>

            <div class="pl-sidebar-section">
              <div class="pl-sidebar-heading">Projects</div>
              ${projects.map(p => {
                const maps = mapsByProject.get(p.id) ?? [];
                const color = p.color ?? projectColor(p.id);
                return `
                  <button class="pl-sidebar-item pl-sidebar-proj-btn${this.selectedProjectId === p.id ? ' active' : ''}"
                          data-proj-select="${p.id}">
                    <span class="pl-proj-dot" style="background:${color}"></span>
                    <span class="pl-sidebar-proj-name" title="${escHtml(p.name)}">${escHtml(p.name)}</span>
                    <span class="pl-sidebar-count">${maps.length}</span>
                  </button>`;
              }).join('')}
            </div>

            <div class="pl-sidebar-section pl-sidebar-actions">
              <button class="btn btn-primary pl-new-proj-btn" id="pl-new-project">+ New Project</button>
            </div>
          </aside>

          <main class="pl-main">
            ${this.view === 'projects' ? this.renderProjectsView(projects, mapsByProject, activeMapId) : ''}
            ${this.view === 'project-detail' && selectedProject ? this.renderProjectDetailView(selectedProject, mapsForSelected, activeMapId, this.detailData) : ''}
            ${this.view === 'new-project' ? this.renderNewProjectForm() : ''}
            ${this.view === 'new-map' && selectedProject ? this.renderNewMapForm(selectedProject) : ''}
          </main>
        </div>
      </div>`;

    this.wireEvents(projects, allMaps, mapsByProject);
  }

  private renderProjectsView(projects: Project[], mapsByProject: Map<string, ProjectMap[]>, activeMapId: string): string {
    const filtered = this.filterProjects(projects);
    return `
      <div class="pl-main-toolbar">
        <input class="pl-search" id="pl-search" type="text" placeholder="Search projects…" value="${escHtml(this.searchQuery)}" />
        <select id="pl-sort" class="pl-sort-select">
          <option value="name" ${this.sortMode === 'name' ? 'selected' : ''}>Name A→Z</option>
          <option value="updated" ${this.sortMode === 'updated' ? 'selected' : ''}>Last Updated</option>
          <option value="created" ${this.sortMode === 'created' ? 'selected' : ''}>Date Created</option>
        </select>
      </div>
      <div class="pl-all-data-card${activeMapId === ALL_DATA_MAP_ID ? ' active' : ''}" id="pl-all-data-card">
        <div class="pl-all-data-icon">🌐</div>
        <div class="pl-all-data-info">
          <div class="pl-all-data-title">All Data</div>
          <div class="pl-all-data-sub">View all collected features across every project</div>
        </div>
        <button class="btn ${activeMapId === ALL_DATA_MAP_ID ? 'btn-secondary' : 'btn-primary'} pl-card-open"
                id="pl-open-all-data" ${activeMapId === ALL_DATA_MAP_ID ? 'disabled' : ''}>
          ${activeMapId === ALL_DATA_MAP_ID ? 'Active' : 'Open'}
        </button>
      </div>
      ${filtered.length === 0
        ? `<p class="pl-empty">No projects yet. Create one to get started.</p>`
        : `<div class="pl-grid">
            ${filtered.map(p => this.renderProjectCard(p, mapsByProject.get(p.id) ?? [], activeMapId)).join('')}
           </div>`
      }`;
  }

  private renderProjectCard(p: Project, maps: ProjectMap[], activeMapId: string): string {
    const color = p.color ?? projectColor(p.id);
    const date = formatDate(p.updated_at);
    const mapCount = maps.length;
    const activeMap = maps.find(m => m.id === activeMapId);
    const isRenaming = this.renamingId === p.id && this.renamingKind === 'project';

    return `
      <div class="pl-card pl-project-card" data-project-id="${p.id}">
        <div class="pl-card-thumb"${p.thumbnail_url ? '' : ` style="background: linear-gradient(135deg, ${color}33, ${color}99)"`}>
          ${p.thumbnail_url
            ? `<img class="pl-card-thumb-img" src="${p.thumbnail_url}" alt="${escHtml(p.name)} preview" />`
            : `<span class="pl-card-thumb-icon">🗺</span>`}
          ${activeMap ? `<span class="pl-active-badge pl-thumb-badge">Active</span>` : ''}
        </div>
        <div class="pl-card-body">
          <div class="pl-card-header">
            ${isRenaming
              ? `<input class="pl-rename-input" id="pl-rename-input-${p.id}" value="${escHtml(p.name)}" maxlength="60" />
                 <button class="btn btn-sm btn-primary" data-save-rename-proj="${p.id}">Save</button>
                 <button class="btn btn-sm btn-secondary" data-cancel-rename>✕</button>`
              : `<span class="pl-card-title">${escHtml(p.name)}</span>
                 <div class="pl-card-menu-wrap">
                   <button class="pl-card-menu-btn" data-menu-id="${p.id}" title="More options">⋯</button>
                   <div class="pl-card-dropdown" id="pl-menu-${p.id}" style="display:none">
                     <button data-rename-proj="${p.id}">✏ Rename</button>
                     <button data-export-proj="${p.id}">⬇ Export</button>
                     <button data-delete-proj="${p.id}" class="pl-danger-item">🗑 Delete</button>
                   </div>
                 </div>`
            }
          </div>
          ${p.description ? `<div class="pl-card-desc">${escHtml(p.description)}</div>` : ''}
          <div class="pl-card-meta">
            <span>${mapCount} map${mapCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>${date}</span>
          </div>
          <div class="pl-card-footer">
            <button class="btn btn-sm btn-outline pl-card-view-maps" data-view-proj="${p.id}">View Maps</button>
            <button class="btn btn-sm ${activeMap ? 'btn-secondary' : 'btn-primary'} pl-card-open"
                    data-open-proj="${p.id}" ${activeMap ? 'disabled' : ''}>
              ${activeMap ? 'Active' : 'Open'}
            </button>
          </div>
        </div>
      </div>`;
  }

  private renderProjectDetailView(
    project: Project,
    maps: ProjectMap[],
    activeMapId: string,
    data: DetailData | null,
  ): string {
    const color = project.color ?? projectColor(project.id);
    const isRenaming = this.renamingId === project.id && this.renamingKind === 'project';
    const featureCount = data?.featureCount ?? 0;
    const users = data?.users ?? [];

    return `
     <div class="pl-detail-scroll">
      <div class="pl-detail-header" style="border-left: 4px solid ${color}">
        <div class="pl-detail-proj-top">
          <span class="pl-proj-dot pl-proj-dot-lg" style="background:${color}"></span>
          <div class="pl-detail-proj-info">
            ${isRenaming
              ? `<input class="pl-rename-input" id="pl-rename-input-${project.id}" value="${escHtml(project.name)}" maxlength="60" />
                 <div class="pl-detail-rename-actions">
                   <button class="btn btn-sm btn-primary" data-save-rename-proj="${project.id}">Save</button>
                   <button class="btn btn-sm btn-secondary" data-cancel-rename>Cancel</button>
                 </div>`
              : `<span class="pl-detail-proj-name">${escHtml(project.name)}</span>
                 ${project.description ? `<span class="pl-detail-proj-desc">${escHtml(project.description)}</span>` : ''}`
            }
          </div>
        </div>
        <div class="pl-detail-proj-meta">
          <span class="pl-detail-meta-item">📁 ${maps.length} map${maps.length !== 1 ? 's' : ''}</span>
          <span class="pl-detail-meta-item">📍 ${featureCount} feature${featureCount !== 1 ? 's' : ''}</span>
          <span class="pl-detail-meta-item">Updated ${formatDate(project.updated_at)}</span>
          <span class="pl-detail-meta-item">Created ${formatDate(project.created_at)}</span>
          ${users.length > 0
            ? `<span class="pl-detail-meta-item pl-detail-users">👤 ${users.map(u => `<span class="pl-user-avatar" title="${escHtml(u)}">${escHtml(u.slice(0,2).toUpperCase())}</span>`).join('')}</span>`
            : ''}
        </div>
        <div class="pl-detail-proj-actions">
          <button class="btn btn-sm btn-outline" data-rename-proj="${project.id}">✏ Rename</button>
          <button class="btn btn-sm btn-outline" data-export-proj="${project.id}">⬇ Export Project</button>
          <button class="btn btn-sm btn-outline pl-danger-btn" data-delete-proj="${project.id}">🗑 Delete</button>
        </div>
      </div>

      ${this.section('maps', '🗺 Maps', maps.length,
        `<button class="btn btn-sm btn-primary" id="pl-new-map-btn">+ New Map</button>`,
        maps.length === 0
          ? `<p class="pl-empty">No maps yet. Create one to get started.</p>`
          : maps.map(m => this.renderDetailMapCard(m, activeMapId)).join('')
      )}
      ${this.renderCollectedDataSection(data?.collected ?? [])}
      ${this.renderWetlandSection(data?.wetlandPlots ?? [])}
      ${this.renderInventorySection(data?.inventorySurveys ?? [])}
     </div>`;
  }

  /** Wrap a detail section in a collapsible shell with a caret toggle. The body is
   *  always rendered; CSS hides it when collapsed (state persists in this.sectionOpen). */
  private section(key: SectionKey, title: string, count: number, headActions: string, body: string): string {
    const isOpen = this.sectionOpen[key];
    return `
      <div class="pl-detail-section pl-collapsible${isOpen ? '' : ' pl-collapsed'}" data-section="${key}">
        <div class="pl-section-head">
          <button class="pl-section-toggle" data-toggle-section="${key}" aria-expanded="${isOpen}">
            <span class="pl-section-caret" aria-hidden="true">▾</span>
            <span class="pl-detail-section-title">${title}</span>
            <span class="pl-section-badge">${count}</span>
          </button>
          ${headActions ? `<div class="pl-section-head-actions">${headActions}</div>` : ''}
        </div>
        <div class="pl-section-body">${body}</div>
      </div>`;
  }

  /** "User Collected Data" — one row per preset/type that has collected features. */
  private renderCollectedDataSection(datasets: CollectedDataset[]): string {
    if (datasets.length === 0) return '';
    const rows = datasets.map((d, i) => `
      <div class="pl-data-row">
        <span class="pl-data-dot" style="background:${d.color}"></span>
        <div class="pl-data-info">
          <span class="pl-data-name" title="${escHtml(d.label)}">${escHtml(d.label)}</span>
          <span class="pl-data-meta">${d.count} record${d.count !== 1 ? 's' : ''} · ${escHtml(d.geomLabel)} · ${escHtml(d.layerName)}${d.updatedAt ? ` · Updated ${formatDate(d.updatedAt)}` : ''}</span>
        </div>
        ${this.exportPills([
          { fmt: 'csv', label: 'CSV', attrs: `data-ds-export="${i}" data-fmt="csv"` },
          { fmt: 'geojson', label: 'GeoJSON', attrs: `data-ds-export="${i}" data-fmt="geojson"` },
        ], `ds-${i}`, [
          { fmt: 'kml', label: 'KML', attrs: `data-ds-export="${i}" data-fmt="kml"` },
          { fmt: 'shp', label: 'Shapefile', attrs: `data-ds-export="${i}" data-fmt="shp"` },
        ])}
      </div>`).join('');
    return this.section('collected', '📊 User Collected Data', datasets.length, '',
      `<div class="pl-data-list">${rows}</div>`);
  }

  /** Wetland Plots — per-plot collector + PDF; section-level CSV/GeoJSON for all plots. */
  private renderWetlandSection(plots: WetlandPlotRow[]): string {
    if (plots.length === 0) return '';
    const rows = plots.map(p => `
      <div class="pl-data-row">
        <span class="pl-data-dot" style="background:${p.isUpland ? '#b08d57' : '#0b6b50'}"></span>
        <div class="pl-data-info">
          <span class="pl-data-name" title="${escHtml(p.plotId)}">${escHtml(p.plotId)}</span>
          <span class="pl-data-meta">${escHtml(p.isUpland ? 'Upland Plot' : 'Wetland Plot')} · ${escHtml(p.date)} · <span class="pl-collector">👤 ${escHtml(p.collector)}</span></span>
        </div>
        <div class="pl-export-pills">
          <button class="pl-pill" data-wl-edit="${p.feature.id}">✏ Edit</button>
          <button class="pl-pill" data-wl-pdf="${p.feature.id}">PDF</button>
        </div>
      </div>`).join('');
    return this.section('wetland', '🌿 Wetland Plots', plots.length,
      `<button class="pl-pill" data-wl-export="csv">CSV (all)</button>
       <button class="pl-pill" data-wl-export="geojson">GeoJSON (all)</button>`,
      `<div class="pl-data-list">${rows}</div>`);
  }

  /** Inventory Surveys — per-survey surveyor + CSV/GeoJSON/PDF. */
  private renderInventorySection(surveys: InventorySurveyRow[]): string {
    if (surveys.length === 0) return '';
    const rows = surveys.map(r => {
      const s = r.survey;
      const title = s.siteName || s.surveyID || 'Untitled survey';
      return `
      <div class="pl-data-row">
        <span class="pl-data-dot" style="background:#22c55e"></span>
        <div class="pl-data-info">
          <span class="pl-data-name" title="${escHtml(title)}">${escHtml(title)}</span>
          <span class="pl-data-meta">${escHtml(s.date || '')} · ${r.obsCount} obs · ${r.speciesCount} spp · <span class="pl-collector">👤 ${escHtml(s.surveyor || '—')}</span></span>
        </div>
        <div class="pl-export-pills">
          <button class="pl-pill" data-inv-edit="${s.id}">✏ Edit</button>
          <button class="pl-pill" data-inv-export="${s.id}" data-fmt="csv">CSV</button>
          <button class="pl-pill" data-inv-export="${s.id}" data-fmt="geojson">GeoJSON</button>
          <button class="pl-pill" data-inv-export="${s.id}" data-fmt="pdf">PDF</button>
        </div>
      </div>`;
    }).join('');
    return this.section('inventory', '📋 Inventory Surveys', surveys.length, '',
      `<div class="pl-data-list">${rows}</div>`);
  }

  /** Render a row of export pills with an optional overflow (⋯) menu for extra formats. */
  private exportPills(
    primary: Array<{ fmt: string; label: string; attrs: string }>,
    menuId: string,
    overflow: Array<{ fmt: string; label: string; attrs: string }>,
  ): string {
    return `
      <div class="pl-export-pills">
        ${primary.map(p => `<button class="pl-pill" ${p.attrs}>${p.label}</button>`).join('')}
        ${overflow.length > 0 ? `
        <div class="pl-card-menu-wrap">
          <button class="pl-pill pl-pill-more" data-menu-id="${menuId}" title="More formats">⋯</button>
          <div class="pl-card-dropdown" id="pl-menu-${menuId}" style="display:none">
            ${overflow.map(o => `<button ${o.attrs}>⬇ ${o.label}</button>`).join('')}
          </div>
        </div>` : ''}
      </div>`;
  }

  // ---- Detail-view data aggregation ----

  /** Build render-ready section data for a project, reading features + layers once. */
  private async buildDetailData(projectId: string): Promise<DetailData> {
    const [features, layers] = await Promise.all([
      this.storage.getFeaturesByProject(projectId),
      this.storage.getLayersByProject(projectId),
    ]);
    this.detailFeatures = features;

    const layerById = new Map<string, LayerPreset>(layers.map(l => [l.id, l]));
    const isWetland = (f: FieldFeature) => f.layer_id.endsWith('-wetlands') || !!f.wetland_data;
    const isInventory = (f: FieldFeature) => f.layer_id.endsWith('-inventory') || !!f.inventory_data;

    // ---- User Collected Data: group generic features by preset TYPE ----
    const groups = new Map<string, FieldFeature[]>();
    for (const f of features) {
      if (isWetland(f) || isInventory(f)) continue;
      const key = featureType(f);
      const arr = groups.get(key);
      if (arr) arr.push(f); else groups.set(key, [f]);
    }
    const collected: CollectedDataset[] = [];
    for (const [key, feats] of groups) {
      const layer = layerById.get(feats[0].layer_id);
      const isUntyped = key.startsWith('__layer__');
      const label = isUntyped ? `${layer?.name ?? 'Untyped'} (untyped)` : key;
      const typePreset = isUntyped ? undefined : layer?.types.find(t => t.label === key);
      const color = typePreset?.color ?? layer?.color ?? '#4ade80';
      const geomSet = new Set(feats.map(f => f.geometry_type));
      const geomLabel = geomSet.size > 1 ? 'Mixed' : geomTypeLabel([...geomSet][0]);
      const updatedAt = feats.reduce((acc, f) => (f.updated_at > acc ? f.updated_at : acc), '');
      const collectors = [...new Set(feats.map(f => f.created_by).filter(Boolean))];
      collected.push({
        key, label, layerId: feats[0].layer_id, layerName: layer?.name ?? '',
        color, geomLabel, count: feats.length, updatedAt, collectors,
      });
    }
    collected.sort((a, b) => a.label.localeCompare(b.label));

    // ---- Wetland Plots ----
    const wetlandPlots: WetlandPlotRow[] = features.filter(isWetland)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .map(f => {
        const d = f.wetland_data;
        const plotId = str(d?.PLOT_ID) || str(d?.SiteID) || f.point_id;
        const collector = f.created_by || str(d?.observer) || '—';
        const date = str(d?.date) || formatDate(f.created_at);
        const isUpland = str(d?.PLOT_TYPE).toLowerCase().includes('upland');
        return { feature: f, plotId, collector, date, isUpland };
      });

    // ---- Inventory Surveys (reconstructed from observation features) ----
    const inventorySurveys = this.reconstructSurveys(features.filter(isInventory), projectId);

    const users = [...new Set(features.map(f => f.created_by).filter(Boolean))];

    return { featureCount: features.length, users, collected, wetlandPlots, inventorySurveys };
  }

  /** Group inventory observation features back into submitted surveys (newest first). */
  private reconstructSurveys(feats: FieldFeature[], projectId: string): InventorySurveyRow[] {
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
          status: 'submitted', project_id: f.project_id || projectId, observations: [],
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
    return [...map.values()]
      .sort((a, b) => b.startTime - a.startTime)
      .map(survey => {
        const real = realObservations(survey);
        return { survey, obsCount: real.length, speciesCount: uniqueSpeciesCount(real) };
      });
  }

  private renderDetailMapCard(m: ProjectMap, activeMapId: string): string {
    const isActive = m.id === activeMapId;
    const isRenaming = this.renamingId === m.id && this.renamingKind === 'map';

    const userSet = new Set<string>([
      ...Object.keys(m.user_viewports ?? {}),
      ...Object.keys(m.user_layer_views ?? {}),
    ]);
    const userList = [...userSet].filter(Boolean);

    return `
      <div class="pl-detail-map-card${isActive ? ' pl-map-active' : ''}" data-map-id="${m.id}">
        <div class="pl-map-thumb">
          ${m.thumbnail_url
            ? `<img class="pl-map-thumb-img" src="${m.thumbnail_url}" alt="${escHtml(m.name)} preview" />`
            : `<span class="pl-map-thumb-icon">🗺</span>`}
        </div>
        <div class="pl-detail-map-content">
          <div class="pl-detail-map-header">
            <div class="pl-detail-map-title-row">
              ${isRenaming
                ? `<input class="pl-rename-input" id="pl-rename-input-${m.id}" value="${escHtml(m.name)}" maxlength="60" />
                   <button class="btn btn-sm btn-primary" data-save-rename-map="${m.id}">Save</button>
                   <button class="btn btn-sm btn-secondary" data-cancel-rename>✕</button>`
                : `<span class="pl-detail-map-name">${escHtml(m.name)}</span>
                   ${isActive ? `<span class="pl-active-badge">Active</span>` : ''}`
              }
            </div>
            ${!isRenaming ? `
            <div class="pl-card-menu-wrap">
              <button class="pl-card-menu-btn" data-menu-id="map-${m.id}" title="More options">⋯</button>
              <div class="pl-card-dropdown" id="pl-menu-map-${m.id}" style="display:none">
                <button data-rename-map="${m.id}">✏ Rename</button>
                <button data-dupe-map="${m.id}">⧉ Duplicate</button>
                <button data-delete-map="${m.id}" class="pl-danger-item">🗑 Delete</button>
              </div>
            </div>` : ''}
          </div>
          <div class="pl-detail-map-meta">
            ${m.created_by
              ? `<div class="pl-detail-meta-pill"><span class="pl-detail-meta-label">Creator</span><span>${escHtml(m.created_by)}</span></div>`
              : ''}
            ${userList.length > 0
              ? `<div class="pl-detail-meta-pill"><span class="pl-detail-meta-label">Users</span><span>${userList.map(u => `<span class="pl-user-avatar" title="${escHtml(u)}">${escHtml(u.slice(0,2).toUpperCase())}</span>`).join('')}</span></div>`
              : ''}
            <div class="pl-detail-meta-pill"><span class="pl-detail-meta-label">Created</span><span>${formatDate(m.created_at)}</span></div>
            <div class="pl-detail-meta-pill"><span class="pl-detail-meta-label">Updated</span><span>${formatDate(m.updated_at)}</span></div>
          </div>
          <div class="pl-detail-map-footer">
            <button class="btn btn-sm ${isActive ? 'btn-secondary' : 'btn-primary'}"
                    data-open-map="${m.id}" ${isActive ? 'disabled' : ''}>
              ${isActive ? 'Active' : 'Open'}
            </button>
          </div>
        </div>
      </div>`;
  }

  private renderNewProjectForm(): string {
    return `
      <div class="pl-form">
        <h3 class="pl-form-title">New Project</h3>
        <div class="form-group">
          <label>Project name <span style="color:var(--color-danger)">*</span>
            <input type="text" id="pl-proj-name" placeholder="e.g. Truro Survey 2026" maxlength="60" />
          </label>
        </div>
        <div class="form-group">
          <label>Description (optional)
            <textarea id="pl-proj-desc" placeholder="What's this project about?" rows="3" maxlength="200"></textarea>
          </label>
        </div>
        <div class="form-group">
          <label>Template
            <select id="pl-proj-template">
              ${PROJECT_TEMPLATES.map((t, i) => `<option value="${t.id}"${i === 0 ? ' selected' : ''}>${escHtml(t.label)}</option>`).join('')}
            </select>
          </label>
          <p class="pl-form-hint" id="pl-proj-template-desc">${escHtml(PROJECT_TEMPLATES[0]?.description ?? '')}</p>
        </div>
        <p class="pl-form-hint">Three feature layers (Points, Lines, Polygons) are created automatically.</p>
        <div class="pl-form-actions">
          <button class="btn btn-secondary" id="pl-form-cancel">Cancel</button>
          <button class="btn btn-primary" id="pl-form-create-proj">Create Project</button>
        </div>
        <div id="pl-form-status" class="pl-form-status"></div>
      </div>`;
  }

  private renderNewMapForm(project: Project): string {
    return `
      <div class="pl-form">
        <h3 class="pl-form-title">New Map in "${escHtml(project.name)}"</h3>
        <div class="form-group">
          <label>Map name <span style="color:var(--color-danger)">*</span>
            <input type="text" id="pl-map-name" placeholder="e.g. Hydrology Overview" maxlength="60" />
          </label>
        </div>
        <p class="pl-form-hint">The new map starts with the current basemap stack. You can customise it independently.</p>
        <div class="pl-form-actions">
          <button class="btn btn-secondary" id="pl-form-cancel">Cancel</button>
          <button class="btn btn-primary" id="pl-form-create-map">Create Map</button>
        </div>
        <div id="pl-form-status" class="pl-form-status"></div>
      </div>`;
  }

  // ---- Event wiring ----

  private wireEvents(projects: Project[], _allMaps: ProjectMap[], mapsByProject: Map<string, ProjectMap[]>): void {
    this.overlay.querySelector('#pl-close')?.addEventListener('click', () => this.close());

    this.overlay.querySelector('#pl-back')?.addEventListener('click', () => {
      if (this.view === 'new-map') {
        this.view = 'project-detail';
      } else {
        this.view = 'projects';
        this.selectedProjectId = null;
      }
      void this.render();
    });

    this.overlay.querySelector<HTMLInputElement>('#pl-search')?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      void this.render();
    });

    this.overlay.querySelector<HTMLSelectElement>('#pl-sort')?.addEventListener('change', (e) => {
      this.sortMode = (e.target as HTMLSelectElement).value as 'name' | 'updated' | 'created';
      void this.render();
    });

    // Ellipsis card menus (project cards + map rows share the same markup pattern)
    const closeAllMenus = () => {
      this.overlay.querySelectorAll<HTMLElement>('.pl-card-dropdown').forEach(d => { d.style.display = 'none'; });
      this.overlay.querySelectorAll<HTMLElement>('.pl-menu-open').forEach(c => c.classList.remove('pl-menu-open'));
    };
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-menu-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.menuId!;
        const dropdown = this.overlay.querySelector<HTMLElement>(`#pl-menu-${id}`);
        if (!dropdown) return;
        const isOpen = dropdown.style.display !== 'none';
        closeAllMenus();
        if (!isOpen) {
          dropdown.style.display = 'block';
          // Lift the host card above siblings and let the menu escape its clipped bounds
          btn.closest('.pl-card, .pl-detail-map-card')?.classList.add('pl-menu-open');
        }
      });
    });

    // Close dropdowns when clicking outside
    this.overlay.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.pl-card-menu-wrap')) {
        closeAllMenus();
      }
      if (e.target === this.overlay) this.close();
    });

    this.overlay.querySelector('#pl-all-data')?.addEventListener('click', () => this.handleOpenAllData());
    this.overlay.querySelector('#pl-open-all-data')?.addEventListener('click', () => this.handleOpenAllData());

    this.overlay.querySelector('#pl-new-project')?.addEventListener('click', () => {
      this.view = 'new-project';
      void this.render();
    });

    // Sidebar: select project and show project-detail view
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-proj-select]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedProjectId = btn.dataset.projSelect!;
        this.view = 'project-detail';
        void this.render();
      });
    });

    // Project cards: "View Maps" → switch to project-detail view
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-view-proj]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedProjectId = btn.dataset.viewProj!;
        this.view = 'project-detail';
        void this.render();
      });
    });

    // Project cards: "Open" (loads first/most-recent map)
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-open-proj]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Opening…';
        await this.callbacks.onLoadProject(btn.dataset.openProj!);
        void this.render();
      });
    });

    // Map cards: "Open"
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-open-map]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Opening…';
        await this.callbacks.onLoadMap(btn.dataset.openMap!);
        this.close();
      });
    });

    // Project rename
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-rename-proj]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.renamingId = btn.dataset.renameProj!;
        this.renamingKind = 'project';
        void this.render();
        requestAnimationFrame(() => {
          const input = this.overlay.querySelector<HTMLInputElement>(`#pl-rename-input-${this.renamingId}`);
          input?.focus(); input?.select();
        });
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-save-rename-proj]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.saveRenameProj!;
        const input = this.overlay.querySelector<HTMLInputElement>(`#pl-rename-input-${id}`);
        const name = input?.value.trim() ?? '';
        if (!name) { input?.focus(); return; }
        btn.disabled = true;
        await this.callbacks.onRenameProject(id, name);
        this.renamingId = null; this.renamingKind = null;
        void this.render();
      });
    });

    // Map rename
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-rename-map]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.renamingId = btn.dataset.renameMap!;
        this.renamingKind = 'map';
        void this.render();
        requestAnimationFrame(() => {
          const input = this.overlay.querySelector<HTMLInputElement>(`#pl-rename-input-${this.renamingId}`);
          input?.focus(); input?.select();
        });
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-save-rename-map]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.saveRenameMap!;
        const input = this.overlay.querySelector<HTMLInputElement>(`#pl-rename-input-${id}`);
        const name = input?.value.trim() ?? '';
        if (!name) { input?.focus(); return; }
        btn.disabled = true;
        await this.callbacks.onRenameMap(id, name);
        this.renamingId = null; this.renamingKind = null;
        void this.render();
      });
    });

    this.overlay.querySelectorAll<HTMLButtonElement>('[data-cancel-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.renamingId = null; this.renamingKind = null;
        void this.render();
      });
    });

    this.overlay.querySelectorAll<HTMLInputElement>('.pl-rename-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const saveBtn = input.closest('.pl-card-header,.pl-detail-rename-actions,.pl-detail-map-header')
            ?.querySelector<HTMLButtonElement>('[data-save-rename-proj],[data-save-rename-map]');
          saveBtn?.click();
        } else if (e.key === 'Escape') {
          this.renamingId = null; this.renamingKind = null;
          void this.render();
        }
      });
    });

    // Project delete
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-delete-proj]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteProj!;
        const proj = projects.find(p => p.id === id);
        const mapCount = (mapsByProject.get(id) ?? []).length;
        if (!confirm(`Delete "${proj?.name ?? id}"? All features, layers, and ${mapCount} map(s) will be permanently removed.`)) return;
        btn.disabled = true;
        await this.callbacks.onDeleteProject(id);
        this.selectedProjectId = null;
        this.view = 'projects';
        void this.render();
      });
    });

    // Map delete
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-delete-map]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteMap!;
        const maps = this.selectedProjectId ? (mapsByProject.get(this.selectedProjectId) ?? []) : [];
        const m = maps.find(x => x.id === id);
        if (!confirm(`Delete map "${m?.name ?? id}"? This cannot be undone.`)) return;
        btn.disabled = true;
        await this.callbacks.onDeleteMap(id);
        void this.render();
      });
    });

    // Map duplicate
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-dupe-map]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '…';
        await this.callbacks.onDuplicateMap(btn.dataset.dupeMap!);
        void this.render();
      });
    });

    // Export bundle
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-export-proj]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.callbacks.onExportBundle(btn.dataset.exportProj!);
      });
    });

    // New map button (in project-detail view)
    this.overlay.querySelector('#pl-new-map-btn')?.addEventListener('click', () => {
      this.view = 'new-map';
      void this.render();
    });

    // New project form
    const templateSel = this.overlay.querySelector<HTMLSelectElement>('#pl-proj-template');
    const templateDesc = this.overlay.querySelector<HTMLElement>('#pl-proj-template-desc');
    templateSel?.addEventListener('change', () => {
      const t = PROJECT_TEMPLATES.find(t => t.id === templateSel.value);
      if (templateDesc) templateDesc.textContent = t?.description ?? '';
    });

    this.overlay.querySelector('#pl-form-cancel')?.addEventListener('click', () => {
      this.view = this.selectedProjectId ? 'project-detail' : 'projects';
      void this.render();
    });

    this.overlay.querySelector('#pl-form-create-proj')?.addEventListener('click', async () => {
      const nameInput = this.overlay.querySelector<HTMLInputElement>('#pl-proj-name');
      const descInput = this.overlay.querySelector<HTMLTextAreaElement>('#pl-proj-desc');
      const name = nameInput?.value.trim() ?? '';
      if (!name) { nameInput?.focus(); return; }
      const statusEl = this.overlay.querySelector<HTMLElement>('#pl-form-status');
      const btn = this.overlay.querySelector<HTMLButtonElement>('#pl-form-create-proj')!;
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await this.callbacks.onCreateProject(name, descInput?.value.trim() ?? '', templateSel?.value || undefined);
        this.view = 'projects';
        void this.render();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Create Project';
        if (statusEl) statusEl.textContent = `Error: ${(err as Error).message}`;
      }
    });

    // New map form
    this.overlay.querySelector('#pl-form-create-map')?.addEventListener('click', async () => {
      const nameInput = this.overlay.querySelector<HTMLInputElement>('#pl-map-name');
      const name = nameInput?.value.trim() ?? '';
      if (!name) { nameInput?.focus(); return; }
      const statusEl = this.overlay.querySelector<HTMLElement>('#pl-form-status');
      const btn = this.overlay.querySelector<HTMLButtonElement>('#pl-form-create-map')!;
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await this.callbacks.onCreateMap(this.selectedProjectId!, name);
        this.view = 'project-detail';
        void this.render();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Create Map';
        if (statusEl) statusEl.textContent = `Error: ${(err as Error).message}`;
      }
    });

    this.wireExportEvents();
  }

  // ---- Detail-view export wiring ----

  private wireExportEvents(): void {
    // Collapsible section toggles — flip state + class without a full re-render.
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-toggle-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggleSection as SectionKey;
        const nowOpen = !this.sectionOpen[key];
        this.sectionOpen[key] = nowOpen;
        btn.closest('.pl-detail-section')?.classList.toggle('pl-collapsed', !nowOpen);
        btn.setAttribute('aria-expanded', String(nowOpen));
        const caret = btn.querySelector('.pl-section-caret');
        if (caret) caret.textContent = nowOpen ? '▾' : '▸';
      });
    });

    // Wetland plot — edit survey form
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-wl-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.close();
        await this.callbacks.onEditWetlandPlot(btn.dataset.wlEdit!);
      });
    });

    // Inventory survey — edit metadata form
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-inv-edit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.close();
        await this.callbacks.onEditInventorySurvey(btn.dataset.invEdit!);
      });
    });

    // User Collected Data — per-preset export (GeoJSON / CSV / KML / Shapefile)
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-ds-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ds = this.detailData?.collected[Number(btn.dataset.dsExport)];
        if (!ds) return;
        const feats = this.detailFeatures.filter(f => f.layer_id === ds.layerId && featureType(f) === ds.key);
        void this.runFeatureExport(btn.dataset.fmt!, feats, ds.label);
      });
    });

    // Wetland Plots — section-level GeoJSON/CSV for all plots
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-wl-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        const plots = (this.detailData?.wetlandPlots ?? []).map(p => p.feature);
        if (plots.length === 0) return;
        void this.runFeatureExport(btn.dataset.wlExport!, plots, 'Wetland_Plots');
      });
    });

    // Wetland Plots — per-plot PDF report
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-wl-pdf]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = (this.detailData?.wetlandPlots ?? []).find(p => p.feature.id === btn.dataset.wlPdf);
        const survey = row?.feature.wetland_data;
        if (!survey) { EventBus.emit('toast', { message: 'No survey data on this plot', type: 'warning' }); return; }
        btn.disabled = true;
        try {
          EventBus.emit('toast', { message: 'Generating PDF…', type: 'info', duration: 1500 });
          await exportRecordPdf(survey, reportBaseName(survey));
        } catch (err) {
          console.error('[project-library] wetland PDF failed:', err);
          EventBus.emit('toast', { message: 'PDF export failed in this browser', type: 'error' });
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Inventory Surveys — per-survey CSV / GeoJSON / PDF
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-inv-export]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = (this.detailData?.inventorySurveys ?? []).find(r => r.survey.id === btn.dataset.invExport);
        if (!row) return;
        const fmt = btn.dataset.fmt!;
        btn.disabled = true;
        try {
          if (fmt === 'csv') invExportCSV(row.survey);
          else if (fmt === 'geojson') invExportGeoJSON(row.survey);
          else if (fmt === 'pdf') {
            EventBus.emit('toast', { message: 'Generating PDF…', type: 'info', duration: 1500 });
            const settings: AppSettings = await this.storage.getAppSettings();
            await invExportPDF(row.survey, settings);
          }
        } catch (err) {
          console.error('[project-library] inventory export failed:', err);
          EventBus.emit('toast', { message: 'Export failed in this browser', type: 'error' });
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  /** Export a feature subset via ExportManager in the requested format. */
  private async runFeatureExport(fmt: string, feats: FieldFeature[], baseName: string): Promise<void> {
    if (feats.length === 0) {
      EventBus.emit('toast', { message: 'No features to export', type: 'warning' });
      return;
    }
    try {
      if (fmt === 'geojson') await this.exporter.exportGeoJSON(feats, baseName);
      else if (fmt === 'csv') await this.exporter.exportCSV(feats, baseName);
      else if (fmt === 'kml') await this.exporter.exportKML(feats, baseName);
      else if (fmt === 'shp') await this.exporter.exportShapefile(feats, baseName);
    } catch (err) {
      console.error('[project-library] export failed:', err);
      EventBus.emit('toast', { message: `Export failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  private async handleOpenAllData(): Promise<void> {
    await this.callbacks.onLoadMap(ALL_DATA_MAP_ID);
    this.close();
  }

  private filterProjects(projects: Project[]): Project[] {
    const q = this.searchQuery.toLowerCase();
    const filtered = q
      ? projects.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q)
        )
      : [...projects];
    return filtered.sort((a, b) => {
      if (this.sortMode === 'name') return a.name.localeCompare(b.name);
      if (this.sortMode === 'updated') return b.updated_at.localeCompare(a.updated_at);
      return b.created_at.localeCompare(a.created_at);
    });
  }
}

// ---- Helpers ----

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Stable grouping key for a collected feature: its preset TYPE, or a per-layer
 *  fallback for features captured without a type. */
function featureType(f: FieldFeature): string {
  return (f.type && f.type.trim()) ? f.type.trim() : `__layer__${f.layer_id}`;
}

function geomTypeLabel(g: string | undefined): string {
  if (g === 'LineString') return 'Line';
  if (g === 'Polygon') return 'Polygon';
  if (g === 'Point') return 'Point';
  return 'Feature';
}

function projectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}
