PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturer_print_areas (
  id TEXT PRIMARY KEY,
  manufacturer_product_id TEXT NOT NULL,
  area_key TEXT NOT NULL,
  label TEXT,
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  dpi INTEGER DEFAULT 300,
  safe_zone_json TEXT NOT NULL DEFAULT '{}',
  position_json TEXT NOT NULL DEFAULT '{}',
  supported_file_types_json TEXT NOT NULL DEFAULT '["png"]',
  supports_transparency INTEGER NOT NULL DEFAULT 1,
  default_fit TEXT NOT NULL DEFAULT 'contain',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_product_id) REFERENCES manufacturer_products(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_print_areas_product
  ON manufacturer_print_areas (manufacturer_product_id);

CREATE TABLE IF NOT EXISTS manufacturer_mockup_templates (
  id TEXT PRIMARY KEY,
  manufacturer_product_id TEXT NOT NULL,
  variant_id TEXT,
  view_key TEXT NOT NULL,
  image_r2_key TEXT,
  image_url TEXT,
  overlay_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_product_id) REFERENCES manufacturer_products(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_mockups_product
  ON manufacturer_mockup_templates (manufacturer_product_id);
