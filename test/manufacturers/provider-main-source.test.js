import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portal = join(__dirname, "../../admin-partner-portal/js/catalog-editor");

describe("provider main source inheritance (smoke)", () => {
  it("technical module defines main source schema helpers", () => {
    const src = readFileSync(join(portal, "provider-print-technical.js"), "utf8");
    expect(src).toContain("MAIN_SOURCE_CATEGORY_KEYS");
    expect(src).toContain("defaultUseMainSourceCategories");
    expect(src).toContain("normalizeUseMainSourceCategories");
    expect(src).toContain("findPrintSettingsMainSource");
    expect(src).toContain("is_print_settings_main_source");
    expect(src).toContain("use_main_source");
  });

  it("version config panel supports per-category inherit toggles", () => {
    const src = readFileSync(join(portal, "version-config-panel.js"), "utf8");
    expect(src).toContain("ce-prov-use-main-cb");
    expect(src).toContain("applyMainSourceInheritanceToConfig");
    expect(src).toContain("ce-prov-section--inherited");
    expect(src).toContain("design_types");
    expect(src).toContain("print_area_positions");
  });

  it("providers tab wires main source header and save merge", () => {
    const src = readFileSync(join(portal, "tabs/providers.js"), "utf8");
    expect(src).toContain("ce-prov-main-source-cb");
    expect(src).toContain("ce-prov-use-main-provider-cb");
    expect(src).toContain("applyMainSourceInheritanceToConfig");
    expect(src).toContain("clearMainSourceFromOtherProviders");
  });
});

describe("listViewKeys provider scoping (smoke)", () => {
  it("filters views by version placeholder slots intersected with mockups", () => {
    const src = readFileSync(join(portal, "print-area/helpers.js"), "utf8");
    expect(src).toContain("const versionKeys = []");
    expect(src).toContain("placeholderViewHasSlots(slots)");
    expect(src).toContain("if (versionKeys.length)");
    expect(src).toContain("getVersionPlaceholderConfig(version, catalogDetail)");
  });
});
