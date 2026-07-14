PRAGMA foreign_keys = ON;

-- Partner Product Editor (manual catalog entry) — views, mockup slots, meta

ALTER TABLE manufacturer_products ADD COLUMN sku_base TEXT;
ALTER TABLE manufacturer_products ADD COLUMN design_types_json TEXT DEFAULT '[]';
ALTER TABLE manufacturer_products ADD COLUMN print_technique TEXT;
ALTER TABLE manufacturer_products ADD COLUMN regions_json TEXT DEFAULT '[]';
ALTER TABLE manufacturer_products ADD COLUMN meta_json TEXT DEFAULT '{}';
ALTER TABLE manufacturer_products ADD COLUMN eazpire_product_key TEXT;
ALTER TABLE manufacturer_products ADD COLUMN review_note TEXT;

CREATE TABLE IF NOT EXISTS manufacturer_product_views (
  id TEXT PRIMARY KEY,
  manufacturer_product_id TEXT NOT NULL,
  view_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  printable INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_product_id) REFERENCES manufacturer_products(id),
  UNIQUE (manufacturer_product_id, view_key)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_product_views_product
  ON manufacturer_product_views (manufacturer_product_id);

-- Extend mockup templates for set + color slot (View × Color)
ALTER TABLE manufacturer_mockup_templates ADD COLUMN mockup_set TEXT DEFAULT 'clean';
ALTER TABLE manufacturer_mockup_templates ADD COLUMN color_key TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_manufacturer_mockups_slot
  ON manufacturer_mockup_templates (manufacturer_product_id, mockup_set, view_key, color_key);

-- Print area: bind optional view + rect for partner editor
ALTER TABLE manufacturer_print_areas ADD COLUMN view_key TEXT;
ALTER TABLE manufacturer_print_areas ADD COLUMN print_rect_json TEXT DEFAULT '{}';
ALTER TABLE manufacturer_print_areas ADD COLUMN placeholders_json TEXT DEFAULT '{}';
ALTER TABLE manufacturer_print_areas ADD COLUMN image_r2_key TEXT;
ALTER TABLE manufacturer_print_areas ADD COLUMN image_url TEXT;
