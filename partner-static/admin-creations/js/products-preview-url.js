/**
 * Prefer grid mock / Printify mocks — preview_url alone is often empty on Softstyle rows.
 * @param {object} item
 * @returns {string}
 */
export function itemPreviewUrl(item) {
  if (!item || typeof item !== "object") return "";
  const fromGrid = Array.isArray(item.grid_views)
    ? item.grid_views.map((v) => v?.src).find(Boolean)
    : "";
  const fromImages = Array.isArray(item.images) ? item.images.find(Boolean) : "";
  const fromPrintify = Array.isArray(item.printify_mock_urls)
    ? item.printify_mock_urls.find(Boolean)
    : "";
  return String(
    fromGrid || item.preview_url || fromImages || fromPrintify || item.mock_url || ""
  ).trim();
}
