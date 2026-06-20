/**
 * Catalog Studio — partner / provider tree + product list for admin UI
 */

import { buildCategoryTree, CAT_REVERSE, CATEGORY_GROUPS } from "../../admin/catalogConstants.js";
import { listPartnersForAdmin, getPartnerByIdOrSlug } from "./printifyPartnerSeed.js";
import { listFulfillmentProviders } from "./fulfillmentProviderService.js";
import { listEazpireProducts, updateEazpireProduct } from "./eazpireProductService.js";
import { parseJson } from "../db.js";
import { mirrorEazpireProductToCatalogDb } from "./mirrorToCatalogDb.js";
import { PRINTIFY_PARTNER_SLUG } from "./constants.js";
import { fetchBlueprint, buildPrintifyCatalogProductUrl } from "../adapters/printify/printifyCatalogClient.js";

const BLUEPRINT_API_CONCURRENCY = 5;
const BLUEPRINT_ID_CHUNK = 100;
/** List view must not fan out to Printify (subrequest / CPU limits with ~1000+ blueprints). */
const BLUEPRINT_API_LIST_FALLBACK_MAX = 0;
/** Skip manufacturer raw_json enrichment above this count (Worker CPU/memory). */
const AVAILABLE_BULK_ENRICHMENT_MAX = 0;
const PRINTIFY_CHOICE_PROVIDER_ID = 99;
/** Max Printify blueprint API lookups per list request (online / small sets). */
const PRINT_AREAS_API_FETCH_MAX = 30;

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

function printAreasFromBlueprintData(normalizedJson, rawJson) {
  const keys = new Set(printAreasFromNormalized(normalizedJson));

  const normalized = parseJson(normalizedJson, {}) || {};
  const raw = parseJson(rawJson, {}) || {};
  const printifyRaw = normalized._printify_raw || raw;
  const areas = printifyRaw?.print_areas || printifyRaw?.printAreas || [];
  if (Array.isArray(areas)) {
    for (const area of areas) {
      const key = area?.area_key || area?.key || area?.name;
      if (key) keys.add(String(key));
      for (const ph of area?.placeholders || []) {
        if (ph?.position) keys.add(String(ph.position));
      }
    }
  }

  return [...keys].sort();
}

function enrichmentFromBlueprintJson(normalizedJson, rawJson) {
  return {
    mock_images: imagesFromBlueprintData(normalizedJson, rawJson),
    print_areas: printAreasFromBlueprintData(normalizedJson, rawJson),
  };
}

function parseCatalogImagesJson(imagesJson) {
  try {
    return JSON.parse(imagesJson || "[]").filter((i) => typeof i === "string");
  } catch {
    return [];
  }
}

function blueprintSupportsProvider(printProvidersJson, providerExternalId) {
  if (providerExternalId == null || providerExternalId === "") return true;
  const providerId = String(providerExternalId);
  const providers = parseJson(printProvidersJson, []);
  if (!Array.isArray(providers)) return false;
  return providers.some((p) => String(p?.id) === providerId);
}

function mergeEnrichment(existing, enrichment) {
  const mock_images = [...(existing.mock_images || [])];
  for (const url of enrichment?.mock_images || []) pushImageUrl(mock_images, url);

  const printAreaSet = new Set(existing.print_areas || []);
  for (const key of enrichment?.print_areas || []) printAreaSet.add(String(key));

  return {
    mock_images,
    print_areas: [...printAreaSet].sort(),
  };
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

/** Technical eazpire catalog keys → admin CATEGORY_GROUPS leaf names. */
const TECHNICAL_CATEGORY_MAP = {
  "apparel.hoodie": "Hoodie",
  "apparel.tshirt": "T-Shirt",
  "apparel.sweater": "Sweatshirt",
  "apparel.jacket": "Jacket",
  "apparel.pants": "Joggers",
  "apparel.socks": "Socks",
  "home.mug": "Mug",
  "wall_art.poster": "Poster",
  "wall_art.canvas": "Canvas",
  "accessory.bag": "Tote Bag",
};

/** Printify / blueprint label aliases → CATEGORY_GROUPS leaf names. */
const PRINTIFY_CATEGORY_ALIASES = {
  "t-shirts": "T-Shirt",
  "t-shirt": "T-Shirt",
  tees: "T-Shirt",
  hoodies: "Hoodie",
  hoodie: "Hoodie",
  mugs: "Mug",
  mug: "Mug",
  posters: "Poster",
  poster: "Poster",
  "tote bags": "Tote Bag",
  "tote bag": "Tote Bag",
  bags: "Bag",
  sweatshirts: "Sweatshirt",
  sweatshirt: "Sweatshirt",
  "tank tops": "Tank Top",
  "tank top": "Tank Top",
  "phone cases": "Phone Case",
  "phone case": "Phone Case",
  canvases: "Canvas",
  canvas: "Canvas",
  stickers: "Sticker",
  pillows: "Pillow",
  blankets: "Blanket",
};

const GROUP_ALIASES = {
  clothing: "Kleidung",
  kleidung: "Kleidung",
  accessories: "Accessoires",
  accessoires: "Accessoires",
  bags: "Taschen",
  taschen: "Taschen",
  drinkware: "Drinkware",
  "wall art": "Wall Art",
  home: "Home",
  kitchen: "Kueche",
  kueche: "Kueche",
  tech: "Tech",
  paper: "Papier",
  papier: "Papier",
  jewelry: "Schmuck",
  schmuck: "Schmuck",
  shoes: "Schuhe",
  schuhe: "Schuhe",
  pet: "Pet",
  auto: "Auto",
  wellness: "Wellness",
  sport: "Sport",
};

function normalizeGroupName(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return null;
  if (CATEGORY_GROUPS[raw]) return raw;
  if (GROUP_ALIASES[key]) return GROUP_ALIASES[key];
  for (const groupName of Object.keys(CATEGORY_GROUPS)) {
    if (groupName.toLowerCase() === key) return groupName;
  }
  return null;
}

function fuzzyMatchCategoryLeaf(token) {
  const t = String(token || "").trim().toLowerCase();
  if (!t) return null;
  for (const cats of Object.values(CATEGORY_GROUPS)) {
    for (const cat of cats) {
      const c = cat.toLowerCase();
      if (c === t || c.replace(/[\s-/]/g, "") === t.replace(/[\s-/]/g, "")) return cat;
      if (c.includes(t) || t.includes(c.replace(/[\s-/]/g, ""))) return cat;
    }
  }
  return null;
}

function normalizePrintifyCategoryName(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (CAT_REVERSE[s]) return s;

  const lower = s.toLowerCase();
  if (PRINTIFY_CATEGORY_ALIASES[lower]) return PRINTIFY_CATEGORY_ALIASES[lower];

  const fuzzy = fuzzyMatchCategoryLeaf(lower);
  if (fuzzy) return fuzzy;

  return s;
}

function resolveStudioCategory(item) {
  const rawLeaf = String(item.catalog_category_leaf || item.category || item.blueprint_category || "").trim();
  const rawGroup = String(item.catalog_category_group || item.parent_group || "").trim();

  let category = null;

  if (rawLeaf.includes(".")) {
    const techKey = rawLeaf.toLowerCase();
    category = TECHNICAL_CATEGORY_MAP[techKey] || fuzzyMatchCategoryLeaf(techKey.split(".").pop());
  }

  if (!category && rawLeaf) {
    category = normalizePrintifyCategoryName(rawLeaf);
  }

  if (!category && item.blueprint_category) {
    category = normalizePrintifyCategoryName(item.blueprint_category);
  }

  if (!category) category = "Sonstiges";

  let parent_group = CAT_REVERSE[category] || normalizeGroupName(rawGroup) || "Sonstiges";
  if (!CATEGORY_GROUPS[parent_group] && parent_group !== "Sonstiges") {
    parent_group = CAT_REVERSE[category] || "Sonstiges";
  }

  return { category, parent_group };
}

function itemCategoryFields(item) {
  return resolveStudioCategory(item);
}

function enrichItemsWithCategory(items) {
  return items.map((row) => ({ ...row, ...itemCategoryFields(row) }));
}

/** Detect All Over Print products from catalog title (Printify naming conventions). */
function isAllOverPrintFromTitle(title) {
  const raw = String(title || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  if (/all[\s-]?over[\s-]?print/.test(lower)) return true;
  if (/all[\s-]over\b/.test(lower)) return true;
  if (/\(aop\)/.test(lower)) return true;
  if (/\baop\b/.test(lower)) return true;

  const stripped = lower.replace(/[^\w]+$/, "").trim();
  if (stripped === "aop" || /[\s_-]aop$/.test(stripped)) return true;

  return false;
}

function slimAvailableListItem(row) {
  const codes = shippingCodesForItem(row.shipping_country_codes, row.shipping_countries_raw);
  return {
    kind: row.kind,
    blueprint_id: row.blueprint_id,
    printify_blueprint_id: row.printify_blueprint_id,
    blueprint_key: row.blueprint_key,
    title: row.title,
    category: row.category,
    audience: row.audience,
    catalog_status: row.catalog_status,
    mock_images: row.mock_images || [],
    print_areas: row.print_areas || [],
    provider_count: row.provider_count ?? 0,
    printify_choice: row.printify_choice || null,
    printify_url: row.printify_url || null,
    shipping_country_codes: codes,
    shipping_countries: formatShippingCountriesDisplay(codes),
    is_aop: isAllOverPrintFromTitle(row.title),
  };
}

function slimMockImagesForList(urls, max = 3) {
  return (urls || []).slice(0, max);
}

function buildProductsResponse(filter, items) {
  const enriched = enrichItemsWithCategory(items);
  return {
    ok: true,
    filter,
    items: enriched,
    total: enriched.length,
    category_tree: buildCategoryTree(enriched),
  };
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

function parseCountryCodesFromJson(json) {
  const parsed = parseJson(json, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((c) => String(c || "").trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
}

function parseShippingCountriesString(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
}

function formatShippingCountriesDisplay(codes) {
  const unique = [...new Set((codes || []).filter(Boolean))].sort();
  return unique.length ? unique.join(", ") : null;
}

function shippingCodesForItem(rawCodes, rawString) {
  if (Array.isArray(rawCodes) && rawCodes.length) {
    return [...new Set(rawCodes.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
  }
  return parseShippingCountriesString(rawString).sort();
}

function printAreasFromTemplateJson(json) {
  const arr = parseJson(json, []);
  if (!Array.isArray(arr)) return [];
  const keys = new Set();
  for (const area of arr) {
    const key = area?.name || area?.key || area?.area_key;
    if (key) keys.add(String(key));
    for (const ph of area?.placeholders || []) {
      if (ph?.position) keys.add(String(ph.position));
    }
  }
  return [...keys].sort();
}

function printAreasFromStoredJson(json) {
  const parsed = parseJson(json, []);
  if (Array.isArray(parsed)) {
    return parsed.map((k) => String(k)).filter(Boolean).sort();
  }
  if (parsed && typeof parsed === "object") {
    return Object.keys(parsed).filter((k) => k && k !== "null").sort();
  }
  return [];
}

function extractPrintAreaNamesFromPrintifyBlueprint(blueprint) {
  const areas = blueprint?.print_areas || blueprint?.printAreas || [];
  if (!Array.isArray(areas)) return [];
  const keys = new Set();
  for (const area of areas) {
    const key = area?.name || area?.key || area?.area_key;
    if (key) keys.add(String(key));
    for (const ph of area?.placeholders || []) {
      if (ph?.position) keys.add(String(ph.position));
    }
  }
  return [...keys].sort();
}

/**
 * @deprecated Shipping profiles indicate delivery regions, not Printify Choice US vs World tier.
 * Kept for reference/tests only — do not use for Catalog Studio badges.
 */
export function resolvePrintifyChoiceTypeFromShippingData(shippingData) {
  const countries = new Set();
  for (const profile of shippingData?.profiles || []) {
    for (const c of profile.countries || []) {
      countries.add(String(c).toUpperCase());
    }
  }
  if (!countries.size) return null;
  if (countries.has("REST_OF_THE_WORLD")) return "world";
  for (const code of countries) {
    if (code !== "US") return "world";
  }
  return "us";
}

/**
 * Printify Choice US vs World for Catalog Studio.
 * - Explicit DB value (`us`|`world`) wins (manual override from UI).
 * - When provider 99 is available but unset → default **US Only** (matches Printify dashboard).
 * @param {string|null|undefined} cachedType - us|world from catalog DB
 * @returns {null|'us'|'world'}
 */
export function resolvePrintifyChoiceType(printProvidersJson, cachedType = null) {
  if (cachedType === "us" || cachedType === "world") return cachedType;
  const providers = parseJson(printProvidersJson, []);
  if (!Array.isArray(providers)) return null;
  if (!providers.some((p) => Number(p?.id) === PRINTIFY_CHOICE_PROVIDER_ID)) return null;
  return "us";
}

async function loadBlueprintShippingByExternalIds(catalogDb, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !catalogDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await queryAll(
      catalogDb,
      `SELECT id, shipping_countries FROM printify_blueprints WHERE id IN (${placeholders})`,
      ...chunk
    );
    for (const row of rows) {
      map.set(String(row.id), parseShippingCountriesString(row.shipping_countries));
    }
  }
  return map;
}

async function loadShippingCountriesByProductKey(db, env, products) {
  const map = new Map();
  if (!products.length) return map;

  const productKeys = products.map((p) => p.product_key);
  const placeholders = productKeys.map(() => "?").join(",");

  const providerRows = await queryAll(
    db,
    `SELECT DISTINCT v.product_key, fp.ships_to_json
     FROM eazpire_product_versions v
     INNER JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
     WHERE v.product_key IN (${placeholders})`,
    ...productKeys
  );

  for (const row of providerRows) {
    if (!map.has(row.product_key)) map.set(row.product_key, new Set());
    for (const code of parseCountryCodesFromJson(row.ships_to_json)) {
      map.get(row.product_key).add(code);
    }
  }

  if (env?.CATALOG_DB) {
    const blueprintLinks = await queryAll(
      db,
      `SELECT ep.product_key, pb.external_blueprint_id
       FROM eazpire_products ep
       INNER JOIN manufacturer_eazpire_blueprints eb ON eb.id = ep.source_blueprint_id
       INNER JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
       WHERE ep.product_key IN (${placeholders})`,
      ...productKeys
    );
    const externalIds = blueprintLinks.map((r) => String(r.external_blueprint_id)).filter(Boolean);
    const shippingByExternalId = await loadBlueprintShippingByExternalIds(env.CATALOG_DB, externalIds);

    for (const link of blueprintLinks) {
      const codes = shippingByExternalId.get(String(link.external_blueprint_id)) || [];
      if (!codes.length) continue;
      if (!map.has(link.product_key)) map.set(link.product_key, new Set());
      for (const code of codes) map.get(link.product_key).add(code);
    }
  }

  const out = new Map();
  for (const key of productKeys) {
    const set = map.get(key);
    out.set(key, set ? [...set].sort() : []);
  }
  return out;
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

async function loadPrintAreasFromCatalogColumn(catalogDb, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !catalogDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows = await queryAll(
        catalogDb,
        `SELECT id, print_areas_json FROM printify_blueprints WHERE id IN (${placeholders})`,
        ...chunk
      );
      for (const row of rows) {
        const areas = printAreasFromStoredJson(row.print_areas_json);
        if (areas.length) map.set(String(row.id), areas);
      }
    } catch (e) {
      if (!String(e?.message || e).includes("no such column")) throw e;
      break;
    }
  }
  return map;
}

/** Lightweight: normalized_json only (no raw_json) for large available lists. */
async function loadPrintAreasLightByExternalIds(mfgDb, manufacturerId, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !mfgDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await queryAll(
      mfgDb,
      `SELECT pb.external_blueprint_id, eb.normalized_json
       FROM manufacturer_provider_blueprints pb
       LEFT JOIN manufacturer_eazpire_blueprints eb ON eb.provider_blueprint_id = pb.id
       WHERE pb.manufacturer_id = ? AND pb.external_blueprint_id IN (${placeholders})`,
      manufacturerId,
      ...chunk
    );
    for (const row of rows) {
      const areas = printAreasFromBlueprintData(row.normalized_json, null);
      if (areas.length) map.set(String(row.external_blueprint_id), areas);
    }
  }
  return map;
}

async function fetchPrintAreasByExternalIds(env, externalIds, maxCount = PRINT_AREAS_API_FETCH_MAX) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))].slice(0, maxCount);
  if (!ids.length || !env) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_API_CONCURRENCY) {
    const batch = ids.slice(i, i + BLUEPRINT_API_CONCURRENCY);
    await Promise.all(
      batch.map(async (externalId) => {
        const result = await fetchBlueprint(env, externalId);
        if (!result.ok || !result.blueprint) return;
        const areas = extractPrintAreaNamesFromPrintifyBlueprint(result.blueprint);
        if (areas.length) map.set(externalId, areas);
      })
    );
  }
  return map;
}

async function loadPrintAreasFromTemplateProducts(db, productKeys) {
  const map = new Map();
  if (!productKeys.length) return map;
  const placeholders = productKeys.map(() => "?").join(",");
  const rows = await queryAll(
    db,
    `SELECT product_key, print_areas_json FROM eazpire_template_products
     WHERE product_key IN (${placeholders}) AND print_areas_json IS NOT NULL AND TRIM(print_areas_json) != ''`,
    ...productKeys
  );
  for (const row of rows) {
    const areas = printAreasFromTemplateJson(row.print_areas_json);
    if (!areas.length) continue;
    if (!map.has(row.product_key)) map.set(row.product_key, new Set());
    for (const a of areas) map.get(row.product_key).add(a);
  }
  const out = new Map();
  for (const [key, set] of map) out.set(key, [...set].sort());
  return out;
}

async function loadPrintifyBlueprintExternalIdsForProducts(db, env, products) {
  const map = new Map();
  if (!products.length) return map;

  const productKeys = products.map((p) => p.product_key);
  const placeholders = productKeys.map(() => "?").join(",");

  const mfgLinks = await queryAll(
    db,
    `SELECT ep.product_key, pb.external_blueprint_id
     FROM eazpire_products ep
     INNER JOIN manufacturer_eazpire_blueprints eb ON eb.id = ep.source_blueprint_id
     INNER JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
     WHERE ep.product_key IN (${placeholders})`,
    ...productKeys
  );
  for (const row of mfgLinks) {
    if (row.external_blueprint_id != null) map.set(row.product_key, String(row.external_blueprint_id));
  }

  if (env?.CATALOG_DB) {
    try {
      const catalogLinks = await queryAll(
        env.CATALOG_DB,
        `SELECT product_key, blueprint_id FROM product_publish_profiles
         WHERE product_key IN (${placeholders}) AND blueprint_id IS NOT NULL
         GROUP BY product_key`,
        ...productKeys
      );
      for (const row of catalogLinks) {
        if (!map.has(row.product_key) && row.blueprint_id != null) {
          map.set(row.product_key, String(row.blueprint_id));
        }
      }
    } catch {
      /* optional */
    }
  }
  return map;
}

async function loadPrintifyChoiceTypeByExternalIds(catalogDb, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !catalogDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows = await queryAll(
        catalogDb,
        `SELECT id, printify_choice_type, print_providers_json FROM printify_blueprints WHERE id IN (${placeholders})`,
        ...chunk
      );
      for (const row of rows) {
        const type = resolvePrintifyChoiceType(row.print_providers_json, row.printify_choice_type);
        if (type) map.set(String(row.id), type);
      }
    } catch (e) {
      if (!String(e?.message || e).includes("no such column")) throw e;
      break;
    }
  }
  return map;
}

async function loadPrintifyCatalogUrlsByExternalIds(catalogDb, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !catalogDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows = await queryAll(
        catalogDb,
        `SELECT id, brand, title FROM printify_blueprints WHERE id IN (${placeholders})`,
        ...chunk
      );
      for (const row of rows) {
        const url = buildPrintifyCatalogProductUrl(row.id, row.brand, row.title);
        if (url) map.set(String(row.id), url);
      }
    } catch (e) {
      if (!String(e?.message || e).includes("no such column")) throw e;
      break;
    }
  }
  return map;
}

async function loadPrintifyChoiceByProductKeys(db, env, productKeys, blueprintExternalIds) {
  const map = new Map();
  if (!productKeys.length) return map;

  if (env?.CATALOG_DB && blueprintExternalIds?.size) {
    const typeByExternal = await loadPrintifyChoiceTypeByExternalIds(env.CATALOG_DB, [
      ...blueprintExternalIds.values(),
    ]);
    for (const [productKey, extId] of blueprintExternalIds) {
      const type = typeByExternal.get(String(extId));
      if (type) map.set(productKey, type);
    }
  }

  return map;
}

function applyPrintAreasToAvailableItems(items, ...areaMaps) {
  return items.map((item) => {
    const externalId = String(item.printify_blueprint_id || item.blueprint_key || "");
    let merged = { print_areas: item.print_areas || [] };
    for (const m of areaMaps) {
      const extra = m.get(externalId);
      if (extra?.length) merged = mergeEnrichment(merged, { print_areas: extra });
    }
    return { ...item, print_areas: merged.print_areas };
  });
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
 * @param {object} db — MANUFACTURER_DB
 * @param {object} env — worker env (CATALOG_DB for Printify available list)
 * @param {object} opts
 * @param {string} opts.manufacturerId
 * @param {string} [opts.providerExternalId] — Printify print_provider_id
 * @param {'available'|'online'|'preview'|'offline'} opts.filter
 */
export async function getCatalogStudioProducts(db, env, { manufacturerId, providerExternalId, filter }) {
  if (!manufacturerId) return { ok: false, error: "manufacturer_id_required" };

  const providerId = providerExternalId != null && providerExternalId !== "" ? String(providerExternalId) : null;

  if (filter === "available") {
    const partner = await getPartnerByIdOrSlug(db, manufacturerId);
    const isPrintify = String(partner?.slug || "").toLowerCase() === PRINTIFY_PARTNER_SLUG;
    const rows =
      isPrintify && env?.CATALOG_DB
        ? await listAvailablePrintifyBlueprints(env, db, manufacturerId, providerId)
        : await listAvailableBlueprints(db, manufacturerId);
    const items = rows.map((row) => slimAvailableListItem(row));
    return buildProductsResponse(filter, items);
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
  const templateAreasMap = await loadPrintAreasFromTemplateProducts(db, productKeys);
  const shippingCountryCodesMap = await loadShippingCountriesByProductKey(db, env, products);
  const blueprintEnrichmentMap = await loadBlueprintEnrichmentForEazpireProducts(db, products);
  const blueprintExternalIds = await loadPrintifyBlueprintExternalIdsForProducts(db, env, products);
  const choiceMap = await loadPrintifyChoiceByProductKeys(db, env, productKeys, blueprintExternalIds);
  const printifyUrlMap =
    env?.CATALOG_DB && blueprintExternalIds.size
      ? await loadPrintifyCatalogUrlsByExternalIds(env.CATALOG_DB, [...blueprintExternalIds.values()])
      : new Map();

  const catalogAreasMap =
    env?.CATALOG_DB && blueprintExternalIds.size
      ? await loadPrintAreasFromCatalogColumn(env.CATALOG_DB, [...blueprintExternalIds.values()])
      : new Map();

  const needApiBlueprintIds = [];
  for (const p of products) {
    const areasFromDb = printAreasMap.get(p.product_key) || [];
    const templateAreas = templateAreasMap.get(p.product_key) || [];
    const blueprintEnrichment = blueprintEnrichmentMap.get(p.product_key) || {};
    const extId = blueprintExternalIds.get(p.product_key);
    const catalogAreas = extId ? catalogAreasMap.get(String(extId)) || [] : [];
    const merged = mergeEnrichment(
      mergeEnrichment({ print_areas: areasFromDb }, { print_areas: templateAreas }),
      mergeEnrichment(blueprintEnrichment, { print_areas: catalogAreas })
    );
    if (merged.print_areas.length <= 1 && extId) needApiBlueprintIds.push(extId);
  }
  const apiPrintAreasMap = await fetchPrintAreasByExternalIds(env, needApiBlueprintIds);

  const items = products.map((p) => {
    const blueprintEnrichment = blueprintEnrichmentMap.get(p.product_key) || {};
    const mockFromDb = mockImagesMap.get(p.product_key) || [];
    const areasFromDb = printAreasMap.get(p.product_key) || [];
    const templateAreas = templateAreasMap.get(p.product_key) || [];
    const extId = blueprintExternalIds.get(p.product_key);
    const merged = mergeEnrichment(
      mergeEnrichment({ mock_images: mockFromDb, print_areas: areasFromDb }, blueprintEnrichment),
      {
        print_areas: [
          ...(templateAreasMap.get(p.product_key) || []),
          ...(extId ? catalogAreasMap.get(String(extId)) || [] : []),
          ...(extId ? apiPrintAreasMap.get(String(extId)) || [] : []),
        ],
      }
    );
    const codes = shippingCountryCodesMap.get(p.product_key) || [];
    return {
      kind: "eazpire_product",
      product_key: p.product_key,
      title: p.title,
      catalog_status: p.catalog_status,
      catalog_category_leaf: p.catalog_category_leaf,
      catalog_category_group: p.catalog_category_group,
      blueprint_category: p.blueprint_category,
      version_count: p.version_count ?? 0,
      blueprint_title: p.blueprint_title,
      updated_at: p.updated_at,
      mock_images: merged.mock_images,
      shipping_country_codes: codes,
      shipping_countries: formatShippingCountriesDisplay(codes),
      print_areas: merged.print_areas,
      printify_choice: choiceMap.get(p.product_key) || null,
      printify_url: extId ? printifyUrlMap.get(String(extId)) || null : null,
      printify_blueprint_id: extId ? Number(extId) || null : null,
      is_aop: isAllOverPrintFromTitle(p.title),
    };
  });

  return buildProductsResponse(status, items);
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

/**
 * Persist manual Printify Choice US / World override on printify_blueprints (CATALOG_DB).
 */
export async function setCatalogStudioPrintifyChoice(env, { blueprintId, choiceType }) {
  const catalogDb = env?.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const id = Number(blueprintId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "blueprint_id_required" };

  const choice = String(choiceType || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  const normalized =
    choice === "us" || choice === "us_only" || choice === "printify_choice_us"
      ? "us"
      : choice === "world" || choice === "printify_choice_world"
        ? "world"
        : null;
  if (!normalized) return { ok: false, error: "invalid_choice_type" };

  try {
    const existing = await catalogDb.prepare("SELECT id FROM printify_blueprints WHERE id = ?").bind(id).first();
    if (!existing) return { ok: false, error: "blueprint_not_found" };

    await catalogDb
      .prepare("UPDATE printify_blueprints SET printify_choice_type = ?, updated_at = ? WHERE id = ?")
      .bind(normalized, Date.now(), id)
      .run();

    return { ok: true, blueprint_id: id, printify_choice: normalized };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("no such column")) {
      return { ok: false, error: "printify_choice_type_column_missing" };
    }
    return { ok: false, error: "update_failed", detail: msg };
  }
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

async function loadCachedBlueprintEnrichmentByExternalIds(mfgDb, manufacturerId, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !mfgDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await queryAll(
      mfgDb,
      `SELECT pb.external_blueprint_id, pb.raw_json, eb.normalized_json
       FROM manufacturer_provider_blueprints pb
       LEFT JOIN manufacturer_eazpire_blueprints eb ON eb.provider_blueprint_id = pb.id
       WHERE pb.manufacturer_id = ? AND pb.external_blueprint_id IN (${placeholders})`,
      manufacturerId,
      ...chunk
    );
    for (const row of rows) {
      map.set(String(row.external_blueprint_id), enrichmentFromBlueprintJson(row.normalized_json, row.raw_json));
    }
  }
  return map;
}

async function loadCachedBlueprintEnrichmentByEazpireIds(mfgDb, eazpireBlueprintIds) {
  const map = new Map();
  const ids = [...new Set(eazpireBlueprintIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !mfgDb) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_ID_CHUNK) {
    const chunk = ids.slice(i, i + BLUEPRINT_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await queryAll(
      mfgDb,
      `SELECT eb.id, eb.normalized_json, pb.raw_json, pb.external_blueprint_id
       FROM manufacturer_eazpire_blueprints eb
       LEFT JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
       WHERE eb.id IN (${placeholders})`,
      ...chunk
    );
    for (const row of rows) {
      map.set(String(row.id), {
        external_blueprint_id: row.external_blueprint_id != null ? String(row.external_blueprint_id) : null,
        ...enrichmentFromBlueprintJson(row.normalized_json, row.raw_json),
      });
    }
  }
  return map;
}

async function fetchBlueprintEnrichmentByExternalIds(env, externalIds) {
  const map = new Map();
  const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length || !env) return map;

  for (let i = 0; i < ids.length; i += BLUEPRINT_API_CONCURRENCY) {
    const batch = ids.slice(i, i + BLUEPRINT_API_CONCURRENCY);
    await Promise.all(
      batch.map(async (externalId) => {
        const result = await fetchBlueprint(env, externalId);
        if (!result.ok || !result.blueprint) return;
        const rawJson = JSON.stringify(result.blueprint);
        map.set(externalId, enrichmentFromBlueprintJson(null, rawJson));
      })
    );
  }
  return map;
}

async function enrichPrintifyAvailableItems(env, mfgDb, manufacturerId, items, { allowApiFallback = false } = {}) {
  if (!items.length) return items;

  const externalIds = items.map((item) => String(item.printify_blueprint_id || item.blueprint_key || "")).filter(Boolean);
  const cached = await loadCachedBlueprintEnrichmentByExternalIds(mfgDb, manufacturerId, externalIds);

  let apiFetched = new Map();
  if (allowApiFallback && BLUEPRINT_API_LIST_FALLBACK_MAX > 0) {
    const missingPrintAreas = externalIds.filter((id) => {
      const cachedEntry = cached.get(id);
      const item = items.find((row) => String(row.printify_blueprint_id || row.blueprint_key) === id);
      const hasAreas = (cachedEntry?.print_areas?.length || item?.print_areas?.length) > 0;
      return !hasAreas;
    });
    const toFetch = missingPrintAreas.slice(0, BLUEPRINT_API_LIST_FALLBACK_MAX);
    if (toFetch.length) {
      apiFetched = await fetchBlueprintEnrichmentByExternalIds(env, toFetch);
    }
  }

  return items.map((item) => {
    const externalId = String(item.printify_blueprint_id || item.blueprint_key || "");
    const enrichment = mergeEnrichment(
      { mock_images: item.mock_images || [], print_areas: item.print_areas || [] },
      cached.get(externalId) || apiFetched.get(externalId) || {}
    );
    return { ...item, ...enrichment };
  });
}

async function loadBlueprintEnrichmentForEazpireProducts(mfgDb, products) {
  const out = new Map();
  const withBlueprint = products.filter((p) => p.source_blueprint_id);
  if (!withBlueprint.length || !mfgDb) return out;

  const blueprintIds = [...new Set(withBlueprint.map((p) => String(p.source_blueprint_id)))];
  const cachedByBlueprintId = await loadCachedBlueprintEnrichmentByEazpireIds(mfgDb, blueprintIds);

  for (const product of withBlueprint) {
    const cached = cachedByBlueprintId.get(String(product.source_blueprint_id));
    if (cached) out.set(product.product_key, cached);
  }
  return out;
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
    category: b.normalized_category || "Sonstiges",
    catalog_status: "available",
    updated_at: b.updated_at,
    mock_images: imagesFromBlueprintData(b.normalized_json, b.raw_json),
    print_areas: printAreasFromBlueprintData(b.normalized_json, b.raw_json),
  }));
}

/** Printify Available — full CATALOG_DB catalog minus legacy usage and active eazpire products. */
async function loadPrintifyBlueprintCatalogRows(catalogDb) {
  const queries = [
    `SELECT id, title, category, audience, shipping_countries, images_json, print_providers_json, print_provider_count, print_areas_json, printify_choice_type, brand
     FROM printify_blueprints ORDER BY category, title`,
    `SELECT id, title, category, audience, shipping_countries, images_json, print_providers_json, print_provider_count, print_areas_json, brand
     FROM printify_blueprints ORDER BY category, title`,
    `SELECT id, title, category, audience, shipping_countries, images_json, print_providers_json, print_provider_count
     FROM printify_blueprints ORDER BY category, title`,
    `SELECT id, title, images_json, print_provider_count FROM printify_blueprints ORDER BY title`,
  ];

  for (const sql of queries) {
    try {
      const all = await catalogDb.prepare(sql).all();
      const rows = all?.results || [];
      if (sql.includes("printify_choice_type")) return rows;
      if (sql.includes("print_areas_json")) {
        return rows.map((row) => ({ ...row, printify_choice_type: null }));
      }
      return rows.map((row) => ({
        ...row,
        category: row.category ?? null,
        audience: row.audience ?? null,
        shipping_countries: row.shipping_countries ?? null,
        print_providers_json: row.print_providers_json ?? null,
        print_areas_json: null,
        printify_choice_type: null,
        brand: row.brand ?? null,
      }));
    } catch (queryErr) {
      const msg = String(queryErr?.message || queryErr);
      if (!msg.includes("no such column")) throw queryErr;
    }
  }
  return [];
}

async function listAvailablePrintifyBlueprints(env, mfgDb, manufacturerId, providerExternalId = null) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return listAvailableBlueprints(mfgDb, manufacturerId);

  let items = [];
  try {
    const linkedRows = await queryAll(
      mfgDb,
      `SELECT DISTINCT pb.external_blueprint_id
       FROM eazpire_products ep
       INNER JOIN manufacturer_eazpire_blueprints eb ON eb.id = ep.source_blueprint_id
       INNER JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
       WHERE ep.manufacturer_id = ?`,
      manufacturerId
    );
    const linkedExternalIds = new Set(linkedRows.map((r) => String(r.external_blueprint_id)));

    const usedInCatalog = await catalogDb
      .prepare(
        `SELECT DISTINCT blueprint_id FROM product_publish_profiles
         WHERE blueprint_id IS NOT NULL AND source_system = 'printify'`
      )
      .all();
    const usedCatalogIds = new Set((usedInCatalog?.results || []).map((r) => String(r.blueprint_id)));

    const blueprintRows = await loadPrintifyBlueprintCatalogRows(catalogDb);

    for (const bp of blueprintRows) {
      if (usedCatalogIds.has(String(bp.id))) continue;
      if (linkedExternalIds.has(String(bp.id))) continue;
      if (!blueprintSupportsProvider(bp.print_providers_json, providerExternalId)) continue;

      items.push({
        kind: "blueprint",
        blueprint_id: `printify-${bp.id}`,
        printify_blueprint_id: bp.id,
        blueprint_key: String(bp.id),
        title: bp.title,
        category: bp.category || "Sonstiges",
        audience: bp.audience,
        catalog_status: "available",
        mock_images: slimMockImagesForList(parseCatalogImagesJson(bp.images_json)),
        print_areas: printAreasFromStoredJson(bp.print_areas_json),
        printify_choice: resolvePrintifyChoiceType(bp.print_providers_json, bp.printify_choice_type),
        printify_url: buildPrintifyCatalogProductUrl(bp.id, bp.brand, bp.title),
        provider_count: bp.print_provider_count || 0,
        shipping_countries_raw: bp.shipping_countries,
      });
    }
  } catch (err) {
    console.error("[catalog-studio] listAvailablePrintifyBlueprints failed:", err?.message || err);
    return listAvailableBlueprints(mfgDb, manufacturerId);
  }

  if (items.length > 0 && items.length <= 100) {
    try {
      const externalIds = items.map((item) => String(item.printify_blueprint_id));
      const fromMfg = await loadPrintAreasLightByExternalIds(mfgDb, manufacturerId, externalIds);
      items = applyPrintAreasToAvailableItems(items, new Map(), fromMfg);
    } catch (err) {
      console.warn("[catalog-studio] optional print area merge skipped:", err?.message || err);
    }
  }

  return items;
}

export {
  formatPrintAreaLabel,
  formatShippingCountriesDisplay,
  imagesFromBlueprintData,
  isAllOverPrintFromTitle,
  parseShippingCountriesString,
  printAreasFromBlueprintData,
  printAreasFromNormalized,
  blueprintSupportsProvider,
  mergeEnrichment,
  resolveStudioCategory,
  extractPrintAreaNamesFromPrintifyBlueprint,
};
