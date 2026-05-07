import type { Project } from '../types';
import { StorageManager } from '../storage/StorageManager';

type OnLoadProject = (id: string) => Promise<void>;
type OnCreateProject = (name: string, description: string) => Promise<void>;
type OnDeleteProject = (id: string) => Promise<void>;

export class ProjectPanel {
  private panel: HTMLElement;
  private isOpen = false;
  private activeTab: 'library' | 'new' = 'library';
  private activeProjectId = 'default';

  private onLoad: OnLoadProject;
  private onCreate: OnCreateProject;
  private onDelete: OnDeleteProject;
  private storage = StorageManager.getInstance();

  constructor(
    onLoad: OnLoadProject,
    onCreate: OnCreateProject,
    onDelete: OnDeleteProject,
  ) {
    this.panel = document.getElementById('project-panel')!;
    this.onLoad = onLoad;
    this.onCreate = onCreate;
    this.onDelete = onDelete;
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
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  refresh(): void {
    if (this.isOpen) void this.render();
  }

  private async render(): Promise<void> {
    const projects = await this.storage.getAllProjects();

    // Attach feature counts
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
      </div>`;

    document.getElementById('proj-close')?.addEventListener('click', () => this.close());

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
    return `<div class="proj-list">
      ${projects.map((p, i) => {
        const isActive = p.id === this.activeProjectId;
        const date = new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        return `
          <div class="proj-item${isActive ? ' proj-active' : ''}" data-proj-id="${p.id}">
            <div class="proj-item-header">
              <span class="proj-name">${escHtml(p.name)}</span>
              ${isActive ? '<span class="proj-badge">Active</span>' : ''}
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
    this.panel.querySelectorAll<HTMLButtonElement>('[data-activate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.activate!;
        btn.disabled = true;
        btn.textContent = 'Loading…';
        await this.onLoad(id);
        void this.render();
      });
    });

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
