PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturer_products (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  external_product_id TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  category TEXT,
  normalized_category TEXT,
  product_type TEXT,
  base_cost_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'draft',
  artifact_supported INTEGER NOT NULL DEFAULT 0,
  artifact_slot_type TEXT,
  quality_score INTEGER DEFAULT 0,
  delivery_score INTEGER DEFAULT 0,
  margin_score INTEGER DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_products_mfg
  ON manufacturer_products (manufacturer_id);

CREATE INDEX IF NOT EXISTS idx_manufacturer_products_status
  ON manufacturer_products (status);

CREATE TABLE IF NOT EXISTS manufacturer_variants (
  id TEXT PRIMARY KEY,
  manufacturer_product_id TEXT NOT NULL,
  external_variant_id TEXT,
  sku TEXT,
  color TEXT,
  size TEXT,
  material TEXT,
  base_cost_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  weight_grams INTEGER,
  available INTEGER NOT NULL DEFAULT 1,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_product_id) REFERENCES manufacturer_products(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_variants_product
  ON manufacturer_variants (manufacturer_product_id);

CREATE TABLE IF NOT EXISTS manufacturer_shipping_rates (
  id TEXT PRIMARY KEY,
  manufacturer_id TEXT NOT NULL,
  manufacturer_product_id TEXT,
  country_code TEXT NOT NULL,
  base_shipping_cents INTEGER NOT NULL DEFAULT 0,
  additional_item_shipping_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  estimated_days_min INTEGER,
  estimated_days_max INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_shipping_mfg
  ON manufacturer_shipping_rates (manufacturer_id);
