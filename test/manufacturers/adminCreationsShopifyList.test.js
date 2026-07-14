import { describe, it, expect } from "vitest";
import {
  shopDomainFromEnv,
  normalizeShopifyProductId,
  hasPrintifyMetafield,
  isPrintifySourcedProduct,
  isCustomerStudioShopifyProduct,
  isGiftCardShopifyProduct,
  isSampleShopifyProduct,
  isNativeShopifyStoreProduct,
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

  it("isPrintifySourcedProduct detects metafield, provider, listing_origin, and D1 link", () => {
    const links = new Map([["99", "pf-d1"]]);
    const publishedIds = new Set(["88", "99"]);

    expect(
      isPrintifySourcedProduct(
        { id: "gid://shopify/Product/1", mfPrintifyId: { value: "pf-1" } },
        links,
        publishedIds
      )
    ).toBe(true);

    expect(
      isPrintifySourcedProduct(
        { id: "gid://shopify/Product/2", mfProvider: { value: "printify" } },
        links,
        publishedIds
      )
    ).toBe(true);

    expect(
      isPrintifySourcedProduct(
        { id: "gid://shopify/Product/3", mfListingOrigin: { value: "creator" } },
        links,
        publishedIds
      )
    ).toBe(true);

    expect(isPrintifySourcedProduct({ id: "gid://shopify/Product/99" }, links, publishedIds)).toBe(true);

    expect(isPrintifySourcedProduct({ id: "gid://shopify/Product/88" }, links, publishedIds)).toBe(true);

    expect(
      isPrintifySourcedProduct({ id: "gid://shopify/Product/3", mfProvider: { value: "gelato" } }, links, publishedIds)
    ).toBe(false);

    expect(
      isPrintifySourcedProduct(
        {
          id: "gid://shopify/Product/77",
          mfProvider: { value: "todify" },
          mfListingOrigin: { value: "creator" },
        },
        links,
        publishedIds
      )
    ).toBe(false);
  });

  it("isTodifyPartnerShopifyProduct and isShopifyTabProduct include Todify listings", async () => {
    const { isTodifyPartnerShopifyProduct, isShopifyTabProduct } = await import(
      "../../src/features/manufacturers/adminCreationsShopifyList.js"
    );
    const todifyNode = {
      id: "gid://shopify/Product/55",
      mfProvider: { value: "Todify" },
      mfListingOrigin: { value: "creator" },
    };
    expect(isTodifyPartnerShopifyProduct(todifyNode)).toBe(true);
    expect(isShopifyTabProduct(todifyNode, new Set(["55"]))).toBe(true);
    expect(isShopifyTabProduct({ isGiftCard: true }, new Set())).toBe(true);
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

  it("isGiftCardShopifyProduct matches isGiftCard, Gutschein type, and giftcard tags", () => {
    expect(isGiftCardShopifyProduct({ isGiftCard: true, productType: "" })).toBe(true);
    expect(
      isGiftCardShopifyProduct({
        isGiftCard: true,
        productType: "Gutschein",
        tags: ["giftcard", "gutschein"],
      })
    ).toBe(true);
    expect(isGiftCardShopifyProduct({ productType: "Gift Card" })).toBe(true);
    expect(isGiftCardShopifyProduct({ productType: "Gutschein" })).toBe(true);
    expect(isGiftCardShopifyProduct({ tags: ["gift-card", "featured"] })).toBe(true);
    expect(isGiftCardShopifyProduct({ tags: ["giftcard"] })).toBe(true);
    expect(isGiftCardShopifyProduct({ productType: "Poster", tags: [], isGiftCard: false })).toBe(
      false
    );
    expect(
      isGiftCardShopifyProduct({
        title: "Unisex Hoodie",
        productType: "Hoodie",
        tags: ["clothing"],
        isGiftCard: false,
      })
    ).toBe(false);
  });

  it("isSampleShopifyProduct matches custom.sample yes", () => {
    expect(isSampleShopifyProduct({ mfSample: { value: "yes" } })).toBe(true);
    expect(isSampleShopifyProduct({ mfSample: { value: "YES" } })).toBe(true);
    expect(isSampleShopifyProduct({ mfSample: { value: "no" } })).toBe(false);
    expect(isSampleShopifyProduct({})).toBe(false);
  });

  it("isNativeShopifyStoreProduct whitelists gift cards and samples only", () => {
    expect(isNativeShopifyStoreProduct({ isGiftCard: true })).toBe(true);
    expect(isNativeShopifyStoreProduct({ productType: "Gutschein" })).toBe(true);
    expect(isNativeShopifyStoreProduct({ productType: "Gift Card" })).toBe(true);
    expect(isNativeShopifyStoreProduct({ mfSample: { value: "yes" }, productType: "Poster" })).toBe(
      true
    );
    expect(
      isNativeShopifyStoreProduct({
        productType: "Poster",
        isGiftCard: false,
        mfPrintifyId: { value: "pf-1" },
        mfProvider: { value: "printify" },
      })
    ).toBe(false);
    expect(
      isNativeShopifyStoreProduct({
        title: "Unisex Hoodie",
        productType: "Hoodie",
        isGiftCard: false,
        mfProductKey: { value: "unisex-hoodie" },
      })
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
