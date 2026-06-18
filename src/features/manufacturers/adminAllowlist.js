/**
 * Admin email allowlist for worker-native admin portals (no Shopify login).
 */

/** Comma/semicolon/newline-separated allowlist from ADMIN_OWNER_EMAILS. */
export function getAdminAllowedEmails(env) {
  const raw = String(env.ADMIN_OWNER_EMAILS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;|\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export function isAdminEmail(email, env) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return getAdminAllowedEmails(env).includes(normalized);
}

/** Audit actor id for email-based admin sessions (first Shopify admin owner id). */
export function resolveAdminActorId(env) {
  const ids = String(env.ADMIN_OWNER_IDS || "9415375946010")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids[0] || "admin";
}
