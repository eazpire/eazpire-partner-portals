/**
 * Creations Logs — thumbnail is the current Shopify featured / preview mock only.
 * No Printify default, no raw design artwork. Empty placeholder when Shopify has no image.
 */

function firstUrl(...vals) {
  for (const v of vals) {
    if (Array.isArray(v)) {
      const inner = firstUrl(...v);
      if (inner) return inner;
      continue;
    }
    if (v && typeof v === "object") {
      const inner = firstUrl(v.src, v.url, v.image_url, v.preview_url, v.mock_url);
      if (inner) return inner;
      continue;
    }
    const s = String(v || "").trim();
    if (!s) continue;
    if (s.startsWith("//")) return `https:${s}`;
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

/**
 * @param {object} row public job-log item
 * @returns {string}
 */
export function jobLogPreviewUrl(row) {
  if (!row || typeof row !== "object") return "";
  return firstUrl(row.shopify_preview_url, row.shopify_image_url);
}
