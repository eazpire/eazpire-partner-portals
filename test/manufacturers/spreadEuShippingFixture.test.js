import { describe, expect, it } from "vitest";
import {
  SPREAD_EU_DEFAULT_MARKET_COUNTRY_CODES,
  SPREAD_EU_NO_SHIP_COUNTRY_CODES,
  SPREAD_EU_SHIPPABLE_COUNTRY_CODES,
  SPREAD_EU_SHIPPING_PROBE,
  SPREAD_EU_SHIPPING_RATES_DEFAULT,
  SPREAD_EU_SHIPPING_RATES_HOODIE,
  SPREAD_EU_TODIFY_MARKET_EXCEPTION,
} from "../../src/features/manufacturers/adapters/spreadconnect/spreadEuShippingFixture.js";

describe("spreadEuShippingFixture (live API sample 2026-08-27)", () => {
  it("matches Standard shippingTypes amounts from POST /orders quotes", () => {
    expect(SPREAD_EU_SHIPPING_PROBE.api).toBe("https://rest.spod.com");
    expect(SPREAD_EU_SHIPPING_RATES_DEFAULT.DE).toEqual({ first: 399, additional: 61 });
    expect(SPREAD_EU_SHIPPING_RATES_DEFAULT.FR).toEqual({ first: 465, additional: 134 });
    expect(SPREAD_EU_SHIPPING_RATES_DEFAULT.AT).toEqual({ first: 355, additional: 144 });
    expect(SPREAD_EU_SHIPPING_RATES_HOODIE.DE).toEqual({ first: 460, additional: 190 });
    expect(SPREAD_EU_SHIPPING_RATES_HOODIE.JP).toEqual({ first: 1699, additional: 0 });
    expect(SPREAD_EU_SHIPPING_RATES_HOODIE.CZ).toBeUndefined();
  });

  it("stores 71 shippable countries, 70 default markets, no blocked ISOs, MA Todify-unchecked", () => {
    expect(SPREAD_EU_SHIPPABLE_COUNTRY_CODES).toHaveLength(71);
    expect(SPREAD_EU_DEFAULT_MARKET_COUNTRY_CODES).toHaveLength(70);
    expect(SPREAD_EU_TODIFY_MARKET_EXCEPTION).toBe("MA");
    expect(SPREAD_EU_SHIPPABLE_COUNTRY_CODES).toContain("MA");
    expect(SPREAD_EU_DEFAULT_MARKET_COUNTRY_CODES).not.toContain("MA");
    for (const blocked of SPREAD_EU_NO_SHIP_COUNTRY_CODES) {
      expect(SPREAD_EU_SHIPPABLE_COUNTRY_CODES).not.toContain(blocked);
      expect(SPREAD_EU_DEFAULT_MARKET_COUNTRY_CODES).not.toContain(blocked);
    }
    expect(SPREAD_EU_NO_SHIP_COUNTRY_CODES).toEqual(
      expect.arrayContaining(["US", "CH", "NO", "AU", "AR", "KR", "NZ", "LI", "UA"])
    );
  });
});
