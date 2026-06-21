import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { savePrintAreaRect } from "../api.js";
import {
  getMockupDefaultForView,
  mockupImageUrl,
  aspectRatioFromDefault,
  clampRectToStage,
  fitRectWithAspect,
} from "./helpers.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function renderDualViewer(st, data) {
  const md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  const leftImg = mockupImageUrl(md);
  const mockImg = st.printifyMockUrl || "";

  const viewTabs = st.viewKeys
    .map(
      (vk) =>
        `<button type="button" class="ce-pa-view-tab ${vk === st.activeView ? "active" : ""}" data-view="${escapeHtml(vk)}">${escapeHtml(vk)}</button>`
    )
    .join("");

  return `
    <div class="ce-pa-viewers-wrap">
      <div class="ce-pa-viewers">
        <div class="ce-pa-viewer ce-pa-viewer--print">
          <div class="ce-pa-viewer-head">Print Area</div>
          <div class="ce-pa-stage" id="ce-pa-stage-left" data-layer="${escapeHtml(st.activeLayer)}">
            <img class="ce-pa-stage-img" id="ce-pa-img-left" alt="" ${leftImg ? `src="${escapeHtml(leftImg)}"` : ""} />
            <div class="ce-pa-rect ce-pa-rect--bounds ${st.boundsLocked ? "is-locked" : ""}" id="ce-pa-rect-red" title="Print area bounds">
              <button type="button" class="ce-pa-lock-btn" id="ce-pa-bounds-lock" aria-label="Lock bounds">${st.boundsLocked ? "🔒" : "🔓"}</button>
            </div>
            <div class="ce-pa-rect ce-pa-rect--placement ${st.activeLayer === "green" ? "is-active" : ""}" id="ce-pa-rect-green" title="Creator placement">
              <button type="button" class="ce-pa-snap-btn" id="ce-pa-snap-green" aria-label="Snap to print area" title="Snap to print area">⊞</button>
            </div>
          </div>
        </div>
        <div class="ce-pa-viewer ce-pa-viewer--mock">
          <div class="ce-pa-viewer-head">
            <span>Printify Mock</span>
            <button type="button" class="btn btn-ghost btn-xs" id="ce-pa-mock-refresh" title="Refresh Printify mock">↻</button>
          </div>
          <div class="ce-pa-stage" id="ce-pa-stage-mock">
            ${
              mockImg
                ? `<img class="ce-pa-stage-img" id="ce-pa-img-mock" alt="" src="${escapeHtml(mockImg)}" />`
                : `<div class="ce-pa-mock-empty" id="ce-pa-mock-empty">Click refresh to load Printify mock</div>`
            }
          </div>
        </div>
      </div>
      <div class="ce-pa-view-bar">${viewTabs}</div>
    </div>`;
}

export function mountDualViewer(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, onViewChange, onMockRefresh } = callbacks;
  const main = root.querySelector("#ce-pa-main");
  if (!main) return { destroy() {} };

  main.innerHTML = renderDualViewer(st, data);

  const md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  const aspect = aspectRatioFromDefault(md);
  const stage = main.querySelector("#ce-pa-stage-left");
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
    stage?.setAttribute("data-layer", st.activeLayer);
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
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const target = layer === "red" ? st.redRect : st.greenRect;
    const sx = (ev.clientX - box.left) / box.width;
    const sy = (ev.clientY - box.top) / box.height;
    const handle = ev.target.closest(".ce-pa-rect");
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
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
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
      if (drag.layer === "red" && aspect > 0) next = fitRectWithAspect(next, aspect);
      else next = clampRectToStage(next);
      Object.assign(target, next);
    }

    if (drag.layer === "red") {
      st.boundsDirty = true;
    } else {
      st.greenDirty = true;
      st.mockPreviewStale = true;
    }
    redraw();
    onStateChange?.();
  };

  const onMouseUp = () => {
    drag = null;
  };

  stage?.addEventListener("mousedown", (ev) => {
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

  main.querySelectorAll(".ce-pa-view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      onViewChange?.(btn.dataset.view);
    });
  });

  main.querySelector("#ce-pa-mock-refresh")?.addEventListener("click", () => {
    onMockRefresh?.();
  });

  return {
    refresh() {
      redraw();
      const img = main.querySelector("#ce-pa-img-left");
      const md2 = getMockupDefaultForView(data.mockup_defaults, st.activeView);
      const url = mockupImageUrl(md2);
      if (img && url) img.src = url;
    },
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
