/**
 * Partner catalog constants
 */

export const PRINTIFY_PARTNER_ID = "mfg_printify";
export const PRINTIFY_PARTNER_SLUG = "printify";

/**
 * Official Printify brand assets (printify.com — favicon.ico returns 404).
 * Prefer square favicon PNG for Catalog Studio avatars; SVG wordmark for wide placements.
 */
export const PRINTIFY_LOGO_URL = "https://printify.com/app/assets/svg/logo.svg";
export const PRINTIFY_ICON_URL = "https://printify.com/pfh/assets/png/favicon-300x300.png";

/** Dogfood / Morocco POD partner — listings go to Shopify without Printify API. */
export const TODIFY_PARTNER_ID = "mfg_todify";
export const TODIFY_PARTNER_SLUG = "todify";
export const TODIFY_FULFILLMENT_EXTERNAL_ID = "ma-1";
/** Brand / Shopify source label (not the Catalog Studio print-provider node). */
export const TODIFY_PROVIDER_DISPLAY_NAME = "Todify";
/** Catalog Studio print-provider label — mirrors company location name. */
export const TODIFY_PRINT_PROVIDER_DISPLAY_NAME = "KNL print";
/** Stable company-location id for Todify MA (source of truth for the print-provider label). */
export const TODIFY_LOCATION_ID = "mloc_todify_ma_1";

/** Spreadshirt parent in Catalog Studio (IDEA-085) — EU + US are fulfillment providers, not top-level partners. */
export const SPREADSHIRT_PARTNER_ID = "mfg_spreadshirt";
export const SPREADSHIRT_PARTNER_SLUG = "spreadshirt";
export const SPREADSHIRT_DISPLAY_NAME = "Spreadshirt";
export const SPREADSHIRT_WEBSITE = "https://www.spreadconnect.com";

/** Spread Connect EU (SPOD rest.spod.com) — Catalog Studio provider under Spreadshirt. */
export const SPREAD_EU_PARTNER_ID = "mfg_spread_eu";
export const SPREAD_EU_PARTNER_SLUG = "spread-eu";
export const SPREAD_EU_FULFILLMENT_EXTERNAL_ID = "spread-eu-1";
export const SPREAD_EU_LOCATION_ID = "mloc_spread_eu_1";
export const SPREAD_EU_PROVIDER_DISPLAY_NAME = "Spread EU";
export const SPREAD_EU_SOURCE_SYSTEM = "spreadconnect_eu";
export const SPREAD_EU_SHOPIFY_PROVIDER = "spreadconnect_eu";
/** Catalog Studio avatar — local partner-static asset. */
export const SPREAD_EU_ICON_URL = "/admin-partner/img/spread-eu-icon.svg";
export const SPREAD_EU_LOGO_URL = SPREAD_EU_ICON_URL;
export const SPREAD_EU_WEBSITE = SPREADSHIRT_WEBSITE;
export const SPREADSHIRT_ICON_URL = SPREAD_EU_ICON_URL;
export const SPREADSHIRT_LOGO_URL = SPREAD_EU_ICON_URL;

/** Spread Connect US — Catalog Studio placeholder provider (no API yet). */
export const SPREAD_US_PARTNER_ID = "mfg_spread_us";
export const SPREAD_US_PARTNER_SLUG = "spread-us";
export const SPREAD_US_FULFILLMENT_EXTERNAL_ID = "spread-us-1";
export const SPREAD_US_LOCATION_ID = "mloc_spread_us_1";
export const SPREAD_US_PROVIDER_DISPLAY_NAME = "Spread US";
export const SPREAD_US_SOURCE_SYSTEM = "spreadconnect_us";
export const SPREAD_US_ICON_URL = "/admin-partner/img/spread-us-icon.svg";
export const SPREAD_US_LOGO_URL = SPREAD_US_ICON_URL;

/** Hidden as top-level Catalog Studio rows — shown as providers under Spreadshirt instead. */
export const HIDDEN_CATALOG_STUDIO_SLUGS = new Set([SPREAD_EU_PARTNER_SLUG, SPREAD_US_PARTNER_SLUG]);

export function isSpreadshirtStudioSlug(slug) {
  return String(slug || "").toLowerCase() === SPREADSHIRT_PARTNER_SLUG;
}

export function partnerUsesFlatProviders(slug) {
  return isSpreadshirtStudioSlug(slug);
}

export function isSpreadEuFulfillmentId(id) {
  const s = String(id || "").trim();
  return s === SPREAD_EU_FULFILLMENT_EXTERNAL_ID || s === "910002";
}

export function isSpreadUsFulfillmentId(id) {
  const s = String(id || "").trim();
  return s === SPREAD_US_FULFILLMENT_EXTERNAL_ID || s === "910003";
}

/**
 * INTEGER print_provider_id columns (CREATOR_DB.product_variant_config, etc.) cannot store
 * opaque partner ids. Map known opaque ids to reserved numeric sentinels outside Printify ranges.
 */
export const OPAQUE_VARIANT_PROVIDER_IDS = Object.freeze({
  [TODIFY_FULFILLMENT_EXTERNAL_ID]: 910001,
  [SPREAD_EU_FULFILLMENT_EXTERNAL_ID]: 910002,
  [SPREAD_US_FULFILLMENT_EXTERNAL_ID]: 910003,
});

/** Coerce Printify numeric ids or known opaque partner ids for INTEGER storage. */
export function coerceVariantConfigProviderId(printProviderId) {
  const n = Number(printProviderId);
  if (Number.isFinite(n) && n > 0) return n;
  const s = String(printProviderId || "").trim();
  if (OPAQUE_VARIANT_PROVIDER_IDS[s] != null) return OPAQUE_VARIANT_PROVIDER_IDS[s];
  return NaN;
}
/**
 * Official Todify brand assets (sourced from https://todify.ma CDN / CloudFront).
 * Prefer square icon for Catalog Studio avatars; logo SVG for wide placements.
 */
export const TODIFY_LOGO_URL = "https://d2vw8tvocudf9g.cloudfront.net/images/logo.svg";
export const TODIFY_ICON_URL = "https://d2vw8tvocudf9g.cloudfront.net/apple-touch-icon.png";

/** Publish profiles with these source_system values skip Printify and create Shopify directly. */
export const DIRECT_SHOPIFY_SOURCE_SYSTEMS = new Set([
  "todify",
  "direct_shopify",
  "spreadconnect_eu",
]);

export function isDirectShopifySourceSystem(sourceSystem) {
  return DIRECT_SHOPIFY_SOURCE_SYSTEMS.has(String(sourceSystem || "").trim().toLowerCase());
}

export const CATALOG_STATUS_TO_IS_ACTIVE = {
  offline: 0,
  preview: 1,
  online: 2,
};

export const IS_ACTIVE_TO_CATALOG_STATUS = {
  0: "offline",
  1: "preview",
  2: "online",
};

export function catalogStatusToIsActive(status) {
  return CATALOG_STATUS_TO_IS_ACTIVE[String(status || "offline").toLowerCase()] ?? 0;
}

export function isActiveToCatalogStatus(isActive) {
  const n = Number(isActive);
  return IS_ACTIVE_TO_CATALOG_STATUS[n] ?? "offline";
}
