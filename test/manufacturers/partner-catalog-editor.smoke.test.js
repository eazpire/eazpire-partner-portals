import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const portal = join(root, "admin-partner-portal/js/catalog-editor");

/**
 * Fast regression guard for Partner Admin catalog editor (no browser, no network).
 */
describe("partner catalog editor assets (smoke)", () => {
  const tabFiles = [
    "tabs/meta.js",
    "tabs/providers.js",
    "tabs/template.js",
    "tabs/mockups.js",
    "tabs/variants.js",
    "tabs/print-area.js",
    "tabs/products.js",
    "tabs/automations.js",
    "utils/variant-matrix.js",
    "version-config-panel.js",
    "print-area-canvas.js",
  ];

  it("has shell with 8 tabs and mirror save bar", () => {
    const src = readFileSync(join(portal, "shell.js"), "utf8");
    const needles = [
      "openProductEditor",
      "catalog-editor-overlay",
      "fetchEditorBundle",
      "mirrorProduct",
      "const TABS = [",
      "provider",
      "template",
      "mockups",
      "variants",
      "print_area",
      "meta_data",
      "products",
      "automations",
      "ce-mirror",
      "ce-save",
    ];
    for (const n of needles) {
      expect(src, `shell missing: ${n}`).toContain(n);
    }
  });

  it("api.js wraps editor bundle and save ops", () => {
    const src = readFileSync(join(portal, "api.js"), "utf8");
    expect(src).toContain("admin-eazpire-product-editor-bundle");
    expect(src).toContain("admin-eazpire-product-meta-save");
    expect(src).toContain("admin-eazpire-product-providers-save");
    expect(src).toContain("admin-eazpire-automations-save");
    expect(src).toContain("admin-eazpire-load-printify-settings");
    expect(src).toContain("admin-eazpire-print-area-rect-save");
    expect(src).toContain("admin-eazpire-fetch-printify-mockups");
  });

  it("all tab modules exist", () => {
    for (const f of tabFiles) {
      expect(existsSync(join(portal, f)), `missing tab: ${f}`).toBe(true);
    }
  });

  it("app.js opens editor from Eazpire products list", () => {
    const src = readFileSync(join(root, "admin-partner-portal/js/app.js"), "utf8");
    expect(src).toContain('import { openProductEditor } from "./catalog-editor/shell.js"');
    expect(src).toContain("admin-eazpire-catalog-mirror-status-v2");
    expect(src).toContain("openProductEditor");
  });

  it("migration 0015 defines shadow tables", () => {
    const sql = readFileSync(
      join(root, "migrations-manufacturer/0015_eazpire_catalog_shadow_tables.sql"),
      "utf8"
    );
    const tables = [
      "eazpire_product_active_providers",
      "eazpire_product_publish_plans",
      "eazpire_product_publish_profiles",
      "eazpire_product_mockup_defaults",
      "eazpire_product_variant_config",
      "eazpire_template_products",
    ];
    for (const t of tables) {
      expect(sql, `missing table: ${t}`).toContain(t);
    }
  });
});
