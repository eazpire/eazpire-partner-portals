import { describe, it, expect } from "vitest";
import { validatePrintAreaForSubmit } from "../../src/features/manufacturers/printAreaValidation.js";
import { isManufacturerOp } from "../../src/features/manufacturers/manufacturerRouter.js";

/**
 * Lightweight integration guard for Partner Systems V1 API surface.
 */
describe("partner systems V1 integration guards", () => {
  it("blocks product submit without print areas", () => {
    const result = validatePrintAreaForSubmit([]);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("print_area_required");
  });

  it("exposes full V1 op surface", () => {
    const ops = [
      "partner-auth-request",
      "manufacturer-product-submit-review",
      "manufacturer-order-tracking-update",
      "admin-manufacturer-create",
      "admin-test-order-create",
      "admin-certification-review",
      "partner-application-submit",
      "admin-partner-application-approve",
      "partner-blueprint-list",
      "partner-blueprint-submit-review",
      "admin-blueprint-list",
      "admin-blueprint-approve",
    ];
    for (const op of ops) expect(isManufacturerOp(op)).toBe(true);
  });
});
