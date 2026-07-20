import {
  DESIGN_TYPES_ALL,
  PH_TYPES,
  normalizePatPositionKey,
  unionPatPlaceholderPositions,
} from "../provider-print-technical.js";
import { getPlaceholderSlotsForView, getVersionPlaceholderConfig } from "../version-config-panel.js";
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

/** Version slug for eaz_admin.by_version (matches publish slugifyPrintAreaTemplateVersionKey). */
export function printAreaVersionSlug(version) {
  const t = String(version?.display_name || version?.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return t || "standard";
}

/**
 * Numeric print_area_printify_templates.id for API calls (test products, publish).
 * Editor version ids may be `pat-123`, legacy eaz version ids, or numeric PAT ids.
 */
export function resolvePrintAreaTemplateId(ctx, data = null) {
  const version = resolvePrintAreaVersion(ctx, data);
  const fromPat = Number(version?.catalog_pat_id);
  if (Number.isFinite(fromPat) && fromPat > 0) return fromPat;

  const raw = String(ctx?.selectedVersionId || "").trim();
  const patMatch = raw.match(/^pat-(\d+)$/i);
  if (patMatch) return Number(patMatch[1]);

  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return 0;
}

function parsePublishLogicObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = defaultPublishLogicByPh();
  let any = false;
  for (const key of Object.keys(out)) {
    const v = String(raw[key] || "").toLowerCase();
    if (v === "calculated" || v === "template" || v === "admin") {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : null;
}

/** Read per-placeholder publish_logic (eaz_admin.by_version first, then legacy by_design_type). */
export function readPublishLogicFromConfig(config, designType, versionSlug) {
  const key = normalizeDesignTypeKey(designType);
  const ver = String(versionSlug || "standard").trim() || "standard";
  const ea = config?.eaz_admin;
  const bv = ea?.by_version?.[ver] || (ver !== "standard" ? ea?.by_version?.standard : null);
  const fromEa = parsePublishLogicObject(bv?.by_design_type?.[key]?.publish_logic);
  if (fromEa) return fromEa;
  const fromClassic = parsePublishLogicObject(bv?.by_design_type?.classic?.publish_logic);
  if (fromClassic && key !== "classic") return fromClassic;
  const { slice } = getDesignTypeSlice(config || {}, designType);
  return parsePublishLogicObject(slice.publish_logic) || defaultPublishLogicByPh();
}

/** Persist publish_logic to eaz_admin.by_version + legacy by_design_type slice. */
export function writePublishLogicToConfig(config, designType, versionSlug, publishLogicByPh) {
  const cfg = ensureByDesignTypeConfig(config && typeof config === "object" ? { ...config } : {});
  const key = normalizeDesignTypeKey(designType);
  const ver = String(versionSlug || "standard").trim() || "standard";
  const logic = { ...defaultPublishLogicByPh(), ...(publishLogicByPh || {}) };
  if (!cfg.eaz_admin || typeof cfg.eaz_admin !== "object") cfg.eaz_admin = {};
  if (!cfg.eaz_admin.by_version || typeof cfg.eaz_admin.by_version !== "object") {
    cfg.eaz_admin.by_version = {};
  }
  if (!cfg.eaz_admin.by_version[ver] || typeof cfg.eaz_admin.by_version[ver] !== "object") {
    cfg.eaz_admin.by_version[ver] = {};
  }
  const verSlice = cfg.eaz_admin.by_version[ver];
  if (!verSlice.by_design_type || typeof verSlice.by_design_type !== "object") {
    verSlice.by_design_type = {};
  }
  if (!verSlice.by_design_type[key] || typeof verSlice.by_design_type[key] !== "object") {
    verSlice.by_design_type[key] = {};
  }
  verSlice.by_design_type[key].publish_logic = { ...logic };
  cfg.by_design_type[key].publish_logic = { ...logic };
  return cfg;
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

/** Catalog variants for print-area — live provider catalog matches Provider tab; fallback to saved variants_json. */
export function resolvePrintAreaCatalogVariants(ctx, data) {
  const fromLive = data?.catalog_variants;
  if (Array.isArray(fromLive) && fromLive.length) return fromLive;

  const pid = ctx?.selectedPrintProviderId;
  const cached = ctx?.providersTabState?.catalogCache?.get(String(pid));
  if (Array.isArray(cached?.variants) && cached.variants.length) return cached.variants;

  const saved = data?.variants_json || data?.variants;
  return Array.isArray(saved) ? saved : [];
}

export function printAreaCatalogDetail(ctx, data) {
  return { variants: resolvePrintAreaCatalogVariants(ctx, data) };
}

/** Active provider version row for print-area (bundle fallback when tab payload omits versions). */
export function resolvePrintAreaVersion(ctx, data) {
  const fromData =
    (data?.versions || []).find((v) => String(v.id) === String(ctx?.selectedVersionId)) || data?.version || null;
  if (fromData) return fromData;
  return (ctx?.bundle?.versions || []).find((v) => String(v.id) === String(ctx?.selectedVersionId)) || null;
}

function mockupDefaultViewKeys(mockupDefaults) {
  const keys = [];
  for (const row of mockupDefaults || []) {
    const k = String(row.print_area_key || "").trim().toLowerCase();
    if (k) keys.push(k);
  }
  return [...new Set(keys)].sort();
}

function viewKeysFromPositions(positions) {
  const seen = new Map();
  for (const ph of positions || []) {
    const pos = String(ph?.position ?? "")
      .trim()
      .toLowerCase();
    if (!pos) continue;
    const norm = normalizePatPositionKey(pos);
    if (!norm || seen.has(norm)) continue;
    seen.set(norm, pos);
  }
  return [...seen.values()].sort();
}

/** Views for the active provider version — same position keys as Provider tab print area positions. */
export function listViewKeys(mockupDefaults, _configSlice, version = null, catalogDetail = null) {
  const variants = catalogDetail?.variants || catalogDetail?.variants_json || [];
  const variantList = Array.isArray(variants) ? variants : [];
  const byPos = getVersionPlaceholderConfig(version, catalogDetail);
  const positions = unionPatPlaceholderPositions(variantList, byPos);
  const versionKeys = viewKeysFromPositions(positions);

  if (versionKeys.length) return versionKeys;

  const mockupKeys = mockupDefaultViewKeys(mockupDefaults);
  if (mockupKeys.length) return mockupKeys;
  return ["front"];
}

export function defaultProductBrandAssets() {
  return { qr: {}, logo: {} };
}

export function normalizeBrandAssetsMode(mode) {
  return String(mode || "global").trim().toLowerCase() === "specific" ? "specific" : "global";
}

export function readBrandAssetsFromConfig(config) {
  const cfg = config && typeof config === "object" ? config : {};
  return {
    mode: normalizeBrandAssetsMode(cfg.brand_assets_mode),
    assets: cfg.brand_assets && typeof cfg.brand_assets === "object" ? cfg.brand_assets : defaultProductBrandAssets(),
  };
}

export function resolveEffectiveBrandAssets(st, globalAssets) {
  if (normalizeBrandAssetsMode(st?.brandAssetsMode) === "specific") {
    return st?.brandAssets || defaultProductBrandAssets();
  }
  return globalAssets || defaultProductBrandAssets();
}

/** Sum QR/logo placeholder slots across product views (for brand assets sidebar visibility). */
export function aggregateBrandAssetSlots(version, catalogDetail, viewKeys) {
  let qrSlots = 0;
  let logoSlots = 0;
  for (const vk of viewKeys || []) {
    const slots = getPlaceholderSlotsForView(version, catalogDetail, vk);
    qrSlots += Math.max(0, Number(slots.qr) || 0);
    logoSlots += Math.max(0, Number(slots.logo) || 0);
  }
  return {
    qrSlots,
    logoSlots,
    showQr: qrSlots > 0,
    showLogo: logoSlots > 0,
    showSection: qrSlots > 0 || logoSlots > 0,
  };
}

function printAreaKeyCandidates(viewKey) {
  const vk = String(viewKey || "front").trim().toLowerCase();
  const norm = normalizePatPositionKey(vk);
  return [...new Set([vk, vk.replace(/-/g, "_"), vk.replace(/_/g, "-"), norm])];
}

export function getMockupDefaultForView(mockupDefaults, viewKey) {
  const rows = mockupDefaults || [];
  for (const candidate of printAreaKeyCandidates(viewKey)) {
    const row = rows.find((r) => String(r.print_area_key || "").toLowerCase() === candidate);
    if (row) return row;
  }
  const norm = normalizePatPositionKey(viewKey);
  return rows.find((r) => normalizePatPositionKey(r.print_area_key) === norm) || null;
}

/** DB print_area_key for API writes (upload/clear/save). */
export function canonicalPrintAreaKey(mockupDefaults, viewKey) {
  const row = getMockupDefaultForView(mockupDefaults, viewKey);
  if (row?.print_area_key) return String(row.print_area_key).trim().toLowerCase();
  return normalizePatPositionKey(viewKey) || String(viewKey || "front").trim().toLowerCase();
}

export function mergePrintDimensionsForView(data, viewKey) {
  const md = getMockupDefaultForView(data?.mockup_defaults, viewKey);
  let w = Number(md?.printify_print_area_width);
  let h = Number(md?.printify_print_area_height);
  if (!(w > 0 && h > 0)) {
    const norm = normalizePatPositionKey(viewKey);
    for (const row of data?.variant_print_areas || []) {
      if (normalizePatPositionKey(row?.print_area_key) !== norm) continue;
      const rw = Number(row.printify_print_area_width);
      const rh = Number(row.printify_print_area_height);
      if (rw > 0 && rh > 0) {
        w = rw;
        h = rh;
        break;
      }
    }
  }
  return { w, h, md };
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

/** Print-area template image (edit mode) — only explicit print-area fields; never template_r2_key (Printify mock). */
export function printAreaTemplateImageUrl(row) {
  if (!row) return "";
  if (row.print_area_template_url) return row.print_area_template_url;
  return mockupUrlFromR2Key(row.print_area_template_r2_key);
}

/** Color mockup / template_r2_key (mock preview). */
export function mockupImageUrl(row) {
  if (!row) return "";
  if (row.template_url) return row.template_url;
  if (row.image_url) return row.image_url;
  return mockupUrlFromR2Key(row.template_r2_key);
}

/** Collapse Printify camera aliases so print-area mock carousels aren't duplicated. */
export function canonicalizeMockupViewKey(value) {
  const v = String(value || "front")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!v) return "front";
  if (/(^|_)back($|_)/.test(v)) return "back";
  if (/(^|_)neck($|_)/.test(v) || v.includes("collar")) return "neck";
  if (v.includes("left") && v.includes("sleeve")) return "left_sleeve";
  if (v.includes("right") && v.includes("sleeve")) return "right_sleeve";
  if (/(^|_)front($|_)/.test(v)) return "front";
  return v;
}

export function buildMockupImagesByView(images) {
  const byView = {};
  for (const img of images || []) {
    const vk = canonicalizeMockupViewKey(img.view_key || "front");
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
    const existing = byView[vk][color];
    if (existing && !Number(img.is_default)) continue;
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
  const norm = normalizePatPositionKey(viewKey);
  return (vpas || []).find(
    (r) => normalizePatPositionKey(r?.print_area_key) === norm && Number(r.variant_id) === Number(variantId)
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
    st.redRect = rectFromSavedSource(vpa.print_area_rect_json);
  }
  if (vpa?.mockup_print_area_rect_json) {
    st.greenRect = clampRectToStage(parseRect(vpa.mockup_print_area_rect_json));
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

/** Print width ÷ height (Provider tab: Width × Height in px). */
export function aspectRatioFromDefault(row, data = null, viewKey = null) {
  if (data && viewKey) {
    const merged = mergePrintDimensionsForView(data, viewKey);
    if (merged.w > 0 && merged.h > 0) return merged.w / merged.h;
  }
  const w = Number(row?.printify_print_area_width);
  const h = Number(row?.printify_print_area_height);
  if (w > 0 && h > 0) return w / h;
  return null;
}

/** Normalized w/h so pixel ratio on stage-inner matches print aspect. */
export function normalizedDisplayAspect(printAspect, stageW, stageH) {
  if (!(printAspect > 0) || !(stageW > 0) || !(stageH > 0)) return printAspect;
  return printAspect * (stageH / stageW);
}

export function clampRectToStage(rect) {
  const r = { ...rect };
  r.w = Math.max(0.02, Math.min(1, r.w));
  r.h = Math.max(0.02, Math.min(1, r.h));
  r.x = Math.max(0, Math.min(1 - r.w, r.x));
  r.y = Math.max(0, Math.min(1 - r.h, r.y));
  return r;
}

export function fitRectWithAspect(baseRect, aspect, stageBox = null) {
  if (!(aspect > 0)) return clampRectToStage(baseRect);
  const displayAspect = normalizedDisplayAspect(aspect, stageBox?.w, stageBox?.h) ?? aspect;
  const cx = baseRect.x + baseRect.w / 2;
  const cy = baseRect.y + baseRect.h / 2;
  let w = baseRect.w;
  let h = baseRect.h;
  if (w / h > displayAspect) w = h * displayAspect;
  else h = w / displayAspect;
  let x = cx - w / 2;
  let y = cy - h / 2;
  return clampRectToStage({ ...baseRect, x, y, w, h });
}

/** Centered rect at `scale` fraction of stage (default 50%), preserving Printify aspect ratio. */
export function defaultCenteredRect(aspect, scale = 0.5, stageBox = null) {
  const s = Math.max(0.02, Math.min(1, scale));
  if (!(aspect > 0)) {
    return clampRectToStage({ x: (1 - s) / 2, y: (1 - s) / 2, w: s, h: s, angle: 0 });
  }
  const displayAspect = normalizedDisplayAspect(aspect, stageBox?.w, stageBox?.h) ?? aspect;
  let w;
  let h;
  if (displayAspect >= 1) {
    w = s;
    h = s / displayAspect;
  } else {
    h = s;
    w = s * displayAspect;
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

export function normalizeRectToPrintAspect(rect, md, data = null, viewKey = null, stageBox = null) {
  const parsed = parseRect(rect);
  const aspect = aspectRatioFromDefault(md, data, viewKey);
  if (!(aspect > 0)) return clampRectToStage(parsed);
  return fitRectWithAspect(parsed, aspect, stageBox);
}

/** Saved rects keep exact x,y,w,h — aspect lock is for interactive resize only. */
export function rectFromSavedSource(raw) {
  return clampRectToStage(parseRect(raw));
}

function resolveRedRectForView(data, viewKey, md) {
  const aspect = aspectRatioFromDefault(md, data, viewKey);
  if (hasDbPrintAreaRect(md)) {
    return rectFromSavedSource(md.print_area_rect_json);
  }
  return defaultCenteredRect(aspect, 0.5);
}

/** Red = print bounds; green overlaps red unless explicitly saved in DB/config. */
export function resolveRectsForView(data, slice, viewKey) {
  const md = getMockupDefaultForView(data.mockup_defaults, viewKey);
  const red = resolveRedRectForView(data, viewKey, md);

  if (hasSavedGreenRect(slice, viewKey)) {
    const green = clampRectToStage(parseRect(getGreenRectFromSlice(slice, viewKey)));
    return { red, green, greenDirty: true, md };
  }

  if (hasDbMockupPrintAreaRect(md)) {
    const mockGreen = clampRectToStage(parseRect(md.mockup_print_area_rect_json));
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

/** Print area image mode: mockup carousels vs upload grids (product_catalog.print_area_edit_use_mocks). */
export function resolvePrintAreaUseMockups(ctx, data) {
  const fromMockups = data?.product?.print_area_edit_use_mocks;
  if (fromMockups !== undefined && fromMockups !== null && fromMockups !== "") {
    return fromMockups === true || fromMockups === 1 || fromMockups === "1";
  }
  const fromBundle = ctx.bundle?.product?.print_area_edit_use_mocks;
  return fromBundle === true || fromBundle === 1 || fromBundle === "1";
}

const PARTNER_SOURCE_SYSTEMS = new Set(["todify", "direct_shopify"]);

function collectSourceSystemCandidates(ctx, data) {
  const out = [];
  const push = (v) => {
    const s = String(v || "")
      .trim()
      .toLowerCase();
    if (s) out.push(s);
  };
  push(ctx?.bundle?.product?.source_system);
  push(data?.product?.source_system);
  push(data?.source_system);

  const profiles = ctx?.bundle?.publish_profiles;
  if (Array.isArray(profiles)) {
    for (const p of profiles) push(p?.source_system);
  } else if (profiles && typeof profiles.values === "function") {
    for (const p of profiles.values()) push(p?.source_system);
  } else if (profiles && typeof profiles === "object") {
    for (const p of Object.values(profiles)) {
      if (p && typeof p === "object" && !Array.isArray(p)) push(p.source_system);
    }
  }
  return out;
}

/**
 * True for Todify / manufacturer partner catalog products (no Printify dual-viewer branding).
 * Printify catalog items stay on the classic “Printify Mock” right panel.
 */
export function isPartnerOrTodifyProduct(ctx, data = null) {
  if (collectSourceSystemCandidates(ctx, data).some((s) => PARTNER_SOURCE_SYSTEMS.has(s))) return true;
  if (data?._partner_print_areas || data?._partner_mockups) return true;
  if (String(ctx?.bundle?.markets_mode || "").toLowerCase() === "partner") return true;

  const mfg = String(
    ctx?.bundle?.product?.manufacturer_id || ctx?.partnerReview?.product?.manufacturer_id || ""
  ).toLowerCase();
  if (mfg === "mfg_todify" || mfg.includes("todify")) return true;

  const imgs = data?.mockup_images || [];
  if (imgs.some((i) => String(i?._source || "").toLowerCase().includes("partner"))) return true;

  return false;
}

export function createInitialPrintAreaState(ctx, data) {
  const designTypes = visibleDesignTypes(ctx);
  const rawConfig = getPublishProfileConfig(ctx);
  const { full, slice } = getDesignTypeSlice(rawConfig, ctx.selectedDesignType || designTypes[0]);
  const version = resolvePrintAreaVersion(ctx, data);
  const catalogDetail = printAreaCatalogDetail(ctx, data);
  const viewKeys = listViewKeys(data.mockup_defaults, slice, version, catalogDetail);
  const activeView = viewKeys.includes(ctx.printAreaActiveView) ? ctx.printAreaActiveView : viewKeys[0];
  const brandFromConfig = readBrandAssetsFromConfig(rawConfig);
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
    useMockups: resolvePrintAreaUseMockups(ctx, data),
    redRect: red,
    greenRect: green,
    activeLayer: "green",
    workingConfig: full,
    patternConfig: { ...(slice.pattern || defaultPatternConfig()) },
    publishLogicByPh: readPublishLogicFromConfig(
      rawConfig,
      ctx.selectedDesignType || designTypes[0],
      printAreaVersionSlug(version)
    ),
    variantGroups,
    variantsScope: new Set(variantGroups.groups.map((g) => g.id)),
    variantGroupMode: variantGroups.mode,
    activeVariantGroupId,
    mockupImagesByView,
    mockUrlsByView: {},
    sessionMockUrlsByView: {},
    useSessionTestProductMock: false,
    mockPreviewStale: false,
    perVariantProduct: productKeyExpectsPerVariantDimensions(ctx.productKey),
    brandAssetsMode: brandFromConfig.mode,
    brandAssets: JSON.parse(JSON.stringify(brandFromConfig.assets)),
    versionSlug: printAreaVersionSlug(version),
  };

  if (st.perVariantProduct && activeVariantGroupId) {
    loadRectsForVariantGroup(st, data, activeVariantGroupId);
  }

  return st;
}
