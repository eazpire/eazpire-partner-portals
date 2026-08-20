/**
 * Aggregate per-version (PAT) auto-publish flags for Catalog Studio overview rows.
 * A channel is ON if any active version has it enabled. Amazon countries are a union.
 */

export const AMAZON_EU_CODES = ["FR", "NL", "PL", "UK", "DE", "ES", "IE", "SE", "BE", "IT"];
export const AMAZON_NA_CODES = ["CA", "US"];
export const AMAZON_ALL_CODES = [...AMAZON_EU_CODES, ...AMAZON_NA_CODES];

function asBool(v) {
  return v === true || v === 1 || v === "1" || String(v || "").toLowerCase() === "true";
}

function isActiveVersion(row) {
  if (row == null) return false;
  if (row.is_active === 0 || row.is_active === false || row.is_active === "0") return false;
  return true;
}

export function emptyAutomationsSummary() {
  return {
    printify: false,
    shopify: false,
    amazon: false,
    amazon_countries: [],
    amazon_count: 0,
    mixed: false,
  };
}

/** Same default as Automations tab: Amazon on + no countries → all EU markets. */
export function enabledAmazonCountries(markets, amazonOn) {
  if (!amazonOn) return [];
  const src = markets && typeof markets === "object" && !Array.isArray(markets) ? markets : {};
  const on = AMAZON_ALL_CODES.filter((code) => asBool(src[code]));
  if (on.length) return on;
  return [...AMAZON_EU_CODES];
}

function sortAmazonCountries(codes) {
  const rank = new Map(AMAZON_ALL_CODES.map((code, i) => [code, i]));
  return [...new Set(codes)].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99) || a.localeCompare(b));
}

export function normalizeAutomationVersion(row) {
  if (!row || typeof row !== "object") return null;
  const auto = row.auto_publish_config && typeof row.auto_publish_config === "object" ? row.auto_publish_config : null;
  const markets =
    row.amazon_markets ||
    row.automation_amazon_markets ||
    auto?.amazon_markets ||
    auto?.automation_amazon_markets ||
    {};
  return {
    is_active: row.is_active,
    printify: asBool(row.auto_publish_enabled ?? auto?.auto_publish_enabled),
    shopify: asBool(row.automation_shopify_sync_enabled ?? auto?.automation_shopify_sync_enabled),
    amazon: asBool(row.automation_amazon_publish_enabled ?? auto?.automation_amazon_publish_enabled),
    markets,
  };
}

/**
 * @param {object[]} rows — PAT rows or version rows (active + inactive)
 * @returns {ReturnType<typeof emptyAutomationsSummary>}
 */
export function aggregateProductAutomations(rows) {
  const versions = (rows || []).map(normalizeAutomationVersion).filter(Boolean).filter(isActiveVersion);
  if (!versions.length) return emptyAutomationsSummary();

  const printifyAny = versions.some((v) => v.printify);
  const shopifyAny = versions.some((v) => v.shopify);
  const amazonAny = versions.some((v) => v.amazon);
  const mixed =
    versions.length > 1 &&
    ((printifyAny && versions.some((v) => !v.printify)) ||
      (shopifyAny && versions.some((v) => !v.shopify)) ||
      (amazonAny && versions.some((v) => !v.amazon)));

  const countrySet = new Set();
  for (const v of versions) {
    for (const code of enabledAmazonCountries(v.markets, v.amazon)) countrySet.add(code);
  }
  const amazon_countries = sortAmazonCountries([...countrySet]);

  return {
    printify: printifyAny,
    shopify: shopifyAny,
    amazon: amazonAny,
    amazon_countries,
    amazon_count: amazon_countries.length,
    mixed,
  };
}
