import { describe, it, expect, vi } from "vitest";
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
  fetchPrintifyShopifyNodesFromD1,
  toEpochMs,
  productRecencyMs,
  sortProductsNewestFirst,
  PRINTIFY_SHOPIFY_STORE_QUERY,
  TODIFY_SHOPIFY_STORE_QUERY,
  SAMPLES_SHOPIFY_STORE_QUERY,
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

  it("normalizeShopifyProductId strips gid prefix and rejects studio pseudo-ids", () => {
    expect(normalizeShopifyProductId("gid://shopify/Product/12345")).toBe("12345");
    expect(normalizeShopifyProductId("12345.0")).toBe("12345");
    expect(normalizeShopifyProductId("studio:26")).toBe("");
    expect(normalizeShopifyProductId("abc")).toBe("");
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

  it("isTodifyPartnerShopifyProduct and source buckets split Shopify residual", async () => {
    const {
      isTodifyPartnerShopifyProduct,
      isShopifyTabProduct,
      isShopifyResidualProduct,
      isSampleShopifyProduct,
    } = await import("../../src/features/manufacturers/adminCreationsShopifyList.js");
    const todifyNode = {
      id: "gid://shopify/Product/55",
      mfProvider: { value: "Todify" },
      mfListingOrigin: { value: "creator" },
    };
    const sampleNode = { mfSample: { value: "yes" }, productType: "Poster" };
    expect(isTodifyPartnerShopifyProduct(todifyNode)).toBe(true);
    expect(isShopifyResidualProduct(todifyNode)).toBe(false);
    expect(isShopifyResidualProduct({ isGiftCard: true })).toBe(true);
    expect(isShopifyResidualProduct(sampleNode)).toBe(false);
    expect(isSampleShopifyProduct(sampleNode)).toBe(true);
    expect(isShopifyTabProduct(todifyNode, new Set(["55"]))).toBe(true);
    expect(isShopifyTabProduct({ isGiftCard: true }, new Set())).toBe(true);
  });

  it("isPrintifySourcedProduct excludes samples and gift cards", () => {
    const links = new Map();
    const publishedIds = new Set();
    expect(
      isPrintifySourcedProduct(
        { id: "gid://shopify/Product/1", mfPrintifyId: { value: "pf-1" }, mfSample: { value: "yes" } },
        links,
        publishedIds
      )
    ).toBe(false);
    expect(
      isPrintifySourcedProduct({ id: "gid://shopify/Product/2", isGiftCard: true }, links, publishedIds)
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

  it("toEpochMs / productRecencyMs / newest-first sort for Admin Products", () => {
    expect(toEpochMs("2026-08-08T12:00:00.000Z")).toBe(Date.parse("2026-08-08T12:00:00.000Z"));
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    const mapped = mapShopifyNodeToProduct(
      {
        id: "gid://shopify/Product/91",
        title: "Recent Tee",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-08-08T10:00:00.000Z",
      },
      "printify",
      new Map()
    );
    expect(mapped.sort_ts).toBe(Date.parse("2026-08-08T10:00:00.000Z"));
    expect(productRecencyMs(mapped)).toBe(mapped.sort_ts);
    const list = [
      { id: "old", sort_ts: 100 },
      { id: "new", updated_at: 300 },
      { id: "mid", published_at: 200 },
    ];
    sortProductsNewestFirst(list);
    expect(list.map((p) => p.id)).toEqual(["new", "mid", "old"]);
  });

  it("maps Todify listing origin to Creator and Customer labels", () => {
    const creator = mapShopifyNodeToProduct(
      {
        id: "gid://shopify/Product/70",
        title: "Creator Todify Hoodie",
        mfProvider: { value: "Todify" },
        mfListingOrigin: { value: "creator" },
      },
      "todify",
      new Map()
    );
    const customer = mapShopifyNodeToProduct(
      {
        id: "gid://shopify/Product/71",
        title: "Customer Todify Hoodie",
        mfProvider: { value: "Todify" },
        mfListingOrigin: { value: "shop" },
      },
      "todify",
      new Map()
    );

    expect(creator.source_label).toBe("Todify");
    expect(creator.origin_label).toBe("Creator");
    expect(customer.source_label).toBe("Todify");
    expect(customer.origin_label).toBe("Customer");
  });

  it("maps Shopify product images into grid views", () => {
    const row = mapShopifyNodeToProduct(
      {
        id: "gid://shopify/Product/90",
        title: "Todify Hoodie",
        mfProvider: { value: "Todify" },
        images: {
          edges: [
            { node: { url: "https://cdn.example/hoodie-front.png", altText: "Black|front|preview-default" } },
            { node: { url: "https://cdn.example/hoodie-back.png", altText: "Black|back" } },
          ],
        },
      },
      "todify",
      new Map()
    );

    expect(row.images).toEqual([
      "https://cdn.example/hoodie-front.png",
      "https://cdn.example/hoodie-back.png",
    ]);
    expect(row.grid_views.map((v) => v.view)).toEqual(["front", "back"]);
  });

  it("exposes targeted Shopify search queries (no full-catalog bucket scans)", () => {
    expect(PRINTIFY_SHOPIFY_STORE_QUERY).toMatch(/printify_product_id|provider:printify|listing_origin:creator/);
    expect(TODIFY_SHOPIFY_STORE_QUERY).toMatch(/provider:todify/);
    expect(SAMPLES_SHOPIFY_STORE_QUERY).toMatch(/sample:yes/);
  });

  it("loadPublishedDesignsShopifyIndex pages past 1000 D1 rows", async () => {
    const { loadPublishedDesignsShopifyIndex } = await import(
      "../../src/features/manufacturers/adminCreationsShopifyList.js"
    );
    const pages = [];
    for (let i = 0; i < 1000; i++) pages.push({ sid: String(1000 + i), pid: `pf-${i}` });
    const page2 = Array.from({ length: 50 }, (_, i) => ({ sid: String(3000 + i), pid: `pf2-${i}` }));
    let calls = 0;
    const env = {
      CREATOR_DB: {
        prepare() {
          return {
            bind() {
              return {
                async all() {
                  calls += 1;
                  if (calls === 1) return { results: pages };
                  if (calls === 2) return { results: page2 };
                  return { results: [] };
                },
              };
            },
          };
        },
      },
    };
    const { creatorPublishedIds, printifyLinks } = await loadPublishedDesignsShopifyIndex(env);
    expect(calls).toBe(2);
    expect(creatorPublishedIds.size).toBe(1050);
    expect(printifyLinks.get("1000")).toBe("pf-0");
    expect(printifyLinks.get("3000")).toBe("pf2-0");
  });

  it("fetchPrintifyShopifyNodesFromD1 hydrates D1 ids and drops todify/studio", async () => {
    const shopify = await import("../../src/utils/shopify.js");
    const spy = vi.spyOn(shopify, "shopifyAPI").mockImplementation(async (_env, _shop, _ep, opts) => {
      const body = JSON.parse(opts.body);
      const ids = body.variables.ids || [];
      return {
        data: {
          nodes: ids.map((gid) => {
            const num = String(gid).replace(/^gid:\/\/shopify\/Product\//, "");
            if (num === "2") {
              return { id: gid, title: "Todify", mfProvider: { value: "todify" } };
            }
            if (num === "3") {
              return { id: gid, title: "Studio", mfListingOrigin: { value: "shop" } };
            }
            return {
              id: gid,
              title: `Printify ${num}`,
              mfPrintifyId: { value: `pf-${num}` },
              mfListingOrigin: { value: "creator" },
            };
          }),
        },
      };
    });

    try {
      const nodes = await fetchPrintifyShopifyNodesFromD1(
        { SHOPIFY_ACCESS_TOKEN: "t", SHOPIFY_SHOP: "allyoucanpink.myshopify.com" },
        {
          limit: 50,
          customerStudioIds: new Set(["3"]),
          printifyLinks: new Map([
            ["1", "pf-1"],
            ["2", "pf-2"],
            ["3", "pf-3"],
            ["4", "pf-4"],
          ]),
          creatorPublishedIds: new Set(["1", "2", "3", "4"]),
        }
      );
      const ids = nodes.map((n) => normalizeShopifyProductId(n.id));
      // Preserve D1 Set insertion order (newest-first), not arbitrary hydrate order.
      expect(ids).toEqual(["1", "4"]);
    } finally {
      spy.mockRestore();
    }
  });
});
