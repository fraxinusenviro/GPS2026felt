import type { AppSettings } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { CaptureManager } from '../capture/CaptureManager';
import { readExif, hasExifLocation, type ExifData } from './exif';
import { buildPhotoFeature } from './photoFeature';

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

interface BatchItem {
  id: string;
  dataUrl: string;
  exif: ExifData;
  lat: number | null;
  lon: number | null;
  elevation: number | null;
  accuracy: number | null;
  bearing: number | null;
  source: 'gps' | 'exif' | 'none';
  caption: string;
  createdAt?: string;
  include: boolean;
}

/**
 * Batch-import flow: pick many photos at once, read each one's EXIF for
 * coordinates / bearing / date, review and caption them in a grid, then save
 * all selected photos as Photo Points in one pass.
 */
export class PhotoBatchPanel {
  private overlay: HTMLElement | null = null;
  private storage = StorageManager.getInstance();
  private items: BatchItem[] = [];
  private observer = '';
  private busy = false;

  constructor(
    private captureManager: CaptureManager,
    private getSettings: () => AppSettings,
  ) {}

  open(): void {
    this.items = [];
    this.observer = this.getSettings().user_id ?? '';
    this.render();
    // Immediately prompt for files.
    setTimeout(() => this.overlay?.querySelector<HTMLInputElement>('#pb-file-input')?.click(), 50);
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.items = [];
  }

  private esc(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private async addFiles(files: FileList): Promise<void> {
    const gps = this.captureManager.getGPSState();
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    let idx = this.items.length;
    for (const file of list) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;
      const exif = await readExif(file);

      let lat: number | null = null, lon: number | null = null;
      let elevation: number | null = null, accuracy: number | null = null;
      let source: BatchItem['source'] = 'none';
      if (hasExifLocation(exif)) {
        lat = exif.lat; lon = exif.lon; elevation = exif.altitude ?? null; source = 'exif';
      } else if (gps.available) {
        lat = gps.lat; lon = gps.lon; elevation = gps.elevation; accuracy = gps.accuracy; source = 'gps';
      }

      this.items.push({
        id: `pb-${idx++}`,
        dataUrl,
        exif,
        lat, lon, elevation, accuracy,
        bearing: exif.bearing,
        source,
        caption: '',
        createdAt: exif.dateTime ?? undefined,
        include: source !== 'none',
      });
    }
    this.renderBody();
  }

  private render(): void {
    let overlay = document.getElementById('photo-batch-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'photo-batch-overlay';
      overlay.className = 'pv-overlay';
      document.body.appendChild(overlay);
    }
    this.overlay = overlay;

    overlay.innerHTML = `
      <div class="pv-backdrop" id="pb-backdrop"></div>
      <div class="pv-modal pb-modal" role="dialog" aria-modal="true">
        <div class="pv-header">
          <span class="pv-title">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18"><path d="M216,40H72A16,16,0,0,0,56,56V72H40A16,16,0,0,0,24,88V200a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V184h16a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM184,200H40V88H56v80a16,16,0,0,0,16,16H184Z"/></svg>
            Batch Add Photos
          </span>
          <button class="pv-close" id="pb-close" title="Close">✕</button>
        </div>

        <div class="pb-toolbar">
          <label class="btn-outline pb-tool-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M224,152a8,8,0,0,1-8,8H160v56a8,8,0,0,1-16,0V160H88a8,8,0,0,1,0-16h56V88a8,8,0,0,1,16,0v56h56A8,8,0,0,1,224,152Z"/></svg>
            Add more
            <input type="file" id="pb-file-input" accept="image/*" multiple style="display:none" />
          </label>
          <div class="pb-observer">
            <label>Observer</label>
            <input type="text" id="pb-observer" class="felt-input" value="${this.esc(this.observer)}" placeholder="Initials / name" />
          </div>
        </div>

        <div class="pv-body pb-body" id="pb-body"></div>

        <div class="pv-footer">
          <button class="pv-btn" id="pb-cancel">Cancel</button>
          <button class="pv-btn pv-btn-primary" id="pb-save">Save Photos</button>
        </div>
      </div>`;

    overlay.querySelector('#pb-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#pb-cancel')?.addEventListener('click', () => this.close());
    overlay.querySelector('#pb-backdrop')?.addEventListener('click', () => this.close());
    overlay.querySelector('#pb-save')?.addEventListener('click', () => void this.saveAll());

    overlay.querySelector<HTMLInputElement>('#pb-observer')?.addEventListener('input', (e) => {
      this.observer = (e.target as HTMLInputElement).value;
    });

    overlay.querySelector<HTMLInputElement>('#pb-file-input')?.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files.length) void this.addFiles(input.files);
      input.value = '';
    });

    this.renderBody();
  }

  private renderBody(): void {
    const body = this.overlay?.querySelector<HTMLElement>('#pb-body');
    if (!body) return;

    if (this.items.length === 0) {
      body.innerHTML = `<div class="pb-empty">No photos selected yet.<br>Use <strong>Add more</strong> to choose photos from your library or files.</div>`;
      this.updateSaveLabel();
      return;
    }

    const sourceBadge = (it: BatchItem): string => {
      if (it.source === 'exif') return '<span class="pb-badge pb-badge-ok">EXIF location</span>';
      if (it.source === 'gps') return '<span class="pb-badge pb-badge-warn">Current GPS</span>';
      return '<span class="pb-badge pb-badge-bad">No location</span>';
    };

    body.innerHTML = `<div class="pb-grid">${this.items.map(it => {
      const coords = it.lat != null && it.lon != null
        ? `${it.lat.toFixed(5)}°, ${it.lon.toFixed(5)}°` : '—';
      const bearing = it.bearing != null
        ? `${Math.round(it.bearing)}° ${bearingToCardinal(it.bearing)}` : '—';
      const disabled = it.source === 'none';
      return `
        <div class="pb-card${it.include ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}" data-id="${it.id}">
          <label class="pb-card-sel">
            <input type="checkbox" class="pb-include" data-id="${it.id}" ${it.include ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          </label>
          <div class="pb-thumb"><img src="${it.dataUrl}" alt="" /></div>
          <div class="pb-meta">
            <div class="pb-meta-row">${sourceBadge(it)}</div>
            <div class="pb-meta-line"><span>📍</span> ${coords}</div>
            <div class="pb-meta-line"><span>🧭</span> ${bearing}</div>
            <input type="text" class="felt-input pb-caption" data-id="${it.id}" value="${this.esc(it.caption)}" placeholder="Caption (optional)" />
          </div>
        </div>`;
    }).join('')}</div>`;

    body.querySelectorAll<HTMLInputElement>('.pb-include').forEach(cb => {
      cb.addEventListener('change', () => {
        const it = this.items.find(i => i.id === cb.dataset.id);
        if (it) { it.include = cb.checked; cb.closest('.pb-card')?.classList.toggle('is-on', cb.checked); }
        this.updateSaveLabel();
      });
    });
    body.querySelectorAll<HTMLInputElement>('.pb-caption').forEach(inp => {
      inp.addEventListener('input', () => {
        const it = this.items.find(i => i.id === inp.dataset.id);
        if (it) it.caption = inp.value;
      });
    });

    this.updateSaveLabel();
  }

  private updateSaveLabel(): void {
    const n = this.items.filter(i => i.include).length;
    const btn = this.overlay?.querySelector<HTMLButtonElement>('#pb-save');
    if (btn) {
      btn.textContent = n > 0 ? `Save ${n} Photo${n !== 1 ? 's' : ''}` : 'Save Photos';
      btn.disabled = n === 0 || this.busy;
    }
  }

  private async saveAll(): Promise<void> {
    if (this.busy) return;
    const selected = this.items.filter(i => i.include && i.lat != null && i.lon != null);
    if (selected.length === 0) {
      EventBus.emit('toast', { message: 'No photos with a location are selected', type: 'warning' });
      return;
    }

    this.busy = true;
    this.updateSaveLabel();
    const settings = this.getSettings();
    const projectId = settings.active_project_id ?? 'default';
    const layerId = `${projectId}-photos`;
    const observer = (this.observer || settings.user_id || 'USER').trim();

    let saved = 0;
    for (const it of selected) {
      const feature = buildPhotoFeature({
        photoDataUrl: it.dataUrl,
        lat: it.lat!,
        lon: it.lon!,
        elevation: it.elevation,
        accuracy: it.accuracy,
        bearing: it.bearing ?? 0,
        observer,
        notes: '',
        caption: it.caption,
        source: it.source === 'none' ? 'gps' : it.source,
        createdAt: it.createdAt,
        projectId,
        layerId,
      });
      await this.storage.saveFeature(feature);
      EventBus.emit('feature-added', { feature });
      saved++;
    }

    this.busy = false;
    EventBus.emit('toast', { message: `${saved} photo point${saved !== 1 ? 's' : ''} saved`, type: 'success' });
    this.close();
  }
}
