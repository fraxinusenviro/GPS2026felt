/**
 * Phase 0 spike — Cloudflare Worker for Fraxinus Field Mapper backend.
 *
 * Proves the three things Phase 0 needs to validate:
 *   1. D1 round-trip      — POST /sync (upsert) + GET /changes?since= (pull)
 *   2. R2 blob storage    — PUT/GET /blobs/:key (proxied; works in local `wrangler dev`)
 *   3. R2 presigned URLs   — POST/GET /uploads/sign (direct browser↔R2; needs real R2 keys)
 *
 * Auth here is a placeholder shared bearer token (env.SPIKE_TOKEN). Real auth in
 * the build phase is Cloudflare Access in front of the Worker — do NOT ship this.
 */

import { AwsClient } from 'aws4fetch';

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  SPIKE_TOKEN?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

interface FeatureRow {
  id: string;
  project_id: string | null;
  geometry: string;
  properties: string | null;
  photo_keys: string | null;
  updated_at: number;
  deleted: number;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const bad = (msg: string, status = 400): Response => json({ error: msg }, status);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // --- auth gate (skipped if no token configured, e.g. pure local dev) ---
    if (env.SPIKE_TOKEN) {
      const auth = request.headers.get('authorization') ?? '';
      if (auth !== `Bearer ${env.SPIKE_TOKEN}`) return bad('unauthorized', 401);
    }

    try {
      if (path === '/health') return json({ ok: true, ts: Date.now() });

      // ----- 1. D1: structured feature sync -----
      if (path === '/sync' && method === 'POST') return syncFeatures(request, env);
      if (path === '/changes' && method === 'GET') return getChanges(url, env);

      // ----- 2. R2: proxied blob path (local-testable) -----
      if (path.startsWith('/blobs/')) {
        const key = decodeURIComponent(path.slice('/blobs/'.length));
        if (!key) return bad('missing key');
        if (method === 'PUT') return putBlob(key, request, env);
        if (method === 'GET') return getBlob(key, env);
        return bad('method not allowed', 405);
      }

      // ----- 3. R2: presigned direct-to-R2 path (production pattern) -----
      if (path === '/uploads/sign' && method === 'POST') return signUpload(request, env);
      if (path === '/uploads/sign' && method === 'GET') return signDownload(url, env);

      return bad('not found', 404);
    } catch (err) {
      return bad(`server error: ${(err as Error).message}`, 500);
    }
  },
};

// ---------------------------------------------------------------------------
// D1: last-write-wins upsert. Only overwrites a row if the incoming record is
// newer (>=) than what's stored, so out-of-order syncs from offline clients
// don't clobber fresher data.
// ---------------------------------------------------------------------------
async function syncFeatures(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { features?: unknown[] } | null;
  if (!body || !Array.isArray(body.features)) return bad('expected { features: [...] }');

  let applied = 0;
  let skipped = 0;
  const stmt = env.DB.prepare(
    `INSERT INTO features (id, project_id, geometry, properties, photo_keys, updated_at, deleted)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       geometry   = excluded.geometry,
       properties = excluded.properties,
       photo_keys = excluded.photo_keys,
       updated_at = excluded.updated_at,
       deleted    = excluded.deleted
     WHERE excluded.updated_at >= features.updated_at`
  );

  for (const f of body.features as Array<Record<string, unknown>>) {
    if (!f || typeof f.id !== 'string' || typeof f.updated_at !== 'number') {
      skipped++;
      continue;
    }
    const res = await stmt
      .bind(
        f.id,
        (f.project_id as string) ?? null,
        JSON.stringify(f.geometry ?? null),
        f.properties != null ? JSON.stringify(f.properties) : null,
        f.photo_keys != null ? JSON.stringify(f.photo_keys) : null,
        f.updated_at,
        f.deleted ? 1 : 0
      )
      .run();
    if (res.meta.changes > 0) applied++;
    else skipped++;
  }

  return json({ applied, skipped, received: body.features.length });
}

async function getChanges(url: URL, env: Env): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? '0') || 0;
  const { results } = await env.DB.prepare(
    `SELECT * FROM features WHERE updated_at > ?1 ORDER BY updated_at ASC LIMIT 1000`
  )
    .bind(since)
    .all<FeatureRow>();

  const features = (results ?? []).map((r) => ({
    id: r.id,
    project_id: r.project_id,
    geometry: JSON.parse(r.geometry),
    properties: r.properties ? JSON.parse(r.properties) : null,
    photo_keys: r.photo_keys ? JSON.parse(r.photo_keys) : [],
    updated_at: r.updated_at,
    deleted: !!r.deleted,
  }));

  const cursor = features.length ? features[features.length - 1].updated_at : since;
  return json({ since, cursor, count: features.length, features });
}

// ---------------------------------------------------------------------------
// R2 proxied path — bytes flow through the Worker. Simple and works against
// Miniflare's local R2, but not what we'd use for large photos in production.
// ---------------------------------------------------------------------------
async function putBlob(key: string, request: Request, env: Env): Promise<Response> {
  const obj = await env.BLOBS.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
  });
  return json({ key, etag: obj?.etag ?? null });
}

async function getBlob(key: string, env: Env): Promise<Response> {
  const obj = await env.BLOBS.get(key);
  if (!obj) return bad('blob not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

// ---------------------------------------------------------------------------
// R2 presigned URLs — the production pattern: the browser uploads/downloads the
// blob DIRECTLY to/from R2, so large photos never transit the Worker. Mirrors
// the Felt presigned-S3 flow already in src/io/FeltService.ts. Requires R2 S3
// credentials (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).
// ---------------------------------------------------------------------------
function r2Client(env: Env): { client: AwsClient; base: string } | null {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    return null;
  }
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;
  return { client, base };
}

async function signUpload(request: Request, env: Env): Promise<Response> {
  const r2 = r2Client(env);
  if (!r2) return bad('R2 S3 credentials not configured (see README)', 501);
  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  const key = body?.key;
  if (!key) return bad('expected { key }');

  const signed = await r2.client.sign(`${r2.base}/${encodeURIComponent(key)}?X-Amz-Expires=900`, {
    method: 'PUT',
    aws: { signQuery: true },
  });
  return json({ key, method: 'PUT', url: signed.url, expiresIn: 900 });
}

async function signDownload(url: URL, env: Env): Promise<Response> {
  const r2 = r2Client(env);
  if (!r2) return bad('R2 S3 credentials not configured (see README)', 501);
  const key = url.searchParams.get('key');
  if (!key) return bad('expected ?key=');

  const signed = await r2.client.sign(`${r2.base}/${encodeURIComponent(key)}?X-Amz-Expires=900`, {
    method: 'GET',
    aws: { signQuery: true },
  });
  return json({ key, method: 'GET', url: signed.url, expiresIn: 900 });
}
