import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchPublishedBundle, deletePublished } from "../api.js";

export async function loadProductsTab(ctx) {
  const data = await fetchPublishedBundle(ctx.productKey);
  ctx.productsData = data;
  const allRows = data.published || [];
  const providerFilter = ctx.productsFilterProvider || "all";
  const visibilityFilter = ctx.productsFilterVisibility || "all";
  const versionFilter = ctx.productsFilterVersion || "all";

  const rows = allRows
    .filter((row) => {
      const providerOk =
        providerFilter === "all" ||
        String(row.print_provider_id || row.provider_id || "") === String(providerFilter);
      const visOk = visibilityFilter === "all" || String(row.visibility || "") === visibilityFilter;
      const versionOk = versionFilter === "all" || String(row.version_id || row.product_version_id || "") === versionFilter;
      return providerOk && visOk && versionOk;
    })
    .slice(0, 100)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.design_id || row.id)}</td>
        <td>${escapeHtml(row.product_name || "—")}</td>
        <td>${escapeHtml(row.visibility || "—")}</td>
        <td>
          <span class="badge ${row.channels?.shopify ? "badge-success" : "badge-neutral"}">Shopify</span>
          <span class="badge ${row.channels?.printify ? "badge-info" : "badge-neutral"}">Printify</span>
          <span class="badge ${row.channels?.amazon ? "badge-warning" : "badge-neutral"}">Amazon</span>
        </td>
        <td>${row.published_at ? new Date(row.published_at).toLocaleDateString() : "—"}</td>
        <td><button type="button" class="btn btn-secondary btn-sm ce-pub-delete" data-design="${escapeHtml(row.design_id)}">Remove</button></td>
      </tr>`
    )
    .join("");

  const providerIds = [...new Set(allRows.map((r) => String(r.print_provider_id || r.provider_id || "")).filter(Boolean))];
  const providerOptions = [
    `<option value="all">All providers</option>`,
    ...providerIds.map(
      (v) =>
        `<option value="${escapeHtml(v)}" ${providerFilter === v ? "selected" : ""}>Provider ${escapeHtml(v)}</option>`
    ),
  ].join("");
  const versionIds = [...new Set(allRows.map((r) => String(r.version_id || r.product_version_id || "")).filter(Boolean))];
  const versionOptions = [
    `<option value="all">All versions</option>`,
    ...versionIds.map(
      (v) =>
        `<option value="${escapeHtml(v)}" ${versionFilter === v ? "selected" : ""}>Version ${escapeHtml(v)}</option>`
    ),
  ].join("");

  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Published listings (${(data.published || []).length})</h3>
      <p class="ce-hint">Data from creator DB · ${(data.versions || []).length} product version(s) in master.</p>
      <div class="ce-inline-actions">
        <select class="input input-sm" id="ce-products-provider-filter">${providerOptions}</select>
        <select class="input input-sm" id="ce-products-version-filter">${versionOptions}</select>
        <select class="input input-sm" id="ce-products-visibility-filter">
          <option value="all" ${visibilityFilter === "all" ? "selected" : ""}>All visibility</option>
          <option value="public" ${visibilityFilter === "public" ? "selected" : ""}>Public</option>
          <option value="private" ${visibilityFilter === "private" ? "selected" : ""}>Private</option>
        </select>
      </div>
      <table class="data-table ce-table"><thead><tr><th>Design</th><th>Name</th><th>Visibility</th><th>Channels</th><th>Published</th><th></th></tr></thead>
        <tbody>${rows || "<tr><td colspan=\"6\">No published designs for this filter.</td></tr>"}</tbody></table>
    </div>`;
}

export function bindProductsTab(ctx, root) {
  root.querySelector("#ce-products-provider-filter")?.addEventListener("change", (e) => {
    ctx.productsFilterProvider = e.target.value;
    ctx.reloadTab();
  });
  root.querySelector("#ce-products-version-filter")?.addEventListener("change", (e) => {
    ctx.productsFilterVersion = e.target.value;
    ctx.reloadTab();
  });
  root.querySelector("#ce-products-visibility-filter")?.addEventListener("change", (e) => {
    ctx.productsFilterVisibility = e.target.value;
    ctx.reloadTab();
  });
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
