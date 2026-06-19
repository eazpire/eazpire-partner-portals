import { describe, it, expect } from "vitest";
import { isManufacturerOp } from "../../src/features/manufacturers/manufacturerRouter.js";
import {
  catalogStatusToIsActive,
  isActiveToCatalogStatus,
  PRINTIFY_PARTNER_ID,
} from "../../src/features/manufacturers/partnerCatalog/constants.js";
import { normalizePrintifyCatalogBlueprint } from "../../src/features/manufacturers/adapters/printify/printifyBlueprintNormalizer.js";
import {
  patRowToStudioConfig,
  patRowToAutoPublishConfig,
} from "../../src/features/manufacturers/partnerCatalog/eazpireProductVersionService.js";

describe("partner catalog ops registration", () => {
  const ops = [
    "admin-partner-list",
    "admin-partner-fulfillment-providers",
    "admin-partner-catalog-blueprints",
    "admin-partner-sync-printify",
    "admin-eazpire-product-list",
    "admin-eazpire-product-get",
    "admin-eazpire-product-update",
    "admin-eazpire-product-version-list",
    "admin-eazpire-product-version-update",
    "admin-eazpire-catalog-import",
    "admin-eazpire-catalog-mirror-status",
    "admin-eazpire-catalog-mirror-run",
  ];

  for (const op of ops) {
    it(`registers ${op}`, () => {
      expect(isManufacturerOp(op)).toBe(true);
    });
  }
});

describe("catalog status mapping", () => {
  it("maps online to is_active 2", () => {
    expect(catalogStatusToIsActive("online")).toBe(2);
    expect(isActiveToCatalogStatus(2)).toBe("online");
  });

  it("maps preview and offline", () => {
    expect(catalogStatusToIsActive("preview")).toBe(1);
    expect(catalogStatusToIsActive("offline")).toBe(0);
  });
});

describe("normalizePrintifyCatalogBlueprint", () => {
  it("produces universal blueprint with printify provider metadata", () => {
    const normalized = normalizePrintifyCatalogBlueprint(
      { id: 145, title: "Unisex Softstyle Cotton Tee", brand: "Gildan" },
      { manufacturerId: PRINTIFY_PARTNER_ID, printProviderId: 30 }
    );
    expect(normalized.schema).toBe("eazpire.universal_blueprint");
    expect(normalized.provider.integration_type).toBe("printify_catalog");
    expect(normalized.provider.external_blueprint_id).toBe("145");
    expect(normalized.identity.title).toContain("Unisex");
    expect(normalized.print_areas.length).toBeGreaterThan(0);
  });
});

describe("PAT field mapping", () => {
  it("maps PAT row to studio and auto_publish config", () => {
    const pat = {
      print_areas_snapshot_json: '{"front":{}}',
      printify_print_area_groups_json: '["front"]',
      shopify_design_placement: "Front",
      print_provider_id: 30,
      auto_publish_enabled: 1,
      automation_shopify_sync_enabled: 0,
      automation_amazon_publish_enabled: 0,
      automation_social_json: null,
    };
    const studio = patRowToStudioConfig(pat);
    expect(studio.shopify_design_placement).toBe("Front");
    expect(studio.print_provider_id).toBe(30);
    const auto = patRowToAutoPublishConfig(pat);
    expect(auto.auto_publish_enabled).toBe(true);
  });
});

describe("mirror drift status shape", () => {
  it("returns drift array from mock env", async () => {
    const makeDb = () => ({
      prepare: (sql) => {
        const handler = {
          bind: (...args) => handler,
          all: async () => {
            if (sql.includes("FROM eazpire_products") && !sql.includes("COUNT")) {
              return { results: [{ product_key: "test-tee", title: "Test", catalog_status: "online", updated_at: 1 }] };
            }
            return { results: [] };
          },
          first: async () => {
            if (sql.includes("COUNT(*)") && sql.includes("eazpire_product_versions")) return { c: 1 };
            if (sql.includes("COUNT(*)") && sql.includes("print_area_printify_templates")) return { c: 1 };
            if (sql.includes("FROM product_catalog")) {
              return { title: "Test", is_active: 2, updated_at: 1 };
            }
            return null;
          },
        };
        return handler;
      },
    });
    const { getCatalogMirrorDriftStatus } = await import(
      "../../src/features/manufacturers/partnerCatalog/mirrorToCatalogDb.js"
    );
    const status = await getCatalogMirrorDriftStatus({
      MANUFACTURER_DB: makeDb(),
      CATALOG_DB: makeDb(),
    });
    expect(status.ok).toBe(true);
    expect(status.total).toBe(1);
    expect(status.in_sync).toBe(1);
  });
});
