PRAGMA foreign_keys = ON;

-- Partner product → manufacturer location ("Provider" in product editor Details)
ALTER TABLE manufacturer_products ADD COLUMN provider_location_id TEXT;

CREATE INDEX IF NOT EXISTS idx_manufacturer_products_provider_location
  ON manufacturer_products (provider_location_id);
