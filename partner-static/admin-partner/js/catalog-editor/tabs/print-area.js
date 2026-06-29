import {
  fetchPrintAreaBundle,
  fetchMockupsBundle,
  fetchVariantsBundle,
  fetchProviderCatalogDetail,
  savePrintAreasConfig,
  saveMockups,
  loadPrintifySettings,
  fetchTemplateBundle,
  fetchPrintifyMockups,
  saveVariantPrintAreaRect,
  savePrintAreaRect,
  fetchBrandAssetsBundle,
  saveProviders,
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
  listViewKeys,
  printAreaCatalogDetail,
  resolvePrintAreaVersion,
  readBrandAssetsFromConfig,
  resolveEffectiveBrandAssets,
  readPublishLogicFromConfig,
  writePublishLogicToConfig,
  printAreaVersionSlug,
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
import { mountViewDock, removeViewDock, remountViewDock, updateViewDockActive } from "../print-area/view-dock.js";
import { mountDesignDock, removeDesignDock } from "../print-area/design-dock.js";
import { openPrintAreaFullscreen, closePrintAreaFullscreen } from "../print-area/fullscreen-viewer.js";
import { notifyActiveTabDirty } from "../editor-tab-dirty.js";
import {
  bindSessionTestProductFlow,
  refreshSessionTestProductMock,
  applySessionTestProductMockToState,
  hasActiveSessionTestProduct,
  refreshPrintAreaMockViewer,
  syncSessionDesignFromPrintify,
  loadSidebarTestProductsGrid,
  removeDesignFromActiveView,
  syncActiveTestProductViewSession,
} from "../print-area/test-products.js";
import { applyLivePrintifyPlacementToSessionDesign } from "../print-area/design-session-overlay.js";
import {
  printAreaMainSourceContext,
  applyPrintAreaInheritanceToState,
  collectMainSourceVersionUpdates,
  collectMainSourceSnapshot,
  syncMainSourceFromSubnavDom,
  syncCategoryInheritFromSidebarDom,
  setCategoryUseMainSource,
} from "../print-area/main-source.js";

export function teardownPrintAreaUi(ctx) {
  closePrintAreaFullscreen();
  ctx.printAreaFullscreenHandle = null;
  ctx.printAreaViewerHandle?.destroy?.();
  ctx.printAreaDesignDockHandle?.destroy?.();
  ctx.printAreaViewDockHandle?.destroy?.();
  removeDesignDock();
  removeViewDock();
  ctx.printAreaViewerHandle = null;
  ctx.printAreaDesignDockHandle = null;
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
  st.publishLogicByPh = readPublishLogicFromConfig(full, designType, st.versionSlug || "standard");
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
  if (!hasActiveSessionTestProduct(st)) {
    st.mockUrlsByView[st.activeView] = pickMockUrlForView(
      st.mockupImagesByView,
      st.activeView,
      getActiveColorTitle(st)
    );
  }
}

function getActiveColorTitle(st) {
  return st.variantGroups.groups.find((g) => g.id === st.activeVariantGroupId)?.title || null;
}

function syncViewKeys(st, data, ctx) {
  const version = resolvePrintAreaVersion(ctx, data);
  const catalogDetail = printAreaCatalogDetail(ctx, data);
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  st.viewKeys = listViewKeys(data.mockup_defaults, slice, version, catalogDetail);
  if (!st.viewKeys.includes(st.activeView)) {
    st.activeView = st.viewKeys[0] || "front";
  }
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

  for (const dt of st.designTypesScope) {
    if (dt === sourceDt) continue;
    const { slice: target } = getDesignTypeSlice(cfg, dt);
    if (!placementMode) {
      applyGreenRectToSlice(target, st.activeView, st.greenRect);
    }
    target.pattern = { ...st.patternConfig };
  }

  cfg.brand_assets_mode = st.brandAssetsMode || "global";
  cfg.brand_assets = JSON.parse(JSON.stringify(st.brandAssets || { qr: {}, logo: {} }));

  const versionSlug = st.versionSlug || printAreaVersionSlug(resolvePrintAreaVersion(ctx, data));
  let out = writePublishLogicToConfig(cfg, sourceDt, versionSlug, st.publishLogicByPh);
  for (const dt of st.designTypesScope) {
    if (dt === sourceDt) continue;
    out = writePublishLogicToConfig(out, dt, versionSlug, st.publishLogicByPh);
  }
  return out;
}

export function snapshotPrintAreaTab(ctx) {
  const st = ctx.printAreaState;
  const data = ctx.printAreaData;
  if (!st || !data) return null;
  syncPrintAreaDomState(ctx);
  return {
    config: buildConfigForSave(st, ctx, data),
    useMockups: !!st.useMockups,
    variantsScope: [...st.variantsScope].sort(),
    brandAssetsMode: st.brandAssetsMode || "global",
    brandAssets: JSON.parse(JSON.stringify(st.brandAssets || { qr: {}, logo: {} })),
    mainSourceVersionEdits: collectMainSourceSnapshot(ctx),
  };
}

export function syncPrintAreaDomState(ctx) {
  if (!ctx || ctx.activeTab !== "print_area") return;
  syncMainSourceFromSubnavDom(ctx);
  const root = ctx.printAreaRoot || document.getElementById("ce-body");
  syncCategoryInheritFromSidebarDom(ctx, root);
}

function notifyPrintAreaDirty(ctx) {
  notifyActiveTabDirty(ctx);
}

function buildRedRectPlacement(redRect) {
  return {
    x: Number((redRect.x + redRect.w / 2).toFixed(4)),
    y: Number((redRect.y + redRect.h / 2).toFixed(4)),
    scale: Number(Math.max(redRect.w, redRect.h).toFixed(4)),
  };
}

async function persistMockupDefaultRects(ctx, st) {
  await savePrintAreaRect({
    product_key: ctx.productKey,
    print_area_key: st.activeView,
    print_area_rect: st.redRect,
    mockup_rect: st.greenRect,
    universal_rect: st.redRect,
    placement: buildRedRectPlacement(st.redRect),
    auto_mirror: false,
  });
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
  const [printArea, mockups, variants, catalogDetail, brandBundle] = await Promise.all([
    fetchPrintAreaBundle(ctx.productKey, pid, ctx.selectedVersionId),
    fetchMockupsBundle(ctx.productKey, pid).catch(() => ({ images: [] })),
    fetchVariantsBundle(ctx.productKey, pid).catch(() => ({})),
    fetchProviderCatalogDetail(ctx.productKey, pid).catch(() => ({})),
    fetchBrandAssetsBundle().catch(() => ({ assets: { qr: {}, logo: {} } })),
  ]);
  const data = mergeTabData(printArea, mockups, variants);
  if (Array.isArray(catalogDetail?.variants) && catalogDetail.variants.length) {
    data.catalog_variants = catalogDetail.variants;
  }
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
    const brandFromConfig = readBrandAssetsFromConfig(st.workingConfig);
    st.brandAssetsMode = brandFromConfig.mode;
    st.brandAssets = JSON.parse(JSON.stringify(brandFromConfig.assets));
    syncViewKeys(st, data, ctx);
    ctx.printAreaRemountViewDock?.();
    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    st.patternConfig = { ...(slice.pattern || {}) };
    st.publishLogicByPh = readPublishLogicFromConfig(st.workingConfig, st.activeDesignType, st.versionSlug || "standard");
    const { red, green, greenDirty } = resolveRectsForView(data, slice, st.activeView);
    st.redRect = red;
    st.greenRect = green;
    st.greenDirty = greenDirty;
    if (st.perVariantProduct && st.activeVariantGroupId) {
      loadRectsForVariantGroup(st, data, st.activeVariantGroupId);
    }
  }

  return `
    <div class="ce-tab-panel ce-tab-panel--print-area">
      ${renderPrintAreaSidebar(ctx.printAreaState, data, ctx, ctx.brandAssetsBundle?.assets, printAreaMainSourceContext(ctx))}
    </div>`;
}

export function bindPrintAreaTab(ctx, root) {
  const st = ctx.printAreaState;
  const data = ctx.printAreaData;
  if (!st || !data) return;

  teardownPrintAreaUi(ctx);
  ctx.printAreaRoot = root;

  const msCtx = printAreaMainSourceContext(ctx);
  applyPrintAreaInheritanceToState(st, ctx, data, msCtx);

  const editorMain = root.closest(".catalog-editor")?.querySelector(".catalog-editor-main");

  const globalBrandAssetsRef = { current: ctx.brandAssetsBundle?.assets || { qr: {}, logo: {} } };
  const specificBrandAssetsRef = { current: JSON.parse(JSON.stringify(st.brandAssets || { qr: {}, logo: {} })) };
  const brandAssetsModeRef = { current: st.brandAssetsMode || "global" };

  const getEffectiveBrandAssets = () => {
    st.brandAssetsMode = brandAssetsModeRef.current;
    st.brandAssets = specificBrandAssetsRef.current;
    return resolveEffectiveBrandAssets(st, globalBrandAssetsRef.current);
  };

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
      notifyPrintAreaDirty(ctx);
    },
  };
  ctx.printAreaImageGridCallbacks = imageGridCallbacks;

  const refreshPrintifyViewer = () => {
    ctx.printAreaViewerHandle?.refreshPrintify?.(st);
  };

  const onSessionTestProductMockReady = (preview) => {
    if (preview) {
      applySessionTestProductMockToState(st, preview, st.activeView);
      if (preview.design_placement) {
        applyLivePrintifyPlacementToSessionDesign(st, data, preview, { markDirty: false });
      }
    }
    refreshPrintifyViewer();
    ctx.printAreaViewerHandle?.refreshSessionDesign?.();
    ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
  };

  const sidebarCallbacks = {
    ctx,
    imageGridCallbacks,
    globalBrandAssetsRef,
    brandAssetsModeRef,
    specificBrandAssetsRef,
    onBrandAssetsChange: () => {
      st.brandAssetsMode = brandAssetsModeRef.current;
      st.brandAssets = specificBrandAssetsRef.current;
      const effective = getEffectiveBrandAssets();
      ctx.printAreaViewerHandle?.setBrandAssets?.(effective);
      ctx.printAreaFullscreenHandle?.setBrandAssets?.(effective);
      persistStateToCtx(ctx, st);
      notifyPrintAreaDirty(ctx);
    },
    onChange: () => {
      persistStateToCtx(ctx, st);
      notifyPrintAreaDirty(ctx);
    },
    onPatternChange: () => {
      persistStateToCtx(ctx, st);
      ctx.printAreaViewerHandle?.refreshPattern?.();
      notifyPrintAreaDirty(ctx);
    },
    onPrintAreaRefresh: refreshPrintAreaViewer,
    onSessionDesignPlaced: () => {
      ctx.printAreaViewerHandle?.refreshSessionDesign?.();
      ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
      ctx.printAreaDesignDockHandle?.refresh?.();
    },
    onMockReady: onSessionTestProductMockReady,
    onDesignDockRefresh: () => ctx.printAreaDesignDockHandle?.refresh?.(),
    onDesignTypeChange: (dt) => {
      loadDesignTypeIntoState(st, data, dt);
      applyPrintAreaInheritanceToState(st, ctx, data, printAreaMainSourceContext(ctx));
      refreshScopeActiveStates(root, st);
      refreshPatternSummary(root, st);
      refreshPatternSection(root, st, sidebarCallbacks.onPatternChange, printAreaMainSourceContext(ctx));
      refreshPlacementSummary(root, st);
      refreshPlacementValues(root, st);
      refreshPrintAreaViewer();
    },
    onVariantGroupChange: async () => {
      refreshScopeActiveStates(root, st);
      refreshPrintAreaViewer();
      if (hasActiveSessionTestProduct(st)) {
        try {
          await refreshSessionTestProductMock(st, st.activeView, {
            force: true,
            colorKey: getActiveColorTitle(st),
          });
          refreshPrintifyViewer();
        } catch (err) {
          console.warn("Session test product mock refresh failed", err);
        }
      }
    },
    onCategoryInheritChange: (categoryKey, enabled) => {
      setCategoryUseMainSource(ctx, ctx.selectedPrintProviderId, categoryKey, enabled);
      applyPrintAreaInheritanceToState(st, ctx, data, printAreaMainSourceContext(ctx));
      refreshScopeActiveStates(root, st);
      refreshPatternSection(root, st, sidebarCallbacks.onPatternChange, printAreaMainSourceContext(ctx));
      refreshPlacementSection(root, st, data, ctx, printAreaMainSourceContext(ctx));
      refreshImagesGrids(root, ctx, st, data, imageGridCallbacks);
      notifyPrintAreaDirty(ctx);
      refreshPrintAreaViewer();
    },
  };

  bindPrintAreaSidebar(root, st, data, sidebarCallbacks);

  void loadSidebarTestProductsGrid(ctx, root, {
    ...sidebarCallbacks,
    root,
    data,
    brandAssets: getEffectiveBrandAssets(),
    onDesignPlaced: sidebarCallbacks.onSessionDesignPlaced,
  });

  const sessionTestFlow = bindSessionTestProductFlow(ctx, st, {
    data,
    onStatus: (msg) => {
      const statusEl = root.querySelector("#ce-pa-test-products-status");
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = msg;
      }
    },
    onMockReady: onSessionTestProductMockReady,
    onDesignPlaced: () => {
      ctx.printAreaViewerHandle?.refreshSessionDesign?.();
      ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
    },
  });

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
    notifyPrintAreaDirty(ctx);
  };

  const onSyncFromPrintify = async () => {
    if (!hasActiveSessionTestProduct(st)) return;
    const statusEl = root.querySelector("#ce-pa-test-products-status");
    try {
      if (statusEl) statusEl.hidden = false;
      await syncSessionDesignFromPrintify(ctx, st, data, {
        viewKey: st.activeView,
        onStatus: (msg) => {
          if (statusEl) statusEl.textContent = msg;
        },
      });
      ctx.printAreaViewerHandle?.refreshSessionDesign?.();
      ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
    } catch (err) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = err?.message || "Sync from Printify failed";
      }
    }
  };

  ctx.printAreaViewerHandle = mountDualViewer(root, ctx, st, data, {
    onStateChange: onPrintAreaStageChange,
    onMockRefresh: () => refreshPrintifyMock(ctx, refreshPrintifyViewer),
    onSyncFromPrintify,
    onSessionDesignSave: () => sessionTestFlow.onSave(),
    brandAssets: getEffectiveBrandAssets(),
    hasSessionTestProduct: () => hasActiveSessionTestProduct(st),
    onMagnify: () => {
      ctx.printAreaFullscreenHandle = openPrintAreaFullscreen(ctx, st, data, {
        onStateChange: onPrintAreaStageChange,
        onSessionDesignSave: () => sessionTestFlow.onSave(),
        onSyncFromPrintify,
        hasSessionTestProduct: () => hasActiveSessionTestProduct(st),
        onClose: () => {
          syncMainPrintAreaStage(true);
          ctx.printAreaFullscreenHandle = null;
        },
        brandAssets: getEffectiveBrandAssets(),
      });
    },
  });

  const onViewDockChange = async (viewKey) => {
    loadViewIntoState(st, data, viewKey);
    if (hasActiveSessionTestProduct(st)) {
      await syncActiveTestProductViewSession(ctx, st, data, viewKey, {
        onDesignPlaced: () => {
          ctx.printAreaViewerHandle?.refreshSessionDesign?.();
          ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
        },
        onDesignDockRefresh: () => ctx.printAreaDesignDockHandle?.refresh?.(),
      });
    }
    updateViewDockActive(st);
    ctx.printAreaDesignDockHandle?.refresh?.();
    refreshPlacementSummary(root, st);
    refreshPlacementSection(root, st, data, ctx, printAreaMainSourceContext(ctx));
    root.querySelectorAll(".ce-pa-pl-mode").forEach((sel) => {
      sel.addEventListener("change", () => {
        st.publishLogicByPh[sel.dataset.ph] = sel.value;
        persistStateToCtx(ctx, st);
        notifyPrintAreaDirty(ctx);
      });
    });
    ctx.printAreaViewerHandle?.refreshSessionDesign?.();
    refreshPrintAreaViewer();
    if (st.sessionTestDesign?.testProductRowId) {
      try {
        await refreshSessionTestProductMock(st, viewKey, {
          force: false,
          colorKey: getActiveColorTitle(st),
          data,
        });
        refreshPrintifyViewer();
        ctx.printAreaViewerHandle?.refreshSessionDesign?.();
      } catch (err) {
        console.warn("Session test product mock refresh failed", err);
      }
    }
  };

  const mountOrRefreshViewDock = () => {
    if (ctx.activeTab !== "print_area" || !editorMain) {
      removeDesignDock();
      removeViewDock();
      ctx.printAreaDesignDockHandle = null;
      ctx.printAreaViewDockHandle = null;
      return;
    }
    ctx.printAreaDesignDockHandle?.destroy?.();
    ctx.printAreaViewDockHandle?.destroy?.();
    removeDesignDock();
    removeViewDock();
    ctx.printAreaDesignDockHandle = mountDesignDock(editorMain, st, {
      onRemoveDesign: async () => {
        const statusEl = root.querySelector("#ce-pa-test-products-status");
        try {
          await removeDesignFromActiveView(ctx, st, {
            root,
            onStatus: (msg) => {
              if (statusEl) {
                statusEl.hidden = false;
                statusEl.textContent = msg;
              }
            },
            onMockReady: onSessionTestProductMockReady,
            onDesignPlaced: () => {
              ctx.printAreaViewerHandle?.refreshSessionDesign?.();
              ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
            },
            onDesignDockRefresh: () => ctx.printAreaDesignDockHandle?.refresh?.(),
          });
          refreshPrintifyViewer();
          ctx.printAreaViewerHandle?.refreshSessionDesign?.();
          ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
        } catch (err) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = err?.message || "Remove design failed";
          }
        }
      },
    });
    ctx.printAreaViewDockHandle = remountViewDock(editorMain, st, onViewDockChange);
  };

  mountOrRefreshViewDock();
  ctx.printAreaRemountViewDock = mountOrRefreshViewDock;

  ctx.printAreaUiCleanup = () => teardownPrintAreaUi(ctx);
}

async function refreshPrintifyMock(ctx, refreshPrintifyViewer) {
  const st = ctx.printAreaState;
  if (!st) return;

  if (hasActiveSessionTestProduct(st)) {
    try {
      await refreshPrintAreaMockViewer(ctx, { force: true });
      refreshPrintifyViewer?.();
      ctx.printAreaViewerHandle?.refreshSessionDesign?.();
      ctx.printAreaFullscreenHandle?.refreshSessionDesign?.();
      const statusEl = ctx.printAreaRoot?.querySelector("#ce-pa-test-products-status");
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "Mock refreshed from test product (Printify).";
      }
    } catch (err) {
      console.error("Session test product mock refresh failed", err);
      const statusEl = ctx.printAreaRoot?.querySelector("#ce-pa-test-products-status");
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = err?.message || "Mock refresh failed";
      }
    }
    return;
  }

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

  await persistMockupDefaultRects(ctx, st);

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
  st.boundsDirty = false;
  st.workingConfig = config;
  persistStateToCtx(ctx, st);

  const versionUpdates = collectMainSourceVersionUpdates(ctx);
  if (versionUpdates.length) {
    await saveProviders(ctx.productKey, { version_updates: versionUpdates, auto_mirror: false });
    ctx.printAreaVersionConfigEdits?.clear?.();
  }
}
