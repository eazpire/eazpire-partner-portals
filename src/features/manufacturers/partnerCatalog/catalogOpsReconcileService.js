/**
 * Reconciliation report via worker D1 bindings (catalog-db wins).
 */

import { compareProductOpsBaseline, summarizeBaselineReport } from "./catalogOpsCompare.js";

async function queryAll(db, sql, ...binds) {
  if (!db) return [];
  try {
    const res = binds.length ? await db.prepare(sql).bind(...binds).all() : await db.prepare(sql).all();
    return res?.results || [];
  } catch {
    return [];
  }
}

async function scalarCount(db, sql, productKey) {
  const row = await db.prepare(sql).bind(productKey).first();
  if (!row) return 0;
  return Number(Object.values(row)[0]) || 0;
}

async function loadCatalogSnapshot(catalogDb, productKey) {
  const product = await catalogDb
    .prepare(`SELECT product_key, title, is_active FROM product_catalog WHERE product_key = ? LIMIT 1`)
    .bind(productKey)
    .first();

  const activeRows = await queryAll(
    catalogDb,
    `SELECT print_provider_id FROM product_active_print_providers WHERE product_key = ? ORDER BY print_provider_id ASC`,
    productKey
  );

  return {
    product: product || null,
    activeProviderIds: activeRows.map((r) => r.print_provider_id),
    patCount: await scalarCount(
      catalogDb,
      `SELECT COUNT(*) AS c FROM print_area_printify_templates WHERE product_key = ? AND COALESCE(is_active, 1) = 1`,
      productKey
    ),
    publishProfileCount: await scalarCount(
      catalogDb,
      `SELECT COUNT(*) AS c FROM product_publish_profiles WHERE product_key = ?`,
      productKey
    ),
    publishPlanCount: await scalarCount(
      catalogDb,
      `SELECT COUNT(*) AS c FROM product_publish_map WHERE product_key = ?`,
      productKey
    ),
  };
}

async function loadManufacturerSnapshot(mfgDb, productKey) {
  const product = await mfgDb
    .prepare(
      `SELECT product_key, title, catalog_status, source_blueprint_id FROM eazpire_products WHERE product_key = ? LIMIT 1`
    )
    .bind(productKey)
    .first();

  const activeRows = await queryAll(
    mfgDb,
    `SELECT print_provider_id FROM eazpire_product_active_providers WHERE product_key = ? ORDER BY print_provider_id ASC`,
    productKey
  );

  return {
    product: product || null,
    activeProviderIds: activeRows.map((r) => r.print_provider_id),
    patCount: await scalarCount(
      mfgDb,
      `SELECT COUNT(*) AS c FROM eazpire_product_versions WHERE product_key = ? AND COALESCE(is_active, 1) = 1`,
      productKey
    ),
    publishProfileCount: await scalarCount(
      mfgDb,
      `SELECT COUNT(*) AS c FROM eazpire_product_publish_profiles WHERE product_key = ?`,
      productKey
    ),
    publishPlanCount: await scalarCount(
      mfgDb,
      `SELECT COUNT(*) AS c FROM eazpire_product_publish_plans WHERE product_key = ?`,
      productKey
    ),
  };
}

export async function runCatalogOpsReconcile(env, { isActive = 2 } = {}) {
  const catalogDb = env.CATALOG_DB;
  const mfgDb = env.MANUFACTURER_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };

  const onlineRows = await queryAll(
    catalogDb,
    `SELECT product_key, title, is_active FROM product_catalog WHERE is_active = ? ORDER BY product_key ASC`,
    Number(isActive)
  );

  const products = [];
  for (const row of onlineRows) {
    const productKey = row.product_key;
    const catalog = await loadCatalogSnapshot(catalogDb, productKey);
    let manufacturer;
    try {
      manufacturer = await loadManufacturerSnapshot(mfgDb, productKey);
    } catch (err) {
      manufacturer = {
        product: null,
        activeProviderIds: [],
        patCount: 0,
        publishProfileCount: 0,
        publishPlanCount: 0,
      };
    }
    products.push({
      title: row.title,
      ...compareProductOpsBaseline(productKey, catalog, manufacturer),
    });
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    policy: "catalog-db wins on conflicts; no automatic writes",
    summary: summarizeBaselineReport(products),
    products,
  };
}
