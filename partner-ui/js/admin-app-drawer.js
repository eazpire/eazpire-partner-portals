import { escapeHtml } from "./partner-api.js";

/** @type {{ id: string, label: string, route: string, iconSvg: string }[]} */
export const ADMIN_APPS = [
  {
    id: "partner",
    label: "Partner",
    route: "/partner",
    iconSvg:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 21V10l8-6 8 6v11h-5v-7H9v7H4Zm2-2h3v-5h10v5h3V10.6l-7-5.25-7 5.25V19Z"/></svg>',
  },
  {
    id: "creations",
    label: "Creations",
    route: "/creations",
    iconSvg:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3c-1.5 2.4-3.6 4.1-6 5.2V11c0 5 3.8 9.4 9 10.8 5.2-1.4 9-5.8 9-10.8V8.2C17.6 7.1 15.5 5.4 14 3c-1.2 1.9-3 3.3-5 4.1 2 .8 3.8 2.2 5 4.1 1.2-1.9 3-3.3 5-4.1-2-.8-3.8-2.2-5-4.1Z"/></svg>',
  },
];

const DOTS_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" class="app-drawer-dots__svg">
  ${Array.from({ length: 9 })
    .map((_, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      return `<circle cx="${5 + col * 7}" cy="${5 + row * 7}" r="2.2" fill="currentColor"/>`;
    })
    .join("")}
</svg>`;

function appItemHtml(app, activeId) {
  const active = app.id === activeId ? " app-drawer__item--active" : "";
  return `<a class="app-drawer__item${active}" href="${escapeHtml(app.route)}">
    <span class="app-drawer__icon">${app.iconSvg}</span>
    <span class="app-drawer__label">${escapeHtml(app.label)}</span>
  </a>`;
}

function isSidebarExpanded() {
  const root = document.querySelector(".app-root");
  return root && !root.classList.contains("sidebar-collapsed");
}

function positionFloatingDrawer(panel, trigger) {
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const panelWidth = panel.offsetWidth || 360;
  let left = rect.left;
  const maxLeft = window.innerWidth - panelWidth - margin;
  if (left > maxLeft) left = Math.max(margin, maxLeft);
  panel.style.top = `${rect.bottom + margin}px`;
  panel.style.left = `${left}px`;
}

function mountFloatingDrawer(panel) {
  if (panel.parentElement === document.body) return;
  panel._drawerAnchor = panel.parentElement;
  panel._drawerNext = panel.nextElementSibling;
  document.body.appendChild(panel);
}

function restoreDrawerDom(panel) {
  if (!panel._drawerAnchor || panel.parentElement !== document.body) return;
  if (panel._drawerNext && panel._drawerNext.parentElement === panel._drawerAnchor) {
    panel._drawerAnchor.insertBefore(panel, panel._drawerNext);
  } else {
    panel._drawerAnchor.appendChild(panel);
  }
}

function applyDrawerLayout(panel, trigger, open) {
  if (!open) {
    panel.classList.remove("app-drawer--floating");
    panel.style.top = "";
    panel.style.left = "";
    restoreDrawerDom(panel);
    return;
  }
  if (isSidebarExpanded()) {
    mountFloatingDrawer(panel);
    panel.classList.add("app-drawer--floating");
    positionFloatingDrawer(panel, trigger);
  } else {
    panel.classList.remove("app-drawer--floating");
    panel.style.top = "";
    panel.style.left = "";
    restoreDrawerDom(panel);
  }
}

function closeDrawer() {
  const panel = document.getElementById("app-drawer");
  const trigger = document.getElementById("app-drawer-trigger");
  if (!panel) return;
  panel.hidden = true;
  panel.classList.remove("show");
  trigger?.setAttribute("aria-expanded", "false");
  applyDrawerLayout(panel, trigger, false);
}

function openDrawer() {
  const panel = document.getElementById("app-drawer");
  const trigger = document.getElementById("app-drawer-trigger");
  if (!panel) return;
  panel.hidden = false;
  panel.classList.add("show");
  trigger?.setAttribute("aria-expanded", "true");
  if (trigger) {
    applyDrawerLayout(panel, trigger, true);
    requestAnimationFrame(() => positionFloatingDrawer(panel, trigger));
  }
}

function toggleDrawer() {
  const panel = document.getElementById("app-drawer");
  if (!panel) return;
  if (panel.classList.contains("show")) closeDrawer();
  else openDrawer();
}

function getDrawerTriggers() {
  return [...document.querySelectorAll("#app-drawer-trigger, .app-drawer-trigger")];
}

/**
 * @param {{ currentAppId: string, brandTitle?: string }} opts
 */
export function initAdminAppDrawer({ currentAppId, brandTitle }) {
  const trigger = document.getElementById("app-drawer-trigger");
  const panel = document.getElementById("app-drawer");
  if (!trigger || !panel) return;

  if (brandTitle) {
    const brandName = document.querySelector(".sidebar .brand-block .brand-name");
    if (brandName) brandName.textContent = brandTitle;
  }

  trigger.innerHTML = DOTS_SVG;
  trigger.setAttribute("aria-label", "Eazpire apps");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "app-drawer");

  panel.innerHTML = `
    <div class="app-drawer__head">
      <strong class="app-drawer__title">Eazpire Admin</strong>
    </div>
    <div class="app-drawer__grid">
      ${ADMIN_APPS.map((app) => appItemHtml(app, currentAppId)).join("")}
    </div>`;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDrawer();
  });

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("show")) return;
    const triggers = getDrawerTriggers();
    if (panel.contains(e.target) || triggers.some((t) => t.contains(e.target))) return;
    closeDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  window.addEventListener("resize", () => {
    if (!panel.classList.contains("show") || !panel.classList.contains("app-drawer--floating")) return;
    positionFloatingDrawer(panel, trigger);
  });

  document.getElementById("sidebar-collapse")?.addEventListener("click", () => {
    if (!panel.classList.contains("show")) return;
    window.setTimeout(() => {
      if (!isSidebarExpanded()) closeDrawer();
      else positionFloatingDrawer(panel, trigger);
    }, 0);
  });
}
