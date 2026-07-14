import { escapeHtml } from "/shared/js/partner-api.js";
import { uploadImage } from "../api.js";

export function renderPrintAreaTab(ctx) {
  const views = (ctx.localViews || ctx.bundle?.views || []).filter((v) => v.printable !== false && v.printable !== 0);
  const areas = ctx.localPrintAreas || ctx.bundle?.print_areas || [];
  const byView = Object.fromEntries(areas.map((a) => [a.view_key || a.area_key, a]));

  if (!views.length) {
    return `<div class="ce-tab-panel"><p class="ce-hint">Mark at least one view as printable on the Variants tab.</p></div>`;
  }

  const blocks = views
    .map((view) => {
      const a = byView[view.view_key] || {};
      const rect = a.print_rect || a.position || {};
      return `<section class="pe-pa-block" data-view="${escapeHtml(view.view_key)}">
        <h3 class="ce-section-title">${escapeHtml(view.label)} <code>${escapeHtml(view.view_key)}</code></h3>
        <div class="split-row">
          <div class="field"><label>Width px</label>
            <input class="input pe-pa-w" type="number" value="${escapeHtml(a.width_px || 4500)}" /></div>
          <div class="field"><label>Height px</label>
            <input class="input pe-pa-h" type="number" value="${escapeHtml(a.height_px || 5400)}" /></div>
          <div class="field"><label>DPI</label>
            <input class="input pe-pa-dpi" type="number" value="${escapeHtml(a.dpi || 300)}" /></div>
        </div>
        <div class="split-row">
          <div class="field"><label>Rect X</label><input class="input pe-pa-rx" type="number" value="${escapeHtml(rect.x ?? 0)}" /></div>
          <div class="field"><label>Rect Y</label><input class="input pe-pa-ry" type="number" value="${escapeHtml(rect.y ?? 0)}" /></div>
          <div class="field"><label>Rect W</label><input class="input pe-pa-rw" type="number" value="${escapeHtml(rect.width ?? a.width_px ?? 4500)}" /></div>
          <div class="field"><label>Rect H</label><input class="input pe-pa-rh" type="number" value="${escapeHtml(rect.height ?? a.height_px ?? 5400)}" /></div>
        </div>
        <div class="field"><label>Placeholder slots (comma: qr, logo)</label>
          <input class="input pe-pa-ph" value="${escapeHtml(Array.isArray(a.placeholders) ? a.placeholders.join(", ") : Object.keys(a.placeholders || {}).join(", "))}" placeholder="qr, logo" /></div>
        <div class="field"><label>Reference image URL</label>
          <input class="input pe-pa-url" value="${escapeHtml(a.image_url || "")}" /></div>
        <div class="ce-inline-actions">
          <label class="btn btn-secondary btn-sm">Upload<input type="file" class="pe-pa-file" accept="image/*" hidden /></label>
          <input type="hidden" class="pe-pa-r2" value="${escapeHtml(a.image_r2_key || "")}" />
        </div>
        ${a.image_url ? `<div class="pe-pa-preview"><img src="${escapeHtml(a.image_url)}" alt="" /></div>` : ""}
      </section>`;
    })
    .join("");

  return `
    <div class="ce-tab-panel pe-print-area-panel">
      <p class="ce-hint">Define canvas size and print rectangle per printable view. Closeup/Lifestyle can stay non-printable.</p>
      ${blocks}
    </div>`;
}

export function snapshotPrintAreaTab() {
  const areas = [];
  document.querySelectorAll(".pe-pa-block").forEach((block) => {
    const view_key = block.dataset.view;
    const width_px = Number(block.querySelector(".pe-pa-w")?.value) || 4500;
    const height_px = Number(block.querySelector(".pe-pa-h")?.value) || 5400;
    const dpi = Number(block.querySelector(".pe-pa-dpi")?.value) || 300;
    const print_rect = {
      x: Number(block.querySelector(".pe-pa-rx")?.value) || 0,
      y: Number(block.querySelector(".pe-pa-ry")?.value) || 0,
      width: Number(block.querySelector(".pe-pa-rw")?.value) || width_px,
      height: Number(block.querySelector(".pe-pa-rh")?.value) || height_px,
    };
    const ph = String(block.querySelector(".pe-pa-ph")?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const placeholders = {};
    ph.forEach((k) => {
      placeholders[k] = true;
    });
    areas.push({
      view_key,
      area_key: view_key,
      label: view_key,
      width_px,
      height_px,
      dpi,
      print_rect,
      position: print_rect,
      safe_zone: { x: 0, y: 0, width: width_px, height: height_px },
      placeholders,
      image_url: block.querySelector(".pe-pa-url")?.value?.trim() || null,
      image_r2_key: block.querySelector(".pe-pa-r2")?.value?.trim() || null,
    });
  });
  return areas;
}

export function bindPrintAreaTab(ctx, root) {
  root.querySelectorAll("input").forEach((el) => {
    el.addEventListener("input", () => ctx.markDirty?.());
    el.addEventListener("change", () => ctx.markDirty?.());
  });
  root.querySelectorAll(".pe-pa-file").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !ctx.productId) return;
      try {
        const res = await uploadImage(ctx.productId, file);
        const block = input.closest(".pe-pa-block");
        if (block) {
          block.querySelector(".pe-pa-r2").value = res.image_r2_key || "";
          block.querySelector(".pe-pa-url").value = res.image_url || "";
        }
        ctx.markDirty?.();
        ctx.showToast?.("Uploaded", "Print area image saved");
      } catch (e) {
        ctx.showToast?.("Upload failed", e.message || String(e));
      }
    });
  });
}
