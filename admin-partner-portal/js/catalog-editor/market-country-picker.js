import { escapeHtml } from "/partner/shared/js/partner-api.js";

/** Common publish markets — extend as needed. */
export const MARKET_COUNTRY_CODES = [
  "DE", "FR", "IT", "ES", "NL", "BE", "AT", "PL", "CZ", "CH",
  "US", "CA", "GB", "UK", "AU", "NZ", "NO", "SE", "DK", "FI", "IE", "PT",
];

const COUNTRY_TO_REGION = {
  DE: "EU", FR: "EU", NL: "EU", CZ: "EU", PL: "EU", AT: "EU", BE: "EU", IT: "EU", ES: "EU", PT: "EU",
  DK: "EU", FI: "EU", IE: "EU", NO: "EU", SE: "EU", CH: "EU", LU: "EU",
  GB: "UK", UK: "UK", US: "US", CA: "CA", AU: "AU_NZ", NZ: "AU_NZ",
};

export function regionCodesFromCountryCodes(countryCodes) {
  const regions = new Set();
  for (const raw of countryCodes || []) {
    const cc = String(raw || "").trim().toUpperCase();
    if (cc.length !== 2) continue;
    let region = COUNTRY_TO_REGION[cc] || cc;
    if (region === "GB") region = "UK";
    if (region === "AU" || region === "NZ") region = "AU_NZ";
    regions.add(region);
  }
  return [...regions].sort();
}

export function normalizeCountryCodeList(codes) {
  return [
    ...new Set(
      (codes || [])
        .map((c) => String(c || "").trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
    ),
  ].sort();
}

/**
 * @param {{ idPrefix: string, selected?: string[], hint?: string }} opts
 */
export function renderMarketCountryPicker(opts) {
  const idPrefix = opts.idPrefix || "ce-market";
  const selected = new Set(normalizeCountryCodeList(opts.selected || []));
  const chips = MARKET_COUNTRY_CODES.map((cc) => {
    const on = selected.has(cc) ? " ce-market-chip--on" : "";
    return `<button type="button" class="ce-market-chip${on}" data-country="${escapeHtml(cc)}" aria-pressed="${selected.has(cc) ? "true" : "false"}">${escapeHtml(cc)}</button>`;
  }).join("");

  return `
    <div class="ce-market-countries" data-picker-id="${escapeHtml(idPrefix)}">
      <div class="ce-market-chip-grid" id="${escapeHtml(idPrefix)}-chips" role="group" aria-label="Publish countries">${chips}</div>
      <input type="hidden" id="${escapeHtml(idPrefix)}-hidden" value="${escapeHtml([...selected].join(","))}" />
      <p class="ce-hint ce-market-country-hint" id="${escapeHtml(idPrefix)}-hint">${escapeHtml(opts.hint || "Selected countries control where this product can be published.")}</p>
    </div>`;
}

export function readMarketCountryPicker(idPrefix) {
  const hidden = document.getElementById(`${idPrefix}-hidden`);
  if (!hidden) return [];
  return normalizeCountryCodeList(hidden.value.split(","));
}

function syncMarketPickerHidden(idPrefix) {
  const grid = document.getElementById(`${idPrefix}-chips`);
  const hidden = document.getElementById(`${idPrefix}-hidden`);
  if (!grid || !hidden) return;
  const selected = [...grid.querySelectorAll(".ce-market-chip--on")].map((b) => b.dataset.country);
  hidden.value = normalizeCountryCodeList(selected).join(",");
  const hint = document.getElementById(`${idPrefix}-hint`);
  if (hint) {
    hint.textContent = selected.length
      ? `Selected: ${selected.join(", ")}`
      : "No countries selected — product will not publish to any market.";
  }
}

export function bindMarketCountryPicker(root, idPrefix, onChange) {
  const grid = root.querySelector(`#${CSS.escape(idPrefix)}-chips`);
  if (!grid) return;
  grid.querySelectorAll(".ce-market-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.classList.toggle("ce-market-chip--on");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      syncMarketPickerHidden(idPrefix);
      onChange?.();
    });
  });
}

export function syncMarketCountryPickerFromDom(root, idPrefix) {
  syncMarketPickerHidden(idPrefix);
  return readMarketCountryPicker(idPrefix);
}
