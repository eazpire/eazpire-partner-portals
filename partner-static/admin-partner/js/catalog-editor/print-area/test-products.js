import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { PH_TYPES } from "../provider-print-technical.js";
import {
  createTestPrintifyProduct,
  deleteTestPrintifyProducts,
  fetchTestPrintifyProducts,
  fetchTestPrintifyProductPreview,
  fetchTestPrintifyCreations,
  fetchTestPrintifyDesignDimensions,
  updateTestPrintifyProductPlacement,
} from "../api.js";
import {
  printAreaVersionSlug,
  resolvePrintAreaTemplateId,
  resolvePrintAreaVersion,
} from "./helpers.js";
import {
  hasSessionTestDesign,
  getSessionDesignPlacementForApi,
  placeSessionTestDesign,
  clearSessionTestDesign,
  markSessionDesignSaved,
  isSessionDesignDirty,
  applyLivePrintifyPlacementToSessionDesign,
  alignSessionDesignToPrintArea,
} from "./design-session-overlay.js";

/** Design rows from the picker grid (id → API row with width/height). */
const designPickerRowsById = new Map();

/** Ensure true design pixel size (API/R2 original — not preview thumbnail). */
async function resolveDesignRowDimensions(row) {
  const w = Number(row?.width);
  const h = Number(row?.height);
  if (w > 0 && h > 0) return { ...row, width: w, height: h };

  const id = Number(row?.id);
  if (id > 0) {
    try {
      const res = await fetchTestPrintifyDesignDimensions(id);
      if (res?.ok && Number(res.width) > 0 && Number(res.height) > 0) {
        return { ...row, width: Number(res.width), height: Number(res.height) };
      }
    } catch {
      /* fall through */
    }
  }

  return row;
}

const previewCache = new Map();

function capitalizeMode(m) {
  const s = String(m || "calculated").toLowerCase();
  if (s === "template") return "Template";
  if (s === "admin") return "Admin";
  return "Calculated";
}

function normViewKey(viewKey) {
  return String(viewKey || "front")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function buildTestContext(ctx, st, data = ctx?.printAreaData, { randomDesign = true, designId } = {}) {
  const version = resolvePrintAreaVersion(ctx, data);
  const pid = Number(ctx.selectedPrintProviderId);
  const profile = (ctx.bundle?.publish_profiles || []).find((p) => Number(p.print_provider_id) === pid);
  const regions = ctx.bundle?.product?.regions;
  const regionCode = Array.isArray(regions) && regions.length ? regions[0] : "EU";
  const body = {
    product_key: ctx.productKey,
    print_provider_id: pid,
    print_area_template_id: resolvePrintAreaTemplateId(ctx, data),
    version_label: printAreaVersionSlug(version),
    design_type: st.activeDesignType || "classic",
    publish_profile_id: profile?.id ? Number(profile.id) : undefined,
    region_code: regionCode,
    placement_modes: { ...(st.publishLogicByPh || {}) },
    random_design: !!randomDesign,
  };
  if (!randomDesign && designId != null) {
    body.design_id = Number(designId);
  } else if (!randomDesign && st.sessionTestDesign?.designId) {
    body.design_id = Number(st.sessionTestDesign.designId);
  }
  const sessionPlacement = getSessionDesignPlacementForApi(st, data);
  if (!randomDesign && sessionPlacement) {
    body.design_session_placement = sessionPlacement;
  }
  return body;
}

function mockUrlFromPreview(preview, viewKey, colorKey = "default") {
  if (!preview) return null;
  const vk = normViewKey(viewKey);
  const byColor = preview.views_by_color || {};
  const colors = preview.colors || [];
  const color =
    colorKey && byColor[colorKey]
      ? colorKey
      : colors[0]?.color_key || (byColor.default ? "default" : Object.keys(byColor)[0]);
  const views = byColor[color] || byColor.default || [];
  const match = views.find((v) => normViewKey(v.view_key) === vk) || views[0];
  return match?.url || preview.thumbnail_url || null;
}

export function hasActiveSessionTestProduct(st) {
  return Number(st?.sessionTestDesign?.testProductRowId) > 0;
}

function mockUrlWithCacheBust(url) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}t=${Date.now()}`;
}

function applyMockUrlToSessionState(st, vk, url, { cacheBust = false } = {}) {
  if (!st || !url) return null;
  const displayUrl = cacheBust ? mockUrlWithCacheBust(url) : url;
  if (!st.sessionMockUrlsByView) st.sessionMockUrlsByView = {};
  st.sessionMockUrlsByView[vk] = displayUrl;
  if (!st.mockUrlsByView) st.mockUrlsByView = {};
  st.mockUrlsByView[vk] = displayUrl;
  st.useSessionTestProductMock = true;
  return displayUrl;
}

/**
 * Apply cached test-product preview URLs to the inline Printify mock viewer.
 */
export function applySessionTestProductMockToState(st, preview, viewKey, { cacheBust = false } = {}) {
  if (!st || !preview) return null;
  const sd = st.sessionTestDesign;
  if (sd) sd.previewCache = preview;
  const vk = normViewKey(viewKey || st.activeView || "front");
  const colorKey =
    st.variantGroups?.groups?.find((g) => g.id === st.activeVariantGroupId)?.title || undefined;
  const url = mockUrlFromPreview(preview, vk, colorKey);
  return applyMockUrlToSessionState(st, vk, url, { cacheBust });
}

export function invalidateSessionTestProductPreviewCache(st) {
  const sd = st?.sessionTestDesign;
  const rowId = Number(sd?.testProductRowId);
  if (rowId > 0) previewCache.delete(String(rowId));
  if (sd) sd.previewCache = null;
}

export async function refreshSessionTestProductMock(st, viewKey, { colorKey, force = false, data } = {}) {
  const sd = st?.sessionTestDesign;
  const rowId = Number(sd?.testProductRowId);
  if (!rowId) return null;

  const vk = normViewKey(viewKey || st.activeView || "front");
  const resolvedColorKey =
    colorKey || st.variantGroups?.groups?.find((g) => g.id === st.activeVariantGroupId)?.title || undefined;

  if (!force && sd?.previewCache && normViewKey(sd.previewCache._viewKey) === vk) {
    const cachedUrl = mockUrlFromPreview(sd.previewCache, vk, resolvedColorKey);
    if (cachedUrl) return applyMockUrlToSessionState(st, vk, cachedUrl);
  }

  if (force) invalidateSessionTestProductPreviewCache(st);

  const res = await fetchTestPrintifyProductPreview(rowId, { view_key: vk });
  if (!res?.ok) return null;
  const preview = { ...res, _viewKey: vk };
  previewCache.set(String(rowId), preview);
  if (sd) sd.previewCache = preview;

  const placementData = data || null;
  if (preview.design_placement && sd) {
    applyLivePrintifyPlacementToSessionDesign(st, placementData, preview, { markDirty: false });
  }

  const url = mockUrlFromPreview(preview, vk, resolvedColorKey);
  return applySessionTestProductMockToState(st, preview, vk, { cacheBust: force });
}

/** Mock panel ↻ — test product when session active, else catalog template. */
export async function refreshPrintAreaMockViewer(ctx, { force = false } = {}) {
  const st = ctx?.printAreaState;
  if (!st) return null;
  if (hasActiveSessionTestProduct(st)) {
    const colorKey = st.variantGroups?.groups?.find((g) => g.id === st.activeVariantGroupId)?.title;
    return refreshSessionTestProductMock(st, st.activeView, {
      force: true,
      colorKey,
      data: ctx?.printAreaData,
    });
  }
  return null;
}

export async function applySessionDesignToPrintify(ctx, st, data, { onStatus, viewKey } = {}) {
  const sd = st?.sessionTestDesign;
  const rowId = Number(sd?.testProductRowId);
  if (!rowId) throw new Error("No test product — choose a design first.");
  if (!isSessionDesignDirty(st)) return null;

  const placement = getSessionDesignPlacementForApi(st, data);
  if (!placement) throw new Error("No design placement to apply.");

  onStatus?.("Updating product…");
  const vk = normViewKey(viewKey || placement.view_key || st.activeView || "front");
  const res = await updateTestPrintifyProductPlacement({
    id: rowId,
    design_session_placement: placement,
    view_key: vk,
  });
  if (!res?.ok) {
    throw new Error(res?.message || res?.error || "Apply failed");
  }

  previewCache.set(String(rowId), { ...res, _viewKey: vk });
  if (sd) {
    sd.previewCache = previewCache.get(String(rowId));
    sd.viewKey = vk;
    if (res.design_width > 0) sd.designWidth = Number(res.design_width);
    if (res.design_height > 0) sd.designHeight = Number(res.design_height);
  }
  markSessionDesignSaved(st);
  applySessionTestProductMockToState(st, res, vk, { cacheBust: true });
  onStatus?.("Product updated");
  return res;
}

function placementBadgesHtml(placementModes) {
  if (!placementModes || typeof placementModes !== "object") return "";
  return PH_TYPES.map((ph) => {
    const mode = placementModes[ph.key];
    if (!mode) return "";
    return `<span class="ce-pa-tp-badge">${escapeHtml(ph.label)}: ${escapeHtml(capitalizeMode(mode))}</span>`;
  })
    .filter(Boolean)
    .join("");
}

function ensureListModal() {
  let el = document.getElementById("ce-pa-tp-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-pa-tp-modal";
  el.className = "ce-pa-tp-modal";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.innerHTML = `
    <div class="ce-pa-tp-modal__backdrop" data-ce-pa-tp-close></div>
    <div class="ce-pa-tp-modal__dialog" role="dialog" aria-modal="true">
      <header class="ce-pa-tp-modal__header">
        <h2 class="ce-pa-tp-modal__title">Test Products</h2>
        <button type="button" class="btn btn-ghost btn-xs ce-pa-tp-modal__close" data-ce-pa-tp-close aria-label="Close">×</button>
      </header>
      <div class="ce-pa-tp-modal__body">
        <p class="ce-hint ce-pa-tp-modal__hint" data-ce-pa-tp-hint></p>
        <div class="ce-pa-tp-grid" data-ce-pa-tp-grid></div>
        <p class="ce-pa-tp-empty" data-ce-pa-tp-empty hidden>No test products yet.</p>
        <p class="ce-pa-tp-err" data-ce-pa-tp-err hidden></p>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-pa-tp-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeListModal());
  });
  return el;
}

function ensureViewerModal() {
  let el = document.getElementById("ce-pa-tp-viewer");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-pa-tp-viewer";
  el.className = "ce-pa-tp-viewer";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.innerHTML = `
    <div class="ce-pa-tp-viewer__backdrop" data-ce-pa-tp-viewer-close></div>
    <div class="ce-pa-tp-viewer__dialog" role="dialog" aria-modal="true">
      <header class="ce-pa-tp-viewer__header">
        <h2 class="ce-pa-tp-viewer__title" data-ce-pa-tp-viewer-title>Preview</h2>
        <button type="button" class="btn btn-ghost btn-xs" data-ce-pa-tp-viewer-close aria-label="Close">×</button>
      </header>
      <div class="ce-pa-tp-viewer__body">
        <div class="ce-pa-tp-viewer__thumbs" data-ce-pa-tp-viewer-thumbs></div>
        <div class="ce-pa-tp-viewer__main">
          <button type="button" class="ce-pa-tp-viewer__nav ce-pa-tp-viewer__nav--prev" data-ce-pa-tp-variant-prev aria-label="Previous variant">‹</button>
          <div class="ce-pa-tp-viewer__stage">
            <img class="ce-pa-tp-viewer__img" data-ce-pa-tp-viewer-img alt="" />
            <p class="ce-pa-tp-viewer__view-label" data-ce-pa-tp-viewer-view-label></p>
            <p class="ce-pa-tp-viewer__variant-label" data-ce-pa-tp-viewer-variant-label></p>
          </div>
          <button type="button" class="ce-pa-tp-viewer__nav ce-pa-tp-viewer__nav--next" data-ce-pa-tp-variant-next aria-label="Next variant">›</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-pa-tp-viewer-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeViewer());
  });
  el.querySelector("[data-ce-pa-tp-variant-prev]")?.addEventListener("click", () => stepViewerVariant(-1));
  el.querySelector("[data-ce-pa-tp-variant-next]")?.addEventListener("click", () => stepViewerVariant(1));
  return el;
}

let viewerState = null;

function blurModalFocus(el) {
  if (el?.contains(document.activeElement)) {
    document.activeElement?.blur();
  }
}

function closeViewer() {
  viewerState = null;
  const el = document.getElementById("ce-pa-tp-viewer");
  if (el) {
    blurModalFocus(el);
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("inert", "");
  }
  document.removeEventListener("keydown", onViewerKeydown);
  setListModalAssistiveHidden(false);
}

function onViewerKeydown(e) {
  if (!viewerState) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") stepViewerVariant(-1);
  if (e.key === "ArrowRight") stepViewerVariant(1);
}

function currentViews() {
  if (!viewerState?.data) return [];
  const colorKey = viewerState.colorKey;
  const byColor = viewerState.data.views_by_color || {};
  return byColor[colorKey] || byColor.default || [];
}

function renderViewer() {
  const el = document.getElementById("ce-pa-tp-viewer");
  if (!el || !viewerState?.data) return;
  const colors = viewerState.data.colors || [];
  if (!colors.length) colors.push({ color_key: "default", label: "Default" });

  let colorIdx = colors.findIndex((c) => c.color_key === viewerState.colorKey);
  if (colorIdx < 0) colorIdx = 0;
  viewerState.colorKey = colors[colorIdx].color_key;

  const views = currentViews();
  let viewIdx = viewerState.viewIndex;
  if (viewIdx < 0) viewIdx = 0;
  if (viewIdx >= views.length) viewIdx = Math.max(0, views.length - 1);
  viewerState.viewIndex = viewIdx;

  const thumbs = el.querySelector("[data-ce-pa-tp-viewer-thumbs]");
  const img = el.querySelector("[data-ce-pa-tp-viewer-img]");
  const viewLabel = el.querySelector("[data-ce-pa-tp-viewer-view-label]");
  const variantLabel = el.querySelector("[data-ce-pa-tp-viewer-variant-label]");
  const title = el.querySelector("[data-ce-pa-tp-viewer-title]");

  title.textContent = viewerState.data.title || viewerState.rowTitle || "Preview";
  variantLabel.textContent = colors[colorIdx]?.label || colors[colorIdx]?.color_key || "";

  thumbs.innerHTML = views
    .map(
      (v, i) => `
    <button type="button" class="ce-pa-tp-viewer__thumb ${i === viewIdx ? "is-active" : ""}" data-view-idx="${i}">
      <img src="${escapeHtml(v.url)}" alt="${escapeHtml(v.label || v.view_key || "")}" loading="lazy" />
      <span>${escapeHtml(v.label || v.view_key || "")}</span>
    </button>`
    )
    .join("");

  thumbs.querySelectorAll("[data-view-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewerState.viewIndex = Number(btn.dataset.viewIdx) || 0;
      renderViewer();
    });
  });

  const view = views[viewIdx];
  if (view?.url) {
    img.src = view.url;
    img.hidden = false;
    viewLabel.textContent = view.label || view.view_key || "";
    viewLabel.hidden = false;
  } else {
    img.hidden = true;
    viewLabel.textContent = "No mockup image";
    viewLabel.hidden = false;
  }

  const prev = el.querySelector("[data-ce-pa-tp-variant-prev]");
  const next = el.querySelector("[data-ce-pa-tp-variant-next]");
  if (prev) prev.disabled = colors.length < 2;
  if (next) next.disabled = colors.length < 2;
}

function stepViewerVariant(delta) {
  if (!viewerState?.data) return;
  const colors = viewerState.data.colors || [];
  if (colors.length < 2) return;
  let idx = colors.findIndex((c) => c.color_key === viewerState.colorKey);
  if (idx < 0) idx = 0;
  idx = (idx + delta + colors.length) % colors.length;
  viewerState.colorKey = colors[idx].color_key;
  viewerState.viewIndex = 0;
  renderViewer();
}

function setListModalAssistiveHidden(hidden) {
  const listEl = document.getElementById("ce-pa-tp-modal");
  if (!listEl?.classList.contains("is-open")) return;
  if (hidden) {
    blurModalFocus(listEl);
    listEl.setAttribute("aria-hidden", "true");
    listEl.setAttribute("inert", "");
  } else {
    listEl.setAttribute("aria-hidden", "false");
    listEl.removeAttribute("inert");
  }
}

async function openViewer(row) {
  setListModalAssistiveHidden(true);
  const el = ensureViewerModal();
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  el.removeAttribute("inert");
  document.addEventListener("keydown", onViewerKeydown);

  const cacheKey = String(row.id);
  let data = previewCache.get(cacheKey);
  if (!data) {
    const res = await fetchTestPrintifyProductPreview(row.id);
    if (!res?.ok) {
      viewerState = null;
      alert(res?.message || res?.error || res?.detail || "Preview failed");
      closeViewer();
      return;
    }
    data = res;
    previewCache.set(cacheKey, data);
  }

  viewerState = {
    rowId: row.id,
    rowTitle: row.printify?.title || row.printify_title,
    data,
    colorKey: (data.colors && data.colors[0] && data.colors[0].color_key) || "default",
    viewIndex: Number.isFinite(Number(data.preferred_view_index)) ? Number(data.preferred_view_index) : 0,
  };
  renderViewer();
}

function closeListModal() {
  const el = document.getElementById("ce-pa-tp-modal");
  if (el) {
    blurModalFocus(el);
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("inert", "");
  }
}

async function loadTestProductsGrid(ctx) {
  const el = ensureListModal();
  const grid = el.querySelector("[data-ce-pa-tp-grid]");
  const empty = el.querySelector("[data-ce-pa-tp-empty]");
  const err = el.querySelector("[data-ce-pa-tp-err]");
  const hint = el.querySelector("[data-ce-pa-tp-hint]");
  err.hidden = true;
  grid.innerHTML = `<p class="ce-hint">Loading…</p>`;
  empty.hidden = true;
  hint.textContent = `${ctx.productKey} · provider ${ctx.selectedPrintProviderId || "—"}`;

  try {
    const res = await fetchTestPrintifyProducts(ctx.productKey, ctx.selectedPrintProviderId);
    if (!res?.ok) throw new Error(res?.error || "load_failed");
    const items = res.items || [];
    previewCache.clear();
    if (!items.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = items
      .map((row) => {
        const title = row.printify?.title || row.printify_title || `Test #${row.id}`;
        const badges = placementBadgesHtml(row.placement_modes);
        const thumb = row.printify_product_id
          ? `<div class="ce-pa-tp-card__thumb ce-pa-tp-card__thumb--loading" data-thumb-id="${row.id}"></div>`
          : `<div class="ce-pa-tp-card__thumb ce-pa-tp-card__thumb--empty">No preview</div>`;
        return `
      <article class="ce-pa-tp-card" data-row-id="${row.id}">
        <div class="ce-pa-tp-card__badges">${badges}</div>
        <button type="button" class="ce-pa-tp-card__open" data-open-id="${row.id}">
          ${thumb}
          <span class="ce-pa-tp-card__title">${escapeHtml(title)}</span>
          <span class="ce-pa-tp-card__meta">Design #${row.design_id || "—"}</span>
        </button>
        <button type="button" class="btn btn-ghost btn-xs ce-pa-tp-card__delete" data-delete-id="${row.id}" title="Delete">🗑</button>
      </article>`;
      })
      .join("");

    grid.querySelectorAll("[data-open-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.openId);
        const row = items.find((r) => Number(r.id) === id);
        if (row) openViewer(row);
      });
    });

    grid.querySelectorAll("[data-delete-id]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.deleteId);
        if (!id || !window.confirm("Delete this test product from Printify?")) return;
        btn.disabled = true;
        try {
          await deleteTestPrintifyProducts([id]);
          await loadTestProductsGrid(ctx);
        } catch (errDel) {
          alert(errDel?.message || "Delete failed");
          btn.disabled = false;
        }
      });
    });

    for (const row of items) {
      const thumbEl = grid.querySelector(`[data-thumb-id="${row.id}"]`);
      if (!thumbEl) continue;
      fetchTestPrintifyProductPreview(row.id)
        .then((data) => {
          if (!data?.ok || !data.thumbnail_url) {
            thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
            thumbEl.classList.add("ce-pa-tp-card__thumb--empty");
            thumbEl.textContent = "—";
            return;
          }
          previewCache.set(String(row.id), data);
          thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
          thumbEl.innerHTML = `<img src="${escapeHtml(data.thumbnail_url)}" alt="" loading="lazy" />`;
        })
        .catch(() => {
          thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
          thumbEl.classList.add("ce-pa-tp-card__thumb--empty");
        });
    }
  } catch (e) {
    grid.innerHTML = "";
    err.hidden = false;
    err.textContent = e?.message || "Failed to load test products";
  }
}

export async function openTestProductsModal(ctx) {
  const el = ensureListModal();
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  el.removeAttribute("inert");
  await loadTestProductsGrid(ctx);
}

export async function createTestProductFromPrintArea(
  ctx,
  st,
  { onStatus, randomDesign = true, designId, keepSession = false, data } = {}
) {
  if (!ctx?.productKey || !ctx?.selectedPrintProviderId) {
    throw new Error("Select a print provider first.");
  }
  onStatus?.("Saving print area settings…");
  const { savePrintAreaTab } = await import("../tabs/print-area.js");
  await savePrintAreaTab(ctx);

  const placementData = data ?? ctx?.printAreaData;
  const body = buildTestContext(ctx, st, placementData, { randomDesign, designId });
  onStatus?.(
    randomDesign
      ? "Creating test product with random design…"
      : `Creating test product with design #${body.design_id}…`
  );
  const res = await createTestPrintifyProduct(body);
  if (!res?.ok) {
    throw new Error(res?.message || res?.error || "Create failed");
  }
  onStatus?.(`Created: ${res.printify_product_id || "OK"}`);
  if (!keepSession) {
    clearSessionTestDesign(st);
  } else if (st.sessionTestDesign && res.id) {
    st.sessionTestDesign.testProductRowId = Number(res.id);
    st.sessionTestDesign.testProductCreating = false;
    markSessionDesignSaved(st);
  }
  return res;
}

let createChooserCallbacks = null;
let designsCursor = null;
let designsLoading = false;

function setModalOpen(el, open) {
  if (!el) return;
  if (open) {
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    el.removeAttribute("inert");
  } else {
    blurModalFocus(el);
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("inert", "");
  }
}

function ensureCreateChooserModal() {
  let el = document.getElementById("ce-pa-tp-create-chooser");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-pa-tp-create-chooser";
  el.className = "ce-pa-tp-modal ce-pa-tp-create-chooser";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.innerHTML = `
    <div class="ce-pa-tp-modal__backdrop" data-ce-pa-create-close></div>
    <div class="ce-pa-tp-modal__dialog ce-pa-tp-create-chooser__dialog" role="dialog" aria-modal="true">
      <header class="ce-pa-tp-modal__header">
        <h2 class="ce-pa-tp-modal__title">Create Test Product</h2>
        <button type="button" class="btn btn-ghost btn-xs ce-pa-tp-modal__close" data-ce-pa-create-close aria-label="Close">×</button>
      </header>
      <div class="ce-pa-tp-modal__body ce-pa-tp-create-chooser__body">
        <p class="ce-hint">How should we pick the design?</p>
        <div class="ce-pa-tp-create-chooser__actions">
          <button type="button" class="btn btn-primary" data-ce-pa-create-random>Random</button>
          <button type="button" class="btn btn-secondary" data-ce-pa-create-choose>Choose design</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-pa-create-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeCreateChooserModal());
  });
  el.querySelector("[data-ce-pa-create-random]")?.addEventListener("click", () => {
    void runCreateWithRandom();
  });
  el.querySelector("[data-ce-pa-create-choose]")?.addEventListener("click", () => {
    openDesignPickerModal();
  });
  return el;
}

function ensureDesignPickerModal() {
  let el = document.getElementById("ce-pa-tp-design-picker");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-pa-tp-design-picker";
  el.className = "ce-pa-tp-modal ce-pa-tp-design-picker";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.innerHTML = `
    <div class="ce-pa-tp-modal__backdrop" data-ce-pa-design-close></div>
    <div class="ce-pa-tp-modal__dialog ce-pa-tp-design-picker__dialog" role="dialog" aria-modal="true">
      <header class="ce-pa-tp-modal__header">
        <h2 class="ce-pa-tp-modal__title">Choose design</h2>
        <button type="button" class="btn btn-ghost btn-xs" data-ce-pa-design-close aria-label="Close">×</button>
      </header>
      <div class="ce-pa-tp-modal__body ce-pa-tp-design-picker__body">
        <p class="ce-hint ce-pa-tp-design-picker__hint" data-ce-pa-design-hint></p>
        <div class="ce-pa-tp-design-grid" data-ce-pa-design-grid></div>
        <p class="ce-pa-tp-empty" data-ce-pa-design-empty hidden>No active designs found.</p>
        <p class="ce-pa-tp-err" data-ce-pa-design-err hidden></p>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-pa-design-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeDesignPickerModal());
  });
  const grid = el.querySelector("[data-ce-pa-design-grid]");
  grid?.addEventListener("scroll", () => {
    if (!grid || designsLoading || !designsCursor) return;
    if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 80) {
      void loadDesignGrid(true);
    }
  });
  grid?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-design-id]");
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.designId);
    if (!id) return;
    const row = designPickerRowsById.get(id) || {
      id,
      design_title: btn.querySelector(".ce-pa-tp-design-card__title")?.textContent || "",
      preview_url: btn.querySelector("img")?.getAttribute("src") || "",
    };
    void runPlaceDesign(id, row);
  });
  return el;
}

function closeCreateChooserModal() {
  createChooserCallbacks = null;
  setModalOpen(document.getElementById("ce-pa-tp-create-chooser"), false);
}

function closeDesignPickerModal() {
  designsCursor = null;
  designsLoading = false;
  setModalOpen(document.getElementById("ce-pa-tp-design-picker"), false);
  setModalOpen(document.getElementById("ce-pa-tp-create-chooser"), false);
  closeCreateChooserModal();
}

async function runCreateWithRandom() {
  const { ctx, st, onStatus, onMockReady } = createChooserCallbacks || {};
  if (!ctx || !st) return;
  closeDesignPickerModal();
  closeCreateChooserModal();
  try {
    onStatus?.("Working…");
    const res = await createTestProductFromPrintArea(ctx, st, { onStatus, randomDesign: true });
    onStatus?.("Test product created.");
    if (res?.id) {
      const preview = await fetchTestPrintifyProductPreview(res.id, { view_key: st.activeView });
      if (preview?.ok) onMockReady?.(preview);
    }
  } catch (e) {
    onStatus?.(e?.message || "Create failed");
  }
}

async function runPlaceDesign(designId, designRow) {
  const { ctx, st, onStatus, onDesignPlaced, onMockReady, data, brandAssets } = createChooserCallbacks || {};
  if (!ctx || !st || !designId) return;
  const row = await resolveDesignRowDimensions(designRow || { id: designId });
  closeDesignPickerModal();
  closeCreateChooserModal();

  const placed = placeSessionTestDesign(ctx, st, data, brandAssets, row, {
    onPlaced: () => {
      onDesignPlaced?.();
    },
  });
  if (!placed) {
    onStatus?.("Could not place design on print area.");
    return;
  }

  onStatus?.(`Design #${designId} placed — creating test product…`);
  if (st.sessionTestDesign) st.sessionTestDesign.testProductCreating = true;

  try {
    const res = await createTestProductFromPrintArea(ctx, st, {
      onStatus,
      randomDesign: false,
      designId,
      keepSession: true,
      data,
    });
    const rowId = Number(res?.id || st.sessionTestDesign?.testProductRowId);
    if (rowId) {
      const preview = await fetchTestPrintifyProductPreview(rowId, { view_key: st.activeView });
      if (preview?.ok) {
        const sd = st.sessionTestDesign;
        if (sd) {
          if (preview.design_width > 0) sd.designWidth = Number(preview.design_width);
          if (preview.design_height > 0) sd.designHeight = Number(preview.design_height);
          alignSessionDesignToPrintArea(st, data);
          onDesignPlaced?.();
          if (isSessionDesignDirty(st)) {
            try {
              await applySessionDesignToPrintify(
                { ...ctx, printAreaData: data },
                st,
                data,
                { onStatus, viewKey: st.activeView }
              );
            } catch (applyErr) {
              onStatus?.(applyErr?.message || "Placement sync failed — click ✓ to retry.");
            }
          }
        }
        applySessionTestProductMockToState(st, preview, st.activeView);
        onMockReady?.(preview);
      }
    }
    if (st.sessionTestDesign) st.sessionTestDesign.testProductCreating = false;
    onStatus?.("Test product ready — click ✓ if you adjust placement.");
  } catch (e) {
    if (st.sessionTestDesign) st.sessionTestDesign.testProductCreating = false;
    onStatus?.(e?.message || "Background create failed");
  }
}

function renderDesignCard(row) {
  const title = row.design_title || `Design ${row.id}`;
  const thumb = row.preview_url
    ? `<img src="${escapeHtml(row.preview_url)}" alt="" loading="lazy" />`
    : `<span class="ce-pa-tp-design-card__placeholder">#${escapeHtml(String(row.id))}</span>`;
  return `
    <button type="button" class="ce-pa-tp-design-card" data-design-id="${row.id}" title="${escapeHtml(title)}">
      <span class="ce-pa-tp-design-card__thumb">${thumb}</span>
      <span class="ce-pa-tp-design-card__title">${escapeHtml(title)}</span>
      <span class="ce-pa-tp-design-card__meta">#${escapeHtml(String(row.id))}</span>
    </button>`;
}

async function loadDesignGrid(append = false) {
  const el = ensureDesignPickerModal();
  const grid = el.querySelector("[data-ce-pa-design-grid]");
  const empty = el.querySelector("[data-ce-pa-design-empty]");
  const err = el.querySelector("[data-ce-pa-design-err]");
  const hint = el.querySelector("[data-ce-pa-design-hint]");
  if (!grid || !createChooserCallbacks?.st) return;
  if (designsLoading) return;
  designsLoading = true;
  err.hidden = true;
    if (!append) {
      grid.innerHTML = `<p class="ce-hint">Loading designs…</p>`;
      designsCursor = null;
      designPickerRowsById.clear();
    }
  hint.textContent = `Design type: ${createChooserCallbacks.st.activeDesignType || "classic"}`;

  try {
    const res = await fetchTestPrintifyCreations({
      design_type: createChooserCallbacks.st.activeDesignType || "classic",
      cursor: append ? designsCursor : undefined,
      limit: 40,
    });
    if (!res?.ok) throw new Error(res?.error || "load_failed");
    const items = res.items || [];
    designsCursor = res.next_cursor || null;
    if (!append) grid.innerHTML = "";
    if (!append && !items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    items.forEach((row) => {
      const id = Number(row?.id);
      if (id > 0) designPickerRowsById.set(id, row);
    });
    const frag = items.map((row) => renderDesignCard(row)).join("");
    if (append) grid.insertAdjacentHTML("beforeend", frag);
    else grid.innerHTML = frag;
  } catch (e) {
    if (!append) grid.innerHTML = "";
    err.hidden = false;
    err.textContent = e?.message || "Failed to load designs";
  } finally {
    designsLoading = false;
  }
}

function openDesignPickerModal() {
  const el = ensureDesignPickerModal();
  setModalOpen(el, true);
  void loadDesignGrid(false);
}

export function openCreateTestProductChooser(ctx, st, callbacks = {}) {
  createChooserCallbacks = {
    ctx,
    st,
    onStatus: callbacks.onStatus || null,
    onDesignPlaced: callbacks.onDesignPlaced || null,
    onMockReady: callbacks.onMockReady || null,
    data: callbacks.data || ctx?.printAreaData || null,
    brandAssets: callbacks.brandAssets || null,
  };
  const el = ensureCreateChooserModal();
  setModalOpen(el, true);
}

export async function createTestProductWithSessionDesign(ctx, st, { onStatus, data, brandAssets, onDesignPlaced, onMockReady } = {}) {
  if (!hasSessionTestDesign(st)) {
    openCreateTestProductChooser(ctx, st, { onStatus, data, brandAssets, onDesignPlaced, onMockReady });
    return;
  }

  const sd = st.sessionTestDesign;
  if (sd?.testProductRowId) {
    if (isSessionDesignDirty(st)) {
      try {
        onStatus?.("Applying pending changes…");
        await applySessionDesignToPrintify(ctx, st, data, { onStatus });
        onMockReady?.(sd.previewCache);
      } catch (e) {
        onStatus?.(e?.message || "Apply failed");
      }
      return;
    }
    openTestProductsModal(ctx);
    onStatus?.("Test product already exists — opened list.");
    return;
  }

  try {
    onStatus?.("Working…");
    await createTestProductFromPrintArea(ctx, st, {
      onStatus,
      randomDesign: false,
      designId: st.sessionTestDesign.designId,
      keepSession: true,
      data,
    });
    onStatus?.("Test product created.");
  } catch (e) {
    onStatus?.(e?.message || "Create failed");
  }
}

export function bindSessionTestProductFlow(ctx, st, callbacks = {}) {
  const { onStatus, onMockReady, onDesignPlaced, onDirtyChange, data } = callbacks;
  const placementData = data || ctx?.printAreaData;
  return {
    async onSave() {
      try {
        await applySessionDesignToPrintify(ctx, st, placementData, {
          onStatus,
          viewKey: st.activeView,
        });
        onMockReady?.(st.sessionTestDesign?.previewCache);
        onDesignPlaced?.();
        onDirtyChange?.(false);
      } catch (e) {
        onStatus?.(e?.message || "Apply failed");
      }
    },
    onDirtyChange,
  };
}
