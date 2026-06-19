import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchPublishedBundle, deletePublished } from "../api.js";

export async function loadProductsTab(ctx) {
  const data = await fetchPublishedBundle(ctx.productKey);
  ctx.productsData = data;
  const rows = (data.published || [])
    .slice(0, 50)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.design_id || row.id)}</td>
        <td>${escapeHtml(row.product_name || "—")}</td>
        <td>${escapeHtml(row.visibility || "—")}</td>
        <td>${row.published_at ? new Date(row.published_at).toLocaleDateString() : "—"}</td>
        <td><button type="button" class="btn btn-secondary btn-sm ce-pub-delete" data-design="${escapeHtml(row.design_id)}">Remove</button></td>
      </tr>`
    )
    .join("");
  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Published listings (${(data.published || []).length})</h3>
      <p class="ce-hint">Data from creator DB · ${(data.versions || []).length} product version(s) in master.</p>
      <table class="data-table ce-table"><thead><tr><th>Design</th><th>Name</th><th>Visibility</th><th>Published</th><th></th></tr></thead>
        <tbody>${rows || "<tr><td colspan=\"5\">No published designs for this product key.</td></tr>"}</tbody></table>
    </div>`;
}

export function bindProductsTab(ctx, root) {
  root.querySelectorAll(".ce-pub-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this published listing record?")) return;
      await deletePublished({ design_id: btn.dataset.design });
      ctx.reloadTab();
    });
  });
}

export async function saveProductsTab() {
  /* read-only tab */
}
