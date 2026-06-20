/**
 * Feature flags: catalog-db as ops master (Phase 2 read, Phase 3 write).
 * Set CATALOG_OPS_MASTER_READ / CATALOG_OPS_MASTER_WRITE on partner worker.
 */

function flagTruthy(env, key) {
  const v = env?.[key];
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export function isCatalogOpsMasterRead(env) {
  return flagTruthy(env, "CATALOG_OPS_MASTER_READ");
}

export function isCatalogOpsMasterWrite(env) {
  return flagTruthy(env, "CATALOG_OPS_MASTER_WRITE");
}

/** True when editor should use catalog-db for reads or writes (shared routing). */
export function shouldUseCatalogOps(env) {
  return isCatalogOpsMasterRead(env) || isCatalogOpsMasterWrite(env);
}
