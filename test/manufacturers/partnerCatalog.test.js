import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    "admin-catalog-studio-tree",
    "admin-catalog-studio-products",
    "admin-catalog-studio-set-status",
    "admin-catalog-studio-set-printify-choice",
    "admin-catalog-studio-remove-product",
    "admin-catalog-ops-reconcile",
    "admin-eazpire-product-editor-bundle",
    "admin-eazpire-product-meta-save",
    "admin-eazpire-product-providers-bundle",
    "admin-eazpire-product-providers-save",
    "admin-eazpire-provider-catalog-detail",
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
    "admin-eazpire-product-readiness",
    "admin-eazpire-resolve-countries",
    "admin-eazpire-load-printify-settings",
    "admin-eazpire-print-area-rect-save",
    "admin-eazpire-print-areas-config-save",
    "admin-eazpire-variants-refresh-from-template",
    "admin-eazpire-template-create-draft",
    "admin-eazpire-template-remove-draft",
    "admin-eazpire-template-section-id-save",
    "admin-eazpire-fetch-printify-mockups",
    "admin-eazpire-print-area-image-upload",
    "admin-eazpire-print-area-image-clear",
    "admin-eazpire-variant-print-area-rect-save",
    "admin-eazpire-published-update-all",
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

describe("getCatalogStudioTree", () => {
  it("maps DB providers with ship country fields", async () => {
    const { getCatalogStudioTree } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const db = {
      prepare: (sql) => {
        const handler = {
          bind: () => handler,
          all: async () => {
            if (sql.includes("FROM manufacturers m")) {
              return {
                results: [
                  {
                    id: "mfg_other",
                    name: "Other Partner",
                    slug: "other",
                    integration_type: "manual",
                    fulfillment_provider_count: 1,
                    live_blueprint_count: 0,
                    eazpire_product_count: 0,
                  },
                ],
              };
            }
            if (sql.includes("manufacturer_fulfillment_providers")) {
              return {
                results: [
                  {
                    id: "fp_1",
                    manufacturer_id: "mfg_other",
                    external_provider_id: "42",
                    name: "Test Provider",
                    location_json: '{"country":"DE","city":"Berlin"}',
                    ships_to_json: "[]",
                    status: "active",
                  },
                ],
              };
            }
            return { results: [] };
          },
          first: async () => null,
          run: async () => ({}),
        };
        return handler;
      },
    };
    const result = await getCatalogStudioTree(db, {});
    expect(result.ok).toBe(true);
    expect(result.partners).toHaveLength(1);
    expect(result.partners[0].providers[0].ship_country_code).toBe("DE");
    expect(result.partners[0].providers[0].ship_country_name).toBe("Germany");
  }, 120000);

  it("returns all Printify catalog providers from API", async () => {
    const { getCatalogStudioTree } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          { id: 30, title: "Provider A", location: { country: "US", city: "Charlotte" } },
          { id: 31, title: "Provider B", location: { country: "Germany", city: "Berlin" } },
        ]),
        { status: 200 }
      );
    try {
      const db = {
        prepare: (sql) => {
          const handler = {
            bind: () => handler,
            all: async () => {
              if (sql.includes("FROM manufacturers m")) {
                return {
                  results: [
                    {
                      id: "mfg_printify",
                      name: "Printify",
                      slug: "printify",
                      integration_type: "api",
                      fulfillment_provider_count: 1,
                      live_blueprint_count: 0,
                      eazpire_product_count: 0,
                    },
                  ],
                };
              }
              if (sql.includes("manufacturer_fulfillment_providers")) {
                return {
                  results: [
                    {
                      id: "fp_db",
                      manufacturer_id: "mfg_printify",
                      external_provider_id: "30",
                      name: "DB Name",
                      location_json: "{}",
                      ships_to_json: "[]",
                      status: "active",
                    },
                  ],
                };
              }
              return { results: [] };
            },
            first: async () => null,
            run: async () => ({}),
          };
          return handler;
        },
      };
      const result = await getCatalogStudioTree(db, { PRINTIFY_API_KEY: "test-key" });
      expect(result.ok).toBe(true);
      expect(result.partners[0].provider_count).toBe(2);
      expect(result.partners[0].providers).toHaveLength(2);
      const ids = result.partners[0].providers.map((p) => p.external_provider_id).sort();
      expect(ids).toEqual(["30", "31"]);
      const merged = result.partners[0].providers.find((p) => p.external_provider_id === "30");
      expect(merged.id).toBe("fp_db");
      expect(merged.status).toBe("active");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60000);
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
  }, 60000);
});

describe("catalog studio service", () => {
  it("exports status and remove handlers", async () => {
    const svc = await import("../../src/features/manufacturers/partnerCatalog/catalogStudioService.js");
    expect(typeof svc.setCatalogStudioProductStatus).toBe("function");
    expect(typeof svc.removeCatalogStudioProduct).toBe("function");
    expect(typeof svc.formatPrintAreaLabel).toBe("function");
  }, 60000);

  it("rejects invalid catalog status", async () => {
    const { setCatalogStudioProductStatus } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const result = await setCatalogStudioProductStatus({}, { productKey: "x", catalogStatus: "bogus" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_catalog_status");
  }, 60000);

  it("removes product from manufacturer and catalog dbs", async () => {
    const deleted = [];
    const mfgDb = {
      prepare: (sql) => {
        const handler = {
          bind: (...args) => {
            handler._args = args;
            return handler;
          },
          first: async () => {
            if (sql.includes("FROM eazpire_products WHERE")) {
              return { product_key: "test-tee", source_blueprint_id: "eb_1" };
            }
            return null;
          },
          run: async () => {
            if (sql.startsWith("DELETE FROM")) deleted.push({ db: "mfg", sql, key: handler._args[0] });
            return { meta: { changes: 1 } };
          },
        };
        return handler;
      },
    };
    const catalogDb = {
      prepare: (sql) => {
        const handler = {
          bind: (...args) => {
            handler._args = args;
            return handler;
          },
          run: async () => {
            if (sql.startsWith("DELETE FROM")) deleted.push({ db: "catalog", sql, key: handler._args[0] });
            return { meta: { changes: 1 } };
          },
        };
        return handler;
      },
    };

    const { removeCatalogStudioProduct } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const result = await removeCatalogStudioProduct(
      { MANUFACTURER_DB: mfgDb, CATALOG_DB: catalogDb },
      { productKey: "test-tee" }
    );

    expect(result.ok).toBe(true);
    expect(result.source_blueprint_id).toBe("eb_1");
    expect(deleted.some((d) => d.db === "mfg" && d.sql.includes("eazpire_products"))).toBe(true);
    expect(deleted.some((d) => d.db === "catalog" && d.sql.includes("product_catalog"))).toBe(true);
  }, 60000);

  it("formats print area labels", async () => {
    const { formatPrintAreaLabel } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    expect(formatPrintAreaLabel("sleeve_left")).toBe("Sleeve Left");
  });

  it("returns category_tree for product list", async () => {
    const { getCatalogStudioProducts } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );

    const mfgDb = {
      prepare: (sql) => {
        const handler = {
          bind: (...args) => {
            handler._args = args;
            return handler;
          },
          first: async () => {
            if (sql.includes("FROM manufacturers WHERE")) return { country: "US" };
            if (sql.includes("getPartnerByIdOrSlug") || sql.includes("manufacturers WHERE id")) {
              return { id: "m1", slug: "other-partner" };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM eazpire_products")) {
              return {
                results: [
                  {
                    product_key: "tee-1",
                    title: "Classic Tee",
                    catalog_status: "online",
                    catalog_category_leaf: "T-Shirt",
                    catalog_category_group: "Kleidung",
                    version_count: 1,
                    manufacturer_name: "Test",
                    blueprint_title: "Tee",
                    blueprint_category: null,
                    updated_at: 1,
                  },
                ],
              };
            }
            if (sql.includes("eazpire_product_mockup")) return { results: [] };
            if (sql.includes("manufacturer_eazpire_blueprints")) return { results: [] };
            return { results: [] };
          },
        };
        return handler;
      },
    };

    const result = await getCatalogStudioProducts(
      mfgDb,
      {},
      { manufacturerId: "m1", filter: "online" }
    );

    expect(result.ok).toBe(true);
    expect(result.category_tree).toBeDefined();
    expect(Array.isArray(result.category_tree)).toBe(true);
    expect(result.items[0].category).toBe("T-Shirt");
    expect(result.items[0].parent_group).toBe("Kleidung");
  });

  it("extracts mock images and print areas from blueprint json", async () => {
    const {
      imagesFromBlueprintData,
      printAreasFromBlueprintData,
      blueprintSupportsProvider,
      mergeEnrichment,
    } = await import("../../src/features/manufacturers/partnerCatalog/catalogStudioService.js");

    const normalized = JSON.stringify({
      print_areas: [{ area_key: "front" }, { area_key: "back" }],
      mockup_views: [{ url: "https://example.com/mock-front.png" }],
    });
    const raw = JSON.stringify({
      images: ["https://example.com/catalog.png"],
      print_areas: [{ name: "neck" }],
    });

    expect(imagesFromBlueprintData(normalized, raw)).toEqual([
      "https://example.com/mock-front.png",
      "https://example.com/catalog.png",
    ]);
    expect(printAreasFromBlueprintData(normalized, null)).toEqual(["back", "front"]);
    expect(printAreasFromBlueprintData(null, raw)).toEqual(["neck"]);
    expect(blueprintSupportsProvider(JSON.stringify([{ id: 26 }, { id: 30 }]), "30")).toBe(true);
    expect(blueprintSupportsProvider(JSON.stringify([{ id: 26 }]), "30")).toBe(false);
    expect(blueprintSupportsProvider(JSON.stringify([{ id: 26 }]), null)).toBe(true);

    const merged = mergeEnrichment(
      { mock_images: ["https://a"], print_areas: ["front"] },
      { mock_images: ["https://b", "https://a"], print_areas: ["back", "front"] }
    );
    expect(merged.mock_images).toEqual(["https://a", "https://b"]);
    expect(merged.print_areas).toEqual(["back", "front"]);
  });

  it("detects All Over Print products from title", async () => {
    const { isAllOverPrintFromTitle } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );

    expect(isAllOverPrintFromTitle("Unisex All Over Print Hoodie")).toBe(true);
    expect(isAllOverPrintFromTitle("All-Over Print Leggings")).toBe(true);
    expect(isAllOverPrintFromTitle("Premium All Over Tee")).toBe(true);
    expect(isAllOverPrintFromTitle("Sublimation Mug (AOP)")).toBe(true);
    expect(isAllOverPrintFromTitle("Custom Tote — AOP")).toBe(true);
    expect(isAllOverPrintFromTitle("AOP")).toBe(true);

    expect(isAllOverPrintFromTitle("Unisex Tee")).toBe(false);
    expect(isAllOverPrintFromTitle("Classic Hoodie")).toBe(false);
    expect(isAllOverPrintFromTitle("Overall Fit Jacket")).toBe(false);
    expect(isAllOverPrintFromTitle("")).toBe(false);
  });

  it("loads available printify products from catalog without bulk raw_json enrichment", async () => {
    const catalogRows = [
      {
        id: 145,
        title: "Unisex Tee",
        category: "T-Shirts",
        audience: "Unisex",
        shipping_countries: "US,CA",
        images_json: '["https://catalog/mock.png"]',
        print_providers_json: '[{"id":26},{"id":30}]',
        print_provider_count: 2,
        print_areas_json: '["neck"]',
      },
    ];
    const catalogDb = {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => ({ results: [] }),
        }),
        all: async () => {
          if (sql.includes("FROM product_publish_profiles")) return { results: [] };
          if (sql.includes("FROM printify_blueprints")) return { results: catalogRows };
          return { results: [] };
        },
      }),
    };
    const mfgDb = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (sql.includes("FROM manufacturers WHERE id = ? OR slug = ?")) {
              return { id: "mfg_printify", slug: "printify", country: "CH" };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM eazpire_products ep")) return { results: [] };
            if (sql.includes("FROM manufacturer_provider_blueprints pb")) {
              return {
                results: [
                  {
                    external_blueprint_id: "145",
                    raw_json: JSON.stringify({
                      images: ["https://raw/mock.png"],
                      print_areas: [
                        { name: "front" },
                        { name: "back" },
                        { name: "sleeve_left", placeholders: [{ position: "sleeve_left" }] },
                      ],
                    }),
                    normalized_json: JSON.stringify({
                      print_areas: [{ area_key: "front" }, { area_key: "back" }],
                    }),
                  },
                ],
              };
            }
            return { results: [] };
          },
        }),
      }),
    };

    const { getCatalogStudioProducts } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const result = await getCatalogStudioProducts(mfgDb, { CATALOG_DB: catalogDb }, {
      manufacturerId: "mfg_printify",
      providerExternalId: "30",
      filter: "available",
    });

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].category).toBe("T-Shirt");
    expect(result.items[0].parent_group).toBe("Kleidung");
    expect(result.items[0].shipping_countries).toBe("CA, US");
    expect(result.items[0].shipping_country_codes).toEqual(["CA", "US"]);
    expect(result.items[0].mock_images).toContain("https://catalog/mock.png");
    expect(result.items[0].mock_images).not.toContain("https://raw/mock.png");
    expect(result.items[0].print_areas).toEqual(["back", "front", "neck"]);
  });

  it("resolves Printify Choice US vs World with US default when provider 99 present", async () => {
    const { resolvePrintifyChoiceTypeFromShippingData, resolvePrintifyChoiceType } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    expect(resolvePrintifyChoiceTypeFromShippingData({ profiles: [{ countries: ["US"] }] })).toBe("us");
    expect(
      resolvePrintifyChoiceTypeFromShippingData({
        profiles: [{ countries: ["US", "REST_OF_THE_WORLD", "CA"] }],
      })
    ).toBe("world");
    expect(
      resolvePrintifyChoiceType(
        JSON.stringify([{ id: 26 }, { id: 99, title: "Printify Choice", location: { country: "US" } }]),
        "world"
      )
    ).toBe("world");
    expect(
      resolvePrintifyChoiceType(
        JSON.stringify([{ id: 99, title: "Printify Choice", location: { country: "US" } }])
      )
    ).toBe("us");
    expect(
      resolvePrintifyChoiceType(
        JSON.stringify([{ id: 99, title: "Printify Choice", location: { country: "US" } }]),
        null
      )
    ).toBe("us");
    expect(resolvePrintifyChoiceType(JSON.stringify([{ id: 26 }]))).toBeNull();
  });

  it("persists manual Printify Choice override on printify_blueprints", async () => {
    const { setCatalogStudioPrintifyChoice } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const runs = [];
    const env = {
      CATALOG_DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                async first() {
                  if (sql.includes("SELECT id FROM")) return { id: args[0] };
                  return null;
                },
                async run() {
                  runs.push({ sql, args });
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    };
    const world = await setCatalogStudioPrintifyChoice(env, { blueprintId: 145, choiceType: "world" });
    expect(world.ok).toBe(true);
    expect(world.printify_choice).toBe("world");
    expect(runs.some((r) => r.args[0] === "world" && r.args[2] === 145)).toBe(true);

    const bad = await setCatalogStudioPrintifyChoice(env, { blueprintId: 145, choiceType: "global" });
    expect(bad.ok).toBe(false);
  });

  it("builds Printify catalog product URLs from blueprint id, brand, and title", async () => {
    const { buildPrintifyCatalogProductUrl } = await import(
      "../../src/features/manufacturers/adapters/printify/printifyCatalogClient.js"
    );
    expect(buildPrintifyCatalogProductUrl(145, "Gildan", "Unisex Softstyle T-Shirt")).toBe(
      "https://printify.com/app/products/145/gildan/unisex-softstyle-t-shirt"
    );
    expect(buildPrintifyCatalogProductUrl(896, "Generic brand", "Heart-Shaped Mug")).toBe(
      "https://printify.com/app/products/896/generic-brand/heart-shaped-mug"
    );
    expect(buildPrintifyCatalogProductUrl(null, "Gildan", "Shirt")).toBeNull();
  });

  it("normalizes technical catalog_category_leaf for category tree", async () => {
    const { resolveStudioCategory } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    expect(resolveStudioCategory({ catalog_category_leaf: "apparel.hoodie" })).toEqual({
      category: "Hoodie",
      parent_group: "Kleidung",
    });
    expect(resolveStudioCategory({ catalog_category_leaf: "home.mug" })).toEqual({
      category: "Mug",
      parent_group: "Drinkware",
    });
    expect(resolveStudioCategory({ category: "T-Shirts" })).toEqual({
      category: "T-Shirt",
      parent_group: "Kleidung",
    });
  });

  it("builds category tree for large available lists without throwing", async () => {
    const { getCatalogStudioProducts } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const catalogRows = Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1,
      title: `Product ${i}`,
      category: i % 2 === 0 ? "T-Shirts" : "Mugs",
      audience: "Unisex",
      shipping_countries: "US",
      images_json: '["https://example.com/img.png"]',
      print_providers_json: '[{"id":26}]',
      print_provider_count: 1,
    }));
    const catalogDb = {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("print_areas_json")) return { results: [] };
            return { results: [] };
          },
        }),
        all: async () => {
          if (sql.includes("FROM product_publish_profiles")) return { results: [] };
          if (sql.includes("FROM printify_blueprints")) return { results: catalogRows };
          return { results: [] };
        },
      }),
    };
    const mfgDb = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("FROM manufacturers WHERE id = ? OR slug = ?")) {
              return { id: "mfg_printify", slug: "printify" };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM eazpire_products ep")) return { results: [] };
            if (sql.includes("FROM manufacturer_provider_blueprints pb")) return { results: [] };
            return { results: [] };
          },
        }),
      }),
    };

    const result = await getCatalogStudioProducts(mfgDb, { CATALOG_DB: catalogDb }, {
      manufacturerId: "mfg_printify",
      filter: "available",
    });

    expect(result.ok).toBe(true);
    expect(result.total).toBe(1200);
    expect(result.category_tree.length).toBeGreaterThan(0);
  });

  it("filters available printify products by provider id", async () => {
    const catalogRows = [
      {
        id: 1,
        title: "Provider 26 only",
        category: "T-Shirts",
        audience: "Unisex",
        images_json: "[]",
        print_providers_json: '[{"id":26}]',
        print_provider_count: 1,
      },
      {
        id: 2,
        title: "Provider 30 only",
        category: "T-Shirts",
        audience: "Unisex",
        images_json: "[]",
        print_providers_json: '[{"id":30}]',
        print_provider_count: 1,
      },
    ];
    const catalogDb = {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("print_areas_json")) return { results: [] };
            if (sql.includes("FROM product_publish_profiles")) return { results: [] };
            return { results: [] };
          },
        }),
        all: async () => {
          if (sql.includes("FROM product_publish_profiles")) return { results: [] };
          if (sql.includes("FROM printify_blueprints")) return { results: catalogRows };
          return { results: [] };
        },
      }),
    };
    const mfgDb = {
      prepare: (sql) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("FROM manufacturers WHERE id = ? OR slug = ?")) {
              return { id: "mfg_printify", slug: "printify", country: "US" };
            }
            if (sql.includes("SELECT country FROM manufacturers WHERE id = ?")) {
              return { country: "US" };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM eazpire_products ep")) return { results: [] };
            if (sql.includes("FROM manufacturer_provider_blueprints pb")) return { results: [] };
            return { results: [] };
          },
        }),
      }),
    };

    const { getCatalogStudioProducts } = await import(
      "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js"
    );
    const result = await getCatalogStudioProducts(mfgDb, { CATALOG_DB: catalogDb }, {
      manufacturerId: "mfg_printify",
      providerExternalId: "30",
      filter: "available",
    });

    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.printify_blueprint_id)).toEqual([2]);
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

describe("getProviderCatalogDetail", () => {
  it("returns error without manufacturer db", async () => {
    const { getProviderCatalogDetail } = await import(
      "../../src/features/manufacturers/partnerCatalog/editor/productEditorService.js"
    );
    const result = await getProviderCatalogDetail({}, "test-product", 30);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("manufacturer_db_unavailable");
  });
});

describe("resolvePrintifyBlueprintId", () => {
  it("maps internal blueprint row id to Printify external id", async () => {
    const { resolvePrintifyBlueprintId } = await import(
      "../../src/features/manufacturers/partnerCatalog/editor/partnerEditorExtensions.js"
    );
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ external_blueprint_id: "145" }),
        }),
      }),
    };
    const id = await resolvePrintifyBlueprintId(db, "eb_internal_uuid");
    expect(id).toBe("145");
  });

  it("falls back to numeric source id when already Printify blueprint id", async () => {
    const { resolvePrintifyBlueprintId } = await import(
      "../../src/features/manufacturers/partnerCatalog/editor/partnerEditorExtensions.js"
    );
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
        }),
      }),
    };
    const id = await resolvePrintifyBlueprintId(db, "145");
    expect(id).toBe("145");
  });
});

describe("provider catalog location enrichment", () => {
  it("enriches blueprint-only provider rows with global catalog location", async () => {
    const { buildPrintProviderCatalogMap, enrichProviderRowWithCatalog } = await import(
      "../../src/features/manufacturers/partnerCatalog/editor/providerBundleService.js"
    );
    const map = buildPrintProviderCatalogMap([
      { id: 42, title: "Drive Fulfillment", location: { country: "US", city: "American Fork" } },
    ]);
    const row = enrichProviderRowWithCatalog(
      {
        type: "available",
        print_provider_id: 42,
        name: "Drive Fulfillment",
        catalogData: { id: 42, title: "Drive Fulfillment" },
      },
      map
    );
    expect(row.locationDetail?.country).toBe("US");
    expect(row.locationLabel).toContain("US");
    expect(row.region).toBe("US");
  });
});

describe("partner worker storage bindings", () => {
  it("wrangler-partner.toml binds MOCKUP_R2 for print area uploads", () => {
    const toml = readFileSync(resolve(process.cwd(), "wrangler-partner.toml"), "utf8");
    expect(toml).toMatch(/binding\s*=\s*"MOCKUP_R2"/);
    expect(toml).toMatch(/bucket_name\s*=\s*"product-mockups"/);
  });
});

describe("uploadPrintAreaTemplateImage", () => {
  it("returns storage_unavailable when MOCKUP_R2 is not bound", async () => {
    const { uploadPrintAreaTemplateImage } = await import(
      "../../src/features/manufacturers/partnerCatalog/editor/partnerEditorExtensions.js"
    );
    const request = new Request("https://admin.eazpire.com/partner?op=admin-eazpire-print-area-image-upload", {
      method: "POST",
      body: new FormData(),
    });
    const result = await uploadPrintAreaTemplateImage({}, request);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("storage_unavailable");
  });
});
