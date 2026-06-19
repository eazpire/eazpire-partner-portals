import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchPrintAreaBundle, savePrintAreaSnapshot } from "../api.js";

export async function loadPrintAreaTab(ctx) {
  const data = await fetchPrintAreaBundle(ctx.productKey, ctx.selectedPrintProviderId, ctx.selectedVersionId);
  ctx.printAreaData = data;
  const version = data.version;
  const studioJson = JSON.stringify(version?.studio_config || {}, null, 2);
  const qrJson = JSON.stringify(version?.qr_logo_snapshot || {}, null, 2);
  const versionOptions = (data.versions || [])
    .map(
      (v) =>
        `<option value="${escapeHtml(v.id)}" ${v.id === version?.id ? "selected" : ""}>${escapeHtml(v.display_name)} (${escapeHtml(v.external_provider_id || v.provider_name || "")})</option>`
    )
    .join("");
  return `
    <div class="ce-tab-panel">
      <div class="field"><label>Product version</label>
        <select class="input" id="ce-pa-version">${versionOptions}</select></div>
      <div class="field"><label>Studio config JSON</label>
        <textarea class="textarea ce-code" id="ce-pa-studio" rows="10">${escapeHtml(studioJson)}</textarea></div>
      <div class="field"><label>QR / logo snapshot JSON</label>
        <textarea class="textarea ce-code" id="ce-pa-qr" rows="8">${escapeHtml(qrJson)}</textarea></div>
      <p class="ce-hint">${(data.mockup_defaults || []).length} mockup default(s), ${(data.variant_print_areas || []).length} variant print area(s).</p>
    </div>`;
}

export function bindPrintAreaTab(ctx, root) {
  root.querySelector("#ce-pa-version")?.addEventListener("change", (e) => {
    ctx.selectedVersionId = e.target.value;
    ctx.reloadTab();
  });
}

export async function savePrintAreaTab(ctx) {
  const versionId = document.getElementById("ce-pa-version")?.value || ctx.selectedVersionId;
  if (!versionId) return;
  let studio_config = {};
  let qr_logo_snapshot = null;
  try {
    studio_config = JSON.parse(document.getElementById("ce-pa-studio")?.value || "{}");
    const qrRaw = document.getElementById("ce-pa-qr")?.value?.trim();
    if (qrRaw) qr_logo_snapshot = JSON.parse(qrRaw);
  } catch {
    throw new Error("Invalid print area JSON");
  }
  await savePrintAreaSnapshot(versionId, { studio_config, qr_logo_snapshot, auto_mirror: false });
}
