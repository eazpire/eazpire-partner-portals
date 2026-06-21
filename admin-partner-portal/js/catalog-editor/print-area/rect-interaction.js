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

/** Resize rect by dragging a corner; px/py are normalized 0–1 in stage. */
export function resizeRectByCorner(corner, start, px, py, { lockAspect = false, aspectRatio = null, minSize = 0.02 } = {}) {
  const ar = lockAspect ? (aspectRatio > 0 ? aspectRatio : start.w / Math.max(start.h, 0.001)) : null;
  const ax = start.x + start.w;
  const ay = start.y + start.h;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;

  if (corner === "se") {
    w = clamp(px - start.x, minSize, 1 - start.x);
    h = clamp(py - start.y, minSize, 1 - start.y);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
  } else if (corner === "nw") {
    w = clamp(ax - px, minSize, ax);
    h = clamp(ay - py, minSize, ay);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
    x = ax - w;
    y = ay - h;
  } else if (corner === "ne") {
    w = clamp(px - start.x, minSize, 1 - start.x);
    h = clamp(ay - py, minSize, ay);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
    y = ay - h;
    x = start.x;
  } else if (corner === "sw") {
    w = clamp(ax - px, minSize, ax);
    h = clamp(py - start.y, minSize, 1 - start.y);
    if (ar) ({ w, h } = applyAspect(w, h, ar));
    x = ax - w;
    y = start.y;
  }

  return clampRectToStage({ ...start, x, y, w, h, angle: start.angle || 0 });
}

export function angleDeg(cx, cy, x, y) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
}

export function lockAspectForPhType(phType) {
  return phType === "creator_design" || phType === "additional_design";
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
