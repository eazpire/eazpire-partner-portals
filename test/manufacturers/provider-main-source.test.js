import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portal = join(__dirname, "../../admin-partner-portal/js/catalog-editor");

describe("print area main source inheritance (smoke)", () => {
  it("technical module defines main source schema helpers", () => {
    const src = readFileSync(join(portal, "provider-print-technical.js"), "utf8");
    expect(src).toContain("MAIN_SOURCE_CATEGORY_KEYS");
    expect(src).toContain("defaultUseMainSourceCategories");
    expect(src).toContain("normalizeUseMainSourceCategories");
    expect(src).toContain("findPrintSettingsMainSource");
    expect(src).toContain("is_print_settings_main_source");
    expect(src).toContain("use_main_source");
    expect(src).toContain("use_main_source_provider");
    expect(src).toContain('"scope"');
    expect(src).toContain('"placement"');
  });

  it("print area main-source module wires provider header and sidebar toggles", () => {
    const src = readFileSync(join(portal, "print-area/main-source.js"), "utf8");
    expect(src).toContain("ce-pa-main-source-cb");
    expect(src).toContain("ce-pa-use-main-provider-cb");
    expect(src).toContain("ce-pa-use-main-cb");
    expect(src).toContain("applyPrintAreaInheritanceToState");
    expect(src).toContain("collectMainSourceVersionUpdates");
  });

  it("settings sidebar exposes per-category use main source toggles", () => {
    const src = readFileSync(join(portal, "print-area/settings-sidebar.js"), "utf8");
    expect(src).toContain("ce-pa-use-main-cb");
    expect(src).toContain("ce-pa-acc-summary-row");
    expect(src).toContain("shouldShowCategoryInheritToggles");
  });

  it("provider tab no longer renders main source header UI", () => {
    const src = readFileSync(join(portal, "tabs/providers.js"), "utf8");
    expect(src).not.toContain("ce-prov-main-source-cb");
    expect(src).not.toContain("ce-prov-use-main-provider-cb");
    expect(src).not.toContain("renderMainSourceHeader");
    expect(src).not.toContain("No main source set");
    expect(src).not.toContain("Use main source");
  });

  it("version config panel no longer renders provider inherit toggles", () => {
    const src = readFileSync(join(portal, "version-config-panel.js"), "utf8");
    expect(src).not.toContain("ce-prov-use-main-cb");
    expect(src).not.toContain("ce-prov-inherit-label");
    expect(src).not.toContain("applyMainSourceInheritanceToConfig");
    expect(src).not.toContain("Use main source");
    expect(src).not.toContain("No main source set");
  });
});

describe("listViewKeys provider scoping (smoke)", () => {
  it("derives views from version print positions via unionPatPlaceholderPositions", () => {
    const src = readFileSync(join(portal, "print-area/helpers.js"), "utf8");
    expect(src).toContain("unionPatPlaceholderPositions");
    expect(src).toContain("resolvePrintAreaVersion");
    expect(src).toContain("getVersionPlaceholderConfig(version, catalogDetail)");
    expect(src).toContain("resolvePrintAreaCatalogVariants");
    expect(src).toContain("fetchProviderCatalogDetail");
  });
});
