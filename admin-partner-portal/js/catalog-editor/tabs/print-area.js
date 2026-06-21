import {
  fetchPrintAreaBundle,
  savePrintAreasConfig,
  saveMockups,
  loadPrintifySettings,
  fetchTemplateBundle,
  fetchPrintifyMockups,
} from "../api.js";
import {
  createInitialPrintAreaState,
  getDesignTypeSlice,
  getMockupDefaultForView,
  getGreenRectFromSlice,
  parseRect,
  normalizeDesignTypeKey,
  ensureByDesignTypeConfig,
} from "../print-area/helpers.js";
import { renderPrintAreaSidebar, bindPrintAreaSidebar } from "../print-area/settings-sidebar.js";
import { mountDualViewer, applyGreenRectToSlice } from "../print-area/dual-viewer.js";

function persistStateToCtx(ctx, st) {
  ctx.printAreaState = st;
  ctx.selectedDesignType = st.activeDesignType;
  ctx.printAreaActiveView = st.activeView;
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
  st.boundsLocked = true;
  st.boundsDirty = false;
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
    version?.external_template_product_id ||
    tpl?.printify_product_id ||
    null
  );
}

export async function loadPrintAreaTab(ctx) {
  const data = await fetchPrintAreaBundle(ctx.productKey, ctx.selectedPrintProviderId, ctx.selectedVersionId);
  ctx.printAreaData = data;

  if (!ctx.printAreaState || ctx.printAreaState._key !== `${ctx.selectedPrintProviderId}:${ctx.selectedVersionId}`) {
    const st = createInitialPrintAreaState(ctx, data);
    st._key = `${ctx.selectedPrintProviderId}:${ctx.selectedVersionId}`;
    persistStateToCtx(ctx, st);
  }

  return `
    <div class="ce-tab-panel ce-tab-panel--print-area">
      ${renderPrintAreaSidebar(ctx.printAreaState)}
    </div>`;
}

export function bindPrintAreaTab(ctx, root) {
  const st = ctx.printAreaState;
  const data = ctx.printAreaData;
  if (!st || !data) return;

  ctx.printAreaViewerHandle?.destroy?.();

  bindPrintAreaSidebar(root, st, {
    onChange: () => persistStateToCtx(ctx, st),
    onDesignTypeChange: (dt) => {
      loadDesignTypeIntoState(st, dt);
      ctx.reloadTab();
    },
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
    const view = st?.activeView || "front";
    const images = mockRes?.mockups || mockRes?.images || mockRes?.data || [];
    const match =
      images.find((m) => String(m.position || m.print_area_key || m.view || "").toLowerCase() === view) ||
      images[0];
    if (match?.src || match?.url || match?.image_url) {
      st.printifyMockUrl = match.src || match.url || match.image_url;
      st.mockPreviewStale = false;
    }
    const data = await fetchPrintAreaBundle(ctx.productKey, ctx.selectedPrintProviderId, ctx.selectedVersionId);
    ctx.printAreaData = data;
    ctx.reloadTab();
  } catch (err) {
    console.error("Printify mock refresh failed", err);
  }
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
