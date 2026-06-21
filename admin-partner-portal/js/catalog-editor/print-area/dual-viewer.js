import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { savePrintAreaRect } from "../api.js";
import {
  getMockupDefaultForView,
  aspectRatioFromDefault,
  clampRectToStage,
  fitRectWithAspect,
} from "./helpers.js";
import { resolveLeftViewerImage, resolvePrintifyMockUrl } from "./image-grid.js";
import { renderPatternOverlayHtml } from "./pattern-preview.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function stageInnerHtml(st, leftImg, mockImg) {
  return `
    <div class="ce-pa-viewers-wrap">
      <div class="ce-pa-viewers">
        <div class="ce-pa-viewer ce-pa-viewer--print">
          <div class="ce-pa-viewer-head">
            <span class="ce-pa-viewer-title">Print Area</span>
            <span class="ce-pa-viewer-head-spacer" aria-hidden="true"></span>
          </div>
          <div class="ce-pa-stage" id="ce-pa-stage-left" data-layer="${escapeHtml(st.activeLayer)}">
            <div class="ce-pa-stage-inner" id="ce-pa-stage-inner-left">
              <img class="ce-pa-stage-img" id="ce-pa-img-left" alt="" ${leftImg ? `src="${escapeHtml(leftImg)}"` : ""} />
              <div class="ce-pa-rect ce-pa-rect--bounds ${st.boundsLocked ? "is-locked" : ""}" id="ce-pa-rect-red" title="Print area bounds">
                <button type="button" class="ce-pa-lock-btn" id="ce-pa-bounds-lock" aria-label="Lock bounds">${st.boundsLocked ? "🔒" : "🔓"}</button>
              </div>
              <div class="ce-pa-pattern-layer" id="ce-pa-pattern-layer">${renderPatternOverlayHtml(st)}</div>
              <div class="ce-pa-rect ce-pa-rect--placement ${st.activeLayer === "green" ? "is-active" : ""}" id="ce-pa-rect-green" title="Creator placement">
                <button type="button" class="ce-pa-snap-btn" id="ce-pa-snap-green" aria-label="Snap to print area" title="Snap to print area">⊞</button>
              </div>
            </div>
          </div>
        </div>
        <div class="ce-pa-viewer ce-pa-viewer--mock">
          <div class="ce-pa-viewer-head">
            <span class="ce-pa-viewer-title">Printify Mock</span>
            <button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action" id="ce-pa-mock-refresh" title="Refresh Printify mock">↻</button>
          </div>
          <div class="ce-pa-stage" id="ce-pa-stage-mock">
            <div class="ce-pa-stage-inner ce-pa-stage-inner--mock">
              ${
                mockImg
                  ? `<img class="ce-pa-stage-img" id="ce-pa-img-mock" alt="" src="${escapeHtml(mockImg)}" />`
                  : `<div class="ce-pa-mock-empty" id="ce-pa-mock-empty">Click refresh to load Printify mock</div>`
              }
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

export function renderDualViewer(st, data) {
  const leftImg = resolveLeftViewerImage(st, data, st.activeView);
  const mockImg = resolvePrintifyMockUrl(st, st.activeView);
  return stageInnerHtml(st, leftImg, mockImg);
}

function refreshPatternLayer(main, st) {
  const layer = main.querySelector("#ce-pa-pattern-layer");
  if (layer) layer.innerHTML = renderPatternOverlayHtml(st);
}

function updatePrintAreaImage(main, st, data) {
  const imgEl = main.querySelector("#ce-pa-img-left");
  if (!imgEl) return;
  const leftImg = resolveLeftViewerImage(st, data, st.activeView);
  if (leftImg) {
    imgEl.src = leftImg;
    imgEl.hidden = false;
  } else {
    imgEl.removeAttribute("src");
  }
}

function updatePrintifyPanel(main, st) {
  const inner = main.querySelector(".ce-pa-stage-inner--mock");
  if (!inner) return;
  const mockImg = resolvePrintifyMockUrl(st, st.activeView);
  if (mockImg) {
    inner.innerHTML = `<img class="ce-pa-stage-img" id="ce-pa-img-mock" alt="" src="${escapeHtml(mockImg)}" />`;
  } else {
    inner.innerHTML = `<div class="ce-pa-mock-empty" id="ce-pa-mock-empty">Click refresh to load Printify mock</div>`;
  }
}

export function mountDualViewer(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, onMockRefresh } = callbacks;
  const main = root.querySelector("#ce-pa-main");
  if (!main) return { destroy() {} };

  main.innerHTML = renderDualViewer(st, data);

  let md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  let aspect = aspectRatioFromDefault(md);
  const stageInner = main.querySelector("#ce-pa-stage-inner-left");
  const rectRed = main.querySelector("#ce-pa-rect-red");
  const rectGreen = main.querySelector("#ce-pa-rect-green");
  const lockBtn = main.querySelector("#ce-pa-bounds-lock");

  let drag = null;

  const drawRect = (el, rect) => {
    if (!el || !rect) return;
    el.style.left = `${rect.x * 100}%`;
    el.style.top = `${rect.y * 100}%`;
    el.style.width = `${rect.w * 100}%`;
    el.style.height = `${rect.h * 100}%`;
  };

  const redraw = () => {
    drawRect(rectRed, st.redRect);
    drawRect(rectGreen, st.greenRect);
    rectRed?.classList.toggle("is-locked", st.boundsLocked);
    rectGreen?.classList.toggle("is-active", st.activeLayer === "green");
    rectRed?.classList.toggle("is-active", st.activeLayer === "red" && !st.boundsLocked);
    if (lockBtn) lockBtn.textContent = st.boundsLocked ? "🔒" : "🔓";
    main.querySelector("#ce-pa-stage-left")?.setAttribute("data-layer", st.activeLayer);
    refreshPatternLayer(main, st);
  };

  const refreshPrintArea = (nextSt, nextData) => {
    md = getMockupDefaultForView(nextData.mockup_defaults, nextSt.activeView);
    aspect = aspectRatioFromDefault(md);
    updatePrintAreaImage(main, nextSt, nextData);
    redraw();
  };

  const refreshPrintify = (nextSt) => {
    updatePrintifyPanel(main, nextSt);
  };

  redraw();

  const pickLayer = (layer) => {
    st.activeLayer = layer;
    redraw();
  };

  rectRed?.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".ce-pa-lock-btn")) return;
    if (st.boundsLocked) {
      pickLayer("red");
      return;
    }
    pickLayer("red");
    startDrag(ev, "red");
    ev.stopPropagation();
  });

  rectGreen?.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".ce-pa-snap-btn")) return;
    pickLayer("green");
    startDrag(ev, "green");
    ev.stopPropagation();
  });

  function startDrag(ev, layer) {
    const box = stageInner?.getBoundingClientRect();
    if (!box?.width || !box?.height) return;
    const target = layer === "red" ? st.redRect : st.greenRect;
    const sx = (ev.clientX - box.left) / box.width;
    const sy = (ev.clientY - box.top) / box.height;
    const onEdge =
      sx <= target.x + 0.02 ||
      sx >= target.x + target.w - 0.02 ||
      sy <= target.y + 0.02 ||
      sy >= target.y + target.h - 0.02;
    drag = {
      layer,
      type: onEdge && ev.shiftKey ? "resize" : "move",
      sx,
      sy,
      rect: { ...target },
    };
    ev.preventDefault();
  }

  const onMouseMove = (ev) => {
    if (!drag) return;
    const box = stageInner?.getBoundingClientRect();
    if (!box?.width || !box?.height) return;
    const x = clamp((ev.clientX - box.left) / box.width, 0, 1);
    const y = clamp((ev.clientY - box.top) / box.height, 0, 1);
    const target = drag.layer === "red" ? st.redRect : st.greenRect;

    if (drag.type === "move") {
      target.x = clamp(drag.rect.x + (x - drag.sx), 0, 1 - target.w);
      target.y = clamp(drag.rect.y + (y - drag.sy), 0, 1 - target.h);
    } else {
      const x1 = Math.min(drag.sx, x);
      const y1 = Math.min(drag.sy, y);
      const x2 = Math.max(drag.sx, x);
      const y2 = Math.max(drag.sy, y);
      let next = { x: x1, y: y1, w: clamp(x2 - x1, 0.02, 1), h: clamp(y2 - y1, 0.02, 1) };
      if (aspect > 0) next = fitRectWithAspect(next, aspect);
      else next = clampRectToStage(next);
      Object.assign(target, next);
    }

    if (drag.layer === "red") st.boundsDirty = true;
    else {
      st.greenDirty = true;
      st.mockPreviewStale = true;
    }
    redraw();
    onStateChange?.();
  };

  const onMouseUp = () => {
    drag = null;
  };

  stageInner?.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".ce-pa-rect")) return;
    pickLayer("green");
  });

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  lockBtn?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (!st.boundsLocked && st.boundsDirty) {
      lockBtn.disabled = true;
      try {
        await savePrintAreaRect({
          product_key: ctx.productKey,
          print_area_key: st.activeView,
          print_area_rect: st.redRect,
          mockup_rect: st.greenRect,
          universal_rect: st.redRect,
          placement: {
            x: Number((st.redRect.x + st.redRect.w / 2).toFixed(4)),
            y: Number((st.redRect.y + st.redRect.h / 2).toFixed(4)),
            scale: Number(Math.max(st.redRect.w, st.redRect.h).toFixed(4)),
          },
          auto_mirror: false,
        });
        st.boundsDirty = false;
      } finally {
        lockBtn.disabled = false;
      }
    }
    st.boundsLocked = !st.boundsLocked;
    redraw();
    onStateChange?.();
  });

  main.querySelector("#ce-pa-snap-green")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    st.greenRect = { ...st.redRect };
    st.greenDirty = true;
    st.mockPreviewStale = true;
    redraw();
    onStateChange?.();
  });

  main.querySelector("#ce-pa-mock-refresh")?.addEventListener("click", () => {
    onMockRefresh?.();
  });

  return {
    refreshPattern: () => refreshPatternLayer(main, st),
    refreshPrintArea: (nextSt = st, nextData = data) => refreshPrintArea(nextSt, nextData),
    refreshPrintify: (nextSt = st) => refreshPrintify(nextSt),
    destroy() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
  };
}

export function applyGreenRectToSlice(slice, viewKey, greenRect) {
  const vk = String(viewKey || "front").toLowerCase();
  if (!slice.edit_mode) slice.edit_mode = {};
  if (!slice.edit_mode[vk]) slice.edit_mode[vk] = { areas: [] };
  const block = slice.edit_mode[vk];
  if (!Array.isArray(block.areas)) block.areas = [];
  let cd = block.areas.find(
    (a) => a.type === "creator_design" || a.placeholder_type === "creator_design" || a.type === "design"
  );
  if (!cd) {
    cd = { type: "creator_design", rect: { ...greenRect } };
    block.areas.push(cd);
  } else {
    cd.rect = { ...greenRect };
  }
  return slice;
}
