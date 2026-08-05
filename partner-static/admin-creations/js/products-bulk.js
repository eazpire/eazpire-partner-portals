/**
 * Creations Portal Products — multi-select + floating action bar (IDEA-063).
 * Mirrors designs-bulk.js; Publish/Update are conditionally disabled based on
 * per-item eligibility flags from adminCreationsProductListEnrich.js.
 */

const selected = new Map(); // filter_product_key -> product item
/** When true, dock stays hidden even if selection is non-empty (e.g. while a bulk modal is open). */
let dockSuppressed = false;

export function selectionKey(item) {
  return String(item?.filter_product_key || item?.product_key || item?.id || "").trim();
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
    selected.set(key, item);
  }
  refreshSelectionUi();
}

function applyDockVisibility() {
  const dock = document.getElementById("cr-products-bulk-dock");
  if (!dock) return;
  const show = selected.size > 0 && !dockSuppressed;
  dock.hidden = !show;
  dock.classList.toggle("is-visible", show);
  dock.setAttribute("aria-hidden", show ? "false" : "true");
}

/** Hide floating bar without clearing selection (use while a bulk modal is open). */
export function suppressBulkDock() {
  dockSuppressed = true;
  applyDockVisibility();
}

/** Show floating bar again if products are still selected (e.g. modal cancelled). */
export function releaseBulkDock() {
  dockSuppressed = false;
  applyDockVisibility();
}

function syncActionAvailability() {
  const publishBtn = document.querySelector('[data-cr-products-bulk="publish"]');
  const updateBtn = document.querySelector('[data-cr-products-bulk="update"]');
  const items = getSelectedItems();
  if (publishBtn) publishBtn.disabled = !items.some((p) => p.publish_eligible_amazon_eu);
  if (updateBtn) updateBtn.disabled = !items.some((p) => p.needs_update);
}

function refreshSelectionUi() {
  const countEl = document.getElementById("cr-products-bulk-count");
  const n = selected.size;
  applyDockVisibility();
  syncActionAvailability();
  if (countEl) countEl.textContent = n === 1 ? "1 selected" : `${n} selected`;

  document.querySelectorAll(".cr-card--product[data-product-filter-key]").forEach((card) => {
    const key = card.getAttribute("data-product-filter-key") || "";
    const on = selected.has(key);
    card.classList.toggle("is-selected", on);
    const cb = card.querySelector(".cr-card__bulk-cb");
    if (cb) cb.checked = on;
  });
}

export function ensureProductsBulkDock(_rootEl, handlers = {}) {
  let dock = document.getElementById("cr-products-bulk-dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "cr-products-bulk-dock";
    dock.className = "cr-bulk-dock cr-bulk-dock--products";
    dock.hidden = true;
    dock.setAttribute("aria-hidden", "true");
    dock.innerHTML = `
      <div class="cr-bulk-dock__panel" role="toolbar" aria-label="Product bulk actions">
        <span class="cr-bulk-dock__count" id="cr-products-bulk-count">0 selected</span>
        <div class="cr-bulk-dock__actions">
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-products-bulk="all">Select all</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-products-bulk="none">Select none</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-products-bulk="unpublish">Unpublish</button>
          <button type="button" class="btn btn-secondary cr-bulk-dock__btn" data-cr-products-bulk="update">Update</button>
          <button type="button" class="btn btn-primary cr-bulk-dock__btn" data-cr-products-bulk="publish">Publish</button>
        </div>
      </div>`;
  }
  // Must live on document.body — inside .main/.app-root overflow clips position:fixed.
  if (dock.parentElement !== document.body) {
    document.body.appendChild(dock);
  }

  dock.querySelectorAll("[data-cr-products-bulk]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const act = btn.getAttribute("data-cr-products-bulk");
      if (act === "all" && typeof handlers.onSelectAll === "function") handlers.onSelectAll();
      if (act === "none") {
        releaseBulkDock();
        clearSelection();
      }
      if (act === "publish" || act === "unpublish" || act === "update") {
        suppressBulkDock();
      }
      if (act === "publish" && typeof handlers.onPublish === "function") handlers.onPublish(getSelectedItems());
      if (act === "unpublish" && typeof handlers.onUnpublish === "function") handlers.onUnpublish(getSelectedItems());
      if (act === "update" && typeof handlers.onUpdate === "function") handlers.onUpdate(getSelectedItems());
    };
  });

  refreshSelectionUi();
  return dock;
}

/** Hide dock when leaving Products page (dock stays on body). */
export function teardownProductsBulkDock() {
  dockSuppressed = false;
  clearSelection();
  applyDockVisibility();
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function checkboxHtml(item) {
  const key = selectionKey(item);
  const checked = isSelected(key) ? "checked" : "";
  return `<label class="cr-card__bulk" title="Select product">
    <input type="checkbox" class="cr-card__bulk-cb" data-cr-bulk-key="${escapeAttr(key)}" ${checked} />
    <span class="cr-card__bulk-box" aria-hidden="true"></span>
    <span class="visually-hidden">Select product</span>
  </label>`;
}

export function bindBulkCheckboxes(grid, { getItemByKey } = {}) {
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

  refreshSelectionUi();
}
