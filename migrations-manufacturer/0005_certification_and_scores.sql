PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturer_certifications (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  certification_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  issued_at INTEGER,
  expires_at INTEGER,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  reviewed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturer_cert_unique
  ON manufacturer_certifications (manufacturer_id, certification_key);

CREATE TABLE IF NOT EXISTS eazpire_product_templates (
  id TEXT PRIMARY KEY,
  manufacturer_product_id TEXT NOT NULL,
  normalized_category TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slot_type TEXT,
  artifact_supported INTEGER NOT NULL DEFAULT 0,
  template_status TEXT NOT NULL DEFAULT 'draft',
  quality_score INTEGER DEFAULT 0,
  delivery_score INTEGER DEFAULT 0,
  margin_score INTEGER DEFAULT 0,
  region_score_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_product_id) REFERENCES manufacturer_products(id)
);

CREATE INDEX IF NOT EXISTS idx_eazpire_product_templates_product
  ON eazpire_product_templates (manufacturer_product_id);
