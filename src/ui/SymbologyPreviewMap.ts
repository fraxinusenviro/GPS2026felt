// SymbologyPreviewMap — a small, throwaway MapLibre map used inside the Symbology
// Studio to preview a layer's real geometry styled with the current symbology. It is
// fully self-contained (its own map instance + neutral raster basemap) and reuses the
// shared symbology engine so the preview matches what the main map renders. The studio
// owns the lifecycle: mount() once, restyle() on every control change, zoomToExtent()
// for the link, and destroy() on close to release the WebGL context.

import maplibregl from 'maplibre-gl';
import type { SymbologyState, GeoJSONFeatureCollection } from '../types';
import { BASEMAPS } from '../constants';
import { buildColorExpression, buildRadiusExpression, buildLegend } from '../lib/symbologyEngine';
import type { LegendEntry } from '../lib/symbologyEngine';
import { renderShapeSprite, SHAPE_ICON_SCALE } from './SymbolRenderer';

type GeomType = 'point' | 'line' | 'polygon';
type PropFeatures = { properties: Record<string, unknown> }[];

const SRC = 'preview-src';
const BASEMAP_URL =
  BASEMAPS.find(b => b.id === 'esri-light-grey')?.url ??
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';

const PREV_SHAPE_SYM = 'preview-point-sym';
const PREV_SHAPE_PFX = 'pvs';

export class SymbologyPreviewMap {
  private map: maplibregl.Map | null = null;
  private ready = false;
  private pending: Array<() => void> = [];
  private bounds: maplibregl.LngLatBounds | null = null;
  private shapeSpriteCount = 0;

  /** Create the map, add the basemap + the layer's geometry, and fit to its extent. */
  mount(container: HTMLElement, fc: GeoJSONFeatureCollection): void {
    this.bounds = computeBounds(fc);
    this.map = new maplibregl.Map({
      container,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          basemap: { type: 'raster', tiles: [BASEMAP_URL], tileSize: 256, attribution: '© Esri' },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: this.bounds ? this.bounds.getCenter() : [-63.0, 45.0],
      zoom: 6,
    });
    this.map.on('load', () => {
      if (!this.map) return;
      this.map.addSource(SRC, { type: 'geojson', data: fc as never });
      // Sub-layers mirror MapManager.addGeoJSONLayer so restyle() can reuse the same
      // paint-property names the main map uses.
      this.map.addLayer({
        id: 'preview-fill', type: 'fill', source: SRC, filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#3388ff', 'fill-opacity': 0.4 },
      });
      this.map.addLayer({
        id: 'preview-casing', type: 'line', source: SRC, filter: ['==', '$type', 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0a0d12', 'line-width': 0, 'line-opacity': 0 },
      });
      this.map.addLayer({
        id: 'preview-line', type: 'line', source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3388ff', 'line-width': 2, 'line-opacity': 1 },
      });
      this.map.addLayer({
        id: 'preview-point', type: 'circle', source: SRC, filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#3388ff', 'circle-opacity': 0.9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
      });
      this.fit(false);
      this.ready = true;
      const queued = this.pending;
      this.pending = [];
      queued.forEach(fn => fn());
    });
  }

  /** Apply the current symbology to the preview layers (no-op until the map loads). */
  restyle(state: SymbologyState, features: PropFeatures, geomType: GeomType): void {
    if (!this.ready) { this.pending.push(() => this.restyle(state, features, geomType)); return; }
    const map = this.map;
    if (!map) return;
    const colorExpr = buildColorExpression(features, state) as unknown as maplibregl.ExpressionSpecification;
    const fillOpacity = state.opacity ?? 0.8;
    const strokeOpacity = state.strokeOpacity ?? fillOpacity;

    if (geomType === 'point') {
      const shape = state.shape;
      if (shape && shape !== 'circle') {
        // Non-circle shape: register sprites per legend class, use symbol layer.
        const legend = buildLegend(features, state);
        const outlineColor = state.outlineColor ?? '#ffffff';
        const outlineWidth = state.outlineWidth ?? 1;
        // Remove stale sprites from prior restyle.
        for (let i = legend.length; i < this.shapeSpriteCount; i++) {
          if (map.hasImage(`${PREV_SHAPE_PFX}-${i}`)) map.removeImage(`${PREV_SHAPE_PFX}-${i}`);
        }
        this.shapeSpriteCount = legend.length;
        for (let i = 0; i < legend.length; i++) {
          const imgData = renderShapeSprite(shape, legend[i].color, outlineColor, outlineWidth, fillOpacity);
          if (map.hasImage(`${PREV_SHAPE_PFX}-${i}`)) map.removeImage(`${PREV_SHAPE_PFX}-${i}`);
          map.addImage(`${PREV_SHAPE_PFX}-${i}`, imgData, { pixelRatio: 2 });
        }
        const iconImgExpr = buildShapeIconExpr(state, legend, PREV_SHAPE_PFX);
        const iconSizeExpr = buildShapeSizeExpr(features, state);
        // Hide circle layer.
        if (map.getLayer('preview-point')) map.setPaintProperty('preview-point', 'circle-opacity', 0);
        if (map.getLayer(PREV_SHAPE_SYM)) {
          map.setLayoutProperty(PREV_SHAPE_SYM, 'icon-image', iconImgExpr as maplibregl.ExpressionSpecification);
          map.setLayoutProperty(PREV_SHAPE_SYM, 'icon-size', iconSizeExpr as maplibregl.ExpressionSpecification);
        } else {
          map.addLayer({
            id: PREV_SHAPE_SYM, type: 'symbol', source: SRC,
            filter: ['==', '$type', 'Point'],
            layout: {
              'icon-image': iconImgExpr as maplibregl.ExpressionSpecification,
              'icon-size': iconSizeExpr as maplibregl.ExpressionSpecification,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          });
        }
      } else {
        // Circle: restore circle layer, remove shape layer.
        if (map.getLayer(PREV_SHAPE_SYM)) map.removeLayer(PREV_SHAPE_SYM);
        for (let i = 0; i < this.shapeSpriteCount; i++) {
          if (map.hasImage(`${PREV_SHAPE_PFX}-${i}`)) map.removeImage(`${PREV_SHAPE_PFX}-${i}`);
        }
        this.shapeSpriteCount = 0;
        if (map.getLayer('preview-point')) {
          map.setPaintProperty('preview-point', 'circle-color', colorExpr);
          map.setPaintProperty('preview-point', 'circle-opacity', fillOpacity);
          map.setPaintProperty('preview-point', 'circle-radius',
            state.method === 'proportional'
              ? (buildRadiusExpression(features, state) as unknown as maplibregl.ExpressionSpecification)
              : (state.size ?? 5));
          map.setPaintProperty('preview-point', 'circle-stroke-color', state.outlineColor ?? '#ffffff');
          map.setPaintProperty('preview-point', 'circle-stroke-width', state.outlineWidth ?? 1);
        }
      }
    }
    if (geomType === 'line' && map.getLayer('preview-line')) {
      map.setPaintProperty('preview-line', 'line-color', colorExpr);
      map.setPaintProperty('preview-line', 'line-opacity', strokeOpacity);
      map.setPaintProperty('preview-line', 'line-width', state.size ?? 2);
      if (state.cap) map.setLayoutProperty('preview-line', 'line-cap', state.cap);
      if (map.getLayer('preview-casing')) {
        if (state.casing && (state.casingWidth ?? 0) > 0) {
          map.setPaintProperty('preview-casing', 'line-color', state.casingColor ?? '#0a0d12');
          map.setPaintProperty('preview-casing', 'line-width', (state.size ?? 2) + (state.casingWidth ?? 2) * 2);
          map.setPaintProperty('preview-casing', 'line-opacity', strokeOpacity);
          if (state.cap) map.setLayoutProperty('preview-casing', 'line-cap', state.cap);
        } else {
          map.setPaintProperty('preview-casing', 'line-opacity', 0);
        }
      }
    }
    if (geomType === 'polygon' && map.getLayer('preview-fill')) {
      map.setPaintProperty('preview-fill', 'fill-color', colorExpr);
      map.setPaintProperty('preview-fill', 'fill-opacity', fillOpacity);
    }
  }

  /** Animate to the layer's extent (used by the "Zoom to extent" link). */
  zoomToExtent(): void {
    this.fit(true);
  }

  /** Call once after the container becomes visible/sized so tiles render correctly. */
  resize(): void {
    this.map?.resize();
  }

  private fit(animate: boolean): void {
    if (this.map && this.bounds && !this.bounds.isEmpty()) {
      this.map.fitBounds(this.bounds, { padding: 24, maxZoom: 16, animate });
    }
  }

  /** Tear down the map and release its WebGL context. Idempotent. */
  destroy(): void {
    this.pending = [];
    this.ready = false;
    if (this.map) { this.map.remove(); this.map = null; }
    this.bounds = null;
  }
}

function buildShapeIconExpr(
  state: SymbologyState,
  legend: LegendEntry[],
  prefix: string,
): unknown {
  if (state.method === 'single' || state.method === 'proportional' || legend.length === 0) {
    return `${prefix}-0`;
  }
  if (state.method === 'categorical') {
    const expr: unknown[] = ['match', ['to-string', ['get', state.field ?? '']]];
    legend.forEach((l, i) => { if (l.cat !== undefined) expr.push(l.cat, `${prefix}-${i}`); });
    expr.push(`${prefix}-0`);
    return expr;
  }
  // graduated
  const breaks = legend[0].breaks ?? [];
  const expr: unknown[] = ['step', ['to-number', ['get', state.field ?? '']], `${prefix}-0`];
  breaks.forEach((b, i) => expr.push(b, `${prefix}-${i + 1}`));
  return expr;
}

function buildShapeSizeExpr(
  features: PropFeatures,
  state: SymbologyState,
): unknown {
  const scale = SHAPE_ICON_SCALE;
  if (state.method === 'proportional') {
    const base = buildRadiusExpression(features, state);
    if (typeof base === 'number') return base / scale;
    return ['/', base, scale];
  }
  return (state.size ?? 6) / scale;
}

/** Bounding box of a FeatureCollection (handles Point/Line/Polygon + Multi*). */
function computeBounds(fc: GeoJSONFeatureCollection): maplibregl.LngLatBounds | null {
  const b = new maplibregl.LngLatBounds();
  let any = false;
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords as [number, number];
      if (Number.isFinite(lng) && Number.isFinite(lat)) { b.extend([lng, lat]); any = true; }
    } else {
      for (const c of coords) walk(c);
    }
  };
  for (const f of fc.features ?? []) walk(f.geometry && 'coordinates' in f.geometry ? f.geometry.coordinates : undefined);
  return any ? b : null;
}
