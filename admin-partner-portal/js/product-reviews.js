/**
 * Admin: Partner product review queue → opens Catalog Product Editor on Review tab
 */
import { partnerFetch, badgeForStatus, escapeHtml } from "/partner/shared/js/partner-api.js";
import { renderTable } from "/partner/shared/js/partner-shell.js";
import { openProductEditor } from "./catalog-editor/shell.js";

export async function renderPartnerProductReviews(container) {
  if (!container) return;
  let products = [];
  try {
    const data = await partnerFetch("admin-manufacturer-product-list", {
      query: { status: "pending_review" },
    });
    products = data.products || [];
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Could not load product reviews: ${escapeHtml(e.message)}</p></div>`;
    return;
  }

  if (!products.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">▦</div><h3>No products pending</h3><p>Partner product submissions for catalog approve will appear here.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Partner product review</h2>
          <p class="panel-subtitle">Opens the catalog product editor on the Review tab. Approve creates a catalog draft (preview). A review note is required.</p>
        </div>
        <span class="badge badge-warning">${products.length}</span>
      </div>
      ${renderTable(
        ["Product", "Manufacturer", "SKU", "Status", ""],
        products
          .map(
            (p) => `<tr>
          <td>${escapeHtml(p.title)}</td>
          <td>${escapeHtml(p.manufacturer_name || p.manufacturer_id)}</td>
          <td>${escapeHtml(p.sku_base || "—")}</td>
          <td><span class="badge ${badgeForStatus(p.status)}">${escapeHtml(p.status)}</span></td>
          <td><button type="button" class="btn btn-secondary btn-review-product" data-id="${escapeHtml(p.id)}">Review</button></td>
        </tr>`
          )
          .join("")
      )}
    </div>`;

  container.querySelectorAll(".btn-review-product").forEach((btn) => {
    btn.onclick = () => openPartnerProductReviewModal(btn.dataset.id, () => renderPartnerProductReviews(container));
  });
}

/** Open catalog editor Review tab for a manufacturer product (replaces standalone review modal). */
export async function openPartnerProductReviewModal(productId, onDone) {
  await openProductEditor({
    manufacturerProductId: productId,
    initialTab: "review",
    onReviewDone: onDone,
  });
}
