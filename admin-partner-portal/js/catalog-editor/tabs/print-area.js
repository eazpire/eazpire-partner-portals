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
} from "../api.js";
import {
  createInitialPrintAreaState,
  getDesignTypeSlice,
  getMockupDefaultForView,
  getGreenRectFromSlice,
  parseRect,
  normalizeDesignTypeKey,
  ensureByDesignTypeConfig,
  buildMockupImagesByView,
  pickMockUrlForView,
  loadRectsForVariantGroup,
} from "../print-area/helpers.js";
import { renderPrintAreaSidebar, bindPrintAreaSidebar } from "../print-area/settings-sidebar.js";
import { mountDualViewer, applyGreenRectToSlice } from "../print-area/dual-viewer.js";

function persistStateToCtx(ctx, st) {
  ctx.printAreaState = st;
  ctx.selectedDesignType = st.activeDesignType;
  ctx.printAreaActiveView = st.activeView;
}

function mergeTabData(printArea, mockups, variants) {
  return {
    ...printArea,
    mockup_images: mockups?.images || [],
    mockup_images_by_view: buildMockupImagesByView(mockups?.images || []),
    variants_json: variants?.variants_json || null,
    product_data: variants?.product_data || variants?.product_data_json || null,
  };
}

function loadDesignTypeIntoState(st, designType) {
  const { full, slice } = getDesignTypeSlice(st.workingConfig, designType);
  st.workingConfig = full;
  st.activeDesignType = normalizeDesignTypeKey(designType);
  st.patternConfig = { ...(slice.pattern || {}) };
  st.publishLogicByPh = { ...(slice.publish_logic || st.publishLogicByPh) };
  const green = getGreenRectFromSlice(slice, st.activeView);
  if (green) st.greenRect = green;
}

function loadViewIntoState(st, data, viewKey) {
  st.activeView = String(viewKey || "front").toLowerCase();
  const md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  st.redRect = parseRect(md?.print_area_rect_json);
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  st.greenRect =
    getGreenRectFromSlice(slice, st.activeView) || parseRect(md?.mockup_print_area_rect_json) || { ...st.redRect };
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

function buildConfigForSave(st) {
  const cfg = ensureByDesignTypeConfig(JSON.parse(JSON.stringify(st.workingConfig)));
  const sourceDt = st.activeDesignType;
  const { slice: sourceSlice } = getDesignTypeSlice(cfg, sourceDt);

  applyGreenRectToSlice(sourceSlice, st.activeView, st.greenRect);
  sourceSlice.pattern = { ...st.patternConfig };
  sourceSlice.publish_logic = { ...st.publishLogicByPh };

  for (const dt of st.designTypesScope) {
    if (dt === sourceDt) continue;
    const { slice: target } = getDesignTypeSlice(cfg, dt);
    applyGreenRectToSlice(target, st.activeView, st.greenRect);
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
  const [printArea, mockups, variants] = await Promise.all([
    fetchPrintAreaBundle(ctx.productKey, pid, ctx.selectedVersionId),
    fetchMockupsBundle(ctx.productKey, pid).catch(() => ({ images: [] })),
    fetchVariantsBundle(ctx.productKey, pid).catch(() => ({})),
  ]);
  const data = mergeTabData(printArea, mockups, variants);
  ctx.printAreaData = data;

  const stateKey = `${pid}:${ctx.selectedVersionId}`;
  if (!ctx.printAreaState || ctx.printAreaState._key !== stateKey) {
    const st = createInitialPrintAreaState(ctx, data);
    st._key = stateKey;
    for (const vk of st.viewKeys) {
      st.mockUrlsByView[vk] = pickMockUrlForView(st.mockupImagesByView, vk, getActiveColorTitle(st));
    }
    persistStateToCtx(ctx, st);
  } else {
    ctx.printAreaState.mockupImagesByView = data.mockup_images_by_view;
  }

  return `
    <div class="ce-tab-panel ce-tab-panel--print-area">
      ${renderPrintAreaSidebar(ctx.printAreaState, data)}
    </div>`;
}

export function bindPrintAreaTab(ctx, root) {
  const st = ctx.printAreaState;
  const data = ctx.printAreaData;
  if (!st || !data) return;

  ctx.printAreaViewerHandle?.destroy?.();

  bindPrintAreaSidebar(root, st, data, {
    ctx,
    onChange: () => {
      persistStateToCtx(ctx, st);
      ctx.printAreaViewerHandle?.refreshPattern?.();
    },
    onDesignTypeChange: (dt) => {
      loadDesignTypeIntoState(st, dt);
      ctx.reloadTab();
    },
    onVariantGroupChange: () => {
      ctx.reloadTab();
    },
    onReload: () => ctx.reloadTab(),
  });

  ctx.printAreaViewerHandle = mountDualViewer(root, ctx, st, data, {
    onStateChange: () => persistStateToCtx(ctx, st),
    onViewChange: (viewKey) => {
      loadViewIntoState(st, data, viewKey);
      ctx.reloadTab();
    },
    onMockRefresh: () => refreshPrintifyMock(ctx),
  });
}

async function refreshPrintifyMock(ctx) {
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
    ctx.reloadTab();
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

  const config = buildConfigForSave(st);
  await savePrintAreasConfig({
    product_key: ctx.productKey,
    print_provider_id: ctx.selectedPrintProviderId,
    config,
    auto_mirror: false,
  });

  if (st.variantsScope.size && st.variantGroups.groups.length) {
    await saveVariantRectsForScope(ctx, st);
  }

  if (st.useMockups !== !!ctx.bundle?.product?.print_area_edit_use_mocks) {
    await saveMockups(ctx.productKey, {
      print_area_edit_use_mocks: st.useMockups,
      auto_mirror: false,
    });
  }

  st.greenDirty = false;
  st.workingConfig = config;
  persistStateToCtx(ctx, st);
}
