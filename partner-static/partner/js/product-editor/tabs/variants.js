import { escapeHtml } from "/shared/js/partner-api.js";

export function renderVariantsTab(ctx) {
  const colors = [...(ctx.localColors || ctx.bundle?.colors || [])];
  const sizes = [...(ctx.localSizes || ctx.bundle?.sizes || [])];
  const currency = ctx.localCurrency || ctx.bundle?.product?.currency || "EUR";
  const variants = ctx.bundle?.variants || [];
  const costMap = {};
  for (const v of variants) {
    costMap[`${v.color}||${v.size}`] = (Number(v.base_cost_cents) || 0) / 100;
    if (costMap[v.color] == null) costMap[v.color] = (Number(v.base_cost_cents) || 0) / 100;
  }

  if (!colors.length) colors.push("Black");
  if (!sizes.length) sizes.push("M");

  const matrixRows = colors
    .map((color) => {
      const cells = sizes
        .map((size) => {
          const key = `${color}||${size}`;
          const val = costMap[key] ?? costMap[color] ?? "";
          return `<td><input class="input input-sm pe-cost" data-color="${escapeHtml(color)}" data-size="${escapeHtml(size)}" type="number" step="0.01" min="0" value="${escapeHtml(val)}" /></td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(color)}</th>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="ce-tab-panel pe-variants-panel">
      <h3 class="ce-section-title">Views</h3>
      <p class="ce-hint">Views define mockup slots and printable sides. Front/Back are created by default.</p>
      <div id="pe-views-list" class="pe-views-list">${renderViewsList(ctx)}</div>
      <div class="ce-inline-actions" style="margin:10px 0 20px">
        <input class="input input-sm" id="pe-view-key" placeholder="view key (e.g. lifestyle)" style="max-width:180px" />
        <input class="input input-sm" id="pe-view-label" placeholder="Label" style="max-width:160px" />
        <label class="pe-chip"><input type="checkbox" id="pe-view-printable" checked /> Printable</label>
        <button type="button" class="btn btn-secondary btn-sm" id="pe-add-view">Add view</button>
      </div>

      <h3 class="ce-section-title">Colors &amp; sizes</h3>
      <p class="ce-hint">Sizes share the same mockup per color. Costs are wholesale / purchase price in the product currency.</p>
      <div class="split-row">
        <div class="field"><label>Colors (comma-separated)</label>
          <input class="input" id="pe-colors" value="${escapeHtml(colors.join(", "))}" /></div>
        <div class="field"><label>Sizes (comma-separated)</label>
          <input class="input" id="pe-sizes" value="${escapeHtml(sizes.join(", "))}" /></div>
        <div class="field"><label>Currency</label>
          <select class="input" id="pe-var-currency">
            ${["EUR", "USD", "MAD", "GBP"].map((c) => `<option value="${c}" ${currency === c ? "selected" : ""}>${c}</option>`).join("")}
          </select></div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="pe-rebuild-matrix" style="margin-bottom:12px">Rebuild cost matrix</button>
      <div class="pe-matrix-wrap">
        <table class="data-table pe-cost-matrix">
          <thead><tr><th>Color \\ Size</th>${sizes.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}</tr></thead>
          <tbody id="pe-cost-body">${matrixRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderViewsList(ctx) {
  const views = ctx.localViews || ctx.bundle?.views || [];
  if (!views.length) return `<p class="ce-hint">No views yet.</p>`;
  return `<table class="data-table"><thead><tr><th>Key</th><th>Label</th><th>Printable</th><th></th></tr></thead><tbody>
    ${views
      .map(
        (v, i) => `<tr data-view-idx="${i}">
      <td><code>${escapeHtml(v.view_key)}</code></td>
      <td>${escapeHtml(v.label)}</td>
      <td>${v.printable ? "Yes" : "No"}</td>
      <td><button type="button" class="btn btn-ghost btn-sm pe-rm-view" data-idx="${i}">Remove</button></td>
    </tr>`
      )
      .join("")}
  </tbody></table>`;
}

function parseList(val) {
  return String(val || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function snapshotVariantsTab(ctx) {
  const colors = parseList(document.getElementById("pe-colors")?.value);
  const sizes = parseList(document.getElementById("pe-sizes")?.value);
  const currency = document.getElementById("pe-var-currency")?.value || "EUR";
  const costs_major = {};
  document.querySelectorAll(".pe-cost").forEach((input) => {
    const color = input.dataset.color;
    const size = input.dataset.size;
    costs_major[`${color}||${size}`] = Number(input.value) || 0;
  });
  return {
    views: [...(ctx.localViews || ctx.bundle?.views || [])],
    colors,
    sizes,
    currency,
    costs_major,
  };
}

export function bindVariantsTab(ctx, root) {
  if (!ctx.localViews) ctx.localViews = [...(ctx.bundle?.views || [])];

  const rebuild = () => {
    ctx.localColors = parseList(document.getElementById("pe-colors")?.value);
    ctx.localSizes = parseList(document.getElementById("pe-sizes")?.value);
    ctx.localCurrency = document.getElementById("pe-var-currency")?.value;
    ctx.markDirty?.();
    ctx.reloadTab?.();
  };

  root.querySelector("#pe-rebuild-matrix")?.addEventListener("click", rebuild);
  root.querySelector("#pe-colors")?.addEventListener("change", () => ctx.markDirty?.());
  root.querySelector("#pe-sizes")?.addEventListener("change", () => ctx.markDirty?.());
  root.querySelector("#pe-var-currency")?.addEventListener("change", () => ctx.markDirty?.());
  root.querySelectorAll(".pe-cost").forEach((el) => el.addEventListener("input", () => ctx.markDirty?.()));

  root.querySelector("#pe-add-view")?.addEventListener("click", () => {
    const key = String(document.getElementById("pe-view-key")?.value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    const label = document.getElementById("pe-view-label")?.value?.trim() || key;
    const printable = document.getElementById("pe-view-printable")?.checked !== false;
    if (!key) return;
    if (!ctx.localViews) ctx.localViews = [...(ctx.bundle?.views || [])];
    if (ctx.localViews.some((v) => v.view_key === key)) return;
    ctx.localViews.push({ view_key: key, label, sort_order: ctx.localViews.length, printable });
    ctx.markDirty?.();
    ctx.reloadTab?.();
  });

  root.querySelectorAll(".pe-rm-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      ctx.localViews = (ctx.localViews || []).filter((_, i) => i !== idx);
      ctx.markDirty?.();
      ctx.reloadTab?.();
    });
  });
}
