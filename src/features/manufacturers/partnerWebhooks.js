/**
 * Partner webhook CRUD API (session OR API key with webhooks:read / webhooks:write).
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getManufacturerDb, manufacturerDbUnavailable, newId } from "./db.js";
import { ensureManufacturerSchema } from "./ensureManufacturerSchema.js";
import {
  requirePartnerAuth,
  partnerAuthHasScope,
  PARTNER_API_SCOPES,
  writeAuditLog,
} from "./rbac.js";
import { encryptSecret } from "./partnerSecrets.js";
import {
  validateWebhookUrl,
  normalizeWebhookEvents,
  generateWebhookSigningSecret,
  mapWebhookRow,
  deliverToWebhook,
  PARTNER_WEBHOOK_EVENTS,
} from "./partnerWebhookDelivery.js";

function publicWebhook(row) {
  const mapped = mapWebhookRow(row);
  if (!mapped) return null;
  delete mapped.secret_hint;
  return mapped;
}

async function resolveWebhookAuth(request, env, scope) {
  const cors = getCorsHeaders(request);
  const auth = await requirePartnerAuth(request, env);
  if (!auth.ok) return { error: json({ ok: false, error: auth.error }, auth.status, cors) };
  if (!partnerAuthHasScope(auth, scope)) {
    return { error: json({ ok: false, error: "insufficient_scope", required: scope }, 403, cors) };
  }
  const db = getManufacturerDb(env);
  if (!db) {
    const u = manufacturerDbUnavailable(cors);
    return { error: json(u.body, u.status, cors) };
  }
  await ensureManufacturerSchema(env);
  return { cors, db, auth, manufacturerId: auth.manufacturer_id };
}

/** GET ?op=partner-api-webhooks */
export async function handlePartnerWebhooksList(request, env) {
  const resolved = await resolveWebhookAuth(request, env, PARTNER_API_SCOPES.WEBHOOKS_READ);
  if (resolved.error) return resolved.error;
  const { cors, db, manufacturerId } = resolved;

  const rows = await db
    .prepare(
      `SELECT id, manufacturer_id, url, events, status, created_at, updated_at, last_delivery_at, last_error, failure_count
       FROM manufacturer_webhooks WHERE manufacturer_id = ? ORDER BY created_at DESC`
    )
    .bind(manufacturerId)
    .all();

  return json(
    {
      ok: true,
      webhooks: (rows?.results || []).map(publicWebhook),
      available_events: PARTNER_WEBHOOK_EVENTS.filter((e) => e !== "webhook.ping"),
    },
    200,
    cors
  );
}

/** POST ?op=partner-api-webhooks-create  body: { url, events? } */
export async function handlePartnerWebhooksCreate(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const resolved = await resolveWebhookAuth(request, env, PARTNER_API_SCOPES.WEBHOOKS_WRITE);
  if (resolved.error) return resolved.error;
  const { db, auth, manufacturerId } = resolved;

  const body = await request.json().catch(() => ({}));
  const urlCheck = validateWebhookUrl(body.url);
  if (!urlCheck.ok) return json({ ok: false, error: urlCheck.error }, 400, cors);

  const events = normalizeWebhookEvents(body.events);
  const rawSecret = generateWebhookSigningSecret();
  const secretCipher = await encryptSecret(env, rawSecret);
  const id = newId("mwh");
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO manufacturer_webhooks
        (id, manufacturer_id, url, secret_ciphertext, events, status, created_at, updated_at, last_delivery_at, last_error, failure_count)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, 0)`
    )
    .bind(id, manufacturerId, urlCheck.url.toString(), secretCipher, JSON.stringify(events), now, now)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: auth.user_id,
    action: "webhook_create",
    entity_type: "manufacturer_webhook",
    entity_id: id,
    after_json: { url: urlCheck.url.toString(), events },
  });

  return json(
    {
      ok: true,
      webhook: {
        id,
        url: urlCheck.url.toString(),
        events,
        status: "active",
        created_at: now,
        updated_at: now,
        last_delivery_at: null,
        last_error: null,
        failure_count: 0,
      },
      /** Signing secret — shown once; store securely */
      secret: rawSecret,
    },
    200,
    cors
  );
}

/** POST ?op=partner-api-webhooks-update */
export async function handlePartnerWebhooksUpdate(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST" && request.method !== "PATCH" && request.method !== "PUT") {
    return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  }

  const resolved = await resolveWebhookAuth(request, env, PARTNER_API_SCOPES.WEBHOOKS_WRITE);
  if (resolved.error) return resolved.error;
  const { db, manufacturerId } = resolved;

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const webhookId = String(
    body.webhook_id || body.id || url.searchParams.get("webhook_id") || url.searchParams.get("id") || ""
  ).trim();
  if (!webhookId) return json({ ok: false, error: "webhook_id_required" }, 400, cors);

  const row = await db
    .prepare(`SELECT * FROM manufacturer_webhooks WHERE id = ? AND manufacturer_id = ? LIMIT 1`)
    .bind(webhookId, manufacturerId)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);

  let nextUrl = row.url;
  let nextEvents = row.events;
  let nextStatus = row.status;

  if (body.url != null) {
    const urlCheck = validateWebhookUrl(body.url);
    if (!urlCheck.ok) return json({ ok: false, error: urlCheck.error }, 400, cors);
    nextUrl = urlCheck.url.toString();
  }
  if (body.events != null) {
    nextEvents = JSON.stringify(normalizeWebhookEvents(body.events));
  }
  if (body.status != null) {
    const s = String(body.status).trim().toLowerCase();
    if (s !== "active" && s !== "disabled") {
      return json({ ok: false, error: "invalid_status", allowed: ["active", "disabled"] }, 400, cors);
    }
    nextStatus = s;
  }

  const now = Date.now();
  const resetFailures = nextStatus === "active" && row.status !== "active";
  await db
    .prepare(
      `UPDATE manufacturer_webhooks
       SET url = ?, events = ?, status = ?, updated_at = ?,
           failure_count = CASE WHEN ? THEN 0 ELSE failure_count END,
           last_error = CASE WHEN ? THEN NULL ELSE last_error END
       WHERE id = ?`
    )
    .bind(nextUrl, nextEvents, nextStatus, now, resetFailures ? 1 : 0, resetFailures ? 1 : 0, webhookId)
    .run();

  const updated = await db
    .prepare(
      `SELECT id, manufacturer_id, url, events, status, created_at, updated_at, last_delivery_at, last_error, failure_count
       FROM manufacturer_webhooks WHERE id = ?`
    )
    .bind(webhookId)
    .first();

  return json({ ok: true, webhook: publicWebhook(updated) }, 200, cors);
}

/** POST/DELETE ?op=partner-api-webhooks-revoke */
export async function handlePartnerWebhooksRevoke(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST" && request.method !== "DELETE") {
    return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  }

  const resolved = await resolveWebhookAuth(request, env, PARTNER_API_SCOPES.WEBHOOKS_WRITE);
  if (resolved.error) return resolved.error;
  const { db, auth, manufacturerId } = resolved;

  const url = new URL(request.url);
  const body = request.method === "DELETE" ? {} : await request.json().catch(() => ({}));
  const webhookId = String(
    body.webhook_id || body.id || url.searchParams.get("webhook_id") || url.searchParams.get("id") || ""
  ).trim();
  if (!webhookId) return json({ ok: false, error: "webhook_id_required" }, 400, cors);

  const hard = body.hard === true || url.searchParams.get("hard") === "1";

  const row = await db
    .prepare(`SELECT id, status FROM manufacturer_webhooks WHERE id = ? AND manufacturer_id = ? LIMIT 1`)
    .bind(webhookId, manufacturerId)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);

  if (hard) {
    await db.prepare(`DELETE FROM manufacturer_webhook_deliveries WHERE webhook_id = ?`).bind(webhookId).run();
    await db.prepare(`DELETE FROM manufacturer_webhooks WHERE id = ?`).bind(webhookId).run();
    await writeAuditLog(env, {
      manufacturer_id: manufacturerId,
      user_id: auth.user_id,
      action: "webhook_delete",
      entity_type: "manufacturer_webhook",
      entity_id: webhookId,
    });
    return json({ ok: true, deleted: true }, 200, cors);
  }

  if (row.status === "disabled") return json({ ok: true, already: true }, 200, cors);

  await db
    .prepare(`UPDATE manufacturer_webhooks SET status = 'disabled', updated_at = ? WHERE id = ?`)
    .bind(Date.now(), webhookId)
    .run();

  return json({ ok: true, revoked: true }, 200, cors);
}

/** POST ?op=partner-api-webhooks-test */
export async function handlePartnerWebhooksTest(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const resolved = await resolveWebhookAuth(request, env, PARTNER_API_SCOPES.WEBHOOKS_WRITE);
  if (resolved.error) return resolved.error;
  const { db, manufacturerId } = resolved;

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const webhookId = String(
    body.webhook_id || body.id || url.searchParams.get("webhook_id") || url.searchParams.get("id") || ""
  ).trim();
  if (!webhookId) return json({ ok: false, error: "webhook_id_required" }, 400, cors);

  const row = await db
    .prepare(`SELECT * FROM manufacturer_webhooks WHERE id = ? AND manufacturer_id = ? LIMIT 1`)
    .bind(webhookId, manufacturerId)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (row.status !== "active") {
    return json({ ok: false, error: "webhook_disabled" }, 400, cors);
  }

  const ok = await deliverToWebhook(env, row, "webhook.ping", {
    message: "eazpire partner webhook test ping",
  });

  return json(
    {
      ok: true,
      sent: !!ok,
      event: "webhook.ping",
      webhook_id: webhookId,
    },
    200,
    cors
  );
}
