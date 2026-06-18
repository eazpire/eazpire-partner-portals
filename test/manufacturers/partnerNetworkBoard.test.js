import { describe, it, expect, vi, beforeEach } from "vitest";
import { isManufacturerOp } from "../../src/features/manufacturers/manufacturerRouter.js";

describe("partner network board op", () => {
  it("registers admin-manufacturer-network-board", () => {
    expect(isManufacturerOp("admin-manufacturer-network-board")).toBe(true);
  });
});

describe("adminRejectPartnerApplication block mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "" })));
  });

  it("blocks email when block option is set", async () => {
    const runs = [];
    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (sql.includes("partner_applications WHERE id")) {
              return {
                id: "papp_1",
                email: "applicant@example.com",
                company_name: "Test Co",
                status: "pending_review",
              };
            }
            return null;
          },
          run: async () => {
            runs.push({ sql, args });
            return {};
          },
        }),
      }),
    };

    const { adminRejectPartnerApplication } = await import(
      "../../src/features/manufacturers/partnerApplicationService.js"
    );

    const result = await adminRejectPartnerApplication(
      { MANUFACTURER_DB: db, PARTNER_PORTAL_URL: "https://partner.eazpire.com", RESEND_API_KEY: "k" },
      "papp_1",
      "admin_1",
      { reason: "Not a fit", block: true }
    );

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(true);
    expect(runs.some((r) => r.sql.includes("partner_email_blocks"))).toBe(true);
  });
});

describe("adminSuspendManufacturer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "" })));
  });

  it("sets suspend metadata and optionally blocks email", async () => {
    const runs = [];
    const manufacturerRow = {
      id: "mfg_1",
      name: "Test Mfg",
      status: "verified",
      support_email: null,
      business_email: null,
    };
    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (sql.includes("FROM manufacturers WHERE id")) return manufacturerRow;
            if (sql.includes("manufacturer_users") && sql.includes("LIMIT 1")) return { email: "owner@example.com" };
            return null;
          },
          run: async () => {
            runs.push({ sql, args });
            return {};
          },
          all: async () => ({
            results: sql.includes("manufacturer_users") ? [{ email: "owner@example.com" }] : [],
          }),
        }),
      }),
    };

    const { adminSuspendManufacturer } = await import(
      "../../src/features/manufacturers/manufacturerService.js"
    );

    const result = await adminSuspendManufacturer(
      { MANUFACTURER_DB: db, RESEND_API_KEY: "k" },
      "mfg_1",
      "admin_1",
      { reason: "Policy violation", block: true }
    );

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(true);
    expect(runs.some((r) => r.sql.includes("suspend_reason"))).toBe(true);
    expect(runs.some((r) => r.sql.includes("partner_email_blocks"))).toBe(true);
  });
});

describe("adminGetPartnerNetworkBoard", () => {
  it("returns tab buckets with prior history on pending apps", async () => {
    const db = {
      prepare: (sql) => {
        const chain = {
          bind: (...args) => chain,
          first: async () => null,
          all: async () => {
            if (sql.includes("pending_email_verification")) {
              return {
                results: [
                  {
                    id: "papp_new",
                    email: "repeat@example.com",
                    company_name: "Repeat Co",
                    contact_name: "Repeat",
                    status: "pending_review",
                  },
                ],
              };
            }
            if (sql.includes("status = 'rejected'") && sql.includes("partner_applications")) {
              if (sql.includes("lower(email)")) {
                return {
                  results: [
                    {
                      id: "papp_old",
                      company_name: "Repeat Co",
                      rejection_reason: "Previous no",
                      reviewed_at: 1000,
                    },
                  ],
                };
              }
              return { results: [] };
            }
            if (sql.includes("status IN ('verified'")) return { results: [] };
            if (sql.includes("status = 'suspended'") && sql.includes("manufacturers")) return { results: [] };
            if (sql.includes("partner_email_blocks")) return { results: [] };
            if (sql.includes("manufacturer_users")) return { results: [] };
            if (sql.includes("suspended_at IS NOT NULL")) return { results: [] };
            return { results: [] };
          },
        };
        return chain;
      },
    };

    const { adminGetPartnerNetworkBoard } = await import(
      "../../src/features/manufacturers/partnerNetworkBoard.js"
    );
    const board = await adminGetPartnerNetworkBoard(db);

    expect(board.pending).toHaveLength(1);
    expect(board.pending[0].prior_history).toHaveLength(1);
    expect(board.pending[0].prior_history[0].type).toBe("rejected");
  });
});
