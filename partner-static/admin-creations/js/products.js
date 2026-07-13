import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";

const SOURCE_FILTERS = [
  { key: "printify", label: "Printify" },
  { key: "customer", label: "Customer" },
  { key: "shopify", label: "Shopify" },
];

const DETAIL_MENUS = [
  { key: "mockups", label: "Mockups" },
  { key: "variants", label: "Variants" },
  { key: "metafields", label: "Metafields" },
];

const VALUE_TRUNCATE = 160;

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
  fetchGen: 0,
  detail: {
    open: false,
    loading: false,
    error: "",
    menu: "mockups",
    productId: "",
    title: "",
    preview: null,
    data: null,
    expandedValues: new Set(),
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
  const shopifyId = item.shopify_product_id || item.id || "";
  const clickable = state.source === "shopify" && shopifyId;

  return `<article class="cr-card cr-card--product${clickable ? " cr-card--clickable" : ""}" data-product-key="${escapeHtml(item.product_key || item.id || "")}"${clickable ? ` data-shopify-id="${escapeHtml(String(shopifyId))}" data-product-title="${escapeHtml(title)}" tabindex="0" role="button"` : ""}>
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
    return "No native Shopify store products found (gift cards and sample templates with custom.sample = yes).";
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

function refreshToolbar(el) {
  const toolbar = el?.querySelector(".cr-toolbar");
  if (toolbar) toolbar.outerHTML = filterToolbarHtml();
  if (el) bindToolbar(el);
}

async function fetchProducts() {
  const gen = ++state.fetchGen;
  state.loading = true;
  state.error = "";
  renderGrid();

  try {
    if (state.source === "customer") await loadCustomerProducts();
    else if (state.source === "shopify") await loadShopifyProducts();
    else await loadPrintifyProducts();
    if (gen !== state.fetchGen) return;
    state.category = "all";
  } catch (e) {
    if (gen !== state.fetchGen) return;
    const msg = e.message || "Could not load products";
    state.error = msg;
    state.items = [];
    state.categoryTree = [];
    showToast("Error", msg);
  } finally {
    if (gen !== state.fetchGen) return;
    state.loading = false;
    const el = document.getElementById("view-products");
    refreshToolbar(el);
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
      state.category = "all";
      state.error = "";
      state.items = [];
      state.categoryTree = [];
      refreshToolbar(el);
      renderGrid();
      fetchProducts();
    });
  });

  el.querySelectorAll("[data-cr-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.crCategory || "all";
      if (state.category === next) return;
      state.category = next;
      refreshToolbar(el);
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
    </div>
    <div id="cr-pd-backdrop" class="cr-pd-backdrop" hidden>
      <div class="cr-pd-modal" role="dialog" aria-modal="true" aria-labelledby="cr-pd-title">
        <div class="cr-pd-modal__head">
          <div class="cr-pd-modal__head-text">
            <h2 id="cr-pd-title">Product</h2>
            <p class="cr-pd-modal__sub" id="cr-pd-sub" hidden></p>
          </div>
          <button type="button" class="icon-btn" id="cr-pd-close" aria-label="Close">×</button>
        </div>
        <div class="cr-pd-modal__body">
          <nav class="cr-pd-nav" aria-label="Product detail sections">
            ${DETAIL_MENUS.map(
              (m) =>
                `<button type="button" class="cr-pd-nav__btn" data-cr-pd-menu="${m.key}">${escapeHtml(m.label)}</button>`
            ).join("")}
          </nav>
          <div class="cr-pd-content" id="cr-pd-content"></div>
        </div>
      </div>
    </div>`;
}

function ensureDetailDom() {
  return document.getElementById("cr-pd-backdrop");
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

  if (state.detail.menu === "variants") content.innerHTML = renderVariantsPanel(product);
  else if (state.detail.menu === "metafields") content.innerHTML = renderMetafieldsPanel(product);
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

function closeProductDetail() {
  state.detail.open = false;
  state.detail.loading = false;
  state.detail.error = "";
  state.detail.data = null;
  state.detail.productId = "";
  state.detail.expandedValues = new Set();
  const backdrop = ensureDetailDom();
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.classList.remove("show");
  }
  document.removeEventListener("keydown", onDetailKeydown);
}

function onDetailKeydown(e) {
  if (e.key === "Escape") closeProductDetail();
}

async function openProductDetail(productId, title) {
  const id = String(productId || "").trim();
  if (!id) return;

  state.detail.open = true;
  state.detail.loading = true;
  state.detail.error = "";
  state.detail.menu = "mockups";
  state.detail.productId = id;
  state.detail.title = title || "Product";
  state.detail.data = null;
  state.detail.expandedValues = new Set();

  const backdrop = ensureDetailDom();
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.add("show");
  }
  document.addEventListener("keydown", onDetailKeydown);
  renderDetailContent();

  try {
    const data = await partnerFetch("admin-creations-shopify-product-detail", {
      query: { product_id: id },
    });
    if (state.detail.productId !== id) return;
    state.detail.data = data.product || null;
    if (data.product?.title) state.detail.title = data.product.title;
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

function bindDetailModal(el) {
  el.querySelector("#cr-pd-close")?.addEventListener("click", closeProductDetail);
  el.querySelector("#cr-pd-backdrop")?.addEventListener("click", (e) => {
    if (e.target?.id === "cr-pd-backdrop") closeProductDetail();
  });
  el.querySelectorAll("[data-cr-pd-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const menu = btn.dataset.crPdMenu;
      if (!menu || state.detail.menu === menu) return;
      state.detail.menu = menu;
      renderDetailContent();
    });
  });
}

function bindProductCards(el) {
  el.querySelector("#cr-products-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest(".cr-card--product[data-shopify-id]");
    if (!card || state.source !== "shopify") return;
    openProductDetail(card.dataset.shopifyId, card.dataset.productTitle);
  });
  el.querySelector("#cr-products-grid")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest?.(".cr-card--product[data-shopify-id]");
    if (!card || state.source !== "shopify") return;
    e.preventDefault();
    openProductDetail(card.dataset.shopifyId, card.dataset.productTitle);
  });
}

export async function mountProductsPage() {
  const el = document.getElementById("view-products");
  if (!el) return;

  try {
    el.innerHTML = pageShellHtml();
    bindToolbar(el);
    bindDetailModal(el);
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
