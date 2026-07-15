/**
 * Creations admin portal API helpers — proxied through partner worker with admin session.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { CAT_REVERSE, buildCategoryTree } from "../admin/catalogConstants.js";
import {
  shopDomainFromEnv,
  fetchShopifyProductNodesMatching,
  mapShopifyNodeToProduct,
  loadCustomerStudioShopifyIds,
  loadPublishedDesignsShopifyIndex,
  isCustomerStudioShopifyProduct,
  isPrintifySourcedProduct,
  isShopifyResidualProduct,
  isTodifyPartnerShopifyProduct,
  isSampleShopifyProduct,
  normalizeShopifyProductId,
  NATIVE_SHOPIFY_STORE_QUERY,
} from "./adminCreationsShopifyList.js";

export function proxyRequestWithAdminOwner(request, ownerId) {
  const url = new URL(request.url);
  if (ownerId) url.searchParams.set("logged_in_customer_id", String(ownerId));
  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
  });
}

function studioStatusToIsActive(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "complete" || s === "published" || s === "ready") return 2;
  if (s === "pending" || s === "processing") return 1;
  return 0;
}

async function enrichPrintifyCategories(env, products) {
  if (!env.CATALOG_DB || !products.length) return products;

  const keys = [...new Set(products.map((p) => p.product_key).filter(Boolean))];
  if (!keys.length) return products;

  const placeholders = keys.map(() => "?").join(",");
  try {
    const res = await env.CATALOG_DB.prepare(
      `SELECT pc.product_key,
              (SELECT bp.category FROM product_publish_profiles pp
                JOIN printify_blueprints bp ON bp.id = pp.blueprint_id
                WHERE pp.product_key = pc.product_key AND pp.blueprint_id IS NOT NULL
                  AND pp.source_system = 'printify'
                LIMIT 1) AS blueprint_category
       FROM product_catalog pc
       WHERE pc.product_key IN (${placeholders})`
    )
      .bind(...keys)
      .all();

    const catByKey = new Map();
    for (const row of res?.results || []) {
      if (row.product_key) catByKey.set(row.product_key, row.blueprint_category || null);
    }

    return products.map((p) => {
      const category = catByKey.get(p.product_key) || p.category;
      return {
        ...p,
        category,
        parent_group: CAT_REVERSE[category] || p.parent_group || "Other",
      };
    });
  } catch (e) {
    console.warn("[admin-creations-printify-products] category enrich:", e?.message);
    return products;
  }
}

/**
 * Printify = Shopify-listed products with Printify metafield (creator publish flow).
 * Excludes Shop Design Studio listings (customer tab).
 */
export async function handleAdminCreationsPrintifyProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const isActive = url.searchParams.get("is_active");
  const activeFilter =
    isActive != null && isActive !== "" ? Math.max(0, Math.min(2, Number.parseInt(isActive, 10) || 0)) : null;

  try {
    const [customerStudioIds, { printifyLinks, creatorPublishedIds }] = await Promise.all([
      loadCustomerStudioShopifyIds(env),
      loadPublishedDesignsShopifyIndex(env),
    ]);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      matchFn: (node) =>
        isPrintifySourcedProduct(node, printifyLinks, creatorPublishedIds) &&
        !isCustomerStudioShopifyProduct(node, customerStudioIds),
    });

    let products = nodes.map((node) => mapShopifyNodeToProduct(node, "printify", printifyLinks));

    products = await enrichPrintifyCategories(env, products);

    if (activeFilter != null) {
      products = products.filter((p) => Number(p.is_active) === activeFilter);
    }
    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.category, p.vendor, p.printify_product_id, p.shopify_product_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    const category_tree = buildCategoryTree(products);
    return json(
      {
        ok: true,
        products,
        total: products.length,
        category_tree,
        source: "printify",
      },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-printify-products]", err);
    return json({ ok: false, error: err?.message || "internal_error" }, 500, cors);
  }
}

/** Customer = Shop Design Studio products (CUSTOMER_DB), not creator-area published_designs. */
export async function handleAdminCreationsCustomerProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.CUSTOMER_DB) {
    return json({ ok: false, error: "database_unavailable" }, 500, cors);
  }

  const limit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 200));
  const q = String(new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();

  try {
    const products = [];
    const seen = new Set();

    const studioRes = await env.CUSTOMER_DB.prepare(
      `SELECT id, customer_id, product_key, product_title, printify_product_id,
              shopify_product_id, shopify_completion_status, preview_url, updated_at
       FROM shop_studio_listings
       WHERE listing_origin = 'shop' OR listing_origin IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    for (const row of studioRes?.results || []) {
      const key = `studio:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = String(row.product_title || row.product_key || `Studio #${row.id}`).trim();
      const preview = row.preview_url || null;
      products.push({
        id: String(row.id),
        product_key: String(row.product_key || row.id),
        title,
        preview_url: preview,
        images: preview ? [preview] : [],
        category: "Shop Design Studio",
        owner_id: String(row.customer_id || ""),
        owner_label: row.customer_id ? `Customer ${row.customer_id}` : "Customer",
        shopify_product_id: normalizeShopifyProductId(row.shopify_product_id) || null,
        printify_product_id: row.printify_product_id || null,
        is_active: studioStatusToIsActive(row.shopify_completion_status),
        source: "customer",
      });
    }

    const cpRes = await env.CUSTOMER_DB.prepare(
      `SELECT cp.id, cp.customer_id, cp.design_id, cp.product_key, cp.product_name,
              cp.printify_product_id, cp.shopify_product_id, cp.updated_at,
              cd.preview_url, cd.prompt
       FROM customer_products cp
       LEFT JOIN customer_designs cd ON cd.id = cp.design_id
       WHERE COALESCE(cp.listing_origin, 'shop') = 'shop'
       ORDER BY cp.updated_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    for (const row of cpRes?.results || []) {
      const sid = normalizeShopifyProductId(row.shopify_product_id);
      const dedupeKey = sid ? `sid:${sid}` : `cp:${row.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const title =
        String(row.product_name || "").trim() ||
        String(row.product_key || "").trim() ||
        (row.prompt ? String(row.prompt).slice(0, 80) : `Design #${row.design_id || row.id}`);
      const preview = row.preview_url || null;
      products.push({
        id: String(row.id),
        product_key: String(row.product_key || row.id),
        title,
        preview_url: preview,
        images: preview ? [preview] : [],
        category: "Customer products",
        owner_id: String(row.customer_id || ""),
        owner_label: row.customer_id ? `Customer ${row.customer_id}` : "Customer",
        shopify_product_id: sid || null,
        printify_product_id: row.printify_product_id || null,
        design_id: row.design_id,
        is_active: sid ? 2 : 1,
        source: "customer",
      });
    }

    products.sort((a, b) => Number(b.is_active) - Number(a.is_active));

    let filtered = products;
    if (q) {
      filtered = products.filter((p) =>
        [p.title, p.product_key, p.owner_label, p.shopify_product_id, p.printify_product_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return json({ ok: true, products: filtered, total: filtered.length, source: "customer" }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-customer-products]", err);
    return json({ ok: false, error: err?.message || "internal_error" }, 500, cors);
  }
}

/** Shopify residual = gift cards and other leftovers not in Printify / Todify / Customer / Samples. */
export async function handleAdminCreationsShopifyProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const { printifyLinks } = await loadPublishedDesignsShopifyIndex(env);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      maxScan: 3000,
      queryStr: NATIVE_SHOPIFY_STORE_QUERY,
      matchFn: (node) => isShopifyResidualProduct(node),
    });

    let products = nodes.map((node) => mapShopifyNodeToProduct(node, "shopify", printifyLinks));

    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.category, p.vendor, p.provider, p.source_label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return json({ ok: true, products, total: products.length, source: "shopify" }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-shopify-products]", err);
    return json({ ok: false, error: err?.message || "shopify_fetch_failed" }, 500, cors);
  }
}

/** Todify = partner-direct (custom.provider = todify) Shopify listings. */
export async function handleAdminCreationsTodifyProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const [customerStudioIds, { printifyLinks }] = await Promise.all([
      loadCustomerStudioShopifyIds(env),
      loadPublishedDesignsShopifyIndex(env),
    ]);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      maxScan: 3000,
      matchFn: (node) =>
        isTodifyPartnerShopifyProduct(node) && !isCustomerStudioShopifyProduct(node, customerStudioIds),
    });

    let products = nodes.map((node) => mapShopifyNodeToProduct(node, "todify", printifyLinks));

    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.category, p.vendor, p.provider, p.source_label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return json({ ok: true, products, total: products.length, source: "todify" }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-todify-products]", err);
    return json({ ok: false, error: err?.message || "shopify_fetch_failed" }, 500, cors);
  }
}

/** Samples = personalizable template products (`custom.sample` = yes). */
export async function handleAdminCreationsSamplesProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const [customerStudioIds, { printifyLinks }] = await Promise.all([
      loadCustomerStudioShopifyIds(env),
      loadPublishedDesignsShopifyIndex(env),
    ]);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      maxScan: 3000,
      matchFn: (node) =>
        isSampleShopifyProduct(node) && !isCustomerStudioShopifyProduct(node, customerStudioIds),
    });

    let products = nodes.map((node) => mapShopifyNodeToProduct(node, "samples", printifyLinks));

    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.category, p.vendor, p.provider, p.source_label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return json({ ok: true, products, total: products.length, source: "samples" }, 200, cors);
  } catch (err) {
    console.error("[admin-creations-samples-products]", err);
    return json({ ok: false, error: err?.message || "shopify_fetch_failed" }, 500, cors);
  }
}

export { shopDomainFromEnv };
