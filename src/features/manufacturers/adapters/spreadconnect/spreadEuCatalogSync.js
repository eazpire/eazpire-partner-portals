/**
 * Import Spread Connect product types into Catalog Studio as Spread EU products.
 */

import { newId } from "../../db.js";
import { listSpreadconnectProductTypes } from "../../../../utils/spreadconnect.js";
import { upsertEazpireProduct } from "../../partnerCatalog/eazpireProductService.js";
import { ensureSpreadEuPartnerSetup } from "../../partnerCatalog/spreadEuPartnerSeed.js";
import {
  OPAQUE_VARIANT_PROVIDER_IDS,
  SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
  SPREAD_EU_PARTNER_ID,
  SPREAD_EU_PROVIDER_DISPLAY_NAME,
  SPREAD_EU_SOURCE_SYSTEM,
} from "../../partnerCatalog/constants.js";
import { syncPublishIndexVisibility } from "../../partnerCatalog/catalogOpsWriteService.js";
import {
  buildSpreadEuCatalogProductData,
  shouldImportSpreadEuProductType,
  spreadconnectProductTypeName,
  spreadEuProductKey,
  SPREAD_EU_COUNTRY_CODES as EU_CODES,
} from "./spreadEuCatalogMap.js";

const MAX_IMPORT = 80;
const PRINT_PROVIDER_ID = OPAQUE_VARIANT_PROVIDER_IDS[SPREAD_EU_FULFILLMENT_EXTERNAL_ID];

function productTypeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.productTypes)) return raw.productTypes;
  return [];
}

async function countSpreadEuProducts(mfgDb) {
  const row = await mfgDb
    .prepare(`SELECT COUNT(*) AS n FROM eazpire_products WHERE manufacturer_id = ?`)
    .bind(SPREAD_EU_PARTNER_ID)
    .first();
  return Number(row?.n || 0);
}

async function upsertProviderBlueprint(db, type) {
  const externalId = String(type.id);
  const now = Date.now();
  const title = spreadconnectProductTypeName(type) || `Spread EU ${externalId}`;
  const rawJson = JSON.stringify(type);
  const existing = await db
    .prepare(
      `SELECT id FROM manufacturer_provider_blueprints
       WHERE manufacturer_id = ? AND external_blueprint_id = ? LIMIT 1`
    )
    .bind(SPREAD_EU_PARTNER_ID, externalId)
    .first();
  if (existing?.id) {
    await db
      .prepare(
        `UPDATE manufacturer_provider_blueprints SET
          title = ?, status = 'parsed', raw_json = ?, source_type = 'spreadconnect_catalog_sync', updated_at = ?
         WHERE id = ?`
      )
      .bind(title, rawJson, now, existing.id)
      .run();
    return existing.id;
  }
  const id = newId("pbp");
  await db
    .prepare(
      `INSERT INTO manufacturer_provider_blueprints
        (id, manufacturer_id, source_type, external_blueprint_id, title, status, raw_json, created_at, updated_at)
       VALUES (?, ?, 'spreadconnect_catalog_sync', ?, ?, 'parsed', ?, ?, ?)`
    )
    .bind(id, SPREAD_EU_PARTNER_ID, externalId, title, rawJson, now, now)
    .run();
  return id;
}

async function ensureCatalogRows(env, { productKey, title, mapped }) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return;
  const now = Date.now();
  const countriesJson = JSON.stringify(EU_CODES);
  const existing = await catalogDb
    .prepare(`SELECT product_key FROM product_catalog WHERE product_key = ? LIMIT 1`)
    .bind(productKey)
    .first();
  if (!existing?.product_key) {
    await syncPublishIndexVisibility(env, productKey, "offline", {
      title,
      regionsJson: JSON.stringify(["EU"]),
    });
  }

  await catalogDb
    .prepare(
      `INSERT OR IGNORE INTO product_active_print_providers (product_key, print_provider_id)
       VALUES (?, ?)`
    )
    .bind(productKey, PRINT_PROVIDER_ID)
    .run()
    .catch(async () => {
      await catalogDb
        .prepare(
          `INSERT OR IGNORE INTO product_active_print_providers
            (product_key, print_provider_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(productKey, PRINT_PROVIDER_ID, now, now)
        .run();
    });

  const profile = await catalogDb
    .prepare(
      `SELECT id FROM product_publish_profiles
       WHERE product_key = ? AND print_provider_id = ? LIMIT 1`
    )
    .bind(productKey, PRINT_PROVIDER_ID)
    .first();

  const variantsJson = JSON.stringify(mapped.variants_json || []);
  const productDataJson = JSON.stringify(mapped.product_data || {});

  if (profile?.id != null) {
    try {
      await catalogDb
        .prepare(
          `UPDATE product_publish_profiles SET
            title = ?, source_system = ?, source_product_id = ?, variants_json = ?,
            product_data_json = ?, is_active = 1, updated_at = ?
           WHERE id = ?`
        )
        .bind(title, SPREAD_EU_SOURCE_SYSTEM, productKey, variantsJson, productDataJson, now, profile.id)
        .run();
    } catch {
      await catalogDb
        .prepare(
          `UPDATE product_publish_profiles SET
            title = ?, source_system = ?, source_product_id = ?, variants_json = ?,
            is_active = 1, updated_at = ?
           WHERE id = ?`
        )
        .bind(title, SPREAD_EU_SOURCE_SYSTEM, productKey, variantsJson, now, profile.id)
        .run();
    }
  } else {
    try {
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
          PRINT_PROVIDER_ID,
          variantsJson,
          productDataJson,
          now,
          now
        )
        .run();
    } catch {
      await catalogDb
        .prepare(
          `INSERT INTO product_publish_profiles
            (product_key, title, source_system, source_product_id, print_provider_id,
             variants_json, is_active, collected_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .bind(
          productKey,
          title,
          SPREAD_EU_SOURCE_SYSTEM,
          productKey,
          PRINT_PROVIDER_ID,
          variantsJson,
          now,
          now
        )
        .run();
    }
  }

  try {
    await catalogDb
      .prepare(
        `INSERT INTO product_publish_map
          (product_key, provider_name, country_codes_json, region_codes_json, priority, is_enabled, updated_at)
         VALUES (?, ?, ?, ?, 100, 1, ?)`
      )
      .bind(productKey, SPREAD_EU_PROVIDER_DISPLAY_NAME, countriesJson, JSON.stringify(["EU"]), now)
      .run();
  } catch {
    /* map row optional / unique */
  }

  if (env.CREATOR_DB && mapped.variant_config) {
    const configJson = JSON.stringify(mapped.variant_config);
    await env.CREATOR_DB.prepare(
      `INSERT INTO product_variant_config
        (product_key, print_provider_id, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_key, print_provider_id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    )
      .bind(productKey, PRINT_PROVIDER_ID, configJson, now, now)
      .run()
      .catch(() => {});
  }
}

/**
 * @param {object} env
 * @param {{ force?: boolean }} [opts]
 */
export async function ensureSpreadEuCatalogSynced(env, opts = {}) {
  const mfgDb = env?.MANUFACTURER_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };

  const setup = await ensureSpreadEuPartnerSetup(mfgDb);
  const existingCount = await countSpreadEuProducts(mfgDb);
  if (existingCount > 0 && !opts.force) {
    return { ok: true, skipped: true, imported: 0, existing: existingCount, partner_id: setup.partner_id };
  }

  if (!String(env?.SPREADCONNECT_API_KEY || "").trim()) {
    return {
      ok: true,
      skipped: true,
      imported: 0,
      existing: existingCount,
      warning: "spreadconnect_api_key_not_configured",
      partner_id: setup.partner_id,
    };
  }

  const types = productTypeList(await listSpreadconnectProductTypes(env));
  const eligible = types.filter(shouldImportSpreadEuProductType).slice(0, MAX_IMPORT);
  let imported = 0;
  const errors = [];

  for (const type of eligible) {
    const productKey = spreadEuProductKey(type.id);
    const title = spreadconnectProductTypeName(type) || productKey;
    try {
      const mapped = buildSpreadEuCatalogProductData(type);
      await upsertProviderBlueprint(mfgDb, type);
      await upsertEazpireProduct(mfgDb, {
        product_key: productKey,
        manufacturer_id: SPREAD_EU_PARTNER_ID,
        title,
        regions: ["EU"],
        catalog_status: "offline",
      });
      await ensureCatalogRows(env, { productKey, title, mapped });
      imported += 1;
    } catch (e) {
      errors.push({ product_key: productKey, error: e?.message || String(e) });
    }
  }

  return {
    ok: true,
    skipped: false,
    imported,
    existing: existingCount,
    eligible: eligible.length,
    scanned: types.length,
    errors: errors.slice(0, 8),
    partner_id: setup.partner_id,
  };
}
