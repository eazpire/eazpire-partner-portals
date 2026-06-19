import { escapeHtml } from "/partner/shared/js/partner-api.js";

function toPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 100).toFixed(2);
}

function variantCostCents(variant) {
  const c = Number(variant?.cost);
  if (Number.isFinite(c)) return c > 1000 ? Math.round(c) : Math.round(c * 100);
  return 0;
}

function calcVk(ek, marginMode, marginValue) {
  if (!Number.isFinite(ek) || ek <= 0) return 0;
  const mv = Number(marginValue) || 0;
  if (marginMode === "fixed") return Math.max(0, Math.round(ek + mv * 100));
  return Math.max(0, Math.round(ek * (1 + mv / 100)));
}

function variantLabel(variant) {
  const options = Array.isArray(variant?.options) ? variant.options.join(" / ") : "";
  return variant?.title || options || `Variant ${variant?.id ?? "?"}`;
}

export function buildVariantMatrixHtml(productData, variantConfig = null, pricesJson = null) {
  const variants = Array.isArray(productData?.variants) ? productData.variants : [];
  const cfg = variantConfig && typeof variantConfig === "object" ? variantConfig : {};
  const cfgVariants = cfg.variants && typeof cfg.variants === "object" ? cfg.variants : {};
  const global = cfg.global && typeof cfg.global === "object" ? cfg.global : {};
  const marginMode = global.profit_mode || "percent";
  const marginValue = Number(global.profit_value ?? 30);
  const globalBrand = global.branding || "black";
  const prices = new Map(
    Array.isArray(pricesJson) ? pricesJson.map((p) => [String(p.variant_id), Number(p.price)]) : []
  );

  const rows = variants
    .map((v) => {
      const id = String(v.id ?? "");
      const rowCfg = cfgVariants[id] || {};
      const enabled = rowCfg.enabled !== false;
      const rowMode = rowCfg.profit_mode || marginMode;
      const rowValue =
        rowCfg.profit_value != null && Number.isFinite(Number(rowCfg.profit_value))
          ? Number(rowCfg.profit_value)
          : marginValue;
      const branding = rowCfg.branding || globalBrand;
      const ek = variantCostCents(v);
      const vk = prices.has(id) ? Number(prices.get(id)) : calcVk(ek, rowMode, rowValue);
      return `<tr data-variant-id="${escapeHtml(id)}">
        <td><input type="checkbox" class="ce-vm-enabled" ${enabled ? "checked" : ""}></td>
        <td class="ce-vm-title">${escapeHtml(variantLabel(v))}</td>
        <td data-role="ek">${escapeHtml(toPrice(ek))}</td>
        <td>
          <select class="input input-sm ce-vm-mode">
            <option value="percent" ${rowMode === "percent" ? "selected" : ""}>%</option>
            <option value="fixed" ${rowMode === "fixed" ? "selected" : ""}>$</option>
          </select>
        </td>
        <td><input type="number" class="input input-sm ce-vm-margin" value="${escapeHtml(String(rowValue))}" min="0" step="1"></td>
        <td data-role="vk">${escapeHtml(toPrice(vk))}</td>
        <td>
          <select class="input input-sm ce-vm-branding">
            <option value="black" ${branding === "black" ? "selected" : ""}>Black</option>
            <option value="white" ${branding === "white" ? "selected" : ""}>White</option>
          </select>
        </td>
      </tr>`;
    })
    .join("");

  return `
    <div class="ce-vm-head">
      <label>Global margin mode
        <select class="input input-sm" id="ce-vm-global-mode">
          <option value="percent" ${marginMode === "percent" ? "selected" : ""}>Percent</option>
          <option value="fixed" ${marginMode === "fixed" ? "selected" : ""}>Fixed $</option>
        </select>
      </label>
      <label>Global margin
        <input class="input input-sm" id="ce-vm-global-value" type="number" value="${escapeHtml(String(marginValue))}" min="0" step="1">
      </label>
      <label>Global branding
        <select class="input input-sm" id="ce-vm-global-branding">
          <option value="black" ${globalBrand === "black" ? "selected" : ""}>Black</option>
          <option value="white" ${globalBrand === "white" ? "selected" : ""}>White</option>
        </select>
      </label>
      <button type="button" class="btn btn-secondary btn-sm" id="ce-vm-apply-global">Apply global</button>
    </div>
    <div class="table-scroll">
      <table class="data-table ce-table ce-vm-table">
        <thead><tr><th>On</th><th>Variant</th><th>EK</th><th>Mode</th><th>Margin</th><th>VK</th><th>Branding</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No variants loaded.</td></tr>'}</tbody>
      </table>
    </div>`;
}

export function collectVariantConfigFromDom(root) {
  const wrap = root || document;
  const mode = wrap.querySelector("#ce-vm-global-mode")?.value || "percent";
  const value = Number(wrap.querySelector("#ce-vm-global-value")?.value ?? 30);
  const branding = wrap.querySelector("#ce-vm-global-branding")?.value || "black";
  const variants = {};

  wrap.querySelectorAll(".ce-vm-table tbody tr[data-variant-id]").forEach((row) => {
    const vid = row.getAttribute("data-variant-id");
    if (!vid) return;
    variants[vid] = {
      enabled: !!row.querySelector(".ce-vm-enabled")?.checked,
      profit_mode: row.querySelector(".ce-vm-mode")?.value || mode,
      profit_value: Number(row.querySelector(".ce-vm-margin")?.value ?? value),
      branding: row.querySelector(".ce-vm-branding")?.value || branding,
    };
  });

  return {
    global: {
      profit_mode: mode,
      profit_value: Number.isFinite(value) ? value : 30,
      branding,
    },
    variants,
  };
}
