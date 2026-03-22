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

          <div class="fe-actions">
            <button class="btn-primary" id="fe-save">Save Changes</button>
            <button class="btn-outline" id="fe-edit-geometry">Edit Geometry</button>
            <button class="btn-outline btn-danger" id="fe-delete">Delete Feature</button>
          </div>
        </div>
      </div>
    `;

    this.panel.querySelector('#fe-close')?.addEventListener('click', () => {
      this.close();
      EventBus.emit('feature-deselected', {});
    });

    this.panel.querySelector('#fe-save')?.addEventListener('click', () => this.save());
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

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
