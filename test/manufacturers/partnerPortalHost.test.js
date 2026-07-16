import { describe, it, expect } from "vitest";
import { isPartnerPortalHost } from "../../src/features/manufacturers/partnerPortalHost.js";
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

  it("detects admin partner path and root landing", () => {
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner/")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner/catalog")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/creations")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/creations/designs")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/brands")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/brands/detail")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/")).toBe(true);
  });
});
