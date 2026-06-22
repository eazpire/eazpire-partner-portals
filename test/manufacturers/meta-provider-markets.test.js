import { describe, it, expect } from "vitest";
import { regionCodesFromCountryCodes } from "../../src/features/catalog/resolvePlanCountries.js";
import { resolvePublishProductName } from "../../src/features/publish/resolvePublishProductName.js";

describe("regionCodesFromCountryCodes", () => {
  it("maps EU countries to EU region", () => {
    expect(regionCodesFromCountryCodes(["DE", "FR", "PL"])).toEqual(["EU"]);
  });

  it("maps mixed regions", () => {
    expect(regionCodesFromCountryCodes(["DE", "US", "GB"])).toEqual(["EU", "UK", "US"]);
  });
});

describe("resolvePublishProductName", () => {
  it("uses version display_name for default products", () => {
    expect(
      resolvePublishProductName({
        productKey: "tee",
        profile: { print_provider_id: 1 },
        templateDisplayName: "Unisex Softstyle Cotton Tee",
      })
    ).toBe("Unisex Softstyle Cotton Tee");
  });

  it("falls back to legacy standard_product_display_name", () => {
    expect(
      resolvePublishProductName({
        productKey: "tee",
        profile: { standard_product_display_name: "Legacy Name", print_provider_id: 1 },
        templateDisplayName: "",
      })
    ).toBe("Legacy Name");
  });
});
