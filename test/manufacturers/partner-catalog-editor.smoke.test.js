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
    "print-area/helpers.js",
    "print-area/settings-sidebar.js",
    "print-area/dual-viewer.js",
    "print-area/pattern-preview.js",
    "print-area/image-grid.js",
    "print-area/view-dock.js",
    "print-area/placement-overlays.js",
    "print-area/rect-interaction.js",
    "print-area/brand-assets.js",
    "print-area/fullscreen-viewer.js",
    "market-country-picker.js",
    "editor-product-title.js",
    "editor-visibility.js",
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
      "Templates",
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
    expect(src).toContain("admin-eazpire-print-area-image-upload");
    expect(src).toContain("admin-eazpire-variant-print-area-rect-save");
    expect(src).toContain("admin-eazpire-brand-assets-bundle");
    expect(src).toContain("fetchBrandAssetsBundle");
    expect(src).toContain("uploadBrandAsset");
    expect(src).toContain("uploadProductBrandAsset");
    expect(src).toContain("admin-eazpire-product-brand-asset-upload");
    expect(src).toContain("syncTemplateSection");
    expect(src).toContain("saveTemplateSectionProductId");
    expect(src).toContain("admin-eazpire-template-section-id-save");
  });

  it("mockups tab opens shared image viewer", () => {
    const src = readFileSync(join(portal, "tabs/mockups.js"), "utf8");
    expect(src).toContain("openMockViewer");
  });

  it("print-area tab persists useMockups on every save", () => {
    const tabSrc = readFileSync(join(portal, "tabs/print-area.js"), "utf8");
    expect(tabSrc).toContain("resolvePrintAreaUseMockups");
    expect(tabSrc).toContain("print_area_edit_use_mocks: !!st.useMockups");
    expect(tabSrc).not.toMatch(/if\s*\(\s*st\.useMockups\s*!==\s*!!ctx\.bundle/);
    const helpersSrc = readFileSync(join(portal, "print-area/helpers.js"), "utf8");
    expect(helpersSrc).toContain("export function resolvePrintAreaUseMockups");
  });

  it("meta tab is slim shop content only", () => {
    const src = readFileSync(join(portal, "tabs/meta.js"), "utf8");
    expect(src).toContain("ce-meta-shopify-cat");
    expect(src).not.toContain("ce-meta-status");
    expect(src).not.toContain("ce-meta-title");
    expect(src).not.toContain("ce-meta-provider-pill");
  });

  it("footer has visibility triswitch", () => {
    const shell = readFileSync(join(portal, "shell.js"), "utf8");
    expect(shell).toContain("ce-foot-visibility");
    expect(shell).toContain("renderCatalogEditorTriSwitch");
    expect(shell).toContain("editor-visibility.js");
    const vis = readFileSync(join(portal, "editor-visibility.js"), "utf8");
    expect(vis).toContain("ce-triswitch");
  });

  it("meta tab uses collapsible provider subnav", () => {
    const src = readFileSync(join(portal, "editor-subnav.js"), "utf8");
    expect(src).toContain('"meta_data"');
  });

  it("provider tab has markets country picker", () => {
    const src = readFileSync(join(portal, "tabs/providers.js"), "utf8");
    expect(src).toContain("ce-prov-markets");
    expect(src).toContain("publish_plan_updates");
    expect(src).toContain("ce-prov-origin");
    expect(src).toContain("mergeVisibilityIntoVersionConfig");
  });

  it("all tab modules exist", () => {
    for (const f of tabFiles) {
      expect(existsSync(join(portal, f)), `missing tab: ${f}`).toBe(true);
    }
  });

  it("catalog studio opens editor and mirror from product list", () => {
    const appSrc = readFileSync(join(root, "admin-partner-portal/js/app.js"), "utf8");
    expect(appSrc).toContain('import { mountCatalogStudio } from "./catalog-studio.js"');
    const studioSrc = readFileSync(join(root, "admin-partner-portal/js/catalog-studio.js"), "utf8");
    expect(studioSrc).toContain('import { openProductEditor } from "./catalog-editor/shell.js"');
    expect(studioSrc).toContain("admin-eazpire-catalog-mirror-run");
    expect(studioSrc).toContain("admin-catalog-studio-tree");
    expect(studioSrc).toContain("admin-catalog-studio-set-status");
    expect(studioSrc).toContain("admin-catalog-studio-remove-product");
    expect(studioSrc).toContain("cs-mock-carousel");
    expect(studioSrc).toContain("openMockViewer");
    expect(studioSrc).toContain("openStatusPicker");
    expect(studioSrc).toContain("openProductEditor");
    expect(studioSrc).toContain("renderCategorySidebar");
    expect(studioSrc).toContain("catalog-studio-filter-sidebar");
  });

  it("provider-print-technical exports PAT merge helpers", () => {
    const src = readFileSync(join(portal, "provider-print-technical.js"), "utf8");
    expect(src).toContain("mergePatDisplayConfigFromTemplate");
    expect(src).toContain("derivePatProductVersionConfigFromSnapshot");
    expect(src).toContain("patVersionDesignTypesForAdminUi");
    expect(src).toContain("mapPlaceholderNameToPatKey");
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
