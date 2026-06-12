# Cloudflare Access setup — Fraxinus Field Mapper backend

This protects the `ffm-backend` Worker so only your team can reach `/sync`,
`/changes`, and `/blobs`. The Worker verifies the Access JWT in `src/auth.ts`
(JWKS at `${TEAM_DOMAIN}/cdn-cgi/access/certs`, checking `iss` = team domain and
`aud` = the application AUD tag) — this matches Cloudflare's documented pattern.

Confirmed for this account:

| Setting | Value |
|---|---|
| `TEAM_DOMAIN` | `https://fraxinusenviro.cloudflareaccess.com` (already in `wrangler.toml`) |
| Access policy | Allow emails ending in `@fraxinusenviro.com` |
| PWA hosting | **Separate origin** from the API → CORS required |
| `ACCESS_AUD` | filled in at step 3 (generated when the app is created) |
| `ALLOWED_ORIGIN` | filled in at step 4 (your PWA origin) |

> ⚠️ **Cross-origin caveat.** Because the PWA runs on a different origin than the
> Worker, the per-user Access session cookie (`CF_Authorization`) is a
> *third-party* cookie for the API. Most browsers block third-party cookies by
> default, and an expired session makes Access return a login redirect that
> `fetch()` cannot follow — so credentialed cross-origin sync is brittle. The
> robust fix is to host the PWA on the **same parent domain** as the API (e.g.
> `app.fraxinusenviro.com` + `api.fraxinusenviro.com`) behind one Access app, so
> the cookie is first-party. Revisit this if sync auth proves flaky in the field.

## 1. Create the self-hosted Access application (Dashboard)

1. [Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Access → Applications → Add an application**.
2. Choose **Self-hosted**.
3. **Application name**: `Fraxinus Field Mapper API`.
4. **Session Duration**: e.g. `24 hours`.
5. **Public hostname / Application domain**: the Worker's hostname —
   `ffm-backend.<your-subdomain>.workers.dev` (the URL `wrangler deploy` printed,
   without `https://`).
6. Leave identity providers at your default (add One-time PIN if none configured,
   so any `@fraxinusenviro.com` email can verify).
7. Continue to **Policies**.

## 2. Add the access policy

1. **Add a policy** → Name: `Fraxinus team`, Action: **Allow**.
2. **Include** rule → Selector **Emails ending in** → value `@fraxinusenviro.com`.
3. Save and continue.

## 2b. Enable CORS (required — separate-origin PWA)

In the application's **Settings → CORS settings** (a.k.a. Additional settings):

- **Access-Control-Allow-Origins**: your exact PWA origin (e.g. `https://fieldmapper.pages.dev`).
- **Access-Control-Allow-Methods**: `GET, POST, PUT, OPTIONS`.
- **Access-Control-Allow-Headers**: `content-type`.
- **Allow credentials**: **on** (so the session cookie is honored).

This lets Access answer the browser's unauthenticated `OPTIONS` preflight; the
Worker's own CORS headers (in `src/http.ts`) cover the actual responses.

## 3. Copy the AUD and set it

1. Open the application → **Overview / Additional settings** → copy the **Application Audience (AUD) Tag**.
2. In `cloud/wrangler.toml`, set:
   ```toml
   ACCESS_AUD = "<the AUD tag>"
   ```

## 4. Set the PWA origin and redeploy

1. In `cloud/wrangler.toml`, set `ALLOWED_ORIGIN` to your PWA origin (no trailing slash).
2. Redeploy:
   ```bash
   cd cloud
   npx wrangler deploy
   ```

## 5. Verify

```bash
# Unauthenticated → Access blocks before the Worker (302/403), or the Worker 401s.
curl -i https://ffm-backend.<subdomain>.workers.dev/changes?since=0

# /health stays open (no auth) and should return 200.
curl -i https://ffm-backend.<subdomain>.workers.dev/health
```

Then, in the PWA: **Settings → Cloud Sync** → enable, set **Backend URL** to the
Worker URL, sign in via Access when prompted, and hit **Sync Now**.

## Alternative: create the app via API

If you'd rather script it (needs an API token with **Access: Apps and Policies
Write**, plus a policy id):

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "name": "Fraxinus Field Mapper API",
    "type": "self_hosted",
    "domain": "ffm-backend.<your-subdomain>.workers.dev",
    "session_duration": "24h",
    "cors_headers": {
      "allowed_methods": ["GET", "POST", "PUT", "OPTIONS"],
      "allowed_origins": ["https://<your-pwa-origin>"],
      "allowed_headers": ["content-type"],
      "allow_credentials": true
    }
  }'
# Copy the returned "aud" → ACCESS_AUD in wrangler.toml, then add an Allow policy
# for emails ending in @fraxinusenviro.com.
```
