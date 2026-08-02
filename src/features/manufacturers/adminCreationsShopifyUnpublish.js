/**
 * Admin Creations — direct Shopify product unpublish (no published_designs row required).
 * Used for Todify orphans after a prior D1-only unpublish, or Shopify-only listings.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import {
  normalizeShopifyProductIdForDelete,
  unpublishShopifyProductById,
} from "../product/unpublishShopifyProduct.js";

/**
 * POST body: { product_id | shopify_product_id }
 * Deletes the Shopify Admin product and clears eaz_test_todify links.
 * Also deletes matching published_designs rows when present.
 */
export async function handleAdminCreationsShopifyProductUnpublish(request, env) {
  const cors = getCorsHeaders(request);
  const body = await request.json().catch(() => ({}));
  const rawId = body.product_id || body.shopify_product_id || body.id;
  const sid = normalizeShopifyProductIdForDelete(rawId);
  if (!sid) {
    return json({ ok: false, error: "missing_shopify_product_id" }, 400, cors);
  }

  try {
    const shopifyResult = await unpublishShopifyProductById(env, sid);

    let d1Deleted = 0;
    if (env.CREATOR_DB) {
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
    }

    if (!shopifyResult.ok && !shopifyResult.skipped) {
      return json(
        {
          ok: false,
          error: "shopify_delete_failed",
          detail: shopifyResult.message,
          shopify_product_id: sid,
          d1_deleted: d1Deleted,
        },
        502,
        cors
      );
    }

    return json(
      {
        ok: true,
        shopify_product_id: sid,
        shopify: shopifyResult,
        d1_deleted: d1Deleted,
      },
      200,
      cors
    );
  } catch (err) {
    return json(
      { ok: false, error: err?.message || "unpublish_failed", shopify_product_id: sid },
      500,
      cors
    );
  }
}
