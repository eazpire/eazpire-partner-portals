import { escapeHtml } from "/partner/shared/js/partner-api.js";

function formatPrice(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

/** Printify variant.cost is already USD cents (integer). */
function variantCostCents(variant) {
  const c = variant?.cost;
  if (c == null || c === "") return 0;
  if (typeof c === "string") {
    const n = parseFloat(c);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  }
  if (typeof c === "number") return Math.max(0, Math.round(c));
  return 0;
}

function vkFromPublishOrCalc(prices, variantId, ek, isEnabled, profitMode, profitVal) {
  if (!isEnabled) return 0;
  const vidKey = variantId != null ? String(variantId) : "";
  if (vidKey && prices.has(vidKey)) {
    const p = Number(prices.get(vidKey));
    if (Number.isFinite(p) && p > 0) {
      // Legacy bug: cost was multiplied by 100 when already in cents.
      if (ek > 0 && p >= ek * 50) return calcVk(ek, profitMode, profitVal);
      return Math.round(p);
    }
  }
  return calcVk(ek, profitMode, profitVal);
}

function calcVk(ek, marginMode, marginValue) {
  if (!Number.isFinite(ek) || ek <= 0) return 0;
  const mv = Number(marginValue) || 0;
  if (marginMode === "fixed") return Math.max(0, Math.round(ek + mv * 100));
  return Math.max(0, Math.round(ek * (1 + mv / 100)));
}

function optionValueIdSet(option) {
  const ids = new Set();
  for (const v of option?.values || []) {
    if (v?.id != null) ids.add(String(v.id));
  }
  return ids;
}

function getVariantOptionIdByOption(variantOptions, option, expectedIdx) {
  if (!Array.isArray(variantOptions) || !variantOptions.length) return null;
  const allowed = optionValueIdSet(option);
  if (!allowed.size) return null;
  if (Number.isFinite(expectedIdx) && expectedIdx >= 0 && expectedIdx < variantOptions.length) {
    const direct = variantOptions[expectedIdx];
    if (direct != null && allowed.has(String(direct))) return direct;
  }
  for (const cand of variantOptions) {
    if (cand != null && allowed.has(String(cand))) return cand;
  }
  return null;
}

function getVariantDisplayLabel(product, variant, hasColor) {
  const options = Array.isArray(product?.options) ? product.options : [];
  const variantOptions = Array.isArray(variant?.options) ? variant.options : [];
  if (!options.length || !variantOptions.length) return variant?.title || "?";

  const parts = [];
  options.forEach((opt, idx) => {
    const nameLC = String(opt?.name || "").toLowerCase();
    const isColor = opt?.type === "color" || nameLC === "color" || nameLC === "colors";
    if (hasColor && isColor) return;
    const valId = getVariantOptionIdByOption(variantOptions, opt, idx);
    if (valId == null) return;
    const selected = (opt.values || []).find((v) => String(v.id) === String(valId));
    const title = selected?.title ? String(selected.title).trim() : "";
    if (title) parts.push(title);
  });

  if (parts.length) return parts.join(" / ");
  if (variant?.title && hasColor) {
    const chunks = String(variant.title)
      .split(" / ")
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length > 1) return chunks.slice(1).join(" / ");
  }
  return variant?.title || "?";
}

function isColorDark(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function groupVariants(product) {
  const colorOption = (product?.options || []).find((opt) => {
    const nameLC = String(opt?.name || "").toLowerCase();
    return opt?.type === "color" || nameLC === "color" || nameLC === "colors";
  });
  const otherOptions = (product?.options || []).filter((opt) => opt !== colorOption);
  const hasColor = !!colorOption;
  const groupOption = colorOption || otherOptions[0] || null;

  let availableColors;
  let variantsByColor;
  let colorIdx = 0;

  if (hasColor) {
    (product.options || []).forEach((opt, i) => {
      if (opt === colorOption) colorIdx = i;
    });
    variantsByColor = {};
    for (const v of product.variants || []) {
      const optArr = v.options;
      if (!optArr) continue;
      const cId = getVariantOptionIdByOption(Array.isArray(optArr) ? optArr : [], colorOption, colorIdx);
      if (cId == null) continue;
      if (!variantsByColor[cId]) variantsByColor[cId] = [];
      variantsByColor[cId].push(v);
    }
    availableColors = (colorOption.values || []).filter((c) => (variantsByColor[c.id] || []).length > 0);
  } else if (groupOption) {
    let groupIdx = 0;
    (product.options || []).forEach((opt, i) => {
      if (opt === groupOption) groupIdx = i;
    });
    variantsByColor = {};
    for (const v of product.variants || []) {
      const optArr = v.options;
      if (!optArr) continue;
      const gId = getVariantOptionIdByOption(Array.isArray(optArr) ? optArr : [], groupOption, groupIdx);
      if (gId == null) continue;
      if (!variantsByColor[gId]) variantsByColor[gId] = [];
      variantsByColor[gId].push(v);
    }
    availableColors = (groupOption.values || []).filter((c) => (variantsByColor[c.id] || []).length > 0);
  } else {
    availableColors = [{ id: "_all", title: "All variants", colors: ["#888"] }];
    variantsByColor = { _all: product?.variants || [] };
  }

  const placed = new Set();
  for (const color of availableColors) {
    for (const v of variantsByColor[color.id] || []) {
      const vid = v.id ?? v.variant_id;
      if (vid != null) placed.add(String(vid));
    }
  }
  const orphanVariants = (product?.variants || []).filter((v) => {
    const vid = v.id ?? v.variant_id;
    return vid != null && !placed.has(String(vid));
  });
  if (orphanVariants.length) {
    variantsByColor._orphan = orphanVariants;
    availableColors = availableColors.concat([{ id: "_orphan", title: "Other variants", colors: ["#666"] }]);
  }

  return { hasColor, availableColors, variantsByColor, totalVariants: (product?.variants || []).length };
}

function buildSizeRow(product, variant, hasColor, savedVariants, defaultProfitMode, defaultProfitValue, prices) {
  const vidKey = String(variant.id ?? variant.variant_id ?? "");
  const sv = savedVariants[vidKey] || {};
  const isEnabled = sv.enabled !== false;
  const profitMode = sv.profit_mode || defaultProfitMode;
  const profitVal =
    sv.profit_value != null && Number.isFinite(Number(sv.profit_value)) ? Number(sv.profit_value) : defaultProfitValue;
  const ek = variantCostCents(variant);
  const vk = vkFromPublishOrCalc(prices, vidKey, ek, isEnabled, profitMode, profitVal);
  const profit = isEnabled ? vk - ek : 0;
  const label = getVariantDisplayLabel(product, variant, hasColor);
  const rowClass = isEnabled ? "" : " ce-vp__row-disabled";

  return `
    <tr data-variant-id="${escapeHtml(vidKey)}" data-ek="${ek}" class="${rowClass.trim()}">
      <td class="ce-vp__td-cb"><input type="checkbox" class="ce-vp__size-toggle" data-variant-id="${escapeHtml(vidKey)}" ${isEnabled ? "checked" : ""}></td>
      <td>${escapeHtml(label)}</td>
      <td class="ce-vp__col-ek">${escapeHtml(formatPrice(ek))}</td>
      <td class="ce-vp__td-mode">
        <select class="ce-vp__select ce-vp-mode-select" ${isEnabled ? "" : "disabled"}>
          <option value="percent" ${profitMode === "percent" ? "selected" : ""}>%</option>
          <option value="fixed" ${profitMode === "fixed" ? "selected" : ""}>$</option>
        </select>
      </td>
      <td class="ce-vp__td-val"><input type="number" class="ce-vp__input ce-vp-value-input" value="${escapeHtml(String(profitVal))}" min="0" step="1" ${isEnabled ? "" : "disabled"}></td>
      <td class="ce-vp__col-vk ce-vp-vk-display">${isEnabled ? escapeHtml(formatPrice(vk)) : '<span class="ce-vp__disabled-tag">—</span>'}</td>
      <td class="ce-vp__col-profit ce-vp-profit-display">${isEnabled ? escapeHtml(formatPrice(profit)) : ""}</td>
    </tr>`;
}

export function buildVariantMatrixHtml(productData, variantConfig = null, pricesJson = null, printProviderId = "") {
  const product = productData && typeof productData === "object" ? productData : { variants: [] };
  const cfg = variantConfig && typeof variantConfig === "object" ? variantConfig : {};
  const savedVariants = cfg.variants && typeof cfg.variants === "object" ? cfg.variants : {};
  const savedGlobal = cfg.global && typeof cfg.global === "object" ? cfg.global : {};
  const defaultProfitMode = savedGlobal.profit_mode || "percent";
  const defaultProfitValue = Number(savedGlobal.profit_value ?? 30);
  const defaultBrandingGlobal = savedGlobal.branding || "black";
  const prices = new Map(
    Array.isArray(pricesJson) ? pricesJson.map((p) => [String(p.variant_id), Number(p.price)]) : []
  );

  const { hasColor, availableColors, variantsByColor, totalVariants } = groupVariants(product);
  const ppId = escapeHtml(String(printProviderId || "0"));

  let enabledCount = 0;
  for (const color of availableColors) {
    for (const v of variantsByColor[color.id] || []) {
      const vidKey = String(v.id ?? v.variant_id ?? "");
      const sv = savedVariants[vidKey];
      if (sv ? sv.enabled !== false : true) enabledCount++;
    }
  }

  const groupLabel = hasColor ? `${availableColors.length} colors, ` : `${availableColors.length} groups, `;
  let colorCards = "";
  let firstOpen = true;

  for (const color of availableColors) {
    const colorId = color.id;
    const colorTitle = color.title || "Color";
    const colorHex = color.colors?.[0] || "#888";
    const variants = variantsByColor[colorId] || [];

    let colorEnabledCount = 0;
    for (const v of variants) {
      const vidKey0 = String(v.id ?? v.variant_id ?? "");
      const sv = savedVariants[vidKey0];
      if (sv ? sv.enabled !== false : true) colorEnabledCount++;
    }
    const colorEnabled = colorEnabledCount > 0;
    const isOpen = firstOpen ? " is-open" : "";
    if (firstOpen) firstOpen = false;

    const defaultBranding = hasColor && isColorDark(colorHex) ? "white" : "black";
    let colorBranding = defaultBranding;
    if (variants.length) {
      const v0id = String(variants[0].id ?? variants[0].variant_id ?? "");
      const sv0 = savedVariants[v0id];
      if (sv0?.branding) colorBranding = sv0.branding;
    }

    const sizeRows = variants
      .map((v) => buildSizeRow(product, v, hasColor, savedVariants, defaultProfitMode, defaultProfitValue, prices))
      .join("");

    colorCards += `
      <div class="ce-vp__color-card${isOpen}${colorEnabled ? "" : " is-color-disabled"}" data-color-id="${escapeHtml(String(colorId))}">
        <div class="ce-vp__color-header">
          <input type="checkbox" class="ce-vp__color-toggle" data-color-id="${escapeHtml(String(colorId))}" ${colorEnabled ? "checked" : ""} title="Enable/disable group">
          <span class="ce-vp__color-chevron" aria-hidden="true">▶</span>
          ${hasColor ? `<span class="ce-vp__color-dot" style="background:${escapeHtml(colorHex)}"></span>` : ""}
          <span class="ce-vp__color-name">${escapeHtml(colorTitle)}</span>
          ${
            hasColor
              ? `<span class="ce-vp__color-branding">
            <label><input type="radio" name="ce-vp-branding-${ppId}-${escapeHtml(String(colorId))}" value="black" class="ce-vp-color-branding" ${colorBranding === "black" ? "checked" : ""}> B</label>
            <label><input type="radio" name="ce-vp-branding-${ppId}-${escapeHtml(String(colorId))}" value="white" class="ce-vp-color-branding" ${colorBranding === "white" ? "checked" : ""}> W</label>
          </span>`
              : ""
          }
          <span class="ce-vp__color-count">${colorEnabledCount}/${variants.length}</span>
        </div>
        <div class="ce-vp__color-body">
          <table class="ce-vp__size-table">
            <thead><tr>
              <th class="ce-vp__th-cb"></th><th>Size</th><th>Cost (USD)</th>
              <th class="ce-vp__th-mode"></th><th class="ce-vp__th-val">Margin</th><th>VK (USD)</th><th class="ce-vp__th-profit">Profit (USD)</th>
            </tr></thead>
            <tbody>${sizeRows || '<tr><td colspan="7">No variants.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  return `
    <div class="ce-vp-panel" data-pp-id="${ppId}">
      <div class="ce-vp__global">
        <div class="ce-vp__global-row ce-vp__global-row--with-save">
          <label class="ce-vp__global-label">Profit:</label>
          <select class="ce-vp__select" id="ce-vp-global-mode">
            <option value="percent" ${defaultProfitMode === "percent" ? "selected" : ""}>%</option>
            <option value="fixed" ${defaultProfitMode === "fixed" ? "selected" : ""}>$</option>
          </select>
          <input type="number" class="ce-vp__input" id="ce-vp-global-value" value="${escapeHtml(String(defaultProfitValue))}" min="0" step="1">
          <span class="ce-vp__global-vk" id="ce-vp-global-vk">→ Avg VK: —</span>
          <button type="button" class="ce-vp__btn-save" id="ce-vp-save-pricing">Save prices</button>
        </div>
        <div class="ce-vp__global-row ce-vp__global-row--with-save">
          <label class="ce-vp__global-label">Branding:</label>
          <label class="ce-vp__radio"><input type="radio" name="ce-vp-global-branding" value="black" ${defaultBrandingGlobal === "black" ? "checked" : ""}> Black</label>
          <label class="ce-vp__radio"><input type="radio" name="ce-vp-global-branding" value="white" ${defaultBrandingGlobal === "white" ? "checked" : ""}> White</label>
          <button type="button" class="ce-vp__btn-save" id="ce-vp-save-branding">Save branding</button>
          <button type="button" class="ce-vp__btn-apply" id="ce-vp-apply-all">Apply margin &amp; branding to all</button>
        </div>
      </div>
      <div class="ce-vp__summary">${escapeHtml(groupLabel)}${totalVariants} variants — <strong>${enabledCount} / ${totalVariants} for publish</strong></div>
      <div class="ce-vp__colors" id="ce-vp-colors">${colorCards || '<p class="ce-hint">No variants loaded. Sync on the Templates tab.</p>'}</div>
    </div>`;
}

function updateRowVk(row) {
  if (!row || row.classList.contains("ce-vp__row-disabled")) return;
  const ek = Number(row.getAttribute("data-ek")) || 0;
  const mode = row.querySelector(".ce-vp-mode-select")?.value || "percent";
  const val = Number(row.querySelector(".ce-vp-value-input")?.value) || 0;
  const vk = calcVk(ek, mode, val);
  const vkEl = row.querySelector(".ce-vp-vk-display");
  const profitEl = row.querySelector(".ce-vp-profit-display");
  if (vkEl) vkEl.textContent = formatPrice(vk);
  if (profitEl) profitEl.textContent = formatPrice(vk - ek);
}

function toggleRow(row, enabled) {
  if (!row) return;
  row.classList.toggle("ce-vp__row-disabled", !enabled);
  row.querySelectorAll(".ce-vp-mode-select, .ce-vp-value-input").forEach((el) => {
    el.disabled = !enabled;
  });
  const vkEl = row.querySelector(".ce-vp-vk-display");
  const profitEl = row.querySelector(".ce-vp-profit-display");
  if (enabled) updateRowVk(row);
  else {
    if (vkEl) vkEl.innerHTML = '<span class="ce-vp__disabled-tag">—</span>';
    if (profitEl) profitEl.textContent = "";
  }
}

function updateColorCount(card) {
  const countEl = card?.querySelector(".ce-vp__color-count");
  if (!countEl) return;
  const total = card.querySelectorAll(".ce-vp__size-toggle").length;
  const enabled = card.querySelectorAll(".ce-vp__size-toggle:checked").length;
  countEl.textContent = `${enabled}/${total}`;
}

function updateSummary(panel) {
  const summaryEl = panel?.querySelector(".ce-vp__summary");
  if (!summaryEl) return;
  const totalVariants = panel.querySelectorAll(".ce-vp__size-toggle").length;
  const enabledCount = panel.querySelectorAll(".ce-vp__size-toggle:checked").length;
  const totalColors = panel.querySelectorAll(".ce-vp__color-card").length;
  summaryEl.innerHTML = `${totalColors} groups, ${totalVariants} variants — <strong>${enabledCount} / ${totalVariants} for publish</strong>`;
}

function updateGlobalAvgVk(panel) {
  const vkLabel = panel?.querySelector("#ce-vp-global-vk");
  if (!vkLabel) return;
  let total = 0;
  let count = 0;
  panel.querySelectorAll("tr[data-variant-id]").forEach((row) => {
    if (row.classList.contains("ce-vp__row-disabled")) return;
    const ek = Number(row.getAttribute("data-ek")) || 0;
    const mode = row.querySelector(".ce-vp-mode-select")?.value || "percent";
    const val = Number(row.querySelector(".ce-vp-value-input")?.value) || 0;
    total += calcVk(ek, mode, val);
    count++;
  });
  vkLabel.textContent = `→ Avg VK: ${count ? formatPrice(Math.round(total / count)) : "—"}`;
}

function applyGlobalPricing(panel) {
  const mode = panel.querySelector("#ce-vp-global-mode")?.value || "percent";
  const val = Number(panel.querySelector("#ce-vp-global-value")?.value) || 0;
  panel.querySelectorAll("tr[data-variant-id]").forEach((row) => {
    if (row.classList.contains("ce-vp__row-disabled")) return;
    const modeSel = row.querySelector(".ce-vp-mode-select");
    const valInp = row.querySelector(".ce-vp-value-input");
    if (modeSel) modeSel.value = mode;
    if (valInp) valInp.value = String(val);
    updateRowVk(row);
  });
  updateGlobalAvgVk(panel);
}

function applyGlobalBranding(panel) {
  const brandVal = panel.querySelector('input[name="ce-vp-global-branding"]:checked')?.value || "black";
  const ppId = panel.getAttribute("data-pp-id") || "0";
  panel.querySelectorAll(".ce-vp__color-card").forEach((card) => {
    const colorId = card.getAttribute("data-color-id");
    const radio = card.querySelector(`input[name="ce-vp-branding-${ppId}-${colorId}"][value="${brandVal}"]`);
    if (radio) radio.checked = true;
  });
}

export function bindVariantMatrixEvents(root) {
  const panel = (root || document).querySelector(".ce-vp-panel");
  if (!panel) return;

  panel.querySelectorAll(".ce-vp__color-header").forEach((header) => {
    header.addEventListener("click", (e) => {
      if (e.target.closest("label") || e.target.closest("input")) return;
      header.closest(".ce-vp__color-card")?.classList.toggle("is-open");
    });
  });

  panel.querySelectorAll(".ce-vp__color-toggle").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const card = cb.closest(".ce-vp__color-card");
      if (!card) return;
      if (cb.checked) {
        card.querySelectorAll(".ce-vp__size-toggle").forEach((st) => {
          st.checked = true;
          toggleRow(st.closest("tr"), true);
        });
      } else {
        card.querySelectorAll(".ce-vp__size-toggle").forEach((st) => {
          st.checked = false;
          toggleRow(st.closest("tr"), false);
        });
      }
      card.classList.toggle("is-color-disabled", !cb.checked);
      updateColorCount(card);
      updateSummary(panel);
      updateGlobalAvgVk(panel);
    });
  });

  panel.querySelectorAll(".ce-vp__size-toggle").forEach((cb) => {
    cb.addEventListener("change", () => {
      const row = cb.closest("tr");
      toggleRow(row, cb.checked);
      const card = cb.closest(".ce-vp__color-card");
      if (card) {
        const checkedCount = card.querySelectorAll(".ce-vp__size-toggle:checked").length;
        const totalCount = card.querySelectorAll(".ce-vp__size-toggle").length;
        const colorToggle = card.querySelector(".ce-vp__color-toggle");
        if (colorToggle) {
          colorToggle.checked = checkedCount > 0;
          colorToggle.indeterminate = checkedCount > 0 && checkedCount < totalCount;
        }
        card.classList.toggle("is-color-disabled", checkedCount === 0);
        updateColorCount(card);
      }
      updateSummary(panel);
      updateGlobalAvgVk(panel);
    });
  });

  panel.querySelectorAll("tr[data-variant-id]").forEach((row) => {
    row.querySelector(".ce-vp-mode-select")?.addEventListener("change", () => updateRowVk(row));
    row.querySelector(".ce-vp-value-input")?.addEventListener("input", () => updateRowVk(row));
  });

  panel.querySelector("#ce-vp-global-mode")?.addEventListener("change", () => updateGlobalAvgVk(panel));
  panel.querySelector("#ce-vp-global-value")?.addEventListener("input", () => updateGlobalAvgVk(panel));

  panel.querySelector("#ce-vp-save-pricing")?.addEventListener("click", () => applyGlobalPricing(panel));
  panel.querySelector("#ce-vp-save-branding")?.addEventListener("click", () => applyGlobalBranding(panel));
  panel.querySelector("#ce-vp-apply-all")?.addEventListener("click", () => {
    applyGlobalPricing(panel);
    applyGlobalBranding(panel);
  });

  updateGlobalAvgVk(panel);
}

export function collectVariantConfigFromDom(root) {
  const wrap = root || document;
  const panel = wrap.querySelector(".ce-vp-panel");
  const mode = wrap.querySelector("#ce-vp-global-mode")?.value || "percent";
  const value = Number(wrap.querySelector("#ce-vp-global-value")?.value ?? 30);
  const branding = wrap.querySelector('input[name="ce-vp-global-branding"]:checked')?.value || "black";
  const ppId = panel?.getAttribute("data-pp-id") || "0";
  const variants = {};

  wrap.querySelectorAll(".ce-vp__color-card").forEach((card) => {
    const colorId = card.getAttribute("data-color-id");
    const colorBranding =
      card.querySelector(`input[name="ce-vp-branding-${ppId}-${colorId}"]:checked`)?.value || branding;
    card.querySelectorAll("tr[data-variant-id]").forEach((row) => {
      const vid = row.getAttribute("data-variant-id");
      if (!vid) return;
      variants[vid] = {
        enabled: !!row.querySelector(".ce-vp__size-toggle")?.checked,
        profit_mode: row.querySelector(".ce-vp-mode-select")?.value || mode,
        profit_value: Number(row.querySelector(".ce-vp-value-input")?.value ?? value),
        branding: card.querySelector(".ce-vp-color-branding") ? colorBranding : branding,
      };
    });
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
