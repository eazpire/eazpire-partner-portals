import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { openMockViewer } from "/partner/shared/js/mock-viewer.js";
import { fetchMockupsBundle, saveMockups, uploadMockupImage, deleteMockupImage } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";
import { showToast } from "/partner/shared/js/partner-shell.js";

export const MOCKUP_SET_CLEAN = "clean";
export const MOCKUP_SET_SHOP_PREVIEW = "shop_preview";
export const MOCKUP_SET_CALIBRATION = "calibration";
export const MOCKUP_SET_PREVIEW_IMAGES = "preview_images";

const MOCK_SECTION_IDS = {
  clean: MOCKUP_SET_CLEAN,
  shop_preview: MOCKUP_SET_SHOP_PREVIEW,
  calibration: MOCKUP_SET_CALIBRATION,
  preview_images: MOCKUP_SET_PREVIEW_IMAGES,
};

const SECTION_META = {
  [MOCKUP_SET_CLEAN]: {
    id: "clean",
    title: "Clean Mockups",
    hint: "Catalog product mockups for publishing and shop display — sync via Templates → Clean Mockups (or partner portal uploads).",
    emptyHint: "No clean mockup images yet. Sync on Templates, or wait for partner portal Clean mockups.",
    showPrintAreaToggle: true,
    showPreviewToggle: true,
    internal: false,
  },
  [MOCKUP_SET_SHOP_PREVIEW]: {
    id: "shop_preview",
    title: "Shop Preview Mockups",
    hint: "Wearing mocks for the shop — Create from Scratch and Shop Create preview cards. Upload here, or sync via Templates.",
    emptyHint: "No shop preview mockups yet. Upload images below (shop cards use these first; Preview Images are the fallback).",
    showPrintAreaToggle: false,
    showPreviewToggle: true,
    allowUpload: true,
    internal: false,
  },
  [MOCKUP_SET_CALIBRATION]: {
    id: "calibration",
    title: "Calibration Mockup",
    hint: "Internal placement-guide images for print-area detection (red rectangle) and personalized try-on. Not shown in the shop.",
    emptyHint: "No calibration mockup images yet.",
    showPrintAreaToggle: false,
    showPreviewToggle: false,
    internal: true,
  },
  [MOCKUP_SET_PREVIEW_IMAGES]: {
    id: "preview_images",
    title: "Preview Images",
    hint: "Lifestyle / gallery images (Catalog Studio + Skill Tree cards). Also used as shop-card fallback when Shop Preview is empty.",
    emptyHint: "No preview images yet. Upload below or via the partner portal.",
    showPrintAreaToggle: false,
    showPreviewToggle: false,
    allowUpload: true,
    internal: false,
  },
};

function ensureMockupsUiState(ctx) {
  if (!ctx.mockupsUiState) {
    ctx.mockupsUiState = {
      selectedSection: MOCKUP_SET_CLEAN,
      print_area_edit_use_mocks: false,
      preview_mock_id: null,
      shop_preview_mock_id: null,
    };
  }
  return ctx.mockupsUiState;
}

export function resolveActiveMockSection(ctx) {
  const ui = ensureMockupsUiState(ctx);
  const section = ui.selectedSection;
  if (section === MOCKUP_SET_SHOP_PREVIEW) return MOCKUP_SET_SHOP_PREVIEW;
  if (section === MOCKUP_SET_CALIBRATION) return MOCKUP_SET_CALIBRATION;
  if (section === MOCKUP_SET_PREVIEW_IMAGES) return MOCKUP_SET_PREVIEW_IMAGES;
  return MOCKUP_SET_CLEAN;
}

function imagesForSet(data, mockupSet) {
  if (mockupSet === MOCKUP_SET_SHOP_PREVIEW) return data?.shop_preview_images || [];
  if (mockupSet === MOCKUP_SET_CALIBRATION) return data?.calibration_images || [];
  if (mockupSet === MOCKUP_SET_PREVIEW_IMAGES) return data?.preview_images || [];
  return data?.images || [];
}

function groupImagesByView(images) {
  const byView = new Map();
  for (const img of images || []) {
    const viewKey = String(img.view_key || "other").trim() || "other";
    if (!byView.has(viewKey)) byView.set(viewKey, []);
    byView.get(viewKey).push(img);
  }
  return [...byView.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function formatViewLabel(viewKey) {
  return String(viewKey || "other")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderCarousel(mockupSet, viewKey, slides, previewId, showPreviewToggle, allowDelete) {
  const viewEsc = escapeHtml(viewKey);
  const isPreviewView = showPreviewToggle && slides.some((s) => String(s.id) === String(previewId));
  const slideHtml = slides
    .map((img) => {
      const isPreview = showPreviewToggle && String(img.id) === String(previewId);
      const delBtn =
        allowDelete && img.id
          ? `<button type="button" class="ce-mock-slide-remove" data-mock-delete="${escapeHtml(String(img.id))}" data-mock-set="${escapeHtml(mockupSet)}" aria-label="Remove image">×</button>`
          : "";
      return `
        <div class="ce-mock-carousel__slide-wrap">
          <button type="button" class="ce-mock-carousel__slide${isPreview ? " ce-mock-carousel__slide--active" : ""}" data-id="${escapeHtml(img.id)}" title="${escapeHtml(img.color_name || viewKey)} — click to enlarge" aria-label="View mockup ${escapeHtml(img.color_name || viewKey)}">
            <img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.color_name || viewKey)}" loading="lazy" />
            <span class="ce-mock-carousel__color">${escapeHtml(img.color_name || "Default")}</span>
          </button>
          ${delBtn}
        </div>`;
    })
    .join("");

  const previewToggle = showPreviewToggle
    ? `<label class="ce-mock-preview-toggle">
          <span class="ce-mock-preview-toggle__label">Preview Mock</span>
          <input
            type="checkbox"
            class="ce-mock-preview-switch"
            data-mock-set="${escapeHtml(mockupSet)}"
            data-view="${viewEsc}"
            ${isPreviewView ? "checked" : ""}
          />
          <span class="ce-mock-preview-toggle__track" aria-hidden="true"></span>
        </label>`
    : "";

  return `
    <article class="ce-mock-view" data-view-key="${viewEsc}">
      <header class="ce-mock-view__header">
        <div class="ce-mock-view__title-wrap">
          <h4 class="ce-mock-view__title">${escapeHtml(formatViewLabel(viewKey))}</h4>
          <span class="ce-mock-view__count">${slides.length} color${slides.length === 1 ? "" : "s"}</span>
        </div>
        ${previewToggle}
      </header>
      <div class="ce-mock-carousel" data-mock-set="${escapeHtml(mockupSet)}" data-view="${viewEsc}">
        <div class="ce-mock-carousel__viewport">
          <div class="ce-mock-carousel__track">${slideHtml}</div>
        </div>
      </div>
      ${
        showPreviewToggle
          ? `<input type="hidden" class="ce-mock-preview-id" data-mock-set="${escapeHtml(mockupSet)}" data-view="${viewEsc}" value="${isPreviewView ? escapeHtml(String(previewId)) : ""}" />`
          : ""
      }
    </article>`;
}

function renderMockupSetPanel(mockupSet, images, data, ui) {
  const meta = SECTION_META[mockupSet];
  const savedPreviewId =
    mockupSet === MOCKUP_SET_SHOP_PREVIEW ? ui.shop_preview_mock_id : ui.preview_mock_id;
  const previewRow = (images || []).find((img) => Number(img.is_default) === 1);
  const previewId = savedPreviewId || previewRow?.id || null;
  const allowUpload = !!meta.allowUpload;
  const grouped = groupImagesByView(images);
  const carousels = grouped.length
    ? grouped
        .map(([viewKey, slides]) =>
          renderCarousel(mockupSet, viewKey, slides, previewId, meta.showPreviewToggle !== false, allowUpload)
        )
        .join("")
    : `<p class="ce-hint">${escapeHtml(meta.emptyHint)}</p>`;

  const printAreaField = meta.showPrintAreaToggle
    ? `<div class="field ce-mock-print-area-field">
        <label><input type="checkbox" id="ce-mock-use-mocks" ${ui.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label>
      </div>`
    : "";

  const uploadBar = allowUpload
    ? `<div class="ce-mock-upload-bar">
        <button type="button" class="btn btn-secondary" id="ce-mock-upload-btn">Upload images</button>
        <input type="file" id="ce-mock-upload-file" accept="image/png,image/jpeg,image/webp" multiple hidden />
        <span class="ce-hint">PNG / JPEG / WebP · added to this set</span>
      </div>`
    : "";

  const internalBadge = meta.internal
    ? `<span class="ce-mock-internal-badge">Internal · Detection only</span>`
    : "";

  return `
    <section class="ce-mock-section-panel${meta.internal ? " ce-mock-section-panel--internal" : ""}" data-mock-section="${escapeHtml(meta.id)}" data-mock-set="${escapeHtml(mockupSet)}">
      <div class="ce-mock-section-panel__head">
        <h3 class="ce-section-title">${escapeHtml(meta.title)}</h3>
        ${internalBadge}
      </div>
      <p class="ce-hint">${escapeHtml(meta.hint)}</p>
      ${printAreaField}
      ${uploadBar}
      <div class="ce-mock-views">${carousels}</div>
    </section>`;
}

export function renderMockupsTabHtml(ctx, data) {
  const ui = ensureMockupsUiState(ctx);
  const mockupSet = resolveActiveMockSection(ctx);
  const images = imagesForSet(data, mockupSet);

  return `
    <div class="ce-tab-panel ce-mock-panel">
      ${renderMockupSetPanel(mockupSet, images, data, ui)}
    </div>`;
}

export async function loadMockupsTab(ctx) {
  const data = await fetchMockupsBundle(ctx.productKey, ctx.selectedPrintProviderId);
  ctx.mockupsData = data;
  const ui = ensureMockupsUiState(ctx);
  if (data.product?.print_area_edit_use_mocks !== undefined) {
    ui.print_area_edit_use_mocks = !!data.product.print_area_edit_use_mocks;
  }
  const cleanDefault = (data.images || []).find((img) => Number(img.is_default) === 1);
  const shopDefault = (data.shop_preview_images || []).find((img) => Number(img.is_default) === 1);
  ui.preview_mock_id = cleanDefault?.id || null;
  ui.shop_preview_mock_id = shopDefault?.id || null;
  return renderMockupsTabHtml(ctx, data);
}

function getActiveSlideId(carousel) {
  const active = carousel?.querySelector(".ce-mock-carousel__slide--active");
  return active?.getAttribute("data-id") || carousel?.querySelector(".ce-mock-carousel__slide")?.getAttribute("data-id") || "";
}

function setActiveSlide(carousel, slideEl) {
  if (!carousel || !slideEl) return;
  carousel.querySelectorAll(".ce-mock-carousel__slide").forEach((s) => {
    s.classList.toggle("ce-mock-carousel__slide--active", s === slideEl);
  });
}

function syncPreviewHiddenInput(mockupSet, viewKey, mockId) {
  const hidden = document.querySelector(
    `.ce-mock-preview-id[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
  );
  if (hidden) hidden.value = mockId || "";
}

function collectCarouselViewerItems(carousel) {
  return [...carousel.querySelectorAll(".ce-mock-carousel__slide")]
    .map((slide) => {
      const img = slide.querySelector("img");
      const label = slide.querySelector(".ce-mock-carousel__color")?.textContent?.trim() || img?.alt || "";
      return img?.src ? { url: img.src, label } : null;
    })
    .filter(Boolean);
}

function readPreviewMockIdForSet(mockupSet) {
  let previewMockId = null;
  document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]:checked`).forEach((toggle) => {
    const viewKey = toggle.dataset.view;
    const hidden = document.querySelector(
      `.ce-mock-preview-id[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
    );
    const carousel = document.querySelector(
      `.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
    );
    previewMockId = hidden?.value?.trim() || getActiveSlideId(carousel) || null;
  });
  return previewMockId;
}

/** Persist visible mock UI into ctx before switching mock sub-tabs. */
export function syncMockupsUiFromDom(ctx) {
  const ui = ensureMockupsUiState(ctx);
  const activeSet = resolveActiveMockSection(ctx);
  ui.print_area_edit_use_mocks = !!document.getElementById("ce-mock-use-mocks")?.checked;
  if (activeSet === MOCKUP_SET_CLEAN) {
    ui.preview_mock_id = readPreviewMockIdForSet(MOCKUP_SET_CLEAN);
  } else {
    ui.shop_preview_mock_id = readPreviewMockIdForSet(MOCKUP_SET_SHOP_PREVIEW);
  }
}

export function snapshotMockupsTab() {
  const ui = window.__catalogEditorState?.mockupsUiState;
  syncMockupsUiFromDom(window.__catalogEditorState || {});
  return {
    print_area_edit_use_mocks: !!ui?.print_area_edit_use_mocks,
    preview_mock_id: ui?.preview_mock_id || null,
    shop_preview_mock_id: ui?.shop_preview_mock_id || null,
    selected_mock_section: ui?.selectedSection || MOCKUP_SET_CLEAN,
  };
}

function bindMockupSetCarousels(ctx, mockupSet) {
  document.querySelectorAll(`.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((carousel) => {
    const viewKey = carousel.dataset.view;
    const slides = [...carousel.querySelectorAll(".ce-mock-carousel__slide")];

    slides.forEach((slide) => {
      slide.addEventListener("click", () => {
        setActiveSlide(carousel, slide);
        const toggle = document.querySelector(
          `.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
        );
        if (toggle?.checked) {
          syncPreviewHiddenInput(mockupSet, viewKey, slide.getAttribute("data-id") || "");
          syncMockupsUiFromDom(ctx);
        }
        const index = slides.indexOf(slide);
        openMockViewer(collectCarouselViewerItems(carousel), index);
      });
    });
  });

  document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const viewKey = toggle.dataset.view;
      if (!toggle.checked) {
        syncPreviewHiddenInput(mockupSet, viewKey, "");
        syncMockupsUiFromDom(ctx);
        notifyActiveTabDirty(ctx);
        return;
      }
      document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((other) => {
        if (other !== toggle) other.checked = false;
      });
      const carousel = document.querySelector(
        `.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
      );
      syncPreviewHiddenInput(mockupSet, viewKey, getActiveSlideId(carousel));
      syncMockupsUiFromDom(ctx);
      notifyActiveTabDirty(ctx);
    });
  });
}

export function updateMockSectionSubnav(ctx) {
  const activeId = SECTION_META[resolveActiveMockSection(ctx)].id;
  document.querySelectorAll("#ce-subnav-mock-sections .ce-mock-section-pill").forEach((pill) => {
    const on = pill.dataset.mockSection === activeId;
    pill.classList.toggle("active", on);
    pill.setAttribute("aria-selected", on ? "true" : "false");
  });
}

export function bindMockSectionSubnav(ctx) {
  const pills = document.querySelectorAll("#ce-subnav-mock-sections .ce-mock-section-pill");
  if (!pills.length) return;

  updateMockSectionSubnav(ctx);

  pills.forEach((pill) => {
    pill.onclick = () => {
      const sectionId = pill.dataset.mockSection;
      const mockupSet = MOCK_SECTION_IDS[sectionId];
      if (!mockupSet || mockupSet === resolveActiveMockSection(ctx)) return;
      switchMockSection(ctx, mockupSet);
    };
  });
}

export function switchMockSection(ctx, mockupSet) {
  syncMockupsUiFromDom(ctx);
  ensureMockupsUiState(ctx).selectedSection = mockupSet;
  const body = document.getElementById("ce-body");
  if (!body || !ctx.mockupsData) return;
  body.innerHTML = renderMockupsTabHtml(ctx, ctx.mockupsData);
  bindMockupsTab(ctx, body);
  updateMockSectionSubnav(ctx);
}

async function reloadMockupsPanel(ctx) {
  const data = await fetchMockupsBundle(ctx.productKey, ctx.selectedPrintProviderId);
  ctx.mockupsData = data;
  const ui = ensureMockupsUiState(ctx);
  const cleanDefault = (data.images || []).find((img) => Number(img.is_default) === 1);
  const shopDefault = (data.shop_preview_images || []).find((img) => Number(img.is_default) === 1);
  ui.preview_mock_id = cleanDefault?.id || null;
  ui.shop_preview_mock_id = shopDefault?.id || null;
  const body = document.getElementById("ce-body");
  if (!body) return;
  body.innerHTML = renderMockupsTabHtml(ctx, data);
  bindMockupsTab(ctx, body);
  updateMockSectionSubnav(ctx);
}

function bindMockupUpload(ctx, root) {
  const mockupSet = resolveActiveMockSection(ctx);
  const meta = SECTION_META[mockupSet];
  if (!meta?.allowUpload) return;
  const btn = root.querySelector("#ce-mock-upload-btn");
  const input = root.querySelector("#ce-mock-upload-file");
  if (!btn || !input) return;
  btn.onclick = () => input.click();
  input.onchange = async () => {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    btn.disabled = true;
    try {
      for (const file of files) {
        await uploadMockupImage(ctx.productKey, file, {
          mockupSet,
          printProviderId: ctx.selectedPrintProviderId || 0,
          colorName: "Default",
        });
      }
      showToast?.("Uploaded", `${files.length} image(s) added to ${meta.title}.`);
      await reloadMockupsPanel(ctx);
    } catch (err) {
      console.error("[mockups] upload failed", err);
      showToast?.("Upload failed", err?.message || "Could not upload image.");
    } finally {
      btn.disabled = false;
    }
  };

  root.querySelectorAll("[data-mock-delete]").forEach((el) => {
    el.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = el.getAttribute("data-mock-delete");
      const set = el.getAttribute("data-mock-set") || mockupSet;
      if (!id) return;
      try {
        await deleteMockupImage(ctx.productKey, id, set);
        showToast?.("Removed", "Mockup image deleted.");
        await reloadMockupsPanel(ctx);
      } catch (err) {
        console.error("[mockups] delete failed", err);
        showToast?.("Delete failed", err?.message || "Could not delete image.");
      }
    };
  });
}

export function bindMockupsTab(ctx, root) {
  bindTabDirtyInputs(root || document, ctx);
  bindMockupSetCarousels(ctx, resolveActiveMockSection(ctx));
  bindMockSectionSubnav(ctx);
  bindMockupUpload(ctx, root || document);
}

export async function saveMockupsTab(ctx) {
  syncMockupsUiFromDom(ctx);
  const ui = ensureMockupsUiState(ctx);
  await saveMockups(ctx.productKey, {
    print_provider_id: ctx.selectedPrintProviderId,
    print_area_edit_use_mocks: ui.print_area_edit_use_mocks,
    preview_mock_id: ui.preview_mock_id || undefined,
    shop_preview_mock_id: ui.shop_preview_mock_id || undefined,
    auto_mirror: false,
  });
}
