/**
 * Feature flag: catalog-db as ops read source (Phase 2+).
 * Set CATALOG_OPS_MASTER_READ=1 on partner worker.
 */
export function isCatalogOpsMasterRead(env) {
  const v = env?.CATALOG_OPS_MASTER_READ;
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
