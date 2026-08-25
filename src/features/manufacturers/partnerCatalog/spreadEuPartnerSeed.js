/**
 * Ensure Spread EU (Spread Connect) system partner + fulfillment provider exist.
 */

import { upsertFulfillmentProvider } from "./fulfillmentProviderService.js";
import {
  SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
  SPREAD_EU_ICON_URL,
  SPREAD_EU_LOCATION_ID,
  SPREAD_EU_PARTNER_ID,
  SPREAD_EU_PARTNER_SLUG,
  SPREAD_EU_PROVIDER_DISPLAY_NAME,
  SPREAD_EU_WEBSITE,
} from "./constants.js";

export async function ensureSpreadEuPartner(db) {
  const existing = await db
    .prepare(`SELECT id FROM manufacturers WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(SPREAD_EU_PARTNER_ID, SPREAD_EU_PARTNER_SLUG)
    .first();
  if (existing?.id) return existing.id;

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturers
        (id, name, legal_name, slug, country, website, status, integration_type,
         quality_score, delivery_score, support_score, artifact_ready_score, created_at, updated_at)
       VALUES (?, ?, 'Spread Group SE', ?, 'DE', ?, 'verified', 'api', 0, 0, 0, 0, ?, ?)`
    )
    .bind(
      SPREAD_EU_PARTNER_ID,
      SPREAD_EU_PROVIDER_DISPLAY_NAME,
      SPREAD_EU_PARTNER_SLUG,
      SPREAD_EU_WEBSITE,
      now,
      now
    )
    .run();
  return SPREAD_EU_PARTNER_ID;
}

async function ensureSpreadEuLocation(db, partnerId) {
  const now = Date.now();

  const byId = await db
    .prepare(`SELECT id FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(SPREAD_EU_LOCATION_ID)
    .first();
  if (byId?.id) return SPREAD_EU_LOCATION_ID;

  const byName = await db
    .prepare(
      `SELECT id FROM manufacturer_locations
       WHERE manufacturer_id = ? AND label = ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .bind(partnerId, SPREAD_EU_PROVIDER_DISPLAY_NAME)
    .first();
  if (byName?.id) return byName.id;

  await db
    .prepare(
      `INSERT INTO manufacturer_locations
        (id, manufacturer_id, label, country, region, city, postal_code, ships_to_json,
         production_days_min, production_days_max, return_address_json, status, created_at, updated_at)
       VALUES (?, ?, ?, 'DE', NULL, 'Leipzig', NULL, ?, 2, 5, NULL, 'active', ?, ?)`
    )
    .bind(
      SPREAD_EU_LOCATION_ID,
      partnerId,
      SPREAD_EU_PROVIDER_DISPLAY_NAME,
      JSON.stringify(["EU"]),
      now,
      now
    )
    .run();
  return SPREAD_EU_LOCATION_ID;
}

/**
 * @param {any} db MANUFACTURER_DB
 * @returns {Promise<{ partner_id: string, fulfillment_provider: object, location_id: string }>}
 */
export async function ensureSpreadEuPartnerSetup(db) {
  const partnerId = await ensureSpreadEuPartner(db);
  const locationId = await ensureSpreadEuLocation(db, partnerId);

  const locRow = await db
    .prepare(`SELECT label, country, city FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(locationId)
    .first();

  const displayName = String(locRow?.label || "").trim() || SPREAD_EU_PROVIDER_DISPLAY_NAME;

  const fulfillmentProvider = await upsertFulfillmentProvider(db, partnerId, {
    integration_system: "spreadconnect",
    external_provider_id: SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
    name: displayName,
    location: {
      country: locRow?.country || "DE",
      city: locRow?.city || "Leipzig",
      logo_url: SPREAD_EU_ICON_URL,
      location_id: locationId,
    },
    ships_to: ["EU"],
    production_days_min: 2,
    production_days_max: 5,
    status: "active",
  });
  return { partner_id: partnerId, fulfillment_provider: fulfillmentProvider, location_id: locationId };
}
