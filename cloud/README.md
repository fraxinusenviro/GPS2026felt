# Fraxinus Field Mapper — Cloud Backend

Production Cloudflare Worker (`fieldmapper`) that serves the **PWA and the
sync/blob API from one origin** and backs a **shared, org-controlled team dataset**:

- **Static Assets** — the Worker serves the built PWA (`../dist`); API paths
  (`/sync`, `/changes`, `/blobs`, `/uploads/*`, `/health`) are handled in code.
  Single origin → the Access cookie is first-party and there is **no CORS**.
- **D1** — one row per synced entity (projects, features, layer/type presets),
  with a server-assigned monotonic `rev` driving an incremental changes feed.
- **R2** — de-inlined photo/blob storage via presigned direct upload/download
  (zero egress), mirroring the Felt presigned-S3 pattern in `../src/io/FeltService.ts`.
- **Cloudflare Access** — real auth: the Worker verifies the Access JWT against
  the team JWKS. See **ACCESS.md** for the deploy + Access setup runbook.

This supersedes the throwaway `../cloud-spike/`.

## Architecture

### Sync protocol

`POST /sync` accepts changed entities grouped by kind; `GET /changes?since=<rev>`
pulls everything written after a cursor.

```
POST /sync
{
  "projects":      [Project, ...],
  "features":      [FieldFeature, ...],   // photos de-inlined to R2 keys
  "layer_presets": [LayerPreset, ...],
  "type_presets":  [TypePreset, ...]
}
→ { applied: {projects, features, layer_presets, type_presets}, skipped, rev }
```

- **Conflict resolution**: last-write-wins on each entity's `updated_at`
  (ISO 8601). A stale push (older `updated_at`) is silently skipped.
- **Cursor**: every applied write gets a globally monotonic `rev` from `sync_seq`.
  Clients persist the highest `rev` they've seen and pull with `?since=`. This is
  server-assigned, so it's robust against skewed device clocks.
- **Deletes**: send `{ id, deleted: true, updated_at }`; soft-deletes propagate
  through `/changes` so other devices can remove the row locally.
- **Source of truth**: the full entity JSON is stored in a `doc` column. A few
  fields (`project_id`, `layer_id`, `geometry`, `lat`, `lon`) are promoted to
  columns for server-side querying without losing any data.

### Auth

| Config (`wrangler.toml [vars]`) | Behaviour |
|---|---|
| `TEAM_DOMAIN` + `ACCESS_AUD` both set | **Production**: verify the Access JWT (`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie) against the team JWKS; check `aud`, `iss`, `exp`. Identity = the `email` claim. |
| both unset | **Dev**: skip verification; identity from the `X-Dev-User` header (default `dev@local`). Local `wrangler dev` + tests only. |

`/health` is the only unauthenticated route.

## Files

- `src/index.ts` — router + auth gate + CORS
- `src/auth.ts` — Cloudflare Access JWT verification (JWKS, RS256)
- `src/sync.ts` — `/sync` + `/changes` (rev reservation, last-write-wins)
- `src/blobs.ts` — R2 presigned URLs + proxied fallback
- `src/types.ts` — `Env`, entity/table config
- `src/http.ts` — JSON + CORS helpers
- `schema/0001_init.sql` — D1 schema (numbered migration)
- `test/backend.test.mjs` — end-to-end validation

## A. Local validation (no Cloudflare account)

```bash
npm run build                       # from repo ROOT — builds the PWA into ../dist
                                    # (Static Assets needs ../dist to exist)
cd cloud
npm install
cp .dev.vars.example .dev.vars      # blank R2 keys is fine; Access stays off (dev mode)
npm run migrate:local               # apply schema to the local D1
npm run dev                         # http://localhost:8787 — serves PWA + API
# in another terminal:
BASE=http://localhost:8787 npm test
```

Expect sections [1]–[5] to pass; section [6] (presigned R2) reports `⊘ skipped`
without real R2 keys. `GET /` should return the PWA's `index.html`.

## B. Deploy to Cloudflare

The full deploy + Cloudflare Access runbook lives in **ACCESS.md**. In short:
`npm run build` (root) → create R2/D1 + secrets → `wrangler deploy` → create the
self-hosted Access application over `fieldmapper.fraxinusenviro.workers.dev`,
copy its AUD into `ACCESS_AUD`, and redeploy.

## Status / next

Backend + sync engine + single-origin PWA hosting are built and validated
locally (12/12 API: last-write-wins, the rev cursor, soft deletes, the auth gate
denying unauthenticated requests; plus static-asset + SPA-fallback serving). The
PWA client (`../src/sync/`) pushes on save and pulls via `/changes`, de-inlining
photos to R2. **Not yet validated**: the live deploy + real Access JWT
verification against the Access application (needs your Cloudflare account —
see ACCESS.md).
