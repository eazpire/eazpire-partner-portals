/**
 * Persist Amazon bulk-publish batch so the floating dock survives reload.
 * Backend queue jobs keep running; this only restores UI + client polling / missing enqueues.
 */

const STORAGE_KEY = "cr-amazon-publish-batch-v1";

export function loadAmazonPublishBatch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries) || !parsed.entries.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAmazonPublishBatch(batch) {
  try {
    if (!batch?.entries?.length) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batch));
  } catch (e) {
    console.warn("[amazon-publish-batch] save failed:", e?.message || e);
  }
}

export function clearAmazonPublishBatch() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

export function batchHasOpenWork(batch) {
  if (!batch?.entries?.length) return false;
  return batch.entries.some((e) => {
    const st = String(e.status || "").toLowerCase();
    return st !== "done" && st !== "error";
  });
}

export function serializeBatchEntry(item, status = "waiting") {
  const preview =
    (Array.isArray(item.grid_views) && item.grid_views.map((v) => v?.src).find(Boolean)) ||
    item.preview_url ||
    (Array.isArray(item.images) && item.images.find(Boolean)) ||
    (Array.isArray(item.printify_mock_urls) && item.printify_mock_urls.find(Boolean)) ||
    "";
  return {
    shopify_product_id: String(item.shopify_product_id || item.id || "").replace(/\.0$/, "").trim(),
    published_design_id: item.published_design_id != null ? Number(item.published_design_id) : null,
    product_key: String(item.product_key || "").trim(),
    title: String(item.title || item.catalog_product_name || item.product_key || "Product").trim(),
    preview_url: String(preview || "").trim(),
    status,
    message: "",
    enqueued: false,
  };
}

export function createAmazonPublishBatch(items, { continent = "europa" } = {}) {
  return {
    id: `amazon-${Date.now()}`,
    continent: String(continent || "europa").toLowerCase(),
    startedAt: Date.now(),
    entries: (items || []).filter(Boolean).map((item) => serializeBatchEntry(item, "waiting")),
  };
}
