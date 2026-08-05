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
  { key: "source", label: "Source" },
  { key: "product", label: "Product" },
  { key: "provider", label: "Provider" },
  { key: "printify_status", label: "Printify Status" },
  { key: "channels", label: "Channels" },
  { key: "variants", label: "Variants" },
  { key: "catalogs", label: "Kataloge" },
  { key: "metafields", label: "Metafields" },
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

function altViewSlideHtml(view) {
  const src = String(view?.src || "").trim();
  if (!src) return "";
  const alt = String(view?.alt || "").trim();
  const viewLabel = formatViewLabel(view?.view);
  const badges = [];
  if (view?.is_featured) badges.push("Featured");
  else if (view?.is_preview) badges.push("Main");
  const badgeHtml = badges
    .map((b) => `<span class="cr-alt-slide__badge">${escapeHtml(b)}</span>`)
    .join("");
  return `<figure class="cr-alt-slide">
    <div class="cr-alt-slide__media">
      ${badgeHtml}
      <img src="${escapeHtml(src)}" alt="${escapeHtml(alt || viewLabel || "Product image")}" loading="lazy" decoding="async" />
    </div>
    <figcaption class="cr-alt-slide__caption">
      ${viewLabel ? `<span class="cr-alt-slide__view">${escapeHtml(viewLabel)}</span>` : ""}
      ${
        alt
          ? `<span class="cr-alt-slide__alt" title="${escapeHtml(alt)}">${escapeHtml(truncateCell(alt, 64))}</span>`
          : `<span class="cr-alt-slide__alt cr-alt-slide__alt--empty">No alt text</span>`
      }
    </figcaption>
  </figure>`;
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

function altImageTextsBodyHtml(products) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) {
    return `<p class="confirm-modal-message">No products match the current filters.</p>`;
  }
  const productBlocks = list
    .map((p, pIndex) => {
      const title = productTitleOf(p);
      const groups = altVariantGroupsOf(p);
      const imageCount = groups.reduce((n, g) => n + (g.views?.length || 0), 0);
      const variantBlocks = groups.length
        ? groups
            .map((g, vIndex) => {
              const slides = (g.views || []).map(altViewSlideHtml).filter(Boolean).join("");
              const openAttr = vIndex === 0 ? " open" : "";
              return `<details class="cr-alt-variant"${openAttr}>
                <summary class="cr-alt-variant__summary">
                  <span>${escapeHtml(g.variant_label || "Default")}</span>
                  <span class="cr-alt-variant__count">${g.views?.length || 0} view${
                (g.views?.length || 0) === 1 ? "" : "s"
              }</span>
                </summary>
                <div class="cr-alt-variant__body">
                  ${
                    slides
                      ? productCarouselHtml(slides)
                      : `<p class="cr-pf-empty">No images for this variant</p>`
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
          <span class="cr-alt-product__meta">${groups.length} variant${
        groups.length === 1 ? "" : "s"
      } · ${imageCount} image${imageCount === 1 ? "" : "s"}</span>
        </summary>
        <div class="cr-alt-product__body">${variantBlocks}</div>
      </details>`;
    })
    .join("");
  return `
    <p class="confirm-modal-message cr-alt-overview__summary">
      Showing image views for <strong>${list.length}</strong> filtered product${
        list.length === 1 ? "" : "s"
      }. Featured / Main preview is labeled and listed first in its variant.
    </p>
    <div class="cr-alt-overview-scroll" id="cr-alt-overview-body">${productBlocks}</div>`;
}

/**
 * Info modal: filtered products → variant collapsibles → view carousels (alt texts).
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
  if (body) bindProdCarousels(body);
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
