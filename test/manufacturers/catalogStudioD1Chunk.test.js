import { describe, expect, it } from "vitest";
import { getCatalogStudioProducts } from "../../src/features/manufacturers/partnerCatalog/catalogStudioService.js";

const D1_BIND_CAP = 100;

function spreadRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    product_key: `spread-eu-${800 + i}`,
    title: `Spread type ${i + 1}`,
    catalog_status: "offline",
    catalog_category_leaf: "T-Shirt",
    catalog_category_group: "Kleidung",
    version_count: 0,
    manufacturer_name: "Spreadshirt",
    blueprint_title: null,
    blueprint_category: null,
    updated_at: 1,
  }));
}

function makeTrackingDb(rows) {
  const bindCounts = [];
  const db = {
    bindCounts,
    prepare(sql) {
      const handler = {
        bind(...args) {
          bindCounts.push({ sql, n: args.length });
          if (args.length > D1_BIND_CAP) {
            throw new Error("D1_ERROR: too many SQL variables at offset 321: SQLITE_ERROR");
          }
          return handler;
        },
        first: async () => {
          if (String(sql).includes("FROM manufacturers")) {
            return { id: "mfg_spreadshirt", slug: "spreadshirt", name: "Spreadshirt" };
          }
          return null;
        },
        all: async () => {
          if (String(sql).includes("IN (")) return { results: [] };
          if (String(sql).includes("FROM eazpire_products")) return { results: rows };
          return { results: [] };
        },
        run: async () => ({}),
      };
      return handler;
    },
  };
  return db;
}

describe("Catalog Studio Available listing vs D1 bind limit", () => {
  it("lists 340 Spread EU products without binding 300+ variables in one statement", async () => {
    const rows = spreadRows(340);
    const mfgDb = makeTrackingDb(rows);
    const catalogDb = makeTrackingDb([]);
    let listedSpreadSync = false;
    const env = {
      CATALOG_DB: catalogDb,
      get MANUFACTURER_DB() {
        listedSpreadSync = true;
        throw new Error("list_must_not_call_spread_eu_sync");
      },
    };

    const result = await getCatalogStudioProducts(mfgDb, env, {
      manufacturerId: "mfg_spreadshirt",
      providerExternalId: "spread-eu-1",
      filter: "available",
    });

    expect(listedSpreadSync).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.sync).toBeUndefined();
    expect(result.items).toHaveLength(340);
    expect(result.items[0].product_key).toBe("spread-eu-800");
    expect(result.items[0].catalog_status).toBe("available");

    const allBinds = [...mfgDb.bindCounts, ...catalogDb.bindCounts];
    const inBinds = allBinds.filter((b) => String(b.sql).includes("IN ("));
    expect(inBinds.length).toBeGreaterThan(0);
    expect(Math.max(...allBinds.map((b) => b.n), 0)).toBeLessThanOrEqual(D1_BIND_CAP);
    expect(Math.max(...inBinds.map((b) => b.n))).toBeLessThanOrEqual(90);
    expect(inBinds.some((b) => b.n > 1 && b.n <= 80)).toBe(true);
    expect(inBinds.every((b) => b.n <= 90)).toBe(true);
  });

  it("would throw the production D1 error if a list query bound 321 variables at once", () => {
    const db = makeTrackingDb([]);
    const keys = Array.from({ length: 321 }, (_, i) => `spread-eu-${i}`);
    const placeholders = keys.map(() => "?").join(",");
    expect(() => {
      db.prepare(
        `SELECT product_key, image_url, is_default, created_at
     FROM eazpire_product_mockup_images
     WHERE product_key IN (${placeholders})
     ORDER BY is_default DESC, created_at ASC`
      ).bind(...keys);
    }).toThrow(/too many SQL variables at offset 321/);
  });
});
