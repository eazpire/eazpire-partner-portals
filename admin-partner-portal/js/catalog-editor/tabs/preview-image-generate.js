/**
 * Preview Images → Generate modal.
 * Pick a Calibration / Clean / Shop Preview mock, prompt Seedream 4.5, then Save into Preview Images.
 */

import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { generatePreviewImage, saveGeneratedPreviewImage } from "../api.js";

const MOCKUP_SET_CLEAN = "clean";
const MOCKUP_SET_SHOP_PREVIEW = "shop_preview";
const MOCKUP_SET_CALIBRATION = "calibration";

const TABS = [
  { id: MOCKUP_SET_CALIBRATION, label: "Calibration", field: "calibration_images" },
  { id: MOCKUP_SET_CLEAN, label: "Clean", field: "images" },
  { id: MOCKUP_SET_SHOP_PREVIEW, label: "Shop Preview", field: "shop_preview_images" },
];

/** @type {null | {
 *   ctx: any,
 *   onSaved: () => Promise<void> | void,
 *   phase: "select" | "generating" | "result" | "regen",
 *   tab: string,
 *   selected: null | { id: string, image_url: string, view_key: string, color_name: string },
 *   prompt: string,
 *   resultUrl: string | null,
 * }} */
let state = null;

function formatViewLabel(viewKey) {
  return String(viewKey || "other")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

function imagesForTab(data, tabId) {
  const tab = TABS.find((t) => t.id === tabId) || TABS[1];
  return data?.[tab.field] || [];
}

function ensureModal() {
  let el = document.getElementById("ce-prev-gen-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ce-prev-gen-modal";
  el.className = "ce-prev-gen-modal";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.innerHTML = `
    <div class="ce-prev-gen-modal__backdrop" data-ce-prev-gen-close></div>
    <div class="ce-prev-gen-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ce-prev-gen-title">
      <header class="ce-prev-gen-modal__header">
        <h2 id="ce-prev-gen-title" class="ce-prev-gen-modal__title">Generate Preview Image</h2>
        <button type="button" class="btn btn-ghost btn-xs ce-prev-gen-modal__close" data-ce-prev-gen-close aria-label="Close">×</button>
      </header>
      <div class="ce-prev-gen-modal__body" data-ce-prev-gen-body></div>
      <div class="ce-prev-gen-float-slot" data-ce-prev-gen-float-slot hidden></div>
      <footer class="ce-prev-gen-modal__footer" data-ce-prev-gen-footer hidden></footer>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll("[data-ce-prev-gen-close]").forEach((btn) => {
    btn.addEventListener("click", () => closePreviewImageGenerateModal());
  });
  return el;
}

function renderSelectCarousels() {
  if (!state) return "";
  const images = imagesForTab(state.ctx.mockupsData, state.tab);
  const grouped = groupImagesByView(images);
  if (!grouped.length) {
    return `<p class="ce-hint">No mockups in this set yet. Switch tab or sync/upload mockups first.</p>`;
  }
  return grouped
    .map(([viewKey, slides]) => {
      const slideHtml = slides
        .map((img) => {
          const selected = state.selected && String(state.selected.id) === String(img.id);
          return `
            <div class="ce-mock-carousel__slide-wrap">
              <button type="button"
                class="ce-mock-carousel__slide ce-mock-carousel__slide--pickable${selected ? " ce-mock-carousel__slide--active" : ""}"
                data-ce-prev-gen-pick="${escapeHtml(String(img.id))}"
                data-url="${escapeHtml(img.image_url || "")}"
                data-view="${escapeHtml(img.view_key || viewKey)}"
                data-color="${escapeHtml(img.color_name || "Default")}"
                aria-pressed="${selected ? "true" : "false"}"
                title="Select ${escapeHtml(img.color_name || viewKey)}">
                <img src="${escapeHtml(img.image_url)}" alt="${escapeHtml(img.color_name || viewKey)}" loading="lazy" />
                <span class="ce-mock-carousel__color">${escapeHtml(img.color_name || "Default")}</span>
              </button>
            </div>`;
        })
        .join("");
      return `
        <article class="ce-mock-view">
          <header class="ce-mock-view__header">
            <div class="ce-mock-view__title-wrap">
              <h4 class="ce-mock-view__title">${escapeHtml(formatViewLabel(viewKey))}</h4>
              <span class="ce-mock-view__count">${slides.length} color${slides.length === 1 ? "" : "s"}</span>
            </div>
          </header>
          <div class="ce-mock-carousel">
            <div class="ce-mock-carousel__viewport">
              <div class="ce-mock-carousel__track">${slideHtml}</div>
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function renderFloatingPromptBar(showGenerate) {
  const prompt = escapeHtml(state?.prompt || "");
  const canGen = !!(state?.selected?.image_url);
  return `
    <div class="ce-prev-gen-float" data-ce-prev-gen-float>
      <input type="text" class="input ce-prev-gen-float__input" data-ce-prev-gen-prompt
        placeholder="Describe the lifestyle / preview scene…" value="${prompt}" maxlength="4000" />
      ${
        showGenerate
          ? `<button type="button" class="btn btn-primary" data-ce-prev-gen-run ${canGen ? "" : "disabled"}>Generate</button>`
          : ""
      }
    </div>`;
}

function renderBody() {
  if (!state) return "";
  const { phase } = state;

  if (phase === "generating") {
    const src = escapeHtml(state.selected?.image_url || "");
    return `
      <div class="ce-prev-gen-stage ce-prev-gen-stage--generating">
        <div class="ce-prev-gen-placeholder">
          <img src="${src}" alt="Source mockup" class="ce-prev-gen-placeholder__img" />
          <div class="ce-prev-gen-placeholder__overlay">
            <span class="ce-prev-gen-spinner" aria-hidden="true"></span>
            <p>Generating with Seedream 4.5…</p>
          </div>
        </div>
      </div>`;
  }

  if (phase === "result") {
    return `
      <div class="ce-prev-gen-stage ce-prev-gen-stage--result">
        <div class="ce-prev-gen-result">
          <img src="${escapeHtml(state.resultUrl || "")}" alt="Generated preview" class="ce-prev-gen-result__img" />
        </div>
      </div>`;
  }

  // Regen: keep base mock, show prompt bar again (no carousel UI).
  if (phase === "regen") {
    const src = escapeHtml(state.selected?.image_url || "");
    const label = escapeHtml(state.selected?.color_name || state.selected?.view_key || "Selected mock");
    return `
      <div class="ce-prev-gen-stage ce-prev-gen-stage--regen">
        <p class="ce-hint">Edit the prompt and generate again. Source mock: <strong>${label}</strong></p>
        <div class="ce-prev-gen-placeholder ce-prev-gen-placeholder--static">
          <img src="${src}" alt="${label}" class="ce-prev-gen-placeholder__img" />
        </div>
      </div>`;
  }

  // Select: tabs + carousels (prompt bar is rendered in the pinned float slot)
  const tabsHtml = TABS.map(
    (t) => `
      <button type="button" class="ce-prev-gen-tab${state.tab === t.id ? " is-active" : ""}"
        data-ce-prev-gen-tab="${escapeHtml(t.id)}" role="tab" aria-selected="${state.tab === t.id ? "true" : "false"}">
        ${escapeHtml(t.label)}
      </button>`
  ).join("");

  return `
    <div class="ce-prev-gen-stage ce-prev-gen-stage--select">
      <div class="ce-prev-gen-tabs" role="tablist">${tabsHtml}</div>
      <p class="ce-hint">Select a mockup, then enter a prompt and generate a lifestyle preview image.</p>
      <div class="ce-mock-views ce-prev-gen-views">${renderSelectCarousels()}</div>
    </div>`;
}

function renderFooter() {
  if (!state || state.phase !== "result") return "";
  return `
    <button type="button" class="btn btn-secondary" data-ce-prev-gen-discard>Discard</button>
    <button type="button" class="btn btn-secondary" data-ce-prev-gen-regen>Regenerate</button>
    <button type="button" class="btn btn-primary" data-ce-prev-gen-save>Save</button>`;
}

function paint() {
  const el = ensureModal();
  const body = el.querySelector("[data-ce-prev-gen-body]");
  const floatSlot = el.querySelector("[data-ce-prev-gen-float-slot]");
  const footer = el.querySelector("[data-ce-prev-gen-footer]");
  if (body) body.innerHTML = renderBody();

  const showFloat =
    state &&
    (state.phase === "select" || state.phase === "regen") &&
    !!state.selected;
  if (floatSlot) {
    if (showFloat) {
      floatSlot.hidden = false;
      floatSlot.innerHTML = renderFloatingPromptBar(true);
    } else {
      floatSlot.hidden = true;
      floatSlot.innerHTML = "";
    }
  }

  if (footer) {
    const html = renderFooter();
    footer.innerHTML = html;
    footer.hidden = !html;
  }
  bindBodyEvents(el);
}

function bindBodyEvents(el) {
  el.querySelectorAll("[data-ce-prev-gen-tab]").forEach((btn) => {
    btn.onclick = () => {
      if (!state || state.phase === "generating") return;
      state.tab = btn.getAttribute("data-ce-prev-gen-tab") || MOCKUP_SET_CLEAN;
      // Keep selection if it still exists in new tab; otherwise clear.
      if (state.selected) {
        const still = imagesForTab(state.ctx.mockupsData, state.tab).some(
          (img) => String(img.id) === String(state.selected.id)
        );
        if (!still) state.selected = null;
      }
      if (state.phase === "regen") state.phase = "select";
      paint();
    };
  });

  el.querySelectorAll("[data-ce-prev-gen-pick]").forEach((btn) => {
    btn.onclick = () => {
      if (!state || state.phase === "generating") return;
      state.selected = {
        id: btn.getAttribute("data-ce-prev-gen-pick") || "",
        image_url: btn.getAttribute("data-url") || "",
        view_key: btn.getAttribute("data-view") || "",
        color_name: btn.getAttribute("data-color") || "Default",
      };
      if (state.phase === "regen") state.phase = "select";
      paint();
    };
  });

  const promptInput = el.querySelector("[data-ce-prev-gen-prompt]");
  if (promptInput) {
    promptInput.oninput = () => {
      if (state) state.prompt = promptInput.value;
    };
  }

  el.querySelector("[data-ce-prev-gen-run]")?.addEventListener("click", () => {
    void runGenerate();
  });
  el.querySelector("[data-ce-prev-gen-discard]")?.addEventListener("click", () => {
    if (!state) return;
    state.resultUrl = null;
    state.phase = "select";
    paint();
  });
  el.querySelector("[data-ce-prev-gen-regen]")?.addEventListener("click", () => {
    if (!state) return;
    state.resultUrl = null;
    state.phase = "regen";
    paint();
  });
  el.querySelector("[data-ce-prev-gen-save]")?.addEventListener("click", () => {
    void runSave();
  });
}

async function runGenerate() {
  if (!state?.selected?.image_url) {
    showToast?.("Select a mockup", "Pick a Calibration, Clean, or Shop Preview mock first.");
    return;
  }
  const prompt = String(state.prompt || "").trim();
  if (!prompt) {
    showToast?.("Prompt required", "Describe the preview scene you want.");
    return;
  }

  state.phase = "generating";
  paint();

  try {
    const res = await generatePreviewImage(state.ctx.productKey, {
      prompt,
      imageUrl: state.selected.image_url,
    });
    state.resultUrl = res.image_url;
    state.phase = "result";
    paint();
  } catch (err) {
    console.error("[preview-image-generate]", err);
    showToast?.("Generate failed", err?.message || "Could not generate image.");
    state.phase = state.selected ? "select" : "select";
    paint();
  }
}

async function runSave() {
  if (!state?.resultUrl) return;
  const footer = ensureModal().querySelector("[data-ce-prev-gen-footer]");
  const saveBtn = footer?.querySelector("[data-ce-prev-gen-save]");
  if (saveBtn) saveBtn.disabled = true;
  try {
    await saveGeneratedPreviewImage(state.ctx.productKey, {
      imageUrl: state.resultUrl,
      printProviderId: state.ctx.selectedPrintProviderId || 0,
      viewKey: state.selected?.view_key
        ? `gen_${String(state.selected.view_key).slice(0, 20)}`
        : undefined,
      colorName: state.selected?.color_name || "Generated",
    });
    showToast?.("Saved", "Preview image added to Preview Images.");
    const onSaved = state.onSaved;
    closePreviewImageGenerateModal();
    if (onSaved) await onSaved();
  } catch (err) {
    console.error("[preview-image-save]", err);
    showToast?.("Save failed", err?.message || "Could not save generated image.");
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function openPreviewImageGenerateModal(ctx, { onSaved } = {}) {
  if (!ctx?.mockupsData) {
    showToast?.("No mockups", "Load the Mockups tab first.");
    return;
  }
  state = {
    ctx,
    onSaved: onSaved || null,
    phase: "select",
    tab: MOCKUP_SET_CLEAN,
    selected: null,
    prompt: "",
    resultUrl: null,
  };
  const el = ensureModal();
  paint();
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  el.removeAttribute("inert");
}

export function closePreviewImageGenerateModal() {
  const el = document.getElementById("ce-prev-gen-modal");
  if (el) {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("inert", "");
  }
  state = null;
}
