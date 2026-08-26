import { describe, expect, it } from "vitest";
import {
  buildSpreadEuCatalogProductData,
  shouldImportSpreadEuProductType,
  spreadEuCatalogCategory,
  spreadEuProductKey,
  spreadconnectArticleIdFromHandle,
  spreadconnectApparelKind,
  spreadconnectCdnPreviewUrl,
  spreadconnectDefaultD2cPrice,
  spreadconnectMockImageUrls,
  spreadconnectSyntheticVariantId,
  SPREAD_EU_COUNTRY_CODES,
  SPREAD_EU_COUNTRY_OF_ORIGIN,
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
    ).toBe(true);
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

  it("uses Spread API purchase price per variant instead of the 19.99 kind default", () => {
    const mapped = buildSpreadEuCatalogProductData(
      teeType({
        price: 8.5,
        appearances: [
          { id: 1, name: "Schwarz", appearanceColorValue: "#111111" },
          { id: 2, name: "Weiß", colorHex: "ffffff" },
        ],
        sizes: [
          { id: 10, name: "S", price: 8.5 },
          { id: 11, name: "XXL", price: 10.9 },
        ],
      })
    );
    expect(mapped.variants_json).toHaveLength(4);
    expect(mapped.variants_json[0].cost).toBe(850);
    expect(mapped.variants_json[1].cost).toBe(1090);
    expect(mapped.prices_json[0]).toEqual({ variant_id: mapped.variants_json[0].id, price: 850 });
    expect(mapped.d2c_price).not.toBe(19.99);
    expect(mapped.product_data.options[0].values[0].colors[0]).toBe("#111111");
    expect(mapped.product_data.options[0].values[1].colors[0]).toBe("#ffffff");
    expect(mapped.country_of_origin).toBe("DE");
    expect(mapped.shopify_category_id).toMatch(/TaxonomyCategory/);
    expect(mapped.shopify_category_name).toBeTruthy();
    expect(mapped.mockup_entries.some((e) => e.view_key === "front" && e.color_name === "Schwarz")).toBe(true);
    expect(mapped.creator_preview_url).toContain("productTypes/813");
    expect(mapped.print_area_keys).toEqual(["front"]);
  });

  it("groups mockups by print area and color variant", () => {
    const mapped = buildSpreadEuCatalogProductData(
      teeType({
        appearances: [
          { id: 1, name: "Navy", colorHex: "#001f3f" },
          { id: 2, name: "White", colorHex: "#ffffff" },
        ],
        printAreas: [
          { view: "FRONT", widthMm: 300, heightMm: 400 },
          { view: "BACK", widthMm: 280, heightMm: 360 },
        ],
      }),
      {
        views: [
          { id: 1, name: "FRONT" },
          { id: 2, name: "BACK" },
        ],
      }
    );
    expect(mapped.print_area_keys).toEqual(["front", "back"]);
    const keys = mapped.mockup_entries.map((e) => `${e.view_key}:${e.color_name}`);
    expect(keys).toEqual(expect.arrayContaining(["front:Navy", "front:White", "back:Navy", "back:White"]));
    expect(mapped.mockup_entries.find((e) => e.view_key === "back").image_url).toContain("/views/2/");
  });

  it("maps bag types to accessories taxonomy and non-FRONT print areas", () => {
    const mapped = buildSpreadEuCatalogProductData({
      id: 900,
      customerName: "Tote Bag",
      appearances: [{ id: 4, name: "Natural", colorHex: "#e8dcc8" }],
      sizes: [{ id: 1, name: "One Size" }],
      printAreas: [{ view: "SIDE", widthMm: 250, heightMm: 250 }],
    });
    expect(mapped.catalog_category).toEqual({ group: "Taschen", leaf: "Tote Bag" });
    expect(mapped.shopify_category_id).toMatch(/TaxonomyCategory/);
    expect(mapped.print_area_keys).toEqual(["side"]);
    expect(mapped.variants_json).toHaveLength(1);
    expect(mapped.product_data.options[0].values[0].colors[0]).toBe("#e8dcc8");
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

  it("builds CDN fallback previews and reads /views image URLs", () => {
    const cdn = spreadconnectCdnPreviewUrl(812, 1247, 1, 800);
    expect(cdn).toContain("productTypes/812/views/1/appearances/1247");
    const fromCdn = spreadconnectMockImageUrls(teeType());
    expect(fromCdn[0]).toContain("productTypes/813/views/1/appearances/1");
    const fromViews = spreadconnectMockImageUrls(teeType(), {
      views: [
        {
          name: "FRONT",
          id: "1",
          images: [{ appearanceId: "1", image: "https://image.spreadshirtmedia.net/front-black.png" }],
        },
      ],
    });
    expect(fromViews).toContain("https://image.spreadshirtmedia.net/front-black.png");
  });

  it("maps Spread categories onto Catalog Studio groups", () => {
    expect(spreadEuCatalogCategory(teeType())).toEqual({ group: "Female", leaf: "T-Shirt" });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Männer Premium Hoodie" }))).toEqual({
      group: "Male",
      leaf: "Hoodie",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Langarmshirt" }))).toEqual({
      group: "Unisex",
      leaf: "Long Sleeve",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Polo" }))).toEqual({
      group: "Unisex",
      leaf: "Polo Shirt",
    });
    expect(SPREAD_EU_COUNTRY_OF_ORIGIN).toBe("DE");
    expect(SPREAD_EU_COUNTRY_CODES).toEqual(expect.arrayContaining(["DE", "FR", "GB", "US", "ZA", "JP", "AU"]));
    expect(SPREAD_EU_COUNTRY_CODES.length).toBeGreaterThan(40);
    expect(
      spreadEuCatalogCategory(teeType({ customerName: "Crewneck" }), {
        categories: [
          {
            translation: "Bekleidung",
            children: [{ translation: "Pullover & Hoodies", children: [] }],
          },
        ],
      }).leaf
    ).toBe("Sweatshirt");
  });

  it("does not dump non-shirts into T-Shirt", () => {
    expect(spreadEuCatalogCategory(teeType({ customerName: "Brotdose" }))).toEqual({
      group: "Home",
      leaf: "Lunch Box",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Bandana" }))).toEqual({
      group: "Accessoires",
      leaf: "Bandana",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "CRAFT ADV Unify Freizeithose" }))).toEqual({
      group: "Unisex",
      leaf: "Pants",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Bierkrug" }))).toEqual({
      group: "Drinkware",
      leaf: "Mug",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Teddy" })).group).toBe("Accessoires");
    expect(spreadEuCatalogCategory(teeType({ customerName: "Stoffbeutel" })).group).toBe("Taschen");
    expect(spreadEuCatalogCategory(teeType({ customerName: "Männer Jeanshemd Organic von Stanley/Stella" }))).toEqual({
      group: "Male",
      leaf: "Shirt",
    });
  });

  it("puts Männer/Herren apparel in Male and Damen/Frauen in Female, not Unisex", () => {
    expect(spreadEuCatalogCategory(teeType({ customerName: "Männer Premium T-Shirt" }))).toEqual({
      group: "Male",
      leaf: "T-Shirt",
    });
    expect(
      spreadEuCatalogCategory(teeType({ customerName: "Männer Tank Top" }), {
        genders: [{ translation: "Unisex" }],
      })
    ).toEqual({ group: "Male", leaf: "Tank Top" });
    expect(spreadEuCatalogCategory(teeType({ customerName: "JAKO Damen T-Shirt Light Flow" }))).toEqual({
      group: "Female",
      leaf: "T-Shirt",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Kinder Premium T-Shirt" }))).toEqual({
      group: "Kids",
      leaf: "T-Shirt",
    });
    expect(spreadEuCatalogCategory(teeType({ customerName: "Baby Bio-Kurzarm-Body" }))).toEqual({
      group: "Toddler",
      leaf: "Body",
    });
  });

  it("never uses T-Shirt as the unknown-apparel dump", () => {
    expect(spreadEuCatalogCategory(teeType({ customerName: "Mysterious Widget 9000" }))).toEqual({
      group: "Unisex",
      leaf: "Other apparel",
    });
    expect(spreadconnectApparelKind(teeType({ customerName: "Brotdose" }))).toBeNull();
  });
});
