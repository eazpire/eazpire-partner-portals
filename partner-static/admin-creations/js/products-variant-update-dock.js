/**
 * Floating progress dock for single-product variant updates (Publish-style carousel).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { bindProdCarousels, productCarouselHtml } from "./designs-product-media.js";
import {
  expandActionQueue,
  minimizeActionQueue,
  registerActionQueue,
  unregisterActionQueue,
  updateActionQueue,
} from "./action-queue-rail.js";

const POLL_MS = 4000;
const STORAGE_KEY = "cr-products-variant-update-batches-v1";
const COMPOSE_AUTO_ROTATE_MS = 2500;

/** @type {Map<string, VariantBatch>} */
const batches = new Map();
let pollTimer = null;
/** @type {Map<string, object>} */
const sessionsById = new Map();

/**
 * @typedef {object} VariantBatch
 * @property {string} id
 * @property {string} sessionId
 * @property {number} startedAt
 * @property {boolean} minimized
 * @property {object} product
 * @property {string[]} channels
 * @property {Array<object>} mockSlides
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
      sessionId: b.sessionId,
      startedAt: b.startedAt,
      minimized: !!b.minimized,
      product: {
        id: b.product?.id,
        title: b.product?.title,
        product_key: b.product?.product_key,
      },
      channels: b.channels.slice(),
      mockSlides: b.mockSlides.slice(),
    }));
    if (!list.length) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ batches: list }));
  } catch (e) {
    console.warn("[variant-update-dock] save:", e?.message || e);
  }
}

function statusLabel(status) {
  const map = {
    pending: "Waiting…",
    running: "Updating…",
    syncing: "Syncing…",
    completed: "Done",
    error: "Error",
  };
  return map[status] || status || "…";
}

function cardHtml(session, channelProduct, mockSlides, slideIndex) {
  const slide = mockSlides[slideIndex % Math.max(1, mockSlides.length)] || {};
  const src = slide.src || "";
  const ch = channelProduct.channel_label || channelProduct.channel || "Channel";
  const st = channelProduct.status || "pending";
  return `<article class="cr-publish-dock__card cr-variant-dock__card" data-session="${escapeHtml(session.session_id || "")}" data-channel="${escapeHtml(channelProduct.channel || "")}">
    <div class="cr-publish-dock__card-media cr-variant-dock__media" data-cr-variant-media="1">
      ${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" draggable="false" />` : `<span class="cr-pd-vp-mock__missing">No mock</span>`}
      <span class="cr-variant-dock__status cr-variant-dock__status--${escapeHtml(st)}">${escapeHtml(statusLabel(st))}</span>
    </div>
    <div class="cr-publish-dock__card-meta">
      <strong>${escapeHtml(ch)}</strong>
      <span class="cr-publish-dock__card-msg">${escapeHtml(channelProduct.message || "")}</span>
    </div>
  </article>`;
}

function ensureDock(batch) {
  if (batch.dockEl?.isConnected) return batch.dockEl;
  let dock = document.getElementById(`cr-variant-dock-${batch.id}`);
  if (!dock) {
    dock = document.createElement("div");
    dock.id = `cr-variant-dock-${batch.id}`;
    dock.className = "cr-publish-dock cr-variant-dock";
    dock.hidden = true;
    dock.setAttribute("aria-hidden", "true");
    dock.innerHTML = `
      <div class="cr-publish-dock__inner">
        <div class="cr-publish-dock__head">
          <div>
            <strong class="cr-publish-dock__title">Variant update</strong>
            <span class="cr-publish-dock__count" data-cr-variant-count></span>
          </div>
          <button type="button" class="icon-btn cr-publish-dock__min" data-cr-variant-min aria-label="Minimize">−</button>
        </div>
        <div class="cr-publish-dock__carousel-host" data-cr-variant-carousel></div>
      </div>`;
    document.body.appendChild(dock);
    dock.querySelector("[data-cr-variant-min]")?.addEventListener("click", () => minimizeBatch(batch.id));
  }
  batch.dockEl = dock;
  return dock;
}

function registerBatchOnRail(batch) {
  registerActionQueue({
    id: batch.id,
    page: "products",
    kind: "update",
    title: "Variant update",
    startedAt: batch.startedAt,
    itemCount: batch.channels.length,
    summary: batch.product?.title || "Product",
    minimized: !!batch.minimized,
    expand: () => expandBatch(batch.id),
    minimize: () => minimizeBatch(batch.id),
  });
}

function syncRail(batch) {
  const session = sessionsById.get(batch.sessionId);
  const active = session && !session.done;
  updateActionQueue(batch.id, {
    itemCount: batch.channels.length,
    summary: active ? `${batch.product?.title || "Product"} · updating` : "Complete",
    minimized: !!batch.minimized,
  });
}

function renderBatchDock(batch) {
  const dock = ensureDock(batch);
  const session = sessionsById.get(batch.sessionId);
  const countEl = dock.querySelector("[data-cr-variant-count]");
  const carouselHost = dock.querySelector("[data-cr-variant-carousel]");

  if (batch.minimized || !session) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
    syncRail(batch);
    return;
  }

  const done = !!session.done;
  const products = session.products || [];
  const mockSlides = batch.mockSlides?.length ? batch.mockSlides : [{ src: "", view: "front" }];
  const slideIndex = Math.floor((Date.now() - batch.startedAt) / COMPOSE_AUTO_ROTATE_MS) % mockSlides.length;

  dock.hidden = false;
  dock.classList.add("is-visible");
  dock.setAttribute("aria-hidden", "false");

  if (countEl) {
    countEl.textContent = done
      ? "Complete"
      : `${products.filter((p) => p.status === "completed").length}/${products.length} channels`;
  }

  if (carouselHost) {
    const cards = products.map((p) => cardHtml(session, p, mockSlides, slideIndex));
    carouselHost.innerHTML = productCarouselHtml(cards.join(""));
    bindProdCarousels(carouselHost);
  }

  syncRail(batch);

  if (done) {
    setTimeout(() => destroyBatch(batch.id), done && !session.has_error ? 8000 : 20000);
  }
}

function destroyBatch(id) {
  const batch = batches.get(id);
  if (!batch) return;
  batch.dockEl?.remove();
  batches.delete(id);
  unregisterActionQueue(id);
  saveBatchMeta();
}

function minimizeBatch(id) {
  const batch = batches.get(id);
  if (!batch) return;
  batch.minimized = true;
  saveBatchMeta();
  renderBatchDock(batch);
  minimizeActionQueue(id);
}

function expandBatch(id) {
  for (const other of batches.values()) {
    if (other.id !== id && !other.minimized) {
      other.minimized = true;
      renderBatchDock(other);
    }
  }
  const batch = batches.get(id);
  if (!batch) return;
  batch.minimized = false;
  saveBatchMeta();
  renderBatchDock(batch);
  expandActionQueue(id);
}

async function refreshSessions() {
  try {
    const data = await partnerFetch("list-active-publishes", { query: { scope: "admin" } });
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    for (const s of sessions) {
      if (String(s.publish_source || "") === "admin-variant-update") {
        sessionsById.set(s.session_id, s);
      }
    }
    for (const batch of batches.values()) {
      const sid = batch.sessionId;
      if (!sid) continue;
      let session = sessionsById.get(sid);
      if (!session) {
        try {
          const one = await partnerFetch("get-publish-progress", { query: { session_id: sid } });
          if (one?.ok && one.session_id) {
            session = {
              session_id: sid,
              done: !!one.done,
              products: one.products || [],
              publish_source: "admin-variant-update",
              has_error: (one.products || []).some((p) => p.status === "error"),
            };
            sessionsById.set(sid, session);
          }
        } catch (_) {}
      }
      renderBatchDock(batch);
    }
  } catch (e) {
    console.warn("[variant-update-dock] poll:", e?.message || e);
  }
}

function ensurePoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!batches.size) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    void refreshSessions();
  }, POLL_MS);
}

export async function startVariantUpdateDock({ sessionId, product, channels, mockSlides }) {
  const batch = {
    id: `variant-upd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    startedAt: Date.now(),
    minimized: false,
    product: product || {},
    channels: channels || [],
    mockSlides: mockSlides || [],
    dockEl: null,
  };

  for (const other of batches.values()) {
    if (!other.minimized) minimizeBatch(other.id);
  }

  batches.set(batch.id, batch);
  sessionsById.set(sessionId, {
    session_id: sessionId,
    done: false,
    products: (channels || []).map((ch) => ({
      channel: ch,
      channel_label: ch,
      status: "pending",
      message: "Waiting…",
    })),
    publish_source: "admin-variant-update",
  });

  saveBatchMeta();
  registerBatchOnRail(batch);
  ensureDock(batch);
  renderBatchDock(batch);
  ensurePoll();
  void refreshSessions();
}

export async function resumeVariantUpdateDockIfNeeded() {
  const meta = loadBatchMeta();
  if (!meta.length) return null;

  for (const row of meta) {
    if (batches.has(row.id)) continue;
    const batch = {
      id: row.id,
      sessionId: row.sessionId,
      startedAt: row.startedAt || Date.now(),
      minimized: !!row.minimized,
      product: row.product || {},
      channels: row.channels || [],
      mockSlides: row.mockSlides || [],
      dockEl: null,
    };
    batches.set(batch.id, batch);
    registerBatchOnRail(batch);
    ensureDock(batch);
    renderBatchDock(batch);
  }

  if (batches.size) ensurePoll();
  await refreshSessions();
  return batches.size ? [...batches.values()] : null;
}

export function teardownVariantUpdateDock() {
  for (const id of [...batches.keys()]) destroyBatch(id);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
