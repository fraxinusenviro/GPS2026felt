import type { FieldFeature } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { PresetManager } from './PresetManager';
import { formatDistance, polygonAreaM2, lineLength } from '../utils/coordinates';
import { fileToStorageDataUrl } from '../photos/imageUtils';

export class FeatureEditor {
  private panel = document.getElementById('feature-editor-panel')!;
  private currentFeature: FieldFeature | null = null;
  private storage = StorageManager.getInstance();

  constructor(private presetManager: PresetManager) {
    EventBus.on<{ feature: FieldFeature }>('feature-selected', ({ feature }) => {
      this.open(feature);
    });

    EventBus.on('feature-deselected', () => {
      this.close();
    });

    EventBus.on<{ id: string }>('feature-deleted', ({ id }) => {
      if (this.currentFeature?.id === id) this.close();
    });
  }

  open(feature: FieldFeature): void {
    this.currentFeature = feature;
    this.render(feature);
    this.panel.style.display = 'block';
    requestAnimationFrame(() => this.panel.classList.add('open'));
  }

  close(): void {
    this.currentFeature = null;
    this.panel.classList.remove('open');
    setTimeout(() => {
      if (!this.currentFeature) this.panel.style.display = 'none';
    }, 300);
  }

  private render(feature: FieldFeature): void {
    const presets = this.presetManager.getPresetsForGeomType(feature.geometry_type);
    const geometrySummary = this.getGeometrySummary(feature);

    this.panel.innerHTML = `
      <div class="feature-editor-inner">
        <div class="panel-header">
          <h3>Edit Feature</h3>
          <button class="panel-close" id="fe-close">✕</button>
        </div>
        <div class="panel-body">
          <div class="fe-badge">${feature.geometry_type} · ${feature.capture_method}</div>
          <div class="fe-point-id">${feature.point_id}</div>
          <div class="fe-geom-info">${geometrySummary}</div>

          <div class="form-group">
            <label>Type</label>
            <select id="fe-type">
              <option value="">None</option>
              ${presets.map(p => `<option value="${p.label}" ${p.label === feature.type ? 'selected' : ''}>${p.label}</option>`).join('')}
              <option value="${feature.type}" ${!presets.find(p => p.label === feature.type) ? 'selected' : ''}>${feature.type || '-- custom --'}</option>
            </select>
          </div>

          <div class="form-group">
            <label>Description</label>
            <input type="text" id="fe-desc" value="${this.escape(feature.desc)}" placeholder="Enter description..." />
          </div>

          <div class="form-group">
            <label>Notes</label>
            <textarea id="fe-notes" rows="3" placeholder="Additional notes...">${this.escape(feature.notes)}</textarea>
          </div>

          <div class="fe-meta">
            <div><b>Created:</b> ${new Date(feature.created_at).toLocaleString()}</div>
            <div><b>Updated:</b> ${new Date(feature.updated_at).toLocaleString()}</div>
            <div><b>By:</b> ${feature.created_by}</div>
            ${feature.accuracy !== null ? `<div><b>GPS Accuracy:</b> ±${feature.accuracy.toFixed(1)}m</div>` : ''}
            ${feature.elevation !== null ? `<div><b>Elevation:</b> ${feature.elevation?.toFixed(1)}m</div>` : ''}
          </div>

          <div class="form-group">
            <label>Photos</label>
            <input type="file" id="fe-photo" accept="image/*" capture="environment" multiple />
            <div id="fe-photos-preview" class="photos-preview">
              ${(feature.photos ?? []).map((p, i) => `
                <div class="photo-thumb">
                  <img src="${p}" alt="Photo ${i + 1}" />
                  <button class="photo-del" data-idx="${i}">✕</button>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="fe-icon-actions">
            <button class="fe-icon-btn fe-icon-primary" id="fe-save" title="Save Changes">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M219.31,72,184,36.69A15.86,15.86,0,0,0,172.69,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V83.31A15.86,15.86,0,0,0,219.31,72ZM208,208H184V152a16,16,0,0,0-16-16H88a16,16,0,0,0-16,16v56H48V48H172.69L208,83.31ZM160,72a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h56A8,8,0,0,1,160,72Z"/></svg>
              <span>Save</span>
            </button>
            <button class="fe-icon-btn" id="fe-edit-geometry" title="Edit Geometry">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128v80a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32h80a8,8,0,0,1,0,16H48V208H208V128a8,8,0,0,1,16,0Zm5.66-58.34-96,96A8,8,0,0,1,128,168H96a8,8,0,0,1-8-8V128a8,8,0,0,1,2.34-5.66l96-96a8,8,0,0,1,11.32,0l32,32A8,8,0,0,1,229.66,69.66Zm-17-5.66L192,43.31,179.31,56,200,76.69Z"/></svg>
              <span>Geometry</span>
            </button>
            <button class="fe-icon-btn" id="fe-duplicate" title="Duplicate Feature">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M192,72V216a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V72a8,8,0,0,1,8-8H184A8,8,0,0,1,192,72Zm24-40H72a8,8,0,0,0,0,16H208V184a8,8,0,0,0,16,0V40A8,8,0,0,0,216,32Z"/></svg>
              <span>Copy</span>
            </button>
            <button class="fe-icon-btn" id="fe-move" title="Move to another project">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,181.66l-32,32a8,8,0,0,1-11.32-11.32L188.69,184H48a8,8,0,0,1,0-16H188.69l-18.35-18.34a8,8,0,0,1,11.32-11.32l32,32A8,8,0,0,1,213.66,181.66Zm-139.32-64a8,8,0,0,0,11.32-11.32L67.31,88H208a8,8,0,0,0,0-16H67.31L85.66,53.66A8,8,0,0,0,74.34,42.34l-32,32a8,8,0,0,0,0,11.32Z"/></svg>
              <span>Move</span>
            </button>
            <button class="fe-icon-btn" id="fe-buffer" title="Create Buffer">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M176,136h23.54A72.11,72.11,0,0,1,136,199.54V176a8,8,0,0,0-16,0v23.54A72.11,72.11,0,0,1,56.46,136H80a8,8,0,0,0,0-16H56.46A72.11,72.11,0,0,1,120,56.46V80a8,8,0,0,0,16,0V56.46A72.11,72.11,0,0,1,199.54,120H176a8,8,0,0,0,0,16Zm56-8A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>
              <span>Buffer</span>
            </button>
            <button class="fe-icon-btn fe-icon-danger" id="fe-delete" title="Delete Feature">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM112,168a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm0-120H96V40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8Z"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.panel.querySelector('#fe-close')?.addEventListener('click', () => {
      this.close();
      EventBus.emit('feature-deselected', {});
    });

    this.panel.querySelector('#fe-save')?.addEventListener('click', () => this.save());
    this.panel.querySelector('#fe-duplicate')?.addEventListener('click', () => void this.duplicate(feature));
    this.panel.querySelector('#fe-move')?.addEventListener('click', () => void this.promptMove(feature));
    this.panel.querySelector('#fe-buffer')?.addEventListener('click', () => this.promptBuffer(feature));
    this.panel.querySelector('#fe-delete')?.addEventListener('click', () => this.delete(feature.id));
    this.panel.querySelector('#fe-edit-geometry')?.addEventListener('click', () => {
      const feat = this.currentFeature;
      if (!feat) return;
      this.close();
      EventBus.emit('feature-deselected', {});
      // Small delay so the panel closes before the editor overlay appears
      setTimeout(() => {
        EventBus.emit('edit-geometry-start', { feature: feat });
        EventBus.emit('tool-changed', { tool: 'edit-geometry' });
      }, 50);
    });

    // Photo upload
    this.panel.querySelector<HTMLInputElement>('#fe-photo')?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) this.addPhotos(feature, Array.from(files));
    });

    // Photo delete
    this.panel.querySelectorAll<HTMLButtonElement>('.photo-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx ?? '0');
        feature.photos.splice(idx, 1);
        this.render(feature);
      });
    });
  }

  private getGeometrySummary(feature: FieldFeature): string {
    const g = feature.geometry;
    if (g.type === 'Point') {
      const [lon, lat] = g.coordinates as [number, number];
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    } else if (g.type === 'LineString') {
      const coords = g.coordinates as Array<[number, number]>;
      const len = lineLength(coords);
      return `${coords.length} vertices · ${formatDistance(len)}`;
    } else {
      const coords = g.coordinates[0] as Array<[number, number]>;
      const area = polygonAreaM2(coords);
      return `${coords.length} vertices · ${(area / 10000).toFixed(3)} ha`;
    }
  }

  private async addPhotos(feature: FieldFeature, files: File[]): Promise<void> {
    for (const file of files) {
      // Downscale before storing — full-resolution camera photos crash mobile.
      const dataUrl = await fileToStorageDataUrl(file);
      if (!dataUrl) continue;
      feature.photos = feature.photos ?? [];
      feature.photos.push(dataUrl);
    }
    this.render(feature);
  }

  private async save(): Promise<void> {
    if (!this.currentFeature) return;

    this.currentFeature.type = (this.panel.querySelector<HTMLSelectElement>('#fe-type')?.value ?? '');
    this.currentFeature.desc = (this.panel.querySelector<HTMLInputElement>('#fe-desc')?.value ?? '');
    this.currentFeature.notes = (this.panel.querySelector<HTMLTextAreaElement>('#fe-notes')?.value ?? '');
    this.currentFeature.updated_at = new Date().toISOString();

    await this.storage.saveFeature(this.currentFeature);
    EventBus.emit('feature-updated', { feature: this.currentFeature });
    EventBus.emit('toast', { message: 'Feature saved', type: 'success' });
    this.close();
  }

  private async delete(id: string): Promise<void> {
    if (!confirm('Delete this feature? This cannot be undone.')) return;
    await this.storage.deleteFeature(id);
    EventBus.emit('feature-deleted', { id });
    EventBus.emit('toast', { message: 'Feature deleted', type: 'warning' });
  }

  private promptBuffer(feature: FieldFeature): void {
    const polyPresets = this.presetManager.getPresetsForGeomType('Polygon');
    const typeSelectHtml = polyPresets.length > 0 ? `
      <div class="form-group" style="margin-top:10px">
        <label>Assign Type
          <select id="buffer-type">
            <option value="">None</option>
            ${polyPresets.map(p => `<option value="${p.label}">${p.label}</option>`).join('')}
          </select>
        </label>
      </div>` : '';
    EventBus.emit('show-modal', {
      title: 'Create Buffer',
      html: `
        <div class="form-group">
          <label>Buffer Distance (metres)
            <input type="number" id="buffer-dist" value="50" min="1" max="100000" step="1" style="width:100%" />
          </label>
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">
            Creates a polygon buffer around the selected ${feature.geometry_type.toLowerCase()}.
          </div>
        </div>
        ${typeSelectHtml}`,
      confirmLabel: 'Create Buffer',
      onConfirm: () => {
        const dist = parseFloat((document.getElementById('buffer-dist') as HTMLInputElement)?.value ?? '50');
        if (isNaN(dist) || dist <= 0) return;
        const typeLabel = (document.getElementById('buffer-type') as HTMLSelectElement | null)?.value ?? '';
        EventBus.emit('buffer-feature', { geometry: feature.geometry, distanceM: dist, typeLabel });
      },
      onCancel: () => {},
    });
    requestAnimationFrame(() => {
      (document.getElementById('buffer-dist') as HTMLInputElement | null)?.select();
    });
  }

  private async duplicate(feature: FieldFeature): Promise<void> {
    const now = new Date().toISOString();
    const offsetDeg = 0.00005; // ~5m
    const cloneGeom = JSON.parse(JSON.stringify(feature.geometry)) as typeof feature.geometry;
    const shiftCoord = (c: number[]) => [c[0] + offsetDeg, c[1] + offsetDeg, ...(c.length > 2 ? [c[2]] : [])];
    if (cloneGeom.type === 'Point') {
      cloneGeom.coordinates = shiftCoord(cloneGeom.coordinates as number[]) as [number, number];
    } else if (cloneGeom.type === 'LineString') {
      cloneGeom.coordinates = (cloneGeom.coordinates as number[][]).map(shiftCoord) as [number, number][];
    } else {
      cloneGeom.coordinates = (cloneGeom.coordinates as number[][][]).map(ring => ring.map(shiftCoord)) as [number, number][][];
    }
    const clone: FieldFeature = {
      ...feature,
      id: crypto.randomUUID(),
      point_id: `${feature.point_id}-copy`,
      geometry: cloneGeom,
      created_at: now,
      updated_at: now,
      photos: [],
    };
    await this.storage.saveFeature(clone);
    EventBus.emit('feature-added', { feature: clone });
    EventBus.emit('toast', { message: 'Feature duplicated', type: 'success', duration: 1500 });
  }

  private async promptMove(feature: FieldFeature): Promise<void> {
    const projects = (await this.storage.getAllProjects()).filter(p => p.id !== feature.project_id);
    if (projects.length === 0) {
      EventBus.emit('toast', { message: 'No other project to move into — create one first', type: 'info', duration: 3000 });
      return;
    }
    const options = projects.map(p => `<option value="${this.escape(p.id)}">${this.escape(p.name)}</option>`).join('');
    EventBus.emit('show-modal', {
      title: 'Move feature',
      html: `
        <p style="margin:0 0 8px">Move this feature to another project:</p>
        <select id="fe-move-target" style="width:100%;padding:6px">${options}</select>
      `,
      confirmLabel: 'Move',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        const sel = document.getElementById('fe-move-target') as HTMLSelectElement | null;
        const targetId = sel?.value;
        if (!targetId) return;
        const target = projects.find(p => p.id === targetId);
        await this.storage.reassignFeaturesToProject([feature], targetId);
        EventBus.emit('features-reassigned', { ids: [feature.id] });
        this.close();
        EventBus.emit('toast', {
          message: `Feature moved to "${target?.name ?? 'project'}"`,
          type: 'success', duration: 2500,
        });
      },
      onCancel: () => {},
    });
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
