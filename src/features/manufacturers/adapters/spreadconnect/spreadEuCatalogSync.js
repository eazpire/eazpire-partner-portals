/**
 * Import Spread Connect product types into Catalog Studio as Spread EU products.
 */

import { newId } from "../../db.js";
import { listSpreadconnectProductTypes, getSpreadconnectProductTypeViews, getSpreadconnectProductTypeCategories } from "../../../../utils/spreadconnect.js";
import { upsertEazpireProduct, getEazpireProduct } from "../../partnerCatalog/eazpireProductService.js";
import { upsertProductVersion } from "../../partnerCatalog/eazpireProductVersionService.js";
import { ensureSpreadshirtPartnerSetup } from "../../partnerCatalog/spreadEuPartnerSeed.js";
import {
  OPAQUE_VARIANT_PROVIDER_IDS,
  SPREAD_EU_FULFILLMENT_EXTERNAL_ID,
  SPREAD_EU_PROVIDER_DISPLAY_NAME,
  SPREAD_EU_SOURCE_SYSTEM,
  SPREADSHIRT_PARTNER_ID,
} from "../../partnerCatalog/constants.js";
import { syncPublishIndexVisibility } from "../../partnerCatalog/catalogOpsWriteService.js";
import {
  buildSpreadEuCatalogProductData,
  shouldImportSpreadEuProductType,
  spreadconnectProductTypeName,
  spreadEuCatalogCategory,
  spreadEuProductKey,
  SPREAD_EU_COUNTRY_CODES as EU_CODES,
} from "./spreadEuCatalogMap.js";

/** Modest chunk so Catalog Studio GET/Sync stay inside Worker time limits; remaining types import on the next pass. */
export const SPREAD_EU_IMPORT_CHUNK = 25;
const PRINT_PROVIDER_ID = OPAQUE_VARIANT_PROVIDER_IDS[SPREAD_EU_FULFILLMENT_EXTERNAL_ID];

function productTypeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.productTypes)) return raw.productTypes;
  return [];
}

/**
 * Idempotent import queue: never skip remaining types just because some already exist.
 * @param {object[]} types
 * @param {Set<string>} existingKeys
 * @param {{ force?: boolean, chunkSize?: number }} [opts]
 */
export function pickSpreadEuTypesToImport(types, existingKeys, opts = {}) {
  const chunkSize = Number(opts.chunkSize) > 0 ? Number(opts.chunkSize) : SPREAD_EU_IMPORT_CHUNK;
  const eligible = (Array.isArray(types) ? types : []).filter(shouldImportSpreadEuProductType);
  const missing = eligible.filter((type) => !existingKeys.has(spreadEuProductKey(type.id)));
  const queue = opts.force ? eligible : missing;
  return {
    eligible,
    missing,
    toImport: queue.slice(0, chunkSize),
    remaining_after_chunk: Math.max(0, queue.length - chunkSize),
  };
}

async function recategorizeExistingSpreadEuProducts(mfgDb, types, existingKeys, skipKeys) {
  const skip = skipKeys instanceof Set ? skipKeys : new Set();
  let updated = 0;
  for (const type of Array.isArray(types) ? types : []) {
    if (updated >= 80) break;
    const productKey = spreadEuProductKey(type.id);
    if (!productKey || !existingKeys.has(productKey) || skip.has(productKey)) continue;
    if (!shouldImportSpreadEuProductType(type)) continue;
    const category = spreadEuCatalogCategory(type);
    if (!category.group || !category.leaf) continue;
    try {
      const res = await mfgDb
        .prepare(
          `UPDATE eazpire_products SET catalog_category_group = ?, catalog_category_leaf = ?, updated_at = ?
           WHERE product_key = ? AND (
             catalog_category_group IS NULL OR catalog_category_group = '' OR catalog_category_group = 'Kleidung'
           )`
        )
        .bind(category.group, category.leaf, Date.now(), productKey)
        .run();
      if (Number(res?.meta?.changes || 0) > 0) updated += 1;
    } catch {
      /* optional */
    }
  }
  return updated;
}

async function fetchViewsForTypes(env, types) {
  const out = new Map();
  const list = Array.isArray(types) ? types : [];
  const batchSize = 5;
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (type) => {
        try {
          const [views, categories] = await Promise.all([
            getSpreadconnectProductTypeViews(env, type.id).catch(() => null),
            getSpreadconnectProductTypeCategories(env, type.id).catch(() => null),
          ]);
          return [String(type.id), { views, categories }];
        } catch {
          return [String(type.id), { views: null, categories: null }];
        }
      })
    );
    for (const [id, extras] of results) out.set(id, extras);
  }
  return out;
}

async function listExistingSpreadEuProductKeys(mfgDb, partnerId) {
  const keys = new Set();
  const ids = [...new Set([partnerId, SPREADSHIRT_PARTNER_ID].filter(Boolean))];
  for (const id of ids) {
    try {
      const res = await mfgDb
        .prepare(`SELECT product_key FROM eazpire_products WHERE manufacturer_id = ?`)
        .bind(id)
        .all();
      for (const row of res?.results || []) {
        const key = String(row.product_key || "").trim();
        if (key) keys.add(key);
      }
    } catch {
      /* optional */
    }
  }
  try {
    const res = await mfgDb
      .prepare(`SELECT product_key FROM eazpire_products WHERE product_key LIKE 'spread-eu-%'`)
      .all();
    for (const row of res?.results || []) {
      const key = String(row.product_key || "").trim();
      if (key) keys.add(key);
    }
  } catch {
    /* optional */
  }
  return keys;
}

async function upsertProviderBlueprint(db, type, partnerId) {
  const externalId = String(type.id);
  const now = Date.now();
  const title = spreadconnectProductTypeName(type) || `Spread EU ${externalId}`;
  const rawJson = JSON.stringify(type);
  const existing = await db
    .prepare(
      `SELECT id FROM manufacturer_provider_blueprints
       WHERE manufacturer_id = ? AND external_blueprint_id = ? LIMIT 1`
    )
    .bind(partnerId, externalId)
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
    .bind(id, partnerId, externalId, title, rawJson, now, now)
    .run();
  return id;
}

async function ensureMockupDefaults(mfgDb, productKey, printAreas) {
  if (!mfgDb || !printAreas?.length) return;
  const now = Date.now();
  for (const area of printAreas) {
    const key = String(area.name || "front").trim() || "front";
    try {
      const existing = await mfgDb
        .prepare(
          `SELECT id FROM eazpire_product_mockup_defaults WHERE product_key = ? AND print_area_key = ? LIMIT 1`
        )
        .bind(productKey, key)
        .first();
      if (existing?.id) {
        await mfgDb
          .prepare(
            `UPDATE eazpire_product_mockup_defaults SET
              printify_print_area_width = ?, printify_print_area_height = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(Math.round(area.width_mm || 0), Math.round(area.height_mm || 0), now, existing.id)
          .run();
        continue;
      }
      await mfgDb
        .prepare(
          `INSERT INTO eazpire_product_mockup_defaults
            (id, product_key, print_area_key, printify_print_area_width, printify_print_area_height,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newId("pmd"),
          productKey,
          key,
          Math.round(area.width_mm || 0) || null,
          Math.round(area.height_mm || 0) || null,
          now,
          now
        )
        .run();
    } catch {
      /* schema optional */
    }
  }
}

async function ensureMockupImages(mfgDb, productKey, urls) {
  if (!mfgDb || !urls?.length) return;
  const now = Date.now();
  let existing = [];
  try {
    const res = await mfgDb
      .prepare(`SELECT image_url FROM eazpire_product_mockup_images WHERE product_key = ?`)
      .bind(productKey)
      .all();
    existing = (res?.results || []).map((r) => String(r.image_url || "").trim()).filter(Boolean);
  } catch {
    return;
  }
  const have = new Set(existing);
  let isDefault = existing.length ? 0 : 1;
  for (const url of urls.slice(0, 8)) {
    if (have.has(url)) continue;
    try {
      await mfgDb
        .prepare(
          `INSERT INTO eazpire_product_mockup_images
            (id, product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
             image_url, printify_variant_ids, is_default, mockup_set, created_at)
           VALUES (?, ?, ?, '', 'front', 'Default', NULL, ?, NULL, ?, 'clean', ?)`
        )
        .bind(newId("pmi"), productKey, PRINT_PROVIDER_ID, url, isDefault, now)
        .run();
      have.add(url);
      isDefault = 0;
    } catch {
      try {
        await mfgDb
          .prepare(
            `INSERT INTO eazpire_product_mockup_images
              (id, product_key, print_provider_id, printify_product_id, view_key, color_name,
               image_url, is_default, created_at)
             VALUES (?, ?, ?, '', 'front', 'Default', ?, ?, ?)`
          )
          .bind(newId("pmi"), productKey, PRINT_PROVIDER_ID, url, isDefault, now)
          .run();
        isDefault = 0;
      } catch {
        /* optional */
      }
    }
  }
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
  const printAreasConfigJson = JSON.stringify(mapped.print_areas_config || {});

  if (profile?.id != null) {
    try {
      await catalogDb
        .prepare(
          `UPDATE product_publish_profiles SET
            title = ?, source_system = ?, source_product_id = ?, variants_json = ?,
            product_data_json = ?, print_areas_config_json = ?, is_active = 1, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          title,
          SPREAD_EU_SOURCE_SYSTEM,
          productKey,
          variantsJson,
          productDataJson,
          printAreasConfigJson,
          now,
          profile.id
        )
        .run();
    } catch {
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
    }
  } else {
    try {
      await catalogDb
        .prepare(
          `INSERT INTO product_publish_profiles
            (product_key, title, source_system, source_product_id, print_provider_id,
             variants_json, product_data_json, print_areas_config_json, is_active, collected_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .bind(
          productKey,
          title,
          SPREAD_EU_SOURCE_SYSTEM,
          productKey,
          PRINT_PROVIDER_ID,
          variantsJson,
          productDataJson,
          printAreasConfigJson,
          now,
          now
        )
        .run();
    } catch {
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

  const setup = await ensureSpreadshirtPartnerSetup(mfgDb);
  const partnerId = setup.partner_id;
  const existingKeys = await listExistingSpreadEuProductKeys(mfgDb, partnerId);

  if (!String(env?.SPREADCONNECT_API_KEY || "").trim()) {
    return {
      ok: true,
      skipped: true,
      imported: 0,
      existing: existingKeys.size,
      remaining: 0,
      complete: false,
      warning: "spreadconnect_api_key_not_configured",
      partner_id: partnerId,
    };
  }

  const types = productTypeList(await listSpreadconnectProductTypes(env));
  const picked = pickSpreadEuTypesToImport(types, existingKeys, {
    force: !!opts.force,
    chunkSize: SPREAD_EU_IMPORT_CHUNK,
  });
  if (!picked.toImport.length) {
    return {
      ok: true,
      skipped: true,
      imported: 0,
      existing: existingKeys.size,
      eligible: picked.eligible.length,
      remaining: 0,
      complete: true,
      scanned: types.length,
      partner_id: partnerId,
    };
  }

  const viewsByTypeId = await fetchViewsForTypes(env, picked.toImport);

  let imported = 0;
  const errors = [];
  const fpId = setup.fulfillment_provider?.id || null;

  for (const type of picked.toImport) {
    const productKey = spreadEuProductKey(type.id);
    const title = spreadconnectProductTypeName(type) || productKey;
    try {
      const mapped = buildSpreadEuCatalogProductData(type, {
        views: viewsByTypeId.get(String(type.id)) || null,
      });
      const category = mapped.catalog_category || {};
      await upsertProviderBlueprint(mfgDb, type, partnerId);
      const existingProduct = await getEazpireProduct(mfgDb, productKey);
      await upsertEazpireProduct(mfgDb, {
        product_key: productKey,
        manufacturer_id: partnerId,
        title,
        regions: ["EU"],
        catalog_status: existingProduct?.catalog_status || "offline",
        catalog_category_group: category.group || existingProduct?.catalog_category_group || null,
        catalog_category_leaf: category.leaf || existingProduct?.catalog_category_leaf || null,
      });
      await ensureCatalogRows(env, { productKey, title, mapped });
      await ensureMockupDefaults(mfgDb, productKey, mapped.product_data?.print_areas || []);
      await ensureMockupImages(mfgDb, productKey, mapped.mock_images || []);
      if (fpId) {
        await upsertProductVersion(mfgDb, {
          product_key: productKey,
          fulfillment_provider_id: fpId,
          display_name: title,
          is_active: 1,
          publish_enabled: 0,
        }).catch(() => {});
      }
      imported += 1;
    } catch (e) {
      errors.push({ product_key: productKey, error: e?.message || String(e) });
    }
  }

  return {
    ok: true,
    skipped: false,
    imported,
    existing: existingKeys.size,
    eligible: picked.eligible.length,
    remaining: picked.remaining_after_chunk,
    complete: picked.remaining_after_chunk === 0,
    scanned: types.length,
    errors: errors.slice(0, 8),
    partner_id: partnerId,
  };
}
