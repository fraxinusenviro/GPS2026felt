/**
 * HRDEM elevation layer for MapLibre.
 *
 * Follows the same activate / deactivate lifecycle as NSPRDVectorLayer and
 * NSHNVectorLayer so it integrates seamlessly with BasemapManager's
 * rebuildMap() loop.
 *
 * Layer / source naming deliberately mirrors the raster-overlay convention
 * (bm-ov-{iid} / bmsrc-{iid}) so that all existing wireContent() handlers
 * for opacity sliders, visibility toggles, and image-adjustment sliders
 * work on this layer without modification.
 */

import maplibregl from 'maplibre-gl';
import type { MapManager } from './MapManager';
import { fetchHRDEM, type HRDEMResult } from '../lib/hrdemWCS';
import {
  renderElevation,
  rampToGradient,
  invertRamp,
  HRDEM_RAMPS,
  type ColorRamp,
} from '../lib/elevationRenderer';
import { LAYER_IDS } from '../constants';

const DEBOUNCE_MS = 300;
const MIN_ZOOM    = 10;

// 1×1 transparent PNG — used as the initial image source placeholder
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export class HRDEMLayer {
  // Stable across activate/deactivate cycles so canvas data survives rebuildMap()
  private readonly canvas = document.createElement('canvas');
  private ramp: ColorRamp = HRDEM_RAMPS['terrain'].ramp;

  // Last fetched result — re-rendered immediately on ramp changes (no re-fetch needed)
  private lastResult: HRDEMResult | null = null;

  // Last fetched coordinates — restored on re-activate to avoid a blank flash
  private lastCoords: [[number,number],[number,number],[number,number],[number,number]] = [
    [-180, 85], [180, 85], [180, -85], [-180, -85],
  ];
  private canvasHasData = false;

  // Tracks the opacity the caller wants; used to restore after the zoom-guard zeroes it
  private intendedOpacity = 1;

  // Current activation state
  private instanceId = '';
  private layerId    = '';
  private srcId      = '';
  private active     = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private moveHandler: (() => void) | null = null;
  private legendEl: HTMLElement | null = null;

  constructor(private readonly mapManager: MapManager) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Activate (or re-activate) the layer.
   * Always tears down existing map layers first so that the layer is
   * re-inserted at the correct position within the unified overlay order.
   */
  activate(instanceId: string, opacity: number, visible: boolean, ramp?: ColorRamp): void {
    if (ramp) this.ramp = ramp;
    this.intendedOpacity = visible ? opacity : 0;
    // Remove old map artefacts if present (ensures correct ordering after rebuildMap)
    this.removeMapLayers();

    this.instanceId = instanceId;
    this.layerId    = `bm-ov-${instanceId}`;
    this.srcId      = `bmsrc-${instanceId}`;
    this.active     = true;

    const map = this.mapManager.getMap();

    // Add image source — restore cached content immediately to avoid a blank frame
    map.addSource(this.srcId, {
      type:        'image',
      url:         this.canvasHasData ? this.canvas.toDataURL('image/png') : BLANK_PNG,
      coordinates: this.lastCoords,
    } as Parameters<typeof map.addSource>[1]);

    map.addLayer(
      {
        id:    this.layerId,
        type:  'raster',
        source: this.srcId,
        paint: {
          'raster-opacity':       visible ? opacity : 0,
          'raster-fade-duration': 0,
        },
      },
      LAYER_IDS.USER_ACCURACY,
    );

    if (!visible) {
      map.setLayoutProperty(this.layerId, 'visibility', 'none');
    }

    // Create or restore legend
    this.ensureLegend();

    // Attach move listeners (idempotent guard)
    if (!this.moveHandler) {
      this.moveHandler = () => this.scheduleFetch();
      map.on('moveend', this.moveHandler);
      map.on('zoomend', this.moveHandler);
    }

    this.scheduleFetch();
  }

  deactivate(): void {
    if (!this.active) return;
    this.removeMapLayers();
    this.removeLegend();
    this.active = false;
  }

  // --------------------------------------------------------------------------
  // Public controls (called by BasemapManager when stack changes)
  // --------------------------------------------------------------------------

  setOpacity(opacity: number): void {
    this.intendedOpacity = opacity;
    const map = this.mapManager.getMap();
    if (map.getLayer(this.layerId)) {
      map.setPaintProperty(this.layerId, 'raster-opacity', opacity);
    }
  }

  setVisible(visible: boolean): void {
    const map = this.mapManager.getMap();
    if (map.getLayer(this.layerId)) {
      map.setLayoutProperty(this.layerId, 'visibility', visible ? 'visible' : 'none');
    }
    if (visible) this.scheduleFetch();
  }

  setRamp(ramp: ColorRamp, invert = false): void {
    this.ramp = invert ? invertRamp(ramp) : ramp;
    if (this.lastResult) {
      // Re-render immediately from cached data — no network round-trip needed
      renderElevation(this.canvas, this.lastResult, this.ramp);
      this.canvasHasData = true;
      const src = this.mapManager.getMap().getSource(this.srcId) as maplibregl.ImageSource | undefined;
      if (src) src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });
      this.updateLegend(this.lastResult);
    } else {
      this.scheduleFetch();
    }
  }

  getLayerIds(): string[] {
    return this.active ? [this.layerId] : [];
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private removeMapLayers(): void {
    if (this.moveHandler) {
      const map = this.mapManager.getMap();
      map.off('moveend', this.moveHandler);
      map.off('zoomend', this.moveHandler);
      this.moveHandler = null;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const map = this.mapManager.getMap();
    if (this.layerId && map.getLayer(this.layerId))  map.removeLayer(this.layerId);
    if (this.srcId   && map.getSource(this.srcId))   map.removeSource(this.srcId);
  }

  private scheduleFetch(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.fetchAndRender();
    }, DEBOUNCE_MS);
  }

  private async fetchAndRender(): Promise<void> {
    if (!this.active) return;

    const map = this.mapManager.getMap();

    // Skip at small scales — HRDEM 1 m data is meaningless below zoom 10
    if (map.getZoom() < MIN_ZOOM) {
      if (map.getLayer(this.layerId)) {
        map.setPaintProperty(this.layerId, 'raster-opacity', 0);
      }
      this.updateLegend(null);
      return;
    }

    // Skip if layer is hidden
    const vis = map.getLayoutProperty(this.layerId, 'visibility');
    if (vis === 'none') return;

    const bounds = map.getBounds();
    const west  = bounds.getWest();
    const south = bounds.getSouth();
    const east  = bounds.getEast();
    const north = bounds.getNorth();

    // Request at screen resolution (capped inside fetchHRDEM)
    const mc = map.getCanvas();
    const targetW = mc.width  || 512;
    const targetH = mc.height || 512;

    let result;
    try {
      result = await fetchHRDEM(west, south, east, north, targetW, targetH);
    } catch (err) {
      console.warn('[HRDEMLayer] fetch failed:', err);
      return;
    }

    if (!this.active) return; // deactivated while fetch was in-flight

    this.lastResult = result;
    renderElevation(this.canvas, result, this.ramp);
    this.canvasHasData = true;

    // NW → NE → SE → SW (MapLibre image-source coordinate order)
    this.lastCoords = [
      [west,  north],
      [east,  north],
      [east,  south],
      [west,  south],
    ];

    const src = map.getSource(this.srcId) as maplibregl.ImageSource | undefined;
    if (!src) return;

    src.updateImage({ url: this.canvas.toDataURL('image/png'), coordinates: this.lastCoords });

    // Restore opacity if the zoom-guard previously zeroed it
    const currentOpacity = map.getPaintProperty(this.layerId, 'raster-opacity') as number;
    if (currentOpacity === 0 && this.intendedOpacity > 0) {
      map.setPaintProperty(this.layerId, 'raster-opacity', this.intendedOpacity);
    }

    this.updateLegend(result);
  }

  // --------------------------------------------------------------------------
  // Legend
  // --------------------------------------------------------------------------

  private ensureLegend(): void {
    if (this.legendEl) return;
    const container = this.mapManager.getMap().getContainer();
    const el = document.createElement('div');
    el.id = 'hrdem-elevation-legend';
    el.style.cssText = [
      'position:absolute', 'bottom:36px', 'left:12px', 'z-index:10',
      'background:rgba(18,36,26,0.88)', 'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:6px', 'padding:8px 10px',
      'font-family:inherit', 'font-size:11px', 'color:#c8d8c8',
      'min-width:80px', 'pointer-events:none',
      'backdrop-filter:blur(3px)', '-webkit-backdrop-filter:blur(3px)',
    ].join(';');
    el.innerHTML = this.buildLegendHTML(null);
    container.appendChild(el);
    this.legendEl = el;
  }

  private removeLegend(): void {
    this.legendEl?.remove();
    this.legendEl = null;
  }

  private updateLegend(result: { elevMin: number; elevMax: number } | null): void {
    if (this.legendEl) this.legendEl.innerHTML = this.buildLegendHTML(result);
  }

  private buildLegendHTML(result: { elevMin: number; elevMax: number } | null): string {
    const grad = rampToGradient(this.ramp);
    const minLbl = result ? `${result.elevMin.toFixed(0)} m` : '—';
    const maxLbl = result ? `${result.elevMax.toFixed(0)} m` : '—';
    return `
      <div style="font-size:9px;opacity:0.6;letter-spacing:.06em;margin-bottom:5px;text-transform:uppercase">
        Elevation
      </div>
      <div style="display:flex;align-items:stretch;gap:7px">
        <div style="width:10px;min-height:60px;border-radius:3px;background:${grad};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:10px;line-height:1.3">
          <span>${maxLbl}</span>
          <span>${minLbl}</span>
        </div>
      </div>`;
  }
}
