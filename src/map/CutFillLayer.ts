/**
 * MapLibre GL layer for the cut/fill modified surface.
 *
 * Manages three optional sources/layers:
 *   cutfill-elev   — modified elevation rendered with a colour ramp
 *   cutfill-diff   — cut/fill difference (red = cut, blue = fill)
 *   cutfill-contour — contours generated from the modified surface
 */

import maplibregl from 'maplibre-gl';
import type { MapManager } from './MapManager';
import type { CutFillResult } from '../lib/cutFillEngine';
import type { HRDEMResult } from '../lib/hrdemWCS';
import { generateContours } from '../lib/contourGenerator';
import { renderGrid, sampleRamp, type ColorRamp, HRDEM_RAMPS } from '../lib/elevationRenderer';

const SRC_ELEV    = 'cutfill-elev-src';
const SRC_DIFF    = 'cutfill-diff-src';
const SRC_CONTOUR = 'cutfill-contour-src';
const LYR_ELEV    = 'cutfill-elev-lyr';
const LYR_DIFF    = 'cutfill-diff-lyr';
const LYR_CONTOUR = 'cutfill-contour-lyr';

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
  private elevCanvas  = document.createElement('canvas');
  private diffCanvas  = document.createElement('canvas');
  private added       = false;
  private result: CutFillResult | null = null;

  constructor(private readonly mapManager: MapManager) {}

  // --------------------------------------------------------------------------
  // Lifecycle — add sources/layers once
  // --------------------------------------------------------------------------

  private ensureLayers(): void {
    if (this.added) return;
    const map = this.mapManager.getMap();

    // Find a reference layer to insert before (keeps cut/fill above basemap,
    // below collected features)
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

    // Contour line layer (hidden by default)
    map.addSource(SRC_CONTOUR, { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: LYR_CONTOUR, type: 'line', source: SRC_CONTOUR,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#222', 'line-width': 0.8, 'line-opacity': 0.9 },
    }, before);

    this.added = true;
  }

  private findInsertBefore(): string | undefined {
    const map = this.mapManager.getMap();
    // Insert before the first collected-feature layer
    const candidates = ['collected-points', 'collected-lines', 'collected-polygons-fill', 'user-accuracy-circle'];
    for (const id of candidates) {
      if (map.getLayer(id)) return id;
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // Show modified elevation
  // --------------------------------------------------------------------------

  show(result: CutFillResult, ramp?: ColorRamp): void {
    this.result = result;
    this.ensureLayers();
    const map = this.mapManager.getMap();

    const r = ramp ?? HRDEM_RAMPS['terrain'].ramp;
    renderGrid(
      this.elevCanvas,
      result.modifiedGrid,
      result.width,
      result.height,
      result.stretchMin,
      result.stretchMax,
      result.nodata,
      r,
    );

    const coords = bboxToCoords(result.bbox);
    (map.getSource(SRC_ELEV) as maplibregl.ImageSource)
      .updateImage({ url: this.elevCanvas.toDataURL('image/png'), coordinates: coords });

    map.setLayoutProperty(LYR_ELEV, 'visibility', 'visible');
  }

  // --------------------------------------------------------------------------
  // Show cut/fill difference overlay
  // --------------------------------------------------------------------------

  showDiff(result: CutFillResult): void {
    this.result = result;
    this.ensureLayers();
    const map = this.mapManager.getMap();

    // Build diverging stretch around zero
    const diffArr = result.diffGrid;
    let maxAbs = 0;
    for (let i = 0; i < diffArr.length; i++) {
      const a = Math.abs(diffArr[i]);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs < 0.01) maxAbs = 1;

    // Render: map diff value to [0,1]: 0 = −maxAbs (fill), 0.5 = 0, 1 = +maxAbs (cut)
    this.diffCanvas.width  = result.width;
    this.diffCanvas.height = result.height;
    const ctx = this.diffCanvas.getContext('2d')!;
    const img = ctx.createImageData(result.width, result.height);
    const px  = img.data;

    for (let i = 0; i < diffArr.length; i++) {
      const v = diffArr[i];
      const pi = i * 4;

      if (result.nodata !== null && Math.abs((result.originalGrid[i]) - result.nodata) < 0.001) {
        px[pi + 3] = 0;
        continue;
      }

      const t = 0.5 + v / (2 * maxAbs);
      const [r, g, b] = sampleRamp(CUTFILL_DIFF_RAMP, Math.max(0, Math.min(1, t)));
      px[pi]     = r;
      px[pi + 1] = g;
      px[pi + 2] = b;
      px[pi + 3] = Math.abs(v) < 0.01 ? 120 : 220; // near-zero = more transparent
    }

    ctx.putImageData(img, 0, 0);

    const coords = bboxToCoords(result.bbox);
    (map.getSource(SRC_DIFF) as maplibregl.ImageSource)
      .updateImage({ url: this.diffCanvas.toDataURL('image/png'), coordinates: coords });

    map.setLayoutProperty(LYR_DIFF, 'visibility', 'visible');
  }

  // --------------------------------------------------------------------------
  // Toggle between elevation and diff views
  // --------------------------------------------------------------------------

  setView(mode: 'elevation' | 'diff'): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();
    map.setLayoutProperty(LYR_ELEV,  'visibility', mode === 'elevation' ? 'visible' : 'none');
    map.setLayoutProperty(LYR_DIFF,  'visibility', mode === 'diff'      ? 'visible' : 'none');
  }

  // --------------------------------------------------------------------------
  // Contours on the modified surface
  // --------------------------------------------------------------------------

  updateContours(result: CutFillResult, intervalM: number, color = '#111111', width = 0.8): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();

    const hrdemLike: HRDEMResult = {
      grid:       result.modifiedGrid,
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
    if (!this.added) return;
    this.mapManager.getMap().setLayoutProperty(
      LYR_CONTOUR, 'visibility', visible ? 'visible' : 'none');
  }

  // --------------------------------------------------------------------------
  // Export contours as GeoJSON download
  // --------------------------------------------------------------------------

  exportContourGeoJSON(result: CutFillResult, intervalM: number): void {
    const hrdemLike2: HRDEMResult = {
      grid:       result.modifiedGrid,
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
    const fc  = generateContours(hrdemLike2, intervalM);
    const json = JSON.stringify(fc, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'cutfill_contours.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --------------------------------------------------------------------------
  // Opacity
  // --------------------------------------------------------------------------

  setOpacity(opacity: number): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();
    if (map.getLayer(LYR_ELEV))    map.setPaintProperty(LYR_ELEV,  'raster-opacity', opacity);
    if (map.getLayer(LYR_DIFF))    map.setPaintProperty(LYR_DIFF,  'raster-opacity', opacity);
    if (map.getLayer(LYR_CONTOUR)) map.setPaintProperty(LYR_CONTOUR, 'line-opacity', opacity);
  }

  // --------------------------------------------------------------------------
  // Remove all layers and sources from the map
  // --------------------------------------------------------------------------

  clear(): void {
    if (!this.added) return;
    const map = this.mapManager.getMap();
    for (const id of [LYR_ELEV, LYR_DIFF, LYR_CONTOUR]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC_ELEV, SRC_DIFF, SRC_CONTOUR]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    this.added  = false;
    this.result = null;
  }

  getResult(): CutFillResult | null { return this.result; }
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
