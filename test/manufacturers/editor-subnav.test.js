import { describe, it, expect } from "vitest";
import { getSubnavVisibility } from "../../admin-partner-portal/js/catalog-editor/editor-subnav.js";

describe("getSubnavVisibility", () => {
  const baseCtx = {
    activeTab: "template",
    selectedPrintProviderId: "99",
    bundle: {
      active_providers: [{ print_provider_id: 99 }],
      versions: [{ id: 1, external_provider_id: 99, sort_order: 0 }],
    },
  };

  it("hides provider bar on non-print-area tabs with a single provider", () => {
    const v = getSubnavVisibility(baseCtx);
    expect(v.showProviders).toBe(false);
    expect(v.showStack).toBe(false);
  });

  it("shows provider bar on print_area tab with a single provider", () => {
    const v = getSubnavVisibility({ ...baseCtx, activeTab: "print_area" });
    expect(v.showProviders).toBe(true);
    expect(v.showStack).toBe(true);
    expect(v.providerIds).toEqual(["99"]);
  });

  it("shows provider bar on any tab when multiple providers exist", () => {
    const ctx = {
      ...baseCtx,
      bundle: {
        ...baseCtx.bundle,
        active_providers: [
          { print_provider_id: 99 },
          { print_provider_id: 100 },
        ],
      },
    };
    const v = getSubnavVisibility(ctx);
    expect(v.showProviders).toBe(true);
    expect(v.showStack).toBe(true);
  });
});
