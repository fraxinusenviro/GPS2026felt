/**
 * Cloudflare Access authentication.
 *
 * In production, Cloudflare Access sits in front of this Worker and injects a
 * signed JWT (header `Cf-Access-Jwt-Assertion`, or the `CF_Authorization`
 * cookie for browser requests). We verify it against the team's public JWKS and
 * check the audience + issuer, then trust the `email` claim as the identity.
 *
 * DEV MODE: when TEAM_DOMAIN and ACCESS_AUD are both unset (local `wrangler dev`
 * and tests), verification is skipped and the identity comes from an optional
 * `X-Dev-User` header (default dev@local). This must never happen in prod — both
 * vars are set there, so the real path always runs.
 */

import type { Env, Identity } from './types';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

// JWKS are cached briefly; Cloudflare rotates Access signing keys.
let jwksCache: { keys: Jwk[]; fetchedAt: number; domain: string } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.domain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys, fetchedAt: Date.now(), domain: teamDomain };
  return keys;
}

function readToken(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

/**
 * Returns the verified identity, or null if the request is unauthenticated /
 * the token is invalid.
 */
export async function authenticate(request: Request, env: Env): Promise<Identity | null> {
  // --- dev mode: Access not configured ---
  if (!env.TEAM_DOMAIN || !env.ACCESS_AUD) {
    const dev = request.headers.get('x-dev-user');
    return { email: dev || 'dev@local', sub: dev || 'dev' };
  }

  const token = readToken(request);
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSig] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; email?: string; sub?: string };
  try {
    header = b64urlToJson(rawHeader);
    payload = b64urlToJson(rawPayload);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  // signature
  const keys = await getJwks(env.TEAM_DOMAIN);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(rawSig),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
  );
  if (!ok) return null;

  // claims
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  if (payload.iss !== env.TEAM_DOMAIN) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (!payload.email) return null;

  return { email: payload.email, sub: payload.sub ?? payload.email };
}
