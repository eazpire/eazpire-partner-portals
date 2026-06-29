import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { confirmAction } from "/partner/shared/js/partner-shell.js";
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
  getSessionDesignPlacementForApi,
  placeSessionTestDesign,
  clearSessionTestDesign,
  markSessionDesignSaved,
  isSessionDesignDirty,
  applyLivePrintifyPlacementToSessionDesign,
  alignSessionDesignToPrintArea,
  getActiveTestProductRowId,
  activateSessionDesignForView,
  persistSessionDesignToMap,
  removeSessionDesignForView,
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

/** Sidebar test product grid state */
let sidebarItems = [];
let sidebarCallbacksRef = null;

function renderSidebarTestProductCard(row, activeId) {
  const title = row.printify?.title || row.printify_title || `Test #${row.id}`;
  const isActive = Number(row.id) === Number(activeId);
  const thumb = row.printify_product_id
    ? `<div class="ce-pa-tp-sidebar-card__thumb ce-pa-tp-card__thumb--loading" data-thumb-id="${row.id}"></div>`
    : `<div class="ce-pa-tp-sidebar-card__thumb ce-pa-tp-card__thumb--empty">—</div>`;
  return `
    <article class="ce-pa-tp-sidebar-card${isActive ? " is-active" : ""}" data-row-id="${row.id}">
      <button type="button" class="ce-pa-tp-sidebar-card__delete" data-delete-id="${row.id}" aria-label="Delete test product" title="Delete">×</button>
      <div class="ce-pa-tp-sidebar-card__open">${thumb}</div>
      <span class="ce-pa-tp-sidebar-card__title">${escapeHtml(title)}</span>
      <span class="ce-pa-tp-sidebar-card__meta">${Number(row.design_id) > 0 ? `Design #${row.design_id}` : "Brand only"}</span>
    </article>`;
}

async function activateTestProduct(ctx, st, row, callbacks = {}) {
  const rowId = Number(row.id);
  st.activeTestProductRowId = rowId;
  st.sessionDesignsByKey = {};
  st.sessionTestDesign = null;
  const data = callbacks.data || ctx?.printAreaData;
  activateSessionDesignForView(st, data);
  invalidateSessionTestProductPreviewCache(st);
  st.useSessionTestProductMock = true;
  try {
    const preview = await fetchTestPrintifyProductPreview(rowId, { view_key: st.activeView });
    if (preview?.ok) {
      applySessionTestProductMockToState(st, preview, st.activeView, { cacheBust: true });
      if (preview.design_placement && data) {
        applyLivePrintifyPlacementToSessionDesign(st, data, preview, { markDirty: false });
        persistSessionDesignToMap(st);
      }
      callbacks.onMockReady?.(preview);
    }
  } catch (_) {
    /* preview optional */
  }
  callbacks.onDesignPlaced?.();
  callbacks.onDesignDockRefresh?.();
}

export async function loadSidebarTestProductsGrid(ctx, root, callbacks = {}) {
  sidebarCallbacksRef = { ctx, root, ...callbacks };
  const grid = root?.querySelector("[data-ce-pa-sidebar-tp-grid]");
  const empty = root?.querySelector("[data-ce-pa-sidebar-tp-empty]");
  const err = root?.querySelector("[data-ce-pa-sidebar-tp-err]");
  if (!grid) return;
  if (err) err.hidden = true;
  grid.innerHTML = `<p class="ce-hint">Loading…</p>`;
  if (empty) empty.hidden = true;

  try {
    const res = await fetchTestPrintifyProducts(ctx.productKey, ctx.selectedPrintProviderId);
    if (!res?.ok) throw new Error(res?.error || "load_failed");
    const items = res.items || [];
    sidebarItems = items;
    const activeId = ctx.printAreaState?.activeTestProductRowId;

    if (!items.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = items.map((row) => renderSidebarTestProductCard(row, activeId)).join("");

    grid.querySelectorAll(".ce-pa-tp-sidebar-card").forEach((card) => {
      card.addEventListener("click", async (e) => {
        if (e.target.closest("[data-delete-id]")) return;
        const id = Number(card.dataset.rowId);
        const row = items.find((r) => Number(r.id) === id);
        if (!row) return;
        await activateTestProduct(ctx, ctx.printAreaState, row, sidebarCallbacksRef);
        grid.querySelectorAll(".ce-pa-tp-sidebar-card").forEach((c) => {
          c.classList.toggle("is-active", Number(c.dataset.rowId) === id);
        });
        sidebarCallbacksRef?.onStatus?.("Test product loaded for editing.");
      });
    });

    grid.querySelectorAll("[data-delete-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.deleteId);
        if (!id) return;
        confirmAction({
          title: "Delete test product?",
          message: "Delete this test product?",
          confirmLabel: "Yes",
          cancelLabel: "No",
          confirmClass: "btn-danger",
          onConfirm: async () => {
            try {
              const delRes = await deleteTestPrintifyProducts([id]);
              if (!delRes?.ok && !(Number(delRes?.deleted_count) > 0)) {
                throw new Error(delRes?.error || delRes?.message || "Delete failed");
              }
              const st = ctx.printAreaState;
              if (Number(st?.activeTestProductRowId) === id) {
                st.activeTestProductRowId = null;
                clearSessionTestDesign(st);
              }
              await loadSidebarTestProductsGrid(ctx, root, sidebarCallbacksRef);
            } catch (ex) {
              alert(ex?.message || "Delete failed");
            }
          },
        });
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
    if (err) {
      err.hidden = false;
      err.textContent = e?.message || "Failed to load test products";
    }
  }
}

/** @deprecated — list modal removed; refreshes sidebar grid if mounted */
export async function openTestProductsModal(ctx) {
  const root = ctx?.printAreaRoot;
  if (root) await loadSidebarTestProductsGrid(ctx, root, sidebarCallbacksRef || {});
}

function normViewKey(viewKey) {
  return String(viewKey || "front")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function buildTestContext(ctx, st, data = ctx?.printAreaData, { randomDesign = false, designId, brandAssetsOnly = false } = {}) {
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
  };
  if (brandAssetsOnly) {
    body.brand_assets_only = true;
    return body;
  }
  body.random_design = !!randomDesign;
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
  return getActiveTestProductRowId(st) > 0;
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
  const rowId = getActiveTestProductRowId(st);
  if (!rowId) return null;
  const sd = st?.sessionTestDesign;
  if (sd && !sd.testProductRowId) sd.testProductRowId = rowId;

  const vk = normViewKey(viewKey || st.activeView || "front");
  const resolvedColorKey =
    colorKey || st.variantGroups?.groups?.find((g) => g.id === st.activeVariantGroupId)?.title || undefined;

  if (!force && sd?.previewCache && normViewKey(sd.previewCache._viewKey) === vk) {
    const cachedUrl = mockUrlFromPreview(sd.previewCache, vk, resolvedColorKey);
    if (cachedUrl) return applyMockUrlToSessionState(st, vk, cachedUrl);
  }

  if (force) invalidateSessionTestProductPreviewCache(st);

  const res = await fetchTestPrintifyProductPreview(rowId, {
    view_key: vk,
    regenerate_mockups: force,
  });
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

export async function syncSessionDesignFromPrintify(ctx, st, data, { onStatus, viewKey } = {}) {
  const rowId = getActiveTestProductRowId(st);
  if (!rowId) {
    onStatus?.("No test product — choose a design first.");
    return null;
  }
  const sd = st?.sessionTestDesign;
  if (sd && !sd.testProductRowId) sd.testProductRowId = rowId;

  onStatus?.("Syncing placement from Printify…");
  invalidateSessionTestProductPreviewCache(st);
  const vk = normViewKey(viewKey || st.activeView || "front");
  const res = await fetchTestPrintifyProductPreview(rowId, { view_key: vk });
  if (!res?.ok) {
    throw new Error(res?.message || res?.error || res?.detail || "Sync failed");
  }

  const placementData = data || ctx?.printAreaData || null;
  if (res.design_placement && sd) {
    applyLivePrintifyPlacementToSessionDesign(st, placementData, res, { markDirty: false });
  }

  previewCache.set(String(rowId), { ...res, _viewKey: vk });
  if (sd) sd.previewCache = previewCache.get(String(rowId));
  onStatus?.("Placement synced from Printify.");
  return res;
}

export async function applySessionDesignToPrintify(ctx, st, data, { onStatus, viewKey } = {}) {
  const rowId = getActiveTestProductRowId(st);
  const sd = st?.sessionTestDesign;
  if (!rowId) throw new Error("No test product selected.");
  if (!sd?.rect || !Number(sd.designId)) throw new Error("No design to apply.");
  if (!isSessionDesignDirty(st)) return null;

  const placement = getSessionDesignPlacementForApi(st, data);
  if (!placement) throw new Error("No design placement to apply.");

  onStatus?.("Updating product…");
  const vk = normViewKey(viewKey || placement.view_key || st.activeView || "front");
  const res = await updateTestPrintifyProductPlacement({
    id: rowId,
    design_id: Number(sd.designId),
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

export async function createTestProductFromPrintArea(
  ctx,
  st,
  { onStatus, randomDesign = true, designId, keepSession = false, data, brandAssetsOnly = false } = {}
) {
  if (!ctx?.productKey || !ctx?.selectedPrintProviderId) {
    throw new Error("Select a print provider first.");
  }
  onStatus?.("Saving print area settings…");
  const { savePrintAreaTab } = await import("../tabs/print-area.js");
  await savePrintAreaTab(ctx);

  const placementData = data ?? ctx?.printAreaData;
  const body = buildTestContext(ctx, st, placementData, { randomDesign, designId, brandAssetsOnly });
  if (brandAssetsOnly) {
    onStatus?.("Creating test product (brand assets only)…");
  } else {
    onStatus?.(
      randomDesign
        ? "Creating test product with random design…"
        : `Creating test product with design #${body.design_id}…`
    );
  }
  const res = await createTestPrintifyProduct(body);
  if (!res?.ok) {
    throw new Error(res?.message || res?.error || "Create failed");
  }
  onStatus?.(`Created: ${res.printify_product_id || "OK"}`);
  if (brandAssetsOnly && res.id) {
    st.activeTestProductRowId = Number(res.id);
    st.useSessionTestProductMock = true;
    clearSessionTestDesign(st);
  } else if (!keepSession) {
    clearSessionTestDesign(st);
  } else if (st.sessionTestDesign && res.id) {
    st.sessionTestDesign.testProductRowId = Number(res.id);
    st.activeTestProductRowId = Number(res.id);
    st.sessionTestDesign.testProductCreating = false;
    markSessionDesignSaved(st);
    persistSessionDesignToMap(st);
  }
  return res;
}

export async function createBrandOnlyTestProduct(ctx, st, callbacks = {}) {
  const { root, onStatus, onMockReady, onDesignPlaced, onDesignDockRefresh } = callbacks;
  const res = await createTestProductFromPrintArea(ctx, st, {
    onStatus,
    brandAssetsOnly: true,
    data: callbacks.data,
  });
  if (res?.id) {
    st.activeTestProductRowId = Number(res.id);
    st.useSessionTestProductMock = true;
    try {
      const preview = await fetchTestPrintifyProductPreview(res.id, { view_key: st.activeView });
      if (preview?.ok) {
        applySessionTestProductMockToState(st, preview, st.activeView, { cacheBust: true });
        onMockReady?.(preview);
      }
    } catch {
      /* preview optional */
    }
  }
  if (root) await loadSidebarTestProductsGrid(ctx, root, sidebarCallbacksRef || callbacks);
  onDesignPlaced?.();
  onDesignDockRefresh?.();
  onStatus?.("Test product created (brand assets only).");
  return res;
}

let createChooserCallbacks = null;
let designsCursor = null;
let designsLoading = false;

function blurModalFocus(el) {
  if (el?.contains(document.activeElement)) {
    document.activeElement?.blur();
  }
}

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

function ensurePlaceDesignChooserModal() {
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
        <h2 class="ce-pa-tp-modal__title">Add design</h2>
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
    btn.addEventListener("click", () => closePlaceDesignChooser());
  });
  el.querySelector("[data-ce-pa-create-random]")?.addEventListener("click", () => {
    void runPlaceRandom();
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

function closePlaceDesignChooser() {
  createChooserCallbacks = null;
  setModalOpen(document.getElementById("ce-pa-tp-create-chooser"), false);
}

function closeDesignPickerModal() {
  designsCursor = null;
  designsLoading = false;
  setModalOpen(document.getElementById("ce-pa-tp-design-picker"), false);
  setModalOpen(document.getElementById("ce-pa-tp-create-chooser"), false);
  closePlaceDesignChooser();
}

function requireActiveTestProduct(st) {
  const rowId = getActiveTestProductRowId(st);
  if (!rowId) throw new Error("Select or create a test product first.");
  return rowId;
}

async function runPlaceRandom() {
  const callbacks = createChooserCallbacks || {};
  const { ctx, st, onStatus } = callbacks;
  if (!ctx || !st) return;
  closeDesignPickerModal();
  closePlaceDesignChooser();

  try {
    requireActiveTestProduct(st);
    onStatus?.("Picking random design…");
    const res = await fetchTestPrintifyCreations({
      design_type: st.activeDesignType || "classic",
      limit: 40,
    });
    if (!res?.ok) throw new Error(res?.error || "load_failed");
    const items = res.items || [];
    if (!items.length) throw new Error("No designs found for this design type.");
    const pick = items[Math.floor(Math.random() * items.length)];
    const designId = Number(pick?.id);
    if (!designId) throw new Error("No design found for this design type.");
    createChooserCallbacks = callbacks;
    await runPlaceDesign(designId, pick);
  } catch (e) {
    onStatus?.(e?.message || "Place failed");
  }
}

async function runPlaceDesign(designId, designRow) {
  const { ctx, st, onStatus, onDesignPlaced, onMockReady, onDesignDockRefresh, data, brandAssets, root } =
    createChooserCallbacks || {};
  if (!ctx || !st || !designId) return;
  const row = await resolveDesignRowDimensions(designRow || { id: designId });
  closeDesignPickerModal();
  closePlaceDesignChooser();

  try {
    const rowId = requireActiveTestProduct(st);
    if (!st.sessionTestDesign?.testProductRowId) {
      st.sessionTestDesign = st.sessionTestDesign || {};
      st.sessionTestDesign.testProductRowId = rowId;
    }

    const placed = placeSessionTestDesign(ctx, st, data, brandAssets, row, {
      onPlaced: () => {
        onDesignPlaced?.();
      },
    });
    if (!placed) {
      onStatus?.("Could not place design on print area.");
      return;
    }

    onStatus?.(`Applying design #${designId}…`);
    const applyRes = await applySessionDesignToPrintify(
      { ...ctx, printAreaData: data },
      st,
      data,
      { onStatus, viewKey: st.activeView }
    );
    if (applyRes) {
      onMockReady?.(applyRes);
    } else {
      const preview = await fetchTestPrintifyProductPreview(rowId, { view_key: st.activeView });
      if (preview?.ok) {
        applySessionTestProductMockToState(st, preview, st.activeView, { cacheBust: true });
        onMockReady?.(preview);
      }
    }
    if (root) await loadSidebarTestProductsGrid(ctx, root, sidebarCallbacksRef || createChooserCallbacks);
    onDesignPlaced?.();
    onDesignDockRefresh?.();
    onStatus?.("Design applied — adjust placement and click ✓ to save.");
  } catch (e) {
    onStatus?.(e?.message || "Apply failed");
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

export function openPlaceDesignChooser(ctx, st, callbacks = {}) {
  if (!getActiveTestProductRowId(st)) {
    callbacks.onStatus?.("Select or create a test product first.");
    return;
  }
  createChooserCallbacks = {
    ctx,
    st,
    root: callbacks.root || ctx?.printAreaRoot || null,
    onStatus: callbacks.onStatus || null,
    onDesignPlaced: callbacks.onDesignPlaced || callbacks.onSessionDesignPlaced || null,
    onMockReady: callbacks.onMockReady || null,
    onDesignDockRefresh: callbacks.onDesignDockRefresh || null,
    data: callbacks.data || ctx?.printAreaData || null,
    brandAssets: callbacks.brandAssets || null,
  };
  const el = ensurePlaceDesignChooserModal();
  setModalOpen(el, true);
}

/** @deprecated — use openPlaceDesignChooser */
export function openCreateTestProductChooser(ctx, st, callbacks = {}) {
  openPlaceDesignChooser(ctx, st, callbacks);
}

export async function removeDesignFromActiveView(ctx, st, callbacks = {}) {
  const rowId = getActiveTestProductRowId(st);
  if (!rowId) throw new Error("No test product selected.");
  const vk = normViewKey(st.activeView || "front");
  const { onStatus, onMockReady, onDesignPlaced, onDesignDockRefresh, root } = callbacks;

  onStatus?.("Removing design…");
  const res = await updateTestPrintifyProductPlacement({
    id: rowId,
    remove_design: true,
    view_key: vk,
  });
  if (!res?.ok) {
    throw new Error(res?.message || res?.error || "Remove failed");
  }

  removeSessionDesignForView(st, vk);
  if (!st.sessionTestDesign?.designId) {
    clearSessionTestDesign(st);
  }
  invalidateSessionTestProductPreviewCache(st);
  applySessionTestProductMockToState(st, res, vk, { cacheBust: true });
  if (root) await loadSidebarTestProductsGrid(ctx, root, sidebarCallbacksRef || callbacks);
  onMockReady?.(res);
  onDesignPlaced?.();
  onDesignDockRefresh?.();
  onStatus?.("Design removed.");
  return res;
}

export async function createTestProductWithSessionDesign(ctx, st, { onStatus, data, brandAssets, onDesignPlaced, onMockReady, onDesignDockRefresh, root } = {}) {
  if (!getActiveTestProductRowId(st)) {
    openPlaceDesignChooser(ctx, st, { onStatus, data, brandAssets, onDesignPlaced, onMockReady, onDesignDockRefresh, root });
    return;
  }

  const sd = st.sessionTestDesign;
  if (sd?.testProductRowId && isSessionDesignDirty(st)) {
    try {
      onStatus?.("Applying pending changes…");
      await applySessionDesignToPrintify(ctx, st, data, { onStatus });
      onMockReady?.(sd.previewCache);
      onDesignDockRefresh?.();
    } catch (e) {
      onStatus?.(e?.message || "Apply failed");
    }
    return;
  }

  openPlaceDesignChooser(ctx, st, { onStatus, data, brandAssets, onDesignPlaced, onMockReady, onDesignDockRefresh, root });
}

export function bindSessionTestProductFlow(ctx, st, callbacks = {}) {
  const { onStatus, onMockReady, onDesignPlaced, onDirtyChange, data } = callbacks;
  const placementData = data || ctx?.printAreaData;
  return {
    async onSave() {
      try {
        const res = await applySessionDesignToPrintify(ctx, st, placementData, {
          onStatus,
          viewKey: st.activeView,
        });
        if (res) {
          onMockReady?.(st.sessionTestDesign?.previewCache || res);
        }
        onDesignPlaced?.();
        onDirtyChange?.(false);
      } catch (e) {
        onStatus?.(e?.message || "Apply failed");
        throw e;
      }
    },
    onDirtyChange,
  };
}