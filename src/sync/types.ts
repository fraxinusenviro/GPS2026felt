/**
 * Cloud sync types (Phase 2/3 PWA ↔ Cloudflare backend).
 */

import type { FieldFeature, Project, LayerPreset, TypePreset } from '../types';

/** Entity kinds the backend syncs. Matches cloud/src/types.ts ENTITY_KINDS. */
export type SyncKind = 'projects' | 'features' | 'layer_presets' | 'type_presets';
export const SYNC_KINDS: SyncKind[] = ['projects', 'features', 'layer_presets', 'type_presets'];

export type SyncOp = 'upsert' | 'delete';

/** A pending local change, keyed by `${kind}:${id}` in the dirty set. */
export interface DirtyEntry {
  kind: SyncKind;
  id: string;
  op: SyncOp;
  updated_at: string; // ISO 8601
}

/** Response shape of GET /changes. */
export interface ChangesResponse {
  since: number;
  cursor: number;
  count: number;
  projects: Array<Project & RemoteMeta>;
  features: Array<FieldFeature & RemoteMeta & { photo_keys?: string[] }>;
  layer_presets: Array<LayerPreset & RemoteMeta>;
  type_presets: Array<TypePreset & RemoteMeta>;
}

/** Metadata the backend attaches to every row it returns. */
export interface RemoteMeta {
  updated_at: string;
  deleted: boolean;
  rev: number;
}

/** Result of POST /sync. */
export interface SyncPushResult {
  applied: Record<SyncKind, number>;
  skipped: number;
  received: number;
  rev: number;
}

/** Live status surfaced to the UI via the `sync-status` EventBus event. */
export interface SyncStatus {
  enabled: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSync: number | null;
  lastError: string | null;
}
