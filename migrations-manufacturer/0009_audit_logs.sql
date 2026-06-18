PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturer_audit_logs (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_audit_mfg
  ON manufacturer_audit_logs (manufacturer_id);

CREATE INDEX IF NOT EXISTS idx_manufacturer_audit_created
  ON manufacturer_audit_logs (created_at);
