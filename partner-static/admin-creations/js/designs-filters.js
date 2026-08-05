/**
 * Creations Portal Designs — collapsible Design Filter sidebar (IDEA-064).
 * Tri-state switches: exclude (−1) / neutral (0) / include (1) — same UX as Products.
 *
 * Status = Shopify ACTIVE→Online / DRAFT→Draft (not library active/inactive).
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

const STORAGE_KEY = "admin_creations_designs_filter_collapsed";

/** Facet sections under search (Category first). */
const SECTIONS = [
  { key: "category", label: "Category" },
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

export function emptyFacets() {
  return {
    category: [{ key: "_empty", label: "Empty / not set", count: 0 }],
    visibility: [
      { key: "public", label: "Public", count: 0 },
      { key: "private", label: "Private", count: 0 },
    ],
    status: [
      { key: "online", label: "Online", count: 0 },
      { key: "draft", label: "Draft", count: 0 },
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

  sidebarEl.querySelector("#cr-df-clear-all")?.addEventListener("click", () => {
    clearAllFilters();
    notify();
  });
}

export { SECTIONS as DESIGN_FILTER_SECTIONS };
