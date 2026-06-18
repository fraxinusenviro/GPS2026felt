/**
 * HTTP helpers: JSON responses and CORS for the PWA origin.
 */

import type { Env } from './types';

export const json = (data: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const bad = (msg: string, status = 400): Response => json({ error: msg }, status);

/** HTML response with no-store headers so the page itself is never cached. */
export const html = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });

/** CORS headers for the configured PWA origin (credentialed). Empty if unset. */
export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN;
  if (!allowed) return {};
  const origin = request.headers.get('origin');
  if (origin !== allowed) return {};
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, cf-access-jwt-assertion, x-dev-user',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}
