/**
 * Catalog Studio overview: activated providers vs true product versions.
 * Provider = rows in product_active_print_providers (ON), not PAT count.
 * Versions = max active version rows under one provider — not “one PAT per print provider”.
 */

function asActive(row) {
  if (row == null) return false;
  if (row.is_active === 0 || row.is_active === false || row.is_active === "0") return false;
  return true;
}

function providerIdOf(row) {
  if (!row || typeof row !== "object") return "";
  const raw = row.print_provider_id ?? row.external_provider_id ?? row.id;
  return raw == null ? "" : String(raw).trim();
}

export function emptyProviderVersionSummary() {
  return {
    provider_count: 0,
    providers: [],
    version_count: 0,
  };
}

/**
 * @param {object} [row]
 * @returns {{ id: string, name: string, logo_url: string|null }}
 */
export function normalizeProviderLabel(row) {
  const id = providerIdOf(row);
  const name = String(row?.name || row?.title || "").trim() || (id ? `Provider ${id}` : "Provider");
  const logo = row?.logo_url || row?.logoUrl || null;
  return {
    id,
    name,
    logo_url: typeof logo === "string" && logo.trim() ? logo.trim() : null,
  };
}

function countVersionsByProvider(rows, allowedIds) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!asActive(row)) continue;
    const pid = providerIdOf(row);
    if (!pid) continue;
    if (allowedIds && allowedIds.size && !allowedIds.has(pid)) continue;
    groups.set(pid, (groups.get(pid) || 0) + 1);
  }
  let max = 0;
  for (const n of groups.values()) if (n > max) max = n;
  return max;
}

/**
 * @param {object} input
 * @param {object[]} [input.activeProviders] — product_active_print_providers (+ names)
 * @param {object[]} [input.patRows] — print_area_printify_templates
 * @param {object[]} [input.versionRows] — eazpire_product_versions fallback (Todify / no PAT)
 * @returns {{ provider_count: number, providers: object[], version_count: number }}
 */
export function aggregateProviderVersions({ activeProviders = [], patRows = [], versionRows = [] } = {}) {
  const providers = (activeProviders || [])
    .map(normalizeProviderLabel)
    .filter((p) => p.id)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const allowedIds = new Set(providers.map((p) => p.id));
  const restrict = allowedIds.size > 0;
  const fromPat = countVersionsByProvider(patRows, restrict ? allowedIds : null);
  const fromVer = fromPat > 0 ? 0 : countVersionsByProvider(versionRows, restrict ? allowedIds : null);
  const version_count = fromPat || fromVer || 0;

  return {
    provider_count: providers.length,
    providers,
    version_count,
  };
}
