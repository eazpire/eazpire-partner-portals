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

export function mountDesignDock(hostEl, st, callbacks = {}) {
  removeDesignDock();
  if (!hostEl) return { destroy() {}, refresh() {} };
  hostEl.insertAdjacentHTML("beforeend", renderDesignDock(st));
  const dock = hostEl.querySelector("#ce-pa-design-dock");
  dock?.querySelectorAll("[data-remove-design]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onRemoveDesign?.(Number(btn.dataset.removeDesign));
    });
  });
  return {
    refresh() {
      const next = renderDesignDock(st);
      dock?.replaceWith(
        (() => {
          const wrap = document.createElement("div");
          wrap.innerHTML = next;
          return wrap.firstElementChild;
        })()
      );
      const newDock = hostEl.querySelector("#ce-pa-design-dock");
      newDock?.querySelectorAll("[data-remove-design]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          callbacks.onRemoveDesign?.(Number(btn.dataset.removeDesign));
        });
      });
    },
    destroy() {
      dock?.remove();
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
  const handle = mountDesignDock(parent, st, {});
  handle.destroy();
}

export function removeDesignDock() {
  document.getElementById("ce-pa-design-dock")?.remove();
}
