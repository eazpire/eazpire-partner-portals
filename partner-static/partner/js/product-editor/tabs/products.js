import { escapeHtml } from "/shared/js/partner-api.js";

/**
 * Products tab — Shopify listing grid (V1 stub until publish creates rows).
 * After approve, shows catalog key + empty Shopify grid ready for future listings.
 */
export async function renderProductsTab(ctx) {
  const p = ctx.bundle?.product || {};
  const key = p.eazpire_product_key;
  const listings = ctx.shopifyListings || [];

  if (!key && p.status !== "approved") {
    return `
      <div class="ce-tab-panel pe-products-panel">
        <h3 class="ce-section-title">Shopify listings</h3>
        <div class="empty-state">
          <div class="icon">▤</div>
          <h3>Available after publish</h3>
          <p>Submit for review, then admin approves into the catalog. Creator publishes create Shopify listings that appear in this grid.</p>
        </div>
      </div>`;
  }

  const cards =
    listings.length > 0
      ? listings
          .map(
            (row) => `<article class="pe-products-card">
          <div class="pe-products-card__thumb">${
            row.image_url
              ? `<img src="${escapeHtml(row.image_url)}" alt="" />`
              : "No image"
          }</div>
          <div class="pe-products-card__body">
            <strong>${escapeHtml(row.title || row.design_id || "Listing")}</strong>
            <span class="badge badge-success">Shopify</span>
            <div class="ce-hint">${row.published_at ? escapeHtml(new Date(row.published_at).toLocaleDateString()) : "—"}</div>
          </div>
        </article>`
          )
          .join("")
      : `<div class="empty-state" style="grid-column:1/-1">
          <div class="icon">▤</div>
          <h3>No Shopify listings yet</h3>
          <p>Grid is ready. Listings appear here after designs are published to Shopify for this catalog product.</p>
        </div>`;

  return `
    <div class="ce-tab-panel pe-products-panel">
      <h3 class="ce-section-title">Shopify listings</h3>
      ${
        key
          ? `<p class="ce-hint">Catalog key: <code>${escapeHtml(key)}</code> · Admin status: preview until margin/branding/online are set in Catalog Studio.</p>`
          : `<p class="ce-hint">Product approved — catalog key pending sync.</p>`
      }
      <div class="pe-products-grid">${cards}</div>
    </div>`;
}

export function bindProductsTab() {
  /* read-only */
}

export async function saveProductsTab() {
  /* no-op */
}
