/**
 * Admin dogfood: ensure Todify partner + clone an online catalog product for direct-Shopify publish.
 */

import { newId } from "../../db.js";
import { ensureTodifyPartnerSetup } from "../../partnerCatalog/todifyPartnerSeed.js";
import { upsertEazpireProduct } from "../../partnerCatalog/eazpireProductService.js";
import {
  TODIFY_PARTNER_ID,
  TODIFY_PROVIDER_DISPLAY_NAME,
} from "../../partnerCatalog/constants.js";

const DEFAULT_SOURCE_KEY = "unisex-softstyle-cotton-tee";
const DEFAULT_TARGET_KEY = "todify-dogfood-tee";

/** Todify fulfills from Morocco — publish plans must never inherit Printify EU country lists. */
const TODIFY_COUNTRY_CODES_JSON = '["MA"]';
const TODIFY_REGION_CODES_JSON = "[]";

/**
 * Force product_publish_map country targets to Morocco-only for a Todify catalog key.
 * @param {any} catalogDb
 * @param {string} productKey
 */
export async function forceTodifyPublishMapToMorocco(catalogDb, productKey) {
  const key = String(productKey || "").trim();
  if (!catalogDb || !key) return { ok: false, updated: 0 };
  const now = Date.now();
  const result = await catalogDb
    .prepare(
      `UPDATE product_publish_map
       SET country_codes_json = ?, region_codes_json = ?, provider_name = ?, updated_at = ?
       WHERE product_key = ?`
    )
    .bind(TODIFY_COUNTRY_CODES_JSON, TODIFY_REGION_CODES_JSON, TODIFY_PROVIDER_DISPLAY_NAME, now, key)
    .run();
  const updated = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return { ok: true, updated, product_key: key };
}

/**
 * Force Morocco plans for all Todify catalog keys, then re-apply exclusive Shopify publications
 * for already-published Shopify product IDs (removes wrong EU/other market catalogs).
 * @param {any} env
 * @param {{ product_keys?: string[] }} [opts]
 */
export async function reconcileTodifyExclusivePublications(env, opts = {}) {
  const catalogDb = env?.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const keys = new Set(
    (Array.isArray(opts.product_keys) ? opts.product_keys : [])
      .map((k) => String(k || "").trim())
      .filter(Boolean)
  );

  try {
    const profileKeys = await catalogDb
      .prepare(
        `SELECT DISTINCT product_key FROM product_publish_profiles
         WHERE lower(COALESCE(source_system, '')) = 'todify' AND product_key IS NOT NULL`
      )
      .all();
    for (const row of profileKeys?.results || []) {
      const k = String(row.product_key || "").trim();
      if (k) keys.add(k);
    }
  } catch (e) {
    console.warn("[todify-reconcile] profile keys:", e?.message);
  }

  try {
    const mapKeys = await catalogDb
      .prepare(
        `SELECT DISTINCT product_key FROM product_publish_map
         WHERE product_key LIKE 'todify-%' OR lower(COALESCE(provider_name, '')) LIKE '%todify%'`
      )
      .all();
    for (const row of mapKeys?.results || []) {
      const k = String(row.product_key || "").trim();
      if (k) keys.add(k);
    }
  } catch (e) {
    console.warn("[todify-reconcile] map keys:", e?.message);
  }

  const planUpdates = [];
  for (const key of keys) {
    planUpdates.push(await forceTodifyPublishMapToMorocco(catalogDb, key));
  }

  const shop = env.SHOPIFY_SHOP || "eazpire.myshopify.com";
  const shopDomain = shop.includes(".") ? shop : `${shop}.myshopify.com`;
  const publishedPairs = [];

  if (env.CREATOR_DB && keys.size) {
    try {
      const placeholders = [...keys].map(() => "?").join(", ");
      const rows = await env.CREATOR_DB.prepare(
        `SELECT DISTINCT product_key, shopify_product_id FROM published_designs
         WHERE product_key IN (${placeholders})
           AND shopify_product_id IS NOT NULL AND TRIM(shopify_product_id) != ''`
      )
        .bind(...keys)
        .all();
      for (const row of rows?.results || []) {
        publishedPairs.push({
          product_key: String(row.product_key || "").trim(),
          shopify_product_id: String(row.shopify_product_id || "").trim(),
        });
      }
    } catch (e) {
      console.warn("[todify-reconcile] published_designs:", e?.message);
    }
  }

  try {
    const rows = await catalogDb
      .prepare(
        `SELECT DISTINCT product_key, shopify_product_id FROM eaz_test_todify_products
         WHERE shopify_product_id IS NOT NULL AND TRIM(shopify_product_id) != ''`
      )
      .all();
    for (const row of rows?.results || []) {
      const pk = String(row.product_key || "").trim();
      const sid = String(row.shopify_product_id || "").trim();
      if (!pk || !sid) continue;
      keys.add(pk);
      publishedPairs.push({ product_key: pk, shopify_product_id: sid });
    }
  } catch (e) {
    // Table may not exist in all envs
    console.warn("[todify-reconcile] eaz_test_todify_products:", e?.message);
  }

  const seenShopify = new Set();
  const publicationResults = [];
  if (String(env.SHOPIFY_ACCESS_TOKEN || "").trim() && publishedPairs.length) {
    const { applyCatalogPublicationsForProduct } = await import("../../../shopify/catalogPublishing.js");
    for (const pair of publishedPairs) {
      if (!pair.product_key || !pair.shopify_product_id) continue;
      const dedupe = `${pair.product_key}:${pair.shopify_product_id}`;
      if (seenShopify.has(dedupe)) continue;
      seenShopify.add(dedupe);
      await forceTodifyPublishMapToMorocco(catalogDb, pair.product_key);
      try {
        const result = await applyCatalogPublicationsForProduct(
          env,
          shopDomain,
          pair.shopify_product_id,
          pair.product_key,
          { exclusive: true }
        );
        publicationResults.push({
          ok: true,
          product_key: pair.product_key,
          shopify_product_id: pair.shopify_product_id,
          unpublished_other_country_catalogs: result.unpublished_other_country_catalogs || 0,
          plan_countries: result.plan_countries || [],
        });
      } catch (e) {
        publicationResults.push({
          ok: false,
          product_key: pair.product_key,
          shopify_product_id: pair.shopify_product_id,
          error: e?.message || String(e),
        });
      }
    }
  }

  return {
    ok: true,
    plan_keys: [...keys],
    plan_updates: planUpdates,
    publications: publicationResults,
  };
}

async function ensureTodifyOwnerUser(db, ownerEmail) {
  const email = String(ownerEmail || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const existingOnTodify = await db
    .prepare(
      `SELECT id, email, manufacturer_id FROM manufacturer_users
       WHERE manufacturer_id = ? AND lower(email) = ? LIMIT 1`
    )
    .bind(TODIFY_PARTNER_ID, email)
    .first();
  if (existingOnTodify?.id) {
    return { id: existingOnTodify.id, email: existingOnTodify.email, created: false, reassigned: false };
  }

  // Email is unique globally — reuse and point at Todify for dogfood.
  const existingAny = await db
    .prepare(`SELECT id, email, manufacturer_id FROM manufacturer_users WHERE lower(email) = ? LIMIT 1`)
    .bind(email)
    .first();
  const now = Date.now();
  if (existingAny?.id) {
    await db
      .prepare(
        `UPDATE manufacturer_users
         SET manufacturer_id = ?, role = 'owner', status = 'active', updated_at = ?
         WHERE id = ?`
      )
      .bind(TODIFY_PARTNER_ID, now, existingAny.id)
      .run();
    return {
      id: existingAny.id,
      email: existingAny.email || email,
      created: false,
      reassigned: true,
      previous_manufacturer_id: existingAny.manufacturer_id || null,
    };
  }

  const userId = newId("mfu");
  await db
    .prepare(
      `INSERT INTO manufacturer_users (id, manufacturer_id, user_id, email, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)`
    )
    .bind(userId, TODIFY_PARTNER_ID, userId, email, now, now)
    .run();
  return { id: userId, email, created: true, reassigned: false };
}

/**
 * Clone selected catalog-db rows from sourceKey → targetKey and mark as Todify / direct Shopify.
 * @param {any} catalogDb
 * @param {string} sourceKey
 * @param {string} targetKey
 */
async function cloneCatalogProductForTodify(catalogDb, sourceKey, targetKey) {
  const src = await catalogDb
    .prepare(`SELECT * FROM product_catalog WHERE product_key = ? LIMIT 1`)
    .bind(sourceKey)
    .first();
  if (!src) {
    return { ok: false, error: "source_product_not_found", source_key: sourceKey };
  }

  const existing = await catalogDb
    .prepare(`SELECT product_key FROM product_catalog WHERE product_key = ? LIMIT 1`)
    .bind(targetKey)
    .first();
  if (existing?.product_key) {
    await catalogDb
      .prepare(
        `UPDATE product_publish_profiles SET source_system = 'todify', updated_at = ?
         WHERE product_key = ?`
      )
      .bind(Date.now(), targetKey)
      .run();
    await forceTodifyPublishMapToMorocco(catalogDb, targetKey);
    await catalogDb
      .prepare(
        `UPDATE product_catalog SET is_active = 2, regions_json = ?, updated_at = ? WHERE product_key = ?`
      )
      .bind('["MA"]', Date.now(), targetKey)
      .run();
    return { ok: true, cloned: false, product_key: targetKey, reused: true };
  }

  const now = Date.now();
  const title = `Todify — ${src.title || targetKey}`;

  await catalogDb
    .prepare(
      `INSERT INTO product_catalog (product_key, title, regions_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 2, ?, ?)`
    )
    // Todify fulfills from Morocco — do not inherit Printify source EU regions.
    .bind(targetKey, title, '["MA"]', now, now)
    .run();

  // Best-effort: copy optional columns if present on source row
  try {
    if (src.visible_design_types_json != null) {
      await catalogDb
        .prepare(`UPDATE product_catalog SET visible_design_types_json = ? WHERE product_key = ?`)
        .bind(src.visible_design_types_json, targetKey)
        .run();
    }
  } catch (_) {}

  const activeProviders = await catalogDb
    .prepare(`SELECT print_provider_id FROM product_active_print_providers WHERE product_key = ?`)
    .bind(sourceKey)
    .all();
  for (const row of activeProviders?.results || []) {
    try {
      await catalogDb
        .prepare(
          `INSERT OR IGNORE INTO product_active_print_providers (product_key, print_provider_id)
           VALUES (?, ?)`
        )
        .bind(targetKey, row.print_provider_id)
        .run();
    } catch (_) {
      try {
        await catalogDb
          .prepare(
            `INSERT OR IGNORE INTO product_active_print_providers (product_key, print_provider_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)`
          )
          .bind(targetKey, row.print_provider_id, now, now)
          .run();
      } catch (e2) {
        console.warn("[todify-dogfood] active providers clone:", e2?.message);
      }
    }
  }

  const profiles = await catalogDb
    .prepare(`SELECT * FROM product_publish_profiles WHERE product_key = ? AND COALESCE(is_active, 1) = 1`)
    .bind(sourceKey)
    .all();

  const profileIdMap = new Map();
  for (const p of profiles?.results || []) {
    const oldId = p.id;
    const cols = Object.keys(p).filter((k) => k !== "id");
    const insertCols = cols.map((c) => (c === "product_key" ? "product_key" : c));
    const placeholders = insertCols.map(() => "?").join(", ");
    const values = insertCols.map((c) => {
      if (c === "product_key") return targetKey;
      if (c === "source_system") return "todify";
      if (c === "title" && p.title) return `Todify — ${p.title}`;
      if (c === "updated_at" || c === "collected_at") return now;
      return p[c];
    });
    try {
      const result = await catalogDb
        .prepare(
          `INSERT INTO product_publish_profiles (${insertCols.join(", ")})
           VALUES (${placeholders})`
        )
        .bind(...values)
        .run();
      const newId = result?.meta?.last_row_id ?? result?.lastRowId;
      if (oldId != null && newId != null) profileIdMap.set(Number(oldId), Number(newId));
    } catch (e) {
      console.warn("[todify-dogfood] profile clone failed:", e?.message);
    }
  }

  // If INSERT without id failed because of missing autoincrement handling, update any profiles we got
  await catalogDb
    .prepare(
      `UPDATE product_publish_profiles SET source_system = 'todify', updated_at = ?
       WHERE product_key = ?`
    )
    .bind(now, targetKey)
    .run();

  const maps = await catalogDb
    .prepare(`SELECT * FROM product_publish_map WHERE product_key = ?`)
    .bind(sourceKey)
    .all();
  for (const m of maps?.results || []) {
    const cols = Object.keys(m).filter((k) => k !== "id");
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map((c) => {
      if (c === "product_key") return targetKey;
      if (c === "provider_name") return TODIFY_PROVIDER_DISPLAY_NAME;
      // Never copy Printify EU (or other) market lists onto Todify dogfood products.
      if (c === "country_codes_json") return TODIFY_COUNTRY_CODES_JSON;
      if (c === "region_codes_json") return TODIFY_REGION_CODES_JSON;
      if (c === "publish_profile_id" && profileIdMap.has(Number(m.publish_profile_id))) {
        return profileIdMap.get(Number(m.publish_profile_id));
      }
      if (c === "updated_at" || c === "created_at") return now;
      return m[c];
    });
    try {
      await catalogDb
        .prepare(
          `INSERT INTO product_publish_map (${cols.join(", ")})
           VALUES (${placeholders})`
        )
        .bind(...values)
        .run();
    } catch (e) {
      console.warn("[todify-dogfood] publish map clone:", e?.message);
    }
  }

  await forceTodifyPublishMapToMorocco(catalogDb, targetKey);

  for (const table of [
    "print_area_printify_templates",
    "product_mockup_defaults",
    "product_mockup_images",
    "template_products",
    "product_branding_mappings",
  ]) {
    try {
      const rows = await catalogDb.prepare(`SELECT * FROM ${table} WHERE product_key = ?`).bind(sourceKey).all();
      for (const row of rows?.results || []) {
        const cols = Object.keys(row).filter((k) => k !== "id");
        const placeholders = cols.map(() => "?").join(", ");
        const values = cols.map((c) => {
          if (c === "product_key") return targetKey;
          if (c === "updated_at" || c === "created_at") return now;
          return row[c];
        });
        await catalogDb
          .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`)
          .bind(...values)
          .run();
      }
    } catch (e) {
      console.warn(`[todify-dogfood] clone ${table}:`, e?.message);
    }
  }

  return { ok: true, cloned: true, product_key: targetKey, source_key: sourceKey, title };
}

/**
 * @param {any} env
 * @param {{ source_key?: string, target_key?: string, owner_email?: string, send_magic_link?: boolean }} [opts]
 */
export async function runTodifyDogfoodSetup(env, opts = {}) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const sourceKey = String(opts.source_key || DEFAULT_SOURCE_KEY).trim();
  const targetKey = String(opts.target_key || DEFAULT_TARGET_KEY).trim();

  const partner = await ensureTodifyPartnerSetup(mfgDb);
  const owner = await ensureTodifyOwnerUser(mfgDb, opts.owner_email);

  let magicLink = null;
  if (owner?.email && opts.send_magic_link !== false) {
    try {
      const { issuePartnerMagicLink } = await import("../../partnerAuth.js");
      magicLink = await issuePartnerMagicLink(env, owner.email);
    } catch (e) {
      console.warn("[todify-dogfood] magic link:", e?.message);
    }
  }

  const clone = await cloneCatalogProductForTodify(catalogDb, sourceKey, targetKey);
  if (!clone.ok) return clone;

  try {
    await upsertEazpireProduct(mfgDb, {
      product_key: targetKey,
      manufacturer_id: TODIFY_PARTNER_ID,
      title: clone.title || `Todify dogfood (${targetKey})`,
      regions: ["MA"],
      catalog_status: "online",
      catalog_category_group: "Apparel",
      catalog_category_leaf: "T-Shirts",
    });
  } catch (e) {
    console.warn("[todify-dogfood] eazpire_product upsert:", e?.message);
  }

  let reconcile = null;
  if (opts.reconcile_publications !== false) {
    try {
      reconcile = await reconcileTodifyExclusivePublications(env, {
        product_keys: [targetKey],
      });
    } catch (e) {
      console.warn("[todify-dogfood] reconcile publications:", e?.message);
      reconcile = { ok: false, error: e?.message || String(e) };
    }
  }

  return {
    ok: true,
    partner,
    owner,
    magic_link: magicLink,
    catalog: clone,
    product_key: targetKey,
    source_system: "todify",
    reconcile,
    note: "Creator publish for this product_key uses direct Shopify (no Printify). Publish plan is Morocco (MA) only. Fulfill orders manually in Todify for now. Log in at partner.eazpire.com with the owner email magic link.",
  };
}
