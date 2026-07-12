/**
 * Creations admin portal API helpers — proxied through partner worker with admin session.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { shopifyAPI } from "../../utils/shopify.js";

export function proxyRequestWithAdminOwner(request, ownerId) {
  const url = new URL(request.url);
  if (ownerId) url.searchParams.set("logged_in_customer_id", String(ownerId));
  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
  });
}

function shopDomainFromEnv(env) {
  const shop = String(env.SHOPIFY_SHOP || env.SHOPIFY_STORE_URL || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!shop) return "allyoucanpink.myshopify.com";
  return shop.includes(".") ? shop : `${shop}.myshopify.com`;
}

/** Customer-created products from published_designs (D1). */
export async function handleAdminCreationsCustomerProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.CREATOR_DB) {
    return json({ ok: false, error: "database_unavailable" }, 500, cors);
  }

  const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 200));
  const q = String(new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();

  try {
    const res = await env.CREATOR_DB.prepare(
      `SELECT pd.id AS published_id,
              pd.design_id,
              pd.owner_id,
              pd.product_key,
              pd.shopify_product_id,
              pd.printify_product_id,
              pd.updated_at,
              c.preview_url,
              c.creator_name,
              c.prompt
       FROM published_designs pd
       LEFT JOIN creations c ON c.id = pd.design_id
       WHERE pd.shopify_product_id IS NOT NULL
         AND TRIM(CAST(pd.shopify_product_id AS TEXT)) != ''
         AND TRIM(CAST(pd.shopify_product_id AS TEXT)) != '0'
       ORDER BY pd.updated_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    let products = (res?.results || []).map((row) => {
      const title =
        String(row.product_key || "").trim() ||
        (row.prompt ? String(row.prompt).slice(0, 80) : `Design #${row.design_id || row.published_id}`);
      return {
        id: String(row.published_id),
        product_key: String(row.product_key || row.published_id),
        title,
        preview_url: row.preview_url || null,
        images: row.preview_url ? [row.preview_url] : [],
        category: "Customer products",
        owner_id: String(row.owner_id || ""),
        owner_label: row.creator_name ? String(row.creator_name) : `Owner ${row.owner_id || "—"}`,
        creator_name: row.creator_name || "",
        shopify_product_id: row.shopify_product_id,
        printify_product_id: row.printify_product_id,
        design_id: row.design_id,
        source: "customer",
      };
    });

    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.owner_label, p.creator_name, p.shopify_product_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return json({ ok: true, products, total: products.length, source: "customer" }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-customer-products]", err);
    return json({ ok: false, error: err?.message || "internal_error" }, 500, cors);
  }
}

/** Shopify-native products without Printify (gift cards, samples, etc.). */
export async function handleAdminCreationsShopifyProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const shopDomain = shopDomainFromEnv(env);
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const q = String(new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();

  try {
    const resp = await shopifyAPI(env, shopDomain, `products.json?limit=${limit}&fields=id,title,handle,product_type,status,images,vendor`, {
      method: "GET",
    });
    const nodes = Array.isArray(resp?.products) ? resp.products : [];

    let products = nodes
      .filter((p) => {
        const vendor = String(p.vendor || "").toLowerCase();
        return !vendor.includes("printify");
      })
      .map((p) => {
        const images = (p.images || []).map((img) => img.src).filter(Boolean);
        return {
          id: String(p.id),
          product_key: p.handle || String(p.id),
          title: p.title || p.handle || String(p.id),
          preview_url: images[0] || null,
          images,
          category: p.product_type || "Shopify",
          status: p.status,
          vendor: p.vendor,
          shopify_product_id: p.id,
          source: "shopify",
        };
      });

    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.category, p.vendor].filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    }

    return json({ ok: true, products, total: products.length, source: "shopify" }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-shopify-products]", err);
    return json({ ok: false, error: err?.message || "shopify_fetch_failed" }, 500, cors);
  }
}
