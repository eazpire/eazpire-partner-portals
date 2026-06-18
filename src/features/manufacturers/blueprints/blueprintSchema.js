/**
 * Eazpire Universal Blueprint — constants and helpers (V1)
 */

export const SCHEMA = "eazpire.universal_blueprint";
export const SCHEMA_VERSION = "1.0.0";

export const PROVIDER_STATUSES = new Set([
  "draft",
  "uploaded",
  "parsed",
  "validation_failed",
  "normalized",
  "needs_mapping",
  "preview_ready",
  "pending_admin_review",
  "pending_partner_fix",
  "approved",
  "live",
  "deprecated",
  "archived",
  "rejected",
]);

export const EAZPIRE_STATUSES = new Set([
  "draft",
  "normalized",
  "preview_ready",
  "pending_admin_review",
  "pending_partner_fix",
  "approved",
  "live",
  "deprecated",
  "rejected",
]);

export const ARTIFACT_SLOT_BY_CATEGORY = {
  "apparel.hoodie": "upper_body",
  "apparel.tshirt": "upper_body",
  "apparel.sweater": "upper_body",
  "apparel.jacket": "layer",
  "apparel.pants": "pants",
  "apparel.socks": "socks",
  "accessory.cap": "head",
  "accessory.bag": "accessory_1",
  "accessory.phone_case": "accessory_2",
  "wall_art.poster": "museum_collectible",
  "home.mug": "accessory_1",
  "stationery.sticker": "accessory_2",
};

export function inferArtifactSlot(normalizedCategory) {
  if (!normalizedCategory) return null;
  return ARTIFACT_SLOT_BY_CATEGORY[normalizedCategory] || null;
}

export function hashJson(obj) {
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return `h${Math.abs(h).toString(36)}`;
}

export function slugBlueprintKey(title) {
  return String(title || "blueprint")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "blueprint";
}
