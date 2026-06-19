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
import { runFullPrintifyPartnerSetup } from "../../src/features/manufacturers/partnerCatalog/partnerCatalogOps.js";
import { fetchAllPrintProviders } from "../../src/features/manufacturers/adapters/printify/printifyCatalogClient.js";

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
    "admin-eazpire-catalog-mirror-status-v2",
    "admin-eazpire-product-editor-bundle",
    "admin-eazpire-product-meta-save",
    "admin-eazpire-product-providers-bundle",
    "admin-eazpire-product-providers-save",
    "admin-eazpire-product-version-create",
    "admin-eazpire-product-version-delete",
    "admin-eazpire-product-version-config-save",
    "admin-eazpire-print-area-bundle",
    "admin-eazpire-print-area-snapshot-save",
    "admin-eazpire-variants-bundle",
    "admin-eazpire-variants-save",
    "admin-eazpire-template-bundle",
    "admin-eazpire-template-save",
    "admin-eazpire-mockups-bundle",
    "admin-eazpire-mockups-save",
    "admin-eazpire-automations-save",
    "admin-eazpire-published-bundle",
    "admin-eazpire-published-update",
    "admin-eazpire-published-delete",
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

describe("printify catalog client errors", () => {
  it("returns structured error when API key missing", async () => {
    const result = await fetchAllPrintProviders({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("printify_api_key_not_configured");
  });

  it("returns structured error on Printify 401 (no throw)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
    try {
      const result = await fetchAllPrintProviders({ PRINTIFY_API_KEY: "test-key" });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("printify_unauthorized");
      expect(result.status).toBe(401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runFullPrintifyPartnerSetup prechecks", () => {
  it("returns catalog_db_unavailable without CATALOG_DB", async () => {
    const result = await runFullPrintifyPartnerSetup({ MANUFACTURER_DB: { prepare: () => ({}) } });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("catalog_db_unavailable");
    expect(result.hint).toContain("CATALOG_DB");
  });

  it("returns printify_api_key_not_configured when key missing", async () => {
    const result = await runFullPrintifyPartnerSetup({ MANUFACTURER_DB: {}, CATALOG_DB: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("printify_api_key_not_configured");
    expect(result.hint).toContain("eazpire-partner-portals");
  });
});

describe("shadow catalog ops exports", () => {
  it("exports shadow import/mirror and drift v2 helpers", async () => {
    const ops = await import("../../src/features/manufacturers/partnerCatalog/partnerCatalogOps.js");
    expect(typeof ops.importShadowTablesForProduct).toBe("function");
    expect(typeof ops.importShadowTablesFromCatalogDb).toBe("function");
    expect(typeof ops.mirrorShadowTablesForProduct).toBe("function");
    expect(typeof ops.mirrorShadowTablesToCatalogDb).toBe("function");
    expect(typeof ops.getCatalogDriftV2ForProduct).toBe("function");
    expect(typeof ops.getCatalogDriftV2Status).toBe("function");
  });
});

describe("catalog_pat_id backfill on PAT insert", () => {
  it("writes catalog_pat_id from last_row_id after PAT INSERT", async () => {
    const updates = [];
    const mfgDb = {
      prepare: (sql) => {
        const handler = {
          bind: (...args) => {
            handler._args = args;
            return handler;
          },
          first: async () => ({
            product_key: "test-tee",
            title: "Test Tee",
            regions_json: "[]",
            catalog_status: "online",
            visible_design_types_json: null,
            catalog_category_group: null,
            catalog_category_leaf: null,
            catalog_audience_json: null,
            catalog_production_type: null,
            print_area_edit_use_mocks: 0,
          }),
          all: async () => ({
            results: [
              {
                id: "epv_test",
                product_key: "test-tee",
                display_name: "Default",
                description: null,
                sort_order: 0,
                studio_config_json: "{}",
                auto_publish_config_json: "{}",
                external_template_product_id: "tpl-1",
                product_version_config_json: null,
                qr_logo_snapshot_json: null,
                is_active: 1,
                publish_enabled: 1,
                catalog_pat_id: null,
                external_provider_id: "30",
              },
            ],
          }),
          run: async () => {
            if (sql.includes("UPDATE eazpire_product_versions SET catalog_pat_id")) {
              updates.push({ patId: handler._args[0], versionId: handler._args[2] });
            }
            return { meta: { changes: 1 } };
          },
        };
        return handler;
      },
    };
    const catalogDb = {
      prepare: (sql) => {
        const handler = {
          bind: () => handler,
          first: async () => null,
          run: async () => {
            if (sql.includes("INSERT INTO print_area_printify_templates")) {
              return { meta: { last_row_id: 42 } };
            }
            if (sql.includes("INSERT INTO product_catalog")) {
              return { meta: { last_row_id: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
        return handler;
      },
    };

    const { mirrorEazpireProductToCatalogDb } = await import(
      "../../src/features/manufacturers/partnerCatalog/mirrorToCatalogDb.js"
    );
    const result = await mirrorEazpireProductToCatalogDb(
      { MANUFACTURER_DB: mfgDb, CATALOG_DB: catalogDb },
      "test-tee"
    );

    expect(result.ok).toBe(true);
    expect(updates).toEqual([{ patId: 42, versionId: "epv_test" }]);
  });
});

describe("shadow import counts shape", () => {
  it("returns per-table counts for a product", async () => {
    const empty = { results: [] };
    const catalogDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => empty,
        }),
      }),
    };
    const mfgDb = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 0 } }),
          all: async () => empty,
        }),
      }),
    };

    const { importShadowTablesForProduct } = await import(
      "../../src/features/manufacturers/partnerCatalog/shadow/shadowImportFromCatalogDb.js"
    );
    const result = await importShadowTablesForProduct(
      { MANUFACTURER_DB: mfgDb, CATALOG_DB: catalogDb },
      "test-tee"
    );

    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({
      publish_profiles: 0,
      publish_plans: 0,
      active_providers: 0,
      mockup_defaults: 0,
      variant_config: 0,
    });
  });
});

describe("product editor service exports", () => {
  it("exports bundle and save handlers", async () => {
    const svc = await import("../../src/features/manufacturers/partnerCatalog/editor/productEditorService.js");
    expect(typeof svc.getProductEditorBundle).toBe("function");
    expect(typeof svc.saveProductMeta).toBe("function");
    expect(typeof svc.getPublishedBundle).toBe("function");
    expect(typeof svc.createProductVersion).toBe("function");
    expect(typeof svc.deleteProductVersion).toBe("function");
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
