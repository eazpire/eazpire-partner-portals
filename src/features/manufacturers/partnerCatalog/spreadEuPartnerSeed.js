/**
 * Catalog Studio Spreadshirt parent + Spread EU / Spread US fulfillment providers.
 * Spread EU and Spread US are not top-level partners (IDEA-085).
 */

import { upsertFulfillmentProvider } from "./fulfillmentProviderService.js";
import {
  SPREADSHIRT_DISPLAY_NAME,
  SPREADSHIRT_PARTNER_ID,
  SPREADSHIRT_PARTNER_SLUG,
  SPREADSHIRT_WEBSITE,
  SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
  SPREAD_EU_ICON_URL,
  SPREAD_EU_LOCATION_ID,
  SPREAD_EU_PARTNER_ID,
  SPREAD_EU_PARTNER_SLUG,
  SPREAD_EU_PROVIDER_DISPLAY_NAME,
  SPREAD_US_FULFILLMENT_EXTERNAL_ID,
  SPREAD_US_ICON_URL,
  SPREAD_US_LOCATION_ID,
  SPREAD_US_PARTNER_ID,
  SPREAD_US_PARTNER_SLUG,
  SPREAD_US_PROVIDER_DISPLAY_NAME,
} from "./constants.js";

async function safeRun(db, sql, ...binds) {
  try {
    const stmt = db.prepare(sql);
    return binds.length ? await stmt.bind(...binds).run() : await stmt.run();
  } catch {
    return null;
  }
}

export async function ensureSpreadshirtPartner(db) {
  const existing = await db
    .prepare(`SELECT id FROM manufacturers WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(SPREADSHIRT_PARTNER_ID, SPREADSHIRT_PARTNER_SLUG)
    .first();
  if (existing?.id) {
    await safeRun(
      db,
      `UPDATE manufacturers SET name = ?, slug = ?, website = ?, updated_at = ? WHERE id = ?`,
      SPREADSHIRT_DISPLAY_NAME,
      SPREADSHIRT_PARTNER_SLUG,
      SPREADSHIRT_WEBSITE,
      Date.now(),
      existing.id
    );
    return existing.id;
  }

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturers
        (id, name, legal_name, slug, country, website, status, integration_type,
         quality_score, delivery_score, support_score, artifact_ready_score, created_at, updated_at)
       VALUES (?, ?, 'Spread Group SE', ?, 'DE', ?, 'verified', 'api', 0, 0, 0, 0, ?, ?)`
    )
    .bind(
      SPREADSHIRT_PARTNER_ID,
      SPREADSHIRT_DISPLAY_NAME,
      SPREADSHIRT_PARTNER_SLUG,
      SPREADSHIRT_WEBSITE,
      now,
      now
    )
    .run();
  return SPREADSHIRT_PARTNER_ID;
}

/** @deprecated Spread EU is a provider under Spreadshirt — returns the parent manufacturer id. */
export async function ensureSpreadEuPartner(db) {
  return ensureSpreadshirtPartner(db);
}

async function ensureLocation(db, { id, manufacturerId, label, country, city, shipsTo }) {
  const now = Date.now();

  const byId = await db
    .prepare(`SELECT id FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();
  if (byId?.id) {
    await safeRun(
      db,
      `UPDATE manufacturer_locations
       SET manufacturer_id = ?, label = ?, country = ?, city = ?, ships_to_json = ?, updated_at = ?
       WHERE id = ?`,
      manufacturerId,
      label,
      country,
      city,
      JSON.stringify(shipsTo),
      now,
      id
    );
    return id;
  }

  const byName = await db
    .prepare(
      `SELECT id FROM manufacturer_locations
       WHERE manufacturer_id = ? AND label = ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .bind(manufacturerId, label)
    .first();
  if (byName?.id) return byName.id;

  await db
    .prepare(
      `INSERT INTO manufacturer_locations
        (id, manufacturer_id, label, country, region, city, postal_code, ships_to_json,
         production_days_min, production_days_max, return_address_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 2, 5, NULL, 'active', ?, ?)`
    )
    .bind(id, manufacturerId, label, country, city, JSON.stringify(shipsTo), now, now)
    .run();
  return id;
}

async function archiveHiddenSpreadManufacturers(db) {
  const now = Date.now();
  for (const [id, slug] of [
    [SPREAD_EU_PARTNER_ID, SPREAD_EU_PARTNER_SLUG],
    [SPREAD_US_PARTNER_ID, SPREAD_US_PARTNER_SLUG],
  ]) {
    await safeRun(
      db,
      `UPDATE manufacturers SET status = 'archived', updated_at = ? WHERE id = ? OR slug = ?`,
      now,
      id,
      slug
    );
  }
}

async function migrateLegacySpreadEuOntoSpreadshirt(db, spreadshirtId) {
  const now = Date.now();
  await safeRun(
    db,
    `UPDATE manufacturer_locations SET manufacturer_id = ?, updated_at = ? WHERE manufacturer_id = ?`,
    spreadshirtId,
    now,
    SPREAD_EU_PARTNER_ID
  );
  await safeRun(
    db,
    `UPDATE manufacturer_fulfillment_providers SET manufacturer_id = ?, updated_at = ?
     WHERE manufacturer_id = ? OR external_provider_id = ?`,
    spreadshirtId,
    now,
    SPREAD_EU_PARTNER_ID,
    SPREAD_EU_FULFILLMENT_EXTERNAL_ID
  );
  await safeRun(
    db,
    `UPDATE eazpire_products SET manufacturer_id = ?, updated_at = ? WHERE manufacturer_id = ?`,
    spreadshirtId,
    now,
    SPREAD_EU_PARTNER_ID
  );
  await safeRun(
    db,
    `UPDATE manufacturer_provider_blueprints SET manufacturer_id = ?, updated_at = ? WHERE manufacturer_id = ?`,
    spreadshirtId,
    now,
    SPREAD_EU_PARTNER_ID
  );
  await safeRun(
    db,
    `UPDATE manufacturer_eazpire_blueprints SET manufacturer_id = ?, updated_at = ? WHERE manufacturer_id = ?`,
    spreadshirtId,
    now,
    SPREAD_EU_PARTNER_ID
  );
}

/**
 * @param {any} db MANUFACTURER_DB
 * @returns {Promise<{
 *   partner_id: string,
 *   fulfillment_provider: object,
 *   us_fulfillment_provider: object,
 *   location_id: string,
 *   us_location_id: string
 * }>}
 */
export async function ensureSpreadshirtPartnerSetup(db) {
  const partnerId = await ensureSpreadshirtPartner(db);
  await migrateLegacySpreadEuOntoSpreadshirt(db, partnerId);
  await archiveHiddenSpreadManufacturers(db);

  const euLocationId = await ensureLocation(db, {
    id: SPREAD_EU_LOCATION_ID,
    manufacturerId: partnerId,
    label: SPREAD_EU_PROVIDER_DISPLAY_NAME,
    country: "DE",
    city: "Leipzig",
    shipsTo: ["EU"],
  });
  const usLocationId = await ensureLocation(db, {
    id: SPREAD_US_LOCATION_ID,
    manufacturerId: partnerId,
    label: SPREAD_US_PROVIDER_DISPLAY_NAME,
    country: "US",
    city: "Greensburg",
    shipsTo: ["US"],
  });

  const euLoc = await db
    .prepare(`SELECT label, country, city FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(euLocationId)
    .first();
  const usLoc = await db
    .prepare(`SELECT label, country, city FROM manufacturer_locations WHERE id = ? LIMIT 1`)
    .bind(usLocationId)
    .first();

  const euName = String(euLoc?.label || "").trim() || SPREAD_EU_PROVIDER_DISPLAY_NAME;
  const usName = String(usLoc?.label || "").trim() || SPREAD_US_PROVIDER_DISPLAY_NAME;

  const fulfillmentProvider = await upsertFulfillmentProvider(db, partnerId, {
    integration_system: "spreadconnect",
    external_provider_id: SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
    name: euName,
    location: {
      country: euLoc?.country || "DE",
      city: euLoc?.city || "Leipzig",
      logo_url: SPREAD_EU_ICON_URL,
      location_id: euLocationId,
    },
    ships_to: ["EU"],
    production_days_min: 2,
    production_days_max: 5,
    status: "active",
  });

  const usFulfillmentProvider = await upsertFulfillmentProvider(db, partnerId, {
    integration_system: "spreadconnect",
    external_provider_id: SPREAD_US_FULFILLMENT_EXTERNAL_ID,
    name: usName,
    location: {
      country: usLoc?.country || "US",
      city: usLoc?.city || "Greensburg",
      logo_url: SPREAD_US_ICON_URL,
      location_id: usLocationId,
    },
    ships_to: ["US"],
    production_days_min: 2,
    production_days_max: 5,
    status: "catalog",
  });

  return {
    partner_id: partnerId,
    fulfillment_provider: fulfillmentProvider,
    us_fulfillment_provider: usFulfillmentProvider,
    location_id: euLocationId,
    us_location_id: usLocationId,
  };
}

/** @deprecated use ensureSpreadshirtPartnerSetup */
export async function ensureSpreadEuPartnerSetup(db) {
  return ensureSpreadshirtPartnerSetup(db);
}
