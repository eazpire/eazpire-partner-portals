import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { PH_TYPES } from "../provider-print-technical.js";
import {
  createTestPrintifyProduct,
  deleteTestPrintifyProducts,
  fetchTestPrintifyProducts,
  fetchTestPrintifyProductPreview,
} from "../api.js";
import {
  printAreaVersionSlug,
  resolvePrintAreaTemplateId,
  resolvePrintAreaVersion,
} from "./helpers.js";

const previewCache = new Map();

function capitalizeMode(m) {
  const s = String(m || "calculated").toLowerCase();
  if (s === "template") return "Template";
  if (s === "admin") return "Admin";
  return "Calculated";
}

function buildTestContext(ctx, st, data = ctx?.printAreaData) {
  const version = resolvePrintAreaVersion(ctx, data);
  const pid = Number(ctx.selectedPrintProviderId);
  const profile = (ctx.bundle?.publish_profiles || []).find((p) => Number(p.print_provider_id) === pid);
  const regions = ctx.bundle?.product?.regions;
  const regionCode = Array.isArray(regions) && regions.length ? regions[0] : "EU";
  return {
    product_key: ctx.productKey,
    print_provider_id: pid,
    print_area_template_id: resolvePrintAreaTemplateId(ctx, data),
    version_label: printAreaVersionSlug(version),
    design_type: st.activeDesignType || "classic",
    publish_profile_id: profile?.id ? Number(profile.id) : undefined,
    region_code: regionCode,
    placement_modes: { ...(st.publishLogicByPh || {}) },
    random_design: true,
  };
}

function placementBadgesHtml(placementModes) {
  if (!placementModes || typeof placementModes !== "object") return "";
  return PH_TYPES.map((ph) => {
    const mode = placementModes[ph.key];
    if (!mode) return "";
    return `<span class="ce-pa-tp-badge">${escapeHtml(ph.label)}: ${escapeHtml(capitalizeMode(mode))}</span>`;
  })
    .filter(Boolean)
    .join("");
}

function ensureListModal() {
  let el = document.getElementById("ce-pa-tp-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-pa-tp-modal";
  el.className = "ce-pa-tp-modal";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="ce-pa-tp-modal__backdrop" data-ce-pa-tp-close></div>
    <div class="ce-pa-tp-modal__dialog" role="dialog" aria-modal="true">
      <header class="ce-pa-tp-modal__header">
        <h2 class="ce-pa-tp-modal__title">Test Products</h2>
        <button type="button" class="btn btn-ghost btn-xs ce-pa-tp-modal__close" data-ce-pa-tp-close aria-label="Close">×</button>
      </header>
      <div class="ce-pa-tp-modal__body">
        <p class="ce-hint ce-pa-tp-modal__hint" data-ce-pa-tp-hint></p>
        <div class="ce-pa-tp-grid" data-ce-pa-tp-grid></div>
        <p class="ce-pa-tp-empty" data-ce-pa-tp-empty hidden>No test products yet.</p>
        <p class="ce-pa-tp-err" data-ce-pa-tp-err hidden></p>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-pa-tp-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeListModal());
  });
  return el;
}

function ensureViewerModal() {
  let el = document.getElementById("ce-pa-tp-viewer");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-pa-tp-viewer";
  el.className = "ce-pa-tp-viewer";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="ce-pa-tp-viewer__backdrop" data-ce-pa-tp-viewer-close></div>
    <div class="ce-pa-tp-viewer__dialog" role="dialog" aria-modal="true">
      <header class="ce-pa-tp-viewer__header">
        <h2 class="ce-pa-tp-viewer__title" data-ce-pa-tp-viewer-title>Preview</h2>
        <button type="button" class="btn btn-ghost btn-xs" data-ce-pa-tp-viewer-close aria-label="Close">×</button>
      </header>
      <div class="ce-pa-tp-viewer__body">
        <div class="ce-pa-tp-viewer__thumbs" data-ce-pa-tp-viewer-thumbs></div>
        <div class="ce-pa-tp-viewer__main">
          <button type="button" class="ce-pa-tp-viewer__nav ce-pa-tp-viewer__nav--prev" data-ce-pa-tp-variant-prev aria-label="Previous variant">‹</button>
          <div class="ce-pa-tp-viewer__stage">
            <img class="ce-pa-tp-viewer__img" data-ce-pa-tp-viewer-img alt="" />
            <p class="ce-pa-tp-viewer__view-label" data-ce-pa-tp-viewer-view-label></p>
            <p class="ce-pa-tp-viewer__variant-label" data-ce-pa-tp-viewer-variant-label></p>
          </div>
          <button type="button" class="ce-pa-tp-viewer__nav ce-pa-tp-viewer__nav--next" data-ce-pa-tp-variant-next aria-label="Next variant">›</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-pa-tp-viewer-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeViewer());
  });
  el.querySelector("[data-ce-pa-tp-variant-prev]")?.addEventListener("click", () => stepViewerVariant(-1));
  el.querySelector("[data-ce-pa-tp-variant-next]")?.addEventListener("click", () => stepViewerVariant(1));
  return el;
}

let viewerState = null;

function closeViewer() {
  viewerState = null;
  const el = document.getElementById("ce-pa-tp-viewer");
  if (el) {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
  }
  document.removeEventListener("keydown", onViewerKeydown);
}

function onViewerKeydown(e) {
  if (!viewerState) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") stepViewerVariant(-1);
  if (e.key === "ArrowRight") stepViewerVariant(1);
}

function currentViews() {
  if (!viewerState?.data) return [];
  const colorKey = viewerState.colorKey;
  const byColor = viewerState.data.views_by_color || {};
  return byColor[colorKey] || byColor.default || [];
}

function renderViewer() {
  const el = document.getElementById("ce-pa-tp-viewer");
  if (!el || !viewerState?.data) return;
  const colors = viewerState.data.colors || [];
  if (!colors.length) colors.push({ color_key: "default", label: "Default" });

  let colorIdx = colors.findIndex((c) => c.color_key === viewerState.colorKey);
  if (colorIdx < 0) colorIdx = 0;
  viewerState.colorKey = colors[colorIdx].color_key;

  const views = currentViews();
  let viewIdx = viewerState.viewIndex;
  if (viewIdx < 0) viewIdx = 0;
  if (viewIdx >= views.length) viewIdx = Math.max(0, views.length - 1);
  viewerState.viewIndex = viewIdx;

  const thumbs = el.querySelector("[data-ce-pa-tp-viewer-thumbs]");
  const img = el.querySelector("[data-ce-pa-tp-viewer-img]");
  const viewLabel = el.querySelector("[data-ce-pa-tp-viewer-view-label]");
  const variantLabel = el.querySelector("[data-ce-pa-tp-viewer-variant-label]");
  const title = el.querySelector("[data-ce-pa-tp-viewer-title]");

  title.textContent = viewerState.data.title || viewerState.rowTitle || "Preview";
  variantLabel.textContent = colors[colorIdx]?.label || colors[colorIdx]?.color_key || "";

  thumbs.innerHTML = views
    .map(
      (v, i) => `
    <button type="button" class="ce-pa-tp-viewer__thumb ${i === viewIdx ? "is-active" : ""}" data-view-idx="${i}">
      <img src="${escapeHtml(v.url)}" alt="${escapeHtml(v.label || v.view_key || "")}" loading="lazy" />
      <span>${escapeHtml(v.label || v.view_key || "")}</span>
    </button>`
    )
    .join("");

  thumbs.querySelectorAll("[data-view-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewerState.viewIndex = Number(btn.dataset.viewIdx) || 0;
      renderViewer();
    });
  });

  const view = views[viewIdx];
  if (view?.url) {
    img.src = view.url;
    img.hidden = false;
    viewLabel.textContent = view.label || view.view_key || "";
    viewLabel.hidden = false;
  } else {
    img.hidden = true;
    viewLabel.textContent = "No mockup image";
    viewLabel.hidden = false;
  }

  const prev = el.querySelector("[data-ce-pa-tp-variant-prev]");
  const next = el.querySelector("[data-ce-pa-tp-variant-next]");
  if (prev) prev.disabled = colors.length < 2;
  if (next) next.disabled = colors.length < 2;
}

function stepViewerVariant(delta) {
  if (!viewerState?.data) return;
  const colors = viewerState.data.colors || [];
  if (colors.length < 2) return;
  let idx = colors.findIndex((c) => c.color_key === viewerState.colorKey);
  if (idx < 0) idx = 0;
  idx = (idx + delta + colors.length) % colors.length;
  viewerState.colorKey = colors[idx].color_key;
  viewerState.viewIndex = 0;
  renderViewer();
}

async function openViewer(row) {
  const el = ensureViewerModal();
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  document.addEventListener("keydown", onViewerKeydown);

  const cacheKey = String(row.id);
  let data = previewCache.get(cacheKey);
  if (!data) {
    const res = await fetchTestPrintifyProductPreview(row.id);
    if (!res?.ok) {
      viewerState = null;
      alert(res?.message || res?.error || res?.detail || "Preview failed");
      closeViewer();
      return;
    }
    data = res;
    previewCache.set(cacheKey, data);
  }

  viewerState = {
    rowId: row.id,
    rowTitle: row.printify?.title || row.printify_title,
    data,
    colorKey: (data.colors && data.colors[0] && data.colors[0].color_key) || "default",
    viewIndex: 0,
  };
  renderViewer();
}

function closeListModal() {
  const el = document.getElementById("ce-pa-tp-modal");
  if (el) {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
  }
}

async function loadTestProductsGrid(ctx) {
  const el = ensureListModal();
  const grid = el.querySelector("[data-ce-pa-tp-grid]");
  const empty = el.querySelector("[data-ce-pa-tp-empty]");
  const err = el.querySelector("[data-ce-pa-tp-err]");
  const hint = el.querySelector("[data-ce-pa-tp-hint]");
  err.hidden = true;
  grid.innerHTML = `<p class="ce-hint">Loading…</p>`;
  empty.hidden = true;
  hint.textContent = `${ctx.productKey} · provider ${ctx.selectedPrintProviderId || "—"}`;

  try {
    const res = await fetchTestPrintifyProducts(ctx.productKey, ctx.selectedPrintProviderId);
    if (!res?.ok) throw new Error(res?.error || "load_failed");
    const items = res.items || [];
    previewCache.clear();
    if (!items.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = items
      .map((row) => {
        const title = row.printify?.title || row.printify_title || `Test #${row.id}`;
        const badges = placementBadgesHtml(row.placement_modes);
        const thumb = row.printify_product_id
          ? `<div class="ce-pa-tp-card__thumb ce-pa-tp-card__thumb--loading" data-thumb-id="${row.id}"></div>`
          : `<div class="ce-pa-tp-card__thumb ce-pa-tp-card__thumb--empty">No preview</div>`;
        return `
      <article class="ce-pa-tp-card" data-row-id="${row.id}">
        <div class="ce-pa-tp-card__badges">${badges}</div>
        <button type="button" class="ce-pa-tp-card__open" data-open-id="${row.id}">
          ${thumb}
          <span class="ce-pa-tp-card__title">${escapeHtml(title)}</span>
          <span class="ce-pa-tp-card__meta">Design #${row.design_id || "—"}</span>
        </button>
        <button type="button" class="btn btn-ghost btn-xs ce-pa-tp-card__delete" data-delete-id="${row.id}" title="Delete">🗑</button>
      </article>`;
      })
      .join("");

    grid.querySelectorAll("[data-open-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.openId);
        const row = items.find((r) => Number(r.id) === id);
        if (row) openViewer(row);
      });
    });

    grid.querySelectorAll("[data-delete-id]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.deleteId);
        if (!id || !window.confirm("Delete this test product from Printify?")) return;
        btn.disabled = true;
        try {
          await deleteTestPrintifyProducts([id]);
          await loadTestProductsGrid(ctx);
        } catch (errDel) {
          alert(errDel?.message || "Delete failed");
          btn.disabled = false;
        }
      });
    });

    for (const row of items) {
      const thumbEl = grid.querySelector(`[data-thumb-id="${row.id}"]`);
      if (!thumbEl) continue;
      fetchTestPrintifyProductPreview(row.id)
        .then((data) => {
          if (!data?.ok || !data.thumbnail_url) {
            thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
            thumbEl.classList.add("ce-pa-tp-card__thumb--empty");
            thumbEl.textContent = "—";
            return;
          }
          previewCache.set(String(row.id), data);
          thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
          thumbEl.innerHTML = `<img src="${escapeHtml(data.thumbnail_url)}" alt="" loading="lazy" />`;
        })
        .catch(() => {
          thumbEl.classList.remove("ce-pa-tp-card__thumb--loading");
          thumbEl.classList.add("ce-pa-tp-card__thumb--empty");
        });
    }
  } catch (e) {
    grid.innerHTML = "";
    err.hidden = false;
    err.textContent = e?.message || "Failed to load test products";
  }
}

export async function openTestProductsModal(ctx) {
  const el = ensureListModal();
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  await loadTestProductsGrid(ctx);
}

export async function createTestProductFromPrintArea(ctx, st, { onStatus } = {}) {
  if (!ctx?.productKey || !ctx?.selectedPrintProviderId) {
    throw new Error("Select a print provider first.");
  }
  onStatus?.("Saving print area settings…");
  const { savePrintAreaTab } = await import("../tabs/print-area.js");
  await savePrintAreaTab(ctx);

  const body = buildTestContext(ctx, st);
  onStatus?.("Creating test product with random design…");
  const res = await createTestPrintifyProduct(body);
  if (!res?.ok) {
    throw new Error(res?.message || res?.error || "Create failed");
  }
  onStatus?.(`Created: ${res.printify_product_id || "OK"}`);
  return res;
}
