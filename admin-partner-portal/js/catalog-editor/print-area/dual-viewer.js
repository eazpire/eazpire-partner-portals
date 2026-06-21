import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { savePrintAreaRect } from "../api.js";
import { getPlaceholderSlotsForView } from "../version-config-panel.js";
import {
  getMockupDefaultForView,
  aspectRatioFromDefault,
  clampRectToStage,
  getDesignTypeSlice,
  normalizeRectToPrintAspect,
} from "./helpers.js";
import { resolveLeftViewerImage, resolvePrintifyMockUrl } from "./image-grid.js";
import { renderPatternOverlayHtml } from "./pattern-preview.js";
import { resolvePlacementOverlays, refreshPlacementOverlayLayer, renderPlacementOverlaysHtml } from "./placement-overlays.js";
import {
  rectHandlesHtml,
  resizeRectByCorner,
  angleDeg,
  lockAspectForPhType,
  setOverlayAreaRect,
  updateResizeHandleCursors,
  snapRotateAngle,
} from "./rect-interaction.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function resolveVersion(ctx, data) {
  return (data?.versions || []).find((v) => String(v.id) === String(ctx?.selectedVersionId)) || data?.version || null;
}

function placeholderSlotsForView(ctx, st, data) {
  const version = resolveVersion(ctx, data);
  const catalogDetail = { variants: data?.variants_json || data?.variants || [] };
  return getPlaceholderSlotsForView(version, catalogDetail, st.activeView);
}

function placementModeActive(slots) {
  return ["creator_design", "additional_design", "qr", "logo"].some((k) => (Number(slots[k]) || 0) > 0);
}

/** Green legacy rect: only when creator_design is configured and placement overlays are off. */
function shouldShowGreenRect(ctx, st, data) {
  const slots = placeholderSlotsForView(ctx, st, data);
  if ((Number(slots.creator_design) || 0) <= 0) return false;
  return !placementModeActive(slots);
}

function toggleRectHandles(el, active) {
  if (!el) return;
  el.querySelectorAll(".ce-pa-resize-handle, .ce-pa-rotate-handle").forEach((h) => {
    h.classList.toggle("is-visible", active);
  });
}

function drawRect(el, rect, active = false) {
  if (!el || !rect) return;
  el.style.left = `${rect.x * 100}%`;
  el.style.top = `${rect.y * 100}%`;
  el.style.width = `${rect.w * 100}%`;
  el.style.height = `${rect.h * 100}%`;
  const angle = Number(rect.angle) || 0;
  el.style.transform = angle ? `rotate(${angle}deg)` : "";
  toggleRectHandles(el, active);
  updateResizeHandleCursors(el, rect);
}

function stageInnerBox(stageInner) {
  const w = stageInner?.clientWidth || 0;
  const h = stageInner?.clientHeight || 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

function printAreaStageHtml(st, data, leftImg, overlays, options = {}) {
  const { showMagnify = true, stageId = "ce-pa-stage-left", showGreenRect = true } = options;
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
            ${rectHandlesHtml("red")}
          </div>
          <div class="ce-pa-pattern-layer" data-pattern-layer>${renderPatternOverlayHtml(st)}</div>
          <div class="ce-pa-placement-layer" data-placement-layer>${overlays || ""}</div>
          ${
            showGreenRect
              ? `<div class="ce-pa-rect ce-pa-rect--placement ${st.activeLayer === "green" ? "is-active" : ""}" data-rect="green" title="Creator placement">
            <button type="button" class="ce-pa-snap-btn" data-snap-green aria-label="Snap to print area" title="Snap to print area">⊞</button>
            ${rectHandlesHtml("green")}
          </div>`
              : ""
          }
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
  return renderPlacementOverlaysHtml(overlays);
}

function stageInnerHtml(st, data, ctx, brandAssets) {
  const leftImg = resolveLeftViewerImage(st, data, st.activeView);
  const mockImg = resolvePrintifyMockUrl(st, st.activeView);
  const overlays = placementHtml(ctx, st, data, brandAssets);
  const showGreenRect = shouldShowGreenRect(ctx, st, data);
  return `
    <div class="ce-pa-viewers-wrap">
      <div class="ce-pa-viewers">
        ${printAreaStageHtml(st, data, leftImg, overlays, { showGreenRect })}
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
  const showGreenRect = shouldShowGreenRect(ctx, st, data);
  container.innerHTML = printAreaStageHtml(st, data, leftImg, overlays, {
    showMagnify: false,
    stageId: "ce-pa-fs-stage",
    showGreenRect,
  });

  return bindStageInteractions(container, ctx, st, data, callbacks);
}

function bindStageInteractions(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, brandAssets } = callbacks;

  let md = getMockupDefaultForView(data.mockup_defaults, st.activeView);
  let aspect = aspectRatioFromDefault(md, data, st.activeView);
  const stageInner = root.querySelector('[data-stage-inner="left"]');

  const getStageBox = () => stageInnerBox(stageInner);
  const rectRed = root.querySelector('[data-rect="red"]');
  const rectGreen = root.querySelector('[data-rect="green"]');
  const lockBtn = root.querySelector("[data-bounds-lock]");

  let drag = null;
  const overlayRectMap = new WeakMap();
  let activeOverlayEl = null;

  const refreshOverlays = () => {
    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);
    refreshPlacementOverlayLayer(stageInner, overlays);
    bindOverlayInteractions();
  };

  const redraw = () => {
    const showGreen = shouldShowGreenRect(ctx, st, data);
    drawRect(rectRed, st.redRect, st.activeLayer === "red" && !st.boundsLocked);
    if (rectGreen) {
      rectGreen.hidden = !showGreen;
      if (showGreen) drawRect(rectGreen, st.greenRect, st.activeLayer === "green");
      else toggleRectHandles(rectGreen, false);
    }
    if (!showGreen && st.activeLayer === "green") st.activeLayer = "red";
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
    aspect = aspectRatioFromDefault(md, nextData, nextSt.activeView);
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
    const applyAspect = () => {
      const box = getStageBox();
      st.redRect = normalizeRectToPrintAspect(st.redRect, md, nextData, nextSt.activeView, box);
      redraw();
    };
    if (imgEl && leftImg && !imgEl.complete) {
      imgEl.addEventListener("load", applyAspect, { once: true });
    } else {
      requestAnimationFrame(applyAspect);
    }
  };

  const pickLayer = (layer) => {
    st.activeLayer = layer;
    activeOverlayEl = null;
    redraw();
  };

  const pickOverlay = (el) => {
    activeOverlayEl = el;
    st.activeLayer = "overlay";
    stageInner?.querySelectorAll(".ce-pa-rect--overlay").forEach((node) => {
      const active = node === el;
      node.classList.toggle("is-active", active);
      const rect = overlayRectMap.get(node);
      if (rect) drawRect(node, rect, active);
    });
    rectRed?.classList.remove("is-active");
    rectGreen?.classList.remove("is-active");
    toggleRectHandles(rectRed, false);
    toggleRectHandles(rectGreen, false);
    root.querySelector("#ce-pa-stage-left, #ce-pa-fs-stage")?.setAttribute("data-layer", "overlay");
  };

  const stagePoint = (ev) => {
    const box = stageInner?.getBoundingClientRect();
    if (!box?.width || !box?.height) return null;
    return {
      box,
      x: clamp((ev.clientX - box.left) / box.width, 0, 1),
      y: clamp((ev.clientY - box.top) / box.height, 0, 1),
    };
  };

  const bindResizeHandles = (el, onStart) => {
    el?.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        onStart(ev, handle.dataset.resize);
        ev.preventDefault();
      });
    });
  };

  const bindRect = (el, layer) => {
    bindResizeHandles(el, (ev, corner) => {
      if (layer === "red" && st.boundsLocked) return;
      pickLayer(layer);
      startLayerResize(ev, layer, corner);
    });

    el?.addEventListener("mousedown", (ev) => {
      if (ev.target.closest(".ce-pa-lock-btn, .ce-pa-snap-btn, .ce-pa-rotate-handle, .ce-pa-resize-handle")) return;
      if (layer === "red" && st.boundsLocked) {
        pickLayer("red");
        return;
      }
      pickLayer(layer);
      startLayerMove(ev, layer);
      ev.stopPropagation();
    });
  };

  function bindOverlayInteractions() {
    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);

    stageInner?.querySelectorAll(".ce-pa-rect--overlay").forEach((el) => {
      const phType = el.dataset.phType;
      const phIndex = Number(el.dataset.phIndex) || 0;
      const ov = overlays.find((o) => o.type === phType && o.index === phIndex);
      if (!ov) return;

      const rect = { ...(ov.rect || {}) };
      overlayRectMap.set(el, rect);
      const isActive = activeOverlayEl === el;
      el.classList.toggle("is-active", isActive);
      drawRect(el, rect, isActive);

      bindResizeHandles(el, (ev, corner) => {
        pickOverlay(el);
        startOverlayResize(ev, el, phType, phIndex, corner, rect);
      });

      el.querySelectorAll(".ce-pa-rotate-handle").forEach((handle) => {
        handle.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          pickOverlay(el);
          startOverlayRotate(ev, el, phType, phIndex, rect);
          ev.preventDefault();
        });
      });

      el.addEventListener("mousedown", (ev) => {
        if (ev.target.closest(".ce-pa-rotate-handle, .ce-pa-resize-handle")) return;
        pickOverlay(el);
        startOverlayMove(ev, el, phType, phIndex, rect);
        ev.stopPropagation();
      });
    });
  }

  bindRect(rectRed, "red");
  bindRect(rectGreen, "green");

  root.querySelectorAll('[data-rect="red"] .ce-pa-rotate-handle, [data-rect="green"] .ce-pa-rotate-handle').forEach((handle) => {
    handle.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      const layer = handle.dataset.rotate;
      if (layer === "red" && st.boundsLocked) return;
      pickLayer(layer);
      startLayerRotate(ev, layer);
      ev.preventDefault();
    });
  });

  function startLayerRotate(ev, layer) {
    const pt = stagePoint(ev);
    if (!pt) return;
    const target = layer === "red" ? st.redRect : st.greenRect;
    const cx = pt.box.left + (target.x + target.w / 2) * pt.box.width;
    const cy = pt.box.top + (target.y + target.h / 2) * pt.box.height;
    drag = {
      kind: "layer",
      layer,
      type: "rotate",
      cx,
      cy,
      startAngle: Number(target.angle) || 0,
      baseAngle: angleDeg(cx, cy, ev.clientX, ev.clientY),
    };
  }

  function startLayerMove(ev, layer) {
    const pt = stagePoint(ev);
    if (!pt) return;
    const target = layer === "red" ? st.redRect : st.greenRect;
    drag = { kind: "layer", layer, type: "move", sx: pt.x, sy: pt.y, rect: { ...target } };
    ev.preventDefault();
  }

  function startLayerResize(ev, layer, corner) {
    const pt = stagePoint(ev);
    if (!pt) return;
    const target = layer === "red" ? st.redRect : st.greenRect;
    drag = { kind: "layer", layer, type: "resize", corner, rect: { ...target } };
    ev.preventDefault();
  }

  function startOverlayMove(ev, el, phType, phIndex, rect) {
    const pt = stagePoint(ev);
    if (!pt) return;
    drag = { kind: "overlay", el, phType, phIndex, type: "move", sx: pt.x, sy: pt.y, rect: { ...rect } };
    ev.preventDefault();
  }

  function startOverlayResize(ev, el, phType, phIndex, corner, rect) {
    const pt = stagePoint(ev);
    if (!pt) return;
    drag = { kind: "overlay", el, phType, phIndex, type: "resize", corner, rect: { ...rect } };
    ev.preventDefault();
  }

  function startOverlayRotate(ev, el, phType, phIndex, rect) {
    const pt = stagePoint(ev);
    if (!pt) return;
    const cx = pt.box.left + (rect.x + rect.w / 2) * pt.box.width;
    const cy = pt.box.top + (rect.y + rect.h / 2) * pt.box.height;
    drag = {
      kind: "overlay",
      el,
      phType,
      phIndex,
      type: "rotate",
      cx,
      cy,
      startAngle: Number(rect.angle) || 0,
      baseAngle: angleDeg(cx, cy, ev.clientX, ev.clientY),
    };
  }

  const onMouseMove = (ev) => {
    if (!drag) return;
    const pt = stagePoint(ev);
    if (!pt) return;

    if (drag.kind === "layer") {
      const target = drag.layer === "red" ? st.redRect : st.greenRect;
      applyDragToRect(target, drag, ev, drag.layer === "red");
      if (drag.layer === "red") st.boundsDirty = true;
      else {
        st.greenDirty = true;
        st.mockPreviewStale = true;
      }
      drawRect(drag.layer === "red" ? rectRed : rectGreen, target, true);
      onStateChange?.();
      return;
    }

    const rect = overlayRectMap.get(drag.el);
    if (!rect) return;
    applyDragToRect(rect, drag, ev, lockAspectForPhType(drag.phType));
    drawRect(drag.el, rect, true);
    onStateChange?.();
  };

  function applyDragToRect(target, dragState, ev, lockAspectFlag) {
    const pt = stagePoint(ev);
    if (!pt) return;
    const { x: px, y: py } = pt;

    if (dragState.type === "rotate") {
      const cur = angleDeg(dragState.cx, dragState.cy, ev.clientX, ev.clientY);
      target.angle = snapRotateAngle(dragState.startAngle + (cur - dragState.baseAngle));
      return;
    }

    if (dragState.type === "move") {
      const next = {
        ...dragState.rect,
        x: clamp(dragState.rect.x + (px - dragState.sx), 0, 1 - dragState.rect.w),
        y: clamp(dragState.rect.y + (py - dragState.sy), 0, 1 - dragState.rect.h),
      };
      Object.assign(target, clampRectToStage(next));
      return;
    }

    if (dragState.type === "resize") {
      const next = resizeRectByCorner(dragState.corner, dragState.rect, px, py, {
        lockAspect: lockAspectFlag,
        aspectRatio: aspect > 0 ? aspect : null,
        stageBox: getStageBox(),
      });
      Object.assign(target, next);
      updateResizeHandleCursors(
        drag.kind === "layer" ? (drag.layer === "red" ? rectRed : rectGreen) : drag.el,
        target
      );
    }
  }

  const onMouseUp = () => {
    if (drag?.kind === "overlay") {
      const rect = overlayRectMap.get(drag.el);
      if (rect) setOverlayAreaRect(st, st.activeView, drag.phType, drag.phIndex, rect);
    }
    drag = null;
  };

  redraw();

  requestAnimationFrame(() => {
    const box = getStageBox();
    st.redRect = normalizeRectToPrintAspect(st.redRect, md, data, st.activeView, box);
    drawRect(rectRed, st.redRect, st.activeLayer === "red" && !st.boundsLocked);
  });

  stageInner?.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".ce-pa-rect")) return;
    pickLayer(shouldShowGreenRect(ctx, st, data) ? "green" : "red");
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
