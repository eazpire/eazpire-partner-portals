import { describe, expect, it } from "vitest";
import {
  compareProductOpsBaseline,
  summarizeBaselineReport,
  sortedUniqueIds,
} from "../../scripts/manufacturer/reconcile-catalog-ops-compare.mjs";

describe("reconcile-catalog-ops-compare", () => {
  it("sortedUniqueIds dedupes and sorts", () => {
    expect(sortedUniqueIds([99, 26, 26, "42"])).toEqual([26, 42, 99]);
  });

  it("sync_ok when catalog and manufacturer match", () => {
    const catalog = {
      product: { is_active: 2 },
      activeProviderIds: [26, 99],
      patCount: 2,
      publishProfileCount: 2,
      publishPlanCount: 1,
    };
    const manufacturer = {
      product: { catalog_status: "online" },
      activeProviderIds: [99, 26],
      patCount: 2,
      publishProfileCount: 2,
      publishPlanCount: 1,
    };
    const r = compareProductOpsBaseline("test-tee", catalog, manufacturer);
    expect(r.sync_ok).toBe(true);
    expect(r.catalog_complete).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("flags active_providers_mismatch when editor would differ from publish", () => {
    const catalog = {
      product: { is_active: 2 },
      activeProviderIds: [26, 99],
      patCount: 1,
      publishProfileCount: 1,
      publishPlanCount: 1,
    };
    const manufacturer = {
      product: { catalog_status: "online" },
      activeProviderIds: [],
      patCount: 0,
      publishProfileCount: 0,
      publishPlanCount: 0,
    };
    const r = compareProductOpsBaseline("test-tee", catalog, manufacturer);
    expect(r.sync_ok).toBe(false);
    expect(r.issues.some((i) => i.type === "active_providers_mismatch")).toBe(true);
    expect(r.issues.find((i) => i.type === "active_providers_mismatch").only_in_catalog).toEqual([26, 99]);
  });

  it("catalog_incomplete when online product has no active providers in catalog-db", () => {
    const catalog = {
      product: { is_active: 2 },
      activeProviderIds: [],
      patCount: 1,
      publishProfileCount: 1,
      publishPlanCount: 0,
    };
    const r = compareProductOpsBaseline("x", catalog, null);
    expect(r.catalog_complete).toBe(false);
    expect(r.issues.some((i) => i.type === "catalog_incomplete")).toBe(true);
  });

  it("summarizeBaselineReport aggregates counts", () => {
    const summary = summarizeBaselineReport([
      { sync_ok: true, catalog_complete: true, issues: [] },
      { sync_ok: false, catalog_complete: true, issues: [{ severity: "warning" }] },
    ]);
    expect(summary.total_online_products).toBe(2);
    expect(summary.sync_ok).toBe(1);
    expect(summary.sync_conflicts).toBe(1);
  });
});
