import type { AppSettings } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { CaptureManager } from '../capture/CaptureManager';
import { readExif, hasExifLocation, type ExifData } from './exif';
import { buildPhotoFeature } from './photoFeature';
import type { PhotoBatchPanel } from './PhotoBatchPanel';

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

type EffectiveLocation = {
  lat: number; lon: number; elevation: number | null; accuracy: number | null;
  source: 'gps' | 'exif'; available: boolean;
};

export class PhotoCapturePanel {
  private panel = document.getElementById('photo-capture-panel')!;
  private isOpen = false;
  private storage = StorageManager.getInstance();
  private photoDataUrl = '';
  private bearing = 0;
  private compassLive = false;
  private orientationListener: ((e: DeviceOrientationEvent) => void) | null = null;
  // EXIF state for the currently-loaded photo.
  private exif: ExifData | null = null;
  private bearingLocked = false; // true once EXIF supplies a bearing — stops the compass overwriting it
  private batchPanel: PhotoBatchPanel | null = null;

  constructor(
    private captureManager: CaptureManager,
    private getSettings: () => AppSettings,
  ) {}

  /** Wire up the batch-add panel (called once during app init). */
  setBatchPanel(panel: PhotoBatchPanel): void {
    this.batchPanel = panel;
  }

  open(): void {
    this.isOpen = true;
    this.photoDataUrl = '';
    this.exif = null;
    this.bearingLocked = false;
    this.render();
    this.panel.style.display = 'flex';
    requestAnimationFrame(() => this.panel.classList.add('open'));
    void this.requestCompass();
  }

  close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    this.stopCompass();
    setTimeout(() => { if (!this.isOpen) this.panel.style.display = 'none'; }, 300);
  }

  private async requestCompass(): Promise<void> {
    // iOS 13+ requires permission
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission();
        if (result !== 'granted') return;
      } catch {
        return;
      }
    }

    this.orientationListener = (e: DeviceOrientationEvent) => {
      if (this.bearingLocked) return; // EXIF direction takes precedence
      const ext = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      let heading: number | null = null;
      if (ext.webkitCompassHeading != null) {
        heading = ext.webkitCompassHeading;
      } else if (e.absolute && e.alpha != null) {
        heading = (360 - e.alpha) % 360;
      }
      if (heading != null) {
        this.compassLive = true;
        this.bearing = Math.round(heading);
        this.updateBearingDisplay();
      }
    };

    window.addEventListener('deviceorientationabsolute' as keyof WindowEventMap, this.orientationListener as EventListener, { passive: true });
    // Fallback: also try regular deviceorientation if absolute not firing
    setTimeout(() => {
      if (!this.compassLive && this.orientationListener) {
        window.addEventListener('deviceorientation', this.orientationListener as EventListener, { passive: true });
      }
    }, 1000);
  }

  private stopCompass(): void {
    if (this.orientationListener) {
      window.removeEventListener('deviceorientationabsolute' as keyof WindowEventMap, this.orientationListener as EventListener);
      window.removeEventListener('deviceorientation', this.orientationListener as EventListener);
      this.orientationListener = null;
    }
    this.compassLive = false;
  }

  private updateBearingDisplay(): void {
    const bearingVal = this.panel.querySelector<HTMLElement>('.photo-bearing-value');
    const bearingCard = this.panel.querySelector<HTMLElement>('.photo-bearing-cardinal');
    const sliderEl = this.panel.querySelector<HTMLInputElement>('#photo-bearing-slider');
    const numberEl = this.panel.querySelector<HTMLInputElement>('#photo-bearing-number');
    const compassArrow = this.panel.querySelector<SVGElement>('.compass-arrow');

    if (bearingVal) bearingVal.textContent = `${Math.round(this.bearing)}°`;
    if (bearingCard) bearingCard.textContent = bearingToCardinal(this.bearing);
    if (sliderEl) sliderEl.value = String(Math.round(this.bearing));
    if (numberEl) numberEl.value = String(Math.round(this.bearing));
    if (compassArrow) compassArrow.setAttribute('transform', `rotate(${this.bearing}, 24, 24)`);
  }

  /** Coordinates to save: EXIF location when available, otherwise the live GPS fix. */
  private getEffectiveLocation(): EffectiveLocation {
    if (this.exif && hasExifLocation(this.exif)) {
      return {
        lat: this.exif.lat!, lon: this.exif.lon!,
        elevation: this.exif.altitude ?? null, accuracy: null,
        source: 'exif', available: true,
      };
    }
    const gps = this.captureManager.getGPSState();
    return {
      lat: gps.lat, lon: gps.lon, elevation: gps.elevation, accuracy: gps.accuracy,
      source: 'gps', available: gps.available,
    };
  }

  private locationHtml(loc: EffectiveLocation): string {
    if (!loc.available) return '<em>Waiting for GPS fix…</em>';
    const tag = loc.source === 'exif'
      ? '<span style="color:var(--color-accent);font-size:11px;margin-left:4px">● from photo EXIF</span>'
      : '';
    return `<strong>Lat:</strong> ${loc.lat.toFixed(6)}° &nbsp; <strong>Lon:</strong> ${loc.lon.toFixed(6)}°${tag}`
      + `${loc.elevation != null ? `<br><strong>Elev:</strong> ${loc.elevation.toFixed(1)} m` : ''}`
      + `${loc.accuracy != null ? ` &nbsp; <strong>Acc:</strong> ±${loc.accuracy.toFixed(0)} m` : ''}`;
  }

  private refreshLocationDisplay(): void {
    const gpsEl = this.panel.querySelector<HTMLElement>('#photo-gps-display');
    if (gpsEl) gpsEl.innerHTML = this.locationHtml(this.getEffectiveLocation());
  }

  /** Read a selected file: preview it and pull coordinates/bearing from its EXIF. */
  private async loadFile(file: File): Promise<void> {
    // Show preview immediately.
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
    this.photoDataUrl = dataUrl;
    const img = this.panel.querySelector<HTMLImageElement>('#photo-preview-img');
    const placeholder = this.panel.querySelector<HTMLElement>('#photo-placeholder');
    if (img) { img.src = dataUrl; img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';

    // Pull EXIF (no-op for camera captures / stripped images).
    this.exif = await readExif(file);
    const exifNote = this.panel.querySelector<HTMLElement>('#photo-exif-note');

    if (this.exif.bearing != null) {
      this.bearing = Math.round(this.exif.bearing);
      this.bearingLocked = true;
      this.compassLive = false;
      this.stopCompass();
      this.updateBearingDisplay();
    }

    this.refreshLocationDisplay();

    if (exifNote) {
      const parts: string[] = [];
      if (hasExifLocation(this.exif)) parts.push('location');
      if (this.exif.bearing != null) parts.push('bearing');
      if (this.exif.dateTime) parts.push('date/time');
      exifNote.innerHTML = parts.length
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12" style="vertical-align:-2px;margin-right:3px"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,48a12,12,0,1,1,12,12A12,12,0,0,1,120,72Zm24,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z"/></svg>Imported from photo EXIF: ${parts.join(', ')}.`
        : 'No EXIF location in this photo — using live GPS / manual bearing.';
      exifNote.style.display = 'block';
    }
  }

  private render(): void {
    const settings = this.getSettings();
    const observer = settings.user_id ?? '';
    const loc = this.getEffectiveLocation();

    this.panel.innerHTML = `
      <div class="side-panel-inner">
        <div class="panel-header">
          <h2>Add Photo Point</h2>
          <button class="panel-close" id="photo-capture-close">✕</button>
        </div>
        <div class="panel-body">
          <div class="export-section">

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-80,32a44,44,0,1,1-44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,0-28-28A28,28,0,0,0,128,160Z"/></svg>
                Photo
              </h4>
              <div id="photo-preview-area" style="position:relative;background:rgba(0,0,0,0.3);border-radius:6px;overflow:hidden;min-height:120px;display:flex;align-items:center;justify-content:center;margin-bottom:8px">
                <span id="photo-placeholder" style="color:var(--color-text-dim);font-size:13px">No photo selected</span>
                <img id="photo-preview-img" style="display:none;width:100%;max-height:200px;object-fit:contain" alt="Preview" />
              </div>
              <div style="display:flex;gap:8px;margin-bottom:6px">
                <label class="btn-outline" style="flex:1;text-align:center;cursor:pointer;padding:7px 12px;font-size:13px">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-80,32a44,44,0,1,1-44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,0-28-28A28,28,0,0,0,128,160Z"/></svg>
                  Take Photo
                  <input type="file" id="photo-camera-input" accept="image/*" capture="environment" style="display:none" />
                </label>
                <label class="btn-outline" style="flex:1;text-align:center;cursor:pointer;padding:7px 12px;font-size:13px">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M216,40H72A16,16,0,0,0,56,56V72H40A16,16,0,0,0,24,88V200a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V184h16a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM72,56H216v62.75l-10.07-10.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.63,0L72,109.37ZM184,200H40V88H56v80a16,16,0,0,0,16,16H184Z"/></svg>
                  Choose / File
                  <input type="file" id="photo-file-input" accept="image/*" style="display:none" />
                </label>
              </div>
              <button class="btn-outline" id="photo-batch-btn" style="width:100%;padding:7px 12px;font-size:13px;cursor:pointer">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M216,40H72A16,16,0,0,0,56,56V72H40A16,16,0,0,0,24,88V200a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V184h16a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM72,56H216v62.75l-10.07-10.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.63,0L72,109.37Z"/></svg>
                Batch Add Photos…
              </button>
              <p id="photo-exif-note" class="settings-hint" style="display:none;font-size:11px;margin:8px 0 0;color:var(--color-text-dim)"></p>
            </div>

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M128,16a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,176.56C109.39,178.42,56,123.27,56,104a72,72,0,0,1,144,0C200,123.27,146.61,178.42,128,192.56ZM128,72a32,32,0,1,0,32,32A32,32,0,0,0,128,72Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,120Z"/></svg>
                Location
              </h4>
              <div class="settings-hint" id="photo-gps-display" style="font-size:12px;line-height:1.6">
                ${this.locationHtml(loc)}
              </div>
            </div>

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M232,120h-8.07A96.14,96.14,0,0,0,136,31.94V24a8,8,0,0,0-16,0v7.94A96.14,96.14,0,0,0,32.07,120H24a8,8,0,0,0,0,16h8.07A96.14,96.14,0,0,0,120,224.06V232a8,8,0,0,0,16,0v-7.94A96.14,96.14,0,0,0,223.93,136H232a8,8,0,0,0,0-16Zm-96,88.64V200a8,8,0,0,0-16,0v8.64A80.15,80.15,0,0,1,47.36,136H56a8,8,0,0,0,0-16H47.36A80.15,80.15,0,0,1,120,47.36V56a8,8,0,0,0,16,0V47.36A80.15,80.15,0,0,1,208.64,120H200a8,8,0,0,0,0,16h8.64A80.15,80.15,0,0,1,136,208.64ZM128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,112Z"/></svg>
                Camera Bearing
                ${this.compassLive ? '<span style="color:var(--color-accent);font-size:11px;margin-left:6px">● Live</span>' : ''}
              </h4>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <svg viewBox="0 0 48 48" width="48" height="48" style="flex-shrink:0">
                  <circle cx="24" cy="24" r="22" fill="none" stroke="var(--color-text-dim)" stroke-width="1.5"/>
                  <text x="24" y="8" text-anchor="middle" fill="var(--color-text-dim)" font-size="7" font-family="system-ui">N</text>
                  <text x="24" y="44" text-anchor="middle" fill="var(--color-text-dim)" font-size="7" font-family="system-ui">S</text>
                  <text x="4" y="27" text-anchor="middle" fill="var(--color-text-dim)" font-size="7" font-family="system-ui">W</text>
                  <text x="44" y="27" text-anchor="middle" fill="var(--color-text-dim)" font-size="7" font-family="system-ui">E</text>
                  <polygon class="compass-arrow" points="24,6 27,28 24,32 21,28" fill="#f97316" transform="rotate(${this.bearing}, 24, 24)"/>
                  <circle cx="24" cy="24" r="3" fill="var(--color-text-dim)"/>
                </svg>
                <div style="flex:1">
                  <div style="font-size:20px;font-weight:600;line-height:1">
                    <span class="photo-bearing-value">${Math.round(this.bearing)}°</span>
                    <span class="photo-bearing-cardinal" style="font-size:14px;color:var(--color-text-dim);margin-left:6px">${bearingToCardinal(this.bearing)}</span>
                  </div>
                  <div style="font-size:11px;color:var(--color-text-dim);margin-top:2px">Camera direction (where lens points)</div>
                </div>
              </div>
              <input type="range" id="photo-bearing-slider" min="0" max="359" value="${Math.round(this.bearing)}" style="width:100%;accent-color:#f97316;margin-bottom:6px" />
              <div style="display:flex;gap:8px;align-items:center">
                <label style="font-size:12px;color:var(--color-text-dim);white-space:nowrap">Enter °:</label>
                <input type="number" id="photo-bearing-number" min="0" max="359" value="${Math.round(this.bearing)}" class="felt-input" style="width:70px;padding:4px 8px;font-size:13px" />
              </div>
            </div>

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M200,32H56A24,24,0,0,0,32,56V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V56A24,24,0,0,0,200,32Zm8,168a8,8,0,0,1-8,8H56a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8H200a8,8,0,0,1,8,8ZM176,96a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,96Zm0,32a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,128Zm-32,32a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h48A8,8,0,0,1,144,160Z"/></svg>
                Caption
              </h4>
              <input type="text" id="photo-caption" class="felt-input" style="width:100%;font-size:13px;padding:6px 8px" placeholder="Short caption shown under the photo in the log PDF" />
            </div>

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1,0,16H88a8,8,0,0,1,0-16Zm0,32a8,8,0,0,1,0,16H88a8,8,0,0,1,0-16Z"/></svg>
                Notes
              </h4>
              <textarea id="photo-notes" rows="3" class="felt-input" style="width:100%;resize:vertical;font-size:13px;padding:6px 8px" placeholder="Describe what's in the photo…"></textarea>
            </div>

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"/></svg>
                Observer
              </h4>
              <input type="text" id="photo-observer" class="felt-input" value="${observer}" style="width:100%;font-size:13px;padding:6px 8px" placeholder="Observer initials / name" />
            </div>

          </div>
        </div>
        <div class="panel-footer" style="gap:8px">
          <button class="btn-primary" id="photo-drop-btn" style="flex:1">Drop Point</button>
          <button class="btn-outline" id="photo-capture-cancel" style="flex:0 0 auto">Cancel</button>
        </div>
      </div>`;

    this.panel.querySelector('#photo-capture-close')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#photo-capture-cancel')?.addEventListener('click', () => this.close());
    this.panel.querySelector('#photo-drop-btn')?.addEventListener('click', () => void this.dropPoint());

    this.panel.querySelector('#photo-batch-btn')?.addEventListener('click', () => {
      this.close();
      this.batchPanel?.open();
    });

    const cameraInput = this.panel.querySelector<HTMLInputElement>('#photo-camera-input');
    const fileInput = this.panel.querySelector<HTMLInputElement>('#photo-file-input');
    const onPick = (input: HTMLInputElement | null) => {
      input?.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) void this.loadFile(file);
      });
    };
    onPick(cameraInput);
    onPick(fileInput);

    const slider = this.panel.querySelector<HTMLInputElement>('#photo-bearing-slider');
    const numberInput = this.panel.querySelector<HTMLInputElement>('#photo-bearing-number');

    slider?.addEventListener('input', () => {
      this.bearing = Number(slider.value);
      this.compassLive = false;
      this.bearingLocked = true; // manual override beats both compass and EXIF
      this.updateBearingDisplay();
    });

    numberInput?.addEventListener('input', () => {
      const v = ((Number(numberInput.value) % 360) + 360) % 360;
      this.bearing = v;
      this.compassLive = false;
      this.bearingLocked = true;
      this.updateBearingDisplay();
    });

    // Live GPS update listener — only relevant when no EXIF location is in play.
    EventBus.on('gps-update', () => {
      if (!this.isOpen) return;
      if (this.exif && hasExifLocation(this.exif)) return;
      this.refreshLocationDisplay();
    });
  }

  private async dropPoint(): Promise<void> {
    const settings = this.getSettings();
    const notes = (this.panel.querySelector<HTMLTextAreaElement>('#photo-notes')?.value ?? '').trim();
    const caption = (this.panel.querySelector<HTMLInputElement>('#photo-caption')?.value ?? '').trim();
    const observer = (this.panel.querySelector<HTMLInputElement>('#photo-observer')?.value ?? settings.user_id ?? '').trim();

    if (!this.photoDataUrl) {
      EventBus.emit('toast', { message: 'Please select or take a photo first', type: 'warning' });
      return;
    }

    const loc = this.getEffectiveLocation();
    if (!loc.available) {
      EventBus.emit('toast', { message: 'No location — waiting for GPS fix (or choose a geotagged photo)', type: 'warning' });
      return;
    }

    const projectId = settings.active_project_id ?? 'default';
    const layerId = `${projectId}-photos`;

    const feature = buildPhotoFeature({
      photoDataUrl: this.photoDataUrl,
      lat: loc.lat,
      lon: loc.lon,
      elevation: loc.elevation,
      accuracy: loc.accuracy,
      bearing: this.bearing,
      observer: observer || settings.user_id || 'USER',
      notes,
      caption,
      source: loc.source,
      createdAt: loc.source === 'exif' && this.exif?.dateTime ? this.exif.dateTime : undefined,
      projectId,
      layerId,
    });

    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
    EventBus.emit('toast', { message: 'Photo point saved', type: 'success' });

    // Reset for next photo (keep panel open).
    this.photoDataUrl = '';
    this.exif = null;
    this.bearingLocked = false;
    const img = this.panel.querySelector<HTMLImageElement>('#photo-preview-img');
    const placeholder = this.panel.querySelector<HTMLElement>('#photo-placeholder');
    const notesEl = this.panel.querySelector<HTMLTextAreaElement>('#photo-notes');
    const captionEl = this.panel.querySelector<HTMLInputElement>('#photo-caption');
    const exifNote = this.panel.querySelector<HTMLElement>('#photo-exif-note');
    const cameraInput = this.panel.querySelector<HTMLInputElement>('#photo-camera-input');
    const fileInput = this.panel.querySelector<HTMLInputElement>('#photo-file-input');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (placeholder) placeholder.style.display = '';
    if (notesEl) notesEl.value = '';
    if (captionEl) captionEl.value = '';
    if (exifNote) { exifNote.style.display = 'none'; exifNote.innerHTML = ''; }
    if (cameraInput) cameraInput.value = '';
    if (fileInput) fileInput.value = '';
    this.refreshLocationDisplay();
  }
}
