import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { listSessionDesignsForActiveView } from "./design-session-overlay.js";

export function renderDesignDock(st) {
  const designs = listSessionDesignsForActiveView(st);
  const chips = designs
    .map(
      (d) => `
    <div class="ce-pa-design-dock__chip" data-design-id="${Number(d.designId)}" title="${escapeHtml(d.title || "")}">
      <span class="ce-pa-design-dock__thumb">${d.previewUrl ? `<img src="${escapeHtml(d.previewUrl)}" alt="" />` : escapeHtml(d.title || "Design")}</span>
      <span class="ce-pa-design-dock__label">${escapeHtml(d.title || `Design #${d.designId}`)}</span>
      <button type="button" class="ce-pa-design-dock__remove" data-remove-design="${Number(d.designId)}" aria-label="Remove design">×</button>
    </div>`
    )
    .join("");
  const empty = designs.length
    ? ""
    : `<span class="ce-pa-design-dock__empty">No design on this view</span>`;
  return `<div class="ce-pa-design-dock" id="ce-pa-design-dock" role="toolbar" aria-label="Placed designs">
    <span class="ce-pa-design-dock__title">Designs</span>
    <div class="ce-pa-design-dock__chips">${chips}${empty}</div>
  </div>`;
}

function bindDesignDockRemove(dockEl, callbacks = {}) {
  dockEl?.querySelectorAll("[data-remove-design]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onRemoveDesign?.(Number(btn.dataset.removeDesign));
    });
  });
}

export function mountDesignDock(hostEl, st, callbacks = {}) {
  removeDesignDock();
  if (!hostEl) return { destroy() {}, refresh() {} };

  const paint = () => {
    removeDesignDock();
    hostEl.insertAdjacentHTML("beforeend", renderDesignDock(st));
    const dock = hostEl.querySelector("#ce-pa-design-dock");
    bindDesignDockRemove(dock, callbacks);
    return dock;
  };

  paint();

  return {
    refresh() {
      paint();
    },
    destroy() {
      removeDesignDock();
    },
  };
}

export function remountDesignDock(hostEl, st, callbacks) {
  return mountDesignDock(hostEl, st, callbacks);
}

export function updateDesignDock(st) {
  const dock = document.getElementById("ce-pa-design-dock");
  if (!dock) return;
  const parent = dock.parentElement;
  if (!parent) return;
  mountDesignDock(parent, st, {});
}

export function removeDesignDock() {
  document.getElementById("ce-pa-design-dock")?.remove();
}
