/**
 * Backend validation — exercises the production Worker end-to-end against a
 * local `wrangler dev` (Miniflare) or a real deployment.
 *
 *   POST /sync         — push all four entity kinds; last-write-wins
 *   GET /changes       — incremental pull via the rev cursor
 *   soft delete        — propagates through /changes
 *   /uploads/sign      — presigned R2 (skipped unless R2 keys are set)
 *
 * Usage:
 *   npm run dev                 # another terminal (local Miniflare)
 *   npm run migrate:local       # apply schema to local D1 (once)
 *   BASE=http://localhost:8787 node test/backend.test.mjs
 *
 * In dev mode the Worker skips Access; identity comes from X-Dev-User.
 */

const BASE = process.env.BASE ?? 'http://localhost:8787';
const TOKEN = process.env.TOKEN ?? '';
const headers = {
  'content-type': 'application/json',
  'x-dev-user': 'tester@fraxinusenviro.com',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}`, 'cf-access-jwt-assertion': TOKEN } : {}),
};

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
}

const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const get = (path) => fetch(`${BASE}${path}`, { headers });

async function main() {
  console.log(`\nFFM backend test → ${BASE}\n`);

  const h = await get('/health');
  check('GET /health 200', h.status === 200, `(got ${h.status})`);

  const now = Date.now();
  const iso = new Date(now).toISOString();
  const projectId = `proj-${now}`;
  const featId = `feat-${now}`;
  const layerId = `layer-${now}`;
  const typeId = `type-${now}`;

  // 1. push one of each entity kind ---------------------------------------
  console.log('\n[1] POST /sync — all four entity kinds');
  const syncRes = await post('/sync', {
    projects: [{ id: projectId, name: 'Test Project', updated_at: iso }],
    features: [{
      id: featId, project_id: projectId, layer_id: layerId,
      geometry: { type: 'Point', coordinates: [-63.57, 44.65] },
      lat: 44.65, lon: -63.57, type: 'tree', photo_keys: [`photos/${now}.jpg`],
      updated_at: iso,
    }],
    layer_presets: [{ id: layerId, name: 'Trees', project_id: projectId,
      types: [{ id: typeId, label: 'Oak' }], updated_at: iso }],
    type_presets: [{ id: typeId, label: 'Oak', updated_at: iso }],
    shared_layers: [{ id: `shared-${now}`, name: 'Aerial 2026', kind: 'raster',
      format: 'cog', r2_key: `shared/${now}.tif`, updated_at: iso }],
    project_maps: [
      { id: `map-${now}-a`, project_id: projectId, name: 'Map A', updated_at: iso },
      { id: `map-${now}-b`, project_id: projectId, name: 'Map B', updated_at: iso },
    ],
  });
  const syncBody = await syncRes.json();
  check('all six kinds applied', syncRes.ok &&
    syncBody.applied.projects === 1 && syncBody.applied.features === 1 &&
    syncBody.applied.layer_presets === 1 && syncBody.applied.type_presets === 1 &&
    syncBody.applied.shared_layers === 1 && syncBody.applied.project_maps === 2,
    JSON.stringify(syncBody));
  check('server returned a rev cursor', typeof syncBody.rev === 'number' && syncBody.rev > 0);

  // 2. pull everything back ------------------------------------------------
  console.log('\n[2] GET /changes — pull + doc round-trip');
  const c1 = await (await get('/changes?since=0')).json();
  const feat = (c1.features ?? []).find((f) => f.id === featId);
  const layer = (c1.layer_presets ?? []).find((l) => l.id === layerId);
  const shared = (c1.shared_layers ?? []).find((s) => s.id === `shared-${now}`);
  const projMaps = (c1.project_maps ?? []).filter((m) => m.project_id === projectId);
  check('shared layer came back', shared && shared.r2_key === `shared/${now}.tif`, JSON.stringify(c1).slice(0, 200));
  check('both project maps came back (not just one)', projMaps.length === 2,
    `(got ${projMaps.length}: ${projMaps.map((m) => m.name).join(', ')})`);
  check('feature came back', !!feat, JSON.stringify(c1).slice(0, 160));
  check('geometry survived round-trip', feat && feat.geometry.coordinates[0] === -63.57);
  check('photo_keys survived round-trip', feat && feat.photo_keys[0] === `photos/${now}.jpg`);
  check('nested preset types survived', layer && layer.types[0].id === typeId);
  check('cursor advanced past since', c1.cursor > 0);
  const cursor = c1.cursor;

  // 3. incremental pull is empty ------------------------------------------
  console.log('\n[3] incremental cursor');
  const c2 = await (await get(`/changes?since=${cursor}`)).json();
  check('no changes since cursor', c2.count === 0, JSON.stringify(c2).slice(0, 120));

  // 4. last-write-wins -----------------------------------------------------
  console.log('\n[4] last-write-wins');
  const stale = await (await post('/sync', {
    features: [{ id: featId, geometry: { type: 'Point', coordinates: [0, 0] },
      updated_at: new Date(now - 5000).toISOString() }],
  })).json();
  check('stale update skipped', stale.applied.features === 0, JSON.stringify(stale));
  const fresh = await (await post('/sync', {
    features: [{ id: featId, project_id: projectId, geometry: { type: 'Point', coordinates: [1, 1] },
      lat: 1, lon: 1, updated_at: new Date(now + 5000).toISOString() }],
  })).json();
  check('fresh update applied', fresh.applied.features === 1, JSON.stringify(fresh));

  // 5. soft delete propagates ---------------------------------------------
  console.log('\n[5] soft delete');
  await post('/sync', { features: [{ id: featId, deleted: true, updated_at: new Date(now + 9000).toISOString() }] });
  const c3 = await (await get(`/changes?since=${cursor}`)).json();
  const del = (c3.features ?? []).find((f) => f.id === featId);
  check('deleted feature appears with deleted=true', del && del.deleted === true, JSON.stringify(c3).slice(0, 160));

  // A project_map delete is a tombstone with no project_id — must not 500 on the
  // NOT NULL constraint (regression: project_maps.project_id was NOT NULL).
  const mapDel = await post('/sync',
    { project_maps: [{ id: `map-${now}-a`, deleted: true, updated_at: new Date(now + 9000).toISOString() }] });
  const mapDelBody = await mapDel.json();
  check('project_map delete (tombstone, no project_id) applied', mapDel.ok && mapDelBody.applied.project_maps === 1,
    `${mapDel.status} ${JSON.stringify(mapDelBody)}`);
  const c3b = await (await get(`/changes?since=${cursor}`)).json();
  const mapGone = (c3b.project_maps ?? []).find((m) => m.id === `map-${now}-a`);
  check('deleted project_map appears with deleted=true', mapGone && mapGone.deleted === true, JSON.stringify(c3b).slice(0, 160));

  // 6. presigned (only if R2 keys configured) -----------------------------
  console.log('\n[6] R2 presigned URL round-trip');
  const signRes = await post('/uploads/sign', { key: `photos/presigned-${now}.txt` });
  if (signRes.status === 501) {
    console.log('  ⊘ skipped — R2 S3 credentials not configured (expected for local dev)');
  } else {
    const sign = await signRes.json();
    check('POST /uploads/sign returns a PUT url', signRes.ok && !!sign.url, JSON.stringify(sign));
    const payload = `hello-${now}`;
    const directPut = await fetch(sign.url, { method: 'PUT', body: payload });
    check('direct PUT to presigned R2 url', directPut.ok, `(got ${directPut.status})`);
    const dl = await (await get(`/uploads/sign?key=${encodeURIComponent(sign.key)}`)).json();
    const directBody = await (await fetch(dl.url)).text();
    check('direct GET from presigned R2 url', directBody === payload, `(got "${directBody.slice(0, 40)}")`);
  }

  // 7. paginated pull never skips rows (per-kind LIMIT + safe cursor) -----
  console.log('\n[7] /changes pagination — no skipped rows across kinds');
  {
    const base = `pg-${now}`;
    // Push several features and one project; the project gets the highest rev.
    await post('/sync', {
      features: [0, 1, 2].map((i) => ({
        id: `${base}-f${i}`, project_id: projectId, layer_id: layerId,
        geometry: { type: 'Point', coordinates: [0, 0] }, lat: 0, lon: 0,
        type: 'tree', updated_at: new Date(now + 1000 + i).toISOString(),
      })),
    });
    await post('/sync', { projects: [{ id: `${base}-p`, name: 'pager', updated_at: iso }] });

    // Walk from a cursor just before our batch with limit=1 so kinds truncate.
    const start = await (await get('/changes?since=0&limit=100000')).json();
    void start;
    const wanted = new Set([`${base}-f0`, `${base}-f1`, `${base}-f2`, `${base}-p`]);
    const seen = new Set();
    let cur = 0;
    for (let i = 0; i < 5000 && seen.size < wanted.size + 1; i++) {
      const page = await (await get(`/changes?since=${cur}&limit=1`)).json();
      for (const k of ['projects', 'features', 'layer_presets', 'type_presets', 'shared_layers', 'project_maps']) {
        for (const row of page[k] ?? []) if (wanted.has(row.id)) seen.add(row.id);
      }
      cur = page.cursor;
      if (!page.more) break;
    }
    check('all rows recovered when paginating with limit=1', [...wanted].every((id) => seen.has(id)),
      `missing: ${[...wanted].filter((id) => !seen.has(id)).join(',')}`);
  }

  // 8. /blobs Range support ------------------------------------------------
  console.log('\n[8] /blobs — HTTP Range');
  {
    const key = `static/range-${now}.bin`;
    const payload = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const put = await fetch(`${BASE}/blobs/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: payload,
    });
    check('PUT /blobs stored object', put.ok, `(got ${put.status})`);

    const ranged = await fetch(`${BASE}/blobs/${encodeURIComponent(key)}`, { headers: { ...headers, range: 'bytes=5-9' } });
    const body = await ranged.text();
    check('Range returns 206', ranged.status === 206, `(got ${ranged.status})`);
    check('Range returns the requested bytes', body === payload.slice(5, 10), `(got "${body}")`);
    check('Content-Range header set', ranged.headers.get('content-range') === `bytes 5-9/${payload.length}`,
      `(got "${ranged.headers.get('content-range')}")`);

    const full = await fetch(`${BASE}/blobs/${encodeURIComponent(key)}`, { headers });
    check('full GET advertises Accept-Ranges', full.headers.get('accept-ranges') === 'bytes',
      `(got "${full.headers.get('accept-ranges')}")`);
  }

  // 9. R2 → D1 reconciler (static/ drops auto-register) -------------------
  console.log('\n[9] POST /admin/reconcile — static/ → shared_layers');
  {
    const vKey = `static/Wetlands/marsh-${now}.geojson`;
    const rKey = `static/aerial-${now}.tif`;
    const putV = await fetch(`${BASE}/blobs/${encodeURIComponent(vKey)}`, {
      method: 'PUT', headers, body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
    });
    const putR = await fetch(`${BASE}/blobs/${encodeURIComponent(rKey)}`, {
      method: 'PUT', headers: { ...headers, 'content-type': 'image/tiff' }, body: 'II*\0fake-cog',
    });
    check('uploaded static vector + raster', putV.ok && putR.ok);

    const rec = await (await post('/admin/reconcile', {})).json();
    check('reconcile registered the two new layers', rec.added >= 2, JSON.stringify(rec).slice(0, 160));

    const ch = await (await get('/changes?since=0&limit=100000')).json();
    const byKey = Object.fromEntries((ch.shared_layers ?? []).map((s) => [s.r2_key, s]));
    const v = byKey[vKey];
    const r = byKey[rKey];
    check('vector layer inferred (kind/format/folder/name)',
      v && v.kind === 'vector' && v.format === 'geojson' && v.folder === 'Wetlands' && v.name === `marsh-${now}`,
      JSON.stringify(v));
    check('raster layer inferred (kind/format, no folder)',
      r && r.kind === 'raster' && r.format === 'cog' && !r.folder,
      JSON.stringify(r));
    check('reconciled layers carry a rev (so /changes ships them)', v && typeof v.rev === 'number' && v.rev > 0);

    const again = await (await post('/admin/reconcile', {})).json();
    check('reconcile is idempotent (no re-adds)', again.added === 0, JSON.stringify(again).slice(0, 120));
  }

  // 10. GET /shared-layers — global catalogue (all users / all projects) -----
  console.log('\n[10] GET /shared-layers — global catalogue');
  {
    const list = await (await get('/shared-layers')).json();
    check('returns a layers array', Array.isArray(list.layers), JSON.stringify(list).slice(0, 120));
    // The shared layer pushed in [1] must be present regardless of any project.
    const found = (list.layers ?? []).some((l) => l.id === `shared-${now}`);
    check('includes a synced shared layer', found, `ids: ${(list.layers ?? []).map((l) => l.id).slice(0, 5).join(',')}`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
