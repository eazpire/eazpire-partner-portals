/**
 * Catalog editor — Partner product Review tab (approve / reject / discard)
 */
import { partnerFetch, escapeHtml, badgeForStatus } from "/partner/shared/js/partner-api.js";
import { showToast, confirmAction } from "/partner/shared/js/partner-shell.js";

export async function loadPartnerReviewBundle(manufacturerProductId, productKey) {
  const query = manufacturerProductId
    ? { product_id: manufacturerProductId }
    : productKey
      ? { product_key: productKey }
      : null;
  if (!query) return null;
  try {
    const data = await partnerFetch("admin-manufacturer-product-editor-bundle", { query });
    // product_key probe: no partner submission linked to this catalog item
    if (data?.linked === false || !data?.product?.id) return null;
    return data;
  } catch (err) {
    // Explicit product_id missing → keep throw; product_key miss used to be HTTP 404
    if (productKey && !manufacturerProductId && (err?.status === 404 || err?.data?.error === "not_found")) {
      return null;
    }
    throw err;
  }
}

function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `${(n / 100).toFixed(2)} ${escapeHtml(currency || "")}`.trim();
}

export function renderReviewTab(ctx) {
  const data = ctx.partnerReview || {};
  const p = data.product || {};
  const readiness = data.readiness || {};
  const variants = data.variants || [];
  const mockups = data.mockups || [];
  const areas = data.print_areas || [];
  const mfgLabel = data.manufacturer_name || p.manufacturer_id || "—";
  const status = String(p.status || "—");
  const isApproved = status === "approved";
  const isPending = status === "pending_review";
  const canApprove = isPending || status === "rejected" || status === "changes_requested" || status === "draft";
  const canDiscard = isPending || isApproved || status === "changes_requested";

  if (!p.id) {
    return `
      <div class="ce-tab-panel ce-review-panel">
        <h3 class="ce-section-title">Review</h3>
        <p class="ce-hint">No partner product submission is linked to this catalog item.</p>
      </div>`;
  }

  const readinessHtml = readiness.ok
    ? `<span class="badge badge-success">Ready</span>`
    : `<span class="badge badge-warning">${escapeHtml((readiness.errors || []).join(", ") || "Not ready")}</span>`;

  const variantLines = variants
    .slice(0, 12)
    .map(
      (v) =>
        `<li>${escapeHtml(v.color || "—")} / ${escapeHtml(v.size || "—")} — ${money(v.base_cost_cents, v.currency || p.currency)}</li>`
    )
    .join("");
  const variantMore =
    variants.length > 12 ? `<li>… +${variants.length - 12} more</li>` : "";

  const discardLabel = isApproved ? "Revoke approval" : "Discard review";
  const discardHint = isApproved
    ? "Pulls the catalog draft offline and notifies the partner. Data stays so you can approve again later."
    : "Withdraws this submission from the pending queue and notifies the partner.";

  return `
    <div class="ce-tab-panel ce-review-panel">
      <h3 class="ce-section-title">Partner product review</h3>
      <p class="ce-hint">Approve creates a catalog draft (preview). A review note is required for every decision.</p>

      <div class="ce-review-summary" style="display:grid;gap:8px;margin:12px 0 16px;font-size:14px">
        <p><strong>Manufacturer:</strong> ${escapeHtml(mfgLabel)}${
          data.manufacturer_name && p.manufacturer_id
            ? ` <span class="ce-hint" style="margin-left:4px">(${escapeHtml(p.manufacturer_id)})</span>`
            : ""
        }</p>
        <p><strong>SKU:</strong> ${escapeHtml(p.sku_base || "—")} · <strong>Currency:</strong> ${escapeHtml(p.currency || "—")}</p>
        <p><strong>Status:</strong> <span class="badge ${badgeForStatus(status)}">${escapeHtml(status)}</span>${
          p.eazpire_product_key
            ? ` · <strong>Catalog key:</strong> <code>${escapeHtml(p.eazpire_product_key)}</code>`
            : ""
        }</p>
        <p><strong>Variants:</strong> ${variants.length} · <strong>Mockups:</strong> ${mockups.length} · <strong>Print areas:</strong> ${areas.length}</p>
        <p><strong>Readiness:</strong> ${readinessHtml}</p>
      </div>

      <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:var(--muted)">
        ${variantLines || "<li>No variants</li>"}
        ${variantMore}
      </ul>

      <div class="field">
        <label for="ce-review-note">Review note (required)</label>
        <textarea class="textarea" id="ce-review-note" rows="3" required placeholder="Explain the approve, reject, or discard decision for the partner">${escapeHtml(p.review_note || "")}</textarea>
      </div>

      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${
          canApprove
            ? `<button type="button" class="btn btn-primary" id="ce-review-approve">Approve</button>
               <button type="button" class="btn btn-danger" id="ce-review-reject">Reject</button>`
            : ""
        }
        ${
          canDiscard
            ? `<button type="button" class="btn btn-secondary" id="ce-review-discard">${escapeHtml(discardLabel)}</button>`
            : ""
        }
      </div>
      ${canDiscard ? `<p class="ce-hint" style="margin-top:10px">${escapeHtml(discardHint)}</p>` : ""}
      ${
        isApproved
          ? `<p class="ce-hint" style="margin-top:8px">This product is already approved. Use Revoke approval to remove it from the preview pipeline, then Approve again if needed.</p>`
          : ""
      }
    </div>`;
}

export function bindReviewTab(ctx, root, { onDecision } = {}) {
  if (!root || !ctx?.partnerReview?.product?.id) return;

  const productId = ctx.partnerReview.product.id;
  const note = () => String(document.getElementById("ce-review-note")?.value || "").trim();
  const requireNote = () => {
    const value = note();
    if (!value) {
      showToast("Note required", "Add a review note before Approve, Reject, or Discard");
      return false;
    }
    return true;
  };

  const run = async (body, { title, message, confirmLabel, confirmClass, okToast }) => {
    if (!requireNote()) return;
    confirmAction({
      title,
      message,
      confirmLabel,
      confirmClass: confirmClass || "btn-primary",
      onConfirm: async () => {
        try {
          const res = await partnerFetch("admin-manufacturer-product-approve-to-catalog", {
            method: "POST",
            body: { product_id: productId, note: note(), ...body },
          });
          showToast(okToast.title, okToast.text(res));
          if (onDecision) await onDecision(res);
        } catch (e) {
          const detail = (e.data?.errors || [e.message || e.data?.error]).filter(Boolean).join(", ");
          showToast("Review failed", detail || String(e));
        }
      },
    });
  };

  root.querySelector("#ce-review-approve")?.addEventListener("click", () => {
    run(
      {},
      {
        title: "Approve to catalog",
        message:
          "Create/update eazpire product and catalog draft (preview)? The partner will be notified by email with your note.",
        confirmLabel: "Approve",
        okToast: {
          title: "Approved",
          text: (res) => `Catalog draft: ${res.product_key || ""}`,
        },
      }
    );
  });

  root.querySelector("#ce-review-reject")?.addEventListener("click", () => {
    run(
      { rejected: true },
      {
        title: "Reject product",
        message: "Reject this submission and notify the partner with your note?",
        confirmLabel: "Reject",
        confirmClass: "btn-danger",
        okToast: { title: "Rejected", text: () => "Partner notified" },
      }
    );
  });

  root.querySelector("#ce-review-discard")?.addEventListener("click", () => {
    const isApproved = String(ctx.partnerReview.product.status) === "approved";
    run(
      { discarded: true },
      {
        title: isApproved ? "Revoke approval" : "Discard review",
        message: isApproved
          ? "Revoke catalog approval, set the product offline, and notify the partner? You can approve again later."
          : "Discard this review, withdraw from the pending queue, and notify the partner?",
        confirmLabel: isApproved ? "Revoke approval" : "Discard review",
        confirmClass: "btn-danger",
        okToast: {
          title: isApproved ? "Approval revoked" : "Review discarded",
          text: () => "Partner notified",
        },
      }
    );
  });
}
