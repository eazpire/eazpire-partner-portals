import { escapeHtml } from "/shared/js/partner-api.js";
import {
  rectHandlesHtml,
  clampRectToStage,
  resizeRectByCorner,
  moveRect,
  fitRectWithAspect,
  defaultCenteredRect,
  parseNormalizedRect,
  drawRectEl,
} from "../print-area/rect-interaction.js";

const DPI_DEFAULT = 300;

function printableViews(ctx) {
  return (ctx.localViews || ctx.bundle?.views || []).filter((v) => v.printable !== false && v.printable !== 0);
}

function ensurePaState(ctx) {
  if (!ctx.paUi) {
    ctx.paUi = {
      activeViewKey: null,
      activeColorKey: "",
      locked: true,
      rects: {},
      metaByView: {},
    };
  }
  return ctx.paUi;
}

function viewAspect(view) {
  const w = Number(view?.print_width);
  const h = Number(view?.print_height);
  if (w > 0 && h > 0) return w / h;
  return 1;
}

function physicalToCanvasPx(view) {
  const unit = String(view?.print_unit || "mm").toLowerCase();
  const w = Number(view?.print_width);
  const h = Number(view?.print_height);
  if (!(w > 0) || !(h > 0)) {
    return { width_px: 4500, height_px: 4500, dpi: DPI_DEFAULT };
  }
  if (unit === "px") {
    return { width_px: Math.round(w), height_px: Math.round(h), dpi: DPI_DEFAULT };
  }
  const toInches = { mm: 1 / 25.4, cm: 1 / 2.54, in: 1 };
  const factor = toInches[unit] || toInches.mm;
  return {
    width_px: Math.max(1, Math.round(w * factor * DPI_DEFAULT)),
    height_px: Math.max(1, Math.round(h * factor * DPI_DEFAULT)),
    dpi: DPI_DEFAULT,
  };
}

function cleanMockups(ctx) {
  return (ctx.localMockups || ctx.bundle?.mockups || []).filter(
    (m) => (m.mockup_set || "clean") === "clean" && (m.image_url || m.image_r2_key)
  );
}

function cleanColorsForView(ctx, viewKey) {
  const colors = [];
  const seen = new Set();
  for (const m of cleanMockups(ctx)) {
    if (String(m.view_key) !== String(viewKey)) continue;
    const ck = String(m.color_key || "");
    if (seen.has(ck)) continue;
    seen.add(ck);
    colors.push(ck);
  }
  return colors;
}

function resolveCleanImage(ctx, viewKey, colorKey) {
  const slots = cleanMockups(ctx).filter((m) => String(m.view_key) === String(viewKey));
  if (!slots.length) return null;
  const preferred = slots.find((m) => String(m.color_key || "") === String(colorKey || ""));
  return preferred || slots[0];
}

function seedRectsFromBundle(ctx) {
  const st = ensurePaState(ctx);
  const views = printableViews(ctx);
  const areas = ctx.localPrintAreas || ctx.bundle?.print_areas || [];
  const byView = Object.fromEntries(areas.map((a) => [a.view_key || a.area_key, a]));

  for (const view of views) {
    const key = view.view_key;
    if (st.rects[key]) continue;
    const a = byView[key];
    const parsed = parseNormalizedRect(a?.print_rect || a?.position);
    st.rects[key] = parsed || defaultCenteredRect(viewAspect(view), 0.45);
    st.metaByView[key] = {
      placeholders: a?.placeholders || {},
      image_url: a?.image_url || null,
      image_r2_key: a?.image_r2_key || null,
      id: a?.id || null,
    };
  }

  if (!st.activeViewKey || !views.some((v) => v.view_key === st.activeViewKey)) {
    st.activeViewKey = views[0]?.view_key || null;
  }
  if (st.activeViewKey) {
    const colors = cleanColorsForView(ctx, st.activeViewKey);
    if (!colors.includes(st.activeColorKey)) {
      st.activeColorKey = colors[0] ?? "";
    }
  }
}

function lockIcon(locked) {
  if (locked) {
    return `<svg class="pe-pa-lock-icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6H8V6a2 2 0 1 1 4 0v2Z"/></svg>`;
  }
  return `<svg class="pe-pa-lock-icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M15 8h-1V6a4 4 0 0 0-7.9-1h2.1A2 2 0 0 1 12 6v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2Z"/></svg>`;
}

function colorHex(ctx, colorKey) {
  const map = ctx.localColorHexes || ctx.bundle?.color_hexes || {};
  return map[colorKey] || "#94a3b8";
}

export function renderPrintAreaTab(ctx) {
  seedRectsFromBundle(ctx);
  const views = printableViews(ctx);
  if (!views.length) {
    return `<div class="ce-tab-panel pe-print-area-panel"><p class="ce-hint">Mark at least one view as printable on the Variants tab.</p></div>`;
  }

  const st = ensurePaState(ctx);
  const activeView = views.find((v) => v.view_key === st.activeViewKey) || views[0];
  const colors = cleanColorsForView(ctx, activeView.view_key);
  const slot = resolveCleanImage(ctx, activeView.view_key, st.activeColorKey);
  const imgUrl = slot?.image_url || "";
  const aspect = viewAspect(activeView);
  const rect = st.rects[activeView.view_key] || defaultCenteredRect(aspect, 0.45);
  st.rects[activeView.view_key] = rect;

  const unit = activeView.print_unit || "mm";
  const dimLabel =
    activeView.print_height > 0 && activeView.print_width > 0
      ? `${activeView.print_height} × ${activeView.print_width} ${unit}`
      : "Set size in Edit View";
  const techLabel = activeView.print_technique ? String(activeView.print_technique).toUpperCase() : "—";

  const colorChips =
    colors.length > 1
      ? `<div class="pe-pa-color-dock" role="list" aria-label="Clean mockup colors">
        ${colors
          .map((ck) => {
            const active = String(ck) === String(st.activeColorKey);
            const label = ck || "Default";
            return `<button type="button" class="pe-pa-color-chip ${active ? "is-active" : ""}" data-pe-pa-color="${escapeHtml(ck)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="listitem">
              <span class="pe-pa-color-chip__swatch" style="background:${escapeHtml(colorHex(ctx, ck))}"></span>
            </button>`;
          })
          .join("")}
      </div>`
      : "";

  const viewDock = `<div class="pe-pa-view-dock" role="tablist" aria-label="Printable views">
    ${views
      .map((v) => {
        const active = v.view_key === activeView.view_key;
        return `<button type="button" class="pe-pa-view-chip ${active ? "is-active" : ""}" data-pe-pa-view="${escapeHtml(v.view_key)}" role="tab" aria-selected="${active ? "true" : "false"}">${escapeHtml(v.label || v.view_key)}</button>`;
      })
      .join("")}
  </div>`;

  return `
    <div class="ce-tab-panel pe-print-area-panel pe-print-area-panel--viewer">
      <div class="pe-pa-viewer-meta">
        <span class="pe-pa-meta-pill" title="Print technique">${escapeHtml(techLabel)}</span>
        <span class="pe-pa-meta-pill" title="Print area size">${escapeHtml(dimLabel)}</span>
        <span class="pe-pa-meta-hint">Drag and scale the red area · aspect locked to Edit View size</span>
      </div>
      <div class="pe-pa-viewer" data-pe-pa-viewer>
        <button type="button" class="pe-pa-viewer-lock ${st.locked ? "is-locked" : ""}" id="pe-pa-lock" aria-pressed="${st.locked ? "true" : "false"}" aria-label="${st.locked ? "Unlock print area" : "Lock print area"}" title="${st.locked ? "Unlock" : "Lock"}">
          ${lockIcon(st.locked)}
        </button>
        ${colorChips}
        <div class="pe-pa-stage" id="pe-pa-stage">
          <div class="pe-pa-stage-inner" data-pe-pa-stage-inner>
            ${
              imgUrl
                ? `<img class="pe-pa-stage-img" data-pe-pa-img alt="" src="${escapeHtml(imgUrl)}" />`
                : `<div class="pe-pa-stage-empty">No Clean Mockup for this view yet — upload one on the Mockups tab.</div>`
            }
            ${
              imgUrl
                ? `<div class="pe-pa-rect ${st.locked ? "is-locked" : "is-active"}" data-pe-pa-rect title="Print area">
              ${rectHandlesHtml()}
            </div>`
                : ""
            }
          </div>
        </div>
        ${viewDock}
      </div>
    </div>`;
}

export function snapshotPrintAreaTab(ctx) {
  seedRectsFromBundle(ctx);
  const st = ensurePaState(ctx);
  const views = printableViews(ctx);
  const areas = [];

  for (const view of views) {
    const key = view.view_key;
    const aspect = viewAspect(view);
    let rect = st.rects[key] || defaultCenteredRect(aspect, 0.45);
    rect = clampRectToStage(fitRectWithAspect(rect, aspect));
    st.rects[key] = rect;
    const canvas = physicalToCanvasPx(view);
    const meta = st.metaByView[key] || {};
    const print_rect = {
      x: Number(rect.x.toFixed(6)),
      y: Number(rect.y.toFixed(6)),
      w: Number(rect.w.toFixed(6)),
      h: Number(rect.h.toFixed(6)),
      width: Number(rect.w.toFixed(6)),
      height: Number(rect.h.toFixed(6)),
    };
    areas.push({
      view_key: key,
      area_key: key,
      label: view.label || key,
      width_px: canvas.width_px,
      height_px: canvas.height_px,
      dpi: canvas.dpi,
      print_rect,
      position: print_rect,
      safe_zone: { x: 0, y: 0, width: canvas.width_px, height: canvas.height_px },
      placeholders: meta.placeholders || {},
      image_url: meta.image_url || null,
      image_r2_key: meta.image_r2_key || null,
    });
  }
  return areas;
}

export function bindPrintAreaTab(ctx, root) {
  seedRectsFromBundle(ctx);
  const st = ensurePaState(ctx);
  const stageInner = root.querySelector("[data-pe-pa-stage-inner]");
  const rectEl = root.querySelector("[data-pe-pa-rect]");
  const lockBtn = root.querySelector("#pe-pa-lock");

  const getActiveView = () => {
    const views = printableViews(ctx);
    return views.find((v) => v.view_key === st.activeViewKey) || views[0] || null;
  };

  const getStageBox = () => {
    const w = stageInner?.clientWidth || 0;
    const h = stageInner?.clientHeight || 0;
    return w > 0 && h > 0 ? { w, h } : null;
  };

  const redraw = () => {
    const view = getActiveView();
    if (!view || !rectEl) return;
    const aspect = viewAspect(view);
    let rect = st.rects[view.view_key] || defaultCenteredRect(aspect, 0.45, getStageBox());
    rect = fitRectWithAspect(rect, aspect, getStageBox());
    st.rects[view.view_key] = rect;
    drawRectEl(rectEl, rect, !st.locked);
    rectEl.classList.toggle("is-locked", st.locked);
  };

  requestAnimationFrame(() => redraw());

  lockBtn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    st.locked = !st.locked;
    lockBtn.classList.toggle("is-locked", st.locked);
    lockBtn.setAttribute("aria-pressed", st.locked ? "true" : "false");
    lockBtn.setAttribute("aria-label", st.locked ? "Unlock print area" : "Lock print area");
    lockBtn.title = st.locked ? "Unlock" : "Lock";
    lockBtn.innerHTML = lockIcon(st.locked);
    redraw();
  });

  root.querySelectorAll("[data-pe-pa-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.pePaView;
      if (!key || key === st.activeViewKey) return;
      st.activeViewKey = key;
      const colors = cleanColorsForView(ctx, key);
      st.activeColorKey = colors[0] ?? "";
      ctx.reloadTab?.();
    });
  });

  root.querySelectorAll("[data-pe-pa-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      st.activeColorKey = btn.dataset.pePaColor || "";
      ctx.reloadTab?.();
    });
  });

  if (!rectEl || !stageInner) return;

  let drag = null;

  const stagePoint = (ev) => {
    const box = stageInner.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) return null;
    return {
      x: Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height)),
      box,
    };
  };

  rectEl.addEventListener("mousedown", (ev) => {
    if (st.locked) return;
    const view = getActiveView();
    if (!view) return;
    const handle = ev.target.closest("[data-resize]");
    const pt = stagePoint(ev);
    if (!pt) return;
    const startRect = { ...(st.rects[view.view_key] || defaultCenteredRect(viewAspect(view))) };
    if (handle) {
      drag = {
        type: "resize",
        corner: handle.dataset.resize,
        rect: startRect,
        viewKey: view.view_key,
        aspect: viewAspect(view),
      };
    } else {
      drag = {
        type: "move",
        sx: pt.x,
        sy: pt.y,
        rect: startRect,
        viewKey: view.view_key,
      };
    }
    ev.preventDefault();
    ev.stopPropagation();
  });

  const onMove = (ev) => {
    if (!drag) return;
    const pt = stagePoint(ev);
    if (!pt) return;
    if (drag.type === "move") {
      const next = moveRect(drag.rect, pt.x - drag.sx, pt.y - drag.sy);
      st.rects[drag.viewKey] = next;
      drawRectEl(rectEl, next, true);
    } else if (drag.type === "resize") {
      const next = resizeRectByCorner(drag.corner, drag.rect, pt.x, pt.y, {
        aspectRatio: drag.aspect,
        stageBox: getStageBox(),
      });
      st.rects[drag.viewKey] = next;
      drawRectEl(rectEl, next, true);
    }
    ctx.markDirty?.();
  };

  const onUp = () => {
    drag = null;
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  // Clean up listeners when tab is re-rendered (body replaced)
  const body = root.closest?.("#pe-body") || root;
  body._pePaCleanup?.();
  body._pePaCleanup = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
}
