import {
  fetchPrintAreaBundle,
  fetchMockupsBundle,
  fetchVariantsBundle,
  savePrintAreasConfig,
  saveMockups,
  loadPrintifySettings,
  fetchTemplateBundle,
  fetchPrintifyMockups,
  saveVariantPrintAreaRect,
  fetchBrandAssetsBundle,
} from "../api.js";
import {
  createInitialPrintAreaState,
  getDesignTypeSlice,
  normalizeDesignTypeKey,
  ensureByDesignTypeConfig,
  buildMockupImagesByView,
  pickMockUrlForView,
  loadRectsForVariantGroup,
  resolveRectsForView,
  resolvePrintAreaUseMockups,
  getPublishProfileConfig,
} from "../print-area/helpers.js";
import {
  renderPrintAreaSidebar,
  bindPrintAreaSidebar,
  refreshScopeActiveStates,
  refreshPatternSummary,
  refreshPatternSection,
  refreshPlacementSummary,
  refreshPlacementValues,
  refreshPlacementSection,
  refreshImagesGrids,
} from "../print-area/settings-sidebar.js";
import { mountDualViewer, applyGreenRectToSlice, isPlacementOverlayMode } from "../print-area/dual-viewer.js";
import { mountViewDock, removeViewDock, updateViewDockActive } from "../print-area/view-dock.js";
import { openPrintAreaFullscreen, closePrintAreaFullscreen } from "../print-area/fullscreen-viewer.js";

export function teardownPrintAreaUi(ctx) {
  closePrintAreaFullscreen();
  ctx.printAreaFullscreenHandle = null;
  ctx.printAreaViewerHandle?.destroy?.();
  ctx.printAreaViewDockHandle?.destroy?.();
  removeViewDock();
  ctx.printAreaViewerHandle = null;
  ctx.printAreaViewDockHandle = null;
}

function persistStateToCtx(ctx, st) {
  ctx.printAreaState = st;
  ctx.selectedDesignType = st.activeDesignType;
  ctx.printAreaActiveView = st.activeView;
}

function mergeTabData(printArea, mockups, variants) {
  const productData =
    variants?.product_data ||
    variants?.product_data_json ||
    (variants?.template?.product_data_json ? parseProductData(variants.template.product_data_json) : null);
  return {
    ...printArea,
    product: mockups?.product || printArea?.product || null,
    mockup_images: mockups?.images || [],
    mockup_images_by_view: buildMockupImagesByView(mockups?.images || []),
    variants_json: variants?.variants_json || null,
    product_data: productData,
  };
}

function parseProductData(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function loadDesignTypeIntoState(st, data, designType) {
  const { full, slice } = getDesignTypeSlice(st.workingConfig, designType);
  st.workingConfig = full;
  st.activeDesignType = normalizeDesignTypeKey(designType);
  st.patternConfig = { ...(slice.pattern || {}) };
  st.publishLogicByPh = { ...(slice.publish_logic || st.publishLogicByPh) };
  const { green, greenDirty } = resolveRectsForView(data, slice, st.activeView);
  st.greenRect = green;
  st.greenDirty = greenDirty;
}

function loadViewIntoState(st, data, viewKey) {
  st.activeView = String(viewKey || "front").toLowerCase();
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  const { red, green, greenDirty } = resolveRectsForView(data, slice, st.activeView);
  st.redRect = red;
  st.greenRect = green;
  st.greenDirty = greenDirty;
  if (st.perVariantProduct && st.activeVariantGroupId) {
    loadRectsForVariantGroup(st, data, st.activeVariantGroupId);
  }
  st.boundsLocked = true;
  st.boundsDirty = false;
  st.mockUrlsByView[st.activeView] = pickMockUrlForView(st.mockupImagesByView, st.activeView, getActiveColorTitle(st));
}

function getActiveColorTitle(st) {
  return st.variantGroups.groups.find((g) => g.id === st.activeVariantGroupId)?.title || null;
}

function buildConfigForSave(st, ctx, data) {
  const cfg = ensureByDesignTypeConfig(JSON.parse(JSON.stringify(st.workingConfig)));
  const sourceDt = st.activeDesignType;
  const { slice: sourceSlice } = getDesignTypeSlice(cfg, sourceDt);
  const placementMode = isPlacementOverlayMode(ctx, st, data);

  if (!placementMode) {
    applyGreenRectToSlice(sourceSlice, st.activeView, st.greenRect);
  }
  sourceSlice.pattern = { ...st.patternConfig };
  sourceSlice.publish_logic = { ...st.publishLogicByPh };

  for (const dt of st.designTypesScope) {
    if (dt === sourceDt) continue;
    const { slice: target } = getDesignTypeSlice(cfg, dt);
    if (!placementMode) {
      applyGreenRectToSlice(target, st.activeView, st.greenRect);
    }
    target.pattern = { ...st.patternConfig };
    target.publish_logic = { ...st.publishLogicByPh };
  }

  return cfg;
}

async function saveVariantRectsForScope(ctx, st) {
  const view = st.activeView;
  for (const group of st.variantGroups.groups) {
    if (!st.variantsScope.has(group.id)) continue;
    for (const variantId of group.variantIds) {
      await saveVariantPrintAreaRect({
        product_key: ctx.productKey,
        print_area_key: view,
        variant_id: variantId,
        print_area_rect: st.redRect,
        rect_type: "print_area",
        auto_mirror: false,
      });
      await saveVariantPrintAreaRect({
        product_key: ctx.productKey,
        print_area_key: view,
        variant_id: variantId,
        print_area_rect: st.greenRect,
        rect_type: "mockup",
        auto_mirror: false,
      });
    }
  }
}

async function resolvePrintifyProductId(ctx) {
  if (!ctx.templateData) {
    try {
      ctx.templateData = await fetchTemplateBundle(ctx.productKey, ctx.selectedPrintProviderId);
    } catch {
      ctx.templateData = null;
    }
  }
  const tpl = ctx.templateData?.template;
  const version = (ctx.printAreaData?.versions || []).find((v) => String(v.id) === String(ctx.selectedVersionId));
  return (
    tpl?.printify_print_areas_product_id ||
    tpl?.print_areas_product_id ||
    tpl?.printify_mockups_product_id ||
    version?.external_template_product_id ||
    tpl?.printify_product_id ||
    null
  );
}

export async function loadPrintAreaTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  const [printArea, mockups, variants, brandBundle] = await Promise.all([
    fetchPrintAreaBundle(ctx.productKey, pid, ctx.selectedVersionId),
    fetchMockupsBundle(ctx.productKey, pid).catch(() => ({ images: [] })),
    fetchVariantsBundle(ctx.productKey, pid).catch(() => ({})),
    fetchBrandAssetsBundle().catch(() => ({ assets: { qr: {}, logo: {} } })),
  ]);
  const data = mergeTabData(printArea, mockups, variants);
  ctx.printAreaData = data;
  ctx.brandAssetsBundle = brandBundle || { assets: { qr: {}, logo: {} } };

  const stateKey = `${pid}:${ctx.selectedVersionId}`;
  if (!ctx.printAreaState || ctx.printAreaState._key !== stateKey) {
    const st = createInitialPrintAreaState(ctx, data);
    st._key = stateKey;
    for (const vk of st.viewKeys) {
      st.mockUrlsByView[vk] = pickMockUrlForView(st.mockupImagesByView, vk, getActiveColorTitle(st));
    }
    persistStateToCtx(ctx, st);
  } else {
    const st = ctx.printAreaState;
    st.mockupImagesByView = data.mockup_images_by_view;
    st.useMockups = resolvePrintAreaUseMockups(ctx, data);
    st.workingConfig = ensureByDesignTypeConfig(getPublishProfileConfig(ctx));
    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    st.patternConfig = { ...(slice.pattern || {}) };
    st.publishLogicByPh = { ...(slice.publish_logic || st.publishLogicByPh) };
    const { red, green, greenDirty } = resolveRectsForView(data, slice, st.activeView);
    st.redRect = red;
    st.greenRect = green;
    st.greenDirty = greenDirty;
  }

  return `
    <div class="ce-tab-panel ce-tab-panel--print-area">
      ${renderPrintAreaSidebar(ctx.printAreaState, data, ctx, ctx.brandAssetsBundle?.assets)}
    </div>`;
}

export function bindPrintAreaTab(ctx, root) {
  const st = ctx.printAreaState;
  const data = ctx.printAreaData;
  if (!st || !data) return;

  teardownPrintAreaUi(ctx);
  ctx.printAreaRoot = root;

  const editorMain = root.closest(".catalog-editor")?.querySelector(".catalog-editor-main");

  const brandAssetsRef = { current: ctx.brandAssetsBundle?.assets || { qr: {}, logo: {} } };

  const refreshOverlays = () => {
    ctx.printAreaViewerHandle?.refreshOverlays?.();
  };

  const refreshPrintAreaViewer = () => {
    persistStateToCtx(ctx, st);
    ctx.printAreaViewerHandle?.refreshPrintArea?.(st, ctx.printAreaData);
    refreshOverlays();
  };

  const imageGridCallbacks = {
    onUploaded: () => {
      refreshImagesGrids(root, ctx, st, ctx.printAreaData, imageGridCallbacks);
      refreshPrintAreaViewer();
    },
    onCleared: () => {
      refreshImagesGrids(root, ctx, st, ctx.printAreaData, imageGridCallbacks);
      refreshPrintAreaViewer();
    },
    onUseMockPick: () => {
      refreshScopeActiveStates(root, st);
      persistStateToCtx(ctx, st);
      refreshPrintAreaViewer();
    },
  };
  ctx.printAreaImageGridCallbacks = imageGridCallbacks;

  const sidebarCallbacks = {
    ctx,
    imageGridCallbacks,
    brandAssetsRef,
    onBrandAssetsChange: refreshOverlays,
    onChange: () => persistStateToCtx(ctx, st),
    onPatternChange: () => {
      persistStateToCtx(ctx, st);
      ctx.printAreaViewerHandle?.refreshPattern?.();
    },
    onPrintAreaRefresh: refreshPrintAreaViewer,
    onDesignTypeChange: (dt) => {
      loadDesignTypeIntoState(st, data, dt);
      refreshScopeActiveStates(root, st);
      refreshPatternSummary(root, st);
      refreshPatternSection(root, st, sidebarCallbacks.onPatternChange);
      refreshPlacementSummary(root, st);
      refreshPlacementValues(root, st);
      refreshPrintAreaViewer();
    },
    onVariantGroupChange: () => {
      refreshScopeActiveStates(root, st);
      refreshPrintAreaViewer();
    },
  };

  bindPrintAreaSidebar(root, st, data, sidebarCallbacks);

  const refreshPrintifyViewer = () => {
    ctx.printAreaViewerHandle?.refreshPrintify?.(st);
  };

  const syncMainPrintAreaStage = (full = false) => {
    if (full) ctx.printAreaViewerHandle?.redraw?.();
    else ctx.printAreaViewerHandle?.redrawStageRects?.();
  };

  const syncFullscreenPrintAreaStage = (full = false) => {
    if (full) ctx.printAreaFullscreenHandle?.redraw?.();
    else ctx.printAreaFullscreenHandle?.redrawStageRects?.();
  };

  const onPrintAreaStageChange = () => {
    persistStateToCtx(ctx, st);
    syncMainPrintAreaStage(false);
    syncFullscreenPrintAreaStage(false);
  };

  ctx.printAreaViewerHandle = mountDualViewer(root, ctx, st, data, {
    onStateChange: onPrintAreaStageChange,
    onMockRefresh: () => refreshPrintifyMock(ctx, refreshPrintifyViewer),
    brandAssets: brandAssetsRef.current,
    onMagnify: () => {
      ctx.printAreaFullscreenHandle = openPrintAreaFullscreen(ctx, st, data, {
        onStateChange: onPrintAreaStageChange,
        onClose: () => {
          syncMainPrintAreaStage(true);
          ctx.printAreaFullscreenHandle = null;
        },
        brandAssets: brandAssetsRef.current,
      });
    },
  });

  ctx.printAreaViewDockHandle = mountViewDock(editorMain, st, (viewKey) => {
    loadViewIntoState(st, data, viewKey);
    updateViewDockActive(st);
    refreshPlacementSummary(root, st);
    refreshPlacementSection(root, st, data, ctx);
    root.querySelectorAll(".ce-pa-pl-mode").forEach((sel) => {
      sel.addEventListener("change", () => {
        st.publishLogicByPh[sel.dataset.ph] = sel.value;
        persistStateToCtx(ctx, st);
      });
    });
    refreshPrintAreaViewer();
  });

  ctx.printAreaUiCleanup = () => teardownPrintAreaUi(ctx);
}

async function refreshPrintifyMock(ctx, refreshPrintifyViewer) {
  const printifyId = await resolvePrintifyProductId(ctx);
  if (!printifyId) return;
  try {
    await loadPrintifySettings({
      product_key: ctx.productKey,
      print_provider_id: ctx.selectedPrintProviderId,
      version_id: ctx.selectedVersionId,
      printify_product_id: printifyId,
      design_type: ctx.printAreaState?.activeDesignType || "classic",
      auto_mirror: false,
    });
    const mockRes = await fetchPrintifyMockups({
      product_key: ctx.productKey,
      print_provider_id: ctx.selectedPrintProviderId,
      printify_product_id: printifyId,
      auto_mirror: false,
    });
    const st = ctx.printAreaState;
    if (mockRes?.by_view) {
      st.mockupImagesByView = mockRes.by_view;
      for (const vk of st.viewKeys) {
        st.mockUrlsByView[vk] = pickMockUrlForView(st.mockupImagesByView, vk, getActiveColorTitle(st));
      }
    }
    const data = await loadPrintAreaTabData(ctx);
    ctx.printAreaData = data;
    refreshPrintifyViewer?.();
    if (ctx.printAreaRoot) {
      refreshImagesGrids(ctx.printAreaRoot, ctx, st, data, ctx.printAreaImageGridCallbacks || {});
    }
  } catch (err) {
    console.error("Printify mock refresh failed", err);
  }
}

async function loadPrintAreaTabData(ctx) {
  const pid = ctx.selectedPrintProviderId;
  const [printArea, mockups, variants] = await Promise.all([
    fetchPrintAreaBundle(ctx.productKey, pid, ctx.selectedVersionId),
    fetchMockupsBundle(ctx.productKey, pid).catch(() => ({ images: [] })),
    fetchVariantsBundle(ctx.productKey, pid).catch(() => ({})),
  ]);
  return mergeTabData(printArea, mockups, variants);
}

export async function savePrintAreaTab(ctx) {
  const st = ctx.printAreaState;
  if (!st || !ctx.selectedPrintProviderId) return;

  const config = buildConfigForSave(st, ctx, ctx.printAreaData);
  await savePrintAreasConfig({
    product_key: ctx.productKey,
    print_provider_id: ctx.selectedPrintProviderId,
    config,
    auto_mirror: false,
  });

  if (st.variantsScope.size && st.variantGroups.groups.length) {
    await saveVariantRectsForScope(ctx, st);
  }

  await saveMockups(ctx.productKey, {
    print_area_edit_use_mocks: !!st.useMockups,
    auto_mirror: false,
  });
  if (ctx.bundle?.product) {
    ctx.bundle.product.print_area_edit_use_mocks = !!st.useMockups;
  }

  st.greenDirty = false;
  st.workingConfig = config;
  persistStateToCtx(ctx, st);
}
