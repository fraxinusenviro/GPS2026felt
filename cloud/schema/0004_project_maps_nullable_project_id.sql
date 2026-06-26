-- Migration 0004: allow NULL project_id on project_maps.
--
-- Deletes sync as tombstones { id, deleted, updated_at } with no project_id
-- (see SyncManager.buildPayload and the README "Deletes" note). Migration 0003
-- declared project_id NOT NULL, so every ProjectMap delete pushed a NULL into
-- that column and hit `NOT NULL constraint failed: project_maps.project_id`.
-- Because a /sync request applies all its statements in one D1 batch (a single
-- transaction), that one failure 500s the entire push and the change stays
-- pending forever, retrying — and failing — on every sync.
--
-- `features` and `layer_presets` already promote project_id as a NULLABLE
-- column for exactly this reason (0001_init.sql); this brings project_maps in
-- line. SQLite can't drop a column constraint in place, so rebuild the table.

CREATE TABLE project_maps_new (
  id         TEXT PRIMARY KEY,        -- ProjectMap.id (uuid)
  project_id TEXT,                    -- nullable: delete tombstones carry no project_id
  doc        TEXT NOT NULL,           -- full ProjectMap JSON
  updated_at TEXT NOT NULL,           -- ISO 8601; last-write-wins key
  updated_by TEXT,                    -- Cloudflare Access identity (email)
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);

INSERT INTO project_maps_new (id, project_id, doc, updated_at, updated_by, deleted, rev)
  SELECT id, project_id, doc, updated_at, updated_by, deleted, rev FROM project_maps;

DROP TABLE project_maps;
ALTER TABLE project_maps_new RENAME TO project_maps;

CREATE INDEX IF NOT EXISTS idx_project_maps_rev     ON project_maps (rev);
CREATE INDEX IF NOT EXISTS idx_project_maps_project ON project_maps (project_id);
