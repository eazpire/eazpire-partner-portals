/**
 * Catalog: products, variants, mockups
 */

import { getManufacturerDb, newId, rowToProduct, parseJson } from "./db.js";
import { validatePrintAreaForSubmit } from "./printAreaValidation.js";
import { writeAuditLog } from "./rbac.js";

export async function listProducts(db, manufacturerId, { status } = {}) {
  let sql = `SELECT * FROM manufacturer_products WHERE manufacturer_id = ?`;
  const binds = [manufacturerId];
  if (status) {
    sql += ` AND status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY updated_at DESC`;
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map(rowToProduct);
}

export async function getProduct(db, manufacturerId, productId) {
  const row = await db
    .prepare(`SELECT * FROM manufacturer_products WHERE id = ? AND manufacturer_id = ?`)
    .bind(productId, manufacturerId)
    .first();
  return rowToProduct(row);
}

export async function createProduct(db, manufacturerId, input) {
  const id = newId("mprod");
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturer_products
        (id, manufacturer_id, title, subtitle, description, category, normalized_category, product_type,
         base_cost_cents, currency, status, artifact_supported, artifact_slot_type, tags_json, attributes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      manufacturerId,
      input.title,
      input.subtitle || null,
      input.description || null,
      input.category || null,
      input.normalized_category || input.category || null,
      input.product_type || null,
      Number(input.base_cost_cents || 0),
      input.currency || "EUR",
      input.artifact_supported ? 1 : 0,
      input.artifact_slot_type || null,
      JSON.stringify(input.tags || []),
      JSON.stringify(input.attributes || {}),
      now,
      now
    )
    .run();
  return getProduct(db, manufacturerId, id);
}

export async function updateProduct(db, manufacturerId, productId, input) {
  const existing = await getProduct(db, manufacturerId, productId);
  if (!existing) return null;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE manufacturer_products SET
        title = ?, subtitle = ?, description = ?, category = ?, normalized_category = ?,
        product_type = ?, base_cost_cents = ?, currency = ?,
        artifact_supported = ?, artifact_slot_type = ?, tags_json = ?, attributes_json = ?, updated_at = ?
       WHERE id = ? AND manufacturer_id = ?`
    )
    .bind(
      input.title ?? existing.title,
      input.subtitle ?? existing.subtitle,
      input.description ?? existing.description,
      input.category ?? existing.category,
      input.normalized_category ?? existing.normalized_category,
      input.product_type ?? existing.product_type,
      Number(input.base_cost_cents ?? existing.base_cost_cents),
      input.currency ?? existing.currency,
      input.artifact_supported != null ? (input.artifact_supported ? 1 : 0) : existing.artifact_supported ? 1 : 0,
      input.artifact_slot_type ?? existing.artifact_slot_type,
      JSON.stringify(input.tags ?? existing.tags),
      JSON.stringify(input.attributes ?? existing.attributes),
      now,
      productId,
      manufacturerId
    )
    .run();
  return getProduct(db, manufacturerId, productId);
}

export async function submitProductForReview(db, manufacturerId, productId) {
  const areas = await listPrintAreas(db, manufacturerId, productId);
  const validation = validatePrintAreaForSubmit(areas);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const now = Date.now();
  await db
    .prepare(`UPDATE manufacturer_products SET status = 'pending_review', updated_at = ? WHERE id = ? AND manufacturer_id = ?`)
    .bind(now, productId, manufacturerId)
    .run();
  return { ok: true, product: await getProduct(db, manufacturerId, productId) };
}

export async function listVariants(db, manufacturerId, productId) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return [];
  const res = await db
    .prepare(`SELECT * FROM manufacturer_variants WHERE manufacturer_product_id = ? ORDER BY created_at DESC`)
    .bind(productId)
    .all();
  return (res.results || []).map((row) => ({
    ...row,
    available: !!row.available,
    attributes: parseJson(row.attributes_json, {}),
  }));
}

export async function createVariant(db, manufacturerId, productId, input) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return null;
  const id = newId("mvar");
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturer_variants
        (id, manufacturer_product_id, sku, color, size, material, base_cost_cents, currency, weight_grams, available, attributes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      productId,
      input.sku || null,
      input.color || null,
      input.size || null,
      input.material || null,
      Number(input.base_cost_cents ?? product.base_cost_cents),
      input.currency || product.currency,
      input.weight_grams || null,
      input.available === false ? 0 : 1,
      JSON.stringify(input.attributes || {}),
      now,
      now
    )
    .run();
  return (await listVariants(db, manufacturerId, productId)).find((v) => v.id === id);
}

export async function listPrintAreas(db, manufacturerId, productId) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return [];
  const res = await db
    .prepare(`SELECT * FROM manufacturer_print_areas WHERE manufacturer_product_id = ? ORDER BY created_at DESC`)
    .bind(productId)
    .all();
  return (res.results || []).map((row) => ({
    ...row,
    safe_zone: parseJson(row.safe_zone_json, {}),
    position: parseJson(row.position_json, {}),
    print_rect: parseJson(row.print_rect_json, {}),
    placeholders: parseJson(row.placeholders_json, {}),
    view_key: row.view_key || row.area_key,
    image_r2_key: row.image_r2_key || null,
    image_url: row.image_url || null,
    supported_file_types: parseJson(row.supported_file_types_json, ["png"]),
    supports_transparency: !!row.supports_transparency,
  }));
}

export async function upsertPrintArea(db, manufacturerId, productId, input) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return null;
  const id = input.id || newId("mpa");
  const now = Date.now();
  const existing = input.id
    ? await db.prepare(`SELECT id FROM manufacturer_print_areas WHERE id = ?`).bind(id).first()
    : null;

  const payload = [
    input.area_key,
    input.label || input.area_key,
    Number(input.width_px),
    Number(input.height_px),
    Number(input.dpi || 300),
    JSON.stringify(input.safe_zone || {}),
    JSON.stringify(input.position || {}),
    JSON.stringify(input.supported_file_types || ["png"]),
    input.supports_transparency === false ? 0 : 1,
    input.default_fit || "contain",
    input.status || "draft",
    now,
  ];

  if (existing) {
    await db
      .prepare(
        `UPDATE manufacturer_print_areas SET
          area_key = ?, label = ?, width_px = ?, height_px = ?, dpi = ?,
          safe_zone_json = ?, position_json = ?, supported_file_types_json = ?,
          supports_transparency = ?, default_fit = ?, status = ?, updated_at = ?
         WHERE id = ? AND manufacturer_product_id = ?`
      )
      .bind(...payload, id, productId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO manufacturer_print_areas
          (id, manufacturer_product_id, area_key, label, width_px, height_px, dpi, safe_zone_json, position_json,
           supported_file_types_json, supports_transparency, default_fit, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, productId, ...payload, now)
      .run();
  }

  return (await listPrintAreas(db, manufacturerId, productId)).find((a) => a.id === id);
}

export async function adminListProducts(db, { status, limit = 200 } = {}) {
  let sql = `SELECT p.*, m.name AS manufacturer_name FROM manufacturer_products p JOIN manufacturers m ON m.id = p.manufacturer_id`;
  const binds = [];
  if (status) {
    sql += ` WHERE p.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY p.updated_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map((row) => ({
    ...rowToProduct(row),
    manufacturer_name: row.manufacturer_name,
  }));
}

export async function adminReviewProduct(env, productId, { approve, adminOwnerId }) {
  const db = getManufacturerDb(env);
  const now = Date.now();
  const status = approve ? "active" : "rejected";
  const row = await db.prepare(`SELECT * FROM manufacturer_products WHERE id = ?`).bind(productId).first();
  if (!row) return null;
  await db
    .prepare(`UPDATE manufacturer_products SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, now, productId)
    .run();
  await writeAuditLog(env, {
    manufacturer_id: row.manufacturer_id,
    user_id: adminOwnerId,
    action: approve ? "admin_product_approved" : "admin_product_rejected",
    entity_type: "manufacturer_product",
    entity_id: productId,
  });
  return rowToProduct(await db.prepare(`SELECT * FROM manufacturer_products WHERE id = ?`).bind(productId).first());
}
