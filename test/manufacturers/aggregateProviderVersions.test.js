import { describe, it, expect } from "vitest";
import {
  aggregateProviderVersions,
  emptyProviderVersionSummary,
} from "../../src/features/manufacturers/partnerCatalog/aggregateProviderVersions.js";

describe("aggregateProviderVersions", () => {
  it("returns empty when nothing is activated", () => {
    expect(aggregateProviderVersions({})).toEqual(emptyProviderVersionSummary());
  });

  it("counts activated providers, not PAT rows, as Provider", () => {
    const summary = aggregateProviderVersions({
      activeProviders: [{ print_provider_id: 99, name: "Printify Choice" }],
      patRows: [
        { print_provider_id: 99, is_active: 1, display_name: "Hoodie" },
        { print_provider_id: 26, is_active: 1, display_name: "Hoodie Textildruck" },
      ],
    });
    expect(summary.provider_count).toBe(1);
    expect(summary.providers.map((p) => p.id)).toEqual(["99"]);
    expect(summary.version_count).toBe(1);
  });

  it("treats two provider templates as Provider=2 Versions=1", () => {
    const summary = aggregateProviderVersions({
      activeProviders: [
        { print_provider_id: 99, name: "Printify Choice" },
        { print_provider_id: 26, name: "Textildruck Europa" },
      ],
      patRows: [
        { print_provider_id: 99, is_active: 1 },
        { print_provider_id: 26, is_active: 1 },
      ],
    });
    expect(summary.provider_count).toBe(2);
    expect(summary.version_count).toBe(1);
  });

  it("counts true versions under one provider", () => {
    const summary = aggregateProviderVersions({
      activeProviders: [{ print_provider_id: 99, name: "Printify Choice" }],
      patRows: [
        { print_provider_id: 99, is_active: 1, sort_order: 0 },
        { print_provider_id: 99, is_active: 1, sort_order: 1 },
      ],
    });
    expect(summary.provider_count).toBe(1);
    expect(summary.version_count).toBe(2);
  });

  it("ignores inactive PAT leftovers on a hidden provider", () => {
    const summary = aggregateProviderVersions({
      activeProviders: [{ print_provider_id: 99, name: "Printify Choice" }],
      patRows: [
        { print_provider_id: 99, is_active: 1 },
        { print_provider_id: 26, is_active: 0 },
      ],
    });
    expect(summary.provider_count).toBe(1);
    expect(summary.version_count).toBe(1);
  });

  it("falls back to manufacturer versions when there are no PAT rows", () => {
    const summary = aggregateProviderVersions({
      activeProviders: [{ print_provider_id: "ma-1", name: "KNL print" }],
      patRows: [],
      versionRows: [
        { external_provider_id: "ma-1", is_active: 1 },
        { external_provider_id: "ma-1", is_active: 1 },
      ],
    });
    expect(summary.provider_count).toBe(1);
    expect(summary.version_count).toBe(2);
  });
});
