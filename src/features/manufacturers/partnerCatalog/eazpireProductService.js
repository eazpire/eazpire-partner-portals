/**
 * Eazpire curated products (catalog master)
 */

import { parseJson } from "../db.js";
import { catalogStatusToIsActive } from "./constants.js";

function rowToEazpireProduct(row) {
  if (!row) return null;
  return {
    product_key: row.product_key,
    manufacturer_id: row.manufacturer_id,
    source_blueprint_id: row.source_blueprint_id,
    title: row.title,
    regions: parseJson(row.regions_json, []),
    catalog_status: row.catalog_status,
    is_active: catalogStatusToIsActive(row.catalog_status),
    visible_design_types: parseJson(row.visible_design_types_json, null),
    catalog_category_group: row.catalog_category_group,
    catalog_category_leaf: row.catalog_category_leaf,
    catalog_audience: parseJson(row.catalog_audience_json, null),
    catalog_production_type: row.catalog_production_type,
    print_area_edit_use_mocks: !!row.print_area_edit_use_mocks,
    created_at: row.created_at,
    updated_at: row.updated_at,
    manufacturer_name: row.manufacturer_name,
    blueprint_title: row.blueprint_title,
    blueprint_category: row.blueprint_category,
    version_count: row.version_count != null ? Number(row.version_count) : undefined,
  };
}

export async function listEazpireProducts(db, { manufacturerId, catalogStatus } = {}) {
  let sql = `SELECT ep.*, m.name AS manufacturer_name, eb.title AS blueprint_title,
    eb.normalized_category AS blueprint_category,
    (SELECT COUNT(*) FROM eazpire_product_versions v WHERE v.product_key = ep.product_key) AS version_count
    FROM eazpire_products ep
    LEFT JOIN manufacturers m ON m.id = ep.manufacturer_id
    LEFT JOIN manufacturer_eazpire_blueprints eb ON eb.id = ep.source_blueprint_id
    WHERE 1=1`;
  const binds = [];
  if (manufacturerId) {
    sql += ` AND ep.manufacturer_id = ?`;
    binds.push(manufacturerId);
  }
  if (catalogStatus) {
    sql += ` AND ep.catalog_status = ?`;
    binds.push(catalogStatus);
  }
  sql += ` ORDER BY ep.title ASC`;
  const stmt = db.prepare(sql);
  const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return (res?.results || []).map(rowToEazpireProduct);
}

export async function getEazpireProduct(db, productKey) {
  const row = await db
    .prepare(
      `SELECT ep.*, m.name AS manufacturer_name, eb.title AS blueprint_title
       FROM eazpire_products ep
       LEFT JOIN manufacturers m ON m.id = ep.manufacturer_id
       LEFT JOIN manufacturer_eazpire_blueprints eb ON eb.id = ep.source_blueprint_id
       WHERE ep.product_key = ?`
    )
    .bind(productKey)
    .first();
  return rowToEazpireProduct(row);
}

export async function upsertEazpireProduct(db, input) {
  const productKey = String(input.product_key || "").trim();
  if (!productKey) throw new Error("product_key_required");
  const now = Date.now();
  const existing = await db.prepare(`SELECT product_key FROM eazpire_products WHERE product_key = ?`).bind(productKey).first();

  const fields = {
    manufacturer_id: input.manufacturer_id,
    source_blueprint_id: input.source_blueprint_id ?? null,
    title: String(input.title || productKey).trim(),
    regions_json: JSON.stringify(input.regions || []),
    catalog_status: input.catalog_status || "offline",
    visible_design_types_json: input.visible_design_types != null ? JSON.stringify(input.visible_design_types) : null,
    catalog_category_group: input.catalog_category_group ?? null,
    catalog_category_leaf: input.catalog_category_leaf ?? null,
    catalog_audience_json: input.catalog_audience != null ? JSON.stringify(input.catalog_audience) : null,
    catalog_production_type: input.catalog_production_type ?? null,
    print_area_edit_use_mocks: input.print_area_edit_use_mocks ? 1 : 0,
    updated_at: now,
  };

  if (existing) {
    await db
      .prepare(
        `UPDATE eazpire_products SET
          manufacturer_id = ?, source_blueprint_id = ?, title = ?, regions_json = ?,
          catalog_status = ?, visible_design_types_json = ?, catalog_category_group = ?,
          catalog_category_leaf = ?, catalog_audience_json = ?, catalog_production_type = ?,
          print_area_edit_use_mocks = ?, updated_at = ?
         WHERE product_key = ?`
      )
      .bind(
        fields.manufacturer_id,
        fields.source_blueprint_id,
        fields.title,
        fields.regions_json,
        fields.catalog_status,
        fields.visible_design_types_json,
        fields.catalog_category_group,
        fields.catalog_category_leaf,
        fields.catalog_audience_json,
        fields.catalog_production_type,
        fields.print_area_edit_use_mocks,
        fields.updated_at,
        productKey
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_products
          (product_key, manufacturer_id, source_blueprint_id, title, regions_json, catalog_status,
           visible_design_types_json, catalog_category_group, catalog_category_leaf, catalog_audience_json,
           catalog_production_type, print_area_edit_use_mocks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        fields.manufacturer_id,
        fields.source_blueprint_id,
        fields.title,
        fields.regions_json,
        fields.catalog_status,
        fields.visible_design_types_json,
        fields.catalog_category_group,
        fields.catalog_category_leaf,
        fields.catalog_audience_json,
        fields.catalog_production_type,
        fields.print_area_edit_use_mocks,
        now,
        now
      )
      .run();
  }
  return getEazpireProduct(db, productKey);
}

export async function updateEazpireProduct(db, productKey, patch) {
  const existing = await getEazpireProduct(db, productKey);
  if (!existing) return null;
  return upsertEazpireProduct(db, {
    product_key: productKey,
    manufacturer_id: patch.manufacturer_id ?? existing.manufacturer_id,
    source_blueprint_id: patch.source_blueprint_id !== undefined ? patch.source_blueprint_id : existing.source_blueprint_id,
    title: patch.title ?? existing.title,
    regions: patch.regions ?? existing.regions,
    catalog_status: patch.catalog_status ?? existing.catalog_status,
    visible_design_types: patch.visible_design_types !== undefined ? patch.visible_design_types : existing.visible_design_types,
    catalog_category_group: patch.catalog_category_group !== undefined ? patch.catalog_category_group : existing.catalog_category_group,
    catalog_category_leaf: patch.catalog_category_leaf !== undefined ? patch.catalog_category_leaf : existing.catalog_category_leaf,
    catalog_audience: patch.catalog_audience !== undefined ? patch.catalog_audience : existing.catalog_audience,
    catalog_production_type: patch.catalog_production_type !== undefined ? patch.catalog_production_type : existing.catalog_production_type,
    print_area_edit_use_mocks: patch.print_area_edit_use_mocks !== undefined ? patch.print_area_edit_use_mocks : existing.print_area_edit_use_mocks,
  });
}
