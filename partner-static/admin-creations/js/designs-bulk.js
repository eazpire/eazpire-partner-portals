/**
 * Creations Portal Designs — multi-select + floating action bar (IDEA-057 / IDEA-072).
 */

import { computeDesignBulkActionCounts } from "./designs-bulk-actions.js";

export { computeDesignBulkActionCounts } from "./designs-bulk-actions.js";

const selected = new Map(); // item_key -> design item
/** When true, dock stays hidden even if selection is non-empty (e.g. while a bulk modal is open). */
let dockSuppressed = false;

const TILE_ICON = {
  activate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>`,
  deactivate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`,
  public: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  private: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  remove: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  publish: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  update: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
};

function tileHtml(action, label, extraClass = "") {
  const cls = extraClass ? ` ${extraClass}` : "";
  return `<button type="button" class="cr-bulk-dock__tile${cls}" data-cr-bulk="${action}" hidden>
    <span class="cr-bulk-dock__tile-count" data-cr-bulk-count="${action}">0</span>
    <span class="cr-bulk-dock__tile-icon" aria-hidden="true">${TILE_ICON[action] || ""}</span>
    <span class="cr-bulk-dock__tile-label">${label}</span>
  </button>`;
}

export function selectionKey(item) {
  return String(item?.item_key || "").trim();
}

export function isSelected(itemOrKey) {
  const key = typeof itemOrKey === "string" ? itemOrKey : selectionKey(itemOrKey);
  return !!key && selected.has(key);
}

export function getSelectedItems() {
  return [...selected.values()];
}

export function getSelectedCount() {
  return selected.size;
}

export function clearSelection() {
  selected.clear();
  dockSuppressed = false;
  refreshSelectionUi();
}

export function setSelected(item, on) {
  const key = selectionKey(item);
  if (!key) return;
  if (on) selected.set(key, item);
  else selected.delete(key);
  refreshSelectionUi();
}

export function toggleSelected(item) {
  setSelected(item, !isSelected(item));
}

export function selectAllVisible(items) {
  for (const item of items || []) {
    const key = selectionKey(item);
    if (!key) continue;
    // Bulk actions need a saved creation id (or job_id for delete-only).
    selected.set(key, item);
  }
  refreshSelectionUi();
}

export function isBulkActionable(item) {
  if (!item) return false;
  if (item.item_kind === "generated") return true; // delete unsaved
  return !!(item.id || item.job_id);
}

function applyDockVisibility() {
  const dock = document.getElementById("cr-designs-bulk-dock");
  if (!dock) return;
  const show = selected.size > 0 && !dockSuppressed;
  dock.hidden = !show;
  dock.classList.toggle("is-visible", show);
  dock.setAttribute("aria-hidden", show ? "false" : "true");
}

/** Hide floating bar without clearing selection (use while Remove/Publish/Update modal is open). */
export function suppressBulkDock() {
  dockSuppressed = true;
  applyDockVisibility();
}

/** Show floating bar again if designs are still selected (e.g. modal cancelled). */
export function releaseBulkDock() {
  dockSuppressed = false;
  applyDockVisibility();
}

function applyTile(dock, action, count) {
  const btn = dock.querySelector(`[data-cr-bulk="${action}"]`);
  if (!btn || !btn.classList.contains("cr-bulk-dock__tile")) return;
  const show = Number(count || 0) > 0;
  btn.hidden = !show;
  const badge = btn.querySelector("[data-cr-bulk-count]");
  if (badge) badge.textContent = String(count || 0);
}

function refreshSelectionUi() {
  const dock = document.getElementById("cr-designs-bulk-dock");
  const countEl = document.getElementById("cr-bulk-count");
  const n = selected.size;
  applyDockVisibility();
  if (countEl) countEl.textContent = n === 1 ? "1 selected" : `${n} selected`;
  if (dock) {
    const counts = computeDesignBulkActionCounts(getSelectedItems());
    applyTile(dock, "activate", counts.activate);
    applyTile(dock, "deactivate", counts.deactivate);
    applyTile(dock, "public", counts.public);
    applyTile(dock, "private", counts.private);
    applyTile(dock, "update", counts.update);
    applyTile(dock, "publish", counts.publish);
    applyTile(dock, "remove", counts.remove);
  }

  document.querySelectorAll(".cr-card[data-item-key]").forEach((card) => {
    const key = card.getAttribute("data-item-key") || "";
    const on = selected.has(key);
    card.classList.toggle("is-selected", on);
    const cb = card.querySelector(".cr-card__bulk-cb");
    if (cb) cb.checked = on;
  });
}

export function ensureBulkDock(_rootEl, handlers = {}) {
  let dock = document.getElementById("cr-designs-bulk-dock");
  if (dock && !dock.querySelector('[data-cr-bulk="public"]')) {
    dock.remove();
    dock = null;
  }
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "cr-designs-bulk-dock";
    dock.className = "cr-bulk-dock cr-bulk-dock--designs";
    dock.hidden = true;
    dock.setAttribute("aria-hidden", "true");
    dock.innerHTML = `
      <div class="cr-bulk-dock__panel" role="toolbar" aria-label="Design bulk actions">
        <div class="cr-bulk-dock__select">
          <button type="button" class="cr-bulk-dock__link" data-cr-bulk="all">Select all</button>
          <button type="button" class="cr-bulk-dock__link" data-cr-bulk="none">Select none</button>
          <span class="cr-bulk-dock__count" id="cr-bulk-count">0 selected</span>
        </div>
        <div class="cr-bulk-dock__actions">
          ${tileHtml("activate", "Activate")}
          ${tileHtml("deactivate", "Deactivate")}
          ${tileHtml("public", "Public")}
          ${tileHtml("private", "Private")}
          ${tileHtml("remove", "Remove", "cr-bulk-dock__tile--danger")}
          ${tileHtml("publish", "Publish", "cr-bulk-dock__tile--primary")}
          ${tileHtml("update", "Update")}
        </div>
      </div>`;
  }
  // Must live on document.body — inside .main/.app-root overflow clips position:fixed.
  if (dock.parentElement !== document.body) {
    document.body.appendChild(dock);
  }

  dock.querySelectorAll("[data-cr-bulk]").forEach((btn) => {
    btn.onclick = () => {
      const act = btn.getAttribute("data-cr-bulk");
      if (act === "all" && typeof handlers.onSelectAll === "function") handlers.onSelectAll();
      if (act === "none") {
        releaseBulkDock();
        clearSelection();
      }
      if (
        act === "remove" ||
        act === "publish" ||
        act === "update" ||
        act === "activate" ||
        act === "deactivate" ||
        act === "public" ||
        act === "private"
      ) {
        suppressBulkDock();
      }
      if (act === "remove" && typeof handlers.onRemove === "function") handlers.onRemove(getSelectedItems());
      if (act === "publish" && typeof handlers.onPublish === "function") handlers.onPublish(getSelectedItems());
      if (act === "update" && typeof handlers.onUpdate === "function") handlers.onUpdate(getSelectedItems());
      if (act === "activate" && typeof handlers.onActivate === "function") handlers.onActivate(getSelectedItems());
      if (act === "deactivate" && typeof handlers.onDeactivate === "function") handlers.onDeactivate(getSelectedItems());
      if (act === "public" && typeof handlers.onPublic === "function") handlers.onPublic(getSelectedItems());
      if (act === "private" && typeof handlers.onPrivate === "function") handlers.onPrivate(getSelectedItems());
    };
  });

  refreshSelectionUi();
  return dock;
}

/** Hide dock when leaving Designs page (dock stays on body). */
export function teardownBulkDock() {
  dockSuppressed = false;
  clearSelection();
  applyDockVisibility();
}

export function checkboxHtml(item) {
  const key = selectionKey(item);
  const checked = isSelected(key) ? "checked" : "";
  return `<label class="cr-card__bulk" title="Select design">
    <input type="checkbox" class="cr-card__bulk-cb" data-cr-bulk-key="${escapeAttr(key)}" ${checked} />
    <span class="cr-card__bulk-box" aria-hidden="true"></span>
    <span class="visually-hidden">Select design</span>
  </label>`;
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function bindCardSelection(grid, { getItemByKey, onOpenDetail } = {}) {
  if (!grid) return;

  grid.querySelectorAll(".cr-card__bulk-cb").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const key = cb.getAttribute("data-cr-bulk-key") || "";
      const item = typeof getItemByKey === "function" ? getItemByKey(key) : null;
      if (!item) return;
      setSelected(item, cb.checked);
    });
  });

  grid.querySelectorAll(".cr-card[data-item-key]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".cr-card__download") || e.target.closest(".cr-card__bulk")) return;
      const key = card.getAttribute("data-item-key") || "";
      const item = typeof getItemByKey === "function" ? getItemByKey(key) : null;
      if (!item) return;
      if (typeof onOpenDetail === "function") onOpenDetail(item);
    });
  });

  refreshSelectionUi();
}
