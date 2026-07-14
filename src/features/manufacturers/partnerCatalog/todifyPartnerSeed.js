/**
 * Ensure Todify system partner + Morocco fulfillment provider exist (dogfood).
 */

import { upsertFulfillmentProvider } from "./fulfillmentProviderService.js";
import {
  TODIFY_FULFILLMENT_EXTERNAL_ID,
  TODIFY_ICON_URL,
  TODIFY_PARTNER_ID,
  TODIFY_PARTNER_SLUG,
  TODIFY_PROVIDER_DISPLAY_NAME,
} from "./constants.js";

export async function ensureTodifyPartner(db) {
  const existing = await db
    .prepare(`SELECT id FROM manufacturers WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(TODIFY_PARTNER_ID, TODIFY_PARTNER_SLUG)
    .first();
  if (existing?.id) return existing.id;

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturers
        (id, name, legal_name, slug, country, website, status, integration_type,
         quality_score, delivery_score, support_score, artifact_ready_score, created_at, updated_at)
       VALUES (?, 'Todify', 'Todify', ?, 'MA', 'https://todify.ma', 'verified', 'portal', 0, 0, 0, 0, ?, ?)`
    )
    .bind(TODIFY_PARTNER_ID, TODIFY_PARTNER_SLUG, now, now)
    .run();
  return TODIFY_PARTNER_ID;
}

/**
 * @param {any} db MANUFACTURER_DB
 * @returns {Promise<{ partner_id: string, fulfillment_provider: object }>}
 */
export async function ensureTodifyPartnerSetup(db) {
  const partnerId = await ensureTodifyPartner(db);
  const fulfillmentProvider = await upsertFulfillmentProvider(db, partnerId, {
    integration_system: "todify",
    external_provider_id: TODIFY_FULFILLMENT_EXTERNAL_ID,
    name: `${TODIFY_PROVIDER_DISPLAY_NAME} Morocco`,
    // logo_url from todify.ma CloudFront (apple-touch icon for Catalog Studio avatars)
    location: { country: "MA", city: "Casablanca", logo_url: TODIFY_ICON_URL },
    ships_to: ["MA"],
    production_days_min: 1,
    production_days_max: 3,
    status: "active",
  });
  return { partner_id: partnerId, fulfillment_provider: fulfillmentProvider };
}
