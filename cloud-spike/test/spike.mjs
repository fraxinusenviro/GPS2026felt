/**
 * Phase 0 throwaway validation script.
 *
 * Exercises the Worker end-to-end:
 *   - D1 round-trip:  POST /sync  → GET /changes?since=
 *   - R2 (proxied):   PUT /blobs  → GET /blobs   (works against local `wrangler dev`)
 *   - R2 (presigned): /uploads/sign → direct R2 PUT/GET (skipped unless R2 keys set)
 *
 * Usage:
 *   wrangler dev                 # in another terminal (local Miniflare)
 *   npm run db:init:local        # apply schema to local D1 (once)
 *   BASE=http://localhost:8787 TOKEN=... node test/spike.mjs
 */

const BASE = process.env.BASE ?? 'http://localhost:8787';
const TOKEN = process.env.TOKEN ?? '';

const headers = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  console.log(`\nFFM Phase 0 spike → ${BASE}\n`);

  // 0. health
  const h = await fetch(`${BASE}/health`, { headers });
  check('GET /health 200', h.status === 200, `(got ${h.status})`);

  // 1. D1 round-trip ------------------------------------------------------
  console.log('\n[1] D1 feature sync round-trip');
  const now = Date.now();
  const feat = {
    id: `spike-${now}`,
    project_id: 'spike-project',
    geometry: { type: 'Point', coordinates: [-63.57, 44.65] },
    properties: { type: 'tree', notes: 'phase-0 test' },
    photo_keys: [`photos/${now}.jpg`],
    updated_at: now,
  };
  const syncRes = await fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ features: [feat] }),
  });
  const syncBody = await syncRes.json();
  check('POST /sync applied the feature', syncRes.ok && syncBody.applied === 1, JSON.stringify(syncBody));

  const changesRes = await fetch(`${BASE}/changes?since=${now - 1}`, { headers });
  const changesBody = await changesRes.json();
  const found = (changesBody.features ?? []).find((f) => f.id === feat.id);
  check('GET /changes returns the feature', !!found, JSON.stringify(changesBody).slice(0, 200));
  check('geometry survived round-trip', found && found.geometry.coordinates[0] === -63.57);
  check('photo_keys survived round-trip', found && found.photo_keys[0] === `photos/${now}.jpg`);

  // last-write-wins: stale update should be skipped
  const stale = await fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ features: [{ ...feat, updated_at: now - 1000, properties: { type: 'STALE' } }] }),
  });
  const staleBody = await stale.json();
  check('stale update is skipped (LWW)', staleBody.applied === 0, JSON.stringify(staleBody));

  // 2. R2 proxied blob round-trip ----------------------------------------
  console.log('\n[2] R2 proxied blob round-trip');
  const blobKey = `photos/${now}.txt`;
  const payload = `hello-r2-${now}`;
  const put = await fetch(`${BASE}/blobs/${encodeURIComponent(blobKey)}`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'text/plain' },
    body: payload,
  });
  check('PUT /blobs stored object', put.ok, `(got ${put.status})`);
  const get = await fetch(`${BASE}/blobs/${encodeURIComponent(blobKey)}`, { headers });
  const got = await get.text();
  check('GET /blobs returns same bytes', got === payload, `(got "${got.slice(0, 40)}")`);

  // 3. R2 presigned round-trip (only if backend has R2 keys configured) ---
  console.log('\n[3] R2 presigned URL round-trip');
  const signRes = await fetch(`${BASE}/uploads/sign`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ key: `photos/presigned-${now}.txt` }),
  });
  if (signRes.status === 501) {
    console.log('  ⊘ skipped — R2 S3 credentials not configured (expected for local dev)');
  } else {
    const sign = await signRes.json();
    check('POST /uploads/sign returns a PUT url', signRes.ok && !!sign.url, JSON.stringify(sign));
    const directPut = await fetch(sign.url, { method: 'PUT', body: payload });
    check('direct PUT to presigned R2 url', directPut.ok, `(got ${directPut.status})`);
    const dlRes = await fetch(`${BASE}/uploads/sign?key=${encodeURIComponent(sign.key)}`, { headers });
    const dl = await dlRes.json();
    const direct = await fetch(dl.url);
    const directBody = await direct.text();
    check('direct GET from presigned R2 url', directBody === payload, `(got "${directBody.slice(0, 40)}")`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('spike crashed:', e);
  process.exit(1);
});
