import { describe, it, expect } from "vitest";
import {
  validateWebhookUrl,
  normalizeWebhookEvents,
  hmacSha256Hex,
  orderEventForStatus,
} from "../../src/features/manufacturers/partnerWebhookDelivery.js";
import { rewritePartnerApiV1Request } from "../../src/features/manufacturers/partnerApiV1.js";
import { PARTNER_API_SCOPES, DEFAULT_PARTNER_API_SCOPES } from "../../src/features/manufacturers/rbac.js";

describe("validateWebhookUrl", () => {
  it("requires https for public hosts", () => {
    expect(validateWebhookUrl("http://example.com/hook").ok).toBe(false);
    expect(validateWebhookUrl("https://example.com/hook").ok).toBe(true);
  });

  it("allows localhost http", () => {
    expect(validateWebhookUrl("http://localhost:3000/hook").ok).toBe(true);
  });

  it("blocks private hosts", () => {
    expect(validateWebhookUrl("https://10.0.0.1/hook").ok).toBe(false);
    expect(validateWebhookUrl("https://169.254.169.254/latest").ok).toBe(false);
  });
});

describe("normalizeWebhookEvents", () => {
  it("defaults to order events", () => {
    const ev = normalizeWebhookEvents([]);
    expect(ev).toContain("order.created");
    expect(ev).toContain("order.shipped");
  });

  it("filters unknown events", () => {
    expect(normalizeWebhookEvents(["order.created", "product.published"])).toEqual(["order.created"]);
  });
});

describe("orderEventForStatus", () => {
  it("maps create and status values", () => {
    expect(orderEventForStatus("received", { isCreate: true })).toBe("order.created");
    expect(orderEventForStatus("accepted")).toBe("order.accepted");
    expect(orderEventForStatus("shipped")).toBe("order.shipped");
    expect(orderEventForStatus("in_production")).toBe("order.updated");
  });
});

describe("hmacSha256Hex", () => {
  it("is stable", async () => {
    const hex = await hmacSha256Hex("whsec_test", '{"ok":true}');
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
    expect(await hmacSha256Hex("whsec_test", '{"ok":true}')).toBe(hex);
  });
});

describe("partner API webhooks rewrite", () => {
  it("maps webhooks list/create and actions", () => {
    const list = rewritePartnerApiV1Request(new Request("https://partner.eazpire.com/api/v1/webhooks"));
    expect(new URL(list.url).searchParams.get("op")).toBe("partner-api-webhooks");

    const create = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/webhooks", { method: "POST" })
    );
    expect(new URL(create.url).searchParams.get("op")).toBe("partner-api-webhooks-create");

    const test = rewritePartnerApiV1Request(
      new Request("https://partner.eazpire.com/api/v1/webhooks/mwh_1/test", { method: "POST" })
    );
    expect(new URL(test.url).searchParams.get("op")).toBe("partner-api-webhooks-test");
    expect(new URL(test.url).searchParams.get("webhook_id")).toBe("mwh_1");
  });
});

describe("partner webhook scopes", () => {
  it("includes webhook scopes in defaults", () => {
    expect(DEFAULT_PARTNER_API_SCOPES).toContain(PARTNER_API_SCOPES.WEBHOOKS_READ);
    expect(DEFAULT_PARTNER_API_SCOPES).toContain(PARTNER_API_SCOPES.WEBHOOKS_WRITE);
  });
});
