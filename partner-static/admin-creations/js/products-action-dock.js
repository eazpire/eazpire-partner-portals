/**
 * Creations Portal Products — floating bulk-action progress docks with per-product lock (IDEA-063).
 * Supports multiple parallel queues (minimize into page-scoped Publish FAB).
 *
 * Amazon Publish: enqueue then poll until continent is live/failed; dock auto-hides when
 * every card is terminal (done or error) so a new publish can start without dismiss.
 *
 * Polling stops when creator-jobs-amazon-publish is disabled (status.queue_enabled=false /
 * enqueue queue_disabled) or status stays idle-queued with no feed progress — otherwise the
 * dock would show "Publishing…" forever while the consumer discards work.
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";
import { bindProdCarousels, productCarouselHtml } from "./designs-product-media.js";
import { itemPreviewUrl } from "./products-preview-url.js";
import {
  batchHasOpenWork,
  createAmazonPublishBatch,
  loadAmazonPublishBatches,
  pruneTerminalAmazonPublishBatches,
  removeAmazonPublishBatch,
  saveAmazonPublishBatch,
} from "./products-amazon-publish-batch.js";
import {
  amazonPublishQueueOffError,
  amazonPublishStagnantIdleError,
  amazonPublishStatusFingerprint,
  amazonPublishStatusLooksIdleQueued,
  isAmazonPublishQueueOff,
  shouldAbortAmazonPublishWait,
} from "./products-amazon-publish-poll-guard.js";
import {
  expandActionQueue,
  minimizeActionQueue,
  registerActionQueue,
  unregisterActionQueue,
  updateActionQueue,
} from "./action-queue-rail.js";

export { itemPreviewUrl };

const busyProductKeys = new Set();
const busyShopifyIds = new Set();
let onBusyChange = null;

/** @type {Map<string, ProductQueue>} */
const productQueues = new Map();

const AMAZON_LIVE = new Set(["published", "live", "listed"]);
const AMAZON_FAIL = new Set(["failed", "error", "suppressed", "invalid"]);
const AMAZON_IN_FLIGHT = new Set([
  "queued",
  "publishing",
  "feed_pending",
  "processing",
  "verifying",
  "pending_indexing",
]);

/**
 * @typedef {object} ProductQueue
 * @property {string} id
 * @property {string} action
 * @property {object} [batch]
 * @property {Array<object>} entries
 * @property {boolean} minimized
 * @property {number} startedAt
 * @property {HTMLElement|null} dockEl
 * @property {Promise|null} loopPromise
 * @property {Function|null} onDone
 * @property {ReturnType<typeof setTimeout>|null} clearTimer
 * @property {ReturnType<typeof setInterval>|null} recoverTimer
 */

export function getBusyProductKeys() {
  return new Set(busyProductKeys);
}

export function getBusyShopifyIds() {
  return new Set(busyShopifyIds);
}

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

function syncBatchFromEntries(queue) {
  const batch = queue.batch;
  if (!batch) return;
  batch.entries = queue.entries.map((e) => ({
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
  batch.minimized = !!queue.minimized;
  saveAmazonPublishBatch(batch);
}

function queueSummary(queue) {
  const done = queue.entries.filter((e) => e.status === "done").length;
  const errored = queue.entries.filter((e) => e.status === "error").length;
  const total = queue.entries.length;
  return `${done}/${total} done${errored ? ` · ${errored} error${errored === 1 ? "" : "s"}` : ""}`;
}

function syncRail(queue) {
  if (!productQueues.has(queue.id)) return;
  updateActionQueue(queue.id, {
    title: `${actionLabel(queue.action)}…`,
    itemCount: queue.entries.length,
    summary: queueSummary(queue),
    minimized: !!queue.minimized,
    startedAt: queue.startedAt,
    expand: () => expandProductQueue(queue.id),
    minimize: () => minimizeProductQueue(queue.id),
  });
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

function dockIdFor(queueId) {
  return `cr-products-action-dock-${queueId}`;
}

function ensureDock(queue) {
  const id = dockIdFor(queue.id);
  let dock = document.getElementById(id);
  if (dock) {
    queue.dockEl = dock;
    return dock;
  }
  dock = document.createElement("div");
  dock.id = id;
  dock.className = "cr-publish-dock cr-products-action-dock";
  dock.dataset.queueId = queue.id;
  dock.hidden = true;
  dock.setAttribute("aria-hidden", "true");
  dock.innerHTML = `
    <div class="cr-publish-dock__panel" role="status" aria-live="polite">
      <div class="cr-publish-dock__head">
        <span class="cr-publish-dock__title" data-role="title">Working…</span>
        <div class="cr-publish-dock__head-actions">
          <span class="cr-publish-dock__count" data-role="count"></span>
          <button type="button" class="cr-publish-dock__minimize" data-role="minimize" title="Minimize" aria-label="Minimize queue">─</button>
        </div>
      </div>
      <div class="cr-publish-dock__carousel" data-role="carousel"></div>
    </div>`;
  document.body.appendChild(dock);
  dock.querySelector('[data-role="minimize"]')?.addEventListener("click", (e) => {
    e.preventDefault();
    minimizeActionQueue(queue.id);
  });
  queue.dockEl = dock;
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

function renderQueueDock(queue) {
  const dock = ensureDock(queue);
  const titleEl = dock.querySelector('[data-role="title"]');
  const countEl = dock.querySelector('[data-role="count"]');
  const carouselHost = dock.querySelector('[data-role="carousel"]');

  if (!queue.entries.length || queue.minimized) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
    syncRail(queue);
    return;
  }

  dock.hidden = false;
  dock.classList.add("is-visible");
  dock.setAttribute("aria-hidden", "false");

  const done = queue.entries.filter((e) => e.status === "done").length;
  const errored = queue.entries.filter((e) => e.status === "error").length;
  const total = queue.entries.length;
  const action = queue.action;
  if (titleEl) {
    if (errored && done + errored === total) titleEl.textContent = `${actionLabel(action)} — errors`;
    else if (done === total) titleEl.textContent = `${actionLabel(action)} complete`;
    else titleEl.textContent = `${actionLabel(action)}…`;
  }
  if (countEl) countEl.textContent = queueSummary(queue);
  if (carouselHost) {
    carouselHost.innerHTML = productCarouselHtml(queue.entries.map(cardHtml).join(""));
    bindProdCarousels(carouselHost);
  }
  syncRail(queue);
}

function minimizeProductQueue(id) {
  const queue = productQueues.get(id);
  if (!queue) return;
  queue.minimized = true;
  if (queue.batch) {
    queue.batch.minimized = true;
    saveAmazonPublishBatch(queue.batch);
  }
  renderQueueDock(queue);
}

function expandProductQueue(id) {
  const queue = productQueues.get(id);
  if (!queue) return;
  for (const other of productQueues.values()) {
    if (other.id !== id && !other.minimized) {
      other.minimized = true;
      if (other.batch) {
        other.batch.minimized = true;
        saveAmazonPublishBatch(other.batch);
      }
      renderQueueDock(other);
    }
  }
  queue.minimized = false;
  if (queue.batch) {
    queue.batch.minimized = false;
    saveAmazonPublishBatch(queue.batch);
  }
  renderQueueDock(queue);
  // Resume recovery polling for error cards
  startErrorRecovery(queue);
}

function registerQueueOnRail(queue) {
  registerActionQueue({
    id: queue.id,
    page: "products",
    kind: queue.action,
    title: `${actionLabel(queue.action)}…`,
    startedAt: queue.startedAt,
    itemCount: queue.entries.length,
    summary: queueSummary(queue),
    minimized: !!queue.minimized,
    expand: () => expandProductQueue(queue.id),
    minimize: () => minimizeProductQueue(queue.id),
  });
}

function destroyQueue(queueId, { removeStorage = false } = {}) {
  const queue = productQueues.get(queueId);
  if (!queue) return;
  if (queue.clearTimer) clearTimeout(queue.clearTimer);
  if (queue.recoverTimer) clearInterval(queue.recoverTimer);
  queue.dockEl?.remove();
  productQueues.delete(queueId);
  unregisterActionQueue(queueId);
  if (removeStorage && queue.batch) removeAmazonPublishBatch(queue.batch.id);
}

function queueIsSettled(queue) {
  if (!queue?.entries?.length) return true;
  return queue.entries.every((e) => {
    const st = String(e.status || "").toLowerCase();
    return st === "done" || st === "error";
  });
}

/** Hide dock + clear storage once every card is done or error (no open jobs). */
function clearDockSoonWhenSettled(queue, delayMs = 3500) {
  if (queue.clearTimer) clearTimeout(queue.clearTimer);
  queue.clearTimer = setTimeout(() => {
    if (!productQueues.has(queue.id)) return;
    if (!queueIsSettled(queue)) return;
    if (queue.recoverTimer) {
      clearInterval(queue.recoverTimer);
      queue.recoverTimer = null;
    }
    destroyQueue(queue.id, { removeStorage: true });
  }, delayMs);
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
    await partnerFetch("admin-creations-product-action-unlock", {
      method: "POST",
      body: { session_id: sessionId },
    });
  } catch (e) {
    console.warn("[products-action-dock] unlock failed:", e?.message || e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isStaleQueuedErrorMessage(msg) {
  return /stuck in queued|without an Amazon feed/i.test(String(msg || ""));
}

/**
 * Poll admin-amazon-publish-status until all selected marketplaces (or continent rollup) are live/failed/timeout.
 * Stops early when queue_enabled is false (or idle-queued stagnates) so the dock can settle.
 */
export async function waitForAmazonContinentLive(publishedDesignId, opts = {}) {
  const id = Number(publishedDesignId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("missing published_design_id");
  const continent = String(opts.continent || "europa").trim().toLowerCase() || "europa";
  const marketCodes = (() => {
    const fromList = Array.isArray(opts.marketplace_codes)
      ? opts.marketplace_codes.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean)
      : [];
    if (fromList.length) return [...new Set(fromList)];
    const single = String(opts.marketplace_code || "").trim().toUpperCase();
    if (single) return [single];
    return [continent === "amerika" ? "US" : "DE"];
  })();
  const maxMs = Number(opts.maxMs) > 0 ? Number(opts.maxMs) : 12 * 60 * 1000;
  const started = Date.now();
  let delay = 0;
  let lastStatus = "";
  const staleFailGraceUsed = Object.create(null);
  let lastFingerprint = "";
  let stagnantIdlePolls = 0;

  while (Date.now() - started < maxMs) {
    if (delay > 0) await sleep(delay);
    const elapsed = Date.now() - started;
    const query = { published_design_id: String(id) };
    if (elapsed > maxMs - 45000) query.sync = "1";
    const data = await partnerFetch("admin-amazon-publish-status", { query });

    // Prefer status.queue_enabled — no separate admin-job-controls poll every few seconds.
    if (isAmazonPublishQueueOff(data)) {
      throw amazonPublishQueueOffError(data);
    }

    const queueEnabledKnown = typeof data?.queue_enabled === "boolean";
    const fingerprint = amazonPublishStatusFingerprint(marketCodes, data, continent);
    const idleQueued = amazonPublishStatusLooksIdleQueued(marketCodes, data, continent);
    if (!queueEnabledKnown && idleQueued && fingerprint && fingerprint === lastFingerprint) {
      stagnantIdlePolls += 1;
    } else {
      stagnantIdlePolls = 0;
      lastFingerprint = fingerprint;
    }
    const abort = shouldAbortAmazonPublishWait({
      queueOff: false,
      queueEnabledKnown,
      idleQueued,
      stagnantIdlePolls,
    });
    if (abort.abort && abort.reason === "stagnant_idle") {
      throw amazonPublishStagnantIdleError();
    }

    let anyInFlight = false;
    let allLive = true;
    const failMsgs = [];
    let firstLive = null;

    for (const marketCode of marketCodes) {
      const cont = data?.markets?.[marketCode] || data?.continents?.[continent] || null;
      const st = String(cont?.status || "").toLowerCase();
      lastStatus = st || lastStatus;
      if (typeof opts.onTick === "function") {
        opts.onTick({ status: st, continent, marketCode, data, cont });
      }

      if (cont?.asin || AMAZON_LIVE.has(st)) {
        if (!firstLive) firstLive = { status: st || "published", asin: cont?.asin || null };
        continue;
      }
      allLive = false;
      if (AMAZON_IN_FLIGHT.has(st) || st === "publishing" || st === "dry_run_ok" || !st) {
        anyInFlight = true;
        continue;
      }
      if (AMAZON_FAIL.has(st)) {
        const errMsg = cont?.last_error || cont?.message || `Amazon ${marketCode}: ${st || "failed"}`;
        if (isStaleQueuedErrorMessage(errMsg) && (staleFailGraceUsed[marketCode] || 0) < 8) {
          staleFailGraceUsed[marketCode] = (staleFailGraceUsed[marketCode] || 0) + 1;
          anyInFlight = true;
          continue;
        }
        failMsgs.push(errMsg);
      } else {
        anyInFlight = true;
      }
    }

    if (allLive && firstLive) {
      return { ok: true, status: firstLive.status, asin: firstLive.asin, data };
    }
    if (failMsgs.length && !anyInFlight) {
      throw new Error(failMsgs.slice(0, 3).join(" · "));
    }
    delay = delay === 0 ? 4000 : Math.min(delay + 2000, 15000);
  }
  throw new Error(lastStatus ? `Amazon publish timed out (${lastStatus})` : "Amazon publish timed out");
}

function batchMarketCodes(batchOrContinent) {
  if (batchOrContinent && typeof batchOrContinent === "object") {
    const codes = Array.isArray(batchOrContinent.marketplace_codes)
      ? batchOrContinent.marketplace_codes.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean)
      : [];
    if (codes.length) return codes;
    const continent = String(batchOrContinent.continent || "europa").toLowerCase();
    return continent === "amerika" || continent === "us" ? ["US"] : ["DE"];
  }
  const continent = String(batchOrContinent || "europa").toLowerCase();
  return continent === "amerika" || continent === "us" ? ["US"] : ["DE"];
}

async function tryRecoverErrorEntry(entry, continent, marketplaceCodes = null) {
  if (entry.status !== "error") return false;
  const pdId = entry.item.published_design_id;
  if (!pdId) return false;
  const codes = Array.isArray(marketplaceCodes) && marketplaceCodes.length
    ? marketplaceCodes.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean)
    : [continent === "amerika" ? "US" : "DE"];
  try {
    const data = await partnerFetch("admin-amazon-publish-status", {
      query: { published_design_id: String(pdId) },
    });
    // Do not flip errors back to "publishing" while the consumer is off — that restarts polling.
    if (isAmazonPublishQueueOff(data)) {
      entry.message = amazonPublishQueueOffError(data).message;
      return false;
    }
    let allLive = true;
    let anyInFlight = false;
    for (const marketCode of codes) {
      const cont = data?.markets?.[marketCode] || data?.continents?.[continent] || null;
      const st = String(cont?.status || "").toLowerCase();
      if (cont?.asin || AMAZON_LIVE.has(st)) continue;
      allLive = false;
      if (AMAZON_IN_FLIGHT.has(st) || st === "publishing") anyInFlight = true;
    }
    if (allLive) {
      entry.status = "done";
      entry.message = "";
      entry.enqueued = true;
      return true;
    }
    if (anyInFlight) {
      entry.status = "publishing";
      entry.message = "";
      entry.enqueued = true;
      return true;
    }
    // Still failed — if message was stale-queued but row still failed without feed, keep error
  } catch (_) {}
  return false;
}

function startErrorRecovery(queue) {
  if (queue.recoverTimer) return;
  const continent = String(queue.batch?.continent || "europa").toLowerCase();
  const marketplaceCodes = batchMarketCodes(queue.batch);
  queue.recoverTimer = setInterval(async () => {
    if (!productQueues.has(queue.id)) {
      clearInterval(queue.recoverTimer);
      queue.recoverTimer = null;
      return;
    }
    const errors = queue.entries.filter((e) => e.status === "error");
    if (!errors.length) return;
    let changed = false;
    const recovered = [];
    for (const entry of errors) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await tryRecoverErrorEntry(entry, continent, marketplaceCodes);
      if (ok) {
        changed = true;
        if (entry.status === "publishing") recovered.push(entry);
      }
    }
    if (changed) {
      syncBatchFromEntries(queue);
      renderQueueDock(queue);
      if (recovered.length) {
        void mapPool(recovered, 4, async (entry) => {
          await pollAmazonEntry(entry, continent, queue);
        }).then(() => finishAmazonQueue(queue));
      }
    }
  }, 12000);
}

/**
 * Sequential non-Amazon bulk actions — each call creates its own queue (can run parallel to Amazon).
 */
export async function startProductsActionDock(
  items,
  { action = "update", runItem, keepOpenUntilAllOk = false, onDone } = {}
) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return { ok: 0, errors: [] };

  const queue = {
    id: `prod-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    batch: null,
    entries: list.map((item) => ({ item, status: "pending", message: "", sessionId: null })),
    minimized: false,
    startedAt: Date.now(),
    dockEl: null,
    loopPromise: null,
    onDone: onDone || null,
    clearTimer: null,
    recoverTimer: null,
  };

  // Minimize other expanded product queues
  for (const other of productQueues.values()) {
    if (!other.minimized) minimizeProductQueue(other.id);
  }

  productQueues.set(queue.id, queue);
  registerQueueOnRail(queue);
  ensureDock(queue);
  renderQueueDock(queue);

  let ok = 0;
  const errors = [];

  queue.loopPromise = (async () => {
    for (const entry of queue.entries) {
      const key = itemProductKey(entry.item);
      const sid = itemShopifyId(entry.item);
      if (key) busyProductKeys.add(key);
      if (sid) busyShopifyIds.add(sid);
      notifyBusyChange();

      entry.status = "locking";
      renderQueueDock(queue);
      entry.sessionId = await acquireProductLock(entry.item, action);

      entry.status = "running";
      renderQueueDock(queue);
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
        renderQueueDock(queue);
      }
    }

    if (ok && !errors.length) {
      showToast(`${actionLabel(action)} complete`, `${ok} product${ok === 1 ? "" : "s"} ${actionDonePast(action)}`);
    } else if (ok && errors.length) {
      showToast(`${actionLabel(action)} partial`, `${ok} ok · ${errors.length} failed`);
    }
    if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));

    // Auto-hide when every card is terminal (toast already covered failures).
    if (queueIsSettled(queue) && (!keepOpenUntilAllOk || !errors.length)) {
      clearDockSoonWhenSettled(queue);
    }

    if (typeof queue.onDone === "function") await queue.onDone({ ok, errors });
    return { ok, errors };
  })();

  return queue.loopPromise;
}

async function enqueueAmazonEntry(entry, continent, queue) {
  const sid = itemShopifyId(entry.item);
  const key = itemProductKey(entry.item);
  if (sid) busyShopifyIds.add(sid);
  if (key) busyProductKeys.add(key);
  notifyBusyChange();
  const marketplaceCodes = batchMarketCodes(queue.batch || { continent });

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
        marketplace_codes: marketplaceCodes,
        dry_run: false,
        live_submit: true,
      },
    });
    if (enqueue && enqueue.ok === false) {
      if (isAmazonPublishQueueOff(enqueue)) throw amazonPublishQueueOffError(enqueue);
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
    if (isAmazonPublishQueueOff(e?.data) || e?.code === "queue_disabled") {
      entry.message = amazonPublishQueueOffError(e?.data || e).message;
    } else {
      entry.message = e?.message || "Failed";
    }
    entry.enqueued = false;
  } finally {
    await releaseProductLock(lockId);
    syncBatchFromEntries(queue);
    renderQueueDock(queue);
  }
}

async function pollAmazonEntry(entry, continent, queue) {
  const marketplaceCodes = batchMarketCodes(queue.batch || { continent });
  if (entry.status === "done") return;
  if (entry.status === "waiting" || entry.status === "pending") return;
  if (entry.status === "error") {
    const recovered = await tryRecoverErrorEntry(entry, continent, marketplaceCodes);
    if (!recovered) return;
    if (entry.status === "done") {
      syncBatchFromEntries(queue);
      renderQueueDock(queue);
      return;
    }
  }
  const pdId = entry.item.published_design_id;
  if (!pdId) {
    entry.status = "error";
    entry.message = "missing published_design_id";
    syncBatchFromEntries(queue);
    renderQueueDock(queue);
    return;
  }
  entry.status = "publishing";
  renderQueueDock(queue);
  try {
    await waitForAmazonContinentLive(pdId, {
      continent,
      marketplace_codes: marketplaceCodes,
      onTick: () => {
        if (entry.status === "publishing") renderQueueDock(queue);
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
    syncBatchFromEntries(queue);
    renderQueueDock(queue);
  }
}

async function finishAmazonQueue(queue) {
  const ok = queue.entries.filter((e) => e.status === "done").length;
  const errors = queue.entries
    .filter((e) => e.status === "error")
    .map((e) => `${itemTitle(e.item)}: ${e.message || "Failed"}`);

  if (ok && !errors.length) {
    showToast("Publishing complete", `${ok} product${ok === 1 ? "" : "s"} published`);
  } else if (ok && errors.length) {
    showToast("Publishing partial", `${ok} ok · ${errors.length} failed`);
  } else if (errors.length) {
    showToast("Error", errors.slice(0, 2).join(" · "));
  }

  syncBatchFromEntries(queue);
  // Settled batches (incl. errors) auto-hide — no dismiss needed for a fresh publish.
  if (queueIsSettled(queue)) {
    if (queue.recoverTimer) {
      clearInterval(queue.recoverTimer);
      queue.recoverTimer = null;
    }
    clearDockSoonWhenSettled(queue);
  } else {
    startErrorRecovery(queue);
  }

  if (typeof queue.onDone === "function") await queue.onDone({ ok, errors });
  return { ok, errors };
}

async function runAmazonPublishBatchLoop(queue) {
  const batch = queue.batch;
  const continent = String(batch.continent || "europa").toLowerCase();
  const marketplaceCodes = batchMarketCodes(batch);

  const toEnqueue = queue.entries.filter(
    (e) => !e.enqueued && e.status !== "done" && e.status !== "error" && e.status !== "publishing"
  );
  for (const e of toEnqueue) e.status = "waiting";
  syncBatchFromEntries(queue);
  renderQueueDock(queue);

  // Concurrency 1: Amazon createFeed is globally rate-limited (~1/min). Parallel enqueues
  // only pile up jobs that then fight for the same Feeds quota.
  let queueOffMessage = "";
  await mapPool(toEnqueue, 1, async (entry) => {
    if (queueOffMessage) {
      entry.status = "error";
      entry.message = queueOffMessage;
      entry.enqueued = false;
      return;
    }
    await enqueueAmazonEntry(entry, continent, queue);
    if (entry.status === "error" && /queue is (off|disabled)|queue_disabled|creator-jobs-amazon-publish/i.test(entry.message || "")) {
      queueOffMessage = entry.message;
    }
  });

  for (const e of queue.entries) {
    if (e.enqueued && e.status !== "done" && e.status !== "error") e.status = "publishing";
  }
  // Recover previously persisted errors that may already be in-flight again
  const errored = queue.entries.filter((e) => e.status === "error");
  for (const e of errored) {
    // eslint-disable-next-line no-await-in-loop
    await tryRecoverErrorEntry(e, continent, marketplaceCodes);
  }
  syncBatchFromEntries(queue);
  renderQueueDock(queue);

  const toPoll = queue.entries.filter((e) => e.status === "publishing");
  await mapPool(toPoll, 4, async (entry) => {
    await pollAmazonEntry(entry, continent, queue);
  });

  return finishAmazonQueue(queue);
}

/**
 * Amazon country bulk publish: new queue each time (parallel with existing queues).
 */
export async function startProductsAmazonPublishDock(
  items,
  { continent = "europa", marketplace_codes = null, onDone } = {}
) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return { ok: 0, errors: [] };

  for (const other of productQueues.values()) {
    if (!other.minimized) minimizeProductQueue(other.id);
  }

  const batch = createAmazonPublishBatch(list, { continent, marketplace_codes });
  saveAmazonPublishBatch(batch);

  const queue = {
    id: batch.id,
    action: "publish",
    batch,
    entries: batch.entries.map(entryFromBatchRow),
    minimized: false,
    startedAt: batch.startedAt || Date.now(),
    dockEl: null,
    loopPromise: null,
    onDone: onDone || null,
    clearTimer: null,
    recoverTimer: null,
  };

  productQueues.set(queue.id, queue);
  registerQueueOnRail(queue);
  ensureDock(queue);
  renderQueueDock(queue);

  queue.loopPromise = runAmazonPublishBatchLoop(queue)
    .catch((e) => {
      console.error("[products-action-dock] Amazon batch failed:", e);
      showToast("Error", e?.message || "Amazon publish failed");
      return { ok: 0, errors: [e?.message || "Amazon publish failed"] };
    })
    .finally(() => {
      queue.loopPromise = null;
    });

  return queue.loopPromise;
}

/**
 * After Products page mount / reload: restore all open batches from localStorage.
 * If the Amazon publish queue is off, one status check settles publishing cards (no forever-poll).
 */
export async function resumeAmazonPublishDockIfNeeded(opts = {}) {
  const products = Array.isArray(opts.products) ? opts.products : [];
  // Drop finished/error-only batches so a prior failed run does not block a new publish.
  pruneTerminalAmazonPublishBatches();
  let batches = loadAmazonPublishBatches().filter(batchHasOpenWork);

  if (!batches.length && products.length) {
    const fromPending = products.filter((p) => p?.amazon_eu_pending);
    if (fromPending.length) {
      const batch = createAmazonPublishBatch(fromPending, { continent: "europa" });
      for (const row of batch.entries) {
        row.enqueued = true;
        row.status = "publishing";
      }
      saveAmazonPublishBatch(batch);
      batches = [batch];
    }
  }

  if (!batches.length) return null;

  // Newest expanded; older minimized
  batches.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const promises = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (productQueues.has(batch.id) && productQueues.get(batch.id)?.loopPromise) continue;

    const queue = {
      id: batch.id,
      action: "publish",
      batch,
      entries: batch.entries.map(entryFromBatchRow),
      minimized: i < batches.length - 1 || !!batch.minimized,
      startedAt: batch.startedAt || Date.now(),
      dockEl: null,
      loopPromise: null,
      onDone: opts.onDone || null,
      clearTimer: null,
      recoverTimer: null,
    };

    if (products.length) {
      const bySid = new Map(
        products.map((p) => [String(p.shopify_product_id || p.id || "").replace(/\.0$/, ""), p])
      );
      for (const entry of queue.entries) {
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
        } else if (live.amazon_eu_pending) {
          entry.status = "publishing";
          entry.enqueued = true;
          entry.message = "";
        }
      }
      syncBatchFromEntries(queue);
    }

    // Fully settled after live sync — do not restore UI / recovery loop.
    if (queueIsSettled(queue)) {
      removeAmazonPublishBatch(batch.id);
      continue;
    }

    productQueues.set(queue.id, queue);
    registerQueueOnRail(queue);
    ensureDock(queue);
    renderQueueDock(queue);

    queue.loopPromise = runAmazonPublishBatchLoop(queue)
      .catch((e) => {
        console.error("[products-action-dock] Amazon resume failed:", e);
        return { ok: 0, errors: [e?.message || "resume failed"] };
      })
      .finally(() => {
        queue.loopPromise = null;
      });
    promises.push(queue.loopPromise);
  }

  if (promises.length) showToast("Publishing", "Restored Amazon publish progress");
  // Expand newest still-active queue
  const activeIds = [...productQueues.keys()].filter((id) => String(id).startsWith("amazon-"));
  if (activeIds.length) expandActionQueue(activeIds[activeIds.length - 1]);
  return promises.length ? Promise.all(promises) : null;
}

/**
 * Hide dock UI when leaving Products (loops keep running; rail page switch hides FAB).
 */
export function teardownProductsActionDock({ force = false } = {}) {
  onBusyChange = null;
  for (const queue of [...productQueues.values()]) {
    if (queue.loopPromise && !force) {
      minimizeProductQueue(queue.id);
      continue;
    }
    if (force) {
      destroyQueue(queue.id, { removeStorage: false });
    } else {
      minimizeProductQueue(queue.id);
    }
  }
  if (force) {
    busyProductKeys.clear();
    busyShopifyIds.clear();
  }
}
