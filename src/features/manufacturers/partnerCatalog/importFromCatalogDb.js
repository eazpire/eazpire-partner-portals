/**
 * Import online products from catalog-db into MANUFACTURER_DB master
 */

import { resolveBlueprintIdForProductKey } from "../../../utils/resolveBlueprintForProductKey.js";
import { isActiveToCatalogStatus, PRINTIFY_PARTNER_ID } from "./constants.js";
import { ensurePrintifyPartner } from "./printifyPartnerSeed.js";
import { getFulfillmentProviderByExternalId } from "./fulfillmentProviderService.js";
import { upsertEazpireProduct } from "./eazpireProductService.js";
import {
  upsertProductVersion,
  patRowToStudioConfig,
  patRowToAutoPublishConfig,
} from "./eazpireProductVersionService.js";
import { parseJson } from "../db.js";
import { importShadowTablesForProduct } from "./shadow/shadowImportFromCatalogDb.js";

async function findEazpireBlueprintIdForPrintifyBlueprint(db, manufacturerId, blueprintId) {
  const row = await db
    .prepare(
      `SELECT eb.id FROM manufacturer_eazpire_blueprints eb
       JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
       WHERE eb.manufacturer_id = ? AND pb.external_blueprint_id = ?
       LIMIT 1`
    )
    .bind(manufacturerId, String(blueprintId))
    .first();
  return row?.id || null;
}

export async function importOnlineProductsFromCatalogDb(env) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const partnerId = await ensurePrintifyPartner(mfgDb);
  const products = await catalogDb.prepare(`SELECT * FROM product_catalog WHERE is_active = 2`).all();
  const imported = [];

  for (const row of products?.results || []) {
    const productKey = row.product_key;
    const blueprintId = await resolveBlueprintIdForProductKey(env, productKey);
    const sourceBlueprintId = blueprintId
      ? await findEazpireBlueprintIdForPrintifyBlueprint(mfgDb, partnerId, blueprintId)
      : null;

    let regions = [];
    try {
      regions = JSON.parse(row.regions_json || "[]");
    } catch {
      regions = [];
    }
    let visibleDesignTypes = null;
    try {
      const parsed = JSON.parse(row.visible_design_types_json || "null");
      if (Array.isArray(parsed) && parsed.length) visibleDesignTypes = parsed;
    } catch {
      visibleDesignTypes = null;
    }

    await upsertEazpireProduct(mfgDb, {
      product_key: productKey,
      manufacturer_id: partnerId,
      source_blueprint_id: sourceBlueprintId,
      title: row.title,
      regions,
      catalog_status: isActiveToCatalogStatus(row.is_active),
      visible_design_types: visibleDesignTypes,
      catalog_category_group: row.catalog_category_group,
      catalog_category_leaf: row.catalog_category_leaf,
      catalog_audience: parseJson(row.catalog_audience_json, null),
      catalog_production_type: row.catalog_production_type,
      print_area_edit_use_mocks: !!row.print_area_edit_use_mocks,
    });

    let patRows;
    try {
      patRows = await catalogDb
        .prepare(
          `SELECT * FROM print_area_printify_templates
           WHERE product_key = ? AND COALESCE(is_active, 1) = 1
           ORDER BY sort_order ASC, id ASC`
        )
        .bind(productKey)
        .all();
    } catch {
      patRows = { results: [] };
    }

    let versionCount = 0;
    for (const pat of patRows?.results || []) {
      const printProviderId = pat.print_provider_id != null ? String(pat.print_provider_id) : "";
      if (!printProviderId) continue;

      const fp = await getFulfillmentProviderByExternalId(mfgDb, partnerId, "printify", printProviderId);
      if (!fp) continue;

      await upsertProductVersion(mfgDb, {
        product_key: productKey,
        fulfillment_provider_id: fp.id,
        display_name: pat.display_name || row.title,
        description: pat.description,
        sort_order: pat.sort_order ?? 0,
        studio_config: patRowToStudioConfig(pat),
        auto_publish_config: patRowToAutoPublishConfig(pat),
        external_template_product_id: String(pat.printify_product_id || ""),
        product_version_config: parseJson(pat.product_version_config_json, null),
        qr_logo_snapshot: parseJson(pat.qr_logo_snapshot_json, null),
        is_active: pat.is_active !== 0,
        publish_enabled: pat.publish_enabled !== 0,
        catalog_pat_id: pat.id,
      });
      versionCount++;
    }

    const shadowResult = await importShadowTablesForProduct(env, productKey);

    imported.push({
      product_key: productKey,
      versions: versionCount,
      source_blueprint_id: sourceBlueprintId,
      shadow: shadowResult.ok ? shadowResult.counts : { error: shadowResult.error },
    });
  }

  return { ok: true, imported, count: imported.length };
}
