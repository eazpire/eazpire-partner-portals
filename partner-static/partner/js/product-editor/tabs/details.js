import { escapeHtml } from "/shared/js/partner-api.js";

const CATEGORIES = [
  { value: "apparel.tshirt", label: "T-Shirt" },
  { value: "apparel.hoodie", label: "Hoodie" },
  { value: "apparel.socks", label: "Socks" },
  { value: "wall_art.poster", label: "Poster" },
  { value: "home.mug", label: "Mug" },
  { value: "accessory.cap", label: "Cap" },
];

const DESIGN_TYPES = ["hero", "pattern", "logo", "photo"];
const CURRENCIES = ["EUR", "USD", "MAD", "GBP"];

export function renderDetailsTab(ctx) {
  const p = ctx.bundle?.product || {};
  const cat = p.normalized_category || p.category || "apparel.tshirt";
  const designTypes = new Set(p.design_types || []);
  const regions = (p.regions || []).join(", ");

  return `
    <div class="ce-tab-panel pe-details-panel">
      <h3 class="ce-section-title">Product details</h3>
      <p class="ce-hint">Title, SKU, category and shipping regions. Saved with the Details tab.</p>
      <div class="field"><label for="pe-product-title">Title</label>
        <input class="input" id="pe-product-title" value="${escapeHtml(p.title || "")}" required /></div>
      <div class="split-row">
        <div class="field"><label for="pe-product-sku">SKU base</label>
          <input class="input" id="pe-product-sku" value="${escapeHtml(p.sku_base || "")}" placeholder="TODIFY-TEE" /></div>
        <div class="field"><label for="pe-product-currency">Default currency</label>
          <select class="input" id="pe-product-currency">
            ${CURRENCIES.map((c) => `<option value="${c}" ${p.currency === c ? "selected" : ""}>${c}</option>`).join("")}
          </select></div>
      </div>
      <div class="field"><label for="pe-product-desc">Description</label>
        <textarea class="textarea" id="pe-product-desc" rows="4">${escapeHtml(p.description || "")}</textarea></div>
      <div class="field"><label for="pe-product-category">Category</label>
        <select class="input" id="pe-product-category">
          ${CATEGORIES.map((c) => `<option value="${c.value}" ${cat === c.value ? "selected" : ""}>${c.label}</option>`).join("")}
        </select></div>
      <div class="field"><label>Design types</label>
        <div class="pe-chip-row" id="pe-design-types">
          ${DESIGN_TYPES.map(
            (d) => `<label class="pe-chip"><input type="checkbox" value="${d}" ${designTypes.has(d) ? "checked" : ""} /> ${d}</label>`
          ).join("")}
        </div></div>
      <div class="field"><label for="pe-product-technique">Print technique</label>
        <input class="input" id="pe-product-technique" value="${escapeHtml(p.print_technique || "")}" placeholder="DTG, embroidery, …" /></div>
      <div class="field"><label for="pe-product-regions">Regions / ships to</label>
        <input class="input" id="pe-product-regions" value="${escapeHtml(regions)}" placeholder="EU, MA, FR (comma-separated)" /></div>
      ${p.status ? `<p class="ce-hint">Status: <span class="badge">${escapeHtml(p.status)}</span>
        ${p.review_note ? ` · Note: ${escapeHtml(p.review_note)}` : ""}
        ${p.eazpire_product_key ? ` · Catalog key: <code>${escapeHtml(p.eazpire_product_key)}</code>` : ""}</p>` : ""}
    </div>`;
}

export function snapshotDetailsTab() {
  const design_types = [...document.querySelectorAll("#pe-design-types input:checked")].map((el) => el.value);
  const regionsRaw = document.getElementById("pe-product-regions")?.value || "";
  const regions = regionsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    title: document.getElementById("pe-product-title")?.value?.trim() || "",
    sku_base: document.getElementById("pe-product-sku")?.value?.trim() || "",
    description: document.getElementById("pe-product-desc")?.value || "",
    category: document.getElementById("pe-product-category")?.value || "",
    design_types,
    print_technique: document.getElementById("pe-product-technique")?.value?.trim() || "",
    regions,
    currency: document.getElementById("pe-product-currency")?.value || "EUR",
  };
}

export function bindDetailsTab(ctx, root) {
  root?.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("input", () => ctx?.markDirty?.());
    el.addEventListener("change", () => ctx?.markDirty?.());
  });
}
