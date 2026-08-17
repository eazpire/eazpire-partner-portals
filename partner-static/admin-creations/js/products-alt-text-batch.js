/**
 * Persist Fix-alt-text batches so the dock can restore after reload.
 * Server queue keeps running; this is UI only.
 */

const STORAGE_KEY = "cr-alt-text-fix-batches-v1";

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { batches: [] };
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.batches)) return parsed;
  } catch (_) {}
  return { batches: [] };
}

function writeStore(store) {
  try {
    const batches = (store?.batches || []).filter((b) => Array.isArray(b?.entries) && b.entries.length);
    if (!batches.length) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ batches }));
  } catch (e) {
    console.warn("[alt-text-batch] save failed:", e?.message || e);
  }
}

export function loadAltTextFixBatches() {
  return readStore().batches.slice();
}

export function saveAltTextFixBatch(batch) {
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

export function removeAltTextFixBatch(batchId) {
  const store = readStore();
  store.batches = store.batches.filter((b) => b.id !== batchId);
  writeStore(store);
}

export function altTextBatchHasOpenWork(batch) {
  return (batch?.entries || []).some((e) => {
    const st = String(e.status || "").toLowerCase();
    return st === "queued" || st === "waiting" || st === "pending" || st === "running";
  });
}

export function pruneTerminalAltTextFixBatches() {
  const store = readStore();
  store.batches = store.batches.filter(altTextBatchHasOpenWork);
  writeStore(store);
}

export function createAltTextFixBatch(entries, { batchId } = {}) {
  return {
    id: batchId || `alt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action: "alt-texts",
    startedAt: Date.now(),
    minimized: false,
    entries: (entries || []).map((e) => ({
      shopify_product_id: String(e.shopify_product_id || e.id || "").replace(/\.0$/, ""),
      published_design_id: e.published_design_id != null ? Number(e.published_design_id) : null,
      product_key: String(e.product_key || "").trim(),
      title: String(e.title || e.product_key || "Product").trim(),
      preview_url: String(e.preview_url || "").trim(),
      status: e.status || "queued",
      message: e.message || "",
    })),
  };
}
