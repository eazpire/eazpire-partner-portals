import { escapeHtml } from "/shared/js/partner-api.js";

export function renderMetaTab(ctx) {
  const meta = ctx.bundle?.product?.meta || {};
  const title = ctx.bundle?.product?.title || "";

  return `
    <div class="ce-tab-panel pe-meta-panel">
      <h3 class="ce-section-title">Product meta</h3>
      <p class="ce-hint">Shop listing content used after admin approve. Display name is required for review.</p>
      <div class="field"><label for="pe-meta-display">Display name</label>
        <input class="input" id="pe-meta-display" value="${escapeHtml(meta.display_name || title)}" /></div>
      <div class="field"><label for="pe-meta-features">Product features</label>
        <textarea class="textarea" id="pe-meta-features" rows="4">${escapeHtml(meta.product_features || "")}</textarea></div>
      <div class="field"><label for="pe-meta-care">Care instructions</label>
        <textarea class="textarea" id="pe-meta-care" rows="3">${escapeHtml(meta.care_instructions || "")}</textarea></div>
      <div class="field"><label for="pe-meta-size">Size table HTML</label>
        <textarea class="textarea" id="pe-meta-size" rows="3">${escapeHtml(meta.size_table_html || "")}</textarea></div>
      <div class="field"><label for="pe-meta-gpsr">GPSR / material</label>
        <textarea class="textarea" id="pe-meta-gpsr" rows="2">${escapeHtml(meta.gpsr_html || "")}</textarea></div>
      <div class="field"><label for="pe-meta-origin">Country of origin</label>
        <input class="input" id="pe-meta-origin" value="${escapeHtml(meta.country_of_origin || "")}" placeholder="MA" /></div>
    </div>`;
}

export function snapshotMetaTab() {
  return {
    display_name: document.getElementById("pe-meta-display")?.value?.trim() || "",
    product_features: document.getElementById("pe-meta-features")?.value || "",
    care_instructions: document.getElementById("pe-meta-care")?.value || "",
    size_table_html: document.getElementById("pe-meta-size")?.value || "",
    gpsr_html: document.getElementById("pe-meta-gpsr")?.value || "",
    country_of_origin: document.getElementById("pe-meta-origin")?.value?.trim() || "",
  };
}

export function bindMetaTab(ctx, root) {
  root?.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("input", () => ctx.markDirty?.());
  });
}
