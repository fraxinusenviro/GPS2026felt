-- Migration 0003: named map views within a project.
--
-- Each Project can now contain multiple ProjectMaps. A map stores the basemap
-- stack, viewport, and per-user view overrides independently of the project's
-- feature/layer data. Syncs the same way as `projects` (full doc, LWW).

CREATE TABLE IF NOT EXISTS project_maps (
  id         TEXT PRIMARY KEY,        -- ProjectMap.id (uuid)
  project_id TEXT NOT NULL,           -- promoted for per-project queries
  doc        TEXT NOT NULL,           -- full ProjectMap JSON
  updated_at TEXT NOT NULL,           -- ISO 8601; last-write-wins key
  updated_by TEXT,                    -- Cloudflare Access identity (email)
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_maps_rev     ON project_maps (rev);
CREATE INDEX IF NOT EXISTS idx_project_maps_project ON project_maps (project_id);
