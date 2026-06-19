PRAGMA foreign_keys = ON;

-- Sub-Provider under a partner (Printify print providers, etc.)
CREATE TABLE IF NOT EXISTS manufacturer_fulfillment_providers (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  external_provider_id TEXT NOT NULL,
  integration_system TEXT NOT NULL DEFAULT 'printify',
  name TEXT NOT NULL,
  location_json TEXT NOT NULL DEFAULT '{}',
  ships_to_json TEXT NOT NULL DEFAULT '[]',
  production_days_min INTEGER,
  production_days_max INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfg_fp_unique
  ON manufacturer_fulfillment_providers (manufacturer_id, integration_system, external_provider_id);

CREATE INDEX IF NOT EXISTS idx_mfg_fp_manufacturer
  ON manufacturer_fulfillment_providers (manufacturer_id);

-- Curated Eazpire shop products (catalog master)
CREATE TABLE IF NOT EXISTS eazpire_products (
  product_key TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  source_blueprint_id TEXT,
  title TEXT NOT NULL,
  regions_json TEXT NOT NULL DEFAULT '[]',
  catalog_status TEXT NOT NULL DEFAULT 'offline',
  visible_design_types_json TEXT,
  catalog_category_group TEXT,
  catalog_category_leaf TEXT,
  catalog_audience_json TEXT,
  catalog_production_type TEXT,
  print_area_edit_use_mocks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id),
  FOREIGN KEY (source_blueprint_id) REFERENCES manufacturer_eazpire_blueprints(id)
);

CREATE INDEX IF NOT EXISTS idx_eazpire_products_mfg
  ON eazpire_products (manufacturer_id);

CREATE INDEX IF NOT EXISTS idx_eazpire_products_status
  ON eazpire_products (catalog_status);

-- Product versions (PAT equivalent), one sub-provider per version
CREATE TABLE IF NOT EXISTS eazpire_product_versions (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  fulfillment_provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  studio_config_json TEXT NOT NULL DEFAULT '{}',
  auto_publish_config_json TEXT NOT NULL DEFAULT '{}',
  external_template_product_id TEXT NOT NULL DEFAULT '',
  product_version_config_json TEXT,
  qr_logo_snapshot_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  publish_enabled INTEGER NOT NULL DEFAULT 1,
  catalog_pat_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key),
  FOREIGN KEY (fulfillment_provider_id) REFERENCES manufacturer_fulfillment_providers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpire_pv_unique
  ON eazpire_product_versions (product_key, fulfillment_provider_id, external_template_product_id);

CREATE INDEX IF NOT EXISTS idx_eazpire_pv_product
  ON eazpire_product_versions (product_key);

-- Printify system partner seed (idempotent)
INSERT OR IGNORE INTO manufacturers
  (id, name, legal_name, slug, country, website, support_email, business_email, status, integration_type,
   quality_score, delivery_score, support_score, artifact_ready_score, created_at, updated_at)
VALUES
  ('mfg_printify', 'Printify', 'Printify Inc.', 'printify', 'US', 'https://printify.com', NULL, NULL,
   'verified', 'api', 0, 0, 0, 0,
   CAST(strftime('%s', 'now') AS INTEGER) * 1000,
   CAST(strftime('%s', 'now') AS INTEGER) * 1000);
