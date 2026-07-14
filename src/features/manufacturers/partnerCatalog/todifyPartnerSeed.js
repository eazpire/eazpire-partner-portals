/**
 * Ensure Todify system partner + fulfillment provider exist (dogfood).
 *
 * Catalog Studio print-provider labels come from manufacturer_fulfillment_providers.name,
 * which follows the company location label (source of truth).
 */

import { upsertFulfillmentProvider } from "./fulfillmentProviderService.js";
import {
  TODIFY_FULFILLMENT_EXTERNAL_ID,
  TODIFY_ICON_URL,
  TODIFY_LOCATION_ID,
  TODIFY_PARTNER_ID,
  TODIFY_PARTNER_SLUG,
  TODIFY_PRINT_PROVIDER_DISPLAY_NAME,
} from "./constants.js";

/** Old dogfood placeholder — rewrite once to the confirmed Catalog Studio name. */
const LEGACY_TODIFY_LOCATION_LABEL = /^(todify(\s+morocco)?)$/i;

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

function needsLegacyLabelRewrite(label) {
  const t = String(label || "").trim();
  return !t || LEGACY_TODIFY_LOCATION_LABEL.test(t);
}

/**
 * Resolve / create the company location whose name drives the Catalog Studio label.
 * Prefers an existing partner location over inserting a duplicate.
 * @param {any} db
 * @param {string} partnerId
 */
async function ensureTodifyLocation(db, partnerId) {
  const now = Date.now();

  const byId = await db
    .prepare(`SELECT id, label FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(TODIFY_LOCATION_ID)
    .first();
  if (byId?.id) {
    if (needsLegacyLabelRewrite(byId.label)) {
      await db
        .prepare(`UPDATE manufacturer_locations SET label = ?, updated_at = ? WHERE id = ?`)
        .bind(TODIFY_PRINT_PROVIDER_DISPLAY_NAME, now, TODIFY_LOCATION_ID)
        .run();
    }
    return TODIFY_LOCATION_ID;
  }

  const byPreferredName = await db
    .prepare(
      `SELECT id FROM manufacturer_locations
       WHERE manufacturer_id = ? AND label = ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .bind(partnerId, TODIFY_PRINT_PROVIDER_DISPLAY_NAME)
    .first();
  if (byPreferredName?.id) return byPreferredName.id;

  const byCountry = await db
    .prepare(
      `SELECT id, label FROM manufacturer_locations
       WHERE manufacturer_id = ? AND UPPER(COALESCE(country, '')) IN ('MA', 'MOROCCO')
       ORDER BY created_at ASC LIMIT 1`
    )
    .bind(partnerId)
    .first();
  if (byCountry?.id) {
    if (needsLegacyLabelRewrite(byCountry.label)) {
      await db
        .prepare(`UPDATE manufacturer_locations SET label = ?, updated_at = ? WHERE id = ?`)
        .bind(TODIFY_PRINT_PROVIDER_DISPLAY_NAME, now, byCountry.id)
        .run();
    }
    return byCountry.id;
  }

  await db
    .prepare(
      `INSERT INTO manufacturer_locations
        (id, manufacturer_id, label, country, region, city, postal_code, ships_to_json,
         production_days_min, production_days_max, return_address_json, status, created_at, updated_at)
       VALUES (?, ?, ?, 'MA', NULL, 'Casablanca', NULL, ?, 1, 3, NULL, 'active', ?, ?)`
    )
    .bind(
      TODIFY_LOCATION_ID,
      partnerId,
      TODIFY_PRINT_PROVIDER_DISPLAY_NAME,
      JSON.stringify(["MA"]),
      now,
      now
    )
    .run();
  return TODIFY_LOCATION_ID;
}

/**
 * @param {any} db MANUFACTURER_DB
 * @returns {Promise<{ partner_id: string, fulfillment_provider: object, location_id: string }>}
 */
export async function ensureTodifyPartnerSetup(db) {
  const partnerId = await ensureTodifyPartner(db);
  const locationId = await ensureTodifyLocation(db, partnerId);

  const locRow = await db
    .prepare(`SELECT label, country, city FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(locationId)
    .first();

  const displayName =
    String(locRow?.label || "").trim() || TODIFY_PRINT_PROVIDER_DISPLAY_NAME;

  const fulfillmentProvider = await upsertFulfillmentProvider(db, partnerId, {
    integration_system: "todify",
    external_provider_id: TODIFY_FULFILLMENT_EXTERNAL_ID,
    // Location name is the Catalog Studio print-provider label
    name: displayName,
    location: {
      country: locRow?.country || "MA",
      city: locRow?.city || "Casablanca",
      logo_url: TODIFY_ICON_URL,
      location_id: locationId,
    },
    ships_to: ["MA"],
    production_days_min: 1,
    production_days_max: 3,
    status: "active",
  });
  return { partner_id: partnerId, fulfillment_provider: fulfillmentProvider, location_id: locationId };
}
