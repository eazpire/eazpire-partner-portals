/**
 * Creations Portal Designs — multi-select + floating action bar (IDEA-057).
 */

const selected = new Map(); // item_key -> design item
/** When true, dock stays hidden even if selection is non-empty (e.g. while a bulk modal is open). */
let dockSuppressed = false;

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

function libraryStatusOf(item) {
  return String(item?.library_status || "").trim().toLowerCase() === "inactive" ? "inactive" : "active";
}

function refreshSelectionUi() {
  const countEl = document.getElementById("cr-bulk-count");
  const n = selected.size;
  applyDockVisibility();
  if (countEl) countEl.textContent = n === 1 ? "1 selected" : `${n} selected`;
  const items = getSelectedItems();
  const activateBtn = document.querySelector('[data-cr-bulk="activate"]');
  const deactivateBtn = document.querySelector('[data-cr-bulk="deactivate"]');
  if (activateBtn) {
    activateBtn.disabled = !items.some((item) => item?.id && libraryStatusOf(item) === "inactive");
  }
  if (deactivateBtn) {
    deactivateBtn.disabled = !items.some((item) => item?.id && libraryStatusOf(item) === "active");
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
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "cr-designs-bulk-dock";
    dock.className = "cr-bulk-dock";
    dock.hidden = true;
    dock.setAttribute("aria-hidden", "true");
    dock.innerHTML = `
      <div class="cr-bulk-dock__panel" role="toolbar" aria-label="Design bulk actions">
        <span class="cr-bulk-dock__count" id="cr-bulk-count">0 selected</span>
        <div class="cr-bulk-dock__actions">
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-bulk="all">Select all</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-bulk="none">Select none</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-bulk="activate">Activate</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-bulk="deactivate">Deactivate</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn cr-bulk-dock__btn--danger" data-cr-bulk="remove">Remove</button>
          <button type="button" class="btn btn-primary cr-bulk-dock__btn" data-cr-bulk="publish">Publish</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-bulk="update">Update</button>
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
      if (act === "remove" || act === "publish" || act === "update" || act === "activate" || act === "deactivate") {
        suppressBulkDock();
      }
      if (act === "remove" && typeof handlers.onRemove === "function") handlers.onRemove(getSelectedItems());
      if (act === "publish" && typeof handlers.onPublish === "function") handlers.onPublish(getSelectedItems());
      if (act === "update" && typeof handlers.onUpdate === "function") handlers.onUpdate(getSelectedItems());
      if (act === "activate" && typeof handlers.onActivate === "function") handlers.onActivate(getSelectedItems());
      if (act === "deactivate" && typeof handlers.onDeactivate === "function") handlers.onDeactivate(getSelectedItems());
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
