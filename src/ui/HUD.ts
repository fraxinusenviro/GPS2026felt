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
    // GPS accuracy badge
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

    // Copy button
    document.getElementById('btn-copy-coords')?.addEventListener('click', () => {
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
}
