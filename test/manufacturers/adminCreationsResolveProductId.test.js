import { describe, it, expect } from "vitest";
import {
  parseStudioListingId,
  resolveShopifyProductIdFromAdminRef,
} from "../../src/features/manufacturers/adminCreationsResolveProductId.js";

describe("adminCreationsResolveProductId", () => {
  it("parseStudioListingId", () => {
    expect(parseStudioListingId("studio:26")).toBe("26");
    expect(parseStudioListingId("STUDIO:9")).toBe("9");
    expect(parseStudioListingId("123")).toBe(null);
  });

  it("resolves numeric Shopify ids", async () => {
    const r = await resolveShopifyProductIdFromAdminRef({}, "gid://shopify/Product/99");
    expect(r).toEqual({ ok: true, shopify_product_id: "99", studio_listing_id: null });
  });

  it("resolves studio listing with shopify id", async () => {
    const env = {
      CUSTOMER_DB: {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  return {
                    id: 26,
                    shopify_product_id: "88776655",
                    product_key: "todify-todify-hooded-tank",
                    product_title: "Be Kind Always",
                    shopify_completion_status: "ready",
                  };
                },
              };
            },
          };
        },
      },
    };
    const r = await resolveShopifyProductIdFromAdminRef(env, "studio:26");
    expect(r.ok).toBe(true);
    expect(r.shopify_product_id).toBe("88776655");
    expect(r.studio_listing_id).toBe("26");
  });

  it("reports studio listing not on Shopify", async () => {
    const env = {
      CUSTOMER_DB: {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  return {
                    id: 26,
                    shopify_product_id: null,
                    product_key: "x",
                    product_title: "Draft",
                    shopify_completion_status: "pending",
                  };
                },
              };
            },
          };
        },
      },
    };
    const r = await resolveShopifyProductIdFromAdminRef(env, "studio:26");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("studio_listing_not_on_shopify");
  });
});
