-- Production D1 schema for the Fraxinus Field Mapper cloud backend.
--
-- One row per synced entity (projects, features, layer/type presets). The full
-- domain object is stored as JSON in `doc` (the source of truth, so no field is
-- lost); a few columns are promoted out of it for server-side querying and sync.
--
--   rev        — globally monotonic sequence (see sync_seq); drives the
--                GET /changes?since= cursor. Robust across devices because it is
--                assigned by the server, not by unreliable client clocks.
--   updated_at — client ISO-8601 timestamp; drives last-write-wins on conflict.
--   deleted    — soft delete so removals propagate through /changes.
--   updated_by — Cloudflare Access identity (email) that last wrote the row.

-- Global monotonic sequence. The /sync handler reserves a block of rev numbers
-- with a single `UPDATE sync_seq SET value = value + N RETURNING value`. SQLite
-- serializes writes, so every sync gets a unique, increasing block even under
-- concurrent requests. Gaps (from last-write-wins skips) are harmless.
CREATE TABLE IF NOT EXISTS sync_seq (
  id    INTEGER PRIMARY KEY CHECK (id = 0),
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO sync_seq (id, value) VALUES (0, 0);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,        -- Project.id
  doc        TEXT NOT NULL,           -- full Project JSON
  updated_at TEXT NOT NULL,           -- ISO 8601; last-write-wins key
  updated_by TEXT,                    -- Access identity (email)
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_rev ON projects (rev);

CREATE TABLE IF NOT EXISTS features (
  id         TEXT PRIMARY KEY,        -- FieldFeature.id (uuid)
  project_id TEXT,                    -- promoted for per-project queries
  layer_id   TEXT,                    -- promoted for per-layer queries
  geometry   TEXT,                    -- GeoJSON geometry JSON (promoted)
  lat        REAL,                    -- centroid (promoted; null for non-points)
  lon        REAL,
  doc        TEXT NOT NULL,           -- full FieldFeature JSON; photos de-inlined to R2 keys
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_features_rev ON features (rev);
CREATE INDEX IF NOT EXISTS idx_features_project ON features (project_id);
CREATE INDEX IF NOT EXISTS idx_features_layer ON features (layer_id);

CREATE TABLE IF NOT EXISTS layer_presets (
  id         TEXT PRIMARY KEY,        -- LayerPreset.id (embeds its TypePreset[])
  project_id TEXT,
  doc        TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layer_presets_rev ON layer_presets (rev);
CREATE INDEX IF NOT EXISTS idx_layer_presets_project ON layer_presets (project_id);

CREATE TABLE IF NOT EXISTS type_presets (
  id         TEXT PRIMARY KEY,        -- standalone TypePreset (StorageManager STORE_PRESETS)
  doc        TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_type_presets_rev ON type_presets (rev);
