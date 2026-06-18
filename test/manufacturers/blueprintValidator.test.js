import { describe, it, expect } from "vitest";
import { validateUniversalBlueprint } from "../../src/features/manufacturers/blueprints/blueprintValidator.js";
import { normalizeWizardInput, parseCsvVariants } from "../../src/features/manufacturers/blueprints/blueprintNormalizer.js";
import { slugBlueprintKey, inferArtifactSlot } from "../../src/features/manufacturers/blueprints/blueprintSchema.js";

const validBlueprint = {
  schema: "eazpire.universal_blueprint",
  identity: { title: "Test Hoodie", blueprint_key: "test_hoodie" },
  category: { normalized: "apparel.hoodie", product_type: "hoodie" },
  variants: [{ variant_key: "black_m", base_cost: 21.5, currency: "EUR" }],
  print_areas: [
    {
      area_key: "front",
      canvas: { width_px: 4500, height_px: 5400, dpi: 300 },
      safe_zone: { x: 300, y: 300, width: 3900, height: 4800 },
      file_types: ["png"],
      enabled: true,
    },
  ],
  shipping: [{ ship_from_country: "DE", ship_to_countries: ["DE"], base_shipping: 4.9, currency: "EUR" }],
  mockup_views: [{ view_key: "front", label: "Front" }],
  auto_publish_profiles: [{ profile_key: "default", label: "Default" }],
};

describe("blueprintValidator", () => {
  it("accepts valid universal blueprint", () => {
    const result = validateUniversalBlueprint(validBlueprint);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it("rejects blueprint without variants", () => {
    const result = validateUniversalBlueprint({ ...validBlueprint, variants: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "no_variants")).toBe(true);
  });

  it("rejects blueprint without print areas", () => {
    const result = validateUniversalBlueprint({ ...validBlueprint, print_areas: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_print_area")).toBe(true);
  });

  it("warns when mockups missing", () => {
    const result = validateUniversalBlueprint({ ...validBlueprint, mockup_views: [] });
    expect(result.warnings.some((w) => w.code === "missing_mockup")).toBe(true);
  });
});

describe("blueprintNormalizer", () => {
  it("normalizes wizard input with defaults", () => {
    const bp = normalizeWizardInput(
      {
        title: "Organic Tee",
        normalized_category: "apparel.tshirt",
        variants: [{ color: "White", size: "L", base_cost: 12 }],
        print_areas: [{ area_key: "front", width_px: 3000, height_px: 3600, dpi: 300 }],
      },
      { manufacturerId: "mfg_test", title: "Organic Tee" }
    );
    expect(bp.schema).toBe("eazpire.universal_blueprint");
    expect(bp.variants).toHaveLength(1);
    expect(bp.print_areas[0].canvas.width_px).toBe(3000);
    expect(bp.placeholders.some((p) => p.placeholder_key === "main_design_front")).toBe(true);
    expect(bp.auto_publish_profiles.length).toBeGreaterThan(0);
    expect(bp.shipping.length).toBeGreaterThan(0);
  });

  it("parses CSV variants", () => {
    const csv = `color,size,base_cost,sku\nBlack,M,15.5,BLK-M\nWhite,L,15.5,WHT-L`;
    const variants = parseCsvVariants(csv);
    expect(variants).toHaveLength(2);
    expect(variants[0].variant_key).toBe("black_m");
    expect(variants[0].base_cost).toBe(15.5);
  });
});

describe("blueprintSchema", () => {
  it("slugifies blueprint keys", () => {
    expect(slugBlueprintKey("Oversized Hoodie 300gsm")).toBe("oversized_hoodie_300gsm");
  });

  it("infers artifact slot from category", () => {
    expect(inferArtifactSlot("apparel.hoodie")).toBe("upper_body");
    expect(inferArtifactSlot("wall_art.poster")).toBe("museum_collectible");
  });
});
