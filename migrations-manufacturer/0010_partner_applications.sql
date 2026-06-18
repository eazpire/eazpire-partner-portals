PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS partner_applications (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT NOT NULL,
  website TEXT,
  product_types TEXT,
  capabilities TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending_email_verification',
  rejection_reason TEXT,
  manufacturer_id TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_partner_applications_status
  ON partner_applications (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_applications_email
  ON partner_applications (email);

CREATE TABLE IF NOT EXISTS partner_application_tokens (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'email_verify',
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (application_id) REFERENCES partner_applications(id)
);

CREATE INDEX IF NOT EXISTS idx_partner_application_tokens_hash
  ON partner_application_tokens (token_hash);
