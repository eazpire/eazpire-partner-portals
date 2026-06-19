/**
 * Partner catalog constants
 */

export const PRINTIFY_PARTNER_ID = "mfg_printify";
export const PRINTIFY_PARTNER_SLUG = "printify";

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
