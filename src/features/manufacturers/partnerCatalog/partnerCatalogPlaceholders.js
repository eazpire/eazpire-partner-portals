/**
 * Map partner Product Editor print areas → Printify-shaped catalog placeholders.
 * Admin Catalog editor Provider tab reads variant.placeholders[].position (same path as Printify).
 */

/**
 * @param {any} raw
 * @returns {Record<string, number>}
 */
function normalizePartnerPlaceholderSlots(raw) {
  const empty = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...empty };
  const out = { ...empty };
  for (const key of Object.keys(empty)) {
    const n = Number(raw[key]);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.min(10, Math.round(n));
  }
  // Partner editors sometimes use short aliases
  if (raw.qr != null) out.qr = Number.isFinite(Number(raw.qr)) ? Math.min(10, Math.round(Number(raw.qr))) : out.qr;
  if (raw.logo != null) out.logo = Number.isFinite(Number(raw.logo)) ? Math.min(10, Math.round(Number(raw.logo))) : out.logo;
  return out;
}

/**
 * Pixel dims from print area row, else approximate from view physical size (mm → px @ 300dpi).
 * @param {any} area
 * @param {any} view
 */
function resolvePlaceholderDims(area, view) {
  let w = Number(area?.width_px);
  let h = Number(area?.height_px);
  if ((!Number.isFinite(w) || w <= 0) && view) {
    const pw = Number(view.print_width);
    const unit = String(view.print_unit || "mm").toLowerCase();
    if (Number.isFinite(pw) && pw > 0) {
      const inch = unit === "in" || unit === "inch" ? pw : pw / 25.4;
      w = Math.round(inch * 300);
    }
  }
  if ((!Number.isFinite(h) || h <= 0) && view) {
    const ph = Number(view.print_height);
    const unit = String(view.print_unit || "mm").toLowerCase();
    if (Number.isFinite(ph) && ph > 0) {
      const inch = unit === "in" || unit === "inch" ? ph : ph / 25.4;
      h = Math.round(inch * 300);
    }
  }
  return {
    width: Number.isFinite(w) && w > 0 ? Math.round(w) : undefined,
    height: Number.isFinite(h) && h > 0 ? Math.round(h) : undefined,
  };
}

/**
 * Build catalog-style placeholder list from manufacturer_print_areas (+ optional views).
 * @param {any[]} printAreas
 * @param {any[]} [views]
 * @returns {Array<{ position: string, width?: number, height?: number, decoration_method?: string }>}
 */
export function catalogPlaceholdersFromPartnerPrintAreas(printAreas, views = []) {
  const viewByKey = new Map();
  for (const v of views || []) {
    const k = String(v?.view_key || "")
      .trim()
      .toLowerCase();
    if (k) viewByKey.set(k, v);
  }

  const out = [];
  const seen = new Set();
  for (const area of Array.isArray(printAreas) ? printAreas : []) {
    const position = String(area?.view_key || area?.area_key || "")
      .trim()
      .toLowerCase();
    if (!position || seen.has(position)) continue;
    // Skip non-printable views when flagged
    const view = viewByKey.get(position);
    if (view && (view.printable === false || view.printable === 0)) continue;
    seen.add(position);
    const dims = resolvePlaceholderDims(area, view);
    const technique = String(view?.print_technique || area?.print_technique || "")
      .trim()
      .toLowerCase();
    const ph = {
      position,
      ...(dims.width != null ? { width: dims.width } : {}),
      ...(dims.height != null ? { height: dims.height } : {}),
      ...(technique ? { decoration_method: technique } : {}),
    };
    out.push(ph);
  }
  return out;
}

/**
 * placeholders_by_position for product_version_config (Admin Provider / Print Area tabs).
 * Defaults each view to one creator_design slot unless partner meta already sets slots.
 * @param {any[]} printAreas
 * @returns {Record<string, { qr: number, logo: number, creator_design: number, additional_design: number }>}
 */
export function placeholdersByPositionFromPartnerPrintAreas(printAreas) {
  /** @type {Record<string, { qr: number, logo: number, creator_design: number, additional_design: number }>} */
  const byPos = {};
  for (const area of Array.isArray(printAreas) ? printAreas : []) {
    const position = String(area?.view_key || area?.area_key || "")
      .trim()
      .toLowerCase();
    if (!position) continue;
    const slots = normalizePartnerPlaceholderSlots(area?.placeholders);
    const hasAny =
      slots.qr > 0 || slots.logo > 0 || slots.creator_design > 0 || slots.additional_design > 0;
    byPos[position] = hasAny ? slots : { qr: 0, logo: 0, creator_design: 1, additional_design: 0 };
  }
  return byPos;
}

/**
 * Attach the same placeholder list onto every catalog variant (Printify-shaped).
 * @param {any[]} variants
 * @param {any[]} placeholders
 */
export function attachPlaceholdersToCatalogVariants(variants, placeholders) {
  const list = Array.isArray(placeholders) ? placeholders : [];
  return (Array.isArray(variants) ? variants : []).map((v) => ({
    ...v,
    placeholders: list.map((ph) => ({ ...ph })),
  }));
}

/**
 * Build Todify/partner catalog variants for publish profile variants_json.
 * @param {{ variants: any[], printAreas: any[], views?: any[] }} opts
 */
export function buildTodifyCatalogVariantsFromPartner({ variants, printAreas, views = [] }) {
  const placeholders = catalogPlaceholdersFromPartnerPrintAreas(printAreas, views);
  const rows = Array.isArray(variants) ? variants : [];
  return rows.map((v, idx) => ({
    id: 900000 + idx,
    title: `${v.color || ""} / ${v.size || ""}`.replace(/^\s*\/\s*|\s*\/\s*$/g, "").trim() || `Variant ${idx + 1}`,
    options: { color: v.color, size: v.size },
    price: v.base_cost_cents,
    is_enabled: true,
    sku: v.sku,
    placeholders: placeholders.map((ph) => ({ ...ph })),
  }));
}

/**
 * True when at least one variant has a non-empty placeholders[].position.
 * @param {any[]} variants
 */
export function catalogVariantsHavePlaceholderPositions(variants) {
  for (const v of Array.isArray(variants) ? variants : []) {
    for (const ph of v?.placeholders || []) {
      if (String(ph?.position || "").trim()) return true;
    }
  }
  return false;
}
