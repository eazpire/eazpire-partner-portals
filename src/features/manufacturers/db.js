/**
 * MANUFACTURER_DB helpers
 */

export function getManufacturerDb(env) {
  return env.MANUFACTURER_DB || null;
}

export function manufacturerDbUnavailable(cors) {
  return {
    body: {
      ok: false,
      error: "manufacturer_db_unavailable",
      message: "Manufacturer database is not configured.",
    },
    status: 503,
    cors,
  };
}

export function parseJson(text, fallback = null) {
  if (text == null) return fallback;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function newId(prefix = "mfg") {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${t}_${r}`;
}

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function rowToManufacturer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legal_name,
    slug: row.slug,
    country: row.country,
    website: row.website,
    support_email: row.support_email,
    business_email: row.business_email,
    status: row.status,
    integration_type: row.integration_type,
    quality_score: row.quality_score,
    delivery_score: row.delivery_score,
    support_score: row.support_score,
    artifact_ready_score: row.artifact_ready_score,
    suspend_reason: row.suspend_reason ?? null,
    suspended_at: row.suspended_at ?? null,
    suspended_by: row.suspended_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rowToProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    manufacturer_id: row.manufacturer_id,
    external_product_id: row.external_product_id,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    category: row.category,
    normalized_category: row.normalized_category,
    product_type: row.product_type,
    base_cost_cents: row.base_cost_cents,
    currency: row.currency,
    status: row.status,
    artifact_supported: !!row.artifact_supported,
    artifact_slot_type: row.artifact_slot_type,
    quality_score: row.quality_score,
    delivery_score: row.delivery_score,
    margin_score: row.margin_score,
    tags: parseJson(row.tags_json, []),
    attributes: parseJson(row.attributes_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    manufacturer_id: row.manufacturer_id,
    manufacturer_order_ref: row.manufacturer_order_ref,
    status: row.status,
    cost_total_cents: row.cost_total_cents,
    currency: row.currency,
    tracking_number: row.tracking_number,
    tracking_url: row.tracking_url,
    estimated_ship_at: row.estimated_ship_at,
    shipped_at: row.shipped_at,
    delivered_at: row.delivered_at,
    is_test_order: !!row.is_test_order,
    shipping: parseJson(row.shipping_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
