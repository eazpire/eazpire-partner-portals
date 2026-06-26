/**
 * Resolve which print providers are active for a product (provider tab + subnav).
 * Primary source: active_providers table rows. Fallbacks when table is empty/out of sync.
 */

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

function rowPrintProviderId(row) {
  if (row == null) return NaN;
  if (typeof row === "number" || typeof row === "string") return Number(row);
  return Number(row.print_provider_id ?? row.provider_id ?? row.external_provider_id);
}

function mergedRowPid(row) {
  return Number(row?.print_provider_id ?? row?.catalogData?.id ?? row?.external_provider_id);
}

/**
 * @param {object} data
 * @param {Array} [data.active_providers]
 * @param {Array} [data.merged_providers]
 * @param {Array} [data.publish_plans]
 * @param {Array} [data.versions]
 * @returns {Set<number>}
 */
export function resolveActivePrintProviderIds(data = {}) {
  const ids = new Set();

  for (const row of data.active_providers || []) {
    const pid = rowPrintProviderId(row);
    if (Number.isFinite(pid) && pid > 0) ids.add(pid);
  }
  if (ids.size) return ids;

  for (const row of data.merged_providers || []) {
    if (row?.type !== "configured") continue;
    const pid = mergedRowPid(row);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (row.is_enabled) ids.add(pid);
  }
  if (ids.size) return ids;

  for (const plan of data.publish_plans || []) {
    if (!publishPlanIsEnabled(plan)) continue;
    const profile = plan.profile;
    if (profile && !publishProfileIsActive(profile)) continue;
    const pid = Number(profile?.print_provider_id ?? plan.print_provider_id);
    if (Number.isFinite(pid) && pid > 0) ids.add(pid);
  }
  if (ids.size) return ids;

  for (const v of data.versions || []) {
    const pid = Number(v.external_provider_id);
    if (Number.isFinite(pid) && pid > 0) ids.add(pid);
  }

  return ids;
}
