/**
 * Admin Products grid density: Standard (auto-fill) or 8-per-row.
 */

const STORAGE_KEY = "cr-products-grid-view";
export const GRID_VIEW_STANDARD = "standard";
export const GRID_VIEW_COLS_8 = "cols-8";

export function getProductsGridView() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === GRID_VIEW_COLS_8) return GRID_VIEW_COLS_8;
  } catch (_) {}
  return GRID_VIEW_STANDARD;
}

export function setProductsGridView(mode) {
  const next = mode === GRID_VIEW_COLS_8 ? GRID_VIEW_COLS_8 : GRID_VIEW_STANDARD;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (_) {}
  applyProductsGridView();
  return next;
}

export function applyProductsGridView(gridEl = document.getElementById("cr-products-grid")) {
  if (!gridEl) return getProductsGridView();
  const mode = getProductsGridView();
  gridEl.classList.toggle("cr-grid--cols-8", mode === GRID_VIEW_COLS_8);
  return mode;
}

export function productsGridMenuHtml(active = getProductsGridView()) {
  const standardOn = active === GRID_VIEW_STANDARD;
  const eightOn = active === GRID_VIEW_COLS_8;
  return `
    <div class="cr-topbar-menu" id="cr-products-grids-menu" hidden role="menu" aria-label="Grid views">
      <button type="button" class="cr-topbar-menu__item${standardOn ? " is-active" : ""}" data-cr-grid-view="${GRID_VIEW_STANDARD}" role="menuitem">
        <strong>Standard</strong>
        <span>Current auto-fill layout</span>
      </button>
      <button type="button" class="cr-topbar-menu__item${eightOn ? " is-active" : ""}" data-cr-grid-view="${GRID_VIEW_COLS_8}" role="menuitem">
        <strong>8er Grid</strong>
        <span>8 products in one row</span>
      </button>
    </div>`;
}

let outsideCloser = null;
let escapeCloser = null;

export function teardownProductsGridMenu() {
  if (outsideCloser) document.removeEventListener("click", outsideCloser);
  if (escapeCloser) document.removeEventListener("keydown", escapeCloser);
  outsideCloser = null;
  escapeCloser = null;
}

export function bindProductsGridMenu(root, { onChange } = {}) {
  teardownProductsGridMenu();
  const menu = root?.querySelector("#cr-products-grids-menu") || document.getElementById("cr-products-grids-menu");
  const toggle = root?.querySelector('[data-cr-tool="grids"]');
  if (!menu || !toggle) return;

  const close = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.onclick = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  menu.querySelectorAll("[data-cr-grid-view]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const mode = setProductsGridView(btn.getAttribute("data-cr-grid-view"));
      menu.querySelectorAll("[data-cr-grid-view]").forEach((other) => {
        other.classList.toggle("is-active", other.getAttribute("data-cr-grid-view") === mode);
      });
      close();
      if (typeof onChange === "function") onChange(mode);
    };
  });

  outsideCloser = (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    close();
  };
  escapeCloser = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("click", outsideCloser);
  document.addEventListener("keydown", escapeCloser);
}
