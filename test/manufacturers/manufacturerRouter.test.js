import { describe, it, expect } from "vitest";
import { isManufacturerOp } from "../../src/features/manufacturers/manufacturerRouter.js";
import { slugify, newId } from "../../src/features/manufacturers/db.js";

describe("manufacturerService helpers", () => {
  it("slugify normalizes manufacturer names", () => {
    expect(slugify("Acme Print GmbH")).toBe("acme-print-gmbh");
    expect(slugify("  ")).toBe("");
  });

  it("newId uses prefix", () => {
    expect(newId("mfr").startsWith("mfr_")).toBe(true);
  });
});

describe("manufacturerRouter ops", () => {
  it("recognizes partner and admin ops", () => {
    expect(isManufacturerOp("partner-auth-request")).toBe(true);
    expect(isManufacturerOp("partner-auth-poll")).toBe(true);
    expect(isManufacturerOp("partner-auth-exchange")).toBe(true);
    expect(isManufacturerOp("manufacturer-dashboard")).toBe(true);
    expect(isManufacturerOp("admin-test-order-create")).toBe(true);
    expect(isManufacturerOp("admin-manufacturer-reactivate")).toBe(true);
    expect(isManufacturerOp("admin-manufacturer-remove")).toBe(true);
    expect(isManufacturerOp("partner-blueprint-list")).toBe(true);
    expect(isManufacturerOp("admin-blueprint-approve")).toBe(true);
    expect(isManufacturerOp("admin-creations-list")).toBe(true);
    expect(isManufacturerOp("admin-creations-customer-products")).toBe(true);
    expect(isManufacturerOp("unknown-op")).toBe(false);
  });
});
