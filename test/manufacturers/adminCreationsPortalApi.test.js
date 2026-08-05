import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildAdminGridViews,
  ensureShopifyNodesForProductList,
} from "../../src/features/manufacturers/adminCreationsPortalApi.js";
import * as shopifyList from "../../src/features/manufacturers/adminCreationsShopifyList.js";

describe("adminCreationsPortalApi helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds front/back grid views from saved listing mock URLs", () => {
    const views = buildAdminGridViews({
      previewUrl: "https://cdn.example/studio-front-preview.jpg",
      mockUrlsJson: JSON.stringify([
        "https://cdn.example/studio-front-preview.jpg",
        "https://cdn.example/studio-back-preview.jpg",
      ]),
      previewMockIndex: 0,
    });

    expect(views.map((v) => v.view)).toEqual(["front", "back"]);
    expect(views.map((v) => v.src)).toEqual([
      "https://cdn.example/studio-front-preview.jpg",
      "https://cdn.example/studio-back-preview.jpg",
    ]);
    expect(views[0].is_preview).toBe(true);
  });

  it("ensureShopifyNodesForProductList fetches missing Customer/Studio shopify ids", async () => {
    const fetchSpy = vi.spyOn(shopifyList, "fetchShopifyProductNodesByIds").mockResolvedValue([
      {
        id: "gid://shopify/Product/10351905505562",
        totalVariants: { count: 55 },
      },
    ]);

    const existing = new Map([
      ["111", { id: "gid://shopify/Product/111", totalVariants: { count: 2 } }],
    ]);
    const map = await ensureShopifyNodesForProductList(
      { SHOPIFY_ACCESS_TOKEN: "t" },
      [
        { shopify_product_id: "111" },
        { shopify_product_id: "10351905505562" },
        { id: "studio:9" },
      ],
      existing
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["10351905505562"])
    );
    expect(map.get("10351905505562")?.totalVariants?.count).toBe(55);
  });

  it("ensureShopifyNodesForProductList recovers Softstyle when shopify_product_id is a customer id", async () => {
    vi.spyOn(shopifyList, "fetchShopifyProductNodesByIds").mockImplementation(async (_env, ids) => {
      const list = (ids || []).map(String);
      if (list.includes("10351905505562")) {
        return [
          {
            id: "gid://shopify/Product/10351905505562",
            totalVariants: { count: 31 },
            images: {
              edges: [
                {
                  node: {
                    url: "https://cdn.example/white-front.jpg",
                    altText: "White|front|preview-default",
                  },
                },
              ],
            },
            metafields: {
              edges: [{ node: { namespace: "custom", key: "product_key", value: "x" } }],
            },
          },
        ];
      }
      return [];
    });

    const products = [
      {
        shopify_product_id: "9415375946010",
        printify_product_id: "6a725ddfcc695bad81053e2f",
        design_id: "240",
        product_key: "unisex-softstyle-cotton-tee",
        source: "customer",
      },
    ];
    const env = {
      SHOPIFY_ACCESS_TOKEN: "t",
      CREATOR_DB: {
        prepare(sql) {
          return {
            bind() {
              return {
                async all() {
                  if (String(sql).includes("printify_product_id")) {
                    return {
                      results: [
                        {
                          design_id: 240,
                          printify_product_id: "6a725ddfcc695bad81053e2f",
                          shopify_product_id: "10351905505562",
                        },
                      ],
                    };
                  }
                  return { results: [] };
                },
              };
            },
          };
        },
      },
    };

    const map = await ensureShopifyNodesForProductList(env, products, null);
    expect(products[0].shopify_product_id).toBe("10351905505562");
    expect(map.get("10351905505562")?.totalVariants?.count).toBe(31);
  });
});
