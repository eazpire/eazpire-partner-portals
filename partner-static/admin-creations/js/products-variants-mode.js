/**
 * Admin Products Variants mode: header icon + bottom color carousel.
 */

import { collectColorFacets, findVariantIndexForColor, normalizeColorLabel } from "./products-color-facets.js";
import { productsGridMenuHtml } from "./products-grid-view.js";

const BAR_ID = "cr-products-variants-bar";

let variantsOn = false;
let selectedColor = "";
let lastRenderMedia = null;
let onModeChange = null;
let onColorChange = null;
let getFilteredItems = null;

export function isVariantsMode() {
  return variantsOn;
}

export function getSelectedColor() {
  return selectedColor;
}

export function setSelectedColor(color) {
  selectedColor = String(color || "").trim();
  refreshVariantsColorBar();
  applySelectedColorToGrid();
  if (typeof onColorChange === "function") onColorChange(selectedColor);
}

export function productsHeaderToolsHtml() {
  return `
    <div class="cr-topbar-tools" id="cr-products-topbar-tools">
      <button type="button" class="cr-topbar-icon" data-cr-tool="variants" title="Variants" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="8" r="3.2" fill="currentColor"/><circle cx="16.5" cy="7.5" r="2.6" fill="currentColor" opacity=".72"/><circle cx="13.5" cy="16.5" r="3" fill="currentColor" opacity=".88"/></svg>
        <span>Variants</span>
      </button>
      <div class="cr-topbar-menu-wrap">
        <button type="button" class="cr-topbar-icon" data-cr-tool="grids" title="Grids" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4" fill="currentColor"/><rect x="14" y="3" width="7" height="7" rx="1.4" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1.4" fill="currentColor"/><rect x="14" y="14" width="7" height="7" rx="1.4" fill="currentColor"/></svg>
          <span>Grids</span>
        </button>
        ${productsGridMenuHtml()}
      </div>
    </div>`;
}

function ensureVariantsBar() {
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = "cr-variants-bar";
    bar.hidden = true;
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML = `
      <div class="cr-variants-bar__panel" role="toolbar" aria-label="Color variants">
        <span class="cr-variants-bar__title">Variants</span>
        <button type="button" class="cr-variants-bar__scroll" data-cr-color-scroll="-1" aria-label="Previous colors">‹</button>
        <div class="cr-variants-bar__track" id="cr-products-color-track"></div>
        <button type="button" class="cr-variants-bar__scroll" data-cr-color-scroll="1" aria-label="Next colors">›</button>
        <button type="button" class="cr-variants-bar__close" data-cr-variants-close>Close</button>
      </div>`;
    document.body.appendChild(bar);
    bar.querySelector("[data-cr-variants-close]").onclick = () => setVariantsMode(false);
    bar.querySelectorAll("[data-cr-color-scroll]").forEach((btn) => {
      btn.onclick = () => {
        const track = document.getElementById("cr-products-color-track");
        if (!track) return;
        const dir = Number(btn.getAttribute("data-cr-color-scroll")) || 0;
        track.scrollBy({ left: dir * Math.max(160, track.clientWidth * 0.55), behavior: "smooth" });
      };
    });
  }
  if (bar.parentElement !== document.body) document.body.appendChild(bar);
  return bar;
}

export function refreshVariantsColorBar(items = typeof getFilteredItems === "function" ? getFilteredItems() : []) {
  const bar = ensureVariantsBar();
  const track = bar.querySelector("#cr-products-color-track");
  if (!track) return;
  const facets = collectColorFacets(items);
  if (selectedColor && !facets.some((f) => normalizeColorLabel(f.label) === normalizeColorLabel(selectedColor))) {
    selectedColor = "";
  }
  track.innerHTML = facets.length
    ? facets
        .map((f) => {
          const active = normalizeColorLabel(f.label) === normalizeColorLabel(selectedColor);
          const count = f.count > 99 ? "99+" : String(f.count);
          return `<button type="button" class="cr-color-dot${active ? " is-active" : ""}${f.dark ? " is-dark" : ""}" data-cr-color="${escapeAttr(f.label)}" title="${escapeAttr(f.label)} · ${f.count}" style="--cr-dot:${escapeAttr(f.hex)}">
            <span class="cr-color-dot__count">${escapeText(count)}</span>
            <span class="visually-hidden">${escapeText(f.label)}</span>
          </button>`;
        })
        .join("")
    : `<span class="cr-variants-bar__empty">No color variants in this filter</span>`;

  track.querySelectorAll("[data-cr-color]").forEach((btn) => {
    btn.onclick = () => {
      const next = btn.getAttribute("data-cr-color") || "";
      setSelectedColor(normalizeColorLabel(selectedColor) === normalizeColorLabel(next) ? "" : next);
    };
  });
}

export function applySelectedColorToGrid({ renderCardMedia } = {}) {
  if (typeof renderCardMedia === "function") lastRenderMedia = renderCardMedia;
  const paint = lastRenderMedia;
  const color = selectedColor;
  document.querySelectorAll(".cr-card--product[data-cr-grid-groups]").forEach((card) => {
    card.classList.remove("is-color-matched", "is-color-missing");
    if (!color || !paint) return;
    let groups = [];
    try {
      groups = JSON.parse(card.dataset.crGridGroups || "[]") || [];
    } catch (_) {
      groups = [];
    }
    const idx = findVariantIndexForColor(groups, color);
    if (idx < 0) {
      card.classList.add("is-color-missing");
      return;
    }
    const view = groups[idx]?.views?.[0];
    const thumb = card.querySelector(".cr-card__thumb-inner");
    if (thumb && view) thumb.innerHTML = paint(view);
    card.dataset.crVariantIndex = String(idx);
    card.dataset.crViewIndex = "0";
    card.classList.add("is-color-matched");
  });
}

export function setVariantsMode(on, opts = {}) {
  variantsOn = !!on;
  if (!variantsOn) selectedColor = "";
  document.documentElement.classList.toggle("cr-products-variants-on", variantsOn);
  const btn = document.querySelector('[data-cr-tool="variants"]');
  if (btn) btn.setAttribute("aria-pressed", variantsOn ? "true" : "false");
  const bar = ensureVariantsBar();
  bar.hidden = !variantsOn;
  bar.setAttribute("aria-hidden", variantsOn ? "false" : "true");
  bar.classList.toggle("is-visible", variantsOn);
  if (variantsOn) refreshVariantsColorBar();
  else applySelectedColorToGrid();
  if (typeof onModeChange === "function") onModeChange(variantsOn);
  if (opts.silent) return;
}

export function mountProductsVariantsMode({ getItems, renderCardMedia, onMode, onColor } = {}) {
  getFilteredItems = typeof getItems === "function" ? getItems : null;
  lastRenderMedia = renderCardMedia || lastRenderMedia;
  onModeChange = onMode || null;
  onColorChange = onColor || null;
  ensureVariantsBar();
  const btn = document.querySelector('[data-cr-tool="variants"]');
  if (btn) {
    btn.onclick = () => setVariantsMode(!variantsOn);
  }
  setVariantsMode(variantsOn, { silent: true });
}

export function teardownVariantsMode() {
  variantsOn = false;
  selectedColor = "";
  onModeChange = null;
  onColorChange = null;
  getFilteredItems = null;
  document.documentElement.classList.remove("cr-products-variants-on");
  const bar = document.getElementById(BAR_ID);
  if (bar) bar.remove();
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeText(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}
