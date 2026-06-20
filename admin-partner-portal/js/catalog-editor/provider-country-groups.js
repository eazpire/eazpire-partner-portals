/**
 * Group print providers by shipping origin country (Printify location).
 */

const ISO_3166_1_ALPHA2 = /^[A-Z]{2}$/;

const COUNTRY_NAME_TO_ISO = {
  AFGHANISTAN: "AF",
  AUSTRALIA: "AU",
  AUSTRIA: "AT",
  BELGIUM: "BE",
  BULGARIA: "BG",
  CANADA: "CA",
  CHINA: "CN",
  "CZECH REPUBLIC": "CZ",
  CZECHIA: "CZ",
  DENMARK: "DK",
  ESTONIA: "EE",
  FINLAND: "FI",
  FRANCE: "FR",
  GERMANY: "DE",
  GREECE: "GR",
  HUNGARY: "HU",
  IRELAND: "IE",
  ITALY: "IT",
  JAPAN: "JP",
  LATVIA: "LV",
  LITHUANIA: "LT",
  LUXEMBOURG: "LU",
  MEXICO: "MX",
  NETHERLANDS: "NL",
  "NEW ZEALAND": "NZ",
  NORWAY: "NO",
  POLAND: "PL",
  PORTUGAL: "PT",
  ROMANIA: "RO",
  SLOVAKIA: "SK",
  SLOVENIA: "SI",
  SPAIN: "ES",
  SWEDEN: "SE",
  SWITZERLAND: "CH",
  TURKEY: "TR",
  UKRAINE: "UA",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  "UNITED STATES": "US",
  USA: "US",
  US: "US",
  GLOBAL: "US",
};

const COUNTRY_DISPLAY = {
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  AT: "Austria",
  CH: "Switzerland",
  PL: "Poland",
  CZ: "Czech Republic",
  SE: "Sweden",
  DK: "Denmark",
  FI: "Finland",
  NO: "Norway",
  IE: "Ireland",
  PT: "Portugal",
  GR: "Greece",
  HU: "Hungary",
  RO: "Romania",
  SK: "Slovakia",
  SI: "Slovenia",
  LT: "Lithuania",
  LV: "Latvia",
  EE: "Estonia",
  LU: "Luxembourg",
  BG: "Bulgaria",
  HR: "Croatia",
  CY: "Cyprus",
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  UK: "United Kingdom",
  AU: "Australia",
  NZ: "New Zealand",
  MX: "Mexico",
  CN: "China",
  JP: "Japan",
  IN: "India",
  BR: "Brazil",
  TR: "Turkey",
  UA: "Ukraine",
};

/** Preferred sort order for common ship-from countries; rest alphabetical. */
const COUNTRY_SORT_PRIORITY = [
  "US",
  "DE",
  "GB",
  "CA",
  "AU",
  "NL",
  "PL",
  "CZ",
  "FR",
  "IT",
  "ES",
  "LV",
  "OTHER",
];

export function normalizeCountryCode(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (ISO_3166_1_ALPHA2.test(upper)) return upper;
  const mapped = COUNTRY_NAME_TO_ISO[upper];
  if (mapped) return mapped;
  const token = upper.split(/[/,\-|]/)[0].trim();
  if (ISO_3166_1_ALPHA2.test(token)) return token;
  return COUNTRY_NAME_TO_ISO[token] || null;
}

/** ISO 3166-1 alpha-2 → regional indicator flag emoji (e.g. US → 🇺🇸). */
export function countryCodeToFlag(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + c.charCodeAt(0) - 65, base + c.charCodeAt(1) - 65);
}

export function countryDisplayName(code, fallbackLabel = "") {
  const c = String(code || "").trim().toUpperCase();
  if (c && COUNTRY_DISPLAY[c]) return COUNTRY_DISPLAY[c];
  const fromLabel = normalizeCountryCode(fallbackLabel);
  if (fromLabel && COUNTRY_DISPLAY[fromLabel]) return COUNTRY_DISPLAY[fromLabel];
  const trimmed = String(fallbackLabel || "").trim();
  if (trimmed) return trimmed;
  return "Other";
}

export function resolveProviderShipCountry(fp) {
  const loc = fp?.locationDetail || fp?.catalogData?.location;
  if (loc?.country) {
    const code = normalizeCountryCode(loc.country) || "OTHER";
    return { code, name: countryDisplayName(code, loc.country) };
  }

  const shipsFrom = fp?.catalogData?.ships_from;
  if (shipsFrom) {
    const code = normalizeCountryCode(shipsFrom) || "OTHER";
    return { code, name: countryDisplayName(code, shipsFrom) };
  }

  if (fp?.locationLabel) {
    const label = String(fp.locationLabel).trim();
    const firstPart = label.split(/\s*\/\s*/)[0]?.trim() || label;
    const code = normalizeCountryCode(firstPart) || normalizeCountryCode(label) || "OTHER";
    return { code, name: countryDisplayName(code, firstPart) };
  }

  if (fp?.dbPlan?.provider_location) {
    const raw = String(fp.dbPlan.provider_location).trim();
    const firstPart = raw.split(/\s*\/\s*/)[0]?.trim() || raw;
    const code = normalizeCountryCode(firstPart) || "OTHER";
    return { code, name: countryDisplayName(code, firstPart) };
  }

  return { code: "OTHER", name: "Other" };
}

export function groupProvidersByShipCountry(providers, getProviderId) {
  const map = new Map();
  for (const fp of providers || []) {
    const { code, name } = resolveProviderShipCountry(fp);
    const key = code || "OTHER";
    if (!map.has(key)) {
      map.set(key, { code: key, name, providers: [] });
    }
    map.get(key).providers.push(fp);
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.providers.sort((a, b) => {
      const na = String(a?.name || a?.title || "").toLowerCase();
      const nb = String(b?.name || b?.title || "").toLowerCase();
      return na.localeCompare(nb);
    });
  }

  groups.sort((a, b) => {
    const ia = COUNTRY_SORT_PRIORITY.indexOf(a.code);
    const ib = COUNTRY_SORT_PRIORITY.indexOf(b.code);
    const pa = ia === -1 ? 999 : ia;
    const pb = ib === -1 ? 999 : ib;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  return groups;
}
