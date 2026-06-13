/**
 * Shared types for the Fraxinus Field Mapper backend Worker.
 */

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  ASSETS: Fetcher; // Workers Static Assets — serves the built PWA (../dist)

  // Cloudflare Access (blank in both → dev mode, see auth.ts).
  TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  // CORS
  ALLOWED_ORIGIN?: string;

  // R2 S3 presigned-URL config.
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

/** The verified caller identity (from a Cloudflare Access JWT). */
export interface Identity {
  email: string;
  sub: string;
}

/**
 * One synced entity as it travels over the wire. The full domain object lives
 * under arbitrary extra keys; these are the fields the server reads.
 */
export interface SyncEntity {
  id: string;
  updated_at?: string;   // ISO 8601; defaults to server now() if absent
  deleted?: boolean;
  [key: string]: unknown;
}

/** The entity collections a /sync request and /changes response carry. */
export type EntityKind = 'projects' | 'features' | 'layer_presets' | 'type_presets' | 'shared_layers';

export const ENTITY_KINDS: EntityKind[] = ['projects', 'features', 'layer_presets', 'type_presets', 'shared_layers'];

/**
 * Per-entity table config: the SQL table and the columns promoted out of the
 * JSON doc. `promote` derives the promoted column values from the entity.
 */
export interface TableConfig {
  table: string;
  /** Promoted columns beyond the always-present id/doc/updated_at/updated_by/deleted/rev. */
  extraColumns: string[];
  promote: (e: SyncEntity) => Record<string, unknown>;
}

export const TABLES: Record<EntityKind, TableConfig> = {
  projects: {
    table: 'projects',
    extraColumns: [],
    promote: () => ({}),
  },
  features: {
    table: 'features',
    extraColumns: ['project_id', 'layer_id', 'geometry', 'lat', 'lon'],
    promote: (e) => ({
      project_id: (e.project_id as string) ?? null,
      layer_id: (e.layer_id as string) ?? null,
      geometry: e.geometry != null ? JSON.stringify(e.geometry) : null,
      lat: typeof e.lat === 'number' ? e.lat : null,
      lon: typeof e.lon === 'number' ? e.lon : null,
    }),
  },
  layer_presets: {
    table: 'layer_presets',
    extraColumns: ['project_id'],
    promote: (e) => ({ project_id: (e.project_id as string) ?? null }),
  },
  type_presets: {
    table: 'type_presets',
    extraColumns: [],
    promote: () => ({}),
  },
  // Org-shared data library layers (vector/raster); the file bytes live in R2,
  // this row is just the metadata/index (name, format, r2_key, bounds, style).
  shared_layers: {
    table: 'shared_layers',
    extraColumns: ['kind'],
    promote: (e) => ({ kind: (e.kind as string) ?? null }),
  },
};
