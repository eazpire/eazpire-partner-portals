import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { savePrintAreaRect } from "../api.js";
import {
  getMockupDefaultForView,
  aspectRatioFromDefault,
  clampRectToStage,
  fitRectWithAspect,
  getDesignTypeSlice,
} from "./helpers.js";
import { resolveLeftViewerImage, resolvePrintifyMockUrl } from "./image-grid.js";
import { renderPatternOverlayHtml } from "./pattern-preview.js";
import { resolvePlacementOverlays, refreshPlacementOverlayLayer } from "./placement-overlays.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function angleDeg(cx, cy, x, y) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
}

function drawRect(el, rect, active = false) {
  if (!el || !rect) return;
  el.style.left = `${rect.x * 100}%`;
  el.style.top = `${rect.y * 100}%`;
  el.style.width = `${rect.w * 100}%`;
  el.style.height = `${rect.h * 100}%`;
  const angle = Number(rect.angle) || 0;
  el.style.transform = angle ? `rotate(${angle}deg)` : "";
  el.querySelector(".ce-pa-rotate-handle")?.classList.toggle("is-visible", active);
}

function printAreaStageHtml(st, data, leftImg, overlays, options = {}) {
  const { showMagnify = true, stageId = "ce-pa-stage-left" } = options;
  const magnifyBtn = showMagnify
    ? `<button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action ce-pa-magnify-btn" title="Fullscreen magnifier" aria-label="Fullscreen magnifier">🔍</button>`
    : "";
  return `
    <div class="ce-pa-viewer ce-pa-viewer--print">
      <div class="ce-pa-viewer-head">
        <span class="ce-pa-viewer-title">Print Area</span>
        ${magnifyBtn}
        <span class="ce-pa-viewer-head-spacer" aria-hidden="true"></span>
      </div>
      <div class="ce-pa-stage" id="${escapeHtml(stageId)}" data-layer="${escapeHtml(st.activeLayer)}">
        <div class="ce-pa-stage-inner" data-stage-inner="left">
          <img class="ce-pa-stage-img" data-stage-img="left" alt="" ${leftImg ? `src="${escapeHtml(leftImg)}"` : ""} />
          <div class="ce-pa-rect ce-pa-rect--bounds ${st.boundsLocked ? "is-locked" : ""}" data-rect="red" title="Print area bounds">
            <button type="button" class="ce-pa-lock-btn" data-bounds-lock aria-label="Lock bounds">${st.boundsLocked ? "🔒" : "🔓"}</button>
            <span class="ce-pa-rotate-handle" data-rotate="red" title="Rotate"></span>
          </div>
          <div class="ce-pa-pattern-layer" data-pattern-layer>${renderPatternOverlayHtml(st)}</div>
          <div class="ce-pa-placement-layer" data-placement-layer>${overlays || ""}</div>
          <div class="ce-pa-rect ce-pa-rect--placement ${st.activeLayer === "green" ? "is-active" : ""}" data-rect="green" title="Creator placement">
            <button type="button" class="ce-pa-snap-btn" data-snap-green aria-label="Snap to print area" title="Snap to print area">⊞</button>
            <span class="ce-pa-rotate-handle" data-rotate="green" title="Rotate"></span>
          </div>
        </div>
      </div>
    </div>`;
}

function mockStageHtml(st, mockImg, options = {}) {
  const { showMagnify = true } = options;
  const magnifyBtn = showMagnify
    ? `<button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action ce-pa-magnify-btn" data-magnify="mock" title="Fullscreen magnifier" aria-label="Fullscreen magnifier">🔍</button>`
    : "";
  return `
    <div class="ce-pa-viewer ce-pa-viewer--mock">
      <div class="ce-pa-viewer-head">
        <span class="ce-pa-viewer-title">Printify Mock</span>
        ${magnifyBtn}
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
    </div>`;
}

function placementHtml(ctx, st, data, brandAssets) {
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);
  return overlays
    .map((ov) => {
      const cls =
        ov.type === "creator_design"
          ? "ce-pa-rect--creator"
          : ov.type === "additional_design"
            ? "ce-pa-rect--additional"
            : "ce-pa-rect--brand";
      const r = ov.rect || {};
      const angle = Number(r.angle) || 0;
      const transform = angle ? ` transform: rotate(${angle}deg);` : "";
      const img =
        ov.imageUrl && (ov.type === "qr" || ov.type === "logo")
          ? `<img src="${escapeHtml(ov.imageUrl)}" alt="" />`
          : "";
      return `<div class="ce-pa-rect ce-pa-rect--overlay ${cls}" data-ph-type="${escapeHtml(ov.type)}" data-ph-index="${ov.index}"
        style="left:${(r.x || 0) * 100}%;top:${(r.y || 0) * 100}%;width:${(r.w || 0) * 100}%;height:${(r.h || 0) * 100}%;${transform}">${img}</div>`;
    })
    .join("");
}

function stageInnerHtml(st, data, ctx, brandAssets) {
  const leftImg = resolveLeftViewerImage(st, data, st.activeView);
  const mockImg = resolvePrintifyMockUrl(st, st.activeView);
  const overlays = placementHtml(ctx, st, data, brandAssets);
  return `
    <div class="ce-pa-viewers-wrap">
      <div class="ce-pa-viewers">
        ${printAreaStageHtml(st, data, leftImg, overlays)}
        ${mockStageHtml(st, mockImg)}
      </div>
    </div>`;
}

export function renderDualViewer(st, data, ctx, brandAssets) {
  return stageInnerHtml(st, data, ctx, brandAssets);
}

export function mountPrintAreaStage(container, ctx, st, data, callbacks = {}) {
  const { onStateChange, brandAssets } = callbacks;
  const leftImg = resolveLeftViewerImage(st, data, st.activeView);
  const overlays = placementHtml(ctx, st, data, brandAssets);
  container.innerHTML = printAreaStageHtml(st, data, leftImg, overlays, {
    showMagnify: false,
    stageId: "ce-pa-fs-stage",
  });

  return bindStageInteractions(container, ctx, st, data, callbacks);
}

function bindStageInteractions(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, brandAssets } = callbacks;

  let md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  let aspect = aspectRatioFromDefault(md);
  const stageInner = root.querySelector('[data-stage-inner="left"]');
  const rectRed = root.querySelector('[data-rect="red"]');
  const rectGreen = root.querySelector('[data-rect="green"]');
  const lockBtn = root.querySelector("[data-bounds-lock]");

  let drag = null;

  const refreshOverlays = () => {
    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);
    refreshPlacementOverlayLayer(stageInner, overlays);
  };

  const redraw = () => {
    drawRect(rectRed, st.redRect, st.activeLayer === "red" && !st.boundsLocked);
    drawRect(rectGreen, st.greenRect, st.activeLayer === "green");
    rectRed?.classList.toggle("is-locked", st.boundsLocked);
    rectGreen?.classList.toggle("is-active", st.activeLayer === "green");
    rectRed?.classList.toggle("is-active", st.activeLayer === "red" && !st.boundsLocked);
    if (lockBtn) lockBtn.textContent = st.boundsLocked ? "🔒" : "🔓";
    root.querySelector("#ce-pa-stage-left, #ce-pa-fs-stage")?.setAttribute("data-layer", st.activeLayer);
    const patternLayer = root.querySelector("[data-pattern-layer]");
    if (patternLayer) patternLayer.innerHTML = renderPatternOverlayHtml(st);
    refreshOverlays();
  };

  const refresh = (nextSt = st, nextData = data) => {
    md = getMockupDefaultForView(nextData.mockup_defaults, nextSt.activeView);
    aspect = aspectRatioFromDefault(md);
    const imgEl = root.querySelector('[data-stage-img="left"]');
    const leftImg = resolveLeftViewerImage(nextSt, nextData, nextSt.activeView);
    if (imgEl) {
      if (leftImg) {
        imgEl.src = leftImg;
        imgEl.hidden = false;
      } else {
        imgEl.removeAttribute("src");
      }
    }
    redraw();
  };

  redraw();

  const pickLayer = (layer) => {
    st.activeLayer = layer;
    redraw();
  };

  const bindRect = (el, layer) => {
    el?.addEventListener("mousedown", (ev) => {
      if (ev.target.closest(".ce-pa-lock-btn, .ce-pa-snap-btn, .ce-pa-rotate-handle")) return;
      if (layer === "red" && st.boundsLocked) {
        pickLayer("red");
        return;
      }
      pickLayer(layer);
      startDrag(ev, layer);
      ev.stopPropagation();
    });
  };

  bindRect(rectRed, "red");
  bindRect(rectGreen, "green");

  root.querySelectorAll(".ce-pa-rotate-handle").forEach((handle) => {
    handle.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      const layer = handle.dataset.rotate;
      if (layer === "red" && st.boundsLocked) return;
      pickLayer(layer);
      startRotate(ev, layer);
      ev.preventDefault();
    });
  });

  function startRotate(ev, layer) {
    const box = stageInner?.getBoundingClientRect();
    if (!box?.width || !box?.height) return;
    const target = layer === "red" ? st.redRect : st.greenRect;
    const cx = box.left + (target.x + target.w / 2) * box.width;
    const cy = box.top + (target.y + target.h / 2) * box.height;
    drag = { layer, type: "rotate", cx, cy, startAngle: Number(target.angle) || 0, baseAngle: angleDeg(cx, cy, ev.clientX, ev.clientY) };
  }

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
    const target = drag.layer === "red" ? st.redRect : st.greenRect;

    if (drag.type === "rotate") {
      const cur = angleDeg(drag.cx, drag.cy, ev.clientX, ev.clientY);
      target.angle = drag.startAngle + (cur - drag.baseAngle);
      while (target.angle > 180) target.angle -= 360;
      while (target.angle < -180) target.angle += 360;
    } else {
      const x = clamp((ev.clientX - box.left) / box.width, 0, 1);
      const y = clamp((ev.clientY - box.top) / box.height, 0, 1);

      if (drag.type === "move") {
        target.x = clamp(drag.rect.x + (x - drag.sx), 0, 1 - target.w);
        target.y = clamp(drag.rect.y + (y - drag.sy), 0, 1 - target.h);
      } else {
        const x1 = Math.min(drag.sx, x);
        const y1 = Math.min(drag.sy, y);
        const x2 = Math.max(drag.sx, x);
        const y2 = Math.max(drag.sy, y);
        let next = { ...target, x: x1, y: y1, w: clamp(x2 - x1, 0.02, 1), h: clamp(y2 - y1, 0.02, 1) };
        if (aspect > 0) next = fitRectWithAspect(next, aspect);
        else next = clampRectToStage(next);
        Object.assign(target, next);
      }
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

  root.querySelector("[data-snap-green]")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    st.greenRect = { ...st.redRect };
    st.greenDirty = true;
    st.mockPreviewStale = true;
    redraw();
    onStateChange?.();
  });

  return {
    refresh,
    refreshPattern: () => {
      const patternLayer = root.querySelector("[data-pattern-layer]");
      if (patternLayer) patternLayer.innerHTML = renderPatternOverlayHtml(st);
    },
    refreshOverlays,
    destroy() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
  };
}

export function mountDualViewer(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, onMockRefresh, brandAssets, onMagnify } = callbacks;
  const main = root.querySelector("#ce-pa-main");
  if (!main) return { destroy() {} };

  main.innerHTML = renderDualViewer(st, data, ctx, brandAssets);

  const stageHandle = bindStageInteractions(main, ctx, st, data, { onStateChange, brandAssets });

  const refreshPatternLayer = () => stageHandle.refreshPattern?.();

  const updatePrintAreaImage = () => stageHandle.refresh?.(st, data);

  const updatePrintifyPanel = () => {
    const inner = main.querySelector(".ce-pa-stage-inner--mock");
    if (!inner) return;
    const mockImg = resolvePrintifyMockUrl(st, st.activeView);
    if (mockImg) {
      inner.innerHTML = `<img class="ce-pa-stage-img" id="ce-pa-img-mock" alt="" src="${escapeHtml(mockImg)}" />`;
    } else {
      inner.innerHTML = `<div class="ce-pa-mock-empty" id="ce-pa-mock-empty">Click refresh to load Printify mock</div>`;
    }
  };

  main.querySelectorAll(".ce-pa-magnify-btn").forEach((btn) => {
    btn.addEventListener("click", () => onMagnify?.());
  });

  main.querySelector("#ce-pa-mock-refresh")?.addEventListener("click", () => {
    onMockRefresh?.();
  });

  return {
    refreshPattern: refreshPatternLayer,
    refreshPrintArea: (nextSt = st, nextData = data) => {
      Object.assign(st, nextSt);
      stageHandle.refresh?.(st, nextData);
      updatePrintAreaImage();
    },
    refreshPrintify: () => updatePrintifyPanel(),
    refreshOverlays: () => stageHandle.refreshOverlays?.(),
    destroy() {
      stageHandle.destroy?.();
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
