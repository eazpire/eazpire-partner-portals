/**
 * Creations Portal Products — collapsible Product Filter sidebar (IDEA-063).
 * Tri-state switches: exclude (−1) / neutral (0) / include (1) — same logic as shop PLP filters.
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

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
      counts.set(k, (counts.get(k) || 0) + 1);
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
function matchesTriFacets(p, skipSection = null) {
  for (const { key } of SECTIONS) {
    if (skipSection && key === skipSection) continue;
    const group = filterState.tri[key] || {};
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

function poolForFacetCounts(items, skipSection) {
  const needle = filterState.q.trim().toLowerCase();
  return (items || []).filter((p) => {
    if (needle) {
      const hay = [p.title, p.product_key, p.catalog_product_name, p.category, p.owner_label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return matchesTriFacets(p, skipSection);
  });
}

/**
 * Recompute facet buckets + counts. Counts are relative to other active filters
 * (same section excluded from the pool, shop-style).
 */
export function computeFacetsFromItems(items) {
  const list = Array.isArray(items) ? items : [];

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

  // Always show Source / Provider / Printify Status options even when empty in current load
  const baseSource = new Map([
    ["product", 0],
    ["customer", 0],
    ["samples", 0],
    ["other", 0],
  ]);
  const baseProvider = new Map([
    ["printify", 0],
    ["todify", 0],
  ]);
  const basePrintifyStatus = new Map([
    ["published", 0],
    ["unpublished", 0],
    ["unpublished_changes", 0],
    ["publishing", 0],
    ["error", 0],
  ]);
  const baseChannels = new Map(Object.keys(CHANNEL_LABELS).map((k) => [k, 0]));

  const out = { total: list.length };
  for (const { key } of SECTIONS) {
    const pool = poolForFacetCounts(list, key);
    const counts = bucketCount(pool, (p) => valuesForSection(key, p));
    const numeric = NUMERIC_SECTIONS.has(key);
    if (key === "source") {
      for (const [k, v] of counts) baseSource.set(k, v);
      out[key] = toFacetList(baseSource, labelFns.source);
    } else if (key === "provider") {
      for (const [k, v] of counts) baseProvider.set(k, v);
      out[key] = toFacetList(baseProvider, labelFns.provider);
    } else if (key === "printify_status") {
      for (const [k, v] of counts) basePrintifyStatus.set(k, v);
      out[key] = toFacetList(basePrintifyStatus, labelFns.printify_status);
    } else if (key === "channels") {
      for (const [k, v] of counts) baseChannels.set(k, v);
      out[key] = toFacetList(baseChannels, labelFns.channels);
    } else {
      out[key] = toFacetList(counts, labelFns[key], { numeric });
    }
  }
  return out;
}

/** Apply search + tri-state facets to enriched products. */
export function applyProductSidebarFilters(items) {
  const needle = filterState.q.trim().toLowerCase();
  return (items || []).filter((p) => {
    if (needle) {
      const hay = [p.title, p.product_key, p.catalog_product_name, p.category, p.owner_label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return matchesTriFacets(p, null);
  });
}

function clampTri(st) {
  const n = Number(st);
  if (n === 1 || n === -1) return n;
  return 0;
}

function triSwitchHtml(sectionKey, value, state) {
  const st = clampTri(state);
  return `<div class="cr-pf-triswitch" data-state="${st}" data-cr-pf-section="${escapeHtml(sectionKey)}" data-cr-pf-key="${escapeHtml(
    String(value)
  )}" role="group" aria-label="Filter">
    <div class="cr-pf-triswitch__track">
      <div class="cr-pf-triswitch__thumb"></div>
      <div class="cr-pf-triswitch__labels">
        <button type="button" data-v="-1" aria-label="Exclude"><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--minus">−</span></button>
        <button type="button" data-v="0" aria-label="Neutral"><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--dot"></span></button>
        <button type="button" data-v="1" aria-label="Include"><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--plus">+</span></button>
      </div>
    </div>
  </div>`;
}

function facetSectionHtml(sectionKey, label, facetList) {
  const group = filterState.tri[sectionKey] || {};
  const active = Object.values(group).filter((st) => st === 1 || st === -1).length;
  const rows = (facetList || [])
    .map((f) => {
      const st = clampTri(group[f.key] || 0);
      return `<div class="cr-pf-option cr-pf-option--tri" data-tri-state="${st}">
        <span class="cr-pf-option__label" title="${escapeHtml(f.label)}">${escapeHtml(f.label)}</span>
        <span class="cr-pf-option__count">${f.count}</span>
        ${triSwitchHtml(sectionKey, f.key, st)}
      </div>`;
    })
    .join("");
  return `<details class="cr-pf-section" data-cr-pf-group="${escapeHtml(sectionKey)}" open>
    <summary class="cr-pf-section__summary">
      <span>${escapeHtml(label)}</span>
      ${active ? `<span class="cr-pf-section__badge">${active}</span>` : ""}
    </summary>
    <div class="cr-pf-section__body">${rows || '<p class="cr-pf-empty">No values</p>'}</div>
  </details>`;
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

  sidebarEl.querySelectorAll(".cr-pf-triswitch").forEach((sw) => {
    sw.querySelectorAll("button[data-v]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const section = sw.getAttribute("data-cr-pf-section");
        const key = sw.getAttribute("data-cr-pf-key");
        const v = clampTri(parseInt(btn.getAttribute("data-v"), 10));
        if (!section || key == null || !filterState.tri[section]) return;
        if (v === 0) delete filterState.tri[section][key];
        else filterState.tri[section][key] = v;
        sw.setAttribute("data-state", String(v));
        const row = sw.closest(".cr-pf-option--tri");
        if (row) row.setAttribute("data-tri-state", String(v));
        notify();
      });
    });
  });

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
