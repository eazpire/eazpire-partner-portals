/**
 * Manufacturer orders (test orders V1)
 */

import { getManufacturerDb, newId, rowToOrder, parseJson } from "./db.js";
import { writeAuditLog } from "./rbac.js";

export async function listOrders(db, manufacturerId, { status } = {}) {
  let sql = `SELECT * FROM manufacturer_orders WHERE manufacturer_id = ?`;
  const binds = [manufacturerId];
  if (status) {
    sql += ` AND status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY created_at DESC`;
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map(rowToOrder);
}

export async function getOrder(db, manufacturerId, orderId) {
  const row = await db
    .prepare(`SELECT * FROM manufacturer_orders WHERE id = ? AND manufacturer_id = ?`)
    .bind(orderId, manufacturerId)
    .first();
  if (!row) return null;
  const items = await db
    .prepare(`SELECT * FROM manufacturer_order_items WHERE manufacturer_order_id = ?`)
    .bind(orderId)
    .all();
  return {
    ...rowToOrder(row),
    items: (items.results || []).map((it) => ({
      ...it,
      print_files: parseJson(it.print_files_json, []),
      placement: parseJson(it.placement_json, {}),
      artifact: parseJson(it.artifact_json, {}),
    })),
  };
}

export async function updateOrderStatus(db, manufacturerId, orderId, status, extra = {}) {
  const now = Date.now();
  const fields = ["status = ?", "updated_at = ?"];
  const binds = [status, now];
  if (extra.tracking_number != null) {
    fields.push("tracking_number = ?");
    binds.push(extra.tracking_number);
  }
  if (extra.tracking_url != null) {
    fields.push("tracking_url = ?");
    binds.push(extra.tracking_url);
  }
  if (status === "shipped") {
    fields.push("shipped_at = ?");
    binds.push(now);
  }
  binds.push(orderId, manufacturerId);
  await db
    .prepare(`UPDATE manufacturer_orders SET ${fields.join(", ")} WHERE id = ? AND manufacturer_id = ?`)
    .bind(...binds)
    .run();
  return getOrder(db, manufacturerId, orderId);
}

export async function createTestOrder(env, { manufacturerId, productId, variantId, adminOwnerId }) {
  const db = getManufacturerDb(env);
  const product = await db
    .prepare(`SELECT * FROM manufacturer_products WHERE id = ? AND manufacturer_id = ?`)
    .bind(productId, manufacturerId)
    .first();
  if (!product) return { ok: false, error: "product_not_found" };

  const orderId = newId("mord");
  const parentOrderId = newId("ord_test");
  const now = Date.now();
  const printFileUrl = `https://creator-engine.eazpire.workers.dev/file/partner-test/${orderId}.png`;

  await db
    .prepare(
      `INSERT INTO manufacturer_orders
        (id, order_id, manufacturer_id, manufacturer_order_ref, status, cost_total_cents, currency, is_test_order, shipping_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'received', ?, ?, 1, ?, ?, ?)`
    )
    .bind(
      orderId,
      parentOrderId,
      manufacturerId,
      `TEST-${now}`,
      product.base_cost_cents || 0,
      product.currency || "EUR",
      JSON.stringify({ country: "DE", city: "Berlin", postal_code: "10115", name: "Test Customer" }),
      now,
      now
    )
    .run();

  const itemId = newId("mitem");
  await db
    .prepare(
      `INSERT INTO manufacturer_order_items
        (id, manufacturer_order_id, manufacturer_product_id, manufacturer_variant_id, quantity, print_files_json, placement_json, artifact_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, '{}', '{}', 'pending', ?, ?)`
    )
    .bind(
      itemId,
      orderId,
      productId,
      variantId || null,
      JSON.stringify([{ area: "front", url: printFileUrl, expires_at: now + 7 * 86400000 }]),
      now,
      now
    )
    .run();

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: adminOwnerId,
    action: "admin_create_test_order",
    entity_type: "manufacturer_order",
    entity_id: orderId,
  });

  return { ok: true, order: await getOrder(db, manufacturerId, orderId) };
}

export async function adminListOrdersByStatus(db) {
  const res = await db
    .prepare(
      `SELECT o.*, m.name AS manufacturer_name FROM manufacturer_orders o
       JOIN manufacturers m ON m.id = o.manufacturer_id
       ORDER BY o.created_at DESC LIMIT 500`
    )
    .all();
  const grouped = {
    received: [],
    accepted: [],
    in_production: [],
    shipped: [],
  };
  for (const row of res.results || []) {
    const order = { ...rowToOrder(row), manufacturer_name: row.manufacturer_name };
    if (grouped[order.status]) grouped[order.status].push(order);
    else if (order.status === "quality_check") grouped.in_production.push(order);
  }
  return grouped;
}

export function buildSignedPrintFileResponse(order, itemId) {
  const item = (order.items || []).find((i) => i.id === itemId) || order.items?.[0];
  const file = item?.print_files?.[0];
  if (!file?.url) return null;
  return { url: file.url, area: file.area, expires_at: file.expires_at };
}
