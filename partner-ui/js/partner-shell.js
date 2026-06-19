import { escapeHtml } from "./partner-api.js";

let modalSaveHandler = null;
let modalCancelHandler = null;

const DEFAULT_MODAL_FOOTER = {
  saveLabel: "Save",
  saveClass: "btn btn-primary",
  cancelLabel: "Cancel",
  saveDisplay: "",
};

function resetModalFooter() {
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  const modal = document.querySelector("#modal-backdrop .modal");
  if (saveBtn) {
    saveBtn.textContent = DEFAULT_MODAL_FOOTER.saveLabel;
    saveBtn.className = DEFAULT_MODAL_FOOTER.saveClass;
    saveBtn.style.display = DEFAULT_MODAL_FOOTER.saveDisplay;
    saveBtn.disabled = false;
  }
  if (cancelBtn) {
    cancelBtn.textContent = DEFAULT_MODAL_FOOTER.cancelLabel;
    cancelBtn.style.display = "";
  }
  modal?.classList.remove("confirm-modal");
}

export function showToast(title, text) {
  const el = document.getElementById("partner-toast");
  if (!el) return;
  el.querySelector("strong").textContent = title;
  el.querySelector("span").textContent = text || "";
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

export function openModal({ title, bodyHtml, onSave }) {
  const backdrop = document.getElementById("modal-backdrop");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  modalSaveHandler = onSave || null;
  modalCancelHandler = null;
  backdrop.hidden = false;
  backdrop.classList.add("show");
}

function dismissModal() {
  const backdrop = document.getElementById("modal-backdrop");
  if (!backdrop?.classList.contains("show")) return;
  const handler = modalCancelHandler;
  closeModal();
  if (handler) handler();
}

export function closeModal() {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.classList.remove("show");
  backdrop.hidden = true;
  modalSaveHandler = null;
  modalCancelHandler = null;
  resetModalFooter();
}

/** Reject/suspend style modal with mode radios and optional reason textarea. */
export function openActionModeModal({
  title,
  message,
  modes,
  defaultMode,
  reasonLabel = "Reason (optional)",
  reasonPlaceholder = "",
  confirmLabels = {},
  confirmClasses = {},
  onConfirm,
}) {
  const defaultVal = defaultMode || modes[0]?.value;
  const modesHtml = (modes || [])
    .map(
      (mode) => `<label class="action-mode-option">
        <input type="radio" name="action-mode" value="${escapeHtml(mode.value)}" ${mode.value === defaultVal ? "checked" : ""} />
        <span><strong>${escapeHtml(mode.label)}</strong> — ${escapeHtml(mode.description || "")}</span>
      </label>`
    )
    .join("");

  openModal({
    title,
    bodyHtml: `
      ${message ? `<p class="confirm-modal-message">${escapeHtml(message)}</p>` : ""}
      <div class="action-mode-options">${modesHtml}</div>
      <div class="field" style="margin-top:16px">
        <label>${escapeHtml(reasonLabel)}</label>
        <textarea class="textarea" id="action-mode-reason" rows="3" placeholder="${escapeHtml(reasonPlaceholder)}"></textarea>
      </div>`,
    onSave: async () => {
      const mode = document.querySelector('input[name="action-mode"]:checked')?.value;
      const reason = document.getElementById("action-mode-reason")?.value?.trim() || "";
      if (onConfirm) await onConfirm({ mode, reason });
    },
  });

  modalCancelHandler = null;
  const saveBtn = document.getElementById("modal-save");
  const modal = document.querySelector("#modal-backdrop .modal");
  modal?.classList.add("confirm-modal", "action-mode-modal");

  const updateSaveBtn = () => {
    const mode = document.querySelector('input[name="action-mode"]:checked')?.value;
    if (!saveBtn || !mode) return;
    saveBtn.textContent = confirmLabels[mode] || "Confirm";
    saveBtn.className = `btn ${confirmClasses[mode] || "btn-primary"}`;
    saveBtn.style.display = "";
  };

  document.querySelectorAll('input[name="action-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateSaveBtn);
  });
  updateSaveBtn();
}

/** Styled confirmation dialog using the shared modal shell (replaces window.confirm). */
export function confirmAction({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmClass = "btn-primary",
  onConfirm,
  onCancel,
}) {
  openModal({
    title,
    bodyHtml: `<p class="confirm-modal-message">${escapeHtml(message)}</p>`,
    onSave: onConfirm,
  });
  modalCancelHandler = onCancel || null;
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  const modal = document.querySelector("#modal-backdrop .modal");
  modal?.classList.add("confirm-modal");
  if (saveBtn) {
    saveBtn.textContent = confirmLabel;
    saveBtn.className = `btn ${confirmClass}`;
    saveBtn.style.display = "";
  }
  if (cancelBtn) cancelBtn.textContent = cancelLabel;
}

function navItemHtml(item) {
  return `<button type="button" class="nav-item" data-route="${escapeHtml(item.route)}"><span class="nav-icon">${item.icon || "•"}</span><span class="nav-label">${escapeHtml(item.label)}</span></button>`;
}

const MOBILE_DRAWER_MQ = "(max-width: 768px)";
const DESKTOP_SIDEBAR_MQ = "(min-width: 769px)";
const SIDEBAR_COLLAPSED_KEY = "partner_shell_sidebar_collapsed";

function isDesktopSidebar() {
  return window.matchMedia(DESKTOP_SIDEBAR_MQ).matches;
}

function isSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function setSidebarCollapsed(collapsed) {
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  document.querySelectorAll(".app-root:not(.app-root--full)").forEach((shell) => {
    shell.classList.toggle("sidebar-collapsed", collapsed && isDesktopSidebar());
    const btn = shell.querySelector("#sidebar-collapse");
    if (btn) {
      btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
      btn.textContent = collapsed ? "›" : "‹";
    }
  });
}

function initDesktopSidebarCollapse(shell) {
  if (!shell || shell.classList.contains("app-root--full")) return;

  const collapseBtn = shell.querySelector("#sidebar-collapse");
  if (!collapseBtn) return;

  const apply = () => {
    const collapsed = isSidebarCollapsed();
    shell.classList.toggle("sidebar-collapsed", collapsed && isDesktopSidebar());
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    collapseBtn.textContent = collapsed ? "›" : "‹";
  };

  apply();
  collapseBtn.addEventListener("click", () => {
    if (!isDesktopSidebar()) return;
    setSidebarCollapsed(!isSidebarCollapsed());
  });

  window.matchMedia(DESKTOP_SIDEBAR_MQ).addEventListener("change", apply);
}

function getActiveShell() {
  return document.querySelector(".app-root:not([hidden]):not(.app-root--full)");
}

function setDrawerOpen(shell, open) {
  if (!shell) return;
  shell.classList.toggle("sidebar-open", open);
  const toggle = shell.querySelector("#sidebar-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  const backdrop = shell.querySelector("#sidebar-backdrop");
  if (backdrop) backdrop.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("drawer-open", open);
}

function closeDrawer(shell = getActiveShell()) {
  setDrawerOpen(shell, false);
}

function initMobileShell(shell) {
  if (!shell || shell.classList.contains("app-root--full")) return;

  const toggle = shell.querySelector("#sidebar-toggle");
  const backdrop = shell.querySelector("#sidebar-backdrop");
  const nav = shell.querySelector("#partner-nav");

  toggle?.addEventListener("click", () => {
    const open = !shell.classList.contains("sidebar-open");
    setDrawerOpen(shell, open);
  });

  backdrop?.addEventListener("click", () => closeDrawer(shell));

  nav?.querySelectorAll("[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.matchMedia(MOBILE_DRAWER_MQ).matches) closeDrawer(shell);
    });
  });

  const searchBox = shell.querySelector(".search-box");
  const actions = shell.querySelector(".topbar-actions");
  if (searchBox && actions && !shell.querySelector("#search-toggle")) {
    const searchToggle = document.createElement("button");
    searchToggle.type = "button";
    searchToggle.id = "search-toggle";
    searchToggle.className = "icon-btn search-toggle";
    searchToggle.setAttribute("aria-label", "Search");
    searchToggle.textContent = "⌕";
    actions.insertBefore(searchToggle, searchBox);
    searchToggle.addEventListener("click", () => {
      actions.classList.toggle("search-expanded");
      if (actions.classList.contains("search-expanded")) {
        searchBox.querySelector("input")?.focus();
      } else {
        searchBox.querySelector("input")?.blur();
      }
    });
  }

  window.matchMedia(MOBILE_DRAWER_MQ).addEventListener("change", (e) => {
    if (!e.matches) {
      closeDrawer(shell);
      actions?.classList.remove("search-expanded");
    }
  });
}

export function initShell({ navItems, navSections, onRoute, brandSub = "Manufacturer Portal", crumbLabels = {} }) {
  document.querySelector(".brand-sub").textContent = brandSub;
  const nav = document.getElementById("partner-nav");
  if (navSections?.length) {
    nav.innerHTML = navSections
      .map(
        (section) =>
          `<div class="nav-section-title">${escapeHtml(section.title)}</div>${section.items.map(navItemHtml).join("")}`
      )
      .join("");
  } else {
    nav.innerHTML = (navItems || []).map(navItemHtml).join("");
  }
  initShell._crumbLabels = crumbLabels;

  nav.querySelectorAll("[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.route, onRoute));
  });

  document.getElementById("modal-close")?.addEventListener("click", dismissModal);
  document.getElementById("modal-cancel")?.addEventListener("click", dismissModal);
  document.getElementById("modal-save")?.addEventListener("click", async () => {
    try {
      if (modalSaveHandler) await modalSaveHandler();
      closeModal();
    } catch (e) {
      showToast("Error", e.message || String(e));
    }
  });
  document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") dismissModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const shell = getActiveShell();
    if (shell?.classList.contains("sidebar-open")) {
      closeDrawer(shell);
      return;
    }
    dismissModal();
  });

  const shell = document.getElementById("app-shell");
  initMobileShell(shell);
  initDesktopSidebarCollapse(shell);

  const initial = location.pathname.replace(/\/$/, "") || "/";
  navigate(initial === "" ? "/" : initial, onRoute, true);
  window.addEventListener("popstate", () => navigate(location.pathname, onRoute, true));
}

export function navigate(route, onRoute, replace = false) {
  const path = route || "/";
  if (!replace) history.pushState({}, "", path);
  closeDrawer();
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === path);
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const view = document.querySelector(`.view[data-route="${path}"]`) || document.querySelector('.view[data-route="/"]');
  view?.classList.add("active");
  const titleEl = document.getElementById("page-title");
  const labels = initShell._crumbLabels || {};
  const pageTitle =
    labels[path] ||
    (path === "/" || path === "/partner" ? labels["/"] || labels["/partner"] || "Overview" : path.replace(/^\/partner\/?/, "").replace(/\//g, " / ") || "Overview");
  if (titleEl) titleEl.textContent = pageTitle;
  const legacyCrumb = document.getElementById("crumb-current");
  if (legacyCrumb) legacyCrumb.textContent = pageTitle;
  onRoute(path);
}

export function setTopbarExtra(html) {
  const el = document.getElementById("topbar-extra");
  if (el) el.innerHTML = html || "";
}

export function renderTable(headers, rowsHtml) {
  return `<div class="table-scroll"><table class="table"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}
