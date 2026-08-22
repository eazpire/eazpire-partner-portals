/**
 * Creations Portal Products — collapsible Product Filter sidebar (IDEA-063).
 * Tri-state switches: exclude (−1) / neutral (0) / include (1) — same logic as shop PLP filters.
 * Classic faceted search: option counts ignore the option's own section; count 0 → grayed / disabled.
 *
 * Count engine mirrors src/features/admin/adminCreationsProductFilters.js (unit-tested).
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";
import { openModal, closeModal } from "/creations/shared/js/partner-shell.js";
import { bindTriSwitches, facetSectionHtml as sharedFacetSectionHtml } from "./facet-tri-ui.js";
import { bindProdCarousels, productCarouselHtml } from "./designs-product-media.js";
import { TIME_RANGE_KEYS, TIME_RANGE_LABELS, timeRangeKeysForItem } from "./time-range-filter.js";

const INFO_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="5" r="1" fill="currentColor"/><path d="M8 7.25v4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function sectionInfoIconHtml(dataAttr, label) {
  return `<button type="button" class="cr-pf-section__info" ${dataAttr} aria-label="${escapeHtml(
    label
  )}" title="${escapeHtml(label)}">${INFO_ICON_SVG}</button>`;
}

const METAFIELDS_INFO_ICON = sectionInfoIconHtml("data-cr-pf-metafields-info", "Metafields overview");
const ALT_IMAGE_INFO_ICON = sectionInfoIconHtml("data-cr-pf-alt-info", "Alt image texts overview");

const STORAGE_KEY = "admin_creations_products_filter_collapsed";

/** Facet sections in display order. */
const SECTIONS = [
  { key: "time_range", label: "Time range" },
  { key: "category", label: "Category" },
  { key: "visibility", label: "Visibility" },
  { key: "source", label: "Source" },
  { key: "product", label: "Product" },
  { key: "provider", label: "Provider" },
  { key: "printify_status", label: "Printify Status" },
  { key: "channels", label: "Channels" },
  { key: "amazon_markets", label: "Amazon Markets" },
  { key: "amazon_status", label: "Amazon Status" },
  { key: "variants", label: "Variants" },
  { key: "catalogs", label: "Kataloge" },
  { key: "metafields", label: "Metafields" },
  { key: "alt_image_texts", label: "Alt Image Texts" },
  { key: "branding_white", label: "White Branding" },
  { key: "branding_black", label: "Black Branding" },
  { key: "needs_update", label: "Needs Update" },
];

const CATEGORY_EMPTY_KEY = "_empty";
const CATEGORY_EMPTY_LABEL = "Empty / not set";

const VISIBILITY_LABELS = {
  public: "Public",
  private: "Private",
};

const PRINTIFY_STATUS_LABELS = {
  published: "Published",
  unpublished: "Unpublished",
  unpublished_changes: "Unpublished Changes",
  publishing: "Publishing",
  error: "Error",
};

/** Exact-count facets — sort options numerically ascending. */
const NUMERIC_SECTIONS = new Set([
  "variants",
  "catalogs",
  "metafields",
  "branding_white",
  "branding_black",
]);

const SOURCE_LABELS = {
  product: "Product",
  customer: "Customer",
  samples: "Samples",
  other: "Other",
};

const PROVIDER_LABELS = {
  printify: "Printify",
  todify: "Todify",
};

/** Shopify Channels (same options as Shopify Admin + eazpire Headless). */
const CHANNEL_LABELS = {
  onlineshop: "eazpire Web",
  eazpire_headless: "eazpire Android",
  shop: "Shop",
  facebook_instagram: "Facebook & Instagram",
  google_youtube: "Google & YouTube",
  pinterest: "Pinterest",
};

const CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

/** Amazon Markets — parents then countries (amazon_na = Amazon US region). */
const AMAZON_MARKET_KEYS = [
  "amazon_eu",
  "amazon_de",
  "amazon_uk",
  "amazon_fr",
  "amazon_nl",
  "amazon_it",
  "amazon_es",
  "amazon_be",
  "amazon_pl",
  "amazon_se",
  "amazon_ie",
  "amazon_na",
  "amazon_us",
  "amazon_ca",
];

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

const AMAZON_STATUS_KEYS = Object.keys(AMAZON_STATUS_LABELS);

function amazonMarketDepth(key) {
  const k = String(key || "");
  if (k === "amazon_eu" || k === "amazon_na") return 0;
  if (k.startsWith("amazon_")) return 1;
  return 0;
}

function defaultFilterState() {
  return {
    q: "",
    /** @type {Record<string, Record<string, number>>} section -> value -> -1|0|1 */
    tri: Object.fromEntries(SECTIONS.map((s) => [s.key, {}])),
  };
}

export const filterState = defaultFilterState();

export function clearAllFilters() {
  filterState.q = "";
  for (const { key } of SECTIONS) filterState.tri[key] = {};
}

function labelForFacetValue(sectionKey, value, facets) {
  const list = facets?.[sectionKey];
  if (Array.isArray(list)) {
    const hit = list.find((f) => String(f.key) === String(value));
    if (hit?.label) return String(hit.label);
  }
  if (sectionKey === "category") return value === CATEGORY_EMPTY_KEY ? CATEGORY_EMPTY_LABEL : String(value);
  if (sectionKey === "visibility") return VISIBILITY_LABELS[value] || value;
  if (sectionKey === "source") return SOURCE_LABELS[value] || value;
  if (sectionKey === "provider") return PROVIDER_LABELS[value] || value;
  if (sectionKey === "printify_status") return PRINTIFY_STATUS_LABELS[value] || value;
  if (sectionKey === "channels") return CHANNEL_LABELS[value] || value;
  if (sectionKey === "amazon_markets") return AMAZON_MARKET_LABELS[value] || value;
  if (sectionKey === "amazon_status") return AMAZON_STATUS_LABELS[value] || value;
  if (sectionKey === "needs_update") return value === "yes" ? "Needs update" : "Up to date";
  if (sectionKey === "alt_image_texts") return value === "has" ? "Has alt text" : "Missing alt text";
  if (sectionKey === "time_range") return TIME_RANGE_LABELS[value] || value;
  return String(value);
}

/**
 * Active chips for the Results bar (Include / Exclude + search string).
 * @param {Record<string, Array<{ key: string, label: string }>>} [facets]
 */
export function collectActiveFilterChips(facets) {
  const include = [];
  const exclude = [];
  for (const { key, label } of SECTIONS) {
    const group = filterState.tri[key] || {};
    for (const [val, st] of Object.entries(group)) {
      if (st !== 1 && st !== -1) continue;
      const valueLabel = labelForFacetValue(key, val, facets);
      const chip = {
        section: key,
        value: String(val),
        label: `${label}: ${valueLabel}`,
      };
      if (st === 1) include.push(chip);
      else exclude.push(chip);
    }
  }
  return { include, exclude, search: filterState.q.trim() };
}

/** Set one tri value back to neutral. */
export function removeTriFilter(section, value) {
  const group = filterState.tri[section];
  if (!group) return;
  delete group[String(value)];
}

function countActiveTri() {
  let n = 0;
  for (const { key } of SECTIONS) {
    const group = filterState.tri[key] || {};
    for (const st of Object.values(group)) {
      if (st === 1 || st === -1) n += 1;
    }
  }
  return n;
}

export function hasActiveFilters() {
  if (filterState.q.trim()) return true;
  return countActiveTri() > 0;
}

export function isFilterSidebarCollapsed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

export function setFilterSidebarCollapsed(collapsed) {
  try {
    sessionStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}

function exactCountKey(count) {
  return String(Math.max(0, Number(count) || 0));
}

function bucketCount(list, keyFn) {
  const counts = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (key == null) continue;
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      if (k == null || k === "") continue;
      const sk = String(k);
      counts.set(sk, (counts.get(sk) || 0) + 1);
    }
  }
  return counts;
}

function toFacetList(counts, labelFn, { numeric = false, orderedKeys = null, depthFn = null } = {}) {
  const entries = orderedKeys
    ? orderedKeys.map((key) => [String(key), counts.get(String(key)) || 0])
    : [...counts.entries()];
  const list = entries.map(([key, count]) => ({
    key,
    label: labelFn ? labelFn(key) : String(key),
    count,
    ...(depthFn ? { depth: depthFn(key) } : {}),
  }));
  if (orderedKeys) return list;
  return list.sort((a, b) => {
    if (a.key === CATEGORY_EMPTY_KEY) return 1;
    if (b.key === CATEGORY_EMPTY_KEY) return -1;
    if (numeric) {
      const na = Number(a.key);
      const nb = Number(b.key);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    }
    return b.count - a.count || String(a.label).localeCompare(String(b.label));
  });
}

function categoryKeyOf(p) {
  const raw = String(p.filter_category || p.shopify_product_type || p.product_type || "").trim();
  if (!raw || raw === CATEGORY_EMPTY_KEY) return CATEGORY_EMPTY_KEY;
  return raw;
}

function visibilityKeyOf(p) {
  return String(p.filter_visibility || p.listing_visibility || "").trim().toLowerCase() === "public"
    ? "public"
    : "private";
}

function productFacetKey(p) {
  return String(p.filter_product_key || p.product_key || "").trim() || null;
}

function productFacetLabel(p) {
  return String(p.catalog_product_name || p.product_key || "Product").trim() || "Product";
}

function sourceKeyOf(p) {
  const s = String(p.filter_source || "").trim().toLowerCase();
  if (s === "product" || s === "customer" || s === "samples" || s === "other") return s;
  return null;
}

function providerKeyOf(p) {
  const s = String(p.filter_provider || "").trim().toLowerCase();
  if (s === "printify" || s === "todify") return s;
  return null;
}

function valuesForSection(sectionKey, p) {
  switch (sectionKey) {
    case "time_range":
      return timeRangeKeysForItem(p);
    case "category":
      return categoryKeyOf(p);
    case "visibility":
      return visibilityKeyOf(p);
    case "source":
      return sourceKeyOf(p);
    case "product":
      return productFacetKey(p);
    case "provider":
      return providerKeyOf(p);
    case "channels":
      return Array.isArray(p.channel_keys) && p.channel_keys.length ? p.channel_keys : null;
    case "amazon_markets":
      return Array.isArray(p.amazon_market_keys) && p.amazon_market_keys.length ? p.amazon_market_keys : null;
    case "amazon_status":
      return Array.isArray(p.amazon_status_keys) && p.amazon_status_keys.length ? p.amazon_status_keys : null;
    case "variants":
      return exactCountKey(p.variant_count);
    case "catalogs":
      return exactCountKey(p.catalog_count ?? p.market_count);
    case "metafields":
      return exactCountKey(p.metafields_filled_count);
    case "alt_image_texts":
      return Array.isArray(p.alt_image_texts) && p.alt_image_texts.length ? "has" : "missing";
    case "branding_white":
      return exactCountKey(p.branding_white_count);
    case "branding_black":
      return exactCountKey(p.branding_black_count);
    case "needs_update":
      return p.needs_update ? "yes" : "no";
    case "printify_status":
      return p.printify_status || null;
    default:
      return null;
  }
}

function productMatchesValue(p, sectionKey, value) {
  const raw = valuesForSection(sectionKey, p);
  if (raw == null) return false;
  const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
  return list.includes(String(value));
}

/**
 * Shop-style facet match: excludes must not match; if any includes, at least one must match.
 * Sections with only neutrals are ignored.
 */
function matchesTriFacets(p, tri, skipSection = null) {
  for (const { key } of SECTIONS) {
    if (skipSection && key === skipSection) continue;
    const group = tri?.[key] || {};
    const includes = [];
    const excludes = [];
    for (const [val, st] of Object.entries(group)) {
      if (st === 1) includes.push(val);
      if (st === -1) excludes.push(val);
    }
    for (const ex of excludes) {
      if (productMatchesValue(p, key, ex)) return false;
    }
    if (includes.length) {
      if (!includes.some((inc) => productMatchesValue(p, key, inc))) return false;
    }
  }
  return true;
}

function matchQuery(p, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    p.title,
    p.product_key,
    p.catalog_product_name,
    p.category,
    p.filter_category,
    p.shopify_product_type,
    p.filter_visibility,
    p.listing_visibility,
    p.owner_label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function poolForFacetCounts(items, tri, q, skipSection) {
  return (items || []).filter((p) => {
    if (!matchQuery(p, q)) return false;
    return matchesTriFacets(p, tri, skipSection);
  });
}

function universePool(items, q) {
  return (items || []).filter((p) => matchQuery(p, q));
}

function mergeUniverseCounts(universeKeys, poolCounts, activeTriGroup = {}) {
  const merged = new Map();
  for (const k of universeKeys) merged.set(String(k), 0);
  for (const [k, v] of poolCounts) merged.set(String(k), v);
  for (const [val, st] of Object.entries(activeTriGroup || {})) {
    if ((st === 1 || st === -1) && !merged.has(String(val))) merged.set(String(val), 0);
  }
  return merged;
}

function fixedBaseKeys(sectionKey) {
  if (sectionKey === "category") return [CATEGORY_EMPTY_KEY];
  if (sectionKey === "visibility") return ["public", "private"];
  if (sectionKey === "source") return ["product", "customer", "samples", "other"];
  if (sectionKey === "provider") return ["printify", "todify"];
  if (sectionKey === "printify_status") {
    return ["published", "unpublished", "unpublished_changes", "publishing", "error"];
  }
  if (sectionKey === "channels") return CHANNEL_KEYS.slice();
  if (sectionKey === "amazon_markets") return AMAZON_MARKET_KEYS.slice();
  if (sectionKey === "amazon_status") return AMAZON_STATUS_KEYS.slice();
  if (sectionKey === "alt_image_texts") return ["has", "missing"];
  if (sectionKey === "needs_update") return ["yes", "no"];
  if (sectionKey === "time_range") return TIME_RANGE_KEYS.slice();
  return null;
}

/**
 * Recompute facet buckets + counts. Counts are relative to other active filters
 * (same section excluded from the pool, shop-style). Option keys come from the
 * search-only universe so values outside the current selection stay at 0.
 *
 * @param {object[]} items
 * @param {{ q?: string, tri?: Record<string, Record<string, number>> }} [override]
 *        Optional state for tests; defaults to live filterState.
 */
export function computeFacetsFromItems(items, override = null) {
  const list = Array.isArray(items) ? items : [];
  const q = override?.q != null ? String(override.q) : filterState.q;
  const tri = override?.tri || filterState.tri;
  const uni = universePool(list, q);

  const labelFns = {
    time_range: (key) => TIME_RANGE_LABELS[key] || key,
    category: (key) => (key === CATEGORY_EMPTY_KEY ? CATEGORY_EMPTY_LABEL : key),
    visibility: (key) => VISIBILITY_LABELS[key] || key,
    source: (key) => SOURCE_LABELS[key] || key,
    product: (key) => {
      const hit = list.find((p) => productFacetKey(p) === key);
      return hit ? productFacetLabel(hit) : key;
    },
    provider: (key) => PROVIDER_LABELS[key] || key,
    channels: (key) => CHANNEL_LABELS[key] || key,
    amazon_markets: (key) => AMAZON_MARKET_LABELS[key] || key,
    amazon_status: (key) => AMAZON_STATUS_LABELS[key] || key,
    alt_image_texts: (key) => (key === "has" ? "Has alt text" : "Missing alt text"),
    needs_update: (key) => (key === "yes" ? "Needs update" : "Up to date"),
    printify_status: (key) => PRINTIFY_STATUS_LABELS[key] || key,
  };

  const out = { total: list.length };
  for (const { key } of SECTIONS) {
    const pool = poolForFacetCounts(list, tri, q, key);
    const poolCounts = bucketCount(pool, (p) => valuesForSection(key, p));
    const fixed = fixedBaseKeys(key);
    const uniCounts = bucketCount(uni, (p) => valuesForSection(key, p));
    const universeKeys = fixed || [...uniCounts.keys()];
    const merged = mergeUniverseCounts(universeKeys, poolCounts, tri[key]);
    const numeric = NUMERIC_SECTIONS.has(key);
    const ordered =
      key === "amazon_markets" || key === "channels" || key === "amazon_status" || key === "time_range"
        ? fixed
        : null;
    out[key] = toFacetList(merged, labelFns[key], {
      numeric,
      orderedKeys: ordered,
      depthFn: key === "amazon_markets" ? amazonMarketDepth : null,
    });
  }
  return out;
}

/** Apply search + tri-state facets to enriched products. */
export function applyProductSidebarFilters(items) {
  const q = filterState.q;
  const tri = filterState.tri;
  return (items || []).filter((p) => {
    if (!matchQuery(p, q)) return false;
    return matchesTriFacets(p, tri, null);
  });
}

function facetSectionHtml(sectionKey, label, facetList) {
  let headerExtraHtml = "";
  if (sectionKey === "metafields") headerExtraHtml = METAFIELDS_INFO_ICON;
  else if (sectionKey === "alt_image_texts") headerExtraHtml = ALT_IMAGE_INFO_ICON;
  const opts = headerExtraHtml ? { headerExtraHtml } : undefined;
  return sharedFacetSectionHtml(sectionKey, label, facetList, filterState.tri[sectionKey] || {}, opts);
}

function configureInfoModal(extraClass) {
  const modal = document.querySelector("#modal-backdrop .modal");
  if (extraClass) modal?.classList.add(extraClass);
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) saveBtn.style.display = "none";
  const cancelBtn = document.getElementById("modal-cancel");
  if (cancelBtn) cancelBtn.textContent = "Close";
}

function productTitleOf(p) {
  return String(p?.title || p?.catalog_product_name || p?.product_key || "Product").trim() || "Product";
}

function truncateCell(value, max = 72) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Column keys = union of metafields filled on at least one product in the filtered set.
 * @param {object[]} products
 * @returns {string[]}
 */
export function collectFilledMetafieldColumns(products) {
  const keys = new Set();
  for (const p of products || []) {
    const map = p?.metafields_map && typeof p.metafields_map === "object" ? p.metafields_map : null;
    if (!map) continue;
    for (const [k, v] of Object.entries(map)) {
      if (v == null || String(v).trim() === "") continue;
      keys.add(String(k));
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function metafieldMatrixBodyHtml(products) {
  const list = Array.isArray(products) ? products : [];
  const columns = collectFilledMetafieldColumns(list);
  if (!list.length) {
    return `<p class="confirm-modal-message">No products match the current filters.</p>`;
  }
  if (!columns.length) {
    return `<p class="confirm-modal-message">No filled metafields on the ${list.length} filtered product${
      list.length === 1 ? "" : "s"
    }.</p>`;
  }
  const head = columns
    .map((col) => `<th scope="col" title="${escapeHtml(col)}">${escapeHtml(col)}</th>`)
    .join("");
  const rows = list
    .map((p) => {
      const title = productTitleOf(p);
      const preview = p.preview_url || p.grid_views?.[0]?.src || "";
      const map = p?.metafields_map && typeof p.metafields_map === "object" ? p.metafields_map : {};
      const cells = columns
        .map((col) => {
          const raw = map[col];
          if (raw == null || String(raw).trim() === "") {
            return `<td class="cr-mf-matrix__empty"></td>`;
          }
          const full = String(raw);
          const short = truncateCell(full);
          return `<td title="${escapeHtml(full)}">${escapeHtml(short)}</td>`;
        })
        .join("");
      return `<tr>
        <th scope="row" class="cr-mf-matrix__product">
          <span class="cr-mf-matrix__media">${
            preview ? `<img src="${escapeHtml(preview)}" alt="" loading="lazy" />` : ""
          }</span>
          <span class="cr-mf-matrix__title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        </th>
        ${cells}
      </tr>`;
    })
    .join("");
  return `
    <p class="confirm-modal-message cr-mf-matrix__summary">
      Showing <strong>${list.length}</strong> filtered product${list.length === 1 ? "" : "s"} ·
      <strong>${columns.length}</strong> metafield column${columns.length === 1 ? "" : "s"}
      (filled on at least one product; empty cells mean missing on that product).
    </p>
    <div class="cr-mf-matrix-scroll">
      <table class="cr-mf-matrix">
        <thead>
          <tr>
            <th scope="col" class="cr-mf-matrix__product-col">Product</th>
            ${head}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Info modal: product × metafield matrix for the currently filtered set.
 * @param {object[]} products
 */
export function openMetafieldsInfoModal(products) {
  openModal({
    title: "Metafields overview",
    bodyHtml: metafieldMatrixBodyHtml(products),
    onSave: async () => {
      closeModal();
    },
  });
  configureInfoModal("cr-mf-matrix-modal");
}

function formatViewLabel(view) {
  const raw = String(view || "").trim();
  if (!raw || raw === "other") return "";
  return raw.replace(/[_-]+/g, " ");
}

function altVariantSlideHtml(slide) {
  const src = String(slide?.src || "").trim();
  if (!src) return "";
  const alt = String(slide?.alt || "").trim();
  const variantLabel = String(slide?.variant_label || "Default").trim() || "Default";
  const badges = [];
  if (slide?.is_featured) badges.push("Featured");
  else if (slide?.is_preview) badges.push("Main");
  const badgeHtml = badges
    .map((b) => `<span class="cr-alt-slide__badge">${escapeHtml(b)}</span>`)
    .join("");
  return `<figure class="cr-alt-slide">
    <div class="cr-alt-slide__media">
      ${badgeHtml}
      <img src="${escapeHtml(src)}" alt="${escapeHtml(alt || variantLabel || "Product image")}" loading="lazy" decoding="async" />
    </div>
    <figcaption class="cr-alt-slide__caption">
      <span class="cr-alt-slide__view">${escapeHtml(variantLabel)}</span>
      ${
        alt
          ? `<span class="cr-alt-slide__alt" title="${escapeHtml(alt)}">${escapeHtml(truncateCell(alt, 64))}</span>`
          : `<span class="cr-alt-slide__alt cr-alt-slide__alt--empty">No alt text</span>`
      }
    </figcaption>
  </figure>`;
}

const VIEW_ORDER_CLIENT = {
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

function viewSortRankClient(view) {
  const v = String(view || "other")
    .trim()
    .toLowerCase();
  if (Object.prototype.hasOwnProperty.call(VIEW_ORDER_CLIENT, v)) return VIEW_ORDER_CLIENT[v];
  return VIEW_ORDER_CLIENT.other;
}

function altVariantGroupsOf(product) {
  if (Array.isArray(product?.alt_image_groups) && product.alt_image_groups.length) {
    return product.alt_image_groups;
  }
  // Client fallback when enrich map missing (older payload): group grid_views by variant_label.
  const views = Array.isArray(product?.grid_views) ? product.grid_views.filter((v) => v?.src) : [];
  if (!views.length) {
    const urls = Array.isArray(product?.images) ? product.images : product?.preview_url ? [product.preview_url] : [];
    if (!urls.length) return [];
    return [
      {
        variant_label: "Default",
        views: urls.filter(Boolean).map((src, i) => ({
          src,
          alt: "",
          view: i === 0 ? "front" : `view ${i + 1}`,
          is_preview: i === 0,
          is_featured: i === 0,
        })),
      },
    ];
  }
  const byVariant = new Map();
  views.forEach((v, index) => {
    const key = String(v.variant_label || "Default").trim() || "Default";
    if (!byVariant.has(key)) byVariant.set(key, []);
    byVariant.get(key).push({
      src: v.src,
      alt: v.alt || "",
      view: v.view || (index === 0 ? "front" : "other"),
      is_preview: Boolean(v.is_preview),
      is_featured: Boolean(v.is_preview && index === 0),
    });
  });
  return [...byVariant.entries()].map(([variant_label, groupViews]) => ({
    variant_label,
    views: groupViews,
  }));
}

/** Variant groups → view groups (Ansichten-Container with variant carousels). */
function altViewGroupsOf(product) {
  if (Array.isArray(product?.alt_image_view_groups) && product.alt_image_view_groups.length) {
    return product.alt_image_view_groups;
  }
  const byView = new Map();
  for (const group of altVariantGroupsOf(product)) {
    const variantLabel = String(group?.variant_label || "Default").trim() || "Default";
    for (const slide of group?.views || []) {
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
  return [...byView.entries()]
    .map(([view, variants]) => {
      variants.sort((a, b) => {
        if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
        if (a.is_preview !== b.is_preview) return a.is_preview ? -1 : 1;
        return String(a.variant_label).localeCompare(String(b.variant_label));
      });
      return { view, variants };
    })
    .sort((a, b) => viewSortRankClient(a.view) - viewSortRankClient(b.view) || String(a.view).localeCompare(String(b.view)));
}

function altImageTextsBodyHtml(products) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) {
    return `<p class="confirm-modal-message">No products match the current filters.</p>`;
  }
  const productBlocks = list
    .map((p, pIndex) => {
      const title = productTitleOf(p);
      const viewGroups = altViewGroupsOf(p);
      const imageCount = viewGroups.reduce((n, g) => n + (g.variants?.length || 0), 0);
      const variantCount = new Set(
        viewGroups.flatMap((g) => (g.variants || []).map((v) => String(v.variant_label || "Default")))
      ).size;
      const viewBlocks = viewGroups.length
        ? viewGroups
            .map((g, vIndex) => {
              const slides = (g.variants || []).map(altVariantSlideHtml).filter(Boolean).join("");
              const openAttr = vIndex < 2 ? " open" : "";
              const viewLabel = formatViewLabel(g.view) || g.view || "Other";
              return `<details class="cr-alt-variant cr-alt-view"${openAttr}>
                <summary class="cr-alt-variant__summary">
                  <span>${escapeHtml(viewLabel)}</span>
                  <span class="cr-alt-variant__count">${g.variants?.length || 0} variant${
                (g.variants?.length || 0) === 1 ? "" : "s"
              }</span>
                </summary>
                <div class="cr-alt-variant__body">
                  ${
                    slides
                      ? productCarouselHtml(slides)
                      : `<p class="cr-pf-empty">No variants for this view</p>`
                  }
                </div>
              </details>`;
            })
            .join("")
        : `<p class="cr-pf-empty">No images available</p>`;
      const openAttr = pIndex < 3 ? " open" : "";
      return `<details class="cr-alt-product"${openAttr}>
        <summary class="cr-alt-product__summary">
          <span class="cr-alt-product__title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
          <span class="cr-alt-product__meta">${viewGroups.length} view${
        viewGroups.length === 1 ? "" : "s"
      } · ${variantCount} variant${variantCount === 1 ? "" : "s"} · ${imageCount} image${
        imageCount === 1 ? "" : "s"
      }</span>
        </summary>
        <div class="cr-alt-product__body">${viewBlocks}</div>
      </details>`;
    })
    .join("");
  return `
    <p class="confirm-modal-message cr-alt-overview__summary">
      Showing <strong>${list.length}</strong> filtered product${
        list.length === 1 ? "" : "s"
      } grouped by view (Front, Back, …). Scroll each carousel for color variants. Featured / Main is labeled.
    </p>
    <div class="cr-alt-overview-scroll" id="cr-alt-overview-body">${productBlocks}</div>`;
}

/**
 * Info modal: filtered products → view collapsibles → variant carousels (alt texts).
 * @param {object[]} products
 */
export function openAltImageTextsInfoModal(products) {
  openModal({
    title: "Alt image texts overview",
    bodyHtml: altImageTextsBodyHtml(products),
    onSave: async () => {
      closeModal();
    },
  });
  configureInfoModal("cr-alt-overview-modal");
  const body = document.getElementById("cr-alt-overview-body") || document.getElementById("modal-body");
  if (body) {
    bindProdCarousels(body);
    body.querySelectorAll("details.cr-alt-view").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (details.open) requestAnimationFrame(() => bindProdCarousels(details));
      });
    });
  }
}

export function filterSidebarInnerHtml(facets) {
  const f = facets || {};
  const activeCount = countActiveTri() + (filterState.q.trim() ? 1 : 0);
  return `
    <div class="cr-pf-search">
      <input type="search" id="cr-pf-search-input" class="cr-pf-search__input" placeholder="Search products…" value="${escapeHtml(
        filterState.q
      )}" aria-label="Filter products" />
    </div>
    ${
      activeCount
        ? `<button type="button" class="cr-pf-clear" id="cr-pf-clear-all">Clear all filters (${activeCount})</button>`
        : ""
    }
    <div class="cr-pf-sections">
      ${SECTIONS.map(({ key, label }) => facetSectionHtml(key, label, f[key])).join("")}
    </div>`;
}

/**
 * @param {HTMLElement} sidebarEl
 * @param {{ onChange?: () => void, getFilteredItems?: () => object[] }} handlers
 */
export function bindFilterSidebar(sidebarEl, { onChange, getFilteredItems } = {}) {
  if (!sidebarEl) return;
  const notify = () => {
    if (typeof onChange === "function") onChange();
  };

  let searchTimer = null;
  sidebarEl.querySelector("#cr-pf-search-input")?.addEventListener("input", (e) => {
    filterState.q = String(e.target.value || "");
    clearTimeout(searchTimer);
    searchTimer = setTimeout(notify, 200);
  });

  bindTriSwitches(sidebarEl, { triState: filterState, onChange: notify });

  const filteredItems = () => {
    const items =
      typeof getFilteredItems === "function" ? getFilteredItems() : applyProductSidebarFilters([]);
    return Array.isArray(items) ? items : [];
  };

  const bindInfoButton = (selector, openFn) => {
    sidebarEl.querySelectorAll(selector).forEach((btn) => {
      const openInfo = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFn(filteredItems());
      };
      btn.addEventListener("click", openInfo);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
  };

  bindInfoButton("[data-cr-pf-metafields-info]", openMetafieldsInfoModal);
  bindInfoButton("[data-cr-pf-alt-info]", openAltImageTextsInfoModal);

  sidebarEl.querySelector("#cr-pf-clear-all")?.addEventListener("click", () => {
    clearAllFilters();
    const search = sidebarEl.querySelector("#cr-pf-search-input");
    if (search) search.value = "";
    sidebarEl.querySelectorAll(".cr-pf-triswitch").forEach((sw) => {
      sw.setAttribute("data-state", "0");
      sw.closest(".cr-pf-option--tri")?.setAttribute("data-tri-state", "0");
    });
    sidebarEl.querySelectorAll(".cr-pf-section__badge").forEach((b) => b.remove());
    sidebarEl.querySelector("#cr-pf-clear-all")?.remove();
    notify();
  });
}

export { SECTIONS as PRODUCT_FILTER_SECTIONS, SOURCE_LABELS, PROVIDER_LABELS };
