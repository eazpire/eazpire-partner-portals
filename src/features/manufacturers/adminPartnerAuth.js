/**
 * Admin partner session — standalone magic-link auth on admin.eazpire.com (no Shopify bridge).
 * Future: admin.eazpire.com/ root can host more sections (/partner, /other, …).
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getAuthUser, isAdminOwner } from "../../utils/auth.js";
import {
  signAdminPartnerSession,
  signAdminPartnerExchangeTicket,
  verifyAdminPartnerExchangeTicket,
  sessionCookieHeader,
  clearSessionCookieHeader,
  adminPartnerCookieName,
  requireAdminPartnerSession,
  hashToken,
} from "./rbac.js";
import { sendAdminMagicLinkEmail } from "./email.js";
import {
  readVerifyToken,
  renderMagicLinkConfirmPage,
  redirectWithHeaders,
  wantsJsonVerifyResponse,
} from "./partnerAuthVerifyUi.js";
import { isAdminEmail, resolveAdminActorId } from "./adminAllowlist.js";

const ADMIN_MAGIC_KV_PREFIX = "admin_magic:";
const MAGIC_LINK_TTL_SEC = 15 * 60;

/** @deprecated Shopify bridge — kept for backwards compatibility only. */
const BRIDGE_PAGE_PATH = "/pages/admin-partner-bridge";

function adminPartnerBaseUrl(env) {
  return String(env.ADMIN_PARTNER_URL || "https://admin.eazpire.com/partner").replace(/\/$/, "");
}

function shopBaseUrl(env) {
  return String(env.SHOPIFY_STORE_URL || env.SHOPIFY_STOREFRONT_ORIGIN || "https://www.eazpire.com").replace(
    /\/$/,
    ""
  );
}

function adminVerifyFailureResponse(env, request, url, cors, errorCode) {
  if (wantsJsonVerifyResponse(request, url)) {
    return {
      kind: "json",
      status: errorCode === "token_required" ? 400 : 401,
      body: { ok: false, error: errorCode },
      headers: cors,
    };
  }
  const base = adminPartnerBaseUrl(env);
  return {
    kind: "redirect",
    status: 302,
    location: `${base}?auth_error=${encodeURIComponent(errorCode)}`,
    headers: cors,
  };
}

function respondAdminVerifyFailure(env, request, url, cors, errorCode) {
  const failure = adminVerifyFailureResponse(env, request, url, cors, errorCode);
  if (failure.kind === "json") {
    return json(failure.body, failure.status, failure.headers);
  }
  return redirectWithHeaders(failure.location, failure.status, failure.headers);
}

async function storeAdminMagicToken(env, rawToken, email) {
  if (!env.JOBS?.put) return false;
  const tokenHash = await hashToken(rawToken);
  const key = `${ADMIN_MAGIC_KV_PREFIX}${tokenHash}`;
  await env.JOBS.put(key, JSON.stringify({ email, used_at: null }), { expirationTtl: MAGIC_LINK_TTL_SEC });
  return true;
}

async function lookupAdminMagicToken(env, rawToken) {
  if (!env.JOBS?.get) return null;
  const tokenHash = await hashToken(rawToken);
  const key = `${ADMIN_MAGIC_KV_PREFIX}${tokenHash}`;
  const raw = await env.JOBS.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function consumeAdminMagicToken(env, rawToken) {
  if (!env.JOBS?.get) return null;
  const tokenHash = await hashToken(rawToken);
  const key = `${ADMIN_MAGIC_KV_PREFIX}${tokenHash}`;
  const row = await lookupAdminMagicToken(env, rawToken);
  if (!row || row.used_at) return null;
  await env.JOBS.delete(key).catch(() => {});
  return row;
}

export async function issueAdminMagicLink(env, email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return { ok: false, reason: "invalid_email" };
  }
  if (!isAdminEmail(normalized, env)) {
    return { ok: false, reason: "not_allowed" };
  }

  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const stored = await storeAdminMagicToken(env, rawToken, normalized);
  if (!stored) {
    return { ok: false, reason: "kv_unavailable" };
  }

  const verifyUrl = `${adminPartnerBaseUrl(env)}/auth/verify?token=${encodeURIComponent(rawToken)}`;
  const mail = await sendAdminMagicLinkEmail(env, { to: normalized, verifyUrl });
  if (!mail.ok) {
    console.error("[admin-auth] magic link email failed", mail.error, mail.detail || "");
    return { ok: false, reason: mail.error || "email_failed", detail: mail.detail };
  }

  return { ok: true, sent: true, email: normalized };
}

/** POST ?op=admin-auth-request — send magic link to allowlisted admin email. */
export async function handleAdminAuthRequest(request, env) {
  const cors = getCorsHeaders(request);
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim();

  const result = await issueAdminMagicLink(env, email);

  if (!result.ok && result.reason === "invalid_email") {
    return json({ ok: false, error: "invalid_email" }, 400, cors);
  }

  // Generic response — no email enumeration
  return json({ ok: true, sent: true }, 200, cors);
}

/** GET/POST /partner/auth/verify or ?op=admin-auth-verify */
export async function handleAdminAuthVerify(request, env) {
  const cors = getCorsHeaders(request);
  const url = new URL(request.url);
  const rawToken = await readVerifyToken(request, url);
  if (!rawToken) {
    return respondAdminVerifyFailure(env, request, url, cors, "token_required");
  }

  const row = await lookupAdminMagicToken(env, rawToken);
  if (!row) {
    return respondAdminVerifyFailure(env, request, url, cors, "invalid_or_expired_token");
  }
  if (row.used_at) {
    return respondAdminVerifyFailure(env, request, url, cors, "token_already_used");
  }

  const shouldConsume =
    request.method === "POST" || (wantsJsonVerifyResponse(request, url) && url.searchParams.get("confirm") === "1");

  if (!shouldConsume) {
    const html = renderMagicLinkConfirmPage({
      actionPath: "/partner/auth/verify",
      token: rawToken,
      title: "Confirm admin sign-in",
      lead: "Click below to open Eazpire Admin — Partner Ops. This step stops email scanners from using your link before you do.",
      buttonLabel: "Sign in to Admin Partner Ops",
    });
    return new Response(html, {
      status: 200,
      headers: { ...cors, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const consumed = await consumeAdminMagicToken(env, rawToken);
  if (!consumed?.email || !isAdminEmail(consumed.email, env)) {
    return respondAdminVerifyFailure(env, request, url, cors, "invalid_or_expired_token");
  }

  const jwt = await signAdminPartnerSession(env, {
    email: consumed.email,
    owner_id: resolveAdminActorId(env),
  });

  const headers = {
    ...cors,
    "Set-Cookie": sessionCookieHeader(adminPartnerCookieName(), jwt),
  };

  if (wantsJsonVerifyResponse(request, url)) {
    return json({ ok: true, email: consumed.email }, 200, headers);
  }

  return redirectWithHeaders(`${adminPartnerBaseUrl(env)}/`, 302, headers);
}

export async function handleAdminAuthLogout(request, env) {
  const cors = getCorsHeaders(request);
  return json(
    { ok: true },
    200,
    { ...cors, "Set-Cookie": clearSessionCookieHeader(adminPartnerCookieName()) }
  );
}

export async function handleAdminAuthMe(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await requireAdminPartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);
  return json({ ok: true, session: auth }, 200, cors);
}

// ----- Legacy Shopify bridge (deprecated) -----

async function resolveOwnerIdForExchange(request, env, body = {}) {
  const exchangeToken = body?.exchange_token ? String(body.exchange_token).trim() : "";
  if (exchangeToken) {
    return verifyAdminPartnerExchangeTicket(exchangeToken, env);
  }
  const auth = await getAuthUser(request, env);
  return auth?.owner_id ? String(auth.owner_id) : null;
}

/** @deprecated Use admin-auth-request magic link instead. */
export async function handleAdminPartnerIssueExchangeToken(request, env) {
  const cors = getCorsHeaders(request);
  const auth = await getAuthUser(request, env);
  const ownerId = auth?.owner_id ? String(auth.owner_id) : null;
  if (!ownerId) {
    return json({ ok: false, error: "login_required" }, 401, cors);
  }
  if (!isAdminOwner(ownerId, env)) {
    return json({ ok: false, error: "admin_required" }, 403, cors);
  }
  const exchangeToken = await signAdminPartnerExchangeTicket(env, ownerId);
  return json({ ok: true, exchange_token: exchangeToken, owner_id: ownerId }, 200, cors);
}

/** @deprecated Use admin-auth-verify magic link instead. */
export async function handleAdminPartnerSessionExchange(request, env) {
  const cors = getCorsHeaders(request);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const ownerId = await resolveOwnerIdForExchange(request, env, body);
  if (!ownerId || !isAdminOwner(ownerId, env)) {
    return json({ ok: false, error: "admin_required" }, 403, cors);
  }

  const jwt = await signAdminPartnerSession(env, { owner_id: ownerId });
  return json(
    { ok: true, owner_id: ownerId },
    200,
    { ...cors, "Set-Cookie": sessionCookieHeader(adminPartnerCookieName(), jwt) }
  );
}

/** Alias for handleAdminAuthLogout. */
export const handleAdminPartnerSessionLogout = handleAdminAuthLogout;

/** Alias for handleAdminAuthMe. */
export const handleAdminPartnerSessionMe = handleAdminAuthMe;

/** @deprecated */
export function adminLoginRedirectUrl(env) {
  const shop = shopBaseUrl(env);
  const bridge = encodeURIComponent(BRIDGE_PAGE_PATH);
  return `${shop}/customer_authentication/login?return_to=${bridge}`;
}

/** @deprecated */
export function adminPartnerBridgePath() {
  return BRIDGE_PAGE_PATH;
}
