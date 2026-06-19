import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchMockupsBundle, saveMockups, fetchPrintifyMockups } from "../api.js";

export async function loadMockupsTab(ctx) {
  const data = await fetchMockupsBundle(ctx.productKey, ctx.selectedPrintProviderId);
  ctx.mockupsData = data;
  const images = data.images || [];
  const imageRows = images
    .map((img) => {
      let previewIds = [];
      try {
        previewIds = JSON.parse(img.preview_template_ids_json || "[]");
      } catch {
        previewIds = [];
      }
      return `<tr>
        <td>${escapeHtml(img.view_key)}</td>
        <td>${escapeHtml(img.color_name)}</td>
        <td><a href="${escapeHtml(img.image_url)}" target="_blank" rel="noopener">View</a></td>
        <td><input type="checkbox" class="ce-mock-default" data-id="${escapeHtml(img.id)}" ${
          Number(img.is_default) === 1 ? "checked" : ""
        }></td>
        <td><input class="input input-sm ce-mock-preview-ids" data-id="${escapeHtml(img.id)}" value="${escapeHtml(String((previewIds || []).join(",")))}"></td>
      </tr>`;
    })
    .join("");

  const vrRows = (data.view_random || [])
    .map((row) => {
      let ids = [];
      try {
        ids = JSON.parse(row.template_ids_json || "[]");
      } catch {
        ids = [];
      }
      return `<tr><td>${escapeHtml(row.view_key)}</td><td><input class="input input-sm ce-vr-ids" data-view="${escapeHtml(
        row.view_key
      )}" value="${escapeHtml(ids.join(","))}"></td></tr>`;
    })
    .join("");

  return `
    <div class="ce-tab-panel">
      <div class="ce-inline-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="ce-mock-fetch-printify">Fetch from Printify</button>
      </div>
      <div class="field"><label><input type="checkbox" id="ce-mock-use-mocks" ${data.product?.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label></div>
      <h3 class="ce-section-title">Mockup images (${images.length})</h3>
      <table class="data-table ce-table"><thead><tr><th>View</th><th>Color</th><th>Image</th><th>Default</th><th>Preview template IDs</th></tr></thead>
        <tbody>${imageRows || "<tr><td colspan=\"5\">No mockup images imported yet.</td></tr>"}</tbody></table>
      <h3 class="ce-section-title">View random rules</h3>
      <table class="data-table ce-table"><thead><tr><th>View</th><th>Template IDs</th></tr></thead>
        <tbody>${vrRows || '<tr><td colspan="2">No rules configured.</td></tr>'}</tbody></table>
      <p class="ce-hint">${(data.mockup_defaults || []).length} print area default(s) configured.</p>
    </div>`;
}

export async function saveMockupsTab(ctx) {
  const image_rules = [...document.querySelectorAll(".ce-mock-preview-ids")].map((inp) => ({
    id: inp.getAttribute("data-id"),
    preview_template_ids: String(inp.value || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  }));
  const view_random_rules = [...document.querySelectorAll(".ce-vr-ids")].map((inp) => ({
    view_key: inp.getAttribute("data-view"),
    template_ids: String(inp.value || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  }));
  await saveMockups(ctx.productKey, {
    print_area_edit_use_mocks: document.getElementById("ce-mock-use-mocks")?.checked,
    image_rules,
    view_random_rules,
    auto_mirror: false,
  });
}

document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("#ce-mock-fetch-printify");
  if (!btn) return;
  const ctx = window.__catalogEditorState;
  if (!ctx?.productKey || !ctx?.selectedPrintProviderId) return;
  const printifyProductId =
    ctx.templateData?.template?.printify_product_id ||
    ctx.templateData?.version?.external_template_product_id ||
    "";
  if (!printifyProductId) return;
  btn.disabled = true;
  try {
    await fetchPrintifyMockups({
      product_key: ctx.productKey,
      print_provider_id: ctx.selectedPrintProviderId,
      printify_product_id: printifyProductId,
      auto_mirror: false,
    });
    await ctx.reloadTab?.();
  } finally {
    btn.disabled = false;
  }
});
