import { describe, it, expect } from "vitest";
import {
  getSubnavVisibility,
  getActiveProviderIds,
} from "../../admin-partner-portal/js/catalog-editor/editor-subnav.js";

describe("getActiveProviderIds", () => {
  it("reads active_providers from bundle first", () => {
    const ids = getActiveProviderIds({
      bundle: { active_providers: [{ print_provider_id: 99 }] },
    });
    expect(ids).toEqual(["99"]);
  });

  it("falls back to providers tab state when bundle active list is empty", () => {
    const ids = getActiveProviderIds({
      bundle: { active_providers: [] },
      providersTabState: { activeIds: new Set([99, 331]) },
    });
    expect(ids).toEqual(["99", "331"]);
  });

  it("falls back to publish plans and versions when no tab state", () => {
    const ids = getActiveProviderIds({
      bundle: {
        active_providers: [],
        versions: [{ external_provider_id: 99 }, { external_provider_id: 30 }],
      },
    });
    expect(ids).toEqual(["99", "30"]);
  });
});

describe("getSubnavVisibility", () => {
  const baseCtx = {
    activeTab: "template",
    selectedPrintProviderId: "99",
    bundle: {
      active_providers: [{ print_provider_id: 99 }],
      versions: [{ id: 1, external_provider_id: 99, sort_order: 0 }],
    },
  };

  it("shows provider bar with a single active provider on template tab", () => {
    const v = getSubnavVisibility(baseCtx);
    expect(v.showProviders).toBe(true);
    expect(v.showStack).toBe(true);
    expect(v.providerIds).toEqual(["99"]);
  });

  it("shows provider bar on print_area tab with a single provider", () => {
    const v = getSubnavVisibility({ ...baseCtx, activeTab: "print_area" });
    expect(v.showProviders).toBe(true);
    expect(v.showStack).toBe(true);
  });

  it("shows provider bar when multiple providers exist", () => {
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
