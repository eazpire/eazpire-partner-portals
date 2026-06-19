/**
 * Partner catalog admin ops — orchestration
 */

export { listPartnersForAdmin, getPartnerByIdOrSlug, ensurePrintifyPartner } from "./printifyPartnerSeed.js";
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

export async function runFullPrintifyPartnerSetup(env) {
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
}
