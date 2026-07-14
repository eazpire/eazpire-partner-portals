import { escapeHtml } from "/shared/js/partner-api.js";
import { uploadImage } from "../api.js";

export const MOCKUP_SECTION_PREVIEW_IMAGES = "preview_images";

const SETS = [
  { id: "calibration", label: "Calibration" },
  { id: "clean", label: "Clean" },
  { id: "shop_preview", label: "Shop Preview" },
  { id: MOCKUP_SECTION_PREVIEW_IMAGES, label: "Preview Images" },
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

/** Colors for View×Color grids — only from Variants (no invented "Default"). */
function resolveColors(ctx) {
  const fromLocal = [...(ctx.localColors || [])];
  const fromBundle = [...(ctx.bundle?.colors || [])];
  return [...new Set([...fromLocal, ...fromBundle].filter(Boolean))];
}

/** Views for View×Color grids — only from Variants → Views (no Front/Back fallback). */
function resolveViews(ctx) {
  return [...(ctx.localViews || ctx.bundle?.views || [])];
}

function previewImagesFromLocal(localMockups) {
  return (localMockups || [])
    .filter((m) => (m.mockup_set || "") === MOCKUP_SECTION_PREVIEW_IMAGES)
    .slice()
    .sort((a, b) => String(a.view_key).localeCompare(String(b.view_key)));
}

function newPreviewKey() {
  return `pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function upsertLocalSlot(ctx, patch) {
  if (!ctx.localMockups) ctx.localMockups = [...(ctx.bundle?.mockups || [])];
  const key = slotKey(patch.mockup_set || "clean", patch.view_key, patch.color_key || "");
  const idx = ctx.localMockups.findIndex(
    (m) => slotKey(m.mockup_set || "clean", m.view_key, m.color_key || "") === key
  );
  if (idx >= 0) ctx.localMockups[idx] = { ...ctx.localMockups[idx], ...patch };
  else ctx.localMockups.push({ ...patch });
}

function renderPreviewImagesSection(ctx) {
  const items = previewImagesFromLocal(ctx.localMockups || ctx.bundle?.mockups || []);
  const cards = items
    .map((item, idx) => {
      const preview = item.image_url || "";
      return `<div class="pe-mock-card pe-preview-card" data-view="${escapeHtml(item.view_key)}" data-idx="${idx}">
        <div class="pe-mock-card__preview">${
          preview ? `<img src="${escapeHtml(preview)}" alt="" />` : `<span class="ce-hint">No image</span>`
        }</div>
        <div class="field"><label>Title</label>
          <input class="input input-sm pe-preview-title" value="${escapeHtml(item.title || "")}" placeholder="e.g. Front lifestyle" /></div>
        <div class="field"><label>Image URL</label>
          <input class="input input-sm pe-mock-url" value="${escapeHtml(item.image_url || "")}" placeholder="https://…" /></div>
        <div class="ce-inline-actions">
          <label class="btn btn-secondary btn-sm pe-mock-upload-label">
            Upload<input type="file" class="pe-mock-file" accept="image/*" hidden />
          </label>
          <button type="button" class="btn btn-ghost btn-sm pe-preview-remove">Remove</button>
          <input type="hidden" class="pe-mock-r2" value="${escapeHtml(item.image_r2_key || "")}" />
        </div>
      </div>`;
    })
    .join("");

  return `
    <div class="ce-tab-panel pe-mockups-panel pe-preview-images-panel">
      <h3 class="ce-section-title">Preview Images</h3>
      <p class="ce-hint">Product gallery images (like Printify product images) — not tied to views or colors. Add as many as you need.</p>
      <div class="ce-inline-actions" style="margin-bottom:14px">
        <button type="button" class="btn btn-primary btn-sm" id="pe-add-preview-image">Add Image</button>
      </div>
      <div class="pe-mock-grid" id="pe-preview-grid">${cards || `<p class="ce-hint" style="grid-column:1/-1">No preview images yet.</p>`}</div>
    </div>`;
}

function renderViewColorGrid(ctx, section) {
  const views = resolveViews(ctx);
  const colors = resolveColors(ctx);
  const map = slotsMap(ctx.localMockups || ctx.bundle?.mockups || []);

  const emptyMsg = `<p class="ce-hint">Add views and colors on the Variants tab first.</p>`;
  if (!views.length || !colors.length) {
    return `
    <div class="ce-tab-panel pe-mockups-panel">
      <h3 class="ce-section-title">${SETS.find((s) => s.id === section)?.label || "Mockups"}</h3>
      <p class="ce-hint">Slots are View × Color. Upload to R2 or paste a URL. Clean Front is required for review.</p>
      ${emptyMsg}
    </div>`;
  }

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
                ? `<img src="${escapeHtml(preview)}" alt="" loading="lazy" />`
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
      ${grid}
    </div>`;
}

export function renderMockupsTab(ctx) {
  const section = ctx.mockupSection || "clean";
  if (section === MOCKUP_SECTION_PREVIEW_IMAGES) return renderPreviewImagesSection(ctx);
  return renderViewColorGrid(ctx, section);
}

export function updateMockSectionSubnav(ctx, root) {
  const section = ctx.mockupSection || "clean";
  root?.querySelectorAll("[data-mock-section]").forEach((btn) => {
    const active = btn.dataset.mockSection === section;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function snapshotPreviewImagesFromDom() {
  const items = [];
  document.querySelectorAll(".pe-preview-card").forEach((card) => {
    const view_key = card.dataset.view || newPreviewKey();
    const title = card.querySelector(".pe-preview-title")?.value?.trim() || "";
    const image_url = card.querySelector(".pe-mock-url")?.value?.trim() || null;
    const image_r2_key = card.querySelector(".pe-mock-r2")?.value?.trim() || null;
    if (!image_url && !image_r2_key && !title) return;
    items.push({
      mockup_set: MOCKUP_SECTION_PREVIEW_IMAGES,
      view_key,
      color_key: "",
      title,
      image_url,
      image_r2_key,
      overlay: { title },
    });
  });
  return items;
}

export function snapshotMockupsTab(ctx) {
  const existing = [...(ctx.localMockups || ctx.bundle?.mockups || [])];
  const section = ctx.mockupSection || "clean";
  const kept = existing.filter((m) => (m.mockup_set || "clean") !== section);

  if (section === MOCKUP_SECTION_PREVIEW_IMAGES) {
    kept.push(...snapshotPreviewImagesFromDom());
  } else {
    document.querySelectorAll(".pe-mock-card:not(.pe-preview-card)").forEach((card) => {
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
  }

  ctx.localMockups = kept;
  return kept;
}

function bindUploadInputs(ctx, root) {
  root.querySelectorAll(".pe-mock-url").forEach((el) => {
    el.addEventListener("input", () => {
      const card = el.closest(".pe-mock-card");
      const imgWrap = card?.querySelector(".pe-mock-card__preview");
      if (imgWrap && el.value) {
        imgWrap.innerHTML = `<img src="${escapeHtml(el.value)}" alt="" />`;
      }
      if (card && !card.classList.contains("pe-preview-card")) {
        upsertLocalSlot(ctx, {
          mockup_set: ctx.mockupSection || "clean",
          view_key: card.dataset.view,
          color_key: card.dataset.color || "",
          image_url: el.value?.trim() || null,
          image_r2_key: card.querySelector(".pe-mock-r2")?.value || null,
        });
      }
      ctx.markDirty?.();
    });
  });

  root.querySelectorAll(".pe-mock-file").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !ctx.productId) {
        if (!ctx.productId) ctx.showToast?.("Save details first", "Create the product before uploading");
        return;
      }
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
          const titleInput = card.querySelector(".pe-preview-title");
          if (titleInput && !titleInput.value.trim() && file.name) {
            titleInput.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
          }
          if (card.classList.contains("pe-preview-card")) {
            upsertLocalSlot(ctx, {
              mockup_set: MOCKUP_SECTION_PREVIEW_IMAGES,
              view_key: card.dataset.view,
              color_key: "",
              title: titleInput?.value || "",
              image_url: res.image_url || null,
              image_r2_key: res.image_r2_key || null,
            });
          } else {
            upsertLocalSlot(ctx, {
              mockup_set: ctx.mockupSection || "clean",
              view_key: card.dataset.view,
              color_key: card.dataset.color || "",
              image_url: res.image_url || null,
              image_r2_key: res.image_r2_key || null,
            });
          }
        }
        ctx.markDirty?.();
        ctx.showToast?.("Uploaded", "Image saved to storage");
      } catch (e) {
        ctx.showToast?.("Upload failed", e.message || String(e));
      }
    });
  });
}

export function bindMockupsTab(ctx, root) {
  if (!ctx.localMockups) ctx.localMockups = [...(ctx.bundle?.mockups || [])];
  updateMockSectionSubnav(ctx, root.closest(".catalog-editor") || document);
  bindUploadInputs(ctx, root);

  root.querySelectorAll(".pe-preview-title").forEach((el) => {
    el.addEventListener("input", () => ctx.markDirty?.());
  });

  root.querySelector("#pe-add-preview-image")?.addEventListener("click", () => {
    snapshotMockupsTab(ctx);
    const key = newPreviewKey();
    ctx.localMockups = [
      ...(ctx.localMockups || []),
      {
        mockup_set: MOCKUP_SECTION_PREVIEW_IMAGES,
        view_key: key,
        color_key: "",
        title: "",
        image_url: null,
        image_r2_key: null,
      },
    ];
    ctx.markDirty?.();
    ctx.reloadTab?.();
  });

  root.querySelectorAll(".pe-preview-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".pe-preview-card");
      const viewKey = card?.dataset.view;
      snapshotMockupsTab(ctx);
      ctx.localMockups = (ctx.localMockups || []).filter(
        (m) =>
          !(
            (m.mockup_set || "") === MOCKUP_SECTION_PREVIEW_IMAGES &&
            String(m.view_key) === String(viewKey)
          )
      );
      ctx.markDirty?.();
      ctx.reloadTab?.();
    });
  });
}
