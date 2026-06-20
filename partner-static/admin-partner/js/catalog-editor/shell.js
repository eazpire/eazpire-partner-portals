import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast, confirmAction } from "/partner/shared/js/partner-shell.js";
import { fetchEditorBundle, mirrorProduct } from "./api.js";
import { renderMetaTab, saveMetaTab } from "./tabs/meta.js";
import {
  loadProvidersTab,
  bindProvidersTab,
  saveProvidersTab,
  snapshotProvidersTab,
} from "./tabs/providers.js";
import { loadTemplateTab, saveTemplateTab } from "./tabs/template.js";
import { loadMockupsTab, saveMockupsTab } from "./tabs/mockups.js";
import { loadVariantsTab, saveVariantsTab } from "./tabs/variants.js";
import { loadPrintAreaTab, bindPrintAreaTab, savePrintAreaTab } from "./tabs/print-area.js";
import { loadProductsTab, bindProductsTab, saveProductsTab } from "./tabs/products.js";
import { renderAutomationsTab, bindAutomationsTab, saveAutomationsTab } from "./tabs/automations.js";
import {
  registerDirtyListener,
  setDirtySnapshot,
  clearDirtySnapshot,
  resetDirtyAfterSave,
  isEditorDirty,
  hasDirtySnapshot,
  checkDirty,
} from "./editor-dirty.js";

const CE_SIDEBAR_KEY = "admin_catalog_editor_sidebar_collapsed";

const TABS = [
  { id: "provider", label: "Provider", icon: "◈", needsProvider: false },
  { id: "template", label: "Template", icon: "⎘", needsProvider: true },
  { id: "mockups", label: "Mockups", icon: "▣", needsProvider: true },
  { id: "variants", label: "Variants", icon: "▦", needsProvider: true },
  { id: "print_area", label: "Print Area", icon: "⬚", needsProvider: true },
  { id: "meta_data", label: "Meta", icon: "◎", needsProvider: false },
  { id: "products", label: "Products", icon: "▤", needsProvider: false },
  { id: "automations", label: "Automations", icon: "⚙", needsProvider: true },
];

let overlayEl = null;
let editorState = null;
let dirtyUnsub = null;

function updateSaveButtonState(dirty = false) {
  const saveBtn = overlayEl?.querySelector("#ce-save");
  if (!saveBtn) return;
  const enabled = hasDirtySnapshot() ? dirty : true;
  saveBtn.disabled = !enabled;
}

function showSaveFlash() {
  const main = overlayEl?.querySelector(".catalog-editor-main");
  if (!main) return;
  let flash = main.querySelector(".ce-save-flash");
  if (!flash) {
    flash = document.createElement("div");
    flash.className = "ce-save-flash";
    flash.innerHTML = `<div class="ce-save-flash-inner"><span class="ce-save-flash-icon" aria-hidden="true">✓</span><span>Saved</span></div>`;
    main.appendChild(flash);
  }
  flash.classList.remove("ce-save-flash--show");
  void flash.offsetWidth;
  flash.classList.add("ce-save-flash--show");
  window.setTimeout(() => flash.classList.remove("ce-save-flash--show"), 1200);
}

function captureTabDirtySnapshot(ctx) {
  if (ctx.activeTab === "provider" && ctx.providersTabState) {
    setDirtySnapshot(snapshotProvidersTab(ctx));
    return;
  }
  clearDirtySnapshot();
}

function getCurrentTabDirtyState(ctx) {
  if (ctx.activeTab === "provider" && ctx.providersTabState) {
    return snapshotProvidersTab(ctx);
  }
  return null;
}

function isEditorSidebarCollapsed() {
  return sessionStorage.getItem(CE_SIDEBAR_KEY) === "1";
}

function applyEditorSidebarState() {
  const root = overlayEl?.querySelector(".catalog-editor");
  if (!root) return;
  root.classList.toggle("catalog-editor--sidebar-collapsed", isEditorSidebarCollapsed());
}

function toggleEditorSidebar() {
  sessionStorage.setItem(CE_SIDEBAR_KEY, isEditorSidebarCollapsed() ? "0" : "1");
  applyEditorSidebarState();
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "catalog-editor-overlay";
  overlayEl.className = "catalog-editor-overlay";
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="catalog-editor" role="dialog" aria-modal="true" aria-labelledby="ce-title">
      <header class="catalog-editor-header">
        <div class="catalog-editor-brand">
          <div class="catalog-editor-mark" aria-hidden="true">EZ</div>
          <div class="catalog-editor-title">
            <p class="catalog-editor-sub">Product editor</p>
            <h1 id="ce-title">Product</h1>
            <p id="ce-drift" class="catalog-editor-sub"></p>
          </div>
        </div>
        <button type="button" class="catalog-editor-close" id="ce-close" aria-label="Close editor">×</button>
      </header>
      <div class="catalog-editor-layout">
        <aside class="catalog-editor-sidebar-wrap">
          <div class="catalog-editor-sidebar">
            <nav class="ce-sidebar-nav" id="ce-tabs" aria-label="Editor sections"></nav>
          </div>
          <button type="button" class="catalog-editor-rail" id="ce-sidebar-toggle" aria-label="Toggle editor menu">
            <span class="catalog-editor-rail__arrow-zone">
              <span class="catalog-editor-rail__arrow" aria-hidden="true">‹</span>
            </span>
            <span class="catalog-editor-rail__label">Menu</span>
          </button>
        </aside>
        <div class="catalog-editor-main">
          <nav class="catalog-editor-subnav" id="ce-subnav" hidden aria-label="Print providers">
            <span class="catalog-editor-subnav-label">Print provider</span>
            <div class="ce-provider-pills" id="ce-subnav-pills"></div>
          </nav>
          <main class="catalog-editor-body" id="ce-body"></main>
          <footer class="catalog-editor-foot">
            <div class="catalog-editor-foot-actions">
              <button type="button" class="btn btn-secondary" id="ce-mirror">Mirror to publish index</button>
              <button type="button" class="btn btn-primary" id="ce-save">Save tab</button>
            </div>
          </footer>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.querySelector("#ce-close").onclick = () => requestCloseProductEditor();
  overlayEl.querySelector("#ce-save").onclick = () => saveCurrentTab();
  overlayEl.querySelector("#ce-mirror").onclick = () => runMirror();
  overlayEl.querySelector("#ce-sidebar-toggle").onclick = toggleEditorSidebar;
  dirtyUnsub = registerDirtyListener((dirty) => updateSaveButtonState(dirty));
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) requestCloseProductEditor();
  });
  applyEditorSidebarState();
  return overlayEl;
}

function activeProviderIds(ctx) {
  return (ctx.bundle.active_providers || []).map((r) => String(r.print_provider_id));
}

function renderSubnav(ctx) {
  const tab = TABS.find((t) => t.id === ctx.activeTab);
  const subnav = overlayEl.querySelector("#ce-subnav");
  if (!tab?.needsProvider) {
    subnav.hidden = true;
    const pills = subnav.querySelector("#ce-subnav-pills");
    if (pills) pills.innerHTML = "";
    return;
  }
  const ids = activeProviderIds(ctx);
  if (!ids.length) {
    subnav.hidden = true;
    return;
  }
  if (!ctx.selectedPrintProviderId || !ids.includes(String(ctx.selectedPrintProviderId))) {
    ctx.selectedPrintProviderId = ids[0];
  }
  subnav.hidden = false;
  const pills = subnav.querySelector("#ce-subnav-pills");
  if (!pills) return;
  pills.innerHTML = ids
    .map((pid) => {
      const fp = (ctx.bundle.providers || []).find((p) => String(p.external_provider_id) === pid);
      const label = fp?.name || `Provider ${pid}`;
      return `<button type="button" class="ce-provider-pill ${String(ctx.selectedPrintProviderId) === pid ? "active" : ""}" data-pid="${escapeHtml(pid)}">${escapeHtml(label)}</button>`;
    })
    .join("");
  pills.querySelectorAll(".ce-provider-pill").forEach((btn) => {
    btn.onclick = () => {
      ctx.selectedPrintProviderId = btn.dataset.pid;
      renderSubnav(ctx);
      loadActiveTab(ctx);
    };
  });
}

function renderTabs(ctx) {
  const nav = overlayEl.querySelector("#ce-tabs");
  nav.innerHTML = `<p class="ce-nav-section-title">Sections</p>${TABS.map(
    (t) =>
      `<button type="button" class="ce-nav-item ${ctx.activeTab === t.id ? "active" : ""}" data-tab="${t.id}" title="${escapeHtml(t.label)}">
        <span class="ce-nav-icon" aria-hidden="true">${t.icon}</span>
        <span class="ce-nav-label">${escapeHtml(t.label)}</span>
      </button>`
  ).join("")}`;
  nav.querySelectorAll(".ce-nav-item").forEach((btn) => {
    btn.onclick = () => {
      ctx.activeTab = btn.dataset.tab;
      renderTabs(ctx);
      renderSubnav(ctx);
      loadActiveTab(ctx);
    };
  });
}

async function loadActiveTab(ctx) {
  window.__catalogEditorState = ctx;
  const body = overlayEl.querySelector("#ce-body");
  body.innerHTML = `<p class="catalog-editor-loading">Loading…</p>`;
  try {
    let html = "";
    switch (ctx.activeTab) {
      case "provider":
        html = await loadProvidersTab(ctx);
        break;
      case "template":
        html = await loadTemplateTab(ctx);
        break;
      case "mockups":
        html = await loadMockupsTab(ctx);
        break;
      case "variants":
        html = await loadVariantsTab(ctx);
        break;
      case "print_area":
        html = await loadPrintAreaTab(ctx);
        break;
      case "meta_data":
        html = renderMetaTab(ctx);
        break;
      case "products":
        html = await loadProductsTab(ctx);
        break;
      case "automations":
        html = renderAutomationsTab(ctx);
        break;
      default:
        html = "<p>Unknown tab</p>";
    }
    body.innerHTML = html;
    if (ctx.activeTab === "provider") bindProvidersTab(ctx, body);
    if (ctx.activeTab === "print_area") bindPrintAreaTab(ctx, body);
    if (ctx.activeTab === "products") bindProductsTab(ctx, body);
    if (ctx.activeTab === "automations") bindAutomationsTab(ctx, body);
    captureTabDirtySnapshot(ctx);
    updateSaveButtonState(false);
  } catch (err) {
    body.innerHTML = `<div class="ce-error">${escapeHtml(err.message || "Load failed")}</div>`;
  }
}

async function saveCurrentTab() {
  if (!editorState) return;
  const ctx = editorState;
  const saveBtn = overlayEl.querySelector("#ce-save");
  saveBtn.disabled = true;
  try {
    switch (ctx.activeTab) {
      case "provider":
        await saveProvidersTab(ctx);
        break;
      case "template":
        await saveTemplateTab(ctx);
        break;
      case "mockups":
        await saveMockupsTab(ctx);
        break;
      case "variants":
        await saveVariantsTab(ctx);
        break;
      case "print_area":
        await savePrintAreaTab(ctx);
        break;
      case "meta_data":
        await saveMetaTab(ctx);
        break;
      case "products":
        await saveProductsTab(ctx);
        break;
      case "automations":
        await saveAutomationsTab(ctx);
        break;
      default:
        break;
    }
    await runMirror(true);
    ctx.bundle = await fetchEditorBundle(ctx.productKey);
    updateDriftBadge(ctx);
    showSaveFlash();
    showToast("Saved", "Tab saved and mirrored to publish index");
    resetDirtyAfterSave(getCurrentTabDirtyState(ctx) ?? {});
    await loadActiveTab(ctx);
  } catch (err) {
    showToast("Save failed", err.message || "Unknown error");
  } finally {
    updateSaveButtonState(isEditorDirty());
  }
}

function requestCloseProductEditor() {
  if (!editorState) {
    closeProductEditor();
    return;
  }
  if (hasDirtySnapshot() && isEditorDirty()) {
    confirmAction({
      title: "Unsaved changes",
      message: "You have unsaved changes on this tab. Save before closing?",
      confirmLabel: "Save",
      cancelLabel: "Discard",
      confirmClass: "btn-primary",
      onConfirm: async () => {
        try {
          await saveCurrentTab();
          if (!isEditorDirty()) closeProductEditor();
        } catch {
          /* saveCurrentTab shows toast */
        }
      },
      onCancel: () => closeProductEditor(),
    });
    return;
  }
  closeProductEditor();
}

async function runMirror(silent = false) {
  if (!editorState) return;
  try {
    await mirrorProduct(editorState.productKey);
    editorState.bundle = await fetchEditorBundle(editorState.productKey);
    updateDriftBadge(editorState);
    if (!silent) showToast("Mirrored", "Publish index updated");
  } catch (err) {
    if (!silent) showToast("Mirror failed", err.message || "");
  }
}

function updateDriftBadge(ctx) {
  const el = overlayEl.querySelector("#ce-drift");
  const drift = ctx.bundle.drift;
  if (!drift) {
    el.textContent = "";
    return;
  }
  el.textContent = drift.in_sync ? "In sync with publish index" : "Drift detected — save or mirror to reconcile";
  el.classList.toggle("is-sync", !!drift.in_sync);
  el.classList.toggle("is-drift", !drift.in_sync);
}

export async function openProductEditor(productKey) {
  ensureOverlay();
  overlayEl.hidden = false;
  applyEditorSidebarState();
  document.body.classList.add("catalog-editor-open");

  editorState = {
    productKey,
    activeTab: "provider",
    selectedPrintProviderId: null,
    selectedVersionId: null,
    bundle: null,
    reloadTab: () => loadActiveTab(editorState),
  };
  window.__catalogEditorState = editorState;

  const ctx = editorState;
  overlayEl.querySelector("#ce-title").textContent = productKey;
  overlayEl.querySelector("#ce-body").innerHTML = `<p class="catalog-editor-loading">Loading product…</p>`;

  try {
    ctx.bundle = await fetchEditorBundle(productKey);
    overlayEl.querySelector("#ce-title").textContent = ctx.bundle.product?.title || productKey;
    const firstVersion = ctx.bundle.versions?.[0];
    ctx.selectedVersionId = firstVersion?.id || null;
    updateDriftBadge(ctx);
    renderTabs(ctx);
    renderSubnav(ctx);
    await loadActiveTab(ctx);
  } catch (err) {
    overlayEl.querySelector("#ce-body").innerHTML = `<div class="ce-error">${escapeHtml(err.message || "Failed to load")}</div>`;
  }
}

export function closeProductEditor() {
  if (!overlayEl) return;
  overlayEl.hidden = true;
  document.body.classList.remove("catalog-editor-open");
  editorState = null;
  window.__catalogEditorState = null;
  clearDirtySnapshot();
  updateSaveButtonState(false);
}
