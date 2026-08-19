/**
 * Admin Creations — update product variant selection across live channels.
 * POST ?op=admin-creations-product-variant-update
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { syncVariantConfigToCatalog } from "../admin/adminProducts.js";
import { handleUpdateProductVariants } from "../product/updateProductVariants.js";
import { updateProductProgress, getProgressForSession } from "../publish/progress.js";
import { upsertPublishActiveSession, deletePublishActiveSession } from "../publish/publishActiveSessions.js";

const MAX_ENABLED = 100;

function generateSessionId(shopifyProductId) {
  return `variant-update-${shopifyProductId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function channelLabel(channelId) {
  const map = {
    printify: "Printify",
    shopify: "Shopify",
    amazon_europa: "Amazon Europa",
    amazon_amerika: "Amazon USA",
  };
  return map[channelId] || channelId;
}

async function initializeVariantUpdateProgress(env, {
  sessionId,
  designId,
  ownerId,
  productTitle,
  shopifyProductId,
  productKey,
  channels,
  mockSlides,
}) {
  const progressKey = `publish:${sessionId}`;
  const initialProgress = {
    session_id: sessionId,
    design_id: designId || 0,
    design_title: productTitle || null,
    owner_id: ownerId || "admin",
    shopify_product_id: shopifyProductId,
    product_key: productKey,
    started_at: Date.now(),
    updated_at: Date.now(),
    done: false,
    publish_source: "admin-variant-update",
    mock_slides: Array.isArray(mockSlides) ? mockSlides : [],
    products: channels.map((ch) => ({
      product_key: productKey,
      channel: ch,
      channel_label: channelLabel(ch),
      status: "pending",
      progress: 0,
      message: "Waiting…",
    })),
  };

  if (env.JOBS) {
    await env.JOBS.put(progressKey, JSON.stringify(initialProgress));
  }

  if (designId && ownerId) {
    await upsertPublishActiveSession(env, {
      sessionId,
      designId,
      ownerId,
      designTitle: productTitle || null,
      productKeys: [productKey],
    });
  }

  return { progressKey, initialProgress };
}

async function markChannelProgress(env, progressKey, channelIndex, status, progress, message, mergeExtra) {
  await updateProductProgress(env, progressKey, channelIndex, status, progress, message, mergeExtra);
}

function buildVariantsPayload(variantsMap) {
  const out = [];
  for (const [id, row] of Object.entries(variantsMap || {})) {
    const vid = Number(id);
    if (!Number.isFinite(vid)) continue;
    out.push({ id: vid, is_enabled: row?.enabled !== false });
  }
  return out;
}

function buildConfigFromVariantsMap(variantsMap, existingConfig) {
  const base = existingConfig && typeof existingConfig === "object" ? existingConfig : {};
  const variants = { ...(base.variants || {}) };
  for (const [id, row] of Object.entries(variantsMap || {})) {
    variants[String(id)] = {
      ...(variants[String(id)] || {}),
      enabled: row?.enabled !== false,
    };
  }
  return {
    global: base.global || { profit_mode: "percent", profit_value: 0, branding: "none" },
    variants,
  };
}

async function processVariantUpdate(env, ctx, {
  progressKey,
  sessionId,
  channels,
  productKey,
  printProviderId,
  printifyProductId,
  designId,
  variantsMap,
  existingConfig,
  shopifyProductId,
  publishedDesignId,
  removeColor,
}) {
  const config = buildConfigFromVariantsMap(variantsMap, existingConfig);
  const enabledCount = Object.values(config.variants).filter((v) => v.enabled !== false).length;

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    try {
      await markChannelProgress(env, progressKey, i, "running", 10, `Updating ${channelLabel(ch)}…`);

      if (ch === "printify") {
        if (!printifyProductId || !printProviderId) {
          throw new Error("Printify product not linked");
        }
        if (env.CATALOG_DB && env.CREATOR_DB) {
          await syncVariantConfigToCatalog(env, productKey, printProviderId, config);
          const now = Date.now();
          await env.CREATOR_DB.prepare(
            `INSERT INTO product_variant_config
              (product_key, print_provider_id, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(product_key, print_provider_id) DO UPDATE SET
               config_json = excluded.config_json,
               updated_at = excluded.updated_at`
          )
            .bind(productKey, printProviderId, JSON.stringify(config), now, now)
            .run();
        }

        const variantsPayload = buildVariantsPayload(variantsMap);
        if (variantsPayload.length) {
          // Do not call align_publish here — that re-applies catalog colors and undoes a remove-color.
          const mockReq = {
            url: new URL("https://local/apps/creator-dispatch?op=update-product-variants"),
            method: "POST",
            headers: new Headers({ "Content-Type": "application/json", origin: "https://admin.eazpire.com" }),
            json: async () => ({
              printify_product_id: printifyProductId,
              variants: variantsPayload,
              create_job: false,
              product_key: productKey,
              design_id: designId || null,
            }),
          };
          const resp = await handleUpdateProductVariants(mockReq, env, ctx);
          const data = await resp.json();
          if (!data.ok) throw new Error(data.message || data.error || "Printify update failed");
        }
        await markChannelProgress(env, progressKey, i, "completed", 100, `${enabledCount} variant(s) updated`);
      } else if (ch === "shopify") {
        await markChannelProgress(env, progressKey, i, "syncing", 60, "Syncing Shopify listing…");
        if (!printifyProductId) throw new Error("Printify product not linked");
        const { publishPrintifyProduct } = await import("../../utils/printify.js");
        await publishPrintifyProduct(
          env,
          printifyProductId,
          { title: false, description: false, images: false, variants: true, tags: false },
          {
            skipMockupGate: true,
            skipPrintifyPrimaryImage: true,
            productKey,
          }
        );
        if (removeColor) {
          await markChannelProgress(env, progressKey, i, "syncing", 80, `Removing ${removeColor} from Shopify…`);
          const { deleteShopifyVariantsByColor } = await import("./removeShopifyColorVariants.js");
          const removed = await deleteShopifyVariantsByColor(env, shopifyProductId, removeColor);
          if (removed.remaining > 0) {
            throw new Error(
              `Shopify still has ${removed.remaining} ${removeColor} variant(s) after delete`
            );
          }
        } else {
          const { ensureShopifyVariantSyncAfterPrintifyPublish } = await import(
            "../publish/ensureShopifyVariantSync.js"
          );
          await ensureShopifyVariantSyncAfterPrintifyPublish(env, {
            printifyProductId: String(printifyProductId),
            shopifyProductId,
            productKey,
            enabledVariantCount: enabledCount,
            pollAttempts: 4,
            pollIntervalMs: 2500,
          });
        }
        await markChannelProgress(env, progressKey, i, "completed", 100, "Shopify variants published");
      } else if (ch === "amazon_europa" || ch === "amazon_amerika") {
        const continent = ch === "amazon_amerika" ? "amerika" : "europa";
        const { handleAdminAmazonPublish } = await import("../product/amazonAdminPublish.js");
        const mockReq = {
          url: new URL("https://local/apps/creator-dispatch?op=admin-amazon-publish"),
          method: "POST",
          headers: new Headers({ "Content-Type": "application/json", origin: "https://admin.eazpire.com" }),
          json: async () => ({
            product_key: productKey,
            shopify_product_id: shopifyProductId,
            published_design_id: publishedDesignId || undefined,
            continents: [continent],
            dry_run: false,
            live_submit: true,
            force: true,
          }),
        };
        const resp = await handleAdminAmazonPublish(mockReq, env, ctx);
        const data = await resp.json();
        if (data && data.ok === false && data.error !== "already_published") {
          throw new Error(data.message || data.error || "Amazon update failed");
        }
        await markChannelProgress(env, progressKey, i, "completed", 100, `Amazon ${continent} update submitted`);
      } else {
        await markChannelProgress(env, progressKey, i, "completed", 100, "Done");
      }
    } catch (err) {
      await markChannelProgress(env, progressKey, i, "error", 0, err?.message || String(err));
    }
  }

  const progress = await getProgressForSession(env, sessionId);
  const allDone = (progress?.products || []).every((p) => p.status === "completed" || p.status === "error");
  const hasError = (progress?.products || []).some((p) => p.status === "error");

  if (progress && env.JOBS) {
    await env.JOBS.put(
      `publish:${sessionId}`,
      JSON.stringify({
        ...progress,
        done: allDone,
        updated_at: Date.now(),
        has_error: hasError,
      })
    );
  }

  if (allDone) {
    await deletePublishActiveSession(env, sessionId);
  }
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {object} [ctx]
 */
export async function handleAdminCreationsProductVariantUpdate(request, env, ctx) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  try {
    const body = await request.json().catch(() => ({}));
    const shopifyProductId = String(body.shopify_product_id || "").trim();
    const productKey = String(body.product_key || "").trim();
    const printProviderId = Number(body.print_provider_id);
    const printifyProductId = String(body.printify_product_id || "").trim() || null;
    const designId = body.design_id != null ? Number(body.design_id) : null;
    const publishedDesignId = body.published_design_id != null ? Number(body.published_design_id) : null;
    const variantsMap = body.variants && typeof body.variants === "object" ? body.variants : {};
    const channels = Array.isArray(body.channels)
      ? body.channels.map((c) => String(c || "").trim()).filter(Boolean)
      : [];
    const existingConfig = body.existing_config || null;
    const productTitle = String(body.product_title || "").trim() || null;
    const mockSlides = Array.isArray(body.mock_slides) ? body.mock_slides : [];
    const ownerId = String(body.owner_id || "admin").trim() || "admin";
    const removeColor = String(body.remove_color || body.color || "").trim() || null;

    if (!shopifyProductId) return json({ ok: false, error: "shopify_product_id_required" }, 400, cors);
    if (!productKey) return json({ ok: false, error: "product_key_required" }, 400, cors);
    if (!channels.length) return json({ ok: false, error: "channels_required" }, 400, cors);

    const enabledCount = Object.values(variantsMap).filter((v) => v?.enabled !== false).length;
    if (enabledCount > MAX_ENABLED) {
      return json({ ok: false, error: `max_${MAX_ENABLED}_variants`, enabled: enabledCount }, 400, cors);
    }

    const sessionId = generateSessionId(shopifyProductId);
    const { progressKey } = await initializeVariantUpdateProgress(env, {
      sessionId,
      designId: designId || publishedDesignId || 0,
      ownerId,
      productTitle,
      shopifyProductId,
      productKey,
      channels,
      mockSlides,
    });

    const waitForResult = body.wait === true || body.await_result === true;
    const work = processVariantUpdate(env, ctx, {
      progressKey,
      sessionId,
      channels,
      productKey,
      printProviderId,
      printifyProductId,
      designId,
      variantsMap,
      existingConfig,
      shopifyProductId,
      publishedDesignId,
      removeColor,
    });

    if (!waitForResult && ctx?.waitUntil) {
      ctx.waitUntil(work);
      return json(
        {
          ok: true,
          session_id: sessionId,
          message: "Variant update started",
        },
        202,
        cors
      );
    }

    await work;
    const progress = await getProgressForSession(env, sessionId);
    const failed = (progress?.products || []).find((p) => p.status === "error");
    if (failed) {
      return json(
        {
          ok: false,
          error: "variant_update_failed",
          message: failed.message || "Variant update failed",
          session_id: sessionId,
          channel: failed.channel || null,
        },
        500,
        cors
      );
    }

    return json(
      {
        ok: true,
        session_id: sessionId,
        message: "Variant update completed",
      },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-product-variant-update]", err);
    return json({ ok: false, error: err?.message || "internal_error" }, 500, cors);
  }
}
