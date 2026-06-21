import { DESIGN_TYPES_ALL, PH_TYPES } from "../provider-print-technical.js";
import { buildVariantGroupList } from "../utils/variant-matrix.js";

export { DESIGN_TYPES_ALL, PH_TYPES };

const PA_SIDEBAR_KEY = "admin_catalog_editor_pa_sidebar_collapsed";

export function isPaSidebarCollapsed() {
  return sessionStorage.getItem(PA_SIDEBAR_KEY) === "1";
}

export function setPaSidebarCollapsed(v) {
  sessionStorage.setItem(PA_SIDEBAR_KEY, v ? "1" : "0");
}

export function parseJsonSafe(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function productKeyExpectsPerVariantDimensions(productKey) {
  const k = String(productKey || "").toLowerCase();
  return (
    k.includes("poster") ||
    k.includes("photopaper") ||
    k.includes("photo-paper") ||
    k.includes("canvas") ||
    k.includes("metal-print") ||
    k.includes("acrylic") ||
    k.includes("wall-art") ||
    k.includes("foam") ||
    k.includes("panel") ||
    k.includes("wood-print") ||
    k.includes("dibond") ||
    k.includes("blanket")
  );
}

export function defaultPatternConfig() {
  return { enabled: false, style: "grid", spacingH: 0, spacingV: 0, angle: 0, offsetH: 0, rotH: 0, rotV: 0 };
}

export function defaultPublishLogicByPh() {
  return { qr: "calculated", logo: "calculated", creator_design: "calculated", additional_design: "calculated" };
}

export function normalizeDesignTypeKey(dt) {
  return String(dt || "classic")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function visibleDesignTypes(ctx) {
  const fromProduct = ctx.bundle?.product?.visible_design_types;
  if (Array.isArray(fromProduct) && fromProduct.length) {
    return fromProduct.map(normalizeDesignTypeKey).filter((d) => DESIGN_TYPES_ALL.includes(d));
  }
  return ["classic", "pattern"];
}

export function getPublishProfileConfig(ctx) {
  const pid = Number(ctx.selectedPrintProviderId);
  const row = (ctx.bundle?.publish_profiles || []).find((p) => Number(p.print_provider_id) === pid);
  return parseJsonSafe(row?.print_areas_config_json, {}) || {};
}

export function ensureByDesignTypeConfig(raw) {
  const base = raw && typeof raw === "object" ? { ...raw } : {};
  if (base.by_design_type && typeof base.by_design_type === "object") return base;
  if (base.mockup || base.edit_mode) {
    return { ...base, by_design_type: { classic: { mockup: base.mockup || {}, edit_mode: base.edit_mode || {}, pattern: base.pattern || defaultPatternConfig() } } };
  }
  return { ...base, by_design_type: {} };
}

export function getDesignTypeSlice(config, designType) {
  const cfg = ensureByDesignTypeConfig(config);
  const key = normalizeDesignTypeKey(designType);
  if (!cfg.by_design_type[key]) {
    cfg.by_design_type[key] = { mockup: {}, edit_mode: {}, pattern: defaultPatternConfig() };
  }
  const slice = cfg.by_design_type[key];
  if (!slice.pattern) slice.pattern = defaultPatternConfig();
  return { full: cfg, slice, key };
}

export function listViewKeys(mockupDefaults, configSlice) {
  const keys = new Set();
  for (const row of mockupDefaults || []) {
    const k = String(row.print_area_key || "").trim().toLowerCase();
    if (k) keys.add(k);
  }
  for (const slot of ["mockup", "edit_mode"]) {
    const sec = configSlice?.[slot];
    if (sec && typeof sec === "object") {
      Object.keys(sec).forEach((k) => keys.add(String(k).toLowerCase()));
    }
  }
  if (!keys.size) keys.add("front");
  return [...keys].sort();
}

export function getMockupDefaultForView(mockupDefaults, viewKey) {
  const vk = String(viewKey || "front").toLowerCase();
  return (mockupDefaults || []).find((r) => String(r.print_area_key || "").toLowerCase() === vk) || mockupDefaults?.[0] || null;
}

export function mockupPublicBase() {
  const fromWindow =
    typeof window !== "undefined"
      ? window.__MOCKUP_PUBLIC_BASE__ || window.CREATOR_API_CONFIG?.BASE_URL
      : "";
  return String(fromWindow || "https://creator-engine.eazpire.workers.dev").replace(/\/$/, "");
}

function mockupUrlFromR2Key(key) {
  if (!key) return "";
  return `${mockupPublicBase()}/mockup/${encodeURIComponent(key)}`;
}

/** Print-area template image (edit mode) — same source as old admin: print_area_template_r2_key first. */
export function printAreaTemplateImageUrl(row) {
  if (!row) return "";
  if (row.print_area_template_url) return row.print_area_template_url;
  const key = row.print_area_template_r2_key || row.template_r2_key;
  return mockupUrlFromR2Key(key);
}

/** Color mockup / template_r2_key (mock preview). */
export function mockupImageUrl(row) {
  if (!row) return "";
  if (row.template_url) return row.template_url;
  if (row.image_url) return row.image_url;
  return mockupUrlFromR2Key(row.template_r2_key);
}

export function buildMockupImagesByView(images) {
  const byView = {};
  for (const img of images || []) {
    const vk = String(img.view_key || "front")
      .trim()
      .toLowerCase();
    const color = String(img.color_name || "Default").trim() || "Default";
    if (!byView[vk]) byView[vk] = {};
    let variantIds = img.printify_variant_ids;
    if (typeof variantIds === "string") {
      try {
        variantIds = JSON.parse(variantIds);
      } catch {
        variantIds = [];
      }
    }
    byView[vk][color] = {
      image_url: img.image_url || "",
      color_hex: img.color_hex || null,
      is_default: Number(img.is_default) === 1,
      printify_variant_ids: Array.isArray(variantIds) ? variantIds : [],
    };
  }
  return byView;
}

export function pickMockUrlForView(byView, viewKey, colorHint = null) {
  const vk = String(viewKey || "front").toLowerCase();
  const viewMap = byView?.[vk];
  if (!viewMap || typeof viewMap !== "object") return "";
  if (colorHint && viewMap[colorHint]?.image_url) return viewMap[colorHint].image_url;
  for (const name of Object.keys(viewMap)) {
    if (viewMap[name]?.is_default && viewMap[name]?.image_url) return viewMap[name].image_url;
  }
  for (const name of Object.keys(viewMap)) {
    if (viewMap[name]?.image_url) return viewMap[name].image_url;
  }
  return "";
}

export function findVariantPrintAreaRow(vpas, viewKey, variantId) {
  const vk = String(viewKey || "front").toLowerCase();
  return (vpas || []).find(
    (r) => String(r.print_area_key || "").toLowerCase() === vk && Number(r.variant_id) === Number(variantId)
  );
}

export function loadRectsForVariantGroup(st, data, groupId) {
  const group = st.variantGroups.groups.find((g) => g.id === groupId);
  if (!group?.variantIds?.length) return;
  const vid = group.variantIds[0];
  const vpa = findVariantPrintAreaRow(data.variant_print_areas, st.activeView, vid);
  const md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);

  if (vpa?.print_area_rect_json) {
    st.redRect = normalizeRectToPrintAspect(vpa.print_area_rect_json, md);
  }
  if (vpa?.mockup_print_area_rect_json) {
    st.greenRect = normalizeRectToPrintAspect(vpa.mockup_print_area_rect_json, md);
    st.greenDirty = true;
  } else if (!hasSavedGreenRect(slice, st.activeView)) {
    st.greenRect = { ...st.redRect };
    st.greenDirty = false;
  }
}

export function parseRect(raw) {
  const r = parseJsonSafe(raw, null);
  if (r && typeof r === "object" && Number.isFinite(Number(r.w)) && Number.isFinite(Number(r.h))) {
    return {
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      w: Number(r.w) || 0.4,
      h: Number(r.h) || 0.4,
      angle: Number(r.angle) || 0,
    };
  }
  return { x: 0.2, y: 0.2, w: 0.45, h: 0.45, angle: 0 };
}

export function aspectRatioFromDefault(row) {
  const w = Number(row?.printify_print_area_width);
  const h = Number(row?.printify_print_area_height);
  if (w > 0 && h > 0) return w / h;
  return null;
}

export function clampRectToStage(rect) {
  const r = { ...rect };
  r.w = Math.max(0.02, Math.min(1, r.w));
  r.h = Math.max(0.02, Math.min(1, r.h));
  r.x = Math.max(0, Math.min(1 - r.w, r.x));
  r.y = Math.max(0, Math.min(1 - r.h, r.y));
  return r;
}

export function fitRectWithAspect(baseRect, aspect) {
  if (!(aspect > 0)) return clampRectToStage(baseRect);
  const cx = baseRect.x + baseRect.w / 2;
  const cy = baseRect.y + baseRect.h / 2;
  let w = baseRect.w;
  let h = baseRect.h;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  let x = cx - w / 2;
  let y = cy - h / 2;
  return clampRectToStage({ ...baseRect, x, y, w, h });
}

/** Centered rect at `scale` fraction of stage (default 50%), preserving Printify aspect ratio. */
export function defaultCenteredRect(aspect, scale = 0.5) {
  const s = Math.max(0.02, Math.min(1, scale));
  if (!(aspect > 0)) {
    return clampRectToStage({ x: (1 - s) / 2, y: (1 - s) / 2, w: s, h: s, angle: 0 });
  }
  let w;
  let h;
  if (aspect >= 1) {
    w = s;
    h = s / aspect;
  } else {
    h = s;
    w = s * aspect;
  }
  return clampRectToStage({ x: (1 - w) / 2, y: (1 - h) / 2, w, h, angle: 0 });
}

export function hasDbPrintAreaRect(md) {
  const raw = md?.print_area_rect_json;
  if (raw == null || raw === "") return false;
  const r = parseJsonSafe(raw, null);
  return !!(r && Number.isFinite(Number(r.w)) && Number(r.w) > 0);
}

export function hasDbMockupPrintAreaRect(md) {
  const raw = md?.mockup_print_area_rect_json;
  if (raw == null || raw === "") return false;
  const r = parseJsonSafe(raw, null);
  return !!(r && Number.isFinite(Number(r.w)) && Number(r.w) > 0);
}

export function rectFromConfigArea(area) {
  if (!area) return null;
  const rect = area.rect || area;
  if (rect && Number.isFinite(Number(rect.w))) return parseRect(rect);
  if (Number.isFinite(Number(area.x))) {
    return parseRect({ x: area.x, y: area.y, w: area.w || area.width, h: area.h || area.height, angle: area.angle });
  }
  return null;
}

export function getGreenRectFromSlice(slice, viewKey) {
  const vk = String(viewKey || "front").toLowerCase();
  for (const slot of ["edit_mode", "mockup"]) {
    const block = slice?.[slot]?.[vk];
    const areas = block?.areas;
    if (Array.isArray(areas)) {
      const cd = areas.find((a) => String(a.type || a.placeholder_type || "").includes("creator") || a.type === "design");
      const r = rectFromConfigArea(cd);
      if (r) return r;
      if (areas[0]) {
        const r0 = rectFromConfigArea(areas[0]);
        if (r0) return r0;
      }
    }
  }
  return null;
}

export function rectsNearlyEqual(a, b, eps = 0.003) {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.w - b.w) < eps &&
    Math.abs(a.h - b.h) < eps
  );
}

export function hasSavedGreenRect(slice, viewKey) {
  const vk = String(viewKey || "front").toLowerCase();
  const block = slice?.edit_mode?.[vk];
  if (!block?.areas?.length) return false;
  return block.areas.some((a) => {
    const r = rectFromConfigArea(a);
    return r && r.w > 0;
  });
}

export function normalizeRectToPrintAspect(rect, md) {
  const parsed = parseRect(rect);
  const aspect = aspectRatioFromDefault(md);
  if (!(aspect > 0)) return clampRectToStage(parsed);
  return fitRectWithAspect(parsed, aspect);
}

function resolveRedRectForView(data, viewKey, md) {
  const aspect = aspectRatioFromDefault(md);
  if (hasDbPrintAreaRect(md)) {
    return normalizeRectToPrintAspect(md.print_area_rect_json, md);
  }
  return defaultCenteredRect(aspect, 0.5);
}

/** Red = print bounds; green overlaps red unless explicitly saved in DB/config. */
export function resolveRectsForView(data, slice, viewKey) {
  const md = getMockupDefaultForView(data.mockup_defaults, viewKey);
  const red = resolveRedRectForView(data, viewKey, md);

  if (hasSavedGreenRect(slice, viewKey)) {
    const green = normalizeRectToPrintAspect(getGreenRectFromSlice(slice, viewKey), md);
    return { red, green, greenDirty: true, md };
  }

  if (hasDbMockupPrintAreaRect(md)) {
    const mockGreen = normalizeRectToPrintAspect(md.mockup_print_area_rect_json, md);
    if (!rectsNearlyEqual(mockGreen, red)) {
      return { red, green: mockGreen, greenDirty: true, md };
    }
  }

  return { red, green: { ...red }, greenDirty: false, md };
}

export function buildVariantProduct(data, ctx) {
  const variants = Array.isArray(data?.variants_json)
    ? data.variants_json
    : Array.isArray(data?.variants)
      ? data.variants
      : [];
  const options =
    data?.product_data?.options ||
    data?.product_data_json?.options ||
    ctx?.variantsBundle?.product_data?.options ||
    [];
  return { variants, options, product_key: ctx?.productKey || data?.product_key };
}

export function groupVariantsForPrintArea(product) {
  if (!product?.variants?.length) {
    return { mode: "all", groups: [] };
  }
  return buildVariantGroupList(product);
}

export function createInitialPrintAreaState(ctx, data) {
  const designTypes = visibleDesignTypes(ctx);
  const rawConfig = getPublishProfileConfig(ctx);
  const { full, slice } = getDesignTypeSlice(rawConfig, ctx.selectedDesignType || designTypes[0]);
  const viewKeys = listViewKeys(data.mockup_defaults, slice);
  const activeView = viewKeys.includes(ctx.printAreaActiveView) ? ctx.printAreaActiveView : viewKeys[0];
  const { red, green, greenDirty } = resolveRectsForView(data, slice, activeView);

  const variantGroups = groupVariantsForPrintArea(buildVariantProduct(data, ctx));
  const mockupImagesByView = data.mockup_images_by_view || buildMockupImagesByView(data.mockup_images || []);
  const activeVariantGroupId = variantGroups.groups[0]?.id || null;

  const st = {
    designTypes,
    activeDesignType: normalizeDesignTypeKey(ctx.selectedDesignType || designTypes[0]),
    designTypesScope: new Set(designTypes),
    viewKeys,
    activeView,
    boundsLocked: true,
    boundsDirty: false,
    greenDirty,
    useMockups: !!ctx.bundle?.product?.print_area_edit_use_mocks,
    redRect: red,
    greenRect: green,
    activeLayer: "green",
    workingConfig: full,
    patternConfig: { ...(slice.pattern || defaultPatternConfig()) },
    publishLogicByPh: parseJsonSafe(slice.publish_logic, null) || defaultPublishLogicByPh(),
    variantGroups,
    variantsScope: new Set(variantGroups.groups.map((g) => g.id)),
    variantGroupMode: variantGroups.mode,
    activeVariantGroupId,
    mockupImagesByView,
    mockUrlsByView: {},
    mockPreviewStale: false,
    perVariantProduct: productKeyExpectsPerVariantDimensions(ctx.productKey),
  };

  if (st.perVariantProduct && activeVariantGroupId) {
    loadRectsForVariantGroup(st, data, activeVariantGroupId);
  }

  return st;
}
