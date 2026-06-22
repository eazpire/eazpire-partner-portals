import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { buildCountryFlagHtml, countryDisplayName } from "./provider-country-groups.js";

/** Canonical publish regions — aligned with resolvePlanCountries.js */
const MARKET_REGIONS = [
  {
    id: "EU",
    label: "EU",
    description: "European Union & EEA",
    countries: [
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
      "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
      "IS", "NO", "CH", "LI",
      "AD", "AL", "BA", "ME", "MK", "RS", "XK",
      "UA", "MD",
      "MC", "SM", "VA",
      "TR",
      "GE", "AM", "AZ",
    ],
  },
  { id: "UK", label: "UK", description: "United Kingdom", countries: ["GB"] },
  { id: "US", label: "US", description: "United States", countries: ["US"] },
  { id: "CA", label: "CA", description: "Canada", countries: ["CA"] },
  { id: "AU_NZ", label: "AU / NZ", description: "Australia & New Zealand", countries: ["AU", "NZ"] },
];

const COUNTRY_TO_REGION = (() => {
  const map = {};
  for (const region of MARKET_REGIONS) {
    for (const cc of region.countries) {
      map[cc] = region.id;
    }
  }
  return map;
})();

export function regionCodesFromCountryCodes(countryCodes) {
  const regions = new Set();
  for (const raw of countryCodes || []) {
    const cc = String(raw || "").trim().toUpperCase();
    if (cc === "UK") {
      regions.add("UK");
      continue;
    }
    if (cc.length !== 2) continue;
    const region = COUNTRY_TO_REGION[cc] || cc;
    if (region === "GB") regions.add("UK");
    else if (region === "AU" || region === "NZ") regions.add("AU_NZ");
    else regions.add(region);
  }
  return [...regions].sort();
}

export function normalizeCountryCodeList(codes) {
  return [
    ...new Set(
      (codes || [])
        .map((c) => {
          const u = String(c || "").trim().toUpperCase();
          return u === "UK" ? "GB" : u;
        })
        .filter((c) => /^[A-Z]{2}$/.test(c))
    ),
  ].sort();
}

function allMarketCountryCodes() {
  const out = [];
  for (const region of MARKET_REGIONS) {
    out.push(...region.countries);
  }
  return [...new Set(out)].sort();
}

function renderCountryRow(cc, regionId, selected) {
  const checked = selected.has(cc) ? " checked" : "";
  const name = countryDisplayName(cc, cc);
  const flag = buildCountryFlagHtml(cc, {
    className: "ce-market-country-flag",
    title: name,
    ariaLabel: "",
  });
  return `
    <label class="ce-market-country">
      <input type="checkbox" class="ce-market-country-cb" value="${escapeHtml(cc)}" data-region="${escapeHtml(regionId)}"${checked} />
      ${flag}
      <span class="ce-market-country-name">${escapeHtml(name)}</span>
      <span class="ce-market-country-code">${escapeHtml(cc)}</span>
    </label>`;
}

function renderRegionBlock(region, selected) {
  const countries = region.countries;
  const selectedInRegion = countries.filter((cc) => selected.has(cc)).length;
  const allOn = selectedInRegion === countries.length && countries.length > 0;
  const regionChecked = allOn ? " checked" : "";
  const indeterminate = selectedInRegion > 0 && !allOn ? ' data-indeterminate="1"' : "";

  const rows = countries.map((cc) => renderCountryRow(cc, region.id, selected)).join("");

  return `
    <section class="ce-market-region" data-region="${escapeHtml(region.id)}">
      <header class="ce-market-region-head">
        <label class="ce-market-region-select">
          <input type="checkbox" class="ce-market-region-cb" data-region="${escapeHtml(region.id)}"${regionChecked}${indeterminate} />
          <span class="ce-market-region-label">
            <strong class="ce-market-region-code">${escapeHtml(region.label)}</strong>
            <span class="ce-market-region-desc">${escapeHtml(region.description)}</span>
          </span>
          <span class="ce-market-region-count" data-region-count="${escapeHtml(region.id)}">${selectedInRegion}/${countries.length}</span>
        </label>
      </header>
      <div class="ce-market-region-countries" role="group" aria-label="${escapeHtml(region.label)} countries">
        ${rows}
      </div>
    </section>`;
}

/**
 * @param {{ idPrefix: string, selected?: string[], hint?: string }} opts
 */
export function renderMarketCountryPicker(opts) {
  const idPrefix = opts.idPrefix || "ce-market";
  const selected = new Set(normalizeCountryCodeList(opts.selected || []));
  const regionsHtml = MARKET_REGIONS.map((r) => renderRegionBlock(r, selected)).join("");

  return `
    <div class="ce-market-countries" data-picker-id="${escapeHtml(idPrefix)}">
      <div class="ce-market-regions" id="${escapeHtml(idPrefix)}-regions" role="group" aria-label="Publish countries by region">
        ${regionsHtml}
      </div>
      <input type="hidden" id="${escapeHtml(idPrefix)}-hidden" value="${escapeHtml([...selected].join(","))}" />
      <p class="ce-hint ce-market-country-hint" id="${escapeHtml(idPrefix)}-hint">${escapeHtml(opts.hint || formatMarketHint([...selected]))}</p>
    </div>`;
}

function formatMarketHint(selected) {
  if (!selected.length) {
    return "No countries selected — product will not publish to any market.";
  }
  const regions = regionCodesFromCountryCodes(selected);
  return `Selected: ${selected.length} ${selected.length === 1 ? "country" : "countries"} · Regions: ${regions.join(", ")}`;
}

export function readMarketCountryPicker(idPrefix) {
  const hidden = document.getElementById(`${idPrefix}-hidden`);
  if (hidden?.value) {
    return normalizeCountryCodeList(hidden.value.split(","));
  }
  const root = document.getElementById(`${idPrefix}-regions`);
  if (!root) return [];
  return normalizeCountryCodeList(
    [...root.querySelectorAll(".ce-market-country-cb:checked")].map((cb) => cb.value)
  );
}

function updateRegionCheckboxState(regionEl) {
  const regionCb = regionEl.querySelector(".ce-market-region-cb");
  const countryCbs = [...regionEl.querySelectorAll(".ce-market-country-cb")];
  if (!regionCb || !countryCbs.length) return;
  const checkedCount = countryCbs.filter((cb) => cb.checked).length;
  regionCb.checked = checkedCount === countryCbs.length;
  regionCb.indeterminate = checkedCount > 0 && checkedCount < countryCbs.length;
  const countEl = regionEl.querySelector(".ce-market-region-count");
  if (countEl) countEl.textContent = `${checkedCount}/${countryCbs.length}`;
}

function syncMarketPickerHidden(idPrefix) {
  const regionsRoot = document.getElementById(`${idPrefix}-regions`);
  const hidden = document.getElementById(`${idPrefix}-hidden`);
  if (!regionsRoot || !hidden) return;
  const selected = normalizeCountryCodeList(
    [...regionsRoot.querySelectorAll(".ce-market-country-cb:checked")].map((cb) => cb.value)
  );
  hidden.value = selected.join(",");
  const hint = document.getElementById(`${idPrefix}-hint`);
  if (hint) hint.textContent = formatMarketHint(selected);
  regionsRoot.querySelectorAll(".ce-market-region").forEach(updateRegionCheckboxState);
}

export function bindMarketCountryPicker(root, idPrefix, onChange) {
  const regionsRoot = root.querySelector(`#${CSS.escape(idPrefix)}-regions`);
  if (!regionsRoot) return;

  const notify = () => {
    syncMarketPickerHidden(idPrefix);
    onChange?.();
  };

  regionsRoot.querySelectorAll(".ce-market-country-cb").forEach((cb) => {
    cb.addEventListener("change", notify);
  });

  regionsRoot.querySelectorAll(".ce-market-region-cb").forEach((regionCb) => {
    regionCb.addEventListener("change", () => {
      const regionId = regionCb.dataset.region;
      const regionEl = regionsRoot.querySelector(`.ce-market-region[data-region="${CSS.escape(regionId)}"]`);
      if (!regionEl) return;
      const countryCbs = regionEl.querySelectorAll(".ce-market-country-cb");
      const turnOn = regionCb.checked;
      countryCbs.forEach((cb) => {
        cb.checked = turnOn;
      });
      regionCb.indeterminate = false;
      notify();
    });
  });

  regionsRoot.querySelectorAll(".ce-market-region").forEach((regionEl) => {
    const regionCb = regionEl.querySelector(".ce-market-region-cb");
    if (regionCb?.dataset.indeterminate === "1") {
      regionCb.indeterminate = true;
    }
    updateRegionCheckboxState(regionEl);
  });
}

export function syncMarketCountryPickerFromDom(root, idPrefix) {
  syncMarketPickerHidden(idPrefix);
  return readMarketCountryPicker(idPrefix);
}

/** @internal — smoke / parity */
export function marketCountryCatalog() {
  return { regions: MARKET_REGIONS, allCodes: allMarketCountryCodes() };
}
