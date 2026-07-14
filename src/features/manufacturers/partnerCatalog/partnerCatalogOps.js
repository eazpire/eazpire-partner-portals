/**
 * Partner catalog admin ops — orchestration
 */

export { listPartnersForAdmin, getPartnerByIdOrSlug, ensurePrintifyPartner } from "./printifyPartnerSeed.js";
export { ensureTodifyPartner, ensureTodifyPartnerSetup } from "./todifyPartnerSeed.js";
export { listFulfillmentProviders, getFulfillmentProviderById } from "./fulfillmentProviderService.js";
export { listEazpireProducts, getEazpireProduct, upsertEazpireProduct, updateEazpireProduct } from "./eazpireProductService.js";
export {
  listProductVersions,
  getProductVersion,
  upsertProductVersion,
  updateProductVersion,
} from "./eazpireProductVersionService.js";
export { importOnlineProductsFromCatalogDb } from "./importFromCatalogDb.js";
export {
  mirrorEazpireProductToCatalogDb,
  mirrorAllEazpireProductsToCatalogDb,
  getCatalogMirrorDriftStatus,
} from "./mirrorToCatalogDb.js";
export {
  importShadowTablesForProduct,
  importShadowTablesFromCatalogDb,
} from "./shadow/shadowImportFromCatalogDb.js";
export {
  mirrorShadowTablesForProduct,
  mirrorShadowTablesToCatalogDb,
} from "./shadow/shadowMirrorToCatalogDb.js";
export { getCatalogDriftV2ForProduct, getCatalogDriftV2Status } from "./shadow/catalogDriftV2.js";

export async function runFullPrintifyPartnerSetup(env) {
  if (!env.MANUFACTURER_DB) {
    return { ok: false, error: "manufacturer_db_unavailable" };
  }
  if (!env.CATALOG_DB) {
    return {
      ok: false,
      error: "catalog_db_unavailable",
      hint: "Partner worker needs CATALOG_DB binding to catalog-db (see wrangler-partner.toml).",
    };
  }

  const { getPrintifyApiKey, PARTNER_PRINTIFY_API_KEY_MISSING_HINT } = await import("../../../utils/printifyEnv.js");
  if (!getPrintifyApiKey(env)) {
    return {
      ok: false,
      error: "printify_api_key_not_configured",
      hint: PARTNER_PRINTIFY_API_KEY_MISSING_HINT,
    };
  }

  try {
    const { syncPrintifyPartnerCatalog } = await import("../adapters/printify/printifyCatalogSync.js");
    const syncResult = await syncPrintifyPartnerCatalog(env);
    if (!syncResult.ok) return syncResult;

    const { importOnlineProductsFromCatalogDb } = await import("./importFromCatalogDb.js");
    const importResult = await importOnlineProductsFromCatalogDb(env);
    if (!importResult.ok) return { ok: false, error: importResult.error, sync: syncResult };

    return {
      ok: true,
      sync: syncResult,
      import: importResult,
    };
  } catch (err) {
    console.error("[runFullPrintifyPartnerSetup]", err);
    return { ok: false, error: "sync_failed", detail: String(err?.message || err) };
  }
}
