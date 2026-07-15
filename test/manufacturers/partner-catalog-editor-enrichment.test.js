import { describe, it, expect } from "vitest";
import {
  buildPartnerProductDataForUi,
  catalogMockupRowsFromPartnerSlots,
  splitPartnerMockupRowsBySet,
  mockupDefaultsFromPartnerPrintAreas,
  enrichMockupsBundleFromPartner,
  enrichVariantsBundleFromPartner,
  enrichPrintAreaBundleFromPartner,
  enrichVersionsDisplayNamesFromPartner,
  resolvePartnerCatalogDisplayTitle,
  isPlaceholderVersionDisplayName,
  mergePartnerMockupDefaultsIntoCatalog,
} from "../../src/features/manufacturers/partnerCatalog/partnerCatalogEditorEnrichment.js";

describe("partnerCatalogEditorEnrichment", () => {
  const variants = [
    { color: "Black", size: "M", base_cost_cents: 1200, sku: "BK-M", attributes: { color_hex: "#111111" } },
    { color: "Black", size: "L", base_cost_cents: 1300, sku: "BK-L", attributes: { color_hex: "#111111" } },
    { color: "White", size: "M", base_cost_cents: 1250, sku: "WH-M", attributes: { color_hex: "FFFFFF" } },
  ];

  it("builds Printify-shaped product_data with colors, sizes, costs, hex", () => {
    const data = buildPartnerProductDataForUi(variants, { title: "Hooded Tank" });
    expect(data.options).toHaveLength(2);
    expect(data.options[0].type).toBe("color");
    expect(data.options[0].values[0].colors[0]).toBe("#111111");
    expect(data.options[0].values[1].colors[0]).toBe("#ffffff");
    expect(data.variants).toHaveLength(3);
    expect(data.variants[0].cost).toBe(1200);
    expect(data.variants[0].options).toHaveLength(2);
  });

  it("maps partner mockup slots into clean/shop/calibration/preview buckets", () => {
    const rows = catalogMockupRowsFromPartnerSlots(
      [
        { id: "a", mockup_set: "clean", view_key: "front", color_key: "Black", image_url: "https://x/c.png" },
        { id: "b", mockup_set: "shop_preview", view_key: "front", color_key: "Black", image_url: "https://x/s.png" },
        { id: "c", mockup_set: "calibration", view_key: "front", color_key: "Black", image_url: "https://x/cal.png" },
        { id: "d", mockup_set: "preview_images", view_key: "gallery_1", image_url: "https://x/p.png" },
      ],
      { productKey: "todify-hooded-tank", printProviderId: 1 }
    );
    const split = splitPartnerMockupRowsBySet(rows);
    expect(split.images).toHaveLength(1);
    expect(split.shop_preview_images).toHaveLength(1);
    expect(split.calibration_images).toHaveLength(1);
    expect(split.preview_images).toHaveLength(1);
    expect(split.images[0].is_default).toBe(1);
    expect(split.images[0].color_name).toBe("Black");
  });

  it("builds mockup_defaults from partner print rects", () => {
    const defaults = mockupDefaultsFromPartnerPrintAreas(
      [
        {
          view_key: "front",
          width_px: 4200,
          height_px: 4800,
          print_rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
          image_url: "https://x/front.png",
        },
        { view_key: "back", width_px: 4000, height_px: 4500 },
      ],
      {}
    );
    expect(defaults).toHaveLength(2);
    expect(defaults[0].print_area_key).toBe("front");
    expect(defaults[0].printify_print_area_width).toBe(4200);
    expect(JSON.parse(defaults[0].print_area_rect_json).w).toBe(0.5);
    expect(defaults[0].print_area_template_url).toBe("https://x/front.png");
  });

  it("enriches empty mockups/variants/print-area bundles from partner source", () => {
    const partner = {
      product_key: "todify-x",
      variants,
      print_areas: [
        { view_key: "front", width_px: 1000, height_px: 1200, print_rect: { x: 0, y: 0, w: 1, h: 1 } },
      ],
      views: [{ view_key: "front", printable: 1 }],
      mockups: [
        { id: "m1", mockup_set: "clean", view_key: "front", color_key: "Black", image_url: "https://x/c.png" },
      ],
    };

    const mockups = enrichMockupsBundleFromPartner({ ok: true, images: [], shop_preview_images: [], calibration_images: [] }, partner, {
      productKey: "todify-x",
      printProviderId: 1,
    });
    expect(mockups.images).toHaveLength(1);
    expect(mockups._partner_mockups).toBe(true);

    const variantsBundle = enrichVariantsBundleFromPartner({ ok: true, product_data: null }, partner);
    expect(variantsBundle.product_data.variants).toHaveLength(3);
    expect(variantsBundle._partner_variants).toBe(true);

    const pa = enrichPrintAreaBundleFromPartner({ ok: true, mockup_defaults: [], variant_print_areas: [] }, partner, {});
    expect(pa.mockup_defaults).toHaveLength(1);
    expect(pa.variant_print_areas.length).toBeGreaterThan(0);
  });

  it("fills calibration rects into Todify shell mockup_defaults (empty template_r2_key)", () => {
    const partner = {
      product_key: "black-hooded-gym-tank",
      print_areas: [
        {
          view_key: "back",
          width_px: 4200,
          height_px: 4800,
          print_rect: { x: 0.22, y: 0.18, w: 0.42, h: 0.48 },
        },
        {
          view_key: "front",
          width_px: 4200,
          height_px: 4800,
          print_rect: { x: 0.2, y: 0.15, w: 0.45, h: 0.5 },
        },
      ],
    };
    // First-INSERT shell rows: no rect → would previously block partner synth and show defaultCenteredRect
    const shellDefaults = [
      {
        product_key: "black-hooded-gym-tank",
        print_area_key: "back",
        template_r2_key: "",
        print_area_rect_json: null,
        mockup_print_area_rect_json: null,
      },
      {
        product_key: "black-hooded-gym-tank",
        print_area_key: "front",
        template_r2_key: "",
        // Accidental save of UI default (centered 50% after aspect fit approx)
        print_area_rect_json: JSON.stringify({ x: 0.28125, y: 0.25, w: 0.4375, h: 0.5, angle: 0 }),
      },
    ];
    const pa = enrichPrintAreaBundleFromPartner(
      { ok: true, mockup_defaults: shellDefaults, variant_print_areas: [{ id: 1 }] },
      partner,
      {}
    );
    expect(pa._partner_print_areas).toBe(true);
    const back = pa.mockup_defaults.find((r) => r.print_area_key === "back");
    const front = pa.mockup_defaults.find((r) => r.print_area_key === "front");
    expect(JSON.parse(back.print_area_rect_json)).toMatchObject({ x: 0.22, w: 0.42 });
    expect(JSON.parse(front.print_area_rect_json)).toMatchObject({ x: 0.2, w: 0.45 });
    expect(back.printify_print_area_width).toBe(4200);
  });

  it("keeps intentional non-default catalog rects when merging partner calibration", () => {
    const partnerRect = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const manualRect = { x: 0.05, y: 0.4, w: 0.55, h: 0.35, angle: 0 };
    const { rows } = mergePartnerMockupDefaultsIntoCatalog(
      [
        {
          print_area_key: "front",
          template_r2_key: "",
          print_area_rect_json: JSON.stringify(manualRect),
          mockup_print_area_rect_json: JSON.stringify(manualRect),
          printify_print_area_width: 1000,
          printify_print_area_height: 1000,
        },
      ],
      [
        {
          print_area_key: "front",
          print_area_rect_json: JSON.stringify(partnerRect),
          mockup_print_area_rect_json: JSON.stringify(partnerRect),
          printify_print_area_width: 1000,
          printify_print_area_height: 1000,
        },
      ]
    );
    expect(JSON.parse(rows[0].print_area_rect_json)).toMatchObject(manualRect);
    expect(JSON.parse(rows[0].mockup_print_area_rect_json)).toMatchObject(manualRect);
  });

  it("does not overwrite existing catalog mockups/product_data", () => {
    const partner = {
      product_key: "todify-x",
      variants,
      mockups: [{ id: "m1", mockup_set: "clean", view_key: "front", image_url: "https://x/c.png" }],
    };
    const mockups = enrichMockupsBundleFromPartner(
      { images: [{ id: 1, view_key: "front", image_url: "https://printify/x.png" }] },
      partner,
      { productKey: "todify-x" }
    );
    expect(mockups.images[0].id).toBe(1);
    expect(mockups._partner_mockups).toBeUndefined();

    const variantsBundle = enrichVariantsBundleFromPartner(
      { product_data: { variants: [{ id: 1 }] } },
      partner
    );
    expect(variantsBundle.product_data.variants).toHaveLength(1);
    expect(variantsBundle._partner_variants).toBeUndefined();
  });

  it("resolves partner catalog title and replaces Standard version labels for Todify", () => {
    expect(isPlaceholderVersionDisplayName("Standard")).toBe(true);
    expect(isPlaceholderVersionDisplayName("KNL print")).toBe(false);
    expect(
      resolvePartnerCatalogDisplayTitle({
        title: "KNL print",
        productTitle: "Standard",
        profileTitle: "Standard",
      })
    ).toBe("KNL print");

    const versions = enrichVersionsDisplayNamesFromPartner(
      [{ id: 1, display_name: "Standard" }, { id: 2, display_name: "Custom Cut" }],
      "KNL print",
      { sourceSystem: "todify" }
    );
    expect(versions[0].display_name).toBe("KNL print");
    expect(versions[1].display_name).toBe("Custom Cut");

    const printifyLeftAlone = enrichVersionsDisplayNamesFromPartner(
      [{ id: 1, display_name: "Standard" }],
      "KNL print",
      { sourceSystem: "printify" }
    );
    expect(printifyLeftAlone[0].display_name).toBe("Standard");
  });
});
