-- manufacturer-db: separate Printify product IDs per Templates sync section
-- Run: wrangler d1 execute manufacturer-db --remote --file=migrations-manufacturer/0017_eazpire_template_section_ids.sql

ALTER TABLE eazpire_template_products ADD COLUMN printify_mockups_product_id TEXT;
ALTER TABLE eazpire_template_products ADD COLUMN printify_variants_product_id TEXT;
ALTER TABLE eazpire_template_products ADD COLUMN printify_print_areas_product_id TEXT;
