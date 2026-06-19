import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchMockupsBundle, saveMockups } from "../api.js";

export async function loadMockupsTab(ctx) {
  const data = await fetchMockupsBundle(ctx.productKey, ctx.selectedPrintProviderId);
  ctx.mockupsData = data;
  const images = (data.images || []).slice(0, 40);
  const imageRows = images
    .map(
      (img) => `<tr>
        <td>${escapeHtml(img.view_key)}</td>
        <td>${escapeHtml(img.color_name)}</td>
        <td><a href="${escapeHtml(img.image_url)}" target="_blank" rel="noopener">View</a></td>
        <td>${img.is_default ? "Default" : ""}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="ce-tab-panel">
      <div class="field"><label><input type="checkbox" id="ce-mock-use-mocks" ${data.product?.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label></div>
      <h3 class="ce-section-title">Mockup images (${images.length})</h3>
      <table class="data-table ce-table"><thead><tr><th>View</th><th>Color</th><th>Image</th><th></th></tr></thead>
        <tbody>${imageRows || "<tr><td colspan=\"4\">No mockup images imported yet.</td></tr>"}</tbody></table>
      <p class="ce-hint">${(data.mockup_defaults || []).length} print area default(s) configured.</p>
    </div>`;
}

export async function saveMockupsTab(ctx) {
  await saveMockups(ctx.productKey, {
    print_area_edit_use_mocks: document.getElementById("ce-mock-use-mocks")?.checked,
    auto_mirror: false,
  });
}
