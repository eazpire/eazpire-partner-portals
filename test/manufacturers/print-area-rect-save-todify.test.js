import { describe, expect, it } from "vitest";
import { upsertCatalogMockupDefault } from "../../src/features/manufacturers/partnerCatalog/catalogOpsWriteService.js";
import { savePrintAreaRect } from "../../src/features/manufacturers/partnerCatalog/editor/partnerEditorExtensions.js";

/**
 * Minimal catalog-db mock: product_mockup_defaults rows start empty (Todify case).
 * Asserts INSERT includes template_r2_key (NOT NULL) and never binds NaN.
 */
function makeCatalogDbForMockupDefaults() {
  const state = { defaults: [], inserts: [], updates: [] };
  return {
    _state: state,
    prepare: (sql) => {
      const handler = {
        _args: [],
        bind: (...args) => {
          for (const a of args) {
            if (typeof a === "number" && !Number.isFinite(a)) {
              throw new Error(`D1_TYPE_ERROR: Type 'NaN' not supported`);
            }
            if (a === undefined) {
              throw new Error(`D1_TYPE_ERROR: Type 'undefined' not supported`);
            }
          }
          handler._args = args;
          return handler;
        },
        first: async () => {
          if (sql.includes("FROM product_mockup_defaults")) {
            const [productKey, printAreaKey] = handler._args;
            return (
              state.defaults.find(
                (r) => r.product_key === productKey && r.print_area_key === printAreaKey
              ) || null
            );
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes("INSERT INTO product_mockup_defaults")) {
            if (!sql.includes("template_r2_key")) {
              throw new Error("NOT NULL constraint failed: product_mockup_defaults.template_r2_key");
            }
            const templateIdx = sql.includes("print_area_template_r2_key")
              ? 2 // product_key, print_area_key, template_r2_key, print_area_template...
              : 2;
            const templateR2 = handler._args[templateIdx];
            if (templateR2 == null) {
              throw new Error("NOT NULL constraint failed: product_mockup_defaults.template_r2_key");
            }
            state.inserts.push({ sql, args: [...handler._args] });
            const row = {
              id: state.defaults.length + 1,
              product_key: handler._args[0],
              print_area_key: handler._args[1],
              template_r2_key: templateR2,
            };
            state.defaults.push(row);
            return { meta: { changes: 1, last_row_id: row.id } };
          }
          if (sql.includes("UPDATE product_mockup_defaults")) {
            state.updates.push({ sql, args: [...handler._args] });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return handler;
    },
  };
}

const sampleRect = { x: 0.1, y: 0.2, w: 0.5, h: 0.4, angle: 0 };

describe("print-area-rect-save Todify / first INSERT", () => {
  it("upsertCatalogMockupDefault inserts with template_r2_key when no row exists", async () => {
    const catalogDb = makeCatalogDbForMockupDefaults();
    const env = { CATALOG_DB: catalogDb };
    const result = await upsertCatalogMockupDefault(env, "black-hooded-gym-tank", "front", {
      print_area_rect_json: sampleRect,
      mockup_print_area_rect_json: sampleRect,
      universal_print_area_rect_json: sampleRect,
      placement_x: 0.35,
      placement_y: 0.4,
      placement_scale: 0.5,
      placement_angle: 0,
    });
    expect(result.ok).toBe(true);
    expect(catalogDb._state.inserts.length).toBe(1);
    const args = catalogDb._state.inserts[0].args;
    expect(args[0]).toBe("black-hooded-gym-tank");
    expect(args[1]).toBe("front");
    expect(args[2]).toBe(""); // template_r2_key placeholder
    expect(JSON.parse(args[3])).toMatchObject(sampleRect);
  });

  it("upsertCatalogMockupDefault coerces NaN placement to safe defaults on INSERT", async () => {
    const catalogDb = makeCatalogDbForMockupDefaults();
    const result = await upsertCatalogMockupDefault(
      { CATALOG_DB: catalogDb },
      "todify-tank",
      "front",
      {
        print_area_rect_json: sampleRect,
        placement_x: NaN,
        placement_y: Number("ma-1"),
        placement_scale: undefined,
        placement_angle: null,
      }
    );
    expect(result.ok).toBe(true);
    const args = catalogDb._state.inserts[0].args;
    // placement_x, y, scale, angle after template_r2 + 3 json cols
    expect(args[6]).toBe(0.5);
    expect(args[7]).toBe(0.5);
    expect(args[8]).toBe(1);
    expect(args[9]).toBe(0);
  });

  it("savePrintAreaRect catalog-ops path succeeds for Todify-style first save", async () => {
    const catalogDb = makeCatalogDbForMockupDefaults();
    const env = { CATALOG_OPS_MASTER_WRITE: "1", CATALOG_DB: catalogDb };
    const result = await savePrintAreaRect(env, {
      productKey: "black-hooded-gym-tank",
      printAreaKey: "front",
      printAreaRect: sampleRect,
      mockupRect: sampleRect,
      universalRect: sampleRect,
      placement: { x: 0.35, y: 0.4, scale: 0.5, angle: 0 },
      autoMirror: false,
    });
    expect(result.ok).toBe(true);
    expect(catalogDb._state.inserts.length).toBe(1);
    expect(catalogDb._state.inserts[0].sql).toContain("template_r2_key");
  });

  it("savePrintAreaRect returns JSON error instead of throwing on D1 failure", async () => {
    const env = {
      CATALOG_OPS_MASTER_WRITE: "1",
      CATALOG_DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("D1_TYPE_ERROR: Type 'NaN' not supported");
            },
            run: async () => {
              throw new Error("D1_TYPE_ERROR: Type 'NaN' not supported");
            },
          }),
        }),
      },
    };
    const result = await savePrintAreaRect(env, {
      productKey: "tank",
      printAreaKey: "front",
      printAreaRect: sampleRect,
      autoMirror: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("print_area_rect_save_failed");
    expect(result.message).toMatch(/D1_TYPE_ERROR|NaN/);
  });

  it("savePrintAreaRect UPDATE path still works when row exists (Printify)", async () => {
    const catalogDb = makeCatalogDbForMockupDefaults();
    catalogDb._state.defaults.push({
      id: 42,
      product_key: "printify-tee",
      print_area_key: "front",
      template_r2_key: "mockups/tee/white-front.png",
    });
    const result = await savePrintAreaRect(
      { CATALOG_OPS_MASTER_WRITE: "1", CATALOG_DB: catalogDb },
      {
        productKey: "printify-tee",
        printAreaKey: "front",
        printAreaRect: sampleRect,
        mockupRect: sampleRect,
        placement: { x: 0.5, y: 0.5, scale: 1 },
        autoMirror: false,
      }
    );
    expect(result.ok).toBe(true);
    expect(catalogDb._state.inserts.length).toBe(0);
    expect(catalogDb._state.updates.length).toBe(1);
  });
});
