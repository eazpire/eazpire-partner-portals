import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  clampRectToStage,
  defaultCenteredRect,
  aspectRatioFromDefault,
  getDesignTypeSlice,
  getMockupDefaultForView,
  printAreaCatalogDetail,
  resolvePrintAreaVersion,
} from "./helpers.js";
import { getPlaceholderSlotsForView } from "../version-config-panel.js";
import { resolvePlacementOverlays } from "./placement-overlays.js";
import {
  rectHandlesHtml,
  resizeRectByCorner,
  angleDeg,
  updateResizeHandleCursors,
  snapRotateAngle,
} from "./rect-interaction.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sessionKey(st) {
  return `${st.activeDesignType || "classic"}::${st.activeView || "front"}`;
}

export function hasSessionTestDesign(st) {
  const sd = st?.sessionTestDesign;
  return !!(sd && Number(sd.designId) > 0 && sd.rect);
}

export function getSessionDesignPlacementForApi(st) {
  const sd = st?.sessionTestDesign;
  if (!sd?.rect) return null;
  return {
    view_key: sd.viewKey || st.activeView || "front",
    rect: {
      x: Number(sd.rect.x),
      y: Number(sd.rect.y),
      w: Number(sd.rect.w),
      h: Number(sd.rect.h),
      angle: Number(sd.rect.angle) || 0,
    },
  };
}

function placementOverlayModeActive(ctx, st, data) {
  const version = resolvePrintAreaVersion(ctx, data);
  const catalogDetail = printAreaCatalogDetail(ctx, data);
  const slots = getPlaceholderSlotsForView(version, catalogDetail, st.activeView);
  return ["creator_design", "additional_design", "qr", "logo"].some((k) => (Number(slots[k]) || 0) > 0);
}

function resolveInitialDesignRect(ctx, st, data, brandAssets) {
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  const creatorMode = String(st.publishLogicByPh?.creator_design || "calculated").toLowerCase();
  const overlays = resolvePlacementOverlays(ctx, st, data, slice, brandAssets);
  const creatorOv = overlays.find((o) => o.type === "creator_design");

  if (creatorMode === "admin" && creatorOv?.rect) {
    return { ...creatorOv.rect };
  }
  if (creatorOv?.rect) {
    return { ...creatorOv.rect };
  }
  const version = resolvePrintAreaVersion(ctx, data);
  const catalogDetail = printAreaCatalogDetail(ctx, data);
  const slots = getPlaceholderSlotsForView(version, catalogDetail, st.activeView);
  const hasCreatorSlot = (Number(slots.creator_design) || 0) > 0;
  if (hasCreatorSlot && !placementOverlayModeActive(ctx, st, data) && st.greenRect) {
    return { ...st.greenRect };
  }
  const md = getMockupDefaultForView(data?.mockup_defaults, st.activeView);
  const aspect = aspectRatioFromDefault(md, data, st.activeView);
  return defaultCenteredRect(aspect > 0 ? aspect : 1, 0.45);
}

/**
 * Place chosen design on the print area canvas (session-only, not persisted to catalog).
 */
export function placeSessionTestDesign(ctx, st, data, brandAssets, designRow, { onPlaced } = {}) {
  if (!designRow?.id) return false;
  const rect = resolveInitialDesignRect(ctx, st, data, brandAssets);
  st.sessionTestDesign = {
    designId: Number(designRow.id),
    previewUrl: designRow.preview_url || "",
    title: designRow.design_title || `Design ${designRow.id}`,
    viewKey: st.activeView || "front",
    designType: st.activeDesignType || "classic",
    sessionKey: sessionKey(st),
    rect: clampRectToStage({ ...rect, angle: Number(rect.angle) || 0 }),
  };
  onPlaced?.(st.sessionTestDesign);
  return true;
}

export function clearSessionTestDesign(st) {
  if (st) st.sessionTestDesign = null;
}

function toggleHandles(el, active) {
  if (!el) return;
  el.querySelectorAll(".ce-pa-resize-handle, .ce-pa-rotate-handle, .ce-pa-move-handle").forEach((h) => {
    h.classList.toggle("is-visible", active);
  });
}

function drawSessionRect(el, rect, active) {
  if (!el || !rect) return;
  el.style.left = `${rect.x * 100}%`;
  el.style.top = `${rect.y * 100}%`;
  el.style.width = `${rect.w * 100}%`;
  el.style.height = `${rect.h * 100}%`;
  const angle = Number(rect.angle) || 0;
  el.style.transform = angle ? `rotate(${angle}deg)` : "";
  toggleHandles(el, active);
  updateResizeHandleCursors(el, rect);
}

function sessionDesignHtml(sd) {
  if (!sd?.previewUrl) {
    return `<span class="ce-pa-session-design__placeholder">${escapeHtml(sd?.title || "Design")}</span>`;
  }
  return `<img class="ce-pa-session-design__img" src="${escapeHtml(sd.previewUrl)}" alt="" draggable="false" />`;
}

function renderSessionDesignEl(sd) {
  return `
    <div class="ce-pa-rect ce-pa-rect--session-design is-active" data-session-design title="${escapeHtml(sd.title || "Test design")}">
      ${sessionDesignHtml(sd)}
      <span class="ce-pa-move-handle is-visible" data-session-move title="Move" aria-hidden="true"></span>
      ${rectHandlesHtml("session-design")}
    </div>`;
}

export function refreshSessionDesignLayer(stageInner, st, { onChange } = {}) {
  const layer = stageInner?.querySelector?.("[data-session-design-layer]");
  if (!layer) return null;

  const sd = st?.sessionTestDesign;
  const key = sessionKey(st);
  if (!sd || sd.sessionKey !== key) {
    layer.innerHTML = "";
    layer.hidden = true;
    return null;
  }

  layer.hidden = false;
  let el = layer.querySelector("[data-session-design]");
  if (!el) {
    layer.innerHTML = renderSessionDesignEl(sd);
    el = layer.querySelector("[data-session-design]");
  } else {
    const img = el.querySelector(".ce-pa-session-design__img");
    if (img && sd.previewUrl && img.src !== sd.previewUrl) img.src = sd.previewUrl;
  }
  drawSessionRect(el, sd.rect, true);
  return el;
}

function bindSessionDesignEl(el, st, stageInner, { onChange } = {}) {
  let drag = null;

  const getStageBox = () => {
    const w = stageInner?.clientWidth || 0;
    const h = stageInner?.clientHeight || 0;
    return w > 0 && h > 0 ? { w, h } : null;
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

  const syncRect = (rect) => {
    if (st.sessionTestDesign) st.sessionTestDesign.rect = { ...rect };
    drawSessionRect(el, rect, true);
    onChange?.();
  };

  el.querySelectorAll("[data-resize]").forEach((handle) => {
    handle.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      const sd = st.sessionTestDesign;
      if (!sd?.rect) return;
      drag = { type: "resize", corner: handle.dataset.resize, rect: { ...sd.rect } };
      ev.preventDefault();
    });
  });

  el.querySelector(".ce-pa-rotate-handle")?.addEventListener("mousedown", (ev) => {
    ev.stopPropagation();
    const sd = st.sessionTestDesign;
    if (!sd?.rect) return;
    const pt = stagePoint(ev);
    if (!pt) return;
    const rect = sd.rect;
    const cx = pt.box.left + (rect.x + rect.w / 2) * pt.box.width;
    const cy = pt.box.top + (rect.y + rect.h / 2) * pt.box.height;
    drag = {
      type: "rotate",
      cx,
      cy,
      startAngle: Number(rect.angle) || 0,
      baseAngle: angleDeg(cx, cy, ev.clientX, ev.clientY),
      rect: { ...rect },
    };
    ev.preventDefault();
  });

  const startMove = (ev) => {
    const sd = st.sessionTestDesign;
    if (!sd?.rect) return;
    const pt = stagePoint(ev);
    if (!pt) return;
    drag = { type: "move", sx: pt.x, sy: pt.y, rect: { ...sd.rect } };
    ev.preventDefault();
  };

  el.querySelector("[data-session-move]")?.addEventListener("mousedown", (ev) => {
    ev.stopPropagation();
    startMove(ev);
  });

  el.addEventListener("mousedown", (ev) => {
    if (ev.target.closest(".ce-pa-rotate-handle, .ce-pa-resize-handle, [data-session-move]")) return;
    startMove(ev);
    ev.stopPropagation();
  });

  const onMouseMove = (ev) => {
    if (!drag || !st.sessionTestDesign) return;
    const pt = stagePoint(ev);
    if (!pt) return;
    const target = { ...drag.rect };

    if (drag.type === "rotate") {
      const cur = angleDeg(drag.cx, drag.cy, ev.clientX, ev.clientY);
      target.angle = snapRotateAngle(drag.startAngle + (cur - drag.baseAngle));
      syncRect(clampRectToStage(target));
      return;
    }

    if (drag.type === "move") {
      const next = clampRectToStage({
        ...drag.rect,
        x: clamp(drag.rect.x + (pt.x - drag.sx), 0, 1 - drag.rect.w),
        y: clamp(drag.rect.y + (pt.y - drag.sy), 0, 1 - drag.rect.h),
      });
      syncRect(next);
      return;
    }

    if (drag.type === "resize") {
      const next = resizeRectByCorner(drag.corner, drag.rect, pt.x, pt.y, {
        lockAspect: true,
        aspectRatio: drag.rect.w / Math.max(drag.rect.h, 0.001),
        stageBox: getStageBox(),
      });
      syncRect(next);
    }
  };

  const onMouseUp = () => {
    drag = null;
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  return () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
}

export function mountSessionDesignLayer(stageInner, st, callbacks = {}) {
  if (!stageInner) return { refresh() {}, destroy() {} };
  let layer = stageInner.querySelector("[data-session-design-layer]");
  if (!layer) {
    stageInner.insertAdjacentHTML(
      "beforeend",
      `<div class="ce-pa-session-design-layer" data-session-design-layer hidden></div>`
    );
    layer = stageInner.querySelector("[data-session-design-layer]");
  }
  let unbind = null;
  const refresh = () => {
    unbind?.();
    unbind = null;
    const el = refreshSessionDesignLayer(stageInner, st, callbacks);
    if (el) {
      const destroyFn = bindSessionDesignEl(el, st, stageInner, callbacks);
      if (typeof destroyFn === "function") unbind = destroyFn;
    }
  };
  refresh();
  return {
    refresh,
    destroy() {
      unbind?.();
      unbind = null;
    },
  };
}
