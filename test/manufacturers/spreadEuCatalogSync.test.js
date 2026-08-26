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

  it("lists unpublished Spread EU types under Available with categories and preview images", async () => {
    const { getCatalogStudioProducts, resolveStudioCategory } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const rows = [
      {
        product_key: "spread-eu-812",
        title: "Männer Premium T-Shirt",
        catalog_status: "offline",
        catalog_category_leaf: "T-Shirt",
        catalog_category_group: "Kleidung",
        version_count: 0,
        manufacturer_name: "Spreadshirt",
        blueprint_title: null,
        blueprint_category: null,
        updated_at: 1,
      },
      {
        product_key: "spread-eu-900",
        title: "Männer Premium Hoodie",
        catalog_status: "online",
        catalog_category_leaf: "Hoodie",
        catalog_category_group: "Kleidung",
        version_count: 1,
        manufacturer_name: "Spreadshirt",
        blueprint_title: null,
        blueprint_category: null,
        updated_at: 1,
      },
    ];
    const mfgDb = {
      prepare: (sql) => {
        const handler = {
          bind: (...args) => {
            handler._args = args;
            return handler;
          },
          first: async () => {
            if (sql.includes("FROM manufacturers")) {
              return { id: "mfg_spreadshirt", slug: "spreadshirt", name: "Spreadshirt" };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM eazpire_products")) return { results: rows };
            if (sql.includes("eazpire_product_mockup_images")) {
              return {
                results: [
                  {
                    product_key: "spread-eu-812",
                    image_url:
                      "https://image.spreadshirtmedia.net/image-server/v1/productTypes/812/views/1/appearances/1,width=800,height=800",
                  },
                ],
              };
            }
            return { results: [] };
          },
          run: async () => ({}),
        };
        return handler;
      },
    };

    const result = await getCatalogStudioProducts(
      mfgDb,
      {},
      { manufacturerId: "mfg_spreadshirt", providerExternalId: "spread-eu-1", filter: "available" }
    );

    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.product_key)).toEqual(["spread-eu-812"]);
    expect(result.items[0].catalog_status).toBe("available");
    expect(result.items[0].category).toBe("T-Shirt");
    expect(result.items[0].parent_group).toBe("Unisex");
    expect(result.items[0].mock_images[0]).toContain("productTypes/812");
    expect(result.category_tree.some((g) => g.name === "Unisex")).toBe(true);
    expect(resolveStudioCategory({ catalog_category_leaf: "Long Sleeve" }).category).toBe("Long Sleeve");
  });
});
