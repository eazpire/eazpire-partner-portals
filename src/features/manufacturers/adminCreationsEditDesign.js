/**
 * Admin Creations → Product Modal → Edit Design
 *
 * GET  ?op=admin-creations-edit-design&shopify_product_id=
 * POST ?op=admin-creations-edit-design-save
 * POST ?op=admin-creations-edit-design-update
 *
 * Save → D1 draft only. Update → Printify print_areas + Shopify publish refresh.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import {
  getPrintifyProduct,
  getPrintifyUploadedImage,
  putProductPrintAreasFullMerge,
  publishPrintifyProduct,
} from "../../utils/printify.js";
import { shopifyAPI } from "../../utils/shopify.js";
import { shopDomainFromEnv, normalizeShopifyProductId } from "./adminCreationsShopifyList.js";
import { buildSortedMockups } from "./adminCreationsShopifyProductDetail.js";
import { extractCreatorDesignPlacementFromPrintifyProduct } from "../admin/adminTestPrintifyProducts.js";
import {
  patchStudioDesignPlacementOnly,
  pickStudioDesignImageIdForTargetView,
  placeholderMatchesStudioTarget,
  sanitizeStudioPrintAreasForPrintifyApi,
} from "../shop/studioPrintAreaPlacement.js";

const DEFAULT_ZONE = { l: 0.28, t: 0.22, w: 0.44, h: 0.48 };
const POSITIONS = ["front", "back"];

function nowIso() {
  return new Date().toISOString();
}

function clamp01(n, fallback = 0.5) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function normalizePlacement(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const scaleRaw = Number(src.scale);
  return {
    x: clamp01(src.x, 0.5),
    y: clamp01(src.y, 0.5),
    scale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? Math.min(4, Math.max(0.05, scaleRaw)) : 0.95,
    angle: Number.isFinite(Number(src.angle))
      ? Number(src.angle)
      : Number.isFinite(Number(src.rotate))
        ? Number(src.rotate)
        : 0,
  };
}

function normalizePlacementsMap(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const pos of POSITIONS) {
    if (src[pos] != null) out[pos] = normalizePlacement(src[pos]);
  }
  return out;
}

function printifyImageSrc(im) {
  if (!im || typeof im !== "object") return "";
  const s = im.src ?? im.url ?? im.preview_url ?? im.image_url ?? im.file_url;
  return s != null && String(s).trim() ? String(s).trim() : "";
}

function normView(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

async function ensureDraftTable(env) {
  const db = env.CREATOR_DB;
  if (!db) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_product_design_drafts (
        shopify_product_id TEXT PRIMARY KEY,
        printify_product_id TEXT,
        product_key TEXT,
        placement_json TEXT NOT NULL,
        saved_at TEXT,
        synced_at TEXT,
        updated_at TEXT
      )`
    )
    .run();
}

async function loadDraft(env, shopifyProductId) {
  await ensureDraftTable(env);
  const row = await env.CREATOR_DB.prepare(
    `SELECT shopify_product_id, printify_product_id, product_key, placement_json, saved_at, synced_at, updated_at
     FROM admin_product_design_drafts WHERE shopify_product_id = ? LIMIT 1`
  )
    .bind(String(shopifyProductId))
    .first();
  if (!row) return null;
  let placements = {};
  try {
    placements = normalizePlacementsMap(JSON.parse(row.placement_json || "{}"));
  } catch {
    placements = {};
  }
  return {
    shopify_product_id: String(row.shopify_product_id),
    printify_product_id: row.printify_product_id || null,
    product_key: row.product_key || null,
    placements,
    saved_at: row.saved_at || null,
    synced_at: row.synced_at || null,
    updated_at: row.updated_at || null,
  };
}

function draftPendingUpdate(draft) {
  if (!draft?.saved_at) return false;
  if (!draft.synced_at) return true;
  return String(draft.saved_at) > String(draft.synced_at);
}

async function resolvePublishedRow(env, shopifyProductId) {
  const db = env.CREATOR_DB;
  if (!db) return null;
  const sid = String(shopifyProductId);
  let entry = await db
    .prepare(
      `SELECT pd.id, pd.printify_product_id, pd.product_key, pd.design_id, pd.shopify_product_id,
              c.preview_url AS design_preview_url, c.original_url AS design_original_url
       FROM published_designs pd
       LEFT JOIN creations c ON c.id = pd.design_id
       WHERE pd.shopify_product_id = ? OR pd.shopify_product_id = ?
       ORDER BY pd.id DESC LIMIT 1`
    )
    .bind(sid, `gid://shopify/Product/${sid}`)
    .first();
  if (!entry) {
    entry = await db
      .prepare(
        `SELECT pd.id, pd.printify_product_id, pd.product_key, pd.design_id, pd.shopify_product_id,
                c.preview_url AS design_preview_url, c.original_url AS design_original_url
         FROM published_designs pd
         LEFT JOIN creations c ON c.id = pd.design_id
         WHERE CAST(pd.shopify_product_id AS TEXT) LIKE ?
         ORDER BY pd.id DESC LIMIT 1`
      )
      .bind(`%${sid}`)
      .first();
  }
  return entry || null;
}

async function loadZoneForProductKey(env, productKey) {
  const pk = String(productKey || "").trim();
  if (!pk || !env.CATALOG_DB) return { ...DEFAULT_ZONE };
  try {
    const row = await env.CATALOG_DB.prepare(
      `SELECT placement_print_area_json FROM design_studio_settings WHERE product_key = ? LIMIT 1`
    )
      .bind(pk)
      .first();
    if (row?.placement_print_area_json) {
      const parsed = JSON.parse(row.placement_print_area_json);
      const z = parsed?.zone || parsed?.zone_frac || parsed;
      const l = Number(z?.l ?? z?.left);
      const t = Number(z?.t ?? z?.top);
      const w = Number(z?.w ?? z?.width);
      const h = Number(z?.h ?? z?.height);
      if ([l, t, w, h].every((n) => Number.isFinite(n))) {
        return { l, t, w, h };
      }
    }
  } catch {
    /* default */
  }
  return { ...DEFAULT_ZONE };
}

function pickMockUrl(mockups, printifyImages, position) {
  const want = normView(position);
  const fromShopify = (Array.isArray(mockups) ? mockups : []).find((m) => {
    const v = normView(m?.view);
    return v === want || v.startsWith(`${want}_`);
  });
  if (fromShopify?.src) return String(fromShopify.src);

  const images = Array.isArray(printifyImages) ? printifyImages : [];
  const hit = images.find((im) => normView(im?.position) === want && printifyImageSrc(im));
  if (printifyImageSrc(hit)) return printifyImageSrc(hit);
  if (want === "front") {
    const any = images.find((im) => printifyImageSrc(im));
    if (printifyImageSrc(any)) return printifyImageSrc(any);
  }
  return "";
}

async function resolveDesignUrl(env, published, printifyProduct, positions) {
  const fromCreation = String(published?.design_original_url || published?.design_preview_url || "").trim();
  if (fromCreation) return fromCreation;

  for (const pos of positions) {
    const extracted = await extractCreatorDesignPlacementFromPrintifyProduct(printifyProduct, pos);
    const imageId = extracted?.image_id;
    if (!imageId) continue;
    try {
      const meta = await getPrintifyUploadedImage(env, imageId);
      const url =
        meta?.preview_url || meta?.previewUrl || meta?.url || meta?.src || meta?.image_url || "";
      if (url) return String(url);
    } catch {
      /* try next */
    }
  }
  return "";
}

async function buildEditDesignPayload(env, shopifyProductId) {
  const sid = normalizeShopifyProductId(shopifyProductId) || String(shopifyProductId || "").trim();
  if (!sid) {
    return { ok: false, error: "shopify_product_id_required", status: 400 };
  }
  if (!env.CREATOR_DB) {
    return { ok: false, error: "database_unavailable", status: 503 };
  }

  const published = await resolvePublishedRow(env, sid);
  let printifyProductId = String(published?.printify_product_id || "").trim();
  let productKey = String(published?.product_key || "").trim();

  const domain = shopDomainFromEnv(env);
  let shopifyMockups = [];
  try {
    if (domain) {
      const product = await shopifyAPI(env, domain, `products/${sid}.json`, { method: "GET" });
      const p = product?.product || product;
      shopifyMockups = buildSortedMockups(p?.images || []);
      if (!productKey) {
        // Fallback: custom.product_key metafield often set on listing
        try {
          const mf = await shopifyAPI(env, domain, `products/${sid}/metafields.json?limit=250`, {
            method: "GET",
          });
          const rows = Array.isArray(mf?.metafields) ? mf.metafields : [];
          const pkMf = rows.find((m) => m.namespace === "custom" && m.key === "product_key");
          if (pkMf?.value) productKey = String(pkMf.value).trim();
          const pidMf = rows.find(
            (m) =>
              (m.namespace === "custom" && m.key === "printify_product_id") ||
              (m.namespace === "printify" && m.key === "product_id")
          );
          if (!printifyProductId && pidMf?.value) printifyProductId = String(pidMf.value).trim();
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e) {
    console.warn("[admin-creations-edit-design] shopify product:", e?.message || e);
  }

  if (!printifyProductId) {
    return {
      ok: false,
      error: "printify_product_not_linked",
      message:
        "No Printify product linked to this Shopify listing. Publish via Printify first, then edit design.",
      status: 404,
    };
  }

  let printifyProduct = null;
  try {
    printifyProduct = await getPrintifyProduct(env, printifyProductId);
  } catch (e) {
    console.warn("[admin-creations-edit-design] printify fetch:", e?.message || e);
  }
  if (!printifyProduct) {
    return {
      ok: false,
      error: "printify_product_not_found",
      message: `Printify product ${printifyProductId} not found.`,
      status: 404,
    };
  }

  const zone = await loadZoneForProductKey(env, productKey);
  const livePlacements = {};
  const availablePositions = [];
  for (const pos of POSITIONS) {
    const extracted = await extractCreatorDesignPlacementFromPrintifyProduct(printifyProduct, pos);
    const mockUrl = pickMockUrl(shopifyMockups, printifyProduct.images, pos);
    if (extracted?.placement || mockUrl) {
      availablePositions.push(pos);
    }
    if (extracted?.placement) {
      livePlacements[pos] = normalizePlacement(extracted.placement);
    }
  }
  if (!availablePositions.length) availablePositions.push("front");
  if (!livePlacements.front) livePlacements.front = normalizePlacement({ x: 0.5, y: 0.5, scale: 0.95 });

  const draft = await loadDraft(env, sid);
  const designUrl = await resolveDesignUrl(env, published, printifyProduct, availablePositions);
  const designImageId =
    pickStudioDesignImageIdForTargetView(printifyProduct.print_areas, "front") ||
    pickStudioDesignImageIdForTargetView(printifyProduct.print_areas, "back") ||
    null;

  const views = {};
  for (const pos of availablePositions) {
    views[pos] = {
      mock_url: pickMockUrl(shopifyMockups, printifyProduct.images, pos) || null,
      zone,
      live_placement: livePlacements[pos] || null,
      draft_placement: draft?.placements?.[pos] || null,
    };
  }

  return {
    ok: true,
    edit_design: {
      shopify_product_id: sid,
      printify_product_id: printifyProductId,
      product_key: productKey || null,
      published_design_id: published?.id != null ? Number(published.id) : null,
      design_id: published?.design_id || null,
      design_url: designUrl || null,
      design_image_id: designImageId,
      positions: availablePositions,
      views,
      live_placements: livePlacements,
      draft: draft
        ? {
            placements: draft.placements,
            saved_at: draft.saved_at,
            synced_at: draft.synced_at,
            pending_update: draftPendingUpdate(draft),
          }
        : null,
      pending_update: draftPendingUpdate(draft),
    },
  };
}

export async function handleAdminCreationsEditDesignGet(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const url = new URL(request.url);
  const shopifyProductId =
    url.searchParams.get("shopify_product_id") || url.searchParams.get("product_id") || "";

  try {
    const result = await buildEditDesignPayload(env, shopifyProductId);
    if (!result.ok) {
      return json(
        { ok: false, error: result.error, message: result.message || result.error },
        result.status || 400,
        cors
      );
    }
    return json(result, 200, cors);
  } catch (err) {
    console.error("[admin-creations-edit-design]", err);
    return json(
      { ok: false, error: "edit_design_failed", message: err?.message || String(err) },
      500,
      cors
    );
  }
}

export async function handleAdminCreationsEditDesignSave(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  if (!env.CREATOR_DB) return json({ ok: false, error: "database_unavailable" }, 503, cors);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sid =
    normalizeShopifyProductId(body.shopify_product_id || body.product_id) ||
    String(body.shopify_product_id || body.product_id || "").trim();
  if (!sid) return json({ ok: false, error: "shopify_product_id_required" }, 400, cors);

  const placements = normalizePlacementsMap(body.placements || body.placement || {});
  if (!Object.keys(placements).length) {
    return json({ ok: false, error: "placements_required" }, 400, cors);
  }

  try {
    const context = await buildEditDesignPayload(env, sid);
    if (!context.ok) {
      return json(
        { ok: false, error: context.error, message: context.message || context.error },
        context.status || 400,
        cors
      );
    }
    const ed = context.edit_design;
    const merged = { ...(ed.live_placements || {}), ...placements };
    const savedAt = nowIso();
    const existing = await loadDraft(env, sid);
    await ensureDraftTable(env);
    await env.CREATOR_DB.prepare(
      `INSERT INTO admin_product_design_drafts
        (shopify_product_id, printify_product_id, product_key, placement_json, saved_at, synced_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shopify_product_id) DO UPDATE SET
         printify_product_id = excluded.printify_product_id,
         product_key = excluded.product_key,
         placement_json = excluded.placement_json,
         saved_at = excluded.saved_at,
         updated_at = excluded.updated_at`
    )
      .bind(
        sid,
        ed.printify_product_id || null,
        ed.product_key || null,
        JSON.stringify(merged),
        savedAt,
        existing?.synced_at || null,
        savedAt
      )
      .run();

    const draft = await loadDraft(env, sid);
    return json(
      {
        ok: true,
        draft: {
          placements: draft.placements,
          saved_at: draft.saved_at,
          synced_at: draft.synced_at,
          pending_update: draftPendingUpdate(draft),
        },
        pending_update: draftPendingUpdate(draft),
      },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-edit-design-save]", err);
    return json(
      { ok: false, error: "save_failed", message: err?.message || String(err) },
      500,
      cors
    );
  }
}

export async function handleAdminCreationsEditDesignUpdate(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  if (!env.CREATOR_DB) return json({ ok: false, error: "database_unavailable" }, 503, cors);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sid =
    normalizeShopifyProductId(body.shopify_product_id || body.product_id) ||
    String(body.shopify_product_id || body.product_id || "").trim();
  if (!sid) return json({ ok: false, error: "shopify_product_id_required" }, 400, cors);

  try {
    const draft = await loadDraft(env, sid);
    if (!draft?.saved_at || !Object.keys(draft.placements || {}).length) {
      return json(
        {
          ok: false,
          error: "no_saved_draft",
          message: "Save design placement to the database before Update.",
        },
        400,
        cors
      );
    }
    if (!draftPendingUpdate(draft)) {
      return json(
        {
          ok: false,
          error: "already_synced",
          message: "Saved placement is already pushed to Printify/Shopify.",
        },
        400,
        cors
      );
    }

    const context = await buildEditDesignPayload(env, sid);
    if (!context.ok) {
      return json(
        { ok: false, error: context.error, message: context.message || context.error },
        context.status || 400,
        cors
      );
    }
    const ed = context.edit_design;
    const printifyProductId = ed.printify_product_id;
    const product = await getPrintifyProduct(env, printifyProductId);
    if (!product?.print_areas?.length) {
      return json({ ok: false, error: "missing_print_areas" }, 400, cors);
    }

    let areas = product.print_areas;
    const placements = draft.placements;
    for (const [pos, placement] of Object.entries(placements)) {
      const designId =
        pickStudioDesignImageIdForTargetView(areas, pos) ||
        ed.design_image_id ||
        pickStudioDesignImageIdForTargetView(product.print_areas, pos);
      if (!designId) {
        console.warn("[admin-creations-edit-design-update] no design image for", pos);
        continue;
      }
      areas = patchStudioDesignPlacementOnly(
        areas,
        placement,
        pos,
        designId,
        placeholderMatchesStudioTarget
      );
    }
    areas = sanitizeStudioPrintAreasForPrintifyApi(areas);
    await putProductPrintAreasFullMerge(env, printifyProductId, areas);

    let publishResult = null;
    try {
      publishResult = await publishPrintifyProduct(
        env,
        printifyProductId,
        { title: true, description: true, images: true, variants: true, tags: true },
        {
          productKey: ed.product_key || undefined,
          skipMockupGeneration: true,
        }
      );
    } catch (pubErr) {
      console.warn("[admin-creations-edit-design-update] shopify publish:", pubErr?.message || pubErr);
      return json(
        {
          ok: false,
          error: "printify_ok_shopify_publish_failed",
          message:
            pubErr?.message ||
            "Printify placement updated, but Shopify publish/refresh failed. Retry Update.",
          printify_product_id: printifyProductId,
        },
        502,
        cors
      );
    }

    const syncedAt = nowIso();
    await ensureDraftTable(env);
    await env.CREATOR_DB.prepare(
      `UPDATE admin_product_design_drafts
       SET synced_at = ?, updated_at = ?, printify_product_id = ?, product_key = ?
       WHERE shopify_product_id = ?`
    )
      .bind(syncedAt, syncedAt, printifyProductId, ed.product_key || null, sid)
      .run();

    const refreshed = await loadDraft(env, sid);
    return json(
      {
        ok: true,
        printify_product_id: printifyProductId,
        publish: publishResult || null,
        draft: refreshed
          ? {
              placements: refreshed.placements,
              saved_at: refreshed.saved_at,
              synced_at: refreshed.synced_at,
              pending_update: draftPendingUpdate(refreshed),
            }
          : null,
        pending_update: false,
      },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-edit-design-update]", err);
    return json(
      { ok: false, error: "update_failed", message: err?.message || String(err) },
      500,
      cors
    );
  }
}
