import { describe, expect, it } from "vitest";
import {
  buildVariantsMapDisablingColor,
  channelsForRemoveColorVariant,
  colorTitleForVariant,
  normalizeColorLabel,
} from "../../src/features/manufacturers/adminCreationsRemoveColorVariant.js";
import {
  collectColorFacets,
  productHasColor,
  summarizeRemoveVariantImpact,
} from "../../admin-creations-portal/js/products-color-facets.js";
import { resolveVariantEnabledForCatalogRow } from "../../src/features/product/resolveVariantEnabled.js";
import {
  colorsMatchLabel,
  selectShopifyVariantsByColor,
  shopifyColorOptionIndex,
} from "../../src/features/manufacturers/removeShopifyColorVariants.js";

function softstyleProduct() {
  return {
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 1, title: "Black" },
          { id: 2, title: "White" },
        ],
      },
      {
        name: "Sizes",
        type: "size",
        values: [
          { id: 10, title: "S" },
          { id: 11, title: "M" },
        ],
      },
    ],
    variants: [
      { id: 101, title: "Black / S", options: [1, 10], is_enabled: true },
      { id: 102, title: "Black / M", options: [1, 11], is_enabled: true },
      { id: 201, title: "White / S", options: [2, 10], is_enabled: true },
      { id: 202, title: "White / M", options: [2, 11], is_enabled: false },
    ],
  };
}

describe("adminCreationsRemoveColorVariant", () => {
  it("normalizes color labels", () => {
    expect(normalizeColorLabel("  Sport   Grey ")).toBe("sport grey");
  });

  it("reads the color title from the Printify option", () => {
    const product = softstyleProduct();
    expect(colorTitleForVariant(product, product.variants[0], 0)).toBe("Black");
  });

  it("disables only the selected color and keeps other enabled sizes", () => {
    const plan = buildVariantsMapDisablingColor(softstyleProduct(), "Black");
    expect(plan.matched).toBe(true);
    expect(plan.disabled).toBe(2);
    expect(plan.remaining).toBe(1);
    expect(plan.variantsMap["101"].enabled).toBe(false);
    expect(plan.variantsMap["102"].enabled).toBe(false);
    expect(plan.variantsMap["201"].enabled).toBe(true);
    expect(plan.variantsMap["202"].enabled).toBe(false);
  });

  it("blocks removing the last remaining color", () => {
    const product = softstyleProduct();
    product.variants = product.variants.filter((v) => String(v.title).startsWith("Black"));
    const plan = buildVariantsMapDisablingColor(product, "Black");
    expect(plan.remaining).toBe(0);
    expect(plan.matched).toBe(true);
  });

  it("collects live channels from list flags", () => {
    expect(
      channelsForRemoveColorVariant({
        printify_product_id: "p1",
        shopify_product_id: "123",
        amazon_eu_listed: true,
      })
    ).toEqual(["printify", "shopify", "amazon_europa"]);
  });
});

describe("resolveVariantEnabledForCatalogRow", () => {
  it("disables a color when the live variant id is in the payload", () => {
    expect(
      resolveVariantEnabledForCatalogRow({
        templateVariant: { id: 1, options: [10] },
        liveVariant: { id: 101, is_enabled: true },
        variantsPayload: [{ id: 101, is_enabled: false }],
        colorEnabled: new Map([["10", true]]),
        colorIdx: 0,
      })
    ).toBe(false);
  });

  it("keeps a live-disabled row disabled when catalog color ids do not match", () => {
    expect(
      resolveVariantEnabledForCatalogRow({
        templateVariant: { id: 1, options: [99] },
        liveVariant: { id: 101, is_enabled: false },
        variantsPayload: [],
        colorEnabled: new Map([["10", true]]),
        colorIdx: 0,
      })
    ).toBe(false);
  });

  it("does not default unmatched catalog rows to enabled", () => {
    expect(
      resolveVariantEnabledForCatalogRow({
        templateVariant: { id: 1, options: [99] },
        liveVariant: null,
        variantsPayload: [],
        colorEnabled: null,
        colorIdx: 0,
      })
    ).toBe(false);
  });
});

describe("removeShopifyColorVariants", () => {
  const shopifyProduct = {
    options: [
      { name: "Color", values: ["Black", "White"] },
      { name: "Size", values: ["S", "M"] },
    ],
    variants: [
      { id: 1, option1: "Black", option2: "S", title: "Black / S" },
      { id: 2, option1: "Schwarz", option2: "M", title: "Schwarz / M" },
      { id: 3, option1: "White", option2: "S", title: "White / S" },
    ],
  };

  it("finds the Color option and matches Black/Schwarz", () => {
    expect(shopifyColorOptionIndex(shopifyProduct)).toBe(0);
    expect(colorsMatchLabel("Black", "schwarz")).toBe(true);
    expect(selectShopifyVariantsByColor(shopifyProduct, "Black").map((v) => v.id)).toEqual([1, 2]);
  });

  it("leaves other colors untouched", () => {
    expect(selectShopifyVariantsByColor(shopifyProduct, "White")).toHaveLength(1);
    expect(selectShopifyVariantsByColor(shopifyProduct, "Navy")).toHaveLength(0);
  });
});

describe("products color facets", () => {
  const items = [
    {
      title: "A",
      printify_product_id: "1",
      shopify_product_id: "11",
      amazon_eu_listed: true,
      grid_views: [
        { src: "a", variant_label: "Black" },
        { src: "b", variant_label: "White" },
      ],
    },
    {
      title: "B",
      printify_product_id: "2",
      shopify_product_id: "22",
      grid_views: [{ src: "c", variant_label: "Black" }],
    },
    {
      title: "C",
      grid_views: [{ src: "d", variant_label: "Default" }],
    },
  ];

  it("counts products per color and skips generic labels", () => {
    const facets = collectColorFacets(items);
    expect(facets.map((f) => [f.label, f.count])).toEqual([
      ["Black", 2],
      ["White", 1],
    ]);
  });

  it("summarizes remove-variant impact across channels", () => {
    expect(productHasColor(items[0], "white")).toBe(true);
    const impact = summarizeRemoveVariantImpact(items, "Black");
    expect(impact.products).toHaveLength(2);
    expect(impact.channels.find((c) => c.id === "printify")?.count).toBe(2);
    expect(impact.channels.find((c) => c.id === "amazon_europa")?.count).toBe(1);
  });
});
