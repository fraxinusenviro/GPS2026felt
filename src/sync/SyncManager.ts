/**
 * SyncManager — orchestrates PWA ↔ Cloudflare backend sync.
 *
 * Design goals: opt-in (default off → zero behaviour change), offline-tolerant,
 * and never blocking a local save. Local writes flow through StorageManager,
 * which calls our `mark()` hook to record a dirty entry; we debounce-flush those
 * to POST /sync, and pull others' changes via GET /changes using a server-issued
 * monotonic rev cursor. Conflicts resolve last-write-wins on `updated_at`.
 *
 * State (dirty set, cursor, upload cache) lives in localStorage, so no IndexedDB
 * schema change is needed.
 */

import type { StorageManager, StorageSyncHook } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import { BackendClient } from './BackendClient';
import { deinlinePhotos, inlinePhotos } from './PhotoSync';
import { SYNC_KINDS } from './types';
import type { SyncKind, SyncOp, DirtyEntry, SyncStatus, RemoteMeta } from './types';
import type { FieldFeature } from '../types';

const LS_ENABLED = 'ffm_sync_enabled';
const LS_URL = 'ffm_sync_url';
const LS_CURSOR = 'ffm_sync_cursor';
const LS_DIRTY = 'ffm_sync_dirty';
const LS_BOOTSTRAPPED = 'ffm_sync_bootstrapped';

const FLUSH_DEBOUNCE_MS = 1500;
const POLL_INTERVAL_MS = 60_000;
const PAGE_LIMIT = 500;

export class SyncManager implements StorageSyncHook {
  private client: BackendClient | null = null;
  private enabled = false;
  private dirty = new Map<string, DirtyEntry>();
  private cursor = 0;
  private syncing = false;
  private lastSync: number | null = null;
  private lastError: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private storage: StorageManager) {
    this.dirty = loadDirty();
    this.cursor = Number(localStorage.getItem(LS_CURSOR) ?? '0') || 0;
  }

  // ---- config -----------------------------------------------------------

  static getConfig(): { enabled: boolean; url: string } {
    return {
      enabled: localStorage.getItem(LS_ENABLED) === '1',
      url: localStorage.getItem(LS_URL) ?? '',
    };
  }

  /** Persist config and (re)start or stop syncing accordingly. */
  setConfig(enabled: boolean, url: string): void {
    localStorage.setItem(LS_ENABLED, enabled ? '1' : '0');
    localStorage.setItem(LS_URL, url.trim());
    this.stop();
    this.start();
  }

  start(): void {
    const { enabled, url } = SyncManager.getConfig();
    // A blank URL is valid: it means same-origin (the PWA served by the Worker).
    this.enabled = enabled;
    this.client = this.enabled ? new BackendClient(url) : null;
    if (!this.enabled) {
      this.emitStatus();
      return;
    }
    window.addEventListener('online', this.onOnline);
    this.pollTimer = setInterval(() => void this.syncNow(), POLL_INTERVAL_MS);
    this.emitStatus();
    void this.bootstrapIfNeeded().then(() => this.syncNow()); // initial reconcile
  }

  /**
   * On first enable, mark all pre-existing local data dirty so the device's
   * current dataset uploads. Runs once (guarded by a localStorage flag).
   */
  private async bootstrapIfNeeded(): Promise<void> {
    if (!this.enabled || localStorage.getItem(LS_BOOTSTRAPPED) === '1') return;
    const now = new Date().toISOString();
    const [projects, features, layers, types, shared, maps] = await Promise.all([
      this.storage.getAllProjects(),
      this.storage.getAllFeatures(),
      this.storage.getAllLayerPresets(),
      this.storage.getAllTypePresets(),
      this.storage.getAllSharedLayers(),
      this.storage.getAllMaps(),
    ]);
    for (const p of projects) this.mark('projects', p.id, 'upsert', p.updated_at ?? now);
    for (const f of features) this.mark('features', f.id, 'upsert', f.updated_at ?? now);
    for (const l of layers) this.mark('layer_presets', l.id, 'upsert', now);
    for (const t of types) this.mark('type_presets', t.id, 'upsert', now);
    for (const s of shared) this.mark('shared_layers', s.id, 'upsert', s.updated_at ?? now);
    for (const m of maps) this.mark('project_maps', m.id, 'upsert', m.updated_at ?? now);
    localStorage.setItem(LS_BOOTSTRAPPED, '1');
  }

  stop(): void {
    window.removeEventListener('online', this.onOnline);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pollTimer = null;
    this.flushTimer = null;
  }

  private onOnline = () => void this.syncNow();

  // ---- StorageSyncHook --------------------------------------------------

  mark(kind: string, id: string, op: SyncOp, updatedAt: string): void {
    if (!this.enabled) return;
    this.dirty.set(`${kind}:${id}`, { kind: kind as SyncKind, id, op, updated_at: updatedAt });
    saveDirty(this.dirty);
    this.emitStatus();
    this.scheduleFlush();
  }

  // ---- public actions ---------------------------------------------------

  /** Push pending local changes, then pull remote changes. */
  async syncNow(): Promise<void> {
    if (!this.enabled || !this.client || this.syncing || !navigator.onLine) return;
    this.syncing = true;
    this.lastError = null;
    this.emitStatus();
    try {
      await this.flush();
      await this.pull();
      this.lastSync = Date.now();
    } catch (err) {
      this.lastError = (err as Error).message;
      console.warn('[sync] syncNow failed:', err);
    } finally {
      this.syncing = false;
      this.emitStatus();
    }
  }

  // ---- push -------------------------------------------------------------

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.syncNow(), FLUSH_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    if (!this.client || this.dirty.size === 0) return;
    const entries = [...this.dirty.values()];
    const body: Record<SyncKind, Record<string, unknown>[]> = {
      projects: [], features: [], layer_presets: [], type_presets: [], shared_layers: [], project_maps: [],
    };

    for (const e of entries) {
      const payload = await this.buildPayload(e);
      if (payload) body[e.kind].push(payload);
    }

    await this.client.postSync(body);

    // Only clear entries we actually sent (new marks during the await stay).
    for (const e of entries) this.dirty.delete(`${e.kind}:${e.id}`);
    saveDirty(this.dirty);
  }

  /** Read the current local entity and shape it for /sync (or a tombstone). */
  private async buildPayload(e: DirtyEntry): Promise<Record<string, unknown> | null> {
    if (e.op === 'delete') {
      return { id: e.id, deleted: true, updated_at: e.updated_at };
    }
    switch (e.kind) {
      case 'features': {
        const f = await this.storage.getFeature(e.id);
        if (!f) return { id: e.id, deleted: true, updated_at: e.updated_at };
        const photo_keys = this.client ? await deinlinePhotos(this.client, f.id, f.photos ?? []) : [];
        const { photos: _omit, ...rest } = f;
        void _omit;
        return { ...rest, photo_keys, updated_at: f.updated_at ?? e.updated_at };
      }
      case 'projects': {
        const p = await this.storage.getProject(e.id);
        if (!p) return { id: e.id, deleted: true, updated_at: e.updated_at };
        return { ...p, updated_at: p.updated_at ?? e.updated_at };
      }
      case 'layer_presets': {
        const l = await this.storage.getLayerPreset(e.id);
        if (!l) return { id: e.id, deleted: true, updated_at: e.updated_at };
        return { ...l, updated_at: e.updated_at };
      }
      case 'type_presets': {
        const t = await this.storage.getTypePreset(e.id);
        if (!t) return { id: e.id, deleted: true, updated_at: e.updated_at };
        return { ...t, updated_at: e.updated_at };
      }
      case 'shared_layers': {
        const s = await this.storage.getSharedLayer(e.id);
        if (!s) return { id: e.id, deleted: true, updated_at: e.updated_at };
        return { ...s, updated_at: s.updated_at ?? e.updated_at };
      }
      case 'project_maps': {
        const m = await this.storage.getMap(e.id);
        if (!m) return { id: e.id, deleted: true, updated_at: e.updated_at };
        return { ...m, updated_at: m.updated_at ?? e.updated_at };
      }
    }
  }

  // ---- pull -------------------------------------------------------------

  private async pull(): Promise<void> {
    if (!this.client) return;
    let applied = 0;

    // Paginate until a non-full page is returned.
    for (;;) {
      const res = await this.client.getChanges(this.cursor, PAGE_LIMIT);
      this.storage.beginRemote();
      try {
        for (const kind of SYNC_KINDS) {
          for (const entity of (res[kind] ?? []) as unknown as Array<Record<string, unknown> & RemoteMeta>) {
            if (await this.applyRemote(kind, entity)) applied++;
          }
        }
      } finally {
        this.storage.endRemote();
      }
      this.cursor = res.cursor;
      localStorage.setItem(LS_CURSOR, String(this.cursor));
      // Older backends omit `more`; fall back to the page-fill heuristic.
      const more = res.more ?? res.count >= PAGE_LIMIT;
      if (!more) break;
    }

    if (applied > 0) EventBus.emit('cloud-data-changed', { count: applied });
  }

  /** Apply one remote entity locally with last-write-wins. Returns true if applied. */
  private async applyRemote(
    kind: SyncKind,
    entity: Record<string, unknown> & RemoteMeta
  ): Promise<boolean> {
    const id = entity.id as string;
    if (!id) return false;
    const remoteAt = entity.updated_at;

    const local = await this.readLocal(kind, id);
    const localAt = (local as { updated_at?: string } | undefined)?.updated_at;

    if (entity.deleted) {
      if (!local) return false;
      await this.deleteLocal(kind, id);
      return true;
    }

    // Skip if our local copy is the same or newer (also drops sync echoes).
    if (local && localAt && remoteAt && remoteAt <= localAt) return false;

    if (kind === 'features') {
      const keys = (entity.photo_keys as string[]) ?? [];
      const photos = this.client && keys.length ? await inlinePhotos(this.client, keys) : [];
      const { photo_keys: _k, deleted: _d, rev: _r, ...rest } = entity;
      void _k; void _d; void _r;
      await this.storage.saveFeature({ ...(rest as unknown as FieldFeature), photos });
      return true;
    }

    const { deleted: _d, rev: _r, ...clean } = entity;
    void _d; void _r;
    switch (kind) {
      case 'projects': await this.storage.saveProject(clean as never); break;
      case 'layer_presets': await this.storage.saveLayerPreset(clean as never); break;
      case 'type_presets': await this.storage.saveTypePreset(clean as never); break;
      case 'shared_layers': await this.storage.saveSharedLayer(clean as never); break;
      case 'project_maps': await this.storage.saveMap(clean as never); break;
    }
    return true;
  }

  private readLocal(kind: SyncKind, id: string): Promise<unknown> {
    switch (kind) {
      case 'features': return this.storage.getFeature(id);
      case 'projects': return this.storage.getProject(id);
      case 'layer_presets': return this.storage.getLayerPreset(id);
      case 'type_presets': return this.storage.getTypePreset(id);
      case 'shared_layers': return this.storage.getSharedLayer(id);
      case 'project_maps': return this.storage.getMap(id);
    }
  }

  private async deleteLocal(kind: SyncKind, id: string): Promise<void> {
    switch (kind) {
      case 'features': await this.storage.deleteFeature(id); break;
      case 'projects': await this.storage.deleteProject(id); break;
      case 'layer_presets': await this.storage.deleteLayerPreset(id); break;
      case 'type_presets': await this.storage.deleteTypePreset(id); break;
      case 'shared_layers': await this.storage.deleteSharedLayer(id); break;
      case 'project_maps': await this.storage.deleteMap(id); break;
    }
  }

  // ---- status -----------------------------------------------------------

  getStatus(): SyncStatus {
    return {
      enabled: this.enabled,
      online: navigator.onLine,
      syncing: this.syncing,
      pending: this.dirty.size,
      lastSync: this.lastSync,
      lastError: this.lastError,
    };
  }

  private emitStatus(): void {
    EventBus.emit('sync-status', this.getStatus());
  }
}

function loadDirty(): Map<string, DirtyEntry> {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_DIRTY) ?? '[]') as DirtyEntry[];
    return new Map(arr.map((e) => [`${e.kind}:${e.id}`, e]));
  } catch {
    return new Map();
  }
}

function saveDirty(m: Map<string, DirtyEntry>): void {
  try {
    localStorage.setItem(LS_DIRTY, JSON.stringify([...m.values()]));
  } catch {
    /* quota — non-fatal */
  }
}
