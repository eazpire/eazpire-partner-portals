/**
 * Admin Creations Products — per-product action lock (IDEA-063).
 *
 * Bulk Publish/Unpublish/Update actions from the Products bulk dock acquire a lock
 * per product before starting, so the same product can't be double-actioned from two
 * admin tabs/sessions. Reuses the `publish_active_sessions` table (design_id column
 * holds the numeric Shopify product id here; product_keys_json holds the product_key)
 * so the existing `listPublishActiveSessionRows({ adminAll: true })` reader — already
 * used by the Creator/Android "publish_active" list enrichment — also reports these
 * as busy without any schema changes.
 */

import { requireAdmin } from "../../utils/auth.js";
import { getCorsHeaders, json } from "../../utils/response.js";
import { upsertPublishActiveSession, deletePublishActiveSession } from "../publish/publishActiveSessions.js";
import { normalizeShopifyProductId } from "./adminCreationsShopifyList.js";

const SESSION_PREFIX = "admin-prod-";

async function requireAdminGate(request, env) {
  const cors = getCorsHeaders(request);
  const gate = await requireAdmin(request, env);
  if (!gate.ok) {
    return { ok: false, response: json({ ok: false, error: gate.error || "forbidden", reason: gate.reason }, gate.status || 403, cors), cors };
  }
  const owner_id = gate.owner_id;
  if (!env.CREATOR_DB) {
    return { ok: false, response: json({ ok: false, error: "database_unavailable" }, 500, cors), cors };
  }
  return { ok: true, ownerId: String(owner_id || ""), cors };
}

function generateProductLockSessionId() {
  return `${SESSION_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Stable pseudo-numeric id for the `design_id` column when no Shopify product id exists yet. */
function pseudoNumericIdFromProductKey(productKey) {
  const str = String(productKey || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

export async function handleAdminCreationsProductActionLock(request, env) {
  const auth = await requireAdminGate(request, env);
  if (!auth.ok) return auth.response;
  const { ownerId, cors } = auth;

  const body = await request.json().catch(() => ({}));
  const productKey = String(body.product_key || "").trim();
  const shopifyProductId = normalizeShopifyProductId(body.shopify_product_id || body.shopify_id || "");
  const title = body.title ? String(body.title).slice(0, 240) : null;
  const action = String(body.action || "").trim().toLowerCase();

  if (!productKey && !shopifyProductId) {
    return json({ ok: false, error: "missing_product_reference" }, 400, cors);
  }

  const numericId = shopifyProductId
    ? Number(shopifyProductId)
    : pseudoNumericIdFromProductKey(productKey);

  const sessionId = generateProductLockSessionId();
  await upsertPublishActiveSession(env, {
    sessionId,
    designId: numericId,
    ownerId,
    designTitle: title || productKey || shopifyProductId,
    productKeys: [productKey || shopifyProductId].filter(Boolean),
  });

  return json(
    {
      ok: true,
      session_id: sessionId,
      product_key: productKey || null,
      shopify_product_id: shopifyProductId || null,
      action: action || null,
    },
    200,
    cors
  );
}

export async function handleAdminCreationsProductActionUnlock(request, env) {
  const auth = await requireAdminGate(request, env);
  if (!auth.ok) return auth.response;
  const { cors } = auth;

  const body = await request.json().catch(() => ({}));
  const sessionId = String(body.session_id || "").trim();
  if (!sessionId || !sessionId.startsWith(SESSION_PREFIX)) {
    return json({ ok: false, error: "missing_session_id" }, 400, cors);
  }

  await deletePublishActiveSession(env, sessionId);
  return json({ ok: true, session_id: sessionId }, 200, cors);
}
