/**
 * Thin HTTP client for the Fraxinus Field Mapper Cloudflare backend (cloud/).
 *
 * Auth is Cloudflare Access: after the user logs in, the browser holds the
 * `CF_Authorization` cookie for the backend origin, so every request just uses
 * `credentials: 'include'` — there is no token to manage in the client.
 */

import type { ChangesResponse, SyncPushResult, SyncKind } from './types';
import type { SharedLayer } from '../types';

export class BackendClient {
  private base: string;

  constructor(baseUrl: string) {
    // Blank URL → same-origin (the PWA is served by the Worker itself), so API
    // calls are first-party and need no CORS.
    const trimmed = baseUrl.trim();
    const origin = typeof location !== 'undefined' ? location.origin : '';
    this.base = (trimmed || origin).replace(/\/+$/, '');
  }

  /**
   * The Cloudflare Access email of the logged-in user, or null when the
   * identity is unavailable (offline, not served by the Worker, or not behind
   * Access). Never throws.
   */
  async getWhoami(): Promise<{ email: string } | null> {
    try {
      const r = await fetch(`${this.base}/whoami`, { credentials: 'include', redirect: 'error' });
      if (!r.ok) return null;
      return await r.json() as { email: string };
    } catch {
      return null;
    }
  }

  /** Liveness check; never throws. */
  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/health`, { credentials: 'include', redirect: 'error' });
      return r.ok;
    } catch {
      return false;
    }
  }

  async postSync(body: Partial<Record<SyncKind, unknown[]>>): Promise<SyncPushResult> {
    const r = await fetch(`${this.base}/sync`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST /sync failed: ${r.status} ${await safeText(r)}`);
    return r.json() as Promise<SyncPushResult>;
  }

  async getChanges(since: number, limit = 1000): Promise<ChangesResponse> {
    const r = await fetch(`${this.base}/changes?since=${since}&limit=${limit}`, {
      credentials: 'include',
      redirect: 'error',
    });
    if (!r.ok) throw new Error(`GET /changes failed: ${r.status} ${await safeText(r)}`);
    return r.json() as Promise<ChangesResponse>;
  }

  /** The full org-shared static-data catalogue (all users, all projects). */
  async getSharedLayers(): Promise<SharedLayer[]> {
    const r = await fetch(`${this.base}/shared-layers`, { credentials: 'include', redirect: 'error' });
    if (!r.ok) throw new Error(`GET /shared-layers failed: ${r.status}`);
    const j = await r.json() as { layers?: SharedLayer[] };
    return j.layers ?? [];
  }

  /** Proxied blob upload (bytes flow through the Worker, behind Access). */
  async putBlob(key: string, blob: Blob): Promise<void> {
    const r = await fetch(`${this.base}/blobs/${encodeURIComponent(key)}`, {
      method: 'PUT',
      credentials: 'include',
      redirect: 'error',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!r.ok) throw new Error(`PUT /blobs failed: ${r.status} ${await safeText(r)}`);
  }

  /** Proxied blob download; null if the object is missing. */
  async getBlob(key: string): Promise<Blob | null> {
    const r = await fetch(`${this.base}/blobs/${encodeURIComponent(key)}`, { credentials: 'include', redirect: 'error' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GET /blobs failed: ${r.status} ${await safeText(r)}`);
    return r.blob();
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 200);
  } catch {
    return '';
  }
}
