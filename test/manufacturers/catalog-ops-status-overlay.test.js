import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("catalog ops visibility SoT", () => {
  it("prefers manufacturer catalog_status over product_catalog.is_active", () => {
    const src = readFileSync(
      join(root, "src/features/manufacturers/partnerCatalog/catalogOpsReadService.js"),
      "utf8"
    );
    expect(src).toContain("link.catalog_status");
    expect(src).toContain("VALID_CATALOG_STATUSES.has(mfgStatus)");
    expect(src).toContain("cfg.catalog_status = productStatus");
  });

  it("editor visibility prefers product-level status over version config", () => {
    const src = readFileSync(
      join(root, "admin-partner-portal/js/catalog-editor/editor-visibility.js"),
      "utf8"
    );
    expect(src).toContain("productCatalogStatusFallback");
    expect(src).toMatch(/map\.set\(key,\s*productStatus\)/);
    expect(src).toContain("v.product_version_config.catalog_status = productStatus");
  });

  it("providers tab derives country of origin from location when empty", () => {
    const src = readFileSync(
      join(root, "admin-partner-portal/js/catalog-editor/tabs/providers.js"),
      "utf8"
    );
    expect(src).toContain("deriveCountryOfOriginFromProvider");
    expect(src).toContain("locationDetail");
    expect(src).toContain("MOROCCO");
  });
});
