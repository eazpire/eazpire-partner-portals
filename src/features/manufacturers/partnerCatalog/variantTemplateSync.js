/**
 * Apply Printify variants template → variant_config, pricing snapshot, publish profiles.
 * Mirrors admin handleAdminUpdateVariantsTemplate synthetic sync for Partner Catalog Studio.
 */

import { newId } from "../db.js";
import {
  buildVariantConfigFromTemplateSnapshot,
  buildVariantPricingProductSnapshot,
  calcSellPriceCents,
  fetchPrintifyCatalogCostMap,
  applyCatalogCostsToProductVariants,
  resolveVariantCostCents,
} from "../../admin/printifyVariantCostUtils.js";
import { syncVariantConfigToCatalog } from "../../admin/adminProducts.js";

async function queryFirst(db, sql, ...binds) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

async function ensureTemplateVariantsSnapshotColumns(db) {
  if (!db) return;
  const res = await db.prepare(`PRAGMA table_info(template_products)`).all().catch(() => null);
  const cols = new Set((res?.results || []).map((row) => row.name));
  const add = async (name) => {
    if (!cols.has(name)) {
      await db.prepare(`ALTER TABLE template_products ADD COLUMN ${name} TEXT`).run().catch(() => {});
    }
  };
  await add("variants_product_data_json");
  await add("variants_printify_product_id");
}

async function ensureCreatorVariantsTemplateColumns(db) {
  if (!db) return;
  await db.prepare(`ALTER TABLE printify_template_metadata ADD COLUMN variants_printify_product_id TEXT`).run().catch(() => {});
  await db.prepare(`ALTER TABLE printify_template_metadata ADD COLUMN variants_product_data_json TEXT`).run().catch(() => {});
}

async function ensureManufacturerVariantsSnapshotColumns(db) {
  if (!db) return;
  await db.prepare(`ALTER TABLE eazpire_template_products ADD COLUMN variants_product_data_json TEXT`).run().catch(() => {});
  await db.prepare(`ALTER TABLE eazpire_template_products ADD COLUMN variants_printify_product_id TEXT`).run().catch(() => {});
}

function parseJson(raw, fallback = null) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function saveCreatorVariantConfig(env, productKey, printProviderId, config, now) {
  const crDb = env?.CREATOR_DB;
  if (!crDb || !config) return false;
  await crDb
    .prepare(
      `INSERT INTO product_variant_config (product_key, print_provider_id, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_key, print_provider_id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    )
    .bind(productKey, Number(printProviderId), JSON.stringify(config), now, now)
    .run();
  return true;
}

async function saveManufacturerVariantConfig(db, productKey, printProviderId, config, now) {
  if (!db || !config) return false;
  const existing = await queryFirst(
    db,
    `SELECT id FROM eazpire_product_variant_config WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    Number(printProviderId)
  );
  const json = JSON.stringify(config);
  if (existing?.id) {
    await db
      .prepare(`UPDATE eazpire_product_variant_config SET config_json = ?, updated_at = ? WHERE id = ?`)
      .bind(json, now, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_product_variant_config (id, product_key, print_provider_id, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(newId(), productKey, Number(printProviderId), json, now, now)
      .run();
  }
  return true;
}

async function persistVariantsSnapshotOnCatalogTemplate(env, productKey, printProviderId, snapshotJson, printifyProductId, now) {
  const db = env?.CATALOG_DB;
  if (!db || !snapshotJson) return;
  await ensureTemplateVariantsSnapshotColumns(db);
  const pid = String(printifyProductId || "").trim();
  await db
    .prepare(
      `UPDATE template_products SET
        variants_product_data_json = ?,
        variants_printify_product_id = ?,
        printify_variants_product_id = COALESCE(printify_variants_product_id, ?),
        updated_at = ?
       WHERE product_key = ? AND print_provider_id = ?`
    )
    .bind(snapshotJson, pid, pid, now, productKey, Number(printProviderId))
    .run();
}

async function persistVariantsSnapshotOnCreatorMetadata(env, productKey, printProviderId, snapshotJson, printifyProductId, now) {
  const db = env?.CREATOR_DB;
  if (!db || !snapshotJson) return;
  await ensureCreatorVariantsTemplateColumns(db);
  const pid = String(printifyProductId || "").trim();
  const row = await queryFirst(
    db,
    `SELECT id FROM printify_template_metadata WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  if (!row?.id) return;
  await db
    .prepare(
      `UPDATE printify_template_metadata SET
        variants_printify_product_id = ?,
        variants_product_data_json = ?,
        updated_at = ?
       WHERE product_key = ? AND print_provider_id = ?`
    )
    .bind(pid, snapshotJson, now, productKey, Number(printProviderId))
    .run();
}

async function persistVariantsSnapshotOnManufacturerTemplate(db, productKey, printProviderId, snapshotJson, printifyProductId, now) {
  if (!db || !snapshotJson) return;
  await ensureManufacturerVariantsSnapshotColumns(db);
  const pid = String(printifyProductId || "").trim();
  await db
    .prepare(
      `UPDATE eazpire_template_products SET
        variants_product_data_json = ?,
        variants_printify_product_id = ?,
        printify_variants_product_id = COALESCE(printify_variants_product_id, ?),
        updated_at = ?
       WHERE product_key = ? AND print_provider_id = ?`
    )
    .bind(snapshotJson, pid, pid, now, productKey, Number(printProviderId))
    .run();
}

async function syncManufacturerPublishProfileFromConfig(env, db, productKey, printProviderId, productData, config, now) {
  if (!db || !productData || !config) return 0;
  const catalogCostMap = await fetchPrintifyCatalogCostMap(env, productData.blueprint_id, printProviderId).catch(() => ({}));
  if (Object.keys(catalogCostMap || {}).length) {
    applyCatalogCostsToProductVariants(productData, catalogCostMap);
  }

  const savedVariants = config?.variants || {};
  const enabledVariants = [];
  const pricesArray = [];
  const whiteBrandingVariantIds = [];

  for (const v of productData.variants || []) {
    const vid = v.id ?? v.variant_id;
    if (vid == null) continue;
    const sv = savedVariants[String(vid)] ?? savedVariants[vid];
    if (!sv || typeof sv !== "object" || sv.enabled === false) continue;
    const mode = sv.profit_mode === "fixed" ? "fixed" : "percent";
    const value = Number(sv.profit_value);
    const branding = sv.branding === "white" ? "white" : "black";
    const cost = resolveVariantCostCents(v, catalogCostMap);
    const price = calcSellPriceCents(cost, mode, Number.isFinite(value) ? value : 30);
    enabledVariants.push({ ...v, is_enabled: true });
    pricesArray.push({ variant_id: vid, price });
    if (branding === "white") whiteBrandingVariantIds.push(vid);
  }

  for (const [key, sv] of Object.entries(savedVariants)) {
    if (!sv || typeof sv !== "object" || sv.enabled !== false) continue;
    if (sv.branding !== "white") continue;
    const vidNum = Number(key);
    const vid = Number.isFinite(vidNum) ? vidNum : key;
    if (!whiteBrandingVariantIds.includes(vid)) whiteBrandingVariantIds.push(vid);
  }

  const profile = await queryFirst(
    db,
    `SELECT id FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  if (!profile?.id) return 0;

  await db
    .prepare(
      `UPDATE eazpire_product_publish_profiles SET
        variants_json = ?, prices_json = ?, white_branding_variant_ids = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      JSON.stringify(enabledVariants),
      JSON.stringify(pricesArray),
      JSON.stringify(whiteBrandingVariantIds),
      now,
      profile.id
    )
    .run();
  return 1;
}

/**
 * @param {any} env
 * @param {string} productKey
 * @param {number} printProviderId
 * @param {any} fullProduct Printify shop product
 * @param {string} [printifyProductId]
 */
export async function persistVariantTemplateFromPrintify(env, productKey, printProviderId, fullProduct, printifyProductId = "") {
  const snapshotJson = buildVariantPricingProductSnapshot(fullProduct);
  const syntheticConfig = buildVariantConfigFromTemplateSnapshot(fullProduct);
  const now = Date.now();
  const pid = Number(printProviderId);
  const printifyId = String(printifyProductId || fullProduct?.id || "").trim();

  if (!snapshotJson || !syntheticConfig) {
    return { ok: false, error: "variant_snapshot_build_failed" };
  }

  await persistVariantsSnapshotOnCatalogTemplate(env, productKey, pid, snapshotJson, printifyId, now);
  await persistVariantsSnapshotOnCreatorMetadata(env, productKey, pid, snapshotJson, printifyId, now);
  if (env?.MANUFACTURER_DB) {
    await persistVariantsSnapshotOnManufacturerTemplate(env.MANUFACTURER_DB, productKey, pid, snapshotJson, printifyId, now);
  }

  let syntheticSaved = false;
  if (env?.CREATOR_DB) {
    syntheticSaved = await saveCreatorVariantConfig(env, productKey, pid, syntheticConfig, now);
  }
  if (env?.MANUFACTURER_DB) {
    const mfgSaved = await saveManufacturerVariantConfig(env.MANUFACTURER_DB, productKey, pid, syntheticConfig, now);
    syntheticSaved = syntheticSaved || mfgSaved;
  }

  let syncedProfiles = 0;
  let enabledVariants = 0;
  if (env?.CATALOG_DB && env?.CREATOR_DB) {
    try {
      const meta = await syncVariantConfigToCatalog(env, productKey, pid, syntheticConfig);
      syncedProfiles = Number(meta?.synced_profiles || 0);
      enabledVariants = Number(meta?.enabled_variants || 0);
    } catch (err) {
      console.warn("[persistVariantTemplateFromPrintify] catalog sync failed:", err?.message || err);
    }
  } else if (env?.MANUFACTURER_DB) {
    const productData = parseJson(snapshotJson, null);
    if (productData) {
      syncedProfiles = await syncManufacturerPublishProfileFromConfig(
        env,
        env.MANUFACTURER_DB,
        productKey,
        pid,
        productData,
        syntheticConfig,
        now
      );
      enabledVariants = Object.values(syntheticConfig.variants || {}).filter((v) => v?.enabled !== false).length;
    }
  }

  return {
    ok: true,
    synthetic_config_saved: syntheticSaved,
    synced_profiles: syncedProfiles,
    enabled_variants: enabledVariants,
    variant_count: (fullProduct?.variants || []).length,
  };
}

/** Prefer slim variants template snapshot for variant matrix UI. */
export function resolveVariantProductDataForUi(template, profile) {
  const tryParse = (raw) => {
    if (raw == null || String(raw).trim() === "") return null;
    return parseJson(raw, null);
  };
  const fromTemplateSnap = tryParse(template?.variants_product_data_json);
  if (fromTemplateSnap?.variants?.length) return fromTemplateSnap;
  const fromProfile = tryParse(profile?.product_data_json);
  if (fromProfile?.variants?.length) return fromProfile;
  const fromTemplate = tryParse(template?.product_data_json);
  if (fromTemplate?.variants?.length) return fromTemplate;
  return fromTemplateSnap || fromProfile || fromTemplate || null;
}
