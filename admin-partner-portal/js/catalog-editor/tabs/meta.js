import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveMeta } from "../api.js";
import { bindTabDirtyInputs } from "../editor-tab-dirty.js";
import { publishProfileForProvider } from "../editor-product-title.js";

function resolveMetaProviderId(ctx) {
  return Number(
    ctx.selectedPrintProviderId ||
      ctx.bundle.active_providers?.[0]?.print_provider_id ||
      ctx.bundle.publish_profiles?.[0]?.print_provider_id
  ) || null;
}

export function renderMetaTab(ctx) {
  const providerId = resolveMetaProviderId(ctx);
  const profile = publishProfileForProvider(ctx.bundle, providerId);

  return `
    <div class="ce-tab-panel ce-meta-panel">
      <section class="ce-meta-card ce-meta-card--shop">
        <h3 class="ce-section-title">Shop listing content</h3>
        <p class="ce-hint">Texts and Shopify category for the selected print provider. Product title and visibility are set per version on the Provider tab and in the footer.</p>
        <div class="field">
          <label for="ce-meta-shopify-cat">Shopify category ID</label>
          <input class="input" id="ce-meta-shopify-cat" value="${escapeHtml(profile?.shopify_category_id || "")}" placeholder="e.g. gid://shopify/TaxonomyCategory/…" />
        </div>
        <div class="field">
          <label for="ce-meta-features">Product features</label>
          <textarea class="textarea" id="ce-meta-features" rows="4" placeholder="HTML or plain text">${escapeHtml(profile?.product_features || "")}</textarea>
        </div>
        <div class="field">
          <label for="ce-meta-care">Care instructions</label>
          <textarea class="textarea" id="ce-meta-care" rows="3">${escapeHtml(profile?.care_instructions || "")}</textarea>
        </div>
        <div class="field">
          <label for="ce-meta-size">Size table HTML</label>
          <textarea class="textarea" id="ce-meta-size" rows="3">${escapeHtml(profile?.size_table_html || "")}</textarea>
        </div>
        <div class="field">
          <label for="ce-meta-gpsr">GPSR HTML</label>
          <textarea class="textarea" id="ce-meta-gpsr" rows="2">${escapeHtml(profile?.gpsr_html || "")}</textarea>
        </div>
        <input type="hidden" id="ce-meta-provider-id" value="${escapeHtml(String(providerId || ""))}" />
      </section>
    </div>`;
}

export function snapshotMetaTab() {
  const el = (id) => document.getElementById(id);
  return {
    print_provider_id: Number(el("ce-meta-provider-id")?.value) || null,
    shopify_category_id: el("ce-meta-shopify-cat")?.value || null,
    product_features: el("ce-meta-features")?.value || null,
    care_instructions: el("ce-meta-care")?.value || null,
    size_table_html: el("ce-meta-size")?.value || null,
    gpsr_html: el("ce-meta-gpsr")?.value || null,
  };
}

export function bindMetaTab(ctx, root) {
  bindTabDirtyInputs(root, ctx);
}

export async function saveMetaTab(ctx) {
  const snap = snapshotMetaTab();
  const printProviderId =
    snap.print_provider_id ||
    ctx.selectedPrintProviderId ||
    ctx.bundle.active_providers?.[0]?.print_provider_id;

  await saveMeta(ctx.productKey, {
    print_provider_id: printProviderId,
    shopify_category_id: snap.shopify_category_id,
    product_features: snap.product_features,
    care_instructions: snap.care_instructions,
    size_table_html: snap.size_table_html,
    gpsr_html: snap.gpsr_html,
    auto_mirror: false,
  });
}
