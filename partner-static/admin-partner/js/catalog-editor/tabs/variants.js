import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchVariantsBundle, saveVariants, refreshVariantsFromTemplate } from "../api.js";
import { buildVariantMatrixHtml, collectVariantConfigFromDom } from "../utils/variant-matrix.js";

export async function loadVariantsTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return `<div class="ce-tab-panel"><p>Select an active provider above.</p></div>`;
  const data = await fetchVariantsBundle(ctx.productKey, pid);
  ctx.variantsData = data;
  const productData = data.product_data || { variants: data.variants_json || [] };
  const matrixHtml = buildVariantMatrixHtml(productData, data.variant_config, data.prices_json);
  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Variant config · provider ${escapeHtml(pid)}</h3>
      <div class="ce-inline-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="ce-variants-refresh-template">Refresh from template</button>
      </div>
      ${matrixHtml}
      <div class="field"><label>Raw variants JSON (optional manual override)</label>
        <textarea class="textarea ce-code" id="ce-variants-json" rows="8">${escapeHtml(
          JSON.stringify(data.variants_json || [], null, 2)
        )}</textarea></div>
    </div>`;
}

export async function saveVariantsTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return;
  const config = collectVariantConfigFromDom(document);
  let variantsJson = null;
  const raw = document.getElementById("ce-variants-json")?.value?.trim();
  if (raw) {
    try {
      variantsJson = JSON.parse(raw);
    } catch {
      throw new Error("Invalid variants JSON");
    }
  }
  await saveVariants(ctx.productKey, pid, { config, variants_json: variantsJson, auto_mirror: false });
}

document.addEventListener("click", async (ev) => {
  const refreshBtn = ev.target.closest("#ce-variants-refresh-template");
  const applyGlobal = ev.target.closest("#ce-vm-apply-global");
  if (applyGlobal) {
    const mode = document.getElementById("ce-vm-global-mode")?.value || "percent";
    const val = document.getElementById("ce-vm-global-value")?.value || "30";
    const branding = document.getElementById("ce-vm-global-branding")?.value || "black";
    document.querySelectorAll(".ce-vm-mode").forEach((n) => {
      n.value = mode;
    });
    document.querySelectorAll(".ce-vm-margin").forEach((n) => {
      n.value = val;
    });
    document.querySelectorAll(".ce-vm-branding").forEach((n) => {
      n.value = branding;
    });
    return;
  }
  if (!refreshBtn) return;
  const shellCtx = window.__catalogEditorState;
  if (!shellCtx?.productKey || !shellCtx?.selectedPrintProviderId) return;
  refreshBtn.disabled = true;
  try {
    const templateId =
      shellCtx.templateData?.template?.printify_product_id ||
      shellCtx.templateData?.version?.external_template_product_id ||
      "";
    if (!templateId) throw new Error("No template product linked.");
    await refreshVariantsFromTemplate({
      product_key: shellCtx.productKey,
      print_provider_id: shellCtx.selectedPrintProviderId,
      printify_product_id: templateId,
      auto_mirror: false,
    });
    await shellCtx.reloadTab?.();
  } finally {
    refreshBtn.disabled = false;
  }
});
