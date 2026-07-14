/**
 * Resolve which print providers are active for a product (provider tab + subnav).
 * Primary source: active_providers table rows. Fallbacks when table is empty/out of sync.
 *
 * Numeric Printify ids stay numbers. Opaque partner ids (Todify "ma-1") stay strings —
 * never coerce trailing digits (ma-1 → 1), which breaks matching and saves.
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

/** @returns {number|string|null} */
export function normalizeProviderId(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0 && String(n) === s) return n;
  // Opaque partner ids (e.g. Todify ma-1)
  if (/^[a-z][\w.-]*$/i.test(s)) return s;
  return null;
}

function rowPrintProviderId(row) {
  if (row == null) return null;
  if (typeof row === "number" || typeof row === "string") return normalizeProviderId(row);
  return normalizeProviderId(row.print_provider_id ?? row.provider_id ?? row.external_provider_id);
}

function mergedRowPid(row) {
  return normalizeProviderId(row?.print_provider_id ?? row?.catalogData?.id ?? row?.external_provider_id);
}

/**
 * @param {object} data
 * @param {Array} [data.active_providers]
 * @param {Array} [data.merged_providers]
 * @param {Array} [data.publish_plans]
 * @param {Array} [data.versions]
 * @returns {Set<number|string>}
 */
export function resolveActivePrintProviderIds(data = {}) {
  const ids = new Set();

  const versionIds = [];
  for (const v of data.versions || []) {
    const pid = normalizeProviderId(v.external_provider_id);
    if (pid != null) versionIds.push(pid);
  }
  // Partner versions (Todify ma-1) win over orphan Printify numerics from name-match / active table.
  const hasOpaqueVersion = versionIds.some((id) => typeof id === "string");
  if (hasOpaqueVersion) {
    for (const pid of versionIds) ids.add(pid);
    return ids;
  }

  for (const row of data.active_providers || []) {
    const pid = rowPrintProviderId(row);
    if (pid != null) ids.add(pid);
  }
  if (ids.size) return ids;

  for (const row of data.merged_providers || []) {
    if (row?.type !== "configured") continue;
    const pid = mergedRowPid(row);
    if (pid == null) continue;
    if (row.is_enabled) ids.add(pid);
  }
  if (ids.size) return ids;

  for (const plan of data.publish_plans || []) {
    if (!publishPlanIsEnabled(plan)) continue;
    const profile = plan.profile;
    if (profile && !publishProfileIsActive(profile)) continue;
    const pid = normalizeProviderId(profile?.print_provider_id ?? plan.print_provider_id);
    if (pid != null) ids.add(pid);
  }
  if (ids.size) return ids;

  for (const pid of versionIds) ids.add(pid);

  return ids;
}
