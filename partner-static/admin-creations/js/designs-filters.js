/**
 * Creations Portal Designs — collapsible Design Filter sidebar (IDEA-064).
 * Tri-state switches: exclude (−1) / neutral (0) / include (1) — same UX as Products.
 * Facet counts come from the API (classic faceted: skip own section); count 0 → grayed / disabled.
 *
 * Status = library Active / Inactive. Category lives on the Products page.
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";
import { bindTriSwitches, facetSectionHtml as sharedFacetSectionHtml } from "./facet-tri-ui.js";

const STORAGE_KEY = "admin_creations_designs_filter_collapsed";

/** Facet sections under search. */
const SECTIONS = [
  { key: "visibility", label: "Visibility" },
  { key: "status", label: "Status" },
  { key: "products", label: "Products" },
  { key: "assets", label: "Assets" },
  { key: "source", label: "Source" },
  { key: "usage", label: "Usage" },
  { key: "owner", label: "Owner" },
  { key: "creator", label: "Creator" },
  { key: "printify_status", label: "Printify Status" },
];

function defaultFilterState() {
  return {
    q: "",
    /** @type {Record<string, Record<string, number>>} */
    tri: Object.fromEntries(SECTIONS.map((s) => [s.key, {}])),
  };
}

export const filterState = defaultFilterState();

export function clearAllFilters() {
  filterState.q = "";
  for (const { key } of SECTIONS) filterState.tri[key] = {};
}

/** Resolve label for an active tri value from facet buckets. */
function labelForFacetValue(sectionKey, value, facets) {
  const list = facets?.[sectionKey];
  if (Array.isArray(list)) {
    const hit = list.find((f) => String(f.key) === String(value));
    if (hit?.label) return String(hit.label);
  }
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

export function serializeTriFilters() {
  const out = {};
  for (const { key } of SECTIONS) {
    const group = filterState.tri[key] || {};
    const slim = {};
    for (const [val, st] of Object.entries(group)) {
      if (st === 1 || st === -1) slim[val] = st;
    }
    if (Object.keys(slim).length) out[key] = slim;
  }
  return JSON.stringify(out);
}

function facetSectionHtml(sectionKey, label, facetList) {
  return sharedFacetSectionHtml(sectionKey, label, facetList, filterState.tri[sectionKey] || {});
}

export function emptyFacets() {
  return {
    visibility: [
      { key: "public", label: "Public", count: 0 },
      { key: "private", label: "Private", count: 0 },
    ],
    status: [
      { key: "active", label: "Active", count: 0 },
      { key: "inactive", label: "Inactive", count: 0 },
    ],
    products: [],
    assets: [
      { key: "original", label: "Original", count: 0 },
      { key: "preview", label: "Preview", count: 0 },
    ],
    source: [
      { key: "generate", label: "Generate", count: 0 },
      { key: "upload", label: "Upload", count: 0 },
      { key: "automate", label: "Automation", count: 0 },
      { key: "admin", label: "Admin", count: 0 },
    ],
    usage: [
      { key: "sample", label: "Sample", count: 0 },
      { key: "product", label: "Product", count: 0 },
    ],
    owner: [],
    creator: [],
    printify_status: [
      { key: "published", label: "Published", count: 0 },
      { key: "unpublished", label: "Unpublished", count: 0 },
      { key: "unpublished_changes", label: "Unpublished Changes", count: 0 },
      { key: "publishing", label: "Publishing", count: 0 },
      { key: "error", label: "Error", count: 0 },
    ],
  };
}

export function filterSidebarInnerHtml(facets) {
  const f = facets || emptyFacets();
  const activeCount = countActiveTri() + (filterState.q.trim() ? 1 : 0);
  return `
    <div class="cr-pf-search">
      <input type="search" id="cr-df-search-input" class="cr-pf-search__input" placeholder="Search designs, users, creators…" value="${escapeHtml(
        filterState.q
      )}" aria-label="Filter designs" />
    </div>
    ${
      activeCount
        ? `<button type="button" class="cr-pf-clear" id="cr-df-clear-all">Clear all filters (${activeCount})</button>`
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
  sidebarEl.querySelector("#cr-df-search-input")?.addEventListener("input", (e) => {
    filterState.q = String(e.target.value || "");
    clearTimeout(searchTimer);
    searchTimer = setTimeout(notify, 280);
  });

  bindTriSwitches(sidebarEl, { triState: filterState, onChange: notify });

  sidebarEl.querySelector("#cr-df-clear-all")?.addEventListener("click", () => {
    clearAllFilters();
    notify();
  });
}

export { SECTIONS as DESIGN_FILTER_SECTIONS };
