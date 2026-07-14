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
