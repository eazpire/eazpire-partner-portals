import { describe, expect, it } from "vitest";
import { isCatalogOpsMasterRead, isCatalogOpsMasterWrite, shouldUseCatalogOps } from "../../src/features/manufacturers/partnerCatalog/catalogOpsConfig.js";
import {
  getCatalogOpsProduct,
  getCatalogOpsEditorBundle,
  getCatalogOpsVariantsBundle,
  getCatalogOpsPrintAreaBundle,
  getCatalogOpsTemplateRow,
  listCatalogOpsProductVersions,
  enrichMockupDefaultRow,
} from "../../src/features/manufacturers/partnerCatalog/catalogOpsReadService.js";
import { runCatalogOpsReconcile } from "../../src/features/manufacturers/partnerCatalog/catalogOpsReconcileService.js";
import {
  getProductEditorBundle,
  getVariantsBundle,
  getPrintAreaBundle,
  getProviderCatalogDetail,
} from "../../src/features/manufacturers/partnerCatalog/editor/productEditorService.js";

function makeCatalogDb(rows = {}) {
  const {
    product = {
      product_key: "test-tee",
      title: "Test Tee",
      is_active: 2,
      regions_json: "[]",
      created_at: 1,
      updated_at: 2,
    },
    activeProviders = [{ print_provider_id: 26 }],
    patRows = [
      {
        id: 10,
        product_key: "test-tee",
        print_provider_id: 26,
        display_name: "Standard",
        sort_order: 0,
        is_active: 1,
        publish_enabled: 1,
        printify_product_id: "12345",
      },
    ],
    publishProfiles = [{ id: "pp1", print_provider_id: 26, title: "Profile" }],
    publishPlans = [{ id: "plan1", publish_profile_id: "pp1" }],
    variantConfig = null,
    templateRow = { product_key: "test-tee", print_provider_id: 26, printify_product_id: "12345" },
    variantPrintAreas = [],
    mockupDefaults = [],
  } = rows;

  return {
    prepare: (sql) => {
      const handler = {
        _args: [],
        bind: (...args) => {
          handler._args = args;
          return handler;
        },
        first: async () => {
          if (sql.includes("FROM product_catalog WHERE")) return product;
          if (sql.includes("COUNT(*)")) {
            if (sql.includes("print_area_printify_templates")) return { c: patRows.length };
            if (sql.includes("product_publish_profiles")) return { c: publishProfiles.length };
            if (sql.includes("product_publish_map")) return { c: publishPlans.length };
          }
          if (sql.includes("FROM product_publish_profiles") && sql.includes("blueprint_id")) return { blueprint_id: 145 };
          if (sql.includes("FROM product_variant_config")) return variantConfig;
          if (sql.includes("FROM product_publish_profiles WHERE product_key = ? AND print_provider_id")) {
            return publishProfiles.find((p) => p.print_provider_id === handler._args[1]) || publishProfiles[0] || null;
          }
          if (sql.includes("FROM template_products")) return templateRow;
          if (sql.includes("FROM print_area_printify_templates") && sql.includes("LIMIT 1")) {
            return patRows.find((p) => String(p.print_provider_id) === String(handler._args[1])) || patRows[0] || null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes("product_active_print_providers")) return { results: activeProviders };
          if (sql.includes("print_area_printify_templates")) return { results: patRows };
          if (sql.includes("product_publish_profiles")) return { results: publishProfiles };
          if (sql.includes("product_publish_map")) return { results: publishPlans };
          if (sql.includes("product_variant_print_areas")) return { results: variantPrintAreas };
          if (sql.includes("product_mockup_defaults")) return { results: mockupDefaults };
          if (sql.includes("FROM product_catalog WHERE is_active")) return { results: [product] };
          return { results: [] };
        },
      };
      return handler;
    },
  };
}

function makeManufacturerDb(rows = {}) {
  const {
    product = {
      product_key: "test-tee",
      title: "Test Tee",
      catalog_status: "online",
      manufacturer_id: "mfr_1",
      source_blueprint_id: "eb_1",
    },
    activeProviders = [{ print_provider_id: 26 }],
    patCount = 1,
    publishProfileCount = 1,
    publishPlanCount = 1,
  } = rows;

  return {
    prepare: (sql) => {
      const handler = {
        _args: [],
        bind: (...args) => {
          handler._args = args;
          return handler;
        },
        first: async () => {
          if (sql.includes("FROM eazpire_products WHERE")) return product;
          if (sql.includes("COUNT(*)")) {
            if (sql.includes("eazpire_product_versions")) return { c: patCount };
            if (sql.includes("eazpire_product_publish_profiles")) return { c: publishProfileCount };
            if (sql.includes("eazpire_product_publish_plans")) return { c: publishPlanCount };
          }
          return null;
        },
        all: async () => {
          if (sql.includes("eazpire_product_active_providers")) return { results: activeProviders };
          if (sql.includes("eazpire_product_versions")) return { results: [] };
          return { results: [] };
        },
        run: async () => {
          if (sql.includes("UPDATE eazpire_products SET catalog_status")) {
            product.catalog_status = handler._args[0];
          }
          return { success: true };
        },
      };
      return handler;
    },
  };
}

describe("catalogOpsConfig", () => {
  it("isCatalogOpsMasterRead accepts common truthy values", () => {
    expect(isCatalogOpsMasterRead({ CATALOG_OPS_MASTER_READ: "1" })).toBe(true);
    expect(isCatalogOpsMasterRead({ CATALOG_OPS_MASTER_READ: "true" })).toBe(true);
    expect(isCatalogOpsMasterRead({ CATALOG_OPS_MASTER_READ: 1 })).toBe(true);
    expect(isCatalogOpsMasterRead({})).toBe(false);
    expect(isCatalogOpsMasterRead({ CATALOG_OPS_MASTER_READ: "0" })).toBe(false);
  });

  it("shouldUseCatalogOps is true when write flag alone is set", () => {
    expect(shouldUseCatalogOps({ CATALOG_OPS_MASTER_WRITE: "1" })).toBe(true);
    expect(isCatalogOpsMasterWrite({ CATALOG_OPS_MASTER_WRITE: "yes" })).toBe(true);
  });
});

describe("catalogOpsReadService", () => {
  it("getCatalogOpsProduct returns catalog row with ops source", async () => {
    const env = { CATALOG_DB: makeCatalogDb(), MANUFACTURER_DB: makeManufacturerDb() };
    const result = await getCatalogOpsProduct(env, "test-tee");
    expect(result.ok).toBe(true);
    expect(result.product._ops_source).toBe("catalog-db");
    expect(result.product.catalog_status).toBe("online");
  });

  it("reads visibility only from product_catalog.is_active (ignores eazpire online)", async () => {
    const env = {
      CATALOG_DB: makeCatalogDb({
        product: {
          product_key: "test-tee",
          title: "Test Tee",
          is_active: 1,
          regions_json: "[]",
          created_at: 1,
          updated_at: 2,
        },
      }),
      MANUFACTURER_DB: makeManufacturerDb({
        product: {
          product_key: "test-tee",
          title: "Test Tee",
          catalog_status: "online",
          manufacturer_id: "mfr_1",
          source_blueprint_id: "eb_1",
        },
      }),
    };
    const result = await getCatalogOpsProduct(env, "test-tee");
    expect(result.ok).toBe(true);
    expect(result.product.catalog_status).toBe("preview");
    expect(result.product.is_active).toBe(1);
  });

  it("getCatalogOpsEditorBundle loads versions and providers from catalog-db", async () => {
    const env = { CATALOG_DB: makeCatalogDb(), MANUFACTURER_DB: makeManufacturerDb() };
    const result = await getCatalogOpsEditorBundle(env, "test-tee");
    expect(result.ok).toBe(true);
    expect(result.versions.length).toBeGreaterThan(0);
    expect(result.versions[0]._ops_source).toBe("catalog-db");
  });

  it("listCatalogOpsProductVersions maps PAT rows", async () => {
    const env = { CATALOG_DB: makeCatalogDb(), MANUFACTURER_DB: makeManufacturerDb() };
    const versions = await listCatalogOpsProductVersions(env, "test-tee");
    expect(versions).toHaveLength(1);
    expect(versions[0].external_provider_id).toBe("26");
  });

  it("getCatalogOpsTemplateRow reads template_products", async () => {
    const env = { CATALOG_DB: makeCatalogDb() };
    const row = await getCatalogOpsTemplateRow(env, "test-tee", 26);
    expect(row?.printify_product_id).toBe("12345");
  });

  it("getCatalogOpsVariantsBundle returns profile and template", async () => {
    const env = { CATALOG_DB: makeCatalogDb(), MANUFACTURER_DB: makeManufacturerDb() };
    const result = await getCatalogOpsVariantsBundle(env, "test-tee", 26);
    expect(result.ok).toBe(true);
    expect(result.template?.print_provider_id).toBe(26);
    expect(result._ops_source).toBe("catalog-db");
  });

  it("getCatalogOpsPrintAreaBundle returns versions from catalog-db", async () => {
    const env = { CATALOG_DB: makeCatalogDb(), MANUFACTURER_DB: makeManufacturerDb() };
    const result = await getCatalogOpsPrintAreaBundle(env, "test-tee", { printProviderId: 26 });
    expect(result.ok).toBe(true);
    expect(result.versions.length).toBeGreaterThan(0);
  });

  it("enrichMockupDefaultRow adds print_area_template_url from catalog-db keys", () => {
    const row = enrichMockupDefaultRow(
      {
        print_area_key: "back",
        print_area_template_r2_key: "print-area/test-tee/back.png",
        template_r2_key: "mockups/test-tee/back-white.png",
      },
      "https://creator-engine.eazpire.workers.dev"
    );
    expect(row.print_area_template_url).toBe(
      "https://creator-engine.eazpire.workers.dev/mockup/print-area/test-tee/back.png"
    );
    expect(row.template_url).toBe("https://creator-engine.eazpire.workers.dev/mockup/mockups/test-tee/back-white.png");
    expect(row.has_print_area_in_image).toBe(true);
  });
});

describe("productEditorService catalog read path", () => {
  it("routes bundle loaders through catalog-db when flag is on", async () => {
    const env = {
      CATALOG_OPS_MASTER_READ: "1",
      CATALOG_DB: makeCatalogDb(),
      MANUFACTURER_DB: makeManufacturerDb(),
    };

    const editor = await getProductEditorBundle(env, "test-tee");
    expect(editor.ok).toBe(true);
    expect(editor.product._ops_source).toBe("catalog-db");

    const variants = await getVariantsBundle(env, "test-tee", 26);
    expect(variants.ok).toBe(true);

    const printArea = await getPrintAreaBundle(env, "test-tee", { printProviderId: 26 });
    expect(printArea.ok).toBe(true);

    const detail = await getProviderCatalogDetail(env, "test-tee", 26);
    expect(detail.ok).toBe(true);
    expect(detail.versions.length).toBeGreaterThan(0);
  });
});

describe("runCatalogOpsReconcile", () => {
  it("returns aligned report when catalog and manufacturer match", async () => {
    const env = {
      CATALOG_DB: makeCatalogDb(),
      MANUFACTURER_DB: makeManufacturerDb(),
    };
    const report = await runCatalogOpsReconcile(env);
    expect(report.ok).toBe(true);
    expect(report.summary.total_online_products).toBe(1);
    expect(report.summary.sync_ok).toBe(1);
    expect(report.summary.sync_conflicts).toBe(0);
    expect(report.products[0].sync_ok).toBe(true);
  });

  it("flags drift when active providers differ", async () => {
    const env = {
      CATALOG_DB: makeCatalogDb({ activeProviders: [{ print_provider_id: 26 }, { print_provider_id: 99 }] }),
      MANUFACTURER_DB: makeManufacturerDb({ activeProviders: [{ print_provider_id: 26 }] }),
    };
    const report = await runCatalogOpsReconcile(env);
    expect(report.ok).toBe(true);
    expect(report.summary.sync_conflicts).toBe(1);
    expect(report.products[0].issues.some((i) => i.type === "active_providers_mismatch")).toBe(true);
  });

  it("requires both D1 bindings", async () => {
    expect((await runCatalogOpsReconcile({ MANUFACTURER_DB: {} })).error).toBe("catalog_db_unavailable");
    expect((await runCatalogOpsReconcile({ CATALOG_DB: {} })).error).toBe("manufacturer_db_unavailable");
  });
});
