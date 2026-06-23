import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { openMockViewer } from "/partner/shared/js/mock-viewer.js";
import { fetchMockupsBundle, saveMockups } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";

export const MOCKUP_SET_CLEAN = "clean";
export const MOCKUP_SET_SHOP_PREVIEW = "shop_preview";

const SECTION_META = {
  [MOCKUP_SET_CLEAN]: {
    id: "clean",
    title: "Clean Mockups",
    hint: "DB mockups for print area and publishing — sync via Templates → Clean Mockups. Enable one Preview Mock globally (Shopify alt text).",
    syncLabel: "Clean Mockups",
    emptyHint: "No clean mockup images yet. Sync on the Templates tab under Clean Mockups.",
    showPrintAreaToggle: true,
  },
  [MOCKUP_SET_SHOP_PREVIEW]: {
    id: "shop_preview",
    title: "Shop Preview Mockups",
    hint: "Wearing mocks for the shop — Create from Scratch and Shop Create preview cards. Sync via Templates → Shop Preview Mockups.",
    syncLabel: "Shop Preview Mockups",
    emptyHint: "No shop preview mockups yet. Set a Printify product ID on Templates → Shop Preview Mockups and sync.",
    showPrintAreaToggle: false,
  },
};

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

function renderCarousel(mockupSet, viewKey, slides, previewId) {
  const viewEsc = escapeHtml(viewKey);
  const isPreviewView = slides.some((s) => String(s.id) === String(previewId));
  const slideHtml = slides
    .map((img) => {
      const isPreview = String(img.id) === String(previewId);
      return `
        <button type="button" class="ce-mock-carousel__slide${isPreview ? " ce-mock-carousel__slide--active" : ""}" data-id="${escapeHtml(img.id)}" title="${escapeHtml(img.color_name || viewKey)} — click to enlarge" aria-label="View mockup ${escapeHtml(img.color_name || viewKey)}">
          <img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.color_name || viewKey)}" loading="lazy" />
          <span class="ce-mock-carousel__color">${escapeHtml(img.color_name || "Default")}</span>
        </button>`;
    })
    .join("");

  return `
    <article class="ce-mock-view" data-view-key="${viewEsc}">
      <header class="ce-mock-view__header">
        <div class="ce-mock-view__title-wrap">
          <h4 class="ce-mock-view__title">${escapeHtml(formatViewLabel(viewKey))}</h4>
          <span class="ce-mock-view__count">${slides.length} color${slides.length === 1 ? "" : "s"}</span>
        </div>
        <label class="ce-mock-preview-toggle">
          <span class="ce-mock-preview-toggle__label">Preview Mock</span>
          <input
            type="checkbox"
            class="ce-mock-preview-switch"
            data-mock-set="${escapeHtml(mockupSet)}"
            data-view="${viewEsc}"
            ${isPreviewView ? "checked" : ""}
          />
          <span class="ce-mock-preview-toggle__track" aria-hidden="true"></span>
        </label>
      </header>
      <div class="ce-mock-carousel" data-mock-set="${escapeHtml(mockupSet)}" data-view="${viewEsc}">
        <div class="ce-mock-carousel__viewport">
          <div class="ce-mock-carousel__track">${slideHtml}</div>
        </div>
      </div>
      <input type="hidden" class="ce-mock-preview-id" data-mock-set="${escapeHtml(mockupSet)}" data-view="${viewEsc}" value="${isPreviewView ? escapeHtml(String(previewId)) : ""}" />
    </article>`;
}

function renderMockupSetPanel(mockupSet, images, data) {
  const meta = SECTION_META[mockupSet];
  const previewRow = (images || []).find((img) => Number(img.is_default) === 1);
  const previewId = previewRow?.id || null;
  const grouped = groupImagesByView(images);
  const carousels = grouped.length
    ? grouped.map(([viewKey, slides]) => renderCarousel(mockupSet, viewKey, slides, previewId)).join("")
    : `<p class="ce-hint">${escapeHtml(meta.emptyHint)}</p>`;

  const printAreaField = meta.showPrintAreaToggle
    ? `<div class="field ce-mock-print-area-field">
        <label><input type="checkbox" id="ce-mock-use-mocks" ${data.product?.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label>
      </div>`
    : "";

  return `
    <details class="ce-mock-section" id="ce-mock-section-${escapeHtml(meta.id)}" data-mock-section="${escapeHtml(meta.id)}" open>
      <summary class="ce-mock-section__summary">
        <span class="ce-mock-section__chevron" aria-hidden="true">▾</span>
        <span class="ce-mock-section__title">${escapeHtml(meta.title)}</span>
      </summary>
      <div class="ce-mock-section__body" data-mock-set="${escapeHtml(mockupSet)}">
        <p class="ce-hint">${escapeHtml(meta.hint)}</p>
        ${printAreaField}
        <div class="ce-mock-views">${carousels}</div>
      </div>
    </details>`;
}

export async function loadMockupsTab(ctx) {
  const data = await fetchMockupsBundle(ctx.productKey, ctx.selectedPrintProviderId);
  ctx.mockupsData = data;

  return `
    <div class="ce-tab-panel ce-mock-panel">
      ${renderMockupSetPanel(MOCKUP_SET_CLEAN, data.images || [], data)}
      ${renderMockupSetPanel(MOCKUP_SET_SHOP_PREVIEW, data.shop_preview_images || [], data)}
    </div>`;
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

export function snapshotMockupsTab() {
  return {
    print_area_edit_use_mocks: !!document.getElementById("ce-mock-use-mocks")?.checked,
    preview_mock_id: readPreviewMockIdForSet(MOCKUP_SET_CLEAN),
    shop_preview_mock_id: readPreviewMockIdForSet(MOCKUP_SET_SHOP_PREVIEW),
  };
}

function bindMockupSetCarousels(ctx, mockupSet) {
  document.querySelectorAll(`.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((carousel) => {
    const viewKey = carousel.dataset.view;
    const slides = [...carousel.querySelectorAll(".ce-mock-carousel__slide")];

    slides.forEach((slide, index) => {
      slide.addEventListener("click", () => {
        setActiveSlide(carousel, slide);
        const toggle = document.querySelector(
          `.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
        );
        if (toggle?.checked) {
          syncPreviewHiddenInput(mockupSet, viewKey, slide.getAttribute("data-id") || "");
        }
        openMockViewer(collectCarouselViewerItems(carousel), index);
      });
    });
  });

  document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const viewKey = toggle.dataset.view;
      if (!toggle.checked) {
        syncPreviewHiddenInput(mockupSet, viewKey, "");
        if (ctx) notifyActiveTabDirty(ctx);
        return;
      }
      document.querySelectorAll(`.ce-mock-preview-switch[data-mock-set="${CSS.escape(mockupSet)}"]`).forEach((other) => {
        if (other !== toggle) other.checked = false;
      });
      const carousel = document.querySelector(
        `.ce-mock-carousel[data-mock-set="${CSS.escape(mockupSet)}"][data-view="${CSS.escape(viewKey)}"]`
      );
      syncPreviewHiddenInput(mockupSet, viewKey, getActiveSlideId(carousel));
      if (ctx) notifyActiveTabDirty(ctx);
    });
  });
}

export function bindMockSectionSubnav() {
  const stack = document.getElementById("ce-subnav-stack");
  const pills = document.querySelectorAll("#ce-subnav-mock-sections .ce-mock-section-pill");
  if (!pills.length) return;

  const syncPillState = () => {
    pills.forEach((pill) => {
      const sectionId = pill.dataset.mockSection;
      const details = document.getElementById(`ce-mock-section-${sectionId}`);
      const open = details?.open !== false;
      pill.classList.toggle("active", open);
      pill.setAttribute("aria-expanded", open ? "true" : "false");
    });
  };

  pills.forEach((pill) => {
    pill.onclick = () => {
      const sectionId = pill.dataset.mockSection;
      const details = document.getElementById(`ce-mock-section-${sectionId}`);
      if (!details) return;
      details.open = !details.open;
      syncPillState();
    };
  });

  document.querySelectorAll(".ce-mock-section").forEach((details) => {
    details.addEventListener("toggle", syncPillState);
  });

  syncPillState();
  stack?.classList.toggle("ce-subnav-stack--has-mock-sections", true);
}

export function bindMockupsTab(ctx, root) {
  bindTabDirtyInputs(root || document, ctx);
  bindMockupSetCarousels(ctx, MOCKUP_SET_CLEAN);
  bindMockupSetCarousels(ctx, MOCKUP_SET_SHOP_PREVIEW);
  bindMockSectionSubnav();
}

export async function saveMockupsTab(ctx) {
  const snap = snapshotMockupsTab();
  await saveMockups(ctx.productKey, {
    print_provider_id: ctx.selectedPrintProviderId,
    print_area_edit_use_mocks: snap.print_area_edit_use_mocks,
    preview_mock_id: snap.preview_mock_id || undefined,
    shop_preview_mock_id: snap.shop_preview_mock_id || undefined,
    auto_mirror: false,
  });
}
