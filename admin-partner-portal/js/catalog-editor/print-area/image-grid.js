import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { uploadPrintAreaImage, clearPrintAreaImage } from "../api.js";
import { printAreaTemplateImageUrl, mockupImageUrl, buildMockupImagesByView, pickMockUrlForView } from "./helpers.js";

function renderViewImageCard(viewKey, md, byView) {
  const url = printAreaTemplateImageUrl(md);
  const mockEntries = byView?.[viewKey] ? Object.entries(byView[viewKey]) : [];

  const mockThumbs = mockEntries
    .slice(0, 6)
    .map(
      ([color, entry]) => `
    <button type="button" class="ce-pa-mock-pick" data-view="${escapeHtml(viewKey)}" data-color="${escapeHtml(color)}" title="${escapeHtml(color)}">
      <img src="${escapeHtml(entry.image_url)}" alt="" />
      <span>${escapeHtml(color)}</span>
    </button>`
    )
    .join("");

  const tile = url
    ? `
      <div class="ce-pa-img-tile ce-pa-img-tile--filled" id="ce-pa-img-preview-${escapeHtml(viewKey)}">
        <img src="${escapeHtml(url)}" alt="" />
        <button type="button" class="ce-pa-img-remove" data-view="${escapeHtml(viewKey)}" aria-label="Remove image">×</button>
      </div>`
    : `
      <label class="ce-pa-img-tile ce-pa-img-tile--empty" id="ce-pa-img-preview-${escapeHtml(viewKey)}" aria-label="Upload image">
        <span class="ce-pa-img-add-icon" aria-hidden="true">+</span>
        <input type="file" class="ce-pa-upload-input" accept="image/png,image/jpeg,image/webp" data-view="${escapeHtml(viewKey)}" hidden />
      </label>`;

  return `
    <div class="ce-pa-img-view" data-view="${escapeHtml(viewKey)}">
      <div class="ce-pa-img-view-head">${escapeHtml(viewKey)}</div>
      <div class="ce-pa-img-grid">${tile}</div>
      ${mockThumbs ? `<div class="ce-pa-mock-picks">${mockThumbs}</div>` : ""}
    </div>`;
}

export function renderImageGrids(st, data) {
  const byView = st.mockupImagesByView || buildMockupImagesByView(data.mockup_images || []);
  return st.viewKeys.map((vk) => renderViewImageCard(vk, data.mockup_defaults?.find((r) => String(r.print_area_key).toLowerCase() === vk) || null, byView)).join("");
}

export function bindImageGrids(root, ctx, st, data, callbacks = {}) {
  const { onUploaded, onCleared, onUseMockPick } = callbacks;

  root.querySelectorAll(".ce-pa-upload-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const viewKey = input.dataset.view;
      input.disabled = true;
      try {
        const res = await uploadPrintAreaImage(ctx.productKey, viewKey, file);
        const md = data.mockup_defaults?.find((r) => String(r.print_area_key).toLowerCase() === viewKey);
        if (md) md.print_area_template_r2_key = res.r2_key;
        onUploaded?.(viewKey, res);
      } catch (err) {
        console.error("Print area upload failed", err);
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });
  });

  root.querySelectorAll(".ce-pa-img-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const viewKey = btn.dataset.view;
      btn.disabled = true;
      try {
        await clearPrintAreaImage(ctx.productKey, viewKey);
        const md = data.mockup_defaults?.find((r) => String(r.print_area_key).toLowerCase() === viewKey);
        if (md) md.print_area_template_r2_key = null;
        onCleared?.(viewKey);
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll(".ce-pa-mock-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      onUseMockPick?.(btn.dataset.view, btn.dataset.color);
    });
  });
}

export function resolveLeftViewerImage(st, data, viewKey) {
  if (st.useMockups) {
    const group = st.variantGroups.groups.find((g) => g.id === st.activeVariantGroupId);
    const colorTitle = group?.title;
    const fromMock = pickMockUrlForView(st.mockupImagesByView, viewKey, colorTitle);
    if (fromMock) return fromMock;
  }
  const md = data.mockup_defaults?.find((r) => String(r.print_area_key || "").toLowerCase() === String(viewKey).toLowerCase());
  return printAreaTemplateImageUrl(md);
}

export function resolvePrintifyMockUrl(st, viewKey) {
  if (st.mockUrlsByView?.[viewKey]) return st.mockUrlsByView[viewKey];
  const group = st.variantGroups.groups.find((g) => g.id === st.activeVariantGroupId);
  return pickMockUrlForView(st.mockupImagesByView, viewKey, group?.title);
}
