/**
 * Lightweight Shopify product listing for Creations admin portal (partner worker).
 * Avoids importing the full adminShopifyCatalog stack.
 */

import { shopifyAPI } from "../../utils/shopify.js";
import { parseMetafieldValue } from "../admin/shopifyCatalogMetafieldSpec.js";

const PRODUCTS_GQL = `
  query CreationsAdminProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          tags
          isGiftCard
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
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const DEFAULT_MAX_SCAN = 2000;

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
  return raw.replace(/^gid:\/\/shopify\/Product\//i, "").replace(/\.0$/, "");
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

function printifyIdFromNode(node) {
  return parseMetafieldValue(node?.mfPrintifyId?.value);
}

function providerFromNode(node) {
  return parseMetafieldValue(node?.mfProvider?.value).toLowerCase();
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
 * Native Shopify store products for the Creations admin Shopify tab (strict whitelist).
 * Gift cards + sample templates only — not creator Printify listings.
 */
export function isNativeShopifyStoreProduct(node) {
  return isGiftCardShopifyProduct(node) || isSampleShopifyProduct(node);
}

/**
 * Shopify Admin search hint for native store products (post-filter remains authoritative).
 * Prefer gift_card:true — matches Shopify's isGiftCard, including productType "Gutschein".
 */
export const NATIVE_SHOPIFY_STORE_QUERY =
  '(gift_card:true OR product_type:Gutschein OR product_type:"Gift Card" OR tag:giftcard OR tag:gift-card OR tag:gutschein OR metafields.custom.sample:yes)';

/**
 * Shopify listing originates from Printify when metafield, provider, D1 link, or creator publish says so.
 * Explicit Todify/partner-direct products are excluded (they appear under the Shopify tab).
 * @param {object} node
 * @param {Map<string, string>|null|undefined} printifyLinks shopify_product_id → printify_product_id
 * @param {Set<string>|null|undefined} [creatorPublishedIds] all published_designs shopify_product_id values
 */
export function isPrintifySourcedProduct(node, printifyLinks, creatorPublishedIds) {
  if (isTodifyPartnerShopifyProduct(node)) return false;

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
  const provider = providerFromNode(node);
  return provider === "todify";
}

/**
 * Native store products OR partner-direct (Todify) creator listings for Creations → Products → Shopify.
 * @param {object} node
 * @param {Set<string>|null|undefined} [creatorPublishedIds]
 */
export function isShopifyTabProduct(node, creatorPublishedIds) {
  if (isNativeShopifyStoreProduct(node)) return true;
  if (isTodifyPartnerShopifyProduct(node)) return true;
  // Creator publish without Printify id but recorded in published_designs (provider may lag)
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
 * @param {"printify"|"shopify"} source
 * @param {Map<string, string>|null|undefined} [printifyLinks]
 */
export function mapShopifyNodeToProduct(node, source, printifyLinks) {
  const shopifyId = normalizeShopifyProductId(node?.id);
  const productKey = String(parseMetafieldValue(node?.mfProductKey?.value) || node?.handle || shopifyId).trim();
  const imageUrl = imageUrlFromNode(node);
  const printifyFromMf = printifyIdFromNode(node);
  const printifyFromD1 = shopifyId && printifyLinks?.get(shopifyId);
  const provider = providerFromNode(node);
  let sourceLabel = source;
  if (provider === "todify") sourceLabel = "Todify";
  else if (source === "printify") sourceLabel = "Printify";
  else if (source === "shopify" && isNativeShopifyStoreProduct(node)) sourceLabel = "Shopify";
  else if (source === "shopify") sourceLabel = provider || "Shopify";

  return {
    id: shopifyId,
    product_key: productKey,
    title: node?.title || productKey,
    preview_url: imageUrl,
    images: imageUrl ? [imageUrl] : [],
    category: node?.productType || (source === "printify" ? "Printify" : "Shopify"),
    status: node?.status,
    is_active: shopifyStatusToIsActive(node?.status),
    vendor: node?.vendor || "",
    shopify_product_id: shopifyId,
    printify_product_id: printifyFromMf || printifyFromD1 || null,
    listing_origin: parseMetafieldValue(node?.mfListingOrigin?.value) || null,
    provider: provider || null,
    source,
    source_label: sourceLabel,
  };
}

/**
 * @param {object} env
 * @param {{ queryStr?: string, limit?: number }} opts
 */
export async function fetchShopifyProductNodes(env, opts = {}) {
  const shopDomain = shopDomainFromEnv(env);
  const limit = Math.min(250, Math.max(1, Number(opts.limit) || 50));
  const queryStr = String(opts.queryStr || "").trim();
  const items = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext && items.length < limit) {
    const first = Math.min(50, limit - items.length);
    const resp = await shopifyAPI(env, shopDomain, "graphql.json", {
      method: "POST",
      body: JSON.stringify({
        query: PRODUCTS_GQL,
        variables: { first, after: cursor, query: queryStr || null },
      }),
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
 * Paginate Shopify products and collect nodes matching matchFn (post-filter).
 * @param {object} env
 * @param {{ matchFn: (node: object) => boolean, limit?: number, maxScan?: number, queryStr?: string }} opts
 */
export async function fetchShopifyProductNodesMatching(env, opts = {}) {
  const matchFn = typeof opts.matchFn === "function" ? opts.matchFn : () => true;
  const shopDomain = shopDomainFromEnv(env);
  const limit = Math.min(250, Math.max(1, Number(opts.limit) || 50));
  const maxScan = Math.min(5000, Math.max(limit, Number(opts.maxScan) || DEFAULT_MAX_SCAN));
  const queryStr = String(opts.queryStr || "").trim();

  const items = [];
  let cursor = null;
  let hasNext = true;
  let scanned = 0;

  while (hasNext && items.length < limit && scanned < maxScan) {
    const first = Math.min(50, maxScan - scanned);
    const resp = await shopifyAPI(env, shopDomain, "graphql.json", {
      method: "POST",
      body: JSON.stringify({
        query: PRODUCTS_GQL,
        variables: { first, after: cursor, query: queryStr || null },
      }),
    });

    const conn = resp?.data?.products;
    const edges = conn?.edges || [];
    for (const edge of edges) {
      scanned += 1;
      const node = edge?.node;
      if (!node) continue;
      if (matchFn(node)) items.push(node);
      if (items.length >= limit) break;
    }
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    if (!edges.length) break;
  }

  return items;
}

/**
 * published_designs shopify ids — all creator publishes plus optional printify_product_id for backfill.
 * @returns {{ printifyLinks: Map<string, string>, creatorPublishedIds: Set<string> }}
 */
export async function loadPublishedDesignsShopifyIndex(env) {
  /** @type {Map<string, string>} */
  const printifyLinks = new Map();
  /** @type {Set<string>} */
  const creatorPublishedIds = new Set();
  if (!env?.CREATOR_DB) return { printifyLinks, creatorPublishedIds };

  try {
    const normSid = sqlNormalizeShopifyProductId();
    const res = await env.CREATOR_DB.prepare(
      `SELECT ${normSid} AS sid, TRIM(printify_product_id) AS pid
       FROM published_designs
       WHERE shopify_product_id IS NOT NULL
         AND TRIM(CAST(shopify_product_id AS TEXT)) != ''
       ORDER BY published_at DESC`
    ).all();

    for (const row of res?.results || []) {
      const sid = normalizeShopifyProductId(row.sid);
      if (!sid) continue;
      creatorPublishedIds.add(sid);
      const pid = String(row.pid || "").trim();
      if (pid && !printifyLinks.has(sid)) printifyLinks.set(sid, pid);
    }
  } catch (e) {
    console.warn("[admin-creations-shopify-list] published_designs index:", e?.message);
  }

  return { printifyLinks, creatorPublishedIds };
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
