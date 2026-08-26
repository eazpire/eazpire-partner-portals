import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coerceVariantConfigProviderId } from "../../src/features/manufacturers/partnerCatalog/constants.js";
import {
  SPREAD_EU_PRINT_PROVIDER_ID,
  ensureSpreadEuShippingRows,
  fillSpreadEuCatalogProduct,
  fillSpreadEuCreatorSettings,
  listSpreadEuKeysNeedingRepair,
} from "../../src/features/manufacturers/adapters/spreadconnect/spreadEuCatalogFill.js";
import {
  SPREAD_EU_COUNTRY_CODES,
  buildSpreadEuCatalogProductData,
} from "../../src/features/manufacturers/adapters/spreadconnect/spreadEuCatalogMap.js";
import { getProductProviderShipping } from "../../src/features/catalog/productProviderShipping.js";
import { D1_IN_CHUNK } from "../../src/utils/d1InChunk.js";

function memoryCatalogDb() {
  const headers = new Map();
  const rates = [];
  const maps = [];
  const profiles = [];
  const mockups = [];
  const active = [];

  return {
    headers,
    rates,
    maps,
    profiles,
    mockups,
    active,
    prepare(sql) {
      const s = String(sql);
      const binds = [];
      const stmt = {
        bind(...args) {
          binds.push(...args);
          return stmt;
        },
        async first() {
          if (s.includes("FROM product_provider_shipping") && !s.includes("rates")) {
            const row = headers.get(`${binds[0]}:${binds[1]}`);
            return row || null;
          }
          if (s.includes("FROM product_publish_profiles")) {
            return profiles.find((p) => p.product_key === binds[0] && p.print_provider_id === binds[1]) || null;
          }
          if (s.includes("FROM product_publish_map")) {
            return maps.find((m) => m.product_key === binds[0]) || null;
          }
          if (s.includes("FROM product_mockup_images") || s.includes("eazpire_product_mockup_images")) {
            return (
              mockups.find(
                (m) =>
                  m.product_key === binds[0] &&
                  m.print_provider_id === binds[1] &&
                  m.view_key === binds[2] &&
                  m.color_name === binds[3]
              ) || null
            );
          }
          return null;
        },
        async all() {
          if (s.includes("FROM product_provider_shipping_rates")) {
            return {
              results: rates.filter((r) => r.product_key === binds[0] && r.print_provider_id === binds[1]),
            };
          }
          if (s.includes("FROM product_publish_map") && s.includes("LIKE")) {
            return { results: maps };
          }
          if (s.includes("FROM product_publish_profiles") && s.includes("LIKE")) {
            return { results: profiles };
          }
          if (s.includes("FROM product_provider_shipping") && s.includes("LIKE")) {
            return { results: [...headers.values()] };
          }
          return { results: [] };
        },
        async run() {
          if (s.includes("INSERT") && s.includes("product_provider_shipping_rates")) {
            rates.push({
              product_key: binds[0],
              print_provider_id: binds[1],
              country_code: binds[2],
              country_label: binds[3],
              shipping_first_cents: binds[4],
              shipping_additional_cents: binds[5],
              profile_key: "default",
              speed: "Standard",
            });
          } else if (s.includes("INSERT") && s.includes("product_provider_shipping") && !s.includes("rates")) {
            headers.set(`${binds[0]}:${binds[1]}`, {
              product_key: binds[0],
              print_provider_id: binds[1],
              ships_from_json: binds[2],
              network_origins_json: "[]",
              currency: "EUR",
              last_synced_at: binds[3],
              sync_source: "spreadconnect_eu",
              sync_error: null,
              updated_at: binds[5] ?? binds[3],
            });
          } else if (s.includes("INSERT") && s.includes("product_publish_profiles")) {
            profiles.push({
              id: profiles.length + 1,
              product_key: binds[0],
              title: binds[1],
              source_system: binds[2],
              print_provider_id: binds[4],
              variants_json: binds[5],
              prices_json: binds[6],
              product_data_json: binds[7],
              shopify_category_id: binds[9],
              shopify_category_name: binds[10],
            });
          } else if (s.includes("INSERT") && s.includes("product_publish_map")) {
            maps.push({
              id: maps.length + 1,
              product_key: binds[0],
              country_codes_json: binds[2],
              country_of_origin: binds[4],
            });
          } else if (s.includes("INSERT") && s.includes("product_active_print_providers")) {
            active.push({ product_key: binds[0], print_provider_id: binds[1] });
          } else if (s.includes("INSERT") && s.includes("product_mockup_images")) {
            const hasId = s.includes("(id, product_key");
            const offset = hasId ? 1 : 0;
            mockups.push({
              id: hasId ? binds[0] : `pmi_${mockups.length + 1}`,
              product_key: binds[offset],
              print_provider_id: binds[offset + 1],
              view_key: binds[offset + 2],
              color_name: binds[offset + 3],
              color_hex: binds[offset + 4],
              image_url: binds[offset + 5],
              is_default: binds[offset + 7],
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

function memoryCreatorDb() {
  const settings = new Map();
  const variantConfig = [];
  return {
    settings,
    variantConfig,
    prepare(sql) {
      const s = String(sql);
      const binds = [];
      const stmt = {
        bind(...args) {
          binds.push(...args);
          return stmt;
        },
        async first() {
          if (s.includes("FROM creator_product_settings")) return settings.get(binds[0]) || null;
          return null;
        },
        async run() {
          if (s.includes("INSERT INTO creator_product_settings")) {
            settings.set(binds[0], {
              product_key: binds[0],
              cost_eaz: binds[1],
              preview_images_json: binds[2],
              variant_costs_json: binds[3],
            });
          } else if (s.includes("INSERT INTO product_variant_config")) {
            variantConfig.push({
              product_key: binds[0],
              print_provider_id: binds[1],
              config_json: binds[2],
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

describe("spreadEuCatalogFill", () => {
  it("maps opaque Spread EU provider id to sentinel 910002", () => {
    expect(Number("spread-eu-1")).toBeNaN();
    expect(coerceVariantConfigProviderId("spread-eu-1")).toBe(910002);
    expect(SPREAD_EU_PRINT_PROVIDER_ID).toBe(910002);
  });

  it("opens Shipping without missing_print_provider_id and seeds rates", async () => {
    const catalogDb = memoryCatalogDb();
    const result = await getProductProviderShipping(
      { CATALOG_DB: catalogDb },
      "spread-eu-813",
      "spread-eu-1"
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.print_provider_id).toBe(910002);
    expect(result.currency).toBe("EUR");
    expect(result.ships_from.some((s) => s.code === "DE")).toBe(true);
    expect(result.rates_count).toBe(SPREAD_EU_COUNTRY_CODES.length);
    expect(result.continents.some((c) => (c.countries || []).length > 0)).toBe(true);
  });

  it("fills markets, origin, mockups, prices, meta, and EAZV per variant", async () => {
    const mapped = buildSpreadEuCatalogProductData({
      id: 813,
      customerName: "Männer Tank Top atmungsaktiv",
      price: 7.4,
      appearances: [
        { id: 1, name: "Schwarz", appearanceColorValue: "#111111" },
        { id: 2, name: "Weiß", colorHex: "ffffff" },
      ],
      sizes: [
        { id: 10, name: "S", price: 7.4 },
        { id: 11, name: "XL", price: 8.1 },
      ],
      printAreas: [{ view: "FRONT", widthMm: 280, heightMm: 350 }],
    });
    const catalogDb = memoryCatalogDb();
    const creatorDb = memoryCreatorDb();
    await fillSpreadEuCatalogProduct(
      { CATALOG_DB: catalogDb, CREATOR_DB: creatorDb },
      { productKey: "spread-eu-813", title: mapped.product_data.title, mapped }
    );

    expect(catalogDb.active[0].print_provider_id).toBe(910002);
    expect(catalogDb.maps[0].country_of_origin).toBe("DE");
    const countries = JSON.parse(catalogDb.maps[0].country_codes_json);
    expect(countries).toEqual(expect.arrayContaining(["DE", "FR", "ZA", "JP"]));
    expect(JSON.parse(catalogDb.profiles[0].prices_json)[0].price).toBe(740);
    expect(catalogDb.profiles[0].shopify_category_id).toMatch(/TaxonomyCategory/);
    expect(catalogDb.mockups.length).toBeGreaterThanOrEqual(2);
    expect(catalogDb.mockups.some((m) => m.view_key === "front" && m.color_name === "Schwarz")).toBe(true);
    expect(creatorDb.settings.get("spread-eu-813").preview_images_json).toContain("productTypes/813");
    const eazv = JSON.parse(creatorDb.settings.get("spread-eu-813").variant_costs_json);
    expect(eazv["color:1"]).toBe(60);
    expect(eazv["color:2"]).toBe(60);
    expect(creatorDb.variantConfig[0].print_provider_id).toBe(910002);
  });

  it("marks existing Spread EU keys without markets or shipping for repair", async () => {
    const catalogDb = memoryCatalogDb();
    catalogDb.maps.push({
      product_key: "spread-eu-1",
      country_codes_json: "[]",
      country_of_origin: "",
    });
    const need = await listSpreadEuKeysNeedingRepair({ CATALOG_DB: catalogDb }, new Set(["spread-eu-1", "spread-eu-2"]));
    expect(need.has("spread-eu-1")).toBe(true);
    expect(need.has("spread-eu-2")).toBe(true);
  });

  it("sets creator preview and per-color EAZV when settings are empty", async () => {
    const creatorDb = memoryCreatorDb();
    await fillSpreadEuCreatorSettings({ CREATOR_DB: creatorDb }, "spread-eu-812", {
      creator_preview_url: "https://image.spreadshirtmedia.net/preview.png",
      product_data: { options: [{ type: "color", values: [{ id: 9, title: "Red" }] }] },
      print_area_keys: ["front"],
    });
    const row = creatorDb.settings.get("spread-eu-812");
    expect(JSON.parse(row.preview_images_json)).toEqual(["https://image.spreadshirtmedia.net/preview.png"]);
    expect(JSON.parse(row.variant_costs_json)["color:9"]).toBe(60);
  });

  it("keeps D1 IN-list chunking at 80 binds", () => {
    expect(D1_IN_CHUNK).toBe(80);
    const studio = readFileSync("src/features/manufacturers/partnerCatalog/catalogStudioService.js", "utf8");
    expect(studio).toContain("D1_IN_CHUNK");
    expect(studio).toContain("chunkIds");
    const fill = readFileSync("src/features/manufacturers/adapters/spreadconnect/spreadEuCatalogFill.js", "utf8");
    expect(fill).not.toMatch(/IN \(\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?,\s*\?/);
  });
});

describe("ensureSpreadEuShippingRows", () => {
  it("does not insert duplicate rates on a second call", async () => {
    const catalogDb = memoryCatalogDb();
    await ensureSpreadEuShippingRows({ CATALOG_DB: catalogDb }, "spread-eu-10");
    const first = catalogDb.rates.length;
    await ensureSpreadEuShippingRows({ CATALOG_DB: catalogDb }, "spread-eu-10");
    expect(catalogDb.rates.length).toBe(first);
    expect(first).toBe(SPREAD_EU_COUNTRY_CODES.length);
  });
});
