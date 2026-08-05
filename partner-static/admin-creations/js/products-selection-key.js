/**
 * Unique per Shopify/listing row — NOT catalog product_key.
 * Softstyle (and other) multi-listings share product_key; using it collapsed
 * Select-all of 8 Softstyle tees into 1 Publish-modal row.
 *
 * @param {object} item
 * @returns {string}
 */
export function selectionKey(item) {
  const rawSid = String(item?.shopify_product_id || item?.id || "")
    .replace(/^gid:\/\/shopify\/Product\//i, "")
    .replace(/\.0$/, "")
    .trim();
  if (rawSid && !/^studio:/i.test(rawSid) && /^\d+$/.test(rawSid)) {
    return `sid:${rawSid}`;
  }
  const pd = String(item?.published_design_id || "").trim();
  if (pd) return `pd:${pd}`;
  const printify = String(item?.printify_product_id || "").trim();
  if (printify) return `pf:${printify}`;
  const pk = String(item?.product_key || item?.filter_product_key || "").trim();
  const design = String(item?.design_id || "").trim();
  if (pk && design) return `pk:${pk}:d:${design}`;
  return String(item?.id || pk || "").trim();
}
