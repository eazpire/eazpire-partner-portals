import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { openMockViewer } from "/partner/shared/js/mock-viewer.js";
import { fetchMockupsBundle, saveMockups } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";

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

function renderCarousel(viewKey, slides, previewId) {
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
            data-view="${viewEsc}"
            ${isPreviewView ? "checked" : ""}
          />
          <span class="ce-mock-preview-toggle__track" aria-hidden="true"></span>
        </label>
      </header>
      <div class="ce-mock-carousel" data-view="${viewEsc}">
        <div class="ce-mock-carousel__viewport">
          <div class="ce-mock-carousel__track">${slideHtml}</div>
        </div>
      </div>
      <input type="hidden" class="ce-mock-preview-id" data-view="${viewEsc}" value="${isPreviewView ? escapeHtml(String(previewId)) : ""}" />
    </article>`;
}

export async function loadMockupsTab(ctx) {
  const data = await fetchMockupsBundle(ctx.productKey, ctx.selectedPrintProviderId);
  ctx.mockupsData = data;
  const images = data.images || [];
  const previewRow = images.find((img) => Number(img.is_default) === 1);
  const previewId = previewRow?.id || null;
  const grouped = groupImagesByView(images);

  const carousels = grouped.length
    ? grouped.map(([viewKey, slides]) => renderCarousel(viewKey, slides, previewId)).join("")
    : `<p class="ce-hint">No mockup images in the database yet. Sync mockups on the Templates tab.</p>`;

  return `
    <div class="ce-tab-panel ce-mock-panel">
      <h3 class="ce-section-title">Mockup images</h3>
      <p class="ce-hint">DB mockups only — use Templates → Mockups → Sync to import from Printify. Enable one Preview Mock globally (used for Shopify alt text).</p>
      <div class="field">
        <label><input type="checkbox" id="ce-mock-use-mocks" ${data.product?.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label>
      </div>
      <div class="ce-mock-views">${carousels}</div>
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

function syncPreviewHiddenInput(viewKey, mockId) {
  const hidden = document.querySelector(`.ce-mock-preview-id[data-view="${CSS.escape(viewKey)}"]`);
  if (hidden) hidden.value = mockId || "";
}

function collectCarouselViewerItems(carousel) {
  return [...carousel.querySelectorAll(".ce-mock-carousel__slide")].map((slide) => {
    const img = slide.querySelector("img");
    const label = slide.querySelector(".ce-mock-carousel__color")?.textContent?.trim() || img?.alt || "";
    return img?.src ? { url: img.src, label } : null;
  }).filter(Boolean);
}

export function snapshotMockupsTab() {
  let previewMockId = null;
  document.querySelectorAll(".ce-mock-preview-switch:checked").forEach((toggle) => {
    const viewKey = toggle.dataset.view;
    const hidden = document.querySelector(`.ce-mock-preview-id[data-view="${CSS.escape(viewKey)}"]`);
    const carousel = document.querySelector(`.ce-mock-carousel[data-view="${CSS.escape(viewKey)}"]`);
    previewMockId = hidden?.value?.trim() || getActiveSlideId(carousel) || null;
  });
  return {
    print_area_edit_use_mocks: !!document.getElementById("ce-mock-use-mocks")?.checked,
    preview_mock_id: previewMockId,
  };
}

export function bindMockupsTab(ctx, root) {
  bindTabDirtyInputs(root || document, ctx);

  document.querySelectorAll(".ce-mock-carousel").forEach((carousel) => {
    const viewKey = carousel.dataset.view;
    const slides = [...carousel.querySelectorAll(".ce-mock-carousel__slide")];

    slides.forEach((slide, index) => {
      slide.addEventListener("click", () => {
        setActiveSlide(carousel, slide);
        const toggle = document.querySelector(`.ce-mock-preview-switch[data-view="${CSS.escape(viewKey)}"]`);
        if (toggle?.checked) {
          syncPreviewHiddenInput(viewKey, slide.getAttribute("data-id") || "");
        }
        openMockViewer(collectCarouselViewerItems(carousel), index);
      });
    });
  });

  document.querySelectorAll(".ce-mock-preview-switch").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      if (!toggle.checked) {
        syncPreviewHiddenInput(toggle.dataset.view, "");
        if (ctx) notifyActiveTabDirty(ctx);
        return;
      }
      document.querySelectorAll(".ce-mock-preview-switch").forEach((other) => {
        if (other !== toggle) other.checked = false;
      });
      const viewKey = toggle.dataset.view;
      const carousel = document.querySelector(`.ce-mock-carousel[data-view="${CSS.escape(viewKey)}"]`);
      syncPreviewHiddenInput(viewKey, getActiveSlideId(carousel));
      if (ctx) notifyActiveTabDirty(ctx);
    });
  });
}

export async function saveMockupsTab(ctx) {
  let previewMockId = null;
  document.querySelectorAll(".ce-mock-preview-switch:checked").forEach((toggle) => {
    const viewKey = toggle.dataset.view;
    const hidden = document.querySelector(`.ce-mock-preview-id[data-view="${CSS.escape(viewKey)}"]`);
    const carousel = document.querySelector(`.ce-mock-carousel[data-view="${CSS.escape(viewKey)}"]`);
    previewMockId = hidden?.value?.trim() || getActiveSlideId(carousel) || null;
  });

  await saveMockups(ctx.productKey, {
    print_provider_id: ctx.selectedPrintProviderId,
    print_area_edit_use_mocks: document.getElementById("ce-mock-use-mocks")?.checked,
    preview_mock_id: previewMockId || undefined,
    auto_mirror: false,
  });
}
