import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const portal = join(root, "admin-partner-portal/js/catalog-editor");

describe("print area brand assets + view keys (smoke)", () => {
  it("helpers export brand asset and view key scoping", () => {
    const src = readFileSync(join(portal, "print-area/helpers.js"), "utf8");
    expect(src).toContain("export function listViewKeys");
    expect(src).toContain("unionPatPlaceholderPositions");
    expect(src).not.toContain("placeholderViewHasSlots");
    expect(src).toContain("export function aggregateBrandAssetSlots");
    expect(src).toContain("export function readBrandAssetsFromConfig");
    expect(src).toContain("export function resolveEffectiveBrandAssets");
    expect(src).toContain("brand_assets_mode");
    expect(src).not.toMatch(/for \(const slot of \["mockup", "edit_mode"\]\)/);
  });

  it("brand-assets section supports specific assets toggle", () => {
    const src = readFileSync(join(portal, "print-area/brand-assets.js"), "utf8");
    expect(src).toContain("Specific assets");
    expect(src).toContain("ce-pa-brand-specific");
    expect(src).toContain("uploadProductBrandAsset");
    expect(src).toContain("readonly: readonly || !isSpecific");
  });

  it("settings sidebar filters brand section by placeholder slots", () => {
    const src = readFileSync(join(portal, "print-area/settings-sidebar.js"), "utf8");
    expect(src).toContain("aggregateBrandAssetSlots");
    expect(src).toContain("showSection");
  });

  it("print-area tab persists brand assets in config save + dirty snapshot", () => {
    const src = readFileSync(join(portal, "tabs/print-area.js"), "utf8");
    expect(src).toContain("cfg.brand_assets_mode");
    expect(src).toContain("cfg.brand_assets");
    expect(src).toContain("brandAssetsMode:");
    expect(src).toContain("resolveEffectiveBrandAssets");
    expect(src).toContain("setBrandAssets");
  });

  it("view dock uses st.viewKeys only", () => {
    const src = readFileSync(join(portal, "print-area/view-dock.js"), "utf8");
    expect(src).toContain("(st.viewKeys || [])");
  });

  it("backend exposes product-scoped brand asset upload", () => {
    const router = readFileSync(join(root, "src/features/manufacturers/manufacturerRouter.js"), "utf8");
    const ext = readFileSync(
      join(root, "src/features/manufacturers/partnerCatalog/editor/partnerEditorExtensions.js"),
      "utf8"
    );
    expect(router).toContain("admin-eazpire-product-brand-asset-upload");
    expect(ext).toContain("export async function uploadProductBrandAsset");
    expect(ext).toContain("Brand Assets/products/");
  });
});
