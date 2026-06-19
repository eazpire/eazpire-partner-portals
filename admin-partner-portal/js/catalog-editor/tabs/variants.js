import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchVariantsBundle, saveVariants } from "../api.js";

export async function loadVariantsTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return `<div class="ce-tab-panel"><p>Select an active provider above.</p></div>`;
  const data = await fetchVariantsBundle(ctx.productKey, pid);
  ctx.variantsData = data;
  const variants = Array.isArray(data.variants_json) ? data.variants_json : [];
  const configJson = JSON.stringify(data.variant_config || {}, null, 2);
  const variantPreview = variants
    .slice(0, 20)
    .map((v) => `<tr><td>${escapeHtml(v.title || v.id || "—")}</td><td>${escapeHtml(String(v.id ?? ""))}</td></tr>`)
    .join("");
  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Variant config · provider ${escapeHtml(pid)}</h3>
      <div class="field"><label>Variant config JSON</label>
        <textarea class="textarea ce-code" id="ce-variants-config" rows="12">${escapeHtml(configJson)}</textarea></div>
      <h3 class="ce-section-title">Source variants (${variants.length})</h3>
      <table class="data-table ce-table"><thead><tr><th>Title</th><th>ID</th></tr></thead>
        <tbody>${variantPreview || "<tr><td colspan=\"2\">No variants in publish profile.</td></tr>"}</tbody></table>
    </div>`;
}

export async function saveVariantsTab(ctx) {
  const pid = ctx.selectedPrintProviderId;
  if (!pid) return;
  let config = {};
  try {
    config = JSON.parse(document.getElementById("ce-variants-config")?.value || "{}");
  } catch {
    throw new Error("Invalid variant config JSON");
  }
  await saveVariants(ctx.productKey, pid, { config, auto_mirror: false });
}
