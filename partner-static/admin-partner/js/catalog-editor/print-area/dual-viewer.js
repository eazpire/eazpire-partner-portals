import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { savePrintAreaRect } from "../api.js";
import { getPlaceholderSlotsForView } from "../version-config-panel.js";
import { printAreaCatalogDetail, resolvePrintAreaVersion, isPartnerOrTodifyProduct } from "./helpers.js";
import {
  getMockupDefaultForView,
  aspectRatioFromDefault,
  clampRectToStage,
  getDesignTypeSlice,
  hasDbPrintAreaRect,
  normalizeRectToPrintAspect,
} from "./helpers.js";
import { resolveLeftViewerImage, resolvePrintifyMockUrl } from "./image-grid.js";
import { renderPatternOverlayHtml } from "./pattern-preview.js";
import { resolvePlacementOverlays, refreshPlacementOverlayLayer, renderPlacementOverlaysHtml } from "./placement-overlays.js";
import { mountSessionDesignLayer } from "./design-session-overlay.js";
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

function placeholderSlotsForView(ctx, st, data) {
  const version = resolvePrintAreaVersion(ctx, data);
  const catalogDetail = printAreaCatalogDetail(ctx, data);
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

/** True when version placeholder slots drive overlay rects (not the legacy green rect). */
export function isPlacementOverlayMode(ctx, st, data) {
  const slots = placeholderSlotsForView(ctx, st, data);
  return placementModeActive(slots);
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
  const {
    showMagnify = true,
    showSyncFromPrintify = false,
    stageId = "ce-pa-stage-left",
    showGreenRect = true,
    emptyMessage = "No print area image — upload in sidebar",
  } = options;
  const magnifyBtn = showMagnify
    ? `<button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action ce-pa-magnify-btn" title="Fullscreen magnifier" aria-label="Fullscreen magnifier">🔍</button>`
    : "";
  const syncBtn = showSyncFromPrintify
    ? `<button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action ce-pa-sync-printify-btn" data-sync-printify-placement title="Sync placement from Printify" aria-label="Sync placement from Printify">↻</button>`
    : "";
  return `
    <div class="ce-pa-viewer ce-pa-viewer--print">
      <div class="ce-pa-viewer-head">
        <span class="ce-pa-viewer-title">Print Area</span>
        ${magnifyBtn}${syncBtn}
        <span class="ce-pa-viewer-head-spacer" aria-hidden="true"></span>
      </div>
      <div class="ce-pa-stage" id="${escapeHtml(stageId)}" data-layer="${escapeHtml(st.activeLayer)}">
        <div class="ce-pa-stage-inner" data-stage-inner="left">
          <img class="ce-pa-stage-img" data-stage-img="left" alt="" ${leftImg ? `src="${escapeHtml(leftImg)}"` : "hidden"} />
          ${leftImg ? "" : `<div class="ce-pa-mock-empty ce-pa-stage-empty" data-stage-empty="left">${escapeHtml(emptyMessage)}</div>`}
          <div class="ce-pa-rect ce-pa-rect--bounds ${st.boundsLocked ? "is-locked" : ""}" data-rect="red" title="Print area bounds">
            <button type="button" class="ce-pa-lock-btn" data-bounds-lock aria-label="Lock bounds">${st.boundsLocked ? "🔒" : "🔓"}</button>
            ${rectHandlesHtml("red")}
          </div>
          <div class="ce-pa-pattern-layer" data-pattern-layer>${renderPatternOverlayHtml(st)}</div>
          <div class="ce-pa-placement-layer" data-placement-layer>${overlays || ""}</div>
          <div class="ce-pa-session-design-layer" data-session-design-layer hidden></div>
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
  const {
    showMagnify = true,
    sessionTestProduct = false,
    partnerMode = false,
    previewOverlaysHtml = "",
  } = options;
  const magnifyBtn = showMagnify
    ? `<button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action ce-pa-magnify-btn" data-magnify="mock" title="Fullscreen magnifier" aria-label="Fullscreen magnifier">🔍</button>`
    : "";
  if (partnerMode) {
    return `
    <div class="ce-pa-viewer ce-pa-viewer--mock ce-pa-viewer--preview">
      <div class="ce-pa-viewer-head">
        <span class="ce-pa-viewer-title">Preview</span>
        ${magnifyBtn}
        <button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action" id="ce-pa-mock-refresh" title="Refresh clean mock" aria-label="Refresh clean mock">↻</button>
      </div>
      <div class="ce-pa-stage" id="ce-pa-stage-mock">
        <div class="ce-pa-stage-inner ce-pa-stage-inner--mock" data-stage-inner="mock">
          ${
            mockImg
              ? `<img class="ce-pa-stage-img" id="ce-pa-img-mock" alt="" src="${escapeHtml(mockImg)}" />`
              : `<div class="ce-pa-mock-empty" id="ce-pa-mock-empty">No clean mock for this view/color</div>`
          }
          <div class="ce-pa-placement-layer ce-pa-placement-layer--preview" data-placement-layer-preview>${previewOverlaysHtml || ""}</div>
          <div class="ce-pa-session-design-layer ce-pa-session-design-layer--preview" data-session-design-layer data-preview-design-layer hidden></div>
        </div>
      </div>
    </div>`;
  }
  const refreshTitle = sessionTestProduct
    ? "Refresh test product mock from Printify"
    : "Refresh catalog template mock from Printify";
  const refreshLabel = sessionTestProduct ? "Test product" : "Template";
  return `
    <div class="ce-pa-viewer ce-pa-viewer--mock">
      <div class="ce-pa-viewer-head">
        <span class="ce-pa-viewer-title">Printify Mock <span class="ce-pa-viewer-subtitle" data-mock-source-label>${escapeHtml(refreshLabel)}</span></span>
        ${magnifyBtn}
        <button type="button" class="btn btn-ghost btn-xs ce-pa-viewer-head-action" id="ce-pa-mock-refresh" title="${escapeHtml(refreshTitle)}" aria-label="${escapeHtml(refreshTitle)}">↻</button>
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

function placementHtml(ctx, st, data, brandAssets, options = {}) {
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);
  return renderPlacementOverlaysHtml(overlays, options);
}

/** Partner Preview: same clean mock as Print Area when Printify-style mock URL is missing. */
function resolvePartnerPreviewImage(st, data, viewKey) {
  const mockImg = resolvePrintifyMockUrl(st, viewKey);
  if (mockImg) return mockImg;
  return resolveLeftViewerImage(st, data, viewKey, { preferCleanMock: true }) || "";
}

function stageInnerHtml(st, data, ctx, brandAssets, options = {}) {
  const partnerMode = !!options.partnerMode || isPartnerOrTodifyProduct(ctx, data);
  const leftImg = resolveLeftViewerImage(st, data, st.activeView, { preferCleanMock: partnerMode });
  const mockImg = partnerMode
    ? resolvePartnerPreviewImage(st, data, st.activeView)
    : resolvePrintifyMockUrl(st, st.activeView);
  const overlays = placementHtml(ctx, st, data, brandAssets);
  const previewOverlaysHtml = partnerMode
    ? placementHtml(ctx, st, data, brandAssets, { readOnly: true })
    : "";
  const showGreenRect = shouldShowGreenRect(ctx, st, data);
  const sessionTestProduct = !!options.sessionTestProduct;
  const emptyMessage = partnerMode
    ? "No clean mock for this view/color"
    : "No print area image — upload in sidebar";
  return `
    <div class="ce-pa-viewers-wrap">
      <div class="ce-pa-viewers">
        ${printAreaStageHtml(st, data, leftImg, overlays, {
          showGreenRect,
          sessionTestProduct,
          showSyncFromPrintify: sessionTestProduct && !partnerMode,
          emptyMessage,
        })}
        ${mockStageHtml(st, mockImg, { sessionTestProduct, partnerMode, previewOverlaysHtml })}
      </div>
    </div>`;
}

export function renderDualViewer(st, data, ctx, brandAssets, options = {}) {
  return stageInnerHtml(st, data, ctx, brandAssets, options);
}

export function mountPrintAreaStage(container, ctx, st, data, callbacks = {}) {
  const { onStateChange, brandAssets } = callbacks;
  const partnerMode = isPartnerOrTodifyProduct(ctx, data);
  const leftImg = resolveLeftViewerImage(st, data, st.activeView, { preferCleanMock: partnerMode });
  const overlays = placementHtml(ctx, st, data, brandAssets);
  const showGreenRect = shouldShowGreenRect(ctx, st, data);
  container.innerHTML = printAreaStageHtml(st, data, leftImg, overlays, {
    showMagnify: false,
    showSyncFromPrintify: !!callbacks.hasSessionTestProduct?.() && !partnerMode,
    stageId: "ce-pa-fs-stage",
    showGreenRect,
  });

  return bindStageInteractions(container, ctx, st, data, { ...callbacks, partnerMode });
}

function bindSyncFromPrintifyBtn(root, callbacks = {}) {
  root.querySelector("[data-sync-printify-placement]")?.addEventListener("click", () => {
    callbacks.onSyncFromPrintify?.();
  });
}

function bindStageInteractions(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, onSessionDesignSave, onSyncFromPrintify } = callbacks;
  let brandAssets = callbacks.brandAssets;
  const partnerMode = !!callbacks.partnerMode || isPartnerOrTodifyProduct(ctx, data);

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

  const redrawStageRects = () => {
    const showGreen = shouldShowGreenRect(ctx, st, data);
    drawRect(rectRed, st.redRect, st.activeLayer === "red" && !st.boundsLocked);
    if (rectGreen) {
      rectGreen.hidden = !showGreen;
      if (showGreen) drawRect(rectGreen, st.greenRect, st.activeLayer === "green");
      else toggleRectHandles(rectGreen, false);
    }
    rectRed?.classList.toggle("is-locked", st.boundsLocked);
    rectGreen?.classList.toggle("is-active", st.activeLayer === "green");
    rectRed?.classList.toggle("is-active", st.activeLayer === "red" && !st.boundsLocked);
    if (lockBtn) lockBtn.textContent = st.boundsLocked ? "🔒" : "🔓";
    root.querySelector("#ce-pa-stage-left, #ce-pa-fs-stage")?.setAttribute("data-layer", st.activeLayer);

    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);
    stageInner?.querySelectorAll(".ce-pa-rect--overlay").forEach((el) => {
      const phType = el.dataset.phType;
      const phIndex = Number(el.dataset.phIndex) || 0;
      const ov = overlays.find((o) => o.type === phType && o.index === phIndex);
      if (!ov) return;
      const rect = { ...(ov.rect || {}) };
      overlayRectMap.set(el, rect);
      drawRect(el, rect, el === activeOverlayEl);
    });
  };

  const redraw = () => {
    if (!shouldShowGreenRect(ctx, st, data) && st.activeLayer === "green") st.activeLayer = "red";
    redrawStageRects();
    const patternLayer = root.querySelector("[data-pattern-layer]");
    if (patternLayer) patternLayer.innerHTML = renderPatternOverlayHtml(st);
    refreshOverlays();
    sessionDesignHandle.refresh?.();
    callbacks.onStageRefresh?.();
  };

  const refresh = (nextSt = st, nextData = data) => {
    md = getMockupDefaultForView(nextData.mockup_defaults, nextSt.activeView);
    aspect = aspectRatioFromDefault(md, nextData, nextSt.activeView);
    const imgEl = root.querySelector('[data-stage-img="left"]');
    const leftImg = resolveLeftViewerImage(nextSt, nextData, nextSt.activeView, {
      preferCleanMock: partnerMode,
    });
    const stageInnerEl = root.querySelector('[data-stage-inner="left"]');
    let emptyEl = root.querySelector('[data-stage-empty="left"]');
    if (imgEl) {
      if (leftImg) {
        imgEl.src = leftImg;
        imgEl.hidden = false;
        emptyEl?.remove();
      } else {
        imgEl.removeAttribute("src");
        imgEl.hidden = true;
        if (stageInnerEl && !emptyEl) {
          stageInnerEl.insertAdjacentHTML(
            "beforeend",
            `<div class="ce-pa-mock-empty ce-pa-stage-empty" data-stage-empty="left">${
              partnerMode
                ? "No clean mock for this view/color"
                : "No print area image — upload in sidebar"
            }</div>`
          );
          emptyEl = root.querySelector('[data-stage-empty="left"]');
        } else if (emptyEl) {
          emptyEl.hidden = false;
        }
      }
    }
    const applyAspect = () => {
      if (!st.boundsDirty && hasDbPrintAreaRect(md)) {
        redraw();
        return;
      }
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

  const snapOverlayToPrintArea = (el, phType, phIndex) => {
    const snappedRect = { ...st.redRect };
    overlayRectMap.set(el, snappedRect);
    setOverlayAreaRect(st, st.activeView, phType, phIndex, snappedRect);
    st.mockPreviewStale = true;
    drawRect(el, snappedRect, true);
    onStateChange?.();
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
        const liveRect = overlayRectMap.get(el);
        if (liveRect) startOverlayResize(ev, el, phType, phIndex, corner, liveRect);
      });

      el.querySelectorAll(".ce-pa-rotate-handle").forEach((handle) => {
        handle.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          pickOverlay(el);
          const liveRect = overlayRectMap.get(el);
          if (liveRect) startOverlayRotate(ev, el, phType, phIndex, liveRect);
          ev.preventDefault();
        });
      });

      el.querySelector("[data-snap-overlay]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pickOverlay(el);
        snapOverlayToPrintArea(el, phType, phIndex);
      });

      el.addEventListener("mousedown", (ev) => {
        if (ev.target.closest(".ce-pa-rotate-handle, .ce-pa-resize-handle, .ce-pa-snap-btn")) return;
        pickOverlay(el);
        const liveRect = overlayRectMap.get(el);
        if (liveRect) startOverlayMove(ev, el, phType, phIndex, liveRect);
        ev.stopPropagation();
      });
    });
  }

  bindRect(rectRed, "red");
  bindRect(rectGreen, "green");

  const sessionDesignHandle = mountSessionDesignLayer(stageInner, st, {
    onChange: onStateChange,
    onSave: callbacks.onSessionDesignSave,
    printAreaData: data,
  });

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
    setOverlayAreaRect(st, st.activeView, drag.phType, drag.phIndex, rect);
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
    if (!st.boundsDirty && hasDbPrintAreaRect(md)) {
      drawRect(rectRed, st.redRect, st.activeLayer === "red" && !st.boundsLocked);
      return;
    }
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

  bindSyncFromPrintifyBtn(root, { onSyncFromPrintify });

  return {
    refresh,
    redraw,
    redrawStageRects,
    refreshPattern: () => {
      const patternLayer = root.querySelector("[data-pattern-layer]");
      if (patternLayer) patternLayer.innerHTML = renderPatternOverlayHtml(st);
    },
    refreshOverlays: () => {
      refreshOverlays();
      sessionDesignHandle.refresh?.();
    },
    refreshSessionDesign: () => sessionDesignHandle.refresh?.(),
    setBrandAssets(next) {
      brandAssets = next;
      refreshOverlays();
      sessionDesignHandle.refresh?.();
    },
    destroy() {
      sessionDesignHandle.destroy?.();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
  };
}

export function mountDualViewer(root, ctx, st, data, callbacks = {}) {
  const { onStateChange, onMockRefresh, onSyncFromPrintify, brandAssets, onMagnify, hasSessionTestProduct } =
    callbacks;
  const main = root.querySelector("#ce-pa-main");
  if (!main) return { destroy() {} };

  const partnerMode = isPartnerOrTodifyProduct(ctx, data);
  const sessionTestProduct = hasSessionTestProduct?.() ?? false;
  main.innerHTML = renderDualViewer(st, data, ctx, brandAssets, { sessionTestProduct, partnerMode });

  let previewSessionHandle = null;
  let liveBrandAssets = brandAssets;
  let liveData = data;

  /** Partner Preview: sync logo/QR overlays only — no red print-bounds rect (Print Area viewer only). */
  const syncPartnerPreviewMirror = () => {
    if (!partnerMode) return;
    const mockInner = main.querySelector(".ce-pa-stage-inner--mock");
    if (!mockInner) return;
    const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    const overlays = resolvePlacementOverlays(ctx, st, liveData, slice, liveBrandAssets);
    refreshPlacementOverlayLayer(mockInner, overlays, {
      selector: "[data-placement-layer-preview]",
      readOnly: true,
    });
  };

  const notifyStateChange = () => {
    syncPartnerPreviewMirror();
    previewSessionHandle?.refresh?.();
    onStateChange?.();
  };

  const stageHandle = bindStageInteractions(main, ctx, st, data, {
    onStateChange: notifyStateChange,
    onStageRefresh: syncPartnerPreviewMirror,
    brandAssets: liveBrandAssets,
    onSessionDesignSave: callbacks.onSessionDesignSave,
    partnerMode,
  });

  const mockInner = main.querySelector(".ce-pa-stage-inner--mock");
  if (partnerMode && mockInner) {
    previewSessionHandle = mountSessionDesignLayer(mockInner, st, {
      readOnly: true,
      printAreaData: liveData,
    });
    syncPartnerPreviewMirror();
  }

  const refreshPatternLayer = () => stageHandle.refreshPattern?.();

  const updatePrintAreaImage = () => stageHandle.refresh?.(st, data);

  const setMockPanelImage = (inner, mockImg, emptyMessage) => {
    if (!inner) return;
    const designLayer = inner.querySelector("[data-preview-design-layer], [data-session-design-layer]");
    const previewOverlayLayer = inner.querySelector("[data-placement-layer-preview]");
    const insertBeforeRef = previewOverlayLayer || designLayer;
    let imgEl = inner.querySelector("#ce-pa-img-mock");
    let emptyEl = inner.querySelector("#ce-pa-mock-empty");
    if (mockImg) {
      emptyEl?.remove();
      if (imgEl) {
        if (imgEl.src !== mockImg) imgEl.src = mockImg;
        imgEl.hidden = false;
      } else {
        const html = `<img class="ce-pa-stage-img" id="ce-pa-img-mock" alt="" src="${escapeHtml(mockImg)}" />`;
        if (insertBeforeRef) insertBeforeRef.insertAdjacentHTML("beforebegin", html);
        else inner.insertAdjacentHTML("afterbegin", html);
      }
    } else {
      imgEl?.remove();
      if (!emptyEl) {
        const html = `<div class="ce-pa-mock-empty" id="ce-pa-mock-empty">${escapeHtml(emptyMessage)}</div>`;
        if (insertBeforeRef) insertBeforeRef.insertAdjacentHTML("beforebegin", html);
        else inner.insertAdjacentHTML("afterbegin", html);
      } else {
        emptyEl.textContent = emptyMessage;
        emptyEl.hidden = false;
      }
    }
  };

  const updatePrintifyPanel = () => {
    const inner = main.querySelector(".ce-pa-stage-inner--mock");
    if (!inner) return;
    if (!partnerMode) {
      const sessionActive = hasSessionTestProduct?.() ?? !!st.useSessionTestProductMock;
      const label = main.querySelector("[data-mock-source-label]");
      if (label) label.textContent = sessionActive ? "Test product" : "Template";
      const refreshBtn = main.querySelector("#ce-pa-mock-refresh");
      if (refreshBtn) {
        const title = sessionActive
          ? "Refresh test product mock from Printify"
          : "Refresh catalog template mock from Printify";
        refreshBtn.title = title;
        refreshBtn.setAttribute("aria-label", title);
      }
    }
    const mockImg = partnerMode
      ? resolvePartnerPreviewImage(st, liveData, st.activeView)
      : resolvePrintifyMockUrl(st, st.activeView);
    const emptyMessage = partnerMode
      ? "No clean mock for this view/color"
      : "Click refresh to load Printify mock";
    setMockPanelImage(inner, mockImg, emptyMessage);
    syncPartnerPreviewMirror();
    previewSessionHandle?.refresh?.();
  };

  main.querySelectorAll(".ce-pa-magnify-btn").forEach((btn) => {
    btn.addEventListener("click", () => onMagnify?.());
  });

  main.querySelector("[data-sync-printify-placement]")?.addEventListener("click", () => {
    onSyncFromPrintify?.();
  });

  main.querySelector("#ce-pa-mock-refresh")?.addEventListener("click", () => {
    onMockRefresh?.();
  });

  const updateSyncFromPrintifyBtn = () => {
    const sessionActive = hasSessionTestProduct?.() ?? !!st.useSessionTestProductMock;
    const syncBtn = main.querySelector("[data-sync-printify-placement]");
    if (syncBtn) syncBtn.hidden = !sessionActive || partnerMode;
  };
  updateSyncFromPrintifyBtn();

  return {
    refreshPattern: refreshPatternLayer,
    refreshPrintArea: (nextSt = st, nextData = data) => {
      Object.assign(st, nextSt);
      liveData = nextData;
      stageHandle.refresh?.(st, nextData);
      updatePrintAreaImage();
      updatePrintifyPanel();
      updateSyncFromPrintifyBtn();
    },
    refreshPrintify: () => {
      updatePrintifyPanel();
      updateSyncFromPrintifyBtn();
    },
    redraw: () => {
      stageHandle.redraw?.();
      syncPartnerPreviewMirror();
      previewSessionHandle?.refresh?.();
    },
    redrawStageRects: () => {
      stageHandle.redrawStageRects?.();
      syncPartnerPreviewMirror();
      previewSessionHandle?.refresh?.();
    },
    refreshOverlays: () => {
      stageHandle.refreshOverlays?.();
      syncPartnerPreviewMirror();
    },
    refreshSessionDesign: () => {
      stageHandle.refreshSessionDesign?.();
      previewSessionHandle?.refresh?.();
    },
    refreshPreviewDesign: () => previewSessionHandle?.refresh?.(),
    setBrandAssets: (next) => {
      liveBrandAssets = next;
      stageHandle.setBrandAssets?.(next);
      syncPartnerPreviewMirror();
    },
    destroy() {
      previewSessionHandle?.destroy?.();
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
