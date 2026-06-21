import { clampRectToStage, getDesignTypeSlice } from "./helpers.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const CORNER_LOCAL = {
  nw: { lx: -0.5, ly: -0.5 },
  ne: { lx: 0.5, ly: -0.5 },
  se: { lx: 0.5, ly: 0.5 },
  sw: { lx: -0.5, ly: 0.5 },
};

const OPPOSITE_CORNER = { nw: "se", se: "nw", ne: "sw", sw: "ne" };

export function rectHandlesHtml(rotateKey = "") {
  const rk = rotateKey ? ` data-rotate="${rotateKey}"` : "";
  return `
    <span class="ce-pa-resize-handle ce-pa-resize-handle--nw" data-resize="nw" aria-hidden="true"></span>
    <span class="ce-pa-resize-handle ce-pa-resize-handle--ne" data-resize="ne" aria-hidden="true"></span>
    <span class="ce-pa-resize-handle ce-pa-resize-handle--sw" data-resize="sw" aria-hidden="true"></span>
    <span class="ce-pa-resize-handle ce-pa-resize-handle--se" data-resize="se" aria-hidden="true"></span>
    <span class="ce-pa-rotate-handle"${rk} title="Rotate" aria-hidden="true"></span>`;
}

function rotateOffset(ox, oy, rad) {
  return {
    x: ox * Math.cos(rad) - oy * Math.sin(rad),
    y: ox * Math.sin(rad) + oy * Math.cos(rad),
  };
}

/** World position of a rect corner (normalized stage 0–1). */
export function worldCornerOfRect(rect, corner) {
  const spec = CORNER_LOCAL[corner];
  if (!spec) return { x: 0, y: 0 };
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const ox = spec.lx * rect.w;
  const oy = spec.ly * rect.h;
  const rad = ((Number(rect.angle) || 0) * Math.PI) / 180;
  const rot = rotateOffset(ox, oy, rad);
  return { x: cx + rot.x, y: cy + rot.y };
}

function centerFromFixedCorner(fixedWorld, w, h, angleDeg, fixedCorner) {
  const spec = CORNER_LOCAL[fixedCorner];
  const ox = spec.lx * w;
  const oy = spec.ly * h;
  const rad = (angleDeg * Math.PI) / 180;
  const rot = rotateOffset(ox, oy, rad);
  return {
    cx: fixedWorld.x - rot.x,
    cy: fixedWorld.y - rot.y,
  };
}

function applyAspect(w, h, ar) {
  if (!(ar > 0)) return { w, h };
  if (w / h > ar) return { w: h * ar, h };
  return { w, h: w / ar };
}

/** Screen-aligned resize cursor for a corner at a given rect rotation. */
export function resizeCursorForCorner(corner, angleDeg = 0) {
  const spec = CORNER_LOCAL[corner];
  const opp = CORNER_LOCAL[OPPOSITE_CORNER[corner]];
  if (!spec || !opp) return "nwse-resize";

  const lx = spec.lx - opp.lx;
  const ly = spec.ly - opp.ly;
  const rad = (angleDeg * Math.PI) / 180;
  const sx = lx * Math.cos(rad) - ly * Math.sin(rad);
  const sy = lx * Math.sin(rad) + ly * Math.cos(rad);
  const norm = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const mod180 = norm % 180;
  return mod180 < 90 ? "nwse-resize" : "nesw-resize";
}

export function updateResizeHandleCursors(el, rect) {
  if (!el || !rect) return;
  const angle = Number(rect.angle) || 0;
  el.querySelectorAll("[data-resize]").forEach((handle) => {
    handle.style.cursor = resizeCursorForCorner(handle.dataset.resize, angle);
  });
}

/**
 * Resize by dragging one corner; the opposite corner stays fixed in stage space.
 * Works identically at any rotation (CSS rotate around rect center).
 */
export function resizeRectByCorner(
  corner,
  start,
  px,
  py,
  { lockAspect = false, aspectRatio = null, minSize = 0.02, stageBox = null } = {}
) {
  const angle = Number(start.angle) || 0;
  const dragSpec = CORNER_LOCAL[corner];
  const fixedCorner = OPPOSITE_CORNER[corner];
  if (!dragSpec || !fixedCorner) {
    return clampRectToStage({ ...start });
  }

  const fixedWorld = worldCornerOfRect(start, fixedCorner);
  const movingWorld = { x: px, y: py };

  let cx = (fixedWorld.x + movingWorld.x) / 2;
  let cy = (fixedWorld.y + movingWorld.y) / 2;

  const rad = (angle * Math.PI) / 180;
  const vx = movingWorld.x - cx;
  const vy = movingWorld.y - cy;
  const localMx = vx * Math.cos(-rad) - vy * Math.sin(-rad);
  const localMy = vx * Math.sin(-rad) + vy * Math.cos(-rad);

  let w = Math.abs(localMx / dragSpec.lx);
  let h = Math.abs(localMy / dragSpec.ly);
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);

  let ar = lockAspect ? (aspectRatio > 0 ? aspectRatio : start.w / Math.max(start.h, 0.001)) : null;
  if (ar && stageBox?.w > 0 && stageBox?.h > 0) {
    ar = ar * (stageBox.h / stageBox.w);
  }
  if (ar) {
    ({ w, h } = applyAspect(w, h, ar));
    w = Math.max(minSize, w);
    h = Math.max(minSize, h);
  }

  const anchored = centerFromFixedCorner(fixedWorld, w, h, angle, fixedCorner);
  cx = anchored.cx;
  cy = anchored.cy;

  const x = cx - w / 2;
  const y = cy - h / 2;

  return clampRectToStage({ ...start, x, y, w, h, angle });
}

export function angleDeg(cx, cy, x, y) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
}

export const ROTATE_SNAP_DEG = 5;

export function normalizeAngleDeg(angle) {
  let a = Number(angle) || 0;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

/** Snap rotation to fixed degree steps (default 5°) for easier alignment. */
export function snapRotateAngle(angle, step = ROTATE_SNAP_DEG) {
  const a = normalizeAngleDeg(angle);
  if (!(step > 0)) return a;
  return Math.round(a / step) * step;
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
