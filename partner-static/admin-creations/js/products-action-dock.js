/**
 * Creations Portal Products — floating bulk-action progress dock with per-product lock (IDEA-063).
 * Runs a caller-supplied `runItem` for each selected product sequentially, acquiring an
 * admin product-action lock (src/features/manufacturers/adminCreationsProductActionLock.js)
 * before the call and releasing it right after, so the grid can hide/overlay busy products
 * via getBusyProductKeys()/getBusyShopifyIds() while the action is in flight.
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";

const busyProductKeys = new Set();
const busyShopifyIds = new Set();
let activeEntries = [];
let clearTimer = null;

export function getBusyProductKeys() {
  return new Set(busyProductKeys);
}

export function getBusyShopifyIds() {
  return new Set(busyShopifyIds);
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
  const preview = item.preview_url || item.grid_views?.[0]?.src || "";
  return `<article class="cr-dd-prod cr-publish-dock__card cr-products-action-dock__card" data-status="${escapeHtml(
    status
  )}">
    <div class="cr-dd-prod__media">
      ${preview ? `<img src="${escapeHtml(preview)}" alt="" loading="lazy" decoding="async" />` : '<span class="cr-card__noimg">No image</span>'}
      ${status === "locking" || status === "running" ? '<span class="cr-products-action-dock__spinner" aria-hidden="true"></span>' : ""}
    </div>
    <span class="cr-publish-dock__status cr-publish-dock__status--${escapeHtml(status)}">${escapeHtml(
    statusLabel(status)
  )}</span>
    <div class="cr-dd-prod__title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
    ${message ? `<div class="cr-products-action-dock__message">${escapeHtml(message)}</div>` : ""}
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

  const done = activeEntries.filter((e) => e.status === "done" || e.status === "error").length;
  if (titleEl) titleEl.textContent = `${actionLabel(action)}…`;
  if (countEl) countEl.textContent = `${done}/${activeEntries.length} product${activeEntries.length === 1 ? "" : "s"}`;
  if (carouselHost) carouselHost.innerHTML = activeEntries.map(cardHtml).join("");
}

function clearDockSoonIfIdle() {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (activeEntries.some((e) => e.status === "pending" || e.status === "locking" || e.status === "running")) return;
    activeEntries = [];
    renderDock();
  }, 2500);
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

/**
 * Run `runItem(item)` sequentially for each item, showing a floating carousel dock with
 * per-product lock + spinner + status. `runItem` should throw (or return `{ ok: false, error }`)
 * on failure; anything else is treated as success.
 *
 * @param {Array<object>} items
 * @param {{ action: "publish"|"unpublish"|"update", runItem: (item:object) => Promise<any>, onDone?: (summary:{ok:number, errors:string[]}) => void }} opts
 */
export async function startProductsActionDock(items, { action = "update", runItem, onDone } = {}) {
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

    entry.status = "locking";
    renderDock(action);
    entry.sessionId = await acquireProductLock(entry.item, action);

    entry.status = "running";
    renderDock(action);
    try {
      const result = typeof runItem === "function" ? await runItem(entry.item) : { ok: true };
      if (result && result.ok === false) throw new Error(result.error || "Action failed");
      entry.status = "done";
      entry.message = "";
      ok += 1;
    } catch (e) {
      entry.status = "error";
      entry.message = e?.message || "Failed";
      errors.push(`${itemTitle(entry.item)}: ${entry.message}`);
    } finally {
      await releaseProductLock(entry.sessionId);
      if (key) busyProductKeys.delete(key);
      if (sid) busyShopifyIds.delete(sid);
      renderDock(action);
    }
  }

  if (ok) showToast(`${actionLabel(action)} complete`, `${ok} product${ok === 1 ? "" : "s"} ${actionDonePast(action)}`);
  if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));

  clearDockSoonIfIdle();
  if (typeof onDone === "function") await onDone({ ok, errors });
  return { ok, errors };
}

/** Hide dock + clear busy sets when leaving Products page. */
export function teardownProductsActionDock() {
  clearTimeout(clearTimer);
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
