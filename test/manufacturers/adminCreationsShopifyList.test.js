import { describe, it, expect } from "vitest";
import {
  shopDomainFromEnv,
  normalizeShopifyProductId,
  hasPrintifyMetafield,
  isPrintifySourcedProduct,
  isCustomerStudioShopifyProduct,
  mapShopifyNodeToProduct,
} from "../../src/features/manufacturers/adminCreationsShopifyList.js";

describe("adminCreationsShopifyList", () => {
  it("shopDomainFromEnv prefers SHOPIFY_SHOP over storefront URL", () => {
    expect(
      shopDomainFromEnv({
        SHOPIFY_SHOP: "allyoucanpink.myshopify.com",
        SHOPIFY_STORE_URL: "https://www.eazpire.com",
      })
    ).toBe("allyoucanpink.myshopify.com");
    expect(shopDomainFromEnv({ SHOPIFY_SHOP_DOMAIN: "store" })).toBe("store.myshopify.com");
  });

  it("normalizeShopifyProductId strips gid prefix", () => {
    expect(normalizeShopifyProductId("gid://shopify/Product/12345")).toBe("12345");
    expect(normalizeShopifyProductId("12345.0")).toBe("12345");
  });

  it("isPrintifySourcedProduct detects metafield, provider, and D1 link", () => {
    const links = new Map([["99", "pf-d1"]]);

    expect(
      isPrintifySourcedProduct(
        { id: "gid://shopify/Product/1", mfPrintifyId: { value: "pf-1" } },
        links
      )
    ).toBe(true);

    expect(
      isPrintifySourcedProduct(
        { id: "gid://shopify/Product/2", mfProvider: { value: "printify" } },
        links
      )
    ).toBe(true);

    expect(isPrintifySourcedProduct({ id: "gid://shopify/Product/99" }, links)).toBe(true);

    expect(
      isPrintifySourcedProduct({ id: "gid://shopify/Product/3", mfProvider: { value: "gelato" } }, links)
    ).toBe(false);
  });

  it("hasPrintifyMetafield only checks printify_product_id metafield", () => {
    expect(hasPrintifyMetafield({ mfPrintifyId: { value: "abc" } })).toBe(true);
    expect(hasPrintifyMetafield({ mfProvider: { value: "printify" } })).toBe(false);
  });

  it("isCustomerStudioShopifyProduct respects listing_origin and id set", () => {
    const studioIds = new Set(["42"]);
    expect(isCustomerStudioShopifyProduct({ id: "gid://shopify/Product/42" }, studioIds)).toBe(true);
    expect(
      isCustomerStudioShopifyProduct(
        { id: "gid://shopify/Product/7", mfListingOrigin: { value: "shop" } },
        studioIds
      )
    ).toBe(true);
    expect(
      isCustomerStudioShopifyProduct(
        { id: "gid://shopify/Product/8", mfListingOrigin: { value: "creator" } },
        studioIds
      )
    ).toBe(false);
  });

  it("mapShopifyNodeToProduct backfills printify id from D1 links", () => {
    const links = new Map([["55", "pf-from-d1"]]);
    const row = mapShopifyNodeToProduct(
      {
        id: "gid://shopify/Product/55",
        title: "Gift Tee",
        status: "ACTIVE",
        mfProductKey: { value: "tee-1" },
      },
      "printify",
      links
    );
    expect(row.printify_product_id).toBe("pf-from-d1");
    expect(row.shopify_product_id).toBe("55");
  });
});
