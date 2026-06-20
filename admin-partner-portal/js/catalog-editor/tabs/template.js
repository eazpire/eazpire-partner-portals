import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { fetchTemplateBundle, createTemplateDraft, syncTemplateSection } from "../api.js";

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

function defaultPrintifyId(data) {
  return String(data?.template?.printify_product_id || data?.version?.external_template_product_id || "").trim();
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
        <button type="button" class="btn btn-secondary btn-sm ce-tpl-sync" data-section="${section.id}">Sync</button>
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
  const printifyId = defaultPrintifyId(data);

  return `
    <div class="ce-tab-panel ce-tpl-panel">
      <div class="ce-tpl-panel__head">
        <h3 class="ce-section-title">Templates · provider ${escapeHtml(pid)}</h3>
        <button type="button" class="btn btn-secondary btn-sm" id="ce-tpl-create-draft">Create draft</button>
      </div>
      <p class="ce-hint">Link a Printify template product ID per section, then sync to import data into the catalog.</p>
      <div class="ce-tpl-sections">
        ${SECTIONS.map((s) => renderSection(s, printifyId)).join("")}
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
    if (status) status.textContent = err.message || "Sync failed";
    showToast("Sync failed", err.message || "Unknown error");
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    sectionEl?.classList.remove("ce-tpl-section--loading");
    const overlay = sectionEl?.querySelector(".ce-tpl-section__overlay");
    if (overlay) overlay.hidden = true;
  }
}

document.addEventListener("click", async (ev) => {
  const syncBtn = ev.target.closest(".ce-tpl-sync");
  const draftBtn = ev.target.closest("#ce-tpl-create-draft");
  if (!syncBtn && !draftBtn) return;

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
      const id = res?.printify_product_id ? String(res.printify_product_id) : "";
      if (id) {
        document.querySelectorAll("[data-section-input]").forEach((inp) => {
          if (!inp.value?.trim()) inp.value = id;
        });
      }
      await ctx.reloadTab?.();
      showToast("Draft created", id ? `Printify product ${id}` : "Template draft ready.");
    } catch (err) {
      showToast("Draft failed", err.message || "Unknown error");
    } finally {
      draftBtn.disabled = false;
    }
    return;
  }

  if (syncBtn) {
    await runSectionSync(syncBtn.dataset.section, ctx);
  }
});
