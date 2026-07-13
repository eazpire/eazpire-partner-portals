import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";

const SOURCE_FILTERS = [
  { key: "printify", label: "Printify" },
  { key: "customer", label: "Customer" },
  { key: "shopify", label: "Shopify" },
];

const state = {
  source: "printify",
  category: "all",
  q: "",
  qDebounced: "",
  loading: false,
  error: "",
  items: [],
  categories: [],
  categoryTree: [],
  searchTimer: null,
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

function categoriesForToolbar() {
  const cats = [{ key: "all", label: "All", count: state.items.length }];
  const seen = new Set(["all"]);
  for (const group of state.categoryTree || []) {
    for (const child of group.children || []) {
      if (!child?.name || seen.has(child.name)) continue;
      seen.add(child.name);
      cats.push({ key: child.name, label: child.name, count: child.count });
    }
  }
  for (const p of state.items) {
    const cat = p.category;
    if (!cat || seen.has(cat)) continue;
    seen.add(cat);
    cats.push({
      key: cat,
      label: cat,
      count: state.items.filter((x) => x.category === cat).length,
    });
  }
  return cats;
}

function filterToolbarHtml() {
  const cats = categoriesForToolbar();
  return `
    <div class="cr-toolbar panel">
      <div class="cr-toolbar__row cr-toolbar__row--primary">
        <div class="cr-search" role="search">
          <span aria-hidden="true">⌕</span>
          <input type="search" id="cr-products-search" placeholder="Search products…" aria-label="Search products" autocomplete="off" value="${escapeHtml(state.q)}" />
        </div>
      </div>
      <div class="cr-toolbar__row">
        <div class="cr-filter-group cr-filter-group--carousel">
          <span class="cr-filter-label">Category</span>
          <div class="cr-carousel" id="cr-cat-carousel">
            <button type="button" class="cr-carousel__arrow cr-carousel__arrow--prev" id="cr-cat-prev" aria-label="Scroll categories left">‹</button>
            <div class="cr-carousel__track" id="cr-cat-track">
              ${cats
                .map(
                  (c) =>
                    `<button type="button" class="cr-chip ${state.category === c.key ? "active" : ""}" data-cr-category="${escapeHtml(c.key)}">${escapeHtml(c.label)}${c.count != null ? `<span class="cr-chip__count">${c.count}</span>` : ""}</button>`
                )
                .join("")}
            </div>
            <button type="button" class="cr-carousel__arrow cr-carousel__arrow--next" id="cr-cat-next" aria-label="Scroll categories right">›</button>
          </div>
        </div>
      </div>
      <div class="cr-toolbar__row">
        <div class="cr-filter-group">
          <span class="cr-filter-label">Source</span>
          <div class="cr-chips" role="group" aria-label="Product source">
            ${SOURCE_FILTERS.map(
              (f) =>
                `<button type="button" class="cr-chip ${state.source === f.key ? "active" : ""}" data-cr-source="${f.key}">${escapeHtml(f.label)}</button>`
            ).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

function productCardHtml(item) {
  const title = item.title || item.product_key || "—";
  const img = (item.images && item.images[0]) || item.preview_url || "";
  const thumbInner =
    img && String(img).trim()
      ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" />`
      : '<span class="cr-card__noimg">No image</span>';

  return `<article class="cr-card cr-card--product" data-product-key="${escapeHtml(item.product_key || item.id || "")}">
    <div class="cr-card__title-row">
      <h3 class="cr-card__title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
    </div>
    <div class="cr-card__thumb">
      <div class="cr-card__thumb-inner">${thumbInner}</div>
    </div>
    <div class="cr-card__meta">
      ${item.category ? `<span class="cr-meta-chip">${escapeHtml(item.category)}</span>` : ""}
      ${item.owner_label ? `<span class="cr-meta-chip">${escapeHtml(item.owner_label)}</span>` : ""}
      <span class="cr-meta-chip badge ${statusBadgeClass(item.is_active)}">${escapeHtml(statusLabel(item.is_active))}</span>
      <span class="cr-meta-chip cr-meta-chip--muted">${escapeHtml(item.source_label || state.source)}</span>
    </div>
  </article>`;
}

function applyFilters() {
  let items = [...state.items];
  const needle = state.qDebounced.toLowerCase();
  if (needle) {
    items = items.filter((p) => {
      const hay = [p.title, p.product_key, p.category, p.owner_label, p.creator_name, p.parent_group]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  if (state.category !== "all") {
    items = items.filter((p) => p.category === state.category || p.parent_group === state.category);
  }
  return items;
}

function emptyMessageForSource() {
  if (state.source === "printify") {
    return "No Printify-sourced Shopify listings found (products with a Printify link).";
  }
  if (state.source === "shopify") {
    return "No native Shopify store products found (gift cards, samples, and other non-Printify items).";
  }
  if (state.source === "customer") {
    return "No Shop Design Studio customer products found.";
  }
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
}

function initCategoryCarousel(el) {
  const track = el.querySelector("#cr-cat-track");
  const prev = el.querySelector("#cr-cat-prev");
  const next = el.querySelector("#cr-cat-next");
  if (!track) return;
  const scrollBy = () => Math.max(160, track.clientWidth * 0.6);
  prev?.addEventListener("click", () => track.scrollBy({ left: -scrollBy(), behavior: "smooth" }));
  next?.addEventListener("click", () => track.scrollBy({ left: scrollBy(), behavior: "smooth" }));
}

async function loadPrintifyProducts() {
  try {
    const data = await partnerFetch("admin-creations-printify-products");
    const products = Array.isArray(data.products) ? data.products : [];
    state.items = products.map((p) => ({
      ...p,
      source_label: "Printify",
      product_key: p.product_key,
    }));
    state.categoryTree = Array.isArray(data.category_tree) ? data.category_tree : [];
  } catch (e) {
    if (e.data?.error === "shopify_not_configured") {
      state.items = [];
      state.categoryTree = [];
      state.error = "Shopify API is not configured on this worker yet.";
      return;
    }
    throw e;
  }
}

async function loadCustomerProducts() {
  const data = await partnerFetch("admin-creations-customer-products");
  const products = Array.isArray(data.products) ? data.products : [];
  state.items = products.map((p) => ({
    ...p,
    source_label: "Customer",
    category: p.category || "Customer products",
    is_active: 2,
  }));
  state.categoryTree = [];
}

async function loadShopifyProducts() {
  try {
    const data = await partnerFetch("admin-creations-shopify-products");
    const products = Array.isArray(data.products) ? data.products : [];
    state.items = products.map((p) => ({
      ...p,
      source_label: "Shopify",
      is_active: p.status === "ACTIVE" ? 2 : 0,
      category: p.category || p.product_type || "Shopify",
    }));
    state.categoryTree = [];
  } catch (e) {
    if (e.data?.error === "shopify_not_configured") {
      state.items = [];
      state.categoryTree = [];
      state.error = "Shopify API is not configured on this worker yet.";
      return;
    }
    throw e;
  }
}

async function fetchProducts() {
  if (state.loading) return;
  state.loading = true;
  state.error = "";
  renderGrid();

  try {
    if (state.source === "customer") await loadCustomerProducts();
    else if (state.source === "shopify") await loadShopifyProducts();
    else await loadPrintifyProducts();
    state.category = "all";
  } catch (e) {
    const msg = e.message || "Could not load products";
    state.error = msg;
    state.items = [];
    state.categoryTree = [];
    showToast("Error", msg);
  } finally {
    state.loading = false;
    const el = document.getElementById("view-products");
    const toolbar = el?.querySelector(".cr-toolbar");
    if (toolbar) toolbar.outerHTML = filterToolbarHtml();
    if (el) bindToolbar(el);
    renderGrid();
  }
}

function scheduleSearch() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.qDebounced = state.q;
    renderGrid();
  }, 220);
}

function bindToolbar(el) {
  if (!el) return;
  el.querySelector("#cr-products-search")?.addEventListener("input", (e) => {
    state.q = String(e.target.value || "").trim();
    scheduleSearch();
  });

  el.querySelectorAll("[data-cr-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.crSource;
      if (!next || state.source === next) return;
      state.source = next;
      fetchProducts();
    });
  });

  el.querySelectorAll("[data-cr-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.crCategory || "all";
      if (state.category === next) return;
      state.category = next;
      const toolbar = el.querySelector(".cr-toolbar");
      if (toolbar) toolbar.outerHTML = filterToolbarHtml();
      bindToolbar(el);
      renderGrid();
    });
  });

  initCategoryCarousel(el);
}

function pageShellHtml() {
  return `
    ${filterToolbarHtml()}
    <div class="cr-stage">
      <p class="cr-loading" id="cr-products-loading">Loading products…</p>
      <p class="cr-error" id="cr-products-error" hidden role="alert"></p>
      <div class="cr-grid cr-grid--products" id="cr-products-grid" hidden></div>
      <p class="cr-empty" id="cr-products-empty" hidden>No products match your filters.</p>
    </div>`;
}

export async function mountProductsPage() {
  const el = document.getElementById("view-products");
  if (!el) return;

  try {
    el.innerHTML = pageShellHtml();
    bindToolbar(el);
    await fetchProducts();
  } catch (e) {
    el.innerHTML = `
      <div class="cr-stage">
        <p class="cr-error" role="alert">Could not open Products page: ${escapeHtml(e.message || String(e))}</p>
      </div>`;
    showToast("Error", e.message || String(e));
  }
}
