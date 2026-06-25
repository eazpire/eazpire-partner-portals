/**
 * Partner Admin — Print Area test Printify products (create with random design, list, preview, delete).
 */

import { getCorsHeaders, json } from "../../../../utils/response.js";
import { requireAdminPartnerSession } from "../../rbac.js";
import {
  createTestPrintifyProduct,
  ensureTestPrintifyTable,
  buildPrintifyProductPreviewPayload,
  listTestPrintifyCreations,
} from "../../../admin/adminTestPrintifyProducts.js";
import { getPrintifyProduct } from "../../../../utils/printify.js";
import { resolvePreviewMockupPreference } from "../../../mockup/resolvePreviewMockupPreference.js";

async function buildPreviewPayload(env, row) {
  const product = await getPrintifyProduct(env, String(row.printify_product_id || "").trim());
  if (!product) return null;
  const templateId = Number(row.print_area_template_id) || 0;
  const pref = await resolvePreviewMockupPreference(env, row.product_key, templateId).catch(() => null);
  const preferredViewKey = String(pref?.view_key || "front").trim().toLowerCase() || "front";
  return buildPrintifyProductPreviewPayload(product, row.product_key, { preferredViewKey });
}

async function deletePrintifyProduct(env, printifyProductId) {
  if (!printifyProductId || !env.PRINTIFY_API_KEY) {
    return { ok: false, error: "missing_printify" };
  }
  const shopId = env.PRINTIFY_SHOP_ID || "22170465";
  const resp = await fetch(
    `https://api.printify.com/v1/shops/${shopId}/products/${encodeURIComponent(printifyProductId)}.json`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.PRINTIFY_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (resp.ok || resp.status === 404) return { ok: true };
  const text = await resp.text().catch(() => "");
  return { ok: false, error: `printify_${resp.status}`, detail: text.slice(0, 500) };
}

function parseListParams(request) {
  if (request.method === "POST") {
    return request.json().catch(() => ({}));
  }
  const url = new URL(request.url);
  return Promise.resolve({
    product_key: url.searchParams.get("product_key"),
    print_provider_id: url.searchParams.get("print_provider_id"),
  });
}

function mapTestProductRows(rows) {
  return (rows || []).map((row) => {
    let placement_modes = null;
    if (row.placement_modes_json) {
      try {
        placement_modes = JSON.parse(row.placement_modes_json);
      } catch {
        placement_modes = null;
      }
    }
    return {
      ...row,
      placement_modes,
      printify: row.printify_title
        ? { id: row.printify_product_id, title: row.printify_title }
        : { id: row.printify_product_id, title: null },
    };
  });
}

export async function handlePartnerTestPrintifyCreate(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);

  const body = await request.json().catch(() => ({}));
  const actor = auth.session?.email || auth.email || "partner-admin";
  const randomDesign = body.random_design === true || body.design_id == null;
  return createTestPrintifyProduct(
    env,
    { ...body, random_design: randomDesign },
    actor,
    cors
  );
}

export async function handlePartnerTestPrintifyCreations(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);

  const url = new URL(request.url);
  let body = {};
  if (request.method === "POST") {
    body = await request.json().catch(() => ({}));
  }
  const result = await listTestPrintifyCreations(env, {
    designType: body.design_type || url.searchParams.get("design_type") || "classic",
    cursor: body.cursor || url.searchParams.get("cursor"),
    limit: body.limit || url.searchParams.get("limit"),
    activeOnly: true,
  });
  if (!result.ok) {
    return json(result, 500, cors);
  }
  return json(result, 200, cors);
}

export async function handlePartnerTestPrintifyList(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  if (!env.CATALOG_DB) return json({ ok: false, error: "database_unavailable" }, 500, cors);

  await ensureTestPrintifyTable(env);
  const body = await parseListParams(request);
  const productKey = String(body.product_key || "").trim();
  const pp = Number(body.print_provider_id);
  const printProviderId = Number.isFinite(pp) && pp > 0 ? pp : null;
  if (!productKey) return json({ ok: false, error: "missing_product_key" }, 400, cors);

  const q = printProviderId
    ? await env.CATALOG_DB.prepare(
        `SELECT id, product_key, publish_profile_id, print_area_template_id, version_label, design_type,
                design_id, design_owner_id, printify_product_id, printify_title, created_by, created_at,
                placement_modes_json, print_provider_id
         FROM eaz_test_printify_products
         WHERE LOWER(TRIM(product_key)) = LOWER(TRIM(?))
           AND (print_provider_id IS NULL OR print_provider_id = ?)
         ORDER BY created_at DESC LIMIT 200`
      )
        .bind(productKey, printProviderId)
        .all()
    : await env.CATALOG_DB.prepare(
        `SELECT id, product_key, publish_profile_id, print_area_template_id, version_label, design_type,
                design_id, design_owner_id, printify_product_id, printify_title, created_by, created_at,
                placement_modes_json, print_provider_id
         FROM eaz_test_printify_products
         WHERE LOWER(TRIM(product_key)) = LOWER(TRIM(?))
         ORDER BY created_at DESC LIMIT 200`
      )
        .bind(productKey)
        .all();

  return json(
    { ok: true, product_key: productKey, items: mapTestProductRows(q?.results || []) },
    200,
    cors
  );
}

export async function handlePartnerTestPrintifyDelete(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  if (!env.CATALOG_DB) return json({ ok: false, error: "database_unavailable" }, 500, cors);

  await ensureTestPrintifyTable(env);
  const body = await request.json().catch(() => ({}));
  const idsRaw = Array.isArray(body.ids) ? body.ids : body.id != null ? [body.id] : [];
  const ids = [...new Set(idsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return json({ ok: false, error: "invalid_id" }, 400, cors);

  const deleted = [];
  const failed = [];
  for (const id of ids) {
    const row = await env.CATALOG_DB.prepare(`SELECT * FROM eaz_test_printify_products WHERE id = ?`)
      .bind(id)
      .first();
    if (!row) {
      failed.push({ id, error: "not_found" });
      continue;
    }
    const delPi = await deletePrintifyProduct(env, row.printify_product_id);
    if (!delPi.ok) {
      failed.push({ id, error: delPi.error, detail: delPi.detail });
      continue;
    }
    await env.CATALOG_DB.prepare(`DELETE FROM eaz_test_printify_products WHERE id = ?`).bind(id).run();
    deleted.push(id);
  }
  const ok = failed.length === 0;
  return json({ ok, deleted, failed, deleted_count: deleted.length }, ok ? 200 : deleted.length ? 207 : 502, cors);
}

export async function handlePartnerTestPrintifyPreview(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  if (!env.CATALOG_DB) return json({ ok: false, error: "database_unavailable" }, 500, cors);

  await ensureTestPrintifyTable(env);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "invalid_id" }, 400, cors);

  const row = await env.CATALOG_DB.prepare(`SELECT * FROM eaz_test_printify_products WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);

  try {
    const payload = await buildPreviewPayload(env, row);
    if (!payload) return json({ ok: false, error: "printify_product_not_found" }, 404, cors);
    let placement_modes = null;
    if (row.placement_modes_json) {
      try {
        placement_modes = JSON.parse(row.placement_modes_json);
      } catch {
        placement_modes = null;
      }
    }
    return json(
      {
        ok: true,
        id,
        printify_product_id: row.printify_product_id,
        product_key: row.product_key,
        design_id: row.design_id,
        placement_modes,
        ...payload,
      },
      200,
      cors
    );
  } catch (e) {
    return json({ ok: false, error: "printify_fetch_failed", detail: String(e?.message || e).slice(0, 400) }, 502, cors);
  }
}
