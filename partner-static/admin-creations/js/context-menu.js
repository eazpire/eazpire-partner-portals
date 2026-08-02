/**
 * Lightweight right-click context menu for Admin Creations cards.
 * PLATFORM_SPECIFIC — admin.eazpire.com/creations only.
 */

let activeMenu = null;
let outsideBound = false;

function ensureMenuEl() {
  let el = document.getElementById("cr-ctx-menu");
  if (el) return el;
  el = document.createElement("div");
  el.id = "cr-ctx-menu";
  el.className = "cr-ctx-menu";
  el.hidden = true;
  el.setAttribute("role", "menu");
  document.body.appendChild(el);
  return el;
}

function closeContextMenu() {
  const el = activeMenu || document.getElementById("cr-ctx-menu");
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
  activeMenu = null;
}

function onDocPointerDown(e) {
  const el = document.getElementById("cr-ctx-menu");
  if (!el || el.hidden) return;
  if (el.contains(e.target)) return;
  closeContextMenu();
}

function onDocKeydown(e) {
  if (e.key === "Escape") closeContextMenu();
}

function onScrollOrResize() {
  closeContextMenu();
}

function bindOutsideOnce() {
  if (outsideBound) return;
  outsideBound = true;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown, true);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
}

/**
 * @param {MouseEvent} event
 * @param {{ label: string, action: string, danger?: boolean, disabled?: boolean }[]} items
 * @param {(action: string) => void|Promise<void>} onSelect
 */
export function openContextMenu(event, items, onSelect) {
  event.preventDefault();
  event.stopPropagation();
  bindOutsideOnce();

  const el = ensureMenuEl();
  const list = (items || []).filter(Boolean);
  if (!list.length) {
    closeContextMenu();
    return;
  }

  el.innerHTML = list
    .map((item) => {
      const danger = item.danger ? " cr-ctx-menu__item--danger" : "";
      const disabled = item.disabled ? " disabled" : "";
      return `<button type="button" class="cr-ctx-menu__item${danger}" role="menuitem" data-cr-ctx-action="${String(
        item.action || ""
      ).replace(/"/g, "")}"${disabled ? " disabled" : ""}>${String(item.label || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</button>`;
    })
    .join("");

  el.hidden = false;
  activeMenu = el;

  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = el.getBoundingClientRect();
  let x = event.clientX;
  let y = event.clientY;
  if (x + rect.width + pad > vw) x = Math.max(pad, vw - rect.width - pad);
  if (y + rect.height + pad > vh) y = Math.max(pad, vh - rect.height - pad);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  el.querySelectorAll("[data-cr-ctx-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const action = btn.getAttribute("data-cr-ctx-action") || "";
      closeContextMenu();
      if (typeof onSelect === "function" && action) await onSelect(action);
    });
  });
}

export function teardownContextMenu() {
  closeContextMenu();
}

/**
 * Bind contextmenu on a grid for matching cards.
 * @param {HTMLElement} grid
 * @param {string} cardSelector
 * @param {(card: HTMLElement, event: MouseEvent) => void} handler
 */
export function bindCardContextMenu(grid, cardSelector, handler) {
  if (!grid || typeof handler !== "function") return;
  grid.addEventListener("contextmenu", (e) => {
    const card = e.target.closest?.(cardSelector);
    if (!card || !grid.contains(card)) return;
    // Allow native menu on inputs/buttons inside the card when useful
    if (e.target.closest("input, textarea, a[href]")) return;
    handler(card, e);
  });
}
