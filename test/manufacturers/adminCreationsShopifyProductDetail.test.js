import { describe, it, expect } from "vitest";
import {
  buildSortedMockups,
  categorizeMetafields,
  normalizeShopifyMetafields,
  DB_TO_SHOPIFY_METAFIELD_MAP,
} from "../../src/features/manufacturers/adminCreationsShopifyProductDetail.js";

describe("adminCreationsShopifyProductDetail helpers", () => {
  it("buildSortedMockups sorts by variant then view", () => {
    const sorted = buildSortedMockups([
      { id: 1, src: "a", alt: "Black|back|preview-default", position: 3 },
      { id: 2, src: "b", alt: "White|front|preview-default", position: 1 },
      { id: 3, src: "c", alt: "Black|front|preview-default", position: 2 },
      { id: 4, src: "d", alt: "White|back", position: 4 },
      { id: 5, src: "e", alt: null, position: 5 },
    ]);

    expect(sorted.map((m) => m.id)).toEqual(["3", "1", "5", "2", "4"]);
    expect(sorted[0].variant_label).toBe("Black");
    expect(sorted[0].view).toBe("front");
    expect(sorted[2].variant_label).toBe("Unassigned");
  });

  it("normalizeShopifyMetafields filters and sorts", () => {
    const rows = normalizeShopifyMetafields([
      { namespace: "custom", key: "sample", value: "yes" },
      { namespace: "", key: "x", value: "1" },
      { namespace: "custom", key: "product_key", value: "tee" },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["product_key", "sample"]);
  });

  it("categorizeMetafields finds DB values missing on Shopify", () => {
    const shopify = [
      { namespace: "custom", key: "sample", value: "yes" },
      { namespace: "custom", key: "product_key", value: "unisex-softstyle-cotton-tee" },
      { namespace: "custom", key: "product_name", value: "" },
    ];
    const db = [
      {
        namespace: "custom",
        key: "product_name",
        value: "Unisex Softstyle Cotton Tee",
        group: "listing",
        label: "Product name",
      },
      {
        namespace: "custom",
        key: "product_features_html",
        value: "<p>Soft cotton</p>",
        group: "listing",
        label: "Product features",
      },
      {
        namespace: "custom",
        key: "sample",
        value: "yes",
        group: "identity",
        label: "Sample template",
      },
      {
        namespace: "custom",
        key: "empty_skip",
        value: "",
        group: "listing",
      },
    ];

    const result = categorizeMetafields(shopify, db);
    expect(result.in_database_not_in_shopify.map((m) => m.key).sort()).toEqual([
      "product_features_html",
      "product_name",
    ]);
    expect(result.used_in_shopify.some((m) => m.key === "sample")).toBe(true);
    expect(result.used_in_shopify.some((m) => m.key === "product_key")).toBe(true);
  });

  it("DB_TO_SHOPIFY_METAFIELD_MAP covers listing HTML fields", () => {
    const keys = DB_TO_SHOPIFY_METAFIELD_MAP.map((m) => m.key);
    expect(keys).toContain("product_features_html");
    expect(keys).toContain("care_instructions_html");
    expect(keys).toContain("gpsr_html");
  });
});
