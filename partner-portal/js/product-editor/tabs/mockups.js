import { escapeHtml } from "/shared/js/partner-api.js";
import { uploadImage } from "../api.js";

const SETS = [
  { id: "calibration", label: "Calibration" },
  { id: "clean", label: "Clean" },
  { id: "shop_preview", label: "Shop Preview" },
];

function slotKey(set, view, color) {
  return `${set}||${view}||${color || ""}`;
}

function slotsMap(mockups) {
  const map = {};
  for (const m of mockups || []) {
    map[slotKey(m.mockup_set || "clean", m.view_key, m.color_key || "")] = m;
  }
  return map;
}

export function renderMockupsTab(ctx) {
  const section = ctx.mockupSection || "clean";
  const views = ctx.localViews || ctx.bundle?.views || [];
  const colors = ctx.localColors?.length
    ? ctx.localColors
    : ctx.bundle?.colors?.length
      ? ctx.bundle.colors
      : ["Default"];
  const map = slotsMap(ctx.localMockups || ctx.bundle?.mockups || []);

  const grid = views
    .map((view) => {
      const colorCards = colors
        .map((color) => {
          const key = slotKey(section, view.view_key, color);
          const slot = map[key] || {};
          const preview = slot.image_url || "";
          return `<div class="pe-mock-card" data-slot="${escapeHtml(key)}" data-view="${escapeHtml(view.view_key)}" data-color="${escapeHtml(color)}">
            <div class="pe-mock-card__label">${escapeHtml(view.label)} · ${escapeHtml(color)}</div>
            <div class="pe-mock-card__preview">${
              preview
                ? `<img src="${escapeHtml(preview)}" alt="" />`
                : `<span class="ce-hint">No image</span>`
            }</div>
            <div class="field"><label>Image URL</label>
              <input class="input input-sm pe-mock-url" value="${escapeHtml(slot.image_url || "")}" placeholder="https://…" /></div>
            <div class="ce-inline-actions">
              <label class="btn btn-secondary btn-sm pe-mock-upload-label">
                Upload<input type="file" class="pe-mock-file" accept="image/*" hidden />
              </label>
              <input type="hidden" class="pe-mock-r2" value="${escapeHtml(slot.image_r2_key || "")}" />
            </div>
          </div>`;
        })
        .join("");
      return `<section class="pe-mock-view-block"><h4 class="ce-section-title">${escapeHtml(view.label)} <code>${escapeHtml(view.view_key)}</code></h4>
        <div class="pe-mock-grid">${colorCards}</div></section>`;
    })
    .join("");

  return `
    <div class="ce-tab-panel pe-mockups-panel">
      <h3 class="ce-section-title">${SETS.find((s) => s.id === section)?.label || "Mockups"}</h3>
      <p class="ce-hint">Slots are View × Color. Upload to R2 or paste a URL. Clean Front is required for review.</p>
      ${grid || `<p class="ce-hint">Add views and colors on the Variants tab first.</p>`}
    </div>`;
}

export function updateMockSectionSubnav(ctx, root) {
  const section = ctx.mockupSection || "clean";
  root?.querySelectorAll("[data-mock-section]").forEach((btn) => {
    const active = btn.dataset.mockSection === section;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

export function snapshotMockupsTab(ctx) {
  const existing = [...(ctx.localMockups || ctx.bundle?.mockups || [])];
  const section = ctx.mockupSection || "clean";
  // Drop current section slots, re-collect from DOM
  const kept = existing.filter((m) => (m.mockup_set || "clean") !== section);
  document.querySelectorAll(".pe-mock-card").forEach((card) => {
    const view_key = card.dataset.view;
    const color_key = card.dataset.color || "";
    const image_url = card.querySelector(".pe-mock-url")?.value?.trim() || null;
    const image_r2_key = card.querySelector(".pe-mock-r2")?.value?.trim() || null;
    if (!image_url && !image_r2_key) return;
    kept.push({
      mockup_set: section,
      view_key,
      color_key,
      image_url,
      image_r2_key,
    });
  });
  ctx.localMockups = kept;
  return kept;
}

export function bindMockupsTab(ctx, root) {
  if (!ctx.localMockups) ctx.localMockups = [...(ctx.bundle?.mockups || [])];
  updateMockSectionSubnav(ctx, root.closest(".catalog-editor") || document);

  root.querySelectorAll(".pe-mock-url").forEach((el) => {
    el.addEventListener("input", () => {
      const card = el.closest(".pe-mock-card");
      const imgWrap = card?.querySelector(".pe-mock-card__preview");
      if (imgWrap && el.value) {
        imgWrap.innerHTML = `<img src="${escapeHtml(el.value)}" alt="" />`;
      }
      ctx.markDirty?.();
    });
  });

  root.querySelectorAll(".pe-mock-file").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !ctx.productId) return;
      try {
        const res = await uploadImage(ctx.productId, file);
        const card = input.closest(".pe-mock-card");
        if (card) {
          card.querySelector(".pe-mock-r2").value = res.image_r2_key || "";
          card.querySelector(".pe-mock-url").value = res.image_url || "";
          const imgWrap = card.querySelector(".pe-mock-card__preview");
          if (imgWrap && res.image_url) {
            imgWrap.innerHTML = `<img src="${escapeHtml(res.image_url)}" alt="" />`;
          }
        }
        ctx.markDirty?.();
        ctx.showToast?.("Uploaded", "Mockup image saved to storage");
      } catch (e) {
        ctx.showToast?.("Upload failed", e.message || String(e));
      }
    });
  });
}
