/**
 * Shared ISO country → continent data for Partner + Admin market pickers.
 * Continents follow common geographic / UN M49-style grouping (not publish regions).
 * Continent map aligned with theme/assets/eaz-country-continents.js.
 */

/** ISO 3166-1 alpha-2 → continent key */
export const COUNTRY_CONTINENT_MAP = {
  AI: "NA", GT: "NA", GM: "AF", MX: "NA", MW: "AF", PN: "OC", AR: "SA", GU: "OC", BG: "EU",
  DM: "NA", GB: "EU", FM: "OC", PS: "AS", CW: "NA", RW: "AF", HK: "AS", UZ: "AS", CN: "AS",
  CY: "EU", AW: "NA", RE: "AF", KR: "AS", AQ: "AN", SO: "AF", LB: "AS", GN: "AF", TJ: "AS",
  MY: "AS", KP: "AS", SL: "AF", BJ: "AF", IT: "EU", TT: "NA", SA: "AS", CR: "NA", RS: "EU",
  TK: "OC", MN: "AS", BN: "AS", HU: "EU", MZ: "AF", KI: "OC", HT: "NA", KH: "AS", EG: "AF",
  TM: "AS", OM: "AS", JM: "NA", AZ: "EU", SK: "EU", BY: "EU", VN: "AS", VI: "NA", GI: "EU",
  SX: "NA", AX: "EU", SY: "AS", MQ: "NA", GL: "NA", HN: "NA", TN: "AF", KM: "AF", SI: "EU",
  CH: "EU", GG: "EU", MM: "AS", PY: "SA", BQ: "NA", BB: "NA", MO: "AS", JO: "AS", LA: "AS",
  TG: "AF", MA: "AF", PR: "NA", GF: "SA", PM: "NA", MF: "NA", EE: "EU", ID: "AS", SC: "AF",
  ML: "AF", TL: "OC", BR: "SA", GH: "AF", KE: "AF", IS: "EU", MG: "AF", BD: "AS", CD: "AF",
  ZW: "AF", PF: "OC", TR: "EU", CV: "AF", DO: "NA", BS: "NA", DE: "EU", SR: "SA", TO: "OC",
  IO: "AS", LC: "NA", IE: "EU", VA: "EU", CO: "SA", PT: "EU", FO: "EU", ST: "AF", MP: "OC",
  JE: "EU", YT: "AF", YE: "AS", NG: "AF", AF: "AS", BW: "AF", IM: "EU", SV: "NA", UG: "AF",
  AD: "EU", TC: "NA", TD: "AF", FI: "EU", RU: "EU", KZ: "AS", SJ: "EU", VE: "SA", MC: "EU",
  SN: "AF", NP: "AS", AE: "AS", TW: "AS", NC: "OC", BO: "SA", CL: "SA", CI: "AF", LY: "AF",
  PE: "SA", CA: "NA", FR: "EU", DJ: "AF", BI: "AF", XK: "EU", DK: "EU", GR: "EU", CZ: "EU",
  ER: "AF", NA: "AF", VG: "NA", IR: "AS", GQ: "AF", MR: "AF", BH: "AS", CC: "AS", ET: "AF",
  ZM: "AF", BA: "EU", FK: "SA", GD: "NA", TH: "AS", RO: "EU", VC: "NA", LR: "AF", US: "NA",
  SS: "AF", BV: "AN", AM: "AS", JP: "AS", PK: "AS", SZ: "AF", LI: "EU", IL: "AS", AS: "OC",
  LK: "AS", GS: "AN", AL: "EU", DZ: "AF", UA: "EU", SH: "AF", HM: "AN", SM: "EU", CU: "NA",
  NR: "OC", ES: "EU", KW: "AS", MS: "NA", MU: "AF", SE: "EU", AU: "OC", CM: "AF", EC: "SA",
  QA: "AS", MH: "OC", PL: "EU", KY: "NA", ZA: "AF", WF: "OC", WS: "OC", NL: "EU", EH: "AF",
  ME: "EU", BT: "AS", MT: "EU", VU: "OC", TZ: "AF", NZ: "OC", PW: "OC", PA: "NA", TV: "OC",
  FJ: "OC", NI: "NA", KG: "AS", TF: "AN", LV: "EU", GE: "AS", LU: "EU", AT: "EU", MK: "EU",
  BL: "NA", CX: "AS", SB: "OC", AG: "NA", IQ: "AS", MD: "EU", NF: "OC", CG: "AF", NU: "OC",
  LT: "EU", NE: "AF", GY: "SA", BM: "NA", GA: "AF", CK: "OC", AO: "AF", NO: "EU", GP: "NA",
  MV: "AS", BE: "EU", HR: "EU", BZ: "NA", KN: "NA", SG: "AS", LS: "AF", UY: "SA", BF: "AF",
  IN: "AS", PH: "AS", CF: "AF", SD: "AF", GW: "AF", PG: "OC", UM: "OC",
};

/** Display order for continent groups */
export const CONTINENT_ORDER = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"];

export const CONTINENT_LABELS = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
  OTHER: "Other regions",
};

/** Legacy publish-region tokens → ISO country lists (for migrating text like "EU") */
export const LEGACY_REGION_COUNTRIES = {
  EU: [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
    "IS", "NO", "CH", "LI",
    "AD", "AL", "BA", "ME", "MK", "RS", "XK",
    "UA", "MD",
    "MC", "SM", "VA",
    "TR",
    "GE", "AM", "AZ",
  ],
  UK: ["GB"],
  US: ["US"],
  CA: ["CA"],
  AU_NZ: ["AU", "NZ"],
  AU: ["AU"],
  NZ: ["NZ"],
};

/** Country → legacy publish region (for region_codes_json compatibility) */
const COUNTRY_TO_PUBLISH_REGION = {
  DE: "EU", FR: "EU", NL: "EU", CZ: "EU", PL: "EU", LV: "EU", SI: "EU", AT: "EU", CH: "EU",
  IT: "EU", ES: "EU", PT: "EU", BE: "EU", DK: "EU", FI: "EU", IE: "EU", NO: "EU", SE: "EU",
  LT: "EU", EE: "EU", HR: "EU", RO: "EU", BG: "EU", HU: "EU", SK: "EU", LU: "EU", MC: "EU",
  MT: "EU", CY: "EU", AD: "EU", IS: "EU", LI: "EU", AL: "EU", BA: "EU", ME: "EU", MK: "EU",
  RS: "EU", XK: "EU", UA: "EU", MD: "EU", SM: "EU", VA: "EU", TR: "EU", GE: "EU", AM: "EU",
  AZ: "EU", GR: "EU", GB: "UK", US: "US", CA: "CA", AU: "AU_NZ", NZ: "AU_NZ",
};

let _displayNames = null;
function displayNames() {
  if (_displayNames !== null) return _displayNames;
  try {
    _displayNames = typeof Intl !== "undefined" && Intl.DisplayNames
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;
  } catch {
    _displayNames = null;
  }
  return _displayNames;
}

export function getCountryContinent(iso) {
  const c = String(iso || "").trim().toUpperCase();
  return COUNTRY_CONTINENT_MAP[c] || "OTHER";
}

export function countryDisplayName(code, fallback = "") {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return fallback || "Unknown";
  const dn = displayNames();
  if (dn) {
    try {
      const name = dn.of(c);
      if (name && name !== c) return name;
    } catch {
      /* ignore */
    }
  }
  const trimmed = String(fallback || "").trim();
  return trimmed || c;
}

export function normalizeCountryFlagCode(code) {
  let c = String(code || "").trim().toUpperCase();
  if (c === "UK") c = "GB";
  return /^[A-Z]{2}$/.test(c) ? c : "";
}

export function getCountryFlagUrl(code) {
  const c = normalizeCountryFlagCode(code);
  return c ? `https://flagcdn.com/w80/${c.toLowerCase()}.png` : "";
}

export function countryCodeToFlag(code) {
  const c = normalizeCountryFlagCode(code);
  if (!c) return "🏳️";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + c.charCodeAt(0) - 65, base + c.charCodeAt(1) - 65);
}

/**
 * Circular flag markup via flagcdn PNG (Windows-safe); emoji fallback for unknown codes.
 */
export function buildCountryFlagHtml(code, { className = "partner-country-flag", title = "", ariaLabel = "" } = {}) {
  const c = normalizeCountryFlagCode(code);
  const url = getCountryFlagUrl(c);
  const titleAttr = title ? ` title="${String(title).replace(/"/g, "&quot;")}"` : "";
  const aria = ariaLabel
    ? ` aria-label="${String(ariaLabel).replace(/"/g, "&quot;")}"`
    : ' aria-hidden="true"';
  if (url) {
    return `<span class="${className}" style="background-image:url(${url})"${titleAttr}${aria}></span>`;
  }
  return `<span class="${className} ${className}--emoji"${titleAttr}${aria}>${countryCodeToFlag(c)}</span>`;
}

/** Normalize to unique ISO2 codes; expands legacy region tokens (EU, UK, …). */
export function normalizeCountryCodeList(codes) {
  const out = new Set();
  for (const raw of codes || []) {
    const u = String(raw || "").trim().toUpperCase();
    if (!u) continue;
    if (u === "UK") {
      out.add("GB");
      continue;
    }
    if (LEGACY_REGION_COUNTRIES[u]) {
      for (const cc of LEGACY_REGION_COUNTRIES[u]) out.add(cc);
      continue;
    }
    if (/^[A-Z]{2}$/.test(u)) out.add(u);
  }
  return [...out].sort();
}

/** Derive publish region codes (EU, US, UK, …) from ISO2 country codes. */
export function regionCodesFromCountryCodes(countryCodes) {
  const regions = new Set();
  for (const raw of countryCodes || []) {
    const cc = String(raw || "").trim().toUpperCase();
    if (!cc) continue;
    if (cc === "UK") {
      regions.add("UK");
      continue;
    }
    if (LEGACY_REGION_COUNTRIES[cc] && cc.length !== 2) {
      regions.add(cc === "AU" ? "AU_NZ" : cc);
      continue;
    }
    if (cc.length !== 2) continue;
    let region = COUNTRY_TO_PUBLISH_REGION[cc] || cc;
    if (region === "GB") region = "UK";
    else if (region === "AU" || region === "NZ") region = "AU_NZ";
    regions.add(region);
  }
  return [...regions].sort();
}

function allWorldCountryCodes() {
  return Object.keys(COUNTRY_CONTINENT_MAP).sort();
}

/**
 * Group countries by continent for the picker.
 * @param {{ allowedCountries?: string[]|null }} [opts]
 *   When allowedCountries is a non-empty array, only those codes are listed (Admin partner scope).
 *   When null/undefined, full world list. Empty array → no countries.
 */
export function buildContinentGroups(opts = {}) {
  const allowedRaw = opts.allowedCountries;
  let codes;
  if (allowedRaw === undefined || allowedRaw === null) {
    codes = allWorldCountryCodes();
  } else {
    codes = normalizeCountryCodeList(allowedRaw);
  }

  const byCont = new Map();
  for (const cc of codes) {
    const cont = getCountryContinent(cc);
    if (!byCont.has(cont)) byCont.set(cont, []);
    byCont.get(cont).push(cc);
  }

  const order = [...CONTINENT_ORDER, "OTHER"];
  const groups = [];
  for (const id of order) {
    const list = byCont.get(id);
    if (!list?.length) continue;
    list.sort((a, b) => countryDisplayName(a).localeCompare(countryDisplayName(b), "en"));
    groups.push({
      id,
      label: CONTINENT_LABELS[id] || id,
      description: CONTINENT_LABELS[id] || id,
      countries: list,
    });
  }
  return groups;
}

export function worldCountryCatalog() {
  return {
    continents: buildContinentGroups(),
    allCodes: allWorldCountryCodes(),
    continentLabels: { ...CONTINENT_LABELS },
  };
}
