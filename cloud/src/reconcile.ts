/**
 * R2 → D1 reconciler for the Shared Static Data library.
 *
 * Drop a file into the R2 bucket under `static/<folder>/<name>.<ext>` (via the
 * Cloudflare dashboard or any uploader) and this registers it as a `shared_layers`
 * row — inferring name/folder/kind/format from the key and assigning a proper
 * `rev` so every client picks it up through /changes. Runs on a cron trigger and
 * on demand via POST /admin/reconcile.
 *
 * Idempotent: rows already referencing an object's key are left alone, and each
 * registered row uses a deterministic id derived from the key, so re-running
 * never duplicates.
 */

import type { Env } from './types';
import { reserveRevs } from './sync';

const STATIC_PREFIX = 'static/';

interface Inferred {
  kind: 'vector' | 'raster';
  format: string;
  name: string;
  folder: string;
}

/** Map a `static/...` key to layer metadata, or null if the type is unsupported. */
function inferFromKey(key: string): Inferred | null {
  if (!key.startsWith(STATIC_PREFIX)) return null;
  const rel = key.slice(STATIC_PREFIX.length);
  if (!rel || rel.endsWith('/')) return null;

  const parts = rel.split('/');
  const filename = parts.pop() as string;
  const folder = parts.join('/');
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const name = filename.slice(0, dot);
  const ext = filename.slice(dot + 1).toLowerCase();

  switch (ext) {
    case 'geojson':
    case 'json':
      return { kind: 'vector', format: 'geojson', name, folder };
    case 'tif':
    case 'tiff':
      return { kind: 'raster', format: 'cog', name, folder };
    case 'pmtiles':
      return { kind: 'vector', format: 'pmtiles', name, folder };
    default:
      return null;
  }
}

/** Stable id from the key so repeated reconciles never create duplicates. */
function deterministicId(key: string): string {
  return 'sl-' + key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export interface ReconcileResult {
  scanned: number;
  added: number;
  layers: string[];
}

/** Scan the R2 static/ prefix and register any object not yet in shared_layers. */
export async function reconcileStaticLayers(env: Env, who = 'reconciler'): Promise<ReconcileResult> {
  // Existing r2_keys (so client-uploaded rows under static/ aren't duplicated).
  const { results } = await env.DB.prepare('SELECT doc FROM shared_layers WHERE deleted = 0').all<{ doc: string }>();
  const existingKeys = new Set<string>();
  for (const r of results ?? []) {
    try {
      const d = JSON.parse(r.doc) as { r2_key?: string };
      if (d.r2_key) existingKeys.add(d.r2_key);
    } catch {
      /* skip unparseable doc */
    }
  }

  const fresh: Array<{ key: string; size: number; inf: Inferred }> = [];
  let scanned = 0;
  let cursor: string | undefined;
  do {
    const listing = await env.BLOBS.list({ prefix: STATIC_PREFIX, cursor, limit: 1000 });
    for (const obj of listing.objects) {
      scanned++;
      if (existingKeys.has(obj.key)) continue;
      const inf = inferFromKey(obj.key);
      if (inf) fresh.push({ key: obj.key, size: obj.size, inf });
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  if (fresh.length === 0) return { scanned, added: 0, layers: [] };

  const firstRev = await reserveRevs(env, fresh.length);
  const nowIso = new Date().toISOString();

  const statements: D1PreparedStatement[] = [];
  const ids: string[] = [];
  fresh.forEach(({ key, size, inf }, i) => {
    const id = deterministicId(key);
    ids.push(id);
    const doc = {
      id,
      name: inf.name,
      folder: inf.folder || undefined,
      kind: inf.kind,
      format: inf.format,
      r2_key: key,
      size,
      added_by: who,
      added_at: nowIso,
      updated_at: nowIso,
    };
    statements.push(
      env.DB.prepare(
        `INSERT INTO shared_layers (id, kind, doc, updated_at, updated_by, deleted, rev)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6) ON CONFLICT(id) DO NOTHING`
      ).bind(id, inf.kind, JSON.stringify(doc), nowIso, who, firstRev + i)
    );
  });

  const res = await env.DB.batch(statements);
  const added: string[] = [];
  res.forEach((r, i) => {
    if ((r.meta.changes ?? 0) > 0) added.push(ids[i]);
  });

  return { scanned, added: added.length, layers: added };
}
