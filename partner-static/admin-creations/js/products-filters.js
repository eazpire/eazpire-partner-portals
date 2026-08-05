/**
 * Creations Portal Products — collapsible Product Filter sidebar (Catalog Studio pattern), IDEA-063.
 * Client-side facet computation mirrors src/features/manufacturers/adminCreationsProductListEnrich.js
 * (buildProductFilterFacets) but runs on the already-enriched product rows returned by the list APIs.
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

const STORAGE_KEY = "admin_creations_products_filter_collapsed";

const SECTIONS = [
  { key: "provider", label: "Provider" },
  { key: "channels", label: "Channels" },
  { key: "variants", label: "Variants" },
  { key: "markets", label: "Markets" },
  { key: "metafields", label: "Metafields" },
  { key: "channel_count", label: "Channel count" },
  { key: "alt_image_texts", label: "Alt Image Texts" },
  { key: "branding", label: "White/Black Branding" },
  { key: "needs_update", label: "Needs Update" },
];

function defaultFilterState() {
  return {
    q: "",
    provider: new Set(),
    channels: new Set(),
    variants: new Set(),
    markets: new Set(),
    metafields: new Set(),
    channel_count: new Set(),
    alt_image_texts: new Set(),
    branding: new Set(),
    needs_update: new Set(),
  };
}

export const filterState = defaultFilterState();

export function clearAllFilters() {
  filterState.q = "";
  for (const { key } of SECTIONS) filterState[key].clear();
}

export function hasActiveFilters() {
  if (filterState.q.trim()) return true;
  return SECTIONS.some(({ key }) => filterState[key].size > 0);
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

function variantBucket(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  return "20+";
}

function metafieldBucket(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "0";
  if (n <= 2) return "1-2";
  if (n <= 5) return "3-5";
  return "6+";
}

function bucketCount(list, keyFn) {
  const counts = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (key == null) continue;
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function toFacetList(counts, labelFn) {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelFn ? labelFn(key) : String(key), count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

/**
 * Recompute all sidebar facet buckets + counts from the currently loaded (unfiltered) items.
 * Mirrors the server-side `buildProductFilterFacets` shape.
 */
export function computeFacetsFromItems(items) {
  const list = Array.isArray(items) ? items : [];

  const provider = toFacetList(
    bucketCount(list, (p) => p.filter_provider || p.source || "unknown"),
    (key) => list.find((p) => (p.filter_provider || p.source) === key)?.provider_label || key
  );

  const channels = toFacetList(
    bucketCount(list, (p) => (Array.isArray(p.channel_keys) && p.channel_keys.length ? p.channel_keys : null)),
    (key) => list.find((p) => (p.channel_keys || []).includes(key))?.channel_labels?.[
      (list.find((p) => (p.channel_keys || []).includes(key))?.channel_keys || []).indexOf(key)
    ] || key
  );

  const variants = toFacetList(bucketCount(list, (p) => variantBucket(p.variant_count)));

  const markets = toFacetList(
    bucketCount(list, (p) => (Array.isArray(p.market_labels) && p.market_labels.length ? p.market_labels : "0"))
  );

  const metafields = toFacetList(bucketCount(list, (p) => metafieldBucket(p.metafields_filled_count)));

  const channelCount = toFacetList(bucketCount(list, (p) => String(Number(p.channel_count) || 0)));

  const altImageTexts = toFacetList(
    bucketCount(list, (p) => (Array.isArray(p.alt_image_texts) && p.alt_image_texts.length ? "has" : "missing")),
    (key) => (key === "has" ? "Has alt text" : "Missing alt text")
  );

  const branding = toFacetList(
    bucketCount(list, (p) => {
      const out = [];
      if (Number(p.branding_white_count) > 0) out.push("white");
      if (Number(p.branding_black_count) > 0) out.push("black");
      return out.length ? out : null;
    }),
    (key) => (key === "white" ? "White branding" : "Black branding")
  );

  const needsUpdate = toFacetList(
    bucketCount(list, (p) => (p.needs_update ? "yes" : "no")),
    (key) => (key === "yes" ? "Needs update" : "Up to date")
  );

  return {
    total: list.length,
    provider,
    channels,
    variants,
    markets,
    metafields,
    channel_count: channelCount,
    alt_image_texts: altImageTexts,
    branding,
    needs_update: needsUpdate,
  };
}

function matchesFacetSet(selected, valueOrList) {
  if (!selected.size) return true;
  const values = Array.isArray(valueOrList) ? valueOrList : [valueOrList];
  return values.some((v) => selected.has(v));
}

/** Apply the current filterState (search + facet selections) to a list of enriched products. */
export function applyProductSidebarFilters(items) {
  let list = Array.isArray(items) ? items : [];

  const needle = filterState.q.trim().toLowerCase();
  if (needle) {
    list = list.filter((p) => {
      const hay = [p.title, p.product_key, p.catalog_product_name, p.category, p.owner_label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  if (filterState.provider.size) {
    list = list.filter((p) => matchesFacetSet(filterState.provider, p.filter_provider || p.source || "unknown"));
  }
  if (filterState.channels.size) {
    list = list.filter((p) => matchesFacetSet(filterState.channels, p.channel_keys || []));
  }
  if (filterState.variants.size) {
    list = list.filter((p) => matchesFacetSet(filterState.variants, variantBucket(p.variant_count)));
  }
  if (filterState.markets.size) {
    list = list.filter((p) => matchesFacetSet(filterState.markets, p.market_labels?.length ? p.market_labels : "0"));
  }
  if (filterState.metafields.size) {
    list = list.filter((p) => matchesFacetSet(filterState.metafields, metafieldBucket(p.metafields_filled_count)));
  }
  if (filterState.channel_count.size) {
    list = list.filter((p) => matchesFacetSet(filterState.channel_count, String(Number(p.channel_count) || 0)));
  }
  if (filterState.alt_image_texts.size) {
    list = list.filter((p) =>
      matchesFacetSet(filterState.alt_image_texts, p.alt_image_texts?.length ? "has" : "missing")
    );
  }
  if (filterState.branding.size) {
    list = list.filter((p) => {
      const keys = [];
      if (Number(p.branding_white_count) > 0) keys.push("white");
      if (Number(p.branding_black_count) > 0) keys.push("black");
      return matchesFacetSet(filterState.branding, keys);
    });
  }
  if (filterState.needs_update.size) {
    list = list.filter((p) => matchesFacetSet(filterState.needs_update, p.needs_update ? "yes" : "no"));
  }

  return list;
}

function facetSectionHtml(sectionKey, label, facetList) {
  const selected = filterState[sectionKey];
  const rows = (facetList || [])
    .map(
      (f) => `<label class="cr-pf-option">
        <input type="checkbox" class="cr-pf-cb" data-cr-pf-section="${escapeHtml(sectionKey)}" data-cr-pf-key="${escapeHtml(String(f.key))}" ${
        selected.has(f.key) ? "checked" : ""
      } />
        <span class="cr-pf-option__label">${escapeHtml(f.label)}</span>
        <span class="cr-pf-option__count">${f.count}</span>
      </label>`
    )
    .join("");
  return `<details class="cr-pf-section" data-cr-pf-group="${escapeHtml(sectionKey)}" open>
    <summary class="cr-pf-section__summary">
      <span>${escapeHtml(label)}</span>
      ${selected.size ? `<span class="cr-pf-section__badge">${selected.size}</span>` : ""}
    </summary>
    <div class="cr-pf-section__body">${rows || '<p class="cr-pf-empty">No values</p>'}</div>
  </details>`;
}

/** Full innerHTML for the filter sidebar body (search + facet sections + clear-all). */
export function filterSidebarInnerHtml(facets) {
  const f = facets || {};
  const activeCount = SECTIONS.reduce((sum, { key }) => sum + filterState[key].size, 0) + (filterState.q.trim() ? 1 : 0);
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
      ${facetSectionHtml("provider", "Provider", f.provider)}
      ${facetSectionHtml("channels", "Channels", f.channels)}
      ${facetSectionHtml("variants", "Variants", f.variants)}
      ${facetSectionHtml("markets", "Markets", f.markets)}
      ${facetSectionHtml("metafields", "Metafields", f.metafields)}
      ${facetSectionHtml("channel_count", "Channel count", f.channel_count)}
      ${facetSectionHtml("alt_image_texts", "Alt Image Texts", f.alt_image_texts)}
      ${facetSectionHtml("branding", "White/Black Branding", f.branding)}
      ${facetSectionHtml("needs_update", "Needs Update", f.needs_update)}
    </div>`;
}

/**
 * Bind the filter sidebar (search input, facet checkboxes, clear-all).
 * @param {HTMLElement} sidebarEl element containing the sidebar innerHTML (see filterSidebarInnerHtml)
 * @param {{ onChange: () => void }} handlers called whenever the filter state changes
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

  sidebarEl.querySelectorAll(".cr-pf-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const section = cb.getAttribute("data-cr-pf-section");
      const key = cb.getAttribute("data-cr-pf-key");
      if (!section || key == null || !filterState[section]) return;
      if (cb.checked) filterState[section].add(key);
      else filterState[section].delete(key);
      notify();
    });
  });

  sidebarEl.querySelector("#cr-pf-clear-all")?.addEventListener("click", () => {
    clearAllFilters();
    notify();
  });
}

export { SECTIONS as PRODUCT_FILTER_SECTIONS };
