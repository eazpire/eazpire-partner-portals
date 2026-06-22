import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveMeta } from "../api.js";
import { getActiveProviderIds, providerLabel } from "../editor-subnav.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";
import { publishProfileForProvider } from "../editor-product-title.js";

function renderMetaProviderPills(ctx) {
  const providerIds = getActiveProviderIds(ctx);
  if (providerIds.length <= 1) return "";
  const selected = String(ctx.metaSelectedProviderId || ctx.selectedPrintProviderId || providerIds[0]);
  const pills = providerIds
    .map((pid) => {
      const active = String(pid) === selected ? " active" : "";
      return `<button type="button" class="ce-meta-provider-pill${active}" data-pid="${escapeHtml(pid)}">${escapeHtml(providerLabel(ctx, pid))}</button>`;
    })
    .join("");
  return `
    <nav class="ce-meta-provider-nav" aria-label="Print provider">
      <span class="catalog-editor-subnav-label">Print provider</span>
      <div class="ce-meta-provider-pills">${pills}</div>
    </nav>`;
}

function resolveMetaProviderId(ctx) {
  const providerIds = getActiveProviderIds(ctx);
  const fallback =
    ctx.metaSelectedProviderId ||
    ctx.selectedPrintProviderId ||
    providerIds[0] ||
    ctx.bundle.publish_profiles?.[0]?.print_provider_id;
  return Number(fallback) || null;
}

export function renderMetaTab(ctx) {
  const p = ctx.bundle.product;
  const providerId = resolveMetaProviderId(ctx);
  const profile = publishProfileForProvider(ctx.bundle, providerId);

  return `
    <div class="ce-tab-panel ce-meta-panel">
      <div class="ce-meta-layout">
        <section class="ce-meta-card">
          <h3 class="ce-section-title">Visibility</h3>
          <p class="ce-hint">Controls whether creators can see this product in the catalog.</p>
          <div class="ce-meta-status-pills" role="radiogroup" aria-label="Catalog status">
            ${["offline", "preview", "online"]
              .map((status) => {
                const on = (p.catalog_status || "offline") === status;
                const label = status.charAt(0).toUpperCase() + status.slice(1);
                return `<button type="button" class="ce-meta-status-pill${on ? " active" : ""}" data-status="${status}" role="radio" aria-checked="${on ? "true" : "false"}">${escapeHtml(label)}</button>`;
              })
              .join("")}
          </div>
          <input type="hidden" id="ce-meta-status" value="${escapeHtml(p.catalog_status || "offline")}" />
        </section>

        <section class="ce-meta-card ce-meta-card--shop">
          <h3 class="ce-section-title">Shop listing content</h3>
          <p class="ce-hint">Texts and category used when publishing to Shopify. Product title is set per version on the Provider tab.</p>
          ${renderMetaProviderPills(ctx)}
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
      </div>
    </div>`;
}

export function snapshotMetaTab() {
  const el = (id) => document.getElementById(id);
  return {
    catalog_status: el("ce-meta-status")?.value ?? "",
    print_provider_id: Number(el("ce-meta-provider-id")?.value) || null,
    shopify_category_id: el("ce-meta-shopify-cat")?.value || null,
    product_features: el("ce-meta-features")?.value || null,
    care_instructions: el("ce-meta-care")?.value || null,
    size_table_html: el("ce-meta-size")?.value || null,
    gpsr_html: el("ce-meta-gpsr")?.value || null,
  };
}

export function bindMetaTab(ctx, root) {
  root.querySelectorAll(".ce-meta-status-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = btn.dataset.status;
      const hidden = root.querySelector("#ce-meta-status");
      if (hidden) hidden.value = status;
      root.querySelectorAll(".ce-meta-status-pill").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      notifyActiveTabDirty(ctx);
    });
  });

  root.querySelectorAll(".ce-meta-provider-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.pid;
      if (!pid || String(pid) === String(ctx.metaSelectedProviderId)) return;
      ctx.metaSelectedProviderId = pid;
      ctx.reloadTab();
    });
  });

  bindTabDirtyInputs(root, ctx);
}

export async function saveMetaTab(ctx) {
  const snap = snapshotMetaTab();
  const printProviderId =
    snap.print_provider_id ||
    ctx.metaSelectedProviderId ||
    ctx.selectedPrintProviderId ||
    ctx.bundle.active_providers?.[0]?.print_provider_id;

  await saveMeta(ctx.productKey, {
    catalog_status: snap.catalog_status,
    print_provider_id: printProviderId,
    shopify_category_id: snap.shopify_category_id,
    product_features: snap.product_features,
    care_instructions: snap.care_instructions,
    size_table_html: snap.size_table_html,
    gpsr_html: snap.gpsr_html,
    auto_mirror: false,
  });
}
