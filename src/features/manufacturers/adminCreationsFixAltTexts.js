/**
 * Admin Creations Products — check + repair Shopify image alt texts and featured preview.
 * POST ?op=admin-creations-fix-alt-texts
 * Body: { shopify_product_id, printify_product_id?, product_key?, design_id? }
 */
import { requireAdmin } from "../../utils/auth.js";
import { getCorsHeaders, json } from "../../utils/response.js";
import { shopifyAPI } from "../../utils/shopify.js";
import {
  setImageAltTexts,
  ensureShopifyPrimaryPreview,
  assignVariantFeaturedImagesByPrimaryView,
} from "../publish/setImageAltTexts.js";
import { remapApparelAltsByCdnSize } from "../publish/apparelAltRepairAfterPublish.js";
import { auditListingAltHealth } from "../publish/softstyleSizeAltRepair.js";

const PRIMARY_VIEW = "front";

function normSid(raw) {
  return String(raw || "")
    .replace("gid://shopify/Product/", "")
    .replace(/\.0$/, "")
    .trim();
}

function shopDomain(env) {
  const shop = String(env.SHOPIFY_SHOP || "allyoucanpink.myshopify.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return shop.includes(".") ? shop : `${shop}.myshopify.com`;
}

async function lookupPublishedRow(env, sid) {
  if (!env.CREATOR_DB || !sid) return null;
  const norm =
    `REPLACE(REPLACE(TRIM(CAST(shopify_product_id AS TEXT)), 'gid://shopify/Product/', ''), '.0', '')`;
  try {
    return await env.CREATOR_DB.prepare(
      `SELECT id, design_id, product_key, printify_product_id, shopify_product_id
       FROM published_designs
       WHERE shopify_product_id IS NOT NULL AND ${norm} = ?
       ORDER BY id DESC LIMIT 1`
    )
      .bind(sid)
      .first();
  } catch {
    return null;
  }
}

/**
 * Check + repair Shopify image alt texts and featured preview for one listing.
 * Shared by the HTTP op and the durable admin queue consumer.
 */
export async function runFixAltTextsForShopifyProduct(env, opts = {}) {
  const sid = normSid(opts.shopify_product_id || opts.id);
  if (!sid) return { ok: false, error: "missing_shopify_product_id" };

  const shop = shopDomain(env);
  const row = await lookupPublishedRow(env, sid);
  const printifyId = String(opts.printify_product_id || row?.printify_product_id || "").trim();
  const productKey = String(opts.product_key || row?.product_key || "").trim();
  const publishedDesignId = Number(opts.published_design_id || row?.id || 0) || null;

  let product;
  try {
    product = (await shopifyAPI(env, shop, `products/${sid}.json`))?.product;
  } catch (e) {
    return { ok: false, error: e?.message || "shopify_fetch_failed" };
  }
  if (!product) return { ok: false, error: "shopify_product_missing" };

  const steps = [];
  const remap = await remapApparelAltsByCdnSize(env, {
    shopifyProductId: sid,
    printifyProductId: printifyId,
    productKey,
    productTitle: product.title,
    primaryView: PRIMARY_VIEW,
  });
  if (remap.skipped) {
    if (printifyId) {
      const altRes = await setImageAltTexts(env, printifyId, sid, null, { productKey });
      steps.push({ step: "set_image_alt_texts", ...altRes });
    }
  } else {
    steps.push(...(remap.steps || []));
  }
  const before = remap.before || auditListingAltHealth(product.images || [], { primaryView: PRIMARY_VIEW });

  const featured = await ensureShopifyPrimaryPreview(env, sid, PRIMARY_VIEW, {
    retries: 3,
    delayMs: 800,
  });
  steps.push({ step: "featured_preview", ...featured });

  const variants = await assignVariantFeaturedImagesByPrimaryView(env, sid, PRIMARY_VIEW).catch((e) => ({
    ok: false,
    error: e?.message || String(e),
  }));
  steps.push({ step: "variant_previews", ...variants });

  const afterProd = (await shopifyAPI(env, shop, `products/${sid}.json`))?.product;
  const after = auditListingAltHealth(afterProd?.images || [], { primaryView: PRIMARY_VIEW });
  if (remap.after) {
    after.frontMislabeled = remap.after.frontMislabeled;
    after.sizeMismatches = remap.after.sizeMismatches;
    after.ok = after.ok && remap.after.frontMislabeled === 0 && remap.after.missingAlt === 0;
    if (remap.after.frontMislabeled > 0 && !after.issues.some((i) => String(i).startsWith("front_mislabeled"))) {
      after.issues.push(`front_mislabeled:${remap.after.frontMislabeled}`);
    }
  }

  const rateLimited =
    (steps.some((s) => s?.rate_limited && (s?.remaining > 0 || s?.success === false)) ||
      !!(remap.rate_limited && remap.ok === false));
  const repaired = !before.ok && (after.ok || after.frontMislabeled < before.frontMislabeled || after.featured_ok);
  const ok =
    after.featured_ok &&
    after.frontMislabeled === 0 &&
    after.missingAlt === 0 &&
    after.unstructured === 0 &&
    !rateLimited;

  let message = "Alt texts and preview image are already correct.";
  if (!before.ok && ok) {
    message = "Checked and repaired alt texts; featured preview is the primary front image.";
  } else if (!ok) {
    message = after.issues.join(" · ") || "Alt text check found remaining issues.";
  }

  return {
    ok,
    repaired,
    rate_limited: rateLimited,
    error: rateLimited ? "Shopify API error: 429 rate limited — resume remaining images" : undefined,
    message,
    shopify_product_id: sid,
    printify_product_id: printifyId || null,
    product_key: productKey || null,
    published_design_id: publishedDesignId,
    before,
    after,
    steps,
    after_images: (afterProd?.images || []).map((img) => ({
      id: img.id,
      src: img.src,
      alt: img.alt,
      position: img.position,
    })),
  };
}

export async function handleAdminCreationsFixAltTexts(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const gate = await requireAdmin(request, env);
  if (!gate.ok) return json({ ok: false, error: gate.error || "forbidden", reason: gate.reason }, gate.status || 403, cors);
  const owner_id = gate.owner_id;

  const body = await request.json().catch(() => ({}));
  const result = await runFixAltTextsForShopifyProduct(env, body);
  if (result.error === "missing_shopify_product_id") {
    return json({ ok: false, error: result.error }, 400, cors);
  }
  if (result.error === "shopify_product_missing") {
    return json({ ok: false, error: result.error }, 404, cors);
  }
  if (result.error) {
    return json({ ok: false, error: result.error }, 502, cors);
  }

  let amazon = { skipped: true, reason: "not_requested" };
  if (body.include_amazon !== false) {
    try {
      const { syncAmazonListingImagesFromShopify } = await import("../../amazon/syncAmazonListingImagesFromShopify.js");
      amazon = await syncAmazonListingImagesFromShopify(env, {
        publishedDesignId: result.published_design_id,
        productKey: result.product_key,
        images: result.after_images,
      });
    } catch (e) {
      amazon = { ok: false, skipped: false, error: e?.message || String(e) };
    }
  }

  try {
    const { recordProductMaintenanceLog } = await import("../admin/adminJobLogs.js");
    await recordProductMaintenanceLog(env, {
      type: "shopify_alt_text",
      status: result.ok ? "completed" : "failed",
      source: "admin",
      title: result.product_key || result.shopify_product_id,
      product_key: result.product_key,
      design_id: body.design_id,
      shopify_product_id: result.shopify_product_id,
      printify_product_id: result.printify_product_id,
      published_design_id: result.published_design_id,
      error: result.ok ? null : String(result.message || "Alt text repair failed"),
      started_at: Date.now(),
      completed_at: Date.now(),
    });
  } catch (_) {}

  const { after_images: _omit, ...publicResult } = result;
  return json({ ...publicResult, amazon }, 200, cors);
}
