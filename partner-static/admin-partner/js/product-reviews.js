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
          <p class="panel-subtitle">Approve creates a catalog draft (source_system=todify, status preview). A review note is required.</p>
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

export async function openPartnerProductReviewModal(productId, onDone) {
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
      <div class="field"><label>Review note (required)</label>
        <textarea class="textarea" id="pe-admin-note" rows="3" required placeholder="Explain the approve or reject decision for the partner">${escapeHtml(p.review_note || "")}</textarea></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-danger" id="btn-pe-reject">Reject</button>
        <button type="button" class="btn btn-primary" id="btn-pe-approve">Approve</button>
      </div>`,
    onSave: async () => {},
  });
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) saveBtn.style.display = "none";

  const note = () => String(document.getElementById("pe-admin-note")?.value || "").trim();
  const requireNote = () => {
    const value = note();
    if (!value) {
      showToast("Note required", "Add a review note before Approve or Reject");
      return false;
    }
    return true;
  };

  document.getElementById("btn-pe-approve").onclick = () => {
    if (!requireNote()) return;
    confirmAction({
      title: "Approve to catalog",
      message: "Create/update eazpire product and catalog draft (preview, source_system=todify)? The partner will be notified by email with your note.",
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
          showToast("Approve failed", (e.data?.errors || [e.message || e.data?.error]).filter(Boolean).join(", "));
        }
      },
    });
  };

  document.getElementById("btn-pe-reject").onclick = () => {
    if (!requireNote()) return;
    confirmAction({
      title: "Reject product",
      message: "Reject this submission and notify the partner with your note?",
      confirmLabel: "Reject",
      confirmClass: "btn-danger",
      onConfirm: async () => {
        try {
          await partnerFetch("admin-manufacturer-product-approve-to-catalog", {
            method: "POST",
            body: { product_id: productId, rejected: true, note: note() },
          });
          showToast("Rejected", "Partner notified");
          if (saveBtn) saveBtn.style.display = "";
          document.getElementById("modal-close")?.click();
          if (onDone) await onDone();
        } catch (e) {
          showToast("Reject failed", e.message || e.data?.error || String(e));
        }
      },
    });
  };
}
