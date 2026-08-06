/**
 * Shared Design Studio product card compose + channel carousels (Admin Creations).
 * Used by Design Detail Products tab and bulk Publish modal.
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

const DEFAULT_PLACEMENT = { x: 0.5, y: 0.5, scale: 0.95, rotate: 0, flipX: false, flipY: false };

function mockCompositing() {
  return window.CreatorMockCompositing || null;
}

export function parseZoneFrac(f) {
  const MC = mockCompositing();
  if (MC) return MC.parseZoneFrac(f);
  return { l: 0.28, t: 0.22, w: 0.44, h: 0.48 };
}

export function normalizePlacement(raw) {
  const MC = mockCompositing();
  if (MC?.normalizeOpenSeedPlacement) return MC.normalizeOpenSeedPlacement(raw || {});
  return { ...DEFAULT_PLACEMENT, ...(raw || {}) };
}

export function layoutStack(stackEl, attempt = 0) {
  if (!stackEl) return;
  const frame = stackEl.querySelector(".cr-dd-compose__frame");
  const stage = stackEl.querySelector(".cr-dd-compose__stage");
  const mock = stackEl.querySelector(".cr-dd-compose__mock");
  const zone = stackEl.querySelector(".cr-dd-compose__zone");
  const design = stackEl.querySelector(".cr-dd-compose__design");
  if (!frame || !stage || !mock) return;
  if (!mock.complete || !mock.naturalWidth) {
    if (attempt < 48) setTimeout(() => layoutStack(stackEl, attempt + 1), attempt < 12 ? 16 : 50);
    return;
  }
  const MC = mockCompositing();
  if (MC) MC.fitMockStage(stage, mock, frame);
  else {
    const nw = mock.naturalWidth;
    const nh = mock.naturalHeight;
    const boxW = Math.max(1, frame.clientWidth);
    const boxH = Math.max(1, frame.clientHeight);
    const fit = Math.min(boxW / nw, boxH / nh);
    stage.style.width = `${Math.max(1, nw * fit)}px`;
    stage.style.height = `${Math.max(1, nh * fit)}px`;
    mock.style.width = "100%";
    mock.style.height = "100%";
    mock.style.objectFit = "fill";
  }
  if (!zone || !design) return;
  if (!design.complete || !design.naturalWidth) {
    if (attempt < 48) setTimeout(() => layoutStack(stackEl, attempt + 1), attempt < 12 ? 16 : 50);
    return;
  }
  let placement = DEFAULT_PLACEMENT;
  try {
    placement = normalizePlacement(JSON.parse(stackEl.getAttribute("data-card-placement") || "{}"));
  } catch (_) {}
  if (MC) {
    MC.applyDesignTransformInZone(design, zone, placement, { uiScaleMax: 4, minDesignWidth: 8 });
  } else {
    design.classList.add("is-laid-out");
  }
}

export function buildComposeStack(slide, designUrl) {
  const mockUrl = String(slide?.mock_url || "").trim();
  if (!mockUrl || !designUrl) return null;
  const z = parseZoneFrac(slide?.print_area_frac);
  const placement = normalizePlacement(slide?.placement);
  const stack = document.createElement("div");
  stack.className = "cr-dd-compose__slide is-active";
  stack.setAttribute("data-card-placement", JSON.stringify(placement));
  stack.innerHTML = `
    <div class="cr-dd-compose__frame">
      <div class="cr-dd-compose__stage">
        <img class="cr-dd-compose__mock" src="${escapeHtml(mockUrl)}" alt="" decoding="async" draggable="false" />
        <span class="cr-dd-compose__zone" style="left:${z.l * 100}%;top:${z.t * 100}%;width:${z.w * 100}%;height:${z.h * 100}%;">
          <img class="cr-dd-compose__design" src="${escapeHtml(designUrl)}" alt="" decoding="async" draggable="false" />
        </span>
      </div>
    </div>`;
  const mock = stack.querySelector(".cr-dd-compose__mock");
  const design = stack.querySelector(".cr-dd-compose__design");
  const after = () => layoutStack(stack);
  [mock, design].forEach((img) => {
    if (img.complete && img.naturalWidth) return;
    img.addEventListener("load", after, { once: true });
    img.addEventListener("error", after, { once: true });
  });
  requestAnimationFrame(after);
  setTimeout(after, 80);
  setTimeout(after, 320);
  return stack;
}

export function synthesizePreviewFromMocks(urls) {
  const slides = (urls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((mock_url) => ({
      mock_url,
      print_area_frac: null,
      placement: { ...DEFAULT_PLACEMENT },
    }));
  return slides.length ? { slides } : null;
}

const COMPOSE_AUTO_ROTATE_MS = 2500;

export function clearComposeAutoRotate(mediaEl) {
  if (!mediaEl) return;
  if (mediaEl.__crDdComposeRotate) {
    clearInterval(mediaEl.__crDdComposeRotate);
    mediaEl.__crDdComposeRotate = null;
  }
}

/**
 * Studio compose card media — Creator Products Preview parity:
 * real catalog mocks + design overlay, floating variant arrows, optional auto-rotate.
 * @param {HTMLElement} mediaEl
 * @param {{ slides?: object[] }|null} previewConfig
 * @param {string} designUrl
 * @param {{ autoRotate?: boolean }} [opts]
 */
export function mountComposedMedia(mediaEl, previewConfig, designUrl, opts = {}) {
  if (!mediaEl) return false;
  clearComposeAutoRotate(mediaEl);
  mediaEl.innerHTML = "";
  mediaEl.classList.add("cr-dd-compose");
  mediaEl.classList.remove("cr-dd-compose--carousel");
  const slides = (previewConfig?.slides || []).filter((s) => String(s?.mock_url || "").trim());
  if (!slides.length || !designUrl) {
    mediaEl.innerHTML = `<span class="cr-dd-prod__empty">No mock</span>`;
    return false;
  }

  if (slides.length === 1) {
    const stack = buildComposeStack(slides[0], designUrl);
    if (!stack) {
      mediaEl.innerHTML = `<span class="cr-dd-prod__empty">No mock</span>`;
      return false;
    }
    mediaEl.appendChild(stack);
    return true;
  }

  // Multi-color / multi-variant: floating carousel (Creator Products Preview Modal parity).
  mediaEl.classList.add("cr-dd-compose--carousel");
  const host = document.createElement("div");
  host.className = "cr-dd-compose__host";
  host.dataset.slideIndex = "0";

  const stackA = buildComposeStack(slides[0], designUrl);
  if (!stackA) {
    mediaEl.innerHTML = `<span class="cr-dd-prod__empty">No mock</span>`;
    return false;
  }
  stackA.classList.add("is-active");
  host.appendChild(stackA);
  const stackB = buildComposeStack(slides[1] || slides[0], designUrl);
  if (stackB) {
    stackB.classList.remove("is-active");
    host.appendChild(stackB);
  }
  mediaEl.appendChild(host);

  const navPrev = document.createElement("button");
  navPrev.type = "button";
  navPrev.className = "cr-dd-compose__nav cr-dd-compose__nav--prev";
  navPrev.setAttribute("aria-label", "Previous mock variant");
  navPrev.innerHTML = "‹";
  const navNext = document.createElement("button");
  navNext.type = "button";
  navNext.className = "cr-dd-compose__nav cr-dd-compose__nav--next";
  navNext.setAttribute("aria-label", "Next mock variant");
  navNext.innerHTML = "›";

  let advancing = false;
  function advanceSlide(delta) {
    if (advancing) return;
    advancing = true;
    const idx = parseInt(host.dataset.slideIndex || "0", 10);
    const nextIdx = (idx + delta + slides.length * 100) % slides.length;
    host.dataset.slideIndex = String(nextIdx);
    const active = host.querySelector(".cr-dd-compose__slide.is-active");
    let inactive = host.querySelector(".cr-dd-compose__slide:not(.is-active)");
    const target = slides[nextIdx];
    const targetUrl = String(target?.mock_url || "").trim();
    if (!targetUrl) {
      advancing = false;
      return;
    }
    if (!inactive) {
      inactive = buildComposeStack(target, designUrl);
      if (inactive) {
        inactive.classList.remove("is-active");
        host.appendChild(inactive);
      }
    } else {
      const existing = inactive.querySelector(".cr-dd-compose__mock");
      if (!existing || existing.src !== targetUrl) {
        inactive.remove();
        inactive = buildComposeStack(target, designUrl);
        if (inactive) {
          inactive.classList.remove("is-active");
          host.appendChild(inactive);
        }
      } else {
        try {
          inactive.setAttribute(
            "data-card-placement",
            JSON.stringify(normalizePlacement(target?.placement))
          );
        } catch (_) {}
        layoutStack(inactive);
      }
    }
    if (active && inactive) {
      inactive.classList.add("is-active");
      active.classList.remove("is-active");
      if (active !== inactive) active.remove();
    }
    requestAnimationFrame(() => {
      if (inactive) layoutStack(inactive);
      advancing = false;
    });
  }

  navPrev.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    advanceSlide(-1);
  });
  navNext.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    advanceSlide(1);
  });
  mediaEl.appendChild(navPrev);
  mediaEl.appendChild(navNext);

  const autoRotate = opts.autoRotate !== false;
  if (autoRotate) {
    mediaEl.__crDdComposeRotate = setInterval(() => {
      if (!mediaEl.isConnected) {
        clearComposeAutoRotate(mediaEl);
        return;
      }
      try {
        navNext.click();
      } catch (_) {}
    }, COMPOSE_AUTO_ROTATE_MS);
  }
  return true;
}

/** Prefer first studio slide mock, then catalog mock URLs (no design overlay). */
export function cleanMockUrlFromProduct(product) {
  const slide0 = product?.studio_card_preview?.slides?.[0]?.mock_url;
  const fromSlide = String(slide0 || "").trim();
  if (fromSlide) return fromSlide;
  if (Array.isArray(product?.mock_urls)) {
    for (const u of product.mock_urls) {
      const s = String(u || "").trim();
      if (s) return s;
    }
  }
  return String(product?.mock_url || product?.preview_url || "").trim();
}

/** Clean product mock only (no design compositing) — for global publish picker. */
export function mountCleanProductMedia(mediaEl, product) {
  if (!mediaEl) return;
  mediaEl.classList.remove("cr-dd-compose");
  const url = cleanMockUrlFromProduct(product);
  if (url) {
    mediaEl.innerHTML = `<img class="cr-dd-prod__mock" src="${escapeHtml(url)}" alt="" decoding="async" />`;
  } else {
    mediaEl.innerHTML = `<span class="cr-dd-prod__empty">No mock</span>`;
  }
}

export function mountOfflineProductMedia(mediaEl, product, designUrl) {
  if (!mediaEl) return;
  const previewConfig =
    product.studio_card_preview ||
    synthesizePreviewFromMocks(
      product.mock_urls || (product.mock_url ? [product.mock_url] : [])
    );
  if (mountComposedMedia(mediaEl, previewConfig, designUrl)) return;

  const fallbackUrl = String(
    product.mock_url ||
      (Array.isArray(product.mock_urls) && product.mock_urls[0]) ||
      product.preview_url ||
      designUrl ||
      ""
  ).trim();
  mediaEl.classList.remove("cr-dd-compose");
  if (fallbackUrl) {
    mediaEl.innerHTML = `<img class="cr-dd-prod__mock" src="${escapeHtml(fallbackUrl)}" alt="" decoding="async" />`;
  } else {
    mediaEl.innerHTML = `<span class="cr-dd-prod__empty">No mock</span>`;
  }
}

export function syncProdCarouselArrows(carousel) {
  if (!carousel) return;
  const track = carousel.querySelector(".cr-dd-prod-carousel__track");
  const prev = carousel.querySelector(".cr-dd-prod-carousel__arrow--prev");
  const next = carousel.querySelector(".cr-dd-prod-carousel__arrow--next");
  if (!track) return;
  const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth - 1);
  const hasOverflow = maxScroll > 2;
  carousel.classList.toggle("has-overflow", hasOverflow);
  if (prev) {
    prev.hidden = !hasOverflow;
    prev.disabled = track.scrollLeft <= 2;
  }
  if (next) {
    next.hidden = !hasOverflow;
    next.disabled = track.scrollLeft >= maxScroll;
  }
}

export function bindProdCarousels(root) {
  if (!root) return;
  root.querySelectorAll("[data-cr-dd-prod-carousel]").forEach((carousel) => {
    if (carousel.__crDdCarouselBound) {
      syncProdCarouselArrows(carousel);
      return;
    }
    carousel.__crDdCarouselBound = true;
    const track = carousel.querySelector(".cr-dd-prod-carousel__track");
    const prev = carousel.querySelector(".cr-dd-prod-carousel__arrow--prev");
    const next = carousel.querySelector(".cr-dd-prod-carousel__arrow--next");
    if (!track) return;
    const step = () => Math.max(160, Math.floor(track.clientWidth * 0.85));
    prev?.addEventListener("click", () => {
      track.scrollBy({ left: -step(), behavior: "smooth" });
    });
    next?.addEventListener("click", () => {
      track.scrollBy({ left: step(), behavior: "smooth" });
    });
    track.addEventListener("scroll", () => syncProdCarouselArrows(carousel), { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => syncProdCarouselArrows(carousel));
      ro.observe(track);
      carousel.__crDdCarouselRo = ro;
    }
    requestAnimationFrame(() => syncProdCarouselArrows(carousel));
    setTimeout(() => syncProdCarouselArrows(carousel), 120);
    setTimeout(() => syncProdCarouselArrows(carousel), 400);
  });
}

/** Build horizontal carousel HTML for a list of product card HTML strings. */
export function productCarouselHtml(cardsHtml) {
  return `<div class="cr-dd-prod-carousel" data-cr-dd-prod-carousel>
    <button type="button" class="cr-dd-prod-carousel__arrow cr-dd-prod-carousel__arrow--prev" aria-label="Previous products" hidden>‹</button>
    <div class="cr-dd-prod-carousel__track" data-cr-dd-prod-track>${cardsHtml}</div>
    <button type="button" class="cr-dd-prod-carousel__arrow cr-dd-prod-carousel__arrow--next" aria-label="Next products" hidden>›</button>
  </div>`;
}
