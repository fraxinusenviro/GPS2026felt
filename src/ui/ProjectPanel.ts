import type { Project } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import { PROJECT_TEMPLATES } from '../constants';

type OnLoadProject = (id: string) => Promise<void>;
type OnCreateProject = (name: string, description: string, templateId?: string) => Promise<void>;
type OnDeleteProject = (id: string) => Promise<void>;
type OnRenameProject = (id: string, name: string) => Promise<void>;
type OnDuplicateProject = (id: string) => Promise<void>;

export class ProjectPanel {
  private panel: HTMLElement;
  private isOpen = false;
  private activeTab: 'library' | 'new' = 'library';
  private activeProjectId = 'default';
  private renamingId: string | null = null;

  private onLoad: OnLoadProject;
  private onCreate: OnCreateProject;
  private onDelete: OnDeleteProject;
  private onRename: OnRenameProject;
  private onDuplicate: OnDuplicateProject;
  private storage = StorageManager.getInstance();

  constructor(
    onLoad: OnLoadProject,
    onCreate: OnCreateProject,
    onDelete: OnDeleteProject,
    onRename?: OnRenameProject,
    onDuplicate?: OnDuplicateProject,
  ) {
    this.panel = document.getElementById('project-panel')!;
    this.onLoad = onLoad;
    this.onCreate = onCreate;
    this.onDelete = onDelete;
    this.onRename = onRename ?? (async (id, name) => {
      const proj = await this.storage.getProject(id);
      if (proj) { proj.name = name; proj.updated_at = new Date().toISOString(); await this.storage.saveProject(proj); }
    });
    this.onDuplicate = onDuplicate ?? (async (_id) => {});
  }

  setActiveProjectId(id: string): void {
    this.activeProjectId = id;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private handleOutsideClick = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!this.panel.contains(target) && !(target as Element).closest?.('#btn-project')) {
      this.close();
    }
  };

  open(): void {
    this.isOpen = true;
    void this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => {
      this.panel.classList.add('open');
      setTimeout(() => document.addEventListener('click', this.handleOutsideClick), 50);
    });
  }

  close(): void {
    this.isOpen = false;
    this.renamingId = null;
    this.panel.classList.remove('open');
    document.removeEventListener('click', this.handleOutsideClick);
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 250);
  }

  refresh(): void {
    if (this.isOpen) void this.render();
  }

  private async render(): Promise<void> {
    const projects = await this.storage.getAllProjects();

    const counts = await Promise.all(
      projects.map(p => this.storage.getProjectFeatureCount(p.id))
    );

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Projects</h2>
          <button class="panel-close" id="proj-close">✕</button>
        </div>
        <div class="cache-tabs">
          <button class="cache-tab${this.activeTab === 'library' ? ' active' : ''}" data-tab="library">Library</button>
          <button class="cache-tab${this.activeTab === 'new' ? ' active' : ''}" data-tab="new">New Project</button>
        </div>
        <div class="panel-body">
          ${this.activeTab === 'library'
            ? this.renderLibraryTab(projects, counts)
            : this.renderNewTab()}
        </div>
        <div class="panel-footer">
          <button class="btn btn-primary panel-done-btn" id="proj-done">Done</button>
        </div>
      </div>`;

    document.getElementById('proj-close')?.addEventListener('click', () => this.close());
    document.getElementById('proj-done')?.addEventListener('click', () => this.close());

    this.panel.querySelectorAll<HTMLButtonElement>('.cache-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as 'library' | 'new';
        void this.render();
      });
    });

    this.wireLibrary();
    this.wireNewForm();
  }

  private renderLibraryTab(projects: Project[], counts: number[]): string {
    const masterBtn = `<button class="btn btn-outline" id="proj-master-data" style="width:100%;margin-bottom:8px">📊 Master Data — view all projects</button>`;
    const sharedBtn = `<button class="btn btn-outline" id="proj-shared-library" style="width:100%;margin-bottom:10px">☁ Shared Data Library</button>`;
    if (projects.length === 0) {
      return masterBtn + sharedBtn + '<p class="proj-empty">No projects yet. Create one to get started.</p>';
    }
    return masterBtn + sharedBtn + this.renderProjectList(projects, counts);
  }

  private renderProjectList(projects: Project[], counts: number[]): string {

    const pencilSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="11" height="11"><path d="M224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Zm5.66-58.34-96,96A8,8,0,0,1,128,168H96a8,8,0,0,1-8-8V128a8,8,0,0,1,2.34-5.66l96-96a8,8,0,0,1,11.32,0l32,32A8,8,0,0,1,229.66,69.66Zm-17-5.66L192,43.31,179.31,56,200,76.69Z"/></svg>`;
    const copySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    return `<div class="proj-list">
      ${projects.map((p, i) => {
        const isActive = p.id === this.activeProjectId;
        const isRenaming = p.id === this.renamingId;
        const date = new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const contributors = Object.keys(p.user_layer_views ?? {});
        const avatarHtml = contributors.length > 0
          ? `<div class="proj-avatars">${contributors.slice(0, 4).map(uid => `<span class="proj-avatar" title="${escHtml(uid)}">${escHtml(uid.slice(0, 2).toUpperCase())}</span>`).join('')}${contributors.length > 4 ? `<span class="proj-avatar proj-avatar-more">+${contributors.length - 4}</span>` : ''}</div>`
          : '';
        return `
          <div class="proj-item${isActive ? ' proj-active' : ''}" data-proj-id="${p.id}">
            <div class="proj-item-header">
              ${isRenaming
                ? `<input type="text" class="proj-rename-input" id="proj-rename-${p.id}"
                    value="${escHtml(p.name)}" maxlength="60" />`
                : `<span class="proj-name">${escHtml(p.name)}</span>`
              }
              ${isActive ? '<span class="proj-badge">Active</span>' : ''}
              ${avatarHtml}
              ${isRenaming
                ? `<button class="btn btn-sm btn-primary proj-rename-save-btn" data-save-rename="${p.id}">Save</button>
                   <button class="btn btn-sm btn-secondary proj-rename-cancel-btn" data-cancel-rename="${p.id}">✕</button>`
                : `<button class="btn-icon proj-rename-btn" data-rename="${p.id}" title="Rename project">${pencilSvg}</button>`
              }
            </div>
            <div class="proj-meta">${date} · ${counts[i]} feature${counts[i] !== 1 ? 's' : ''}</div>
            ${p.description ? `<div class="proj-desc">${escHtml(p.description)}</div>` : ''}
            <div class="proj-actions">
              <button class="btn btn-sm${isActive ? ' btn-secondary' : ' btn-primary'} proj-activate-btn"
                      data-activate="${p.id}" ${isActive ? 'disabled' : ''}>
                ${isActive ? 'Active' : 'Activate'}
              </button>
              <button class="btn btn-sm btn-outline proj-dupe-btn" data-dupe="${p.id}" title="Duplicate this project">${copySvg} Duplicate</button>
              <button class="btn btn-sm btn-outline proj-bundle-btn" data-bundle="${p.id}" title="Export project bundle for sharing">Export</button>
              <button class="btn btn-sm btn-danger proj-delete-btn" data-delete="${p.id}">Delete</button>
            </div>
          </div>`;
      }).join('')}
    </div>`;
  }

  private renderNewTab(): string {
    return `
      <div class="proj-new-form">
        <div class="form-group">
          <label>Project name <span style="color:var(--color-danger)">*</span>
            <input type="text" id="proj-name-input" placeholder="e.g. Truro Survey 2026" maxlength="60" />
          </label>
        </div>
        <div class="form-group">
          <label>Description (optional)
            <textarea id="proj-desc-input" placeholder="What's this project about?" rows="3" maxlength="200"></textarea>
          </label>
        </div>
        <div class="form-group">
          <label>Template
            <select id="proj-template-select">
              ${PROJECT_TEMPLATES.map((t, i) => `<option value="${t.id}"${i === 0 ? ' selected' : ''}>${escHtml(t.label)}</option>`).join('')}
            </select>
          </label>
          <p class="proj-new-hint" id="proj-template-desc" style="margin-top:4px">${escHtml(PROJECT_TEMPLATES[0]?.description ?? '')}</p>
        </div>
        <p class="proj-new-hint">Three feature layers (Points, Lines, Polygons) are ready for data collection.</p>
        <button class="btn btn-primary" id="proj-create-btn" style="width:100%">Create Project</button>
        <div id="proj-create-status" style="margin-top:8px;font-size:12px;color:var(--color-text-muted)"></div>
      </div>`;
  }

  private wireLibrary(): void {
    // Master Data — open the cross-project read-only view.
    this.panel.querySelector('#proj-master-data')?.addEventListener('click', () => {
      this.close();
      EventBus.emit('open-master-data');
    });
    this.panel.querySelector('#proj-shared-library')?.addEventListener('click', () => {
      this.close();
      EventBus.emit('open-data-library', { group: 'Static Data' });
    });

    // Activate
    this.panel.querySelectorAll<HTMLButtonElement>('[data-activate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.activate!;
        btn.disabled = true;
        btn.textContent = 'Loading…';
        await this.onLoad(id);
        void this.render();
      });
    });

    // Duplicate
    this.panel.querySelectorAll<HTMLButtonElement>('[data-dupe]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.dupe!;
        btn.disabled = true;
        btn.textContent = 'Duplicating…';
        await this.onDuplicate(id);
        void this.render();
      });
    });

    // Export bundle
    this.panel.querySelectorAll<HTMLButtonElement>('[data-bundle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.bundle!;
        btn.disabled = true;
        btn.textContent = 'Exporting…';
        EventBus.emit('export-project-bundle', { projectId: id });
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Export Bundle'; }, 2000);
      });
    });

    // Delete
    this.panel.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delete!;
        const item = btn.closest<HTMLElement>('.proj-item');
        const name = item?.querySelector('.proj-name')?.textContent ?? 'this project';
        if (!confirm(`Delete "${name}"? All features, layers, and imported files in this project will be permanently removed.`)) return;
        btn.disabled = true;
        await this.onDelete(id);
        void this.render();
      });
    });

    // Rename — enter edit mode
    this.panel.querySelectorAll<HTMLButtonElement>('[data-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.renamingId = btn.dataset.rename!;
        void this.render();
        // Focus the input after render
        requestAnimationFrame(() => {
          const input = this.panel.querySelector<HTMLInputElement>(`#proj-rename-${this.renamingId}`);
          input?.focus();
          input?.select();
        });
      });
    });

    // Rename — save
    this.panel.querySelectorAll<HTMLButtonElement>('[data-save-rename]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.saveRename!;
        const input = this.panel.querySelector<HTMLInputElement>(`#proj-rename-${id}`);
        const name = input?.value.trim() ?? '';
        if (!name) { input?.focus(); return; }
        btn.disabled = true;
        await this.onRename(id, name);
        this.renamingId = null;
        void this.render();
      });
    });

    // Rename — cancel
    this.panel.querySelectorAll<HTMLButtonElement>('[data-cancel-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.renamingId = null;
        void this.render();
      });
    });

    // Allow Enter key in rename input to save
    this.panel.querySelectorAll<HTMLInputElement>('.proj-rename-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const id = input.id.replace('proj-rename-', '');
          this.panel.querySelector<HTMLButtonElement>(`[data-save-rename="${id}"]`)?.click();
        } else if (e.key === 'Escape') {
          this.renamingId = null;
          void this.render();
        }
      });
    });
  }

  private wireNewForm(): void {
    const createBtn = document.getElementById('proj-create-btn') as HTMLButtonElement | null;
    const statusEl  = document.getElementById('proj-create-status') as HTMLElement | null;
    if (!createBtn) return;

    // Update the template description as the selection changes.
    const templateSelect = document.getElementById('proj-template-select') as HTMLSelectElement | null;
    const templateDesc = document.getElementById('proj-template-desc') as HTMLElement | null;
    templateSelect?.addEventListener('change', () => {
      const t = PROJECT_TEMPLATES.find(t => t.id === templateSelect.value);
      if (templateDesc) templateDesc.textContent = t?.description ?? '';
    });

    createBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('proj-name-input') as HTMLInputElement;
      const descInput = document.getElementById('proj-desc-input') as HTMLTextAreaElement;
      const name = nameInput?.value.trim() ?? '';
      if (!name) { nameInput?.focus(); return; }

      createBtn.disabled = true;
      createBtn.textContent = 'Creating…';
      if (statusEl) statusEl.textContent = '';

      try {
        await this.onCreate(name, descInput?.value.trim() ?? '', templateSelect?.value || undefined);
        this.activeTab = 'library';
        void this.render();
      } catch (err) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Project';
        if (statusEl) statusEl.textContent = `Error: ${(err as Error).message}`;
      }
    });
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
