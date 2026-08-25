/**
 * Creations Admin — Shopify product detail (mockups, variants, metafields).
 * GET ?op=admin-creations-shopify-product-detail&product_id=…
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { shopifyAPI } from "../../utils/shopify.js";
import { parseMetafieldValue } from "../admin/shopifyCatalogMetafieldSpec.js";
import { shopDomainFromEnv, normalizeShopifyProductId } from "./adminCreationsShopifyList.js";
import { resolveShopifyProductIdFromAdminRef } from "./adminCreationsResolveProductId.js";

/** Preferred view order for mockup sorting (unknown views sort after). */
export const MOCKUP_VIEW_ORDER = {
  front: 0,
  back: 1,
  "front-collar-closeup": 2,
  sleeve: 3,
  left: 4,
  right: 5,
  folded: 6,
  folded_2: 7,
  lifestyle: 8,
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
  if (parts.length >= 2) {
    return {
      color: parts[0].trim(),
      view: parts[1].trim().toLowerCase(),
      isPreview: parts.length >= 3 && String(parts[2] || "").trim().toLowerCase() === "preview-default",
    };
  }
  const lower = alt.toLowerCase();
  const views = ["folded_2", "folded", "lifestyle", "front", "back", "left", "right", "sleeve"];
  for (const view of views) {
    const re = new RegExp(`(?:^|[\\s_-])${view}(?:$|[\\s_-])`, "i");
    if (re.test(lower) || lower.endsWith(view)) {
      return { color: "", view, isPreview: view === "front" };
    }
  }
  return null;
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
 * Color from Shopify image.variant_ids → product variant option1 (Printify sync often
 * attaches size variants of one color). Used when alt text was wiped by a republish.
 * @param {{ variant_ids?: *[] }|string} img
 * @param {Map<string, string>|null|undefined} colorByVariantId
 */
export function inferMockupColorFromVariantIds(img, colorByVariantId) {
  if (!colorByVariantId || !colorByVariantId.size) return null;
  const vids = Array.isArray(img?.variant_ids) ? img.variant_ids.map(String) : [];
  for (const id of vids) {
    const color = colorByVariantId.get(id);
    if (color) return color;
  }
  return null;
}

/**
 * @param {Array<{ id?: *, option1?: string|null }>|null|undefined} variants
 * @returns {Map<string, string>}
 */
export function buildColorByVariantIdMap(variants) {
  const map = new Map();
  for (const v of Array.isArray(variants) ? variants : []) {
    if (v?.id == null) continue;
    const color = String(v.option1 || "").trim();
    if (color) map.set(String(v.id), color);
  }
  return map;
}

/**
 * View key from Printify camera_label on CDN URL (Shopify file URLs usually lack this).
 * @param {string} src
 */
export function inferMockupViewFromSrc(src) {
  if (!src || typeof src !== "string") return null;
  try {
    const u = new URL(src);
    const cam = u.searchParams.get("camera_label");
    if (cam) {
      return String(cam)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    }
  } catch {
    /* ignore */
  }
  const lower = src.toLowerCase();
  if (lower.includes("folded-2") || lower.includes("folded_2")) return "folded_2";
  if (lower.includes("folded")) return "folded";
  if (lower.includes("lifestyle")) return "lifestyle";
  if (/[?&]camera_label=back\b/i.test(src) || /\/back[_-]/i.test(src)) return "back";
  if (/[?&]camera_label=front\b/i.test(src) || /\/front[_-]/i.test(src)) return "front";
  return null;
}

/**
 * Build mockup list from Shopify images, sorted by variant (color) then view.
 * Falls back to variant_ids→option1 and URL camera_label when Printify republish
 * wiped Color|view alt texts (Admin Mockups would otherwise show Unassigned/other).
 *
 * @param {Array<{ id?: *, src?: string, alt?: string|null, position?: number, variant_ids?: *[] }>} images
 * @param {{ variants?: Array<{ id?: *, option1?: string|null }> }|Array} [variantsOrOpts]
 */
export function buildSortedMockups(images, variantsOrOpts = null) {
  const opts = Array.isArray(variantsOrOpts)
    ? { variants: variantsOrOpts }
    : variantsOrOpts && typeof variantsOrOpts === "object"
      ? variantsOrOpts
      : {};
  const colorByVariantId = buildColorByVariantIdMap(opts.variants);

  const list = (Array.isArray(images) ? images : []).map((img, index) => {
    const src = typeof img === "string" ? img : img?.src || "";
    const alt = typeof img === "string" ? null : img?.alt || null;
    const parsed = parseMockupAlt(alt);
    const fromVariants = inferMockupColorFromVariantIds(img, colorByVariantId);
    const fromSrc = inferMockupViewFromSrc(src);
    // Prefer Shopify variant_ids→option1 over alt color — alts can be wrong after
    // cross-color orphan matching bugs (Softstyle White|back on a Red mockup).
    const variantLabel = fromVariants || parsed?.color || "Unassigned";
    const view = parsed?.view || fromSrc || "other";
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
  const resolved = await resolveShopifyProductIdFromAdminRef(env, productIdRaw);
  if (!resolved.ok) {
    const status =
      resolved.error === "studio_listing_not_found" || resolved.error === "studio_listing_not_on_shopify"
        ? 404
        : 400;
    return json(
      {
        ok: false,
        error: resolved.error || "product_id_required",
        studio_listing_id: resolved.studio_listing_id,
      },
      status,
      cors
    );
  }
  const productId = resolved.shopify_product_id;
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

    let mockups = buildSortedMockups(p.images || [], { variants: p.variants || [] });
    const providerMf = shopifyMetafields.find((m) => m.namespace === "custom" && m.key === "provider");
    const isTodifyListing =
      String(providerMf?.value || "")
        .trim()
        .toLowerCase() === "todify" || String(productKey || "").toLowerCase().includes("todify");
    const providerVal = String(providerMf?.value || "")
      .trim()
      .toLowerCase();
    const isSpreadconnectListing =
      providerVal === "spreadconnect_eu" ||
      providerVal === "spreadconnect" ||
      String(p.vendor || "").trim().toLowerCase() === "spreadconnect" ||
      String(p.handle || "")
        .trim()
        .toLowerCase()
        .startsWith("spreadconnect-");
    const hasViewAlts = mockups.some((m) => m.view && m.view !== "other" && m.alt && String(m.alt).includes("|"));
    if (isTodifyListing && (!mockups.length || !hasViewAlts) && productKey) {
      try {
        const {
          loadTodifyCleanCatalogMocks,
          ensureTodifyFrontIsDefaultMock,
        } = await import("../publish/todifyCatalogMocks.js");
        await ensureTodifyFrontIsDefaultMock(env, productKey);
        const catalogMocks = await loadTodifyCleanCatalogMocks(env, productKey);
        if (catalogMocks.length) {
          const fromCatalog = catalogMocks.map((m, index) => ({
            id: `catalog-${index}`,
            src: m.image_url,
            alt: `${m.color_name}|${m.view_key}${m.view_key === "front" ? "|preview-default" : ""}`,
            variant_label: m.color_name || "Default",
            view: m.view_key || "other",
            is_preview: String(m.view_key || "") === "front",
            position: index + 1,
            variant_ids: [],
          }));
          mockups = buildSortedMockups(
            fromCatalog.map((m) => ({
              id: m.id,
              src: m.src,
              alt: m.alt,
              position: m.position,
              variant_ids: [],
            })),
            { variants: p.variants || [] }
          );
        }
      } catch (catErr) {
        console.warn("[admin-creations-shopify-product-detail] catalog mocks:", catErr?.message || catErr);
      }
    }

    let channels = null;
    if (productKey) {
      try {
        const { getProductChannelsConfig } = await import("../catalog/productChannelsConfig.js");
        const chRes = await getProductChannelsConfig(env, productKey);
        if (chRes?.ok) {
          channels = {
            unlocks: chRes.channels,
            amazon_market_codes: chRes.amazon_market_codes,
            amazon_market_groups: chRes.amazon_market_groups,
            amazon_publish_targets: chRes.amazon_publish_targets,
            marketplace_ids: chRes.marketplace_ids,
          };
        }
      } catch (chErr) {
        console.warn("[admin-creations-shopify-product-detail] channels:", chErr?.message || chErr);
      }
    }

    let published_design_id = null;
    let design_id = null;
    let amazon_publish = null;
    try {
      const {
        resolvePublishedDesignForAdminAmazon,
        loadDryRunResult,
        loadAmazonAdminListingSummary,
      } = await import("../product/amazonAdminPublish.js");
      const resolved = await resolvePublishedDesignForAdminAmazon(env, {
        shopify_product_id: String(p.id),
        product_key: productKey,
      });
      if (resolved.ok) {
        published_design_id = resolved.entry.id;
        design_id = resolved.entry.design_id != null ? Number(resolved.entry.design_id) : null;
        const dry = await loadDryRunResult(env, published_design_id);
        const listingSummary = await loadAmazonAdminListingSummary(env, published_design_id);
        amazon_publish = {
          published_design_id,
          design_id,
          continents: listingSummary.continents || {},
          listings: (listingSummary.listings || []).map((row) => ({
            marketplace_id: row.marketplace_id,
            amazon_sku: row.amazon_sku,
            status: row.status,
            asin: row.asin || null,
            verified_status: row.verified_status || null,
            feed_id: row.feed_id || null,
            last_error: row.last_error || null,
            updated_at: row.updated_at || null,
          })),
          dry_run: dry
            ? {
                ok: !!dry.ok,
                mode: dry.mode,
                summary: dry.summary || null,
                saved_at: dry.saved_at || null,
                marketplaces: (dry.marketplaces || []).map((m) => ({
                  ok: m.ok,
                  code: m.code,
                  continent: m.continent,
                  errors: m.errors || [],
                  credentials: m.credentials
                    ? { ok: !!m.credentials.ok, error: m.credentials.error || null }
                    : undefined,
                })),
              }
            : null,
        };
      }
    } catch (pdErr) {
      console.warn("[admin-creations-shopify-product-detail] amazon publish lookup:", pdErr?.message || pdErr);
    }

    let printifyProductId = null;
    let printProviderId = null;
    let variantConfig = null;
    let printifyProductData = null;
    let livePrintifyProductData = null;
    let isTodifyListingResolved = isTodifyListing;

    try {
      const printifyMf = shopifyMetafields.find((m) => m.namespace === "custom" && m.key === "printify_product_id");
      printifyProductId = String(printifyMf?.value || "").trim() || null;
    } catch (_) {}

    if (productKey && env.CATALOG_DB) {
      try {
        const profileRow = await env.CATALOG_DB.prepare(
          `SELECT print_provider_id, product_data_json, source_product_id
           FROM product_publish_profiles
           WHERE product_key = ? AND COALESCE(is_active, 1) = 1
           ORDER BY updated_at DESC
           LIMIT 1`
        )
          .bind(productKey)
          .first();
        if (profileRow?.print_provider_id != null) {
          printProviderId = Number(profileRow.print_provider_id);
        }
        if (!printifyProductId && profileRow?.source_product_id) {
          printifyProductId = String(profileRow.source_product_id).trim() || null;
        }
        if (profileRow?.product_data_json) {
          try {
            printifyProductData = JSON.parse(String(profileRow.product_data_json));
          } catch (_) {}
        }
      } catch (profErr) {
        console.warn("[admin-creations-shopify-product-detail] publish profile:", profErr?.message || profErr);
      }
    }

    if (published_design_id && !printifyProductId && env.CREATOR_DB) {
      try {
        const pdRow = await env.CREATOR_DB.prepare(
          `SELECT printify_product_id FROM published_designs WHERE id = ? LIMIT 1`
        )
          .bind(published_design_id)
          .first();
        if (pdRow?.printify_product_id) {
          printifyProductId = String(pdRow.printify_product_id).trim() || null;
        }
      } catch (_) {}
    }

    if (productKey && printProviderId && env.CREATOR_DB) {
      try {
        const cfgRow = await env.CREATOR_DB.prepare(
          `SELECT config_json FROM product_variant_config
           WHERE product_key = ? AND print_provider_id = ?
           LIMIT 1`
        )
          .bind(productKey, printProviderId)
          .first();
        if (cfgRow?.config_json) {
          variantConfig = JSON.parse(String(cfgRow.config_json));
        }
      } catch (cfgErr) {
        console.warn("[admin-creations-shopify-product-detail] variant config:", cfgErr?.message || cfgErr);
      }
    }

    if (productKey && printProviderId && env.CREATOR_DB) {
      try {
        const tmplRow = await env.CREATOR_DB.prepare(
          `SELECT product_data_json, variants_product_data_json
           FROM printify_template_metadata
           WHERE product_key = ? AND print_provider_id = ?
             AND (variants_product_data_json IS NOT NULL OR product_data_json IS NOT NULL)
           ORDER BY updated_at DESC
           LIMIT 1`
        )
          .bind(productKey, printProviderId)
          .first();
        const snapRaw =
          tmplRow?.variants_product_data_json != null && String(tmplRow.variants_product_data_json).trim() !== ""
            ? tmplRow.variants_product_data_json
            : tmplRow?.product_data_json;
        if (snapRaw) {
          try {
            printifyProductData = JSON.parse(String(snapRaw));
          } catch (_) {}
        }
      } catch (tmplErr) {
        console.warn("[admin-creations-shopify-product-detail] template metadata:", tmplErr?.message || tmplErr);
      }
    }

    if (printifyProductId && env.PRINTIFY_API_KEY && !isTodifyListingResolved) {
      try {
        const { getPrintifyProduct } = await import("../../utils/printify.js");
        livePrintifyProductData = await getPrintifyProduct(env, printifyProductId);
      } catch (livePfErr) {
        console.warn(
          "[admin-creations-shopify-product-detail] live printify fetch:",
          livePfErr?.message || livePfErr
        );
      }
    }

    if (isSpreadconnectListing) {
      printifyProductId = null;
    }

    const shopifyVariants = (p.variants || []).map((v) => mapVariant(v, currency));
    const shopifyOptions = (p.options || []).map((o) => ({
      id: o.id,
      name: o.name,
      position: o.position,
      values: o.values || [],
    }));

    let variant_groups = [];
    let live_channels = [];
    try {
      const { buildVariantGroupsForProductDetail, buildLiveChannelsForVariantUpdate } = await import(
        "./adminCreationsVariantGroups.js"
      );
      variant_groups = buildVariantGroupsForProductDetail({
        shopifyVariants,
        shopifyOptions,
        mockups,
        variantConfig: isSpreadconnectListing ? null : variantConfig,
        printifyProductData: isSpreadconnectListing ? null : printifyProductData,
        livePrintifyProductData: isSpreadconnectListing ? null : livePrintifyProductData,
      });
      live_channels = buildLiveChannelsForVariantUpdate({
        printifyProductId: isSpreadconnectListing ? null : printifyProductId,
        isTodify: isTodifyListingResolved || isSpreadconnectListing,
        amazonPublish: amazon_publish,
        shopifyProductId: String(p.id),
      });
    } catch (vgErr) {
      console.warn("[admin-creations-shopify-product-detail] variant groups:", vgErr?.message || vgErr);
    }

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
          published_design_id,
          design_id,
          amazon_publish,
          printify_product_id: printifyProductId,
          print_provider_id: printProviderId,
          variant_config: variantConfig,
          variant_groups,
          live_channels,
          is_todify: isTodifyListingResolved,
          is_spreadconnect: isSpreadconnectListing,
          is_gift_card: Boolean(p.gift_card),
          currency,
          options: shopifyOptions,
          variants: shopifyVariants,
          mockups,
          metafields: metafieldCategories,
          channels,
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
