import { escapeHtml } from "/shared/js/partner-api.js";
import { showToast } from "/shared/js/partner-shell.js";
import {
  fetchEditorBundle,
  saveHeader,
  saveViews,
  saveVariants,
  saveMockups,
  savePrintAreas,
  saveMeta,
  submitForReview,
} from "./api.js";
import { renderDetailsTab, snapshotDetailsTab, bindDetailsTab } from "./tabs/details.js";
import { renderVariantsTab, snapshotVariantsTab, bindVariantsTab } from "./tabs/variants.js";
import { renderMockupsTab, snapshotMockupsTab, bindMockupsTab, updateMockSectionSubnav } from "./tabs/mockups.js";
import { renderPrintAreaTab, snapshotPrintAreaTab, bindPrintAreaTab } from "./tabs/print-area.js";
import { renderMetaTab, snapshotMetaTab, bindMetaTab } from "./tabs/meta.js";
import { renderProductsTab, bindProductsTab } from "./tabs/products.js";

const SIDEBAR_KEY = "partner_product_editor_sidebar_collapsed";

const TABS = [
  { id: "details", label: "Details", icon: "◎" },
  { id: "mockups", label: "Mockups", icon: "▣" },
  { id: "variants", label: "Variants", icon: "▦" },
  { id: "print_area", label: "Print Area", icon: "⬚" },
  { id: "meta", label: "Meta", icon: "☰" },
  { id: "products", label: "Products", icon: "▤" },
];

const READINESS_LABELS = {
  title_required: "Product title",
  views_required: "At least one view",
  variants_required: "At least one variant",
  variant_cost_required: "Cost on every variant",
  print_area_required: "At least one print area",
  clean_front_mockup_required: "Clean Front mockup",
  meta_display_name_required: "Meta display name",
};

let overlayEl = null;
let editorState = null;

function isSidebarCollapsed() {
  return sessionStorage.getItem(SIDEBAR_KEY) === "1";
}

function applySidebarState() {
  const root = overlayEl?.querySelector(".catalog-editor");
  if (!root) return;
  root.classList.toggle("catalog-editor--sidebar-collapsed", isSidebarCollapsed());
}

function markDirty() {
  if (!editorState) return;
  editorState.dirty = true;
  const saveBtn = overlayEl?.querySelector("#pe-save");
  if (saveBtn) saveBtn.disabled = false;
}

function clearDirty() {
  if (!editorState) return;
  editorState.dirty = false;
  const saveBtn = overlayEl?.querySelector("#pe-save");
  if (saveBtn) saveBtn.disabled = true;
}

function renderReadiness(readiness) {
  const el = overlayEl?.querySelector("#pe-readiness");
  if (!el) return;
  const errors = readiness?.errors || [];
  if (!errors.length) {
    el.innerHTML = `<span class="badge badge-success">Ready for review</span>`;
    return;
  }
  el.innerHTML = `<span class="badge badge-warning">${errors.length} open</span>
    <ul class="pe-readiness-list">${errors
      .map((e) => `<li>${escapeHtml(READINESS_LABELS[e] || e)}</li>`)
      .join("")}</ul>`;
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "partner-product-editor-overlay";
  overlayEl.className = "catalog-editor-overlay";
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="catalog-editor pe-editor" role="dialog" aria-modal="true" aria-labelledby="pe-title">
      <header class="catalog-editor-header catalog-editor-header--slim">
        <h1 id="pe-title" class="catalog-editor-header-title">Product</h1>
        <button type="button" class="catalog-editor-close" id="pe-close" aria-label="Close editor">×</button>
      </header>
      <div class="catalog-editor-layout">
        <aside class="catalog-editor-sidebar-wrap">
          <div class="catalog-editor-sidebar">
            <nav class="ce-sidebar-nav" id="pe-tabs" aria-label="Editor sections"></nav>
          </div>
          <button type="button" class="catalog-editor-rail" id="pe-sidebar-toggle" aria-label="Toggle editor menu">
            <span class="catalog-editor-rail__arrow-zone">
              <span class="catalog-editor-rail__arrow" aria-hidden="true">‹</span>
            </span>
            <span class="catalog-editor-rail__label">Menu</span>
          </button>
        </aside>
        <div class="catalog-editor-main">
          <div class="ce-subnav-stack" id="pe-subnav-stack" hidden>
            <div class="ce-subnav-drawer-body">
              <nav class="catalog-editor-subnav ce-subnav-row ce-subnav-row--mock-sections" id="pe-subnav-mock-sections" hidden aria-label="Mockup sections" role="tablist">
                <button type="button" class="ce-mock-section-pill" data-mock-section="calibration" role="tab">Calibration Mockup</button>
                <button type="button" class="ce-mock-section-pill active" data-mock-section="clean" role="tab">Clean Mockups</button>
                <button type="button" class="ce-mock-section-pill" data-mock-section="shop_preview" role="tab">Shop Preview Mockups</button>
                <button type="button" class="ce-mock-section-pill" data-mock-section="preview_images" role="tab">Preview Images</button>
              </nav>
            </div>
          </div>
          <main class="catalog-editor-body" id="pe-body"></main>
          <footer class="catalog-editor-foot pe-foot">
            <div class="pe-foot-readiness" id="pe-readiness"></div>
            <div class="catalog-editor-foot-actions">
              <button type="button" class="btn btn-warning" id="pe-submit">Submit for review</button>
              <button type="button" class="btn btn-primary" id="pe-save" disabled>Save tab</button>
            </div>
          </footer>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlayEl);

  overlayEl.querySelector("#pe-close").onclick = () => void closeProductEditor();
  overlayEl.querySelector("#pe-save").onclick = () => void saveCurrentTab();
  overlayEl.querySelector("#pe-submit").onclick = () => void submitReview();
  overlayEl.querySelector("#pe-sidebar-toggle").onclick = () => {
    sessionStorage.setItem(SIDEBAR_KEY, isSidebarCollapsed() ? "0" : "1");
    applySidebarState();
  };
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) void closeProductEditor();
  });
  document.addEventListener("keydown", (e) => {
    if (!editorState || overlayEl.hidden) return;
    if (e.key === "Escape") void closeProductEditor();
  });
  applySidebarState();
  return overlayEl;
}

function renderTabsNav(ctx) {
  const nav = overlayEl.querySelector("#pe-tabs");
  nav.innerHTML = TABS.map(
    (t) => `<button type="button" class="ce-nav-item ${ctx.activeTab === t.id ? "active" : ""}" data-tab="${t.id}">
      <span class="ce-nav-icon" aria-hidden="true">${t.icon}</span>
      <span class="ce-nav-label">${escapeHtml(t.label)}</span>
    </button>`
  ).join("");
  nav.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

function updateSubnav(ctx) {
  const stack = overlayEl.querySelector("#pe-subnav-stack");
  const mockRow = overlayEl.querySelector("#pe-subnav-mock-sections");
  const showMock = ctx.activeTab === "mockups";
  stack.hidden = !showMock;
  mockRow.hidden = !showMock;
  if (showMock) {
    updateMockSectionSubnav(ctx, overlayEl);
    mockRow.querySelectorAll("[data-mock-section]").forEach((btn) => {
      btn.onclick = () => {
        // Persist current section DOM into localMockups before switching
        snapshotMockupsTab(ctx);
        ctx.mockupSection = btn.dataset.mockSection;
        loadActiveTab(ctx);
      };
    });
  }
}

async function loadActiveTab(ctx) {
  const body = overlayEl.querySelector("#pe-body");
  body.innerHTML = `<p class="ce-hint">Loading…</p>`;
  updateSubnav(ctx);

  let html = "";
  if (ctx.activeTab === "details") html = renderDetailsTab(ctx);
  else if (ctx.activeTab === "variants") html = renderVariantsTab(ctx);
  else if (ctx.activeTab === "mockups") html = renderMockupsTab(ctx);
  else if (ctx.activeTab === "print_area") html = renderPrintAreaTab(ctx);
  else if (ctx.activeTab === "meta") html = renderMetaTab(ctx);
  else if (ctx.activeTab === "products") html = await renderProductsTab(ctx);

  body.innerHTML = html;
  ctx.markDirty = markDirty;
  ctx.showToast = showToast;
  ctx.reloadTab = () => loadActiveTab(ctx);

  if (ctx.activeTab === "details") bindDetailsTab(ctx, body);
  else if (ctx.activeTab === "variants") bindVariantsTab(ctx, body);
  else if (ctx.activeTab === "mockups") bindMockupsTab(ctx, body);
  else if (ctx.activeTab === "print_area") bindPrintAreaTab(ctx, body);
  else if (ctx.activeTab === "meta") bindMetaTab(ctx, body);
  else if (ctx.activeTab === "products") bindProductsTab(ctx, body);

  clearDirty();
}

async function switchTab(tabId) {
  if (!editorState) return;
  if (editorState.dirty && !confirm("Discard unsaved changes on this tab?")) return;
  editorState.activeTab = tabId;
  renderTabsNav(editorState);
  await loadActiveTab(editorState);
}

async function saveCurrentTab() {
  if (!editorState?.productId && editorState?.activeTab !== "details") {
    showToast("Save details first", "Create the product before editing other tabs");
    return;
  }
  const ctx = editorState;
  try {
    if (ctx.activeTab === "details") {
      const snap = snapshotDetailsTab();
      if (!snap.title) {
        showToast("Title required", "Enter a product title before saving");
        return;
      }
      const body = { ...snap, product_id: ctx.productId || undefined };
      const res = await saveHeader(body);
      ctx.productId = res.product.id;
      ctx.bundle.product = res.product;
      overlayEl.querySelector("#pe-title").textContent = res.product.title || "Product";
      await loadActiveTab(ctx);
    } else if (ctx.activeTab === "variants") {
      const snap = snapshotVariantsTab(ctx);
      await saveViews(ctx.productId, snap.views);
      const varRes = await saveVariants(ctx.productId, {
        colors: snap.colors,
        sizes: snap.sizes,
        currency: snap.currency,
        costs_major: snap.costs_major,
      });
      ctx.localViews = snap.views;
      ctx.localColors = snap.colors;
      ctx.localSizes = snap.sizes;
      ctx.localCurrency = snap.currency;
      ctx.bundle.variants = varRes.variants || [];
      ctx.bundle.colors = snap.colors;
      ctx.bundle.sizes = snap.sizes;
    } else if (ctx.activeTab === "mockups") {
      const slots = snapshotMockupsTab(ctx);
      const mockRes = await saveMockups(ctx.productId, slots);
      const refreshedMockups = mockRes.mockups || slots;
      ctx.localMockups = refreshedMockups;
      ctx.bundle.mockups = refreshedMockups;
    } else if (ctx.activeTab === "print_area") {
      const areas = snapshotPrintAreaTab();
      const res = await savePrintAreas(ctx.productId, areas);
      ctx.localPrintAreas = areas;
      ctx.bundle.print_areas = res.print_areas || areas;
    } else if (ctx.activeTab === "meta") {
      const meta = snapshotMetaTab();
      const res = await saveMeta(ctx.productId, meta);
      ctx.bundle.product = res.product;
    }

    // Refresh readiness + keep editor state in sync with server
    const refreshed = await fetchEditorBundle(ctx.productId);
    ctx.bundle = { ...ctx.bundle, ...refreshed, ok: true };
    if (Array.isArray(refreshed.mockups)) ctx.localMockups = refreshed.mockups;
    if (Array.isArray(refreshed.views)) ctx.localViews = refreshed.views;
    if (Array.isArray(refreshed.colors)) ctx.localColors = refreshed.colors;
    if (Array.isArray(refreshed.sizes)) ctx.localSizes = refreshed.sizes;
    if (Array.isArray(refreshed.print_areas)) ctx.localPrintAreas = refreshed.print_areas;
    renderReadiness(refreshed.readiness);
    clearDirty();
    if (ctx.activeTab === "mockups") await loadActiveTab(ctx);
    showToast("Saved", "Tab changes stored");
  } catch (e) {
    showToast("Save failed", e.message || String(e));
  }
}

async function submitReview() {
  if (!editorState?.productId) {
    showToast("Save product first", "");
    return;
  }
  if (editorState.dirty) {
    await saveCurrentTab();
  }
  try {
    await submitForReview(editorState.productId);
    showToast("Submitted", "Product sent for Eazpire review");
    const refreshed = await fetchEditorBundle(editorState.productId);
    editorState.bundle = refreshed;
    renderReadiness(refreshed.readiness);
    await closeProductEditor(true);
  } catch (e) {
    const errors = e.data?.errors || [];
    renderReadiness({ ok: false, errors });
    showToast("Not ready", errors.map((x) => READINESS_LABELS[x] || x).join(", ") || e.message);
  }
}

export async function closeProductEditor(force = false) {
  if (!overlayEl) return;
  if (!force && editorState?.dirty && !confirm("Close without saving?")) return;
  overlayEl.hidden = true;
  document.body.classList.remove("catalog-editor-open");
  const onClose = editorState?.onClose;
  editorState = null;
  if (onClose) onClose();
}

/**
 * Open fullscreen partner product editor.
 * @param {string|null} productId
 * @param {{ onClose?: () => void }} [opts]
 */
export async function openProductEditor(productId = null, opts = {}) {
  ensureOverlay();
  document.body.classList.add("catalog-editor-open");
  overlayEl.hidden = false;
  overlayEl.querySelector("#pe-body").innerHTML = `<p class="ce-hint">Loading…</p>`;
  overlayEl.querySelector("#pe-title").textContent = productId ? "Product" : "New product";

  let bundle = {
    ok: true,
    product: { title: "", currency: "EUR", status: "draft" },
    views: [
      { view_key: "front", label: "Front", sort_order: 0, printable: true },
      { view_key: "back", label: "Back", sort_order: 1, printable: true },
    ],
    variants: [],
    colors: ["Black"],
    sizes: ["S", "M", "L"],
    mockups: [],
    print_areas: [],
    readiness: { ok: false, errors: ["title_required"] },
  };

  if (productId) {
    bundle = await fetchEditorBundle(productId);
  }

  editorState = {
    productId: productId || null,
    bundle,
    activeTab: "details",
    mockupSection: "clean",
    localViews: [...(bundle.views || [])],
    localColors: [...(bundle.colors || [])],
    localSizes: [...(bundle.sizes || [])],
    localCurrency: bundle.product?.currency || "EUR",
    localMockups: [...(bundle.mockups || [])],
    localPrintAreas: [...(bundle.print_areas || [])],
    dirty: false,
    onClose: opts.onClose,
  };

  overlayEl.querySelector("#pe-title").textContent = bundle.product?.title || (productId ? "Product" : "New product");
  renderTabsNav(editorState);
  renderReadiness(bundle.readiness);
  await loadActiveTab(editorState);
}
