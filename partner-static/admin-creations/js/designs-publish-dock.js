/**
 * Admin Designs — floating publish progress docks with product carousel (composed mocks).
 * Multiple publish batches can run; minimize into page-scoped Publish FAB.
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import {
  mountOfflineProductMedia,
  bindProdCarousels,
  productCarouselHtml,
} from "./designs-product-media.js";
import {
  expandActionQueue,
  minimizeActionQueue,
  registerActionQueue,
  unregisterActionQueue,
  updateActionQueue,
} from "./action-queue-rail.js";

const POLL_MS = 4000;
const STORAGE_KEY = "cr-designs-publish-batches-v1";

let pollTimer = null;
/** @type {Map<string, object>} session_id → session */
let sessionsById = new Map();
/** @type {Map<string, DesignBatch>} */
let batches = new Map();
let onSessionsChange = null;

/**
 * @typedef {object} DesignBatch
 * @property {string} id
 * @property {number} startedAt
 * @property {string[]} sessionIds
 * @property {boolean} minimized
 * @property {HTMLElement|null} dockEl
 */

function loadBatchMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.batches) ? parsed.batches : [];
  } catch {
    return [];
  }
}

function saveBatchMeta() {
  try {
    const list = [...batches.values()].map((b) => ({
      id: b.id,
      startedAt: b.startedAt,
      sessionIds: b.sessionIds.slice(),
      minimized: !!b.minimized,
    }));
    if (!list.length) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ batches: list }));
  } catch (e) {
    console.warn("[cr-publish-dock] save batches:", e?.message || e);
  }
}

export function getPublishingDesignIds() {
  return new Set(
    [...sessionsById.values()]
      .filter((s) => !s.done)
      .map((s) => Number(s.design_id || 0))
      .filter((n) => n > 0)
  );
}

export function getActivePublishSessions() {
  return [...sessionsById.values()];
}

export function setPublishSessionsListener(fn) {
  onSessionsChange = typeof fn === "function" ? fn : null;
}

function notify() {
  if (typeof onSessionsChange === "function") onSessionsChange(getPublishingDesignIds(), getActivePublishSessions());
}

function statusLabel(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "completed" || s === "done") return "Done";
  if (s === "error") return "Error";
  if (s === "skipped") return "Skipped";
  if (s === "searching") return "Shopify…";
  if (s === "publishing") return "Printify…";
  if (s === "creating") return "Creating…";
  if (s === "mockups") return "Mockups…";
  if (s === "syncing") return "Syncing…";
  if (s === "uploading") return "Upload…";
  return "Pending";
}

function batchSessions(batch) {
  return batch.sessionIds.map((id) => sessionsById.get(id)).filter(Boolean);
}

function batchIsActive(batch) {
  return batchSessions(batch).some((s) => !s.done);
}

function batchItemCount(batch) {
  let n = 0;
  for (const s of batchSessions(batch)) n += (s.products || []).length || 1;
  return n;
}

function batchSummary(batch) {
  const active = batchSessions(batch).filter((s) => !s.done).length;
  const total = batch.sessionIds.length;
  const products = batchItemCount(batch);
  return `${active}/${total} designs · ${products} products`;
}

function dockIdFor(batchId) {
  return `cr-publish-dock-${batchId}`;
}

function ensureDock(batch) {
  const id = dockIdFor(batch.id);
  let dock = document.getElementById(id);
  if (dock) {
    batch.dockEl = dock;
    return dock;
  }
  dock = document.createElement("div");
  dock.id = id;
  dock.className = "cr-publish-dock";
  dock.dataset.queueId = batch.id;
  dock.hidden = true;
  dock.setAttribute("aria-hidden", "true");
  dock.innerHTML = `
    <div class="cr-publish-dock__panel" role="status" aria-live="polite">
      <div class="cr-publish-dock__head">
        <span class="cr-publish-dock__title">Publishing…</span>
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
    minimizeActionQueue(batch.id);
  });
  batch.dockEl = dock;
  return dock;
}

function cardHtml(session, product) {
  const designId = Number(session.design_id || 0);
  const key = String(product.product_key || "");
  const title = product.title || key;
  const designTitle = session.design_title || `Design #${designId}`;
  const st = String(product.status || "pending");
  return `<article class="cr-dd-prod cr-publish-dock__card is-offline" data-design-id="${escapeHtml(String(designId))}" data-product-key="${escapeHtml(key)}" data-session="${escapeHtml(session.session_id || "")}">
    <div class="cr-dd-prod__media" data-cr-dd-prod-media></div>
    <span class="cr-publish-dock__status cr-publish-dock__status--${escapeHtml(st)}">${escapeHtml(statusLabel(st))}</span>
    <div class="cr-dd-prod__title">${escapeHtml(title)}</div>
    <div class="cr-publish-dock__design-name" title="${escapeHtml(designTitle)}">${escapeHtml(designTitle)}</div>
  </article>`;
}

function syncRail(batch) {
  if (!batches.has(batch.id)) return;
  const active = batchIsActive(batch);
  if (!active) {
    destroyBatch(batch.id);
    return;
  }
  updateActionQueue(batch.id, {
    title: "Design publish",
    itemCount: batchItemCount(batch),
    summary: batchSummary(batch),
    minimized: !!batch.minimized,
    startedAt: batch.startedAt,
    expand: () => expandDesignBatch(batch.id),
    minimize: () => minimizeDesignBatch(batch.id),
  });
}

function renderBatchDock(batch) {
  const dock = ensureDock(batch);
  const countEl = dock.querySelector('[data-role="count"]');
  const carouselHost = dock.querySelector('[data-role="carousel"]');
  const activeSessions = batchSessions(batch).filter((s) => !s.done);

  if (!activeSessions.length || batch.minimized) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
    if (!activeSessions.length) {
      destroyBatch(batch.id);
      return;
    }
    syncRail(batch);
    return;
  }

  dock.hidden = false;
  dock.classList.add("is-visible");
  dock.setAttribute("aria-hidden", "false");

  const cards = [];
  let productCount = 0;
  for (const s of activeSessions) {
    for (const p of s.products || []) {
      productCount += 1;
      cards.push(cardHtml(s, p));
    }
  }
  if (countEl) {
    countEl.textContent =
      activeSessions.length === 1
        ? `1 design · ${productCount} product${productCount === 1 ? "" : "s"}`
        : `${activeSessions.length} designs · ${productCount} products`;
  }
  if (carouselHost) {
    carouselHost.innerHTML = productCarouselHtml(cards.join(""));
    for (const s of activeSessions) {
      const designUrl = String(s.design_preview_url || "").trim();
      for (const p of s.products || []) {
        const key = String(p.product_key || "");
        const card = carouselHost.querySelector(
          `.cr-publish-dock__card[data-session="${CSS.escape(s.session_id || "")}"][data-product-key="${CSS.escape(key)}"]`
        );
        const media = card?.querySelector("[data-cr-dd-prod-media]");
        if (!media) continue;
        mountOfflineProductMedia(media, p, designUrl);
      }
    }
    bindProdCarousels(carouselHost);
  }
  syncRail(batch);
}

function renderAllDocks() {
  for (const batch of batches.values()) renderBatchDock(batch);
}

function minimizeDesignBatch(id) {
  const batch = batches.get(id);
  if (!batch) return;
  batch.minimized = true;
  saveBatchMeta();
  renderBatchDock(batch);
}

function expandDesignBatch(id) {
  const batch = batches.get(id);
  if (!batch) return;
  for (const other of batches.values()) {
    if (other.id !== id && !other.minimized) {
      other.minimized = true;
      renderBatchDock(other);
    }
  }
  batch.minimized = false;
  saveBatchMeta();
  renderBatchDock(batch);
}

function destroyBatch(id) {
  const batch = batches.get(id);
  if (!batch) return;
  batch.dockEl?.remove();
  batches.delete(id);
  unregisterActionQueue(id);
  saveBatchMeta();
}

function registerBatchOnRail(batch) {
  registerActionQueue({
    id: batch.id,
    page: "designs",
    kind: "publish",
    title: "Design publish",
    startedAt: batch.startedAt,
    itemCount: batchItemCount(batch),
    summary: batchSummary(batch),
    minimized: !!batch.minimized,
    expand: () => expandDesignBatch(batch.id),
    minimize: () => minimizeDesignBatch(batch.id),
  });
}

function createBatch(sessionIds, { minimizeOthers = true } = {}) {
  const ids = [...new Set(sessionIds.map(String).filter(Boolean))];
  if (!ids.length) return null;
  if (minimizeOthers) {
    for (const other of batches.values()) {
      if (!other.minimized) minimizeDesignBatch(other.id);
    }
  }
  const batch = {
    id: `designs-pub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    startedAt: Date.now(),
    sessionIds: ids,
    minimized: false,
    dockEl: null,
  };
  batches.set(batch.id, batch);
  saveBatchMeta();
  registerBatchOnRail(batch);
  ensureDock(batch);
  renderBatchDock(batch);
  return batch;
}

function ensureBatchesForOrphanSessions() {
  const claimed = new Set();
  for (const b of batches.values()) for (const id of b.sessionIds) claimed.add(id);
  const orphans = [...sessionsById.values()]
    .filter((s) => !s.done && !claimed.has(String(s.session_id || "")))
    .map((s) => String(s.session_id || ""))
    .filter(Boolean);
  if (orphans.length) createBatch(orphans, { minimizeOthers: false });
}

function pruneBatches() {
  for (const batch of [...batches.values()]) {
    batch.sessionIds = batch.sessionIds.filter((id) => {
      const s = sessionsById.get(id);
      return s && !s.done;
    });
    if (!batch.sessionIds.length) destroyBatch(batch.id);
  }
  saveBatchMeta();
}

function mergeSessions(nextList) {
  const nextMap = new Map();
  for (const s of nextList || []) {
    const sid = String(s.session_id || "").trim();
    if (!sid) continue;
    nextMap.set(sid, s);
  }
  // Keep locally tracked sessions that API hasn't returned yet
  for (const [sid, prev] of sessionsById) {
    if (!nextMap.has(sid) && !prev.done) nextMap.set(sid, prev);
  }
  sessionsById = nextMap;
  pruneBatches();
  ensureBatchesForOrphanSessions();
  renderAllDocks();
  notify();
}

/** Seed from enqueue responses so the bar appears before the next poll. */
export function trackPublishSessions(partialSessions) {
  if (!Array.isArray(partialSessions) || !partialSessions.length) return;
  const newIds = [];
  for (const s of partialSessions) {
    const sid = String(s.session_id || "").trim();
    if (!sid) continue;
    const prev = sessionsById.get(sid) || {};
    sessionsById.set(sid, {
      ...prev,
      ...s,
      done: false,
      products: Array.isArray(s.products) && s.products.length ? s.products : prev.products || [],
    });
    newIds.push(sid);
  }
  createBatch(newIds, { minimizeOthers: true });
  notify();
  startPublishDockWatch();
}

export async function refreshActivePublishes() {
  try {
    const data = await partnerFetch("list-active-publishes", { query: { scope: "admin" } });
    mergeSessions(Array.isArray(data.sessions) ? data.sessions : []);
    return getActivePublishSessions();
  } catch (e) {
    console.warn("[cr-publish-dock] refresh:", e?.message || e);
    return getActivePublishSessions();
  }
}

function restoreBatchMeta() {
  const meta = loadBatchMeta();
  for (const row of meta) {
    if (!row?.id || batches.has(row.id)) continue;
    batches.set(row.id, {
      id: row.id,
      startedAt: Number(row.startedAt) || Date.now(),
      sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds.map(String) : [],
      minimized: !!row.minimized,
      dockEl: null,
    });
    registerBatchOnRail(batches.get(row.id));
  }
}

export function startPublishDockWatch() {
  restoreBatchMeta();
  if (!pollTimer) {
    pollTimer = setInterval(async () => {
      const before = getPublishingDesignIds();
      await refreshActivePublishes();
      const after = getPublishingDesignIds();
      if (before.size > 0 && after.size === 0) notify();
    }, POLL_MS);
  }
  return refreshActivePublishes();
}

export function stopPublishDockWatch() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Soft teardown when leaving Designs — keep batches/sessions for return. */
export function teardownPublishDock({ force = false } = {}) {
  if (force) {
    stopPublishDockWatch();
    for (const id of [...batches.keys()]) destroyBatch(id);
    sessionsById = new Map();
    onSessionsChange = null;
    return;
  }
  for (const batch of batches.values()) {
    if (!batch.minimized) minimizeDesignBatch(batch.id);
  }
  // Keep polling so progress continues while on Products
  if (![...sessionsById.values()].some((s) => !s.done)) {
    stopPublishDockWatch();
  }
}
