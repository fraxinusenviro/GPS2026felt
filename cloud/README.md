# Fraxinus Field Mapper — Cloud Backend (Phase 1)

Production Cloudflare Worker that backs a **shared, org-controlled team dataset**:

- **D1** — one row per synced entity (projects, features, layer/type presets),
  with a server-assigned monotonic `rev` driving an incremental changes feed.
- **R2** — de-inlined photo/blob storage via presigned direct upload/download
  (zero egress), mirroring the Felt presigned-S3 pattern in `../src/io/FeltService.ts`.
- **Cloudflare Access** — real auth: the Worker verifies the Access JWT against
  the team JWKS. (The Phase 0 spike's placeholder bearer token is gone.)

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
cd cloud
npm install
cp .dev.vars.example .dev.vars      # blank R2 keys is fine; Access stays off (dev mode)
npm run migrate:local               # apply schema to the local D1
npm run dev                         # http://localhost:8787
# in another terminal:
BASE=http://localhost:8787 npm test
```

Expect sections [1]–[5] to pass; section [6] (presigned R2) reports `⊘ skipped`
without real R2 keys.

## B. Deploy to Cloudflare (needs the account + an Access app)

```bash
# 1. Resources
npx wrangler r2 bucket create ffm-blobs
npx wrangler d1 create ffm           # → paste database_id into wrangler.toml
#    Set R2_ACCOUNT_ID in wrangler.toml [vars].

# 2. Schema
npm run migrate:remote

# 3. R2 presigned secrets (R2 → Manage R2 API Tokens, Object Read & Write)
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY

# 4. Cloudflare Access
#    Create a self-hosted Access application in front of the Worker route, then
#    set TEAM_DOMAIN (https://<team>.cloudflareaccess.com) and ACCESS_AUD (the
#    application Audience tag) in wrangler.toml [vars]. Set ALLOWED_ORIGIN to the
#    PWA origin for CORS.

# 5. Deploy + test against the real deployment
npm run deploy
BASE=https://ffm-backend.<subdomain>.workers.dev TOKEN=<a valid Access JWT> npm test
```

## Status / next

Phase 1 delivers the production backend (schema + routes + Access). Validated
locally (12/12) including last-write-wins, the rev cursor, soft deletes, and the
auth gate denying unauthenticated requests. **Not yet validated**: real Access
JWT verification against a live Access app (needs deployment). Phase 2/3 wires
the PWA's `StorageManager` to this backend (push on save, pull on `/changes`,
de-inline photos to R2 on capture).
