PRAGMA foreign_keys = ON;

-- Raw provider blueprint uploads (JSON, CSV, wizard)
CREATE TABLE IF NOT EXISTS manufacturer_provider_blueprints (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual_wizard',
  external_blueprint_id TEXT,
  external_product_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  raw_json TEXT NOT NULL DEFAULT '{}',
  raw_hash TEXT,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_mfg_provider_blueprints_mfg
  ON manufacturer_provider_blueprints (manufacturer_id);

CREATE INDEX IF NOT EXISTS idx_mfg_provider_blueprints_status
  ON manufacturer_provider_blueprints (status);

-- Conversion runs (provider → Eazpire normalized)
CREATE TABLE IF NOT EXISTS manufacturer_blueprint_conversion_runs (
  id TEXT PRIMARY KEY,
  provider_blueprint_id TEXT NOT NULL,
  converter_key TEXT NOT NULL DEFAULT 'portal_manual',
  input_hash TEXT,
  output_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (provider_blueprint_id) REFERENCES manufacturer_provider_blueprints(id)
);

CREATE INDEX IF NOT EXISTS idx_mfg_blueprint_conversion_provider
  ON manufacturer_blueprint_conversion_runs (provider_blueprint_id);

-- Normalized Eazpire Universal Blueprints
CREATE TABLE IF NOT EXISTS manufacturer_eazpire_blueprints (
  id TEXT PRIMARY KEY,
  provider_blueprint_id TEXT NOT NULL,
  manufacturer_id TEXT NOT NULL,
  blueprint_key TEXT NOT NULL,
  blueprint_version TEXT NOT NULL DEFAULT '1.0.0',
  title TEXT NOT NULL,
  normalized_category TEXT,
  product_type TEXT,
  artifact_slot_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  normalized_json TEXT NOT NULL DEFAULT '{}',
  quality_score INTEGER DEFAULT 0,
  studio_score INTEGER DEFAULT 0,
  auto_publish_score INTEGER DEFAULT 0,
  artifact_score INTEGER DEFAULT 0,
  admin_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (provider_blueprint_id) REFERENCES manufacturer_provider_blueprints(id),
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfg_eazpire_blueprints_key_mfg
  ON manufacturer_eazpire_blueprints (manufacturer_id, blueprint_key, blueprint_version);

CREATE INDEX IF NOT EXISTS idx_mfg_eazpire_blueprints_status
  ON manufacturer_eazpire_blueprints (status);

CREATE INDEX IF NOT EXISTS idx_mfg_eazpire_blueprints_mfg
  ON manufacturer_eazpire_blueprints (manufacturer_id);
