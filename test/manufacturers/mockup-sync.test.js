import { describe, it, expect, vi } from "vitest";
import {
  ensureCatalogMockupImageSchema,
  tableSqlNeedsMockupSetUnique,
  dedupeMockupEntriesByViewColor,
  resetCatalogMockupImageSchemaReadyForTests,
} from "../../src/features/manufacturers/partnerCatalog/ensureCatalogMockupImageSchema.js";
import { persistMockupEntriesToR2 } from "../../src/features/manufacturers/partnerCatalog/persistMockupImagesToR2.js";

import {
  normalizeMockupSet,
  MOCKUP_SET_CLEAN,
  MOCKUP_SET_SHOP_PREVIEW,
  MOCKUP_SET_CALIBRATION,
  templatePrintifyColumnForMockupSet,
} from "../../src/features/manufacturers/partnerCatalog/mockupSet.js";

describe("mockupSet", () => {
  it("normalizeMockupSet recognizes calibration", () => {
    expect(normalizeMockupSet("calibration")).toBe(MOCKUP_SET_CALIBRATION);
    expect(normalizeMockupSet("CALIBRATION")).toBe(MOCKUP_SET_CALIBRATION);
    expect(normalizeMockupSet("shop_preview")).toBe(MOCKUP_SET_SHOP_PREVIEW);
    expect(normalizeMockupSet("")).toBe(MOCKUP_SET_CLEAN);
  });

  it("templatePrintifyColumnForMockupSet maps calibration column", () => {
    expect(templatePrintifyColumnForMockupSet("calibration")).toBe("printify_calibration_mockups_product_id");
    expect(templatePrintifyColumnForMockupSet("clean")).toBe("printify_mockups_product_id");
  });
});

describe("mockup sync helpers", () => {
  it("tableSqlNeedsMockupSetUnique detects legacy UNIQUE without mockup_set", () => {
    const legacy = `CREATE TABLE product_mockup_images (
      UNIQUE(product_key, print_provider_id, view_key, color_name)
    )`;
    const modern = `CREATE TABLE product_mockup_images (
      UNIQUE(product_key, print_provider_id, view_key, color_name, mockup_set)
    )`;
    expect(tableSqlNeedsMockupSetUnique(legacy)).toBe(true);
    expect(tableSqlNeedsMockupSetUnique(modern)).toBe(false);
  });

  it("dedupeMockupEntriesByViewColor keeps first row per view/color", () => {
    const out = dedupeMockupEntriesByViewColor([
      { view_key: "front", color_name: "Black", image_url: "a" },
      { view_key: "front", color_name: "Black", image_url: "b" },
      { view_key: "back", color_name: "Black", image_url: "c" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].image_url).toBe("a");
  });

  it("ensureCatalogMockupImageSchema rebuilds when legacy UNIQUE is present", async () => {
    resetCatalogMockupImageSchemaReadyForTests();
    const runs = [];
    let tableSql = `CREATE TABLE product_mockup_images (
      id INTEGER PRIMARY KEY,
      product_key TEXT, print_provider_id INTEGER, printify_product_id TEXT,
      view_key TEXT, color_name TEXT, color_hex TEXT, image_url TEXT,
      printify_variant_ids TEXT, is_default INTEGER, created_at INTEGER,
      preview_template_ids_json TEXT, mockup_set TEXT,
      UNIQUE(product_key, print_provider_id, view_key, color_name)
    )`;

    const db = {
      prepare(sql) {
        return {
          async all() {
            if (sql.includes("PRAGMA table_info")) {
              return {
                results: [
                  { name: "id" },
                  { name: "mockup_set" },
                  { name: "product_key" },
                  { name: "print_provider_id" },
                  { name: "view_key" },
                  { name: "color_name" },
                ],
              };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes("sqlite_master")) return { sql: tableSql };
            return null;
          },
          async run() {
            runs.push(sql);
            if (sql.includes("RENAME TO product_mockup_images")) {
              tableSql = `CREATE TABLE product_mockup_images (
                UNIQUE(product_key, print_provider_id, view_key, color_name, mockup_set)
              )`;
            }
            return {};
          },
        };
      },
    };

    await ensureCatalogMockupImageSchema(db);
    expect(runs.some((s) => s.includes("product_mockup_images_new"))).toBe(true);
    expect(tableSqlNeedsMockupSetUnique(tableSql)).toBe(false);
  });

  it("persistMockupEntriesToR2 stores bytes without webp by default", async () => {
    const puts = [];
    const env = {
      PUBLIC_FILE_BASE_URL: "https://cdn.example",
      MOCKUP_R2: {
        async put(key, body) {
          puts.push({ key, size: body?.byteLength || body?.length || 0 });
        },
      },
    };
    const entries = [
      { view_key: "front", color_name: "Black", image_url: "https://img.test/a.png", printify_variant_ids: "[]" },
      { view_key: "back", color_name: "White", image_url: "https://img.test/b.png", printify_variant_ids: "[]" },
    ];
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));

    const out = await persistMockupEntriesToR2(env, "test-tee", entries, "shop_preview", {
      encodeWebp: false,
      concurrency: 2,
    });

    expect(out).toHaveLength(2);
    expect(puts).toHaveLength(2);
    expect(out[0].image_url).toContain("https://cdn.example/mockup/");
    expect(out[0].image_url).toContain("shop_preview");
  });
});
