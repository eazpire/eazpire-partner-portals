PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  slug TEXT UNIQUE,
  country TEXT,
  website TEXT,
  support_email TEXT,
  business_email TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  integration_type TEXT NOT NULL DEFAULT 'portal',
  quality_score INTEGER DEFAULT 0,
  delivery_score INTEGER DEFAULT 0,
  support_score INTEGER DEFAULT 0,
  artifact_ready_score INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS manufacturer_users (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturer_users_email
  ON manufacturer_users (email);

CREATE INDEX IF NOT EXISTS idx_manufacturer_users_mfg
  ON manufacturer_users (manufacturer_id);

CREATE TABLE IF NOT EXISTS manufacturer_locations (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  label TEXT,
  country TEXT NOT NULL,
  region TEXT,
  city TEXT,
  postal_code TEXT,
  ships_to_json TEXT NOT NULL DEFAULT '[]',
  production_days_min INTEGER DEFAULT 2,
  production_days_max INTEGER DEFAULT 7,
  return_address_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_locations_mfg
  ON manufacturer_locations (manufacturer_id);

CREATE TABLE IF NOT EXISTS manufacturer_auth_tokens (
  id TEXT PRIMARY KEY,
  manufacturer_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_user_id) REFERENCES manufacturer_users(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_auth_tokens_hash
  ON manufacturer_auth_tokens (token_hash);
