import { describe, it, expect } from "vitest";
import { mergeProviders } from "../../src/features/manufacturers/partnerCatalog/editor/providerBundleService.js";

describe("mergeProviders", () => {
  it("does not name-match Todify plans against Printify catalog providers", () => {
    const plans = [
      {
        id: 1,
        provider_name: "Todify",
        is_enabled: 1,
        profile: { source_system: "todify", print_provider_id: null, is_active: 1 },
      },
    ];
    const catalogProviders = [{ id: 93, title: "Todify", location: { country: "US" } }];
    const merged = mergeProviders(plans, catalogProviders, null);
    const configured = merged.find((r) => r.type === "configured");
    expect(configured).toBeTruthy();
    expect(configured.print_provider_id == null || configured.print_provider_id === "").toBe(true);
    expect(configured.catalogData).toBeNull();
  });

  it("still name-matches Printify plans missing print_provider_id", () => {
    const plans = [
      {
        id: 2,
        provider_name: "Monster Digital",
        is_enabled: 1,
        profile: { source_system: "printify", print_provider_id: null, is_active: 1 },
      },
    ];
    const catalogProviders = [{ id: 6, title: "Monster Digital", location: { country: "US" } }];
    const merged = mergeProviders(plans, catalogProviders, null);
    const configured = merged.find((r) => r.type === "configured");
    expect(configured.print_provider_id).toBe(6);
  });
});
