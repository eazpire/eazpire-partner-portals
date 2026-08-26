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
 * Catalog Studio path for one Spread product type.
 *
 * Regeln (einfach):
 * 1. Spezifischer Produktname zuerst (Brotdose, Bandana, Hose, Polo, Hoodie …).
 *    Niemals T-Shirt nur weil irgendwo „shirt“ vorkommt.
 * 2. Kleidung bekommt Eltern Unisex / Male / Female / Kids / Toddler.
 *    „Männer“ / „Herren“ / Men im Namen → Male (auch wenn die API Unisex sagt).
 *    „Frauen“ / „Damen“ / Women → Female.
 * 3. Nicht-Kleidung bekommt NIE Unisex/Male/Female als Eltern:
 *    Accessoires, Taschen, Drinkware, Home, Wall Art, Tech, Papier, Kueche, Schuhe.
 * 4. Unbekannte Kleidung → Other apparel — niemals stiller Fallback auf T-Shirt.
 */

/** [regex, group, leaf] — first match wins. German compounds, no weak \bshirt\b. */
const NON_APPAREL_RULES = [
  [/minifeet|teddy|plüsch|pluesch|plush/, "Accessoires", "Teddy"],
  [/\b(buttons?|pins?|anstecker)\b/, "Accessoires", "Pin / Button"],
  [/bandana/, "Accessoires", "Bandana"],
  [/schlüsselanhänger|schluesselanhaenger|keychain|key[\s-]?ring/, "Accessoires", "Keychain"],
  [/regenschirm|umbrella/, "Accessoires", "Umbrella"],
  [/lätzchen|laetzchen|\bbib\b/, "Accessoires", "Bib"],
  [/baseballkappe|mütze|muetze|beanie|kappe|\bcap\b|\bhat\b/, "Accessoires", "Hat / Cap"],
  [/rucksack|backpack/, "Taschen", "Backpack"],
  [/shopper|tote|stoffbeutel|turnbeutel|einkaufstasche/, "Taschen", "Tote Bag"],
  [/handtasche|handbag/, "Taschen", "Handbag"],
  [/tasche|täschchen|taeschchen|beutel|pouch|\bbag\b|gürteltasche|guerteltasche|kulturtasche|federtasche/, "Taschen", "Bag"],
  [/bierkrug|\bkrug\b|stein mug|\bmugs?\b|tasse|becher|\bcup\b/, "Drinkware", "Mug"],
  [/tumbler/, "Drinkware", "Tumbler"],
  [/flasche|water[\s-]?bottle/, "Drinkware", "Water Bottle"],
  [/\b(glass|glas)\b/, "Drinkware", "Glass"],
  [/untersetzer|coaster/, "Drinkware", "Coaster"],
  [/brotdose|keksdose|lunch[\s-]?box|\bdose\b/, "Home", "Lunch Box"],
  [/poster/, "Wall Art", "Poster"],
  [/canvas|leinwand/, "Wall Art", "Canvas"],
  [/flag|fahne|banner/, "Wall Art", "Flag / Banner"],
  [/kissen|pillow/, "Home", "Pillow"],
  [/\bdecke\b|kuscheldecke|blanket/, "Home", "Blanket"],
  [/magnet/, "Home", "Magnet"],
  [/ofenhandschuh|topflappen|geschirrtuch|oven[\s-]?mitt|pot[\s-]?holder/, "Kueche", "Kitchen"],
  [/sticker|aufkleber/, "Papier", "Sticker"],
  [/puzzle/, "Papier", "Puzzle"],
  [/mouse\s*pad|mauspad/, "Tech", "Mouse Pad"],
  [/handyhülle|handyhuelle|phone[\s-]?case|\bhülle\b|\bhuelle\b/, "Tech", "Phone Case"],
  [/badelatschen|slipper|flip[\s-]?flop|sandal/, "Schuhe", "Shoes"],
];

/** Apparel kinds, specific → generic. First match wins. */
const APPAREL_KIND_RULES = [
  [/kleid|\bdress\b/, "dress"],
  [/badeanzug|bikini|badeshorts|swim\s*wear|swimsuit/, "swimwear"],
  [/schlafanzug|pajama|pyjama|sleepwear/, "pajamas"],
  [/strampler|onesie|romper|babybody|kontrastbody|\bbody\b/, "body"],
  [/bodysuit/, "bodysuit"],
  [/hoodie|kapuzen/, "hoodie-family"],
  [/tank|singlet|ärmellos|aermellos|sleeveless|spaghettiträger|spaghettitraeger|bandeau/, "tank"],
  [/crop/, "crop"],
  [/polo/, "polo"],
  [/long\s*sleeve|longsleeve|langarm/, "longsleeve"],
  [/trikot|jersey|shooting\s*shirt/, "jersey"],
  [/jacke|jacket|blouson|softshell/, "jacket"],
  [/weste|\bvest\b/, "vest"],
  [/zip\s*top|ziptop/, "pullover"],
  [/sweatshorts|hot\s*pants|boxer/, "shorts-family"],
  [/\bshorts?\b/, "shorts"],
  [/tights|legging/, "leggings"],
  [/jogginghose|sweathose|sweatpant|jogger/, "joggers"],
  [/trainingshose|freizeithose|sporthose|hose|pants|trousers/, "pants"],
  [/sock|socken/, "socks"],
  [/apron|schürze|schuerze/, "apron"],
  [/sweat|crewneck|pullover/, "sweat"],
  [/t[- ]?shirt|\btee\b/, "tee"],
  [/hemd|oxford|blouse|button[\s-]?down/, "shirt"],
  [/\bshirt\b/, "shirt"],
];

function matchFirstRule(n, rules) {
  for (const [re, a, b] of rules) {
    if (re.test(n)) return b == null ? a : { group: a, leaf: b };
  }
  return null;
}

function resolveHoodieKind(n) {
  if (/zip|reiß|reiss/.test(n)) return "zip-hoodie";
  return "hoodie";
}

function resolveShortsKind(n) {
  if (/boxer|underwear|slip\b/.test(n) && !/bade/.test(n)) return "underwear";
  return "shorts";
}

export function spreadconnectMatchNonApparel(type) {
  const n = typeNameLower(type);
  if (!n) return null;
  if (/\b(buttons?|pins?|anstecker)\b/.test(n) && /shirt|blouse|jacke|jacket/.test(n)) return null;
  return matchFirstRule(n, NON_APPAREL_RULES);
}

export function spreadconnectIsNonApparel(type) {
  return spreadconnectMatchNonApparel(type) != null;
}

export function spreadconnectApparelKind(type) {
  const n = typeNameLower(type);
  if (!n || spreadconnectIsNonApparel(type)) return null;
  const kind = matchFirstRule(n, APPAREL_KIND_RULES);
  if (kind === "hoodie-family") return resolveHoodieKind(n);
  if (kind === "shorts-family") return resolveShortsKind(n);
  if (kind === "tee") {
    if (/(women|ladies|damen|femme|frauen)/.test(n)) return "womens-tee";
    if (/(men|herren|homme|männer|maenner)/.test(n)) return "mens-tee";
    return "tee";
  }
  return kind;
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
  if (kind === "sweat" || kind === "pullover") return "Sweatshirt";
  if (kind === "tank") return "Tank Top";
  if (kind === "longsleeve") return "Long Sleeve";
  if (kind === "polo") return "Polo Shirt";
  if (kind === "jacket") return "Jacket";
  if (kind === "vest") return "Vest";
  if (kind === "crop") return "Crop Top";
  if (kind === "shorts") return "Shorts";
  if (kind === "pants") return "Pants";
  if (kind === "joggers") return "Joggers";
  if (kind === "leggings") return "Leggings";
  if (kind === "dress") return "Dress";
  if (kind === "jersey") return "Jersey";
  if (kind === "swimwear") return "Swimwear";
  if (kind === "pajamas") return "Pajamas";
  if (kind === "underwear") return "Underwear";
  if (kind === "body") return "Body";
  if (kind === "bodysuit") return "Bodysuit";
  if (kind === "socks") return "Socks";
  if (kind === "apron") return "Apron";
  if (kind === "shirt") return "Shirt";
  if (kind === "womens-tee" || kind === "mens-tee" || kind === "tee") return "T-Shirt";
  return null;
}

function nonApparelGroupAndLeaf(n, apiGroupRaw, apiLeafRaw) {
  const fromName = spreadconnectMatchNonApparel({ customerName: n });
  if (fromName) return fromName;
  const group = SPREAD_NON_APPAREL_GROUP_TO_STUDIO[apiGroupRaw] || "Accessoires";
  const leaf = SPREAD_API_LEAF_TO_STUDIO[apiLeafRaw] || apiLeafRaw || "Other";
  return { group, leaf };
}

const NAME_WOMEN_RE = /\b(wom[ae]n'?s?|ladies|lady|damen|femme|frauen|weiblich|female)\b/;
const NAME_MEN_RE = /\b(men'?s?|\bmens\b|\bmale\b|herren|homme|männer|maenner|männlich|maennlich)\b/;
const NAME_UNISEX_RE = /\bunisex\b/;
const NAME_TODDLER_RE =
  /\b(baby|toddler|infant|newborn|new[\s-]?born|onesie|romper|strampler|säugling|saeugling|neugeboren|babybody|babykleidung)\b/;
const NAME_KIDS_RE = /\b(kids?|child|children|youth|junior|kinder|teenager|teen)\b/;
const NAME_GIRL_BOY_RE = /\b(girls?|boys?|junge|jungen|mädchen|maedchen)\b/;

function nameHasWomen(n) {
  return NAME_WOMEN_RE.test(n);
}
function nameHasMen(n) {
  return NAME_MEN_RE.test(n);
}

/**
 * Zielgruppe: Name schlägt API.
 * Männer/Herren im Produktnamen → Male, auch wenn Spread „Unisex“ liefert.
 */
export function spreadconnectAudienceGroup(type, apiCategories = null) {
  const name = typeNameLower(type);
  if (NAME_TODDLER_RE.test(name)) return "Toddler";
  if (NAME_KIDS_RE.test(name)) return "Kids";
  if (NAME_GIRL_BOY_RE.test(name) && !nameHasWomen(name) && !nameHasMen(name)) return "Kids";

  const nameWomen = nameHasWomen(name);
  const nameMen = nameHasMen(name);
  const nameUnisex = NAME_UNISEX_RE.test(name);
  if (nameWomen && nameMen) return "Unisex";
  if (nameWomen) return "Female";
  if (nameMen) return "Male";
  if (nameUnisex) return "Unisex";

  const genderTexts = collectSpreadTranslations(apiCategories?.genders).map((t) => t.toLowerCase());
  const apiHasWomen = genderTexts.some((g) => NAME_WOMEN_RE.test(g) || /\bfemale\b/.test(g));
  const apiHasMen = genderTexts.some((g) => NAME_MEN_RE.test(g) || /\bmale\b/.test(g));
  const apiHasUnisex = genderTexts.some((g) => NAME_UNISEX_RE.test(g));
  const apiHasKids = genderTexts.some((g) => NAME_KIDS_RE.test(g));
  if (apiHasKids) return "Kids";
  if (apiHasWomen && !apiHasMen) return "Female";
  if (apiHasMen && !apiHasWomen) return "Male";
  if (apiHasUnisex || (apiHasWomen && apiHasMen)) return "Unisex";
  return "Unisex";
}

function apparelLeaf(type, apiLeafRaw) {
  const kind = spreadconnectApparelKind(type);
  const fromKind = studioLeafFromKind(kind);
  if (fromKind) return fromKind;
  if (apiLeafRaw === "Pullover & Hoodies") return kind === "sweat" ? "Sweatshirt" : "Hoodie";
  if (apiLeafRaw === "T-Shirts" || apiLeafRaw === "Bekleidung" || apiLeafRaw === "Babykleidung") {
    return "Other apparel";
  }
  if (apiLeafRaw && SPREAD_API_LEAF_TO_STUDIO[apiLeafRaw]) return SPREAD_API_LEAF_TO_STUDIO[apiLeafRaw];
  if (apiLeafRaw) return apiLeafRaw;
  return "Other apparel";
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

  const nonApparel = spreadconnectMatchNonApparel(type);
  if (nonApparel) return nonApparel;

  const kind = spreadconnectApparelKind(type);
  if (!kind && SPREAD_NON_APPAREL_GROUP_TO_STUDIO[apiGroupRaw]) {
    return nonApparelGroupAndLeaf(n, apiGroupRaw, apiLeafRaw);
  }

  return {
    group: spreadconnectAudienceGroup(type, apiCategories),
    leaf: apparelLeaf(type, apiLeafRaw),
  };
}

/** Live sidebar mapping from the product title (ignores leftover D1 dumps). */
export function spreadEuCatalogCategoryFromTitle(title, _stored = {}) {
  return spreadEuCatalogCategory({ customerName: String(title || "").trim() });
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
