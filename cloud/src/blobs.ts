/**
 * R2 blob storage for de-inlined photos.
 *
 *  - Presigned direct upload/download (POST/GET /uploads/sign): the browser
 *    moves bytes straight to/from R2, so large photos never transit the Worker.
 *    Mirrors the Felt presigned-S3 flow in ../../src/io/FeltService.ts.
 *  - Proxied fallback (PUT/GET /blobs/:key): bytes flow through the Worker.
 *    Kept for small payloads and environments without R2 S3 keys.
 */

import { AwsClient } from 'aws4fetch';
import type { Env } from './types';
import { json, bad } from './http';

function r2Client(env: Env): { client: AwsClient; base: string } | null {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    return null;
  }
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  return { client, base: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}` };
}

export async function signUpload(request: Request, env: Env): Promise<Response> {
  const r2 = r2Client(env);
  if (!r2) return bad('R2 S3 credentials not configured', 501);
  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  if (!body?.key) return bad('expected { key }');
  const signed = await r2.client.sign(`${r2.base}/${encodeURIComponent(body.key)}?X-Amz-Expires=900`, {
    method: 'PUT',
    aws: { signQuery: true },
  });
  return json({ key: body.key, method: 'PUT', url: signed.url, expiresIn: 900 });
}

export async function signDownload(url: URL, env: Env): Promise<Response> {
  const r2 = r2Client(env);
  if (!r2) return bad('R2 S3 credentials not configured', 501);
  const key = url.searchParams.get('key');
  if (!key) return bad('expected ?key=');
  const signed = await r2.client.sign(`${r2.base}/${encodeURIComponent(key)}?X-Amz-Expires=900`, {
    method: 'GET',
    aws: { signQuery: true },
  });
  return json({ key, method: 'GET', url: signed.url, expiresIn: 900 });
}

export async function putBlob(key: string, request: Request, env: Env): Promise<Response> {
  const obj = await env.BLOBS.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
  });
  return json({ key, etag: obj?.etag ?? null });
}

/** Proxied blob download with HTTP Range support (needed for COG range reads). */
export async function getBlob(key: string, request: Request, env: Env): Promise<Response> {
  const rangeHeader = request.headers.get('range');
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;

  if (m) {
    const head = await env.BLOBS.head(key);
    if (!head) return bad('blob not found', 404);
    const total = head.size;
    const startStr = m[1];
    const endStr = m[2];
    let offset: number;
    let length: number;
    if (!startStr && endStr) {
      // suffix range: bytes=-N → last N bytes
      length = Math.min(parseInt(endStr, 10), total);
      offset = total - length;
    } else {
      offset = startStr ? parseInt(startStr, 10) : 0;
      const lastByte = endStr ? Math.min(parseInt(endStr, 10), total - 1) : total - 1;
      length = lastByte - offset + 1;
    }
    if (offset < 0 || offset >= total || length <= 0) {
      return new Response('range not satisfiable', { status: 416, headers: { 'content-range': `bytes */${total}` } });
    }
    const obj = await env.BLOBS.get(key, { range: { offset, length } });
    if (!obj) return bad('blob not found', 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${total}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  const obj = await env.BLOBS.get(key);
  if (!obj) return bad('blob not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  return new Response(obj.body, { headers });
}
