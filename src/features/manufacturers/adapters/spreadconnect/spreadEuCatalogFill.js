/**
 * D1 auto-fill for Spread EU Catalog Studio editor tabs (IDEA-085).
 * Markets, origin, mockups, prices, shipping (print_provider_id 910002), meta, creator preview.
 * Does not change Online/Offline or automations.
 */

import { newId } from "../../db.js";
import { regionCodesFromCountryCodes } from "../../../catalog/resolvePlanCountries.js";
import { ensureProductProviderShippingSchema, destinationLabel } from "../../../catalog/productProviderShipping.js";
import { PRODUCT_TIER_COST } from "../../../creatorJourney/unlockConstants.js";
import {
  OPAQUE_VARIANT_PROVIDER_IDS,
  SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
  SPREAD_EU_PROVIDER_DISPLAY_NAME,
  SPREAD_EU_SOURCE_SYSTEM,
} from "../../partnerCatalog/constants.js";
import {
  SPREAD_EU_COUNTRY_CODES as EU_CODES,
  SPREAD_EU_COUNTRY_OF_ORIGIN,
  SPREAD_EU_NO_SHIP_COUNTRY_CODES,
  SPREAD_EU_SHIPPABLE_COUNTRY_CODES,
  SPREAD_EU_SHIPPING_SYNC_SOURCE,
  SPREAD_EU_TODIFY_MARKET_EXCEPTION,
  spreadEuRateCentsForCountry,
  spreadEuShippingRatesForProduct,
  spreadEuTypeIdFromProductKey,
} from "./spreadEuCatalogMap.js";

export const SPREAD_EU_PRINT_PROVIDER_ID = OPAQUE_VARIANT_PROVIDER_IDS[SPREAD_EU_FULFILLMENT_EXTERNAL_ID];

async function upsertMockupRow(db, table, productKey, entry, now) {
  const viewKey = String(entry.view_key || "front").trim() || "front";
  const colorName = String(entry.color_name || "Default").trim() || "Default";
  const existing = await db
    .prepare(
      `SELECT id FROM ${table}
       WHERE product_key = ? AND print_provider_id = ? AND view_key = ? AND color_name = ?
         AND COALESCE(mockup_set, 'clean') = 'clean'
       LIMIT 1`
    )
    .bind(productKey, SPREAD_EU_PRINT_PROVIDER_ID, viewKey, colorName)
    .first()
    .catch(() => null);
  if (existing?.id) {
    await db
      .prepare(
        `UPDATE ${table} SET
          color_hex = ?, image_url = ?, printify_variant_ids = ?, is_default = COALESCE(is_default, ?)
         WHERE id = ?`
      )
      .bind(entry.color_hex || null, entry.image_url, entry.printify_variant_ids || null, entry.is_default || 0, existing.id)
      .run()
      .catch(() => {});
    return;
  }
  try {
    await db
      .prepare(
        `INSERT INTO ${table}
          (id, product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
           image_url, printify_variant_ids, is_default, mockup_set, created_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'clean', ?)`
      )
      .bind(
        newId("pmi"),
        productKey,
        SPREAD_EU_PRINT_PROVIDER_ID,
        viewKey,
        colorName,
        entry.color_hex || null,
        entry.image_url,
        entry.printify_variant_ids || null,
        entry.is_default || 0,
        now
      )
      .run();
  } catch {
    await db
      .prepare(
        `INSERT INTO ${table}
          (product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
           image_url, printify_variant_ids, is_default, mockup_set, created_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, 'clean', ?)`
      )
      .bind(
        productKey,
        SPREAD_EU_PRINT_PROVIDER_ID,
        viewKey,
        colorName,
        entry.color_hex || null,
        entry.image_url,
        entry.printify_variant_ids || null,
        entry.is_default || 0,
        now
      )
      .run()
      .catch(() => {});
  }
}

export async function fillSpreadEuMockupImages(env, productKey, mapped) {
  const entries = Array.isArray(mapped?.mockup_entries) ? mapped.mockup_entries : [];
  const urls = Array.isArray(mapped?.mock_images) ? mapped.mock_images : [];
  const rows = entries.length
    ? entries
    : urls.map((url, i) => ({
        view_key: "front",
        color_name: "Default",
        color_hex: null,
        image_url: url,
        printify_variant_ids: null,
        is_default: i === 0 ? 1 : 0,
      }));
  if (!rows.length) return;
  const now = Date.now();
  if (env.MANUFACTURER_DB) {
    for (const entry of rows) {
      await upsertMockupRow(env.MANUFACTURER_DB, "eazpire_product_mockup_images", productKey, entry, now);
    }
  }
  if (env.CATALOG_DB) {
    for (const entry of rows) {
      await upsertMockupRow(env.CATALOG_DB, "product_mockup_images", productKey, entry, now);
    }
  }
}

export async function fillSpreadEuPublishPlan(catalogDb, { productKey, title, mapped }) {
  if (!catalogDb) return;
  const now = Date.now();
  const countriesJson = JSON.stringify(EU_CODES);
  const regionCodesJson = JSON.stringify(regionCodesFromCountryCodes(EU_CODES));
  const origin = mapped?.country_of_origin || SPREAD_EU_COUNTRY_OF_ORIGIN;
  const variantsJson = JSON.stringify(mapped?.variants_json || []);
  const pricesJson = JSON.stringify(mapped?.prices_json || []);
  const productDataJson = JSON.stringify(mapped?.product_data || {});
  const printAreasConfigJson = JSON.stringify(mapped?.print_areas_config || {});

  await catalogDb
    .prepare(`INSERT OR IGNORE INTO product_active_print_providers (product_key, print_provider_id) VALUES (?, ?)`)
    .bind(productKey, SPREAD_EU_PRINT_PROVIDER_ID)
    .run()
    .catch(async () => {
      await catalogDb
        .prepare(
          `INSERT OR IGNORE INTO product_active_print_providers
            (product_key, print_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
        )
        .bind(productKey, SPREAD_EU_PRINT_PROVIDER_ID, now, now)
        .run();
    });

  const profile = await catalogDb
    .prepare(
      `SELECT id FROM product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`
    )
    .bind(productKey, SPREAD_EU_PRINT_PROVIDER_ID)
    .first();

  if (profile?.id != null) {
    await catalogDb
      .prepare(
        `UPDATE product_publish_profiles SET
          title = ?, source_system = ?, source_product_id = ?, variants_json = ?, prices_json = ?,
          product_data_json = ?, print_areas_config_json = ?,
          shopify_category_id = COALESCE(?, shopify_category_id),
          shopify_category_name = COALESCE(?, shopify_category_name),
          is_active = 1, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        title,
        SPREAD_EU_SOURCE_SYSTEM,
        productKey,
        variantsJson,
        pricesJson,
        productDataJson,
        printAreasConfigJson,
        mapped?.shopify_category_id || null,
        mapped?.shopify_category_name || null,
        now,
        profile.id
      )
      .run()
      .catch(async () => {
        await catalogDb
          .prepare(
            `UPDATE product_publish_profiles SET
              title = ?, source_system = ?, variants_json = ?, product_data_json = ?, is_active = 1, updated_at = ?
             WHERE id = ?`
          )
          .bind(title, SPREAD_EU_SOURCE_SYSTEM, variantsJson, productDataJson, now, profile.id)
          .run()
          .catch(() => {});
      });
  } else {
    await catalogDb
      .prepare(
        `INSERT INTO product_publish_profiles
          (product_key, title, source_system, source_product_id, print_provider_id,
           variants_json, prices_json, product_data_json, print_areas_config_json,
           shopify_category_id, shopify_category_name, is_active, collected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(
        productKey,
        title,
        SPREAD_EU_SOURCE_SYSTEM,
        productKey,
        SPREAD_EU_PRINT_PROVIDER_ID,
        variantsJson,
        pricesJson,
        productDataJson,
        printAreasConfigJson,
        mapped?.shopify_category_id || null,
        mapped?.shopify_category_name || null,
        now,
        now
      )
      .run()
      .catch(async () => {
        await catalogDb
          .prepare(
            `INSERT INTO product_publish_profiles
              (product_key, title, source_system, source_product_id, print_provider_id,
               variants_json, product_data_json, is_active, collected_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
          )
          .bind(
            productKey,
            title,
            SPREAD_EU_SOURCE_SYSTEM,
            productKey,
            SPREAD_EU_PRINT_PROVIDER_ID,
            variantsJson,
            productDataJson,
            now,
            now
          )
          .run()
          .catch(() => {});
      });
  }

  const mapRow = await catalogDb
    .prepare(`SELECT id FROM product_publish_map WHERE product_key = ? LIMIT 1`)
    .bind(productKey)
    .first()
    .catch(() => null);
  if (mapRow?.id != null) {
    await catalogDb
      .prepare(
        `UPDATE product_publish_map SET
          provider_name = ?, country_codes_json = ?, region_codes_json = ?,
          country_of_origin = COALESCE(NULLIF(country_of_origin, ''), ?),
          is_enabled = 1, updated_at = ?
         WHERE id = ?`
      )
      .bind(SPREAD_EU_PROVIDER_DISPLAY_NAME, countriesJson, regionCodesJson, origin, now, mapRow.id)
      .run()
      .catch(async () => {
        await catalogDb
          .prepare(
            `UPDATE product_publish_map SET
              country_codes_json = ?, region_codes_json = ?, is_enabled = 1, updated_at = ?
             WHERE id = ?`
          )
          .bind(countriesJson, regionCodesJson, now, mapRow.id)
          .run()
          .catch(() => {});
      });
  } else {
    await catalogDb
      .prepare(
        `INSERT INTO product_publish_map
          (product_key, provider_name, country_codes_json, region_codes_json, country_of_origin,
           priority, is_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, 100, 1, ?)`
      )
      .bind(productKey, SPREAD_EU_PROVIDER_DISPLAY_NAME, countriesJson, regionCodesJson, origin, now)
      .run()
      .catch(async () => {
        await catalogDb
          .prepare(
            `INSERT INTO product_publish_map
              (product_key, provider_name, country_codes_json, region_codes_json, priority, is_enabled, updated_at)
             VALUES (?, ?, ?, ?, 100, 1, ?)`
          )
          .bind(productKey, SPREAD_EU_PROVIDER_DISPLAY_NAME, countriesJson, regionCodesJson, now)
          .run()
          .catch(() => {});
      });
  }
}

async function loadSpreadEuShippingTypeHint(catalogDb, productKey, mapped) {
  const title = String(
    mapped?.product_data?.title || mapped?.customerName || mapped?.title || ""
  ).trim();
  if (title) return { id: Number(spreadEuTypeIdFromProductKey(productKey)) || mapped?.id, customerName: title };
  const row = await catalogDb
    .prepare(`SELECT title FROM product_publish_profiles WHERE product_key = ? LIMIT 1`)
    .bind(productKey)
    .first()
    .catch(() => null);
  return {
    id: Number(spreadEuTypeIdFromProductKey(productKey)),
    customerName: String(row?.title || "").trim(),
  };
}

export async function ensureSpreadEuShippingRows(env, productKey, mapped) {
  const catalogDb = env?.CATALOG_DB;
  const pk = String(productKey || "").trim();
  if (!catalogDb || !pk) return { ok: false, error: "catalog_db_unavailable" };
  await ensureProductProviderShippingSchema(catalogDb);
  const now = Date.now();
  const typeHint = await loadSpreadEuShippingTypeHint(catalogDb, pk, mapped);
  const shipsFromJson = JSON.stringify([{ code: SPREAD_EU_COUNTRY_OF_ORIGIN, label: "Germany" }]);
  const header = await catalogDb
    .prepare(
      `SELECT product_key FROM product_provider_shipping
       WHERE product_key = ? AND print_provider_id = ? LIMIT 1`
    )
    .bind(pk, SPREAD_EU_PRINT_PROVIDER_ID)
    .first()
    .catch(() => null);

  if (!header?.product_key) {
    await catalogDb
      .prepare(
        `INSERT INTO product_provider_shipping
          (product_key, print_provider_id, ships_from_json, network_origins_json, currency,
           last_synced_at, sync_source, sync_error, created_at, updated_at)
         VALUES (?, ?, ?, '[]', 'EUR', ?, ?, NULL, ?, ?)`
      )
      .bind(pk, SPREAD_EU_PRINT_PROVIDER_ID, shipsFromJson, now, SPREAD_EU_SHIPPING_SYNC_SOURCE, now, now)
      .run()
      .catch(() => {});
  } else {
    await catalogDb
      .prepare(
        `UPDATE product_provider_shipping SET
          ships_from_json = ?,
          currency = 'EUR',
          last_synced_at = ?,
          sync_source = ?,
          sync_error = NULL,
          updated_at = ?
         WHERE product_key = ? AND print_provider_id = ?`
      )
      .bind(shipsFromJson, now, SPREAD_EU_SHIPPING_SYNC_SOURCE, now, pk, SPREAD_EU_PRINT_PROVIDER_ID)
      .run()
      .catch(() => {});
  }

  await catalogDb
    .prepare(
      `DELETE FROM product_provider_shipping_rates
       WHERE product_key = ? AND print_provider_id = ? AND profile_key = 'default'`
    )
    .bind(pk, SPREAD_EU_PRINT_PROVIDER_ID)
    .run()
    .catch(() => {});

  for (const row of spreadEuShippingRatesForProduct(pk, typeHint)) {
    await catalogDb
      .prepare(
        `INSERT INTO product_provider_shipping_rates
          (product_key, print_provider_id, country_code, country_label,
           shipping_first_cents, shipping_additional_cents, profile_key, speed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'default', 'Standard', ?)`
      )
      .bind(pk, SPREAD_EU_PRINT_PROVIDER_ID, row.country_code, destinationLabel(row.country_code), row.first, row.additional, now)
      .run()
      .catch(() => {});
  }
  return { ok: true, print_provider_id: SPREAD_EU_PRINT_PROVIDER_ID };
}

export async function fillSpreadEuCreatorSettings(env, productKey, mapped) {
  const db = env?.CREATOR_DB;
  const pk = String(productKey || "").trim();
  if (!db || !pk) return;
  const preview = String(mapped?.creator_preview_url || "").trim();
  const colors =
    mapped?.product_data?.options?.find((o) => String(o?.type || "").toLowerCase() === "color")?.values || [];
  const variantCosts = {};
  for (const color of colors) variantCosts[`color:${color.id}`] = 60;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS creator_product_settings (
          product_key TEXT PRIMARY KEY,
          creator_level TEXT NOT NULL DEFAULT 'starter',
          cost_eaz REAL,
          preview_images_json TEXT NOT NULL DEFAULT '[]',
          variant_costs_json TEXT NOT NULL DEFAULT '{}',
          print_areas_json TEXT NOT NULL DEFAULT '[]',
          skill_meta_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )`
      )
      .run();
  } catch {
    /* exists */
  }
  const existing = await db
    .prepare(
      `SELECT product_key, preview_images_json, variant_costs_json FROM creator_product_settings WHERE product_key = ? LIMIT 1`
    )
    .bind(pk)
    .first()
    .catch(() => null);
  const printAreas = JSON.stringify(mapped?.print_area_keys || ["front"]);
  if (!existing?.product_key) {
    await db
      .prepare(
        `INSERT INTO creator_product_settings
          (product_key, creator_level, cost_eaz, preview_images_json, variant_costs_json,
           print_areas_json, skill_meta_json, updated_at)
         VALUES (?, 'starter', ?, ?, ?, ?, '{}', unixepoch())`
      )
      .bind(pk, PRODUCT_TIER_COST.S, JSON.stringify(preview ? [preview] : []), JSON.stringify(variantCosts), printAreas)
      .run()
      .catch(() => {});
    return;
  }
  let previews = [];
  try {
    previews = JSON.parse(existing.preview_images_json || "[]");
  } catch {
    previews = [];
  }
  if ((!Array.isArray(previews) || !previews.length) && preview) {
    await db
      .prepare(`UPDATE creator_product_settings SET preview_images_json = ?, updated_at = unixepoch() WHERE product_key = ?`)
      .bind(JSON.stringify([preview]), pk)
      .run()
      .catch(() => {});
  }
  let savedCosts = {};
  try {
    savedCosts = JSON.parse(existing.variant_costs_json || "{}");
  } catch {
    savedCosts = {};
  }
  if (!savedCosts || typeof savedCosts !== "object" || !Object.keys(savedCosts).length) {
    await db
      .prepare(`UPDATE creator_product_settings SET variant_costs_json = ?, updated_at = unixepoch() WHERE product_key = ?`)
      .bind(JSON.stringify(variantCosts), pk)
      .run()
      .catch(() => {});
  }
}

export async function fillSpreadEuCatalogProduct(env, { productKey, title, mapped }) {
  if (env.CATALOG_DB) {
    await fillSpreadEuPublishPlan(env.CATALOG_DB, { productKey, title, mapped });
  }
  if (env.CREATOR_DB && mapped?.variant_config) {
    const now = Date.now();
    await env.CREATOR_DB.prepare(
      `INSERT INTO product_variant_config
        (product_key, print_provider_id, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_key, print_provider_id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    )
      .bind(productKey, SPREAD_EU_PRINT_PROVIDER_ID, JSON.stringify(mapped.variant_config), now, now)
      .run()
      .catch(() => {});
  }
  await fillSpreadEuMockupImages(env, productKey, mapped);
  await ensureSpreadEuShippingRows(env, productKey, mapped);
  await fillSpreadEuCreatorSettings(env, productKey, mapped);
}

function isoSet(codes) {
  return new Set((Array.isArray(codes) ? codes : []).map((c) => String(c || "").trim().toUpperCase()).filter(Boolean));
}

function spreadEuMarketsNeedRepair(codes) {
  const have = isoSet(codes);
  if (have.has(SPREAD_EU_TODIFY_MARKET_EXCEPTION)) return true;
  for (const blocked of SPREAD_EU_NO_SHIP_COUNTRY_CODES) {
    if (have.has(blocked)) return true;
  }
  if (have.size !== EU_CODES.length) return true;
  for (const code of EU_CODES) {
    if (!have.has(code)) return true;
  }
  return false;
}

export async function listSpreadEuKeysNeedingRepair(env, existingKeys) {
  const need = new Set();
  const catalogDb = env?.CATALOG_DB;
  if (!catalogDb || !existingKeys?.size) return need;
  const complete = new Set();
  try {
    const mapRows = await catalogDb
      .prepare(
        `SELECT product_key, country_codes_json, country_of_origin FROM product_publish_map
         WHERE product_key LIKE 'spread-eu-%'`
      )
      .all();
    for (const row of mapRows?.results || []) {
      const key = String(row.product_key || "").trim();
      let codes = [];
      try {
        codes = JSON.parse(row.country_codes_json || "[]");
      } catch {
        codes = [];
      }
      if (!Array.isArray(codes) || spreadEuMarketsNeedRepair(codes) || !String(row.country_of_origin || "").trim()) {
        if (key) need.add(key);
      } else if (key) {
        complete.add(key);
      }
    }
  } catch {
    /* optional */
  }
  try {
    const profiles = await catalogDb
      .prepare(
        `SELECT product_key, prices_json, title FROM product_publish_profiles
         WHERE product_key LIKE 'spread-eu-%' AND print_provider_id = ?`
      )
      .bind(SPREAD_EU_PRINT_PROVIDER_ID)
      .all();
    for (const row of profiles?.results || []) {
      const key = String(row.product_key || "").trim();
      let prices = [];
      try {
        prices = JSON.parse(row.prices_json || "[]");
      } catch {
        prices = [];
      }
      if (!Array.isArray(prices) || !prices.length) {
        if (key) need.add(key);
      }
    }
  } catch {
    /* optional */
  }
  try {
    const shipped = await catalogDb
      .prepare(
        `SELECT product_key FROM product_provider_shipping
         WHERE print_provider_id = ? AND product_key LIKE 'spread-eu-%'`
      )
      .bind(SPREAD_EU_PRINT_PROVIDER_ID)
      .all();
    const haveShip = new Set((shipped?.results || []).map((r) => String(r.product_key || "").trim()));
    for (const key of existingKeys) {
      if (!haveShip.has(key)) need.add(key);
    }
  } catch {
    for (const key of existingKeys) need.add(key);
  }
  try {
    const rateRows = await catalogDb
      .prepare(
        `SELECT product_key, country_code, shipping_first_cents, shipping_additional_cents
         FROM product_provider_shipping_rates
         WHERE print_provider_id = ? AND profile_key = 'default' AND product_key LIKE 'spread-eu-%'`
      )
      .bind(SPREAD_EU_PRINT_PROVIDER_ID)
      .all();
    const byKey = new Map();
    for (const row of rateRows?.results || []) {
      const key = String(row.product_key || "").trim();
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }
    const titles = new Map();
    try {
      const profileRows = await catalogDb
        .prepare(
          `SELECT product_key, title FROM product_publish_profiles
           WHERE product_key LIKE 'spread-eu-%' AND print_provider_id = ?`
        )
        .bind(SPREAD_EU_PRINT_PROVIDER_ID)
        .all();
      for (const row of profileRows?.results || []) {
        titles.set(String(row.product_key || "").trim(), row.title || "");
      }
    } catch {
      /* optional */
    }
    for (const key of existingKeys) {
      const rows = byKey.get(key) || [];
      if (rows.length !== SPREAD_EU_SHIPPABLE_COUNTRY_CODES.length) {
        need.add(key);
        continue;
      }
      const typeHint = { customerName: titles.get(key) || "" };
      const de = rows.find((r) => String(r.country_code || "").toUpperCase() === "DE");
      const expected = spreadEuRateCentsForCountry("DE", key, typeHint);
      if (!de || Number(de.shipping_first_cents) !== expected.first || Number(de.shipping_additional_cents) !== expected.additional) {
        need.add(key);
      }
    }
  } catch {
    /* optional */
  }
  for (const key of existingKeys) {
    if (!complete.has(key)) need.add(key);
  }
  return need;
}

