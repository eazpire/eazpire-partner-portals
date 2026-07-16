-- Partner / Manufacturer API keys (machine access — hashed at rest; plaintext shown once on create)

CREATE TABLE IF NOT EXISTS manufacturer_api_keys (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturer_api_keys_hash ON manufacturer_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_manufacturer_api_keys_mfg ON manufacturer_api_keys(manufacturer_id);
