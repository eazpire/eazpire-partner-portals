import { describe, it, expect } from "vitest";
import { handlePartnerPortalRequest, isPartnerPortalHost } from "../../src/features/manufacturers/partnerPortalHost.js";
import { rewritePartnerApiV1Request } from "../../src/features/manufacturers/partnerApiV1.js";

describe("partnerPortalHost routing", () => {
  it("detects partner host", () => {
    expect(isPartnerPortalHost("partner.eazpire.com", "/")).toBe(true);
    expect(isPartnerPortalHost("partner.eazpire.com", "/catalog")).toBe(true);
  });

  it("rewrites Partner API v1 before SPA static routes", () => {
    const out = rewritePartnerApiV1Request(new Request("https://partner.eazpire.com/api/v1/overview"));
    expect(out).toBeTruthy();
    expect(new URL(out.url).searchParams.get("op")).toBe("partner-api-overview");
  });

  it("serves cursor-agent CSS with CORS for creator.eazpire.com", async () => {
    const req = new Request("https://admin.eazpire.com/creations/shared/admin-cursor-agent/shell.css", {
      headers: { Origin: "https://creator.eazpire.com" },
    });
    const res = await handlePartnerPortalRequest(req, {});
    expect(res).toBeTruthy();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://creator.eazpire.com");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("detects admin partner path and root landing", () => {
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner/")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner/catalog")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/creations")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/creations/designs")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/brands")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/brands/detail")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/audience")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/audience/plan")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/system")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/system/generator")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/marketing")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/marketing/amazon-ads")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/")).toBe(true);
  });
});
