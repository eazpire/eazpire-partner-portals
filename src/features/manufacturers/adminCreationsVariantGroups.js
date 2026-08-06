/**
 * Build parent/child variant groups (color → sizes) for Admin Creations product detail.
 */

import { MOCKUP_VIEW_ORDER } from "./adminCreationsShopifyProductDetail.js";
import { findLiveVariantForTemplateVariant } from "../../utils/printify.js";

function viewSortRank(view) {
  const v = String(view || "other")
    .trim()
    .toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MOCKUP_VIEW_ORDER, v)) return MOCKUP_VIEW_ORDER[v];
  return MOCKUP_VIEW_ORDER.other;
}

function normOpt(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function resolveColorOptionIndex(options) {
  const opts = Array.isArray(options) ? options : [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (!o) continue;
    const n = String(o.name || "").toLowerCase();
    if (o.type === "color" || n === "color" || n === "colors") return i;
  }
  return opts.length ? 0 : -1;
}

function resolveSizeOptionIndex(options, colorIdx) {
  const opts = Array.isArray(options) ? options : [];
  for (let i = 0; i < opts.length; i++) {
    if (i === colorIdx) continue;
    const o = opts[i];
    if (!o) continue;
    const n = String(o.name || "").toLowerCase();
    if (o.type === "size" || n === "size" || n === "sizes") return i;
  }
  if (opts.length >= 2) return colorIdx === 0 ? 1 : 0;
  return -1;
}

function optionValueAt(variant, idx) {
  if (idx === 0) return variant?.option1 || null;
  if (idx === 1) return variant?.option2 || null;
  if (idx === 2) return variant?.option3 || null;
  return null;
}

function buildMockSlidesByColor(mockups) {
  const map = new Map();
  for (const m of Array.isArray(mockups) ? mockups : []) {
    const color = String(m.variant_label || "Default").trim() || "Default";
    if (!map.has(color)) map.set(color, []);
    map.get(color).push({
      view: m.view || "other",
      src: m.src || "",
      is_preview: !!m.is_preview,
      alt: m.alt || "",
    });
  }
  for (const slides of map.values()) {
    slides.sort((a, b) => viewSortRank(a.view) - viewSortRank(b.view));
  }
  return map;
}

function defaultViewIndex(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const previewIdx = list.findIndex((s) => s.is_preview);
  if (previewIdx >= 0) return previewIdx;
  const frontIdx = list.findIndex((s) => normOpt(s.view) === "front");
  return frontIdx >= 0 ? frontIdx : 0;
}

function enabledFromConfig(printifyVariantId, config) {
  const variants = config?.variants;
  if (!variants || typeof variants !== "object") return true;
  const row = variants[String(printifyVariantId)];
  if (!row) return true;
  return row.enabled !== false;
}

/**
 * @param {object} params
 * @param {Array<object>} params.shopifyVariants
 * @param {Array<object>} params.shopifyOptions
 * @param {Array<object>} params.mockups
 * @param {object|null} params.variantConfig
 * @param {object|null} params.printifyProductData — Printify product JSON from catalog
 */
export function buildVariantGroupsForProductDetail({
  shopifyVariants = [],
  shopifyOptions = [],
  mockups = [],
  variantConfig = null,
  printifyProductData = null,
} = {}) {
  const mockByColor = buildMockSlidesByColor(mockups);
  const colorIdx = resolveColorOptionIndex(shopifyOptions);
  const sizeIdx = resolveSizeOptionIndex(shopifyOptions, colorIdx);
  const printifyVariants = Array.isArray(printifyProductData?.variants) ? printifyProductData.variants : [];

  /** @type {Map<string, { color: string, sizes: object[] }>} */
  const groups = new Map();

  for (const v of shopifyVariants) {
    const color =
      (colorIdx >= 0 ? optionValueAt(v, colorIdx) : null) ||
      v.option1 ||
      v.title ||
      "Default";
    const size =
      (sizeIdx >= 0 ? optionValueAt(v, sizeIdx) : null) ||
      (v.options && v.options.length > 1 ? v.options[v.options.length - 1] : v.option2) ||
      "One size";
    const colorKey = String(color).trim() || "Default";
    if (!groups.has(colorKey)) {
      groups.set(colorKey, { color: colorKey, sizes: [] });
    }

    let printifyVariantId = null;
    if (printifyVariants.length) {
      const templateMatch = printifyVariants.find((pv) => {
        const pvOpts = [pv.title, ...(Array.isArray(pv.options) ? pv.options : [])].join(" ");
        return normOpt(pvOpts).includes(normOpt(color)) && normOpt(pvOpts).includes(normOpt(size));
      });
      const live = templateMatch
        ? findLiveVariantForTemplateVariant(templateMatch, printifyVariants)
        : printifyVariants.find((pv) => normOpt(pv.title) === normOpt(`${color} / ${size}`));
      printifyVariantId = live?.id != null ? String(live.id) : templateMatch?.id != null ? String(templateMatch.id) : null;
    }

    groups.get(colorKey).sizes.push({
      shopify_variant_id: v.id != null ? String(v.id) : null,
      printify_variant_id: printifyVariantId,
      size: String(size).trim() || "One size",
      sku: v.sku || null,
      price: v.price != null ? String(v.price) : null,
      compare_at_price: v.compare_at_price != null ? String(v.compare_at_price) : null,
      inventory_quantity: v.inventory_quantity != null ? Number(v.inventory_quantity) : null,
      enabled: printifyVariantId
        ? enabledFromConfig(printifyVariantId, variantConfig)
        : true,
    });
  }

  const out = [];
  for (const [colorKey, g] of groups) {
    const mock_slides = mockByColor.get(colorKey) || mockByColor.get("Default") || [];
    const sizes = g.sizes.sort((a, b) => String(a.size).localeCompare(String(b.size), undefined, { numeric: true }));
    const enabledCount = sizes.filter((s) => s.enabled !== false).length;
    out.push({
      color: colorKey,
      mock_slides,
      default_view_index: defaultViewIndex(mock_slides),
      enabled: enabledCount > 0,
      sizes,
    });
  }

  out.sort((a, b) => a.color.localeCompare(b.color));
  return out;
}

/**
 * Live channels where this product can be updated.
 * @param {object} params
 */
export function buildLiveChannelsForVariantUpdate({
  printifyProductId = null,
  isTodify = false,
  amazonPublish = null,
  shopifyProductId = null,
} = {}) {
  const channels = [];
  if (!isTodify && printifyProductId) {
    channels.push({ id: "printify", label: "Printify", group: "manufacturing" });
  }
  if (shopifyProductId) {
    channels.push({ id: "shopify", label: "Shopify (eazpire)", group: "storefront" });
  }

  const listings = Array.isArray(amazonPublish?.listings) ? amazonPublish.listings : [];
  const liveStatuses = new Set(["published", "live", "listed"]);
  const euLive = listings.some(
    (r) => liveStatuses.has(String(r.status || "").toLowerCase()) && ["DE", "FR", "UK", "IT", "ES"].includes(String(r.marketplace_id || "").slice(0, 2).toUpperCase())
  );
  const usLive = listings.some(
    (r) => liveStatuses.has(String(r.status || "").toLowerCase()) && String(r.marketplace_id || "").toUpperCase().startsWith("US")
  );
  const europaLive = listings.some((r) => {
    const st = String(r.status || "").toLowerCase();
    if (!liveStatuses.has(st)) return false;
    const mp = String(r.marketplace_id || "").toUpperCase();
    return mp.startsWith("DE") || mp.startsWith("FR") || mp.startsWith("UK") || mp.startsWith("IT") || mp.startsWith("ES") || mp.startsWith("NL") || mp.startsWith("PL") || mp.startsWith("BE") || mp.startsWith("SE") || mp.startsWith("IE");
  });
  const amerikaLive = listings.some((r) => {
    const st = String(r.status || "").toLowerCase();
    if (!liveStatuses.has(st)) return false;
    const mp = String(r.marketplace_id || "").toUpperCase();
    return mp.startsWith("US") || mp.startsWith("CA");
  });

  if (europaLive || euLive) {
    channels.push({ id: "amazon_europa", label: "Amazon Europa", group: "amazon" });
  }
  if (amerikaLive || usLive) {
    channels.push({ id: "amazon_amerika", label: "Amazon USA / Amerika", group: "amazon" });
  }

  return channels;
}
