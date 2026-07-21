import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { openMockViewer } from "/partner/shared/js/mock-viewer.js";
import { fetchMockupsBundle, saveMockups, uploadMockupImage, deleteMockupImage } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { openPreviewImageGenerateModal } from "./preview-image-generate.js";

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
    hint: "Wearing mocks for Shop Create and Skill Tree when the Shop Preview source switch is On. Turn on Preview Mock for the main view, then click a color to set the main preview mock.",
    emptyHint: "No shop preview mockups yet. Upload images below, then turn On the Shop Preview source switch.",
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
    hint: "Click a mock to assign it to Skill Tree, Shop, or both. Only used when the Preview Images source switch is On.",
    emptyHint: "No preview images yet. Upload or Generate below.",
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
      preview_card_source: MOCKUP_SET_SHOP_PREVIEW,
      preview_carousel_mode_shop: "auto",
      preview_carousel_mode_skill_tree: "auto",
      /** @type {Record<string, { use_for_shop: boolean, use_for_skill_tree: boolean }>} */
      previewAssignments: {},
    };
  }
  const ui = ctx.mockupsUiState;
  if (!ui.previewAssignments || typeof ui.previewAssignments !== "object") ui.previewAssignments = {};
  if (!ui.preview_card_source) ui.preview_card_source = MOCKUP_SET_SHOP_PREVIEW;
  if (!ui.preview_carousel_mode_shop) ui.preview_carousel_mode_shop = "auto";
  if (!ui.preview_carousel_mode_skill_tree) ui.preview_carousel_mode_skill_tree = "auto";
  return ui;
}

function syncPreviewAssignmentsFromImages(ui, images) {
  for (const img of images || []) {
    const id = String(img?.id || "");
    if (!id) continue;
    if (ui.previewAssignments[id]) continue;
    ui.previewAssignments[id] = {
      use_for_shop: Number(img.use_for_shop) === 1,
      use_for_skill_tree: Number(img.use_for_skill_tree) === 1,
    };
  }
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

/** Collapse Printify camera aliases (e.g. person_*_back → back) so carousels aren't duplicated. */
function canonicalizeMockupViewKey(value) {
  const v = String(value || "other")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!v) return "other";
  if (/(^|_)back($|_)/.test(v)) return "back";
  if (/(^|_)neck($|_)/.test(v) || v.includes("collar")) return "neck";
  if (v.includes("left") && v.includes("sleeve")) return "left_sleeve";
  if (v.includes("right") && v.includes("sleeve")) return "right_sleeve";
  if (/(^|_)front($|_)/.test(v)) return "front";
  return v;
}

function groupImagesByView(images) {
  const byView = new Map();
  for (const img of images || []) {
    const viewKey = canonicalizeMockupViewKey(img.view_key || "other");
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

function assignmentBadgesHtml(img, ui) {
  const id = String(img?.id || "");
  const a = ui?.previewAssignments?.[id] || {
    use_for_shop: Number(img?.use_for_shop) === 1,
    use_for_skill_tree: Number(img?.use_for_skill_tree) === 1,
  };
  const bits = [];
  if (a.use_for_skill_tree) bits.push(`<span class="ce-mock-assign-badge ce-mock-assign-badge--skill">Skill Tree</span>`);
  if (a.use_for_shop) bits.push(`<span class="ce-mock-assign-badge ce-mock-assign-badge--shop">Shop</span>`);
  return bits.length ? `<span class="ce-mock-assign-badges">${bits.join("")}</span>` : "";
}

function renderCarousel(mockupSet, viewKey, slides, previewId, showPreviewToggle, allowDelete, ui = null) {
  const viewEsc = escapeHtml(viewKey);
  const isPreviewView = showPreviewToggle && slides.some((s) => String(s.id) === String(previewId));
  const isPreviewImagesSet = mockupSet === MOCKUP_SET_PREVIEW_IMAGES;
  const slideHtml = slides
    .map((img) => {
      const isPreview = showPreviewToggle && String(img.id) === String(previewId);
      const delBtn =
        allowDelete && img.id
          ? `<button type="button" class="ce-mock-slide-remove" data-mock-delete="${escapeHtml(String(img.id))}" data-mock-set="${escapeHtml(mockupSet)}" aria-label="Remove image">×</button>`
          : "";
      const mainBadge = isPreview
        ? `<span class="ce-mock-carousel__main-badge">Main preview</span>`
        : "";
      const assignBadges = isPreviewImagesSet ? assignmentBadgesHtml(img, ui) : "";
      const pickHint = isPreviewImagesSet
        ? " — click to assign Skill Tree / Shop"
        : isPreviewView
          ? " — click to set as main preview mock"
          : " — click to enlarge";
      return `
        <div class="ce-mock-carousel__slide-wrap">
          <button type="button" class="ce-mock-carousel__slide${isPreview ? " ce-mock-carousel__slide--active" : ""}${isPreviewView || isPreviewImagesSet ? " ce-mock-carousel__slide--pickable" : ""}" data-id="${escapeHtml(img.id)}" data-mock-assign="${isPreviewImagesSet ? "1" : "0"}" title="${escapeHtml(img.color_name || viewKey)}${pickHint}" aria-label="${isPreviewImagesSet ? "Assign mockup targets" : isPreviewView ? "Set as main preview mock" : "View mockup"} ${escapeHtml(img.color_name || viewKey)}" aria-pressed="${isPreview ? "true" : "false"}">
            <img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.color_name || viewKey)}" loading="lazy" />
            <span class="ce-mock-carousel__color">${escapeHtml(img.color_name || "Default")}</span>
            ${mainBadge}
            ${assignBadges}
          </button>
          <button type="button" class="ce-mock-slide-zoom" data-mock-zoom="${escapeHtml(String(img.id))}" aria-label="Enlarge ${escapeHtml(img.color_name || viewKey)}" title="Enlarge">↗</button>
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

  const pickHint =
    showPreviewToggle && isPreviewView
      ? `<p class="ce-mock-pick-hint">Preview Mock is on for this view — click a color to set it as the <strong>main preview mock</strong> (skill modal + shop cards).</p>`
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
      ${pickHint}
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
          renderCarousel(
            mockupSet,
            viewKey,
            slides,
            previewId,
            meta.showPreviewToggle !== false,
            allowUpload,
            ui
          )
        )
        .join("")
    : `<p class="ce-hint">${escapeHtml(meta.emptyHint)}</p>`;

  const printAreaField = meta.showPrintAreaToggle
    ? `<div class="field ce-mock-print-area-field">
        <label><input type="checkbox" id="ce-mock-use-mocks" ${ui.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label>
      </div>`
    : "";

  const generateBtn =
    mockupSet === MOCKUP_SET_PREVIEW_IMAGES
      ? `<button type="button" class="btn btn-secondary" id="ce-mock-generate-btn">Generate</button>`
      : "";

  const carouselModeField =
    mockupSet === MOCKUP_SET_PREVIEW_IMAGES || mockupSet === MOCKUP_SET_SHOP_PREVIEW
      ? `<div class="ce-mock-carousel-modes">
          <label class="ce-mock-carousel-mode">
            <span>Shop grid switch</span>
            <select id="ce-mock-carousel-mode-shop">
              <option value="auto" ${ui.preview_carousel_mode_shop === "auto" ? "selected" : ""}>Automatic</option>
              <option value="manual" ${ui.preview_carousel_mode_shop === "manual" ? "selected" : ""}>Manual (arrows)</option>
            </select>
          </label>
          <label class="ce-mock-carousel-mode">
            <span>Skill Tree grid switch</span>
            <select id="ce-mock-carousel-mode-skill">
              <option value="auto" ${ui.preview_carousel_mode_skill_tree === "auto" ? "selected" : ""}>Automatic</option>
              <option value="manual" ${ui.preview_carousel_mode_skill_tree === "manual" ? "selected" : ""}>Manual (arrows)</option>
            </select>
          </label>
        </div>`
      : "";

  const uploadBar = allowUpload
    ? `<div class="ce-mock-upload-bar">
        <button type="button" class="btn btn-secondary" id="ce-mock-upload-btn">Upload images</button>
        ${generateBtn}
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
      ${carouselModeField}
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
  ui.preview_card_source =
    String(data.product?.preview_card_source || "").toLowerCase() === MOCKUP_SET_PREVIEW_IMAGES
      ? MOCKUP_SET_PREVIEW_IMAGES
      : MOCKUP_SET_SHOP_PREVIEW;
  ui.preview_carousel_mode_shop =
    String(data.product?.preview_carousel_mode_shop || "").toLowerCase() === "manual" ? "manual" : "auto";
  ui.preview_carousel_mode_skill_tree =
    String(data.product?.preview_carousel_mode_skill_tree || "").toLowerCase() === "manual"
      ? "manual"
      : "auto";
  ui.previewAssignments = {};
  syncPreviewAssignmentsFromImages(ui, data.preview_images || []);
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
  const shopMode = document.getElementById("ce-mock-carousel-mode-shop")?.value;
  const skillMode = document.getElementById("ce-mock-carousel-mode-skill")?.value;
  if (shopMode === "auto" || shopMode === "manual") ui.preview_carousel_mode_shop = shopMode;
  if (skillMode === "auto" || skillMode === "manual") ui.preview_carousel_mode_skill_tree = skillMode;
  const shopOn = document.getElementById("ce-mock-source-shop")?.checked;
  const previewOn = document.getElementById("ce-mock-source-preview")?.checked;
  if (previewOn && !shopOn) ui.preview_card_source = MOCKUP_SET_PREVIEW_IMAGES;
  else if (shopOn) ui.preview_card_source = MOCKUP_SET_SHOP_PREVIEW;
}

export function snapshotMockupsTab() {
  const ui = window.__catalogEditorState?.mockupsUiState;
  syncMockupsUiFromDom(window.__catalogEditorState || {});
  return {
    print_area_edit_use_mocks: !!ui?.print_area_edit_use_mocks,
    preview_mock_id: ui?.preview_mock_id || null,
    shop_preview_mock_id: ui?.shop_preview_mock_id || null,
    selected_mock_section: ui?.selectedSection || MOCKUP_SET_CLEAN,
    preview_card_source: ui?.preview_card_source || MOCKUP_SET_SHOP_PREVIEW,
    preview_carousel_mode_shop: ui?.preview_carousel_mode_shop || "auto",
    preview_carousel_mode_skill_tree: ui?.preview_carousel_mode_skill_tree || "auto",
    preview_assignments: { ...(ui?.previewAssignments || {}) },
  };
}

function refreshMainPreviewBadges(mockupSet, previewId) {
  document.querySelectorAll(`.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"] .ce-mock-carousel__slide`).forEach((slide) => {
    const isMain = previewId && String(slide.getAttribute("data-id")) === String(previewId);
    slide.classList.toggle("ce-mock-carousel__slide--active", isMain);
    slide.setAttribute("aria-pressed", isMain ? "true" : "false");
    let badge = slide.querySelector(".ce-mock-carousel__main-badge");
    if (isMain && !badge) {
      badge = document.createElement("span");
      badge.className = "ce-mock-carousel__main-badge";
      badge.textContent = "Main preview";
      slide.appendChild(badge);
    } else if (!isMain && badge) {
      badge.remove();
    }
  });
}

function openPreviewAssignModal(ctx, img) {
  const ui = ensureMockupsUiState(ctx);
  const id = String(img?.id || "");
  if (!id) return;
  const cur = ui.previewAssignments[id] || {
    use_for_shop: Number(img.use_for_shop) === 1,
    use_for_skill_tree: Number(img.use_for_skill_tree) === 1,
  };
  let root = document.getElementById("ce-mock-assign-modal");
  if (!root) {
    root = document.createElement("div");
    root.id = "ce-mock-assign-modal";
    root.className = "ce-mock-assign-modal";
    root.hidden = true;
    root.innerHTML = `
      <div class="ce-mock-assign-modal__backdrop" data-ce-assign-dismiss></div>
      <div class="ce-mock-assign-modal__card" role="dialog" aria-modal="true" aria-labelledby="ce-mock-assign-title">
        <h3 id="ce-mock-assign-title" class="ce-mock-assign-modal__title">Assign preview mock</h3>
        <p class="ce-hint ce-mock-assign-modal__hint">Choose where this mock appears. You can select both.</p>
        <div class="ce-mock-assign-modal__preview"><img alt="" id="ce-mock-assign-img" /></div>
        <label class="ce-mock-assign-check"><input type="checkbox" id="ce-mock-assign-skill" /> Skill Tree</label>
        <label class="ce-mock-assign-check"><input type="checkbox" id="ce-mock-assign-shop" /> Shop</label>
        <div class="ce-mock-assign-modal__actions">
          <button type="button" class="btn btn-secondary" data-ce-assign-dismiss>Cancel</button>
          <button type="button" class="btn btn-primary" id="ce-mock-assign-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(root);
  }
  const imgEl = root.querySelector("#ce-mock-assign-img");
  if (imgEl) imgEl.src = img.image_url || "";
  const skill = root.querySelector("#ce-mock-assign-skill");
  const shop = root.querySelector("#ce-mock-assign-shop");
  if (skill) skill.checked = !!cur.use_for_skill_tree;
  if (shop) shop.checked = !!cur.use_for_shop;
  root.hidden = false;

  const close = () => {
    root.hidden = true;
  };
  root.querySelectorAll("[data-ce-assign-dismiss]").forEach((el) => {
    el.onclick = close;
  });
  const saveBtn = root.querySelector("#ce-mock-assign-save");
  if (saveBtn) {
    saveBtn.onclick = () => {
      ui.previewAssignments[id] = {
        use_for_skill_tree: !!skill?.checked,
        use_for_shop: !!shop?.checked,
      };
      // Keep in-memory mockupsData in sync for re-render badges.
      const list = ctx.mockupsData?.preview_images || [];
      const row = list.find((r) => String(r.id) === id);
      if (row) {
        row.use_for_skill_tree = ui.previewAssignments[id].use_for_skill_tree ? 1 : 0;
        row.use_for_shop = ui.previewAssignments[id].use_for_shop ? 1 : 0;
      }
      close();
      notifyActiveTabDirty(ctx);
      const body = document.getElementById("ce-body");
      if (body && ctx.mockupsData) {
        body.innerHTML = renderMockupsTabHtml(ctx, ctx.mockupsData);
        bindMockupsTab(ctx, body);
        updateMockSectionSubnav(ctx);
        syncPreviewCardSourceSwitches(ctx);
      }
    };
  }
}

function bindMockupSetCarousels(ctx, mockupSet) {
  document.querySelectorAll(`.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((carousel) => {
    const viewKey = carousel.dataset.view;
    const slides = [...carousel.querySelectorAll(".ce-mock-carousel__slide")];

    slides.forEach((slide) => {
      slide.addEventListener("click", () => {
        if (slide.getAttribute("data-mock-assign") === "1") {
          const id = slide.getAttribute("data-id");
          const img = (ctx.mockupsData?.preview_images || []).find((r) => String(r.id) === String(id));
          if (img) openPreviewAssignModal(ctx, img);
          return;
        }
        const toggle = document.querySelector(
          `.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
        );
        if (toggle?.checked) {
          // Preview Mock on → click picks the main preview mock (no lightbox).
          setActiveSlide(carousel, slide);
          const mockId = slide.getAttribute("data-id") || "";
          syncPreviewHiddenInput(mockupSet, viewKey, mockId);
          syncMockupsUiFromDom(ctx);
          refreshMainPreviewBadges(mockupSet, mockId);
          notifyActiveTabDirty(ctx);
          return;
        }
        const index = slides.indexOf(slide);
        openMockViewer(collectCarouselViewerItems(carousel), index);
      });
    });

    carousel.querySelectorAll(".ce-mock-slide-zoom").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-mock-zoom");
        const index = slides.findIndex((s) => String(s.getAttribute("data-id")) === String(id));
        openMockViewer(collectCarouselViewerItems(carousel), index >= 0 ? index : 0);
      });
    });
  });

  document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const viewKey = toggle.dataset.view;
      if (!toggle.checked) {
        syncPreviewHiddenInput(mockupSet, viewKey, "");
        syncMockupsUiFromDom(ctx);
        // Re-render so pick hint / pickable state clears for this view.
        if (ctx.mockupsData) {
          const body = document.getElementById("ce-body");
          if (body) {
            body.innerHTML = renderMockupsTabHtml(ctx, ctx.mockupsData);
            bindMockupsTab(ctx, body);
            updateMockSectionSubnav(ctx);
          }
        }
        notifyActiveTabDirty(ctx);
        return;
      }
      document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((other) => {
        if (other !== toggle) {
          other.checked = false;
          syncPreviewHiddenInput(mockupSet, other.dataset.view, "");
        }
      });
      const carousel = document.querySelector(
        `.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
      );
      const mockId = getActiveSlideId(carousel);
      syncPreviewHiddenInput(mockupSet, viewKey, mockId);
      syncMockupsUiFromDom(ctx);
      if (ctx.mockupsData) {
        const body = document.getElementById("ce-body");
        if (body) {
          body.innerHTML = renderMockupsTabHtml(ctx, ctx.mockupsData);
          bindMockupsTab(ctx, body);
          updateMockSectionSubnav(ctx);
        }
      }
      notifyActiveTabDirty(ctx);
    });
  });
}

export function syncPreviewCardSourceSwitches(ctx) {
  const ui = ensureMockupsUiState(ctx);
  const shop = document.getElementById("ce-mock-source-shop");
  const preview = document.getElementById("ce-mock-source-preview");
  const source = ui.preview_card_source === MOCKUP_SET_PREVIEW_IMAGES
    ? MOCKUP_SET_PREVIEW_IMAGES
    : MOCKUP_SET_SHOP_PREVIEW;
  if (shop) shop.checked = source === MOCKUP_SET_SHOP_PREVIEW;
  if (preview) preview.checked = source === MOCKUP_SET_PREVIEW_IMAGES;
}

export function updateMockSectionSubnav(ctx) {
  const activeId = SECTION_META[resolveActiveMockSection(ctx)].id;
  document.querySelectorAll("#ce-subnav-mock-sections .ce-mock-section-pill").forEach((pill) => {
    const on = pill.dataset.mockSection === activeId;
    pill.classList.toggle("active", on);
    pill.setAttribute("aria-selected", on ? "true" : "false");
  });
  syncPreviewCardSourceSwitches(ctx);
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

  const shop = document.getElementById("ce-mock-source-shop");
  const preview = document.getElementById("ce-mock-source-preview");
  const onSourceToggle = (which) => {
    const ui = ensureMockupsUiState(ctx);
    if (which === MOCKUP_SET_PREVIEW_IMAGES) {
      ui.preview_card_source = MOCKUP_SET_PREVIEW_IMAGES;
      if (shop) shop.checked = false;
      if (preview) preview.checked = true;
    } else {
      ui.preview_card_source = MOCKUP_SET_SHOP_PREVIEW;
      if (shop) shop.checked = true;
      if (preview) preview.checked = false;
    }
    notifyActiveTabDirty(ctx);
  };
  if (shop) {
    shop.onchange = () => {
      if (shop.checked) onSourceToggle(MOCKUP_SET_SHOP_PREVIEW);
      else {
        // Exactly one source must stay on.
        shop.checked = true;
      }
    };
  }
  if (preview) {
    preview.onchange = () => {
      if (preview.checked) onSourceToggle(MOCKUP_SET_PREVIEW_IMAGES);
      else {
        preview.checked = true;
      }
    };
  }
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
  ui.preview_card_source =
    String(data.product?.preview_card_source || "").toLowerCase() === MOCKUP_SET_PREVIEW_IMAGES
      ? MOCKUP_SET_PREVIEW_IMAGES
      : MOCKUP_SET_SHOP_PREVIEW;
  ui.preview_carousel_mode_shop =
    String(data.product?.preview_carousel_mode_shop || "").toLowerCase() === "manual" ? "manual" : "auto";
  ui.preview_carousel_mode_skill_tree =
    String(data.product?.preview_carousel_mode_skill_tree || "").toLowerCase() === "manual"
      ? "manual"
      : "auto";
  ui.previewAssignments = {};
  syncPreviewAssignmentsFromImages(ui, data.preview_images || []);
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

  const genBtn = root.querySelector("#ce-mock-generate-btn");
  if (genBtn && mockupSet === MOCKUP_SET_PREVIEW_IMAGES) {
    genBtn.onclick = () => {
      openPreviewImageGenerateModal(ctx, {
        onSaved: () => reloadMockupsPanel(ctx),
      });
    };
  }

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
  syncPreviewCardSourceSwitches(ctx);
  const shopMode = root?.querySelector?.("#ce-mock-carousel-mode-shop") || document.getElementById("ce-mock-carousel-mode-shop");
  const skillMode = root?.querySelector?.("#ce-mock-carousel-mode-skill") || document.getElementById("ce-mock-carousel-mode-skill");
  if (shopMode) {
    shopMode.onchange = () => {
      ensureMockupsUiState(ctx).preview_carousel_mode_shop = shopMode.value === "manual" ? "manual" : "auto";
      notifyActiveTabDirty(ctx);
    };
  }
  if (skillMode) {
    skillMode.onchange = () => {
      ensureMockupsUiState(ctx).preview_carousel_mode_skill_tree =
        skillMode.value === "manual" ? "manual" : "auto";
      notifyActiveTabDirty(ctx);
    };
  }
}

export async function saveMockupsTab(ctx) {
  syncMockupsUiFromDom(ctx);
  const ui = ensureMockupsUiState(ctx);
  const previewAssignments = Object.entries(ui.previewAssignments || {}).map(([id, flags]) => ({
    id: Number(id),
    use_for_shop: !!flags.use_for_shop,
    use_for_skill_tree: !!flags.use_for_skill_tree,
  }));
  await saveMockups(ctx.productKey, {
    print_provider_id: ctx.selectedPrintProviderId,
    print_area_edit_use_mocks: ui.print_area_edit_use_mocks,
    preview_mock_id: ui.preview_mock_id || undefined,
    shop_preview_mock_id: ui.shop_preview_mock_id || undefined,
    preview_card_source: ui.preview_card_source || MOCKUP_SET_SHOP_PREVIEW,
    preview_carousel_mode_shop: ui.preview_carousel_mode_shop || "auto",
    preview_carousel_mode_skill_tree: ui.preview_carousel_mode_skill_tree || "auto",
    preview_assignments: previewAssignments,
    auto_mirror: false,
  });
}
