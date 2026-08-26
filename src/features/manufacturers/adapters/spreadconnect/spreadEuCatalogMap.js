/**
 * Pure mapping helpers for Spread EU catalog import (IDEA-085).
 */

import {
  getCategoryIdForCategoryName,
  getTaxonomyDataForCategory,
} from "../../../../utils/taxonomy.js";

export function spreadEuProductKey(typeId) {
  const id = String(typeId || "").trim();
  return id ? `spread-eu-${id}` : "";
}

export function spreadconnectArticleIdFromHandle(handle) {
  const m = String(handle || "")
    .trim()
    .toLowerCase()
    .match(/^spreadconnect-(\d+)/);
  return m ? m[1] : "";
}

export function spreadconnectProductTypeName(type) {
  return String(type?.customerName || type?.merchantName || type?.name || "").trim();
}

function printAreaWidth(area) {
  return Number(area?.widthMm || area?.width_mm || area?.width) || 0;
}

function printAreaHeight(area) {
  return Number(area?.heightMm || area?.height_mm || area?.height) || 0;
}

export function spreadconnectHasFrontPrintArea(type) {
  const areas = Array.isArray(type?.printAreas) ? type.printAreas : [];
  return areas.some((a) => {
    const view = String(a?.view || a?.name || a?.key || "").toUpperCase();
    return view === "FRONT" && printAreaWidth(a) > 0 && printAreaHeight(a) > 0;
  });
}

/** Any printable area with size — bags/buttons often have no FRONT view. */
export function spreadconnectHasUsablePrintArea(type) {
  const areas = Array.isArray(type?.printAreas) ? type.printAreas : [];
  return areas.some((a) => printAreaWidth(a) > 0 && printAreaHeight(a) > 0);
}

function typeNameLower(typeOrTitle) {
  if (typeof typeOrTitle === "string") return typeOrTitle.toLowerCase();
  return spreadconnectProductTypeName(typeOrTitle).toLowerCase();
}

/**
 * Non-clothing (bags, teddy, buttons, home, drinkware, tech).
 * Socks/aprons stay apparel. Hats/caps are accessories.
 */
export function spreadconnectIsNonApparel(type) {
  const n = typeNameLower(type);
  if (!n) return false;
  if (/\b(buttons?|pins?|anstecker)\b/.test(n) && !/shirt|blouse|jacke|jacket/.test(n)) return true;
  if (/teddy|plüsch|pluesch|plush/.test(n)) return true;
  if (/tote|backpack|rucksack|handbag|handtasche|stoffbeutel|turnbeutel|\b(bag|tasche|beutel|pouch)\b/.test(n)) {
    return true;
  }
  return /mug|tasse|cup|becher|bottle|flasche|tumbler|\bglass\b|\bglas\b|poster|canvas|leinwand|sticker|aufkleber|phone|handy|hülle|huelle|\bcase\b|pillow|kissen|mouse\s*pad|mauspad|flag|fahne|puzzle|magnet|hat|\bcap\b|mütze|muetze|beanie|kappe/.test(
    n
  );
}

export function spreadconnectApparelKind(type) {
  const n = typeNameLower(type);
  if (spreadconnectIsNonApparel(type)) return null;
  if (/hoodie|kapuzen/.test(n) && /zip|reiß|reiss/.test(n)) return "zip-hoodie";
  if (/hoodie|kapuzen/.test(n)) return "hoodie";
  if (/tank|singlet|ärmellos|aermellos/.test(n)) return "tank";
  if (/long\s*sleeve|longsleeve|langarm/.test(n)) return "longsleeve";
  if (/polo/.test(n)) return "polo";
  if (/jacke|jacket|blouson/.test(n)) return "jacket";
  if (/weste|vest\b/.test(n)) return "vest";
  if (/crop/.test(n)) return "crop";
  if (/sweat|crewneck|pullover/.test(n)) return "sweat";
  if (/short/.test(n)) return "shorts";
  if (/jogger|sweatpant/.test(n)) return "joggers";
  if (/legging/.test(n)) return "leggings";
  if (/\b(body|onesie|romper|babybody)\b/.test(n)) return "body";
  if (/bodysuit/.test(n)) return "bodysuit";
  if (/sock|socken/.test(n)) return "socks";
  if (/apron|schürze|schuerze/.test(n)) return "apron";
  if (/(women|ladies|damen|femme|frauen)/.test(n) && /t[- ]?shirt|tee\b/.test(n)) return "womens-tee";
  if (/(men|herren|homme)/.test(n) && /t[- ]?shirt|tee\b/.test(n)) return "mens-tee";
  if (/t[- ]?shirt|tee\b/.test(n)) return "tee";
  if (/shirt/.test(n)) return "shirt";
  return null;
}

export function spreadconnectDefaultD2cPrice(type) {
  const kind = spreadconnectApparelKind(type);
  if (kind === "hoodie" || kind === "sweat" || kind === "zip-hoodie") return 29.99;
  if (kind === "longsleeve" || kind === "polo") return 24.99;
  return 19.99;
}

/** Spread EU warehouse origin (Leipzig / Gutenborn — not US). */
export const SPREAD_EU_COUNTRY_OF_ORIGIN = "DE";

const MAX_MOCKUP_ENTRIES = 80;

function moneyToCents(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    return moneyToCents(value.amount ?? value.price ?? value.value ?? value.b2bPrice ?? value.d2cPrice);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 500) return Math.round(n);
  return Math.round(n * 100);
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

export function spreadconnectAppearanceHex(appearance) {
  if (!appearance || typeof appearance !== "object") return null;
  const candidates = [
    appearance.colorHex,
    appearance.color_hex,
    appearance.hex,
    appearance.appearanceColorValue,
    appearance.colorValue,
    appearance.color,
    Array.isArray(appearance.colors) ? appearance.colors[0] : null,
    appearance.rgb,
    appearance.rgbHex,
  ];
  for (const raw of candidates) {
    const hex = normalizeHex(raw);
    if (hex) return hex;
  }
  return null;
}

export function spreadconnectVariantCostCents(type, appearance = null, size = null) {
  const fromApi = moneyToCents(
    size?.price ??
      size?.b2bPrice ??
      size?.d2cPrice ??
      appearance?.price ??
      appearance?.b2bPrice ??
      type?.b2bPrice ??
      type?.price ??
      type?.d2cPrice
  );
  if (fromApi != null) return fromApi;
  return Math.round(spreadconnectDefaultD2cPrice(type) * 100);
}

export function spreadconnectSyntheticVariantId(typeId, appearanceId, sizeId) {
  const t = Number(typeId) || 0;
  const a = Number(appearanceId) || 0;
  const s = Number(sizeId) || 0;
  return t * 1_000_000 + a * 1_000 + s;
}

/**
 * Printify-shaped product_data for Catalog Editor variant matrix.
 * @param {object} type Spread Connect product type
 * @param {{ views?: object, categories?: object }} [extras]
 */
export function buildSpreadEuCatalogProductData(type, extras = {}) {
  const typeId = type?.id;
  const appearances = Array.isArray(type?.appearances) ? type.appearances : [];
  const sizes = typeSizes(type);
  const viewsPayload = extras.views;
  const categoriesPayload = extras.categories ?? extras.views?.categories ?? null;

  const colorValues = appearances
    .map((a) => {
      const hex = spreadconnectAppearanceHex(a);
      return {
        id: Number(a.id),
        title: String(a.name || a.id).trim() || String(a.id),
        colors: hex ? [hex] : [],
      };
    })
    .filter((v) => Number.isFinite(v.id) && v.id > 0);
  const sizeValues = sizes
    .map((s) => ({
      id: Number(s.id),
      title: String(s.name || s.id).trim() || String(s.id),
    }))
    .filter((v) => Number.isFinite(v.id) && v.id > 0);

  const variants = [];
  const configVariants = {};
  const pricesJson = [];
  let firstCost = null;
  for (const appearance of appearances) {
    const appearanceId = Number(appearance.id);
    const colorName = String(appearance.name || appearanceId).trim() || String(appearanceId);
    for (const size of sizes) {
      const sizeId = Number(size.id);
      if (!Number.isFinite(appearanceId) || !Number.isFinite(sizeId)) continue;
      const id = spreadconnectSyntheticVariantId(typeId, appearanceId, sizeId);
      const sizeName = String(size.name || sizeId).trim() || String(sizeId);
      const cost = spreadconnectVariantCostCents(type, appearance, size);
      if (firstCost == null) firstCost = cost;
      variants.push({
        id,
        title: `${colorName} / ${sizeName}`,
        options: [appearanceId, sizeId],
        cost,
        is_enabled: true,
        sku: `${typeId}-P${appearanceId}S${sizeId}`,
      });
      configVariants[String(id)] = { enabled: true };
      pricesJson.push({ variant_id: id, price: cost });
    }
  }

  const printAreaKeys = spreadconnectPrintAreaKeys(type);
  const printAreas = spreadconnectPrintAreaDetails(type);
  const mockupEntries = spreadconnectMockupEntries(type, viewsPayload);
  const mockImages = [];
  for (const entry of mockupEntries) pushHttpUrl(mockImages, entry.image_url);
  for (const url of spreadconnectMockImageUrls(type, viewsPayload)) pushHttpUrl(mockImages, url);
  const catalogCategory = spreadEuCatalogCategory(type, categoriesPayload);
  const taxonomy = spreadEuShopifyTaxonomy(type, catalogCategory);
  const description = String(type?.customerDescription || type?.merchantDescription || "").trim();
  const creatorPreviewUrl = mockupEntries.find((e) => e.is_default)?.image_url || mockImages[0] || "";

  return {
    product_data: {
      id: String(typeId || ""),
      title: spreadconnectProductTypeName(type) || `Spread EU ${typeId}`,
      description,
      brand: type?.brand != null ? String(type.brand) : "",
      options: [
        { name: "Color", type: "color", values: colorValues },
        { name: "Size", type: "size", values: sizeValues },
      ],
      variants,
      print_areas: printAreas,
      images: mockImages,
    },
    variants_json: variants,
    prices_json: pricesJson,
    variant_config: {
      global: { profit_mode: "percent", profit_value: 0, branding: "none" },
      variants: configVariants,
    },
    d2c_price: firstCost != null ? firstCost / 100 : spreadconnectDefaultD2cPrice(type),
    print_area_keys: printAreaKeys,
    print_areas_config: Object.fromEntries(
      printAreas.map((area) => [
        area.name,
        { width_mm: area.width_mm, height_mm: area.height_mm, view: area.view },
      ])
    ),
    mock_images: mockImages.slice(0, 12),
    mockup_entries: mockupEntries,
    catalog_category: catalogCategory,
    shopify_category_id: taxonomy.shopify_category_id,
    shopify_category_name: taxonomy.shopify_category_name,
    country_of_origin: SPREAD_EU_COUNTRY_OF_ORIGIN,
    creator_preview_url: creatorPreviewUrl,
    product_features: description || null,
  };
}

function pushHttpUrl(urls, value) {
  if (typeof value !== "string") return;
  const u = value.trim();
  if (!/^https?:\/\//i.test(u)) return;
  if (!urls.includes(u)) urls.push(u);
}

function collectUrlDeep(urls, node, depth = 0) {
  if (depth > 4 || node == null) return;
  if (typeof node === "string") {
    pushHttpUrl(urls, node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectUrlDeep(urls, item, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const key of ["url", "src", "image", "image_url", "imageUrl", "previewImage", "preview_url", "href"]) {
    pushHttpUrl(urls, node[key]);
  }
  for (const key of ["images", "previews", "resources", "appearancePreviews", "productImages"]) {
    if (node[key] != null) collectUrlDeep(urls, node[key], depth + 1);
  }
}

/** Public Spreadshirt image-server mockup (no API key). View 1 is FRONT for apparel types. */
export function spreadconnectCdnPreviewUrl(typeId, appearanceId, viewId = 1, size = 800) {
  const t = String(typeId || "").trim();
  const a = String(appearanceId || "").trim();
  const v = String(viewId || 1).trim() || "1";
  if (!t || !a) return "";
  const dim = Number(size) > 0 ? Number(size) : 800;
  return `https://image.spreadshirtmedia.net/image-server/v1/productTypes/${encodeURIComponent(t)}/views/${encodeURIComponent(v)}/appearances/${encodeURIComponent(a)},width=${dim},height=${dim}`;
}

export function spreadconnectFrontViewId(viewsPayload) {
  const views = Array.isArray(viewsPayload?.views)
    ? viewsPayload.views
    : Array.isArray(viewsPayload)
      ? viewsPayload
      : [];
  const front = views.find((v) => String(v?.name || "").toUpperCase() === "FRONT") || views[0];
  const id = front?.id;
  return id == null || id === "" ? "1" : String(id);
}

function collectViewsImageUrls(urls, viewsPayload) {
  const views = Array.isArray(viewsPayload?.views)
    ? viewsPayload.views
    : Array.isArray(viewsPayload)
      ? viewsPayload
      : [];
  const front = views.find((v) => String(v?.name || "").toUpperCase() === "FRONT");
  const ordered = front ? [front, ...views.filter((v) => v !== front)] : views;
  for (const view of ordered) {
    collectUrlDeep(urls, view?.images);
  }
}

/** Preview / appearance images from a product type, /views payload, or CDN fallback. */
export function spreadconnectMockImageUrls(type, viewsPayload = null) {
  const urls = [];
  collectViewsImageUrls(urls, viewsPayload);
  collectUrlDeep(urls, type?.images);
  collectUrlDeep(urls, type?.image);
  collectUrlDeep(urls, type?.imageUrl);
  collectUrlDeep(urls, type?.previewImage);
  collectUrlDeep(urls, type?.productImages);
  const appearances = Array.isArray(type?.appearances) ? type.appearances : [];
  for (const appearance of appearances) {
    collectUrlDeep(urls, appearance);
  }
  if (!urls.length && type?.id) {
    const viewId = spreadconnectFrontViewId(viewsPayload);
    for (const appearance of appearances.slice(0, 4)) {
      pushHttpUrl(urls, spreadconnectCdnPreviewUrl(type.id, appearance?.id, viewId));
    }
  }
  return urls.slice(0, 12);
}

function extractViewsList(viewsPayload) {
  if (Array.isArray(viewsPayload?.views)) return viewsPayload.views;
  if (Array.isArray(viewsPayload)) return viewsPayload;
  return [];
}

/** Mockups grouped by print area (view) and variant color. */
export function spreadconnectMockupEntries(type, viewsPayload = null) {
  const appearances = Array.isArray(type?.appearances) ? type.appearances : [];
  const sizes = typeSizes(type);
  const printAreas = spreadconnectPrintAreaDetails(type);
  const views = extractViewsList(viewsPayload);
  const viewIdByName = new Map();
  const imageByViewAppearance = new Map();
  for (const view of views) {
    const name = String(view?.name || view?.key || "").trim().toLowerCase();
    if (name && view?.id != null) viewIdByName.set(name, String(view.id));
    for (const img of Array.isArray(view?.images) ? view.images : []) {
      const aid = String(img?.appearanceId ?? img?.appearance_id ?? "").trim();
      const url = String(img?.image || img?.url || img?.src || img?.imageUrl || "").trim();
      if (!aid || !/^https?:\/\//i.test(url)) continue;
      imageByViewAppearance.set(`${name || "front"}:${aid}`, url);
    }
  }
  const areas = printAreas.length ? printAreas : [{ name: "front", view: "FRONT" }];
  const defaultViewId = spreadconnectFrontViewId(viewsPayload);
  const entries = [];
  const seen = new Set();
  let isDefault = 1;
  const pushEntry = (area, appearance) => {
    const appearanceId = appearance?.id;
    if (appearanceId == null || appearanceId === "") return;
    const viewKey = String(area.name || "front").trim() || "front";
    const colorName = String(appearance.name || appearanceId).trim() || String(appearanceId);
    const dedupeKey = `${viewKey}::${colorName}`;
    if (seen.has(dedupeKey)) return;
    const viewId = viewIdByName.get(viewKey) || viewIdByName.get(String(area.view || "").toLowerCase()) || defaultViewId;
    const url =
      imageByViewAppearance.get(`${viewKey}:${appearanceId}`) ||
      spreadconnectCdnPreviewUrl(type.id, appearanceId, viewId);
    if (!url) return;
    seen.add(dedupeKey);
    const variantIds = sizes
      .map((s) => spreadconnectSyntheticVariantId(type.id, appearanceId, s.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    entries.push({
      view_key: viewKey,
      color_name: colorName,
      color_hex: spreadconnectAppearanceHex(appearance),
      image_url: url,
      printify_variant_ids: JSON.stringify(variantIds),
      is_default: isDefault,
    });
    isDefault = 0;
  };
  for (const appearance of appearances) {
    if (entries.length >= MAX_MOCKUP_ENTRIES) break;
    pushEntry(areas[0], appearance);
  }
  for (const area of areas.slice(1)) {
    for (const appearance of appearances) {
      if (entries.length >= MAX_MOCKUP_ENTRIES) break;
      pushEntry(area, appearance);
    }
  }
  return entries;
}

function typeSizes(type) {
  const sizes = Array.isArray(type?.sizes) ? type.sizes : [];
  if (sizes.length) return sizes;
  return [{ id: 1, name: "One Size" }];
}

export function spreadconnectPrintAreaKeys(type) {
  return spreadconnectPrintAreaDetails(type).map((a) => a.name);
}

function printAreaViewLabel(area) {
  return String(area?.view || area?.name || area?.key || "").trim();
}

function sortPrintAreasFrontFirst(areas) {
  const list = Array.isArray(areas) ? areas.slice() : [];
  list.sort((a, b) => {
    const av = printAreaViewLabel(a).toUpperCase();
    const bv = printAreaViewLabel(b).toUpperCase();
    if (av === "FRONT" && bv !== "FRONT") return -1;
    if (bv === "FRONT" && av !== "FRONT") return 1;
    const aDef = a?.default === true || a?.isDefault === true;
    const bDef = b?.default === true || b?.isDefault === true;
    if (aDef && !bDef) return -1;
    if (bDef && !aDef) return 1;
    return 0;
  });
  return list;
}

export function spreadconnectPrintAreaDetails(type) {
  const areas = sortPrintAreasFrontFirst(type?.printAreas);
  const out = [];
  const seen = new Set();
  for (const area of areas) {
    const w = printAreaWidth(area);
    const h = printAreaHeight(area);
    if (w <= 0 || h <= 0) continue;
    const view = printAreaViewLabel(area) || "default";
    const name = view.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      view: view.toUpperCase(),
      width_mm: w,
      height_mm: h,
    });
  }
  return out;
}

/** Catalog Studio top-level buckets for Spread EU apparel (not Printify Kleidung). */
export const SPREAD_EU_AUDIENCE_GROUPS = ["Unisex", "Male", "Female", "Kids", "Toddler"];

const SPREAD_NON_APPAREL_GROUP_TO_STUDIO = {
  Accessoires: "Accessoires",
  Accessories: "Accessoires",
  Taschen: "Taschen",
  Bags: "Taschen",
  "Home & Living": "Home",
  Home: "Home",
  Drinkware: "Drinkware",
  "Wall Art": "Wall Art",
  Tech: "Tech",
  Papier: "Papier",
  Paper: "Papier",
};

const SPREAD_API_LEAF_TO_STUDIO = {
  "T-Shirts": "T-Shirt",
  "Pullover & Hoodies": "Hoodie",
  "Jacken & Westen": "Jacket",
  Langarmshirts: "Long Sleeve",
  Poloshirts: "Polo Shirt",
  "Tank Tops": "Tank Top",
  "Hosen & Shorts": "Shorts",
  Babykleidung: "Body",
  Taschen: "Bag",
  Bags: "Bag",
  Buttons: "Pin / Button",
};

function collectSpreadTranslations(nodes, acc = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const t = String(node?.translation || node?.name || "").trim();
    if (t) acc.push(t);
    if (Array.isArray(node?.children) && node.children.length) {
      collectSpreadTranslations(node.children, acc);
    }
  }
  return acc;
}

function deepestSpreadCategoryLeaves(nodes, acc = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (Array.isArray(node?.children) && node.children.length) {
      deepestSpreadCategoryLeaves(node.children, acc);
    } else if (node?.translation) {
      acc.push(node);
    }
  }
  return acc;
}

function studioLeafFromKind(kind) {
  if (kind === "hoodie" || kind === "zip-hoodie") return "Hoodie";
  if (kind === "sweat") return "Sweatshirt";
  if (kind === "tank") return "Tank Top";
  if (kind === "longsleeve") return "Long Sleeve";
  if (kind === "polo") return "Polo Shirt";
  if (kind === "jacket") return "Jacket";
  if (kind === "vest") return "Vest";
  if (kind === "crop") return "Crop Top";
  if (kind === "shorts") return "Shorts";
  if (kind === "joggers") return "Joggers";
  if (kind === "leggings") return "Leggings";
  if (kind === "body") return "Body";
  if (kind === "bodysuit") return "Bodysuit";
  if (kind === "socks") return "Socks";
  if (kind === "apron") return "Apron";
  if (kind === "shirt") return "Shirt";
  if (kind === "womens-tee" || kind === "mens-tee" || kind === "tee") return "T-Shirt";
  return null;
}

function nonApparelGroupAndLeaf(n, apiGroupRaw, apiLeafRaw) {
  if (/teddy|plüsch|pluesch|plush/.test(n)) return { group: "Accessoires", leaf: "Teddy" };
  if (/\b(buttons?|pins?|anstecker)\b/.test(n) && !/shirt|blouse/.test(n)) {
    return { group: "Accessoires", leaf: "Pin / Button" };
  }
  if (/hat|\bcap\b|mütze|muetze|beanie|kappe/.test(n)) return { group: "Accessoires", leaf: "Hat / Cap" };
  if (/backpack|rucksack/.test(n)) return { group: "Taschen", leaf: "Backpack" };
  if (/tote|stoffbeutel|turnbeutel/.test(n)) return { group: "Taschen", leaf: "Tote Bag" };
  if (/handbag|handtasche/.test(n)) return { group: "Taschen", leaf: "Handbag" };
  if (/\b(bag|tasche|beutel|pouch)\b/.test(n)) return { group: "Taschen", leaf: "Bag" };
  if (/mug|tasse|becher/.test(n)) return { group: "Drinkware", leaf: "Mug" };
  if (/tumbler/.test(n)) return { group: "Drinkware", leaf: "Tumbler" };
  if (/bottle|flasche/.test(n)) return { group: "Drinkware", leaf: "Water Bottle" };
  if (/\b(glass|glas)\b/.test(n)) return { group: "Drinkware", leaf: "Glass" };
  if (/poster/.test(n)) return { group: "Wall Art", leaf: "Poster" };
  if (/canvas|leinwand/.test(n)) return { group: "Wall Art", leaf: "Canvas" };
  if (/flag|fahne|banner/.test(n)) return { group: "Wall Art", leaf: "Flag / Banner" };
  if (/pillow|kissen/.test(n)) return { group: "Home", leaf: "Pillow" };
  if (/blanket|decke/.test(n)) return { group: "Home", leaf: "Blanket" };
  if (/magnet/.test(n)) return { group: "Home", leaf: "Magnet" };
  if (/sticker|aufkleber/.test(n)) return { group: "Papier", leaf: "Sticker" };
  if (/puzzle/.test(n)) return { group: "Papier", leaf: "Puzzle" };
  if (/mouse\s*pad|mauspad/.test(n)) return { group: "Tech", leaf: "Mouse Pad" };
  if (/phone|handy|hülle|huelle|\bcase\b/.test(n)) return { group: "Tech", leaf: "Phone Case" };

  const group = SPREAD_NON_APPAREL_GROUP_TO_STUDIO[apiGroupRaw] || "Accessoires";
  const leaf = SPREAD_API_LEAF_TO_STUDIO[apiLeafRaw] || apiLeafRaw || "Other";
  return { group, leaf };
}

/**
 * Audience from Spread /categories genders (when present), else type name.
 * Conservative: girl/boy → Kids; women/damen → Female; men/herren → Male;
 * baby/toddler/onesie → Toddler; no gender on adult apparel → Unisex.
 */
export function spreadconnectAudienceGroup(type, apiCategories = null) {
  const genderTexts = collectSpreadTranslations(apiCategories?.genders).map((t) => t.toLowerCase());
  const featureTexts = collectSpreadTranslations(apiCategories?.features).map((t) => t.toLowerCase());
  const categoryTexts = collectSpreadTranslations(apiCategories?.categories).map((t) => t.toLowerCase());
  const apiBlob = [...genderTexts, ...featureTexts, ...categoryTexts].join(" ");
  const n = `${typeNameLower(type)} ${apiBlob}`.trim();

  if (/\b(baby|toddler|infant|newborn|new[\s-]?born|onesie|romper|säugling|saeugling|neugeboren|babybody|babykleidung)\b/.test(n)) {
    return "Toddler";
  }
  if (/\b(kids?|child|children|youth|junior|kinder)\b/.test(n)) return "Kids";
  if (/\b(girls?|boys?|junge|jungen|mädchen|maedchen)\b/.test(n) && !/\b(wom[ae]n|ladies|damen|herren|men'?s)\b/.test(n)) {
    return "Kids";
  }

  const apiHasWomen = genderTexts.some((g) => /\b(wom[ae]n|female|damen|femme|ladies)\b/.test(g));
  const apiHasMen = genderTexts.some((g) => /\b(men|male|herren|homme)\b/.test(g));
  const apiHasUnisex = genderTexts.some((g) => /\bunisex\b/.test(g));
  const apiHasKids = genderTexts.some((g) => /\b(kids?|child|children|youth|kinder)\b/.test(g));
  if (apiHasKids) return "Kids";
  if (apiHasUnisex || (apiHasWomen && apiHasMen)) return "Unisex";
  if (apiHasWomen && !apiHasMen) return "Female";
  if (apiHasMen && !apiHasWomen) return "Male";

  if (/\bunisex\b/.test(n)) return "Unisex";
  if (/\b(wom[ae]n'?s?|ladies|lady|damen|femme|frauen|weiblich|female)\b/.test(n)) return "Female";
  if (/\b(men'?s?|herren|homme|männlich|maennlich|\bmale\b)\b/.test(n)) return "Male";
  return "Unisex";
}

function apparelLeaf(type, apiLeafRaw) {
  const kind = spreadconnectApparelKind(type);
  const fromKind = studioLeafFromKind(kind);
  if (apiLeafRaw === "Pullover & Hoodies") {
    return kind === "sweat" ? "Sweatshirt" : fromKind || "Hoodie";
  }
  if (fromKind) return fromKind;
  if (apiLeafRaw && SPREAD_API_LEAF_TO_STUDIO[apiLeafRaw]) return SPREAD_API_LEAF_TO_STUDIO[apiLeafRaw];
  if (apiLeafRaw && apiLeafRaw !== "Bekleidung" && apiLeafRaw !== "Babykleidung") return apiLeafRaw;
  return "T-Shirt";
}

/**
 * Map Spread Connect type (+ optional /categories payload) onto Catalog Studio groups.
 * Apparel: Unisex / Male / Female / Kids / Toddler → product type.
 * Non-clothing: Accessoires / Taschen / Home / … → product type (never forced into gender buckets).
 */
export function spreadEuCatalogCategory(type, apiCategories = null) {
  const groups = Array.isArray(apiCategories?.categories) ? apiCategories.categories : [];
  const apiGroupRaw = String(groups[0]?.translation || "").trim();
  const apiLeafRaw = String(deepestSpreadCategoryLeaves(groups)[0]?.translation || "").trim();
  const n = typeNameLower(type);

  if (spreadconnectIsNonApparel(type)) {
    return nonApparelGroupAndLeaf(n, apiGroupRaw, apiLeafRaw);
  }

  return {
    group: spreadconnectAudienceGroup(type, apiCategories),
    leaf: apparelLeaf(type, apiLeafRaw),
  };
}

/** Display fallback when D1 still has legacy group "Kleidung". */
export function spreadEuCatalogCategoryFromTitle(title, stored = {}) {
  const fake = { customerName: String(title || "").trim() };
  const mapped = spreadEuCatalogCategory(fake);
  const storedGroup = String(stored.group || "").trim();
  const storedLeaf = String(stored.leaf || "").trim();
  if (SPREAD_EU_AUDIENCE_GROUPS.includes(storedGroup) && storedLeaf) {
    return { group: storedGroup, leaf: storedLeaf };
  }
  if (storedGroup && storedGroup !== "Kleidung" && storedLeaf && !SPREAD_EU_AUDIENCE_GROUPS.includes(storedGroup)) {
    return { group: storedGroup, leaf: storedLeaf };
  }
  return mapped;
}

export function spreadEuShopifyTaxonomy(type, category = null) {
  const cat = category && category.leaf ? category : spreadEuCatalogCategory(type);
  const leaf = String(cat?.leaf || spreadconnectProductTypeName(type) || "").trim();
  const shortId = getCategoryIdForCategoryName(leaf, leaf) || getCategoryIdForCategoryName(typeNameLower(type), leaf);
  if (!shortId) {
    return {
      shopify_category_id: "gid://shopify/TaxonomyCategory/aa-1",
      shopify_category_name: "Clothing",
    };
  }
  const data = getTaxonomyDataForCategory(shortId, leaf);
  return {
    shopify_category_id: data?.categoryId || `gid://shopify/TaxonomyCategory/${shortId}`,
    shopify_category_name: data?.categoryName || leaf,
  };
}

/**
 * Countries Spreadshirt / Spread Connect EU ships to from the EU warehouse.
 * Documented default (no catalog shipping-countries API). Not US-only.
 */
export const SPREAD_EU_COUNTRY_CODES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "GB", "CH", "NO", "IS", "LI", "AD", "MC", "SM", "VA", "BA", "RS", "ME", "MK", "AL", "UA", "MD", "TR",
  "US", "CA", "MX", "BR", "AR", "CL", "CO", "PE", "UY", "CR", "PA",
  "JP", "KR", "SG", "HK", "TW", "IN", "TH", "MY", "PH", "ID", "VN", "AU", "NZ",
  "AE", "IL", "SA", "QA", "KW", "ZA", "EG", "MA", "TN", "NG", "KE", "GH",
];

const SPREAD_EU_NEAR_ORIGIN = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "GB", "CH", "NO", "IS", "LI",
]);

export function spreadEuDefaultShippingRateCents(countryCode) {
  const cc = String(countryCode || "").trim().toUpperCase();
  if (cc === "DE") return { first: 349, additional: 149 };
  if (SPREAD_EU_NEAR_ORIGIN.has(cc)) return { first: 449, additional: 199 };
  return { first: 699, additional: 299 };
}

export function shouldImportSpreadEuProductType(type) {
  if (!type?.id) return false;
  if (!spreadconnectHasUsablePrintArea(type)) return false;
  const appearances = Array.isArray(type.appearances) ? type.appearances : [];
  return appearances.length > 0;
}
