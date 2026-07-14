/**
 * Collapsible continent-grouped country picker for Partner + Admin markets.
 * Persist ISO country codes; derive publish regions via regionCodesFromCountryCodes.
 */
import { escapeHtml } from "./partner-api.js";
import {
  buildContinentGroups,
  buildCountryFlagHtml,
  countryDisplayName,
  normalizeCountryCodeList,
  regionCodesFromCountryCodes,
  worldCountryCatalog,
} from "./world-countries.js";

export {
  normalizeCountryCodeList,
  regionCodesFromCountryCodes,
  worldCountryCatalog,
  buildContinentGroups,
  countryDisplayName,
  buildCountryFlagHtml,
} from "./world-countries.js";

function formatMarketHint(selected) {
  if (!selected.length) {
    return "No countries selected — product will not publish to any market.";
  }
  const regions = regionCodesFromCountryCodes(selected);
  return `Selected: ${selected.length} ${selected.length === 1 ? "country" : "countries"} · Regions: ${regions.join(", ")}`;
}

function renderCountryRow(cc, continentId, selected) {
  const checked = selected.has(cc) ? " checked" : "";
  const name = countryDisplayName(cc, cc);
  const flag = buildCountryFlagHtml(cc, {
    className: "ce-market-country-flag",
    title: name,
    ariaLabel: "",
  });
  return `
    <label class="ce-market-country">
      <input type="checkbox" class="ce-market-country-cb" value="${escapeHtml(cc)}" data-region="${escapeHtml(continentId)}"${checked} />
      ${flag}
      <span class="ce-market-country-name">${escapeHtml(name)}</span>
      <span class="ce-market-country-code">${escapeHtml(cc)}</span>
    </label>`;
}

function renderContinentBlock(group, selected, collapsed, idPrefix) {
  const countries = group.countries;
  const selectedInRegion = countries.filter((cc) => selected.has(cc)).length;
  const allOn = selectedInRegion === countries.length && countries.length > 0;
  const regionChecked = allOn ? " checked" : "";
  const indeterminate = selectedInRegion > 0 && !allOn ? ' data-indeterminate="1"' : "";
  const bodyHidden = collapsed ? " hidden" : "";
  const expanded = collapsed ? "false" : "true";
  const bodyId = `${idPrefix}-${group.id}-countries`;

  const rows = countries.map((cc) => renderCountryRow(cc, group.id, selected)).join("");

  return `
    <section class="ce-market-region${collapsed ? " ce-market-region--collapsed" : ""}" data-region="${escapeHtml(group.id)}">
      <header class="ce-market-region-head">
        <button type="button" class="ce-market-region-toggle" data-region="${escapeHtml(group.id)}" aria-expanded="${expanded}" aria-controls="${escapeHtml(bodyId)}" title="Collapse or expand ${escapeHtml(group.label)}">
          <span class="ce-market-chevron" aria-hidden="true"></span>
        </button>
        <label class="ce-market-region-select">
          <input type="checkbox" class="ce-market-region-cb" data-region="${escapeHtml(group.id)}"${regionChecked}${indeterminate} />
          <span class="ce-market-region-label">
            <strong class="ce-market-region-code">${escapeHtml(group.label)}</strong>
            <span class="ce-market-region-desc">${escapeHtml(group.description)}</span>
          </span>
          <span class="ce-market-region-count" data-region-count="${escapeHtml(group.id)}">${selectedInRegion}/${countries.length}</span>
        </label>
      </header>
      <div class="ce-market-region-countries" id="${escapeHtml(bodyId)}" role="group" aria-label="${escapeHtml(group.label)} countries"${bodyHidden}>
        ${rows}
      </div>
    </section>`;
}

/**
 * @param {{
 *   idPrefix: string,
 *   selected?: string[],
 *   hint?: string,
 *   allowedCountries?: string[]|null,
 *   defaultCollapsed?: boolean,
 *   emptyMessage?: string,
 * }} opts
 */
export function renderMarketCountryPicker(opts) {
  const idPrefix = opts.idPrefix || "ce-market";
  const selected = new Set(normalizeCountryCodeList(opts.selected || []));
  const groups = buildContinentGroups({ allowedCountries: opts.allowedCountries });
  const collapsed = opts.defaultCollapsed !== false;
  const regionsHtml = groups.map((g) => renderContinentBlock(g, selected, collapsed, idPrefix)).join("");

  const emptyHtml =
    !groups.length
      ? `<p class="ce-hint ce-market-empty">${escapeHtml(
          opts.emptyMessage ||
            "No countries available. Ask the partner to select shipping countries in the product Details tab."
        )}</p>`
      : "";

  return `
    <div class="ce-market-countries" data-picker-id="${escapeHtml(idPrefix)}">
      <div class="ce-market-toolbar">
        <button type="button" class="btn btn-ghost btn-sm ce-market-collapse-all" data-picker="${escapeHtml(idPrefix)}" data-action="collapse">Collapse all</button>
        <button type="button" class="btn btn-ghost btn-sm ce-market-expand-all" data-picker="${escapeHtml(idPrefix)}" data-action="expand">Expand all</button>
      </div>
      <div class="ce-market-regions" id="${escapeHtml(idPrefix)}-regions" role="group" aria-label="Publish countries by continent">
        ${emptyHtml || regionsHtml}
      </div>
      <input type="hidden" id="${escapeHtml(idPrefix)}-hidden" value="${escapeHtml([...selected].join(","))}" />
      <p class="ce-hint ce-market-country-hint" id="${escapeHtml(idPrefix)}-hint">${escapeHtml(opts.hint || formatMarketHint([...selected]))}</p>
    </div>`;
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

function setContinentCollapsed(regionEl, collapsed) {
  const body = regionEl.querySelector(".ce-market-region-countries");
  const toggle = regionEl.querySelector(".ce-market-region-toggle");
  if (body) body.hidden = collapsed;
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  regionEl.classList.toggle("ce-market-region--collapsed", collapsed);
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
  const pickerRoot = root.querySelector(`.ce-market-countries[data-picker-id="${CSS.escape(idPrefix)}"]`) || root;
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

    const toggle = regionEl.querySelector(".ce-market-region-toggle");
    toggle?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = regionEl.querySelector(".ce-market-region-countries");
      const nextCollapsed = !body?.hidden;
      setContinentCollapsed(regionEl, nextCollapsed);
    });
  });

  pickerRoot.querySelectorAll(".ce-market-collapse-all, .ce-market-expand-all").forEach((btn) => {
    btn.addEventListener("click", () => {
      const collapse = btn.dataset.action === "collapse";
      regionsRoot.querySelectorAll(".ce-market-region").forEach((regionEl) => {
        setContinentCollapsed(regionEl, collapse);
      });
    });
  });
}

export function syncMarketCountryPickerFromDom(root, idPrefix) {
  syncMarketPickerHidden(idPrefix);
  return readMarketCountryPicker(idPrefix);
}

/** @internal — smoke / parity */
export function marketCountryCatalog() {
  const cat = worldCountryCatalog();
  return { regions: cat.continents, allCodes: cat.allCodes };
}
