import type { GPSState, AppSettings } from '../types';
import { lonLatToUTM, formatUTM, ddToDMS, copyToClipboard } from '../utils/coordinates';
import { EventBus } from '../utils/EventBus';
import { GPS_ACCURACY_GOOD, GPS_ACCURACY_FAIR } from '../constants';

export class HUD {
  private hudSource: 'user' | 'crosshair' = 'crosshair';
  private crosshairLat = 0;
  private crosshairLon = 0;
  private userLat = 0;
  private userLon = 0;
  private gpsState: GPSState | null = null;
  private coordFormat: 'dd' | 'dms' | 'utm' = 'dd';

  private latlonEl = document.getElementById('hud-latlon')!;
  private utmEl = document.getElementById('hud-utm')!;
  private gpsBadge = document.getElementById('gps-badge')!;
  private accuracyText = document.getElementById('gps-accuracy-text')!;

  constructor() {
    // GPS accuracy badge — tap to open status modal
    this.gpsBadge.style.cursor = 'pointer';
    this.gpsBadge.addEventListener('click', () => this.showGpsStatusModal());

    // GPS accuracy badge updates
    EventBus.on<GPSState>('gps-update', (state) => {
      this.gpsState = state;
      this.updateAccuracyBadge(state);
      if (this.hudSource === 'user' && state.available) {
        this.userLat = state.lat;
        this.userLon = state.lon;
        this.updateDisplay(state.lat, state.lon);
      }
    });

    // Map center movement + zoom
    EventBus.on<{ center: { lat: number; lng: number }; zoom: number }>('map-moveend', ({ center, zoom }) => {
      this.crosshairLat = center.lat;
      this.crosshairLon = center.lng;
      if (this.hudSource === 'crosshair') {
        this.updateDisplay(center.lat, center.lng);
      }
      this.updateZoomDisplay(zoom);
    });

    EventBus.on<{ zoom: number }>('map-zoom', ({ zoom }) => {
      this.updateZoomDisplay(zoom);
    });

    EventBus.on<{ lngLat: { lat: number; lng: number } }>('map-mousemove', ({ lngLat }) => {
      if (this.hudSource === 'crosshair') {
        this.updateDisplay(lngLat.lat, lngLat.lng);
        this.crosshairLat = lngLat.lat;
        this.crosshairLon = lngLat.lng;
      }
    });

    // Toggle button
    document.getElementById('btn-hud-toggle')?.addEventListener('click', () => {
      this.toggleSource();
    });

    // Tap coords display to copy
    document.getElementById('hud-coords')?.addEventListener('click', () => {
      this.copyCoords();
    });
  }

  applySettings(settings: AppSettings): void {
    this.hudSource = settings.hud_source;
    this.coordFormat = settings.coord_format;
    this.updateToggleButton();
  }

  private toggleSource(): void {
    this.hudSource = this.hudSource === 'user' ? 'crosshair' : 'user';
    this.updateToggleButton();

    if (this.hudSource === 'user' && this.gpsState?.available) {
      this.updateDisplay(this.gpsState.lat, this.gpsState.lon);
    } else {
      this.updateDisplay(this.crosshairLat, this.crosshairLon);
    }

    EventBus.emit('toast', {
      message: `HUD showing ${this.hudSource === 'user' ? 'GPS location' : 'crosshair position'}`,
      type: 'info',
      duration: 1500
    });
  }

  private updateToggleButton(): void {
    const btn = document.getElementById('btn-hud-toggle');
    if (!btn) return;
    btn.title = this.hudSource === 'user' ? 'Showing: GPS Location' : 'Showing: Crosshair';
    btn.classList.toggle('active', this.hudSource === 'user');
  }

  private updateDisplay(lat: number, lon: number): void {
    if (!this.latlonEl || !this.utmEl) return;
    if (lat === 0 && lon === 0) return;

    const utm = lonLatToUTM(lon, lat);

    // Primary display: lat/lon in chosen format
    if (this.coordFormat === 'dms') {
      this.latlonEl.textContent = `${ddToDMS(lat, false)} ${ddToDMS(lon, true)}`;
    } else {
      this.latlonEl.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }

    // Secondary: UTM always shown below
    this.utmEl.textContent = `UTM ${formatUTM(utm)}`;
  }

  private updateZoomDisplay(zoom: number): void {
    const el = document.getElementById('zoom-level-display');
    if (el) el.textContent = `z${Math.round(zoom)}`;
  }

  private updateAccuracyBadge(state: GPSState): void {
    if (!this.gpsBadge || !this.accuracyText) return;

    if (!state.available || state.accuracy === null) {
      this.gpsBadge.className = 'gps-badge gps-unknown';
      this.accuracyText.textContent = '--';
      return;
    }

    const acc = state.accuracy;
    this.accuracyText.textContent = `±${Math.round(acc)}m`;

    if (acc <= GPS_ACCURACY_GOOD) {
      this.gpsBadge.className = 'gps-badge gps-good';
    } else if (acc <= GPS_ACCURACY_FAIR) {
      this.gpsBadge.className = 'gps-badge gps-fair';
    } else {
      this.gpsBadge.className = 'gps-badge gps-poor';
    }
  }

  private async copyCoords(): Promise<void> {
    const lat = this.hudSource === 'user' ? this.userLat : this.crosshairLat;
    const lon = this.hudSource === 'user' ? this.userLon : this.crosshairLon;

    if (lat === 0 && lon === 0) {
      EventBus.emit('toast', { message: 'No coordinates to copy', type: 'warning' });
      return;
    }

    const utm = lonLatToUTM(lon, lat);
    const text = `Lat/Lon: ${lat.toFixed(6)}, ${lon.toFixed(6)}\nUTM: ${formatUTM(utm)}`;
    const ok = await copyToClipboard(text);
    EventBus.emit('toast', {
      message: ok ? 'Coordinates copied to clipboard' : 'Copy failed',
      type: ok ? 'success' : 'error',
      duration: 2000
    });
  }

  getCurrentCoords(): { lat: number; lon: number } {
    if (this.hudSource === 'user') return { lat: this.userLat, lon: this.userLon };
    return { lat: this.crosshairLat, lon: this.crosshairLon };
  }

  private showGpsStatusModal(): void {
    const s = this.gpsState;

    if (!s || !s.available) {
      EventBus.emit('show-modal', {
        title: 'GPS Status',
        html: `<div class="gsm-unavail">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
            <path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z"/>
            <line x1="2" y1="2" x2="22" y2="22" stroke-width="2"/>
          </svg>
          <p>GPS signal not available.<br>Ensure Location Services are enabled.</p>
        </div>`,
        confirmLabel: 'Close',
      });
      return;
    }

    const acc     = s.accuracy ?? null;
    const bars    = acc === null ? 0 : acc <= 5 ? 4 : acc <= 10 ? 3 : acc <= 15 ? 2 : 1;
    const accText = acc !== null ? `±${Math.round(acc)} m` : '—';
    const qualCls = acc === null ? 'gps-unknown' : acc <= GPS_ACCURACY_GOOD ? 'gps-good' : acc <= GPS_ACCURACY_FAIR ? 'gps-fair' : 'gps-poor';

    const barSvg = `<svg class="gsm-bars" viewBox="0 0 44 20" width="44" height="20">
      ${[1,2,3,4].map((b, i) => {
        const h = 4 + i * 4;
        const x = i * 11 + 1;
        const y = 20 - h;
        const filled = b <= bars;
        return `<rect x="${x}" y="${y}" width="8" height="${h}" rx="1.5"
          fill="${filled ? 'currentColor' : 'currentColor'}" opacity="${filled ? '1' : '0.2'}"/>`;
      }).join('')}
    </svg>`;

    const compassSvg = s.heading !== null ? (() => {
      const a = s.heading;
      const r = a * Math.PI / 180;
      const nx = 22 + 13 * Math.sin(r);
      const ny = 22 - 13 * Math.cos(r);
      const sx = 22 - 8  * Math.sin(r);
      const sy = 22 + 8  * Math.cos(r);
      const dirs: Record<string,string> = { N:'0,-17', E:'17,0', S:'0,17', W:'-17,0' };
      const cardinals = Object.entries(dirs).map(([l, t]) =>
        `<text text-anchor="middle" dominant-baseline="middle" transform="translate(${t})" font-size="6" fill="var(--color-text-muted)">${l}</text>`
      ).join('');
      return `<div class="gsm-compass-wrap">
        <svg class="gsm-compass" viewBox="0 0 44 44" width="64" height="64">
          <circle cx="22" cy="22" r="20" fill="none" stroke="var(--color-border)" stroke-width="1"/>
          <g transform="translate(22,22)" font-family="inherit">${cardinals}</g>
          <line x1="22" y1="22" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"
            stroke="#f97316" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="22" y1="22" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}"
            stroke="var(--color-text-muted)" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="22" cy="22" r="2.5" fill="var(--color-accent)"/>
        </svg>
        <span class="gsm-hdg-val">${Math.round(a)}°</span>
      </div>`;
    })() : '';

    const fixAge = s.timestamp
      ? Math.round((Date.now() - s.timestamp) / 1000)
      : null;

    const row = (label: string, value: string) =>
      `<div class="gsm-row"><span class="gsm-lbl">${label}</span><span class="gsm-val">${value}</span></div>`;

    const html = `
      <div class="gsm-header ${qualCls}">
        ${barSvg}
        <span class="gsm-acc-big">${accText}</span>
        <span class="gsm-acc-sub">horizontal accuracy</span>
      </div>
      <div class="gsm-grid">
        ${row('Latitude',  s.lat.toFixed(6) + '°')}
        ${row('Longitude', s.lon.toFixed(6) + '°')}
        ${s.elevation !== null ? row('Elevation', s.elevation.toFixed(1) + ' m') : ''}
        ${s.speed    !== null ? row('Speed',    (s.speed * 3.6).toFixed(1) + ' km/h') : ''}
        ${s.heading  !== null ? row('Heading',  Math.round(s.heading) + '°') : ''}
        ${fixAge !== null ? row('Fix age', fixAge + ' s') : ''}
      </div>
      ${compassSvg}
      <p class="gsm-note">
        Satellite constellation plots are not available via the browser GPS API —
        the Web Geolocation spec exposes accuracy and motion only, not satellite metadata.
      </p>
    `;

    EventBus.emit('show-modal', {
      title: 'GPS Status',
      html,
      confirmLabel: 'Close',
    });
  }
}
