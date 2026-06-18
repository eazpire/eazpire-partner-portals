/**
 * Partner magic-link authentication
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { getManufacturerDb, manufacturerDbUnavailable, newId } from "./db.js";
import { ensureManufacturerSchema } from "./ensureManufacturerSchema.js";
import {
  hashToken,
  magicLinkExpiry,
  signPartnerSession,
  signPartnerApplicantSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  partnerCookieName,
  writeAuditLog,
} from "./rbac.js";
import { sendPartnerMagicLinkEmail, sendPartnerApplicantMagicLinkEmail } from "./email.js";
import {
  authTokenStatus,
  partnerVerifyFailureResponse,
  readVerifyToken,
  renderMagicLinkConfirmPage,
  redirectWithHeaders,
  wantsJsonVerifyResponse,
} from "./partnerAuthVerifyUi.js";

const PARTNER_LOGIN_POLL_PREFIX = "partner_login_poll:";
const PARTNER_LOGIN_POLL_HASH_PREFIX = "partner_login_poll_hash:";
const PARTNER_SESSION_EXCHANGE_PREFIX = "partner_session_exchange:";
const PARTNER_LOGIN_POLL_TTL_SEC = 15 * 60;
const PARTNER_EXCHANGE_TTL_SEC = 120;

function partnerBaseUrl(env) {
  return String(env.PARTNER_PORTAL_URL || "https://partner.eazpire.com").replace(/\/$/, "");
}

async function insertManufacturerAuthToken(env, db, manufacturerUserId) {
  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await hashToken(rawToken);
  const tokenId = newId("pat");
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO manufacturer_auth_tokens (id, manufacturer_user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(tokenId, manufacturerUserId, tokenHash, magicLinkExpiry(), now)
    .run();

  return {
    rawToken,
    verifyUrl: `${partnerBaseUrl(env)}/auth/verify?token=${encodeURIComponent(rawToken)}`,
  };
}

/**
 * Create token + send magic link for manufacturer users or pending/rejected applicants.
 * @param {{ mailFn?: Function, mailContext?: object, skipEmail?: boolean }} options
 */
export async function issuePartnerMagicLink(env, email, options = {}) {
  const { mailFn, mailContext = {}, skipEmail = false } = options;
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, reason: "manufacturer_db_unavailable" };
  await ensureManufacturerSchema(env);

  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return { ok: false, reason: "invalid_email" };
  }

  const { isPartnerEmailBlocked } = await import("./partnerEmailBlocks.js");
  if (await isPartnerEmailBlocked(db, normalized)) {
    return { ok: false, reason: "email_blocked" };
  }

  const user = await db
    .prepare(
      `SELECT mu.*, m.status AS manufacturer_status
       FROM manufacturer_users mu
       JOIN manufacturers m ON m.id = mu.manufacturer_id
       WHERE lower(mu.email) = ? AND mu.status = 'active'
       LIMIT 1`
    )
    .bind(normalized)
    .first();

  if (user) {
    if (["rejected", "suspended"].includes(String(user.manufacturer_status))) {
      return { ok: false, reason: "manufacturer_inactive" };
    }

    const { rawToken, verifyUrl } = await insertManufacturerAuthToken(env, db, user.id);
    if (!skipEmail) {
      const send = mailFn || sendPartnerMagicLinkEmail;
      const mail = await send(env, { to: normalized, verifyUrl, ...mailContext });
      if (!mail.ok) {
        console.error("[partner-auth] magic link email failed", mail.error, mail.detail || "");
        return { ok: false, reason: mail.error || "email_failed", detail: mail.detail };
      }
    }

    return { ok: true, sent: !skipEmail, email: normalized, verifyUrl, rawToken, mode: "full" };
  }

  const { findApplicationForMagicLink, issueApplicantMagicLinkToken } = await import(
    "./partnerApplicationService.js"
  );
  const application = await findApplicationForMagicLink(db, normalized);
  if (application) {
    const rawToken = await issueApplicantMagicLinkToken(db, application.id);
    const verifyUrl = `${partnerBaseUrl(env)}/auth/verify?token=${encodeURIComponent(rawToken)}`;
    if (!skipEmail) {
      const send = mailFn || sendPartnerApplicantMagicLinkEmail;
      const mail = await send(env, {
        to: normalized,
        verifyUrl,
        companyName: application.company_name,
        status: application.status,
        ...mailContext,
      });
      if (!mail.ok) {
        console.error("[partner-auth] applicant magic link email failed", mail.error, mail.detail || "");
        return { ok: false, reason: mail.error || "email_failed", detail: mail.detail };
      }
    }

    return { ok: true, sent: !skipEmail, email: normalized, verifyUrl, rawToken, mode: "applicant" };
  }

  return { ok: false, reason: "user_not_registered" };
}

function newPollToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function newExchangeToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function pollKvKey(pollToken) {
  return `${PARTNER_LOGIN_POLL_PREFIX}${pollToken}`;
}

function pollHashKvKey(tokenHash) {
  return `${PARTNER_LOGIN_POLL_HASH_PREFIX}${tokenHash}`;
}

function exchangeKvKey(exchangeToken) {
  return `${PARTNER_SESSION_EXCHANGE_PREFIX}${exchangeToken}`;
}

async function readPollRecord(env, pollToken) {
  if (!env.JOBS?.get || !pollToken) return null;
  const raw = await env.JOBS.get(pollKvKey(pollToken));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writePollRecord(env, pollToken, record) {
  if (!env.JOBS?.put || !pollToken) return false;
  await env.JOBS.put(pollKvKey(pollToken), JSON.stringify(record), {
    expirationTtl: PARTNER_LOGIN_POLL_TTL_SEC,
  });
  return true;
}

/** Create cross-device poll session — decoy when no magic link was issued. */
export async function createPartnerLoginPoll(env, { email, rawToken = null, mode = null } = {}) {
  const pollToken = newPollToken();
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  const now = Date.now();
  const record = {
    email: normalized,
    status: "pending",
    mode: mode || null,
    decoy: !rawToken,
    expires_at: now + PARTNER_LOGIN_POLL_TTL_SEC * 1000,
    created_at: now,
  };

  if (rawToken) {
    const tokenHash = await hashToken(rawToken);
    record.magic_token_hash = tokenHash;
    if (env.JOBS?.put) {
      await env.JOBS.put(pollHashKvKey(tokenHash), pollToken, {
        expirationTtl: PARTNER_LOGIN_POLL_TTL_SEC,
      });
    }
  }

  const stored = await writePollRecord(env, pollToken, record);
  if (!stored) return null;
  return pollToken;
}

export async function markPartnerLoginPollVerified(env, rawToken, jwt, mode) {
  if (!env.JOBS?.get || !rawToken || !jwt) return;
  const tokenHash = await hashToken(rawToken);
  const pollToken = await env.JOBS.get(pollHashKvKey(tokenHash));
  if (!pollToken) return;

  const record = await readPollRecord(env, pollToken);
  if (!record || record.status !== "pending") return;

  const exchangeToken = newExchangeToken();
  await env.JOBS.put(
    exchangeKvKey(exchangeToken),
    JSON.stringify({ jwt, mode: mode || "full", used_at: null }),
    { expirationTtl: PARTNER_EXCHANGE_TTL_SEC }
  );

  record.status = "verified";
  record.mode = mode || record.mode || "full";
  record.exchange_token = exchangeToken;
  record.verified_at = Date.now();
  await writePollRecord(env, pollToken, record);
}

export async function handlePartnerAuthRequest(request, env) {
  const cors = getCorsHeaders(request);
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim();

  const result = await issuePartnerMagicLink(env, email);

  if (!result.ok && result.reason === "invalid_email") {
    return json({ ok: false, error: "invalid_email" }, 400, cors);
  }
  if (!result.ok && result.reason === "email_blocked") {
    return json({ ok: false, error: "email_blocked" }, 403, cors);
  }
  if (!result.ok && result.reason === "user_not_registered") {
    return json({ ok: false, error: "application_required" }, 404, cors);
  }

  const pollToken = await createPartnerLoginPoll(env, {
    email,
    rawToken: result.ok && result.rawToken ? result.rawToken : null,
    mode: result.ok ? result.mode : null,
  });

  return json({ ok: true, sent: true, poll_token: pollToken || undefined }, 200, cors);
}

export async function handlePartnerAuthPoll(request, env) {
  const cors = getCorsHeaders(request);
  const url = new URL(request.url);
  const pollToken = String(url.searchParams.get("poll_token") || "").trim();
  if (!pollToken) {
    return json({ ok: false, error: "poll_token_required" }, 400, cors);
  }

  const record = await readPollRecord(env, pollToken);
  if (!record) {
    return json({ ok: true, status: "expired" }, 200, cors);
  }

  if (record.status === "cancelled") {
    return json({ ok: true, status: "cancelled" }, 200, cors);
  }

  if (record.expires_at && record.expires_at < Date.now()) {
    return json({ ok: true, status: "expired" }, 200, cors);
  }

  if (record.status === "verified" && record.exchange_token) {
    return json(
      {
        ok: true,
        status: "verified",
        exchange_token: record.exchange_token,
        mode: record.mode || "full",
      },
      200,
      cors
    );
  }

  return json({ ok: true, status: "pending" }, 200, cors);
}

export async function handlePartnerAuthExchange(request, env) {
  const cors = getCorsHeaders(request);
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, cors);
  }

  const body = await request.json().catch(() => ({}));
  const exchangeToken = String(body.exchange_token || "").trim();
  if (!exchangeToken) {
    return json({ ok: false, error: "exchange_token_required" }, 400, cors);
  }

  if (!env.JOBS?.get) {
    return json({ ok: false, error: "kv_unavailable" }, 503, cors);
  }

  const key = exchangeKvKey(exchangeToken);
  const raw = await env.JOBS.get(key);
  if (!raw) {
    return json({ ok: false, error: "invalid_or_expired_exchange" }, 401, cors);
  }

  let row;
  try {
    row = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_or_expired_exchange" }, 401, cors);
  }

  if (!row?.jwt || row.used_at) {
    return json({ ok: false, error: "invalid_or_expired_exchange" }, 401, cors);
  }

  await env.JOBS.delete(key).catch(() => {});

  return json(
    { ok: true, mode: row.mode || "full" },
    200,
    { ...cors, "Set-Cookie": sessionCookieHeader(partnerCookieName(), row.jwt) }
  );
}

function respondVerifyFailure(env, request, url, cors, errorCode) {
  const failure = partnerVerifyFailureResponse(env, request, url, cors, errorCode);
  if (failure.kind === "json") {
    return json(failure.body, failure.status, failure.headers);
  }
  return redirectWithHeaders(failure.location, failure.status, failure.headers);
}

async function lookupPartnerAuthToken(db, rawToken) {
  const tokenHash = await hashToken(rawToken);
  const row = await db
    .prepare(
      `SELECT t.*, mu.manufacturer_id, mu.id AS user_id, mu.role, mu.email
       FROM manufacturer_auth_tokens t
       JOIN manufacturer_users mu ON mu.id = t.manufacturer_user_id
       WHERE t.token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash)
    .first();
  return row;
}

async function completePartnerAuthLogin(env, row) {
  await getManufacturerDb(env)
    .prepare(`UPDATE manufacturer_auth_tokens SET used_at = ? WHERE id = ?`)
    .bind(Date.now(), row.id)
    .run();

  const jwt = await signPartnerSession(env, {
    manufacturer_id: row.manufacturer_id,
    user_id: row.user_id,
    role: row.role,
    email: row.email,
  });

  await writeAuditLog(env, {
    manufacturer_id: row.manufacturer_id,
    user_id: row.user_id,
    action: "partner_login",
    entity_type: "manufacturer_user",
    entity_id: row.user_id,
  });

  return jwt;
}

async function completeApplicantAuthLogin(env, row) {
  await getManufacturerDb(env)
    .prepare(`UPDATE partner_application_tokens SET used_at = ? WHERE id = ?`)
    .bind(Date.now(), row.id)
    .run();

  return signPartnerApplicantSession(env, {
    application_id: row.application_id,
    email: row.email,
  });
}

export async function handlePartnerAuthVerify(request, env) {
  const cors = getCorsHeaders(request);
  const db = getManufacturerDb(env);
  if (!db) {
    const u = manufacturerDbUnavailable(cors);
    return json(u.body, u.status, cors);
  }
  await ensureManufacturerSchema(env);

  const url = new URL(request.url);
  const rawToken = await readVerifyToken(request, url);
  if (!rawToken) {
    return respondVerifyFailure(env, request, url, cors, "token_required");
  }

  const { lookupPartnerApplicationMagicLinkToken } = await import("./partnerApplicationService.js");
  const applicantRow = await lookupPartnerApplicationMagicLinkToken(db, rawToken);
  const manufacturerRow = applicantRow ? null : await lookupPartnerAuthToken(db, rawToken);
  const row = applicantRow || manufacturerRow;
  const verifyMode = applicantRow ? "applicant" : "full";

  const status = authTokenStatus(row);
  if (status !== "valid") {
    return respondVerifyFailure(env, request, url, cors, status);
  }

  const shouldConsume =
    request.method === "POST" || (wantsJsonVerifyResponse(request, url) && url.searchParams.get("confirm") === "1");

  if (!shouldConsume) {
    const html = renderMagicLinkConfirmPage({
      actionPath: "/auth/verify",
      token: rawToken,
      title: verifyMode === "applicant" ? "Confirm sign-in" : "Confirm sign-in",
      lead:
        verifyMode === "applicant"
          ? "Click below to view your partner application status. This step stops email scanners from using your link before you do."
          : "Click below to open the Eazpire Partner Portal. This step stops email scanners from using your link before you do.",
      buttonLabel: verifyMode === "applicant" ? "View application status" : "Sign in to Partner Portal",
    });
    return new Response(html, {
      status: 200,
      headers: { ...cors, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const jwt =
    verifyMode === "applicant"
      ? await completeApplicantAuthLogin(env, row)
      : await completePartnerAuthLogin(env, row);

  await markPartnerLoginPollVerified(env, rawToken, jwt, verifyMode);

  const headers = {
    ...cors,
    "Set-Cookie": sessionCookieHeader(partnerCookieName(), jwt),
  };

  const redirectTo =
    verifyMode === "applicant" ? `${partnerBaseUrl(env)}/application-status` : `${partnerBaseUrl(env)}/`;

  if (wantsJsonVerifyResponse(request, url)) {
    const body =
      verifyMode === "applicant"
        ? { ok: true, mode: "applicant", application_id: row.application_id, status: row.application_status }
        : { ok: true, mode: "full", manufacturer_id: row.manufacturer_id };
    return json(body, 200, headers);
  }

  return redirectWithHeaders(redirectTo, 302, headers);
}

export async function handlePartnerAuthLogout(request, env) {
  const cors = getCorsHeaders(request);
  return json(
    { ok: true },
    200,
    { ...cors, "Set-Cookie": clearSessionCookieHeader(partnerCookieName()) }
  );
}

export async function handlePartnerAuthMe(request, env) {
  const cors = getCorsHeaders(request);
  const { requirePartnerSession } = await import("./rbac.js");
  const auth = await requirePartnerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, cors);

  if (auth.mode === "applicant") {
    const db = getManufacturerDb(env);
    if (!db) {
      const u = manufacturerDbUnavailable(cors);
      return json(u.body, u.status, cors);
    }
    const { getPartnerApplicationById } = await import("./partnerApplicationService.js");
    const application = await getPartnerApplicationById(db, auth.application_id);
    return json(
      {
        ok: true,
        session: {
          mode: "applicant",
          application_id: auth.application_id,
          email: auth.email,
          application,
        },
      },
      200,
      cors
    );
  }

  return json({ ok: true, session: { mode: "full", ...auth } }, 200, cors);
}

export async function handlePartnerApplicationVerify(request, env) {
  const cors = getCorsHeaders(request);
  const db = getManufacturerDb(env);
  if (!db) {
    const u = manufacturerDbUnavailable(cors);
    return json(u.body, u.status, cors);
  }
  await ensureManufacturerSchema(env);

  const url = new URL(request.url);
  const rawToken = await readVerifyToken(request, url);
  if (!rawToken) {
    return respondVerifyFailure(env, request, url, cors, "token_required");
  }

  const { lookupPartnerApplicationEmailToken, finalizePartnerApplicationEmailVerification } = await import(
    "./partnerApplicationService.js"
  );
  const row = await lookupPartnerApplicationEmailToken(db, rawToken);
  const status = authTokenStatus(row);
  if (status !== "valid") {
    return respondVerifyFailure(env, request, url, cors, status);
  }

  const shouldConsume =
    request.method === "POST" || (wantsJsonVerifyResponse(request, url) && url.searchParams.get("confirm") === "1");

  if (!shouldConsume) {
    const html = renderMagicLinkConfirmPage({
      actionPath: "/auth/verify-application",
      token: rawToken,
      title: "Confirm your email",
      lead: "Click below to verify your partner application email. This step stops email scanners from using your link before you do.",
      buttonLabel: "Verify email address",
    });
    return new Response(html, {
      status: 200,
      headers: { ...cors, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const result = await finalizePartnerApplicationEmailVerification(env, row);
  if (!result.ok) {
    return respondVerifyFailure(env, request, url, cors, result.reason || "invalid_or_expired_token");
  }

  const jwt = await signPartnerApplicantSession(env, {
    application_id: result.application.id,
    email: result.application.email,
  });

  const headers = {
    ...cors,
    "Set-Cookie": sessionCookieHeader(partnerCookieName(), jwt),
  };

  if (wantsJsonVerifyResponse(request, url)) {
    return json({ ok: true, application_id: result.application.id, status: result.application.status }, 200, headers);
  }

  return redirectWithHeaders(`${partnerBaseUrl(env)}/application-status`, 302, headers);
}
