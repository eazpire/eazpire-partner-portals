/**
 * Partner application flow: apply → email verify → pending review → approve/reject
 */

import { getManufacturerDb, newId } from "./db.js";
import { hashToken, magicLinkExpiry, writeAuditLog } from "./rbac.js";
import {
  sendPartnerApplicationConfirmEmail,
  sendPartnerApplicationRejectedEmail,
  sendPartnerApplicationApprovedEmail,
} from "./email.js";
import { adminCreateManufacturer } from "./manufacturerService.js";

const ACTIVE_APPLICATION_STATUSES = new Set([
  "pending_email_verification",
  "pending_review",
]);

function partnerBaseUrl(env) {
  return String(env.PARTNER_PORTAL_URL || "https://partner.eazpire.com").replace(/\/$/, "");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function rowToApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_name: row.company_name,
    contact_name: row.contact_name,
    email: row.email,
    country: row.country,
    website: row.website,
    product_types: row.product_types,
    capabilities: row.capabilities,
    message: row.message,
    status: row.status,
    rejection_reason: row.rejection_reason,
    manufacturer_id: row.manufacturer_id,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    email_verified_at: row.email_verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getPartnerApplicationById(db, applicationId) {
  const row = await db
    .prepare(`SELECT * FROM partner_applications WHERE id = ?`)
    .bind(applicationId)
    .first();
  return rowToApplication(row);
}

async function existingManufacturerUser(db, email) {
  return db
    .prepare(
      `SELECT mu.*, m.status AS manufacturer_status
       FROM manufacturer_users mu
       JOIN manufacturers m ON m.id = mu.manufacturer_id
       WHERE lower(mu.email) = ? AND mu.status = 'active'
       LIMIT 1`
    )
    .bind(email)
    .first();
}

async function findActiveApplication(db, email) {
  return db
    .prepare(
      `SELECT * FROM partner_applications
       WHERE lower(email) = ? AND status IN ('pending_email_verification', 'pending_review')
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(email)
    .first();
}

/** Latest application eligible for applicant magic-link login. */
export async function findApplicationForMagicLink(db, email) {
  return db
    .prepare(
      `SELECT * FROM partner_applications
       WHERE lower(email) = ?
         AND status IN ('pending_email_verification', 'pending_review', 'rejected')
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(email)
    .first();
}

/** Create applicant magic-link token (status page access). */
export async function issueApplicantMagicLinkToken(db, applicationId) {
  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await hashToken(rawToken);
  const tokenId = newId("patok");
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO partner_application_tokens
        (id, application_id, token_hash, token_type, expires_at, created_at)
       VALUES (?, ?, ?, 'magic_link', ?, ?)`
    )
    .bind(tokenId, applicationId, tokenHash, magicLinkExpiry(), now)
    .run();

  return rawToken;
}

/** Look up applicant magic-link token without consuming it. */
export async function lookupPartnerApplicationMagicLinkToken(db, rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;

  const tokenHash = await hashToken(token);
  return db
    .prepare(
      `SELECT t.*, a.email, a.id AS application_id, a.status AS application_status
       FROM partner_application_tokens t
       JOIN partner_applications a ON a.id = t.application_id
       WHERE t.token_hash = ? AND t.token_type = 'magic_link'
       LIMIT 1`
    )
    .bind(tokenHash)
    .first();
}

async function issueEmailVerificationToken(db, applicationId) {
  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await hashToken(rawToken);
  const tokenId = newId("patok");
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO partner_application_tokens
        (id, application_id, token_hash, token_type, expires_at, created_at)
       VALUES (?, ?, ?, 'email_verify', ?, ?)`
    )
    .bind(tokenId, applicationId, tokenHash, magicLinkExpiry(), now)
    .run();

  return rawToken;
}

/** Submit a new partner application (public). */
export async function submitPartnerApplication(env, input) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, reason: "manufacturer_db_unavailable" };

  const email = normalizeEmail(input.email);
  const companyName = String(input.company_name || "").trim();
  const contactName = String(input.contact_name || "").trim();
  const country = String(input.country || "").trim();

  if (!email || !email.includes("@")) return { ok: false, reason: "invalid_email" };
  if (!companyName) return { ok: false, reason: "company_name_required" };

  const { isPartnerEmailBlocked } = await import("./partnerEmailBlocks.js");
  if (await isPartnerEmailBlocked(db, email)) {
    return { ok: false, reason: "email_blocked" };
  }
  if (!contactName) return { ok: false, reason: "contact_name_required" };
  if (!country) return { ok: false, reason: "country_required" };

  const existingUser = await existingManufacturerUser(db, email);
  if (existingUser) {
    return { ok: true, sent: true, already_partner: true };
  }

  const now = Date.now();
  let application = await findActiveApplication(db, email);

  if (application) {
    if (application.status === "pending_review") {
      return { ok: true, sent: true, already_submitted: true };
    }
    await db
      .prepare(
        `UPDATE partner_applications SET
          company_name = ?, contact_name = ?, country = ?, website = ?,
          product_types = ?, capabilities = ?, message = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        companyName,
        contactName,
        country,
        input.website || null,
        input.product_types || null,
        input.capabilities || null,
        input.message || null,
        now,
        application.id
      )
      .run();
    application = await getPartnerApplicationById(db, application.id);
  } else {
    const id = newId("papp");
    await db
      .prepare(
        `INSERT INTO partner_applications
          (id, company_name, contact_name, email, country, website, product_types,
           capabilities, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_email_verification', ?, ?)`
      )
      .bind(
        id,
        companyName,
        contactName,
        email,
        country,
        input.website || null,
        input.product_types || null,
        input.capabilities || null,
        input.message || null,
        now,
        now
      )
      .run();
    application = await getPartnerApplicationById(db, id);
  }

  const rawToken = await issueEmailVerificationToken(db, application.id);
  const verifyUrl = `${partnerBaseUrl(env)}/auth/verify-application?token=${encodeURIComponent(rawToken)}`;
  const mail = await sendPartnerApplicationConfirmEmail(env, { to: email, verifyUrl, companyName });
  if (!mail.ok && !mail.skipped) {
    console.error("[partner-application] confirm email failed", mail.error, mail.detail || "");
    return { ok: false, reason: mail.error || "email_failed", detail: mail.detail };
  }

  return { ok: true, sent: true, application_id: application.id };
}

/** Look up application email token without consuming it. */
export async function lookupPartnerApplicationEmailToken(db, rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;

  const tokenHash = await hashToken(token);
  return db
    .prepare(
      `SELECT t.*, a.email, a.status AS application_status
       FROM partner_application_tokens t
       JOIN partner_applications a ON a.id = t.application_id
       WHERE t.token_hash = ? AND t.token_type = 'email_verify'
       LIMIT 1`
    )
    .bind(tokenHash)
    .first();
}

/** Consume a validated application email token and return the application. */
export async function finalizePartnerApplicationEmailVerification(env, row) {
  const db = getManufacturerDb(env);
  if (!db || !row) return { ok: false, reason: "invalid_or_expired_token" };

  const now = Date.now();
  await db
    .prepare(`UPDATE partner_application_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .bind(now, row.id)
    .run();

  if (row.application_status === "pending_email_verification") {
    await db
      .prepare(
        `UPDATE partner_applications
         SET status = 'pending_review', email_verified_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(now, now, row.application_id)
      .run();
  }

  const application = await getPartnerApplicationById(db, row.application_id);
  return { ok: true, application };
}

/** Verify email token; returns application row on success. */
export async function verifyPartnerApplicationEmail(env, rawToken) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, reason: "manufacturer_db_unavailable" };

  const token = String(rawToken || "").trim();
  if (!token) return { ok: false, reason: "token_required" };

  const row = await lookupPartnerApplicationEmailToken(db, token);
  if (!row || row.used_at || Number(row.expires_at) <= Date.now()) {
    return { ok: false, reason: row?.used_at ? "token_already_used" : "invalid_or_expired_token" };
  }

  return finalizePartnerApplicationEmailVerification(env, row);
}

export async function adminListPartnerApplications(db, { status, limit = 100 } = {}) {
  let sql = `SELECT * FROM partner_applications`;
  const binds = [];
  if (status) {
    sql += ` WHERE status = ?`;
    binds.push(status);
  } else {
    sql += ` WHERE status IN ('pending_email_verification', 'pending_review', 'approved', 'rejected')`;
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map(rowToApplication);
}

export async function adminApprovePartnerApplication(env, applicationId, adminOwnerId) {
  const db = getManufacturerDb(env);
  const application = await getPartnerApplicationById(db, applicationId);
  if (!application) return { ok: false, reason: "not_found" };
  if (application.status !== "pending_review") return { ok: false, reason: "invalid_status" };

  const email = normalizeEmail(application.email);
  const existingUser = await existingManufacturerUser(db, email);
  let manufacturerId = existingUser?.manufacturer_id || null;

  if (!manufacturerId) {
    const manufacturer = await adminCreateManufacturer(
      env,
      {
        name: application.company_name,
        legal_name: application.company_name,
        owner_email: email,
        country: application.country,
        website: application.website,
        support_email: email,
        business_email: email,
      },
      adminOwnerId,
      { skipMagicLink: true }
    );
    manufacturerId = manufacturer.id;
  }

  const now = Date.now();
  await db
    .prepare(
      `UPDATE partner_applications
       SET status = 'approved', manufacturer_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(manufacturerId, adminOwnerId, now, now, applicationId)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: adminOwnerId,
    action: "partner_application_approved",
    entity_type: "partner_application",
    entity_id: applicationId,
    after_json: { email, manufacturer_id: manufacturerId },
  });

  const { issuePartnerMagicLink } = await import("./partnerAuth.js");
  const mail = await issuePartnerMagicLink(env, email, {
    mailFn: sendPartnerApplicationApprovedEmail,
    mailContext: { companyName: application.company_name },
  });
  if (!mail.ok && !mail.skipped) {
    console.error("[partner-application] approval email failed", mail.error, mail.detail || "");
  }

  return {
    ok: true,
    application: await getPartnerApplicationById(db, applicationId),
    manufacturer_id: manufacturerId,
  };
}

export async function adminRejectPartnerApplication(env, applicationId, adminOwnerId, reason) {
  const db = getManufacturerDb(env);
  const application = await getPartnerApplicationById(db, applicationId);
  if (!application) return { ok: false, reason: "not_found" };
  if (!ACTIVE_APPLICATION_STATUSES.has(application.status)) {
    if (application.status === "rejected") return { ok: true, application };
    return { ok: false, reason: "invalid_status" };
  }

  const now = Date.now();
  const rejectionReason = String(reason || "").trim() || null;
  await db
    .prepare(
      `UPDATE partner_applications
       SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(rejectionReason, adminOwnerId, now, now, applicationId)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: application.manufacturer_id,
    user_id: adminOwnerId,
    action: "partner_application_rejected",
    entity_type: "partner_application",
    entity_id: applicationId,
    after_json: { rejection_reason: rejectionReason },
  });

  let statusUrl = null;
  try {
    const rawToken = await issueApplicantMagicLinkToken(db, applicationId);
    statusUrl = `${partnerBaseUrl(env)}/auth/verify?token=${encodeURIComponent(rawToken)}`;
  } catch (e) {
    console.error("[partner-application] rejection status link failed", e);
  }

  const mail = await sendPartnerApplicationRejectedEmail(env, {
    to: application.email,
    companyName: application.company_name,
    reason: rejectionReason,
    statusUrl,
  });
  if (!mail.ok && !mail.skipped) {
    console.error("[partner-application] rejection email failed", mail.error);
  }

  return { ok: true, application: await getPartnerApplicationById(db, applicationId) };
}
