-- Org-shared data library layers (Phase 3).
-- One row per uploaded vector/raster dataset shared across the team. The file
-- bytes live in R2 (key in the doc); this table is the synced metadata/index,
-- riding the same rev cursor + last-write-wins machinery as the other entities.

CREATE TABLE IF NOT EXISTS shared_layers (
  id         TEXT PRIMARY KEY,        -- uuid
  kind       TEXT,                    -- 'vector' | 'raster' (promoted for filtering)
  doc        TEXT NOT NULL,           -- full SharedLayer JSON: name, format, r2_key, bounds, style, size
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_layers_rev ON shared_layers (rev);
