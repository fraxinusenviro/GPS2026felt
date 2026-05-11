import type { FieldFeature } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { PresetManager } from './PresetManager';
import { formatDistance, polygonAreaM2, lineLength } from '../utils/coordinates';

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>Save</span>
            </button>
            <button class="fe-icon-btn" id="fe-edit-geometry" title="Edit Geometry">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Geometry</span>
            </button>
            <button class="fe-icon-btn" id="fe-duplicate" title="Duplicate Feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy</span>
            </button>
            <button class="fe-icon-btn" id="fe-buffer" title="Create Buffer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 2"/></svg>
              <span>Buffer</span>
            </button>
            <button class="fe-icon-btn fe-icon-danger" id="fe-delete" title="Delete Feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
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
      const dataUrl = await this.fileToBase64(file);
      feature.photos = feature.photos ?? [];
      feature.photos.push(dataUrl);
    }
    this.render(feature);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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
        </div>`,
      confirmLabel: 'Create Buffer',
      onConfirm: () => {
        const dist = parseFloat((document.getElementById('buffer-dist') as HTMLInputElement)?.value ?? '50');
        if (isNaN(dist) || dist <= 0) return;
        EventBus.emit('buffer-feature', { geometry: feature.geometry, distanceM: dist });
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

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
