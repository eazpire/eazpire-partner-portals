import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { confirmAction } from "/partner/shared/js/partner-shell.js";
import {
  createTestPrintifyProduct,
  createTestTodifyProduct,
  deleteTestPrintifyProducts,
  deleteTestTodifyProducts,
  fetchTestPrintifyProducts,
  fetchTestTodifyProducts,
  fetchTestPrintifyProductPreview,
  fetchTestTodifyProductPreview,
  fetchTestPrintifyCreations,
  fetchTestPrintifyDesignDimensions,
  updateTestPrintifyProductPlacement,
} from "../api.js";
import {
  printAreaVersionSlug,
  resolvePrintAreaTemplateId,
  resolvePrintAreaVersion,
  isPartnerOrTodifyProduct,
} from "./helpers.js";
import { editorProductTitle } from "../editor-product-title.js";
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
  hydrateSessionDesignFromTestProductPreview,
} from "./design-session-overlay.js";

/** Design rows from the picker grid (id → API row with width/height). */
const designPickerRowsById = new Map();

function isPartnerCtx(ctx, data) {
  return isPartnerOrTodifyProduct(ctx, data || ctx?.printAreaData);
}

/** Prefer API message over bare http_500 from partnerFetch. */
function testProductErrorMessage(err) {
  const data = err?.data;
  const msg = String(data?.message || data?.detail || "").trim();
  if (msg) return msg.length > 220 ? `${msg.slice(0, 217)}…` : msg;
  const code = String(data?.error || "").trim();
  if (code && !/^http_\d+$/i.test(code)) {
    return code.replace(/_/g, " ");
  }
  const fallback = String(err?.message || "").trim();
  if (fallback && !/^http_\d+$/i.test(fallback)) return fallback;
  if (err?.status) return `Server error (${err.status}). Try again or check Worker logs.`;
  return fallback || "Create failed";
}

async function apiCreateTestProduct(ctx, body, data) {
  if (isPartnerCtx(ctx, data)) return createTestTodifyProduct(body);
  return createTestPrintifyProduct(body);
}

async function apiFetchTestProducts(ctx, productKey, printProviderId) {
  if (isPartnerCtx(ctx)) return fetchTestTodifyProducts(productKey);
  return fetchTestPrintifyProducts(productKey, printProviderId);
}

async function apiDeleteTestProducts(ctx, ids) {
  if (isPartnerCtx(ctx)) return deleteTestTodifyProducts(ids);
  return deleteTestPrintifyProducts(ids);
}

async function apiFetchTestProductPreview(ctx, rowId, opts = {}) {
  if (isPartnerCtx(ctx)) return fetchTestTodifyProductPreview(rowId, opts);
  return fetchTestPrintifyProductPreview(rowId, opts);
}

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
  const title = row.printify?.title || row.printify_title || row.title || `Test #${row.id}`;
  const isActive = Number(row.id) === Number(activeId);
  const hasThumb = row.printify_product_id || row.design_preview_url || row.shopify_product_id;
  const thumb = hasThumb
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

async function resolveDesignMetaForHydrate(designId, preview, st) {
  let width = Number(preview?.design_width);
  let height = Number(preview?.design_height);
  let previewUrl = String(preview?.design_preview_url || "").trim();
  let title = String(preview?.design_title || "").trim();

  if (!(width > 0 && height > 0)) {
    try {
      const dims = await fetchTestPrintifyDesignDimensions(designId);
      if (dims?.ok) {
        width = Number(dims.width) || width;
        height = Number(dims.height) || height;
      }
    } catch {
      /* optional */
    }
  }

  if (!previewUrl || !title) {
    try {
      const res = await fetchTestPrintifyCreations({
        design_type: st.activeDesignType || "classic",
        limit: 80,
      });
      const hit = (res?.items || []).find((i) => Number(i.id) === Number(designId));
      if (hit) {
        if (!previewUrl) previewUrl = String(hit.preview_url || "").trim();
        if (!title) title = String(hit.design_title || "").trim();
        if (!(width > 0)) width = Number(hit.width);
        if (!(height > 0)) height = Number(hit.height);
      }
    } catch {
      /* optional */
    }
  }

  return {
    width,
    height,
    previewUrl,
    title: title || `Design ${designId}`,
  };
}

async function activateTestProduct(ctx, st, row, callbacks = {}) {
  const rowId = Number(row.id);
  st.activeTestProductRowId = rowId;
  st.sessionDesignsByKey = {};
  st.sessionTestDesign = null;
  const data = callbacks.data || ctx?.printAreaData;

  if (row.placement_modes && typeof row.placement_modes === "object") {
    st.publishLogicByPh = { ...row.placement_modes };
  }

  invalidateSessionTestProductPreviewCache(st);
  st.useSessionTestProductMock = true;
  try {
    const preview = await apiFetchTestProductPreview(ctx, rowId, { view_key: st.activeView });
    if (preview?.ok) {
      applySessionTestProductMockToState(st, preview, st.activeView, { cacheBust: true });
      const designId = Number(preview.design_id ?? row.design_id);
      const designMeta =
        designId > 0 ? await resolveDesignMetaForHydrate(designId, preview, st) : null;
      hydrateSessionDesignFromTestProductPreview(st, data, preview, {
        designRow: row,
        designMeta,
        allowFallbackPlacement: true,
      });
      callbacks.onMockReady?.(preview);
    }
  } catch (_) {
    /* preview optional */
  }
  callbacks.onDesignPlaced?.();
  callbacks.onPrintAreaRefresh?.();
  callbacks.onDesignDockRefresh?.();
}

/** Sync session design overlay when switching views on an active test product. */
export async function syncActiveTestProductViewSession(ctx, st, data, viewKey, callbacks = {}) {
  const rowId = getActiveTestProductRowId(st);
  if (!rowId) return null;

  persistSessionDesignToMap(st);
  if (activateSessionDesignForView(st, data)) {
    callbacks.onDesignPlaced?.();
    callbacks.onDesignDockRefresh?.();
    return st.sessionTestDesign;
  }

  try {
    const preview = await apiFetchTestProductPreview(ctx, rowId, {
      view_key: normViewKey(viewKey || st.activeView),
    });
    if (!preview?.ok) return null;
    const designId = Number(preview.design_id);
    const designMeta =
      designId > 0 ? await resolveDesignMetaForHydrate(designId, preview, st) : null;
    hydrateSessionDesignFromTestProductPreview(st, data, preview, { designMeta });
    callbacks.onDesignPlaced?.();
    callbacks.onPrintAreaRefresh?.();
    callbacks.onDesignDockRefresh?.();
    return st.sessionTestDesign;
  } catch {
    return null;
  }
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
    const res = await apiFetchTestProducts(ctx, ctx.productKey, ctx.selectedPrintProviderId);
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
              const delRes = await apiDeleteTestProducts(ctx, [id]);
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
      if (row.design_preview_url && !row.printify_product_id) {
        thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
        thumbEl.innerHTML = `<img src="${escapeHtml(row.design_preview_url)}" alt="" loading="lazy" />`;
        continue;
      }
      apiFetchTestProductPreview(ctx, row.id)
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
      err.textContent = testProductErrorMessage(e) || e?.message || "Failed to load test products";
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

function buildTestContext(ctx, st, data = ctx?.printAreaData, { randomDesign = false, designId, brandAssetsOnly = false, title } = {}) {
  const version = resolvePrintAreaVersion(ctx, data);
  const rawPid = ctx.selectedPrintProviderId;
  const pidNum = Number(rawPid);
  const pid =
    Number.isFinite(pidNum) && String(pidNum) === String(rawPid).trim()
      ? pidNum
      : rawPid != null && String(rawPid).trim() !== ""
        ? String(rawPid).trim()
        : null;
  const profile = (ctx.bundle?.publish_profiles || []).find((p) => {
    const pp = p?.print_provider_id;
    if (pid == null) return false;
    return String(pp) === String(pid) || Number(pp) === Number(pid);
  });
  const regions = ctx.bundle?.product?.regions;
  const regionCode = Array.isArray(regions) && regions.length ? regions[0] : "EU";
  /** Active Print Area view chip — create must place the design only on this view. */
  const viewKey = normViewKey(st.activeView || "front");
  const body = {
    product_key: ctx.productKey,
    print_provider_id: pid ?? undefined,
    print_area_template_id: resolvePrintAreaTemplateId(ctx, data),
    version_label: printAreaVersionSlug(version),
    design_type: st.activeDesignType || "classic",
    publish_profile_id: profile?.id ? Number(profile.id) : undefined,
    region_code: regionCode,
    placement_modes: { ...(st.publishLogicByPh || {}) },
    view_key: viewKey,
  };
  const titleTrim = String(title || "").trim();
  if (titleTrim) body.title = titleTrim;
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
  if (sessionPlacement) {
    body.design_session_placement = {
      ...sessionPlacement,
      view_key: sessionPlacement.view_key || viewKey,
    };
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
  { onStatus, randomDesign = true, designId, keepSession = false, data, brandAssetsOnly = false, title } = {}
) {
  const partner = isPartnerCtx(ctx, data);
  if (!ctx?.productKey) {
    throw new Error("Select a product first.");
  }
  if (!partner && !ctx?.selectedPrintProviderId) {
    throw new Error("Select a print provider first.");
  }
  if (partner && brandAssetsOnly) {
    throw new Error("Brand-assets-only create is Printify-only. Choose Automatic or a design.");
  }

  onStatus?.("Saving print area settings…");
  const { savePrintAreaTab } = await import("../tabs/print-area.js");
  try {
    await savePrintAreaTab(ctx);
  } catch (e) {
    const msg = testProductErrorMessage(e);
    throw new Error(`Could not save print area before create: ${msg}`);
  }

  const placementData = data ?? ctx?.printAreaData;
  const body = buildTestContext(ctx, st, placementData, { randomDesign, designId, brandAssetsOnly, title });
  if (brandAssetsOnly) {
    onStatus?.("Creating test product (brand assets only)…");
  } else {
    onStatus?.(
      randomDesign
        ? "Creating test product with automatic design…"
        : `Creating test product with design #${body.design_id}…`
    );
  }
  let res;
  try {
    res = await apiCreateTestProduct(ctx, body, placementData);
  } catch (e) {
    throw new Error(testProductErrorMessage(e));
  }
  if (!res?.ok) {
    throw new Error(testProductErrorMessage({ data: res, message: res?.message || res?.error || "Create failed", status: 500 }));
  }
  onStatus?.(
    partner
      ? `Created: ${res.title || res.id || "OK"} (Available — publish from Admin → Products → Todify)`
      : `Created: ${res.printify_product_id || "OK"}`
  );
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
  } else if (res.id) {
    st.activeTestProductRowId = Number(res.id);
    st.useSessionTestProductMock = !!partner;
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

function readCreateTitleFromModal() {
  const el = document.getElementById("ce-pa-tp-create-chooser");
  const input = el?.querySelector("[data-ce-pa-create-title]");
  return String(input?.value || "").trim();
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
        <div class="ce-pa-tp-create-title-field" data-ce-pa-create-title-wrap hidden>
          <label class="ce-hint" for="ce-pa-tp-create-title">Product name</label>
          <input type="text" class="input" id="ce-pa-tp-create-title" data-ce-pa-create-title autocomplete="off" />
          <p class="ce-hint">Default is the partner catalog name. You can override it.</p>
        </div>
        <p class="ce-hint">How should we pick the design?</p>
        <div class="ce-pa-tp-create-chooser__actions">
          <button type="button" class="btn btn-primary" data-ce-pa-create-random>Automatic</button>
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
    void runCreateWithDesign(id, row);
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
}

async function afterCreateSuccess(res, callbacks) {
  const { ctx, st, onStatus, onMockReady, onDesignPlaced, onDesignDockRefresh, root, data } = callbacks || {};
  if (!res?.id || !st) return;
  st.activeTestProductRowId = Number(res.id);
  st.useSessionTestProductMock = true;

  if (isPartnerCtx(ctx, data)) {
    onMockReady?.(res);
  } else {
    try {
      const preview = await fetchTestPrintifyProductPreview(res.id, { view_key: st.activeView });
      if (preview?.ok) {
        applySessionTestProductMockToState(st, preview, st.activeView, { cacheBust: true });
        onMockReady?.(preview);
      }
    } catch {
      /* optional */
    }
  }
  if (root) await loadSidebarTestProductsGrid(ctx, root, sidebarCallbacksRef || callbacks);
  onDesignPlaced?.();
  onDesignDockRefresh?.();
  onStatus?.(
    isPartnerCtx(ctx, data)
      ? "Test product ready (Available). Publish from Admin → Products → Todify."
      : "Test product ready — adjust design, then click ✓ to apply changes."
  );
}

async function runCreateWithRandom() {
  const callbacks = createChooserCallbacks || {};
  const { ctx, st, onStatus } = callbacks;
  if (!ctx || !st) return;
  const title = readCreateTitleFromModal();
  closeDesignPickerModal();
  closeCreateChooserModal();
  try {
    onStatus?.("Working…");
    const res = await createTestProductFromPrintArea(ctx, st, {
      onStatus,
      randomDesign: true,
      keepSession: false,
      data: callbacks.data,
      title,
    });
    createChooserCallbacks = callbacks;
    await afterCreateSuccess(res, callbacks);
  } catch (e) {
    onStatus?.(testProductErrorMessage(e));
  }
}

async function runCreateWithDesign(designId, designRow) {
  const callbacks = createChooserCallbacks || {};
  const { ctx, st, onStatus, onDesignPlaced, data, brandAssets } = callbacks;
  if (!ctx || !st || !designId) return;
  const title = readCreateTitleFromModal();
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
      title,
    });
    createChooserCallbacks = callbacks;
    await afterCreateSuccess(res, callbacks);
  } catch (e) {
    if (st.sessionTestDesign) st.sessionTestDesign.testProductCreating = false;
    onStatus?.(testProductErrorMessage(e));
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
  const data = callbacks.data || ctx?.printAreaData || null;
  const partner = isPartnerCtx(ctx, data);
  createChooserCallbacks = {
    mode: "create",
    ctx,
    st,
    root: callbacks.root || ctx?.printAreaRoot || null,
    onStatus: callbacks.onStatus || null,
    onDesignPlaced: callbacks.onDesignPlaced || callbacks.onSessionDesignPlaced || null,
    onMockReady: callbacks.onMockReady || null,
    onDesignDockRefresh: callbacks.onDesignDockRefresh || null,
    data,
    brandAssets: callbacks.brandAssets || null,
  };
  const el = ensureCreateChooserModal();
  const titleWrap = el.querySelector("[data-ce-pa-create-title-wrap]");
  const titleInput = el.querySelector("[data-ce-pa-create-title]");
  if (titleWrap && titleInput) {
    if (partner) {
      titleWrap.hidden = false;
      titleInput.value =
        String(callbacks.defaultTitle || "").trim() ||
        editorProductTitle(ctx?.bundle, ctx?.productKey) ||
        ctx?.productKey ||
        "";
    } else {
      titleWrap.hidden = true;
      titleInput.value = "";
    }
  }
  setModalOpen(el, true);
}

export function openPlaceDesignChooser(ctx, st, callbacks = {}) {
  openCreateTestProductChooser(ctx, st, callbacks);
}

export async function createTestProductWithSessionDesign(ctx, st, opts = {}) {
  openCreateTestProductChooser(ctx, st, opts);
}

export async function removeDesignFromActiveView(ctx, st, callbacks = {}) {
  if (isPartnerCtx(ctx)) {
    const vk = normViewKey(st.activeView || "front");
    removeSessionDesignForView(st, vk);
    if (!st.sessionTestDesign?.designId) clearSessionTestDesign(st);
    callbacks.onDesignPlaced?.();
    callbacks.onDesignDockRefresh?.();
    callbacks.onStatus?.("Design removed from view.");
    return null;
  }
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

export function bindSessionTestProductFlow(ctx, st, callbacks = {}) {
  const { onStatus, onMockReady, onDesignPlaced, onDirtyChange, data } = callbacks;
  const placementData = data || ctx?.printAreaData;
  return {
    async onSave() {
      if (isPartnerCtx(ctx, placementData)) {
        markSessionDesignSaved(st);
        onDirtyChange?.(false);
        onStatus?.("Design placement saved locally (Todify draft).");
        onDesignPlaced?.();
        return;
      }
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

