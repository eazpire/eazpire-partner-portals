/**
 * Creations Portal Products — floating bulk-action progress dock with per-product lock (IDEA-063).
 * Runs a caller-supplied `runItem` for each selected product sequentially, acquiring an
 * admin product-action lock (src/features/manufacturers/adminCreationsProductActionLock.js)
 * before the call and releasing it right after, so the grid can hide/overlay busy products
 * via getBusyProductKeys()/getBusyShopifyIds() while the action is in flight.
 *
 * Amazon Publish: enqueue then poll until continent is live; dock stays open until every
 * selected product succeeds (errors keep the dock visible).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";
import { bindProdCarousels, productCarouselHtml } from "./designs-product-media.js";
import { itemPreviewUrl } from "./products-preview-url.js";
import {
  batchHasOpenWork,
  clearAmazonPublishBatch,
  createAmazonPublishBatch,
  loadAmazonPublishBatch,
  saveAmazonPublishBatch,
} from "./products-amazon-publish-batch.js";

export { itemPreviewUrl };

const busyProductKeys = new Set();
const busyShopifyIds = new Set();
let activeEntries = [];
let clearTimer = null;
let onBusyChange = null;
/** Prevents double-running enqueue/poll loops after reload. */
let amazonBatchLoopPromise = null;
let amazonBatchOnDone = null;

const AMAZON_LIVE = new Set(["published", "live", "listed"]);
const AMAZON_FAIL = new Set(["failed", "error", "suppressed", "invalid"]);
const AMAZON_IN_FLIGHT = new Set(["queued", "publishing", "feed_pending", "processing", "verifying", "pending_indexing"]);

export function getBusyProductKeys() {
  return new Set(busyProductKeys);
}

export function getBusyShopifyIds() {
  return new Set(busyShopifyIds);
}

/** Notified whenever a product becomes busy/idle, so the grid can re-filter it in/out. */
export function setBusyChangeListener(fn) {
  onBusyChange = typeof fn === "function" ? fn : null;
}

function notifyBusyChange() {
  if (typeof onBusyChange === "function") onBusyChange();
}

function itemProductKey(item) {
  return String(item?.product_key || item?.id || "").trim();
}

function itemShopifyId(item) {
  return String(item?.shopify_product_id || item?.id || "").trim();
}

function itemTitle(item) {
  return String(item?.title || item?.product_key || "Product").trim() || "Product";
}

function actionLabel(action) {
  if (action === "publish") return "Publishing";
  if (action === "unpublish") return "Unpublishing";
  if (action === "update") return "Updating";
  return "Working";
}

function actionDonePast(action) {
  if (action === "publish") return "published";
  if (action === "unpublish") return "unpublished";
  if (action === "update") return "updated";
  return "processed";
}

function statusLabel(status) {
  if (status === "locking") return "Locking…";
  if (status === "running") return "Working…";
  if (status === "waiting" || status === "pending") return "Waiting…";
  if (status === "publishing") return "Publishing…";
  if (status === "done") return "Done";
  if (status === "error") return "Error";
  return "Waiting…";
}

function entryFromBatchRow(row) {
  return {
    item: {
      shopify_product_id: row.shopify_product_id,
      id: row.shopify_product_id,
      published_design_id: row.published_design_id,
      product_key: row.product_key,
      title: row.title,
      preview_url: row.preview_url,
      grid_views: row.preview_url ? [{ src: row.preview_url }] : [],
    },
    status: row.status || "waiting",
    message: row.message || "",
    sessionId: null,
    enqueued: !!row.enqueued,
  };
}

function syncBatchFromEntries(batch) {
  if (!batch) return;
  batch.entries = activeEntries.map((e) => ({
    shopify_product_id: itemShopifyId(e.item),
    published_design_id:
      e.item.published_design_id != null ? Number(e.item.published_design_id) : null,
    product_key: String(e.item.product_key || "").trim(),
    title: itemTitle(e.item),
    preview_url: itemPreviewUrl(e.item),
    status: e.status,
    message: e.message || "",
    enqueued: !!e.enqueued,
  }));
  saveAmazonPublishBatch(batch);
}

async function mapPool(items, concurrency, worker) {
  const list = [...items];
  const limit = Math.max(1, Number(concurrency) || 1);
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (list.length) {
      const next = list.shift();
      if (next === undefined) return;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

function ensureDock() {
  let dock = document.getElementById("cr-products-action-dock");
  if (dock) return dock;
  dock = document.createElement("div");
  dock.id = "cr-products-action-dock";
  dock.className = "cr-publish-dock cr-products-action-dock";
  dock.hidden = true;
  dock.setAttribute("aria-hidden", "true");
  dock.innerHTML = `
    <div class="cr-publish-dock__panel" role="status" aria-live="polite">
      <div class="cr-publish-dock__head">
        <span class="cr-publish-dock__title" id="cr-products-action-dock-title">Working…</span>
        <span class="cr-publish-dock__count" id="cr-products-action-dock-count"></span>
      </div>
      <div class="cr-publish-dock__carousel" id="cr-products-action-dock-carousel"></div>
    </div>`;
  document.body.appendChild(dock);
  return dock;
}

function cardHtml(entry) {
  const { item, status, message } = entry;
  const title = itemTitle(item);
  const preview = itemPreviewUrl(item);
  const busy = status === "locking" || status === "running" || status === "publishing";
  const overlay = busy
    ? `<div class="cr-dd-prod__job" aria-live="polite"><div class="cr-dd-prod__spinner" aria-hidden="true"></div><span class="cr-dd-prod__job-label">${escapeHtml(
        statusLabel(status)
      )}</span></div>`
    : status === "error"
      ? `<div class="cr-dd-prod__job cr-dd-prod__job--error"><span class="cr-dd-prod__job-label">${escapeHtml(
          message || "Failed"
        )}</span></div>`
      : status === "done"
        ? `<div class="cr-dd-prod__job cr-dd-prod__job--done"><span class="cr-dd-prod__job-label">Done</span></div>`
        : "";
  return `<article class="cr-dd-prod cr-publish-dock__card cr-products-action-dock__card${
    status === "error" ? " is-job-error" : status === "done" ? " is-job-done" : ""
  }" data-status="${escapeHtml(status)}">
    <div class="cr-dd-prod__media">
      ${
        preview
          ? `<img class="cr-dd-prod__mock" src="${escapeHtml(preview)}" alt="" loading="lazy" decoding="async" />`
          : '<span class="cr-dd-prod__empty">No image</span>'
      }
      ${overlay}
    </div>
    <span class="cr-publish-dock__status cr-publish-dock__status--${escapeHtml(status)}">${escapeHtml(
    statusLabel(status)
  )}</span>
    <div class="cr-dd-prod__title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
  </article>`;
}

function renderDock(action) {
  const dock = ensureDock();
  const titleEl = document.getElementById("cr-products-action-dock-title");
  const countEl = document.getElementById("cr-products-action-dock-count");
  const carouselHost = document.getElementById("cr-products-action-dock-carousel");

  if (!activeEntries.length) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
    if (carouselHost) carouselHost.innerHTML = "";
    return;
  }

  dock.hidden = false;
  dock.classList.add("is-visible");
  dock.setAttribute("aria-hidden", "false");

  const done = activeEntries.filter((e) => e.status === "done").length;
  const errored = activeEntries.filter((e) => e.status === "error").length;
  const total = activeEntries.length;
  if (titleEl) {
    if (errored && done + errored === total) titleEl.textContent = `${actionLabel(action)} — errors`;
    else if (done === total) titleEl.textContent = `${actionLabel(action)} complete`;
    else titleEl.textContent = `${actionLabel(action)}…`;
  }
  if (countEl) countEl.textContent = `${done}/${total} done${errored ? ` · ${errored} error${errored === 1 ? "" : "s"}` : ""}`;
  if (carouselHost) {
    carouselHost.innerHTML = productCarouselHtml(activeEntries.map(cardHtml).join(""));
    bindProdCarousels(carouselHost);
  }
}

/**
 * Auto-hide dock only when every card is Done (no errors, nothing in flight).
 * Failed Amazon publishes keep the dock so the admin can see which products failed.
 */
function clearDockSoonIfAllSucceeded() {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (!activeEntries.length) return;
    if (activeEntries.some((e) => e.status !== "done")) return;
    activeEntries = [];
    renderDock();
  }, 3500);
}

async function acquireProductLock(item, action) {
  try {
    const res = await partnerFetch("admin-creations-product-action-lock", {
      method: "POST",
      body: {
        product_key: item.product_key || "",
        shopify_product_id: item.shopify_product_id || item.id || "",
        title: itemTitle(item),
        action,
      },
    });
    return res?.session_id || null;
  } catch (e) {
    console.warn("[products-action-dock] lock failed:", e?.message || e);
    return null;
  }
}

async function releaseProductLock(sessionId) {
  if (!sessionId) return;
  try {
    await partnerFetch("admin-creations-product-action-unlock", { method: "POST", body: { session_id: sessionId } });
  } catch (e) {
    console.warn("[products-action-dock] unlock failed:", e?.message || e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll admin-amazon-publish-status until europa (or given continent) is live/failed/timeout.
 * @param {string|number} publishedDesignId
 * @param {{ continent?: string, maxMs?: number, onTick?: (info:object) => void }} [opts]
 */
export async function waitForAmazonContinentLive(publishedDesignId, opts = {}) {
  const id = Number(publishedDesignId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("missing published_design_id");
  const continent = String(opts.continent || "europa").trim().toLowerCase() || "europa";
  const maxMs = Number(opts.maxMs) > 0 ? Number(opts.maxMs) : 12 * 60 * 1000;
  const started = Date.now();
  let delay = 0; // first status check immediately after enqueue
  let lastStatus = "";

  while (Date.now() - started < maxMs) {
    if (delay > 0) await sleep(delay);
    const elapsed = Date.now() - started;
    const query = { published_design_id: String(id) };
    // Final sync pull near the end of the window
    if (elapsed > maxMs - 45000) query.sync = "1";
    const data = await partnerFetch("admin-amazon-publish-status", { query });
    const cont = data?.continents?.[continent] || null;
    const st = String(cont?.status || "").toLowerCase();
    lastStatus = st || lastStatus;
    if (typeof opts.onTick === "function") opts.onTick({ status: st, continent, data, cont });

    if (cont?.asin || AMAZON_LIVE.has(st)) {
      return { ok: true, status: st || "published", asin: cont?.asin || null, data };
    }
    if (AMAZON_FAIL.has(st)) {
      throw new Error(cont?.last_error || cont?.message || `Amazon ${st || "failed"}`);
    }
    // Still in flight or unknown — keep waiting
    delay = delay === 0 ? 4000 : Math.min(delay + 2000, 15000);
  }
  throw new Error(
    lastStatus ? `Amazon publish timed out (${lastStatus})` : "Amazon publish timed out"
  );
}

/**
 * Run `runItem(item)` sequentially for each item, showing a floating carousel dock with
 * per-product lock + spinner + status. `runItem` should throw (or return `{ ok: false, error }`)
 * on failure; anything else is treated as success.
 *
 * @param {Array<object>} items
 * @param {{
 *   action: "publish"|"unpublish"|"update",
 *   runItem: (item:object) => Promise<any>,
 *   keepOpenUntilAllOk?: boolean,
 *   onDone?: (summary:{ok:number, errors:string[]}) => void
 * }} opts
 */
export async function startProductsActionDock(items, { action = "update", runItem, keepOpenUntilAllOk = false, onDone } = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return { ok: 0, errors: [] };

  clearTimeout(clearTimer);
  activeEntries = list.map((item) => ({ item, status: "pending", message: "", sessionId: null }));
  ensureDock();
  renderDock(action);

  let ok = 0;
  const errors = [];

  for (const entry of activeEntries) {
    const key = itemProductKey(entry.item);
    const sid = itemShopifyId(entry.item);
    if (key) busyProductKeys.add(key);
    if (sid) busyShopifyIds.add(sid);
    notifyBusyChange();

    entry.status = "locking";
    renderDock(action);
    entry.sessionId = await acquireProductLock(entry.item, action);

    entry.status = "running";
    renderDock(action);
    try {
      const result = typeof runItem === "function" ? await runItem(entry.item, entry) : { ok: true };
      if (result && result.ok === false) throw new Error(result.error || result.message || "Action failed");
      entry.status = "done";
      entry.message = "";
      ok += 1;
    } catch (e) {
      entry.status = "error";
      entry.message = e?.message || "Failed";
      errors.push(`${itemTitle(entry.item)}: ${entry.message}`);
    } finally {
      await releaseProductLock(entry.sessionId);
      entry.sessionId = null;
      if (key) busyProductKeys.delete(key);
      if (sid) busyShopifyIds.delete(sid);
      notifyBusyChange();
      renderDock(action);
    }
  }

  if (ok && !errors.length) {
    showToast(`${actionLabel(action)} complete`, `${ok} product${ok === 1 ? "" : "s"} ${actionDonePast(action)}`);
  } else if (ok && errors.length) {
    showToast(`${actionLabel(action)} partial`, `${ok} ok · ${errors.length} failed`);
  }
  if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));

  if (keepOpenUntilAllOk) {
    if (!errors.length) clearDockSoonIfAllSucceeded();
    // else: leave dock visible with error cards
  } else {
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (activeEntries.some((e) => e.status === "pending" || e.status === "locking" || e.status === "running" || e.status === "publishing")) {
        return;
      }
      activeEntries = [];
      renderDock();
    }, 2500);
  }

  if (typeof onDone === "function") await onDone({ ok, errors });
  return { ok, errors };
}

async function enqueueAmazonEntry(entry, continent, batch) {
  const sid = itemShopifyId(entry.item);
  const key = itemProductKey(entry.item);
  if (sid) busyShopifyIds.add(sid);
  if (key) busyProductKeys.add(key);
  notifyBusyChange();

  let lockId = null;
  try {
    lockId = await acquireProductLock(entry.item, "publish");
    const enqueue = await partnerFetch("admin-amazon-publish", {
      method: "POST",
      body: {
        product_key: entry.item.product_key || "",
        shopify_product_id: entry.item.shopify_product_id || entry.item.id || "",
        published_design_id: entry.item.published_design_id || undefined,
        continents: [continent],
        dry_run: false,
        live_submit: true,
      },
    });
    if (enqueue && enqueue.ok === false) {
      throw new Error(enqueue.error || enqueue.message || "Amazon publish failed");
    }
    const pdId = enqueue?.published_design_id || entry.item.published_design_id;
    if (!pdId) throw new Error(enqueue?.message || "Amazon publish did not return published_design_id");
    entry.item = { ...entry.item, published_design_id: pdId };
    entry.enqueued = true;
    entry.status = "publishing";
    entry.message = "";
  } catch (e) {
    entry.status = "error";
    entry.message = e?.message || "Failed";
    entry.enqueued = false;
  } finally {
    await releaseProductLock(lockId);
    syncBatchFromEntries(batch);
    renderDock("publish");
  }
}

async function pollAmazonEntry(entry, continent, batch) {
  if (entry.status === "done" || entry.status === "error") return;
  if (entry.status === "waiting" || entry.status === "pending") return;
  const pdId = entry.item.published_design_id;
  if (!pdId) {
    entry.status = "error";
    entry.message = "missing published_design_id";
    syncBatchFromEntries(batch);
    renderDock("publish");
    return;
  }
  entry.status = "publishing";
  renderDock("publish");
  try {
    await waitForAmazonContinentLive(pdId, {
      continent,
      onTick: () => {
        if (entry.status === "publishing") renderDock("publish");
      },
    });
    entry.status = "done";
    entry.message = "";
  } catch (e) {
    entry.status = "error";
    entry.message = e?.message || "Failed";
  } finally {
    const sid = itemShopifyId(entry.item);
    const key = itemProductKey(entry.item);
    if (sid) busyShopifyIds.delete(sid);
    if (key) busyProductKeys.delete(key);
    notifyBusyChange();
    syncBatchFromEntries(batch);
    renderDock("publish");
  }
}

/**
 * Core loop: enqueue everything first (Waiting → Publishing), then poll until live.
 * Batch is persisted so reload restores the dock.
 */
async function runAmazonPublishBatchLoop(batch, { onDone } = {}) {
  const continent = String(batch.continent || "europa").toLowerCase();
  const action = "publish";

  // Phase 1 — enqueue all waiting (parallel). Page can be left after this starts.
  const toEnqueue = activeEntries.filter(
    (e) => !e.enqueued && e.status !== "done" && e.status !== "error" && e.status !== "publishing"
  );
  for (const e of toEnqueue) {
    e.status = "waiting";
  }
  syncBatchFromEntries(batch);
  renderDock(action);

  await mapPool(toEnqueue, 3, async (entry) => {
    await enqueueAmazonEntry(entry, continent, batch);
  });

  // Already-enqueued rows (restore): mark publishing if still open
  for (const e of activeEntries) {
    if (e.enqueued && e.status !== "done" && e.status !== "error") {
      e.status = "publishing";
    }
  }
  syncBatchFromEntries(batch);
  renderDock(action);

  // Phase 2 — poll all publishing in parallel (Amazon jobs continue server-side)
  const toPoll = activeEntries.filter((e) => e.status === "publishing");
  await mapPool(toPoll, 4, async (entry) => {
    await pollAmazonEntry(entry, continent, batch);
  });

  const ok = activeEntries.filter((e) => e.status === "done").length;
  const errors = activeEntries
    .filter((e) => e.status === "error")
    .map((e) => `${itemTitle(e.item)}: ${e.message || "Failed"}`);

  if (ok && !errors.length) {
    showToast("Publishing complete", `${ok} product${ok === 1 ? "" : "s"} published`);
    clearAmazonPublishBatch();
    clearDockSoonIfAllSucceeded();
  } else if (ok && errors.length) {
    showToast("Publishing partial", `${ok} ok · ${errors.length} failed`);
    syncBatchFromEntries(batch);
  } else if (errors.length) {
    showToast("Error", errors.slice(0, 2).join(" · "));
    syncBatchFromEntries(batch);
  }

  if (typeof onDone === "function") await onDone({ ok, errors });
  return { ok, errors };
}

/**
 * Amazon EU bulk publish: put all cards in Waiting immediately, enqueue in parallel,
 * persist batch for reload, then poll until Amazon live.
 */
export async function startProductsAmazonPublishDock(items, { continent = "europa", onDone } = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return { ok: 0, errors: [] };

  if (amazonBatchLoopPromise) {
    showToast("Publishing", "Amazon publish batch already running");
    return amazonBatchLoopPromise;
  }

  clearTimeout(clearTimer);
  amazonBatchOnDone = onDone || null;
  const batch = createAmazonPublishBatch(list, { continent });
  saveAmazonPublishBatch(batch);
  activeEntries = batch.entries.map(entryFromBatchRow);
  ensureDock();
  renderDock("publish");

  amazonBatchLoopPromise = runAmazonPublishBatchLoop(batch, { onDone })
    .catch((e) => {
      console.error("[products-action-dock] Amazon batch failed:", e);
      showToast("Error", e?.message || "Amazon publish failed");
      return { ok: 0, errors: [e?.message || "Amazon publish failed"] };
    })
    .finally(() => {
      amazonBatchLoopPromise = null;
    });
  return amazonBatchLoopPromise;
}

/**
 * After Products page mount / reload: restore floating dock from localStorage
 * and continue enqueue/poll. Optionally merge server-pending Amazon listings.
 *
 * @param {{ products?: object[], onDone?: Function }} [opts]
 */
export async function resumeAmazonPublishDockIfNeeded(opts = {}) {
  if (amazonBatchLoopPromise) return amazonBatchLoopPromise;

  let batch = loadAmazonPublishBatch();
  const products = Array.isArray(opts.products) ? opts.products : [];

  // Recover server-side in-flight Softstyle (etc.) if localStorage was cleared.
  if (!batchHasOpenWork(batch) && products.length) {
    const pending = products.filter(
      (p) => p?.amazon_eu_pending || (p?.amazon_eu_channel && !p?.amazon_eu_listed)
    );
    // Prefer explicit pending flag from enrich
    const fromPending = products.filter((p) => p?.amazon_eu_pending);
    const seed = fromPending.length ? fromPending : [];
    if (seed.length) {
      batch = createAmazonPublishBatch(seed, { continent: "europa" });
      for (const row of batch.entries) {
        row.enqueued = true; // already has amazon_listing in-flight
        row.status = "publishing";
      }
      saveAmazonPublishBatch(batch);
    }
  }

  if (!batchHasOpenWork(batch)) return null;

  clearTimeout(clearTimer);
  amazonBatchOnDone = opts.onDone || amazonBatchOnDone;
  activeEntries = batch.entries.map(entryFromBatchRow);

  // Enrich previews/titles from live product list when available
  if (products.length) {
    const bySid = new Map(
      products.map((p) => [String(p.shopify_product_id || p.id || "").replace(/\.0$/, ""), p])
    );
    for (const entry of activeEntries) {
      const live = bySid.get(itemShopifyId(entry.item));
      if (!live) continue;
      entry.item = {
        ...entry.item,
        ...live,
        preview_url: itemPreviewUrl(live) || entry.item.preview_url,
        published_design_id: live.published_design_id || entry.item.published_design_id,
      };
      if (live.amazon_eu_listed) {
        entry.status = "done";
        entry.enqueued = true;
      } else if (live.amazon_eu_pending && entry.status !== "error") {
        entry.status = "publishing";
        entry.enqueued = true;
      }
    }
    syncBatchFromEntries(batch);
  }

  ensureDock();
  renderDock("publish");
  showToast("Publishing", "Restored Amazon publish progress");

  amazonBatchLoopPromise = runAmazonPublishBatchLoop(batch, { onDone: amazonBatchOnDone })
    .catch((e) => {
      console.error("[products-action-dock] Amazon resume failed:", e);
      showToast("Error", e?.message || "Amazon publish resume failed");
      return { ok: 0, errors: [e?.message || "resume failed"] };
    })
    .finally(() => {
      amazonBatchLoopPromise = null;
    });
  return amazonBatchLoopPromise;
}

/**
 * Hide dock UI when leaving Products.
 * - In-SPA navigation with an active loop: keep dock DOM (loop still updating).
 * - Full remount / reload: loop is gone; clear UI — resumeAmazonPublishDockIfNeeded restores from localStorage.
 */
export function teardownProductsActionDock({ force = false } = {}) {
  clearTimeout(clearTimer);
  onBusyChange = null;
  if (amazonBatchLoopPromise && !force) {
    return;
  }
  activeEntries = [];
  busyProductKeys.clear();
  busyShopifyIds.clear();
  const dock = document.getElementById("cr-products-action-dock");
  if (dock) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
  }
}
