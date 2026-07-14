import { describe, it, expect } from "vitest";
import {
  catalogPlaceholdersFromPartnerPrintAreas,
  placeholdersByPositionFromPartnerPrintAreas,
  buildTodifyCatalogVariantsFromPartner,
  attachPlaceholdersToCatalogVariants,
  catalogVariantsHavePlaceholderPositions,
} from "../../src/features/manufacturers/partnerCatalog/partnerCatalogPlaceholders.js";

describe("partnerCatalogPlaceholders", () => {
  const printAreas = [
    { view_key: "front", width_px: 4200, height_px: 4800, placeholders: { qr: 1 } },
    { view_key: "back", width_px: 4000, height_px: 4500 },
    { area_key: "neck", width_px: 750, height_px: 750, placeholders: { logo: 1, creator_design: 0 } },
  ];
  const views = [
    { view_key: "front", printable: 1, print_technique: "dtg" },
    { view_key: "back", printable: 1, print_technique: "dtg" },
    { view_key: "neck", printable: 1 },
  ];

  it("builds Printify-shaped placeholders from partner print areas", () => {
    const ph = catalogPlaceholdersFromPartnerPrintAreas(printAreas, views);
    expect(ph.map((p) => p.position)).toEqual(["front", "back", "neck"]);
    expect(ph[0].width).toBe(4200);
    expect(ph[0].decoration_method).toBe("dtg");
  });

  it("skips non-printable views", () => {
    const ph = catalogPlaceholdersFromPartnerPrintAreas(printAreas, [
      { view_key: "front", printable: 0 },
      { view_key: "back", printable: 1 },
    ]);
    expect(ph.map((p) => p.position)).toEqual(["back", "neck"]);
  });

  it("defaults creator_design when partner placeholders empty", () => {
    const byPos = placeholdersByPositionFromPartnerPrintAreas(printAreas);
    expect(byPos.front.qr).toBe(1);
    expect(byPos.back.creator_design).toBe(1);
    expect(byPos.neck.logo).toBe(1);
    expect(byPos.neck.creator_design).toBe(0);
  });

  it("builds catalog variants with placeholders on every row", () => {
    const variants = buildTodifyCatalogVariantsFromPartner({
      variants: [
        { color: "Black", size: "M", base_cost_cents: 1200, sku: "SKU-M" },
        { color: "White", size: "L", base_cost_cents: 1300, sku: "SKU-L" },
      ],
      printAreas,
      views,
    });
    expect(variants).toHaveLength(2);
    expect(variants[0].id).toBe(900000);
    expect(catalogVariantsHavePlaceholderPositions(variants)).toBe(true);
    expect(variants[1].placeholders.map((p) => p.position)).toEqual(["front", "back", "neck"]);
  });

  it("attaches placeholders onto existing profile variants", () => {
    const placeholders = catalogPlaceholdersFromPartnerPrintAreas(printAreas, views);
    const out = attachPlaceholdersToCatalogVariants(
      [{ id: 1, title: "A / S", placeholders: [] }],
      placeholders
    );
    expect(out[0].placeholders).toHaveLength(3);
    expect(catalogVariantsHavePlaceholderPositions([{ id: 1 }])).toBe(false);
  });
});
