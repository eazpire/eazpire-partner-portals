/**
 * Disable one color across all sizes of a live Printify listing, then sync Shopify/Amazon.
 * POST ?op=admin-creations-remove-color-variant
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getPrintifyProduct } from "../../utils/printify.js";
import { handleAdminCreationsProductVariantUpdate } from "./adminCreationsProductVariantUpdate.js";

export function normalizeColorLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function resolveColorOptionIndex(product) {
  const opts = product?.options || [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (!o) continue;
    const n = String(o.name || "").toLowerCase();
    if (o.type === "color" || n === "color" || n === "colors") return i;
  }
  return -1;
}

export function colorTitleForVariant(product, variant, colorIdx) {
  if (colorIdx >= 0) {
    const colorOpt = product?.options?.[colorIdx];
    const arr = Array.isArray(variant?.options) ? variant.options : [];
    const cId = arr[colorIdx];
    const cv = (colorOpt?.values || []).find((v) => String(v.id) === String(cId) || String(v.title) === String(cId));
    if (cv?.title) return String(cv.title).trim();
  }
  const title = String(variant?.title || "");
  const slash = title.indexOf("/");
  return (slash >= 0 ? title.slice(0, slash) : title).trim();
}

export function buildVariantsMapDisablingColor(product, colorLabel) {
  const want = normalizeColorLabel(colorLabel);
  const colorIdx = resolveColorOptionIndex(product);
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const map = {};
  let disabled = 0;
  let remaining = 0;
  const disabledIds = [];
  for (const v of variants) {
    const id = Number(v?.id);
    if (!Number.isFinite(id)) continue;
    const color = normalizeColorLabel(colorTitleForVariant(product, v, colorIdx));
    const disable = color === want;
    const keepEnabled = !disable && v?.is_enabled !== false;
    map[String(id)] = { enabled: keepEnabled };
    if (disable) {
      disabled += 1;
      disabledIds.push(id);
    } else if (keepEnabled) {
      remaining += 1;
    }
  }
  return { variantsMap: map, disabled, remaining, disabledIds, matched: disabled > 0 };
}

export function channelsForRemoveColorVariant(item) {
  const channels = [];
  if (String(item?.printify_product_id || "").trim()) channels.push("printify");
  if (String(item?.shopify_product_id || item?.id || "").replace(/\D/g, "")) channels.push("shopify");
  if (item?.amazon_eu_listed || item?.amazon_de_listed || (item?.channel_keys || []).includes("amazon_eu")) {
    channels.push("amazon_europa");
  }
  if (item?.amazon_us_listed || (item?.channel_keys || []).includes("amazon_us")) {
    channels.push("amazon_amerika");
  }
  return [...new Set(channels)];
}

function mockRequest(body) {
  return {
    method: "POST",
    url: "https://local/apps/creator-dispatch?op=admin-creations-product-variant-update",
    headers: new Headers({ "Content-Type": "application/json", origin: "https://admin.eazpire.com" }),
    json: async () => body,
  };
}

export async function handleAdminCreationsRemoveColorVariant(request, env, ctx) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  try {
    const body = await request.json().catch(() => ({}));
    const color = String(body.color || body.color_label || "").trim();
    const printifyProductId = String(body.printify_product_id || "").trim();
    const shopifyProductId = String(body.shopify_product_id || "").trim();
    const productKey = String(body.product_key || "").trim();
    if (!color) return json({ ok: false, error: "color_required" }, 400, cors);
    if (!printifyProductId) return json({ ok: false, error: "printify_product_id_required" }, 400, cors);
    if (!shopifyProductId) return json({ ok: false, error: "shopify_product_id_required" }, 400, cors);
    if (!productKey) return json({ ok: false, error: "product_key_required" }, 400, cors);

    const product = await getPrintifyProduct(env, printifyProductId);
    if (!product) return json({ ok: false, error: "printify_product_missing" }, 404, cors);

    const plan = buildVariantsMapDisablingColor(product, color);
    if (!plan.matched) {
      return json({ ok: false, error: "color_not_on_product", color }, 400, cors);
    }
    if (plan.remaining < 1) {
      return json({ ok: false, error: "last_color_blocked", color }, 400, cors);
    }

    const channels = Array.isArray(body.channels) && body.channels.length
      ? body.channels.map((c) => String(c || "").trim()).filter(Boolean)
      : channelsForRemoveColorVariant({
          ...body,
          printify_product_id: printifyProductId,
          shopify_product_id: shopifyProductId,
        });

    const updateReq = mockRequest({
      shopify_product_id: shopifyProductId,
      product_key: productKey,
      print_provider_id: Number(body.print_provider_id || product.print_provider_id || 0) || product.print_provider_id,
      printify_product_id: printifyProductId,
      design_id: body.design_id ?? null,
      published_design_id: body.published_design_id ?? null,
      product_title: body.product_title || product.title || null,
      owner_id: body.owner_id || "admin",
      variants: plan.variantsMap,
      existing_config: body.existing_config || null,
      channels,
      mock_slides: Array.isArray(body.mock_slides) ? body.mock_slides : [],
    });

    return handleAdminCreationsProductVariantUpdate(updateReq, env, ctx);
  } catch (err) {
    console.error("[admin-creations-remove-color-variant]", err);
    return json({ ok: false, error: err?.message || "internal_error" }, 500, cors);
  }
}
