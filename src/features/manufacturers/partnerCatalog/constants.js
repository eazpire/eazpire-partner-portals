/**
 * Partner catalog constants
 */

export const PRINTIFY_PARTNER_ID = "mfg_printify";
export const PRINTIFY_PARTNER_SLUG = "printify";

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

/**
 * Official Todify brand assets (sourced from https://todify.ma CDN / CloudFront).
 * Prefer square icon for Catalog Studio avatars; logo SVG for wide placements.
 */
export const TODIFY_LOGO_URL = "https://d2vw8tvocudf9g.cloudfront.net/images/logo.svg";
export const TODIFY_ICON_URL = "https://d2vw8tvocudf9g.cloudfront.net/apple-touch-icon.png";

/** Publish profiles with these source_system values skip Printify and create Shopify directly. */
export const DIRECT_SHOPIFY_SOURCE_SYSTEMS = new Set(["todify", "direct_shopify"]);

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
