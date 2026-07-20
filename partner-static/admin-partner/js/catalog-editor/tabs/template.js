import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import {
  fetchTemplateBundle,
  createTemplateDraft,
  removeTemplateDraft,
  saveTemplateSectionProductId,
  syncTemplateSection,
  setTemplatePrintArea,
} from "../api.js";

const PRINTIFY_PRODUCT_URL_BASE = "https://printify.com/app/store/products/1?searchKey=";

const SECTION_ID_FIELDS = {
  calibration_mockup: "printify_calibration_mockups_product_id",
  mockups: "printify_mockups_product_id",
  shop_preview_mockups: "printify_shop_preview_mockups_product_id",
  variants: "printify_variants_product_id",
  print_areas: "printify_print_areas_product_id",
};

const SECTIONS = [
  {
    id: "calibration_mockup",
    title: "Calibration Mockup",
    hint: "Internal placement-guide images for print-area detection (red rectangle) and personalized try-on. Use Set Print Area to place green markers in Printify, then Sync to detect geometry.",
    supportsSetPrintArea: true,
  },
  {
    id: "mockups",
    title: "Clean Mockups",
    hint: "Fetch clean mockup images from Printify and save them to the catalog database.",
  },
  {
    id: "shop_preview_mockups",
    title: "Shop Preview Mockups",
    hint: "Fetch wearing mockups for shop preview (Create from Scratch and Shop Create cards).",
  },
  {
    id: "variants",
    title: "Variants",
    hint: "Refresh variant pricing, options, and publish profile data from the Printify template. Also syncs placeholder settings (creator design, QR, logo slots) from the same product ID.",
  },
  {
    id: "print_areas",
    title: "Placeholder Settings",
    hint: "Load Printify placeholder slots (creator design, QR, logo, additional design) into the publish profile. Uses the Variants product ID by default — sync here only when you need a different Printify product.",
  },
];

function sectionPrintifyId(data, sectionId) {
  const field = SECTION_ID_FIELDS[sectionId];
  const direct = String(data?.template?.[field] || "").trim();
  if (direct) return direct;
  if (sectionId === "print_areas") {
    return String(data?.template?.printify_variants_product_id || "").trim();
  }
  return "";
}

function draftPrintifyId(data) {
  return String(data?.draft_product_id || data?.template?.printify_draft_product_id || "").trim();
}

function printifyProductUrl(printifyId) {
  const key = String(printifyId || "").trim();
  if (!key) return null;
  return PRINTIFY_PRODUCT_URL_BASE + encodeURIComponent(key);
}

function partnerFetchErrorMessage(err) {
  return err?.data?.message || err?.data?.detail || err?.message || "Unknown error";
}

function renderPanelHead(draftId) {
  if (draftId) {
    const url = printifyProductUrl(draftId);
    return `
      <div class="ce-tpl-panel__head ce-tpl-draft-head">
        <div class="ce-tpl-draft-head__main">
          <span class="ce-tpl-draft-head__label">Printify draft</span>
          ${
            url
              ? `<a class="ce-tpl-draft-head__id" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draftId)}</a>`
              : `<span class="ce-tpl-draft-head__id">${escapeHtml(draftId)}</span>`
          }
        </div>
        <div class="ce-tpl-draft-head__actions">
          <button type="button" class="btn btn-secondary btn-sm ce-tpl-open-draft"${url ? "" : " disabled"}>Open</button>
          <button type="button" class="btn btn-secondary btn-sm" id="ce-tpl-remove-draft">Remove</button>
        </div>
      </div>`;
  }

  return `
    <div class="ce-tpl-panel__head">
      <h3 class="ce-section-title">Templates</h3>
      <button type="button" class="btn btn-secondary btn-sm" id="ce-tpl-create-draft">Create draft</button>
    </div>`;
}

function renderSectionTitle(section, printifyId) {
  const url = printifyProductUrl(printifyId);
  if (url) {
    return `<a class="ce-tpl-section__title-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(section.title)}</a>`;
  }
  return escapeHtml(section.title);
}

function renderSection(section, printifyId) {
  const setPrintAreaBtn = section.supportsSetPrintArea
    ? `<button type="button" class="btn btn-secondary btn-sm ce-tpl-set-print-area" data-section="${section.id}">Set Print Area</button>`
    : "";

  return `
    <section class="ce-tpl-section" id="ce-tpl-section-${section.id}" data-section="${section.id}">
      <div class="ce-tpl-section__head">
        <h4 class="ce-tpl-section__title">${renderSectionTitle(section, printifyId)}</h4>
        <p class="ce-tpl-section__hint">${escapeHtml(section.hint)}</p>
      </div>
      <div class="ce-tpl-section__row">
        <label class="ce-tpl-section__label" for="ce-tpl-id-${section.id}">Printify product ID</label>
        <input
          class="input ce-tpl-section__input"
          id="ce-tpl-id-${section.id}"
          data-section-input="${section.id}"
          value="${escapeHtml(printifyId)}"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="ce-tpl-section__actions">
          ${setPrintAreaBtn}
          <button type="button" class="btn btn-secondary btn-sm ce-tpl-sync" data-section="${section.id}">Sync</button>
          <button type="button" class="btn btn-secondary btn-sm ce-tpl-open" data-section="${section.id}"${printifyId ? "" : " disabled"}>Open</button>
        </div>
      </div>
      <div class="ce-tpl-section__status" aria-live="polite"></div>
      <div class="ce-tpl-section__overlay" hidden>
        <div class="ce-tpl-section__spinner" aria-hidden="true"></div>
        <span class="ce-tpl-section__overlay-text">Syncing…</span>
      </div>
      <div class="ce-tpl-section__success" hidden aria-hidden="true">
        <span class="ce-tpl-section__success-icon">✓</span>
        <span>Synced</span>
      </div>
    </section>`;
}

export async function loadTemplateTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return `<div class="ce-tab-panel"><p>Select an active provider above.</p></div>`;

  const data = await fetchTemplateBundle(ctx.productKey, pid);
  ctx.templateData = data;

  if (data.draft_stale_removed) {
    const removed = data.removed_draft_id ? ` (${data.removed_draft_id})` : "";
    showToast(
      "Draft removed",
      `The saved Printify draft${removed} no longer exists and was cleared from the database.`
    );
  }

  const draftId = draftPrintifyId(data);

  return `
    <div class="ce-tab-panel ce-tpl-panel">
      ${renderPanelHead(draftId)}
      <p class="ce-hint">Create a Printify draft once per provider. Each section below uses its own Printify product ID — sync pulls data into the publish profile independently.</p>
      <div class="ce-tpl-sections">
        ${SECTIONS.map((s) => renderSection(s, sectionPrintifyId(data, s.id))).join("")}
      </div>
    </div>`;
}

export async function saveTemplateTab() {
  /* Sync buttons persist data; footer save is a no-op on this tab. */
}

function setSectionState(sectionEl, state, overlayText) {
  if (!sectionEl) return;
  sectionEl.classList.remove("ce-tpl-section--loading", "ce-tpl-section--success", "ce-tpl-section--error");
  const overlay = sectionEl.querySelector(".ce-tpl-section__overlay");
  const success = sectionEl.querySelector(".ce-tpl-section__success");
  const status = sectionEl.querySelector(".ce-tpl-section__status");
  const overlayLabel = sectionEl.querySelector(".ce-tpl-section__overlay-text");

  if (state === "loading") {
    sectionEl.classList.add("ce-tpl-section--loading");
    if (overlay) overlay.hidden = false;
    if (overlayLabel && overlayText) overlayLabel.textContent = overlayText;
    if (success) success.hidden = true;
    if (status) status.textContent = "";
    return;
  }

  if (overlay) overlay.hidden = true;

  if (state === "success") {
    sectionEl.classList.add("ce-tpl-section--success");
    if (success) {
      success.hidden = false;
      window.setTimeout(() => {
        success.hidden = true;
        sectionEl.classList.remove("ce-tpl-section--success");
      }, 1800);
    }
    if (status) status.textContent = "";
    return;
  }

  if (state === "error") {
    sectionEl.classList.add("ce-tpl-section--error");
    if (success) success.hidden = true;
  }
}

async function runSectionSync(sectionId, ctx) {
  const sectionEl = document.getElementById(`ce-tpl-section-${sectionId}`);
  const input = document.getElementById(`ce-tpl-id-${sectionId}`);
  const printifyId = input?.value?.trim();
  if (!printifyId) {
    showToast("Sync failed", "Printify product ID required.");
    return;
  }

  const syncBtn = sectionEl?.querySelector(".ce-tpl-sync");
  if (syncBtn) syncBtn.disabled = true;
  setSectionState(sectionEl, "loading", "Syncing…");

  try {
    const extra = {};
    if (sectionId === "print_areas" || sectionId === "variants") {
      if (ctx.selectedVersionId) extra.version_id = ctx.selectedVersionId;
    }
    const result = await syncTemplateSection(ctx.productKey, ctx.selectedPrintProviderId, sectionId, printifyId, extra);
    setSectionState(sectionEl, "success");
    let syncMsg =
      sectionId === "variants"
        ? "Variants and placeholder settings updated from Printify."
        : sectionId === "print_areas"
          ? "Placeholder settings updated from Printify."
          : `${sectionId.replace(/_/g, " ")} data updated from Printify.`;
    let toastKind = "Synced";

    if (sectionId === "calibration_mockup") {
      const detected = Number(result?.calibration_detection?.detected_count) || 0;
      const errCount = Number(result?.calibration_detection?.error_count) ||
        (result?.calibration_detection?.errors?.length || 0);
      // Force Print Area tab to reload rects from DB on next open.
      ctx.printAreaState = null;
      ctx.printAreaData = null;
      ctx.mockupsData = null;
      if (detected > 0 && errCount === 0) {
        syncMsg = `Calibration sync complete — ${detected} print area${detected === 1 ? "" : "s"} detected. Reopen Print Area to see the red frames.`;
      } else if (detected > 0 && errCount > 0) {
        toastKind = "Synced with warnings";
        syncMsg = `Detected ${detected} print area${detected === 1 ? "" : "s"}, but ${errCount} view${errCount === 1 ? "" : "s"} failed detection. Reopen Print Area to refresh.`;
      } else {
        toastKind = "Sync incomplete";
        const firstErr = result?.calibration_detection?.errors?.[0]?.error || "green marker not detected";
        syncMsg = `Mockups saved, but print-area geometry was not updated (${firstErr}). Check that green markers are solid on the images, then Sync again.`;
      }
    }

    showToast(toastKind, syncMsg);
    ctx.templateData = await fetchTemplateBundle(ctx.productKey, ctx.selectedPrintProviderId);
  } catch (err) {
    setSectionState(sectionEl, "error");
    const status = sectionEl?.querySelector(".ce-tpl-section__status");
    if (status) status.textContent = partnerFetchErrorMessage(err);
    showToast("Sync failed", partnerFetchErrorMessage(err));
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    sectionEl?.classList.remove("ce-tpl-section--loading");
    const overlay = sectionEl?.querySelector(".ce-tpl-section__overlay");
    if (overlay) overlay.hidden = true;
  }
}

async function runSetPrintArea(sectionId, ctx) {
  const sectionEl = document.getElementById(`ce-tpl-section-${sectionId}`);
  const input = document.getElementById(`ce-tpl-id-${sectionId}`);
  const printifyId = input?.value?.trim();
  if (!printifyId) {
    showToast("Set Print Area failed", "Printify product ID required.");
    return;
  }

  const actionBtn = sectionEl?.querySelector(".ce-tpl-set-print-area");
  const syncBtn = sectionEl?.querySelector(".ce-tpl-sync");
  if (actionBtn) actionBtn.disabled = true;
  if (syncBtn) syncBtn.disabled = true;
  setSectionState(sectionEl, "loading", "Setting print area…");

  try {
    const result = await setTemplatePrintArea(ctx.productKey, ctx.selectedPrintProviderId, sectionId, printifyId);
    setSectionState(sectionEl, "success");
    const count = result?.placements_applied?.length || 0;
    showToast(
      "Print area set",
      count
        ? `Green markers placed on ${count} print area${count === 1 ? "" : "s"}. Run Sync to save geometry to the database.`
        : "Green markers placed. Run Sync to save geometry to the database."
    );
    ctx.templateData = await fetchTemplateBundle(ctx.productKey, ctx.selectedPrintProviderId);
  } catch (err) {
    setSectionState(sectionEl, "error");
    const status = sectionEl?.querySelector(".ce-tpl-section__status");
    if (status) status.textContent = partnerFetchErrorMessage(err);
    showToast("Set Print Area failed", partnerFetchErrorMessage(err));
  } finally {
    if (actionBtn) actionBtn.disabled = false;
    if (syncBtn) syncBtn.disabled = false;
    sectionEl?.classList.remove("ce-tpl-section--loading");
    const overlay = sectionEl?.querySelector(".ce-tpl-section__overlay");
    if (overlay) overlay.hidden = true;
    const overlayLabel = sectionEl?.querySelector(".ce-tpl-section__overlay-text");
    if (overlayLabel) overlayLabel.textContent = "Syncing…";
  }
}

document.addEventListener("input", (ev) => {
  const input = ev.target.closest("[data-section-input]");
  if (!input) return;
  const sectionId = input.dataset.sectionInput;
  const openBtn = document.querySelector(`.ce-tpl-open[data-section="${sectionId}"]`);
  if (openBtn) openBtn.disabled = !input.value?.trim();
  const titleEl = document.querySelector(`#ce-tpl-section-${sectionId} .ce-tpl-section__title`);
  if (!titleEl) return;
  const section = SECTIONS.find((s) => s.id === sectionId);
  if (!section) return;
  titleEl.innerHTML = renderSectionTitle(section, input.value?.trim());
});

document.addEventListener("click", async (ev) => {
  const syncBtn = ev.target.closest(".ce-tpl-sync");
  const setPrintAreaBtn = ev.target.closest(".ce-tpl-set-print-area");
  const openBtn = ev.target.closest(".ce-tpl-open");
  const draftOpenBtn = ev.target.closest(".ce-tpl-open-draft");
  const draftBtn = ev.target.closest("#ce-tpl-create-draft");
  const removeBtn = ev.target.closest("#ce-tpl-remove-draft");
  if (!syncBtn && !setPrintAreaBtn && !openBtn && !draftBtn && !removeBtn && !draftOpenBtn) return;

  if (openBtn) {
    const sectionId = openBtn.dataset.section;
    const input = document.getElementById(`ce-tpl-id-${sectionId}`);
    const url = printifyProductUrl(input?.value);
    if (!url) {
      showToast("Open failed", "Printify product ID required.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (draftOpenBtn) {
    const draftLink = document.querySelector(".ce-tpl-draft-head__id[href]");
    const url = draftLink?.href;
    if (!url) {
      showToast("Open failed", "Printify draft ID required.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const ctx = window.__catalogEditorState;
  if (!ctx?.productKey || !ctx?.selectedPrintProviderId) return;

  if (draftBtn) {
    draftBtn.disabled = true;
    try {
      const res = await createTemplateDraft({
        product_key: ctx.productKey,
        print_provider_id: ctx.selectedPrintProviderId,
        auto_mirror: false,
      });
      const id = res?.printify_draft_product_id ? String(res.printify_draft_product_id) : "";
      await ctx.reloadTab?.();
      showToast("Draft created", id ? `Printify draft ${id}` : "Printify draft ready.");
    } catch (err) {
      showToast("Draft failed", partnerFetchErrorMessage(err));
    } finally {
      draftBtn.disabled = false;
    }
    return;
  }

  if (removeBtn) {
    removeBtn.disabled = true;
    try {
      const res = await removeTemplateDraft({
        product_key: ctx.productKey,
        print_provider_id: ctx.selectedPrintProviderId,
      });
      await ctx.reloadTab?.();
      const id = res?.removed_draft_id ? String(res.removed_draft_id) : "";
      showToast("Draft removed", id ? `Removed Printify draft ${id}` : "Draft link cleared.");
    } catch (err) {
      showToast("Remove failed", partnerFetchErrorMessage(err));
    } finally {
      removeBtn.disabled = false;
    }
    return;
  }

  if (setPrintAreaBtn) {
    await runSetPrintArea(setPrintAreaBtn.dataset.section, ctx);
    return;
  }

  if (syncBtn) {
    await runSectionSync(syncBtn.dataset.section, ctx);
  }
});
