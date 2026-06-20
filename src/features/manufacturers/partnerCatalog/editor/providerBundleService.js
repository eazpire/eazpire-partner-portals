/**
 * Partner product editor provider merge helpers (ES module port).
 */

const COUNTRY_TO_REGION = {
  US: "US",
  CA: "CA",
  GB: "UK",
  UK: "UK",
  AU: "AU",
  DE: "EU",
  FR: "EU",
  IT: "EU",
  ES: "EU",
  NL: "EU",
  BE: "EU",
  AT: "EU",
  CH: "EU",
  PL: "EU",
  CZ: "EU",
  SE: "EU",
  DK: "EU",
  FI: "EU",
  NO: "EU",
  IE: "EU",
  PT: "EU",
  GR: "EU",
  HU: "EU",
  RO: "EU",
  BG: "EU",
  HR: "EU",
  SK: "EU",
  SI: "EU",
  LT: "EU",
  LV: "EU",
  EE: "EU",
  LU: "EU",
  MT: "EU",
  CY: "EU",
};

export function countryToRegion(countryCode) {
  if (!countryCode) return "Other";
  return COUNTRY_TO_REGION[String(countryCode).trim().toUpperCase()] || "Other";
}

function resolveProviderRegion(catalogData, dbLocation) {
  if (catalogData?.location?.country) return countryToRegion(catalogData.location.country);
  if (dbLocation) {
    const cc = String(dbLocation).split(/\s*\/\s*/)[0]?.trim()?.toUpperCase();
    if (COUNTRY_TO_REGION[cc]) return COUNTRY_TO_REGION[cc];
    if (["EU", "US", "UK", "CA", "AU"].includes(cc)) return cc;
  }
  return "Other";
}

function resolveProviderLocationLabel(catalogData) {
  if (!catalogData?.location) return null;
  const c = catalogData.location.country;
  const city = catalogData.location.city;
  if (!c) return null;
  return city ? `${c} / ${city}` : c;
}

export function publishPlanIsEnabled(plan) {
  if (plan == null) return false;
  const v = plan.is_enabled;
  if (v == null) return true;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "1" || t === "true") return true;
    if (t === "0" || t === "false" || t === "") return false;
  }
  const n = Number(v);
  if (n === 1) return true;
  if (n === 0) return false;
  return !!v;
}

export function publishProfileIsActive(profile) {
  if (!profile) return false;
  const v = profile.is_active;
  if (v == null) return true;
  if (v === false || v === 0) return false;
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "0" || t === "false") return false;
    if (t === "1" || t === "true") return true;
  }
  return Number(v) !== 0;
}

export function publishPlanIsLiveForPublish(plan, mergedRow) {
  if (!publishPlanIsEnabled(plan)) return false;
  const pp =
    mergedRow?.print_provider_id != null && mergedRow?.print_provider_id !== ""
      ? mergedRow.print_provider_id
      : plan?.profile?.print_provider_id;
  if (pp == null || pp === "") return false;
  if (plan?.profile) return publishProfileIsActive(plan.profile);
  return true;
}

export function resolveDisplayProviderName(planOrMapName, catalogTitle) {
  const plan = planOrMapName != null ? String(planOrMapName).trim() : "";
  const catalog = catalogTitle != null ? String(catalogTitle).trim() : "";
  if (!plan) return catalog || "Unknown";
  if (!catalog) return plan;
  if (/^\[Template\]/i.test(plan)) return catalog;
  return plan;
}

export function mergeProviders(dbPlans = [], catalogProviders = [], activePrintProviderIds = null) {
  const merged = [];
  const seen = new Set();

  let idsForTable = activePrintProviderIds;
  if (Array.isArray(idsForTable) && idsForTable.length === 0) idsForTable = null;
  const activeSet = new Set(
    Array.isArray(idsForTable)
      ? idsForTable.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : []
  );
  const useActiveTable = idsForTable != null;

  for (const plan of dbPlans || []) {
    let ppId = plan?.profile?.print_provider_id;
    let catMatch = null;
    let usedNameFallback = false;
    const hadPpIdOnProfile = !!(plan?.profile?.print_provider_id != null && plan?.profile?.print_provider_id !== "");

    if (ppId != null && ppId !== "") {
      seen.add(Number(ppId));
      catMatch = (catalogProviders || []).find((cp) => String(cp.id) === String(ppId)) || null;
    } else if (plan?.provider_name) {
      const nameLc = String(plan.provider_name).trim().toLowerCase();
      catMatch =
        (catalogProviders || []).find(
          (cp) => String(cp?.title || "").trim().toLowerCase() === nameLc
        ) || null;
      if (catMatch?.id != null) {
        ppId = catMatch.id;
        usedNameFallback = true;
        seen.add(Number(ppId));
      }
    }

    if (usedNameFallback && !hadPpIdOnProfile) {
      console.warn(
        `[providerBundleService] name-only provider match (plan ${plan?.id || "n/a"}: ${plan?.provider_name || ""})`
      );
    }

    const rowEnabled = useActiveTable
      ? ppId != null && ppId !== "" && activeSet.has(Number(ppId))
      : publishPlanIsEnabled(plan);

    merged.push({
      type: "configured",
      id: plan?.id,
      print_provider_id: ppId,
      name: resolveDisplayProviderName(plan?.provider_name, catMatch?.title),
      region: resolveProviderRegion(catMatch, plan?.provider_location),
      locationLabel: resolveProviderLocationLabel(catMatch) || plan?.provider_location || "",
      locationDetail: catMatch?.location || null,
      is_enabled: rowEnabled,
      dbPlan: plan,
      catalogData: catMatch,
      profile: plan?.profile || null,
    });
  }

  for (const cp of catalogProviders || []) {
    if (seen.has(Number(cp?.id))) continue;
    const cpNum = Number(cp?.id);
    const rowOn = useActiveTable && Number.isFinite(cpNum) ? activeSet.has(cpNum) : false;
    merged.push({
      type: "available",
      id: `new_${cp?.id}`,
      print_provider_id: cp?.id,
      name: cp?.title || `Provider #${cp?.id}`,
      region: resolveProviderRegion(cp, null),
      locationLabel: resolveProviderLocationLabel(cp) || "",
      locationDetail: cp?.location || null,
      is_enabled: rowOn,
      dbPlan: null,
      catalogData: cp,
      profile: null,
    });
  }

  return merged;
}

/** Map Printify global catalog print_providers.json by numeric id. */
export function buildPrintProviderCatalogMap(catalogProviders) {
  const map = new Map();
  for (const p of catalogProviders || []) {
    const id = Number(p?.id);
    if (Number.isFinite(id) && id > 0) map.set(id, p);
  }
  return map;
}

/** Attach location from global Printify catalog when blueprint list omits it. */
export function enrichBlueprintProviderWithCatalog(bp, catalogById) {
  if (!bp || !catalogById?.size) return bp;
  const global = catalogById.get(Number(bp.id));
  if (!global?.location) return bp;
  return {
    ...bp,
    location: bp.location || global.location,
    title: bp.title || global.title,
  };
}

export function enrichProviderRowWithCatalog(row, catalogById) {
  if (!row || !catalogById?.size) return row;
  const pid = Number(row.print_provider_id);
  if (!Number.isFinite(pid)) return row;
  const global = catalogById.get(pid);
  if (!global?.location) return row;

  const location = global.location;
  const locationLabel = resolveProviderLocationLabel(global) || row.locationLabel || "";
  const region = resolveProviderRegion(global, row.dbPlan?.provider_location);

  const catalogData = row.catalogData?.location
    ? row.catalogData
    : {
        ...(row.catalogData || {}),
        id: row.catalogData?.id ?? global.id,
        title: row.catalogData?.title ?? global.title,
        location,
      };

  return {
    ...row,
    region,
    locationLabel,
    locationDetail: location,
    catalogData,
  };
}
