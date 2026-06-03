/**
 * MapLibre GL layer for the cut/fill modified surface.
 *
 * Manages five optional sources/layers:
 *   cutfill-elev       — modified elevation rendered with a colour ramp
 *   cutfill-diff       — cut/fill difference (red = cut, blue = fill)
 *   cutfill-hillshade  — hillshade overlay (semi-transparent, on top of elev/diff)
 *   cutfill-contour    — contours generated from the modified surface
 *   cutfill-daylight   — top-of-cut / toe-of-fill boundary lines
 */

import maplibregl from 'maplibre-gl';
import type { MapManager } from './MapManager';
import type { CutFillResult } from '../lib/cutFillEngine';
import type { HRDEMResult } from '../lib/hrdemWCS';
import { computeHillshadeGrid, smoothGridForContours } from '../lib/cutFillEngine';
import { generateContours } from '../lib/contourGenerator';
import { renderGrid, sampleRamp, type ColorRamp, HRDEM_RAMPS } from '../lib/elevationRenderer';

const SRC_ELEV      = 'cutfill-elev-src';
const SRC_DIFF      = 'cutfill-diff-src';
const SRC_HILLSHADE = 'cutfill-hillshade-src';
const SRC_CONTOUR   = 'cutfill-contour-src';
const SRC_DAYLIGHT  = 'cutfill-daylight-src';

const LYR_ELEV      = 'cutfill-elev-lyr';
const LYR_DIFF      = 'cutfill-diff-lyr';
const LYR_HILLSHADE = 'cutfill-hillshade-lyr';
const LYR_CONTOUR   = 'cutfill-contour-lyr';
const LYR_DAYLIGHT_CUT  = 'cutfill-daylight-cut-lyr';
const LYR_DAYLIGHT_FILL = 'cutfill-daylight-fill-lyr';

const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Diverging ramp: deep blue (fill) → white (no change) → deep red (cut). */
export const CUTFILL_DIFF_RAMP: ColorRamp = {
  stops: [
    { t: 0.00, r:  33, g: 102, b: 172 },
    { t: 0.40, r: 178, g: 211, b: 226 },
    { t: 0.50, r: 247, g: 247, b: 247 },
    { t: 0.60, r: 253, g: 219, b: 199 },
    { t: 1.00, r: 178, g:  24, b:  43 },
  ],
};

export class CutFillLayer {
  private elevCanvas      = document.createElement('canvas');
  private diffCanvas      = document.createElement('canvas');
  private hillshadeCanvas = document.createElement('canvas');
  private added           = false;
  private result: CutFillResult | null = null;

  constructor(private readonly mapManager: MapManager) {}

  // --------------------------------------------------------------------------
  // Lifecycle — add sources/layers once
  // --------------------------------------------------------------------------

  private ensureLayers(): void {
    if (this.added) return;
    const map = this.mapManager.getMap();
    const before = this.findInsertBefore();

    // Elevation image layer
    map.addSource(SRC_ELEV, {
      type: 'image',
      url: BLANK_PNG,
      coordinates: [[-180, 85], [180, 85], [180, -85], [-180, -85]],
    });
    map.addLayer({ id: LYR_ELEV, type: 'raster', source: SRC_ELEV,
      paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest' } }, before);

    // Diff image layer (hidden by default)
    map.addSource(SRC_DIFF, {
      type: 'image',
      url: BLANK_PNG,
      coordinates: [[-180, 85], [180, 85], [180, -85], [-180, -85]],
    });
    map.addLayer({ id: LYR_DIFF, type: 'raster', source: SRC_DIFF,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest' } }, before);

    // Hillshade overlay (hidden by default, on top of elev/diff)
    map.addSource(SRC_HILLSHADE, {
      type: 'image',
      url: BLANK_PNG,
      coordinates: [[-180, 85], [180, 85], [180, -85], [-180, -85]],
    });
    map.addLayer({ id: LYR_HILLSHADE, type: 'raster', source: SRC_HILLSHADE,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.45, 'raster-resampling': 'nearest' } }, before);

    // Contour line layer (hidden by default)
    map.addSource(SRC_CONTOUR, { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: LYR_CONTOUR, type: 'line', source: SRC_CONTOUR,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#222', 'line-width': 0.8, 'line-opacity': 0.9 },
    }, before);

    // Daylight lines (hidden by default)
    map.addSource(SRC_DAYLIGHT, { type: 'geojson', data: EMPTY_FC });
    // Top of cut — orange/red dashed
    map.addLayer({
      id: LYR_DAYLIGHT_CUT, type: 'line', source: SRC_DAYLIGHT,
      filter: ['==', ['get', 'type'], 'top_of_cut'],
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 1.8,
        'line-dasharray': [4, 3],
        'line-opacity': 0.9,
      },
    }, before);
    // Toe of fill — blue dashed
    map.addLayer({
      id: LYR_DAYLIGHT_FILL, type: 'line', source: SRC_DAYLIGHT,
      filter: ['==', ['get', 'type'], 'toe_of_fill'],
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#3b82f6',
        'line-width': 1.8,
        'line-dasharray': [4, 3],
        'line-opacity': 0.9,
      },
    }, before);

    this.added = true;
  }

  private findInsertBefore(): string | undefined {
    const map = this.mapManager.getMap();
    const candidates = ['collected-points', 'collected-lines', 'collected-polygons-fill', 'user-accuracy-circle'];
    for (const id of candidates) {
      if (map.getLayer(id)) return id;
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // Show modified elevation (with optional baked hillshade)
  // --------------------------------------------------------------------------

  show(result: CutFillResult, ramp?: ColorRamp, withHillshade = false): void {
    this.result = result;
    this.ensureLayers();
    const map = this.mapManager.getMap();
    const r = ramp ?? HRDEM_RAMPS['terrain'].ramp;

    if (withHillshade) {
      this.renderElevHillshadeComposite(result, r);
    } else {
      renderGrid(this.elevCanvas, result.modifiedGrid, result.width, result.height,
        result.stretchMin, result.stretchMax, result.nodata, r);
    }

    const coords = bboxToCoords(result.bbox);
    (map.getSource(SRC_ELEV) as maplibregl.ImageSource)
      .updateImage({ url: this.elevCanvas.toDataURL('image/png'), coordinates: coords });

    map.setLayoutProperty(LYR_ELEV, 'visibility', 'visible');
    map.setLayoutProperty(LYR_DIFF, 'visibility', 'none');
  }

  // --------------------------------------------------------------------------
  // Show cut/fill difference overlay (with optional baked hillshade)
  // --------------------------------------------------------------------------

  showDiff(result: CutFillResult, withHillshade = false): void {
    this.result = result;
    this.ensureLayers();
    const map = this.mapManager.getMap();

    const diffArr = result.diffGrid;
    let maxAbs = 0;
    for (let i = 0; i < diffArr.length; i++) {
      const a = Math.abs(diffArr[i]);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs < 0.01) maxAbs = 1;

    const shade = withHillshade
      ? computeHillshadeGrid(result.modifiedGrid, result.width, result.height, result.bbox, result.nodata)
      : null;

    this.diffCanvas.width  = result.width;
    this.diffCanvas.height = result.height;
    const ctx = this.diffCanvas.getContext('2d')!;
    const img = ctx.createImageData(result.width, result.height);
    const px  = img.data;

    for (let i = 0; i < diffArr.length; i++) {
      const v = diffArr[i];
      const pi = i * 4;

      if (result.nodata !== null && Math.abs(result.originalGrid[i] - result.nodata) < 0.001) {
        px[pi + 3] = 0;
        continue;
      }

      const t = 0.5 + v / (2 * maxAbs);
      let [r, g, b] = sampleRamp(CUTFILL_DIFF_RAMP, Math.max(0, Math.min(1, t)));

      if (shade !== null) {
        const brightness = 0.35 + 0.65 * (shade[i] / 255);
        r = Math.round(r * brightness);
        g = Math.round(g * brightness);
        b = Math.round(b * brightness);
      }

      px[pi]     = r;
      px[pi + 1] = g;
      px[pi + 2] = b;
      px[pi + 3] = Math.abs(v) < 0.01 ? 120 : 220;
    }

    ctx.putImageData(img, 0, 0);

    const coords = bboxToCoords(result.bbox);
    (map.getSource(SRC_DIFF) as maplibregl.ImageSource)
      .updateImage({ url: this.diffCanvas.toDataURL('image/png'), coordinates: coords });

    map.setLayoutProperty(LYR_DIFF, 'visibility', 'visible');
    map.setLayoutProperty(LYR_ELEV, 'visibility', 'none');
  }

  // --------------------------------------------------------------------------
  // Hillshade as standalone overlay (when not baked into raster)
  // --------------------------------------------------------------------------

  setHillshadeVisible(visible: boolean, result?: CutFillResult): void {
    this.ensureLayers();
    const map = this.mapManager.getMap();

    if (visible && result) {
      const shade = computeHillshadeGrid(
        result.modifiedGrid, result.width, result.height, result.bbox, result.nodata);

      this.hillshadeCanvas.width  = result.width;
      this.hillshadeCanvas.height = result.height;
      const ctx = this.hillshadeCanvas.getContext('2d')!;
      const img = ctx.createImageData(result.width, result.height);
      const px  = img.data;

      for (let i = 0; i < shade.length; i++) {
        const v  = shade[i];
        const pi = i * 4;
        const isNodata = result.nodata !== null &&
          Math.abs(result.originalGrid[i] - result.nodata) < 0.001;
        if (isNodata) { px[pi + 3] = 0; continue; }
        px[pi]     = v;
        px[pi + 1] = v;
        px[pi + 2] = v;
        // Multiply-blend simulation: shade below midpoint = darker, above = lighter
        px[pi + 3] = v < 128 ? Math.round((128 - v) / 128 * 160) : Math.round((v - 128) / 128 * 80);
      }

      ctx.putImageData(img, 0, 0);
      (map.getSource(SRC_HILLSHADE) as maplibregl.ImageSource)
        .updateImage({ url: this.hillshadeCanvas.toDataURL('image/png'), coordinates: bboxToCoords(result.bbox) });
    }

    map.setLayoutProperty(LYR_HILLSHADE, 'visibility', visible ? 'visible' : 'none');
  }

  // --------------------------------------------------------------------------
  // Toggle between elevation and diff views
  // --------------------------------------------------------------------------

  setView(mode: 'elevation' | 'diff'): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();
    map.setLayoutProperty(LYR_ELEV, 'visibility', mode === 'elevation' ? 'visible' : 'none');
    map.setLayoutProperty(LYR_DIFF, 'visibility', mode === 'diff'      ? 'visible' : 'none');
  }

  // --------------------------------------------------------------------------
  // Contours on the modified surface
  // --------------------------------------------------------------------------

  updateContours(result: CutFillResult, intervalM: number, color = '#111111', width = 0.8): void {
    this.ensureLayers();
    const map = this.mapManager.getMap();

    // Smooth the grid slightly before contouring to reduce raster jaggedness.
    // The original modifiedGrid is unchanged; only the contour input is smoothed.
    const smoothed = smoothGridForContours(result.modifiedGrid, result.width, result.height, result.nodata, 3);

    const hrdemLike: HRDEMResult = {
      grid:       smoothed,
      width:      result.width,
      height:     result.height,
      bbox:       result.bbox,
      nodata:     result.nodata,
      elevMin:    result.stretchMin,
      elevMax:    result.stretchMax,
      stretchMin: result.stretchMin,
      stretchMax: result.stretchMax,
      validCount: result.width * result.height,
    };

    const fc = generateContours(hrdemLike, intervalM);
    (map.getSource(SRC_CONTOUR) as maplibregl.GeoJSONSource).setData(fc);
    map.setLayoutProperty(LYR_CONTOUR, 'visibility', 'visible');
    map.setPaintProperty(LYR_CONTOUR, 'line-color', color);
    map.setPaintProperty(LYR_CONTOUR, 'line-width', width);
  }

  setContoursVisible(visible: boolean): void {
    this.ensureLayers();
    this.mapManager.getMap().setLayoutProperty(
      LYR_CONTOUR, 'visibility', visible ? 'visible' : 'none');
  }

  // --------------------------------------------------------------------------
  // Daylight limit lines
  // --------------------------------------------------------------------------

  setDaylight(fc: GeoJSON.FeatureCollection): void {
    this.ensureLayers();
    const map = this.mapManager.getMap();
    (map.getSource(SRC_DAYLIGHT) as maplibregl.GeoJSONSource).setData(fc);
    map.setLayoutProperty(LYR_DAYLIGHT_CUT,  'visibility', 'visible');
    map.setLayoutProperty(LYR_DAYLIGHT_FILL, 'visibility', 'visible');
  }

  setDaylightVisible(visible: boolean): void {
    this.ensureLayers();
    const map = this.mapManager.getMap();
    const v = visible ? 'visible' : 'none';
    map.setLayoutProperty(LYR_DAYLIGHT_CUT,  'visibility', v);
    map.setLayoutProperty(LYR_DAYLIGHT_FILL, 'visibility', v);
  }

  // --------------------------------------------------------------------------
  // Export helpers
  // --------------------------------------------------------------------------

  exportContourGeoJSON(result: CutFillResult, intervalM: number): void {
    const smoothed = smoothGridForContours(result.modifiedGrid, result.width, result.height, result.nodata, 3);
    const hrdemLike: HRDEMResult = {
      grid:       smoothed,
      width:      result.width,
      height:     result.height,
      bbox:       result.bbox,
      nodata:     result.nodata,
      elevMin:    result.stretchMin,
      elevMax:    result.stretchMax,
      stretchMin: result.stretchMin,
      stretchMax: result.stretchMax,
      validCount: result.width * result.height,
    };
    triggerDownload(JSON.stringify(generateContours(hrdemLike, intervalM), null, 2),
      'application/json', 'cutfill_contours.geojson');
  }

  exportDaylightGeoJSON(fc: GeoJSON.FeatureCollection): void {
    triggerDownload(JSON.stringify(fc, null, 2), 'application/json', 'cutfill_daylight.geojson');
  }

  // --------------------------------------------------------------------------
  // Opacity
  // --------------------------------------------------------------------------

  setOpacity(opacity: number): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();
    if (map.getLayer(LYR_ELEV))    map.setPaintProperty(LYR_ELEV, 'raster-opacity', opacity);
    if (map.getLayer(LYR_DIFF))    map.setPaintProperty(LYR_DIFF, 'raster-opacity', opacity);
    if (map.getLayer(LYR_CONTOUR)) map.setPaintProperty(LYR_CONTOUR, 'line-opacity', opacity);
  }

  // --------------------------------------------------------------------------
  // Remove all layers and sources from the map
  // --------------------------------------------------------------------------

  clear(): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();
    for (const id of [LYR_ELEV, LYR_DIFF, LYR_HILLSHADE, LYR_CONTOUR, LYR_DAYLIGHT_CUT, LYR_DAYLIGHT_FILL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC_ELEV, SRC_DIFF, SRC_HILLSHADE, SRC_CONTOUR, SRC_DAYLIGHT]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    this.added  = false;
    this.result = null;
  }

  getResult(): CutFillResult | null { return this.result; }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private renderElevHillshadeComposite(result: CutFillResult, ramp: ColorRamp): void {
    const shade = computeHillshadeGrid(
      result.modifiedGrid, result.width, result.height, result.bbox, result.nodata);

    this.elevCanvas.width  = result.width;
    this.elevCanvas.height = result.height;
    const ctx = this.elevCanvas.getContext('2d')!;
    const img = ctx.createImageData(result.width, result.height);
    const px  = img.data;

    const { modifiedGrid: grid, stretchMin: min, stretchMax: max, nodata } = result;

    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      const pi = i * 4;
      if (!isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 0.001)) {
        px[pi + 3] = 0;
        continue;
      }
      const t = min === max ? 0.5 : (v - min) / (max - min);
      let [r, g, b] = sampleRamp(ramp, Math.max(0, Math.min(1, t)));
      const brightness = 0.35 + 0.65 * (shade[i] / 255);
      px[pi]     = Math.round(r * brightness);
      px[pi + 1] = Math.round(g * brightness);
      px[pi + 2] = Math.round(b * brightness);
      px[pi + 3] = 220;
    }

    ctx.putImageData(img, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bboxToCoords(
  bbox: [number, number, number, number],
): [[number, number], [number, number], [number, number], [number, number]] {
  const [west, south, east, north] = bbox;
  return [[west, north], [east, north], [east, south], [west, south]];
}

function triggerDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
