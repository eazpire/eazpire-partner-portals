-- manufacturer-db: shop preview template id + mockup_set on shadow mockup images
-- Run: wrangler d1 execute manufacturer-db --remote --file=migrations-manufacturer/0018_eazpire_mockup_set.sql

ALTER TABLE eazpire_template_products ADD COLUMN printify_shop_preview_mockups_product_id TEXT;
ALTER TABLE eazpire_product_mockup_images ADD COLUMN mockup_set TEXT NOT NULL DEFAULT 'clean';

CREATE INDEX IF NOT EXISTS idx_eazpmi_product_set
  ON eazpire_product_mockup_images (product_key, print_provider_id, mockup_set);
