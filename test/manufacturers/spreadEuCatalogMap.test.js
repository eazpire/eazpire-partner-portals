import { describe, expect, it } from "vitest";
import {
  buildSpreadEuCatalogProductData,
  shouldImportSpreadEuProductType,
  spreadEuProductKey,
  spreadconnectArticleIdFromHandle,
  spreadconnectApparelKind,
  spreadconnectDefaultD2cPrice,
  spreadconnectSyntheticVariantId,
} from "../../src/features/manufacturers/adapters/spreadconnect/spreadEuCatalogMap.js";

function teeType(overrides = {}) {
  return {
    id: 813,
    customerName: "Frauen Premium T-Shirt",
    appearances: [
      { id: 1, name: "Schwarz" },
      { id: 2, name: "Weiß" },
    ],
    sizes: [
      { id: 10, name: "S" },
      { id: 11, name: "M" },
    ],
    printAreas: [{ view: "FRONT", widthMm: 300, heightMm: 400 }],
    ...overrides,
  };
}

describe("spreadEuCatalogMap", () => {
  it("builds stable product keys and article ids from handles", () => {
    expect(spreadEuProductKey(813)).toBe("spread-eu-813");
    expect(spreadconnectArticleIdFromHandle("spreadconnect-3502371")).toBe("3502371");
    expect(spreadconnectArticleIdFromHandle("other-handle")).toBe("");
  });

  it("imports apparel with a front print area and skips mugs", () => {
    expect(shouldImportSpreadEuProductType(teeType())).toBe(true);
    expect(spreadconnectApparelKind(teeType())).toBe("womens-tee");
    expect(
      shouldImportSpreadEuProductType(
        teeType({ customerName: "Kaffeebecher", printAreas: [{ view: "FRONT", widthMm: 80, heightMm: 80 }] })
      )
    ).toBe(false);
  });

  it("builds Printify-shaped variant matrix data", () => {
    const mapped = buildSpreadEuCatalogProductData(teeType());
    expect(mapped.product_data.options[0].values).toHaveLength(2);
    expect(mapped.variants_json).toHaveLength(4);
    expect(mapped.variants_json[0].id).toBe(spreadconnectSyntheticVariantId(813, 1, 10));
    expect(mapped.d2c_price).toBe(spreadconnectDefaultD2cPrice(teeType()));
    expect(mapped.variant_config.variants[String(mapped.variants_json[0].id)].enabled).toBe(true);
    expect(mapped.print_area_keys).toEqual(["front"]);
    expect(mapped.product_data.print_areas[0].name).toBe("front");
    expect(mapped.print_areas_config.front.width_mm).toBe(300);
  });

  it("collects appearance preview images", () => {
    const mapped = buildSpreadEuCatalogProductData(
      teeType({
        appearances: [
          { id: 1, name: "Schwarz", imageUrl: "https://cdn.example.com/black.png" },
          { id: 2, name: "Weiß", previewImage: "https://cdn.example.com/white.png" },
        ],
      })
    );
    expect(mapped.mock_images).toContain("https://cdn.example.com/black.png");
    expect(mapped.mock_images).toContain("https://cdn.example.com/white.png");
  });
});
