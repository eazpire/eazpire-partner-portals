/**
 * Disable one color across all sizes of a live Printify listing, then sync Shopify/Amazon.
 * POST ?op=admin-creations-remove-color-variant
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getPrintifyProduct } from "../../utils/printify.js";

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
  let enabledOfColor = 0;
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
      if (v?.is_enabled !== false) enabledOfColor += 1;
    } else if (keepEnabled) {
      remaining += 1;
    }
  }
  return { variantsMap: map, disabled, remaining, disabledIds, matched: disabled > 0, enabledOfColor };
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

function buildPrintifyEnabledPayload(product, variantsMap) {
  return (product?.variants || []).map((v) => {
    const row = variantsMap[String(v.id)];
    const price = typeof v.price === "string" ? parseInt(v.price, 10) : v.price;
    return {
      id: v.id,
      price,
      is_enabled: row ? row.enabled !== false : v.is_enabled !== false,
    };
  });
}

async function putPrintifyEnabledFlags(env, printifyProductId, product, variantsMap) {
  const shopId = String(env.PRINTIFY_SHOP_ID || "").trim();
  if (!env.PRINTIFY_API_KEY || !shopId) throw new Error("Printify is not configured");
  const res = await fetch(
    `https://api.printify.com/v1/shops/${shopId}/products/${encodeURIComponent(printifyProductId)}.json`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ variants: buildPrintifyEnabledPayload(product, variantsMap) }),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined,
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Printify update failed: ${res.status} ${String(text).slice(0, 180)}`);
  }
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
    if (plan.matched && plan.remaining < 1 && plan.enabledOfColor > 0) {
      return json({ ok: false, error: "last_color_blocked", color }, 400, cors);
    }

    const { deleteShopifyVariantsByColor } = await import("./removeShopifyColorVariants.js");
    const shopifyAlreadyGone = async () => {
      const removed = await deleteShopifyVariantsByColor(env, shopifyProductId, color);
      return removed;
    };

    // Color already off in Printify: only clean leftover Shopify SKUs. Never re-PUT 400+ variants.
    if (!plan.matched || plan.enabledOfColor === 0) {
      const removed = await shopifyAlreadyGone();
      if (removed.remaining > 0) {
        return json(
          {
            ok: false,
            error: "shopify_delete_incomplete",
            message: `Shopify still has ${removed.remaining} ${color} variant(s)`,
          },
          500,
          cors
        );
      }
      return json(
        {
          ok: true,
          already_removed: true,
          color,
          shopify_deleted: removed.deleted || 0,
        },
        200,
        cors
      );
    }

    const sessionId = `remove-color-${shopifyProductId}-${Date.now()}`;
    const progressKey = `publish:${sessionId}`;
    const channels = ["printify", "shopify"];
    const initialProgress = {
      session_id: sessionId,
      done: false,
      has_error: false,
      publish_source: "admin-variant-update",
      shopify_product_id: shopifyProductId,
      product_key: productKey,
      started_at: Date.now(),
      updated_at: Date.now(),
      products: channels.map((ch) => ({
        product_key: productKey,
        channel: ch,
        channel_label: ch === "printify" ? "Printify" : "Shopify",
        status: "pending",
        progress: 0,
        message: "Waiting…",
      })),
    };
    if (env.JOBS) await env.JOBS.put(progressKey, JSON.stringify(initialProgress));

    const work = (async () => {
      const patch = async (index, status, progress, message) => {
        if (!env.JOBS) return;
        const cur = JSON.parse((await env.JOBS.get(progressKey)) || "{}");
        if (!cur.products?.[index]) return;
        cur.products[index] = { ...cur.products[index], status, progress, message };
        cur.updated_at = Date.now();
        await env.JOBS.put(progressKey, JSON.stringify(cur));
      };
      try {
        await patch(0, "running", 20, `Disabling ${color} on Printify…`);
        await putPrintifyEnabledFlags(env, printifyProductId, product, plan.variantsMap);
        await patch(0, "completed", 100, `${plan.enabledOfColor} variant(s) disabled`);
        await patch(1, "running", 60, `Removing ${color} from Shopify…`);
        const removed = await shopifyAlreadyGone();
        if (removed.remaining > 0) {
          throw new Error(`Shopify still has ${removed.remaining} ${color} variant(s)`);
        }
        await patch(1, "completed", 100, removed.deleted ? `Removed ${removed.deleted} Shopify variant(s)` : "Shopify already in sync");
        if (env.JOBS) {
          const cur = JSON.parse((await env.JOBS.get(progressKey)) || "{}");
          cur.done = true;
          cur.has_error = false;
          cur.updated_at = Date.now();
          await env.JOBS.put(progressKey, JSON.stringify(cur));
        }
      } catch (err) {
        const message = err?.message || String(err);
        console.error("[admin-creations-remove-color-variant] background", message);
        if (env.JOBS) {
          const cur = JSON.parse((await env.JOBS.get(progressKey)) || "{}");
          const running = (cur.products || []).findIndex((p) => p.status === "running" || p.status === "pending");
          const idx = running >= 0 ? running : 0;
          if (cur.products?.[idx]) {
            cur.products[idx] = { ...cur.products[idx], status: "error", progress: 0, message };
          }
          cur.done = true;
          cur.has_error = true;
          cur.updated_at = Date.now();
          await env.JOBS.put(progressKey, JSON.stringify(cur));
        }
      }
    })();

    if (ctx?.waitUntil) {
      ctx.waitUntil(work);
      return json(
        {
          ok: true,
          session_id: sessionId,
          started: true,
          color,
          printify_disabled: plan.enabledOfColor,
        },
        202,
        cors
      );
    }

    await work;
    const progress = env.JOBS ? JSON.parse((await env.JOBS.get(progressKey)) || "{}") : {};
    if (progress.has_error) {
      const failed = (progress.products || []).find((p) => p.status === "error");
      return json(
        { ok: false, error: "variant_update_failed", message: failed?.message || "Remove variant failed", session_id: sessionId },
        500,
        cors
      );
    }
    return json({ ok: true, session_id: sessionId, color }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-remove-color-variant]", err);
    return json({ ok: false, error: err?.message || "internal_error" }, 500, cors);
  }
}
