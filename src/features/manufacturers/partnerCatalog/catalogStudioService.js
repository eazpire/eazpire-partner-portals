/**
 * Catalog Studio — partner / provider tree + product list for admin UI
 */

import { listPartnersForAdmin } from "./printifyPartnerSeed.js";
import { listFulfillmentProviders } from "./fulfillmentProviderService.js";
import { listEazpireProducts, updateEazpireProduct } from "./eazpireProductService.js";
import { parseJson } from "../db.js";
import { mirrorEazpireProductToCatalogDb } from "./mirrorToCatalogDb.js";

/** Known partner logos by slug (fallback when DB has no logo_url). */
const PARTNER_LOGO_BY_SLUG = {
  printify: "https://www.printify.com/favicon.ico",
};

const VALID_CATALOG_STATUSES = new Set(["online", "preview", "offline"]);

const MFG_PRODUCT_CHILD_TABLES = [
  "eazpire_product_versions",
  "eazpire_template_products",
  "eazpire_product_publish_plans",
  "eazpire_product_publish_profiles",
  "eazpire_product_active_providers",
  "eazpire_product_mockup_defaults",
  "eazpire_product_mockup_images",
  "eazpire_product_mockup_view_random",
  "eazpire_product_variant_print_areas",
  "eazpire_product_base_costs",
  "eazpire_product_variant_config",
];

const CATALOG_PRODUCT_CHILD_TABLES = [
  "print_area_printify_templates",
  "template_products",
  "product_mockup_images",
  "product_mockup_defaults",
  "product_variant_print_areas",
  "product_color_variants",
  "product_base_costs",
  "product_publish_map",
  "product_publish_profiles",
  "product_variant_config",
  "product_catalog",
];

function resolvePartnerLogo(partner) {
  if (partner.logo_url) return partner.logo_url;
  const slug = String(partner.slug || "").toLowerCase();
  return PARTNER_LOGO_BY_SLUG[slug] || null;
}

async function queryAll(db, sql, ...binds) {
  const stmt = db.prepare(sql);
  const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return res?.results || [];
}

function countryFromLocationJson(locationJson) {
  const loc = parseJson(locationJson, {});
  return loc.country || loc.country_code || loc.countryCode || null;
}

function pushImageUrl(urls, value) {
  if (typeof value !== "string" || !value.trim()) return;
  const u = value.trim();
  if (!urls.includes(u)) urls.push(u);
}

function imagesFromBlueprintData(normalizedJson, rawJson) {
  const normalized = parseJson(normalizedJson, {}) || {};
  const raw = parseJson(rawJson, {}) || {};
  const urls = [];

  for (const view of normalized.mockup_views || []) {
    pushImageUrl(urls, view?.url || view?.image_url);
  }

  const printifyRaw = normalized._printify_raw || raw;
  const images = printifyRaw?.images || raw?.images || [];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string") pushImageUrl(urls, img);
      else pushImageUrl(urls, img?.src || img?.url || img?.image_url);
    }
  }

  return urls;
}

function printAreasFromNormalized(normalizedJson) {
  const normalized = parseJson(normalizedJson, {}) || {};
  const keys = new Set();
  for (const area of normalized.print_areas || []) {
    const key = area?.area_key || area?.key || area?.name;
    if (key) keys.add(String(key));
  }
  return [...keys];
}

function printAreasFromConfigJson(configJson) {
  const config = parseJson(configJson, {}) || {};
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  return Object.keys(config).filter((k) => k && k !== "null");
}

function formatPrintAreaLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function resolveManufacturerCountry(db, manufacturerId, providerExternalId) {
  if (providerExternalId != null && providerExternalId !== "") {
    const provider = await db
      .prepare(
        `SELECT location_json FROM manufacturer_fulfillment_providers
         WHERE manufacturer_id = ? AND external_provider_id = ? LIMIT 1`
      )
      .bind(manufacturerId, String(providerExternalId))
      .first();
    const fromProvider = countryFromLocationJson(provider?.location_json);
    if (fromProvider) return fromProvider;
  }

  const mfg = await db.prepare(`SELECT country FROM manufacturers WHERE id = ?`).bind(manufacturerId).first();
  return mfg?.country || null;
}

async function loadMockImagesByProductKey(db, productKeys) {
  const map = new Map();
  if (!productKeys.length) return map;

  const placeholders = productKeys.map(() => "?").join(",");
  const rows = await queryAll(
    db,
    `SELECT product_key, image_url, is_default, created_at
     FROM eazpire_product_mockup_images
     WHERE product_key IN (${placeholders})
     ORDER BY is_default DESC, created_at ASC`,
    ...productKeys
  );

  for (const row of rows) {
    const key = row.product_key;
    if (!map.has(key)) map.set(key, []);
    pushImageUrl(map.get(key), row.image_url);
  }
  return map;
}

async function loadPrintAreasByProductKey(db, productKeys) {
  const map = new Map();
  if (!productKeys.length) return map;

  const placeholders = productKeys.map(() => "?").join(",");
  const defaults = await queryAll(
    db,
    `SELECT DISTINCT product_key, print_area_key FROM eazpire_product_mockup_defaults
     WHERE product_key IN (${placeholders})`,
    ...productKeys
  );
  const variantAreas = await queryAll(
    db,
    `SELECT DISTINCT product_key, print_area_key FROM eazpire_product_variant_print_areas
     WHERE product_key IN (${placeholders})`,
    ...productKeys
  );
  const profiles = await queryAll(
    db,
    `SELECT product_key, print_areas_config_json FROM eazpire_product_publish_profiles
     WHERE product_key IN (${placeholders})`,
    ...productKeys
  );

  const addKey = (productKey, areaKey) => {
    if (!productKey || !areaKey) return;
    if (!map.has(productKey)) map.set(productKey, new Set());
    map.get(productKey).add(String(areaKey));
  };

  for (const row of defaults) addKey(row.product_key, row.print_area_key);
  for (const row of variantAreas) addKey(row.product_key, row.print_area_key);
  for (const row of profiles) {
    for (const key of printAreasFromConfigJson(row.print_areas_config_json)) {
      addKey(row.product_key, key);
    }
  }

  const out = new Map();
  for (const [key, set] of map) out.set(key, [...set].sort());
  return out;
}

export async function getCatalogStudioTree(db) {
  const partners = await listPartnersForAdmin(db);
  const out = [];
  for (const partner of partners) {
    const providers = await listFulfillmentProviders(db, partner.id);
    out.push({
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      logo_url: resolvePartnerLogo(partner),
      integration_type: partner.integration_type,
      provider_count: partner.fulfillment_provider_count,
      live_blueprint_count: partner.live_blueprint_count,
      eazpire_product_count: partner.eazpire_product_count,
      providers: providers.map((fp) => ({
        id: fp.id,
        name: fp.name,
        external_provider_id: fp.external_provider_id,
        status: fp.status,
        logo_url: fp.logo_url || null,
      })),
    });
  }
  return { ok: true, partners: out };
}

/**
 * @param {object} opts
 * @param {string} opts.manufacturerId
 * @param {string} [opts.providerExternalId] — Printify print_provider_id
 * @param {'available'|'online'|'preview'|'offline'} opts.filter
 */
export async function getCatalogStudioProducts(db, { manufacturerId, providerExternalId, filter }) {
  if (!manufacturerId) return { ok: false, error: "manufacturer_id_required" };

  const providerId = providerExternalId != null && providerExternalId !== "" ? String(providerExternalId) : null;
  const manufacturerCountry = await resolveManufacturerCountry(db, manufacturerId, providerId);

  if (filter === "available") {
    const rows = await listAvailableBlueprints(db, manufacturerId);
    const items = rows.map((row) => ({
      ...row,
      manufacturer_country: manufacturerCountry,
      print_areas: row.print_areas || [],
      mock_images: row.mock_images || [],
    }));
    return { ok: true, filter, items, total: items.length };
  }

  const status = filter === "online" || filter === "preview" || filter === "offline" ? filter : "online";
  let products = await listEazpireProducts(db, { manufacturerId, catalogStatus: status });

  if (providerId) {
    const keysForProvider = await productKeysForProvider(db, manufacturerId, providerId);
    const keySet = new Set(keysForProvider);
    products = products.filter((p) => keySet.has(p.product_key));
  }

  const productKeys = products.map((p) => p.product_key);
  const mockImagesMap = await loadMockImagesByProductKey(db, productKeys);
  const printAreasMap = await loadPrintAreasByProductKey(db, productKeys);

  const items = products.map((p) => ({
    kind: "eazpire_product",
    product_key: p.product_key,
    title: p.title,
    catalog_status: p.catalog_status,
    version_count: p.version_count ?? 0,
    blueprint_title: p.blueprint_title,
    updated_at: p.updated_at,
    mock_images: mockImagesMap.get(p.product_key) || [],
    manufacturer_country: manufacturerCountry,
    print_areas: printAreasMap.get(p.product_key) || [],
  }));

  return { ok: true, filter: status, items, total: items.length };
}

export async function setCatalogStudioProductStatus(env, { productKey, catalogStatus }) {
  const status = String(catalogStatus || "").toLowerCase();
  if (!VALID_CATALOG_STATUSES.has(status)) {
    return { ok: false, error: "invalid_catalog_status" };
  }

  const mfgDb = env.MANUFACTURER_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };

  const key = String(productKey || "").trim();
  if (!key) return { ok: false, error: "product_key_required" };

  const updated = await updateEazpireProduct(mfgDb, key, { catalog_status: status });
  if (!updated) return { ok: false, error: "product_not_found" };

  const mirror = await mirrorEazpireProductToCatalogDb(env, key);
  if (!mirror.ok) return { ok: false, error: mirror.error || "mirror_failed", product: updated };

  return { ok: true, product_key: key, catalog_status: status, product: updated };
}

async function runCatalogCleanup(catalogDb, productKey) {
  const cleanup = [];
  for (const table of CATALOG_PRODUCT_CHILD_TABLES) {
    try {
      const r = await catalogDb.prepare(`DELETE FROM ${table} WHERE product_key = ?`).bind(productKey).run();
      cleanup.push({ table, changes: r?.meta?.changes || 0 });
    } catch (e) {
      cleanup.push({ table, error: e?.message || "cleanup_failed" });
    }
  }
  return cleanup;
}

export async function removeCatalogStudioProduct(env, { productKey }) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };

  const key = String(productKey || "").trim();
  if (!key) return { ok: false, error: "product_key_required" };

  const existing = await mfgDb.prepare(`SELECT product_key, source_blueprint_id FROM eazpire_products WHERE product_key = ?`).bind(key).first();
  if (!existing) return { ok: false, error: "product_not_found" };

  const mfgCleanup = [];
  for (const table of MFG_PRODUCT_CHILD_TABLES) {
    try {
      const r = await mfgDb.prepare(`DELETE FROM ${table} WHERE product_key = ?`).bind(key).run();
      mfgCleanup.push({ table, changes: r?.meta?.changes || 0 });
    } catch (e) {
      mfgCleanup.push({ table, error: e?.message || "cleanup_failed" });
    }
  }

  await mfgDb.prepare(`DELETE FROM eazpire_products WHERE product_key = ?`).bind(key).run();
  mfgCleanup.push({ table: "eazpire_products", changes: 1 });

  let catalogCleanup = [];
  if (catalogDb) {
    catalogCleanup = await runCatalogCleanup(catalogDb, key);
  }

  return {
    ok: true,
    product_key: key,
    source_blueprint_id: existing.source_blueprint_id,
    mfg_cleanup: mfgCleanup,
    catalog_cleanup: catalogCleanup,
  };
}

async function productKeysForProvider(db, manufacturerId, providerExternalId) {
  const rows = await queryAll(
    db,
    `SELECT DISTINCT v.product_key
     FROM eazpire_product_versions v
     INNER JOIN eazpire_products ep ON ep.product_key = v.product_key
     INNER JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
     WHERE ep.manufacturer_id = ? AND fp.external_provider_id = ?`,
    manufacturerId,
    providerExternalId
  );
  return rows.map((r) => r.product_key);
}

async function listAvailableBlueprints(db, manufacturerId) {
  const blueprintRows = await queryAll(
    db,
    `SELECT eb.id, eb.blueprint_key, eb.title, eb.normalized_category, eb.status, eb.updated_at,
            eb.normalized_json, pb.raw_json
     FROM manufacturer_eazpire_blueprints eb
     LEFT JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
     WHERE eb.manufacturer_id = ? AND eb.status = 'live'
       AND NOT EXISTS (
         SELECT 1 FROM eazpire_products ep WHERE ep.source_blueprint_id = eb.id
       )
     ORDER BY eb.title ASC`,
    manufacturerId
  );

  return blueprintRows.map((b) => ({
    kind: "blueprint",
    blueprint_id: b.id,
    blueprint_key: b.blueprint_key,
    title: b.title,
    category: b.normalized_category,
    catalog_status: "available",
    updated_at: b.updated_at,
    mock_images: imagesFromBlueprintData(b.normalized_json, b.raw_json),
    print_areas: printAreasFromNormalized(b.normalized_json),
  }));
}

export { formatPrintAreaLabel };
