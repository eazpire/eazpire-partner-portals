import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchVariantsBundle, saveVariants } from "../api.js";
import { buildVariantMatrixHtml, collectVariantConfigFromDom, bindVariantMatrixEvents } from "../utils/variant-matrix.js";
import { notifyActiveTabDirty } from "../editor-tab-dirty.js";
import { markEditorDirty } from "../editor-dirty.js";

/** Stable JSON for variant-config dirty checks (ignores visibility footer state). */
export function stableVariantConfigJson(root) {
  const config = collectVariantConfigFromDom(root || document);
  const keys = Object.keys(config.variants || {}).sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
  const variants = {};
  for (const key of keys) variants[key] = config.variants[key];
  return JSON.stringify({ global: config.global, variants });
}

export function captureVariantsTabBaseline(ctx, root) {
  if (!ctx) return;
  ctx.variantsDirtyBaseline = stableVariantConfigJson(root || document);
}

export async function loadVariantsTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return `<div class="ce-tab-panel"><p>Select an active provider above.</p></div>`;
  const data = await fetchVariantsBundle(ctx.productKey, pid);
  ctx.variantsData = data;
  const productData = data.product_data || { variants: data.variants_json || [] };
  const matrixHtml = buildVariantMatrixHtml(productData, data.variant_config, data.prices_json, pid);
  return `
    <div class="ce-tab-panel ce-variants-panel">
      <h3 class="ce-section-title">Variant config · provider ${escapeHtml(pid)}</h3>
      <p class="ce-hint">Configure margins and branding per color. Sync variant data from Printify on the Templates tab.</p>
      ${matrixHtml}
    </div>`;
}

export function snapshotVariantsTab() {
  return collectVariantConfigFromDom(document);
}

export function bindVariantsTab(ctx, root) {
  captureVariantsTabBaseline(ctx, root);
  const notifyDirty = () => {
    const current = stableVariantConfigJson(root || document);
    const variantChanged =
      ctx?.variantsDirtyBaseline != null && current !== ctx.variantsDirtyBaseline;
    if (variantChanged) {
      markEditorDirty();
      return;
    }
    // Reverted to loaded config — fall back to full tab snapshot (e.g. visibility-only dirty).
    notifyActiveTabDirty(ctx);
  };
  bindVariantMatrixEvents(root || document, notifyDirty);
}

export async function saveVariantsTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return;
  const config = collectVariantConfigFromDom(document);
  await saveVariants(ctx.productKey, pid, { config, auto_mirror: false });
}
