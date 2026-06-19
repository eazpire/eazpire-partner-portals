/**
 * Field-level drift detection: MANUFACTURER_DB shadow vs catalog-db (+ CREATOR_DB variant config)
 */

import { catalogStatusToIsActive } from "../constants.js";

function norm(value) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function compareFields(masterRow, indexRow, fields) {
  const mismatches = [];
  for (const field of fields) {
    const masterVal = norm(masterRow?.[field]);
    const indexVal = norm(indexRow?.[field]);
    if (masterVal !== indexVal) {
      mismatches.push({ field, master: masterVal, index: indexVal });
    }
  }
  return mismatches;
}

async function safeCatalogAll(catalogDb, sql, productKey) {
  try {
    return await catalogDb.prepare(sql).bind(productKey).all();
  } catch {
    return { results: [] };
  }
}

async function compareTableByCatalogSourceId(mfgRows, catalogRows, fields, keyLabel = "catalog_source_id") {
  const issues = [];
  const indexById = new Map((catalogRows || []).map((r) => [Number(r.id), r]));
  const matchedCatalogIds = new Set();

  for (const master of mfgRows || []) {
    const catalogId = master.catalog_source_id != null ? Number(master.catalog_source_id) : null;
    if (!catalogId) {
      issues.push({ issue: "missing_catalog_source_id", master_id: master.id, [keyLabel]: null });
      continue;
    }
    const index = indexById.get(catalogId);
    if (!index) {
      issues.push({ issue: "missing_in_catalog_db", master_id: master.id, [keyLabel]: catalogId });
      continue;
    }
    matchedCatalogIds.add(catalogId);
    const fieldMismatches = compareFields(master, index, fields);
    if (fieldMismatches.length) {
      issues.push({ issue: "field_mismatch", master_id: master.id, [keyLabel]: catalogId, fields: fieldMismatches });
    }
  }

  for (const catalogRow of catalogRows || []) {
    if (!matchedCatalogIds.has(Number(catalogRow.id))) {
      issues.push({ issue: "extra_in_catalog_db", catalog_id: catalogRow.id });
    }
  }

  return {
    master_count: (mfgRows || []).length,
    index_count: (catalogRows || []).length,
    in_sync: issues.length === 0,
    issues,
  };
}

export async function getCatalogDriftV2ForProduct(env, productKey) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb || !catalogDb) return { ok: false, error: "database_unavailable" };

  const tables = {};

  const masterProduct = await mfgDb
    .prepare(`SELECT * FROM eazpire_products WHERE product_key = ?`)
    .bind(productKey)
    .first();
  const indexProduct = await catalogDb
    .prepare(`SELECT * FROM product_catalog WHERE product_key = ?`)
    .bind(productKey)
    .first();

  const productFields = [
    "title",
    "catalog_category_group",
    "catalog_category_leaf",
    "catalog_production_type",
    "print_area_edit_use_mocks",
  ];
  const productIssues = [];
  if (!indexProduct) productIssues.push({ issue: "missing_in_catalog_db" });
  else {
    productIssues.push(...compareFields(masterProduct, indexProduct, productFields));
    const expectedActive = catalogStatusToIsActive(masterProduct?.catalog_status);
    if (Number(indexProduct.is_active) !== expectedActive) {
      productIssues.push({
        field: "is_active",
        master: expectedActive,
        index: Number(indexProduct.is_active),
      });
    }
  }
  tables.product_catalog = {
    in_sync: productIssues.length === 0,
    issues: productIssues,
  };

  const masterProfiles = (
    await mfgDb
      .prepare(`SELECT * FROM eazpire_product_publish_profiles WHERE product_key = ?`)
      .bind(productKey)
      .all()
  )?.results;
  const indexProfiles = (await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_publish_profiles WHERE product_key = ?`,
    productKey
  )).results;
  tables.publish_profiles = await compareTableByCatalogSourceId(masterProfiles, indexProfiles, [
    "title",
    "print_provider_id",
    "source_product_id",
    "is_active",
  ]);

  const masterPlans = (
    await mfgDb.prepare(`SELECT * FROM eazpire_product_publish_plans WHERE product_key = ?`).bind(productKey).all()
  )?.results;
  const indexPlans = (await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_publish_map WHERE product_key = ?`,
    productKey
  )).results;
  tables.publish_plans = await compareTableByCatalogSourceId(masterPlans, indexPlans, [
    "provider_name",
    "region_codes_json",
    "is_enabled",
    "priority",
  ]);

  const masterActive = (
    await mfgDb
      .prepare(`SELECT * FROM eazpire_product_active_providers WHERE product_key = ?`)
      .bind(productKey)
      .all()
  )?.results;
  const indexActive = (await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_active_print_providers WHERE product_key = ?`,
    productKey
  )).results;
  tables.active_providers = await compareTableByCatalogSourceId(masterActive, indexActive, ["print_provider_id"]);

  const masterMockupDefaults = (
    await mfgDb
      .prepare(`SELECT * FROM eazpire_product_mockup_defaults WHERE product_key = ?`)
      .bind(productKey)
      .all()
  )?.results;
  const indexMockupDefaults = (await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_mockup_defaults WHERE product_key = ?`,
    productKey
  )).results;
  tables.mockup_defaults = await compareTableByCatalogSourceId(masterMockupDefaults, indexMockupDefaults, [
    "print_area_key",
    "template_r2_key",
    "is_active",
  ]);

  const masterVersions = (
    await mfgDb.prepare(`SELECT * FROM eazpire_product_versions WHERE product_key = ?`).bind(productKey).all()
  )?.results;
  const indexPat = (await safeCatalogAll(
    catalogDb,
    `SELECT * FROM print_area_printify_templates WHERE product_key = ?`,
    productKey
  )).results;
  const versionIssues = [];
  const patById = new Map((indexPat || []).map((r) => [Number(r.id), r]));
  const matchedPatIds = new Set();
  for (const master of masterVersions || []) {
    const patId = master.catalog_pat_id != null ? Number(master.catalog_pat_id) : null;
    if (!patId) {
      versionIssues.push({ issue: "missing_catalog_pat_id", master_id: master.id });
      continue;
    }
    const index = patById.get(patId);
    if (!index) {
      versionIssues.push({ issue: "missing_in_catalog_db", master_id: master.id, catalog_pat_id: patId });
      continue;
    }
    matchedPatIds.add(patId);
    const fieldMismatches = compareFields(master, index, ["display_name", "sort_order", "is_active", "publish_enabled"]);
    if (fieldMismatches.length) {
      versionIssues.push({ issue: "field_mismatch", master_id: master.id, catalog_pat_id: patId, fields: fieldMismatches });
    }
  }
  for (const pat of indexPat || []) {
    if (!matchedPatIds.has(Number(pat.id))) {
      versionIssues.push({ issue: "extra_in_catalog_db", catalog_pat_id: pat.id });
    }
  }
  tables.product_versions = {
    master_count: (masterVersions || []).length,
    index_count: (indexPat || []).length,
    in_sync: versionIssues.length === 0,
    issues: versionIssues,
  };

  const masterVariantConfig = (
    await mfgDb
      .prepare(`SELECT * FROM eazpire_product_variant_config WHERE product_key = ?`)
      .bind(productKey)
      .all()
  )?.results;
  let indexVariantConfig = [];
  if (env.CREATOR_DB) {
    try {
      indexVariantConfig = (
        await env.CREATOR_DB.prepare(`SELECT * FROM product_variant_config WHERE product_key = ?`).bind(productKey).all()
      )?.results;
    } catch {
      indexVariantConfig = [];
    }
  }
  tables.variant_config = await compareTableByCatalogSourceId(masterVariantConfig, indexVariantConfig, [
    "print_provider_id",
    "config_json",
  ]);

  const tableNames = Object.keys(tables);
  const inSync = tableNames.every((t) => tables[t].in_sync);

  return {
    ok: true,
    product_key: productKey,
    in_sync: inSync,
    tables,
  };
}

export async function getCatalogDriftV2Status(env) {
  const mfgDb = env.MANUFACTURER_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };
  if (!env.CATALOG_DB) return { ok: false, error: "catalog_db_unavailable" };

  const products = await mfgDb.prepare(`SELECT product_key FROM eazpire_products`).all();
  const drift = [];
  for (const row of products?.results || []) {
    drift.push(await getCatalogDriftV2ForProduct(env, row.product_key));
  }

  const inSyncCount = drift.filter((d) => d.in_sync).length;
  return {
    ok: true,
    total: drift.length,
    in_sync: inSyncCount,
    drift,
  };
}
