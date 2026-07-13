/**
 * Lightweight Shopify product listing for Creations admin portal (partner worker).
 * Avoids importing the full adminShopifyCatalog stack.
 */

import { shopifyAPI } from "../../utils/shopify.js";

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
          featuredMedia {
            ... on MediaImage {
              image { url }
            }
          }
          mfPrintifyId: metafield(namespace: "custom", key: "printify_product_id") { value }
          mfProductKey: metafield(namespace: "custom", key: "product_key") { value }
          mfListingOrigin: metafield(namespace: "custom", key: "listing_origin") { value }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export function shopDomainFromEnv(env) {
  const shop = String(env.SHOPIFY_SHOP || env.SHOPIFY_STORE_URL || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!shop) return "allyoucanpink.myshopify.com";
  return shop.includes(".") ? shop : `${shop}.myshopify.com`;
}

/** @param {string|null|undefined} id */
export function normalizeShopifyProductId(id) {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^gid:\/\/shopify\/Product\//i, "").replace(/\.0$/, "");
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

/**
 * @param {object} node Shopify GraphQL product node
 * @param {"printify"|"shopify"} source
 */
export function mapShopifyNodeToProduct(node, source) {
  const shopifyId = normalizeShopifyProductId(node?.id);
  const productKey = String(node?.mfProductKey?.value || node?.handle || shopifyId).trim();
  const imageUrl = imageUrlFromNode(node);
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
    printify_product_id: String(node?.mfPrintifyId?.value || "").trim() || null,
    listing_origin: String(node?.mfListingOrigin?.value || "").trim() || null,
    source,
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

/** Shopify product IDs linked to Shop Design Studio (exclude from Printify tab). */
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
  const origin = String(node?.mfListingOrigin?.value || "").trim().toLowerCase();
  return origin === "shop";
}

export function hasPrintifyMetafield(node) {
  return Boolean(String(node?.mfPrintifyId?.value || "").trim());
}
