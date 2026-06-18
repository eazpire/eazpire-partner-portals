import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizePartnerEmail,
  isPartnerEmailBlocked,
  blockPartnerEmail,
} from "../../src/features/manufacturers/partnerEmailBlocks.js";

describe("partnerEmailBlocks", () => {
  it("normalizes email to lowercase", () => {
    expect(normalizePartnerEmail("  Test@Example.COM ")).toBe("test@example.com");
  });

  it("detects blocked email", async () => {
    const db = {
      prepare: (sql) => ({
        bind: (email) => ({
          first: async () => (sql.includes("partner_email_blocks") && email === "blocked@example.com" ? { email } : null),
        }),
        run: async () => ({}),
      }),
    };
    expect(await isPartnerEmailBlocked(db, "blocked@example.com")).toBe(true);
    expect(await isPartnerEmailBlocked(db, "free@example.com")).toBe(false);
  });

  it("upserts block row", async () => {
    const runs = [];
    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          run: async () => {
            runs.push({ sql, args });
          },
        }),
      }),
    };
    await blockPartnerEmail(db, "Bad@Example.com", "admin_1", "test");
    expect(runs).toHaveLength(1);
    expect(runs[0].args[0]).toBe("bad@example.com");
    expect(runs[0].args[1]).toBeTypeOf("number");
    expect(runs[0].args[2]).toBe("admin_1");
  });
});

describe("adminRemoveManufacturer", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns not_found when manufacturer missing", async () => {
    const { adminRemoveManufacturer } = await import("../../src/features/manufacturers/manufacturerService.js");
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }),
      }),
    };
    const result = await adminRemoveManufacturer({ MANUFACTURER_DB: db }, "mfr_missing", "remove", "admin_1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found");
  }, 30000);

  it("blocks emails when mode is block_remove", async () => {
    const manufacturer = {
      id: "mfr_1",
      name: "Acme",
      support_email: "owner@example.com",
      business_email: "owner@example.com",
    };
    const blockRuns = [];
    const deleteRuns = [];

    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (sql.includes("FROM manufacturers WHERE id")) return manufacturer;
            return null;
          },
          all: async () => {
            if (sql.includes("manufacturer_users")) {
              return { results: [{ email: "owner@example.com" }, { email: "ops@example.com" }] };
            }
            return { results: [] };
          },
          run: async () => {
            if (sql.includes("partner_email_blocks")) blockRuns.push(args);
            else deleteRuns.push(sql.slice(0, 40));
          },
        }),
      }),
    };

    vi.doMock("../../src/features/manufacturers/rbac.js", () => ({
      writeAuditLog: vi.fn(async () => {}),
    }));

    const { adminRemoveManufacturer } = await import("../../src/features/manufacturers/manufacturerService.js");
    const result = await adminRemoveManufacturer({ MANUFACTURER_DB: db }, "mfr_1", "block_remove", "admin_1");

    expect(result.ok).toBe(true);
    expect(result.blocked_emails).toContain("owner@example.com");
    expect(result.blocked_emails).toContain("ops@example.com");
    expect(blockRuns.length).toBe(2);
    expect(deleteRuns.some((s) => s.includes("DELETE FROM manufacturers"))).toBe(true);
  }, 30000);
});
