import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  fetchTemplateBundle,
  saveTemplate,
  createTemplateDraft,
  refreshVariantsFromTemplate,
} from "../api.js";

export async function loadTemplateTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return `<div class="ce-tab-panel"><p>Select an active provider above.</p></div>`;
  const data = await fetchTemplateBundle(ctx.productKey, pid);
  ctx.templateData = data;
  const tpl = data.template;
  const version = data.version;
  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Printify template · provider ${escapeHtml(pid)}</h3>
      <div class="ce-inline-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="ce-tpl-create-draft">Create draft</button>
        <button type="button" class="btn btn-secondary btn-sm" id="ce-tpl-update-printify">Update from Printify</button>
      </div>
      <div class="field"><label>Printify product ID</label>
        <input class="input" id="ce-tpl-id" value="${escapeHtml(tpl?.printify_product_id || version?.external_template_product_id || "")}" /></div>
      <div class="field"><label>Title</label>
        <input class="input" id="ce-tpl-title" value="${escapeHtml(tpl?.title || version?.display_name || "")}" /></div>
      <p class="ce-hint">Link an existing Printify template product ID or create a new draft from blueprint/provider variants.</p>
    </div>`;
}

export async function saveTemplateTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return;
  await saveTemplate(ctx.productKey, pid, {
    printify_product_id: document.getElementById("ce-tpl-id")?.value?.trim(),
    title: document.getElementById("ce-tpl-title")?.value?.trim(),
    auto_mirror: false,
  });
}

document.addEventListener("click", async (ev) => {
  const draftBtn = ev.target.closest("#ce-tpl-create-draft");
  const refreshBtn = ev.target.closest("#ce-tpl-update-printify");
  if (!draftBtn && !refreshBtn) return;

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
      const inp = document.getElementById("ce-tpl-id");
      if (inp && res?.printify_product_id) inp.value = String(res.printify_product_id);
      await ctx.reloadTab?.();
    } finally {
      draftBtn.disabled = false;
    }
  }

  if (refreshBtn) {
    refreshBtn.disabled = true;
    try {
      const printifyProductId = document.getElementById("ce-tpl-id")?.value?.trim();
      if (!printifyProductId) throw new Error("Printify product ID required.");
      await refreshVariantsFromTemplate({
        product_key: ctx.productKey,
        print_provider_id: ctx.selectedPrintProviderId,
        printify_product_id: printifyProductId,
        auto_mirror: false,
      });
      await ctx.reloadTab?.();
    } finally {
      refreshBtn.disabled = false;
    }
  }
});
