import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { fetchEditorBundle, mirrorProduct } from "./api.js";
import { renderMetaTab, saveMetaTab } from "./tabs/meta.js";
import { loadProvidersTab, bindProvidersTab, saveProvidersTab } from "./tabs/providers.js";
import { loadTemplateTab, saveTemplateTab } from "./tabs/template.js";
import { loadMockupsTab, saveMockupsTab } from "./tabs/mockups.js";
import { loadVariantsTab, saveVariantsTab } from "./tabs/variants.js";
import { loadPrintAreaTab, bindPrintAreaTab, savePrintAreaTab } from "./tabs/print-area.js";
import { loadProductsTab, bindProductsTab, saveProductsTab } from "./tabs/products.js";
import { renderAutomationsTab, bindAutomationsTab, saveAutomationsTab } from "./tabs/automations.js";

const TABS = [
  { id: "provider", label: "Provider", needsProvider: false },
  { id: "template", label: "Template", needsProvider: true },
  { id: "mockups", label: "Mockups", needsProvider: true },
  { id: "variants", label: "Variants", needsProvider: true },
  { id: "print_area", label: "Print Area", needsProvider: true },
  { id: "meta_data", label: "Meta", needsProvider: false },
  { id: "products", label: "Products", needsProvider: false },
  { id: "automations", label: "Automations", needsProvider: true },
];

let overlayEl = null;
let editorState = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "catalog-editor-overlay";
  overlayEl.className = "catalog-editor-overlay";
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="catalog-editor" role="dialog" aria-modal="true">
      <header class="catalog-editor-header">
        <div class="catalog-editor-title">
          <div>
            <p class="catalog-editor-sub">Product editor</p>
            <h1 id="ce-title">Product</h1>
            <p id="ce-drift" class="catalog-editor-sub"></p>
          </div>
        </div>
        <div class="catalog-editor-actions">
          <button type="button" class="icon-btn" id="ce-close" aria-label="Close editor">×</button>
        </div>
      </header>
      <nav class="catalog-editor-tabs" id="ce-tabs"></nav>
      <nav class="catalog-editor-subnav" id="ce-subnav" hidden>
        <div class="ce-provider-pills" id="ce-subnav-pills"></div>
      </nav>
      <main class="catalog-editor-body" id="ce-body"></main>
      <footer class="catalog-editor-foot">
        <div class="catalog-editor-foot-actions">
          <button type="button" class="btn btn-secondary" id="ce-mirror">Mirror to publish index</button>
          <button type="button" class="btn btn-primary" id="ce-save">Save tab</button>
        </div>
      </footer>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.querySelector("#ce-close").onclick = closeProductEditor;
  overlayEl.querySelector("#ce-save").onclick = () => saveCurrentTab();
  overlayEl.querySelector("#ce-mirror").onclick = () => runMirror();
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeProductEditor();
  });
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
  nav.innerHTML = TABS.map(
    (t) =>
      `<button type="button" class="ce-tab ${ctx.activeTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("");
  nav.querySelectorAll(".ce-tab").forEach((btn) => {
    btn.onclick = () => {
      ctx.activeTab = btn.dataset.tab;
      renderTabs(ctx);
      renderSubnav(ctx);
      loadActiveTab(ctx);
    };
  });
}

async function loadActiveTab(ctx) {
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
    showToast("Saved", "Tab saved and mirrored to publish index");
    await loadActiveTab(ctx);
  } catch (err) {
    showToast("Save failed", err.message || "Unknown error");
  } finally {
    saveBtn.disabled = false;
  }
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
  document.body.classList.add("catalog-editor-open");

  editorState = {
    productKey,
    activeTab: "provider",
    selectedPrintProviderId: null,
    selectedVersionId: null,
    bundle: null,
    reloadTab: () => loadActiveTab(editorState),
  };

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
}
