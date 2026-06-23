import { v4 as uuidv4 } from 'uuid';
import type { FieldFeature, AppSettings, PhotoPointData } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import type { CaptureManager } from '../capture/CaptureManager';

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function generatePointId(userId: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${userId}_${y}_${mo}_${d}_${h}${mi}`;
}

export class PhotoCapturePanel {
  private panel = document.getElementById('photo-capture-panel')!;
  private isOpen = false;
  private storage = StorageManager.getInstance();
  private photoDataUrl = '';
  private bearing = 0;
  private compassLive = false;
  private orientationListener: ((e: DeviceOrientationEvent) => void) | null = null;

  constructor(
    private captureManager: CaptureManager,
    private getSettings: () => AppSettings,
  ) {}

  open(): void {
    this.isOpen = true;
    this.photoDataUrl = '';
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

  private render(): void {
    const gps = this.captureManager.getGPSState();
    const settings = this.getSettings();
    const observer = settings.user_id ?? '';

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
              <label class="btn-outline" style="display:block;text-align:center;cursor:pointer;padding:7px 12px;font-size:13px">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13" style="margin-right:5px;vertical-align:-1px"><path d="M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-80,32a44,44,0,1,1-44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,0-28-28A28,28,0,0,0,128,160Z"/></svg>
                Take / Choose Photo
                <input type="file" id="photo-file-input" accept="image/*" capture="environment" style="display:none" />
              </label>
            </div>

            <div class="settings-section">
              <h4>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M128,16a88.1,88.1,0,0,0-88,88c0,31.4,14.51,64.68,42,96.25a254.19,254.19,0,0,0,41.45,38.3,8,8,0,0,0,9.18,0A254.19,254.19,0,0,0,174,200.25c27.45-31.57,42-64.85,42-96.25A88.1,88.1,0,0,0,128,16Zm0,176.56C109.39,178.42,56,123.27,56,104a72,72,0,0,1,144,0C200,123.27,146.61,178.42,128,192.56ZM128,72a32,32,0,1,0,32,32A32,32,0,0,0,128,72Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,120Z"/></svg>
                GPS Location
              </h4>
              <div class="settings-hint" id="photo-gps-display" style="font-size:12px;line-height:1.6">
                ${gps.available
                  ? `<strong>Lat:</strong> ${gps.lat.toFixed(6)}° &nbsp; <strong>Lon:</strong> ${gps.lon.toFixed(6)}°${gps.elevation != null ? `<br><strong>Elev:</strong> ${gps.elevation.toFixed(1)} m` : ''}${gps.accuracy != null ? ` &nbsp; <strong>Acc:</strong> ±${gps.accuracy.toFixed(0)} m` : ''}`
                  : '<em>Waiting for GPS fix…</em>'}
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

    const fileInput = this.panel.querySelector<HTMLInputElement>('#photo-file-input');
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.photoDataUrl = String(reader.result ?? '');
        const img = this.panel.querySelector<HTMLImageElement>('#photo-preview-img');
        const placeholder = this.panel.querySelector<HTMLElement>('#photo-placeholder');
        if (img) { img.src = this.photoDataUrl; img.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
      };
      reader.readAsDataURL(file);
    });

    const slider = this.panel.querySelector<HTMLInputElement>('#photo-bearing-slider');
    const numberInput = this.panel.querySelector<HTMLInputElement>('#photo-bearing-number');

    slider?.addEventListener('input', () => {
      this.bearing = Number(slider.value);
      this.compassLive = false;
      this.updateBearingDisplay();
    });

    numberInput?.addEventListener('input', () => {
      const v = ((Number(numberInput.value) % 360) + 360) % 360;
      this.bearing = v;
      this.compassLive = false;
      this.updateBearingDisplay();
    });

    // Live GPS update listener
    EventBus.on('gps-update', (state) => {
      if (!this.isOpen) return;
      const gpsEl = this.panel.querySelector<HTMLElement>('#photo-gps-display');
      if (!gpsEl) return;
      const s = state as { lat: number; lon: number; elevation: number | null; accuracy: number | null; available: boolean };
      gpsEl.innerHTML = s.available
        ? `<strong>Lat:</strong> ${s.lat.toFixed(6)}° &nbsp; <strong>Lon:</strong> ${s.lon.toFixed(6)}°${s.elevation != null ? `<br><strong>Elev:</strong> ${s.elevation.toFixed(1)} m` : ''}${s.accuracy != null ? ` &nbsp; <strong>Acc:</strong> ±${s.accuracy.toFixed(0)} m` : ''}`
        : '<em>Waiting for GPS fix…</em>';
    });
  }

  private async dropPoint(): Promise<void> {
    const gps = this.captureManager.getGPSState();
    const settings = this.getSettings();
    const notes = (this.panel.querySelector<HTMLTextAreaElement>('#photo-notes')?.value ?? '').trim();
    const observer = (this.panel.querySelector<HTMLInputElement>('#photo-observer')?.value ?? settings.user_id ?? '').trim();

    if (!this.photoDataUrl) {
      EventBus.emit('toast', { message: 'Please select or take a photo first', type: 'warning' });
      return;
    }

    if (!gps.available) {
      EventBus.emit('toast', { message: 'No GPS fix — waiting for location', type: 'warning' });
      return;
    }

    const projectId = settings.active_project_id ?? 'default';
    const layerId = `${projectId}-photos`;
    const now = new Date().toISOString();

    const photoData: PhotoPointData = { bearing: Math.round(this.bearing), observer };

    const feature: FieldFeature = {
      id: uuidv4(),
      point_id: generatePointId(observer || settings.user_id || 'USER'),
      type: 'Photo Point',
      desc: notes,
      geometry_type: 'Point',
      geometry: {
        type: 'Point',
        coordinates: gps.elevation != null
          ? [gps.lon, gps.lat, gps.elevation]
          : [gps.lon, gps.lat],
      },
      capture_method: 'gps',
      created_at: now,
      updated_at: now,
      created_by: observer || settings.user_id || 'USER',
      lat: gps.lat,
      lon: gps.lon,
      elevation: gps.elevation,
      accuracy: gps.accuracy,
      layer_id: layerId,
      project_id: projectId,
      notes,
      photos: [this.photoDataUrl],
      photo_data: photoData,
    };

    await this.storage.saveFeature(feature);
    EventBus.emit('feature-added', { feature });
    EventBus.emit('toast', { message: 'Photo point saved', type: 'success' });

    // Reset for next photo (keep panel open)
    this.photoDataUrl = '';
    const img = this.panel.querySelector<HTMLImageElement>('#photo-preview-img');
    const placeholder = this.panel.querySelector<HTMLElement>('#photo-placeholder');
    const notesEl = this.panel.querySelector<HTMLTextAreaElement>('#photo-notes');
    const fileInput = this.panel.querySelector<HTMLInputElement>('#photo-file-input');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (placeholder) placeholder.style.display = '';
    if (notesEl) notesEl.value = '';
    if (fileInput) fileInput.value = '';
  }
}
