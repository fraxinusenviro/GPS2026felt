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

export async function getBlob(key: string, env: Env): Promise<Response> {
  const obj = await env.BLOBS.get(key);
  if (!obj) return bad('blob not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}
