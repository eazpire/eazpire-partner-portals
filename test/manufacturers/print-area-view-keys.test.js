import { describe, it, expect } from "vitest";
import {
  catalogPlaceholdersFromVariants,
  unionPatPlaceholderPositions,
} from "../../admin-partner-portal/js/catalog-editor/provider-print-technical.js";
import {
  listViewKeys,
  printAreaCatalogDetail,
  resolvePrintAreaCatalogVariants,
} from "../../admin-partner-portal/js/catalog-editor/print-area/helpers.js";

const savedVariantsSubset = [
  {
    id: 1,
    placeholders: [
      { position: "front", width: 4200, height: 4800 },
      { position: "neck", width: 750, height: 750 },
      { position: "sleeve_left", width: 1200, height: 1200 },
    ],
  },
];

const liveCatalogVariants = [
  {
    id: 1,
    placeholders: [
      { position: "front", width: 4200, height: 4800 },
      { position: "left_sleeve", width: 1200, height: 1200 },
      { position: "back", width: 4200, height: 4800 },
      { position: "right_sleeve", width: 1200, height: 1200 },
      { position: "neck", width: 750, height: 750 },
    ],
  },
];

const versionWithAllPositions = {
  product_version_config: {
    placeholders_by_position: {
      front: { creator_design: 1, qr: 0, logo: 0, additional_design: 0 },
      back: { creator_design: 1, qr: 0, logo: 0, additional_design: 0 },
      neck: { logo: 1, qr: 0, creator_design: 0, additional_design: 0 },
      sleeve_left: { qr: 1, logo: 0, creator_design: 0, additional_design: 0 },
      sleeve_right: { qr: 1, logo: 0, creator_design: 0, additional_design: 0 },
    },
  },
};

describe("catalogPlaceholdersFromVariants", () => {
  it("unions placeholder positions across variants", () => {
    const variants = [
      { placeholders: [{ position: "front" }, { position: "neck" }] },
      { placeholders: [{ position: "back" }, { position: "right_sleeve" }] },
    ];
    const positions = catalogPlaceholdersFromVariants(variants).map((p) => p.position);
    expect(positions).toEqual(["front", "neck", "back", "right_sleeve"]);
  });

  it("dedupes sleeve_left vs left_sleeve aliases", () => {
    const variants = [
      { placeholders: [{ position: "sleeve_left" }] },
      { placeholders: [{ position: "left_sleeve" }, { position: "back" }] },
    ];
    const positions = catalogPlaceholdersFromVariants(variants).map((p) => p.position);
    expect(positions).toEqual(["sleeve_left", "back"]);
  });
});

describe("listViewKeys OPT OnDemand catalog resolution", () => {
  it("shows all five views when live catalog variants are available", () => {
    const ctx = { selectedPrintProviderId: 30 };
    const data = { catalog_variants: liveCatalogVariants, variants_json: savedVariantsSubset };
    const catalogDetail = printAreaCatalogDetail(ctx, data);
    const views = listViewKeys([], {}, versionWithAllPositions, catalogDetail);
    expect(views).toEqual(["back", "front", "left_sleeve", "neck", "right_sleeve"]);
  });

  it("falls back to saved variants_json when live catalog is missing", () => {
    const ctx = { selectedPrintProviderId: 30 };
    const data = { variants_json: savedVariantsSubset };
    const views = listViewKeys([], {}, versionWithAllPositions, printAreaCatalogDetail(ctx, data));
    // Only catalog positions — version config must not invent back / sleeve_right.
    expect(views).toEqual(["front", "neck", "sleeve_left"]);
  });

  it("prefers live catalog variants over saved variants_json", () => {
    const ctx = { selectedPrintProviderId: 30 };
    const variants = resolvePrintAreaCatalogVariants(ctx, {
      catalog_variants: liveCatalogVariants,
      variants_json: savedVariantsSubset,
    });
    expect(variants).toBe(liveCatalogVariants);
  });

  it("does not add version config positions absent from provider catalog", () => {
    const views = listViewKeys(
      [],
      {},
      versionWithAllPositions,
      { variants: savedVariantsSubset }
    );
    expect(views).toEqual(["front", "neck", "sleeve_left"]);
  });

  it("matches provider catalog when only front/back/neck exist", () => {
    const catalogFrontBackNeck = [
      {
        id: 1,
        placeholders: [
          { position: "front", width: 4200, height: 4800 },
          { position: "back", width: 4200, height: 4800 },
          { position: "neck", width: 750, height: 750 },
        ],
      },
    ];
    const views = listViewKeys([], {}, versionWithAllPositions, { variants: catalogFrontBackNeck });
    expect(views).toEqual(["back", "front", "neck"]);
  });
});

describe("unionPatPlaceholderPositions alias handling", () => {
  it("does not duplicate sleeve aliases from catalog and ignores config-only extras", () => {
    const positions = unionPatPlaceholderPositions(liveCatalogVariants, {
      sleeve_left: { qr: 1, logo: 0, creator_design: 0, additional_design: 0 },
      hood: { qr: 0, logo: 0, creator_design: 1, additional_design: 0 },
    });
    const keys = positions.map((p) => p.position);
    expect(keys).toEqual(["front", "left_sleeve", "back", "right_sleeve", "neck"]);
    expect(keys).not.toContain("hood");
  });
});
