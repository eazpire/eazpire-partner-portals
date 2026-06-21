import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { mountPrintAreaStage } from "./dual-viewer.js";

let openModal = null;

export function openPrintAreaFullscreen(ctx, st, data, callbacks = {}) {
  closePrintAreaFullscreen();
  const overlay = document.createElement("div");
  overlay.className = "ce-pa-fs-modal";
  overlay.innerHTML = `
    <div class="ce-pa-fs-card" role="dialog" aria-modal="true" aria-label="Print area magnifier">
      <div class="ce-pa-fs-head">
        <span class="ce-pa-fs-title">Print Area — ${escapeHtml(st.activeView)}</span>
        <button type="button" class="btn btn-ghost btn-sm ce-pa-fs-close" aria-label="Close">×</button>
      </div>
      <div class="ce-pa-fs-body" id="ce-pa-fs-stage-host"></div>
    </div>`;

  document.body.appendChild(overlay);
  openModal = overlay;

  const host = overlay.querySelector("#ce-pa-fs-stage-host");
  const { onClose, onStateChange, ...stageCallbacks } = callbacks;
  const stageHandle = mountPrintAreaStage(host, ctx, st, data, {
    ...stageCallbacks,
    fullscreen: true,
    onStateChange: () => {
      onStateChange?.();
    },
  });

  const close = () => {
    onClose?.();
    stageHandle?.destroy?.();
    overlay.remove();
    if (openModal === overlay) openModal = null;
    window.removeEventListener("keydown", onKey);
  };

  overlay.querySelector(".ce-pa-fs-close")?.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
  };
  window.addEventListener("keydown", onKey);

  return {
    close,
    refresh: (nextSt = st, nextData = data) => stageHandle?.refresh?.(nextSt, nextData),
    redraw: () => stageHandle?.redraw?.(),
    redrawStageRects: () => stageHandle?.redrawStageRects?.(),
  };
}

export function closePrintAreaFullscreen() {
  openModal?.querySelector(".ce-pa-fs-close")?.click();
}
