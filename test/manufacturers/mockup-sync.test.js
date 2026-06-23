import { describe, it, expect, vi } from "vitest";
import { ensureCatalogMockupImageColumns } from "../../src/features/manufacturers/partnerCatalog/catalogOpsWriteService.js";
import { persistMockupEntriesToR2 } from "../../src/features/manufacturers/partnerCatalog/persistMockupImagesToR2.js";

describe("mockup sync helpers", () => {
  it("ensureCatalogMockupImageColumns adds mockup_set when missing", async () => {
    const runs = [];
    const db = {
      prepare(sql) {
        return {
          async all() {
            if (sql.includes("PRAGMA table_info")) {
              return { results: [{ name: "product_key" }] };
            }
            return { results: [] };
          },
          async run() {
            runs.push(sql);
            return {};
          },
        };
      },
    };
    await ensureCatalogMockupImageColumns(db);
    expect(runs.some((s) => s.includes("mockup_set"))).toBe(true);
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
