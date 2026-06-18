import { describe, it, expect } from "vitest";
import { validatePrintArea, validatePrintAreaForSubmit } from "../../src/features/manufacturers/printAreaValidation.js";

describe("printAreaValidation", () => {
  it("accepts valid print area", () => {
    const result = validatePrintArea({
      width_px: 4500,
      height_px: 5400,
      dpi: 300,
      safe_zone: { x: 0, y: 0, width: 4500, height: 5400 },
      supported_file_types: ["png"],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects low dpi", () => {
    const result = validatePrintArea({ width_px: 1000, height_px: 1000, dpi: 72 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dpi_too_low");
  });

  it("rejects safe zone outside canvas", () => {
    const result = validatePrintArea({
      width_px: 1000,
      height_px: 1000,
      dpi: 300,
      safe_zone: { x: 0, y: 0, width: 1200, height: 1000 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("safe_zone_outside_canvas");
  });

  it("requires at least one print area for submit", () => {
    expect(validatePrintAreaForSubmit([]).ok).toBe(false);
    expect(validatePrintAreaForSubmit([{ width_px: 1000, height_px: 1000, dpi: 300 }]).ok).toBe(true);
  });
});
