import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { fetchTemplateBundle, createTemplateDraft, removeTemplateDraft, syncTemplateSection } from "../api.js";

const PRINTIFY_PRODUCT_URL_BASE = "https://printify.com/app/store/products/1?searchKey=";

const SECTIONS = [
  {
    id: "mockups",
    title: "Mockups",
    hint: "Fetch mockup images from Printify and save them to the catalog database.",
  },
  {
    id: "variants",
    title: "Variants",
    hint: "Refresh variant pricing, options, and publish profile data from the Printify template.",
  },
  {
    id: "print_areas",
    title: "Print Areas",
    hint: "Load print area geometry and placeholder settings from Printify.",
  },
];

function syncPrintifyId(data) {
  return String(data?.template?.printify_product_id || "").trim();
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

function renderSection(section, printifyId) {
  return `
    <section class="ce-tpl-section" id="ce-tpl-section-${section.id}" data-section="${section.id}">
      <div class="ce-tpl-section__head">
        <h4 class="ce-tpl-section__title">${escapeHtml(section.title)}</h4>
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
  const syncPrintifyIdValue = syncPrintifyId(data);

  return `
    <div class="ce-tab-panel ce-tpl-panel">
      ${renderPanelHead(draftId)}
      <p class="ce-hint">Create a Printify draft once per provider, then link a separate Printify product ID per section to sync data into the catalog.</p>
      <div class="ce-tpl-sections">
        ${SECTIONS.map((s) => renderSection(s, syncPrintifyIdValue)).join("")}
      </div>
    </div>`;
}

export async function saveTemplateTab() {
  /* Sync buttons persist data; footer save is a no-op on this tab. */
}

function setSectionState(sectionEl, state) {
  if (!sectionEl) return;
  sectionEl.classList.remove("ce-tpl-section--loading", "ce-tpl-section--success", "ce-tpl-section--error");
  const overlay = sectionEl.querySelector(".ce-tpl-section__overlay");
  const success = sectionEl.querySelector(".ce-tpl-section__success");
  const status = sectionEl.querySelector(".ce-tpl-section__status");

  if (state === "loading") {
    sectionEl.classList.add("ce-tpl-section--loading");
    if (overlay) overlay.hidden = false;
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
  setSectionState(sectionEl, "loading");

  try {
    const extra = {};
    if (sectionId === "print_areas" && ctx.selectedVersionId) {
      extra.version_id = ctx.selectedVersionId;
    }
    await syncTemplateSection(ctx.productKey, ctx.selectedPrintProviderId, sectionId, printifyId, extra);
    setSectionState(sectionEl, "success");
    showToast("Synced", `${sectionId.replace("_", " ")} data updated from Printify.`);
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

document.addEventListener("input", (ev) => {
  const input = ev.target.closest("[data-section-input]");
  if (!input) return;
  const openBtn = document.querySelector(`.ce-tpl-open[data-section="${input.dataset.sectionInput}"]`);
  if (openBtn) openBtn.disabled = !input.value?.trim();
});

document.addEventListener("click", async (ev) => {
  const syncBtn = ev.target.closest(".ce-tpl-sync");
  const openBtn = ev.target.closest(".ce-tpl-open");
  const draftOpenBtn = ev.target.closest(".ce-tpl-open-draft");
  const draftBtn = ev.target.closest("#ce-tpl-create-draft");
  const removeBtn = ev.target.closest("#ce-tpl-remove-draft");
  if (!syncBtn && !openBtn && !draftBtn && !removeBtn && !draftOpenBtn) return;

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

  if (syncBtn) {
    await runSectionSync(syncBtn.dataset.section, ctx);
  }
});
