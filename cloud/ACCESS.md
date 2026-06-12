# Cloudflare Access setup — Fraxinus Field Mapper

The `fieldmapper` Worker serves **both** the PWA and the sync/blob API from one
origin: `https://fieldmapper.fraxinusenviro.workers.dev`. One Cloudflare Access
application protects that whole hostname, so:

- The user signs in on the normal page load (a top-level navigation Access can
  redirect), not a background `fetch` — no redirect-during-fetch problem.
- API calls are **same-origin**, so the `CF_Authorization` cookie is first-party
  and always sent. **No CORS, no token flow, no custom domain.**
- Access injects the `Cf-Access-Jwt-Assertion` header into requests reaching the
  Worker; `src/auth.ts` verifies it (JWKS at `${TEAM_DOMAIN}/cdn-cgi/access/certs`,
  checking `iss` = team domain and `aud` = the application AUD tag).

Confirmed for this account:

| Setting | Value |
|---|---|
| Worker / hostname | `fieldmapper` → `https://fieldmapper.fraxinusenviro.workers.dev` |
| `TEAM_DOMAIN` | `https://fraxinusenviro.cloudflareaccess.com` (already in `wrangler.toml`) |
| Access policy | Allow emails ending in `@fraxinusenviro.com` |
| `ACCESS_AUD` | filled in at step 4 (generated when the app is created) |

## Deploy the Worker

Deploys run automatically from GitHub via
`.github/workflows/deploy-cloudflare.yml` — **you never run `wrangler` locally.**
"Deploy" / "redeploy" anywhere below means: **commit the change and push** to the
default branch (or GitHub → **Actions → Deploy fieldmapper Worker to Cloudflare →
Run workflow**).

One-time setup, all in the browser:

1. **Create resources** (Cloudflare dashboard): an **R2 bucket** named `ffm-blobs`
   and a **D1 database** named `ffm`; copy the D1 **Database ID**.
2. **Edit `cloud/wrangler.toml`** on GitHub: set `database_id` to that ID and
   `R2_ACCOUNT_ID` to your account id (`1edcb67fc582d37374725ed3bd8dc91a`).
3. **Add GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template + D1:Edit) and
   `CLOUDFLARE_ACCOUNT_ID`.
4. **Trigger the workflow** (merge to the default branch, or Run workflow). CI
   builds the PWA, applies D1 migrations, and deploys to
   `fieldmapper.fraxinusenviro.workers.dev`.

> The R2 S3 secrets (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) are **optional** —
> the app moves photos through the R2 binding (`/blobs`), not the presigned routes.

After the first deploy the app is live but **unprotected** (Access vars blank →
dev mode). Create the Access app next, then push the `ACCESS_AUD` change to enforce it.

<details>
<summary>Alternative: deploy from a local clone instead of CI</summary>

```bash
npm install && npm run build      # repo root → builds ../dist
cd cloud && npm install
npx wrangler login
npx wrangler r2 bucket create ffm-blobs
npx wrangler d1 create ffm        # → paste database_id into wrangler.toml
npm run migrate:remote
npx wrangler deploy
```
</details>

## 1. Create the self-hosted Access application (Dashboard)

1. [Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Access → Applications → Add an application → Self-hosted**.
2. **Application name**: `Fraxinus Field Mapper`.
3. **Session Duration**: e.g. `24 hours` (or longer for field use).
4. **Public hostname**: `fieldmapper.fraxinusenviro.workers.dev` (the whole host —
   no path, so both the PWA and the API are protected).
5. Identity providers: keep your default; add **One-time PIN** if you have none,
   so any `@fraxinusenviro.com` address can verify by email.

## 2. Add the access policy

1. **Add a policy** → Name `Fraxinus team`, Action **Allow**.
2. **Include** → selector **Emails ending in** → `@fraxinusenviro.com`.
3. Save.

> No CORS settings are needed — the app and API are the same origin.

## 3. Copy the AUD

In the application → **Overview / Additional settings** → copy the
**Application Audience (AUD) Tag**.

## 4. Enforce Access and redeploy

1. In `cloud/wrangler.toml`, set:
   ```toml
   ACCESS_AUD = "<the AUD tag>"
   ```
   (`TEAM_DOMAIN` is already set.)
2. **Commit that edit** on GitHub to the default branch. The push triggers the
   deploy workflow, which redeploys with Access enforced. (No local command — to
   redeploy without a code change, use GitHub → Actions → Run workflow.)

## 5. Verify

- Open `https://fieldmapper.fraxinusenviro.workers.dev` in a browser → you should
  be redirected to the Access login, then to the app after signing in.
- In the app: **Settings → Cloud Sync** → enable, **leave Backend URL blank**
  (same origin), **Sync Now**. Status should show online with 0 pending.

```bash
# Unauthenticated API call is rejected (Access blocks at the edge, or Worker 401s):
curl -i https://fieldmapper.fraxinusenviro.workers.dev/changes?since=0
```

## Alternative: create the app via API

Needs an API token with **Access: Apps and Policies Write** plus a policy id:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "name": "Fraxinus Field Mapper",
    "type": "self_hosted",
    "domain": "fieldmapper.fraxinusenviro.workers.dev",
    "session_duration": "24h"
  }'
# Copy the returned "aud" → ACCESS_AUD in wrangler.toml, then add an Allow policy
# for emails ending in @fraxinusenviro.com, and redeploy.
```
