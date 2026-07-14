import { describe, it, expect } from "vitest";
import { resolveActivePrintProviderIds } from "../../admin-partner-portal/js/catalog-editor/active-provider-ids.js";

describe("resolveActivePrintProviderIds", () => {
  it("prefers active_providers table", () => {
    const ids = resolveActivePrintProviderIds({
      active_providers: [{ print_provider_id: 99 }, { print_provider_id: 30 }],
      merged_providers: [{ type: "configured", print_provider_id: 331, is_enabled: true }],
    });
    expect([...ids].sort()).toEqual([30, 99]);
  });

  it("falls back to configured merged rows when active table empty", () => {
    const ids = resolveActivePrintProviderIds({
      active_providers: [],
      merged_providers: [
        { type: "configured", print_provider_id: 99, is_enabled: true },
        { type: "configured", print_provider_id: 30, is_enabled: true },
        { type: "available", print_provider_id: 331, is_enabled: false },
      ],
    });
    expect([...ids].sort()).toEqual([30, 99]);
  });

  it("falls back to enabled publish plans with active profiles", () => {
    const ids = resolveActivePrintProviderIds({
      active_providers: [],
      publish_plans: [
        { is_enabled: 1, profile: { print_provider_id: 99, is_active: 1 } },
        { is_enabled: 0, profile: { print_provider_id: 331, is_active: 1 } },
      ],
    });
    expect([...ids]).toEqual([99]);
  });

  it("falls back to version external_provider_id", () => {
    const ids = resolveActivePrintProviderIds({
      active_providers: [],
      versions: [
        { external_provider_id: 99 },
        { external_provider_id: 30 },
      ],
    });
    expect([...ids].sort()).toEqual([30, 99]);
  });

  it("keeps opaque partner ids like Todify ma-1 (no trailing-digit coerce)", () => {
    const ids = resolveActivePrintProviderIds({
      active_providers: [],
      versions: [{ external_provider_id: "ma-1" }],
    });
    expect([...ids]).toEqual(["ma-1"]);
  });
});
