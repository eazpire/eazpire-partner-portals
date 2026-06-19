/**
 * One-way mirror: MANUFACTURER_DB master → catalog-db publish index
 */

import { catalogStatusToIsActive } from "./constants.js";
import { parseJson } from "../db.js";

function studioConfigToPatFields(studioConfig) {
  const sc = studioConfig || {};
  return {
    print_areas_snapshot_json:
      sc.print_areas_snapshot != null ? JSON.stringify(sc.print_areas_snapshot) : null,
    printify_print_area_groups_json:
      sc.printify_print_area_groups != null ? JSON.stringify(sc.printify_print_area_groups) : null,
    shopify_design_placement: sc.shopify_design_placement || null,
    print_provider_id: sc.print_provider_id,
  };
}

function autoPublishConfigToPatFields(autoConfig) {
  const ac = autoConfig || {};
  return {
    auto_publish_enabled: ac.auto_publish_enabled ? 1 : 0,
    automation_shopify_sync_enabled: ac.automation_shopify_sync_enabled ? 1 : 0,
    automation_amazon_publish_enabled: ac.automation_amazon_publish_enabled ? 1 : 0,
    automation_social_json: ac.automation_social != null ? JSON.stringify(ac.automation_social) : null,
  };
}

export async function mirrorEazpireProductToCatalogDb(env, productKey) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb || !catalogDb) return { ok: false, error: "database_unavailable" };

  const product = await mfgDb.prepare(`SELECT * FROM eazpire_products WHERE product_key = ?`).bind(productKey).first();
  if (!product) return { ok: false, error: "product_not_in_master" };

  const now = Date.now();
  const isActive = catalogStatusToIsActive(product.catalog_status);

  const existingCatalog = await catalogDb
    .prepare(`SELECT product_key FROM product_catalog WHERE product_key = ?`)
    .bind(productKey)
    .first();

  if (existingCatalog) {
    await catalogDb
      .prepare(
        `UPDATE product_catalog SET
          title = ?, regions_json = ?, is_active = ?,
          visible_design_types_json = ?, catalog_category_group = ?,
          catalog_category_leaf = ?, catalog_audience_json = ?,
          catalog_production_type = ?, print_area_edit_use_mocks = ?, updated_at = ?
         WHERE product_key = ?`
      )
      .bind(
        product.title,
        product.regions_json,
        isActive,
        product.visible_design_types_json,
        product.catalog_category_group,
        product.catalog_category_leaf,
        product.catalog_audience_json,
        product.catalog_production_type,
        product.print_area_edit_use_mocks,
        now,
        productKey
      )
      .run();
  } else {
    await catalogDb
      .prepare(
        `INSERT INTO product_catalog
          (product_key, title, regions_json, is_active, visible_design_types_json,
           catalog_category_group, catalog_category_leaf, catalog_audience_json,
           catalog_production_type, print_area_edit_use_mocks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        product.title,
        product.regions_json,
        isActive,
        product.visible_design_types_json,
        product.catalog_category_group,
        product.catalog_category_leaf,
        product.catalog_audience_json,
        product.catalog_production_type,
        product.print_area_edit_use_mocks,
        now,
        now
      )
      .run();
  }

  const versions = await mfgDb
    .prepare(
      `SELECT v.*, fp.external_provider_id
       FROM eazpire_product_versions v
       JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
       WHERE v.product_key = ?`
    )
    .bind(productKey)
    .all();

  let patUpdated = 0;
  for (const v of versions?.results || []) {
    const studio = parseJson(v.studio_config_json, {});
    const auto = parseJson(v.auto_publish_config_json, {});
    const patFields = studioConfigToPatFields(studio);
    const autoFields = autoPublishConfigToPatFields(auto);
    const printProviderId = Number(patFields.print_provider_id || v.external_provider_id);

    if (v.catalog_pat_id) {
      await catalogDb
        .prepare(
          `UPDATE print_area_printify_templates SET
            display_name = ?, description = ?, sort_order = ?,
            print_provider_id = ?, printify_product_id = ?,
            print_areas_snapshot_json = COALESCE(?, print_areas_snapshot_json),
            printify_print_area_groups_json = COALESCE(?, printify_print_area_groups_json),
            shopify_design_placement = COALESCE(?, shopify_design_placement),
            product_version_config_json = ?,
            qr_logo_snapshot_json = ?,
            is_active = ?, publish_enabled = ?,
            auto_publish_enabled = ?, automation_shopify_sync_enabled = ?,
            automation_amazon_publish_enabled = ?, automation_social_json = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .bind(
          v.display_name,
          v.description,
          v.sort_order,
          printProviderId,
          v.external_template_product_id,
          patFields.print_areas_snapshot_json,
          patFields.printify_print_area_groups_json,
          patFields.shopify_design_placement,
          v.product_version_config_json,
          v.qr_logo_snapshot_json,
          v.is_active,
          v.publish_enabled,
          autoFields.auto_publish_enabled,
          autoFields.automation_shopify_sync_enabled,
          autoFields.automation_amazon_publish_enabled,
          autoFields.automation_social_json,
          now,
          v.catalog_pat_id
        )
        .run();
      patUpdated++;
      continue;
    }

    const insertResult = await catalogDb
      .prepare(
        `INSERT INTO print_area_printify_templates
          (product_key, print_provider_id, display_name, description, printify_product_id,
           sort_order, is_active, publish_enabled, print_areas_snapshot_json, qr_logo_snapshot_json,
           shopify_design_placement, product_version_config_json, printify_print_area_groups_json,
           auto_publish_enabled, automation_shopify_sync_enabled, automation_amazon_publish_enabled,
           automation_social_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        printProviderId,
        v.display_name,
        v.description,
        v.external_template_product_id,
        v.sort_order,
        v.is_active,
        v.publish_enabled,
        patFields.print_areas_snapshot_json,
        v.qr_logo_snapshot_json,
        patFields.shopify_design_placement,
        v.product_version_config_json,
        patFields.printify_print_area_groups_json,
        autoFields.auto_publish_enabled,
        autoFields.automation_shopify_sync_enabled,
        autoFields.automation_amazon_publish_enabled,
        autoFields.automation_social_json,
        now,
        now
      )
      .run();
    const newPatId = insertResult.meta?.last_row_id;
    if (newPatId) {
      await mfgDb
        .prepare(`UPDATE eazpire_product_versions SET catalog_pat_id = ?, updated_at = ? WHERE id = ?`)
        .bind(newPatId, now, v.id)
        .run();
    }
    patUpdated++;
  }

  const { mirrorShadowTablesForProduct } = await import("./shadow/shadowMirrorToCatalogDb.js");
  const shadowResult = await mirrorShadowTablesForProduct(env, productKey);

  return { ok: true, product_key: productKey, pat_updated: patUpdated, shadow: shadowResult.counts || shadowResult.stats };
}

export async function mirrorAllEazpireProductsToCatalogDb(env) {
  const mfgDb = env.MANUFACTURER_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };

  const products = await mfgDb.prepare(`SELECT product_key FROM eazpire_products`).all();
  const results = [];
  for (const row of products?.results || []) {
    results.push(await mirrorEazpireProductToCatalogDb(env, row.product_key));
  }
  const ok = results.every((r) => r.ok);
  return { ok, results, mirrored: results.filter((r) => r.ok).length };
}

export async function getCatalogMirrorDriftStatus(env) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb || !catalogDb) return { ok: false, error: "database_unavailable" };

  const masterProducts = await mfgDb.prepare(`SELECT product_key, title, catalog_status, updated_at FROM eazpire_products`).all();
  const drift = [];

  for (const mp of masterProducts?.results || []) {
    const index = await catalogDb
      .prepare(`SELECT title, is_active, updated_at FROM product_catalog WHERE product_key = ?`)
      .bind(mp.product_key)
      .first();

    const masterVersions = await mfgDb
      .prepare(`SELECT COUNT(*) AS c FROM eazpire_product_versions WHERE product_key = ?`)
      .bind(mp.product_key)
      .first();
    const indexPat = await catalogDb
      .prepare(`SELECT COUNT(*) AS c FROM print_area_printify_templates WHERE product_key = ? AND COALESCE(is_active,1)=1`)
      .bind(mp.product_key)
      .first();

    const issues = [];
    if (!index) issues.push("missing_in_catalog_db");
    else {
      if (index.title !== mp.title) issues.push("title_mismatch");
      const expectedActive = catalogStatusToIsActive(mp.catalog_status);
      if (Number(index.is_active) !== expectedActive) issues.push("is_active_mismatch");
    }
    if (Number(masterVersions?.c || 0) !== Number(indexPat?.c || 0)) issues.push("version_count_mismatch");

    drift.push({
      product_key: mp.product_key,
      in_sync: issues.length === 0,
      issues,
      master_updated_at: mp.updated_at,
      index_updated_at: index?.updated_at ?? null,
    });
  }

  return {
    ok: true,
    total: drift.length,
    in_sync: drift.filter((d) => d.in_sync).length,
    drift,
  };
}
