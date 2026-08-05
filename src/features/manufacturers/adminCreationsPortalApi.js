/**
 * Creations admin portal API helpers — proxied through partner worker with admin session.
 */

import { json, getCorsHeaders } from "../../utils/response.js";
import { CAT_REVERSE, buildCategoryTree } from "../admin/catalogConstants.js";
import {
  shopDomainFromEnv,
  fetchShopifyProductNodesMatching,
  fetchShopifyProductNodesByIds,
  mapShopifyNodeToProduct,
  loadCustomerStudioShopifyIds,
  loadPublishedDesignsShopifyIndex,
  isCustomerStudioShopifyProduct,
  isPrintifySourcedProduct,
  isShopifyResidualProduct,
  isTodifyPartnerShopifyProduct,
  isSampleShopifyProduct,
  normalizeShopifyProductId,
  indexShopifyNodesById,
  NATIVE_SHOPIFY_STORE_QUERY,
} from "./adminCreationsShopifyList.js";
import {
  enrichCreationsProductListFacets,
  buildProductFilterFacets,
} from "./adminCreationsProductListEnrich.js";
import {
  classifyPrintifyListingStatusFromRow,
  ensurePrintifyListingStatusColumn,
  extractPrintifyMockUrls,
  parsePrintifyImagesJson,
  persistPrintifyListingSnapshot,
} from "../publish/printifyListingStatus.js";

/**
 * Resolve real Shopify product ids from D1 when list rows carry a stale / wrong
 * shopify_product_id (e.g. customer id) or only a Printify / design id.
 * @param {object} env
 * @param {Array<object>} products
 * @returns {Promise<Map<string, string>>} key `pf:<printifyId>` or `design:<designId>` → shopify id
 */
async function resolveShopifyIdsFromPublishedDesigns(env, products) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!env?.CREATOR_DB) return out;

  const printifyIds = [
    ...new Set(
      (products || [])
        .map((p) => String(p?.printify_product_id || "").trim())
        .filter(Boolean)
    ),
  ];
  const designIds = [
    ...new Set(
      (products || [])
        .map((p) => String(p?.design_id || "").trim())
        .filter((id) => /^\d+$/.test(id))
    ),
  ];
  if (!printifyIds.length && !designIds.length) return out;

  const CHUNK = 80;
  for (let i = 0; i < printifyIds.length; i += CHUNK) {
    const chunk = printifyIds.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    try {
      const res = await env.CREATOR_DB.prepare(
        `SELECT design_id, printify_product_id, shopify_product_id
         FROM published_designs
         WHERE TRIM(CAST(printify_product_id AS TEXT)) IN (${ph})
           AND shopify_product_id IS NOT NULL
           AND TRIM(CAST(shopify_product_id AS TEXT)) != ''`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        const pid = String(row.printify_product_id || "").trim();
        if (sid && pid && !out.has(`pf:${pid}`)) out.set(`pf:${pid}`, sid);
        const did = String(row.design_id ?? "").trim();
        if (sid && did && !out.has(`design:${did}`)) out.set(`design:${did}`, sid);
      }
    } catch (e) {
      console.warn("[ensureShopifyNodes] printify→shopify resolve failed:", e?.message || e);
    }
  }

  const missingDesigns = designIds.filter((id) => !out.has(`design:${id}`));
  for (let i = 0; i < missingDesigns.length; i += CHUNK) {
    const chunk = missingDesigns.slice(i, i + CHUNK);
    const ph = chunk.map(() => "?").join(",");
    try {
      const res = await env.CREATOR_DB.prepare(
        `SELECT design_id, printify_product_id, shopify_product_id
         FROM published_designs
         WHERE CAST(design_id AS TEXT) IN (${ph})
           AND shopify_product_id IS NOT NULL
           AND TRIM(CAST(shopify_product_id AS TEXT)) != ''`
      )
        .bind(...chunk)
        .all();
      for (const row of res?.results || []) {
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        const did = String(row.design_id ?? "").trim();
        if (sid && did && !out.has(`design:${did}`)) out.set(`design:${did}`, sid);
        const pid = String(row.printify_product_id || "").trim();
        if (sid && pid && !out.has(`pf:${pid}`)) out.set(`pf:${pid}`, sid);
      }
    } catch (e) {
      console.warn("[ensureShopifyNodes] design→shopify resolve failed:", e?.message || e);
    }
  }

  return out;
}

/**
 * Merge caller-supplied Shopify nodes with any missing ids looked up via `nodes(ids:)`.
 * Customer / Studio Softstyle rows often:
 *   - never went through a products() scan, or
 *   - store a wrong shopify_product_id (customer id) while printify_product_id is correct
 * Without a real Product node, enrich shows variant_count=0, metafields=0, Default alts.
 *
 * Mutates `product.shopify_product_id` when a better id is resolved from D1 so enrich
 * can look up the node.
 *
 * @param {object} env
 * @param {Array<object>} products
 * @param {Map<string, object>|null|undefined} nodesByShopifyId
 * @returns {Promise<Map<string, object>>}
 */
export async function ensureShopifyNodesForProductList(env, products, nodesByShopifyId = null) {
  const map =
    nodesByShopifyId instanceof Map
      ? new Map(nodesByShopifyId)
      : indexShopifyNodesById(Object.values(nodesByShopifyId || {}));
  const list = Array.isArray(products) ? products : [];

  const missing = [];
  for (const product of list) {
    const sid = normalizeShopifyProductId(product?.shopify_product_id || product?.id);
    if (!sid || map.has(sid)) continue;
    missing.push(sid);
  }
  if (missing.length) {
    const fetched = await fetchShopifyProductNodesByIds(env, missing);
    for (const node of fetched) {
      const sid = normalizeShopifyProductId(node?.id);
      if (sid) map.set(sid, node);
    }
  }

  // Rows still without a node: invalid shopify id (customer id) or studio-only id.
  const unresolved = list.filter((p) => {
    const sid = normalizeShopifyProductId(p?.shopify_product_id || p?.id);
    return !sid || !map.has(sid);
  });
  if (!unresolved.length) return map;

  const resolved = await resolveShopifyIdsFromPublishedDesigns(env, unresolved);
  const extraSids = [];
  for (const product of unresolved) {
    const pid = String(product?.printify_product_id || "").trim();
    const did = String(product?.design_id || "").trim();
    const sid =
      (pid && resolved.get(`pf:${pid}`)) ||
      (did && resolved.get(`design:${did}`)) ||
      "";
    if (!sid) continue;
    product.shopify_product_id = sid;
    if (!map.has(sid)) extraSids.push(sid);
  }
  if (extraSids.length) {
    const fetched = await fetchShopifyProductNodesByIds(env, extraSids);
    for (const node of fetched) {
      const sid = normalizeShopifyProductId(node?.id);
      if (sid) map.set(sid, node);
    }
  }
  return map;
}

/**
 * Enrich + facet-bucket a product list for the Products page (filter sidebar, "Needs
 * Update" badge, bulk eligibility). Pass `nodesByShopifyId` (see indexShopifyNodesById)
 * when the caller already fetched raw Shopify GraphQL nodes. Any product with a
 * shopify_product_id still missing from that map is fetched automatically.
 * @param {object} env
 * @param {Array<object>} products
 * @param {{ nodesByShopifyId?: Map<string, object>|null }} [opts]
 */
export async function finalizeProductList(env, products, { nodesByShopifyId = null } = {}) {
  const nodesMap = await ensureShopifyNodesForProductList(env, products, nodesByShopifyId);
  const enriched = await enrichCreationsProductListFacets(env, products, nodesMap);
  const facets = buildProductFilterFacets(enriched);
  return { products: enriched, facets };
}

/** Default/max page size for Creations Products buckets (D1 has ~1k+ Shopify-linked rows). */
const PRODUCT_LIST_DEFAULT_LIMIT = 2500;
const PRODUCT_LIST_MAX_LIMIT = 5000;

function parseProductListLimit(url, { defaultLimit = PRODUCT_LIST_DEFAULT_LIMIT } = {}) {
  return Math.min(
    PRODUCT_LIST_MAX_LIMIT,
    Math.max(1, Number(url?.searchParams?.get("limit")) || defaultLimit)
  );
}

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

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function inferViewFromUrl(url, fallback) {
  const s = String(url || "").toLowerCase();
  if (/(^|[^a-z])back([^a-z]|$)|[_/-]back[_./-]/.test(s)) return "back";
  if (/(^|[^a-z])front([^a-z]|$)|[_/-]front[_./-]/.test(s)) return "front";
  return fallback || "front";
}

export function buildAdminGridViews({ previewUrl, mockUrlsJson, previewMockIndex } = {}) {
  const urls = [];
  const seen = new Set();
  function push(url, view, isPreview) {
    const src = String(url || "").trim();
    if (!src || seen.has(src.split("?")[0])) return;
    seen.add(src.split("?")[0]);
    urls.push({
      src,
      view: view || inferViewFromUrl(src, urls.length === 0 ? "front" : `view ${urls.length + 1}`),
      variant_label: "Default",
      is_preview: !!isPreview,
    });
  }
  const rawMockUrls = parseJsonArray(mockUrlsJson);
  const pIndex = Number(previewMockIndex);
  rawMockUrls.forEach((url, idx) => {
    push(url, inferViewFromUrl(url, idx === 0 ? "front" : idx === 1 ? "back" : `view ${idx + 1}`), idx === pIndex);
  });
  push(previewUrl, inferViewFromUrl(previewUrl, "front"), !urls.some((x) => x.is_preview));
  if (!urls.length && previewUrl) push(previewUrl, "front", true);
  return urls;
}

function parsePlacementJson(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function attachDesignOverlayToGridViews(views, designUrl, placementJson) {
  const url = String(designUrl || "").trim();
  if (!url || !Array.isArray(views) || !views.length) return views;
  const parsed = parsePlacementJson(placementJson);
  const target = String(parsed?.printify_position || "front").trim().toLowerCase().replace(/\s+/g, "_");
  const placement = parsed?.placement && typeof parsed.placement === "object" ? parsed.placement : {};
  const zoneRaw = placement.zone_frac && typeof placement.zone_frac === "object" ? placement.zone_frac : {};
  const zone = {
    l: Number.isFinite(Number(zoneRaw.l)) ? Number(zoneRaw.l) : 0.28,
    t: Number.isFinite(Number(zoneRaw.t)) ? Number(zoneRaw.t) : 0.22,
    w: Number.isFinite(Number(zoneRaw.w)) ? Number(zoneRaw.w) : 0.44,
    h: Number.isFinite(Number(zoneRaw.h)) ? Number(zoneRaw.h) : 0.48,
  };
  return views.map((view) => {
    const viewKey = String(view.view || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (viewKey !== target) return view;
    return {
      ...view,
      design_url: url,
      design_placement: {
        x: Number.isFinite(Number(placement.x)) ? Number(placement.x) : 0.5,
        y: Number.isFinite(Number(placement.y)) ? Number(placement.y) : 0.5,
        scale: Number.isFinite(Number(placement.scale)) ? Number(placement.scale) : 0.95,
        angle: Number.isFinite(Number(placement.angle)) ? Number(placement.angle) : 0,
        zone,
      },
    };
  });
}

async function loadDirectShopifyProductKeySet(env, keys) {
  const clean = [...new Set((keys || []).map((k) => String(k || "").trim()).filter(Boolean))];
  const out = new Set();
  if (!env?.CATALOG_DB || !clean.length) return out;
  const placeholders = clean.map(() => "?").join(",");
  try {
    const rows = await env.CATALOG_DB.prepare(
      `SELECT DISTINCT product_key
       FROM product_publish_profiles
       WHERE product_key IN (${placeholders})
         AND LOWER(TRIM(source_system)) IN ('todify', 'direct_shopify')`
    )
      .bind(...clean)
      .all();
    for (const row of rows?.results || []) {
      if (row.product_key) out.add(String(row.product_key));
    }
  } catch (e) {
    console.warn("[admin-creations-products] direct key lookup:", e?.message);
  }
  return out;
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
  const limit = parseProductListLimit(url);
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
      maxScan: 10000,
      matchFn: (node) =>
        isPrintifySourcedProduct(node, printifyLinks, creatorPublishedIds) &&
        !isCustomerStudioShopifyProduct(node, customerStudioIds),
    });

    let products = nodes.map((node) => mapShopifyNodeToProduct(node, "printify", printifyLinks));

    products = await enrichPrintifyCategories(env, products);

    // Printify-only listings (not yet on Shopify) — still show with Printify mockups.
    try {
      if (!env.CREATOR_DB) throw new Error("creator_db_unavailable");
      await ensurePrintifyListingStatusColumn(env);
      const seenPrintify = new Set(
        products.map((p) => String(p.printify_product_id || "").trim()).filter(Boolean)
      );
      const seenShopify = new Set(
        products.map((p) => normalizeShopifyProductId(p.shopify_product_id || p.id)).filter(Boolean)
      );
      const pdRes = await env.CREATOR_DB.prepare(
        `SELECT id, design_id, owner_id, product_key, product_name, printify_product_id,
                shopify_product_id, shopify_completion_status, printify_listing_status,
                printify_images_json, visibility, updated_at
         FROM published_designs
         WHERE printify_product_id IS NOT NULL
           AND TRIM(CAST(printify_product_id AS TEXT)) != ''
           AND (
             shopify_product_id IS NULL
             OR TRIM(CAST(shopify_product_id AS TEXT)) = ''
             OR TRIM(CAST(shopify_product_id AS TEXT)) = '0'
           )
         ORDER BY COALESCE(updated_at, published_at, 0) DESC
         LIMIT ?`
      )
        .bind(limit)
        .all();

      let printifyMockFetches = 0;
      for (const row of pdRes?.results || []) {
        const pid = String(row.printify_product_id || "").trim();
        if (!pid || seenPrintify.has(pid)) continue;
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        if (sid && seenShopify.has(sid)) continue;
        let mocks = parsePrintifyImagesJson(row.printify_images_json);
        // Cap live fetches so list stays fast; persist mocks for next load.
        if (!mocks.length && env.PRINTIFY_API_KEY && printifyMockFetches < 8) {
          printifyMockFetches += 1;
          try {
            const { getPrintifyProduct } = await import("../../utils/printify.js");
            const live = await getPrintifyProduct(env, pid);
            mocks = extractPrintifyMockUrls(live);
            if (live) {
              await persistPrintifyListingSnapshot(env, row.id, { printifyProduct: live, images: mocks });
            }
          } catch (fetchErr) {
            console.warn(
              "[admin-creations-printify-products] printify mock fetch:",
              fetchErr?.message || fetchErr
            );
          }
        }
        const status = classifyPrintifyListingStatusFromRow(row) || "unpublished";
        const title = String(row.product_name || row.product_key || `Printify ${pid}`).trim();
        products.push({
          id: `printify-only:${row.id}`,
          product_key: String(row.product_key || row.id),
          title,
          preview_url: mocks[0] || null,
          images: mocks,
          category: "Printify (not on Shopify)",
          owner_id: String(row.owner_id || ""),
          owner_label: row.owner_id ? `Owner ${row.owner_id}` : "Admin",
          shopify_product_id: null,
          printify_product_id: pid,
          is_active: 0,
          source: "printify",
          source_label: "Printify",
          design_id: row.design_id != null ? String(row.design_id) : null,
          published_design_id: row.id != null ? Number(row.id) : null,
          shopify_completion_status: row.shopify_completion_status || "pending_shopify",
          printify_status: status,
          printify_listing_status: row.printify_listing_status || status,
          listing_origin: "printify_only",
        });
        seenPrintify.add(pid);
      }
    } catch (pdErr) {
      console.warn("[admin-creations-printify-products] printify-only rows:", pdErr?.message || pdErr);
    }

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
    const { products: finalProducts, facets } = await finalizeProductList(env, products, {
      nodesByShopifyId: indexShopifyNodesById(nodes),
    });
    return json(
      {
        ok: true,
        products: finalProducts,
        total: finalProducts.length,
        category_tree,
        source: "printify",
        facets,
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

  const url = new URL(request.url);
  const limit = parseProductListLimit(url, { defaultLimit: PRODUCT_LIST_DEFAULT_LIMIT });
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const products = [];
    const seen = new Set();

    const studioRes = await env.CUSTOMER_DB.prepare(
      `SELECT id, customer_id, product_key, product_title, printify_product_id,
              shopify_product_id, shopify_completion_status, preview_url, mock_urls_json,
              preview_mock_index, design_url, placement_json, updated_at
       FROM shop_studio_listings
       WHERE listing_origin = 'shop' OR listing_origin IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    const directKeys = await loadDirectShopifyProductKeySet(
      env,
      (studioRes?.results || []).map((row) => row.product_key)
    );

    for (const row of studioRes?.results || []) {
      const st = String(row.shopify_completion_status || "").trim().toLowerCase();
      if (st === "cancelled" || st === "failed") continue;
      if (directKeys.has(String(row.product_key || "").trim())) continue;
      const key = `studio:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = String(row.product_title || row.product_key || `Studio #${row.id}`).trim();
      const preview = row.preview_url || null;
      const gridViews = attachDesignOverlayToGridViews(buildAdminGridViews({
        previewUrl: preview,
        mockUrlsJson: row.mock_urls_json,
        previewMockIndex: row.preview_mock_index,
      }), row.design_url, row.placement_json);
      products.push({
        id: String(row.id),
        product_key: String(row.product_key || row.id),
        title,
        preview_url: preview,
        images: gridViews.length ? gridViews.map((v) => v.src) : preview ? [preview] : [],
        grid_views: gridViews,
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

    const cpDirectKeys = await loadDirectShopifyProductKeySet(
      env,
      (cpRes?.results || []).map((row) => row.product_key)
    );

    for (const row of cpRes?.results || []) {
      if (cpDirectKeys.has(String(row.product_key || "").trim())) continue;
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

    const { products: finalProducts, facets } = await finalizeProductList(env, filtered);
    return json(
      { ok: true, products: finalProducts, total: finalProducts.length, source: "customer", facets },
      200,
      cors
    );
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
  const limit = parseProductListLimit(url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const { printifyLinks } = await loadPublishedDesignsShopifyIndex(env);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      maxScan: 10000,
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

    const { products: finalProducts, facets } = await finalizeProductList(env, products, {
      nodesByShopifyId: indexShopifyNodesById(nodes),
    });
    return json(
      { ok: true, products: finalProducts, total: finalProducts.length, source: "shopify", facets },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-shopify-products]", err);
    return json({ ok: false, error: err?.message || "shopify_fetch_failed" }, 500, cors);
  }
}

/** Todify = partner-direct Shopify listings, including direct Shop Studio customer rows. */
export async function handleAdminCreationsTodifyProducts(request, env) {
  const cors = getCorsHeaders(request);
  if (!env.SHOPIFY_ACCESS_TOKEN) {
    return json({ ok: false, error: "shopify_not_configured" }, 503, cors);
  }

  const url = new URL(request.url);
  const limit = parseProductListLimit(url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const [customerStudioIds, { printifyLinks }] = await Promise.all([
      loadCustomerStudioShopifyIds(env),
      loadPublishedDesignsShopifyIndex(env),
    ]);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      maxScan: 10000,
      matchFn: (node) => isTodifyPartnerShopifyProduct(node),
    });

    let products = nodes.map((node) => {
      const row = mapShopifyNodeToProduct(node, "todify", printifyLinks);
      if (isCustomerStudioShopifyProduct(node, customerStudioIds)) {
        row.origin_label = "Customer";
        row.listing_origin = row.listing_origin || "shop";
      } else if (!row.origin_label) {
        row.origin_label = "Creator";
        row.listing_origin = row.listing_origin || "creator";
      }
      return row;
    });
    const seenProductIds = new Set(
      products
        .map((p) => normalizeShopifyProductId(p.shopify_product_id || p.id))
        .filter(Boolean)
    );

    if (env.CUSTOMER_DB) {
      const studioRows = await env.CUSTOMER_DB.prepare(
        `SELECT id, customer_id, product_key, product_title, printify_product_id,
                shopify_product_id, shopify_completion_status, preview_url, mock_urls_json,
                preview_mock_index, design_url, placement_json, updated_at
         FROM shop_studio_listings
         WHERE listing_origin = 'shop' OR listing_origin IS NULL
         ORDER BY updated_at DESC
         LIMIT ?`
      )
        .bind(limit)
        .all()
        .catch(() => ({ results: [] }));
      const directKeys = await loadDirectShopifyProductKeySet(
        env,
        (studioRows?.results || []).map((row) => row.product_key)
      );
      for (const row of studioRows?.results || []) {
        const st = String(row.shopify_completion_status || "").trim().toLowerCase();
        if (st === "cancelled" || st === "failed") continue;
        if (!directKeys.has(String(row.product_key || "").trim())) continue;
        const sid = normalizeShopifyProductId(row.shopify_product_id);
        if (sid && seenProductIds.has(sid)) continue;
        const preview = row.preview_url || null;
        const gridViews = attachDesignOverlayToGridViews(buildAdminGridViews({
          previewUrl: preview,
          mockUrlsJson: row.mock_urls_json,
          previewMockIndex: row.preview_mock_index,
        }), row.design_url, row.placement_json);
        products.push({
          id: sid || `studio:${row.id}`,
          product_key: String(row.product_key || row.id),
          title: String(row.product_title || row.product_key || `Todify Studio #${row.id}`).trim(),
          preview_url: preview,
          images: gridViews.length ? gridViews.map((v) => v.src) : preview ? [preview] : [],
          grid_views: gridViews,
          category: "Shop Design Studio",
          owner_id: String(row.customer_id || ""),
          owner_label: row.customer_id ? `Customer ${row.customer_id}` : "Customer",
          shopify_product_id: sid || null,
          printify_product_id: row.printify_product_id || null,
          is_active: studioStatusToIsActive(row.shopify_completion_status),
          source: "todify",
          source_label: "Todify",
          listing_origin: "shop",
          origin_label: "Customer",
        });
        if (sid) seenProductIds.add(sid);
      }
    }

    if (q) {
      products = products.filter((p) =>
        [p.title, p.product_key, p.category, p.vendor, p.provider, p.source_label, p.origin_label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    const { products: finalProducts, facets } = await finalizeProductList(env, products, {
      nodesByShopifyId: indexShopifyNodesById(nodes),
    });
    return json(
      { ok: true, products: finalProducts, total: finalProducts.length, source: "todify", facets },
      200,
      cors
    );
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
  const limit = parseProductListLimit(url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const [customerStudioIds, { printifyLinks }] = await Promise.all([
      loadCustomerStudioShopifyIds(env),
      loadPublishedDesignsShopifyIndex(env),
    ]);

    const nodes = await fetchShopifyProductNodesMatching(env, {
      limit,
      maxScan: 10000,
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

    const { products: finalProducts, facets } = await finalizeProductList(env, products, {
      nodesByShopifyId: indexShopifyNodesById(nodes),
    });
    return json(
      { ok: true, products: finalProducts, total: finalProducts.length, source: "samples", facets },
      200,
      cors
    );
  } catch (err) {
    console.error("[admin-creations-samples-products]", err);
    return json({ ok: false, error: err?.message || "shopify_fetch_failed" }, 500, cors);
  }
}

export { shopDomainFromEnv };
