# Phase 0 Spike — Cloudflare backend for Fraxinus Field Mapper

A throwaway, self-contained Cloudflare Worker that validates the recommended
backend architecture before any app changes:

- **D1** (SQLite) for queryable feature metadata + a `/changes` sync feed
- **R2** (S3-compatible object storage, zero egress) for photos/blobs
- **Workers** as the single glue layer (auth + sync API + presigned URLs)

It mirrors the presigned-upload pattern already used for Felt in
`../src/io/FeltService.ts`. **None of this is production code** — auth is a
placeholder bearer token; real auth will be Cloudflare Access.

## What it proves

| # | Capability | Endpoints | Local-testable? |
|---|---|---|---|
| 1 | D1 round-trip + last-write-wins | `POST /sync`, `GET /changes?since=` | ✅ yes |
| 2 | R2 blob storage (proxied) | `PUT/GET /blobs/:key` | ✅ yes |
| 3 | R2 presigned direct upload/download | `POST/GET /uploads/sign` | needs real R2 keys |

## A. Local validation (no Cloudflare account needed)

`wrangler dev` runs the Worker, R2, and D1 locally via Miniflare.

```bash
cd cloud-spike
npm install
cp .dev.vars.example .dev.vars          # SPIKE_TOKEN=dev-token is enough for local
npm run db:init:local                   # apply schema.sql to the local D1
npm run dev                             # starts http://localhost:8787
```

In a second terminal:

```bash
cd cloud-spike
BASE=http://localhost:8787 TOKEN=dev-token npm run spike
```

Expect sections [1] and [2] to pass; section [3] reports `⊘ skipped` locally.

## B. Real Cloudflare validation (needs an account)

These steps touch your Fraxinus Cloudflare account — run them yourself with an
authenticated `wrangler` (`npx wrangler login`).

```bash
# 1. Create resources
npx wrangler r2 bucket create ffm-blobs-spike
npx wrangler d1 create ffm-spike
#    → copy the printed database_id into wrangler.toml (database_id = "...")

# 2. Apply schema to remote D1
npm run db:init:remote

# 3. Set secrets (R2 → Manage R2 API Tokens gives the access key id + secret)
npx wrangler secret put SPIKE_TOKEN
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
#    Also set R2_ACCOUNT_ID in wrangler.toml [vars] (your Cloudflare account id).

# 4. Deploy + test (section 3 presigned path now runs too)
npm run deploy
BASE=https://ffm-cloud-spike.<your-subdomain>.workers.dev TOKEN=<token> npm run spike
```

## Exit criteria

Phase 0 is complete when, against a **real** deployment, `npm run spike` reports
all three sections passing — i.e. a feature written via `/sync` reads back via
`/changes`, last-write-wins rejects stale updates, and a blob round-trips through
both the proxied and presigned R2 paths. That confirms the R2 + D1 + Workers
design holds before we touch the PWA in Phase 2/3.

## Files

- `src/index.ts` — the Worker (all routes)
- `schema.sql` — D1 schema (mirrors `FieldFeature` shape, photos de-inlined)
- `wrangler.toml` — bindings + config
- `test/spike.mjs` — the validation script
- `.dev.vars.example` — local secrets template
