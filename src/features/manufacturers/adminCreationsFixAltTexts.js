/**
 * Admin Creations Products — check + repair Shopify image alt texts and featured preview.
 * POST ?op=admin-creations-fix-alt-texts
 * Body: { shopify_product_id, printify_product_id?, product_key?, design_id? }
 */
import { getAuthUser, isAdminOwner } from "../../utils/auth.js";
import { getCorsHeaders, json } from "../../utils/response.js";
import { shopifyAPI } from "../../utils/shopify.js";
import {
  setImageAltTexts,
  ensureShopifyPrimaryPreview,
  assignVariantFeaturedImagesByPrimaryView,
} from "../publish/setImageAltTexts.js";
import { isClothingListingProduct } from "../publish/shopifyListingSyncFromTemplate.js";
import {
  auditListingAltHealth,
  listingLooksLikeSoftstyleApparel,
  planSoftstyleSizeViewAssignments,
} from "../publish/softstyleSizeAltRepair.js";

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

async function imageBytes(url) {
  try {
    const head = await fetch(url, { method: "HEAD" });
    const fromHead = Number(head.headers.get("content-length") || 0);
    if (fromHead > 0) return fromHead;
    const get = await fetch(url);
    const fromGet = Number(get.headers.get("content-length") || 0);
    if (fromGet > 0) return fromGet;
    const buf = await get.arrayBuffer();
    return buf.byteLength;
  } catch {
    return 0;
  }
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

async function applyAltAssignments(env, shop, sid, assignments, currentById) {
  let updated = 0;
  let errors = 0;
  let skipped = 0;
  for (const [imgId, alt] of assignments) {
    const cur = currentById.get(Number(imgId)) || "";
    if (cur === alt) {
      skipped += 1;
      continue;
    }
    try {
      const r = await fetch(`https://${shop}/admin/api/2024-10/products/${sid}/images/${imgId}.json`, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": env.SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image: { id: imgId, alt } }),
      });
      if (r.ok) updated += 1;
      else errors += 1;
    } catch {
      errors += 1;
    }
    await new Promise((res) => setTimeout(res, 180));
  }
  return { updated, errors, skipped };
}

function attachBytes(images, bytesById) {
  return (images || []).map((img) => ({
    ...img,
    bytes: bytesById.get(Number(img.id)) || 0,
  }));
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

  const images = product.images || [];
  const bytesById = new Map();
  for (const img of images) {
    bytesById.set(Number(img.id), await imageBytes(img.src));
  }
  const withBytes = attachBytes(images, bytesById);
  const before = auditListingAltHealth(withBytes, { primaryView: PRIMARY_VIEW });

  const clothing =
    isClothingListingProduct(product.product_type, productKey) ||
    listingLooksLikeSoftstyleApparel(productKey, product.title, withBytes);
  const mostlyMissing = before.missingAlt > Math.max(2, Math.floor(images.length * 0.25));
  const steps = [];

  // Softstyle CDN: order/URL matching can swap lifestyle/back onto front.
  // Only use it when most alts are missing, or the listing is not apparel.
  if (printifyId && (!clothing || mostlyMissing)) {
    const altRes = await setImageAltTexts(env, printifyId, sid, null, { productKey });
    steps.push({ step: "set_image_alt_texts", ...altRes });
  }

  if (clothing) {
    const afterOrder = (await shopifyAPI(env, shop, `products/${sid}.json`))?.product;
    const fresh = afterOrder?.images || images;
    for (const img of fresh) {
      if (!bytesById.has(Number(img.id))) {
        bytesById.set(Number(img.id), await imageBytes(img.src));
      }
    }
    const planned = planSoftstyleSizeViewAssignments(attachBytes(fresh, bytesById), {
      primaryView: PRIMARY_VIEW,
    });
    const currentById = new Map(fresh.map((img) => [Number(img.id), String(img.alt || "").trim()]));
    const applied = await applyAltAssignments(env, shop, sid, planned, currentById);
    steps.push({ step: "size_view_remap", assigned: planned.size, ...applied });
  }

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
  const afterImages = attachBytes(afterProd?.images || [], bytesById);
  const after = auditListingAltHealth(afterImages, { primaryView: PRIMARY_VIEW });

  const repaired = !before.ok && (after.ok || after.frontMislabeled < before.frontMislabeled || after.featured_ok);
  const ok = after.featured_ok && after.frontMislabeled === 0 && after.missingAlt === 0;

  let message = "Alt texts and preview image are already correct.";
  if (!before.ok && ok) {
    message = "Checked and repaired alt texts; featured preview is the primary front image.";
  } else if (!ok) {
    message = after.issues.join(" · ") || "Alt text check found remaining issues.";
  }

  return {
    ok,
    repaired,
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

  const { owner_id } = await getAuthUser(request, env);
  if (!isAdminOwner(owner_id, env)) return json({ ok: false, error: "forbidden" }, 403, cors);

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

  const { after_images: _omit, ...publicResult } = result;
  return json({ ...publicResult, amazon }, 200, cors);
}
