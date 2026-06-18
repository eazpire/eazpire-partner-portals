import { describe, it, expect, vi, beforeEach } from "vitest";
import { isManufacturerOp } from "../../src/features/manufacturers/manufacturerRouter.js";

describe("partner application ops", () => {
  it("registers application and admin review ops", () => {
    const ops = [
      "partner-application-submit",
      "partner-application-verify",
      "partner-application-status",
      "admin-partner-application-list",
      "admin-partner-application-approve",
      "admin-partner-application-reject",
      "admin-manufacturer-network-board",
    ];
    for (const op of ops) expect(isManufacturerOp(op)).toBe(true);
  });
});

describe("submitPartnerApplication validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects missing company name", async () => {
    const { submitPartnerApplication } = await import(
      "../../src/features/manufacturers/partnerApplicationService.js"
    );
    const result = await submitPartnerApplication(
      { MANUFACTURER_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } },
      { email: "a@b.com", contact_name: "A", country: "DE" }
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("company_name_required");
  });

  it("returns success for existing manufacturer user without creating application", async () => {
    const { submitPartnerApplication } = await import(
      "../../src/features/manufacturers/partnerApplicationService.js"
    );
    const db = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("manufacturer_users")) return { id: "musr_1" };
            return null;
          },
          run: async () => ({}),
        }),
      }),
    };
    const result = await submitPartnerApplication({ MANUFACTURER_DB: db }, {
      email: "tobi.muss@hotmail.com",
      company_name: "Test Co",
      contact_name: "Tobi",
      country: "DE",
    });
    expect(result.ok).toBe(true);
    expect(result.already_partner).toBe(true);
  });

  it("rejects blocked email without sending", async () => {
    const { submitPartnerApplication } = await import(
      "../../src/features/manufacturers/partnerApplicationService.js"
    );
    const db = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("partner_email_blocks")) return { email: "blocked@example.com" };
            return null;
          },
          run: async () => ({}),
        }),
      }),
    };
    const result = await submitPartnerApplication({ MANUFACTURER_DB: db }, {
      email: "blocked@example.com",
      company_name: "Test Co",
      contact_name: "Tobi",
      country: "DE",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("email_blocked");
  });
});

describe("issuePartnerMagicLink application fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
  });

  it("sends applicant magic link when no manufacturer user but pending application exists", async () => {
    const application = {
      id: "papp_1",
      company_name: "Test Co",
      status: "pending_review",
      email: "applicant@example.com",
    };
    const db = {
      prepare: (sql) => {
        const chain = {
          bind: () => chain,
          first: async () => {
            if (sql.trim() === "SELECT 1 FROM manufacturers LIMIT 1") return { ok: 1 };
            if (sql.includes("manufacturer_users")) return null;
            if (sql.includes("partner_applications") && sql.includes("rejected")) return application;
            return null;
          },
          run: async () => ({}),
        };
        return chain;
      },
    };
    const { issuePartnerMagicLink } = await import("../../src/features/manufacturers/partnerAuth.js");
    const result = await issuePartnerMagicLink(
      {
        MANUFACTURER_DB: db,
        PARTNER_PORTAL_URL: "https://partner.eazpire.com",
        RESEND_API_KEY: "test-key",
      },
      "applicant@example.com"
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("applicant");
    expect(result.verifyUrl).toContain("/auth/verify?token=");
    expect(global.fetch).toHaveBeenCalled();
  });

  it("returns email_blocked for blocked addresses", async () => {
    const db = {
      prepare: (sql) => {
        const chain = {
          bind: () => chain,
          first: async () => {
            if (sql.trim() === "SELECT 1 FROM manufacturers LIMIT 1") return { ok: 1 };
            if (sql.includes("partner_email_blocks")) return { email: "blocked@example.com" };
            return null;
          },
          run: async () => ({}),
        };
        return chain;
      },
    };
    const { issuePartnerMagicLink } = await import("../../src/features/manufacturers/partnerAuth.js");
    const result = await issuePartnerMagicLink({ MANUFACTURER_DB: db }, "blocked@example.com");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("email_blocked");
    expect(global.fetch).not.toHaveBeenCalled();
  });

});

describe("upgradeApprovedApplicantToFullSession", () => {
  it("issues full session when application is approved and manufacturer user exists", async () => {
    const { upgradeApprovedApplicantToFullSession } = await import(
      "../../src/features/manufacturers/partnerApplicationService.js"
    );
    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (sql.includes("partner_applications WHERE id")) {
              return {
                id: "papp_1",
                email: "applicant@example.com",
                status: "approved",
              };
            }
            if (sql.includes("manufacturer_users")) {
              return {
                id: "musr_1",
                manufacturer_id: "mfg_1",
                email: "applicant@example.com",
                role: "owner",
                manufacturer_status: "approved_for_test",
              };
            }
            return null;
          },
          run: async () => ({}),
        }),
      }),
    };

    const result = await upgradeApprovedApplicantToFullSession(
      { MANUFACTURER_DB: db, JWT_APP_SECRET: "test-secret-key-for-jwt-signing" },
      { applicationId: "papp_1", email: "applicant@example.com" }
    );

    expect(result).not.toBeNull();
    expect(result.session.mode).toBe("full");
    expect(result.session.manufacturer_id).toBe("mfg_1");
    expect(result.jwt).toBeTruthy();
  });

  it("returns null when application is not approved", async () => {
    const { upgradeApprovedApplicantToFullSession } = await import(
      "../../src/features/manufacturers/partnerApplicationService.js"
    );
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "papp_1",
            email: "applicant@example.com",
            status: "pending_review",
          }),
        }),
      }),
    };

    const result = await upgradeApprovedApplicantToFullSession(
      { MANUFACTURER_DB: db },
      { applicationId: "papp_1", email: "applicant@example.com" }
    );
    expect(result).toBeNull();
  });
});
