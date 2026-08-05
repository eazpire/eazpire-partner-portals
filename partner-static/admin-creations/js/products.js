import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast, confirmUnsavedChanges } from "/creations/shared/js/partner-shell.js";
import {
  renderChannelsPanelHtml,
  bindChannelsPanel,
  renderOverviewPanelHtml,
  seedChannelStateFromProduct,
} from "./product-channels-panel.js";
import {
  renderEditDesignPanelHtml,
  bindEditDesignPanel,
  loadEditDesignForProduct,
  isEditDesignDirty,
  saveEditDesignWorking,
  discardEditDesignWorking,
} from "./product-edit-design-panel.js";
import { bindCardContextMenu, openContextMenu, teardownContextMenu } from "./context-menu.js";
import { openProductUnpublishModal } from "./products-unpublish-modal.js";
import {
  applyProductSidebarFilters,
  computeFacetsFromItems,
  filterSidebarInnerHtml,
  bindFilterSidebar,
  isFilterSidebarCollapsed,
  setFilterSidebarCollapsed,
} from "./products-filters.js";
import {
  ensureProductsBulkDock,
  checkboxHtml as productBulkCheckboxHtml,
  bindBulkCheckboxes,
  selectionKey as productSelectionKey,
  selectAllVisible as selectAllProductsVisible,
  teardownProductsBulkDock as teardownProductsBulkDockInner,
} from "./products-bulk.js";
import {
  openProductsBulkPublishModal,
  openProductsBulkUnpublishModal,
  openProductsBulkUpdateModal,
} from "./products-bulk-modals.js";
import {
  getBusyProductKeys,
  getBusyShopifyIds,
  setBusyChangeListener,
  teardownProductsActionDock as teardownProductsActionDockInner,
} from "./products-action-dock.js";

/** Hide floating bulk selection bar + bulk action progress dock (both body-mounted). */
export function teardownProductsExtras() {
  teardownProductsBulkDockInner();
  teardownProductsActionDockInner();
}

/**
 * Buckets whose list `id` is a Shopify product id (safe fallback when shopify_product_id is missing).
 * Customer / studio pseudo-ids (`studio:26`) must never be treated as Shopify ids.
 */
const SHOPIFY_ROW_ID_SOURCES = new Set(["printify", "shopify", "todify", "samples", "other"]);

function isNumericShopifyId(raw) {
  const s = String(raw || "").trim();
  if (!s || /^studio:/i.test(s)) return false;
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(s)) return true;
  return /^\d+(\.0+)?$/.test(s);
}

function resolveShopifyProductId(item) {
  const fromField = String(item?.shopify_product_id || "").trim();
  if (isNumericShopifyId(fromField)) return fromField.replace(/\.0+$/, "");
  const bucket = String(item?.listing_bucket || item?.source || "").trim();
  if (SHOPIFY_ROW_ID_SOURCES.has(bucket)) {
    const id = String(item?.id || "").trim();
    if (isNumericShopifyId(id)) return id.replace(/\.0+$/, "");
  }
  return "";
}

/** Studio listing id for Todify/Customer cards that are not (yet) on Shopify. */
function resolveStudioListingId(item) {
  const id = String(item?.id || "").trim();
  const m = /^studio:(\d+)$/i.exec(id);
  if (m) return m[1];
  if (
    (item?.listing_bucket === "customer" || item?.filter_source === "customer" || item?.source === "customer") &&
    !resolveShopifyProductId(item)
  ) {
    if (/^\d+$/.test(id)) return id;
  }
  return "";
}

/** Creator-parity nav first; Mockups/Metafields/Edit Design kept as admin extras. */
const DETAIL_MENUS = [
  { key: "overview", label: "Overview" },
  { key: "variants", label: "Variants" },
  { key: "channels", label: "Channels" },
  { key: "edit_design", label: "Edit Design" },
  { key: "mockups", label: "Mockups" },
  { key: "metafields", label: "Metafields" },
];

const VALUE_TRUNCATE = 160;

const state = {
  loading: false,
  error: "",
  items: [],
  fetchGen: 0,
  detail: {
    open: false,
    loading: false,
    error: "",
    menu: "overview",
    productId: "",
    title: "",
    preview: null,
    data: null,
    expandedValues: new Set(),
    channelState: {},
    amazonExpanded: false,
    editDesignUi: null,
    editDesignLoadedFor: "",
    closePromptOpen: false,
  },
};

function statusLabel(isActive) {
  const n = Number(isActive);
  if (n === 2) return "Online";
  if (n === 1) return "Preview";
  return "Offline";
}

function statusBadgeClass(isActive) {
  const n = Number(isActive);
  if (n === 2) return "badge-success";
  if (n === 1) return "badge-warning";
  return "badge-neutral";
}

function formatMoney(amount, currency) {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return escapeHtml(String(amount));
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "EUR",
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ""}`.trim();
  }
}

function overlayStyleFromPlacement(placement) {
  const zone = placement?.zone || {};
  const zl = Math.max(0, Math.min(1, Number(zone.l) || 0.28));
  const zt = Math.max(0, Math.min(1, Number(zone.t) || 0.22));
  const zw = Math.max(0.05, Math.min(1, Number(zone.w) || 0.44));
  const zh = Math.max(0.05, Math.min(1, Number(zone.h) || 0.48));
  const x = Math.max(0, Math.min(1, Number(placement?.x) || 0.5));
  const y = Math.max(0, Math.min(1, Number(placement?.y) || 0.5));
  const scale = Math.max(0.05, Math.min(2.5, Number(placement?.scale) || 0.95));
  const angle = Number(placement?.angle) || 0;
  return {
    left: (zl + x * zw) * 100,
    top: (zt + y * zh) * 100,
    width: zw * scale * 100,
    angle,
  };
}

function groupGridViews(views) {
  const groups = [];
  const byKey = new Map();
  (views || []).forEach((view) => {
    const label = String(view.variant_label || view.variant || "Default").trim() || "Default";
    if (!byKey.has(label)) {
      const group = { label, views: [] };
      byKey.set(label, group);
      groups.push(group);
    }
    byKey.get(label).views.push(view);
  });
  return groups;
}

function renderCardMedia(view) {
  if (!view || !view.src) return '<span class="cr-card__noimg">No image</span>';
  const activePlacement = view.design_placement || null;
  const overlay = activePlacement ? overlayStyleFromPlacement(activePlacement) : null;
  const overlayStyle = activePlacement
    ? `left:${overlay.left}%;top:${overlay.top}%;width:${overlay.width}%;transform:translate(-50%,-50%) rotate(${overlay.angle}deg);`
    : "";
  const overlayImg =
    view.design_url
      ? `<img class="cr-card__design-overlay" src="${escapeHtml(view.design_url)}" alt="" loading="lazy" decoding="async" data-cr-card-design-img style="${escapeHtml(overlayStyle)}" />`
      : "";
  return `<img src="${escapeHtml(view.src)}" alt="" loading="lazy" decoding="async" data-cr-card-img />${overlayImg}`;
}

function productCardHtml(item) {
  const title = item.title || item.product_key || "—";
  const views = Array.isArray(item.grid_views)
    ? item.grid_views.filter((v) => v && v.src)
    : [];
  if (!views.length && item.preview_url) views.push({ src: item.preview_url, view: "front", variant_label: "Default" });
  const groups = groupGridViews(views);
  const activeView = groups[0]?.views?.[0] || null;
  const thumbInner = renderCardMedia(activeView);
  const controls =
    views.length > 1
      ? `<div class="cr-card__nav" aria-label="Product media navigation">
          ${groups.length > 1 ? '<button type="button" class="cr-card__arrow cr-card__arrow--left" data-cr-grid-axis="variant" data-cr-grid-delta="-1" aria-label="Previous variant">‹</button><button type="button" class="cr-card__arrow cr-card__arrow--right" data-cr-grid-axis="variant" data-cr-grid-delta="1" aria-label="Next variant">›</button>' : ""}
          ${groups.some((g) => g.views.length > 1) ? '<button type="button" class="cr-card__arrow cr-card__arrow--up" data-cr-grid-axis="view" data-cr-grid-delta="-1" aria-label="Previous view">↑</button><button type="button" class="cr-card__arrow cr-card__arrow--down" data-cr-grid-axis="view" data-cr-grid-delta="1" aria-label="Next view">↓</button>' : ""}
        </div>`
      : "";
  const shopifyId = resolveShopifyProductId(item);
  const studioListingId = resolveStudioListingId(item);
  const clickable = Boolean(shopifyId);
  const canUnpublish = Boolean(shopifyId || studioListingId);
  const filterKey = productSelectionKey(item);
  const dataAttrs = [
    clickable ? `data-shopify-id="${escapeHtml(String(shopifyId))}"` : "",
    studioListingId ? `data-studio-listing-id="${escapeHtml(String(studioListingId))}"` : "",
    canUnpublish || clickable ? `data-product-title="${escapeHtml(title)}"` : "",
    clickable ? `tabindex="0" role="button"` : "",
    filterKey ? `data-product-filter-key="${escapeHtml(filterKey)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<article class="cr-card cr-card--product${clickable ? " cr-card--clickable" : ""}${canUnpublish ? " cr-card--unpublishable" : ""}" data-product-key="${escapeHtml(item.product_key || item.id || "")}" data-cr-grid-groups="${escapeHtml(JSON.stringify(groups))}" data-cr-variant-index="0" data-cr-view-index="0"${dataAttrs ? ` ${dataAttrs}` : ""}>
    <div class="cr-card__title-row">
      ${filterKey ? productBulkCheckboxHtml(item) : ""}
      <h3 class="cr-card__title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
    </div>
    <div class="cr-card__thumb">
      <div class="cr-card__thumb-inner">${thumbInner}</div>
      ${controls}
    </div>
    <div class="cr-card__meta">
      ${item.category ? `<span class="cr-meta-chip">${escapeHtml(item.category)}</span>` : ""}
      ${item.owner_label ? `<span class="cr-meta-chip">${escapeHtml(item.owner_label)}</span>` : ""}
      <span class="cr-meta-chip badge ${statusBadgeClass(item.is_active)}">${escapeHtml(statusLabel(item.is_active))}</span>
      <span class="cr-meta-chip cr-meta-chip--muted">${escapeHtml(item.source_label || item.listing_bucket || "—")}</span>
    </div>
    ${
      item.needs_update
        ? `<div class="cr-card__needs-update" aria-label="Needs update"><span class="cr-card__needs-update-pill" title="Design or settings changed since last publish">needs Update</span></div>`
        : ""
    }
  </article>`;
}

function applyFilters() {
  let items = applyProductSidebarFilters(state.items);
  const busyKeys = getBusyProductKeys();
  const busyShopifyIds = getBusyShopifyIds();
  if (busyKeys.size || busyShopifyIds.size) {
    items = items.filter((p) => {
      const key = String(p.product_key || p.id || "").trim();
      const sid = String(p.shopify_product_id || p.id || "").trim();
      return !(busyKeys.has(key) || busyShopifyIds.has(sid));
    });
  }
  return items;
}

function emptyMessageForSource() {
  return "No products match your filters.";
}

function renderGrid() {
  const grid = document.getElementById("cr-products-grid");
  const empty = document.getElementById("cr-products-empty");
  const loading = document.getElementById("cr-products-loading");
  const error = document.getElementById("cr-products-error");
  if (!grid) return;

  const visible = applyFilters();
  grid.innerHTML = visible.map(productCardHtml).join("");
  const hasRows = visible.length > 0;
  grid.hidden = !hasRows;
  if (empty) {
    empty.hidden = hasRows || state.loading || !!state.error;
    if (!empty.hidden) empty.textContent = emptyMessageForSource();
  }
  if (loading) loading.hidden = !state.loading;
  if (error) {
    error.hidden = !state.error;
    error.textContent = state.error;
  }
  const byKey = new Map(visible.map((item) => [productSelectionKey(item), item]));
  bindBulkCheckboxes(grid, { getItemByKey: (key) => byKey.get(key) });
}

function visibleProductsForBulk() {
  return applyFilters();
}

function dedupeKey(p) {
  const sid = String(p.shopify_product_id || "").trim();
  if (sid && !/^studio:/i.test(sid)) return `sid:${sid}`;
  const pk = String(p.product_key || "").trim();
  if (pk) return `pk:${pk}:${p.listing_bucket || p.source || ""}`;
  return `id:${p.id || Math.random()}`;
}

function tagBucket(products, { listingBucket, filterSource, filterProvider, sourceLabel, defaultCategory }) {
  return (products || []).map((p) => ({
    ...p,
    listing_bucket: listingBucket,
    filter_source: filterSource || null,
    filter_provider: filterProvider || p.filter_provider || null,
    source_label: p.source_label || sourceLabel,
    source: listingBucket,
    category: p.category || p.product_type || defaultCategory,
    is_active: p.is_active != null ? p.is_active : p.status === "ACTIVE" ? 2 : 0,
    filter_product_key: p.filter_product_key || p.product_key || null,
    catalog_product_name: p.catalog_product_name || p.product_key || p.title || null,
  }));
}

async function fetchBucket(op) {
  try {
    const data = await partnerFetch(op);
    return { ok: true, products: Array.isArray(data.products) ? data.products : [], data };
  } catch (e) {
    if (e.data?.error === "shopify_not_configured") {
      return { ok: false, shopifyMissing: true, products: [], error: e };
    }
    return { ok: false, products: [], error: e };
  }
}

/** Load Printify + Todify + Customer + Samples + Other (residual) in parallel. */
async function loadAllProductBuckets() {
  const [printify, todify, customer, samples, other] = await Promise.all([
    fetchBucket("admin-creations-printify-products"),
    fetchBucket("admin-creations-todify-products"),
    fetchBucket("admin-creations-customer-products"),
    fetchBucket("admin-creations-samples-products"),
    fetchBucket("admin-creations-shopify-products"),
  ]);

  if (
    printify.shopifyMissing &&
    todify.shopifyMissing &&
    samples.shopifyMissing &&
    other.shopifyMissing &&
    !customer.ok
  ) {
    state.items = [];
    state.error = "Shopify API is not configured on this worker yet.";
    return;
  }

  const merged = [];
  const seen = new Set();
  const pushAll = (rows) => {
    for (const p of rows) {
      const key = dedupeKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
  };

  pushAll(
    tagBucket(printify.products, {
      listingBucket: "printify",
      filterSource: "product",
      filterProvider: "printify",
      sourceLabel: "Printify",
      defaultCategory: "Printify",
    })
  );
  pushAll(
    tagBucket(todify.products, {
      listingBucket: "todify",
      filterSource: "product",
      filterProvider: "todify",
      sourceLabel: "Todify",
      defaultCategory: "Todify",
    })
  );
  pushAll(
    tagBucket(customer.products, {
      listingBucket: "customer",
      filterSource: "customer",
      filterProvider: null,
      sourceLabel: "Customer",
      defaultCategory: "Customer products",
    }).map((p) => ({ ...p, is_active: p.is_active != null ? p.is_active : 2 }))
  );
  pushAll(
    tagBucket(samples.products, {
      listingBucket: "samples",
      filterSource: "samples",
      filterProvider: null,
      sourceLabel: "Samples",
      defaultCategory: "Personalizable samples",
    })
  );
  pushAll(
    tagBucket(other.products, {
      listingBucket: "other",
      filterSource: "other",
      filterProvider: null,
      sourceLabel: "Other",
      defaultCategory: "Other",
    })
  );

  const hardErrors = [printify, todify, customer, samples, other].filter((r) => !r.ok && !r.shopifyMissing && r.error);
  if (!merged.length && hardErrors.length) {
    throw hardErrors[0].error;
  }

  state.items = merged;
}

/** Lighter refresh after a bulk action — keeps sidebar filter state. */
async function refreshProductsAfterBulk() {
  try {
    await loadAllProductBuckets();
  } catch (e) {
    showToast("Error", e.message || "Could not refresh products");
  } finally {
    const el = document.getElementById("view-products");
    refreshFilterSidebarBody(el);
    renderGrid();
  }
}

async function fetchProducts() {
  const gen = ++state.fetchGen;
  state.loading = true;
  state.error = "";
  renderGrid();

  try {
    await loadAllProductBuckets();
    if (gen !== state.fetchGen) return;
  } catch (e) {
    if (gen !== state.fetchGen) return;
    const msg = e.message || "Could not load products";
    state.error = msg;
    state.items = [];
    showToast("Error", msg);
  } finally {
    if (gen !== state.fetchGen) return;
    state.loading = false;
    const el = document.getElementById("view-products");
    refreshFilterSidebarBody(el);
    renderGrid();
  }
}

function pageShellHtml() {
  const filterCollapsed = isFilterSidebarCollapsed();
  return `
    <div class="catalog-studio cr-products-studio${filterCollapsed ? " catalog-studio--filter-collapsed" : ""}">
      <div class="catalog-studio-filter-wrap">
        <aside class="catalog-studio-filter-sidebar" id="cr-pf-sidebar">
          <div class="catalog-studio-sidebar-head">
            <span class="catalog-studio-sidebar-label">Filters</span>
          </div>
          <div class="cr-pf-body" id="cr-pf-body">${filterSidebarInnerHtml(computeFacetsFromItems(state.items))}</div>
        </aside>
        <button type="button" class="catalog-studio-rail catalog-studio-filter-rail" id="cr-pf-toggle" aria-label="${
          filterCollapsed ? "Expand" : "Collapse"
        } filter sidebar" title="${filterCollapsed ? "Expand" : "Collapse"}">
          <span class="catalog-studio-rail__arrow-zone" aria-hidden="true"><span class="catalog-studio-rail__arrow">‹</span></span>
          <span class="catalog-studio-rail__labels">
            <span class="catalog-studio-rail__section">Filter</span>
            <span class="catalog-studio-rail__action">${filterCollapsed ? "Expand" : "Collapse"}</span>
          </span>
        </button>
      </div>
      <div class="catalog-studio-main">
        <div class="cr-stage">
          <p class="cr-loading" id="cr-products-loading">Loading products…</p>
          <p class="cr-error" id="cr-products-error" hidden role="alert"></p>
          <div class="cr-grid cr-grid--products" id="cr-products-grid" hidden></div>
          <p class="cr-empty" id="cr-products-empty" hidden>No products match your filters.</p>
        </div>
      </div>
    </div>`;
}

/** Re-render the sidebar facet sections + counts from the currently loaded items. */
function refreshFilterSidebarBody(el) {
  const body = el?.querySelector("#cr-pf-body");
  if (!body) return;
  body.innerHTML = filterSidebarInnerHtml(computeFacetsFromItems(state.items));
  bindFilterSidebar(body, {
    onChange: () => renderGrid(),
  });
}

function bindFilterSidebarToggle(el) {
  const studioEl = el.querySelector(".cr-products-studio");
  const toggle = el.querySelector("#cr-pf-toggle");
  if (!studioEl || !toggle) return;
  toggle.onclick = () => {
    const next = !isFilterSidebarCollapsed();
    setFilterSidebarCollapsed(next);
    studioEl.classList.toggle("catalog-studio--filter-collapsed", next);
    const label = toggle.querySelector(".catalog-studio-rail__action");
    if (label) label.textContent = next ? "Expand" : "Collapse";
    toggle.setAttribute("aria-label", next ? "Expand filter sidebar" : "Collapse filter sidebar");
    toggle.title = next ? "Expand" : "Collapse";
  };
}

function wireProductsBulkDock() {
  ensureProductsBulkDock(null, {
    onSelectAll: () => selectAllProductsVisible(visibleProductsForBulk()),
    onPublish: (items) => openProductsBulkPublishModal(items, { onDone: refreshProductsAfterBulk }),
    onUnpublish: (items) => openProductsBulkUnpublishModal(items, { onDone: refreshProductsAfterBulk }),
    onUpdate: (items) => openProductsBulkUpdateModal(items, { onDone: refreshProductsAfterBulk }),
  });
}

function detailModalHtml() {
  return `
    <div class="cr-pd-modal cr-pd-modal--fullscreen" role="dialog" aria-modal="true" aria-labelledby="cr-pd-title">
      <div class="cr-pd-modal__head">
        <div class="cr-pd-modal__head-text">
          <h2 id="cr-pd-title">Product</h2>
          <p class="cr-pd-modal__sub" id="cr-pd-sub" hidden></p>
        </div>
        <button type="button" class="icon-btn" id="cr-pd-close" aria-label="Close">×</button>
      </div>
      <div class="cr-pd-modal__body">
        <nav class="cr-pd-nav" id="cr-pd-nav" aria-label="Product detail sections">
          ${DETAIL_MENUS.map(
            (m) =>
              `<button type="button" class="cr-pd-nav__btn" data-cr-pd-menu="${m.key}" title="${escapeHtml(m.label)}">${escapeHtml(m.label)}</button>`
          ).join("")}
        </nav>
        <div class="cr-pd-content" id="cr-pd-content"></div>
      </div>
    </div>`;
}

let detailModalBound = false;

/**
 * Product detail must live on document.body.
 * #view-products.layout-stage keeps animation-fill transform:translateY(0), which makes
 * position:fixed descendants relative to the tall scrollable view — backdrop blur shows
 * in the viewport while the white modal panel is centered off-screen.
 */
function ensureDetailDom() {
  let backdrop = document.getElementById("cr-pd-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "cr-pd-backdrop";
    backdrop.className = "cr-pd-backdrop";
    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.innerHTML = detailModalHtml();
    document.body.appendChild(backdrop);
    detailModalBound = false;
  }
  if (backdrop.parentElement !== document.body) {
    document.body.appendChild(backdrop);
    detailModalBound = false;
  }
  if (!detailModalBound) {
    bindDetailModal(backdrop);
    detailModalBound = true;
  }
  return backdrop;
}

function truncateValue(value, id) {
  const raw = String(value ?? "");
  const expanded = state.detail.expandedValues.has(id);
  if (raw.length <= VALUE_TRUNCATE || expanded) {
    const collapse =
      raw.length > VALUE_TRUNCATE
        ? `<button type="button" class="cr-pd-expand" data-cr-pd-expand="${escapeHtml(id)}">Show less</button>`
        : "";
    return `<pre class="cr-pd-value">${escapeHtml(raw)}</pre>${collapse}`;
  }
  return `<pre class="cr-pd-value">${escapeHtml(raw.slice(0, VALUE_TRUNCATE))}…</pre><button type="button" class="cr-pd-expand" data-cr-pd-expand="${escapeHtml(id)}">Show more</button>`;
}

function renderMockupsPanel(product) {
  const mockups = Array.isArray(product?.mockups) ? product.mockups : [];
  if (!mockups.length) {
    return `<div class="cr-pd-empty">No mockups for this product. Gift cards and simple listings often have none.</div>`;
  }

  const groups = new Map();
  for (const m of mockups) {
    const key = m.variant_label || "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  let html = "";
  for (const [variant, items] of groups) {
    html += `<section class="cr-pd-mockup-group">
      <h3 class="cr-pd-section-title">${escapeHtml(variant)}</h3>
      <div class="cr-pd-mockup-grid">
        ${items
          .map(
            (m) => `<figure class="cr-pd-mockup">
              ${m.src ? `<img src="${escapeHtml(m.src)}" alt="${escapeHtml(m.alt || m.view || "")}" loading="lazy" />` : `<div class="cr-pd-mockup__missing">No image</div>`}
              <figcaption>${escapeHtml(m.view || "other")}${m.is_preview ? " · preview" : ""}</figcaption>
            </figure>`
          )
          .join("")}
      </div>
    </section>`;
  }
  return html;
}

function renderVariantsPanel(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) {
    return `<div class="cr-pd-empty">No variants found.</div>`;
  }
  const currency = product.currency || "EUR";
  return `<div class="cr-pd-table-wrap"><table class="cr-pd-table">
    <thead>
      <tr>
        <th>Variant</th>
        <th>SKU</th>
        <th>Price</th>
        <th>Compare at</th>
        <th>Inventory</th>
      </tr>
    </thead>
    <tbody>
      ${variants
        .map((v) => {
          const title =
            (Array.isArray(v.options) && v.options.length ? v.options.join(" / ") : null) ||
            v.title ||
            "Default";
          return `<tr>
            <td>${escapeHtml(title)}</td>
            <td>${escapeHtml(v.sku || "—")}</td>
            <td>${formatMoney(v.price, currency)}</td>
            <td>${formatMoney(v.compare_at_price, currency)}</td>
            <td>${v.inventory_quantity != null ? escapeHtml(String(v.inventory_quantity)) : "—"}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>`;
}

function metafieldRowsHtml(rows, sectionPrefix) {
  if (!rows.length) return `<div class="cr-pd-empty">None</div>`;
  const byGroup = new Map();
  for (const m of rows) {
    const g = m.group || m.namespace || "other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(m);
  }
  let html = "";
  for (const [group, items] of byGroup) {
    html += `<div class="cr-pd-mf-group"><h4 class="cr-pd-mf-group__title">${escapeHtml(group)}</h4>`;
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const id = `${sectionPrefix}:${m.namespace}.${m.key}:${i}`;
      const label = m.label || `${m.namespace}.${m.key}`;
      html += `<div class="cr-pd-mf-row">
        <div class="cr-pd-mf-row__key">
          <strong>${escapeHtml(label)}</strong>
          <code>${escapeHtml(`${m.namespace}.${m.key}`)}</code>
        </div>
        <div class="cr-pd-mf-row__val">${truncateValue(m.value, id)}</div>
      </div>`;
    }
    html += `</div>`;
  }
  return html;
}

function renderMetafieldsPanel(product) {
  const mf = product?.metafields || {};
  const dbOnly = Array.isArray(mf.in_database_not_in_shopify) ? mf.in_database_not_in_shopify : [];
  const shopify = Array.isArray(mf.used_in_shopify) ? mf.used_in_shopify : [];
  return `
    <section class="cr-pd-mf-section">
      <h3 class="cr-pd-section-title">In database, not in Shopify</h3>
      <p class="cr-pd-hint">Catalog / publish-profile values that are missing or empty on this Shopify product.</p>
      ${metafieldRowsHtml(dbOnly, "db")}
    </section>
    <section class="cr-pd-mf-section">
      <h3 class="cr-pd-section-title">Used in Shopify</h3>
      <p class="cr-pd-hint">Metafields currently set on the Shopify product.</p>
      ${metafieldRowsHtml(shopify, "shop")}
    </section>`;
}

function syncDetailStudioChrome() {
  const modal = document.querySelector("#cr-pd-backdrop .cr-pd-modal");
  if (!modal) return;
  // Fullscreen for the whole product modal; Edit Design uses denser content chrome.
  modal.classList.add("cr-pd-modal--fullscreen");
  modal.classList.toggle("cr-pd-modal--studio", state.detail.menu === "edit_design");
}

function renderDetailContent() {
  const content = document.getElementById("cr-pd-content");
  const titleEl = document.getElementById("cr-pd-title");
  const subEl = document.getElementById("cr-pd-sub");
  if (!content) return;

  if (titleEl) titleEl.textContent = state.detail.title || "Product";
  if (subEl) {
    const p = state.detail.data;
    const bits = [];
    if (p?.product_key) bits.push(p.product_key);
    if (p?.handle) bits.push(`/${p.handle}`);
    if (p?.status) bits.push(p.status);
    subEl.textContent = bits.join(" · ");
    subEl.hidden = !bits.length;
  }

  syncDetailStudioChrome();

  document.querySelectorAll("[data-cr-pd-menu]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.crPdMenu === state.detail.menu);
  });

  if (state.detail.loading) {
    content.innerHTML = `<p class="cr-pd-loading">Loading product details…</p>`;
    return;
  }
  if (state.detail.error) {
    content.innerHTML = `<p class="cr-pd-error" role="alert">${escapeHtml(state.detail.error)}</p>`;
    return;
  }
  const product = state.detail.data;
  if (!product) {
    content.innerHTML = `<p class="cr-pd-empty">No product data.</p>`;
    return;
  }

  if (state.detail.menu === "overview") content.innerHTML = renderOverviewPanelHtml(product);
  else if (state.detail.menu === "variants") content.innerHTML = renderVariantsPanel(product);
  else if (state.detail.menu === "channels") {
    const chUi = {
      channelState: state.detail.channelState,
      amazonExpanded: state.detail.amazonExpanded,
      product,
      onChange: () => {
        state.detail.amazonExpanded = chUi.amazonExpanded;
        renderDetailContent();
      },
      onProductPatch: (patch) => {
        state.detail.data = { ...state.detail.data, ...patch };
        if (patch.amazon_publish) {
          state.detail.data.amazon_publish = {
            ...(state.detail.data.amazon_publish || {}),
            ...patch.amazon_publish,
          };
        }
      },
    };
    content.innerHTML = renderChannelsPanelHtml(product, chUi);
    bindChannelsPanel(content, chUi);
  } else if (state.detail.menu === "edit_design") {
    kickEditDesignLoad();
    const edUi = state.detail.editDesignUi || {
      loading: true,
      error: "",
      editDesign: null,
      activePos: "front",
      working: {},
      savedBaseline: {},
      pendingUpdate: false,
      busy: false,
    };
    edUi.onRerender = () => renderDetailContent();
    edUi.onDirtyChange = () => {};
    content.innerHTML = renderEditDesignPanelHtml(edUi);
    if (edUi.editDesign && !edUi.loading && !edUi.error) bindEditDesignPanel(content, edUi);
  } else if (state.detail.menu === "metafields") content.innerHTML = renderMetafieldsPanel(product);
  else content.innerHTML = renderMockupsPanel(product);

  content.querySelectorAll("[data-cr-pd-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.crPdExpand;
      if (!id) return;
      if (state.detail.expandedValues.has(id)) state.detail.expandedValues.delete(id);
      else state.detail.expandedValues.add(id);
      renderDetailContent();
    });
  });
}

function isDetailBackdropOpen(backdrop) {
  return !!(backdrop && (backdrop.classList.contains("show") || !backdrop.hidden));
}

function kickEditDesignLoad() {
  const id = state.detail.productId;
  if (!id) return;
  if (state.detail.editDesignLoadedFor === id && state.detail.editDesignUi) return;

  state.detail.editDesignLoadedFor = id;
  state.detail.editDesignUi = {
    loading: true,
    error: "",
    editDesign: null,
    activePos: "front",
    working: {},
    savedBaseline: {},
    pendingUpdate: false,
    busy: false,
  };

  loadEditDesignForProduct(id)
    .then((ui) => {
      if (state.detail.productId !== id) return;
      state.detail.editDesignUi = ui;
      if (state.detail.menu === "edit_design") renderDetailContent();
    })
    .catch((e) => {
      if (state.detail.productId !== id) return;
      state.detail.editDesignUi = {
        loading: false,
        error: e.message || "Could not load Edit Design",
        editDesign: null,
        activePos: "front",
        working: {},
        savedBaseline: {},
        pendingUpdate: false,
        busy: false,
      };
      if (state.detail.menu === "edit_design") renderDetailContent();
    });
}

function closeProductDetail() {
  state.detail.open = false;
  state.detail.loading = false;
  state.detail.error = "";
  state.detail.data = null;
  state.detail.productId = "";
  state.detail.expandedValues = new Set();
  state.detail.editDesignUi = null;
  state.detail.editDesignLoadedFor = "";
  state.detail.closePromptOpen = false;
  const backdrop = document.getElementById("cr-pd-backdrop");
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.classList.remove("show");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.querySelector(".cr-pd-modal")?.classList.remove("cr-pd-modal--studio");
  }
  document.body.classList.remove("cr-pd-open");
  document.removeEventListener("keydown", onDetailKeydown);
}

function requestCloseProductDetail() {
  if (state.detail.closePromptOpen) return;
  if (!isEditDesignDirty(state.detail.editDesignUi)) {
    closeProductDetail();
    return;
  }
  state.detail.closePromptOpen = true;
  confirmUnsavedChanges({
    title: "Unsaved changes",
    bodyHtml: `<p class="confirm-modal-message">You have unsaved Edit Design changes. Save them, discard them, or cancel to keep editing.</p>`,
    saveLabel: "Save",
    discardLabel: "Discard",
    cancelLabel: "Cancel",
    onCancel: () => {
      state.detail.closePromptOpen = false;
    },
    onDiscard: () => {
      state.detail.closePromptOpen = false;
      discardEditDesignWorking(state.detail.editDesignUi);
      closeProductDetail();
    },
    onSave: async () => {
      state.detail.closePromptOpen = false;
      try {
        await saveEditDesignWorking(state.detail.editDesignUi);
        if (!isEditDesignDirty(state.detail.editDesignUi)) closeProductDetail();
        else if (state.detail.menu === "edit_design") renderDetailContent();
      } catch (e) {
        showToast("Error", e.message || "Save failed");
        /* keep modal open */
      }
    },
  });
}

function onDetailKeydown(e) {
  if (e.key !== "Escape") return;
  const backdrop = document.getElementById("cr-pd-backdrop");
  // Defensive: close even if state drifted but backdrop/blur is still visible.
  if (state.detail.open || isDetailBackdropOpen(backdrop)) {
    e.preventDefault();
    requestCloseProductDetail();
  }
}

async function openProductDetail(productId, title) {
  const id = String(productId || "").trim();
  if (!id) return;

  state.detail.open = true;
  state.detail.loading = true;
  state.detail.error = "";
  state.detail.menu = "overview";
  state.detail.productId = id;
  state.detail.title = title || "Product";
  state.detail.data = null;
  state.detail.expandedValues = new Set();
  state.detail.channelState = { eazpire: { status: "published", queue: false } };
  state.detail.amazonExpanded = false;
  state.detail.editDesignUi = null;
  state.detail.editDesignLoadedFor = "";
  state.detail.closePromptOpen = false;

  const backdrop = ensureDetailDom();
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.add("show");
    backdrop.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("cr-pd-open");
  document.removeEventListener("keydown", onDetailKeydown);
  document.addEventListener("keydown", onDetailKeydown);
  renderDetailContent();

  try {
    const data = await partnerFetch("admin-creations-shopify-product-detail", {
      query: { product_id: id },
    });
    if (state.detail.productId !== id) return;
    state.detail.data = data.product || null;
    if (data.product?.title) state.detail.title = data.product.title;
    state.detail.channelState = seedChannelStateFromProduct(data.product || {});
  } catch (e) {
    if (state.detail.productId !== id) return;
    state.detail.error = e.message || "Could not load product detail";
    showToast("Error", state.detail.error);
  } finally {
    if (state.detail.productId !== id) return;
    state.detail.loading = false;
    renderDetailContent();
  }
}

function bindDetailModal(backdrop) {
  backdrop.querySelector("#cr-pd-close")?.addEventListener("click", requestCloseProductDetail);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop || e.target?.id === "cr-pd-backdrop") requestCloseProductDetail();
  });
  backdrop.querySelectorAll("[data-cr-pd-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const menu = btn.dataset.crPdMenu;
      if (!menu || state.detail.menu === menu) return;
      state.detail.menu = menu;
      renderDetailContent();
    });
  });
}

function bindProductCards(el) {
  const grid = el.querySelector("#cr-products-grid");
  grid?.addEventListener("click", (e) => {
    const navBtn = e.target.closest("[data-cr-grid-axis]");
    if (navBtn) {
      e.preventDefault();
      e.stopPropagation();
      const card = navBtn.closest(".cr-card--product");
      if (!card) return;
      let groups = [];
      try {
        groups = JSON.parse(card.dataset.crGridGroups || "[]") || [];
      } catch {}
      if (!groups.length) return;
      const axis = navBtn.dataset.crGridAxis;
      const delta = Number(navBtn.dataset.crGridDelta) || 0;
      let variantIndex = Number(card.dataset.crVariantIndex) || 0;
      let viewIndex = Number(card.dataset.crViewIndex) || 0;
      if (axis === "variant" && groups.length > 1) {
        variantIndex = (variantIndex + delta + groups.length) % groups.length;
        viewIndex = 0;
      } else if (axis === "view") {
        const currentGroup = groups[variantIndex] || groups[0];
        const len = currentGroup?.views?.length || 1;
        viewIndex = (viewIndex + delta + len) % len;
      }
      const group = groups[variantIndex] || groups[0];
      const view = group?.views?.[viewIndex] || group?.views?.[0];
      const thumb = card.querySelector(".cr-card__thumb-inner");
      if (thumb && view) thumb.innerHTML = renderCardMedia(view);
      card.dataset.crVariantIndex = String(variantIndex);
      card.dataset.crViewIndex = String(viewIndex);
      return;
    }
    const card = e.target.closest(".cr-card--product[data-shopify-id]");
    if (!card?.dataset?.shopifyId) return;
    openProductDetail(card.dataset.shopifyId, card.dataset.productTitle);
  });
  grid?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest?.(".cr-card--product[data-shopify-id]");
    if (!card?.dataset?.shopifyId) return;
    e.preventDefault();
    openProductDetail(card.dataset.shopifyId, card.dataset.productTitle);
  });
  bindCardContextMenu(grid, ".cr-card--product[data-shopify-id], .cr-card--product[data-studio-listing-id]", (card, event) => {
    const shopifyId = card.dataset.shopifyId || "";
    const studioListingId = card.dataset.studioListingId || "";
    const title = card.dataset.productTitle || "";
    if (!shopifyId && !studioListingId) return;
    openContextMenu(event, [{ label: "Unpublish", action: "unpublish" }], async (action) => {
      if (action !== "unpublish") return;
      await openProductUnpublishModal({ shopifyId, studioListingId, title });
    });
  });
}

/** Hide body-mounted product modal when leaving Products (modal stays on document.body). */
export function teardownProductDetailModal() {
  closeProductDetail();
  teardownContextMenu();
}

export async function mountProductsPage() {
  const el = document.getElementById("view-products");
  if (!el) return;

  try {
    // Close/clear any leftover body-mounted modal, bulk selection or action dock from a previous visit.
    closeProductDetail();
    teardownProductsExtras();
    el.innerHTML = pageShellHtml();
    bindFilterSidebarToggle(el);
    refreshFilterSidebarBody(el);
    wireProductsBulkDock();
    setBusyChangeListener(() => renderGrid());
    ensureDetailDom();
    bindProductCards(el);
    await fetchProducts();
  } catch (e) {
    el.innerHTML = `
      <div class="cr-stage">
        <p class="cr-error" role="alert">Could not open Products page: ${escapeHtml(e.message || String(e))}</p>
      </div>`;
    showToast("Error", e.message || String(e));
  }
}
