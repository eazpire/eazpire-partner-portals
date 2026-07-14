import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { fetchEditorBundle, mirrorProduct } from "./api.js";
import { renderMetaTab, saveMetaTab, bindMetaTab } from "./tabs/meta.js";
import {
  loadProvidersTab,
  bindProvidersTab,
  saveProvidersTab,
} from "./tabs/providers.js";
import { loadTemplateTab, saveTemplateTab } from "./tabs/template.js";
import { loadMockupsTab, saveMockupsTab, bindMockupsTab, updateMockSectionSubnav } from "./tabs/mockups.js";
import { loadVariantsTab, saveVariantsTab, bindVariantsTab } from "./tabs/variants.js";
import { loadPrintAreaTab, bindPrintAreaTab, savePrintAreaTab } from "./tabs/print-area.js";
import { loadProductsTab, bindProductsTab, saveProductsTab } from "./tabs/products.js";
import { renderAutomationsTab, bindAutomationsTab, saveAutomationsTab } from "./tabs/automations.js";
import { loadPartnerReviewBundle, renderReviewTab, bindReviewTab } from "./tabs/review.js";
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
  snapshotActiveTab,
  syncActiveTabDom,
  tabSaveDisabled,
} from "./editor-tab-dirty.js";
import {
  renderCatalogEditorTriSwitch,
  bindCatalogEditorTriSwitch,
  refreshVisibilityTriSwitch,
  initVisibilityFromBundle,
  captureVisibilityBaseline,
  saveVisibilityFromFooter,
  snapshotVisibilityState,
} from "./editor-visibility.js";
import {
  tabUsesEditorSubnav,
  ensureEditorSelections,
  getSubnavVisibility,
  providerLabel,
  renderVersionPills,
  isSubnavDrawerCollapsed,
  setSubnavDrawerCollapsed,
} from "./editor-subnav.js";
import { renderPrintAreaProviderPill, bindPrintAreaMainSourceSubnav } from "./print-area/main-source.js";
import { removeViewDock } from "./print-area/view-dock.js";
import { editorProductTitle } from "./editor-product-title.js";

const CE_SIDEBAR_KEY = "admin_catalog_editor_sidebar_collapsed";

const REVIEW_TAB = { id: "review", label: "Review", icon: "⚑", needsProvider: false };

const CORE_TABS = [
  { id: "provider", label: "Provider", icon: "◈", needsProvider: false },
  { id: "template", label: "Templates", icon: "⎘", needsProvider: true },
  { id: "mockups", label: "Mockups", icon: "▣", needsProvider: true },
  { id: "variants", label: "Variants", icon: "▦", needsProvider: true },
  { id: "print_area", label: "Print Area", icon: "⬚", needsProvider: true },
  { id: "meta_data", label: "Meta", icon: "◎", needsProvider: false },
  { id: "products", label: "Products", icon: "▤", needsProvider: false },
  { id: "automations", label: "Automations", icon: "⚙", needsProvider: true },
];

function tabsForCtx(ctx) {
  if (ctx?.showReviewTab) return [REVIEW_TAB, ...CORE_TABS];
  return CORE_TABS;
}

let overlayEl = null;
let editorState = null;
let dirtyUnsub = null;

function updateSaveButtonState(dirty = false) {
  const saveBtn = overlayEl?.querySelector("#ce-save");
  if (!saveBtn) return;
  const tab = editorState?.activeTab;
  const enabled = !tabSaveDisabled(tab) && hasDirtySnapshot() && dirty;
  saveBtn.disabled = !enabled;
}

function captureTabDirtySnapshot(ctx) {
  const state = snapshotActiveTab(ctx);
  if (state != null) {
    setDirtySnapshot(state);
    return;
  }
  clearDirtySnapshot();
}

function getCurrentTabDirtyState(ctx) {
  return snapshotActiveTab(ctx);
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

let saveFlashTimer = null;

function showSaveFlash() {
  const editor = overlayEl?.querySelector(".catalog-editor");
  if (!editor) return;
  // Prefer a flash attached directly on .catalog-editor (not nested under .catalog-editor-main
  // leftovers from older builds that loadActiveTab remounts could leave orphaned).
  let flash = [...editor.children].find((el) => el.classList?.contains("ce-save-flash"));
  if (!flash) {
    flash = document.createElement("div");
    flash.className = "ce-save-flash";
    flash.setAttribute("role", "status");
    flash.setAttribute("aria-live", "polite");
    flash.innerHTML = `<div class="ce-save-flash-inner"><span class="ce-save-flash-icon" aria-hidden="true">✓</span><span>Saved</span></div>`;
    editor.appendChild(flash);
  }
  if (saveFlashTimer) {
    window.clearTimeout(saveFlashTimer);
    saveFlashTimer = null;
  }
  flash.classList.remove("ce-save-flash--show");
  void flash.offsetWidth;
  flash.classList.add("ce-save-flash--show");
  saveFlashTimer = window.setTimeout(() => {
    flash.classList.remove("ce-save-flash--show");
    saveFlashTimer = null;
  }, 1800);
}

function refreshDirtyBeforeClose(ctx) {
  if (!ctx) return;
  syncActiveTabDom(ctx);
  const state = snapshotActiveTab(ctx);
  if (state != null) checkDirty(state);
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
              <nav class="catalog-editor-subnav ce-subnav-row ce-subnav-row--mock-sections" id="ce-subnav-mock-sections" hidden aria-label="Mockup sections" role="tablist">
                <button type="button" class="ce-mock-section-pill" data-mock-section="calibration" role="tab" aria-selected="false">Calibration Mockup</button>
                <button type="button" class="ce-mock-section-pill active" data-mock-section="clean" role="tab" aria-selected="true">Clean Mockups</button>
                <button type="button" class="ce-mock-section-pill" data-mock-section="shop_preview" role="tab" aria-selected="false">Shop Preview Mockups</button>
                <button type="button" class="ce-mock-section-pill" data-mock-section="preview_images" role="tab" aria-selected="false">Preview Images</button>
              </nav>
            </div>
          </div>
          <main class="catalog-editor-body" id="ce-body"></main>
          <footer class="catalog-editor-foot">
            <div class="ce-foot-visibility" id="ce-foot-visibility">
              <span class="ce-foot-visibility-label">Visibility</span>
              <p class="ce-foot-visibility-hint ce-hint"></p>
              ${renderCatalogEditorTriSwitch("offline")}
            </div>
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
  const mockSectionsRow = overlayEl.querySelector("#ce-subnav-mock-sections");
  const providerPills = overlayEl.querySelector("#ce-subnav-pills");
  const versionPills = overlayEl.querySelector("#ce-subnav-version-pills");
  const isMockupsTab = ctx.activeTab === "mockups";

  if (!tabUsesEditorSubnav(ctx.activeTab)) {
    stack.hidden = true;
    if (providerPills) providerPills.innerHTML = "";
    if (versionPills) versionPills.innerHTML = "";
    if (mockSectionsRow) mockSectionsRow.hidden = true;
    refreshVisibilityTriSwitch(ctx);
    return;
  }

  ensureEditorSelections(ctx);
  const { showStack, showProviders, showVersions, providerIds, versions } = getSubnavVisibility(ctx);
  const showMockSections = isMockupsTab;

  if (!showStack && !showMockSections) {
    stack.hidden = true;
    if (providerPills) providerPills.innerHTML = "";
    if (versionPills) versionPills.innerHTML = "";
    if (mockSectionsRow) mockSectionsRow.hidden = true;
    refreshVisibilityTriSwitch(ctx);
    return;
  }

  stack.hidden = false;
  stack.classList.toggle("ce-subnav-stack--has-mock-sections", showMockSections);
  providerRow.hidden = !showProviders;
  versionRow.hidden = !showVersions;
  if (mockSectionsRow) mockSectionsRow.hidden = !showMockSections;
  if (showMockSections) updateMockSectionSubnav(ctx);
  applySubnavDrawerState();

  if (showProviders && providerPills) {
    const pillRenderer =
      ctx.activeTab === "print_area"
        ? (pid) => renderPrintAreaProviderPill(ctx, pid)
        : (pid) => {
            const label = providerLabel(ctx, pid);
            return `<button type="button" class="ce-provider-pill ${
              String(ctx.selectedPrintProviderId) === pid ? "active" : ""
            }" data-pid="${escapeHtml(pid)}">${escapeHtml(label)}</button>`;
          };
    providerPills.innerHTML = providerIds.map(pillRenderer).join("");
    providerPills.querySelectorAll(".ce-provider-pill").forEach((btn) => {
      btn.onclick = () => {
        ctx.selectedPrintProviderId = btn.dataset.pid;
        ensureEditorSelections(ctx);
        renderSubnav(ctx);
        loadActiveTab(ctx);
        refreshVisibilityTriSwitch(ctx);
      };
    });
    if (ctx.activeTab === "print_area") {
      bindPrintAreaMainSourceSubnav(ctx, () => {
        renderSubnav(ctx);
        loadActiveTab(ctx);
      });
    }
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
        refreshVisibilityTriSwitch(ctx);
      };
    });
  } else if (versionPills) {
    versionPills.innerHTML = "";
  }
  refreshVisibilityTriSwitch(ctx);
}

function renderTabs(ctx) {
  const nav = overlayEl.querySelector("#ce-tabs");
  const tabs = tabsForCtx(ctx);
  nav.innerHTML = `<p class="ce-nav-section-title">Sections</p>${tabs
    .map(
      (t) =>
        `<button type="button" class="ce-nav-item ${ctx.activeTab === t.id ? "active" : ""}" data-tab="${t.id}" title="${escapeHtml(t.label)}">
        <span class="ce-nav-icon" aria-hidden="true">${t.icon}</span>
        <span class="ce-nav-label">${escapeHtml(t.label)}</span>
      </button>`
    )
    .join("")}`;
  nav.querySelectorAll(".ce-nav-item").forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.tab;
      if (ctx.partnerReviewOnly && next !== "review" && !ctx.productKey) {
        showToast("Approve first", "Other editor tabs unlock after this partner product is approved to the catalog.");
        return;
      }
      ctx.activeTab = next;
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
  if (ctx.activeTab !== "print_area") removeViewDock();
  ensureEditorSelections(ctx);
  renderSubnav(ctx);
  updateFooterForMode(ctx);
  const body = overlayEl.querySelector("#ce-body");
  body.innerHTML = `<p class="catalog-editor-loading">Loading…</p>`;
  try {
    let html = "";
    switch (ctx.activeTab) {
      case "review":
        html = renderReviewTab(ctx);
        break;
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
    if (ctx.activeTab === "review") {
      bindReviewTab(ctx, body, {
        onDecision: async (res) => {
          await refreshAfterReviewDecision(ctx, res);
        },
      });
    }
    if (ctx.activeTab === "provider") bindProvidersTab(ctx, body);
    if (ctx.activeTab === "print_area") bindPrintAreaTab(ctx, body);
    if (ctx.activeTab === "products") bindProductsTab(ctx, body);
    if (ctx.activeTab === "meta_data") bindMetaTab(ctx, body);
    if (ctx.activeTab === "automations") bindAutomationsTab(ctx, body);
    if (ctx.activeTab === "mockups") bindMockupsTab(ctx, body);
    if (ctx.activeTab === "variants") bindVariantsTab(ctx, body);
    captureTabDirtySnapshot(ctx);
    captureVisibilityBaseline(ctx);
    refreshVisibilityTriSwitch(ctx);
    updateFooterForMode(ctx);
    updateSaveButtonState(false);
  } catch (err) {
    body.innerHTML = `<div class="ce-error">${escapeHtml(err.message || "Load failed")}</div>`;
  }
}

function updateFooterForMode(ctx) {
  const visibility = overlayEl?.querySelector("#ce-foot-visibility");
  const mirror = overlayEl?.querySelector("#ce-mirror");
  const save = overlayEl?.querySelector("#ce-save");
  if (!ctx) return;
  const reviewOnly = !!(ctx.partnerReviewOnly && !ctx.productKey);
  const onReview = ctx.activeTab === "review";
  const hideCatalogChrome = reviewOnly || onReview;
  if (visibility) visibility.hidden = hideCatalogChrome;
  if (mirror) mirror.style.display = hideCatalogChrome ? "none" : "";
  if (save) save.style.display = hideCatalogChrome ? "none" : "";
}

async function refreshAfterReviewDecision(ctx, res) {
  const productId = ctx.manufacturerProductId || ctx.partnerReview?.product?.id;
  const nextKey = res?.product_key || ctx.productKey || ctx.partnerReview?.product?.eazpire_product_key || null;

  if (productId) {
    try {
      ctx.partnerReview = await loadPartnerReviewBundle(productId, null);
      ctx.manufacturerProductId = productId;
      ctx.showReviewTab = true;
    } catch (e) {
      console.warn("[catalog-editor] reload partner review", e);
    }
  }

  if (nextKey && res?.status === "approved") {
    ctx.productKey = nextKey;
    ctx.partnerReviewOnly = false;
    try {
      ctx.bundle = await fetchEditorBundle(nextKey);
      overlayEl.querySelector("#ce-title").textContent = editorProductTitle(ctx.bundle, nextKey);
      ensureEditorSelections(ctx);
      initVisibilityFromBundle(ctx);
      captureVisibilityBaseline(ctx);
      bindCatalogEditorTriSwitch(ctx, () => refreshDirtyBeforeClose(ctx));
    } catch (e) {
      console.warn("[catalog-editor] load catalog after approve", e);
    }
  } else if (res?.discarded || res?.decision === "approval_revoked" || res?.decision === "discarded" || res?.status === "rejected") {
    // Keep productKey if present (data retained for re-approve) but refresh catalog bundle offline
    if (ctx.productKey) {
      try {
        ctx.bundle = await fetchEditorBundle(ctx.productKey);
        initVisibilityFromBundle(ctx);
        captureVisibilityBaseline(ctx);
      } catch {
        /* offline product may still load */
      }
    }
  }

  renderTabs(ctx);
  await loadActiveTab(ctx);
  if (typeof ctx.onReviewDone === "function") {
    try {
      await ctx.onReviewDone(res);
    } catch {
      /* catalog studio reload */
    }
  }
}

async function saveCurrentTab() {
  if (!editorState) return;
  syncActiveTabDom(editorState);
  refreshDirtyBeforeClose(editorState);
  if (!isEditorDirty()) return;
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
    if (ctx.activeTab !== "provider") {
      await saveVisibilityFromFooter(ctx);
    }
    await runMirror(true);
    ctx.bundle = await fetchEditorBundle(ctx.productKey);
    updateDriftBadge(ctx);
    // Success feedback MUST run before post-save remount. Provider remount (providers
    // bundle + catalog detail) is much slower than Variants; waiting for it meant the
    // flash either never ran (snapshot/reload throw) or appeared only after a long
    // "Saving…" and was easy to miss. Flash lives on .catalog-editor, outside #ce-body.
    hideSaveLoading();
    showSaveFlash();
    showToast("Saved", "Tab saved and mirrored to publish index");
    try {
      resetDirtyAfterSave(getCurrentTabDirtyState(ctx) ?? {});
      await loadActiveTab(ctx);
    } catch (reloadErr) {
      console.warn("[catalog-editor] post-save reload", reloadErr);
    }
  } catch (err) {
    showToast("Save failed", err.message || "Unknown error");
  } finally {
    hideSaveLoading();
    updateSaveButtonState(isEditorDirty());
  }
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

async function discardEditorChanges(ctx) {
  ctx.printAreaState = null;
  ctx.providersTabState = null;
  ctx.mockupsData = null;
  ctx.variantsData = null;
  ctx.printAreaData = null;
  try {
    ctx.bundle = await fetchEditorBundle(ctx.productKey);
  } catch {
    /* closing or reloading anyway */
  }
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
      await discardEditorChanges(editorState);
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
    // Save path must surface publish-index failures (previous silent swallow hid HTTP 500s).
    if (silent) throw err;
    showToast("Mirror failed", err.message || "");
  }
}

function updateDriftBadge() {
  /* drift badge removed from slim header — mirror status via footer action */
}

/**
 * Open the catalog product editor.
 * @param {string|{productKey?:string,manufacturerProductId?:string,initialTab?:string,onReviewDone?:Function}} productKeyOrOptions
 * @param {{initialTab?:string,manufacturerProductId?:string,onReviewDone?:Function}} [maybeOptions]
 */
export async function openProductEditor(productKeyOrOptions, maybeOptions) {
  let productKey = null;
  let manufacturerProductId = null;
  let initialTab = null;
  let onReviewDone = null;

  if (productKeyOrOptions && typeof productKeyOrOptions === "object") {
    productKey = productKeyOrOptions.productKey || null;
    manufacturerProductId = productKeyOrOptions.manufacturerProductId || null;
    initialTab = productKeyOrOptions.initialTab || null;
    onReviewDone = productKeyOrOptions.onReviewDone || null;
  } else {
    productKey = productKeyOrOptions || null;
    manufacturerProductId = maybeOptions?.manufacturerProductId || null;
    initialTab = maybeOptions?.initialTab || null;
    onReviewDone = maybeOptions?.onReviewDone || null;
  }

  ensureOverlay();
  overlayEl.hidden = false;
  overlayEl.querySelector("#ce-unsaved-dialog")?.setAttribute("hidden", "");
  applyEditorSidebarState();
  document.body.classList.add("catalog-editor-open");
  removeViewDock();

  const preferReview = initialTab === "review" || (!!manufacturerProductId && !productKey);

  editorState = {
    productKey,
    manufacturerProductId,
    partnerReview: null,
    showReviewTab: !!manufacturerProductId || preferReview,
    partnerReviewOnly: !!manufacturerProductId && !productKey,
    activeTab: preferReview ? "review" : initialTab || "provider",
    selectedPrintProviderId: null,
    selectedVersionId: null,
    bundle: null,
    onReviewDone,
    reloadTab: () => loadActiveTab(editorState),
  };
  window.__catalogEditorState = editorState;

  const ctx = editorState;
  overlayEl.querySelector("#ce-title").textContent = productKey || "Partner product review";
  overlayEl.querySelector("#ce-body").innerHTML = `<p class="catalog-editor-loading">Loading product…</p>`;
  updateFooterForMode(ctx);

  try {
    if (manufacturerProductId) {
      ctx.partnerReview = await loadPartnerReviewBundle(manufacturerProductId, null);
      ctx.showReviewTab = true;
      const linkedKey = ctx.partnerReview?.product?.eazpire_product_key || null;
      if (linkedKey && !productKey) {
        productKey = linkedKey;
        ctx.productKey = linkedKey;
        ctx.partnerReviewOnly = false;
      }
      const title =
        ctx.partnerReview?.product?.meta?.display_name ||
        ctx.partnerReview?.product?.title ||
        productKey ||
        "Partner product review";
      overlayEl.querySelector("#ce-title").textContent = title;
    } else if (productKey) {
      // Detect linked partner submission for Review tab on Todify/partner catalog items
      try {
        const linkBundle = await loadPartnerReviewBundle(null, productKey);
        if (linkBundle?.product?.id) {
          ctx.partnerReview = linkBundle;
          ctx.manufacturerProductId = linkBundle.product.id;
          ctx.showReviewTab = true;
        }
      } catch {
        /* no partner link — Review tab stays hidden */
      }
    }

    if (productKey) {
      ctx.bundle = await fetchEditorBundle(productKey);
      overlayEl.querySelector("#ce-title").textContent = editorProductTitle(ctx.bundle, productKey);
      ensureEditorSelections(ctx);
      initVisibilityFromBundle(ctx);
      captureVisibilityBaseline(ctx);
      bindCatalogEditorTriSwitch(ctx, () => refreshDirtyBeforeClose(ctx));
      updateDriftBadge(ctx);
    } else if (!ctx.partnerReview?.product) {
      throw new Error("Product not found");
    }

    if (preferReview && ctx.showReviewTab) ctx.activeTab = "review";
    else if (!ctx.showReviewTab && ctx.activeTab === "review") ctx.activeTab = "provider";

    updateFooterForMode(ctx);
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
  editorState?.printAreaUiCleanup?.();
  removeViewDock();
  overlayEl.hidden = true;
  document.body.classList.remove("catalog-editor-open");
  editorState = null;
  window.__catalogEditorState = null;
  clearDirtySnapshot();
  updateSaveButtonState(false);
}
