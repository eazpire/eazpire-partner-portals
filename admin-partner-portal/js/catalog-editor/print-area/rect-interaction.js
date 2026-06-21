import { clampRectToStage, getDesignTypeSlice } from "./helpers.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function rectHandlesHtml(rotateKey = "") {
  const rk = rotateKey ? ` data-rotate="${rotateKey}"` : "";
  return `
    <span class="ce-pa-resize-handle ce-pa-resize-handle--nw" data-resize="nw" aria-hidden="true"></span>
    <span class="ce-pa-resize-handle ce-pa-resize-handle--ne" data-resize="ne" aria-hidden="true"></span>
    <span class="ce-pa-resize-handle ce-pa-resize-handle--sw" data-resize="sw" aria-hidden="true"></span>
    <span class="ce-pa-resize-handle ce-pa-resize-handle--se" data-resize="se" aria-hidden="true"></span>
    <span class="ce-pa-rotate-handle"${rk} title="Rotate" aria-hidden="true"></span>`;
}

function applyAspect(w, h, ar) {
  if (!(ar > 0)) return { w, h };
  if (w / h > ar) return { w: h * ar, h };
  return { w, h: w / ar };
}

/** Map pointer in stage-normalized coords into unrotated rect-local space. */
export function stagePointToRectLocal(px, py, rect) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const rad = (-(Number(rect.angle) || 0) * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Screen-aligned resize cursor for a corner at a given rect rotation. */
export function resizeCursorForCorner(corner, angleDeg = 0) {
  const cornerDeg = { nw: 225, ne: 315, sw: 135, se: 45 }[corner] ?? 45;
  const screen = (((cornerDeg + angleDeg) % 360) + 360) % 360;
  const bucket = Math.round(screen / 90) % 2;
  return bucket === 0 ? "nwse-resize" : "nesw-resize";
}

export function updateResizeHandleCursors(el, rect) {
  if (!el || !rect) return;
  const angle = Number(rect.angle) || 0;
  el.querySelectorAll("[data-resize]").forEach((handle) => {
    handle.style.cursor = resizeCursorForCorner(handle.dataset.resize, angle);
  });
}

/** Resize rect by dragging a corner; px/py are normalized 0–1 in stage. */
export function resizeRectByCorner(
  corner,
  start,
  px,
  py,
  { lockAspect = false, aspectRatio = null, minSize = 0.02, stageBox = null } = {}
) {
  let lpx = px;
  let lpy = py;
  const angle = Number(start.angle) || 0;
  if (angle) {
    const local = stagePointToRectLocal(px, py, start);
    lpx = local.x;
    lpy = local.y;
  }

  let ar = lockAspect ? (aspectRatio > 0 ? aspectRatio : start.w / Math.max(start.h, 0.001)) : null;
  if (ar && stageBox?.w > 0 && stageBox?.h > 0) {
    ar = ar * (stageBox.h / stageBox.w);
  }
  const ax = start.x + start.w;
  const ay = start.y + start.h;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;

  if (corner === "se") {
    w = clamp(lpx - start.x, minSize, 1 - start.x);
    h = clamp(lpy - start.y, minSize, 1 - start.y);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
  } else if (corner === "nw") {
    w = clamp(ax - lpx, minSize, ax);
    h = clamp(ay - lpy, minSize, ay);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
    x = ax - w;
    y = ay - h;
  } else if (corner === "ne") {
    w = clamp(lpx - start.x, minSize, 1 - start.x);
    h = clamp(ay - lpy, minSize, ay);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
    y = ay - h;
    x = start.x;
  } else if (corner === "sw") {
    w = clamp(ax - lpx, minSize, ax);
    h = clamp(lpy - start.y, minSize, 1 - start.y);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
    x = ax - w;
    y = start.y;
  }

  return clampRectToStage({ ...start, x, y, w, h, angle: start.angle || 0 });
}

export function angleDeg(cx, cy, x, y) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
}

/** Only the red print-bounds rect locks aspect; overlays resize freely. */
export function lockAspectForPhType(_phType) {
  return false;
}

export function normalizePhType(area) {
  const t = String(area?.type || area?.placeholder_type || "").toLowerCase();
  if (t === "design") return "creator_design";
  if (t === "additional") return "additional_design";
  return t;
}

export function setOverlayAreaRect(st, viewKey, phType, phIndex, rect) {
  const { slice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
  const vk = String(viewKey || "front").toLowerCase();
  if (!slice.edit_mode) slice.edit_mode = {};
  if (!slice.edit_mode[vk]) slice.edit_mode[vk] = { areas: [] };
  if (!Array.isArray(slice.edit_mode[vk].areas)) slice.edit_mode[vk].areas = [];

  const areas = slice.edit_mode[vk].areas;
  let seen = 0;
  for (let i = 0; i < areas.length; i++) {
    if (normalizePhType(areas[i]) !== phType) continue;
    if (seen === phIndex) {
      areas[i].type = phType;
      areas[i].rect = { ...rect };
      return;
    }
    seen++;
  }
  areas.push({ type: phType, rect: { ...rect } });
}
