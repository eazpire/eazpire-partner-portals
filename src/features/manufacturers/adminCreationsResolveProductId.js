/**
 * Resolve Admin Creations product ids (Shopify numeric / GID / studio:<listingId>).
 */

import { normalizeShopifyProductId } from "./adminCreationsShopifyList.js";

/**
 * @param {unknown} raw
 * @returns {string|null} numeric studio listing id, or null
 */
export function parseStudioListingId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = /^studio:(\d+)$/i.exec(s);
  if (m) return m[1];
  return null;
}

/**
 * @param {any} env
 * @param {string|number} listingId
 * @returns {Promise<{ id: string, shopify_product_id: string|null, product_key: string, product_title: string, shopify_completion_status: string }|null>}
 */
export async function loadStudioListingById(env, listingId) {
  const id = String(listingId || "").trim();
  if (!id || !/^\d+$/.test(id) || !env?.CUSTOMER_DB) return null;
  try {
    const row = await env.CUSTOMER_DB.prepare(
      `SELECT id, shopify_product_id, product_key, product_title, shopify_completion_status
       FROM shop_studio_listings WHERE id = ? LIMIT 1`
    )
      .bind(id)
      .first();
    if (!row?.id) return null;
    return {
      id: String(row.id),
      shopify_product_id: normalizeShopifyProductId(row.shopify_product_id) || null,
      product_key: String(row.product_key || "").trim(),
      product_title: String(row.product_title || "").trim(),
      shopify_completion_status: String(row.shopify_completion_status || "").trim(),
    };
  } catch (e) {
    console.warn("[adminCreationsResolveProductId] studio lookup:", e?.message || e);
    return null;
  }
}

/**
 * Resolve a UI/API product_id into a Shopify Admin numeric id when possible.
 * @param {any} env
 * @param {unknown} rawId
 * @returns {Promise<{
 *   ok: boolean,
 *   shopify_product_id: string,
 *   studio_listing_id: string|null,
 *   error?: string,
 * }>}
 */
export async function resolveShopifyProductIdFromAdminRef(env, rawId) {
  const raw = String(rawId ?? "").trim();
  if (!raw) {
    return { ok: false, shopify_product_id: "", studio_listing_id: null, error: "product_id_required" };
  }

  const studioId = parseStudioListingId(raw);
  if (studioId) {
    const listing = await loadStudioListingById(env, studioId);
    if (!listing) {
      return {
        ok: false,
        shopify_product_id: "",
        studio_listing_id: studioId,
        error: "studio_listing_not_found",
      };
    }
    if (!listing.shopify_product_id) {
      return {
        ok: false,
        shopify_product_id: "",
        studio_listing_id: studioId,
        error: "studio_listing_not_on_shopify",
      };
    }
    return {
      ok: true,
      shopify_product_id: listing.shopify_product_id,
      studio_listing_id: studioId,
    };
  }

  const sid = normalizeShopifyProductId(raw);
  if (!sid) {
    return { ok: false, shopify_product_id: "", studio_listing_id: null, error: "invalid_shopify_product_id" };
  }
  return { ok: true, shopify_product_id: sid, studio_listing_id: null };
}
