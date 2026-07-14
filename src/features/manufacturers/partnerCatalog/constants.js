/**
 * Partner catalog constants
 */

export const PRINTIFY_PARTNER_ID = "mfg_printify";
export const PRINTIFY_PARTNER_SLUG = "printify";

/** Dogfood / Morocco POD partner — listings go to Shopify without Printify API. */
export const TODIFY_PARTNER_ID = "mfg_todify";
export const TODIFY_PARTNER_SLUG = "todify";
export const TODIFY_FULFILLMENT_EXTERNAL_ID = "ma-1";
export const TODIFY_PROVIDER_DISPLAY_NAME = "Todify";

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
