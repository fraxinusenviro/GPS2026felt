-- Phase 0 spike D1 schema.
-- Mirrors the shape of the app's FieldFeature (src/types.ts) but stores the
-- queryable bits as a row, with photos de-inlined into R2 (photo_keys holds
-- R2 object keys instead of base64 blobs).

CREATE TABLE IF NOT EXISTS features (
  id          TEXT PRIMARY KEY,         -- FieldFeature.id (uuid)
  project_id  TEXT,                     -- FieldFeature.project_id
  geometry    TEXT NOT NULL,            -- GeoJSON geometry, JSON string
  properties  TEXT,                     -- attributes (type, notes, etc.), JSON string
  photo_keys  TEXT,                     -- JSON array of R2 object keys (was base64 inline)
  updated_at  INTEGER NOT NULL,         -- epoch ms; drives last-write-wins
  deleted     INTEGER NOT NULL DEFAULT 0 -- soft delete so deletions propagate via /changes
);

-- The changes feed (`GET /changes?since=`) scans by updated_at.
CREATE INDEX IF NOT EXISTS idx_features_updated_at ON features (updated_at);
CREATE INDEX IF NOT EXISTS idx_features_project ON features (project_id);
