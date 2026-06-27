-- Migration 0005: graphical annotations scoped to a single map.
--
-- Annotations are cartographic decoration (text labels, arrows/leaders, callouts,
-- graphic shapes) owned by a ProjectMap rather than by the project's feature data.
-- They sync the same way as `project_maps` (full doc, last-write-wins). The
-- project_id and map_id columns are promoted out of the JSON doc for per-project
-- and per-map queries; the matching client store is keyed by map_id.

CREATE TABLE IF NOT EXISTS annotations (
  id         TEXT PRIMARY KEY,        -- Annotation.id (uuid)
  project_id TEXT,                    -- promoted for per-project cleanup
  map_id     TEXT NOT NULL,           -- promoted for per-map queries (scoping key)
  doc        TEXT NOT NULL,           -- full Annotation JSON
  updated_at TEXT NOT NULL,           -- ISO 8601; last-write-wins key
  updated_by TEXT,                    -- Cloudflare Access identity (email)
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_rev     ON annotations (rev);
CREATE INDEX IF NOT EXISTS idx_annotations_project ON annotations (project_id);
CREATE INDEX IF NOT EXISTS idx_annotations_map     ON annotations (map_id);
