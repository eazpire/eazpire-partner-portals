/**
 * Pure mapping helpers for Spread EU catalog import (IDEA-085).
 */

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

export function spreadconnectHasFrontPrintArea(type) {
  const areas = Array.isArray(type?.printAreas) ? type.printAreas : [];
  return areas.some(
    (a) => String(a.view || "").toUpperCase() === "FRONT" && Number(a.widthMm) > 0 && Number(a.heightMm) > 0
  );
}

export function spreadconnectIsNonApparel(type) {
  const n = spreadconnectProductTypeName(type).toLowerCase();
  return /mug|tasse|cup|becher|bottle|flasche|tumbler|glass|poster|canvas|sticker|phone|hülle|huelle|case|pillow|kissen|tote|bag|sock|mouse\s*pad|flag|puzzle|magnet|hat|cap|beanie|apron/.test(
    n
  );
}

export function spreadconnectApparelKind(type) {
  const n = spreadconnectProductTypeName(type).toLowerCase();
  if (spreadconnectIsNonApparel(type)) return null;
  if (/hoodie|kapuzen/.test(n) && /zip|reiß|reiss/.test(n)) return "zip-hoodie";
  if (/hoodie|kapuzen/.test(n)) return "hoodie";
  if (/tank|singlet|ärmellos|aermellos/.test(n)) return "tank";
  if (/long\s*sleeve|longsleeve|langarm/.test(n)) return "longsleeve";
  if (/polo/.test(n)) return "polo";
  if (/sweat|crewneck|pullover/.test(n)) return "sweat";
  if (/(women|ladies|damen|femme|frauen)/.test(n) && /t[- ]?shirt|tee\b/.test(n)) return "womens-tee";
  if (/(men|herren|homme)/.test(n) && /t[- ]?shirt|tee\b/.test(n)) return "mens-tee";
  if (/t[- ]?shirt|tee\b/.test(n)) return "tee";
  return null;
}

export function spreadconnectDefaultD2cPrice(type) {
  const kind = spreadconnectApparelKind(type);
  if (kind === "hoodie" || kind === "sweat" || kind === "zip-hoodie") return 29.99;
  if (kind === "longsleeve" || kind === "polo") return 24.99;
  return 19.99;
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
 */
export function buildSpreadEuCatalogProductData(type) {
  const typeId = type?.id;
  const appearances = Array.isArray(type?.appearances) ? type.appearances : [];
  const sizes = Array.isArray(type?.sizes) ? type.sizes : [];
  const d2c = spreadconnectDefaultD2cPrice(type);
  const costCents = Math.round(d2c * 100);

  const colorValues = appearances
    .map((a) => ({
      id: Number(a.id),
      title: String(a.name || a.id).trim() || String(a.id),
    }))
    .filter((v) => Number.isFinite(v.id) && v.id > 0);
  const sizeValues = sizes
    .map((s) => ({
      id: Number(s.id),
      title: String(s.name || s.id).trim() || String(s.id),
    }))
    .filter((v) => Number.isFinite(v.id) && v.id > 0);

  const variants = [];
  const configVariants = {};
  for (const appearance of appearances) {
    const appearanceId = Number(appearance.id);
    const colorName = String(appearance.name || appearanceId).trim() || String(appearanceId);
    for (const size of sizes) {
      const sizeId = Number(size.id);
      if (!Number.isFinite(appearanceId) || !Number.isFinite(sizeId)) continue;
      const id = spreadconnectSyntheticVariantId(typeId, appearanceId, sizeId);
      const sizeName = String(size.name || sizeId).trim() || String(sizeId);
      variants.push({
        id,
        title: `${colorName} / ${sizeName}`,
        options: [appearanceId, sizeId],
        cost: costCents,
        is_enabled: true,
        sku: `${typeId}-P${appearanceId}S${sizeId}`,
      });
      configVariants[String(id)] = { enabled: true };
    }
  }

  return {
    product_data: {
      id: String(typeId || ""),
      title: spreadconnectProductTypeName(type) || `Spread EU ${typeId}`,
      options: [
        { name: "Color", type: "color", values: colorValues },
        { name: "Size", type: "size", values: sizeValues },
      ],
      variants,
    },
    variants_json: variants,
    variant_config: {
      global: { profit_mode: "percent", profit_value: 0, branding: "none" },
      variants: configVariants,
    },
    d2c_price: d2c,
  };
}

/** EU shipping countries used for Spread EU catalog plans. */
export const SPREAD_EU_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
];

export function shouldImportSpreadEuProductType(type) {
  if (!type?.id) return false;
  if (!spreadconnectHasFrontPrintArea(type)) return false;
  if (spreadconnectIsNonApparel(type)) return false;
  const appearances = Array.isArray(type.appearances) ? type.appearances : [];
  const sizes = Array.isArray(type.sizes) ? type.sizes : [];
  return appearances.length > 0 && sizes.length > 0;
}
