/**
 * Partner API key CRUD (portal API page — session only).
 * Keys authenticate machine clients to Partner API ops; plaintext shown once on create.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getManufacturerDb, manufacturerDbUnavailable, newId } from "./db.js";
import { ensureManufacturerSchema } from "./ensureManufacturerSchema.js";
import {
  requireFullPartnerSession,
  hashToken,
  canManageApiKeys,
  writeAuditLog,
  DEFAULT_PARTNER_API_SCOPES,
  ALLOWED_PARTNER_API_SCOPES,
  PARTNER_API_KEY_PREFIX,
} from "./rbac.js";

function randomKeySecret(len = 32) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function normalizeScopes(input) {
  if (Array.isArray(input) && input.length) {
    const allowed = new Set(ALLOWED_PARTNER_API_SCOPES);
    const scopes = input.map((s) => String(s).trim()).filter((s) => allowed.has(s));
    return scopes.length ? scopes : [...DEFAULT_PARTNER_API_SCOPES];
  }
  return [...DEFAULT_PARTNER_API_SCOPES];
}

async function requireApiKeyManagerSession(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireFullPartnerSession(request, env);
  if (!auth.ok) return { error: json({ ok: false, error: auth.error }, auth.status, cors) };
  if (!canManageApiKeys(auth.role)) {
    return { error: json({ ok: false, error: "forbidden" }, 403, cors) };
  }

  const db = getManufacturerDb(env);
  if (!db) {
    const u = manufacturerDbUnavailable(cors);
    return { error: json(u.body, u.status, cors) };
  }
  await ensureManufacturerSchema(env);

  return { cors, db, auth, manufacturerId: auth.manufacturer_id };
}

/** GET ?op=partner-api-keys | partner-api-keys-list */
export async function handlePartnerApiKeysList(request, env) {
  const resolved = await requireApiKeyManagerSession(request, env);
  if (resolved.error) return resolved.error;
  const { cors, db, manufacturerId } = resolved;

  const rows = await db
    .prepare(
      `SELECT id, name, key_prefix, scopes, created_at, revoked_at, last_used_at
       FROM manufacturer_api_keys WHERE manufacturer_id = ? ORDER BY created_at DESC`
    )
    .bind(manufacturerId)
    .all();

  const keys = (rows?.results || []).map((row) => {
    let scopes = [];
    try {
      scopes = JSON.parse(row.scopes || "[]");
    } catch {
      scopes = [];
    }
    return {
      id: row.id,
      name: row.name,
      key_prefix: row.key_prefix,
      scopes,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
      last_used_at: row.last_used_at,
      active: !row.revoked_at,
    };
  });

  return json({ ok: true, keys }, 200, cors);
}

/** POST ?op=partner-api-keys-create  body: { name, scopes? } — returns raw api_key once */
export async function handlePartnerApiKeysCreate(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const resolved = await requireApiKeyManagerSession(request, env);
  if (resolved.error) return resolved.error;
  const { db, auth, manufacturerId } = resolved;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || body.label || "").trim().slice(0, 80);
  if (!name) return json({ ok: false, error: "name_required" }, 400, cors);

  const scopes = normalizeScopes(body.scopes);
  const raw = `${PARTNER_API_KEY_PREFIX}${randomKeySecret(36)}`;
  const keyHash = await hashToken(raw);
  const keyPrefix = raw.slice(0, 18);
  const id = newId("mak");
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO manufacturer_api_keys
        (id, manufacturer_id, name, key_prefix, key_hash, scopes, created_at, revoked_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    )
    .bind(id, manufacturerId, name, keyPrefix, keyHash, JSON.stringify(scopes), now)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: auth.user_id,
    action: "api_key_create",
    entity_type: "manufacturer_api_key",
    entity_id: id,
    after_json: { name, key_prefix: keyPrefix, scopes },
  });

  return json(
    {
      ok: true,
      key: {
        id,
        name,
        key_prefix: keyPrefix,
        scopes,
        created_at: now,
        active: true,
      },
      /** Shown once — store securely; never returned again */
      api_key: raw,
    },
    200,
    cors
  );
}

/** POST ?op=partner-api-keys-revoke  body: { key_id } */
export async function handlePartnerApiKeysRevoke(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const resolved = await requireApiKeyManagerSession(request, env);
  if (resolved.error) return resolved.error;
  const { db, auth, manufacturerId } = resolved;

  const body = await request.json().catch(() => ({}));
  const keyId = String(body.key_id || body.id || "").trim();
  if (!keyId) return json({ ok: false, error: "key_id_required" }, 400, cors);

  const row = await db
    .prepare(
      `SELECT id, revoked_at FROM manufacturer_api_keys WHERE id = ? AND manufacturer_id = ? LIMIT 1`
    )
    .bind(keyId, manufacturerId)
    .first();
  if (!row) return json({ ok: false, error: "not_found" }, 404, cors);
  if (row.revoked_at) return json({ ok: true, already: true }, 200, cors);

  await db
    .prepare(`UPDATE manufacturer_api_keys SET revoked_at = ? WHERE id = ?`)
    .bind(Date.now(), keyId)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: auth.user_id,
    action: "api_key_revoke",
    entity_type: "manufacturer_api_key",
    entity_id: keyId,
  });

  return json({ ok: true, revoked: true }, 200, cors);
}

export async function countActivePartnerApiKeys(db, manufacturerId) {
  if (!db || !manufacturerId) return 0;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM manufacturer_api_keys WHERE manufacturer_id = ? AND revoked_at IS NULL`
    )
    .bind(manufacturerId)
    .first();
  return Number(row?.c || 0);
}
