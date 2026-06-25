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
import { handleSync, handleChanges, handleSharedLayers } from './sync';
import { signUpload, signDownload, putBlob, getBlob } from './blobs';
import { reconcileStaticLayers } from './reconcile';
import { rebuildWetlandMaster } from './wetlandMaster';
import { rebuildInventoryMaster } from './inventoryMaster';
import { handleAlmanac } from './almanac';
import { json, bad, html, corsHeaders } from './http';

/** True for request paths this Worker handles itself (vs. static PWA assets). */
function isApiPath(path: string): boolean {
  return (
    path === '/health' ||
    path === '/force-reload' ||
    path === '/logout' ||
    path === '/whoami' ||
    path === '/almanac' ||
    path === '/sync' ||
    path === '/changes' ||
    path === '/uploads/sign' ||
    path === '/admin/reconcile' ||
    path === '/admin/wetland-master' ||
    path === '/admin/inventory-master' ||
    path === '/shared-layers' ||
    path.startsWith('/blobs/')
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Non-API requests → serve the PWA (Static Assets handle SPA fallback).
    if (!isApiPath(url.pathname)) return env.ASSETS.fetch(request);

    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const res = await route(request, env, url, ctx);
    // attach CORS to every real response
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },

  // Cron trigger: register any newly-dropped R2 static/ files into D1 so they
  // sync to every client without manual SQL. See wrangler.toml [triggers].
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcileStaticLayers(env).then(
      (r) => { if (r.added) console.log(`[reconcile] registered ${r.added} static layer(s)`); },
      (err) => console.error('[reconcile] failed:', err)
    ));
    // Keep the wetland-plots Master File in the Data Library up to date.
    ctx.waitUntil(rebuildWetlandMaster(env).then(
      (r) => console.log(`[wetland-master] ${r.plots} plot(s)`),
      (err) => console.error('[wetland-master] failed:', err)
    ));
    // Keep the inventory-observations Master File in the Data Library up to date.
    ctx.waitUntil(rebuildInventoryMaster(env).then(
      (r) => console.log(`[inventory-master] ${r.observations} observation(s)`),
      (err) => console.error('[inventory-master] failed:', err)
    ));
  },
};

async function route(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/health') return json({ ok: true, ts: Date.now() });

  // Shareable cache-bust link: unregister the service worker, wipe Cache
  // Storage, then bounce to the app so it reloads fresh from the network.
  // Hand this URL to anyone stuck on an outdated build.
  if (path === '/force-reload' && method === 'GET') return html(FORCE_RELOAD_HTML);

  // Public GPS almanac proxy — no auth needed (data is publicly available)
  if (path === '/almanac' && method === 'GET') return handleAlmanac(request, env);

  // CF Access logout — redirect to the team logout endpoint (no auth required).
  if (path === '/logout' && method === 'GET') {
    if (!env.TEAM_DOMAIN) return Response.redirect('/', 302);
    return Response.redirect(`${env.TEAM_DOMAIN}/cdn-cgi/access/logout`, 302);
  }

  // --- auth gate: every route below needs a verified Access identity ---
  const who = await authenticate(request, env);
  if (!who) return bad('unauthorized', 401);

  // Expose the logged-in identity so the PWA can derive the User code from the
  // email (e.g. ibryson@… → IBRYSON). No DB access — just echoes the JWT email.
  if (path === '/whoami' && method === 'GET') return json({ email: who.email });

  try {
    if (path === '/sync' && method === 'POST') return await handleSync(request, env, who, ctx);
    if (path === '/changes' && method === 'GET') return await handleChanges(url, env);
    if (path === '/shared-layers' && method === 'GET') return await handleSharedLayers(env);

    if (path === '/uploads/sign' && method === 'POST') return await signUpload(request, env);
    if (path === '/uploads/sign' && method === 'GET') return await signDownload(url, env);

    // Manual trigger for the R2→D1 static-layer reconciler (cron runs it too).
    if (path === '/admin/reconcile' && method === 'POST') {
      return json(await reconcileStaticLayers(env, who.email));
    }

    // Manual rebuild of the wetland-plots Master File (cron + post-sync run it too).
    if (path === '/admin/wetland-master' && method === 'POST') {
      return json(await rebuildWetlandMaster(env, who.email));
    }

    // Manual rebuild of the inventory-observations Master File (cron + post-sync run it too).
    if (path === '/admin/inventory-master' && method === 'POST') {
      return json(await rebuildInventoryMaster(env, who.email));
    }

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

/**
 * Self-contained page served at /force-reload. Runs in the visitor's browser:
 * unregisters every service worker, deletes all Cache Storage entries, then
 * redirects to the app root with a cache-busting query so the next load comes
 * fresh from the network (and the SW re-registers against the latest sw.js).
 */
const FORCE_RELOAD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Updating Field Mapper…</title>
  <style>
    html,body{margin:0;height:100%;background:#0f172a;color:#e2e8f0;
      font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;text-align:center}
    .card{max-width:420px;padding:24px}
    h1{font-size:1.2rem;margin:0 0 8px}
    p{margin:4px 0;color:#94a3b8}
    .spin{width:36px;height:36px;margin:0 auto 16px;border:3px solid #334155;
      border-top-color:#4ade80;border-radius:50%;animation:s 0.8s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="card">
    <div class="spin"></div>
    <h1>Updating Field Mapper…</h1>
    <p id="status">Clearing cached files and fetching the latest version.</p>
  </div>
  <script>
    (async function () {
      try {
        if ('serviceWorker' in navigator) {
          var regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(function (r) { return r.unregister().catch(function () {}); }));
        }
        if ('caches' in window) {
          var keys = await caches.keys();
          await Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }
      } catch (e) { /* best-effort; reload regardless */ }
      // Cache-busting redirect to the app root.
      location.replace('/?fresh=' + Date.now());
    })();
  </script>
</body>
</html>`;
