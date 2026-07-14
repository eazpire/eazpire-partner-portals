/**
 * Admin: Partner product review queue → hybrid approve to catalog
 */
import { partnerFetch, badgeForStatus, escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast, renderTable, openModal, confirmAction } from "/partner/shared/js/partner-shell.js";

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
          <p class="panel-subtitle">Approve creates a catalog draft (source_system=todify, status preview)</p>
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

async function openPartnerProductReviewModal(productId, onDone) {
  const data = await partnerFetch("admin-manufacturer-product-editor-bundle", {
    query: { product_id: productId },
  });
  const p = data.product || {};
  const readiness = data.readiness || {};
  const variants = data.variants || [];
  const mockups = data.mockups || [];
  const areas = data.print_areas || [];

  openModal({
    title: `Product review — ${p.title || productId}`,
    bodyHtml: `
      <p><strong>Manufacturer:</strong> ${escapeHtml(p.manufacturer_id)}</p>
      <p><strong>SKU:</strong> ${escapeHtml(p.sku_base || "—")} · <strong>Currency:</strong> ${escapeHtml(p.currency || "—")}</p>
      <p><strong>Variants:</strong> ${variants.length} · <strong>Mockups:</strong> ${mockups.length} · <strong>Print areas:</strong> ${areas.length}</p>
      <p><strong>Readiness:</strong> ${
        readiness.ok
          ? `<span class="badge badge-success">Ready</span>`
          : `<span class="badge badge-warning">${(readiness.errors || []).join(", ")}</span>`
      }</p>
      <ul style="margin:8px 0 12px;padding-left:18px;font-size:13px;color:var(--muted)">
        ${variants
          .slice(0, 8)
          .map(
            (v) =>
              `<li>${escapeHtml(v.color)} / ${escapeHtml(v.size)} — ${(Number(v.base_cost_cents) / 100).toFixed(2)} ${escapeHtml(v.currency || p.currency || "")}</li>`
          )
          .join("")}
        ${variants.length > 8 ? `<li>… +${variants.length - 8} more</li>` : ""}
      </ul>
      <div class="field"><label>Admin note</label>
        <textarea class="textarea" id="pe-admin-note" rows="2">${escapeHtml(p.review_note || "")}</textarea></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-warning" id="btn-pe-changes">Request changes</button>
        <button type="button" class="btn btn-primary" id="btn-pe-approve">Approve → catalog draft</button>
      </div>`,
    onSave: async () => {},
  });
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) saveBtn.style.display = "none";

  const note = () => document.getElementById("pe-admin-note")?.value || "";

  document.getElementById("btn-pe-approve").onclick = () => {
    confirmAction({
      title: "Approve to catalog",
      message: "Create/update eazpire product and catalog draft (preview, source_system=todify)? You set margin and online later in Catalog Studio.",
      confirmLabel: "Approve",
      onConfirm: async () => {
        try {
          const res = await partnerFetch("admin-manufacturer-product-approve-to-catalog", {
            method: "POST",
            body: { product_id: productId, note: note() },
          });
          showToast("Approved", `Catalog draft: ${res.product_key || ""}`);
          if (saveBtn) saveBtn.style.display = "";
          document.getElementById("modal-close")?.click();
          if (onDone) await onDone();
        } catch (e) {
          showToast("Approve failed", (e.data?.errors || [e.message]).join(", "));
        }
      },
    });
  };

  document.getElementById("btn-pe-changes").onclick = () => {
    confirmAction({
      title: "Request changes",
      message: "Send this product back to the partner?",
      confirmLabel: "Request changes",
      confirmClass: "btn-warning",
      onConfirm: async () => {
        await partnerFetch("admin-manufacturer-product-approve-to-catalog", {
          method: "POST",
          body: { product_id: productId, changes_requested: true, note: note() },
        });
        showToast("Changes requested", "");
        if (saveBtn) saveBtn.style.display = "";
        document.getElementById("modal-close")?.click();
        if (onDone) await onDone();
      },
    });
  };
}
