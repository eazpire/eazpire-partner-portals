import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveMeta } from "./api.js";

export function renderMetaTab(ctx) {
  const p = ctx.bundle.product;
  const profile = ctx.bundle.publish_profiles?.[0];
  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Product meta</h3>
      <div class="field"><label>Title</label><input class="input" id="ce-meta-title" value="${escapeHtml(p.title)}" /></div>
      <div class="field"><label>Catalog status</label>
        <select class="input" id="ce-meta-status">
          <option value="offline" ${p.catalog_status === "offline" ? "selected" : ""}>Offline</option>
          <option value="preview" ${p.catalog_status === "preview" ? "selected" : ""}>Preview</option>
          <option value="online" ${p.catalog_status === "online" ? "selected" : ""}>Online</option>
        </select>
      </div>
      <div class="field"><label>Regions (comma-separated)</label>
        <input class="input" id="ce-meta-regions" value="${escapeHtml((p.regions || []).join(", "))}" /></div>
      <div class="field"><label>Category group</label>
        <input class="input" id="ce-meta-cat-group" value="${escapeHtml(p.catalog_category_group || "")}" /></div>
      <div class="field"><label>Category leaf</label>
        <input class="input" id="ce-meta-cat-leaf" value="${escapeHtml(p.catalog_category_leaf || "")}" /></div>
      <div class="field"><label>Production type</label>
        <input class="input" id="ce-meta-prod-type" value="${escapeHtml(p.catalog_production_type || "")}" /></div>
      <div class="field"><label><input type="checkbox" id="ce-meta-use-mocks" ${p.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label></div>
      <h3 class="ce-section-title">Publish profile</h3>
      <div class="field"><label>Standard product display name</label>
        <input class="input" id="ce-meta-std-name" value="${escapeHtml(profile?.standard_product_display_name || "")}" /></div>
      <div class="field"><label>Product features</label>
        <textarea class="textarea" id="ce-meta-features" rows="3">${escapeHtml(profile?.product_features || "")}</textarea></div>
      <div class="field"><label>Care instructions</label>
        <textarea class="textarea" id="ce-meta-care" rows="2">${escapeHtml(profile?.care_instructions || "")}</textarea></div>
      <div class="field"><label>Size table HTML</label>
        <textarea class="textarea" id="ce-meta-size" rows="3">${escapeHtml(profile?.size_table_html || "")}</textarea></div>
      <div class="field"><label>GPSR HTML</label>
        <textarea class="textarea" id="ce-meta-gpsr" rows="2">${escapeHtml(profile?.gpsr_html || "")}</textarea></div>
    </div>`;
}

export async function saveMetaTab(ctx) {
  const printProviderId = ctx.selectedPrintProviderId || ctx.bundle.active_providers?.[0]?.print_provider_id;
  const regionsRaw = document.getElementById("ce-meta-regions")?.value || "";
  const regions = regionsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  await saveMeta(ctx.productKey, {
    title: document.getElementById("ce-meta-title")?.value,
    catalog_status: document.getElementById("ce-meta-status")?.value,
    regions,
    catalog_category_group: document.getElementById("ce-meta-cat-group")?.value || null,
    catalog_category_leaf: document.getElementById("ce-meta-cat-leaf")?.value || null,
    catalog_production_type: document.getElementById("ce-meta-prod-type")?.value || null,
    print_area_edit_use_mocks: document.getElementById("ce-meta-use-mocks")?.checked,
    print_provider_id: printProviderId,
    standard_product_display_name: document.getElementById("ce-meta-std-name")?.value || null,
    product_features: document.getElementById("ce-meta-features")?.value || null,
    care_instructions: document.getElementById("ce-meta-care")?.value || null,
    size_table_html: document.getElementById("ce-meta-size")?.value || null,
    gpsr_html: document.getElementById("ce-meta-gpsr")?.value || null,
    auto_mirror: false,
  });
}
