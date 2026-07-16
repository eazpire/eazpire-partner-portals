import { describe, it, expect } from "vitest";
import { rewritePartnerApiV1Request } from "../../src/features/manufacturers/partnerApiV1.js";
import {
  partnerAuthHasScope,
  PARTNER_API_SCOPES,
  DEFAULT_PARTNER_API_SCOPES,
  PARTNER_API_KEY_ALLOWED_OPS,
} from "../../src/features/manufacturers/rbac.js";

describe("rewritePartnerApiV1Request", () => {
  it("maps product list and create by method", () => {
    const get = rewritePartnerApiV1Request(new Request("https://partner.eazpire.com/api/v1/products"));
    expect(new URL(get.url).searchParams.get("op")).toBe("partner-api-products");

    const post = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/products", { method: "POST" })
    );
    expect(new URL(post.url).searchParams.get("op")).toBe("partner-api-product-create");
  });

  it("maps GET/POST company", () => {
    const get = rewritePartnerApiV1Request(new Request("https://partner.eazpire.com/api/v1/company"));
    expect(new URL(get.url).searchParams.get("op")).toBe("partner-api-company");
    const post = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/company", { method: "POST" })
    );
    expect(new URL(post.url).searchParams.get("op")).toBe("partner-api-company-update");
  });

  it("maps product id get/update and submit-review", () => {
    const get = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/products/mprod_123")
    );
    expect(new URL(get.url).searchParams.get("op")).toBe("partner-api-product-get");
    expect(new URL(get.url).searchParams.get("product_id")).toBe("mprod_123");

    const update = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/products/mprod_123", { method: "POST" })
    );
    expect(new URL(update.url).searchParams.get("op")).toBe("partner-api-product-update");

    const submit = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/products/mprod_123/submit-review", {
        method: "POST",
      })
    );
    expect(new URL(submit.url).searchParams.get("op")).toBe("partner-api-product-submit");
    expect(new URL(submit.url).searchParams.get("product_id")).toBe("mprod_123");
  });

  it("maps overview", () => {
    const out = rewritePartnerApiV1Request(new Request("https://partner.eazpire.com/api/v1/overview"));
    expect(new URL(out.url).searchParams.get("op")).toBe("partner-api-overview");
  });

  it("maps orders list, get, and actions", () => {
    const list = rewritePartnerApiV1Request(new Request("https://partner.eazpire.com/api/v1/orders"));
    expect(new URL(list.url).searchParams.get("op")).toBe("partner-api-orders");

    const get = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/orders/mord_1")
    );
    expect(new URL(get.url).searchParams.get("op")).toBe("partner-api-order-get");
    expect(new URL(get.url).searchParams.get("order_id")).toBe("mord_1");

    const accept = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/orders/mord_1/accept", { method: "POST" })
    );
    expect(new URL(accept.url).searchParams.get("op")).toBe("partner-api-order-accept");

    const tracking = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/orders/mord_1/tracking", { method: "POST" })
    );
    expect(new URL(tracking.url).searchParams.get("op")).toBe("partner-api-order-tracking");
  });
});

describe("partner API scopes", () => {
  it("includes MVP default scopes", () => {
    expect(DEFAULT_PARTNER_API_SCOPES).toContain(PARTNER_API_SCOPES.PRODUCTS_WRITE);
    expect(DEFAULT_PARTNER_API_SCOPES).toContain(PARTNER_API_SCOPES.COMPANY_READ);
    expect(DEFAULT_PARTNER_API_SCOPES).toContain(PARTNER_API_SCOPES.ORDERS_WRITE);
  });

  it("partnerAuthHasScope respects wildcard and session", () => {
    expect(partnerAuthHasScope({ type: "session", scopes: ["*"] }, "products:write")).toBe(true);
    expect(partnerAuthHasScope({ type: "api_key", scopes: ["products:read"] }, "products:write")).toBe(
      false
    );
    expect(partnerAuthHasScope({ type: "api_key", scopes: ["*"] }, "products:write")).toBe(true);
  });

  it("allows product and order ops for API keys", () => {
    expect(PARTNER_API_KEY_ALLOWED_OPS.has("partner-api-product-create")).toBe(true);
    expect(PARTNER_API_KEY_ALLOWED_OPS.has("partner-api-orders")).toBe(true);
    expect(PARTNER_API_KEY_ALLOWED_OPS.has("partner-api-order-tracking")).toBe(true);
  });
});
