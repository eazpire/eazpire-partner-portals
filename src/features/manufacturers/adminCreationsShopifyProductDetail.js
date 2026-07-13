/**
 * Creations Admin — Shopify product detail (mockups, variants, metafields).
 * GET ?op=admin-creations-shopify-product-detail&product_id=…
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { shopifyAPI } from "../../utils/shopify.js";
import { parseMetafieldValue } from "../admin/shopifyCatalogMetafieldSpec.js";
import { shopDomainFromEnv, normalizeShopifyProductId } from "./adminCreationsShopifyList.js";

/** Preferred view order for mockup sorting (unknown views sort after). */
export const MOCKUP_VIEW_ORDER = {
  front: 0,
  back: 1,
  "front-collar-closeup": 2,
  sleeve: 3,
  left: 4,
  right: 5,
  other: 90,
};

/**
 * Parse Shopify mockup alt: "Color|view|preview-default"
 * @param {string|null|undefined} alt
 * @returns {{ color: string; view: string; isPreview: boolean }|null}
 */
export function parseMockupAlt(alt) {
  if (!alt || typeof alt !== "string") return null;
  const parts = alt.split("|");
  if (parts.length < 2) return null;
  return {
    color: parts[0].trim(),
    view: parts[1].trim().toLowerCase(),
    isPreview: parts.length >= 3 && String(parts[2] || "").trim().toLowerCase() === "preview-default",
  };
}

/**
 * Catalog DB fields → Shopify custom metafield keys (sample / template listing content).
 * Used to find values present in D1 but missing (or empty) on Shopify.
 */
export const DB_TO_SHOPIFY_METAFIELD_MAP = [
  {
    dbField: "standard_product_display_name",
    namespace: "custom",
    key: "product_name",
    group: "listing",
    label: "Product name",
  },
  {
    dbField: "product_features",
    namespace: "custom",
    key: "product_features_html",
    group: "listing",
    label: "Product features",
  },
  {
    dbField: "care_instructions",
    namespace: "custom",
    key: "care_instructions_html",
    group: "listing",
    label: "Care instructions",
  },
  {
    dbField: "size_table_html",
    namespace: "custom",
    key: "size_table_html",
    group: "listing",
    label: "Size table",
  },
  {
    dbField: "gpsr_html",
    namespace: "custom",
    key: "gpsr_html",
    group: "compliance",
    label: "GPSR",
  },
];

function metafieldIdentity(namespace, key) {
  return `${String(namespace || "").trim()}.${String(key || "").trim()}`;
}

function isFilledValue(raw) {
  const v = parseMetafieldValue(raw);
  if (v === "" || v == null) return false;
  if (v === "[]" || v === "{}") return false;
  return true;
}

function viewSortRank(view) {
  const v = String(view || "other")
    .trim()
    .toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MOCKUP_VIEW_ORDER, v)) return MOCKUP_VIEW_ORDER[v];
  return MOCKUP_VIEW_ORDER.other;
}

/**
 * Build mockup list from Shopify images, sorted by variant (color) then view.
 * @param {Array<{ id?: *, src?: string, alt?: string|null, position?: number, variant_ids?: *[] }>} images
 */
export function buildSortedMockups(images) {
  const list = (Array.isArray(images) ? images : []).map((img, index) => {
    const src = typeof img === "string" ? img : img?.src || "";
    const alt = typeof img === "string" ? null : img?.alt || null;
    const parsed = parseMockupAlt(alt);
    const variantLabel = parsed?.color || "Unassigned";
    const view = parsed?.view || "other";
    return {
      id: img?.id != null ? String(img.id) : `img-${index}`,
      src,
      alt,
      variant_label: variantLabel,
      view,
      is_preview: Boolean(parsed?.isPreview),
      position: Number(img?.position) || index + 1,
      variant_ids: Array.isArray(img?.variant_ids) ? img.variant_ids.map(String) : [],
    };
  });

  list.sort((a, b) => {
    const va = String(a.variant_label || "").toLowerCase();
    const vb = String(b.variant_label || "").toLowerCase();
    if (va !== vb) return va.localeCompare(vb);
    const viewDiff = viewSortRank(a.view) - viewSortRank(b.view);
    if (viewDiff !== 0) return viewDiff;
    if (a.is_preview !== b.is_preview) return a.is_preview ? -1 : 1;
    return (a.position || 0) - (b.position || 0);
  });

  return list;
}

/**
 * Normalize Shopify REST metafield rows.
 * @param {Array<object>} metafields
 */
export function normalizeShopifyMetafields(metafields) {
  return (Array.isArray(metafields) ? metafields : [])
    .map((m) => ({
      id: m?.id != null ? String(m.id) : null,
      namespace: String(m?.namespace || "").trim(),
      key: String(m?.key || "").trim(),
      type: m?.type || null,
      value: m?.value != null ? String(m.value) : "",
      group: String(m?.namespace || "other").trim() || "other",
    }))
    .filter((m) => m.namespace && m.key)
    .sort((a, b) => {
      const na = metafieldIdentity(a.namespace, a.key);
      const nb = metafieldIdentity(b.namespace, b.key);
      return na.localeCompare(nb);
    });
}

/**
 * Compare catalog/DB listing fields against Shopify metafields.
 * @param {Array<{ namespace: string, key: string, value: string }>} shopifyMetafields
 * @param {Array<{ namespace: string, key: string, value: string, group?: string, label?: string, source?: string }>} dbMetafields
 */
export function categorizeMetafields(shopifyMetafields, dbMetafields) {
  const shopify = normalizeShopifyMetafields(shopifyMetafields);
  const shopifyById = new Map();
  for (const m of shopify) {
    shopifyById.set(metafieldIdentity(m.namespace, m.key), m);
  }

  const inDatabaseNotInShopify = [];
  for (const db of Array.isArray(dbMetafields) ? dbMetafields : []) {
    if (!isFilledValue(db?.value)) continue;
    const id = metafieldIdentity(db.namespace, db.key);
    const onShopify = shopifyById.get(id);
    if (!onShopify || !isFilledValue(onShopify.value)) {
      inDatabaseNotInShopify.push({
        namespace: db.namespace,
        key: db.key,
        value: String(db.value),
        group: db.group || "catalog",
        label: db.label || db.key,
        source: db.source || "catalog_db",
      });
    }
  }

  inDatabaseNotInShopify.sort((a, b) => {
    const ga = String(a.group || "");
    const gb = String(b.group || "");
    if (ga !== gb) return ga.localeCompare(gb);
    return metafieldIdentity(a.namespace, a.key).localeCompare(metafieldIdentity(b.namespace, b.key));
  });

  return {
    in_database_not_in_shopify: inDatabaseNotInShopify,
    used_in_shopify: shopify,
  };
}

/**
 * Build expected metafields from catalog DB for a sample product_key.
 * @param {object} env
 * @param {string} productKey
 */
export async function loadDbMetafieldsForProductKey(env, productKey) {
  const pk = String(productKey || "").trim();
  if (!pk || !env?.CATALOG_DB) return [];

  const out = [];

  try {
    const catalog = await env.CATALOG_DB.prepare(
      `SELECT product_key, title FROM product_catalog WHERE product_key = ? LIMIT 1`
    )
      .bind(pk)
      .first();

    if (catalog?.product_key) {
      out.push({
        namespace: "custom",
        key: "product_key",
        value: String(catalog.product_key),
        group: "identity",
        label: "Product key",
        source: "product_catalog",
      });
      if (catalog.title) {
        out.push({
          namespace: "custom",
          key: "product_name",
          value: String(catalog.title),
          group: "listing",
          label: "Product name (catalog title)",
          source: "product_catalog",
        });
      }
    }
  } catch (e) {
    console.warn("[admin-creations-shopify-product-detail] product_catalog:", e?.message);
  }

  try {
    const profiles = await env.CATALOG_DB.prepare(
      `SELECT standard_product_display_name, product_features, care_instructions,
              size_table_html, gpsr_html, print_provider_id, title
       FROM product_publish_profiles
       WHERE product_key = ? AND COALESCE(is_active, 1) = 1
       ORDER BY id ASC
       LIMIT 8`
    )
      .bind(pk)
      .all();

    const rows = profiles?.results || [];
    /** Prefer first non-empty value per mapped field across active profiles. */
    const best = {};
    for (const row of rows) {
      for (const map of DB_TO_SHOPIFY_METAFIELD_MAP) {
        if (best[map.dbField]) continue;
        const val = row?.[map.dbField];
        if (isFilledValue(val)) best[map.dbField] = String(val);
      }
    }

    for (const map of DB_TO_SHOPIFY_METAFIELD_MAP) {
      const val = best[map.dbField];
      if (!isFilledValue(val)) continue;
      // Avoid duplicate product_name from catalog title when profile has display name
      if (map.key === "product_name") {
        const existingIdx = out.findIndex((m) => m.namespace === "custom" && m.key === "product_name");
        if (existingIdx >= 0) {
          out[existingIdx] = {
            ...out[existingIdx],
            value: val,
            label: map.label,
            source: "product_publish_profiles",
          };
          continue;
        }
      }
      out.push({
        namespace: map.namespace,
        key: map.key,
        value: val,
        group: map.group,
        label: map.label,
        source: "product_publish_profiles",
      });
    }
  } catch (e) {
    console.warn("[admin-creations-shopify-product-detail] publish_profiles:", e?.message);
  }

  // Sample products are marked in Shopify; catalog always expects this when product_key matches.
  if (pk) {
    out.push({
      namespace: "custom",
      key: "sample",
      value: "yes",
      group: "identity",
      label: "Sample template",
      source: "sample_convention",
    });
  }

  return out;
}

function mapVariant(v, currency) {
  const options = [v.option1, v.option2, v.option3].filter((o) => o != null && String(o).trim() !== "");
  return {
    id: v.id != null ? String(v.id) : null,
    title: v.title || options.join(" / ") || "Default",
    options,
    option1: v.option1 || null,
    option2: v.option2 || null,
    option3: v.option3 || null,
    sku: v.sku || null,
    price: v.price != null ? String(v.price) : null,
    compare_at_price: v.compare_at_price != null ? String(v.compare_at_price) : null,
    inventory_quantity: v.inventory_quantity != null ? Number(v.inventory_quantity) : null,
    currency: currency || null,
  };
}

/**
 * @param {Request} request
 * @param {object} env
 */
export async function handleAdminCreationsShopifyProductDetail(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const url = new URL(request.url);
  const productIdRaw = url.searchParams.get("product_id") || url.searchParams.get("id") || "";
  const productId = normalizeShopifyProductId(productIdRaw);
  if (!productId) {
    return json({ ok: false, error: "product_id_required" }, 400, cors);
  }

  const shopDomain = shopDomainFromEnv(env);

  try {
    const response = await shopifyAPI(env, shopDomain, `products/${productId}.json`, {
      method: "GET",
    });
    const p = response?.product;
    if (!p) {
      return json({ ok: false, error: "product_not_found" }, 404, cors);
    }

    let metafieldsRaw = [];
    try {
      const mfRes = await shopifyAPI(env, shopDomain, `products/${productId}/metafields.json?limit=250`, {
        method: "GET",
      });
      metafieldsRaw = mfRes?.metafields || [];
    } catch (mfErr) {
      console.warn("[admin-creations-shopify-product-detail] metafields:", mfErr?.message || mfErr);
    }

    const shopifyMetafields = normalizeShopifyMetafields(metafieldsRaw);
    const productKeyMf = shopifyMetafields.find((m) => m.namespace === "custom" && m.key === "product_key");
    const productKey = String(productKeyMf?.value || "").trim() || String(p.handle || "").trim();

    const dbMetafields = await loadDbMetafieldsForProductKey(env, productKey);
    const metafieldCategories = categorizeMetafields(shopifyMetafields, dbMetafields);

    const currency =
      p.variants?.[0]?.presentment_prices?.[0]?.price?.currency_code ||
      env.SHOPIFY_CURRENCY ||
      "EUR";

    const mockups = buildSortedMockups(p.images || []);

    return json(
      {
        ok: true,
        product: {
          id: String(p.id),
          title: p.title || "",
          handle: p.handle || "",
          product_type: p.product_type || "",
          vendor: p.vendor || "",
          status: p.status || "",
          tags:
            typeof p.tags === "string"
              ? p.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              : p.tags || [],
          product_key: productKey || null,
          is_gift_card: Boolean(p.gift_card),
          currency,
          options: (p.options || []).map((o) => ({
            id: o.id,
            name: o.name,
            position: o.position,
            values: o.values || [],
          })),
          variants: (p.variants || []).map((v) => mapVariant(v, currency)),
          mockups,
          metafields: metafieldCategories,
        },
      },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-shopify-product-detail]", err);
    const status = err?.status === 404 ? 404 : 500;
    return json(
      { ok: false, error: status === 404 ? "product_not_found" : "shopify_fetch_failed", message: err?.message },
      status,
      cors
    );
  }
}
