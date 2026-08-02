/**
 * Admin Creations — direct Shopify product unpublish (no published_designs row required).
 * Also accepts studio:<listingId> refs and cancels studio listings that never reached Shopify.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { unpublishShopifyProductById } from "../product/unpublishShopifyProduct.js";
import {
  parseStudioListingId,
  loadStudioListingById,
  resolveShopifyProductIdFromAdminRef,
} from "./adminCreationsResolveProductId.js";
import { SHOP_STUDIO_STATUS_CANCELLED } from "../shop/shopStudioListingsSchema.js";

async function cancelStudioListing(env, listingId) {
  const id = String(listingId || "").trim();
  if (!id || !env?.CUSTOMER_DB) return { ok: false, cancelled: false };
  const now = Date.now();
  await env.CUSTOMER_DB.prepare(
    `UPDATE shop_studio_listings
     SET shopify_completion_status = ?, job_cancelled = 1, updated_at = ?
     WHERE id = ?`
  )
    .bind(SHOP_STUDIO_STATUS_CANCELLED, now, id)
    .run();
  try {
    await env.CUSTOMER_DB.prepare(
      `UPDATE shop_studio_pending_cart SET status = ?, updated_at = ? WHERE listing_id = ? AND status = 'pending'`
    )
      .bind(SHOP_STUDIO_STATUS_CANCELLED, now, id)
      .run();
  } catch (_) {
    /* optional table */
  }
  return { ok: true, cancelled: true, studio_listing_id: id };
}

async function clearPublishedDesignsForShopifyId(env, sid) {
  let d1Deleted = 0;
  if (!env?.CREATOR_DB || !sid) return d1Deleted;
  try {
    const rows = await env.CREATOR_DB.prepare(
      `SELECT id FROM published_designs
       WHERE TRIM(CAST(shopify_product_id AS TEXT)) = ?
          OR TRIM(CAST(shopify_product_id AS TEXT)) = ?
          OR TRIM(CAST(shopify_product_id AS TEXT)) LIKE ?`
    )
      .bind(sid, `${sid}.0`, `%/${sid}`)
      .all();
    for (const row of rows?.results || []) {
      const pid = row?.id;
      if (pid == null) continue;
      await env.CREATOR_DB.prepare(`DELETE FROM published_designs WHERE id = ?`).bind(pid).run();
      d1Deleted += 1;
    }
  } catch (e) {
    console.warn("[admin-creations-shopify-product-unpublish] D1 cleanup:", e?.message || e);
  }
  return d1Deleted;
}

/**
 * POST body: { product_id | shopify_product_id | studio_listing_id }
 */
export async function handleAdminCreationsShopifyProductUnpublish(request, env) {
  const cors = getCorsHeaders(request);
  const body = await request.json().catch(() => ({}));
  const rawId = String(
    body.product_id ||
      body.shopify_product_id ||
      body.id ||
      (body.studio_listing_id ? `studio:${body.studio_listing_id}` : "") ||
      ""
  ).trim();

  let shopifyId = "";
  let studioListingId = parseStudioListingId(rawId);

  const resolved = await resolveShopifyProductIdFromAdminRef(env, rawId);

  if (resolved.ok) {
    shopifyId = resolved.shopify_product_id;
    studioListingId = resolved.studio_listing_id || studioListingId;
  } else if (resolved.error === "studio_listing_not_on_shopify" && resolved.studio_listing_id) {
    try {
      const cancel = await cancelStudioListing(env, resolved.studio_listing_id);
      return json(
        {
          ok: true,
          mode: "studio_cancel",
          studio_listing_id: resolved.studio_listing_id,
          studio: cancel,
        },
        200,
        cors
      );
    } catch (err) {
      return json(
        {
          ok: false,
          error: err?.message || "studio_cancel_failed",
          studio_listing_id: resolved.studio_listing_id,
        },
        500,
        cors
      );
    }
  } else if (!shopifyId && body.studio_listing_id) {
    const listing = await loadStudioListingById(env, body.studio_listing_id);
    if (listing?.shopify_product_id) {
      shopifyId = listing.shopify_product_id;
      studioListingId = String(body.studio_listing_id);
    } else if (listing) {
      const cancel = await cancelStudioListing(env, body.studio_listing_id);
      return json(
        { ok: true, mode: "studio_cancel", studio_listing_id: String(body.studio_listing_id), studio: cancel },
        200,
        cors
      );
    }
  }

  if (!shopifyId) {
    return json(
      {
        ok: false,
        error: resolved.error || "missing_shopify_product_id",
        studio_listing_id: studioListingId || resolved.studio_listing_id || null,
      },
      400,
      cors
    );
  }

  try {
    const shopifyResult = await unpublishShopifyProductById(env, shopifyId);
    const d1Deleted = await clearPublishedDesignsForShopifyId(env, shopifyId);

    if (studioListingId) {
      await cancelStudioListing(env, studioListingId).catch(() => {});
    } else if (env.CUSTOMER_DB) {
      try {
        const now = Date.now();
        await env.CUSTOMER_DB.prepare(
          `UPDATE shop_studio_listings
           SET shopify_completion_status = ?, job_cancelled = 1, updated_at = ?
           WHERE TRIM(CAST(shopify_product_id AS TEXT)) = ?
              OR TRIM(CAST(shopify_product_id AS TEXT)) = ?`
        )
          .bind(SHOP_STUDIO_STATUS_CANCELLED, now, shopifyId, `${shopifyId}.0`)
          .run();
      } catch (e) {
        console.warn("[admin-creations-shopify-product-unpublish] studio by sid:", e?.message || e);
      }
    }

    if (!shopifyResult.ok && !shopifyResult.skipped) {
      return json(
        {
          ok: false,
          error: "shopify_delete_failed",
          detail: shopifyResult.message,
          shopify_product_id: shopifyId,
          d1_deleted: d1Deleted,
        },
        502,
        cors
      );
    }

    return json(
      {
        ok: true,
        mode: "shopify_delete",
        shopify_product_id: shopifyId,
        studio_listing_id: studioListingId || null,
        shopify: shopifyResult,
        d1_deleted: d1Deleted,
      },
      200,
      cors
    );
  } catch (err) {
    return json(
      { ok: false, error: err?.message || "unpublish_failed", shopify_product_id: shopifyId },
      500,
      cors
    );
  }
}
