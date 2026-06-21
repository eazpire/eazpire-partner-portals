import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { fetchEditorBundle, mirrorProduct } from "./api.js";
import { renderMetaTab, saveMetaTab, bindMetaTab } from "./tabs/meta.js";
import {
  loadProvidersTab,
  bindProvidersTab,
  saveProvidersTab,
  snapshotProvidersTab,
  syncProvidersDomState,
} from "./tabs/providers.js";
import { loadTemplateTab, saveTemplateTab } from "./tabs/template.js";
import { loadMockupsTab, saveMockupsTab, bindMockupsTab } from "./tabs/mockups.js";
import { loadVariantsTab, saveVariantsTab, bindVariantsTab } from "./tabs/variants.js";
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
import {
  tabUsesEditorSubnav,
  ensureEditorSelections,
  getSubnavVisibility,
  providerLabel,
  renderVersionPills,
  isSubnavDrawerCollapsed,
  setSubnavDrawerCollapsed,
} from "./editor-subnav.js";

const CE_SIDEBAR_KEY = "admin_catalog_editor_sidebar_collapsed";

const TABS = [
  { id: "provider", label: "Provider", icon: "◈", needsProvider: false },
  { id: "template", label: "Templates", icon: "⎘", needsProvider: true },
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
  const tab = editorState?.activeTab;
  let enabled = false;
  if (tab === "template") {
    enabled = false;
  } else if (tab === "provider") {
    enabled = hasDirtySnapshot() && dirty;
  } else {
    enabled = true;
  }
  saveBtn.disabled = !enabled;
}

function showSaveLoading() {
  const editor = overlayEl?.querySelector(".catalog-editor");
  if (!editor) return;
  let el = editor.querySelector(".ce-save-loading");
  if (!el) {
    el = document.createElement("div");
    el.className = "ce-save-loading";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-busy", "true");
    el.innerHTML = `<div class="ce-save-loading-inner"><div class="ce-save-loading-spinner" aria-hidden="true"></div><span>Saving…</span></div>`;
    editor.appendChild(el);
  }
  el.hidden = false;
  el.classList.add("ce-save-loading--show");
}

function hideSaveLoading() {
  const el = overlayEl?.querySelector(".ce-save-loading");
  if (!el) return;
  el.classList.remove("ce-save-loading--show");
  el.hidden = true;
  el.removeAttribute("aria-busy");
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
      <header class="catalog-editor-header catalog-editor-header--slim">
        <h1 id="ce-title" class="catalog-editor-header-title">Product</h1>
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
          <div class="ce-subnav-stack" id="ce-subnav-stack" hidden>
            <button type="button" class="ce-subnav-drawer-toggle" id="ce-subnav-drawer-toggle" aria-expanded="true" aria-controls="ce-subnav-drawer-body" aria-label="Expand or collapse provider and version bars">
              <span class="ce-subnav-drawer-icon" aria-hidden="true">▴</span>
            </button>
            <div class="ce-subnav-drawer-body" id="ce-subnav-drawer-body">
              <nav class="catalog-editor-subnav ce-subnav-row" id="ce-subnav-providers" hidden aria-label="Print providers">
                <span class="catalog-editor-subnav-label">Print provider</span>
                <div class="ce-provider-pills" id="ce-subnav-pills"></div>
              </nav>
              <nav class="catalog-editor-subnav ce-subnav-row ce-subnav-row--versions" id="ce-subnav-versions" hidden aria-label="Product versions">
                <span class="catalog-editor-subnav-label">Versions</span>
                <div class="ce-version-pills" id="ce-subnav-version-pills" role="tablist"></div>
              </nav>
            </div>
          </div>
          <main class="catalog-editor-body" id="ce-body"></main>
          <footer class="catalog-editor-foot">
            <div class="catalog-editor-foot-actions">
              <button type="button" class="btn btn-secondary" id="ce-mirror">Mirror to publish index</button>
              <button type="button" class="btn btn-primary" id="ce-save">Save tab</button>
            </div>
          </footer>
        </div>
      </div>
      <div id="ce-unsaved-dialog" class="ce-unsaved-dialog" hidden>
        <div class="ce-unsaved-dialog__backdrop" data-ce-unsaved-dismiss></div>
        <div class="ce-unsaved-dialog__card" role="alertdialog" aria-modal="true" aria-labelledby="ce-unsaved-title">
          <h2 id="ce-unsaved-title" class="ce-unsaved-dialog__title">Unsaved changes</h2>
          <p class="ce-unsaved-dialog__text">You have unsaved changes on this tab. Save before closing?</p>
          <div class="ce-unsaved-dialog__actions">
            <button type="button" class="btn btn-secondary" id="ce-unsaved-keep">Keep editing</button>
            <button type="button" class="btn btn-secondary" id="ce-unsaved-discard">Discard</button>
            <button type="button" class="btn btn-primary" id="ce-unsaved-save">Save</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.querySelector("#ce-close").onclick = () => void requestCloseProductEditor();
  overlayEl.querySelector("#ce-save").onclick = () => saveCurrentTab();
  overlayEl.querySelector("#ce-mirror").onclick = () => runMirror();
  overlayEl.querySelector("#ce-sidebar-toggle").onclick = toggleEditorSidebar;
  overlayEl.querySelector("#ce-subnav-drawer-toggle")?.addEventListener("click", () => {
    setSubnavDrawerCollapsed(!isSubnavDrawerCollapsed());
    applySubnavDrawerState();
  });
  dirtyUnsub = registerDirtyListener((dirty) => updateSaveButtonState(dirty));
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) void requestCloseProductEditor();
  });
  if (!overlayEl.dataset.escapeBound) {
    overlayEl.dataset.escapeBound = "1";
    document.addEventListener("keydown", (e) => {
      if (!editorState || overlayEl.hidden) return;
      if (e.key !== "Escape") return;
      const dialog = overlayEl.querySelector("#ce-unsaved-dialog");
      if (dialog && !dialog.hidden) {
        hideUnsavedCloseDialog();
        return;
      }
      void requestCloseProductEditor();
    });
  }
  applyEditorSidebarState();
  return overlayEl;
}

function applySubnavDrawerState() {
  const stack = overlayEl?.querySelector("#ce-subnav-stack");
  const toggle = overlayEl?.querySelector("#ce-subnav-drawer-toggle");
  const icon = toggle?.querySelector(".ce-subnav-drawer-icon");
  if (!stack || stack.hidden) return;
  const collapsed = isSubnavDrawerCollapsed();
  stack.classList.toggle("ce-subnav-stack--collapsed", collapsed);
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (icon) icon.textContent = collapsed ? "▾" : "▴";
}

function renderSubnav(ctx) {
  const stack = overlayEl.querySelector("#ce-subnav-stack");
  const providerRow = overlayEl.querySelector("#ce-subnav-providers");
  const versionRow = overlayEl.querySelector("#ce-subnav-versions");
  const providerPills = overlayEl.querySelector("#ce-subnav-pills");
  const versionPills = overlayEl.querySelector("#ce-subnav-version-pills");

  if (!tabUsesEditorSubnav(ctx.activeTab)) {
    stack.hidden = true;
    if (providerPills) providerPills.innerHTML = "";
    if (versionPills) versionPills.innerHTML = "";
    return;
  }

  ensureEditorSelections(ctx);
  const { showStack, showProviders, showVersions, providerIds, versions } = getSubnavVisibility(ctx);

  if (!showStack) {
    stack.hidden = true;
    if (providerPills) providerPills.innerHTML = "";
    if (versionPills) versionPills.innerHTML = "";
    return;
  }

  stack.hidden = false;
  providerRow.hidden = !showProviders;
  versionRow.hidden = !showVersions;
  applySubnavDrawerState();

  if (showProviders && providerPills) {
    providerPills.innerHTML = providerIds
      .map((pid) => {
        const label = providerLabel(ctx, pid);
        return `<button type="button" class="ce-provider-pill ${
          String(ctx.selectedPrintProviderId) === pid ? "active" : ""
        }" data-pid="${escapeHtml(pid)}">${escapeHtml(label)}</button>`;
      })
      .join("");
    providerPills.querySelectorAll(".ce-provider-pill").forEach((btn) => {
      btn.onclick = () => {
        ctx.selectedPrintProviderId = btn.dataset.pid;
        ensureEditorSelections(ctx);
        renderSubnav(ctx);
        loadActiveTab(ctx);
      };
    });
  } else if (providerPills) {
    providerPills.innerHTML = "";
  }

  if (showVersions && versionPills) {
    versionPills.innerHTML = renderVersionPills(versions, ctx.selectedVersionId);
    versionPills.querySelectorAll(".ce-version-pill").forEach((btn) => {
      btn.onclick = () => {
        const nextId = btn.dataset.versionId;
        if (!nextId || String(nextId) === String(ctx.selectedVersionId)) return;
        ctx.selectedVersionId = nextId;
        renderSubnav(ctx);
        loadActiveTab(ctx);
      };
    });
  } else if (versionPills) {
    versionPills.innerHTML = "";
  }
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
  editorState?.printAreaUiCleanup?.();
  if (editorState) editorState.printAreaUiCleanup = null;
  ensureEditorSelections(ctx);
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
    if (ctx.activeTab === "mockups") bindMockupsTab();
    if (ctx.activeTab === "variants") bindVariantsTab();
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
  showSaveLoading();
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
    hideSaveLoading();
    updateSaveButtonState(isEditorDirty());
  }
}

function refreshDirtyBeforeClose(ctx) {
  if (!ctx) return;
  if (ctx.activeTab === "provider") syncProvidersDomState(ctx);
  const state = getCurrentTabDirtyState(ctx);
  if (state != null) checkDirty(state);
}

let unsavedCloseResolver = null;

function hideUnsavedCloseDialog() {
  const dialog = overlayEl?.querySelector("#ce-unsaved-dialog");
  if (dialog) dialog.hidden = true;
  unsavedCloseResolver = null;
}

function promptUnsavedCloseDialog() {
  const dialog = overlayEl?.querySelector("#ce-unsaved-dialog");
  if (!dialog) return Promise.resolve("discard");

  hideUnsavedCloseDialog();
  dialog.hidden = false;

  return new Promise((resolve) => {
    unsavedCloseResolver = resolve;

    const finish = (choice) => {
      hideUnsavedCloseDialog();
      resolve(choice);
    };

    dialog.querySelector("#ce-unsaved-keep").onclick = () => finish("keep");
    dialog.querySelector("#ce-unsaved-discard").onclick = () => finish("discard");
    dialog.querySelector("#ce-unsaved-save").onclick = () => finish("save");
    dialog.querySelectorAll("[data-ce-unsaved-dismiss]").forEach((el) => {
      el.onclick = () => finish("keep");
    });
  });
}

async function requestCloseProductEditor() {
  if (!editorState) {
    closeProductEditor();
    return;
  }

  refreshDirtyBeforeClose(editorState);

  if (hasDirtySnapshot() && isEditorDirty()) {
    const choice = await promptUnsavedCloseDialog();
    if (choice === "keep") return;
    if (choice === "discard") {
      closeProductEditor();
      return;
    }
    if (choice === "save") {
      try {
        await saveCurrentTab();
        refreshDirtyBeforeClose(editorState);
        if (!isEditorDirty()) closeProductEditor();
      } catch {
        /* saveCurrentTab shows toast */
      }
      return;
    }
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

function updateDriftBadge() {
  /* drift badge removed from slim header — mirror status via footer action */
}

export async function openProductEditor(productKey) {
  ensureOverlay();
  overlayEl.hidden = false;
  overlayEl.querySelector("#ce-unsaved-dialog")?.setAttribute("hidden", "");
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
  hideUnsavedCloseDialog();
  overlayEl.hidden = true;
  document.body.classList.remove("catalog-editor-open");
  editorState = null;
  window.__catalogEditorState = null;
  clearDirtySnapshot();
  updateSaveButtonState(false);
}
