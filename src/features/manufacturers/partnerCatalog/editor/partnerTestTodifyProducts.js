/**
 * Partner Admin — Todify / direct-Shopify test products (create, list, preview, delete, publish).
 */

import { getCorsHeaders, json } from "../../../../utils/response.js";
import { requireAdminPartnerSession } from "../../rbac.js";
import {
  createTestTodifyProduct,
  ensureTestTodifyTable,
  listTestTodifyProducts,
} from "../../../admin/adminTestTodifyProducts.js";
import { createDirectShopifyListing } from "../../../publish/directShopifyPublish.js";
import { preparePublishImage, parseDesignMetadata, resolvePublishRequestOrigin } from "../../../publish/designLoader.js";
import { loadTemplateMetadata } from "../../../publish/templateLoader.js";
import { savePublishedDesign } from "../../../publish/persistence.js";
import { TODIFY_PROVIDER_DISPLAY_NAME } from "../constants.js";
import { normalizeDesignType } from "../../../admin/designStyleType.js";

export async function handlePartnerTestTodifyCreate(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);

  const body = await request.json().catch(() => ({}));
  const actor = auth.session?.email || auth.email || "partner-admin";
  const randomDesign = body.random_design === true || body.design_id == null;
  return createTestTodifyProduct(env, { ...body, random_design: randomDesign }, actor, cors);
}

export async function handlePartnerTestTodifyList(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  if (!env.CATALOG_DB) return json({ ok: false, error: "database_unavailable" }, 500, cors);

  await ensureTestTodifyTable(env);
  let productKey = "";
  let status = "";
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    productKey = String(body.product_key || "").trim();
    status = String(body.status || "").trim();
  } else {
    const url = new URL(request.url);
    productKey = String(url.searchParams.get("product_key") || "").trim();
    status = String(url.searchParams.get("status") || "").trim();
  }
  if (!productKey) return json({ ok: false, error: "missing_product_key" }, 400, cors);

  const items = await listTestTodifyProducts(env, { productKey, status, limit: 200 });
  return json({ ok: true, items }, 200, cors);
}

export async function handlePartnerTestTodifyPreview(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);

  await ensureTestTodifyTable(env);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return json({ ok: false, error: "invalid_id" }, 400, cors);
  }
  const row = await env.CATALOG_DB.prepare(`SELECT * FROM eaz_test_todify_products WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);

  let design_width = null;
  let design_height = null;
  try {
    const { resolveCreationPixelDimensions } = await import("../../../admin/adminTestPrintifyProducts.js");
    const dims = await resolveCreationPixelDimensions(env, row.design_id);
    if (dims) {
      design_width = dims.width;
      design_height = dims.height;
    }
  } catch {
    /* optional */
  }

  let design_session_placement = null;
  if (row.design_session_placement_json) {
    try {
      design_session_placement = JSON.parse(row.design_session_placement_json);
    } catch {
      design_session_placement = null;
    }
  }

  return json(
    {
      ok: true,
      id: row.id,
      product_key: row.product_key,
      design_id: row.design_id,
      design_preview_url: row.design_preview_url,
      design_placement: design_session_placement,
      design_width,
      design_height,
      thumbnail_url: row.design_preview_url,
      title: row.title,
      status: row.status,
      views_by_color: {},
      colors: [],
    },
    200,
    cors
  );
}

export async function handlePartnerTestTodifyDelete(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  await ensureTestTodifyTable(env);
  const body = await request.json().catch(() => ({}));
  const idsRaw = Array.isArray(body.ids) ? body.ids : body.id != null ? [body.id] : [];
  const ids = [...new Set(idsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return json({ ok: false, error: "invalid_id" }, 400, cors);
  const deleted = [];
  for (const id of ids) {
    await env.CATALOG_DB.prepare(`DELETE FROM eaz_test_todify_products WHERE id = ?`).bind(id).run();
    deleted.push(id);
  }
  return json({ ok: true, deleted_count: deleted.length, deleted }, 200, cors);
}

export async function handlePartnerTestTodifyPublish(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);

  await ensureTestTodifyTable(env);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return json({ ok: false, error: "invalid_id" }, 400, cors);
  }

  const row = await env.CATALOG_DB.prepare(`SELECT * FROM eaz_test_todify_products WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (row.shopify_product_id) {
    return json(
      {
        ok: true,
        already_published: true,
        id,
        shopify_product_id: row.shopify_product_id,
        title: row.title,
      },
      200,
      cors
    );
  }

  const shopRaw = String(env.SHOPIFY_SHOP || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const shopDomain = shopRaw.includes(".") ? shopRaw : shopRaw ? `${shopRaw}.myshopify.com` : "";
  if (!shopDomain) return json({ ok: false, error: "shopify_shop_missing" }, 500, cors);

  const designId = Number(row.design_id);
  const designRow = await env.CREATOR_DB.prepare(`SELECT * FROM creations WHERE id = ?`)
    .bind(designId)
    .first();
  if (!designRow?.owner_id) return json({ ok: false, error: "design_not_found" }, 404, cors);
  const ownerId = String(designRow.owner_id);
  const designMetadata = parseDesignMetadata(designRow);
  designMetadata.design_type = normalizeDesignType(row.design_type || "classic");
  const productName = String(row.title || row.product_key).trim();
  const regionCode = String(body.region_code || row.region_code || "EU").trim() || "EU";
  const printAreaTemplateId = Number(body.print_area_template_id || row.print_area_template_id) || 0;
  const publishProfileId = Number(body.publish_profile_id || row.publish_profile_id) || undefined;

  let template;
  try {
    template = await loadTemplateMetadata(env, row.product_key, regionCode, {
      printAreaTemplateId,
      publishProfileId,
    });
  } catch (e) {
    return json({ ok: false, error: "template_load_failed", message: e?.message || String(e) }, 400, cors);
  }
  template.productName = productName;

  let designR2Key = String(row.design_r2_key || "").trim();
  if (!designR2Key) {
    try {
      const requestOrigin = resolvePublishRequestOrigin(new Request("https://internal/"), env);
      const prep = await preparePublishImage(env, {
        requestOrigin,
        designRow,
        designId,
        ownerId,
      });
      designR2Key = String(prep.imageR2Key || "").trim();
    } catch (e) {
      return json({ ok: false, error: "image_prepare_failed", message: e?.message || String(e) }, 400, cors);
    }
  }

  try {
    const { shopifyProduct } = await createDirectShopifyListing(env, {
      shopDomain,
      productKey: row.product_key,
      template,
      designMetadata: { ...designMetadata, title: productName },
      designR2Key,
      ownerId,
      designId,
      visibility: body.visibility === "draft" ? "draft" : "public",
      printAreaTemplateId,
      providerDisplayName: TODIFY_PROVIDER_DISPLAY_NAME,
      titleOverride: productName,
    });

    await savePublishedDesign(env, {
      designId,
      ownerId,
      productKey: row.product_key,
      productName,
      printifyProductId: null,
      shopifyProduct,
      visibility: body.visibility === "draft" ? "private" : "public",
      printAreaTemplateId,
      shopifyCompletionStatus: "complete",
      listingOrigin: "admin_test_todify",
    }).catch(() => {});

    const sid = String(shopifyProduct.id);
    const handle = String(shopifyProduct.handle || "");
    await env.CATALOG_DB.prepare(
      `UPDATE eaz_test_todify_products
       SET shopify_product_id = ?, shopify_handle = ?, status = 'online', published_at = ?, title = ?
       WHERE id = ?`
    )
      .bind(sid, handle || null, Date.now(), productName, id)
      .run();

    return json(
      { ok: true, id, shopify_product_id: sid, shopify_handle: handle, title: productName, status: "online" },
      200,
      cors
    );
  } catch (e) {
    return json({ ok: false, error: "publish_failed", message: e?.message || String(e) }, 500, cors);
  }
}
