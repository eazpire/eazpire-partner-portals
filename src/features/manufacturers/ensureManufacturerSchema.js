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
}

export async function ensureManufacturerSchema(env) {
  const db = getManufacturerDb(env);
  if (!db) return false;
  if (schemaReady) return true;

  await db.prepare(`SELECT 1 FROM manufacturers LIMIT 1`).first().catch(() => null);
  await applyPendingSchemaPatches(db);

  schemaReady = true;
  return true;
}
