/**
 * Compare catalog-db (ops truth) vs MANUFACTURER_DB legacy master rows.
 */

const IS_ACTIVE_TO_CATALOG_STATUS = { 0: "offline", 1: "preview", 2: "online" };

export function isActiveToCatalogStatus(isActive) {
  const n = Number(isActive);
  return IS_ACTIVE_TO_CATALOG_STATUS[n] ?? "offline";
}

export function sortedUniqueIds(ids) {
  return [...new Set((ids || []).map((v) => Number(v)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
}

function arrayDiff(a, b) {
  const setB = new Set(b);
  return a.filter((x) => !setB.has(x));
}

export function compareProductOpsBaseline(productKey, catalog, manufacturer) {
  const issues = [];

  if (!catalog?.product) {
    issues.push({
      type: "missing_in_catalog_db",
      severity: "error",
      message: "Online product missing from catalog-db product_catalog",
    });
    return { product_key: productKey, issues, sync_ok: false, catalog_complete: false };
  }

  const catActive = sortedUniqueIds(catalog.activeProviderIds);
  const mfgActive = sortedUniqueIds(manufacturer?.activeProviderIds);
  const catPat = Number(catalog.patCount) || 0;
  const mfgPat = Number(manufacturer?.patCount) || 0;
  const catProfiles = Number(catalog.publishProfileCount) || 0;
  const mfgProfiles = Number(manufacturer?.publishProfileCount) || 0;
  const catPlans = Number(catalog.publishPlanCount) || 0;
  const mfgPlans = Number(manufacturer?.publishPlanCount) || 0;

  if (!manufacturer?.product) {
    issues.push({
      type: "missing_in_manufacturer_db",
      severity: "info",
      message: "No eazpire_products row — OK after pivot",
    });
  } else {
    const expectedStatus = isActiveToCatalogStatus(catalog.product.is_active);
    const mfgStatus = String(manufacturer.product.catalog_status || "offline").toLowerCase();
    if (mfgStatus !== expectedStatus) {
      issues.push({
        type: "status_mismatch",
        severity: "warning",
        catalog_wins: expectedStatus,
        manufacturer: mfgStatus,
      });
    }
  }

  if (catActive.length !== mfgActive.length || catActive.some((id, i) => id !== mfgActive[i])) {
    issues.push({
      type: "active_providers_mismatch",
      severity: "warning",
      catalog_wins: catActive,
      manufacturer: mfgActive,
      only_in_catalog: arrayDiff(catActive, mfgActive),
      only_in_manufacturer: arrayDiff(mfgActive, catActive),
    });
  }

  if (catPat !== mfgPat) {
    issues.push({ type: "pat_count_mismatch", severity: "warning", catalog_wins: catPat, manufacturer: mfgPat });
  }
  if (catProfiles !== mfgProfiles) {
    issues.push({
      type: "publish_profiles_count_mismatch",
      severity: "warning",
      catalog_wins: catProfiles,
      manufacturer: mfgProfiles,
    });
  }
  if (catPlans !== mfgPlans) {
    issues.push({
      type: "publish_plans_count_mismatch",
      severity: "warning",
      catalog_wins: catPlans,
      manufacturer: mfgPlans,
    });
  }

  const catalogCompleteIssues = [];
  if (catPat === 0) catalogCompleteIssues.push("pat");
  if (catActive.length === 0) catalogCompleteIssues.push("active_providers");
  if (catProfiles === 0) catalogCompleteIssues.push("publish_profiles");

  if (catalogCompleteIssues.length) {
    issues.push({
      type: "catalog_incomplete",
      severity: "error",
      missing: catalogCompleteIssues,
    });
  }

  const syncBlocking = issues.filter(
    (i) =>
      i.type === "active_providers_mismatch" ||
      i.type === "pat_count_mismatch" ||
      i.type === "status_mismatch" ||
      i.type === "publish_profiles_count_mismatch" ||
      i.type === "publish_plans_count_mismatch"
  );

  return {
    product_key: productKey,
    issues,
    sync_ok: syncBlocking.length === 0,
    catalog_complete: catalogCompleteIssues.length === 0,
    counts: {
      catalog: {
        active_providers: catActive.length,
        pat: catPat,
        publish_profiles: catProfiles,
        publish_plans: catPlans,
      },
      manufacturer: {
        active_providers: mfgActive.length,
        pat: mfgPat,
        publish_profiles: mfgProfiles,
        publish_plans: mfgPlans,
      },
    },
  };
}

export function summarizeBaselineReport(products) {
  const total = products.length;
  const syncOk = products.filter((p) => p.sync_ok).length;
  return {
    total_online_products: total,
    sync_ok: syncOk,
    sync_conflicts: total - syncOk,
    catalog_complete: products.filter((p) => p.catalog_complete).length,
    catalog_incomplete: products.filter((p) => !p.catalog_complete).length,
    missing_in_manufacturer_db: products.filter((p) => p.issues.some((i) => i.type === "missing_in_manufacturer_db"))
      .length,
    active_providers_mismatches: products.filter((p) =>
      p.issues.some((i) => i.type === "active_providers_mismatch")
    ).length,
  };
}
