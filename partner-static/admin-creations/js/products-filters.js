/**
 * Creations Portal Products — collapsible Product Filter sidebar (IDEA-063).
 * Tri-state switches: exclude (−1) / neutral (0) / include (1) — same logic as shop PLP filters.
 * Classic faceted search: option counts ignore the option's own section; count 0 → grayed / disabled.
 *
 * Count engine mirrors src/features/admin/adminCreationsProductFilters.js (unit-tested).
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";
import { bindTriSwitches, facetSectionHtml as sharedFacetSectionHtml } from "./facet-tri-ui.js";

const STORAGE_KEY = "admin_creations_products_filter_collapsed";

/** Facet sections in display order. */
const SECTIONS = [
  { key: "source", label: "Source" },
  { key: "product", label: "Product" },
  { key: "provider", label: "Provider" },
  { key: "printify_status", label: "Printify Status" },
  { key: "channels", label: "Channels" },
  { key: "variants", label: "Variants" },
  { key: "catalogs", label: "Kataloge" },
  { key: "metafields", label: "Metafields" },
  { key: "channel_count", label: "Channel count" },
  { key: "alt_image_texts", label: "Alt Image Texts" },
  { key: "branding_white", label: "White Branding" },
  { key: "branding_black", label: "Black Branding" },
  { key: "needs_update", label: "Needs Update" },
];

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
  "channel_count",
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

/** Always-visible Channels options (counts filled from D1/Shopify enrichment). */
const CHANNEL_LABELS = {
  eazpire: "eazpire",
  onlineshop: "Online Store",
  eazpire_headless: "eazpire Headless",
  amazon_eu: "Amazon EU",
  amazon_us: "Amazon US",
  pending_amazon_eu: "Pending Amazon EU",
  pending_amazon_us: "Pending Amazon US",
};

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
  if (sectionKey === "source") return SOURCE_LABELS[value] || value;
  if (sectionKey === "provider") return PROVIDER_LABELS[value] || value;
  if (sectionKey === "printify_status") return PRINTIFY_STATUS_LABELS[value] || value;
  if (sectionKey === "channels") return CHANNEL_LABELS[value] || value;
  if (sectionKey === "needs_update") return value === "yes" ? "Needs update" : "Up to date";
  if (sectionKey === "alt_image_texts") return value === "has" ? "Has alt text" : "Missing alt text";
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

function toFacetList(counts, labelFn, { numeric = false } = {}) {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelFn ? labelFn(key) : String(key), count }))
    .sort((a, b) => {
      if (numeric) {
        const na = Number(a.key);
        const nb = Number(b.key);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      }
      return b.count - a.count || String(a.label).localeCompare(String(b.label));
    });
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
    case "source":
      return sourceKeyOf(p);
    case "product":
      return productFacetKey(p);
    case "provider":
      return providerKeyOf(p);
    case "channels":
      return Array.isArray(p.channel_keys) && p.channel_keys.length ? p.channel_keys : null;
    case "variants":
      return exactCountKey(p.variant_count);
    case "catalogs":
      return exactCountKey(p.catalog_count ?? p.market_count);
    case "metafields":
      return exactCountKey(p.metafields_filled_count);
    case "channel_count":
      return exactCountKey(p.channel_count);
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
  const hay = [p.title, p.product_key, p.catalog_product_name, p.category, p.owner_label]
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
  if (sectionKey === "source") return ["product", "customer", "samples", "other"];
  if (sectionKey === "provider") return ["printify", "todify"];
  if (sectionKey === "printify_status") {
    return ["published", "unpublished", "unpublished_changes", "publishing", "error"];
  }
  if (sectionKey === "channels") return Object.keys(CHANNEL_LABELS);
  if (sectionKey === "alt_image_texts") return ["has", "missing"];
  if (sectionKey === "needs_update") return ["yes", "no"];
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
    source: (key) => SOURCE_LABELS[key] || key,
    product: (key) => {
      const hit = list.find((p) => productFacetKey(p) === key);
      return hit ? productFacetLabel(hit) : key;
    },
    provider: (key) => PROVIDER_LABELS[key] || key,
    channels: (key) => {
      if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
      const hit = list.find((p) => (p.channel_keys || []).includes(key));
      const idx = hit ? (hit.channel_keys || []).indexOf(key) : -1;
      return (idx >= 0 && hit.channel_labels?.[idx]) || key;
    },
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
    out[key] = toFacetList(merged, labelFns[key], { numeric });
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
  return sharedFacetSectionHtml(sectionKey, label, facetList, filterState.tri[sectionKey] || {});
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
 * @param {{ onChange: () => void }} handlers
 */
export function bindFilterSidebar(sidebarEl, { onChange } = {}) {
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
