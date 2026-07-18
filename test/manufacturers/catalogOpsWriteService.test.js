import { describe, expect, it } from "vitest";
import {
  isCatalogOpsMasterWrite,
  shouldUseCatalogOps,
} from "../../src/features/manufacturers/partnerCatalog/catalogOpsConfig.js";
import {
  resolvePatIdFromVersionId,
  setCatalogProductStatus,
  updateCatalogProductMeta,
  saveCatalogProviders,
  saveCatalogMockups,
  saveCatalogVersionConfig,
} from "../../src/features/manufacturers/partnerCatalog/catalogOpsWriteService.js";
import { mirrorEazpireProductToCatalogDb } from "../../src/features/manufacturers/partnerCatalog/mirrorToCatalogDb.js";
import {
  saveProductMeta,
  saveProviders,
} from "../../src/features/manufacturers/partnerCatalog/editor/productEditorService.js";
import { setCatalogStudioProductStatus } from "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js";

function makeWritableCatalogDb() {
  const state = {
    product: {
      product_key: "test-tee",
      title: "Test Tee",
      is_active: 2,
      regions_json: "[]",
      updated_at: 1,
    },
    activeProviders: [],
    patRows: [{ id: 10, product_key: "test-tee", print_provider_id: 26, display_name: "Standard" }],
    updates: [],
    inserts: [],
    deletes: [],
  };

  return {
    _state: state,
    prepare: (sql) => {
      const handler = {
        _args: [],
        bind: (...args) => {
          handler._args = args;
          return handler;
        },
        first: async () => {
          if (sql.includes("FROM product_catalog WHERE")) return state.product;
          if (sql.includes("FROM print_area_printify_templates WHERE id")) {
            const id = handler._args[0];
            return state.patRows.find((p) => p.id === id) || null;
          }
          if (sql.includes("FROM print_area_printify_templates") && sql.includes("print_provider_id")) {
            return state.patRows.find((p) => String(p.print_provider_id) === String(handler._args[1])) || null;
          }
          if (sql.includes("FROM product_publish_profiles")) return null;
          if (sql.includes("FROM product_publish_map")) return null;
          if (sql.includes("blueprint_id")) return null;
          return null;
        },
        all: async () => {
          if (sql.includes("product_active_print_providers")) return { results: state.activeProviders };
          if (sql.includes("print_area_printify_templates")) return { results: state.patRows };
          return { results: [] };
        },
        run: async () => {
          if (sql.includes("UPDATE product_catalog")) {
            state.updates.push({ sql, args: handler._args });
            if (sql.includes("print_area_edit_use_mocks")) {
              state.product.print_area_edit_use_mocks = handler._args[0];
              state.product.updated_at = handler._args[1];
            } else if (handler._args.length >= 3) {
              state.product.is_active = handler._args[0];
              state.product.updated_at = handler._args[1];
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM product_active_print_providers")) {
            state.deletes.push({ sql, args: handler._args });
            state.activeProviders = [];
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO product_active_print_providers")) {
            state.inserts.push({ sql, args: handler._args });
            state.activeProviders.push({ print_provider_id: handler._args[1] });
            return { meta: { changes: 1, last_row_id: state.activeProviders.length } };
          }
          if (sql.includes("INSERT INTO print_area_printify_templates")) {
            const newId = state.patRows.length + 10;
            state.patRows.push({
              id: newId,
              product_key: handler._args[0],
              print_provider_id: handler._args[1],
              display_name: handler._args[2],
            });
            return { meta: { changes: 1, last_row_id: newId } };
          }
          if (sql.includes("UPDATE print_area_printify_templates")) {
            state.updates.push({ sql, args: handler._args });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO product_publish_profiles")) {
            return { meta: { changes: 1, last_row_id: 99 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return handler;
    },
  };
}

describe("catalogOpsConfig write flags", () => {
  it("isCatalogOpsMasterWrite accepts common truthy values", () => {
    expect(isCatalogOpsMasterWrite({ CATALOG_OPS_MASTER_WRITE: "1" })).toBe(true);
    expect(isCatalogOpsMasterWrite({ CATALOG_OPS_MASTER_WRITE: "true" })).toBe(true);
    expect(isCatalogOpsMasterWrite({})).toBe(false);
  });

  it("shouldUseCatalogOps is true when read or write flag is on", () => {
    expect(shouldUseCatalogOps({ CATALOG_OPS_MASTER_READ: "1" })).toBe(true);
    expect(shouldUseCatalogOps({ CATALOG_OPS_MASTER_WRITE: "1" })).toBe(true);
    expect(shouldUseCatalogOps({})).toBe(false);
  });
});

describe("catalogOpsWriteService", () => {
  it("resolvePatIdFromVersionId parses pat-{id} format", async () => {
    const env = { CATALOG_DB: makeWritableCatalogDb() };
    expect(await resolvePatIdFromVersionId(env, "pat-10", "test-tee")).toBe(10);
  });

  it("setCatalogProductStatus updates is_active on product_catalog", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await setCatalogProductStatus(env, "test-tee", "offline");
    expect(result.ok).toBe(true);
    expect(result.is_active).toBe(0);
    expect(catalogDb._state.product.is_active).toBe(0);
  });

  it("updateCatalogProductMeta writes product_catalog fields", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = { CATALOG_DB: catalogDb, MANUFACTURER_DB: null };
    const result = await updateCatalogProductMeta(env, "test-tee", { title: "New Title", catalog_status: "preview" });
    expect(result.ok).toBe(true);
    expect(catalogDb._state.updates.some((u) => u.sql.includes("UPDATE product_catalog"))).toBe(true);
  });

  it("saveCatalogProviders replaces active providers and creates PAT for new provider", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = { CATALOG_DB: catalogDb, MANUFACTURER_DB: null };
    const result = await saveCatalogProviders(env, "test-tee", { active_print_provider_ids: [26, 99] });
    expect(result.ok).toBe(true);
    expect(catalogDb._state.activeProviders.map((p) => p.print_provider_id)).toEqual([26, 99]);
    expect(catalogDb._state.patRows.some((p) => p.print_provider_id === 99)).toBe(true);
  });

  it("saveCatalogMockups persists print_area_edit_use_mocks on product_catalog", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = { CATALOG_DB: catalogDb, MANUFACTURER_DB: null };
    const result = await saveCatalogMockups(env, "test-tee", { print_area_edit_use_mocks: false });
    expect(result.ok).toBe(true);
    expect(catalogDb._state.product.print_area_edit_use_mocks).toBe(0);
    expect(
      catalogDb._state.updates.some(
        (u) => u.sql.includes("print_area_edit_use_mocks") && u.args[0] === 0
      )
    ).toBe(true);
  });

  it("saveCatalogVersionConfig writes catalog_status to product_catalog", async () => {
    const catalogDb = makeWritableCatalogDb();
    catalogDb._state.patRows[0].product_version_config_json = JSON.stringify({ catalog_status: "online" });
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await saveCatalogVersionConfig(env, "pat-10", {
      product_version_config: { catalog_status: "offline", design_types: ["classic"] },
    });
    expect(result.ok).toBe(true);
    expect(catalogDb._state.product.is_active).toBe(0);
  });

  it("mirrorEazpireProductToCatalogDb skips when catalog-db is master", async () => {
    const result = await mirrorEazpireProductToCatalogDb(
      { CATALOG_OPS_MASTER_WRITE: "1", MANUFACTURER_DB: {}, CATALOG_DB: {} },
      "test-tee"
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe("productEditorService write routing", () => {
  it("saveProductMeta delegates to catalog write service when write flag on", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await saveProductMeta(env, "test-tee", { title: "Updated", catalog_status: "online" });
    expect(result.ok).toBe(true);
    expect(result._ops_source).toBe("catalog-db");
    expect(catalogDb._state.updates.length).toBeGreaterThan(0);
  });

  it("saveProviders delegates to catalog write service when write flag on", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await saveProviders(env, "test-tee", { active_print_provider_ids: [26] });
    expect(result.ok).toBe(true);
    expect(result._ops_source).toBe("catalog-db");
  });

  it("saveProductMeta succeeds without MANUFACTURER_DB when write flag on (no mirror)", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await saveProductMeta(env, "test-tee", { title: "X", auto_mirror: true });
    expect(result.ok).toBe(true);
    expect(result._ops_source).toBe("catalog-db");
  });
});

describe("setCatalogStudioProductStatus write path", () => {
  it("updates catalog-db directly when write flag on", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await setCatalogStudioProductStatus(env, { productKey: "test-tee", catalogStatus: "offline" });
    expect(result.ok).toBe(true);
    expect(result.is_active).toBe(0);
    expect(catalogDb._state.product.is_active).toBe(0);
  });

  it("writes product_catalog even without CATALOG_OPS_MASTER_WRITE flag", async () => {
    const catalogDb = makeWritableCatalogDb();
    const env = {
      CATALOG_DB: catalogDb,
      MANUFACTURER_DB: null,
    };
    const result = await setCatalogStudioProductStatus(env, { productKey: "test-tee", catalogStatus: "preview" });
    expect(result.ok).toBe(true);
    expect(result.is_active).toBe(1);
    expect(catalogDb._state.product.is_active).toBe(1);
  });
});
