/**
 * Re-export shared market country picker (source: partner-ui/js/market-country-picker.js).
 * Keep this path so admin imports and smoke tests stay stable.
 */
export {
  renderMarketCountryPicker,
  bindMarketCountryPicker,
  syncMarketCountryPickerFromDom,
  readMarketCountryPicker,
  normalizeCountryCodeList,
  regionCodesFromCountryCodes,
  marketCountryCatalog,
  worldCountryCatalog,
  buildContinentGroups,
  countryDisplayName,
  buildCountryFlagHtml,
} from "/partner/shared/js/market-country-picker.js";
