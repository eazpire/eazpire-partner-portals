/**
 * Print-area placement math for admin UI (mirrors src/utils/printAreaSessionPlacement.js).
 */

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

function normalizeRect(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  if (w <= 0 || h <= 0) return null;
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: Math.max(0.01, Math.min(1, w)),
    h: Math.max(0.01, Math.min(1, h)),
    angle: Number.isFinite(Number(raw.angle)) ? Number(raw.angle) : 0,
  };
}

export function designPixelAspectFromSession(sd) {
  const w = Number(sd?.designWidth);
  const h = Number(sd?.designHeight);
  if (w > 0 && h > 0) return w / h;
  return null;
}

export function designPixelAspectFromDesignRow(designRow) {
  const w = Number(designRow?.width);
  const h = Number(designRow?.height);
  if (w > 0 && h > 0) return w / h;
  return null;
}

function isWidthLimitedUniformContain(designWidth, designHeight, printAreaWidth, printAreaHeight) {
  const dW = Number(designWidth);
  const dH = Number(designHeight);
  const paw = Number(printAreaWidth);
  const pah = Number(printAreaHeight);
  if (!(dW > 0 && dH > 0 && paw > 0 && pah > 0)) return false;
  return paw / dW <= pah / dH;
}

function uniformContainPrintifyCenterY(ctx, scale, { verticalAlign = "top" } = {}) {
  const dW = Number(ctx?.designWidth);
  const dH = Number(ctx?.designHeight);
  const paw = Number(ctx?.printAreaWidthPx);
  const pah = Number(ctx?.printAreaHeightPx);
  const s = Number(scale);
  if (!(dW > 0 && dH > 0 && paw > 0 && pah > 0 && s > 0)) return 0.5;
  const widthLimited = isWidthLimitedUniformContain(dW, dH, paw, pah);
  if (widthLimited && verticalAlign === "top") {
    const printedH = (s * paw * dH) / dW;
    return clamp01(printedH / 2 / pah);
  }
  return 0.5;
}

/** Contain-fit using design pixel aspect inside print-area bounds on stage. */
export function containDesignRectInPrintAreaBounds(bounds, designAspect) {
  const b = normalizeRect(bounds);
  const ar = Number(designAspect);
  if (!b || !(ar > 0)) return null;
  const bw = b.w;
  const bh = b.h;
  let w;
  let h;
  let y;
  if (ar >= bw / bh) {
    w = bw;
    h = bw / ar;
    y = b.y;
  } else {
    h = bh;
    w = bh * ar;
    y = b.y + (bh - h) / 2;
  }
  return normalizeRect({
    x: b.x + (bw - w) / 2,
    y,
    w,
    h,
    angle: 0,
  });
}

function printifyScaleForCreatorDesign(m, designWidth, printAreaWidth) {
  const mul = Number(m);
  const dw = Number(designWidth);
  const pw = Number(printAreaWidth);
  if (!Number.isFinite(mul) || mul <= 0) return 0.95;
  if (!Number.isFinite(dw) || dw <= 0 || !Number.isFinite(pw) || pw <= 0) {
    return parseFloat(mul.toFixed(6));
  }
  const s = (mul * dw) / pw;
  return parseFloat(Math.min(Math.max(s, 1e-6), 1e3).toFixed(6));
}

/** Uniform contain in print-area px → Printify placement (mirrors worker). */
export function uniformContainPrintifyPlacement(ctx = {}, options = {}) {
  const dW = Number(ctx.designWidth);
  const dH = Number(ctx.designHeight);
  const paw = Number(ctx.printAreaWidthPx);
  const pah = Number(ctx.printAreaHeightPx);
  if (!(dW > 0 && dH > 0 && paw > 0 && pah > 0)) return null;
  const m = Math.min(paw / dW, pah / dH);
  const scale = printifyScaleForCreatorDesign(m, dW, paw);
  const y = uniformContainPrintifyCenterY(ctx, scale, options);
  return { x: 0.5, y: parseFloat(y.toFixed(6)), scale, angle: 0 };
}

/** Align session rect via print-px contain → Printify placement → stage bounds. */
export function sessionDesignRectFromUniformContain(ctx = {}) {
  const placement = uniformContainPrintifyPlacement(ctx);
  if (!placement) return null;
  return printifyPlacementToSessionDesignRect(placement, ctx);
}

/** Printify placement → session design rect (inverse of worker rectToPrintifyImagePlacement). */
export function printifyPlacementToSessionDesignRect(placement, ctx = {}) {
  if (!placement || typeof placement !== "object") return null;
  const bounds = normalizeRect(ctx.printAreaBounds);
  const dW = Number(ctx.designWidth);
  const dH = Number(ctx.designHeight);
  const paw = Number(ctx.printAreaWidthPx);
  const pah = Number(ctx.printAreaHeightPx);
  const scale = Number(placement.scale);
  const px = Number(placement.x);
  const py = Number(placement.y);
  if (!(bounds && bounds.w > 0 && bounds.h > 0)) return null;
  if (!(dW > 0 && dH > 0 && paw > 0 && pah > 0 && scale > 0)) return null;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

  const printedW = scale * paw;
  const printedH = (scale * paw * dH) / dW;
  const relW = printedW / paw;
  const relH = printedH / pah;
  const cx = clamp01(px);
  const cy = clamp01(py);
  const w = relW * bounds.w;
  const h = relH * bounds.h;
  const x = bounds.x + cx * bounds.w - w / 2;
  const y = bounds.y + cy * bounds.h - h / 2;
  return normalizeRect({
    x,
    y,
    w,
    h,
    angle: Number.isFinite(Number(placement.angle)) ? Number(placement.angle) : 0,
  });
}

export function buildPlacementCtxFromSession(st, data) {
  const placement = { view_key: st?.activeView || "front" };
  if (st?.redRect) placement.print_area_bounds = { ...st.redRect };
  const sd = st?.sessionTestDesign;
  const dw = Number(sd?.designWidth);
  const dh = Number(sd?.designHeight);
  if (dw > 0 && dh > 0) {
    placement.design_width = dw;
    placement.design_height = dh;
  }
  if (data) {
    const vk = String(st?.activeView || "front").toLowerCase();
    const rows = data.mockup_defaults || [];
    const md = rows.find((r) => String(r.print_area_key || "").toLowerCase() === vk) || rows[0];
    let paw = Number(md?.printify_print_area_width);
    let pah = Number(md?.printify_print_area_height);
    if (!(paw > 0 && pah > 0)) {
      for (const row of data.variant_print_areas || []) {
        if (String(row?.print_area_key || "").toLowerCase() !== vk) continue;
        paw = Number(row.printify_print_area_width);
        pah = Number(row.printify_print_area_height);
        if (paw > 0 && pah > 0) break;
      }
    }
    if (paw > 0 && pah > 0) {
      placement.print_area_width_px = paw;
      placement.print_area_height_px = pah;
    }
  }
  return {
    printAreaBounds: placement.print_area_bounds,
    designWidth: placement.design_width,
    designHeight: placement.design_height,
    printAreaWidthPx: placement.print_area_width_px,
    printAreaHeightPx: placement.print_area_height_px,
  };
}

/**
 * Apply live Printify design placement from preview API onto session overlay rect.
 */
export function applyLivePrintifyPlacementToSessionDesign(st, data, live, { markDirty = false } = {}) {
  const sd = st?.sessionTestDesign;
  if (!sd?.rect || !live?.placement) return false;
  if (live.design_width > 0) sd.designWidth = Number(live.design_width);
  if (live.design_height > 0) sd.designHeight = Number(live.design_height);
  const ctx = buildPlacementCtxFromSession(st, data);
  const rect = printifyPlacementToSessionDesignRect(live.placement, ctx);
  if (!rect) return false;
  sd.rect = rect;
  if (markDirty) {
    sd.dirty = true;
  } else {
    sd.savedRect = { ...rect };
    sd.dirty = false;
  }
  return true;
}
