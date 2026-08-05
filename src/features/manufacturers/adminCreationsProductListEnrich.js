/**
 * Admin Creations Products — list-level enrichment for the Product Filter sidebar,
 * "Needs Update" badge, and Amazon/branding facets (IDEA-063).
 *
 * `enrichCreationsProductListFacets` decorates each product row (as produced by
 * adminCreationsPortalApi.js handlers) with the extra fields the filter sidebar,
 * cards, and bulk dock need. `buildProductFilterFacets` then aggregates those
 * enriched rows into count-bucketed facets for the sidebar UI.
 */

import { EU_MARKETPLACES, NA_MARKETPLACES } from "../../config/amazonMarketplaces.js";
import { mapAmazonListingRowToAdminStatus } from "../product/amazonAdminPublish.js";
import { resolvePlanCountryCodes } from "../catalog/resolvePlanCountries.js";
import { parseExtraPublicationIdsFromEnv } from "../publish/extraPublications.js";
import { listPublishActiveSessionRows } from "../publish/publishActiveSessions.js";
import {
  classifyPrintifyListingStatusFromRow,
  ensurePrintifyListingStatusColumn,
  parsePrintifyImagesJson,
  PRINTIFY_STATUS_LABELS,
  repairStalePrintifyListingStatusPublishing,
} from "../publish/printifyListingStatus.js";
import { normalizeShopifyProductId, indexShopifyNodesById } from "./adminCreationsShopifyList.js";

export { indexShopifyNodesById };

const EU_MARKETPLACE_IDS = new Set(Object.values(EU_MARKETPLACES));
/** Fully live status strings on D1 amazon_listing.status (also require ASIN/verified via helpers). */
const AMAZON_LIVE_STATUSES = new Set(["active", "published", "live", "listed", "verified", "suppressed"]);
/**
 * In-flight Amazon statuses — count toward Pending Amazon EU/US, not live Amazon EU/US.
 */
const AMAZON_PENDING_STATUSES = new Set([
  "verifying",
  "feed_pending",
  "submitted",
  "processing",
  "pending",
  "publishing",
  "queued",
  "pending_indexing",
]);

/** Fixed sales-channel keys a Creations product can be published on (incl. Amazon from D1). */
export function publicationChannelKeys() {
  return [
    "eazpire",
    "onlineshop",
    "eazpire_headless",
    "amazon_eu",
    "amazon_us",
    "pending_amazon_eu",
    "pending_amazon_us",
  ];
}

const CHANNEL_LABELS = {
  eazpire: "eazpire",
  onlineshop: "Online Store",
  eazpire_headless: "eazpire Headless",
  amazon_eu: "Amazon EU",
  amazon_us: "Amazon US",
  pending_amazon_eu: "Pending Amazon EU",
  pending_amazon_us: "Pending Amazon US",
};

export function channelLabelForKey(key) {
  return CHANNEL_LABELS[key] || String(key || "");
}

/** @deprecated Prefer isAmazonSuccessfullyPublished / isAmazonPendingPublish — kept for tests. */
export function isAmazonChannelPresentStatus(status) {
  const st = String(status || "").trim().toLowerCase();
  return AMAZON_LIVE_STATUSES.has(st) || AMAZON_PENDING_STATUSES.has(st);
}

/** True when an amazon_listing.status string alone looks fully live (no ASIN check). */
export function isAmazonLiveStatus(status) {
  return AMAZON_LIVE_STATUSES.has(String(status || "").trim().toLowerCase());
}

/**
 * Truly successfully published on Amazon (retail-live / ASIN / verified).
 * Uses the same criteria as Admin continent cards (`mapAmazonListingRowToAdminStatus` → published).
 * @param {{ status?: string|null, asin?: string|null, verified_status?: string|null, feed_id?: string|null, updated_at?: number|null }} row
 */
export function isAmazonSuccessfullyPublished(row) {
  return mapAmazonListingRowToAdminStatus(row) === "published";
}

/**
 * Waiting on Amazon (feed/verify/queue) — not failed-terminal and not live yet.
 * @param {{ status?: string|null, asin?: string|null, verified_status?: string|null, feed_id?: string|null, updated_at?: number|null }} row
 */
export function isAmazonPendingPublish(row) {
  return mapAmazonListingRowToAdminStatus(row) === "publishing";
}

/** Normalize Shopify Publication GID (accepts numeric id or full gid). */
export function normalizePublicationGid(gid) {
  const s = String(gid || "").trim();
  if (!s) return "";
  if (s.startsWith("gid://shopify/Publication/")) return s;
  const num = s.replace(/\D/g, "");
  return num ? `gid://shopify/Publication/${num}` : s;
}

/**
 * True when Shopify GraphQL node is published to Online Store sales channel.
 * Prefers `publications.channel.name`; falls back to ACTIVE status when publications absent.
 */
export function nodePublishedToOnlineStore(node, { fallbackActive = true } = {}) {
  const edges = node?.publications?.edges;
  if (Array.isArray(edges) && edges.length) {
    for (const edge of edges) {
      const n = edge?.node;
      if (!n?.isPublished) continue;
      const name = String(n?.channel?.name || "").trim().toLowerCase();
      if (name === "online store" || name.includes("online store")) return true;
    }
    return false;
  }
  if (!fallbackActive) return false;
  // No publication payload — keep prior ACTIVE heuristic so facets are not empty.
  return String(node?.status || "").toUpperCase() === "ACTIVE";
}

/**
 * True when node is published to any Headless / extra publication ID from env.
 * @param {object|null} node
 * @param {Iterable<string>} headlessPublicationGids
 */
export function nodePublishedToHeadless(node, headlessPublicationGids) {
  const allowed = new Set(
    [...(headlessPublicationGids || [])].map(normalizePublicationGid).filter(Boolean)
  );
  if (!allowed.size) return false;
  const edges = node?.resourcePublications?.edges || [];
  for (const edge of edges) {
    const n = edge?.node;
    if (!n?.isPublished) continue;
    const pid = normalizePublicationGid(n?.publication?.id);
    if (pid && allowed.has(pid)) return true;
  }
  return false;
}

function safeJsonParse(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

/**
 * Count non-empty metafield values on a Shopify GraphQL node.
 * Prefers `metafields.edges` (full list) when present; falls back to aliased `mf*` fields.
 */
export function countFilledMetafields(node) {
  if (!node || typeof node !== "object") return 0;
  const edges = node.metafields?.edges;
  if (Array.isArray(edges) && edges.length) {
    let count = 0;
    for (const edge of edges) {
      const value = edge?.node?.value;
      if (value != null && String(value).trim() !== "") count += 1;
    }
    return count;
  }
  let count = 0;
  for (const key of Object.keys(node)) {
    if (!key.startsWith("mf")) continue;
    const value = node[key]?.value;
    if (value != null && String(value).trim() !== "") count += 1;
  }
  return count;
}

function resolveNodeForProduct(product, nodesByShopifyId) {
  if (!nodesByShopifyId) return null;
  const sid = normalizeShopifyProductId(product?.shopify_product_id || product?.id);
  if (!sid) return null;
  if (nodesByShopifyId instanceof Map) return nodesByShopifyId.get(sid) || null;
  return nodesByShopifyId[sid] || null;
}

function providerLabelForProduct(product) {
  const source = String(product?.source || "").toLowerCase();
  const provider = String(product?.provider || "").toLowerCase();
  if (source === "todify" || provider === "todify") return "Todify";
  if (source === "samples") return "Personalizable samples";
  if (source === "customer") return "Customer";
  if (source === "printify" || provider === "printify") return "Printify";
  if (source === "shopify") return "Shopify";
  return provider ? provider[0].toUpperCase() + provider.slice(1) : "Unknown";
}

function filterProviderForProduct(product) {
  const source = String(product?.source || "").toLowerCase();
  if (source) return source;
  const provider = String(product?.provider || "").toLowerCase();
  return provider || "unknown";
}

async function loadCatalogProductNames(env, productKeys) {
  const out = new Map();
  const keys = [...new Set((productKeys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  if (!env?.CATALOG_DB || !keys.length) return out;
  const placeholders = keys.map(() => "?").join(",");
  try {
    const res = await env.CATALOG_DB.prepare(
      `SELECT product_key, title FROM product_catalog WHERE product_key IN (${placeholders})`
    )
      .bind(...keys)
      .all();
    for (const row of res?.results || []) {
      if (row.product_key) out.set(String(row.product_key), row.title || null);
    }
  } catch (e) {
    console.warn("[admin-creations-product-list-enrich] catalog names:", e?.message);
  }
  return out;
}

async function loadDesignPublishLinks(env, shopifyIds) {
  const out = new Map();
  const ids = [...new Set((shopifyIds || []).map((id) => normalizeShopifyProductId(id)).filter(Boolean))];
  if (!env?.CREATOR_DB || !ids.length) return out;
  const placeholders = ids.map(() => "?").join(",");
  try {
    const res = await env.CREATOR_DB.prepare(
      `SELECT id, design_id, shopify_product_id
       FROM published_designs
       WHERE REPLACE(REPLACE(TRIM(CAST(shopify_product_id AS TEXT)), 'gid://shopify/Product/', ''), '.0', '') IN (${placeholders})`
    )
      .bind(...ids)
      .all();
    for (const row of res?.results || []) {
      const sid = normalizeShopifyProductId(row.shopify_product_id);
      if (!sid || out.has(sid)) continue;
      out.set(sid, { design_id: Number(row.design_id || 0) || null, published_design_id: Number(row.id || 0) || null });
    }
  } catch (e) {
    console.warn("[admin-creations-product-list-enrich] published_designs links:", e?.message);
  }
  return out;
}

async function loadDesignPublishSnapshots(env, designIds) {
  const out = new Map();
  const ids = [...new Set((designIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!env?.CREATOR_DB || !ids.length) return out;
  const placeholders = ids.map(() => "?").join(",");
  try {
    const res = await env.CREATOR_DB.prepare(
      `SELECT design_id, metadata_json, image_fingerprint
       FROM design_publish_snapshots
       WHERE design_id IN (${placeholders})`
    )
      .bind(...ids)
      .all();
    for (const row of res?.results || []) {
      out.set(Number(row.design_id), {
        metadata: safeJsonParse(row.metadata_json, {}),
        image_fingerprint: String(row.image_fingerprint || ""),
      });
    }
  } catch (e) {
    console.warn("[admin-creations-product-list-enrich] design_publish_snapshots:", e?.message);
  }
  return out;
}

async function loadCreationsForDesignIds(env, designIds) {
  const out = new Map();
  const ids = [...new Set((designIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!env?.CREATOR_DB || !ids.length) return out;
  const placeholders = ids.map(() => "?").join(",");
  try {
    const res = await env.CREATOR_DB.prepare(
      `SELECT id, metadata, preview_url, original_url FROM creations WHERE id IN (${placeholders})`
    )
      .bind(...ids)
      .all();
    for (const row of res?.results || []) {
      out.set(Number(row.id), {
        metadata: typeof row.metadata === "string" ? safeJsonParse(row.metadata, {}) : row.metadata || {},
        image_fingerprint: String(row.original_url || row.preview_url || ""),
      });
    }
  } catch (e) {
    console.warn("[admin-creations-product-list-enrich] creations lookup:", e?.message);
  }
  return out;
}

function metadataChanged(a, b) {
  try {
    return JSON.stringify(a || {}) !== JSON.stringify(b || {});
  } catch (_) {
    return false;
  }
}

/**
 * True when the live design (metadata + image fingerprint) has drifted from the
 * snapshot recorded at last publish/update-commit.
 */
function computeNeedsUpdate(snapshot, current) {
  if (!snapshot || !current) return false;
  if (metadataChanged(snapshot.metadata, current.metadata)) return true;
  if (String(snapshot.image_fingerprint || "") !== String(current.image_fingerprint || "")) return true;
  return false;
}

async function loadAmazonListingsByShopifyId(env, shopifyIds) {
  const out = new Map();
  const ids = [...new Set((shopifyIds || []).map((id) => normalizeShopifyProductId(id)).filter(Boolean))];
  if (!env?.CREATOR_DB || !ids.length) return out;
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const res = await env.CREATOR_DB.prepare(
        `SELECT al.marketplace_id, al.status, al.asin, al.verified_status, al.feed_id,
                al.updated_at, al.listing_type, pd.shopify_product_id
         FROM amazon_listing al
         JOIN published_designs pd ON pd.id = al.published_design_id
         WHERE REPLACE(REPLACE(TRIM(CAST(pd.shopify_product_id AS TEXT)), 'gid://shopify/Product/', ''), '.0', '') IN (${placeholders})`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        if (!sid) continue;
        if (!out.has(sid)) out.set(sid, []);
        out.get(sid).push({
          marketplace_id: row.marketplace_id,
          status: String(row.status || "").toLowerCase(),
          asin: row.asin || null,
          verified_status: row.verified_status || null,
          feed_id: row.feed_id || null,
          updated_at: row.updated_at != null ? Number(row.updated_at) : null,
          listing_type: row.listing_type || null,
        });
      }
    } catch (e) {
      console.warn("[admin-creations-product-list-enrich] amazon_listing:", e?.message);
    }
  }
  return out;
}

async function loadPublishProfilesByProductKey(env, productKeys) {
  const out = new Map();
  const keys = [...new Set((productKeys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  if (!env?.CATALOG_DB || !keys.length) return out;
  const placeholders = keys.map(() => "?").join(",");
  try {
    const res = await env.CATALOG_DB.prepare(
      `SELECT product_key, white_branding_variant_ids, variants_json
       FROM product_publish_profiles
       WHERE product_key IN (${placeholders})`
    )
      .bind(...keys)
      .all();
    for (const row of res?.results || []) {
      if (!row.product_key) continue;
      out.set(String(row.product_key), {
        whiteBrandingIds: new Set((safeJsonParse(row.white_branding_variant_ids, []) || []).map((v) => String(v))),
        variants: safeJsonParse(row.variants_json, []) || [],
      });
    }
  } catch (e) {
    console.warn("[admin-creations-product-list-enrich] product_publish_profiles:", e?.message);
  }
  return out;
}

/**
 * Exact catalog/country count per product_key from publish plans
 * (`product_publish_map` + region/country expansion). Used by the "Kataloge" facet.
 */
async function loadCatalogCountryCounts(env, productKeys) {
  const out = new Map();
  const keys = [...new Set((productKeys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  if (!env?.CATALOG_DB || !keys.length) return out;
  const placeholders = keys.map(() => "?").join(",");
  const countriesByKey = new Map();
  try {
    const res = await env.CATALOG_DB.prepare(
      `SELECT product_key, country_codes_json, region_codes_json, provider_location
       FROM product_publish_map
       WHERE product_key IN (${placeholders})`
    )
      .bind(...keys)
      .all();
    for (const row of res?.results || []) {
      const pk = String(row.product_key || "").trim();
      if (!pk) continue;
      if (!countriesByKey.has(pk)) countriesByKey.set(pk, new Set());
      const countryCodes = await resolvePlanCountryCodes(env, {
        regionCodes: safeJsonParse(row.region_codes_json, []) || [],
        countryCodes: safeJsonParse(row.country_codes_json, []) || [],
        providerLocation: row.provider_location || null,
      });
      for (const cc of countryCodes) countriesByKey.get(pk).add(cc);
    }
  } catch (e) {
    console.warn("[admin-creations-product-list-enrich] product_publish_map catalogs:", e?.message);
  }
  for (const [pk, set] of countriesByKey) out.set(pk, set.size);
  return out;
}

function brandingCountsFromProfile(profile, variantCountHint = 0) {
  if (!profile) return { white: 0, black: 0 };
  const variants = Array.isArray(profile.variants) ? profile.variants : [];
  let white = 0;
  let black = 0;
  for (const v of variants) {
    const id = String(v?.id ?? v?.variant_id ?? "");
    if (id && profile.whiteBrandingIds.has(id)) white += 1;
    else black += 1;
  }
  // No variant list — use white-id count; derive black from Shopify variant total when known.
  if (!variants.length) {
    white = profile.whiteBrandingIds.size;
    const total = Math.max(0, Number(variantCountHint) || 0);
    black = total > white ? total - white : 0;
  }
  return { white, black };
}

function altImageTextsFromNode(node) {
  const edges = node?.images?.edges || [];
  const texts = [];
  for (const edge of edges) {
    const alt = String(edge?.node?.altText || "").trim();
    if (alt) texts.push(alt);
  }
  return texts;
}

/**
 * Load Printify listing status + mock URLs for product list rows (by Shopify / Printify id).
 * @returns {Promise<{ byShopifyId: Map<string, object>, byPrintifyId: Map<string, object> }>}
 */
async function loadPrintifyListingMeta(env, shopifyIds, printifyIds) {
  const byShopifyId = new Map();
  const byPrintifyId = new Map();
  if (!env?.CREATOR_DB) return { byShopifyId, byPrintifyId };

  try {
    await ensurePrintifyListingStatusColumn(env);
    await repairStalePrintifyListingStatusPublishing(env);
  } catch (_) {}

  const sids = [...new Set((shopifyIds || []).map((id) => normalizeShopifyProductId(id)).filter(Boolean))];
  const pids = [...new Set((printifyIds || []).map((id) => String(id || "").trim()).filter(Boolean))];

  const mapRow = (row) => {
    const status = classifyPrintifyListingStatusFromRow(row);
    const mocks = parsePrintifyImagesJson(row.printify_images_json);
    return {
      status,
      mocks,
      published_design_id: row.id != null ? Number(row.id) : null,
      design_id: row.design_id != null ? String(row.design_id) : null,
    };
  };

  const CHUNK = 80;
  for (let i = 0; i < sids.length; i += CHUNK) {
    const chunk = sids.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    try {
      const res = await env.CREATOR_DB.prepare(
        `SELECT id, design_id, shopify_product_id, printify_product_id, shopify_completion_status,
                printify_listing_status, printify_images_json
         FROM published_designs
         WHERE TRIM(REPLACE(REPLACE(CAST(shopify_product_id AS TEXT), 'gid://shopify/Product/', ''), '.0', '')) IN (${ph})`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        if (sid && !byShopifyId.has(sid)) byShopifyId.set(sid, mapRow(row));
        const pid = String(row.printify_product_id || "").trim();
        if (pid && !byPrintifyId.has(pid)) byPrintifyId.set(pid, mapRow(row));
      }
    } catch (e) {
      console.warn("[admin-creations-product-list-enrich] printify meta by shopify:", e?.message);
    }
  }

  const missingPids = pids.filter((pid) => !byPrintifyId.has(pid));
  for (let i = 0; i < missingPids.length; i += CHUNK) {
    const chunk = missingPids.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    try {
      const res = await env.CREATOR_DB.prepare(
        `SELECT id, design_id, shopify_product_id, printify_product_id, shopify_completion_status,
                printify_listing_status, printify_images_json
         FROM published_designs
         WHERE TRIM(CAST(printify_product_id AS TEXT)) IN (${ph})`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        const pid = String(row.printify_product_id || "").trim();
        if (pid && !byPrintifyId.has(pid)) byPrintifyId.set(pid, mapRow(row));
      }
    } catch (e) {
      console.warn("[admin-creations-product-list-enrich] printify meta by printify:", e?.message);
    }
  }

  return { byShopifyId, byPrintifyId };
}

/** Busy set (currently locked/publishing) product keys from admin product-action locks + creator publish sessions. */
export async function getBusyProductKeysAndShopifyIds(env) {
  const rows = await listPublishActiveSessionRows(env, { adminAll: true });
  const shopifyIds = new Set();
  const productKeys = new Set();
  for (const row of rows) {
    const did = Number(row.design_id || 0);
    if (did > 0) shopifyIds.add(String(did));
    for (const key of row.product_keys || []) {
      if (key) productKeys.add(String(key));
    }
  }
  return { shopifyIds, productKeys };
}

/**
 * Decorate each product with the extra fields needed by the filter sidebar,
 * "Needs Update" badge, bulk dock eligibility, and Amazon facets.
 *
 * @param {object} env
 * @param {Array<object>} products
 * @param {Map<string, object>|Record<string, object>|null} [nodesByShopifyId] normalizeShopifyProductId → Shopify GQL node
 * @returns {Promise<Array<object>>}
 */
export async function enrichCreationsProductListFacets(env, products, nodesByShopifyId = null) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) return list;

  const productKeys = list.map((p) => p.product_key).filter(Boolean);
  const shopifyIds = list.map((p) => p.shopify_product_id || p.id).filter(Boolean);
  const printifyIds = list.map((p) => p.printify_product_id).filter(Boolean);

  const [
    catalogNames,
    publishLinks,
    amazonByShopifyId,
    publishProfiles,
    catalogCountryCounts,
    busy,
    printifyMeta,
  ] = await Promise.all([
    loadCatalogProductNames(env, productKeys),
    loadDesignPublishLinks(env, shopifyIds),
    loadAmazonListingsByShopifyId(env, shopifyIds),
    loadPublishProfilesByProductKey(env, productKeys),
    loadCatalogCountryCounts(env, productKeys),
    getBusyProductKeysAndShopifyIds(env),
    loadPrintifyListingMeta(env, shopifyIds, printifyIds),
  ]);

  const designIds = [...publishLinks.values()].map((v) => v.design_id).filter(Boolean);
  const [snapshots, creationsById] = await Promise.all([
    loadDesignPublishSnapshots(env, designIds),
    loadCreationsForDesignIds(env, designIds),
  ]);

  const headlessPublicationGids = parseExtraPublicationIdsFromEnv(env);

  return list.map((product) => {
    const sid = normalizeShopifyProductId(product.shopify_product_id || product.id);
    const node = resolveNodeForProduct(product, nodesByShopifyId);
    const link = sid ? publishLinks.get(sid) : null;
    const designId = link?.design_id || null;
    const snapshot = designId ? snapshots.get(designId) : null;
    const current = designId ? creationsById.get(designId) : null;

    const amazonRows = sid ? amazonByShopifyId.get(sid) || [] : [];
    const amazonEuLive = amazonRows.some(
      (r) => EU_MARKETPLACE_IDS.has(r.marketplace_id) && isAmazonSuccessfullyPublished(r)
    );
    const amazonUsLive = amazonRows.some(
      (r) => r.marketplace_id === NA_MARKETPLACES.US && isAmazonSuccessfullyPublished(r)
    );
    const amazonEuPending = amazonRows.some(
      (r) => EU_MARKETPLACE_IDS.has(r.marketplace_id) && isAmazonPendingPublish(r)
    );
    const amazonUsPending = amazonRows.some(
      (r) => r.marketplace_id === NA_MARKETPLACES.US && isAmazonPendingPublish(r)
    );
    // Live-only flags for bulk UI (same success criteria as Channels Amazon EU/US).
    const amazonEuListed = amazonEuLive;
    const amazonUsListed = amazonUsLive;
    // Busy / in-flight presence (live OR pending) — used for publish eligibility.
    const amazonEuChannel = amazonEuLive || amazonEuPending;
    const amazonUsChannel = amazonUsLive || amazonUsPending;

    const onOnlineStore = node
      ? nodePublishedToOnlineStore(node)
      : Number(product.is_active) === 2;
    const onHeadless = node
      ? nodePublishedToHeadless(node, headlessPublicationGids)
      : false;
    // eazpire = live Shopify product (ACTIVE); Online Store / Headless = real publications.
    const onEazpire = Number(product.is_active) === 2 || String(node?.status || "").toUpperCase() === "ACTIVE";

    const marketLabels = [];
    if (onOnlineStore) marketLabels.push("Online Store");
    if (onHeadless) marketLabels.push("eazpire Headless");
    if (amazonEuLive) marketLabels.push("Amazon EU");
    else if (amazonEuPending) marketLabels.push("Pending Amazon EU");
    if (amazonUsLive) marketLabels.push("Amazon US");
    else if (amazonUsPending) marketLabels.push("Pending Amazon US");

    const profile = product.product_key ? publishProfiles.get(product.product_key) : null;
    const variantCount = Number(node?.totalVariants?.count ?? product.total_variants ?? 0) || 0;
    const branding = brandingCountsFromProfile(profile, variantCount);
    const catalogCount = product.product_key ? Number(catalogCountryCounts.get(product.product_key) || 0) : 0;

    const channelKeys = publicationChannelKeys().filter((key) => {
      if (key === "eazpire") return onEazpire;
      if (key === "onlineshop") return onOnlineStore;
      if (key === "eazpire_headless") return onHeadless;
      if (key === "amazon_eu") return amazonEuLive;
      if (key === "amazon_us") return amazonUsLive;
      if (key === "pending_amazon_eu") return amazonEuPending;
      if (key === "pending_amazon_us") return amazonUsPending;
      return false;
    });

    const busyByShopifyId = sid ? busy.shopifyIds.has(sid) : false;
    const busyByProductKey = product.product_key ? busy.productKeys.has(String(product.product_key)) : false;

    const pid = String(product.printify_product_id || "").trim();
    const pMeta =
      (sid && printifyMeta.byShopifyId.get(sid)) ||
      (pid && printifyMeta.byPrintifyId.get(pid)) ||
      null;
    const printifyStatus =
      product.printify_status ||
      pMeta?.status ||
      classifyPrintifyListingStatusFromRow({
        printify_product_id: pid,
        shopify_product_id: sid,
        shopify_completion_status: product.shopify_completion_status,
        printify_listing_status: product.printify_listing_status,
      });

    // Prefer Shopify images; for Printify-only / empty Shopify media use stored Printify mocks.
    const existingImages = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const mockUrls = Array.isArray(pMeta?.mocks) ? pMeta.mocks : [];
    let images = existingImages;
    let previewUrl = product.preview_url || null;
    if (!images.length && mockUrls.length) {
      images = mockUrls;
      previewUrl = mockUrls[0];
    } else if (!previewUrl && mockUrls.length) {
      previewUrl = mockUrls[0];
    }

    return {
      ...product,
      preview_url: previewUrl,
      images,
      catalog_product_name: (product.product_key && catalogNames.get(product.product_key)) || null,
      design_id: designId || pMeta?.design_id || product.design_id || null,
      published_design_id: link?.published_design_id || pMeta?.published_design_id || product.published_design_id || null,
      provider_label: providerLabelForProduct(product),
      filter_provider: filterProviderForProduct(product),
      variant_count: variantCount,
      catalog_count: catalogCount,
      market_count: catalogCount,
      market_labels: marketLabels,
      metafields_filled_count: countFilledMetafields(node),
      channel_count: channelKeys.length,
      channel_keys: channelKeys,
      channel_labels: channelKeys.map(channelLabelForKey),
      alt_image_texts: altImageTextsFromNode(node),
      branding_white_count: branding.white,
      branding_black_count: branding.black,
      needs_update: computeNeedsUpdate(snapshot, current),
      amazon_eu_listed: amazonEuListed,
      amazon_us_listed: amazonUsListed,
      amazon_eu_channel: amazonEuChannel,
      amazon_us_channel: amazonUsChannel,
      amazon_eu_pending: amazonEuPending,
      amazon_us_pending: amazonUsPending,
      // Don't re-queue Amazon publish while a D1 listing is already in-flight or live.
      publish_eligible_amazon_eu: !amazonEuChannel && !amazonUsChannel,
      publish_active: busyByShopifyId || busyByProductKey,
      filter_product_key: String(product.product_key || product.id || sid || ""),
      printify_status: printifyStatus || null,
      printify_mock_urls: mockUrls,
    };
  });
}

function bucketCount(list, keyFn) {
  const counts = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (key == null) continue;
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return counts;
}

function exactCountKey(count) {
  return String(Math.max(0, Number(count) || 0));
}

function toFacetList(counts, labelFn, { numeric = false } = {}) {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelFn ? labelFn(key) : String(key), count }))
    .sort((a, b) => {
      if (numeric) {
        const na = Number(a.key);
        const nb = Number(b.key);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      }
      return b.count - a.count || String(a.key).localeCompare(String(b.key));
    });
}

/**
 * Aggregate enriched products into exact-count facets for the Product Filter sidebar.
 * Pure/sync — safe to call on the client and in tests.
 * @param {Array<object>} products enriched products (see enrichCreationsProductListFacets)
 */
export function buildProductFilterFacets(products) {
  const list = Array.isArray(products) ? products : [];

  const provider = toFacetList(
    bucketCount(list, (p) => p.filter_provider || "unknown"),
    (key) => list.find((p) => (p.filter_provider || "unknown") === key)?.provider_label || key
  );

  const baseChannels = new Map(publicationChannelKeys().map((k) => [k, 0]));
  const channelCounts = bucketCount(
    list,
    (p) => (Array.isArray(p.channel_keys) && p.channel_keys.length ? p.channel_keys : null)
  );
  for (const [k, v] of channelCounts) baseChannels.set(k, v);
  const channels = toFacetList(baseChannels, (key) => channelLabelForKey(key));

  const variants = toFacetList(bucketCount(list, (p) => exactCountKey(p.variant_count)), null, { numeric: true });

  const catalogs = toFacetList(
    bucketCount(list, (p) => exactCountKey(p.catalog_count ?? p.market_count)),
    null,
    { numeric: true }
  );

  const metafields = toFacetList(
    bucketCount(list, (p) => exactCountKey(p.metafields_filled_count)),
    null,
    { numeric: true }
  );

  const channelCount = toFacetList(
    bucketCount(list, (p) => exactCountKey(p.channel_count)),
    null,
    { numeric: true }
  );

  const altImageTexts = toFacetList(
    bucketCount(list, (p) => (Array.isArray(p.alt_image_texts) && p.alt_image_texts.length ? "has" : "missing")),
    (key) => (key === "has" ? "Has alt text" : "Missing alt text")
  );

  const brandingWhite = toFacetList(
    bucketCount(list, (p) => exactCountKey(p.branding_white_count)),
    null,
    { numeric: true }
  );

  const brandingBlack = toFacetList(
    bucketCount(list, (p) => exactCountKey(p.branding_black_count)),
    null,
    { numeric: true }
  );

  const needsUpdate = toFacetList(
    bucketCount(list, (p) => (p.needs_update ? "yes" : "no")),
    (key) => (key === "yes" ? "Needs update" : "Up to date")
  );

  const basePrintifyStatus = new Map([
    ["published", 0],
    ["unpublished", 0],
    ["unpublished_changes", 0],
    ["publishing", 0],
    ["error", 0],
  ]);
  const printifyStatusCounts = bucketCount(list, (p) => p.printify_status || null);
  for (const [k, v] of printifyStatusCounts) basePrintifyStatus.set(k, v);
  const printifyStatus = toFacetList(
    basePrintifyStatus,
    (key) => PRINTIFY_STATUS_LABELS[key] || key
  );

  return {
    total: list.length,
    provider,
    channels,
    variants,
    catalogs,
    markets: catalogs,
    metafields,
    channel_count: channelCount,
    alt_image_texts: altImageTexts,
    branding_white: brandingWhite,
    branding_black: brandingBlack,
    needs_update: needsUpdate,
    printify_status: printifyStatus,
  };
}
