/**
 * Maps org-shared data-library layers (SharedLayer) onto synthetic BasemapDefs so
 * they ride the existing Data Library → basemap-stack pipeline: non-editable
 * rendering, opacity/visibility, legend, identify and symbology — no parallel path.
 *
 *   raster (cog)  → type 'raster', url `cog://<blob>/{z}/{x}/{y}` (range-read from R2)
 *   vector (geojson) → type 'geojson', url = the blob URL to fetch
 *
 * Shared defs use the id prefix `shared:` so callers can route them back to the
 * SharedLayer and offer delete; they are grouped under "Static Data[: <folder>]".
 */

import type { BasemapDef, SharedLayer } from '../types';

export const SHARED_DEF_PREFIX = 'shared:';
export const SHARED_GROUP_ROOT = 'Static Data';

/** True for a BasemapDef synthesized from a SharedLayer. */
export function isSharedDef(def: BasemapDef): boolean {
  return def.id.startsWith(SHARED_DEF_PREFIX);
}

/** True for a Data Library group that holds shared static-data layers. */
export function isSharedGroup(group: string): boolean {
  return group === SHARED_GROUP_ROOT || group.startsWith(`${SHARED_GROUP_ROOT}: `);
}

/** The SharedLayer id behind a synthetic def id (or null). */
export function sharedIdFromDef(defId: string): string | null {
  return defId.startsWith(SHARED_DEF_PREFIX) ? defId.slice(SHARED_DEF_PREFIX.length) : null;
}

/** Group heading for a layer: per-folder so the library lists them grouped. */
export function sharedGroupOf(layer: SharedLayer): string {
  return layer.folder ? `${SHARED_GROUP_ROOT}: ${layer.folder}` : SHARED_GROUP_ROOT;
}

/** Absolute, same-origin (or configured) URL to a proxied R2 blob. */
export function blobUrl(r2_key: string, baseUrl: string): string {
  const origin = (baseUrl || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');
  const path = r2_key.split('/').map(encodeURIComponent).join('/');
  return `${origin}/blobs/${path}`;
}

/** Build the synthetic BasemapDef for one shared layer. */
export function sharedLayerToDef(layer: SharedLayer, baseUrl: string): BasemapDef {
  const url = blobUrl(layer.r2_key, baseUrl);
  const attribution = layer.source ?? layer.added_by ?? 'Fraxinus shared data';
  const group = sharedGroupOf(layer);
  const description = layer.description;

  if (layer.kind === 'raster') {
    return {
      id: `${SHARED_DEF_PREFIX}${layer.id}`,
      label: layer.name,
      type: 'raster',
      url: `cog://${encodeURIComponent(url)}/{z}/{x}/{y}`,
      attribution,
      description,
      group,
      max_zoom: 22,
    };
  }

  // Vector GeoJSON: carry style + identify field labels through vector_config.
  const color = layer.style?.color ?? '#3388ff';
  return {
    id: `${SHARED_DEF_PREFIX}${layer.id}`,
    label: layer.name,
    type: 'geojson',
    url,
    attribution,
    description,
    group,
    vector_config: {
      endpoint: '',
      geomType: layer.geometry_type === 'LineString' ? 'line' : 'polygon',
      lineColor: color,
      lineWidth: layer.style?.lineWidth ?? 2,
      fillColor: color,
      fillOpacity: layer.style?.fillOpacity ?? 0.4,
      fieldLabels: layer.field_labels,
    },
  };
}
