/**
 * Admin Designs — floating publish progress bar with product carousel (composed mocks).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import {
  mountOfflineProductMedia,
  bindProdCarousels,
  productCarouselHtml,
} from "./designs-product-media.js";

const POLL_MS = 4000;
let pollTimer = null;
let sessions = [];
let onSessionsChange = null;

export function getPublishingDesignIds() {
  return new Set(
    sessions
      .filter((s) => !s.done)
      .map((s) => Number(s.design_id || 0))
      .filter((n) => n > 0)
  );
}

export function getActivePublishSessions() {
  return sessions.slice();
}

export function setPublishSessionsListener(fn) {
  onSessionsChange = typeof fn === "function" ? fn : null;
}

function notify() {
  if (typeof onSessionsChange === "function") onSessionsChange(getPublishingDesignIds(), sessions);
}

function ensureDock() {
  let dock = document.getElementById("cr-publish-dock");
  if (dock) return dock;
  dock = document.createElement("div");
  dock.id = "cr-publish-dock";
  dock.className = "cr-publish-dock";
  dock.hidden = true;
  dock.setAttribute("aria-hidden", "true");
  dock.innerHTML = `
    <div class="cr-publish-dock__panel" role="status" aria-live="polite">
      <div class="cr-publish-dock__head">
        <span class="cr-publish-dock__title">Publishing…</span>
        <span class="cr-publish-dock__count" id="cr-publish-dock-count"></span>
      </div>
      <div class="cr-publish-dock__carousel" id="cr-publish-dock-carousel"></div>
    </div>`;
  document.body.appendChild(dock);
  return dock;
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

function renderDock() {
  const dock = ensureDock();
  const active = sessions.filter((s) => !s.done);
  const countEl = document.getElementById("cr-publish-dock-count");
  const carouselHost = document.getElementById("cr-publish-dock-carousel");
  if (!active.length) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
    if (carouselHost) carouselHost.innerHTML = "";
    return;
  }
  dock.hidden = false;
  dock.classList.add("is-visible");
  dock.setAttribute("aria-hidden", "false");

  const cards = [];
  let productCount = 0;
  for (const s of active) {
    for (const p of s.products || []) {
      productCount += 1;
      cards.push(cardHtml(s, p));
    }
  }
  if (countEl) {
    countEl.textContent =
      active.length === 1
        ? `1 design · ${productCount} product${productCount === 1 ? "" : "s"}`
        : `${active.length} designs · ${productCount} products`;
  }
  if (carouselHost) {
    carouselHost.innerHTML = productCarouselHtml(cards.join(""));
    for (const s of active) {
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
}

function mergeSessions(nextList) {
  const byId = new Map();
  for (const s of nextList || []) {
    const sid = String(s.session_id || "").trim();
    if (!sid) continue;
    byId.set(sid, s);
  }
  sessions = [...byId.values()];
  renderDock();
  notify();
}

/** Seed from enqueue responses so the bar appears before the next poll. */
export function trackPublishSessions(partialSessions) {
  if (!Array.isArray(partialSessions) || !partialSessions.length) return;
  const byId = new Map(sessions.map((s) => [String(s.session_id || ""), s]));
  for (const s of partialSessions) {
    const sid = String(s.session_id || "").trim();
    if (!sid) continue;
    const prev = byId.get(sid) || {};
    byId.set(sid, {
      ...prev,
      ...s,
      done: false,
      products: Array.isArray(s.products) && s.products.length ? s.products : prev.products || [],
    });
  }
  sessions = [...byId.values()];
  renderDock();
  notify();
  startPublishDockWatch();
}

export async function refreshActivePublishes() {
  try {
    const data = await partnerFetch("list-active-publishes", { query: { scope: "admin" } });
    mergeSessions(Array.isArray(data.sessions) ? data.sessions : []);
    return sessions;
  } catch (e) {
    console.warn("[cr-publish-dock] refresh:", e?.message || e);
    return sessions;
  }
}

export function startPublishDockWatch() {
  if (pollTimer) return;
  ensureDock();
  refreshActivePublishes();
  pollTimer = setInterval(async () => {
    const before = getPublishingDesignIds();
    await refreshActivePublishes();
    const after = getPublishingDesignIds();
    // When all clear after having some, keep listener notified (grid reload).
    if (before.size > 0 && after.size === 0) notify();
    if (after.size === 0 && pollTimer) {
      // Keep a short idle poll while on the page in case a new publish starts elsewhere.
    }
  }, POLL_MS);
}

export function stopPublishDockWatch() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  sessions = [];
  const dock = document.getElementById("cr-publish-dock");
  if (dock) {
    dock.hidden = true;
    dock.classList.remove("is-visible");
    dock.setAttribute("aria-hidden", "true");
  }
}

export function teardownPublishDock() {
  stopPublishDockWatch();
  document.getElementById("cr-publish-dock")?.remove();
  onSessionsChange = null;
}
