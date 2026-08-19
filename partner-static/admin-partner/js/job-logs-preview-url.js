/**
 * Partner Admin Logs — pick the mockup that matches the job source.
 * Same fallback idea as Creations `products-preview-url.js` / grid_views.
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
 * @param {object} row public job-log item (type + preview fields)
 * @returns {string}
 */
export function jobLogPreviewUrl(row) {
  if (!row || typeof row !== "object") return "";
  const fromGrid = Array.isArray(row.grid_views)
    ? row.grid_views.map((v) => v?.src).find(Boolean)
    : "";
  const fromImages = Array.isArray(row.images) ? row.images.find(Boolean) : "";
  const printify = firstUrl(row.printify_preview_url, row.printify_mock_urls, fromGrid);
  const shopify = firstUrl(row.shopify_preview_url, row.shopify_image_url);
  const amazon = firstUrl(row.amazon_preview_url, row.amazon_image_url);
  const fallback = firstUrl(printify, shopify, amazon, row.preview_url, fromImages, row.mock_url);
  const type = String(row.type || "");
  if (type === "printify_publish") return firstUrl(printify, fallback);
  if (type === "shopify_publish") return firstUrl(shopify, fallback);
  if (type === "amazon_publish") return firstUrl(amazon, shopify, printify, fallback);
  return fallback;
}
