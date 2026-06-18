/**
 * Fallback static assets when PARTNER_ASSETS binding is unavailable (local dev / tests).
 * Populated by scripts/utils/sync-partner-static.js
 */

import { PARTNER_STATIC_BUNDLE } from "./partnerStaticBundle.js";

export function getPartnerStaticFallback(key) {
  const entry = PARTNER_STATIC_BUNDLE[key];
  if (!entry) return null;
  return { contentType: entry.contentType, body: entry.body };
}
