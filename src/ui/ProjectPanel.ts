import type { Project } from '../types';
import { StorageManager } from '../storage/StorageManager';

type OnLoadProject = (id: string) => Promise<void>;
type OnCreateProject = (name: string, description: string) => Promise<void>;
type OnDeleteProject = (id: string) => Promise<void>;
type OnRenameProject = (id: string, name: string) => Promise<void>;

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
  private storage = StorageManager.getInstance();

  constructor(
    onLoad: OnLoadProject,
    onCreate: OnCreateProject,
    onDelete: OnDeleteProject,
    onRename?: OnRenameProject,
  ) {
    this.panel = document.getElementById('project-panel')!;
    this.onLoad = onLoad;
    this.onCreate = onCreate;
    this.onDelete = onDelete;
    this.onRename = onRename ?? (async (id, name) => {
      const proj = await this.storage.getProject(id);
      if (proj) { proj.name = name; proj.updated_at = new Date().toISOString(); await this.storage.saveProject(proj); }
    });
  }

  setActiveProjectId(id: string): void {
    this.activeProjectId = id;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.isOpen = true;
    void this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
  }

  close(): void {
    this.isOpen = false;
    this.renamingId = null;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
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
    if (projects.length === 0) {
      return '<p class="proj-empty">No projects yet. Create one to get started.</p>';
    }

    const pencilSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

    return `<div class="proj-list">
      ${projects.map((p, i) => {
        const isActive = p.id === this.activeProjectId;
        const isRenaming = p.id === this.renamingId;
        const date = new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        return `
          <div class="proj-item${isActive ? ' proj-active' : ''}" data-proj-id="${p.id}">
            <div class="proj-item-header">
              ${isRenaming
                ? `<input type="text" class="proj-rename-input" id="proj-rename-${p.id}"
                    value="${escHtml(p.name)}" maxlength="60" style="flex:1;padding:2px 6px;font-size:14px;font-weight:600;background:var(--bg-3,#243a24);border:1px solid var(--color-accent);border-radius:4px;color:var(--color-text);min-width:0" />`
                : `<span class="proj-name">${escHtml(p.name)}</span>`
              }
              ${isActive ? '<span class="proj-badge">Active</span>' : ''}
              ${isRenaming
                ? `<button class="btn btn-sm btn-primary proj-rename-save-btn" data-save-rename="${p.id}" style="padding:2px 8px;font-size:12px">Save</button>
                   <button class="btn btn-sm btn-secondary proj-rename-cancel-btn" data-cancel-rename="${p.id}" style="padding:2px 8px;font-size:12px">✕</button>`
                : `<button class="btn-icon proj-rename-btn" data-rename="${p.id}" title="Rename project" style="opacity:0.5;padding:2px">${pencilSvg}</button>`
              }
            </div>
            <div class="proj-meta">${date} · ${counts[i]} feature${counts[i] !== 1 ? 's' : ''}</div>
            ${p.description ? `<div class="proj-desc">${escHtml(p.description)}</div>` : ''}
            <div class="proj-actions">
              <button class="btn btn-sm${isActive ? ' btn-secondary' : ' btn-primary'} proj-activate-btn"
                      data-activate="${p.id}" ${isActive ? 'disabled' : ''}>
                ${isActive ? 'Active' : 'Activate'}
              </button>
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
        <p class="proj-new-hint">New projects start with ESRI Imagery, NS Property Registry, and Digital Terrain Model pre-loaded. Three feature layers (Points, Lines, Polygons) are ready for data collection.</p>
        <button class="btn btn-primary" id="proj-create-btn" style="width:100%">Create Project</button>
        <div id="proj-create-status" style="margin-top:8px;font-size:12px;color:var(--color-text-muted)"></div>
      </div>`;
  }

  private wireLibrary(): void {
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

    createBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('proj-name-input') as HTMLInputElement;
      const descInput = document.getElementById('proj-desc-input') as HTMLTextAreaElement;
      const name = nameInput?.value.trim() ?? '';
      if (!name) { nameInput?.focus(); return; }

      createBtn.disabled = true;
      createBtn.textContent = 'Creating…';
      if (statusEl) statusEl.textContent = '';

      try {
        await this.onCreate(name, descInput?.value.trim() ?? '');
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
