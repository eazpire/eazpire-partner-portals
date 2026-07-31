/**
 * Creations Portal — Design Detail Modal (Creator Design Preview parity, admin mode). IDEA-057.
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { openModal, showToast } from "/creations/shared/js/partner-shell.js";
import { openRemoveModal, openPublishModal, openUpdateModal } from "./designs-bulk-modals.js";

const ICON = {
  overview: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  metadata: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  products: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
};

const DEFAULT_PLACEMENT = { x: 0.5, y: 0.5, scale: 0.95, rotate: 0, flipX: false, flipY: false };
const BG_PRESETS = ["#37375A", "#0f172a", "#ffffff", "#111827", "#f59e0b", "checker"];
const AMAZON_BULLETS_KEY = "amazon_bullet_points_de";
const BULLET_SLOT_COUNT = 5;

let activeItem = null;
let onClosed = null;
let draftMeta = null;
let metaDirty = false;
let metaSaving = false;
let editTool = "crop";
let editBgMode = "complete";
let editColorTolerance = 30;
let editPickedColor = null;
let editBusy = false;
let editDirty = false;
let pendingEdit = null; // { kind, payload, previewUrl }
let zoomLevel = 1;
let panMode = false;
let viewerBg = "#37375A";
let lastCatalogPreview = null;
let lastUpdateDiff = null;
let productsNeedUpdate = false;
let selectedProductKeys = new Set();
let productStateByKey = new Map(); // key -> { online, publishedId, needsUpdate, title }
let activeTab = "overview";
let visibilitySaving = false;

function mockCompositing() {
  return window.CreatorMockCompositing || null;
}

function ensureRoot() {
  let root = document.getElementById("cr-design-detail");
  if (root) return root;
  root = document.createElement("div");
  root.id = "cr-design-detail";
  root.className = "cr-dd";
  root.hidden = true;
  root.innerHTML = `
    <div class="cr-dd__backdrop" data-cr-dd-close></div>
    <div class="cr-dd__shell" role="dialog" aria-modal="true" aria-labelledby="cr-dd-title">
      <header class="cr-dd__header">
        <h2 class="cr-dd__title" id="cr-dd-title">Design</h2>
        <button type="button" class="cr-dd__close" data-cr-dd-close aria-label="Close">×</button>
      </header>
      <div class="cr-dd__body">
        <nav class="cr-dd__rail" aria-label="Design sections">
          <button type="button" class="cr-dd__tab is-active" data-cr-dd-tab="overview" title="Overview">${ICON.overview}</button>
          <button type="button" class="cr-dd__tab" data-cr-dd-tab="edit" title="Edit">${ICON.edit}</button>
          <button type="button" class="cr-dd__tab" data-cr-dd-tab="metadata" title="Metadata">${ICON.metadata}</button>
          <button type="button" class="cr-dd__tab" data-cr-dd-tab="products" title="Products">${ICON.products}<span class="cr-dd__tab-badge" data-cr-dd-products-badge hidden></span></button>
        </nav>
        <div class="cr-dd__panels">
          <section class="cr-dd__panel is-active" data-cr-dd-panel="overview"></section>
          <section class="cr-dd__panel" data-cr-dd-panel="edit"></section>
          <section class="cr-dd__panel" data-cr-dd-panel="metadata"></section>
          <section class="cr-dd__panel" data-cr-dd-panel="products"></section>
        </div>
      </div>
      <footer class="cr-dd__footer" data-cr-dd-footer></footer>
    </div>`;
  document.body.appendChild(root);

  root.querySelectorAll("[data-cr-dd-close]").forEach((el) => {
    el.addEventListener("click", () => closeDesignDetailModal());
  });
  root.querySelectorAll("[data-cr-dd-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.getAttribute("data-cr-dd-tab")));
  });
  root.querySelector("[data-cr-dd-footer]")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cr-dd-act]");
    if (btn) handleFooterAction(btn.getAttribute("data-cr-dd-act"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root && !root.hidden) closeDesignDetailModal();
  });

  return root;
}

function setProductsTabNeedsUpdate(on) {
  productsNeedUpdate = !!on;
  const root = ensureRoot();
  const tab = root.querySelector('[data-cr-dd-tab="products"]');
  const badge = root.querySelector("[data-cr-dd-products-badge]");
  tab?.classList.toggle("needs-update", productsNeedUpdate);
  if (badge) {
    badge.hidden = !productsNeedUpdate;
    badge.textContent = productsNeedUpdate ? "!" : "";
  }
}

function renderFooter() {
  const root = ensureRoot();
  const footer = root.querySelector("[data-cr-dd-footer]");
  if (!footer) return;
  const tab = activeTab || "overview";

  if (tab === "overview") {
    footer.innerHTML = `
      <button type="button" class="btn btn-secondary" data-cr-dd-act="download">Download</button>
      <button type="button" class="btn btn-danger" data-cr-dd-act="remove">Remove</button>`;
    return;
  }
  if (tab === "edit") {
    footer.innerHTML = `
      <button type="button" class="btn btn-primary" data-cr-dd-act="edit-save" ${
        editDirty && pendingEdit ? "" : "disabled"
      }>Save</button>`;
    return;
  }
  if (tab === "metadata") {
    footer.innerHTML = `
      <button type="button" class="btn btn-secondary" data-cr-dd-act="meta-regen">Regenerate</button>
      <button type="button" class="btn btn-primary" data-cr-dd-act="meta-save" ${
        metaDirty && !metaSaving ? "" : "disabled"
      }>Save</button>`;
    return;
  }
  if (tab === "products") {
    const sel = [...selectedProductKeys];
    let canUpdate = false;
    let canPublish = false;
    let canUnpublish = false;
    for (const key of sel) {
      const st = productStateByKey.get(key);
      if (!st) continue;
      if (st.online && (st.needsUpdate || productsNeedUpdate)) canUpdate = true;
      if (!st.online) canPublish = true;
      if (st.online) canUnpublish = true;
    }
    footer.innerHTML = `
      <button type="button" class="btn btn-secondary" data-cr-dd-act="prod-update" ${canUpdate ? "" : "disabled"}>Update</button>
      <button type="button" class="btn btn-primary" data-cr-dd-act="prod-publish" ${canPublish ? "" : "disabled"}>Publish</button>
      <button type="button" class="btn btn-danger" data-cr-dd-act="prod-unpublish" ${canUnpublish ? "" : "disabled"}>Unpublish</button>`;
  }
}

async function handleFooterAction(act) {
  if (!activeItem) return;
  if (act === "download") {
    document
      .querySelector(`.cr-card[data-item-key="${CSS.escape(activeItem.item_key || "")}"] .cr-card__download`)
      ?.click();
    return;
  }
  if (act === "remove") {
    await openRemoveModal([activeItem], {
      onDone: async () => {
        closeDesignDetailModal();
        if (typeof onClosed === "function") await onClosed({ reload: true });
      },
    });
    return;
  }
  if (act === "meta-save") {
    await saveMetadata();
    return;
  }
  if (act === "meta-regen") {
    await regenerateMetadata();
    return;
  }
  if (act === "edit-save") {
    await commitPendingEdit();
    return;
  }
  if (act === "prod-update") {
    await updateSelectedProducts();
    return;
  }
  if (act === "prod-publish") {
    await publishSelectedProducts();
    return;
  }
  if (act === "prod-unpublish") {
    await unpublishSelectedProducts();
  }
}

function setTab(tab) {
  activeTab = tab || "overview";
  const root = ensureRoot();
  root.querySelectorAll("[data-cr-dd-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-cr-dd-tab") === activeTab);
  });
  root.querySelectorAll("[data-cr-dd-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.getAttribute("data-cr-dd-panel") === activeTab);
  });
  renderFooter();
  if (activeTab === "products") renderProductsPanel(activeItem).catch(() => {});
  if (activeTab === "edit") bindEditPanel();
  if (activeTab === "metadata") bindMetadataPanel();
  if (activeTab === "overview") bindOverviewChrome();
}

function designPreviewUrl(item) {
  return String(item?.preview_url || item?.original_url || "").trim();
}

function normalizeList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeBullets(meta) {
  const raw = meta?.[AMAZON_BULLETS_KEY];
  const list = Array.isArray(raw) ? raw.map((x) => String(x || "").trim()) : [];
  while (list.length < BULLET_SLOT_COUNT) list.push("");
  return list.slice(0, BULLET_SLOT_COUNT);
}

function cloneMeta(meta) {
  const m = meta && typeof meta === "object" ? { ...meta } : {};
  m.title = String(m.title || "").trim();
  m.description = String(m.description || "").trim();
  m.tags = normalizeList(m.tags);
  m.topics = normalizeList(m.topics || m.topic);
  m.subtopics = normalizeList(m.subtopics || m.subtopic);
  m.topic = m.topics;
  m.subtopic = m.subtopics;
  m[AMAZON_BULLETS_KEY] = normalizeBullets(m).filter(Boolean);
  return m;
}

function pickPrompts(item) {
  const meta = item?.metadata || {};
  const designPrompt = String(
    meta.design_prompt || item.design_prompt || item.prompt || ""
  ).trim();
  const userPrompt = String(meta.user_prompt || item.user_prompt || "").trim();
  const userImage = String(
    meta.user_image_url || meta.image_url || meta.baseImageUrl || item.user_image_url || ""
  ).trim();
  const visibility =
    String(item.visibility || meta.visibility || "private").toLowerCase() === "public"
      ? "public"
      : "private";
  return { designPrompt, userPrompt, userImage, visibility };
}

function applyViewerBg(el) {
  if (!el) return;
  if (viewerBg === "checker") {
    el.style.backgroundImage =
      "linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)";
    el.style.backgroundSize = "16px 16px";
    el.style.backgroundPosition = "0 0,0 8px,8px -8px,-8px 0";
    el.style.backgroundColor = "#e2e8f0";
  } else {
    el.style.backgroundImage = "none";
    el.style.backgroundColor = viewerBg;
  }
}

function applyZoom(stage) {
  if (!stage) return;
  stage.style.transform = `scale(${zoomLevel})`;
  stage.classList.toggle("is-pan", panMode);
}

function zoomChromeHtml() {
  return `
    <div class="cr-dd-zoom-chrome">
      <button type="button" class="cr-dd-zoom-btn" data-cr-dd-zoom-out aria-label="Zoom out">−</button>
      <button type="button" class="cr-dd-zoom-btn" data-cr-dd-zoom-in aria-label="Zoom in">+</button>
      <button type="button" class="cr-dd-zoom-btn" data-cr-dd-pan aria-label="Pan" aria-pressed="false">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12h8M12 8v8"/><path d="M5 9l-2 3 2 3M19 9l2 3-2 3M9 5l3-2 3 2M9 19l3 2 3-2"/></svg>
      </button>
    </div>
    <button type="button" class="cr-dd-bg-btn" data-cr-dd-bg-open aria-label="Background" title="Background">
      <span class="cr-dd-bg-swatch" data-cr-dd-bg-swatch></span>
    </button>
    <div class="cr-dd-bg-popover" data-cr-dd-bg-popover hidden>
      <div class="cr-dd-bg-presets">
        ${BG_PRESETS.map(
          (c) =>
            `<button type="button" class="cr-dd-bg-preset ${c === "checker" ? "is-checker" : ""}" data-cr-dd-bg="${escapeHtml(
              c
            )}" style="${c === "checker" ? "" : `background:${escapeHtml(c)}`}" aria-label="${escapeHtml(c)}"></button>`
        ).join("")}
      </div>
    </div>`;
}

function renderOverview(item) {
  const preview = designPreviewUrl(item);
  const { designPrompt, userPrompt, userImage, visibility } = pickPrompts(item);
  const isPublic = visibility === "public";
  return `
    <div class="cr-dd-overview">
      <div class="cr-dd-col">
        <div class="cr-dd-frame">
          <div class="cr-dd-frame__label">Design</div>
          <div class="cr-dd-frame__media" data-cr-dd-viewer="design">
            <div class="cr-dd-zoom-stage" data-cr-dd-zoom-stage>
              ${
                preview
                  ? `<img class="cr-dd-frame__img" src="${escapeHtml(preview)}" alt="" />`
                  : `<div class="cr-dd-frame__empty">No preview</div>`
              }
            </div>
            ${zoomChromeHtml()}
          </div>
        </div>
        <div class="cr-dd-prompt">
          <label>Design prompt</label>
          <textarea readonly rows="4">${escapeHtml(designPrompt || "—")}</textarea>
        </div>
        <div class="cr-dd-visibility">
          <label>Visibility</label>
          <label class="cr-dd-switch">
            <span>Private</span>
            <input type="checkbox" id="cr-dd-visibility" ${isPublic ? "checked" : ""} />
            <span class="cr-dd-switch__track" aria-hidden="true"></span>
            <span>Public</span>
          </label>
        </div>
      </div>
      <div class="cr-dd-col">
        <div class="cr-dd-frame">
          <div class="cr-dd-frame__label">User Design</div>
          <div class="cr-dd-frame__media" data-cr-dd-viewer="user">
            ${
              userImage
                ? `<img class="cr-dd-frame__img" src="${escapeHtml(userImage)}" alt="User design reference" />`
                : `<div class="cr-dd-frame__empty">No user reference image</div>`
            }
          </div>
        </div>
        <div class="cr-dd-prompt">
          <label>User prompt</label>
          <textarea readonly rows="4">${escapeHtml(userPrompt || "—")}</textarea>
        </div>
      </div>
    </div>`;
}

function bindOverviewChrome() {
  const root = ensureRoot();
  const panel = root.querySelector('[data-cr-dd-panel="overview"]');
  if (!panel) return;
  const media = panel.querySelector('[data-cr-dd-viewer="design"]');
  if (media && !media.__crDdBound) {
    media.__crDdBound = true;
    const stage = media.querySelector("[data-cr-dd-zoom-stage]");
    applyViewerBg(media);
    applyZoom(stage);
    media.querySelector("[data-cr-dd-zoom-in]")?.addEventListener("click", () => {
      zoomLevel = Math.min(4, zoomLevel + 0.25);
      applyZoom(stage);
    });
    media.querySelector("[data-cr-dd-zoom-out]")?.addEventListener("click", () => {
      zoomLevel = Math.max(0.5, zoomLevel - 0.25);
      applyZoom(stage);
    });
    media.querySelector("[data-cr-dd-pan]")?.addEventListener("click", (e) => {
      panMode = !panMode;
      e.currentTarget.setAttribute("aria-pressed", panMode ? "true" : "false");
      e.currentTarget.classList.toggle("is-active", panMode);
      applyZoom(stage);
    });
    const pop = media.querySelector("[data-cr-dd-bg-popover]");
    media.querySelector("[data-cr-dd-bg-open]")?.addEventListener("click", () => {
      if (pop) pop.hidden = !pop.hidden;
    });
    media.querySelectorAll("[data-cr-dd-bg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewerBg = btn.getAttribute("data-cr-dd-bg") || "#37375A";
        applyViewerBg(media);
        const sw = media.querySelector("[data-cr-dd-bg-swatch]");
        if (sw) {
          sw.classList.toggle("is-checker", viewerBg === "checker");
          sw.style.background = viewerBg === "checker" ? "" : viewerBg;
        }
        if (pop) pop.hidden = true;
      });
    });
  }

  const vis = panel.querySelector("#cr-dd-visibility");
  if (vis && !vis.__crDdBound) {
    vis.__crDdBound = true;
    vis.addEventListener("change", async () => {
      if (!activeItem?.id || visibilitySaving) return;
      const next = vis.checked ? "public" : "private";
      visibilitySaving = true;
      try {
        const data = await partnerFetch("admin-design-set-visibility", {
          method: "POST",
          body: { design_id: activeItem.id, visibility: next },
        });
        activeItem.visibility = next;
        if (!activeItem.metadata) activeItem.metadata = {};
        activeItem.metadata.visibility = next;
        if (data.metadata) activeItem.metadata = { ...activeItem.metadata, ...data.metadata };
        showToast("Visibility", next === "public" ? "Public" : "Private");
      } catch (e) {
        vis.checked = !vis.checked;
        showToast("Error", e.message || "Visibility update failed");
      } finally {
        visibilitySaving = false;
      }
    });
  }
}

function renderEdit(item) {
  const preview = designPreviewUrl(item);
  return `
    <div class="cr-dd-edit">
      <div class="cr-dd-edit__viewer" data-cr-dd-edit-viewer>
        <img class="cr-dd-edit__img" id="cr-dd-edit-img" src="${escapeHtml(preview)}" alt="" />
        <p class="cr-dd-edit__status" id="cr-dd-edit-status" hidden></p>
      </div>
      <div class="cr-dd-edit__tools">
        <div class="cr-dd-edit__tabs" role="tablist">
          <button type="button" class="cr-dd-edit__tab is-active" data-cr-dd-edit-tool="crop">Crop</button>
          <button type="button" class="cr-dd-edit__tab" data-cr-dd-edit-tool="remove_bg">Remove background</button>
          <button type="button" class="cr-dd-edit__tab" data-cr-dd-edit-tool="remove_color">Remove color</button>
          <button type="button" class="cr-dd-edit__tab" data-cr-dd-edit-tool="remove_object">Remove object</button>
        </div>
        <div class="cr-dd-edit__panel is-active" data-cr-dd-edit-panel="crop">
          <p class="cr-dd-muted">Preview auto-crop, then Save in the footer to commit.</p>
          <button type="button" class="btn btn-secondary" id="cr-dd-edit-crop">Preview crop</button>
        </div>
        <div class="cr-dd-edit__panel" data-cr-dd-edit-panel="remove_bg" hidden>
          <div class="cr-dd-edit__seg">
            <button type="button" class="cr-dd-edit__seg-btn is-active" data-cr-dd-bg-mode="complete">Complete</button>
            <button type="button" class="cr-dd-edit__seg-btn" data-cr-dd-bg-mode="outside">Outside</button>
          </div>
          <button type="button" class="btn btn-secondary" id="cr-dd-edit-bg-preview">Preview</button>
        </div>
        <div class="cr-dd-edit__panel" data-cr-dd-edit-panel="remove_color" hidden>
          <p class="cr-dd-muted">Click the image to pick a color, then preview. Save in the footer to commit.</p>
          <div class="cr-dd-edit__row">
            <span class="cr-dd-edit__swatch" id="cr-dd-edit-color-swatch"></span>
            <label>Tolerance <input type="range" id="cr-dd-edit-color-tol" min="0" max="100" value="30" /></label>
          </div>
          <button type="button" class="btn btn-secondary" id="cr-dd-edit-color-preview">Preview color remove</button>
        </div>
        <div class="cr-dd-edit__panel" data-cr-dd-edit-panel="remove_object" hidden>
          <p class="cr-dd-muted">Object remove needs a brush mask in Creator. Use History to re-apply versions.</p>
          <button type="button" class="btn btn-secondary" id="cr-dd-edit-history">Edit history</button>
        </div>
        <div id="cr-dd-edit-versions" class="cr-dd-edit__versions" hidden></div>
      </div>
    </div>`;
}

function setEditTool(tool) {
  editTool = tool;
  const root = ensureRoot();
  root.querySelectorAll("[data-cr-dd-edit-tool]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-cr-dd-edit-tool") === tool);
  });
  root.querySelectorAll("[data-cr-dd-edit-panel]").forEach((panel) => {
    const on = panel.getAttribute("data-cr-dd-edit-panel") === tool;
    panel.classList.toggle("is-active", on);
    panel.hidden = !on;
  });
}

function setEditStatus(msg) {
  const el = document.getElementById("cr-dd-edit-status");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function markPendingEdit(kind, payload, previewUrl) {
  pendingEdit = { kind, payload, previewUrl };
  editDirty = true;
  const img = document.getElementById("cr-dd-edit-img");
  if (img && previewUrl) img.src = previewUrl;
  renderFooter();
}

function applyEditedDesign(design) {
  if (!design || !activeItem) return;
  if (design.preview_url) activeItem.preview_url = design.preview_url;
  if (design.original_url) activeItem.original_url = design.original_url;
  if (design.image_url) activeItem.original_url = design.image_url;
  const img = document.getElementById("cr-dd-edit-img");
  const url = designPreviewUrl(activeItem);
  if (img && url) img.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const overviewImg = document.querySelector('[data-cr-dd-panel="overview"] .cr-dd-frame__img');
  if (overviewImg && url) overviewImg.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  pendingEdit = null;
  editDirty = false;
  setProductsTabNeedsUpdate(true);
  renderFooter();
}

async function runRemoveBgPreview() {
  if (!activeItem?.id || editBusy) return;
  editBusy = true;
  setEditStatus("Generating preview…");
  try {
    const data = await partnerFetch("admin-design-edit-remove-background", {
      method: "POST",
      body: {
        design_id: activeItem.id,
        mode: editBgMode,
        preview_only: true,
      },
    });
    const previewUrl = data.version?.preview_url || data.preview_url;
    if (previewUrl) {
      markPendingEdit("remove_bg", { mode: editBgMode }, previewUrl);
      showToast("Preview", "Preview ready — click Save to commit");
    }
  } catch (e) {
    showToast("Error", e.message || "Remove background failed");
  } finally {
    editBusy = false;
    setEditStatus("");
  }
}

async function runRemoveColorPreview() {
  if (!activeItem?.id || editBusy) return;
  if (!editPickedColor) {
    showToast("Remove color", "Click the image to pick a color first");
    return;
  }
  editBusy = true;
  setEditStatus("Generating preview…");
  try {
    const data = await partnerFetch("admin-design-edit-remove-color", {
      method: "POST",
      body: {
        design_id: activeItem.id,
        colors: [editPickedColor],
        tolerance: editColorTolerance,
        replace_mode: "transparent",
        preview_only: true,
      },
    });
    const previewUrl = data.version?.preview_url || data.preview_url || data.design?.preview_url;
    if (previewUrl) {
      markPendingEdit(
        "remove_color",
        {
          colors: [editPickedColor],
          tolerance: editColorTolerance,
          replace_mode: "transparent",
        },
        previewUrl
      );
      showToast("Preview", "Preview ready — click Save to commit");
    } else {
      showToast("Preview", "No preview URL returned");
    }
  } catch (e) {
    showToast("Error", e.message || "Remove color failed");
  } finally {
    editBusy = false;
    setEditStatus("");
  }
}

async function runAutoCropPreview() {
  if (!activeItem?.id || editBusy) return;
  editBusy = true;
  setEditStatus("Cropping preview…");
  try {
    const data = await partnerFetch("admin-design-edit-image-preview", {
      method: "POST",
      body: { design_id: activeItem.id, image_operation: "auto_crop" },
    });
    const preview = data.preview_url || designPreviewUrl(activeItem);
    markPendingEdit(
      "crop",
      {
        preview_url: preview,
        original_url: data.original_url || preview,
        image_operation: "auto_crop",
      },
      preview
    );
    showToast("Preview", "Crop preview ready — click Save to commit");
  } catch (e) {
    showToast("Error", e.message || "Crop failed");
  } finally {
    editBusy = false;
    setEditStatus("");
  }
}

async function commitPendingEdit() {
  if (!activeItem?.id || !pendingEdit || editBusy) return;
  editBusy = true;
  setEditStatus("Saving…");
  try {
    if (pendingEdit.kind === "crop") {
      const commit = await partnerFetch("admin-design-edit-image-commit", {
        method: "POST",
        body: {
          design_id: activeItem.id,
          ...pendingEdit.payload,
        },
      });
      if (commit.ok !== false) {
        applyEditedDesign({
          preview_url: pendingEdit.payload.preview_url,
          original_url: pendingEdit.payload.original_url,
        });
        showToast("Edit", "Crop saved");
      }
    } else if (pendingEdit.kind === "remove_bg") {
      const data = await partnerFetch("admin-design-edit-remove-background", {
        method: "POST",
        body: {
          design_id: activeItem.id,
          mode: pendingEdit.payload.mode || editBgMode,
          preview_only: false,
        },
      });
      if (data.design) applyEditedDesign(data.design);
      else applyEditedDesign({ preview_url: pendingEdit.previewUrl });
      showToast("Edit", "Background removed");
    } else if (pendingEdit.kind === "remove_color") {
      const data = await partnerFetch("admin-design-edit-remove-color", {
        method: "POST",
        body: {
          design_id: activeItem.id,
          ...pendingEdit.payload,
          preview_only: false,
        },
      });
      if (data.design) applyEditedDesign(data.design);
      else applyEditedDesign({ preview_url: pendingEdit.previewUrl });
      showToast("Edit", "Color removed");
    }
  } catch (e) {
    showToast("Error", e.message || "Save failed");
  } finally {
    editBusy = false;
    setEditStatus("");
    renderFooter();
  }
}

async function loadEditVersions() {
  const host = document.getElementById("cr-dd-edit-versions");
  if (!host || !activeItem?.id) return;
  host.hidden = false;
  host.innerHTML = `<p class="cr-dd-muted">Loading versions…</p>`;
  try {
    const data = await partnerFetch("admin-design-edit-list-versions", {
      query: { design_id: activeItem.id },
    });
    const versions = data.versions || data.items || [];
    if (!versions.length) {
      host.innerHTML = `<p class="cr-dd-muted">No edit versions yet.</p>`;
      return;
    }
    host.innerHTML = `<ul class="cr-dd-edit__version-list">${versions
      .slice(0, 12)
      .map(
        (v) =>
          `<li>
            <span>${escapeHtml(v.label || v.version_type || "Version")} ${v.is_applied ? "· applied" : ""}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-cr-dd-apply-ver="${escapeHtml(
              String(v.id)
            )}">Apply</button>
          </li>`
      )
      .join("")}</ul>`;
    host.querySelectorAll("[data-cr-dd-apply-ver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const res = await partnerFetch("admin-design-edit-apply-version", {
            method: "POST",
            body: { design_id: activeItem.id, version_id: Number(btn.getAttribute("data-cr-dd-apply-ver")) },
          });
          if (res.design) applyEditedDesign(res.design);
          showToast("Edit", "Version applied");
          await loadEditVersions();
        } catch (e) {
          showToast("Error", e.message || "Apply failed");
        }
      });
    });
  } catch (e) {
    host.innerHTML = `<p class="cr-bulk-error">${escapeHtml(e.message || "Failed to load versions")}</p>`;
  }
}

function bindEditPanel() {
  const root = ensureRoot();
  const panel = root.querySelector('[data-cr-dd-panel="edit"]');
  if (!panel || panel.__crDdEditBound) return;
  panel.__crDdEditBound = true;
  panel.querySelectorAll("[data-cr-dd-edit-tool]").forEach((btn) => {
    btn.addEventListener("click", () => setEditTool(btn.getAttribute("data-cr-dd-edit-tool")));
  });
  panel.querySelectorAll("[data-cr-dd-bg-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editBgMode = btn.getAttribute("data-cr-dd-bg-mode") || "complete";
      panel.querySelectorAll("[data-cr-dd-bg-mode]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
    });
  });
  panel.querySelector("#cr-dd-edit-crop")?.addEventListener("click", () => runAutoCropPreview());
  panel.querySelector("#cr-dd-edit-bg-preview")?.addEventListener("click", () => runRemoveBgPreview());
  panel.querySelector("#cr-dd-edit-color-preview")?.addEventListener("click", () => runRemoveColorPreview());
  panel.querySelector("#cr-dd-edit-history")?.addEventListener("click", () => loadEditVersions());
  panel.querySelector("#cr-dd-edit-color-tol")?.addEventListener("input", (e) => {
    editColorTolerance = Number(e.target.value) || 30;
  });
  const img = panel.querySelector("#cr-dd-edit-img");
  img?.addEventListener("click", (e) => {
    if (editTool !== "remove_color") return;
    try {
      const canvas = document.createElement("canvas");
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const rect = img.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * w);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * h);
      const px = ctx.getImageData(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)), 1, 1).data;
      editPickedColor = { r: px[0], g: px[1], b: px[2] };
      const sw = document.getElementById("cr-dd-edit-color-swatch");
      if (sw) sw.style.background = `rgb(${px[0]},${px[1]},${px[2]})`;
    } catch (_) {
      showToast("Remove color", "Could not sample color (CORS). Try another image host.");
    }
  });
}

function chipHtml(list, kind) {
  if (!list.length) return `<span class="cr-dd-muted">—</span>`;
  return list
    .map(
      (t, i) =>
        `<span class="cr-dd-chip">${escapeHtml(t)} <button type="button" data-cr-dd-chip-rm="${kind}:${i}" aria-label="Remove">×</button></span>`
    )
    .join("");
}

function bulletsHtml(meta) {
  const bullets = normalizeBullets(meta);
  return bullets
    .map(
      (b, i) => `
      <div class="cr-dd-meta-field cr-dd-meta-bullet">
        <label for="cr-dd-meta-bullet-${i}">Bullet point ${i + 1}</label>
        <input type="text" id="cr-dd-meta-bullet-${i}" data-cr-dd-bullet="${i}" value="${escapeHtml(
          b
        )}" autocomplete="off" maxlength="256" />
      </div>`
    )
    .join("");
}

function renderMetadata(item) {
  const meta = draftMeta || cloneMeta(item.metadata);
  return `
    <div class="cr-dd-meta-editor">
      <div class="cr-dd-meta-field">
        <label for="cr-dd-meta-title">Title</label>
        <input type="text" id="cr-dd-meta-title" value="${escapeHtml(meta.title || "")}" autocomplete="off" />
      </div>
      <div class="cr-dd-meta-field">
        <label for="cr-dd-meta-description">Description</label>
        <textarea id="cr-dd-meta-description" rows="4">${escapeHtml(meta.description || "")}</textarea>
      </div>
      <div class="cr-dd-meta-field">
        <label>Tags</label>
        <div class="cr-dd-chip-row" id="cr-dd-meta-tags">${chipHtml(meta.tags || [], "tags")}</div>
        <div class="cr-dd-meta-add">
          <input type="text" id="cr-dd-meta-tags-input" placeholder="Add tag" autocomplete="off" />
          <button type="button" class="btn btn-secondary" data-cr-dd-meta-add="tags">Add</button>
        </div>
      </div>
      <div class="cr-dd-meta-field">
        <label>Topics</label>
        <div class="cr-dd-chip-row" id="cr-dd-meta-topics">${chipHtml(meta.topics || [], "topics")}</div>
        <div class="cr-dd-meta-add">
          <input type="text" id="cr-dd-meta-topics-input" placeholder="Add topic" autocomplete="off" />
          <button type="button" class="btn btn-secondary" data-cr-dd-meta-add="topics">Add</button>
        </div>
      </div>
      <div class="cr-dd-meta-field">
        <label>Subtopics</label>
        <div class="cr-dd-chip-row" id="cr-dd-meta-subtopics">${chipHtml(meta.subtopics || [], "subtopics")}</div>
        <div class="cr-dd-meta-add">
          <input type="text" id="cr-dd-meta-subtopics-input" placeholder="Add subtopic" autocomplete="off" />
          <button type="button" class="btn btn-secondary" data-cr-dd-meta-add="subtopics">Add</button>
        </div>
      </div>
      <div class="cr-dd-meta-bullets">
        <h3 class="cr-dd-meta-bullets__title">Amazon bullet points</h3>
        <p class="cr-dd-muted">Generated on Save / Regenerate with other metadata (DE listing bullets).</p>
        ${bulletsHtml(meta)}
      </div>
    </div>`;
}

function collectMetaFromDom() {
  const meta = draftMeta || cloneMeta(activeItem?.metadata);
  const titleEl = document.getElementById("cr-dd-meta-title");
  const descEl = document.getElementById("cr-dd-meta-description");
  if (titleEl) meta.title = titleEl.value.trim();
  if (descEl) meta.description = descEl.value.trim();
  meta.tags = normalizeList(meta.tags);
  meta.topics = normalizeList(meta.topics);
  meta.subtopics = normalizeList(meta.subtopics);
  meta.topic = meta.topics;
  meta.subtopic = meta.subtopics;
  const bullets = [];
  document.querySelectorAll("[data-cr-dd-bullet]").forEach((el) => {
    const v = String(el.value || "").trim();
    if (v) bullets.push(v);
  });
  meta[AMAZON_BULLETS_KEY] = bullets;
  draftMeta = meta;
  return meta;
}

function refreshMetaChips() {
  const meta = draftMeta || cloneMeta(activeItem?.metadata);
  const tags = document.getElementById("cr-dd-meta-tags");
  const topics = document.getElementById("cr-dd-meta-topics");
  const sub = document.getElementById("cr-dd-meta-subtopics");
  if (tags) tags.innerHTML = chipHtml(meta.tags || [], "tags");
  if (topics) topics.innerHTML = chipHtml(meta.topics || [], "topics");
  if (sub) sub.innerHTML = chipHtml(meta.subtopics || [], "subtopics");
  bindChipRemoves();
  renderFooter();
}

function bindChipRemoves() {
  const root = ensureRoot();
  root.querySelectorAll("[data-cr-dd-chip-rm]").forEach((btn) => {
    btn.onclick = () => {
      const [kind, idxStr] = String(btn.getAttribute("data-cr-dd-chip-rm") || "").split(":");
      const idx = Number(idxStr);
      const meta = collectMetaFromDom();
      if (Array.isArray(meta[kind])) meta[kind].splice(idx, 1);
      metaDirty = true;
      refreshMetaChips();
    };
  });
}

function markMetaDirty() {
  metaDirty = true;
  collectMetaFromDom();
  renderFooter();
}

async function saveMetadata() {
  if (!activeItem?.id || metaSaving) return;
  const metadata = collectMetaFromDom();
  metaSaving = true;
  renderFooter();
  try {
    const data = await partnerFetch("admin-design-edit-metadata", {
      method: "POST",
      body: { design_id: activeItem.id, metadata },
    });
    const saved = data.metadata || metadata;
    activeItem.metadata = saved;
    if (saved.title) {
      activeItem.title = saved.title;
      const titleEl = document.getElementById("cr-dd-title");
      if (titleEl) titleEl.textContent = saved.title;
    }
    draftMeta = cloneMeta(saved);
    metaDirty = false;
    setProductsTabNeedsUpdate(true);
    const panel = ensureRoot().querySelector('[data-cr-dd-panel="metadata"]');
    if (panel) {
      panel.innerHTML = renderMetadata(activeItem);
      bindMetadataPanel();
    }
    showToast("Metadata", "Saved");
  } catch (e) {
    showToast("Error", e.message || "Save failed");
  } finally {
    metaSaving = false;
    renderFooter();
  }
}

async function regenerateMetadata() {
  if (!activeItem?.id) return;
  try {
    const data = await partnerFetch("admin-design-metadata-full-regenerate", {
      method: "POST",
      body: { design_id: activeItem.id },
    });
    const next = data.metadata || {};
    draftMeta = cloneMeta(next);
    metaDirty = true;
    ensureRoot().querySelector('[data-cr-dd-panel="metadata"]').innerHTML = renderMetadata(activeItem);
    bindMetadataPanel();
    renderFooter();
    showToast("Metadata", "Regenerated draft — save to persist");
  } catch (e) {
    showToast("Error", e.message || "Regenerate failed");
  }
}

function bindMetadataPanel() {
  const root = ensureRoot();
  const panel = root.querySelector('[data-cr-dd-panel="metadata"]');
  if (!panel) return;
  panel.__crDdMetaBound = true;
  panel.querySelector("#cr-dd-meta-title")?.addEventListener("input", markMetaDirty);
  panel.querySelector("#cr-dd-meta-description")?.addEventListener("input", markMetaDirty);
  panel.querySelectorAll("[data-cr-dd-bullet]").forEach((el) => {
    el.addEventListener("input", markMetaDirty);
  });
  panel.querySelectorAll("[data-cr-dd-meta-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-cr-dd-meta-add");
      const input = document.getElementById(`cr-dd-meta-${kind}-input`);
      const val = String(input?.value || "").trim();
      if (!val) return;
      const meta = collectMetaFromDom();
      if (!Array.isArray(meta[kind])) meta[kind] = [];
      if (!meta[kind].includes(val)) meta[kind].push(val);
      if (input) input.value = "";
      metaDirty = true;
      refreshMetaChips();
    });
  });
  bindChipRemoves();
}

function parseZoneFrac(f) {
  const MC = mockCompositing();
  if (MC) return MC.parseZoneFrac(f);
  return { l: 0.28, t: 0.22, w: 0.44, h: 0.48 };
}

function normalizePlacement(raw) {
  const MC = mockCompositing();
  if (MC?.normalizeOpenSeedPlacement) return MC.normalizeOpenSeedPlacement(raw || {});
  return { ...DEFAULT_PLACEMENT, ...(raw || {}) };
}

function layoutStack(stackEl, attempt = 0) {
  if (!stackEl) return;
  const frame = stackEl.querySelector(".cr-dd-compose__frame");
  const stage = stackEl.querySelector(".cr-dd-compose__stage");
  const mock = stackEl.querySelector(".cr-dd-compose__mock");
  const zone = stackEl.querySelector(".cr-dd-compose__zone");
  const design = stackEl.querySelector(".cr-dd-compose__design");
  if (!frame || !stage || !mock) return;
  if (!mock.complete || !mock.naturalWidth) {
    if (attempt < 48) setTimeout(() => layoutStack(stackEl, attempt + 1), attempt < 12 ? 16 : 50);
    return;
  }
  const MC = mockCompositing();
  if (MC) MC.fitMockStage(stage, mock, frame);
  else {
    const nw = mock.naturalWidth;
    const nh = mock.naturalHeight;
    const boxW = Math.max(1, frame.clientWidth);
    const boxH = Math.max(1, frame.clientHeight);
    const fit = Math.min(boxW / nw, boxH / nh);
    stage.style.width = `${Math.max(1, nw * fit)}px`;
    stage.style.height = `${Math.max(1, nh * fit)}px`;
    mock.style.width = "100%";
    mock.style.height = "100%";
    mock.style.objectFit = "fill";
  }
  if (!zone || !design) return;
  if (!design.complete || !design.naturalWidth) {
    if (attempt < 48) setTimeout(() => layoutStack(stackEl, attempt + 1), attempt < 12 ? 16 : 50);
    return;
  }
  let placement = DEFAULT_PLACEMENT;
  try {
    placement = normalizePlacement(JSON.parse(stackEl.getAttribute("data-card-placement") || "{}"));
  } catch (_) {}
  if (MC) {
    MC.applyDesignTransformInZone(design, zone, placement, { uiScaleMax: 4, minDesignWidth: 8 });
  } else {
    design.classList.add("is-laid-out");
  }
}

function buildComposeStack(slide, designUrl) {
  const mockUrl = String(slide?.mock_url || "").trim();
  if (!mockUrl || !designUrl) return null;
  const z = parseZoneFrac(slide?.print_area_frac);
  const placement = normalizePlacement(slide?.placement);
  const stack = document.createElement("div");
  stack.className = "cr-dd-compose__slide is-active";
  stack.setAttribute("data-card-placement", JSON.stringify(placement));
  stack.innerHTML = `
    <div class="cr-dd-compose__frame">
      <div class="cr-dd-compose__stage">
        <img class="cr-dd-compose__mock" src="${escapeHtml(mockUrl)}" alt="" decoding="async" draggable="false" />
        <span class="cr-dd-compose__zone" style="left:${z.l * 100}%;top:${z.t * 100}%;width:${z.w * 100}%;height:${z.h * 100}%;">
          <img class="cr-dd-compose__design" src="${escapeHtml(designUrl)}" alt="" decoding="async" draggable="false" />
        </span>
      </div>
    </div>`;
  const mock = stack.querySelector(".cr-dd-compose__mock");
  const design = stack.querySelector(".cr-dd-compose__design");
  const after = () => layoutStack(stack);
  [mock, design].forEach((img) => {
    if (img.complete && img.naturalWidth) return;
    img.addEventListener("load", after, { once: true });
    img.addEventListener("error", after, { once: true });
  });
  requestAnimationFrame(after);
  setTimeout(after, 80);
  setTimeout(after, 320);
  return stack;
}

function synthesizePreviewFromMocks(urls) {
  const slides = (urls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((mock_url) => ({
      mock_url,
      print_area_frac: null,
      placement: { ...DEFAULT_PLACEMENT },
    }));
  return slides.length ? { slides } : null;
}

function mountComposedMedia(mediaEl, previewConfig, designUrl) {
  if (!mediaEl) return;
  mediaEl.innerHTML = "";
  mediaEl.classList.add("cr-dd-compose");
  const slides = (previewConfig?.slides || []).filter((s) => s?.mock_url);
  if (!slides.length || !designUrl) {
    mediaEl.innerHTML = `<span class="cr-dd-prod__empty">No mock</span>`;
    return;
  }
  const stack = buildComposeStack(slides[0], designUrl);
  if (stack) mediaEl.appendChild(stack);
}

function openNeedsUpdateInfoModal() {
  const diffs = lastUpdateDiff?.field_diffs || [];
  const keys = lastUpdateDiff?.changed_fields || lastUpdateDiff?.changed_field_keys || [];
  const imageChanged = !!(lastUpdateDiff?.image_changed || lastUpdateDiff?.summary?.image_changed);
  let body;
  if (diffs.length) {
    body = `<ul class="cr-dd-diff-list">${diffs
      .map(
        (d) => `<li>
          <strong>${escapeHtml(d.field)}</strong>
          <div class="cr-dd-diff-list__row"><span class="cr-dd-diff-list__label">Before</span><code>${escapeHtml(
            d.before || "—"
          )}</code></div>
          <div class="cr-dd-diff-list__row"><span class="cr-dd-diff-list__label">After</span><code>${escapeHtml(
            d.after || "—"
          )}</code></div>
        </li>`
      )
      .join("")}</ul>`;
  } else {
    const bits = [];
    if (imageChanged) bits.push("Design image changed");
    if (keys.length) bits.push(`Metadata: ${keys.slice(0, 12).join(", ")}`);
    body = bits.length
      ? `<p class="confirm-modal-message">${escapeHtml(bits.join(" · "))}</p>`
      : `<p class="confirm-modal-message">Changes detected since last publish snapshot.</p>`;
  }
  openModal({
    title: "Needs update — changes since publish",
    bodyHtml: body,
    onSave: async () => {},
  });
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) saveBtn.style.display = "none";
}

function syncProductSelectionUi() {
  const root = ensureRoot();
  root.querySelectorAll(".cr-dd-prod").forEach((card) => {
    const key = card.getAttribute("data-product-key") || "";
    const cb = card.querySelector(".cr-dd-prod__cb");
    if (cb) cb.checked = selectedProductKeys.has(key);
    card.classList.toggle("is-selected", selectedProductKeys.has(key));
  });
  renderFooter();
}

async function updateSelectedProducts() {
  if (!activeItem) return;
  await openUpdateModal([activeItem], {
    onDone: async () => {
      setProductsTabNeedsUpdate(false);
      await renderProductsPanel(activeItem);
    },
  });
}

async function publishSelectedProducts() {
  if (!activeItem?.id) return;
  const offlineKeys = [...selectedProductKeys].filter((k) => {
    const st = productStateByKey.get(k);
    return st && !st.online;
  });
  if (!offlineKeys.length) {
    showToast("Publish", "Select offline products");
    return;
  }
  try {
    await partnerFetch("admin-design-publish-missing-online", {
      method: "POST",
      body: { design_id: activeItem.id, product_keys: offlineKeys, region_code: "EU" },
    });
    showToast("Publish", `${offlineKeys.length} product(s) queued`);
    selectedProductKeys.clear();
    await renderProductsPanel(activeItem);
    if (typeof onClosed === "function") await onClosed({ reload: false });
  } catch (e) {
    // Fallback to full publish modal if direct keys fail
    try {
      await openPublishModal([activeItem], {
        onDone: async () => {
          await renderProductsPanel(activeItem);
          if (typeof onClosed === "function") await onClosed({ reload: false });
        },
      });
    } catch (_) {
      showToast("Error", e.message || "Publish failed");
    }
  }
}

async function unpublishSelectedProducts() {
  if (!activeItem?.id) return;
  const onlineKeys = [...selectedProductKeys].filter((k) => productStateByKey.get(k)?.online);
  if (!onlineKeys.length) {
    showToast("Unpublish", "Select online products");
    return;
  }
  const publishedIds = onlineKeys
    .map((k) => Number(productStateByKey.get(k)?.publishedId || 0))
    .filter((n) => n > 0);
  try {
    await partnerFetch("admin-design-unpublish", {
      method: "POST",
      body: {
        design_id: activeItem.id,
        product_keys: onlineKeys,
        published_ids: publishedIds,
      },
    });
    showToast("Unpublish", `${onlineKeys.length} product(s) queued`);
    selectedProductKeys.clear();
    await renderProductsPanel(activeItem);
  } catch (e) {
    showToast("Error", e.message || "Unpublish failed");
  }
}

async function renderProductsPanel(item) {
  const root = ensureRoot();
  const panel = root.querySelector('[data-cr-dd-panel="products"]');
  if (!panel) return;
  const designId = Number(item.id || 0);
  if (!designId) {
    panel.innerHTML = `<p class="cr-dd-muted">Unsaved designs have no catalog products yet.</p>`;
    return;
  }
  panel.innerHTML = `<p class="cr-dd-muted">Loading products…</p>`;
  try {
    const [preview, live, diff] = await Promise.all([
      partnerFetch("admin-design-action-preview", {
        query: { action: "publish", design_id: designId },
      }),
      partnerFetch("admin-design-shopify-live-products", {
        query: { design_id: designId },
      }).catch(() => ({ products: [], items: [] })),
      partnerFetch("admin-design-update-diff", {
        query: { design_id: designId },
      }).catch(() => null),
    ]);
    lastCatalogPreview = preview;
    lastUpdateDiff = diff;
    const needsUpdate = !!(diff?.has_updatable_changes || diff?.image_changed || Number(diff?.changed_count || 0) > 0);
    setProductsTabNeedsUpdate(needsUpdate);

    if (preview.design_metadata && typeof preview.design_metadata === "object") {
      item.metadata = { ...(item.metadata || {}), ...preview.design_metadata };
      if (!metaDirty) draftMeta = cloneMeta(item.metadata);
    }
    if (preview.design_visibility) item.visibility = preview.design_visibility;
    if (preview.design_preview_url) item.preview_url = preview.design_preview_url;
    if (preview.user_image_url && item.metadata) item.metadata.user_image_url = preview.user_image_url;
    if (preview.user_prompt && item.metadata) item.metadata.user_prompt = preview.user_prompt;
    if (preview.design_prompt && item.metadata) item.metadata.design_prompt = preview.design_prompt;

    // Refresh overview if still mounted
    const overviewPanel = root.querySelector('[data-cr-dd-panel="overview"]');
    if (overviewPanel && activeTab === "overview") {
      overviewPanel.innerHTML = renderOverview(item);
      bindOverviewChrome();
    }

    const liveRows = live.products || live.items || live.published_products || [];
    const liveByKey = new Map();
    for (const p of liveRows) {
      liveByKey.set(String(p.product_key || ""), p);
    }

    const catalog = preview.catalog_products || [];
    const missingKeys = new Set((preview.missing_products || []).map((p) => String(p.product_key || "")));
    const designUrl = preview.design_preview_url || designPreviewUrl(item);

    productStateByKey = new Map();
    selectedProductKeys = new Set([...selectedProductKeys].filter((k) => catalog.some((p) => String(p.product_key) === k)));

    const byChannel = new Map();
    for (const p of catalog) {
      const ch = String(p.channel || "printify").toLowerCase();
      if (ch === "amazon") continue;
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch).push(p);
    }

    const preferred = ["printify", "todify", "shopify"];
    const keys = [...byChannel.keys()].sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    panel.innerHTML =
      `<div class="cr-dd-prod-toolbar">
        <button type="button" class="btn btn-secondary btn-sm" data-cr-dd-prod-all>Select all</button>
        <button type="button" class="btn btn-secondary btn-sm" data-cr-dd-prod-none>Select none</button>
      </div>` +
      (keys
        .map((ch) => {
          const products = byChannel.get(ch) || [];
          const cards = products
            .map((p) => {
              const key = String(p.product_key || "");
              const liveRow = liveByKey.get(key);
              const online = !missingKeys.has(key) || !!liveRow;
              const publishedId = liveRow?.published_id || null;
              const needs = online && needsUpdate;
              productStateByKey.set(key, {
                online,
                publishedId,
                needsUpdate: needs,
                title: p.title || key,
              });
              return `<article class="cr-dd-prod ${online ? "is-online" : "is-offline"} ${
                needs ? "needs-update" : ""
              }" data-product-key="${escapeHtml(key)}" data-online="${online ? "1" : "0"}">
              <label class="cr-dd-prod__check">
                <input type="checkbox" class="cr-dd-prod__cb" data-product-key="${escapeHtml(key)}" />
              </label>
              <div class="cr-dd-prod__media" data-cr-dd-prod-media></div>
              <div class="cr-dd-prod__title">${escapeHtml(p.title || key)}</div>
              ${
                needs
                  ? `<button type="button" class="cr-dd-needs-update" data-cr-dd-needs-update>needs Update</button>`
                  : ""
              }
            </article>`;
            })
            .join("");
          const label =
            ch === "printify" ? "Printify" : ch === "todify" ? "Todify" : ch === "shopify" ? "Shopify" : ch;
          return `<details class="cr-channel" open>
          <summary class="cr-channel__summary"><span>${escapeHtml(label)}</span><span class="cr-channel__count">${
            products.length
          }</span></summary>
          <div class="cr-channel__body"><div class="cr-dd-prod-grid">${cards}</div></div>
        </details>`;
        })
        .join("") || `<p class="cr-dd-muted">No admin catalog products for this design type.</p>`);

    for (const p of catalog) {
      const ch = String(p.channel || "").toLowerCase();
      if (ch === "amazon") continue;
      const key = String(p.product_key || "");
      const card = panel.querySelector(`.cr-dd-prod[data-product-key="${CSS.escape(key)}"]`);
      const media = card?.querySelector("[data-cr-dd-prod-media]");
      if (!media) continue;
      const liveRow = liveByKey.get(key);
      const online = card?.getAttribute("data-online") === "1";
      if (online) {
        const liveUrl = liveRow?.image_url || liveRow?.featured_image || "";
        media.innerHTML = liveUrl
          ? `<img class="cr-dd-prod__mock" src="${escapeHtml(liveUrl)}" alt="" loading="lazy" /><span class="cr-badge cr-badge--online">Online</span>`
          : `<span class="cr-dd-prod__empty">No Shopify image</span><span class="cr-badge cr-badge--online">Online</span>`;
      } else {
        const previewConfig =
          p.studio_card_preview || synthesizePreviewFromMocks(p.mock_urls || (p.mock_url ? [p.mock_url] : []));
        mountComposedMedia(media, previewConfig, designUrl);
        const badge = document.createElement("span");
        badge.className = "cr-badge cr-badge--offline";
        badge.textContent = "Offline";
        media.appendChild(badge);
      }
    }

    panel.querySelector("[data-cr-dd-prod-all]")?.addEventListener("click", () => {
      for (const key of productStateByKey.keys()) selectedProductKeys.add(key);
      syncProductSelectionUi();
    });
    panel.querySelector("[data-cr-dd-prod-none]")?.addEventListener("click", () => {
      selectedProductKeys.clear();
      syncProductSelectionUi();
    });
    panel.querySelectorAll(".cr-dd-prod__cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.getAttribute("data-product-key") || "";
        if (cb.checked) selectedProductKeys.add(key);
        else selectedProductKeys.delete(key);
        syncProductSelectionUi();
      });
    });
    panel.querySelectorAll("[data-cr-dd-needs-update]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNeedsUpdateInfoModal();
      });
    });

    syncProductSelectionUi();
  } catch (e) {
    panel.innerHTML = `<p class="cr-bulk-error">${escapeHtml(e.message || "Failed to load products")}</p>`;
  }
}

export async function openDesignDetailModal(item, { onClose } = {}) {
  if (!item) return;
  activeItem = item;
  onClosed = onClose || null;
  draftMeta = cloneMeta(item.metadata);
  metaDirty = false;
  metaSaving = false;
  editTool = "crop";
  editDirty = false;
  pendingEdit = null;
  zoomLevel = 1;
  panMode = false;
  viewerBg = "#37375A";
  lastCatalogPreview = null;
  lastUpdateDiff = null;
  productsNeedUpdate = false;
  selectedProductKeys = new Set();
  productStateByKey = new Map();
  activeTab = "overview";
  const root = ensureRoot();
  root.querySelector("#cr-dd-title").textContent = item.title || "Design";
  root.querySelector('[data-cr-dd-panel="overview"]').innerHTML = renderOverview(item);
  root.querySelector('[data-cr-dd-panel="edit"]').innerHTML = renderEdit(item);
  root.querySelector('[data-cr-dd-panel="edit"]').__crDdEditBound = false;
  root.querySelector('[data-cr-dd-panel="metadata"]').innerHTML = renderMetadata(item);
  root.querySelector('[data-cr-dd-panel="products"]').innerHTML = `<p class="cr-dd-muted">Loading catalog…</p>`;
  setProductsTabNeedsUpdate(false);
  setTab("overview");
  root.hidden = false;
  document.body.classList.add("cr-dd-open");
  bindOverviewChrome();
  bindMetadataPanel();
  renderProductsPanel(item).catch(() => {});
}

export function closeDesignDetailModal() {
  const root = document.getElementById("cr-design-detail");
  if (root) root.hidden = true;
  document.body.classList.remove("cr-dd-open");
  activeItem = null;
  draftMeta = null;
  lastCatalogPreview = null;
  lastUpdateDiff = null;
  pendingEdit = null;
  editDirty = false;
  selectedProductKeys = new Set();
  productStateByKey = new Map();
}
