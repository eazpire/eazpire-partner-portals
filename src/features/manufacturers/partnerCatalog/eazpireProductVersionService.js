/**
 * Eazpire product versions (PAT equivalent)
 */

import { newId, parseJson } from "../db.js";

function rowToProductVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    product_key: row.product_key,
    fulfillment_provider_id: row.fulfillment_provider_id,
    display_name: row.display_name,
    description: row.description,
    sort_order: row.sort_order,
    studio_config: parseJson(row.studio_config_json, {}),
    auto_publish_config: parseJson(row.auto_publish_config_json, {}),
    external_template_product_id: row.external_template_product_id,
    product_version_config: parseJson(row.product_version_config_json, null),
    qr_logo_snapshot: parseJson(row.qr_logo_snapshot_json, null),
    is_active: !!row.is_active,
    publish_enabled: !!row.publish_enabled,
    catalog_pat_id: row.catalog_pat_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    provider_name: row.provider_name,
    external_provider_id: row.external_provider_id,
  };
}

export async function listProductVersions(db, productKey) {
  const res = await db
    .prepare(
      `SELECT v.*, fp.name AS provider_name, fp.external_provider_id
       FROM eazpire_product_versions v
       LEFT JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
       WHERE v.product_key = ?
       ORDER BY v.sort_order ASC, v.display_name ASC`
    )
    .bind(productKey)
    .all();
  return (res?.results || []).map(rowToProductVersion);
}

export async function getProductVersion(db, id) {
  const row = await db
    .prepare(
      `SELECT v.*, fp.name AS provider_name, fp.external_provider_id
       FROM eazpire_product_versions v
       LEFT JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
       WHERE v.id = ?`
    )
    .bind(id)
    .first();
  return rowToProductVersion(row);
}

export function patRowToStudioConfig(pat) {
  return {
    print_areas_snapshot: parseJson(pat.print_areas_snapshot_json, null),
    printify_print_area_groups: parseJson(pat.printify_print_area_groups_json, null),
    shopify_design_placement: pat.shopify_design_placement || null,
    print_provider_id: pat.print_provider_id != null ? Number(pat.print_provider_id) : null,
  };
}

export function patRowToAutoPublishConfig(pat) {
  return {
    auto_publish_enabled: !!pat.auto_publish_enabled,
    automation_shopify_sync_enabled: !!pat.automation_shopify_sync_enabled,
    automation_amazon_publish_enabled: !!pat.automation_amazon_publish_enabled,
    automation_social: parseJson(pat.automation_social_json, null),
  };
}

export async function upsertProductVersion(db, input) {
  const productKey = String(input.product_key || "").trim();
  const fulfillmentProviderId = String(input.fulfillment_provider_id || "").trim();
  const externalTemplateId = String(input.external_template_product_id ?? "").trim();
  if (!productKey || !fulfillmentProviderId) throw new Error("product_key_and_fulfillment_provider_required");

  const now = Date.now();
  let existing = null;
  if (input.id) {
    existing = await getProductVersion(db, input.id);
  }
  if (!existing) {
    const row = await db
      .prepare(
        `SELECT id FROM eazpire_product_versions
         WHERE product_key = ? AND fulfillment_provider_id = ? AND external_template_product_id = ?`
      )
      .bind(productKey, fulfillmentProviderId, externalTemplateId)
      .first();
    if (row?.id) existing = await getProductVersion(db, row.id);
  }

  const studioConfig = input.studio_config ?? existing?.studio_config ?? {};
  const autoPublishConfig = input.auto_publish_config ?? existing?.auto_publish_config ?? {};

  if (existing) {
    await db
      .prepare(
        `UPDATE eazpire_product_versions SET
          display_name = ?, description = ?, sort_order = ?,
          studio_config_json = ?, auto_publish_config_json = ?,
          external_template_product_id = ?, product_version_config_json = ?,
          qr_logo_snapshot_json = ?, is_active = ?, publish_enabled = ?,
          catalog_pat_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        input.display_name ?? existing.display_name,
        input.description !== undefined ? input.description : existing.description,
        input.sort_order ?? existing.sort_order ?? 0,
        JSON.stringify(studioConfig),
        JSON.stringify(autoPublishConfig),
        externalTemplateId || existing.external_template_product_id,
        input.product_version_config != null
          ? JSON.stringify(input.product_version_config)
          : existing.product_version_config
            ? JSON.stringify(existing.product_version_config)
            : null,
        input.qr_logo_snapshot != null
          ? JSON.stringify(input.qr_logo_snapshot)
          : existing.qr_logo_snapshot
            ? JSON.stringify(existing.qr_logo_snapshot)
            : null,
        input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active ? 1 : 0,
        input.publish_enabled !== undefined ? (input.publish_enabled ? 1 : 0) : existing.publish_enabled ? 1 : 0,
        input.catalog_pat_id !== undefined ? input.catalog_pat_id : existing.catalog_pat_id,
        now,
        existing.id
      )
      .run();
    return getProductVersion(db, existing.id);
  }

  const id = newId("epv");
  await db
    .prepare(
      `INSERT INTO eazpire_product_versions
        (id, product_key, fulfillment_provider_id, display_name, description, sort_order,
         studio_config_json, auto_publish_config_json, external_template_product_id,
         product_version_config_json, qr_logo_snapshot_json, is_active, publish_enabled,
         catalog_pat_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      productKey,
      fulfillmentProviderId,
      String(input.display_name || productKey).trim(),
      input.description ?? null,
      input.sort_order ?? 0,
      JSON.stringify(studioConfig),
      JSON.stringify(autoPublishConfig),
      externalTemplateId,
      input.product_version_config != null ? JSON.stringify(input.product_version_config) : null,
      input.qr_logo_snapshot != null ? JSON.stringify(input.qr_logo_snapshot) : null,
      input.is_active !== false ? 1 : 0,
      input.publish_enabled !== false ? 1 : 0,
      input.catalog_pat_id ?? null,
      now,
      now
    )
    .run();
  return getProductVersion(db, id);
}

export async function updateProductVersion(db, id, patch) {
  const existing = await getProductVersion(db, id);
  if (!existing) return null;
  return upsertProductVersion(db, {
    id,
    product_key: existing.product_key,
    fulfillment_provider_id: patch.fulfillment_provider_id ?? existing.fulfillment_provider_id,
    display_name: patch.display_name ?? existing.display_name,
    description: patch.description !== undefined ? patch.description : existing.description,
    sort_order: patch.sort_order ?? existing.sort_order,
    studio_config: patch.studio_config ?? existing.studio_config,
    auto_publish_config: patch.auto_publish_config ?? existing.auto_publish_config,
    external_template_product_id: patch.external_template_product_id ?? existing.external_template_product_id,
    product_version_config: patch.product_version_config !== undefined ? patch.product_version_config : existing.product_version_config,
    qr_logo_snapshot: patch.qr_logo_snapshot !== undefined ? patch.qr_logo_snapshot : existing.qr_logo_snapshot,
    is_active: patch.is_active !== undefined ? patch.is_active : existing.is_active,
    publish_enabled: patch.publish_enabled !== undefined ? patch.publish_enabled : existing.publish_enabled,
    catalog_pat_id: patch.catalog_pat_id !== undefined ? patch.catalog_pat_id : existing.catalog_pat_id,
  });
}
