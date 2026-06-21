import { escapeHtml } from "/partner/shared/js/partner-api.js";

export function renderViewDock(st) {
  const tabs = st.viewKeys
    .map(
      (vk) =>
        `<button type="button" class="ce-pa-view-tab ${vk === st.activeView ? "active" : ""}" data-view="${escapeHtml(vk)}">${escapeHtml(vk)}</button>`
    )
    .join("");
  return `<div class="ce-pa-view-dock" id="ce-pa-view-dock" role="toolbar" aria-label="Print area views">${tabs}</div>`;
}

export function mountViewDock(hostEl, st, onViewChange) {
  removeViewDock();
  if (!hostEl) return { destroy() {} };
  hostEl.insertAdjacentHTML("beforeend", renderViewDock(st));
  const dock = hostEl.querySelector("#ce-pa-view-dock");
  dock?.querySelectorAll(".ce-pa-view-tab").forEach((btn) => {
    btn.addEventListener("click", () => onViewChange?.(btn.dataset.view));
  });
  return {
    destroy() {
      dock?.remove();
    },
  };
}

export function updateViewDockActive(st) {
  const dock = document.getElementById("ce-pa-view-dock");
  if (!dock) return;
  dock.querySelectorAll(".ce-pa-view-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === st.activeView);
  });
}

export function removeViewDock() {
  document.getElementById("ce-pa-view-dock")?.remove();
}
