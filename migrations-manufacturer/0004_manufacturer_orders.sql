PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturer_orders (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  manufacturer_id TEXT NOT NULL,
  manufacturer_order_ref TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  cost_total_cents INTEGER DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  tracking_number TEXT,
  tracking_url TEXT,
  estimated_ship_at INTEGER,
  shipped_at INTEGER,
  delivered_at INTEGER,
  is_test_order INTEGER NOT NULL DEFAULT 0,
  shipping_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_mfg
  ON manufacturer_orders (manufacturer_id);

CREATE INDEX IF NOT EXISTS idx_manufacturer_orders_status
  ON manufacturer_orders (status);

CREATE TABLE IF NOT EXISTS manufacturer_order_items (
  id TEXT PRIMARY KEY,
  manufacturer_order_id TEXT NOT NULL,
  manufacturer_product_id TEXT NOT NULL,
  manufacturer_variant_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  print_files_json TEXT NOT NULL DEFAULT '[]',
  placement_json TEXT NOT NULL DEFAULT '{}',
  artifact_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (manufacturer_order_id) REFERENCES manufacturer_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_order_items_order
  ON manufacturer_order_items (manufacturer_order_id);
