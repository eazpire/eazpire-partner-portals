/**
 * Map Partner Portal Product Editor data → Admin Catalog Editor bundle shapes
 * (Mockups / Variants / Print Area), when catalog-db shadow is empty or incomplete.
 */

import { listVariants, listPrintAreas, getProduct } from "../catalogService.js";
import {
  findManufacturerProductByCatalogKey,
  listMockupSlots,
  listViews,
  publicFileUrl,
} from "../partnerProductEditorService.js";
import {
  MOCKUP_SET_CLEAN,
  MOCKUP_SET_SHOP_PREVIEW,
  MOCKUP_SET_CALIBRATION,
  MOCKUP_SET_PREVIEW_IMAGES,
  normalizeMockupSet,
  filterImagesByMockupSet,
} from "./mockupSet.js";
import {
  buildTodifyCatalogVariantsFromPartner,
  catalogPlaceholdersFromPartnerPrintAreas,
} from "./partnerCatalogPlaceholders.js";

const PARTNER_SOURCE_SYSTEMS = new Set(["todify", "direct_shopify"]);

/** Auto-seeded Printify PAT label — not the partner Details title. */
export function isPlaceholderVersionDisplayName(name) {
  const s = String(name || "").trim();
  return !s || /^standard$/i.test(s);
}

/**
 * Prefer partner Details title (meta.display_name), then catalog/profile titles that are not "Standard".
 * @param {{ title?: string|null, productTitle?: string|null, profileTitle?: string|null, eazVersionTitles?: string[] }} opts
 */
export function resolvePartnerCatalogDisplayTitle(opts = {}) {
  const candidates = [
    opts.title,
    opts.productTitle,
    opts.profileTitle,
    ...(Array.isArray(opts.eazVersionTitles) ? opts.eazVersionTitles : []),
  ];
  for (const raw of candidates) {
    const s = String(raw || "").trim();
    if (s && !isPlaceholderVersionDisplayName(s)) return s;
  }
  return null;
}

export function isPartnerCatalogSourceSystem(sourceSystem) {
  return PARTNER_SOURCE_SYSTEMS.has(String(sourceSystem || "").trim().toLowerCase());
}

/**
 * Replace placeholder "Standard" version labels with the partner product title.
 * Printify products (no partner source / non-partner source_system) are left alone.
 * @param {any[]} versions
 * @param {string|null} preferredTitle
 * @param {{ forcePartner?: boolean, sourceSystem?: string|null }} [opts]
 */
export function enrichVersionsDisplayNamesFromPartner(versions, preferredTitle, opts = {}) {
  const title = String(preferredTitle || "").trim();
  if (!title || isPlaceholderVersionDisplayName(title)) {
    return Array.isArray(versions) ? versions.slice() : [];
  }
  const partnerish =
    opts.forcePartner === true || isPartnerCatalogSourceSystem(opts.sourceSystem);
  if (!partnerish) {
    return Array.isArray(versions) ? versions.slice() : [];
  }
  return (Array.isArray(versions) ? versions : []).map((v) => {
    if (!v || typeof v !== "object") return v;
    if (!isPlaceholderVersionDisplayName(v.display_name)) return v;
    return { ...v, display_name: title };
  });
}

/**
 * @param {any} env
 * @param {string} productKey
 */
export async function loadPartnerEditorSource(env, productKey) {
  const key = String(productKey || "").trim();
  if (!key || !env?.MANUFACTURER_DB) return null;

  const link = await findManufacturerProductByCatalogKey(env, key);
  if (!link?.product_id) return null;

  const { manufacturer_id: manufacturerId, product_id: productId } = link;
  const [product, variants, printAreas, mockups, views] = await Promise.all([
    getProduct(env.MANUFACTURER_DB, manufacturerId, productId),
    listVariants(env.MANUFACTURER_DB, manufacturerId, productId),
    listPrintAreas(env.MANUFACTURER_DB, manufacturerId, productId),
    listMockupSlots(env.MANUFACTURER_DB, env, productId),
    listViews(env.MANUFACTURER_DB, productId),
  ]);

  const title = String(product?.meta?.display_name || product?.title || "").trim() || null;

  return {
    manufacturer_id: manufacturerId,
    product_id: productId,
    product_key: key,
    title,
    product,
    variants,
    print_areas: printAreas,
    mockups,
    views,
  };
}

function normalizeHex(raw) {
  const h = String(raw || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h.toLowerCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    const s = h.slice(1);
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase();
  }
  return null;
}

/**
 * Printify-shaped product_data for Admin Variants matrix / Print Area color scope.
 * @param {any[]} partnerVariants
 * @param {{ title?: string }} [meta]
 */
export function buildPartnerProductDataForUi(partnerVariants, meta = {}) {
  const rows = Array.isArray(partnerVariants) ? partnerVariants : [];
  if (!rows.length) return null;

  const colorTitles = [];
  const sizeTitles = [];
  const colorHexByTitle = new Map();
  for (const v of rows) {
    const color = String(v.color || "").trim();
    const size = String(v.size || "").trim();
    if (color && !colorTitles.includes(color)) {
      colorTitles.push(color);
      const hex = normalizeHex(v.attributes?.color_hex || v.color_hex);
      if (hex) colorHexByTitle.set(color, hex);
    }
    if (size && !sizeTitles.includes(size)) sizeTitles.push(size);
  }

  const colorValues = colorTitles.map((title, i) => ({
    id: 1001 + i,
    title,
    colors: [colorHexByTitle.get(title) || "#888888"],
  }));
  const sizeValues = sizeTitles.map((title, i) => ({
    id: 2001 + i,
    title,
  }));

  /** @type {any[]} */
  const options = [];
  if (colorValues.length) {
    options.push({ id: 1, name: "Colors", type: "color", values: colorValues });
  }
  if (sizeValues.length) {
    options.push({ id: 2, name: "Sizes", type: "size", values: sizeValues });
  }

  const colorIdByTitle = new Map(colorValues.map((c) => [c.title, c.id]));
  const sizeIdByTitle = new Map(sizeValues.map((s) => [s.title, s.id]));

  const variants = rows.map((v, idx) => {
    const color = String(v.color || "").trim();
    const size = String(v.size || "").trim();
    const optionIds = [];
    if (color && colorIdByTitle.has(color)) optionIds.push(colorIdByTitle.get(color));
    if (size && sizeIdByTitle.has(size)) optionIds.push(sizeIdByTitle.get(size));
    const cost = Number(v.base_cost_cents);
    const title =
      [color, size].filter(Boolean).join(" / ") ||
      String(v.sku || "").trim() ||
      `Variant ${idx + 1}`;
    return {
      id: 900000 + idx,
      title,
      options: optionIds,
      cost: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : 0,
      price: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : 0,
      is_enabled: v.available !== false && v.available !== 0,
      sku: v.sku || null,
    };
  });

  return {
    id: "partner",
    title: meta.title || "Partner product",
    options,
    variants,
    _source: "partner_manufacturer_variants",
  };
}

function partnerSlotColorName(slot) {
  const fromKey = String(slot?.color_key || "").trim();
  if (fromKey) return fromKey;
  const fromOverlay = String(slot?.overlay?.color_name || slot?.overlay?.title || "").trim();
  if (fromOverlay) return fromOverlay;
  return "Default";
}

/**
 * Shape manufacturer_mockup_templates slots like product_mockup_images rows.
 * @param {any[]} slots
 * @param {{ productKey: string, printProviderId?: any }} opts
 */
export function catalogMockupRowsFromPartnerSlots(slots, { productKey, printProviderId } = {}) {
  const pid = Number(printProviderId);
  const providerId = Number.isFinite(pid) ? pid : 0;
  const out = [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    const url = String(slot?.image_url || "").trim();
    if (!url) continue;
    const set = String(slot?.mockup_set || MOCKUP_SET_CLEAN).trim().toLowerCase() || MOCKUP_SET_CLEAN;
    out.push({
      id: slot.id || `partner-mock-${out.length}`,
      product_key: productKey || null,
      print_provider_id: providerId,
      printify_product_id: "",
      view_key: String(slot.view_key || "front").trim().toLowerCase() || "front",
      color_name: partnerSlotColorName(slot),
      color_hex: normalizeHex(slot.overlay?.color_hex || slot.color_hex),
      image_url: url,
      printify_variant_ids: null,
      is_default: 0,
      mockup_set: set,
      image_r2_key: slot.image_r2_key || null,
      _source: "partner_mockup_templates",
    });
  }
  // First image per set as default preview
  const seenSets = new Set();
  for (const row of out) {
    const set = normalizeMockupSet(row.mockup_set);
    // preview_images keeps its own set key
    const key = String(row.mockup_set || "").toLowerCase() === MOCKUP_SET_PREVIEW_IMAGES
      ? MOCKUP_SET_PREVIEW_IMAGES
      : set;
    if (seenSets.has(key)) continue;
    seenSets.add(key);
    row.is_default = 1;
  }
  return out;
}

/**
 * Split partner mockup rows into Admin Mockups tab buckets.
 * @param {any[]} rows
 */
export function splitPartnerMockupRowsBySet(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const previewImages = list.filter(
    (r) => String(r?.mockup_set || "").toLowerCase() === MOCKUP_SET_PREVIEW_IMAGES
  );
  const nonPreview = list.filter(
    (r) => String(r?.mockup_set || "").toLowerCase() !== MOCKUP_SET_PREVIEW_IMAGES
  );
  return {
    images: filterImagesByMockupSet(nonPreview, MOCKUP_SET_CLEAN),
    shop_preview_images: filterImagesByMockupSet(nonPreview, MOCKUP_SET_SHOP_PREVIEW),
    calibration_images: filterImagesByMockupSet(nonPreview, MOCKUP_SET_CALIBRATION),
    preview_images: previewImages,
  };
}

function normalizePartnerRect(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const w = Number(raw.w ?? raw.width);
  const h = Number(raw.h ?? raw.height);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  if (w <= 0 || h <= 0) return null;
  return {
    x,
    y,
    w,
    h,
    width: w,
    height: h,
    angle: Number(raw.angle) || 0,
  };
}

/**
 * Build product_mockup_defaults-shaped rows from partner print areas.
 * @param {any[]} printAreas
 * @param {any} env
 */
export function mockupDefaultsFromPartnerPrintAreas(printAreas, env) {
  const out = [];
  const seen = new Set();
  for (const area of Array.isArray(printAreas) ? printAreas : []) {
    const key = String(area?.view_key || area?.area_key || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rect = normalizePartnerRect(area?.print_rect || area?.position);
    const w = Number(area?.width_px);
    const h = Number(area?.height_px);
    let imageUrl = String(area?.image_url || "").trim() || null;
    const r2Key = area?.image_r2_key ? String(area.image_r2_key).trim() : "";
    if (!imageUrl && r2Key) imageUrl = publicFileUrl(env, r2Key);
    out.push({
      product_key: null,
      print_area_key: key,
      print_area_rect_json: rect ? JSON.stringify(rect) : null,
      mockup_print_area_rect_json: rect ? JSON.stringify(rect) : null,
      universal_print_area_rect_json: null,
      printify_print_area_width: Number.isFinite(w) && w > 0 ? Math.round(w) : null,
      printify_print_area_height: Number.isFinite(h) && h > 0 ? Math.round(h) : null,
      print_area_template_r2_key: r2Key || null,
      print_area_template_url: imageUrl,
      template_r2_key: null,
      template_url: null,
      template_color: "white",
      placement_x: 0.5,
      placement_y: 0.5,
      placement_scale: 1,
      placement_angle: 0,
      has_print_area_in_image: !!imageUrl,
      _source: "partner_print_areas",
    });
  }
  return out;
}

/**
 * Prefer existing catalog rows; fill empty buckets from partner source.
 * @param {{ images?: any[], shop_preview_images?: any[], calibration_images?: any[], preview_images?: any[] }} bundle
 * @param {any} partnerSource
 * @param {{ productKey: string, printProviderId?: any }} opts
 */
export function enrichMockupsBundleFromPartner(bundle, partnerSource, opts) {
  const base = bundle && typeof bundle === "object" ? { ...bundle } : {};
  if (!partnerSource?.mockups?.length) return base;

  const partnerRows = catalogMockupRowsFromPartnerSlots(partnerSource.mockups, opts);
  const split = splitPartnerMockupRowsBySet(partnerRows);

  if (!(base.images || []).length && split.images.length) {
    base.images = split.images;
    base._partner_mockups = true;
  }
  if (!(base.shop_preview_images || []).length && split.shop_preview_images.length) {
    base.shop_preview_images = split.shop_preview_images;
    base._partner_mockups = true;
  }
  if (!(base.calibration_images || []).length && split.calibration_images.length) {
    base.calibration_images = split.calibration_images;
    base._partner_mockups = true;
  }
  if (!(base.preview_images || []).length && split.preview_images.length) {
    base.preview_images = split.preview_images;
    base._partner_mockups = true;
  }
  return base;
}

/**
 * @param {{ product_data?: any, variants_json?: any, prices_json?: any }} bundle
 * @param {any} partnerSource
 * @param {{ title?: string }} [meta]
 */
export function enrichVariantsBundleFromPartner(bundle, partnerSource, meta = {}) {
  const base = bundle && typeof bundle === "object" ? { ...bundle } : {};
  const hasUi =
    base.product_data?.variants?.length ||
    base.product_data_json?.variants?.length;
  if (hasUi) return base;

  const productData = buildPartnerProductDataForUi(partnerSource?.variants || [], meta);
  if (!productData?.variants?.length) return base;

  base.product_data = productData;
  base.product_data_json = productData;
  base._partner_variants = true;

  if (!Array.isArray(base.variants_json) || !base.variants_json.length) {
    base.variants_json = buildTodifyCatalogVariantsFromPartner({
      variants: partnerSource.variants,
      printAreas: partnerSource.print_areas || [],
      views: partnerSource.views || [],
    });
  }

  if (!base.prices_json || (typeof base.prices_json === "object" && !Object.keys(base.prices_json).length)) {
    const prices = {};
    for (const v of productData.variants) {
      if (v.id != null && v.cost > 0) prices[String(v.id)] = v.cost;
    }
    if (Object.keys(prices).length) base.prices_json = prices;
  }

  return base;
}

/**
 * @param {{ mockup_defaults?: any[], variant_print_areas?: any[] }} bundle
 * @param {any} partnerSource
 * @param {any} env
 */
export function enrichPrintAreaBundleFromPartner(bundle, partnerSource, env) {
  const base = bundle && typeof bundle === "object" ? { ...bundle } : {};
  if (!(base.mockup_defaults || []).length && partnerSource?.print_areas?.length) {
    base.mockup_defaults = mockupDefaultsFromPartnerPrintAreas(partnerSource.print_areas, env).map(
      (row) => ({ ...row, product_key: partnerSource.product_key })
    );
    base._partner_print_areas = true;
  }

  if (!(base.variant_print_areas || []).length && partnerSource?.print_areas?.length) {
    const placeholders = catalogPlaceholdersFromPartnerPrintAreas(
      partnerSource.print_areas,
      partnerSource.views || []
    );
    const catalogVariants = buildTodifyCatalogVariantsFromPartner({
      variants: partnerSource.variants || [],
      printAreas: partnerSource.print_areas,
      views: partnerSource.views || [],
    });
    const rows = [];
    for (const ph of placeholders) {
      const pos = String(ph.position || "").trim().toLowerCase();
      if (!pos) continue;
      for (const v of catalogVariants) {
        rows.push({
          product_key: partnerSource.product_key,
          print_area_key: pos,
          variant_id: v.id,
          variant_title: v.title || null,
          printify_print_area_width: ph.width ?? null,
          printify_print_area_height: ph.height ?? null,
          _source: "partner_print_areas",
        });
      }
    }
    if (rows.length) {
      base.variant_print_areas = rows;
      base._partner_print_areas = true;
    }
  }

  return base;
}
