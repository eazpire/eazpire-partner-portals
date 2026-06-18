PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS partner_email_blocks (
  email TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL,
  blocked_by TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_email_blocks_blocked_at
  ON partner_email_blocks (blocked_at DESC);
