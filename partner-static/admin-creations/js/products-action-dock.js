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

const busyProductKeys = new Set();
const busyShopifyIds = new Set();
let activeEntries = [];
let clearTimer = null;
let onBusyChange = null;

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

/** Prefer grid mock / Printify mocks — preview_url alone is often empty on Softstyle rows. */
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
  if (status === "publishing") return "Publishing…";
  if (status === "done") return "Done";
  if (status === "error") return "Error";
  return "Waiting…";
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

/**
 * Amazon EU bulk publish: enqueue (with short lock) → poll until live → Done.
 * Dock closes only when every product reached Amazon live status.
 * Products run sequentially for enqueue; each stays "publishing" until Amazon confirms.
 */
export async function startProductsAmazonPublishDock(items, { continent = "europa", onDone } = {}) {
  const list = (items || []).filter(Boolean);
  const action = "publish";
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

    let pdId = entry.item.published_design_id || null;
    try {
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
      pdId = enqueue?.published_design_id || pdId;
      if (!pdId) throw new Error(enqueue?.message || "Amazon publish did not return published_design_id");
      entry.item = { ...entry.item, published_design_id: pdId };
    } catch (e) {
      entry.status = "error";
      entry.message = e?.message || "Failed";
      errors.push(`${itemTitle(entry.item)}: ${entry.message}`);
      await releaseProductLock(entry.sessionId);
      entry.sessionId = null;
      if (key) busyProductKeys.delete(key);
      if (sid) busyShopifyIds.delete(sid);
      notifyBusyChange();
      renderDock(action);
      continue;
    }

    // Release admin lock after enqueue — Amazon job can take minutes.
    await releaseProductLock(entry.sessionId);
    entry.sessionId = null;

    entry.status = "publishing";
    renderDock(action);
    try {
      await waitForAmazonContinentLive(pdId, {
        continent,
        onTick: () => {
          if (entry.status === "publishing") renderDock(action);
        },
      });
      entry.status = "done";
      entry.message = "";
      ok += 1;
    } catch (e) {
      entry.status = "error";
      entry.message = e?.message || "Failed";
      errors.push(`${itemTitle(entry.item)}: ${entry.message}`);
    } finally {
      if (key) busyProductKeys.delete(key);
      if (sid) busyShopifyIds.delete(sid);
      notifyBusyChange();
      renderDock(action);
    }
  }

  if (ok && !errors.length) {
    showToast("Publishing complete", `${ok} product${ok === 1 ? "" : "s"} published`);
    clearDockSoonIfAllSucceeded();
  } else if (ok && errors.length) {
    showToast("Publishing partial", `${ok} ok · ${errors.length} failed`);
  } else if (errors.length) {
    showToast("Error", errors.slice(0, 2).join(" · "));
  }

  if (typeof onDone === "function") await onDone({ ok, errors });
  return { ok, errors };
}

/** Hide dock + clear busy sets when leaving Products page. */
export function teardownProductsActionDock() {
  clearTimeout(clearTimer);
  activeEntries = [];
  busyProductKeys.clear();
  busyShopifyIds.clear();
  onBusyChange = null;
  const dock = document.getElementById("cr-products-action-dock");
  if (dock) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
  }
}
