/**
 * Blocked emails — prevent partner applications and magic-link login
 */

export function normalizePartnerEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export async function isPartnerEmailBlocked(db, email) {
  const normalized = normalizePartnerEmail(email);
  if (!normalized) return false;
  const row = await db
    .prepare(`SELECT email FROM partner_email_blocks WHERE email = ? LIMIT 1`)
    .bind(normalized)
    .first();
  return !!row;
}

export async function blockPartnerEmail(db, email, blockedBy = null, reason = null) {
  const normalized = normalizePartnerEmail(email);
  if (!normalized) return false;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO partner_email_blocks (email, blocked_at, blocked_by, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         blocked_at = excluded.blocked_at,
         blocked_by = excluded.blocked_by,
         reason = excluded.reason`
    )
    .bind(normalized, now, blockedBy, reason)
    .run();
  return true;
}
