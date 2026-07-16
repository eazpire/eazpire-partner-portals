-- Partner outbound webhooks (signing secret encrypted at rest; plaintext shown once on create)

CREATE TABLE IF NOT EXISTS manufacturer_webhooks (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  events TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_delivery_at INTEGER,
  last_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_webhooks_mfg ON manufacturer_webhooks(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_webhooks_status ON manufacturer_webhooks(manufacturer_id, status);

CREATE TABLE IF NOT EXISTS manufacturer_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload_hash TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  response_code INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (webhook_id) REFERENCES manufacturer_webhooks(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_webhook_deliveries_webhook
  ON manufacturer_webhook_deliveries(webhook_id, created_at);
