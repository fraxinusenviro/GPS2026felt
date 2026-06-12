/**
 * Photo de-inlining for cloud sync.
 *
 * Locally, photos live as base64 data URLs on FieldFeature.photos (offline-first
 * display is unchanged). For the cloud, photos are de-inlined into R2: on push we
 * upload each photo and replace it with an R2 object key; on pull we fetch the
 * keys and rebuild the data URLs so the existing UI keeps working.
 *
 * Keys are content-addressed (SHA-256 of the data URL) so re-syncing the same
 * photo is idempotent, and an upload-cache skips bytes already pushed.
 */

import type { BackendClient } from './BackendClient';

const LS_UPLOADED = 'ffm_sync_photos'; // set of R2 keys already uploaded

function loadUploaded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_UPLOADED) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveUploaded(s: Set<string>): void {
  try {
    localStorage.setItem(LS_UPLOADED, JSON.stringify([...s].slice(-2000)));
  } catch {
    /* quota — non-fatal */
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?)(;|$)/)?.[1] || 'image/jpeg';
  const ext = mime.split('/')[1]?.split('+')[0] || 'jpg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), ext };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A value is a data URL (inline photo) rather than an already-de-inlined key. */
function isDataUrl(s: string): boolean {
  return s.startsWith('data:');
}

/**
 * Upload any inline (data URL) photos to R2 and return the list of R2 keys for
 * this feature. Entries that are already keys are passed through untouched.
 */
export async function deinlinePhotos(
  client: BackendClient,
  featureId: string,
  photos: string[]
): Promise<string[]> {
  if (!photos.length) return [];
  const uploaded = loadUploaded();
  const keys: string[] = [];

  for (const photo of photos) {
    if (!isDataUrl(photo)) {
      keys.push(photo); // already a key
      continue;
    }
    const { blob, ext } = dataUrlToBlob(photo);
    const hash = (await sha256Hex(photo)).slice(0, 32);
    const key = `photos/${featureId}/${hash}.${ext}`;
    if (!uploaded.has(key)) {
      await client.putBlob(key, blob);
      uploaded.add(key);
    }
    keys.push(key);
  }

  saveUploaded(uploaded);
  return keys;
}

/**
 * Rebuild base64 data URLs from R2 keys (used when applying pulled features).
 * Missing/failed blobs are skipped so a bad key can't break a sync.
 */
export async function inlinePhotos(client: BackendClient, keys: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const key of keys) {
    if (isDataUrl(key)) {
      out.push(key);
      continue;
    }
    try {
      const blob = await client.getBlob(key);
      if (blob) out.push(await blobToDataUrl(blob));
    } catch {
      /* skip unreachable blob */
    }
  }
  return out;
}
