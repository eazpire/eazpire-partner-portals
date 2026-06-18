/**
 * Admin partner network board — tabbed pending / approved / rejected / suspended / blocked
 */

import { rowToManufacturer } from "./db.js";
import { normalizePartnerEmail } from "./partnerEmailBlocks.js";

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

function rowToBlock(row) {
  if (!row) return null;
  return {
    email: row.email,
    blocked_at: row.blocked_at,
    blocked_by: row.blocked_by,
    reason: row.reason,
  };
}

async function getPartnerPriorHistory(db, email, excludeApplicationId) {
  const normalized = normalizePartnerEmail(email);
  if (!normalized) return [];

  const events = [];

  let rejectSql = `
    SELECT id, company_name, rejection_reason, reviewed_at
    FROM partner_applications
    WHERE lower(email) = ? AND status = 'rejected'`;
  const rejectBinds = [normalized];
  if (excludeApplicationId) {
    rejectSql += ` AND id != ?`;
    rejectBinds.push(excludeApplicationId);
  }
  rejectSql += ` ORDER BY reviewed_at DESC LIMIT 10`;

  const rejections = await db.prepare(rejectSql).bind(...rejectBinds).all();
  for (const row of rejections.results || []) {
    if (!row.reviewed_at) continue;
    events.push({
      type: "rejected",
      at: row.reviewed_at,
      reason: row.rejection_reason || null,
      company_name: row.company_name || null,
      application_id: row.id,
    });
  }

  const suspensions = await db
    .prepare(
      `SELECT m.id, m.name, m.suspend_reason, m.suspended_at, m.status
       FROM manufacturers m
       INNER JOIN manufacturer_users mu ON mu.manufacturer_id = m.id
       WHERE lower(mu.email) = ? AND m.suspended_at IS NOT NULL
       ORDER BY m.suspended_at DESC
       LIMIT 10`
    )
    .bind(normalized)
    .all();

  for (const row of suspensions.results || []) {
    events.push({
      type: "suspended",
      at: row.suspended_at,
      reason: row.suspend_reason || null,
      company_name: row.name || null,
      manufacturer_id: row.id,
      manufacturer_status: row.status,
    });
  }

  events.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  return events;
}

async function enrichManufacturersWithOwnerEmail(db, rows) {
  const out = [];
  for (const row of rows) {
    const owner = await db
      .prepare(
        `SELECT email FROM manufacturer_users WHERE manufacturer_id = ? ORDER BY created_at ASC LIMIT 1`
      )
      .bind(row.id)
      .first();
    out.push({
      ...rowToManufacturer(row),
      owner_email: owner?.email || row.support_email || row.business_email || null,
    });
  }
  return out;
}

export async function adminGetPartnerNetworkBoard(db) {
  const pendingRows = await db
    .prepare(
      `SELECT * FROM partner_applications
       WHERE status IN ('pending_email_verification', 'pending_review')
       ORDER BY updated_at DESC
       LIMIT 200`
    )
    .all();

  const pending = [];
  for (const row of pendingRows.results || []) {
    const app = rowToApplication(row);
    app.prior_history = await getPartnerPriorHistory(db, app.email, app.id);
    pending.push(app);
  }

  const approvedRows = await db
    .prepare(
      `SELECT * FROM manufacturers
       WHERE status IN ('verified', 'approved_for_test')
       ORDER BY updated_at DESC
       LIMIT 200`
    )
    .all();
  const approved = await enrichManufacturersWithOwnerEmail(db, approvedRows.results || []);

  const rejectedRows = await db
    .prepare(
      `SELECT * FROM partner_applications
       WHERE status = 'rejected'
       ORDER BY reviewed_at DESC
       LIMIT 200`
    )
    .all();
  const rejected = (rejectedRows.results || []).map(rowToApplication);

  const suspendedRows = await db
    .prepare(
      `SELECT * FROM manufacturers
       WHERE status = 'suspended'
       ORDER BY COALESCE(suspended_at, updated_at) DESC
       LIMIT 200`
    )
    .all();
  const suspended = await enrichManufacturersWithOwnerEmail(db, suspendedRows.results || []);

  const blockedRows = await db
    .prepare(`SELECT * FROM partner_email_blocks ORDER BY blocked_at DESC LIMIT 200`)
    .all();
  const blocked = (blockedRows.results || []).map(rowToBlock);

  return {
    counts: {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      suspended: suspended.length,
      blocked: blocked.length,
    },
    pending,
    approved,
    rejected,
    suspended,
    blocked,
  };
}
