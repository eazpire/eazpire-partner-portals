/**
 * Ensure MANUFACTURER_DB schema — idempotent runtime guards for partner worker deploys
 * (D1 migrations may lag behind worker code; apply missing tables/columns here)
 */

import { getManufacturerDb } from "./db.js";

let schemaReady = false;

async function tableColumns(db, table) {
  try {
    const res = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (!res || !Array.isArray(res.results)) return null;
    return new Set(res.results.map((row) => row.name));
  } catch {
    return null;
  }
}

async function ensureColumn(db, table, column, definition) {
  const cols = await tableColumns(db, table);
  if (!cols) return;
  if (cols.has(column)) return;
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

async function applyPendingSchemaPatches(db) {
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS partner_email_blocks (
          email TEXT PRIMARY KEY,
          blocked_at INTEGER NOT NULL,
          blocked_by TEXT,
          reason TEXT
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] partner_email_blocks skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_partner_email_blocks_blocked_at
         ON partner_email_blocks (blocked_at DESC)`
      )
      .run();
  } catch {
    /* index optional */
  }

  await ensureColumn(db, "manufacturers", "suspend_reason", "TEXT");
  await ensureColumn(db, "manufacturers", "suspended_at", "INTEGER");
  await ensureColumn(db, "manufacturers", "suspended_by", "TEXT");

  try {
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_manufacturers_suspended_at
         ON manufacturers (suspended_at DESC)`
      )
      .run();
  } catch {
    /* index optional */
  }

  await applyPartnerCatalogSchemaPatches(db);
}

async function applyPartnerCatalogSchemaPatches(db) {
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS manufacturer_provider_blueprints (
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
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] manufacturer_provider_blueprints skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS manufacturer_blueprint_conversion_runs (
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
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] manufacturer_blueprint_conversion_runs skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS manufacturer_eazpire_blueprints (
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
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] manufacturer_eazpire_blueprints skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS manufacturer_fulfillment_providers (
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
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] manufacturer_fulfillment_providers skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS eazpire_products (
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
          FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] eazpire_products skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS eazpire_product_versions (
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
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] eazpire_product_versions skipped:", e?.message || e);
  }

  try {
    const now = Date.now();
    await db
      .prepare(
        `INSERT OR IGNORE INTO manufacturers
          (id, name, legal_name, slug, country, website, status, integration_type,
           quality_score, delivery_score, support_score, artifact_ready_score, created_at, updated_at)
         VALUES ('mfg_printify', 'Printify', 'Printify Inc.', 'printify', 'US', 'https://printify.com',
                 'verified', 'api', 0, 0, 0, 0, ?, ?)`
      )
      .bind(now, now)
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] printify partner seed skipped:", e?.message || e);
  }

  await applyEazpireShadowSchemaPatches(db);
}

async function runSchemaPatch(db, label, sql) {
  try {
    await db.prepare(sql).run();
  } catch (e) {
    const msg = String(e?.message || e);
    if (!msg.includes("already exists")) {
      console.warn(`[ensureManufacturerSchema] ${label} skipped:`, msg);
    }
  }
}

/** Inline 0015 shadow tables — no node:fs (Workers cannot read migration files at runtime). */
async function applyEazpireShadowSchemaPatches(db) {
  await runSchemaPatch(
    db,
    "eazpire_product_active_providers",
    `CREATE TABLE IF NOT EXISTS eazpire_product_active_providers (
      id TEXT PRIMARY KEY,
      product_key TEXT NOT NULL,
      print_provider_id INTEGER NOT NULL,
      catalog_source_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpap_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpap_unique
      ON eazpire_product_active_providers (product_key, print_provider_id)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_publish_profiles",
    `CREATE TABLE IF NOT EXISTS eazpire_product_publish_profiles (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazppp_product",
    `CREATE INDEX IF NOT EXISTS idx_eazppp_product
      ON eazpire_product_publish_profiles (product_key, print_provider_id)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_publish_plans",
    `CREATE TABLE IF NOT EXISTS eazpire_product_publish_plans (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazppp_plans_product",
    `CREATE INDEX IF NOT EXISTS idx_eazppp_plans_product
      ON eazpire_product_publish_plans (product_key)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_mockup_defaults",
    `CREATE TABLE IF NOT EXISTS eazpire_product_mockup_defaults (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpmd_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpmd_unique
      ON eazpire_product_mockup_defaults (product_key, print_area_key)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_mockup_images",
    `CREATE TABLE IF NOT EXISTS eazpire_product_mockup_images (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpmi_product",
    `CREATE INDEX IF NOT EXISTS idx_eazpmi_product
      ON eazpire_product_mockup_images (product_key)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_mockup_view_random",
    `CREATE TABLE IF NOT EXISTS eazpire_product_mockup_view_random (
      id TEXT PRIMARY KEY,
      product_key TEXT NOT NULL,
      view_key TEXT NOT NULL,
      template_ids_json TEXT,
      catalog_source_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpmvr_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpmvr_unique
      ON eazpire_product_mockup_view_random (product_key, view_key)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_variant_print_areas",
    `CREATE TABLE IF NOT EXISTS eazpire_product_variant_print_areas (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpvpa_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpvpa_unique
      ON eazpire_product_variant_print_areas (product_key, print_area_key, variant_id)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_base_costs",
    `CREATE TABLE IF NOT EXISTS eazpire_product_base_costs (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpbc_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpbc_unique
      ON eazpire_product_base_costs (product_key, region_code)`
  );

  await runSchemaPatch(
    db,
    "eazpire_product_variant_config",
    `CREATE TABLE IF NOT EXISTS eazpire_product_variant_config (
      id TEXT PRIMARY KEY,
      product_key TEXT NOT NULL,
      print_provider_id INTEGER NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      catalog_source_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (product_key) REFERENCES eazpire_products(product_key)
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eazpvc_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eazpvc_unique
      ON eazpire_product_variant_config (product_key, print_provider_id)`
  );

  await runSchemaPatch(
    db,
    "eazpire_template_products",
    `CREATE TABLE IF NOT EXISTS eazpire_template_products (
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
    )`
  );
  await runSchemaPatch(
    db,
    "idx_eaztp_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eaztp_unique
      ON eazpire_template_products (product_key, print_provider_id)`
  );
  await ensureColumn(db, "eazpire_template_products", "printify_draft_product_id", "TEXT");
}

export async function ensureManufacturerSchema(env) {
  try {
    const db = getManufacturerDb(env);
    if (!db) return false;
    if (schemaReady) return true;

    await db.prepare(`SELECT 1 FROM manufacturers LIMIT 1`).first().catch(() => null);
    await applyPendingSchemaPatches(db);

    schemaReady = true;
    return true;
  } catch (e) {
    console.warn("[ensureManufacturerSchema] failed:", e?.message || e);
    schemaReady = false;
    return false;
  }
}
