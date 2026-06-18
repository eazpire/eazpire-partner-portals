PRAGMA foreign_keys = ON;

ALTER TABLE manufacturers ADD COLUMN suspend_reason TEXT;
ALTER TABLE manufacturers ADD COLUMN suspended_at INTEGER;
ALTER TABLE manufacturers ADD COLUMN suspended_by TEXT;

CREATE INDEX IF NOT EXISTS idx_manufacturers_suspended_at
  ON manufacturers (suspended_at DESC);
