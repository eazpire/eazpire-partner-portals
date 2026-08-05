import { describe, it, expect } from "vitest";
import {
  buildProductFilterFacets,
  publicationChannelKeys,
  countFilledMetafields,
  indexShopifyNodesById,
} from "../../src/features/manufacturers/adminCreationsProductListEnrich.js";

function product(overrides = {}) {
  return {
    product_key: "pk-1",
    id: "1001",
    title: "Test Product",
    filter_provider: "printify",
    provider_label: "Printify",
    variant_count: 1,
    market_labels: [],
    metafields_filled_count: 0,
    channel_count: 0,
    channel_keys: [],
    channel_labels: [],
    alt_image_texts: [],
    branding_white_count: 0,
    branding_black_count: 0,
    needs_update: false,
    ...overrides,
  };
}

describe("adminCreationsProductListEnrich", () => {
  it("publicationChannelKeys returns the fixed Creations sales channel list", () => {
    expect(publicationChannelKeys()).toEqual(["eazpire", "onlineshop", "eazpire_headless"]);
  });

  it("countFilledMetafields counts only non-empty mf* values on a Shopify node", () => {
    expect(
      countFilledMetafields({
        mfPrintifyId: { value: "pf-1" },
        mfProductKey: { value: "" },
        mfProvider: { value: "printify" },
        mfSample: { value: null },
        title: "Not a metafield",
      })
    ).toBe(2);
    expect(countFilledMetafields(null)).toBe(0);
  });

  it("indexShopifyNodesById normalizes ids and skips unresolvable nodes", () => {
    const map = indexShopifyNodesById([
      { id: "gid://shopify/Product/123" },
      { id: "studio:26" },
      { id: "456.0" },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("123")).toBeTruthy();
    expect(map.get("456")).toBeTruthy();
  });

  it("buildProductFilterFacets returns total + provider/channel/variant/market buckets with counts", () => {
    const products = [
      product({ product_key: "pk-1", filter_provider: "printify", provider_label: "Printify", variant_count: 1 }),
      product({
        product_key: "pk-2",
        filter_provider: "printify",
        provider_label: "Printify",
        variant_count: 8,
        channel_keys: ["eazpire", "onlineshop"],
        channel_labels: ["eazpire", "Online Store"],
        channel_count: 2,
        market_labels: ["Online Store"],
        needs_update: true,
      }),
      product({
        product_key: "pk-3",
        filter_provider: "todify",
        provider_label: "Todify",
        variant_count: 25,
        metafields_filled_count: 4,
        alt_image_texts: ["Front view"],
        branding_white_count: 2,
        branding_black_count: 1,
      }),
    ];

    const facets = buildProductFilterFacets(products);

    expect(facets.total).toBe(3);

    expect(facets.provider).toEqual(
      expect.arrayContaining([
        { key: "printify", label: "Printify", count: 2 },
        { key: "todify", label: "Todify", count: 1 },
      ])
    );

    expect(facets.variants).toEqual(
      expect.arrayContaining([
        { key: "1", label: "1", count: 1 },
        { key: "6-20", label: "6-20", count: 1 },
        { key: "20+", label: "20+", count: 1 },
      ])
    );

    expect(facets.channels).toEqual(
      expect.arrayContaining([
        { key: "eazpire", label: "eazpire", count: 1 },
        { key: "onlineshop", label: "Online Store", count: 1 },
      ])
    );

    expect(facets.channel_count).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "2", label: "2", count: 1 },
      ])
    );

    expect(facets.markets).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "Online Store", label: "Online Store", count: 1 },
      ])
    );

    expect(facets.metafields).toEqual(
      expect.arrayContaining([
        { key: "0", label: "0", count: 2 },
        { key: "3-5", label: "3-5", count: 1 },
      ])
    );

    expect(facets.alt_image_texts).toEqual(
      expect.arrayContaining([
        { key: "missing", label: "Missing alt text", count: 2 },
        { key: "has", label: "Has alt text", count: 1 },
      ])
    );

    expect(facets.branding).toEqual(
      expect.arrayContaining([
        { key: "white", label: "White branding", count: 1 },
        { key: "black", label: "Black branding", count: 1 },
      ])
    );

    expect(facets.needs_update).toEqual(
      expect.arrayContaining([
        { key: "no", label: "Up to date", count: 2 },
        { key: "yes", label: "Needs update", count: 1 },
      ])
    );
  });

  it("buildProductFilterFacets handles an empty product list", () => {
    const facets = buildProductFilterFacets([]);
    expect(facets.total).toBe(0);
    expect(facets.provider).toEqual([]);
    expect(facets.needs_update).toEqual([]);
  });
});
