/**
 * Wetland Plots "Master File" generator.
 *
 * Aggregates every wetland-plot FieldFeature across all projects into a single
 * GeoJSON, uploads it to R2, and upserts a `shared_layers` row so it appears in
 * every authenticated user's Data Library (read-only org reference). Uses a
 * stable id + key, so re-running overwrites rather than duplicating.
 *
 * Triggered: best-effort after a /sync that includes wetland features, on the
 * cron schedule, and on demand via POST /admin/wetland-master.
 */

import type { Env } from './types';
import { reserveRevs } from './sync';

const MASTER_ID = 'wetland-master-plots';
const MASTER_KEY = 'static/Wetlands/wetland-plots-master.geojson';

export interface WetlandMasterResult {
  plots: number;
}

interface FeatureDoc {
  geometry?: unknown;
  project_id?: string;
  point_id?: string;
  lat?: number;
  lon?: number;
  wetland_data?: Record<string, unknown>;
}

export async function rebuildWetlandMaster(env: Env, who = 'system'): Promise<WetlandMasterResult> {
  const { results } = await env.DB.prepare(
    `SELECT doc FROM features
     WHERE deleted = 0 AND (layer_id LIKE '%-wetlands' OR doc LIKE '%"wetland_data"%')`
  ).all<{ doc: string }>();

  const features: unknown[] = [];
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;

  for (const r of results ?? []) {
    let f: FeatureDoc;
    try { f = JSON.parse(r.doc) as FeatureDoc; } catch { continue; }
    if (!f.geometry) continue;

    const d = f.wetland_data ?? {};
    const props: Record<string, unknown> = { project_id: f.project_id ?? '', point_id: f.point_id ?? '' };
    for (const [k, v] of Object.entries(d)) {
      if (k === 'photos') { props.photo_count = Array.isArray(v) ? v.length : 0; continue; }
      props[k] = Array.isArray(v) ? v.join('; ') : v;
    }
    features.push({ type: 'Feature', geometry: f.geometry, properties: props });

    if (typeof f.lon === 'number' && typeof f.lat === 'number') {
      minLon = Math.min(minLon, f.lon); maxLon = Math.max(maxLon, f.lon);
      minLat = Math.min(minLat, f.lat); maxLat = Math.max(maxLat, f.lat);
    }
  }

  const body = JSON.stringify({ type: 'FeatureCollection', features });
  await env.BLOBS.put(MASTER_KEY, body, {
    httpMetadata: { contentType: 'application/geo+json' },
  });

  const nowIso = new Date().toISOString();
  const bounds = features.length > 0 && minLon <= maxLon
    ? [minLon, minLat, maxLon, maxLat]
    : undefined;
  const doc = {
    id: MASTER_ID,
    name: 'Wetland Plots — Master (All Projects)',
    folder: 'Wetlands',
    kind: 'vector',
    format: 'geojson',
    r2_key: MASTER_KEY,
    size: body.length,
    description: `Aggregated wetland plot survey points from all projects (${features.length}). Auto-generated, read-only.`,
    source: 'Fraxinus Field Mapper',
    geometry_type: 'Point',
    bounds,
    style: { color: '#14b8a6', fillOpacity: 0.85, lineWidth: 1 },
    field_labels: { PLOT_ID: 'Plot ID', PLOT_TYPE: 'Plot Type', SiteID: 'Site ID', observer: 'Observer', date: 'Date' },
    added_by: who,
    added_at: nowIso,
    updated_at: nowIso,
  };

  const rev = await reserveRevs(env, 1);
  await env.DB.prepare(
    `INSERT INTO shared_layers (id, kind, doc, updated_at, updated_by, deleted, rev)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
     ON CONFLICT(id) DO UPDATE SET
       doc = excluded.doc, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by, deleted = 0, rev = excluded.rev`
  ).bind(MASTER_ID, 'vector', JSON.stringify(doc), nowIso, who, rev).run();

  return { plots: features.length };
}

/** Cheap check: does a /sync push include any wetland-plot features? */
export function pushHasWetlandFeatures(items: Array<{ kind: string; e: Record<string, unknown> }>): boolean {
  return items.some(({ kind, e }) =>
    kind === 'features' && (
      (typeof e.layer_id === 'string' && e.layer_id.endsWith('-wetlands')) ||
      e.wetland_data != null
    ));
}
