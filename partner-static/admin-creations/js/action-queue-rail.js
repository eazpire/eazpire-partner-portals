/**
 * Creations Admin — page-scoped floating action queues (Products / Designs).
 * Publish FAB sits left of the Cursor Agent shell; docks can minimize into it.
 * PLATFORM_SPECIFIC (admin.eazpire.com/creations).
 */

/** @typedef {'products'|'designs'} ActionQueuePage */

/**
 * @typedef {object} ActionQueue
 * @property {string} id
 * @property {ActionQueuePage} page
 * @property {string} kind  e.g. publish | unpublish | update
 * @property {string} title
 * @property {number} startedAt
 * @property {number} itemCount
 * @property {string} [summary] e.g. "0/7 done · 1 error"
 * @property {boolean} minimized
 * @property {boolean} [done]
 * @property {() => void} expand
 * @property {() => void} minimize
 * @property {() => void} [onRemove]
 */

/** @type {ActionQueuePage|null} */
let currentPage = null;
/** @type {Map<string, ActionQueue>} */
const queues = new Map();
let pickerOpen = false;

const PUBLISH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 20h14v-2H5v2zm7-18L5.5 9h4.5v6h4V9h4.5L12 2z"/></svg>`;

function formatWhen(ts) {
  const d = new Date(Number(ts) || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString();
  }
}

function pageQueues() {
  if (!currentPage) return [];
  return [...queues.values()].filter((q) => q.page === currentPage && !q.done);
}

function bindPublishFabPosition(rail, fab) {
  if (!rail || !fab || rail.dataset.eazFabPosInit === "1") return;
  const tryBind = () => {
    const api = window.EazAdminFabPosition;
    if (!api || typeof api.bind !== "function") return false;
    rail.dataset.eazFabPosInit = "1";
    api.bind(rail, api.keys?.publish || "publish_fab", { handleEl: fab });
    return true;
  };
  if (tryBind()) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (tryBind() || tries >= 40) clearInterval(timer);
  }, 250);
}

function ensureRail() {
  let rail = document.getElementById("cr-aq-rail");
  if (rail) return rail;
  rail = document.createElement("div");
  rail.id = "cr-aq-rail";
  rail.className = "cr-aq-rail";
  rail.hidden = true;
  rail.innerHTML = `
    <div class="cr-aq-rail__picker" id="cr-aq-rail-picker" hidden role="menu" aria-label="Action queues"></div>
    <button type="button" class="cr-aq-rail__fab" id="cr-aq-rail-fab" title="Show publish queue" aria-label="Show publish queue" aria-expanded="false">
      ${PUBLISH_ICON}
      <span class="cr-aq-rail__badge" id="cr-aq-rail-badge" hidden>0</span>
    </button>`;
  document.body.appendChild(rail);

  const fab = rail.querySelector("#cr-aq-rail-fab");
  fab?.addEventListener("click", (e) => {
    if (fab.getAttribute("data-eaz-fab-suppress-click") === "1" || rail.getAttribute("data-eaz-fab-suppress-click") === "1") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onFabClick();
  });

  bindPublishFabPosition(rail, fab);

  document.addEventListener(
    "click",
    (ev) => {
      if (!pickerOpen) return;
      const t = ev.target;
      if (t instanceof Node && rail.contains(t)) return;
      closePicker();
    },
    true
  );

  return rail;
}

function closePicker() {
  pickerOpen = false;
  const picker = document.getElementById("cr-aq-rail-picker");
  const fab = document.getElementById("cr-aq-rail-fab");
  if (picker) {
    picker.hidden = true;
    picker.innerHTML = "";
  }
  if (fab) fab.setAttribute("aria-expanded", "false");
}

function renderPicker(list) {
  const picker = document.getElementById("cr-aq-rail-picker");
  if (!picker) return;
  picker.innerHTML = list
    .slice()
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .map((q) => {
      const count = Number(q.itemCount) || 0;
      const when = formatWhen(q.startedAt);
      const summary = q.summary ? ` · ${q.summary}` : "";
      return `<button type="button" class="cr-aq-rail__pick" role="menuitem" data-queue-id="${q.id}">
        <span class="cr-aq-rail__pick-title">${escapeText(q.title || "Queue")}</span>
        <span class="cr-aq-rail__pick-meta">${count} item${count === 1 ? "" : "s"}${summary}</span>
        <span class="cr-aq-rail__pick-when">${escapeText(when)}</span>
      </button>`;
    })
    .join("");
  picker.hidden = false;
  pickerOpen = true;
  document.getElementById("cr-aq-rail-fab")?.setAttribute("aria-expanded", "true");
  picker.querySelectorAll("[data-queue-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute("data-queue-id");
      closePicker();
      if (id) expandActionQueue(id);
    });
  });
}

function escapeText(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function onFabClick() {
  const list = pageQueues();
  if (!list.length) return;
  const minimized = list.filter((q) => q.minimized);
  const expanded = list.filter((q) => !q.minimized);

  if (list.length === 1) {
    const q = list[0];
    if (q.minimized) expandActionQueue(q.id);
    else q.minimize?.();
    closePicker();
    return;
  }

  // Multiple queues: open picker (prefer showing minimized + all)
  if (pickerOpen) {
    closePicker();
    return;
  }
  // If one is expanded and others minimized, picker lets you switch
  void expanded;
  void minimized;
  renderPicker(list);
}

export function renderActionQueueRail() {
  const rail = ensureRail();
  const list = pageQueues();
  const fab = document.getElementById("cr-aq-rail-fab");
  const badge = document.getElementById("cr-aq-rail-badge");

  if (!currentPage || !list.length) {
    rail.hidden = true;
    closePicker();
    return;
  }

  const anyMinimized = list.some((q) => q.minimized);
  const allMinimized = list.every((q) => q.minimized);
  // Show FAB when something is minimized, or when multiple queues exist (switcher)
  const showFab = anyMinimized || list.length > 1;
  rail.hidden = !showFab;
  if (!showFab) {
    closePicker();
    return;
  }

  if (badge) {
    const n = list.length;
    badge.textContent = String(n);
    badge.hidden = n < 2;
  }
  if (fab) {
    fab.title =
      list.length > 1
        ? `Queues (${list.length}) — pick one`
        : allMinimized
          ? "Show publish queue"
          : "Switch / minimize queues";
    fab.setAttribute(
      "aria-label",
      list.length > 1 ? `Open queue list (${list.length})` : "Show publish queue"
    );
  }
}

/**
 * @param {ActionQueuePage|null} page
 */
export function setActionQueuePage(page) {
  const next = page === "products" || page === "designs" ? page : null;
  if (currentPage === next) {
    renderActionQueueRail();
    return;
  }
  // Hide expanded docks for the page we're leaving
  for (const q of queues.values()) {
    if (currentPage && q.page === currentPage && !q.minimized) {
      try {
        q.minimize?.();
      } catch (_) {}
    }
  }
  currentPage = next;
  closePicker();
  // Auto-expand the newest minimized queue for the new page (optional nicety: keep minimized)
  renderActionQueueRail();
}

export function getActionQueuePage() {
  return currentPage;
}

/**
 * @param {ActionQueue} queue
 */
export function registerActionQueue(queue) {
  if (!queue?.id || !queue.page) return;
  queues.set(queue.id, {
    ...queue,
    minimized: !!queue.minimized,
    startedAt: Number(queue.startedAt) || Date.now(),
    itemCount: Number(queue.itemCount) || 0,
  });
  renderActionQueueRail();
}

/**
 * @param {string} id
 * @param {Partial<ActionQueue>} patch
 */
export function updateActionQueue(id, patch) {
  const prev = queues.get(id);
  if (!prev) return;
  queues.set(id, { ...prev, ...patch, id: prev.id, page: prev.page });
  renderActionQueueRail();
}

export function unregisterActionQueue(id) {
  const q = queues.get(id);
  if (!q) return;
  queues.delete(id);
  try {
    q.onRemove?.();
  } catch (_) {}
  closePicker();
  renderActionQueueRail();
}

export function minimizeActionQueue(id) {
  const q = queues.get(id);
  if (!q) return;
  q.minimized = true;
  try {
    q.minimize?.();
  } catch (_) {}
  queues.set(id, q);
  closePicker();
  renderActionQueueRail();
}

export function expandActionQueue(id) {
  const q = queues.get(id);
  if (!q) return;
  // Only one expanded carousel per page
  for (const other of queues.values()) {
    if (other.page === q.page && other.id !== id && !other.minimized) {
      other.minimized = true;
      try {
        other.minimize?.();
      } catch (_) {}
      queues.set(other.id, other);
    }
  }
  q.minimized = false;
  try {
    q.expand?.();
  } catch (_) {}
  queues.set(id, q);
  closePicker();
  renderActionQueueRail();
}

export function listActionQueues(page = currentPage) {
  if (!page) return [];
  return [...queues.values()].filter((q) => q.page === page && !q.done);
}
