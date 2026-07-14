/** Partner Print Area — self-contained rect move/resize (normalized stage 0–1). */

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

export function rectHandlesHtml() {
  return `
    <span class="pe-pa-resize-handle pe-pa-resize-handle--nw" data-resize="nw" aria-hidden="true"></span>
    <span class="pe-pa-resize-handle pe-pa-resize-handle--ne" data-resize="ne" aria-hidden="true"></span>
    <span class="pe-pa-resize-handle pe-pa-resize-handle--sw" data-resize="sw" aria-hidden="true"></span>
    <span class="pe-pa-resize-handle pe-pa-resize-handle--se" data-resize="se" aria-hidden="true"></span>`;
}

export function clampRectToStage(rect) {
  const r = { ...rect };
  r.w = Math.max(0.02, Math.min(1, Number(r.w) || 0.02));
  r.h = Math.max(0.02, Math.min(1, Number(r.h) || 0.02));
  r.x = Math.max(0, Math.min(1 - r.w, Number(r.x) || 0));
  r.y = Math.max(0, Math.min(1 - r.h, Number(r.y) || 0));
  return r;
}

function rotateOffset(ox, oy, rad) {
  return {
    x: ox * Math.cos(rad) - oy * Math.sin(rad),
    y: ox * Math.sin(rad) + oy * Math.cos(rad),
  };
}

function worldCornerOfRect(rect, corner) {
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

/**
 * Resize by dragging one corner; opposite corner stays fixed.
 * aspectRatio = physical width/height (print_width / print_height).
 * stageBox converts to display-space aspect when the stage is not square.
 */
export function resizeRectByCorner(
  corner,
  start,
  px,
  py,
  { aspectRatio = null, minSize = 0.02, stageBox = null } = {}
) {
  const angle = Number(start.angle) || 0;
  const dragSpec = CORNER_LOCAL[corner];
  const fixedCorner = OPPOSITE_CORNER[corner];
  if (!dragSpec || !fixedCorner) return clampRectToStage({ ...start });

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

  let ar = aspectRatio > 0 ? aspectRatio : start.w / Math.max(start.h, 0.001);
  if (ar && stageBox?.w > 0 && stageBox?.h > 0) {
    ar = ar * (stageBox.h / stageBox.w);
  }
  ({ w, h } = applyAspect(w, h, ar));
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);

  const anchored = centerFromFixedCorner(fixedWorld, w, h, angle, fixedCorner);
  return clampRectToStage({
    ...start,
    x: anchored.cx - w / 2,
    y: anchored.cy - h / 2,
    w,
    h,
    angle,
  });
}

export function moveRect(start, dx, dy) {
  return clampRectToStage({
    ...start,
    x: start.x + dx,
    y: start.y + dy,
  });
}

export function fitRectWithAspect(baseRect, aspect, stageBox = null) {
  if (!(aspect > 0)) return clampRectToStage(baseRect);
  let displayAspect = aspect;
  if (stageBox?.w > 0 && stageBox?.h > 0) {
    displayAspect = aspect * (stageBox.h / stageBox.w);
  }
  const cx = baseRect.x + baseRect.w / 2;
  const cy = baseRect.y + baseRect.h / 2;
  let w = baseRect.w;
  let h = baseRect.h;
  if (w / h > displayAspect) w = h * displayAspect;
  else h = w / displayAspect;
  return clampRectToStage({ ...baseRect, x: cx - w / 2, y: cy - h / 2, w, h });
}

export function defaultCenteredRect(aspect, scale = 0.45, stageBox = null) {
  const s = clamp(scale, 0.02, 1);
  return fitRectWithAspect({ x: (1 - s) / 2, y: (1 - s) / 2, w: s, h: s, angle: 0 }, aspect, stageBox);
}

export function parseNormalizedRect(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const w = Number(raw.w ?? raw.width);
  const h = Number(raw.h ?? raw.height);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  // Legacy absolute px coords (>1) — ignore and fall back to default
  if (w > 1.5 || h > 1.5 || x > 1.5 || y > 1.5) return null;
  return clampRectToStage({ x, y, w, h, angle: Number(raw.angle) || 0 });
}

export function drawRectEl(el, rect, active = false) {
  if (!el || !rect) return;
  el.style.left = `${rect.x * 100}%`;
  el.style.top = `${rect.y * 100}%`;
  el.style.width = `${rect.w * 100}%`;
  el.style.height = `${rect.h * 100}%`;
  const angle = Number(rect.angle) || 0;
  el.style.transform = angle ? `rotate(${angle}deg)` : "";
  el.classList.toggle("is-active", !!active);
  el.querySelectorAll(".pe-pa-resize-handle").forEach((h) => {
    h.classList.toggle("is-visible", !!active);
  });
}
