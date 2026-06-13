/**
 * Fraxinus Field Mapper — production Worker (PWA host + sync/blob API).
 *
 * The Worker runs first for every request (run_worker_first). API paths are
 * handled here; everything else is served from Workers Static Assets (the built
 * PWA in ../dist), so the app and API share one origin behind one Access app.
 *
 * API routes (all require a verified Cloudflare Access identity except /health):
 *   GET  /health                 — liveness, unauthenticated
 *   POST /sync                   — push changed projects/features/presets (LWW)
 *   GET  /changes?since=&limit=  — pull changes since a rev cursor
 *   POST /uploads/sign           — presigned R2 PUT url for a photo blob
 *   GET  /uploads/sign?key=      — presigned R2 GET url
 *   PUT  /blobs/:key             — proxied blob upload (fallback)
 *   GET  /blobs/:key             — proxied blob download (fallback)
 */

import type { Env } from './types';
import { authenticate } from './auth';
import { handleSync, handleChanges } from './sync';
import { signUpload, signDownload, putBlob, getBlob } from './blobs';
import { json, bad, corsHeaders } from './http';

/** True for request paths this Worker handles itself (vs. static PWA assets). */
function isApiPath(path: string): boolean {
  return (
    path === '/health' ||
    path === '/sync' ||
    path === '/changes' ||
    path === '/uploads/sign' ||
    path.startsWith('/blobs/')
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Non-API requests → serve the PWA (Static Assets handle SPA fallback).
    if (!isApiPath(url.pathname)) return env.ASSETS.fetch(request);

    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const res = await route(request, env, url);
    // attach CORS to every real response
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/health') return json({ ok: true, ts: Date.now() });

  // --- auth gate: every route below needs a verified Access identity ---
  const who = await authenticate(request, env);
  if (!who) return bad('unauthorized', 401);

  try {
    if (path === '/sync' && method === 'POST') return await handleSync(request, env, who);
    if (path === '/changes' && method === 'GET') return await handleChanges(url, env);

    if (path === '/uploads/sign' && method === 'POST') return await signUpload(request, env);
    if (path === '/uploads/sign' && method === 'GET') return await signDownload(url, env);

    if (path.startsWith('/blobs/')) {
      const key = decodeURIComponent(path.slice('/blobs/'.length));
      if (!key) return bad('missing key');
      if (method === 'PUT') return await putBlob(key, request, env);
      if (method === 'GET') return await getBlob(key, request, env);
      return bad('method not allowed', 405);
    }

    return bad('not found', 404);
  } catch (err) {
    return bad(`server error: ${(err as Error).message}`, 500);
  }
}
