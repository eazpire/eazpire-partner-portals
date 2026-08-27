/**
 * Live Spread Connect EU Standard shipping (IDEA-085).
 *
 * Probed 2026-08-27 against https://rest.spod.com (X-SPOD-ACCESS-TOKEN).
 * Docs: https://rest.spod.com/docs/
 *
 * There is no catalog shipping/countries endpoint (GET /shipping, /countries,
 * /shippingTypes, /productTypes/shipping → 404). Quotes come from:
 *   POST /orders  { state: "NEW" }
 *   GET  /orders/{id}/shippingTypes
 *   POST /orders/{id}/cancel
 *
 * Standard method shape:
 *   { id, name, description, price: { amount, taxRate, taxAmount, currency } }
 * No transit min/max on the method. Production SLA (help center): 95% shipped
 * within 48 hours — that is not delivery days.
 *
 * Quote SKUs: tee 598247906-P6A2S3 (type 6), hoodie 598252912-P20A2S3 (type 20).
 * Postage is order-value based. Tank type 916 matched tee. Mug/Bag/Baby had no
 * articles in the account — those keys inherit the tee table (explicit gap).
 *
 * Rebuild notes: scripts/spreadconnect/build-shipping-fixture.mjs
 */

function expandBands(bands) {
  /** @type {Record<string, { first: number, additional: number }>} */
  const out = {};
  for (const band of bands) {
    for (const code of band.countries) {
      out[code] = { first: band.first, additional: band.additional };
    }
  }
  return out;
}

/** ISO2 destinations that returned NO_SHIPPING_TYPE from the EU warehouse. */
export const SPREAD_EU_NO_SHIP_COUNTRY_CODES = Object.freeze([
  "AR", "AU", "CH", "KR", "LI", "NO", "NZ", "UA", "US",
]);

/**
 * Tee (type 6) Standard: first item EUR cents / additional = qty2 − qty1.
 * Live amounts: 3.55, 3.99, 4.65, 5.99, 6.99, 9.99 — not placeholders.
 */
export const SPREAD_EU_SHIPPING_RATES_DEFAULT = Object.freeze(
  expandBands([
    { first: 355, additional: 144, countries: ["AT", "BE", "DK", "GR", "LU", "MC", "NL", "SE"] },
    { first: 399, additional: 61, countries: ["DE"] },
    { first: 465, additional: 134, countries: ["ES", "FI", "FR", "GB", "IE", "IT", "PL"] },
    { first: 599, additional: 56, countries: ["AD", "AL", "BA", "MD", "MK", "MT", "SM"] },
    { first: 699, additional: 0, countries: ["BG", "CZ", "EE", "HR", "HU", "LT", "LV", "PT", "RO", "SI", "SK"] },
    {
      first: 999,
      additional: 0,
      countries: [
        "AE", "BR", "CA", "CL", "CO", "CR", "CY", "EG", "GH", "HK", "ID", "IL", "IN", "IS", "JP",
        "KE", "KW", "MA", "ME", "MX", "MY", "NG", "PA", "PE", "PH", "QA", "RS", "SA", "SG", "TH",
        "TN", "TR", "TW", "UY", "VA", "VN", "ZA",
      ],
    },
  ])
);

/**
 * Hoodie type 20 Standard overrides. 6.99-band (BG/CZ/…) matched tee — omitted.
 * Only type 20 was quoted for every destination; other hoodie types reuse this
 * class because postage is order-value based (hoodie b2b 25.60 vs tee 9.05).
 */
export const SPREAD_EU_SHIPPING_RATES_HOODIE = Object.freeze(
  expandBands([
    { first: 499, additional: 200, countries: ["AT", "BE", "DK", "GR", "LU", "MC", "NL", "SE"] },
    { first: 460, additional: 190, countries: ["DE"] },
    { first: 599, additional: 126, countries: ["ES", "FI", "FR", "GB", "IE", "IT", "PL"] },
    { first: 655, additional: 70, countries: ["AD", "AL", "BA", "MD", "MK", "MT", "SM"] },
    {
      first: 1699,
      additional: 0,
      countries: [
        "AE", "BR", "CA", "CL", "CO", "CR", "CY", "EG", "GH", "HK", "ID", "IL", "IN", "IS", "JP",
        "KE", "KW", "MA", "ME", "MX", "MY", "NG", "PA", "PE", "PH", "QA", "RS", "SA", "SG", "TH",
        "TN", "TR", "TW", "UY", "VA", "VN", "ZA",
      ],
    },
  ])
);

export const SPREAD_EU_HOODIE_RATE_TYPE_IDS = Object.freeze(["20"]);

export const SPREAD_EU_SHIPPABLE_COUNTRY_CODES = Object.freeze(
  Object.keys(SPREAD_EU_SHIPPING_RATES_DEFAULT).sort()
);

/** Todify is the Morocco partner — MA ships on Spread API but stays unchecked by default. */
export const SPREAD_EU_TODIFY_MARKET_EXCEPTION = "MA";

export const SPREAD_EU_DEFAULT_MARKET_COUNTRY_CODES = Object.freeze(
  SPREAD_EU_SHIPPABLE_COUNTRY_CODES.filter((c) => c !== SPREAD_EU_TODIFY_MARKET_EXCEPTION)
);

/** Editor market pool (MA present so it can be checked manually). */
export const SPREAD_EU_AVAILABLE_COUNTRY_CODES = SPREAD_EU_SHIPPABLE_COUNTRY_CODES;

export const SPREAD_EU_SHIPPING_SYNC_SOURCE = "spreadconnect_order_shipping_types";

export const SPREAD_EU_SHIPPING_PROBE = Object.freeze({
  api: "https://rest.spod.com",
  docs: "https://rest.spod.com/docs/",
  helpCalculator: "https://faq.spreadconnect.app/hc/en-us/articles/360021480060",
  helpExclusions: "https://faq.spreadconnect.app/hc/en-us/articles/360020928279",
  legalLeipzig: "https://www.spreadshop.de/legal-information/",
  teeSku: "598247906-P6A2S3",
  hoodieSku: "598252912-P20A2S3",
  probedAt: "2026-08-27",
});
