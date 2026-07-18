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
import { extractPrintifyMockupEntries } from "../../src/utils/printifyShopProductMocks.js";

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

describe("extractPrintifyMockupEntries label axis", () => {
  it("apparel Color×Size collapses to one tile per color (not White / M)", () => {
    const product = {
      options: [
        {
          type: "color",
          name: "Colors",
          values: [
            { id: 1, title: "White", colors: ["#ffffff"] },
            { id: 2, title: "Black", colors: ["#000000"] },
          ],
        },
        {
          type: "size",
          name: "Sizes",
          values: [
            { id: 10, title: "S" },
            { id: 11, title: "M" },
            { id: 12, title: "XL" },
          ],
        },
      ],
      variants: [
        { id: 101, title: "White / S", options: [1, 10] },
        { id: 102, title: "White / M", options: [1, 11] },
        { id: 103, title: "White / XL", options: [1, 12] },
        { id: 201, title: "Black / M", options: [2, 11] },
      ],
      images: [
        {
          src: "https://cdn.test/back-white.png",
          position: "back",
          variant_ids: [101, 102, 103],
        },
        {
          src: "https://cdn.test/back-black.png",
          position: "back",
          variant_ids: [201],
        },
      ],
    };

    const entries = extractPrintifyMockupEntries(product);
    const back = entries.filter((e) => e.view_key === "back");
    expect(back.map((e) => e.color_name).sort()).toEqual(["Black", "White"]);
    expect(back.every((e) => !String(e.color_name).includes("/"))).toBe(true);
  });

  it("photopaper poster without color keeps one tile per size", () => {
    const product = {
      options: [
        {
          type: "paper",
          name: "Paper",
          values: [{ id: 5, title: "Photopaper" }],
        },
        {
          type: "size",
          name: "Sizes",
          values: [
            { id: 20, title: '12″ × 18″' },
            { id: 21, title: '18″ × 24″' },
          ],
        },
      ],
      variants: [
        { id: 301, title: 'Photopaper / 12″ × 18″', options: [5, 20] },
        { id: 302, title: 'Photopaper / 18″ × 24″', options: [5, 21] },
      ],
      images: [
        {
          src: "https://cdn.test/poster-12x18.png",
          position: "front",
          variant_ids: [301],
        },
        {
          src: "https://cdn.test/poster-18x24.png",
          position: "front",
          variant_ids: [302],
        },
      ],
    };

    const entries = extractPrintifyMockupEntries(product);
    const front = entries.filter((e) => e.view_key === "front");
    expect(front).toHaveLength(2);
    expect(front.map((e) => e.color_name).sort()).toEqual(['12″ × 18″', '18″ × 24″']);
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
