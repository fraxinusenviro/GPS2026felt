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
  });
  const syncBody = await syncRes.json();
  check('all four applied', syncRes.ok &&
    syncBody.applied.projects === 1 && syncBody.applied.features === 1 &&
    syncBody.applied.layer_presets === 1 && syncBody.applied.type_presets === 1,
    JSON.stringify(syncBody));
  check('server returned a rev cursor', typeof syncBody.rev === 'number' && syncBody.rev > 0);

  // 2. pull everything back ------------------------------------------------
  console.log('\n[2] GET /changes — pull + doc round-trip');
  const c1 = await (await get('/changes?since=0')).json();
  const feat = (c1.features ?? []).find((f) => f.id === featId);
  const layer = (c1.layer_presets ?? []).find((l) => l.id === layerId);
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

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
