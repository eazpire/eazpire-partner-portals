import { parseJson } from "../db.js";

/** Build admin-style by_view map from product_mockup_images rows. */
export function buildMockupImagesByView(images) {
  const byView = {};
  for (const img of images || []) {
    const vk = String(img.view_key || "front")
      .trim()
      .toLowerCase();
    const color = String(img.color_name || "Default").trim() || "Default";
    if (!byView[vk]) byView[vk] = {};
    let variantIds = img.printify_variant_ids;
    if (typeof variantIds === "string") {
      variantIds = parseJson(variantIds, []);
    }
    if (!Array.isArray(variantIds)) variantIds = [];
    byView[vk][color] = {
      image_url: img.image_url || "",
      color_hex: img.color_hex || null,
      is_default: Number(img.is_default) === 1,
      printify_variant_ids: variantIds,
    };
  }
  return byView;
}

export function pickMockUrlForView(byView, viewKey, colorHint = null) {
  const vk = String(viewKey || "front").toLowerCase();
  const viewMap = byView?.[vk];
  if (!viewMap || typeof viewMap !== "object") return "";
  if (colorHint && viewMap[colorHint]?.image_url) return viewMap[colorHint].image_url;
  for (const name of Object.keys(viewMap)) {
    if (viewMap[name]?.is_default && viewMap[name]?.image_url) return viewMap[name].image_url;
  }
  for (const name of Object.keys(viewMap)) {
    if (viewMap[name]?.image_url) return viewMap[name].image_url;
  }
  return "";
}
