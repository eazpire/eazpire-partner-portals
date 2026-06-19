PRAGMA foreign_keys = ON;

-- Shadow tables: MANUFACTURER_DB master copies of catalog-db publish index data
-- catalog_source_id tracks the row id in catalog-db for mirror upserts

CREATE TABLE IF NOT EXISTS eazpire_product_active_providers (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  print_provider_id INTEGER NOT NULL,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpap_unique
  ON eazpire_product_active_providers (product_key, print_provider_id);

CREATE TABLE IF NOT EXISTS eazpire_product_publish_profiles (
  id TEXT PRIMARY KEY,
  product_key TEXT,
  title TEXT,
  source_system TEXT NOT NULL DEFAULT 'printify',
  source_product_id TEXT NOT NULL DEFAULT '',
  blueprint_id INTEGER,
  print_provider_id INTEGER,
  product_features TEXT,
  care_instructions TEXT,
  size_table_html TEXT,
  gpsr_html TEXT,
  variants_json TEXT,
  prices_json TEXT,
  white_branding_variant_ids TEXT,
  print_area_width INTEGER,
  print_area_height INTEGER,
  qr_logo_mapping_json TEXT,
  product_data_json TEXT,
  shopify_category_id TEXT,
  standard_product_display_name TEXT,
  print_areas_config_json TEXT,
  catalog_source_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  collected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE INDEX IF NOT EXISTS idx_eazppp_product
  ON eazpire_product_publish_profiles (product_key, print_provider_id);

CREATE TABLE IF NOT EXISTS eazpire_product_publish_plans (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  region_codes_json TEXT NOT NULL DEFAULT '[]',
  provider_name TEXT NOT NULL DEFAULT '',
  provider_location TEXT,
  country_codes_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER DEFAULT 100,
  is_enabled INTEGER DEFAULT 1,
  publish_profile_id TEXT,
  publish_profile_catalog_id INTEGER,
  publication_ids_json TEXT,
  country_of_origin TEXT,
  amazon_channel_enabled INTEGER NOT NULL DEFAULT 0,
  amazon_markets_enabled_json TEXT,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE INDEX IF NOT EXISTS idx_eazppp_plans_product
  ON eazpire_product_publish_plans (product_key);

CREATE TABLE IF NOT EXISTS eazpire_product_mockup_defaults (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  print_area_key TEXT NOT NULL DEFAULT 'front',
  template_r2_key TEXT,
  mask_r2_key TEXT,
  template_color TEXT NOT NULL DEFAULT 'white',
  placement_x REAL NOT NULL DEFAULT 0.5,
  placement_y REAL NOT NULL DEFAULT 0.5,
  placement_scale REAL NOT NULL DEFAULT 1.0,
  placement_angle REAL NOT NULL DEFAULT 0.0,
  printify_print_area_width INTEGER,
  printify_print_area_height INTEGER,
  template_width INTEGER,
  template_height INTEGER,
  available_colors_json TEXT,
  print_area_rect_json TEXT,
  mockup_print_area_rect_json TEXT,
  universal_print_area_rect_json TEXT,
  enabled_colors_json TEXT,
  enabled_sizes_json TEXT,
  visible_design_types_json TEXT,
  is_active INTEGER DEFAULT 1,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpmd_unique
  ON eazpire_product_mockup_defaults (product_key, print_area_key);

CREATE TABLE IF NOT EXISTS eazpire_product_mockup_images (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  print_provider_id INTEGER NOT NULL DEFAULT 0,
  printify_product_id TEXT NOT NULL DEFAULT '',
  view_key TEXT NOT NULL,
  color_name TEXT NOT NULL,
  color_hex TEXT,
  image_url TEXT NOT NULL,
  printify_variant_ids TEXT,
  is_default INTEGER DEFAULT 0,
  preview_template_ids_json TEXT,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE INDEX IF NOT EXISTS idx_eazpmi_product
  ON eazpire_product_mockup_images (product_key);

CREATE TABLE IF NOT EXISTS eazpire_product_mockup_view_random (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  view_key TEXT NOT NULL,
  template_ids_json TEXT,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpmvr_unique
  ON eazpire_product_mockup_view_random (product_key, view_key);

CREATE TABLE IF NOT EXISTS eazpire_product_variant_print_areas (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  print_area_key TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  variant_title TEXT,
  printify_print_area_width INTEGER,
  printify_print_area_height INTEGER,
  print_area_rect_json TEXT,
  mockup_print_area_rect_json TEXT,
  mockup_image_url TEXT,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpvpa_unique
  ON eazpire_product_variant_print_areas (product_key, print_area_key, variant_id);

CREATE TABLE IF NOT EXISTS eazpire_product_base_costs (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  region_code TEXT NOT NULL DEFAULT 'EU',
  base_cost_cents INTEGER NOT NULL DEFAULT 0,
  default_sell_price_cents INTEGER NOT NULL DEFAULT 0,
  min_profit_cents INTEGER NOT NULL DEFAULT 100,
  creator_share_percent REAL NOT NULL DEFAULT 40.0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  source TEXT DEFAULT 'printify',
  catalog_source_id INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpbc_unique
  ON eazpire_product_base_costs (product_key, region_code);

CREATE TABLE IF NOT EXISTS eazpire_product_variant_config (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  print_provider_id INTEGER NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpvc_unique
  ON eazpire_product_variant_config (product_key, print_provider_id);

CREATE TABLE IF NOT EXISTS eazpire_template_products (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  print_provider_id INTEGER NOT NULL,
  printify_product_id TEXT NOT NULL DEFAULT '',
  blueprint_id INTEGER,
  title TEXT,
  variants_json TEXT,
  prices_json TEXT,
  print_area_width INTEGER,
  print_area_height INTEGER,
  print_areas_json TEXT,
  selected_positions_json TEXT,
  product_data_json TEXT,
  mockup_images_count INTEGER DEFAULT 0,
  catalog_source_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eaztp_unique
  ON eazpire_template_products (product_key, print_provider_id);
