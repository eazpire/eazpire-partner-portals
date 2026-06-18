import { describe, it, expect } from "vitest";
import { isPartnerPortalHost } from "../../src/features/manufacturers/partnerPortalHost.js";

describe("partnerPortalHost routing", () => {
  it("detects partner host", () => {
    expect(isPartnerPortalHost("partner.eazpire.com", "/")).toBe(true);
    expect(isPartnerPortalHost("partner.eazpire.com", "/catalog")).toBe(true);
  });

  it("detects admin partner path and root landing", () => {
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner/")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/partner/catalog")).toBe(true);
    expect(isPartnerPortalHost("admin.eazpire.com", "/")).toBe(true);
  });
});
