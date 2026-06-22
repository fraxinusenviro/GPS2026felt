import type { Project, ProjectMap } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { PROJECT_TEMPLATES } from '../constants';

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
  getActiveMapId: () => string;
}

type View = 'projects' | 'project-detail' | 'new-project' | 'new-map';

const PROJECT_COLORS = [
  '#4f8ef7', '#34c97e', '#f5a623', '#e84393', '#9b59b6',
  '#1abc9c', '#e67e22', '#e74c3c', '#3498db', '#2ecc71',
];

export class ProjectLibraryModal {
  private overlay: HTMLElement;
  private storage = StorageManager.getInstance();
  private callbacks!: ProjectLibraryCallbacks;

  private view: View = 'projects';
  private selectedProjectId: string | null = null;
  private searchQuery = '';
  private sortMode: 'name' | 'updated' | 'created' = 'name';
  private renamingId: string | null = null;
  private renamingKind: 'project' | 'map' | null = null;

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

    // Total feature count for the selected project (shown in project header only)
    let projectFeatureCount = 0;
    if (this.view === 'project-detail' && this.selectedProjectId) {
      try {
        const features = await this.storage.getFeaturesByProject(this.selectedProjectId);
        projectFeatureCount = features.length;
      } catch { /* non-fatal */ }
    }

    this.overlay.innerHTML = `
      <div class="pl-modal">
        <div class="pl-header">
          <div class="pl-header-left">
            ${this.view === 'project-detail' || this.view === 'new-map'
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

        <div class="pl-body">
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
            ${this.view === 'project-detail' && selectedProject ? this.renderProjectDetailView(selectedProject, mapsForSelected, activeMapId, projectFeatureCount) : ''}
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
        <div class="pl-card-thumb" style="background: linear-gradient(135deg, ${color}33, ${color}99)">
          <span class="pl-card-thumb-icon">🗺</span>
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
                   <button class="pl-card-menu-btn" data-menu-proj="${p.id}" title="More options">⋯</button>
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
    totalFeatures: number,
  ): string {
    const color = project.color ?? projectColor(project.id);
    const isRenaming = this.renamingId === project.id && this.renamingKind === 'project';

    return `
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
          <span class="pl-detail-meta-item">📍 ${totalFeatures} feature${totalFeatures !== 1 ? 's' : ''}</span>
          <span class="pl-detail-meta-item">Updated ${formatDate(project.updated_at)}</span>
          <span class="pl-detail-meta-item">Created ${formatDate(project.created_at)}</span>
        </div>
        <div class="pl-detail-proj-actions">
          <button class="btn btn-sm btn-outline" data-rename-proj="${project.id}">✏ Rename</button>
          <button class="btn btn-sm btn-outline" data-export-proj="${project.id}">⬇ Export</button>
          <button class="btn btn-sm btn-outline pl-danger-btn" data-delete-proj="${project.id}">🗑 Delete</button>
        </div>
      </div>

      <div class="pl-detail-maps-section">
        <div class="pl-detail-maps-toolbar">
          <span class="pl-detail-section-title">Maps</span>
          <button class="btn btn-sm btn-primary" id="pl-new-map-btn">+ New Map</button>
        </div>
        ${maps.length === 0
          ? `<p class="pl-empty">No maps yet. Create one to get started.</p>`
          : maps.map(m => this.renderDetailMapCard(m, activeMapId)).join('')
        }
      </div>`;
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
        <div class="pl-detail-map-header">
          <div class="pl-detail-map-title-row">
            <span class="pl-map-thumb-icon" style="font-size:18px">🗺</span>
            ${isRenaming
              ? `<input class="pl-rename-input" id="pl-rename-input-${m.id}" value="${escHtml(m.name)}" maxlength="60" />
                 <button class="btn btn-sm btn-primary" data-save-rename-map="${m.id}">Save</button>
                 <button class="btn btn-sm btn-secondary" data-cancel-rename>✕</button>`
              : `<span class="pl-detail-map-name">${escHtml(m.name)}</span>
                 ${isActive ? `<span class="pl-active-badge">Active</span>` : ''}`
            }
          </div>
          ${!isRenaming ? `
          <div class="pl-card-actions">
            <button class="pl-icon-btn" data-rename-map="${m.id}" title="Rename map">✏</button>
            <button class="pl-icon-btn" data-dupe-map="${m.id}" title="Duplicate map">⧉</button>
            <button class="pl-icon-btn pl-danger-btn" data-delete-map="${m.id}" title="Delete map">🗑</button>
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

    // Ellipsis card menus
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-menu-proj]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.menuProj!;
        const dropdown = this.overlay.querySelector<HTMLElement>(`#pl-menu-${id}`);
        if (!dropdown) return;
        const isOpen = dropdown.style.display !== 'none';
        // Close all dropdowns
        this.overlay.querySelectorAll<HTMLElement>('.pl-card-dropdown').forEach(d => { d.style.display = 'none'; });
        if (!isOpen) dropdown.style.display = 'block';
      });
    });

    // Close dropdowns when clicking outside
    this.overlay.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.pl-card-menu-wrap')) {
        this.overlay.querySelectorAll<HTMLElement>('.pl-card-dropdown').forEach(d => { d.style.display = 'none'; });
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

function projectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}
