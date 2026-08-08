/**
 * Persist Amazon bulk-publish batches so floating docks survive reload.
 * Backend queue jobs keep running; this restores UI + client polling / missing enqueues.
 * Supports multiple parallel batches (queue rail).
 */

const STORAGE_KEY = "cr-amazon-publish-batches-v1";
const LEGACY_KEY = "cr-amazon-publish-batch-v1";

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.batches)) return parsed;
    }
  } catch (_) {}
  // Migrate legacy single-batch key
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const batch = JSON.parse(legacy);
      if (batch && Array.isArray(batch.entries) && batch.entries.length) {
        const store = { batches: [batch] };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        localStorage.removeItem(LEGACY_KEY);
        return store;
      }
    }
  } catch (_) {}
  return { batches: [] };
}

function writeStore(store) {
  try {
    const batches = (store?.batches || []).filter((b) => Array.isArray(b?.entries) && b.entries.length);
    if (!batches.length) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ batches }));
  } catch (e) {
    console.warn("[amazon-publish-batch] save failed:", e?.message || e);
  }
}

export function loadAmazonPublishBatches() {
  return readStore().batches.slice();
}

/** @deprecated use loadAmazonPublishBatches — returns newest open batch or null */
export function loadAmazonPublishBatch() {
  const open = loadAmazonPublishBatches().filter(batchHasOpenWork);
  return open.length ? open[open.length - 1] : null;
}

export function saveAmazonPublishBatch(batch) {
  if (!batch?.id) return;
  const store = readStore();
  const idx = store.batches.findIndex((b) => b.id === batch.id);
  if (!batch.entries?.length) {
    if (idx >= 0) store.batches.splice(idx, 1);
  } else if (idx >= 0) {
    store.batches[idx] = batch;
  } else {
    store.batches.push(batch);
  }
  writeStore(store);
}

export function removeAmazonPublishBatch(batchId) {
  const store = readStore();
  store.batches = store.batches.filter((b) => b.id !== batchId);
  writeStore(store);
}

export function clearAmazonPublishBatch() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch (_) {}
}

export function batchHasOpenWork(batch) {
  if (!batch?.entries?.length) return false;
  return batch.entries.some((e) => {
    const st = String(e.status || "").toLowerCase();
    return st !== "done" && st !== "error";
  });
}

/**
 * True if the dock should stay/restore for this batch.
 * Only in-flight work — terminal errors do not keep the UI open
 * (toast already summarized; user can start a new publish cleanly).
 */
export function batchNeedsUi(batch) {
  return batchHasOpenWork(batch);
}

/** Drop settled batches (all done/error) from localStorage. */
export function pruneTerminalAmazonPublishBatches() {
  const store = readStore();
  const before = store.batches.length;
  store.batches = store.batches.filter(batchHasOpenWork);
  if (store.batches.length !== before) writeStore(store);
  return before - store.batches.length;
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

export function createAmazonPublishBatch(items, { continent = "europa", marketplace_codes = null } = {}) {
  const codes = Array.isArray(marketplace_codes)
    ? marketplace_codes.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean)
    : continent === "amerika" || continent === "us"
      ? ["US"]
      : ["DE"];
  return {
    id: `amazon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    continent: String(continent || "europa").toLowerCase(),
    marketplace_codes: codes,
    startedAt: Date.now(),
    kind: "publish",
    title: codes.length === 1 ? `Amazon ${codes[0]} publish` : "Amazon publish",
    minimized: false,
    entries: (items || []).filter(Boolean).map((item) => serializeBatchEntry(item, "waiting")),
  };
}
