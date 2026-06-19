import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveMeta } from "../api.js";

const COMMON_COUNTRIES = ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "PL", "CZ", "US", "CA", "GB", "UK"];

export function renderMetaTab(ctx) {
  const p = ctx.bundle.product;
  const providerId = Number(
    ctx.selectedPrintProviderId ||
      ctx.bundle.active_providers?.[0]?.print_provider_id ||
      ctx.bundle.publish_profiles?.[0]?.print_provider_id
  );
  const profile = (ctx.bundle.publish_profiles || []).find(
    (r) => Number(r.print_provider_id) === providerId
  ) || ctx.bundle.publish_profiles?.[0];
  const plan = (ctx.bundle.publish_plans || []).find((r) => {
    const pp = Number(r?.profile?.print_provider_id ?? r?.print_provider_id);
    return pp === providerId;
  });
  let countries = [];
  try {
    countries = JSON.parse(plan?.country_codes_json || "[]");
  } catch {
    countries = [];
  }

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
      <div class="field"><label>Visible design types (comma-separated)</label>
        <input class="input" id="ce-meta-vdt" value="${escapeHtml((p.visible_design_types || []).join(", "))}" /></div>
      <div class="field"><label>Catalog audience</label>
        <input class="input" id="ce-meta-audience" value="${escapeHtml((p.catalog_audience || []).join(", "))}" /></div>
      <div class="field"><label>Category group</label>
        <input class="input" id="ce-meta-cat-group" value="${escapeHtml(p.catalog_category_group || "")}" /></div>
      <div class="field"><label>Category leaf</label>
        <input class="input" id="ce-meta-cat-leaf" value="${escapeHtml(p.catalog_category_leaf || "")}" /></div>
      <div class="field"><label>Production type</label>
        <input class="input" id="ce-meta-prod-type" value="${escapeHtml(p.catalog_production_type || "")}" /></div>
      <div class="field"><label><input type="checkbox" id="ce-meta-use-mocks" ${p.print_area_edit_use_mocks ? "checked" : ""} /> Print area edit uses mockups</label></div>

      <h3 class="ce-section-title">Publish profile</h3>
      <p class="ce-hint">Selected provider: ${escapeHtml(String(providerId || "n/a"))}</p>
      <div class="field"><label>Shopify category ID</label>
        <input class="input" id="ce-meta-shopify-cat" value="${escapeHtml(profile?.shopify_category_id || "")}" /></div>
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

      <h3 class="ce-section-title">Publish plan</h3>
      <div class="field"><label>Enabled</label>
        <input type="checkbox" id="ce-meta-plan-enabled" ${Number(plan?.is_enabled ?? 1) === 1 ? "checked" : ""}></div>
      <div class="field"><label>Priority</label>
        <input class="input" id="ce-meta-plan-priority" value="${escapeHtml(String(plan?.priority ?? 100))}"></div>
      <div class="field"><label>Country of origin</label>
        <input class="input" id="ce-meta-origin" value="${escapeHtml(plan?.country_of_origin || "")}"></div>
      <div class="field">
        <label>Countries</label>
        <button type="button" class="btn btn-secondary btn-sm" id="ce-meta-country-open">Open country picker</button>
        <input type="hidden" id="ce-meta-countries" value="${escapeHtml(countries.join(","))}">
        <div id="ce-meta-country-preview" class="ce-hint">${escapeHtml(countries.join(", ") || "No countries selected")}</div>
      </div>
      <div id="ce-meta-country-modal" class="ce-inline-modal" hidden>
        <div class="ce-inline-modal-card">
          <h4>Select countries</h4>
          <div class="ce-country-list">
            ${COMMON_COUNTRIES.map((cc) => {
              const checked = countries.includes(cc) ? "checked" : "";
              return `<label><input type="checkbox" class="ce-country-check" value="${cc}" ${checked}> ${cc}</label>`;
            }).join("")}
          </div>
          <div class="ce-inline-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="ce-meta-country-cancel">Close</button>
            <button type="button" class="btn btn-primary btn-sm" id="ce-meta-country-apply">Apply</button>
          </div>
        </div>
      </div>
    </div>`;
}

export async function saveMetaTab(ctx) {
  const printProviderId =
    ctx.selectedPrintProviderId || ctx.bundle.active_providers?.[0]?.print_provider_id;
  const regionsRaw = document.getElementById("ce-meta-regions")?.value || "";
  const regions = regionsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const visibleDesignTypes = (document.getElementById("ce-meta-vdt")?.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const catalogAudience = (document.getElementById("ce-meta-audience")?.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const countryCodes = (document.getElementById("ce-meta-countries")?.value || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  await saveMeta(ctx.productKey, {
    title: document.getElementById("ce-meta-title")?.value,
    catalog_status: document.getElementById("ce-meta-status")?.value,
    regions,
    visible_design_types: visibleDesignTypes,
    catalog_audience: catalogAudience,
    catalog_category_group: document.getElementById("ce-meta-cat-group")?.value || null,
    catalog_category_leaf: document.getElementById("ce-meta-cat-leaf")?.value || null,
    catalog_production_type: document.getElementById("ce-meta-prod-type")?.value || null,
    print_area_edit_use_mocks: document.getElementById("ce-meta-use-mocks")?.checked,
    print_provider_id: printProviderId,
    shopify_category_id: document.getElementById("ce-meta-shopify-cat")?.value || null,
    standard_product_display_name: document.getElementById("ce-meta-std-name")?.value || null,
    product_features: document.getElementById("ce-meta-features")?.value || null,
    care_instructions: document.getElementById("ce-meta-care")?.value || null,
    size_table_html: document.getElementById("ce-meta-size")?.value || null,
    gpsr_html: document.getElementById("ce-meta-gpsr")?.value || null,
    publish_plan: {
      provider_name:
        (ctx.bundle.publish_plans || []).find((x) => {
          const pp = Number(x?.profile?.print_provider_id ?? x?.print_provider_id);
          return pp === Number(printProviderId);
        })?.provider_name || "",
      country_codes: countryCodes,
      priority: Number(document.getElementById("ce-meta-plan-priority")?.value || 100),
      is_enabled: !!document.getElementById("ce-meta-plan-enabled")?.checked,
      country_of_origin: (document.getElementById("ce-meta-origin")?.value || "").trim().toUpperCase() || null,
    },
    auto_mirror: false,
  });
}

document.addEventListener("click", (ev) => {
  const open = ev.target.closest("#ce-meta-country-open");
  const close = ev.target.closest("#ce-meta-country-cancel");
  const apply = ev.target.closest("#ce-meta-country-apply");
  const modal = document.getElementById("ce-meta-country-modal");
  if (!modal) return;

  if (open) {
    modal.hidden = false;
    return;
  }
  if (close) {
    modal.hidden = true;
    return;
  }
  if (apply) {
    const vals = [...document.querySelectorAll(".ce-country-check:checked")].map((n) => n.value);
    const hidden = document.getElementById("ce-meta-countries");
    const preview = document.getElementById("ce-meta-country-preview");
    if (hidden) hidden.value = vals.join(",");
    if (preview) preview.textContent = vals.join(", ") || "No countries selected";
    modal.hidden = true;
  }
});
