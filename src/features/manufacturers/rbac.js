/**
 * Partner / Admin session JWT + audit logging
 */

import { SignJWT, jwtVerify } from "jose";
import { getManufacturerDb, newId } from "./db.js";

const PARTNER_COOKIE = "partner_session";
const ADMIN_PARTNER_COOKIE = "admin_partner_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

function getJwtSecret(env) {
  const s = String(env.PARTNER_JWT_SECRET || env.JWT_APP_SECRET || "").trim();
  if (!s) throw new Error("partner_jwt_secret_missing");
  return new TextEncoder().encode(s);
}

export function partnerCookieName() {
  return PARTNER_COOKIE;
}

export function adminPartnerCookieName() {
  return ADMIN_PARTNER_COOKIE;
}

export async function signPartnerSession(env, payload) {
  const secret = getJwtSecret(env);
  return new SignJWT({ ...payload, typ: "partner", mode: "full" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret);
}

/** Limited session for applicants awaiting admin approval. */
export async function signPartnerApplicantSession(env, payload) {
  const secret = getJwtSecret(env);
  return new SignJWT({ ...payload, typ: "partner", mode: "applicant" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret);
}

export async function signAdminPartnerSession(env, payload) {
  const secret = getJwtSecret(env);
  return new SignJWT({ ...payload, typ: "admin_partner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret);
}

/** Short-lived ticket (www storefront → admin.eazpire.com cookie exchange). */
export async function signAdminPartnerExchangeTicket(env, ownerId) {
  const secret = getJwtSecret(env);
  return new SignJWT({ owner_id: String(ownerId), typ: "admin_partner_exchange" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(secret);
}

export async function verifyAdminPartnerExchangeTicket(token, env) {
  if (!token) return null;
  try {
    const secret = getJwtSecret(env);
    const { payload } = await jwtVerify(token, secret);
    if (payload?.typ !== "admin_partner_exchange") return null;
    const ownerId = payload?.owner_id ? String(payload.owner_id) : null;
    return ownerId || null;
  } catch {
    return null;
  }
}

export async function verifyPartnerSession(token, env) {
  if (!token) return null;
  try {
    const secret = getJwtSecret(env);
    const { payload } = await jwtVerify(token, secret);
    if (payload?.typ !== "partner") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyAdminPartnerSession(token, env) {
  if (!token) return null;
  try {
    const secret = getJwtSecret(env);
    const { payload } = await jwtVerify(token, secret);
    if (payload?.typ !== "admin_partner") return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${name}=`)) {
      return decodeURIComponent(p.slice(name.length + 1));
    }
  }
  return null;
}

export function sessionCookieHeader(name, token, maxAgeSec = SESSION_TTL_SEC) {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function magicLinkExpiry() {
  return Date.now() + MAGIC_LINK_TTL_MS;
}

export async function requirePartnerSession(request, env) {
  const token = readCookie(request, PARTNER_COOKIE);
  const session = await verifyPartnerSession(token, env);
  if (!session) {
    return { ok: false, status: 401, error: "partner_auth_required" };
  }
  if (session.mode === "applicant" && session.application_id) {
    return {
      ok: true,
      mode: "applicant",
      application_id: String(session.application_id),
      email: String(session.email || ""),
    };
  }
  if (!session?.manufacturer_id || !session?.user_id) {
    return { ok: false, status: 401, error: "partner_auth_required" };
  }
  return {
    ok: true,
    mode: "full",
    manufacturer_id: String(session.manufacturer_id),
    user_id: String(session.user_id),
    role: String(session.role || "viewer"),
    email: String(session.email || ""),
  };
}

/** Blocks limited applicant sessions — required for full portal ops. */
export async function requireFullPartnerSession(request, env) {
  const auth = await requirePartnerSession(request, env);
  if (!auth.ok) return auth;
  if (auth.mode === "applicant") {
    return { ok: false, status: 403, error: "full_partner_access_required" };
  }
  return auth;
}

export async function requireAdminPartnerSession(request, env) {
  const { isAdminOwner } = await import("../../utils/auth.js");
  const { isAdminEmail, resolveAdminActorId } = await import("./adminAllowlist.js");
  const token = readCookie(request, ADMIN_PARTNER_COOKIE);
  const session = await verifyAdminPartnerSession(token, env);
  if (!session) {
    return { ok: false, status: 401, error: "admin_partner_auth_required" };
  }

  const email = session?.email ? String(session.email).toLowerCase() : null;
  const ownerId = session?.owner_id ? String(session.owner_id) : null;

  if (email && isAdminEmail(email, env)) {
    return { ok: true, email, owner_id: ownerId || resolveAdminActorId(env) };
  }
  if (ownerId && isAdminOwner(ownerId, env)) {
    return { ok: true, email: email || "", owner_id: ownerId };
  }
  return { ok: false, status: 403, error: "admin_partner_auth_required" };
}

export async function writeAuditLog(env, entry) {
  const db = getManufacturerDb(env);
  if (!db) return;
  const id = newId("maudit");
  await db
    .prepare(
      `INSERT INTO manufacturer_audit_logs
        (id, manufacturer_id, user_id, action, entity_type, entity_id, before_json, after_json, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      entry.manufacturer_id || null,
      entry.user_id || null,
      entry.action,
      entry.entity_type || null,
      entry.entity_id || null,
      entry.before_json ? JSON.stringify(entry.before_json) : null,
      entry.after_json ? JSON.stringify(entry.after_json) : null,
      entry.ip_hash || null,
      Date.now()
    )
    .run()
    .catch((e) => console.error("[manufacturer audit]", e));
}

export function canManageCatalog(role) {
  return ["owner", "admin", "catalog_manager"].includes(role);
}

export function canManageOrders(role) {
  return ["owner", "admin", "order_operator"].includes(role);
}
