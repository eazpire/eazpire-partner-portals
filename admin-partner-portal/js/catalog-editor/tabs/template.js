import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchTemplateBundle, saveTemplate } from "../api.js";

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
      <div class="field"><label>Printify product ID</label>
        <input class="input" id="ce-tpl-id" value="${escapeHtml(tpl?.printify_product_id || version?.external_template_product_id || "")}" /></div>
      <div class="field"><label>Title</label>
        <input class="input" id="ce-tpl-title" value="${escapeHtml(tpl?.title || version?.display_name || "")}" /></div>
      <p class="ce-hint">Link an existing Printify template product ID or save after creating one in Printify.</p>
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
