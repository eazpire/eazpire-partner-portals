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
import { parseMetafieldValue } from "../admin/shopifyCatalogMetafieldSpec.js";
import {
  matchShopifySalesChannelName,
  parseShopifySalesPublicationIdsFromEnv,
  SHOPIFY_SALES_CHANNEL_DEFS,
  shopifySalesFilterKeys,
  shopifySalesFilterLabel,
} from "../catalog/shopifySalesChannels.js";
import {
  normalizeShopifyProductId,
  indexShopifyNodesById,
  liveColorsFromShopifyNode,
} from "./adminCreationsShopifyList.js";
import {
  inferMockupViewFromSrc,
  MOCKUP_VIEW_ORDER,
  parseMockupAlt,
} from "./adminCreationsShopifyProductDetail.js";

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

/** EU country codes under Amazon Markets parent `amazon_eu`. */
export const AMAZON_EU_COUNTRY_CODES = ["DE", "UK", "FR", "NL", "IT", "ES", "BE", "PL", "SE", "IE"];
/** NA country codes under Amazon Markets parent `amazon_na` (label: Amazon US). */
export const AMAZON_US_COUNTRY_CODES = ["US", "CA"];

/** All country codes used for Amazon Markets facets. */
export const AMAZON_FACET_COUNTRY_CODES = [...AMAZON_EU_COUNTRY_CODES, ...AMAZON_US_COUNTRY_CODES];

/**
 * Shopify sales channels only (Creations Products → Channels filter).
 * Online Store → eazpire Web; Headless → eazpire Android; plus Shop / social channels.
 */
export function publicationChannelKeys() {
  return shopifySalesFilterKeys();
}

/**
 * Amazon Markets facet keys in display order: region parents, then countries indented in UI.
 * Parents: amazon_eu / amazon_na (UI label "Amazon US"). Countries: amazon_de … amazon_us, amazon_ca.
 * Presence = live OR pending on that region/country (status is a separate filter).
 */
export function amazonMarketKeys() {
  return [
    "amazon_eu",
    ...AMAZON_EU_COUNTRY_CODES.map((c) => `amazon_${c.toLowerCase()}`),
    "amazon_na",
    ...AMAZON_US_COUNTRY_CODES.map((c) => `amazon_${c.toLowerCase()}`),
  ];
}

/** Depth for hierarchical Markets UI (0 = parent, 1 = country). */
export function amazonMarketDepth(key) {
  const k = String(key || "");
  if (k === "amazon_eu" || k === "amazon_na") return 0;
  if (k.startsWith("amazon_")) return 1;
  return 0;
}

/** Amazon Status facet — Online / Pending (any marketplace). */
export function amazonStatusKeys() {
  return ["online", "pending"];
}

const CHANNEL_LABELS = Object.fromEntries(
  SHOPIFY_SALES_CHANNEL_DEFS.map((d) => [d.filterKey, d.label])
);

const AMAZON_MARKET_LABELS = {
  amazon_eu: "Amazon EU",
  amazon_na: "Amazon US",
  amazon_de: "DE",
  amazon_uk: "UK",
  amazon_fr: "FR",
  amazon_nl: "NL",
  amazon_it: "IT",
  amazon_es: "ES",
  amazon_be: "BE",
  amazon_pl: "PL",
  amazon_se: "SE",
  amazon_ie: "IE",
  amazon_us: "US",
  amazon_ca: "CA",
};

const AMAZON_STATUS_LABELS = {
  online: "Online",
  pending: "Pending",
};

function countryCodeForMarketplaceId(marketplaceId) {
  const id = String(marketplaceId || "").trim();
  if (!id) return null;
  for (const [cc, mid] of Object.entries(EU_MARKETPLACES)) {
    if (mid === id) return cc;
  }
  for (const [cc, mid] of Object.entries(NA_MARKETPLACES)) {
    if (mid === id) return cc;
  }
  return null;
}

export function channelLabelForKey(key) {
  return CHANNEL_LABELS[key] || shopifySalesFilterLabel(key) || String(key || "");
}

export function amazonMarketLabelForKey(key) {
  return AMAZON_MARKET_LABELS[key] || String(key || "");
}

export function amazonStatusLabelForKey(key) {
  return AMAZON_STATUS_LABELS[key] || String(key || "");
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

/**
 * True when node is published to a Shopify sales channel by channel name and/or publication IDs.
 */
export function nodePublishedToSalesChannel(node, def, publicationGids) {
  if (!def) return false;
  if (nodePublishedToHeadless(node, publicationGids)) return true;
  const edges = node?.publications?.edges;
  if (!Array.isArray(edges) || !edges.length) return false;
  for (const edge of edges) {
    const n = edge?.node;
    if (!n?.isPublished) continue;
    if (matchShopifySalesChannelName(def, n?.channel?.name)) return true;
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

/** Aliased Shopify GQL metafields → `namespace.key` (list query fallback). */
const MF_ALIAS_TO_KEY = {
  mfPrintifyId: "custom.printify_product_id",
  mfProductKey: "custom.product_key",
  mfListingOrigin: "custom.listing_origin",
  mfProvider: "custom.provider",
  mfSample: "custom.sample",
  mfVisibility: "custom.visibility",
};

/**
 * Map of filled metafields on a Shopify GraphQL node (`namespace.key` → value string).
 * Prefers `metafields.edges` when present; falls back to aliased `mf*` fields.
 * Empty / missing values are omitted (columns are the union across the filtered set).
 */
export function extractFilledMetafieldMap(node) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!node || typeof node !== "object") return out;
  const edges = node.metafields?.edges;
  if (Array.isArray(edges) && edges.length) {
    for (const edge of edges) {
      const n = edge?.node;
      const value = n?.value;
      if (value == null || String(value).trim() === "") continue;
      const ns = String(n?.namespace || "").trim();
      const key = String(n?.key || "").trim();
      if (!ns || !key) continue;
      out[`${ns}.${key}`] = String(value);
    }
    return out;
  }
  for (const [alias, fieldKey] of Object.entries(MF_ALIAS_TO_KEY)) {
    const value = node[alias]?.value;
    if (value == null || String(value).trim() === "") continue;
    out[fieldKey] = String(value);
  }
  return out;
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
  return Object.keys(extractFilledMetafieldMap(node)).length;
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

/** Blank/catalog product titles by product_key (same SoT as Products page Product filter). */
export async function loadCatalogProductNames(env, productKeys) {
  const out = new Map();
  const keys = [...new Set((productKeys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  if (!env?.CATALOG_DB || !keys.length) return out;
  const CHUNK = 80;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const res = await env.CATALOG_DB.prepare(
        `SELECT product_key, title FROM product_catalog WHERE product_key IN (${placeholders})`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        if (row.product_key) out.set(String(row.product_key), row.title || null);
      }
    } catch (e) {
      console.warn("[admin-creations-product-list-enrich] catalog names:", e?.message);
      break;
    }
  }
  return out;
}

async function loadDesignPublishLinks(env, shopifyIds) {
  const out = new Map();
  const ids = [...new Set((shopifyIds || []).map((id) => normalizeShopifyProductId(id)).filter(Boolean))];
  if (!env?.CREATOR_DB || !ids.length) return out;
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const res = await env.CREATOR_DB.prepare(
        `SELECT id, design_id, shopify_product_id, visibility
         FROM published_designs
         WHERE REPLACE(REPLACE(TRIM(CAST(shopify_product_id AS TEXT)), 'gid://shopify/Product/', ''), '.0', '') IN (${placeholders})`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        if (!sid || out.has(sid)) continue;
        const vis = String(row.visibility || "")
          .trim()
          .toLowerCase();
        out.set(sid, {
          design_id: Number(row.design_id || 0) || null,
          published_design_id: Number(row.id || 0) || null,
          visibility: vis === "public" ? "public" : vis === "private" ? "private" : null,
        });
      }
    } catch (e) {
      // Older rows / schema without visibility — retry id-only.
      try {
        const res = await env.CREATOR_DB.prepare(
          `SELECT id, design_id, shopify_product_id
           FROM published_designs
           WHERE REPLACE(REPLACE(TRIM(CAST(shopify_product_id AS TEXT)), 'gid://shopify/Product/', ''), '.0', '') IN (${placeholders})`
        )
          .bind(...chunk)
          .all();
        for (const row of res?.results || []) {
          const sid = normalizeShopifyProductId(row.shopify_product_id);
          if (!sid || out.has(sid)) continue;
          out.set(sid, {
            design_id: Number(row.design_id || 0) || null,
            published_design_id: Number(row.id || 0) || null,
            visibility: null,
          });
        }
      } catch (e2) {
        console.warn("[admin-creations-product-list-enrich] published_designs links:", e2?.message || e?.message);
      }
    }
  }
  return out;
}

/** Shopify productType / taxonomy leaf, else Empty key for Products Category facet. */
function filterCategoryForProduct(product, node) {
  const fromNodeType = String(node?.productType || "").trim();
  const fullName = String(node?.category?.fullName || "").trim();
  const leaf = fullName.includes(">") ? fullName.split(">").pop().trim() : fullName;
  const fromProduct = String(product?.shopify_product_type || product?.product_type || "").trim();
  const fromFilter = String(product?.filter_category || "").trim();
  if (fromFilter && fromFilter !== "_empty") return fromFilter;
  return fromNodeType || leaf || fromProduct || "_empty";
}

/** Prefer Shopify custom.visibility metafield; fall back to published_designs.visibility. */
function filterVisibilityForProduct(product, node, link) {
  const mfMap = extractFilledMetafieldMap(node);
  const fromAlias = parseMetafieldValue(node?.mfVisibility?.value).toLowerCase();
  const fromMap = parseMetafieldValue(mfMap["custom.visibility"]).toLowerCase();
  const fromProduct = String(product?.filter_visibility || product?.listing_visibility || "")
    .trim()
    .toLowerCase();
  const fromLink = String(link?.visibility || "").trim().toLowerCase();
  const raw = fromAlias || fromMap || fromProduct || fromLink;
  return raw === "public" ? "public" : "private";
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

function normalizeImageKey(url) {
  return String(url || "")
    .split("?")[0]
    .trim()
    .toLowerCase();
}

function viewSortRank(view) {
  const v = String(view || "other")
    .trim()
    .toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MOCKUP_VIEW_ORDER, v)) return MOCKUP_VIEW_ORDER[v];
  return MOCKUP_VIEW_ORDER.other;
}

/**
 * Group product images by variant (from Color|view|preview-default alt) for the
 * Alt Image Texts overview modal. Featured / Main slides sort first within a variant.
 *
 * @param {object|null|undefined} node Shopify GQL product node
 * @param {object|null|undefined} [product] list row fallback (grid_views / images / preview_url)
 * @returns {Array<{ variant_label: string, views: Array<object> }>}
 */
export function buildAltImageGroupsFromNode(node, product = null) {
  const featuredKey = normalizeImageKey(
    node?.featuredMedia?.image?.url || product?.preview_url || ""
  );

  /** @type {Array<{ src: string, alt: string, view: string, variant_label: string, is_preview: boolean, is_featured: boolean, position: number }>} */
  let slides = [];
  const edges = node?.images?.edges;
  if (Array.isArray(edges) && edges.length) {
    slides = edges
      .map((edge, index) => {
        const src = String(edge?.node?.url || "").trim();
        if (!src) return null;
        const alt = String(edge?.node?.altText || "").trim();
        const parsed = parseMockupAlt(alt);
        const fromSrc = inferMockupViewFromSrc(src);
        const isFeatured = Boolean(featuredKey && normalizeImageKey(src) === featuredKey);
        return {
          src,
          alt,
          view: parsed?.view || fromSrc || (index === 0 ? "front" : "other"),
          variant_label: parsed?.color || "Default",
          is_preview: Boolean(parsed?.isPreview) || isFeatured,
          is_featured: isFeatured,
          position: index + 1,
        };
      })
      .filter(Boolean);
  } else if (Array.isArray(product?.grid_views) && product.grid_views.length) {
    slides = product.grid_views
      .map((v, index) => {
        const src = String(v?.src || "").trim();
        if (!src) return null;
        const alt = String(v?.alt || "").trim();
        const parsed = parseMockupAlt(alt);
        const isFeatured = Boolean(featuredKey && normalizeImageKey(src) === featuredKey);
        return {
          src,
          alt,
          view: String(v?.view || parsed?.view || (index === 0 ? "front" : "other")).toLowerCase(),
          variant_label: String(v?.variant_label || parsed?.color || "Default").trim() || "Default",
          is_preview: Boolean(v?.is_preview || parsed?.isPreview || isFeatured),
          is_featured: isFeatured || Boolean(v?.is_preview && index === 0),
          position: index + 1,
        };
      })
      .filter(Boolean);
  } else {
    const urls = Array.isArray(product?.images)
      ? product.images
      : product?.preview_url
        ? [product.preview_url]
        : [];
    slides = urls
      .map((u, index) => {
        const src = String(u || "").trim();
        if (!src) return null;
        const isFeatured = Boolean(featuredKey && normalizeImageKey(src) === featuredKey) || index === 0;
        return {
          src,
          alt: "",
          view: index === 0 ? "front" : `view ${index + 1}`,
          variant_label: "Default",
          is_preview: isFeatured,
          is_featured: isFeatured,
          position: index + 1,
        };
      })
      .filter(Boolean);
  }

  /** @type {Map<string, typeof slides>} */
  const byVariant = new Map();
  for (const slide of slides) {
    const key = String(slide.variant_label || "Default").trim() || "Default";
    if (!byVariant.has(key)) byVariant.set(key, []);
    byVariant.get(key).push(slide);
  }

  const groups = [...byVariant.entries()].map(([variant_label, views]) => {
    views.sort((a, b) => {
      if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
      if (a.is_preview !== b.is_preview) return a.is_preview ? -1 : 1;
      const viewDiff = viewSortRank(a.view) - viewSortRank(b.view);
      if (viewDiff !== 0) return viewDiff;
      return (a.position || 0) - (b.position || 0);
    });
    return { variant_label, views };
  });

  groups.sort((a, b) => {
    const af = a.views.some((v) => v.is_featured);
    const bf = b.views.some((v) => v.is_featured);
    if (af !== bf) return af ? -1 : 1;
    return String(a.variant_label).localeCompare(String(b.variant_label));
  });

  return groups;
}

/**
 * Flip variant→views groups into view→variants (for Alt Image Texts overview carousel).
 * @param {Array<{ variant_label: string, views: Array<object> }>} variantGroups
 * @returns {Array<{ view: string, variants: Array<object> }>}
 */
export function regroupAltImagesByView(variantGroups) {
  /** @type {Map<string, Array<object>>} */
  const byView = new Map();
  for (const group of Array.isArray(variantGroups) ? variantGroups : []) {
    const variantLabel = String(group?.variant_label || "Default").trim() || "Default";
    for (const slide of Array.isArray(group?.views) ? group.views : []) {
      if (!slide?.src) continue;
      const viewKey = String(slide.view || "other").trim().toLowerCase() || "other";
      if (!byView.has(viewKey)) byView.set(viewKey, []);
      byView.get(viewKey).push({
        ...slide,
        view: viewKey,
        variant_label: String(slide.variant_label || variantLabel).trim() || variantLabel,
      });
    }
  }

  const viewGroups = [...byView.entries()].map(([view, variants]) => {
    variants.sort((a, b) => {
      if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
      if (a.is_preview !== b.is_preview) return a.is_preview ? -1 : 1;
      return String(a.variant_label).localeCompare(String(b.variant_label));
    });
    return { view, variants };
  });

  viewGroups.sort((a, b) => {
    const rankDiff = viewSortRank(a.view) - viewSortRank(b.view);
    if (rankDiff !== 0) return rankDiff;
    return String(a.view).localeCompare(String(b.view));
  });

  return viewGroups;
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

  const salesPublicationGids = parseShopifySalesPublicationIdsFromEnv(env);
  const headlessPublicationGids = salesPublicationGids.eazpire_android || parseExtraPublicationIdsFromEnv(env);

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
    /** @type {Record<string, boolean>} */
    const amazonCountryLive = {};
    /** @type {Record<string, boolean>} */
    const amazonCountryPending = {};
    for (const r of amazonRows) {
      const cc = countryCodeForMarketplaceId(r.marketplace_id);
      if (!cc) continue;
      const k = cc.toLowerCase();
      if (isAmazonSuccessfullyPublished(r)) amazonCountryLive[k] = true;
      if (isAmazonPendingPublish(r)) amazonCountryPending[k] = true;
    }
    const amazonNaLive = AMAZON_US_COUNTRY_CODES.some((c) => !!amazonCountryLive[c.toLowerCase()]);
    const amazonNaPending = AMAZON_US_COUNTRY_CODES.some((c) => !!amazonCountryPending[c.toLowerCase()]);
    // Live-only flags for bulk UI (same success criteria as Channels Amazon EU/US).
    const amazonEuListed = amazonEuLive;
    const amazonUsListed = amazonUsLive;
    const amazonDeListed = !!amazonCountryLive.de;
    const amazonDePending = !!amazonCountryPending.de;
    // Busy / in-flight presence (live OR pending) — used for publish eligibility.
    const amazonEuChannel = amazonEuLive || amazonEuPending;
    const amazonUsChannel = amazonUsLive || amazonUsPending;
    const amazonDeChannel = amazonDeListed || amazonDePending;
    const amazonAnyOnline = amazonEuLive || amazonNaLive;
    const amazonAnyPending = amazonEuPending || amazonNaPending;

    const salesOn = {};
    for (const def of SHOPIFY_SALES_CHANNEL_DEFS) {
      if (!node) {
        salesOn[def.key] = def.key === "eazpire_web" ? Number(product.is_active) === 2 : false;
        continue;
      }
      if (def.key === "eazpire_web") {
        salesOn[def.key] =
          nodePublishedToOnlineStore(node) ||
          nodePublishedToSalesChannel(node, def, salesPublicationGids[def.key]);
        continue;
      }
      if (def.key === "eazpire_android") {
        salesOn[def.key] = nodePublishedToHeadless(node, headlessPublicationGids);
        continue;
      }
      salesOn[def.key] = nodePublishedToSalesChannel(node, def, salesPublicationGids[def.key]);
    }
    const marketLabels = [];
    for (const def of SHOPIFY_SALES_CHANNEL_DEFS) {
      if (salesOn[def.key]) marketLabels.push(def.label);
    }
    if (amazonEuChannel) marketLabels.push("Amazon EU");
    if (amazonNaLive || amazonNaPending) marketLabels.push("Amazon US");

    const profile = product.product_key ? publishProfiles.get(product.product_key) : null;
    const variantCount = Number(node?.totalVariants?.count ?? product.total_variants ?? 0) || 0;
    const branding = brandingCountsFromProfile(profile, variantCount);
    const catalogCount = product.product_key ? Number(catalogCountryCounts.get(product.product_key) || 0) : 0;

    // Shopify sales channels only.
    const channelKeys = publicationChannelKeys().filter((key) => {
      const def = SHOPIFY_SALES_CHANNEL_DEFS.find((d) => d.filterKey === key);
      return def ? !!salesOn[def.key] : false;
    });

    // Region/country presence (live OR pending) — status filtered separately.
    const amazonMarketKeysForProduct = amazonMarketKeys().filter((key) => {
      if (key === "amazon_eu") return amazonEuChannel;
      if (key === "amazon_na") return amazonNaLive || amazonNaPending;
      if (key.startsWith("amazon_")) {
        const cc = key.slice("amazon_".length);
        return !!amazonCountryLive[cc] || !!amazonCountryPending[cc];
      }
      return false;
    });

    const amazonStatusKeysForProduct = [];
    if (amazonAnyOnline) amazonStatusKeysForProduct.push("online");
    if (amazonAnyPending) amazonStatusKeysForProduct.push("pending");

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
      metafields_map: extractFilledMetafieldMap(node),
      channel_count: channelKeys.length,
      channel_keys: channelKeys,
      channel_labels: channelKeys.map(channelLabelForKey),
      amazon_market_keys: amazonMarketKeysForProduct,
      amazon_market_labels: amazonMarketKeysForProduct.map(amazonMarketLabelForKey),
      amazon_status_keys: amazonStatusKeysForProduct,
      amazon_status_labels: amazonStatusKeysForProduct.map(amazonStatusLabelForKey),
      alt_image_texts: altImageTextsFromNode(node),
      ...(() => {
        const alt_image_groups = buildAltImageGroupsFromNode(node, {
          ...product,
          preview_url: previewUrl,
          images,
        });
        return {
          alt_image_groups,
          alt_image_view_groups: regroupAltImagesByView(alt_image_groups),
        };
      })(),
      branding_white_count: branding.white,
      branding_black_count: branding.black,
      needs_update: computeNeedsUpdate(snapshot, current),
      amazon_eu_listed: amazonEuListed,
      amazon_us_listed: amazonUsListed,
      amazon_de_listed: amazonDeListed,
      amazon_eu_channel: amazonEuChannel,
      amazon_us_channel: amazonUsChannel,
      amazon_de_channel: amazonDeChannel,
      amazon_eu_pending: amazonEuPending,
      amazon_us_pending: amazonUsPending,
      amazon_de_pending: amazonDePending,
      amazon_country_live: amazonCountryLive,
      amazon_country_pending: amazonCountryPending,
      // Prefer DE eligibility for bulk publish; keep EU alias for older UI.
      publish_eligible_amazon_de: !amazonDeChannel,
      publish_eligible_amazon_eu: !amazonDeChannel,
      publish_active: busyByShopifyId || busyByProductKey,
      filter_product_key: String(product.product_key || product.id || sid || ""),
      filter_category: filterCategoryForProduct(product, node),
      shopify_product_type:
        String(product.shopify_product_type || node?.productType || "").trim() || null,
      filter_visibility: filterVisibilityForProduct(product, node, link),
      listing_visibility: filterVisibilityForProduct(product, node, link),
      printify_status: printifyStatus || null,
      printify_mock_urls: mockUrls,
      live_colors: node ? liveColorsFromShopifyNode(node) : product.live_colors,
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
  // Fixed order: Shopify sales channels from shopifySalesChannels.js (do not sort by count/name).
  const channels = publicationChannelKeys().map((key) => ({
    key,
    label: channelLabelForKey(key),
    count: baseChannels.get(key) || 0,
  }));

  const baseAmazonMarkets = new Map(amazonMarketKeys().map((k) => [k, 0]));
  const amazonMarketCounts = bucketCount(
    list,
    (p) => (Array.isArray(p.amazon_market_keys) && p.amazon_market_keys.length ? p.amazon_market_keys : null)
  );
  for (const [k, v] of amazonMarketCounts) baseAmazonMarkets.set(k, v);
  const amazon_markets = amazonMarketKeys().map((key) => ({
    key,
    label: amazonMarketLabelForKey(key),
    count: baseAmazonMarkets.get(key) || 0,
    depth: amazonMarketDepth(key),
  }));

  const baseAmazonStatus = new Map(amazonStatusKeys().map((k) => [k, 0]));
  const amazonStatusCounts = bucketCount(
    list,
    (p) => (Array.isArray(p.amazon_status_keys) && p.amazon_status_keys.length ? p.amazon_status_keys : null)
  );
  for (const [k, v] of amazonStatusCounts) baseAmazonStatus.set(k, v);
  // Fixed order: Online → Pending.
  const amazon_status = amazonStatusKeys().map((key) => ({
    key,
    label: amazonStatusLabelForKey(key),
    count: baseAmazonStatus.get(key) || 0,
  }));

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
    amazon_markets,
    amazon_status,
    variants,
    catalogs,
    markets: catalogs,
    metafields,
    alt_image_texts: altImageTexts,
    branding_white: brandingWhite,
    branding_black: brandingBlack,
    needs_update: needsUpdate,
    printify_status: printifyStatus,
  };
}
