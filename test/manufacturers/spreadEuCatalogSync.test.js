import { describe, expect, it } from "vitest";
import { pickSpreadEuTypesToImport } from "../../src/features/manufacturers/adapters/spreadconnect/spreadEuCatalogSync.js";
import { spreadEuProductKey } from "../../src/features/manufacturers/adapters/spreadconnect/spreadEuCatalogMap.js";
import {
  isSpreadEuFulfillmentId,
  isSpreadUsFulfillmentId,
  partnerUsesFlatProviders,
  HIDDEN_CATALOG_STUDIO_SLUGS,
} from "../../src/features/manufacturers/partnerCatalog/constants.js";
import { applySpreadshirtProviderFilter } from "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js";

function apparelType(id) {
  return {
    id,
    customerName: "Men Premium T-Shirt",
    appearances: [{ id: 1, name: "Black" }],
    sizes: [{ id: 10, name: "M" }],
    printAreas: [{ view: "FRONT", widthMm: 300, heightMm: 400 }],
  };
}

describe("pickSpreadEuTypesToImport", () => {
  it("still queues types that are not yet imported when some already exist", () => {
    const types = [apparelType(1), apparelType(2), apparelType(3)];
    const existing = new Set([spreadEuProductKey(1)]);
    const picked = pickSpreadEuTypesToImport(types, existing, { chunkSize: 10 });
    expect(picked.eligible).toHaveLength(3);
    expect(picked.missing.map((t) => t.id)).toEqual([2, 3]);
    expect(picked.toImport.map((t) => t.id)).toEqual([2, 3]);
    expect(picked.remaining_after_chunk).toBe(0);
  });

  it("does not skip the rest of the catalog when count > 0", () => {
    const types = Array.from({ length: 5 }, (_, i) => apparelType(i + 1));
    const existing = new Set([spreadEuProductKey(1), spreadEuProductKey(2)]);
    const picked = pickSpreadEuTypesToImport(types, existing, { chunkSize: 2 });
    expect(picked.toImport.map((t) => t.id)).toEqual([3, 4]);
    expect(picked.remaining_after_chunk).toBe(1);
  });
});

describe("Spreadshirt catalog studio helpers", () => {
  it("hides Spread EU / Spread US as top-level partners and flattens Spreadshirt providers", () => {
    expect(HIDDEN_CATALOG_STUDIO_SLUGS.has("spread-eu")).toBe(true);
    expect(HIDDEN_CATALOG_STUDIO_SLUGS.has("spread-us")).toBe(true);
    expect(partnerUsesFlatProviders("spreadshirt")).toBe(true);
    expect(partnerUsesFlatProviders("printify")).toBe(false);
  });

  it("lists Spread EU product keys and ignores the US placeholder", () => {
    const products = [
      { product_key: "spread-eu-813", title: "Tee" },
      { product_key: "spread-eu-900", title: "Hoodie" },
    ];
    expect(applySpreadshirtProviderFilter(products, "spread-eu-1").map((p) => p.product_key)).toEqual([
      "spread-eu-813",
      "spread-eu-900",
    ]);
    expect(applySpreadshirtProviderFilter(products, "910002")).toHaveLength(2);
    expect(applySpreadshirtProviderFilter(products, "spread-us-1")).toEqual([]);
    expect(isSpreadEuFulfillmentId("spread-eu-1")).toBe(true);
    expect(isSpreadUsFulfillmentId("910003")).toBe(true);
  });
});
