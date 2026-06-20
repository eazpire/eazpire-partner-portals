import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchMockupsBundle, saveMockups } from "../api.js";

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
    .map((img, idx) => {
      const isPreview = String(img.id) === String(previewId);
      return `
        <div class="ce-mock-carousel__slide" data-slide-index="${idx}" data-id="${escapeHtml(img.id)}">
          <img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.color_name || viewKey)}" loading="lazy" />
          <span class="ce-mock-carousel__color">${escapeHtml(img.color_name || "Default")}</span>
        </div>`;
    })
    .join("");

  const single = slides.length <= 1;

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
      <div class="ce-mock-carousel ${single ? "ce-mock-carousel--single" : ""}" data-view="${viewEsc}">
        ${single ? "" : '<button type="button" class="ce-mock-carousel__arrow ce-mock-carousel__arrow--prev" aria-label="Previous color">‹</button>'}
        <div class="ce-mock-carousel__viewport">
          <div class="ce-mock-carousel__track">${slideHtml}</div>
        </div>
        ${single ? "" : '<button type="button" class="ce-mock-carousel__arrow ce-mock-carousel__arrow--next" aria-label="Next color">›</button>'}
        <span class="ce-mock-carousel__indicator">${slides.length ? "1" : "0"} / ${slides.length}</span>
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
  const track = carousel?.querySelector(".ce-mock-carousel__track");
  const idx = Number(carousel?.dataset.activeIndex || 0);
  const slide = track?.children[idx];
  return slide?.getAttribute("data-id") || "";
}

function setCarouselIndex(carousel, nextIndex) {
  const slides = carousel?.querySelectorAll(".ce-mock-carousel__slide") || [];
  const count = slides.length;
  if (!count) return;
  const idx = ((nextIndex % count) + count) % count;
  carousel.dataset.activeIndex = String(idx);
  const track = carousel.querySelector(".ce-mock-carousel__track");
  if (track) track.style.transform = `translateX(-${idx * 100}%)`;
  const indicator = carousel.querySelector(".ce-mock-carousel__indicator");
  if (indicator) indicator.textContent = `${idx + 1} / ${count}`;
}

function syncPreviewHiddenInput(viewKey, mockId) {
  const hidden = document.querySelector(`.ce-mock-preview-id[data-view="${CSS.escape(viewKey)}"]`);
  if (hidden) hidden.value = mockId || "";
}

export function bindMockupsTab() {
  document.querySelectorAll(".ce-mock-carousel").forEach((carousel) => {
    carousel.dataset.activeIndex = "0";
    setCarouselIndex(carousel, 0);

    const updatePreviewIfActive = () => {
      const viewKey = carousel.dataset.view;
      const toggle = document.querySelector(`.ce-mock-preview-switch[data-view="${CSS.escape(viewKey)}"]`);
      if (toggle?.checked) {
        syncPreviewHiddenInput(viewKey, getActiveSlideId(carousel));
      }
    };

    carousel.querySelector(".ce-mock-carousel__arrow--prev")?.addEventListener("click", () => {
      setCarouselIndex(carousel, Number(carousel.dataset.activeIndex || 0) - 1);
      updatePreviewIfActive();
    });
    carousel.querySelector(".ce-mock-carousel__arrow--next")?.addEventListener("click", () => {
      setCarouselIndex(carousel, Number(carousel.dataset.activeIndex || 0) + 1);
      updatePreviewIfActive();
    });
  });

  document.querySelectorAll(".ce-mock-preview-switch").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      if (!toggle.checked) {
        syncPreviewHiddenInput(toggle.dataset.view, "");
        return;
      }
      document.querySelectorAll(".ce-mock-preview-switch").forEach((other) => {
        if (other !== toggle) other.checked = false;
      });
      const viewKey = toggle.dataset.view;
      const carousel = document.querySelector(`.ce-mock-carousel[data-view="${CSS.escape(viewKey)}"]`);
      syncPreviewHiddenInput(viewKey, getActiveSlideId(carousel));
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
