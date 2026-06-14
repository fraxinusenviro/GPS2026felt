/**
 * /almanac — proxy endpoint that fetches the current GPS Yuma almanac from
 * NAVCEN and caches the result in R2 for 12 hours.
 *
 * The almanac is public data (no auth required). Consumers get a plain-text
 * Yuma-format file they can pass directly into the frontend parser.
 */

import type { Env } from './types';

// Official NAVCEN (US Coast Guard Navigation Center) GPS almanac URL.
// Published daily; valid for ~7 days. Update this if NAVCEN changes their path.
const NAVCEN_URL = 'https://www.navcen.uscg.gov/gps/almanacs/current.alm';
const CACHE_KEY  = 'almanac/current.alm';
const CACHE_TTL  = 12 * 3600 * 1000; // 12 hours in ms

export async function handleAlmanac(_req: Request, env: Env): Promise<Response> {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'max-age=3600',
  };

  // Serve from R2 cache if fresh
  const cached = await env.BLOBS.get(CACHE_KEY);
  if (cached) {
    const fetchedAt = Number(cached.customMetadata?.fetchedAt ?? 0);
    if (Date.now() - fetchedAt < CACHE_TTL) {
      return new Response(await cached.text(), { headers });
    }
  }

  // Fetch fresh from NAVCEN
  let upstream: Response;
  try {
    upstream = await fetch(NAVCEN_URL, {
      headers: { 'User-Agent': 'FraxinusFieldMapper/1.0' },
    });
  } catch {
    // Network failure — serve stale cache if available rather than returning an error
    if (cached) return new Response(await cached.text(), { headers });
    return new Response('GPS almanac unavailable (upstream unreachable)', { status: 502 });
  }

  if (!upstream.ok) {
    if (cached) return new Response(await cached.text(), { headers });
    return new Response(`GPS almanac unavailable (upstream ${upstream.status})`, { status: 502 });
  }

  const text = await upstream.text();

  // Cache in R2 (fire-and-forget — don't block the response)
  void env.BLOBS.put(CACHE_KEY, text, {
    customMetadata: { fetchedAt: String(Date.now()) },
  });

  return new Response(text, { headers });
}
