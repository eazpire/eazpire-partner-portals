/**
 * Lightweight Shopify product listing for Creations admin portal (partner worker).
 * Avoids importing the full adminShopifyCatalog stack.
 */

import { shopifyAPI } from "../../utils/shopify.js";
import { parseMetafieldValue } from "../admin/shopifyCatalogMetafieldSpec.js";

/** Classification-only fields for catalog scans (cheap; avoids throttle / CPU kills). */
const PRODUCT_SCAN_FIELDS = `
  id
  title
  handle
  status
  vendor
  productType
  createdAt
  updatedAt
  category { fullName }
  tags
  isGiftCard
  totalVariants: variantsCount {
    count
  }
  featuredMedia {
    ... on MediaImage {
      image { url }
    }
  }
  mfPrintifyId: metafield(namespace: "custom", key: "printify_product_id") { value }
  mfProductKey: metafield(namespace: "custom", key: "product_key") { value }
  mfListingOrigin: metafield(namespace: "custom", key: "listing_origin") { value }
  mfProvider: metafield(namespace: "custom", key: "provider") { value }
  mfSample: metafield(namespace: "custom", key: "sample") { value }
  mfVisibility: metafield(namespace: "custom", key: "visibility") { value }
`;

/**
 * Normalize Shopify ISO timestamps / D1 epoch seconds-or-ms to epoch milliseconds.
 * @param {unknown} value
 * @returns {number}
 */
export function toEpochMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return 0;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  const raw = String(value).trim();
  if (!raw) return 0;
  // Numeric strings (D1) — avoid Date.parse treating bare numbers oddly.
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const asNum = Number(raw);
    if (!Number.isFinite(asNum) || asNum <= 0) return 0;
    return asNum < 1e12 ? Math.round(asNum * 1000) : Math.round(asNum);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Newest meaningful change for Admin Products list ordering. */
export function productRecencyMs(product) {
  if (!product || typeof product !== "object") return 0;
  return Math.max(
    toEpochMs(product.sort_ts),
    toEpochMs(product.updated_at),
    toEpochMs(product.published_at),
    toEpochMs(product.created_at)
  );
}

/**
 * Stamp sort_ts / updated_at from Shopify + optional D1 published_designs recency.
 * @param {object} product
 * @param {Map<string, number>|null} [updatedAtBySid]
 */
export function applyProductRecencyTimestamps(product, updatedAtBySid = null) {
  if (!product || typeof product !== "object") return product;
  const sid = normalizeShopifyProductId(product.shopify_product_id || product.id);
  const d1Ts = sid && updatedAtBySid instanceof Map ? toEpochMs(updatedAtBySid.get(sid)) : 0;
  const sortTs = Math.max(productRecencyMs(product), d1Ts);
  product.sort_ts = sortTs;
  if (sortTs > 0) product.updated_at = sortTs;
  else if (product.updated_at == null) product.updated_at = 0;
  return product;
}

/** In-place newest-first sort for Admin Products lists. */
export function sortProductsNewestFirst(products) {
  if (!Array.isArray(products)) return [];
  return products.sort((a, b) => productRecencyMs(b) - productRecencyMs(a));
}

/** Full Product selection for Creations list enrich (variants / metafields / alts). */
const PRODUCT_NODE_FIELDS = `
  ${PRODUCT_SCAN_FIELDS}
  images(first: 100) {
    edges {
      node {
        url
        altText
      }
    }
  }
  metafields(first: 100) {
    edges {
      node {
        namespace
        key
        value
      }
    }
  }
  publications(first: 25) {
    edges {
      node {
        isPublished
        channel { id name }
      }
    }
  }
  resourcePublications(first: 50) {
    edges {
      node {
        isPublished
        publication { id }
      }
    }
  }
`;

const PRODUCTS_SCAN_GQL = `
  query CreationsAdminProductsScan($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          ${PRODUCT_SCAN_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCTS_GQL = `
  query CreationsAdminProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          ${PRODUCT_NODE_FIELDS}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCTS_BY_IDS_GQL = `
  query CreationsAdminProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        ${PRODUCT_NODE_FIELDS}
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function graphqlThrottleMessage(errors) {
  if (!Array.isArray(errors) || !errors.length) return "";
  return errors
    .map((e) => String(e?.message || ""))
    .join("; ");
}

function isGraphqlThrottled(errors) {
  const msg = graphqlThrottleMessage(errors).toLowerCase();
  return (
    msg.includes("throttled") ||
    msg.includes("exceeds") ||
    msg.includes("rate limit") ||
    errors.some((e) => String(e?.extensions?.code || "").toUpperCase() === "THROTTLED")
  );
}

/**
 * Shopify Admin GraphQL with light retry on throttle / 429.
 * @param {object} env
 * @param {string} shopDomain
 * @param {{ query: string, variables?: object }} body
 * @param {{ maxAttempts?: number }} [opts]
 */
async function shopifyGraphql(env, shopDomain, body, opts = {}) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 4);
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await shopifyAPI(env, shopDomain, "graphql.json", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const errors = resp?.errors;
      if (Array.isArray(errors) && errors.length) {
        if (isGraphqlThrottled(errors) && attempt < maxAttempts) {
          await sleep(350 * attempt * attempt);
          continue;
        }
        // Shopify may return partial data alongside field errors — keep usable payloads.
        if (resp?.data?.products || resp?.data?.nodes) {
          console.warn(
            "[adminCreationsShopifyList] GraphQL warnings:",
            graphqlThrottleMessage(errors)
          );
          return resp;
        }
        const err = new Error(graphqlThrottleMessage(errors) || "shopify_graphql_error");
        err.graphqlErrors = errors;
        throw err;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      const status = Number(e?.status) || 0;
      const retryable = status === 429 || status === 503 || isGraphqlThrottled(e?.graphqlErrors);
      if (!retryable || attempt >= maxAttempts) throw e;
      const retryAfterMs = Number.isFinite(Number(e?.retryAfter))
        ? Math.max(250, Number(e.retryAfter) * 1000)
        : 350 * attempt * attempt;
      await sleep(retryAfterMs);
    }
  }
  throw lastErr || new Error("shopify_graphql_failed");
}

/** Admin Products page can hold thousands of live listings — scan past the old 2k ceiling. */
const DEFAULT_MAX_SCAN = 10000;
/** Hard cap for matched / returned Shopify product nodes per list call. */
const MAX_PRODUCT_NODES = 5000;

export function shopDomainFromEnv(env) {
  const raw = String(env?.SHOPIFY_SHOP || env?.SHOPIFY_SHOP_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!raw) return "allyoucanpink.myshopify.com";
  return raw.includes(".") ? raw : `${raw}.myshopify.com`;
}

/** @param {string|null|undefined} id */
export function normalizeShopifyProductId(id) {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  // Reject Admin UI pseudo-ids (e.g. studio:26) — only real Shopify product ids.
  if (/^studio:/i.test(raw)) return "";
  const gid = /^gid:\/\/shopify\/Product\/(\d+)$/i.exec(raw);
  if (gid) return gid[1];
  const whole = raw.replace(/\.0+$/, "").replace(/\.\d+$/, "");
  if (/^\d+$/.test(whole)) return whole;
  return "";
}

function sqlNormalizeShopifyProductId(column = "shopify_product_id") {
  return `REPLACE(REPLACE(TRIM(CAST(${column} AS TEXT)), 'gid://shopify/Product/', ''), '.0', '')`;
}

function shopifyStatusToIsActive(status) {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE") return 2;
  if (s === "DRAFT") return 1;
  return 0;
}

function imageUrlFromNode(node) {
  return node?.featuredMedia?.image?.url || null;
}

function imageListFromNode(node) {
  const out = [];
  const seen = new Set();
  const edges = node?.images?.edges || [];
  for (const edge of edges) {
    const url = String(edge?.node?.url || "").trim();
    if (!url || seen.has(url.split("?")[0])) continue;
    seen.add(url.split("?")[0]);
    out.push({
      src: url,
      alt: edge?.node?.altText || "",
      view: inferViewFromAltOrUrl(edge?.node?.altText, url, out.length),
      variant_label: String(edge?.node?.altText || "").split("|")[0]?.trim() || "Default",
      is_preview: out.length === 0,
    });
  }
  const featured = imageUrlFromNode(node);
  if (featured && !seen.has(String(featured).split("?")[0])) {
    out.unshift({ src: featured, alt: "", view: "front", variant_label: "Default", is_preview: true });
  }
  return out;
}

function inferViewFromAltOrUrl(alt, url, index) {
  const raw = `${String(alt || "")} ${String(url || "")}`.toLowerCase();
  if (/(^|[^a-z])back([^a-z]|$)|[_/-]back[_./-]/.test(raw)) return "back";
  if (/(^|[^a-z])front([^a-z]|$)|[_/-]front[_./-]/.test(raw)) return "front";
  return index === 0 ? "front" : index === 1 ? "back" : `view ${index + 1}`;
}

function printifyIdFromNode(node) {
  return parseMetafieldValue(node?.mfPrintifyId?.value);
}

function providerFromNode(node) {
  return parseMetafieldValue(node?.mfProvider?.value).toLowerCase();
}

function originLabelFromListingOrigin(origin) {
  const o = String(origin || "").trim().toLowerCase();
  if (o === "shop" || o === "customer") return "Customer";
  if (o === "creator") return "Creator";
  return null;
}

function normYes(val) {
  return String(val || "")
    .trim()
    .toLowerCase() === "yes";
}

function tagsFromNode(node) {
  const raw = node?.tags;
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);
  }
  return String(raw || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Shopify gift card product (native store offering, not Printify POD).
 * This store's gift card uses productType "Gutschein", tags like giftcard/gutschein,
 * and Shopify's built-in isGiftCard flag — not product_type "Gift Card" / tag gift-card.
 */
export function isGiftCardShopifyProduct(node) {
  if (node?.isGiftCard === true) return true;

  const productType = String(node?.productType || "")
    .trim()
    .toLowerCase();
  if (
    productType === "gift card" ||
    productType === "giftcard" ||
    productType === "gutschein" ||
    productType === "geschenkgutschein"
  ) {
    return true;
  }

  const tags = tagsFromNode(node);
  return (
    tags.includes("gift-card") ||
    tags.includes("gift card") ||
    tags.includes("giftcard") ||
    tags.includes("gutschein") ||
    tags.includes("geschenkgutschein")
  );
}

/** Shopify sample template product (`custom.sample` = yes). */
export function isSampleShopifyProduct(node) {
  return normYes(parseMetafieldValue(node?.mfSample?.value));
}

/**
 * Native Shopify store products that are not POD-catalog sources.
 * Gift cards + personalizable sample templates — not creator Printify/Todify listings.
 */
export function isNativeShopifyStoreProduct(node) {
  return isGiftCardShopifyProduct(node) || isSampleShopifyProduct(node);
}

/**
 * Shopify Admin search hint for residual store products (gift cards).
 * Prefer gift_card:true — matches Shopify's isGiftCard, including productType "Gutschein".
 */
export const NATIVE_SHOPIFY_STORE_QUERY =
  '(gift_card:true OR product_type:Gutschein OR product_type:"Gift Card" OR tag:giftcard OR tag:gift-card OR tag:gutschein)';

/** Shopify Admin search hint for personalizable sample templates (`custom.sample` = yes). */
export const SAMPLES_SHOPIFY_STORE_QUERY = "metafields.custom.sample:yes";

/** Shopify Admin search hint for Todify/partner-direct listings. */
export const TODIFY_SHOPIFY_STORE_QUERY = "metafields.custom.provider:todify";

/**
 * Shopify Admin search hint for Printify / creator listings not already loaded from D1.
 * Keeps orphan metafield listings discoverable without a full-catalog scan.
 */
export const PRINTIFY_SHOPIFY_STORE_QUERY =
  '(metafields.custom.printify_product_id:* OR metafields.custom.provider:printify OR metafields.custom.listing_origin:creator)';

/**
 * Shopify listing originates from Printify when metafield, provider, D1 link, or creator publish says so.
 * Todify, gift cards, and personalizable samples belong to their own source chips.
 * @param {object} node
 * @param {Map<string, string>|null|undefined} printifyLinks shopify_product_id → printify_product_id
 * @param {Set<string>|null|undefined} [creatorPublishedIds] all published_designs shopify_product_id values
 */
export function isPrintifySourcedProduct(node, printifyLinks, creatorPublishedIds) {
  if (isTodifyPartnerShopifyProduct(node)) return false;
  if (isSampleShopifyProduct(node)) return false;
  if (isGiftCardShopifyProduct(node)) return false;

  const printifyId = printifyIdFromNode(node);
  if (printifyId) return true;

  const provider = providerFromNode(node);
  if (provider === "printify") return true;

  const listingOrigin = parseMetafieldValue(node?.mfListingOrigin?.value).toLowerCase();
  if (listingOrigin === "creator") return true;

  const sid = normalizeShopifyProductId(node?.id);
  if (sid && printifyLinks?.has(sid)) return true;
  if (sid && creatorPublishedIds?.has(sid)) return true;

  return false;
}

/**
 * Partner-direct Shopify listings (Todify dogfood / future non-Printify partners).
 * Detected via custom.provider metafield.
 */
export function isTodifyPartnerShopifyProduct(node) {
  if (isSampleShopifyProduct(node) || isGiftCardShopifyProduct(node)) return false;
  return providerFromNode(node) === "todify";
}

/**
 * Shopify residual bucket: store-native leftovers not assigned to Printify / Todify / Customer / Samples.
 * Gift cards are the primary example.
 */
export function isShopifyResidualProduct(node) {
  if (isTodifyPartnerShopifyProduct(node)) return false;
  if (isSampleShopifyProduct(node)) return false;
  return isGiftCardShopifyProduct(node);
}

/**
 * @deprecated Prefer isShopifyResidualProduct — previously mixed gift cards, samples, and Todify.
 * @param {object} node
 * @param {Set<string>|null|undefined} [creatorPublishedIds]
 */
export function isShopifyTabProduct(node, creatorPublishedIds) {
  if (isShopifyResidualProduct(node)) return true;
  if (isSampleShopifyProduct(node)) return true;
  if (isTodifyPartnerShopifyProduct(node)) return true;
  // Legacy: creator publish without Printify id, provider lag, id in published_designs
  const printifyId = printifyIdFromNode(node);
  if (printifyId) return false;
  const listingOrigin = parseMetafieldValue(node?.mfListingOrigin?.value).toLowerCase();
  const sid = normalizeShopifyProductId(node?.id);
  if (listingOrigin === "creator" && sid && creatorPublishedIds?.has(sid) && !printifyId) {
    const provider = providerFromNode(node);
    if (provider === "todify") return true;
  }
  return false;
}

/** @deprecated Use isPrintifySourcedProduct — kept for tests/callers that only check metafield. */
export function hasPrintifyMetafield(node) {
  return Boolean(printifyIdFromNode(node));
}

/**
 * @param {object} node Shopify GraphQL product node
 * @param {"printify"|"shopify"|"todify"|"samples"} source
 * @param {Map<string, string>|null|undefined} [printifyLinks]
 */
export function mapShopifyNodeToProduct(node, source, printifyLinks) {
  const shopifyId = normalizeShopifyProductId(node?.id);
  const productKey = String(parseMetafieldValue(node?.mfProductKey?.value) || node?.handle || shopifyId).trim();
  const imageUrl = imageUrlFromNode(node);
  const gridViews = imageListFromNode(node);
  const printifyFromMf = printifyIdFromNode(node);
  const printifyFromD1 = shopifyId && printifyLinks?.get(shopifyId);
  const provider = providerFromNode(node);
  const listingOrigin = parseMetafieldValue(node?.mfListingOrigin?.value) || null;
  let sourceLabel = source;
  if (source === "todify" || provider === "todify") sourceLabel = "Todify";
  else if (source === "samples" || isSampleShopifyProduct(node)) sourceLabel = "Personalizable samples";
  else if (source === "printify") sourceLabel = "Printify";
  else if (source === "shopify") sourceLabel = "Shopify";
  else if (provider) sourceLabel = provider;

  let categoryDefault = "Shopify";
  if (source === "printify") categoryDefault = "Printify";
  else if (source === "todify") categoryDefault = "Todify";
  else if (source === "samples") categoryDefault = "Personalizable samples";
  else if (isGiftCardShopifyProduct(node)) categoryDefault = "Gift card";

  const productType = String(node?.productType || "").trim();
  const fullName = String(node?.category?.fullName || "").trim();
  const taxonomyLeaf = fullName.includes(">") ? fullName.split(">").pop().trim() : fullName;
  const shopifyProductType = productType || taxonomyLeaf || "";
  const visibilityRaw = String(parseMetafieldValue(node?.mfVisibility?.value) || "")
    .trim()
    .toLowerCase();
  const listingVisibility = visibilityRaw === "public" ? "public" : "private";
  const createdAt = toEpochMs(node?.createdAt);
  const updatedAt = toEpochMs(node?.updatedAt) || createdAt;
  const sortTs = Math.max(updatedAt, createdAt);

  return {
    id: shopifyId,
    product_key: productKey,
    title: node?.title || productKey,
    preview_url: imageUrl,
    images: gridViews.length ? gridViews.map((v) => v.src) : imageUrl ? [imageUrl] : [],
    grid_views: gridViews,
    category: shopifyProductType || categoryDefault,
    shopify_product_type: shopifyProductType || null,
    filter_category: shopifyProductType || "_empty",
    listing_visibility: listingVisibility,
    filter_visibility: listingVisibility,
    status: node?.status,
    is_active: shopifyStatusToIsActive(node?.status),
    vendor: node?.vendor || "",
    shopify_product_id: shopifyId,
    printify_product_id: printifyFromMf || printifyFromD1 || null,
    listing_origin: listingOrigin,
    origin_label: originLabelFromListingOrigin(listingOrigin),
    provider: provider || null,
    source,
    source_label: sourceLabel,
    total_variants: Number(node?.totalVariants?.count) || 0,
    created_at: createdAt || 0,
    updated_at: updatedAt || 0,
    sort_ts: sortTs || 0,
  };
}

/**
 * Build a Map<normalizedShopifyId, node> from a list of raw Shopify GraphQL product nodes
 * (e.g. the output of fetchShopifyProductNodesMatching), for list-enrichment lookups
 * (see adminCreationsProductListEnrich.js).
 */
export function indexShopifyNodesById(nodes) {
  const map = new Map();
  for (const node of nodes || []) {
    const sid = normalizeShopifyProductId(node?.id);
    if (!sid) continue;
    map.set(sid, node);
  }
  return map;
}

/**
 * Fetch Shopify Product nodes by numeric / GID ids (same fields as list scan).
 * Used when Customer / Studio rows have shopify_product_id but were not part of a
 * products() scan — without this, enrich emits variant_count=0 / metafields=0 /
 * Default+No-alt image groups.
 *
 * @param {object} env
 * @param {Array<string|number>} shopifyIds
 * @returns {Promise<object[]>}
 */
export async function fetchShopifyProductNodesByIds(env, shopifyIds) {
  const ids = [
    ...new Set(
      (shopifyIds || [])
        .map((id) => normalizeShopifyProductId(id))
        .filter(Boolean)
        .map((id) => `gid://shopify/Product/${id}`)
    ),
  ];
  if (!ids.length || !env?.SHOPIFY_ACCESS_TOKEN) return [];

  const shopDomain = shopDomainFromEnv(env);
  const out = [];
  const CHUNK = 50;
  let hardFailures = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const resp = await shopifyGraphql(env, shopDomain, {
        query: PRODUCTS_BY_IDS_GQL,
        variables: { ids: chunk },
      });
      for (const node of resp?.data?.nodes || []) {
        if (node?.id) out.push(node);
      }
    } catch (e) {
      hardFailures += 1;
      console.warn("[adminCreationsShopifyList] products-by-ids failed:", e?.message || e);
      // One chunk can fail (deleted ids / transient); abort only if nothing loaded and many fail.
      if (hardFailures >= 3 && !out.length) throw e;
    }
  }
  return out;
}

/**
 * @param {object} env
 * @param {{ queryStr?: string, limit?: number }} opts
 */
export async function fetchShopifyProductNodes(env, opts = {}) {
  const shopDomain = shopDomainFromEnv(env);
  const limit = Math.min(MAX_PRODUCT_NODES, Math.max(1, Number(opts.limit) || 50));
  const queryStr = String(opts.queryStr || "").trim();
  const items = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext && items.length < limit) {
    const first = Math.min(50, limit - items.length);
    const resp = await shopifyGraphql(env, shopDomain, {
      query: PRODUCTS_GQL,
      variables: { first, after: cursor, query: queryStr || null },
    });

    const conn = resp?.data?.products;
    const edges = conn?.edges || [];
    for (const edge of edges) {
      if (edge?.node) items.push(edge.node);
    }
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    if (!edges.length) break;
  }

  return items;
}

/**
 * Paginate Shopify products with a *light* scan query, collect matching ids, then
 * hydrate full Product nodes (images/metafields/publications) via nodes(ids:).
 * Avoids the old pattern of pulling 100 images + 100 metafields for every catalog page,
 * which throttled Shopify and made Admin Products counts jump on each reload.
 *
 * @param {object} env
 * @param {{ matchFn: (node: object) => boolean, limit?: number, maxScan?: number, queryStr?: string }} opts
 */
export async function fetchShopifyProductNodesMatching(env, opts = {}) {
  const matchFn = typeof opts.matchFn === "function" ? opts.matchFn : () => true;
  const shopDomain = shopDomainFromEnv(env);
  const limit = Math.min(MAX_PRODUCT_NODES, Math.max(1, Number(opts.limit) || 50));
  const maxScan = Math.min(20000, Math.max(limit, Number(opts.maxScan) || DEFAULT_MAX_SCAN));
  const queryStr = String(opts.queryStr || "").trim();

  const matchedIds = [];
  let cursor = null;
  let hasNext = true;
  let scanned = 0;

  while (hasNext && matchedIds.length < limit && scanned < maxScan) {
    const first = Math.min(50, maxScan - scanned);
    const resp = await shopifyGraphql(env, shopDomain, {
      query: PRODUCTS_SCAN_GQL,
      variables: { first, after: cursor, query: queryStr || null },
    });

    const conn = resp?.data?.products;
    const edges = conn?.edges || [];
    for (const edge of edges) {
      scanned += 1;
      const node = edge?.node;
      if (!node) continue;
      if (!matchFn(node)) continue;
      const sid = normalizeShopifyProductId(node.id);
      if (!sid) continue;
      matchedIds.push(sid);
      if (matchedIds.length >= limit) break;
    }
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    if (!edges.length) break;
  }

  if (!matchedIds.length) return [];
  const fullNodes = await fetchShopifyProductNodesByIds(env, matchedIds);
  const byId = indexShopifyNodesById(fullNodes);
  // Preserve scan order; fall back to light node only if hydrate missed an id.
  return matchedIds.map((sid) => byId.get(sid)).filter(Boolean);
}

/**
 * Load Printify/creator Shopify products from D1 published_designs ids (source of truth),
 * then hydrate full Shopify nodes. Deterministic — no full-catalog scan.
 *
 * @param {object} env
 * @param {{
 *   limit?: number,
 *   customerStudioIds?: Set<string>,
 *   printifyLinks?: Map<string, string>,
 *   creatorPublishedIds?: Set<string>,
 * }} opts
 * @returns {Promise<object[]>}
 */
export async function fetchPrintifyShopifyNodesFromD1(env, opts = {}) {
  const limit = Math.min(MAX_PRODUCT_NODES, Math.max(1, Number(opts.limit) || 2500));
  const customerStudioIds = opts.customerStudioIds instanceof Set ? opts.customerStudioIds : new Set();
  let printifyLinks = opts.printifyLinks;
  let creatorPublishedIds = opts.creatorPublishedIds;
  if (!(printifyLinks instanceof Map) || !(creatorPublishedIds instanceof Set)) {
    const idx = await loadPublishedDesignsShopifyIndex(env);
    printifyLinks = idx.printifyLinks;
    creatorPublishedIds = idx.creatorPublishedIds;
  }

  const ids = [...creatorPublishedIds].slice(0, limit);
  if (!ids.length) return [];

  const nodes = await fetchShopifyProductNodesByIds(env, ids);
  const byId = indexShopifyNodesById(nodes);
  // Keep D1 newest-first order (Set insertion order from ORDER BY updated_at DESC).
  return ids
    .map((sid) => byId.get(sid))
    .filter(
      (node) =>
        !!node &&
        isPrintifySourcedProduct(node, printifyLinks, creatorPublishedIds) &&
        !isCustomerStudioShopifyProduct(node, customerStudioIds)
    );
}

/**
 * published_designs shopify ids — all creator publishes plus optional printify_product_id for backfill.
 * Ordered newest-first by updated_at (falls back to published_at).
 * @returns {{
 *   printifyLinks: Map<string, string>,
 *   creatorPublishedIds: Set<string>,
 *   updatedAtBySid: Map<string, number>,
 * }}
 */
export async function loadPublishedDesignsShopifyIndex(env) {
  /** @type {Map<string, string>} */
  const printifyLinks = new Map();
  /** @type {Set<string>} */
  const creatorPublishedIds = new Set();
  /** @type {Map<string, number>} */
  const updatedAtBySid = new Map();
  if (!env?.CREATOR_DB) return { printifyLinks, creatorPublishedIds, updatedAtBySid };

  try {
    const normSid = sqlNormalizeShopifyProductId();
    // Page through D1 — a single SELECT can truncate large published_designs tables.
    const PAGE = 1000;
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const res = await env.CREATOR_DB.prepare(
        `SELECT ${normSid} AS sid, TRIM(printify_product_id) AS pid,
                updated_at, published_at
         FROM published_designs
         WHERE shopify_product_id IS NOT NULL
           AND TRIM(CAST(shopify_product_id AS TEXT)) != ''
         ORDER BY COALESCE(updated_at, published_at, 0) DESC
         LIMIT ? OFFSET ?`
      )
        .bind(PAGE, offset)
        .all();
      const rows = res?.results || [];
      for (const row of rows) {
        const sid = normalizeShopifyProductId(row.sid);
        if (!sid) continue;
        const ts = Math.max(toEpochMs(row.updated_at), toEpochMs(row.published_at));
        if (!creatorPublishedIds.has(sid)) creatorPublishedIds.add(sid);
        if (ts > (updatedAtBySid.get(sid) || 0)) updatedAtBySid.set(sid, ts);
        const pid = String(row.pid || "").trim();
        if (pid && !printifyLinks.has(sid)) printifyLinks.set(sid, pid);
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  } catch (e) {
    console.warn("[admin-creations-shopify-list] published_designs index:", e?.message);
  }

  return { printifyLinks, creatorPublishedIds, updatedAtBySid };
}

/** @deprecated Prefer loadPublishedDesignsShopifyIndex — kept for callers that only need printify id map. */
export async function loadPrintifyLinksFromD1(env) {
  const { printifyLinks } = await loadPublishedDesignsShopifyIndex(env);
  return printifyLinks;
}

/** Shopify product IDs linked to Shop Design Studio (exclude from Printify + Shopify tabs). */
export async function loadCustomerStudioShopifyIds(env) {
  const ids = new Set();
  if (!env?.CUSTOMER_DB) return ids;

  const queries = [
    `SELECT shopify_product_id FROM customer_products
     WHERE shopify_product_id IS NOT NULL AND TRIM(shopify_product_id) != ''`,
    `SELECT shopify_product_id FROM shop_studio_listings
     WHERE shopify_product_id IS NOT NULL AND TRIM(shopify_product_id) != ''`,
  ];

  for (const sql of queries) {
    try {
      const res = await env.CUSTOMER_DB.prepare(sql).all();
      for (const row of res?.results || []) {
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        if (sid) ids.add(sid);
      }
    } catch (e) {
      console.warn("[admin-creations-shopify-list] customer studio ids:", e?.message);
    }
  }

  return ids;
}

export function isCustomerStudioShopifyProduct(node, customerStudioIds) {
  const sid = normalizeShopifyProductId(node?.id);
  if (sid && customerStudioIds.has(sid)) return true;
  const origin = parseMetafieldValue(node?.mfListingOrigin?.value).toLowerCase();
  return origin === "shop";
}
