/**
 * Partner Admin product editor — bundle loaders and save handlers (master DB)
 */

import { isCatalogOpsMasterWrite, shouldUseCatalogOps } from "../catalogOpsConfig.js";
import { enrichMockupDefaultsRows } from "../catalogOpsReadService.js";
import {
  getCatalogOpsEditorBundle,
  getCatalogOpsVariantsBundle,
  getCatalogOpsPrintAreaBundle,
  getCatalogOpsProduct,
  listCatalogOpsProductVersions,
  getCatalogOpsMockupsBundle,
  getCatalogOpsTemplateRow,
} from "../catalogOpsReadService.js";
import {
  updateCatalogProductMeta,
  saveCatalogProviders,
  createCatalogPatVersion,
  deleteCatalogPatVersion,
  saveCatalogVersionConfig,
  saveCatalogPrintAreaSnapshot,
  saveCatalogVariants,
  saveCatalogTemplate,
  saveCatalogTemplateSectionProductId,
  TEMPLATE_SECTION_PRINTIFY_COLUMNS,
  saveCatalogMockups,
  saveCatalogAutomations,
} from "../catalogOpsWriteService.js";
import { resolveVariantProductDataForUi } from "../variantTemplateSync.js";
import { parseJson, newId } from "../../db.js";
import { regionCodesFromCountryCodes } from "../../../catalog/resolvePlanCountries.js";
import {
  filterImagesByMockupSet,
  MOCKUP_SET_CLEAN,
  MOCKUP_SET_SHOP_PREVIEW,
  MOCKUP_SET_CALIBRATION,
  mockupSetSqlMatch,
} from "../mockupSet.js";
import { getEazpireProduct, updateEazpireProduct } from "../eazpireProductService.js";
import {
  listProductVersions,
  getProductVersion,
  upsertProductVersion,
  updateProductVersion,
} from "../eazpireProductVersionService.js";
import { listFulfillmentProviders } from "../fulfillmentProviderService.js";
import { getCatalogDriftV2ForProduct } from "../shadow/catalogDriftV2.js";
import { mirrorEazpireProductToCatalogDb } from "../mirrorToCatalogDb.js";
import { enhanceProvidersBundle, resolvePrintifyBlueprintId, validateTemplateDraftProductId } from "./partnerEditorExtensions.js";
import { fetchBlueprintProviderVariants } from "../../adapters/printify/printifyCatalogClient.js";
import {
  attachPlaceholdersToCatalogVariants,
  buildTodifyCatalogVariantsFromPartner,
  catalogPlaceholdersFromPartnerPrintAreas,
  catalogVariantsHavePlaceholderPositions,
} from "../partnerCatalogPlaceholders.js";

async function queryAll(db, sql, ...binds) {
  try {
    const stmt = db.prepare(sql);
    const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return res?.results || [];
  } catch {
    return [];
  }
}

async function queryFirst(db, sql, ...binds) {
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

export async function getProductEditorBundle(env, productKey) {
  if (shouldUseCatalogOps(env)) {
    return getCatalogOpsEditorBundle(env, productKey);
  }
  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };

  const product = await getEazpireProduct(db, productKey);
  if (!product) return { ok: false, error: "not_found" };

  const versions = await listProductVersions(db, productKey);
  const providers = await listFulfillmentProviders(db, product.manufacturer_id);
  const activeProviders = await queryAll(
    db,
    `SELECT * FROM eazpire_product_active_providers WHERE product_key = ?`,
    productKey
  );
  const publishProfileRows = await queryAll(
    db,
    `SELECT * FROM eazpire_product_publish_profiles WHERE product_key = ?`,
    productKey
  );
  const publishPlans = await queryAll(
    db,
    `SELECT * FROM eazpire_product_publish_plans WHERE product_key = ?`,
    productKey
  );
  const publishProfiles = publishProfilesRowsToMap(publishProfileRows);
  const productDrift = await getCatalogDriftV2ForProduct(env, productKey);

  return {
    ok: true,
    product,
    versions,
    providers,
    active_providers: activeProviders,
    publish_profiles: publishProfiles,
    publish_plans: publishPlans.map((plan) => ({ ...plan, profile: publishProfiles.get(plan.publish_profile_id) || null })),
    drift: productDrift,
    tabs: ["provider", "template", "mockups", "variants", "print_area", "meta_data", "products", "automations"],
  };
}

function publishProfilesRowsToMap(rows) {
  const list = (rows || []).map(rowToPublishProfile);
  const map = new Map();
  for (const row of list) map.set(row.id, row);
  list.get = map.get.bind(map);
  return list;
}

function rowToPublishProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    print_provider_id: row.print_provider_id,
    title: row.title,
    shopify_category_id: row.shopify_category_id,
    standard_product_display_name: row.standard_product_display_name,
    product_features: row.product_features,
    care_instructions: row.care_instructions,
    size_table_html: row.size_table_html,
    gpsr_html: row.gpsr_html,
    variants_json: parseJson(row.variants_json, null),
    prices_json: parseJson(row.prices_json, null),
    print_areas_config_json: parseJson(row.print_areas_config_json, null),
    qr_logo_mapping_json: parseJson(row.qr_logo_mapping_json, null),
  };
}

export async function saveProductMeta(env, productKey, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return updateCatalogProductMeta(env, productKey, body);
  }
  const db = env.MANUFACTURER_DB;
  const product = await updateEazpireProduct(db, productKey, {
    catalog_status: body.catalog_status,
  });
  if (!product) return { ok: false, error: "not_found" };

  const printProviderId = body.print_provider_id;
  if (printProviderId != null) {
    const now = Date.now();
    const existing = await queryFirst(
      db,
      `SELECT id FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      printProviderId
    );
    const fields = {
      title: body.profile_title ?? product.title,
      shopify_category_id: body.shopify_category_id ?? null,
      standard_product_display_name: body.standard_product_display_name ?? null,
      product_features: body.product_features ?? null,
      care_instructions: body.care_instructions ?? null,
      size_table_html: body.size_table_html ?? null,
      gpsr_html: body.gpsr_html ?? null,
      updated_at: now,
    };
    if (existing?.id) {
      await db
        .prepare(
          `UPDATE eazpire_product_publish_profiles SET
            title = ?, shopify_category_id = ?, standard_product_display_name = ?,
            product_features = ?, care_instructions = ?, size_table_html = ?, gpsr_html = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          fields.title,
          fields.shopify_category_id,
          fields.standard_product_display_name,
          fields.product_features,
          fields.care_instructions,
          fields.size_table_html,
          fields.gpsr_html,
          fields.updated_at,
          existing.id
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO eazpire_product_publish_profiles
            (id, product_key, title, source_system, source_product_id, print_provider_id,
             shopify_category_id, standard_product_display_name, product_features, care_instructions,
             size_table_html, gpsr_html, collected_at, updated_at, is_active, revision)
           VALUES (?, ?, ?, 'printify', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
        )
        .bind(
          newId(),
          productKey,
          fields.title,
          printProviderId,
          fields.shopify_category_id,
          fields.standard_product_display_name,
          fields.product_features,
          fields.care_instructions,
          fields.size_table_html,
          fields.gpsr_html,
          now,
          now
        )
        .run();
    }

    /* publish_plan updates live on Provider tab (markets section) */
  }

  if (body.auto_mirror !== false) {
    await mirrorEazpireProductToCatalogDb(env, productKey);
  }
  return { ok: true, product };
}

export async function getProvidersBundle(env, productKey) {
  const enhanced = await enhanceProvidersBundle(env, productKey);
  if (!enhanced.ok) return enhanced;
  const bundle = await getProductEditorBundle(env, productKey);
  if (!bundle.ok) return bundle;

  return {
    ok: true,
    product: bundle.product,
    providers: bundle.providers,
    merged_providers: enhanced.merged_providers || [],
    blueprint_providers: enhanced.blueprint_providers || [],
    active_providers: bundle.active_providers,
    versions: bundle.versions,
    publish_plans: enhanced.publish_plans || bundle.publish_plans,
  };
}

export async function getProviderCatalogDetail(env, productKey, printProviderId) {
  const db = env.MANUFACTURER_DB;
  if (!db && !shouldUseCatalogOps(env)) return { ok: false, error: "manufacturer_db_unavailable" };

  const pidRaw = printProviderId;
  const pid = Number(printProviderId);
  // Accept numeric Printify ids; partner opaque ids (e.g. ma-1) still allowed as string for matching
  if (!Number.isFinite(pid) && !String(pidRaw || "").trim()) {
    return { ok: false, error: "print_provider_id_required" };
  }
  const pidKey = Number.isFinite(pid) ? pid : String(pidRaw).trim();

  let product;
  let printifyBlueprintId;
  if (shouldUseCatalogOps(env)) {
    const ops = await getCatalogOpsProduct(env, productKey);
    if (!ops.ok) return ops;
    product = ops.product;
    printifyBlueprintId = ops.printify_blueprint_id;
  } else {
    product = await getEazpireProduct(db, productKey);
    if (!product) return { ok: false, error: "not_found" };
    printifyBlueprintId = await resolvePrintifyBlueprintId(db, product.source_blueprint_id);
  }

  let variants = [];
  let variants_available = false;
  let variants_source = null;
  if (printifyBlueprintId && Number.isFinite(pid)) {
    const variantsRes = await fetchBlueprintProviderVariants(env, printifyBlueprintId, pid);
    if (variantsRes.ok) {
      const raw = variantsRes.variants;
      variants = Array.isArray(raw) ? raw : Array.isArray(raw?.variants) ? raw.variants : [];
      variants_available = variants.length > 0;
      if (variants_available) variants_source = "printify_catalog";
    }
  }

  // Todify / partner: no Printify placeholders — use stored profile or manufacturer_print_areas
  if (!catalogVariantsHavePlaceholderPositions(variants)) {
    const partner = await loadPartnerCatalogVariantsForDetail(env, productKey);
    if (partner?.variants?.length && catalogVariantsHavePlaceholderPositions(partner.variants)) {
      variants = partner.variants;
      variants_available = true;
      variants_source = partner.source || "partner_print_areas";
    }
  }

  const variantPrintAreas = shouldUseCatalogOps(env)
    ? await queryAll(
        env.CATALOG_DB,
        `SELECT * FROM product_variant_print_areas WHERE product_key = ? ORDER BY print_area_key, variant_title`,
        productKey
      )
    : await queryAll(
        db,
        `SELECT * FROM eazpire_product_variant_print_areas WHERE product_key = ? ORDER BY print_area_key, variant_title`,
        productKey
      );

  const allVersions = shouldUseCatalogOps(env)
    ? await listCatalogOpsProductVersions(env, productKey)
    : await listProductVersions(db, productKey);

  const matchProvider = (extId) => {
    const e = String(extId ?? "");
    if (!e) return false;
    if (e === String(pidKey)) return true;
    if (Number.isFinite(pid) && e === String(pid)) return true;
    // Legacy: opaque partner ids like "ma-1" were coerced to trailing digits in the UI (→ 1)
    if (Number.isFinite(pid) && e.includes("-")) {
      const m = e.match(/(\d+)$/);
      if (m && Number(m[1]) === pid) return true;
    }
    return false;
  };

  let versions = allVersions
    .filter((v) => matchProvider(v.external_provider_id))
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));

  // Partner products: if provider id coercion hid the match, still surface versions
  if (!versions.length && !printifyBlueprintId && allVersions.length) {
    versions = allVersions.slice().sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  }

  return {
    ok: true,
    product_key: productKey,
    print_provider_id: pidKey,
    blueprint_id: printifyBlueprintId || product.source_blueprint_id,
    variants,
    variants_available,
    variants_source,
    variant_print_areas: variantPrintAreas,
    versions,
  };
}

/**
 * Load Printify-shaped catalog variants for a partner/Todify product.
 * Prefer profile variants_json (with placeholders); else rebuild from manufacturer_print_areas.
 */
async function loadPartnerCatalogVariantsForDetail(env, productKey) {
  const key = String(productKey || "").trim();
  if (!key) return null;

  // 1) Publish profile variants_json (already shaped)
  if (env.CATALOG_DB) {
    try {
      const row = await env.CATALOG_DB.prepare(
        `SELECT id, variants_json, source_system, source_product_id
         FROM product_publish_profiles WHERE product_key = ? ORDER BY id ASC LIMIT 1`
      )
        .bind(key)
        .first();
      const stored = parseJson(row?.variants_json, null);
      if (Array.isArray(stored) && catalogVariantsHavePlaceholderPositions(stored)) {
        return { variants: stored, source: "publish_profile_variants_json", profile_id: row.id };
      }

      // 2) Rebuild from partner print areas and lazily persist
      const mfgDb = env.MANUFACTURER_DB;
      if (mfgDb) {
        let manufacturerId = null;
        let productId = row?.source_product_id || null;
        const linked = await mfgDb
          .prepare(
            `SELECT manufacturer_id, id FROM manufacturer_products WHERE eazpire_product_key = ? LIMIT 1`
          )
          .bind(key)
          .first();
        if (linked?.id) {
          manufacturerId = linked.manufacturer_id;
          productId = linked.id;
        } else if (productId) {
          const byId = await mfgDb
            .prepare(`SELECT manufacturer_id, id FROM manufacturer_products WHERE id = ? LIMIT 1`)
            .bind(productId)
            .first();
          if (byId?.id) {
            manufacturerId = byId.manufacturer_id;
            productId = byId.id;
          }
        }

        if (manufacturerId && productId) {
          const { listVariants, listPrintAreas } = await import("../../catalogService.js");
          const { listViews, syncPartnerPrintAreasIntoCatalog } = await import(
            "../../partnerProductEditorService.js"
          );
          const [variants, printAreas, views] = await Promise.all([
            listVariants(mfgDb, manufacturerId, productId),
            listPrintAreas(mfgDb, manufacturerId, productId),
            listViews(mfgDb, productId),
          ]);
          const placeholders = catalogPlaceholdersFromPartnerPrintAreas(printAreas, views);
          if (placeholders.length) {
            const catalogVariants =
              Array.isArray(stored) && stored.length
                ? attachPlaceholdersToCatalogVariants(stored, placeholders)
                : buildTodifyCatalogVariantsFromPartner({ variants, printAreas, views });
            try {
              await syncPartnerPrintAreasIntoCatalog(env, manufacturerId, productId, key);
            } catch (e) {
              console.warn("[provider-catalog-detail] lazy partner print-area sync:", e?.message || e);
            }
            return { variants: catalogVariants, source: "partner_print_areas", profile_id: row?.id };
          }
        }
      }
    } catch (e) {
      console.warn("[provider-catalog-detail] partner fallback:", e?.message || e);
    }
  }

  // 3) Manufacturer DB only (no catalog profile yet)
  if (env.MANUFACTURER_DB) {
    try {
      const linked = await env.MANUFACTURER_DB.prepare(
        `SELECT manufacturer_id, id FROM manufacturer_products WHERE eazpire_product_key = ? LIMIT 1`
      )
        .bind(key)
        .first();
      if (!linked?.id) return null;
      const { listVariants, listPrintAreas } = await import("../../catalogService.js");
      const { listViews } = await import("../../partnerProductEditorService.js");
      const [variants, printAreas, views] = await Promise.all([
        listVariants(env.MANUFACTURER_DB, linked.manufacturer_id, linked.id),
        listPrintAreas(env.MANUFACTURER_DB, linked.manufacturer_id, linked.id),
        listViews(env.MANUFACTURER_DB, linked.id),
      ]);
      const catalogVariants = buildTodifyCatalogVariantsFromPartner({ variants, printAreas, views });
      if (catalogVariantsHavePlaceholderPositions(catalogVariants)) {
        return { variants: catalogVariants, source: "partner_print_areas" };
      }
    } catch (e) {
      console.warn("[provider-catalog-detail] mfg fallback:", e?.message || e);
    }
  }

  return null;
}

async function fulfillmentProviderIdForPrintProvider(db, printProviderId) {
  const fp = await queryFirst(
    db,
    `SELECT id FROM manufacturer_fulfillment_providers WHERE external_provider_id = ? LIMIT 1`,
    String(printProviderId)
  );
  return fp?.id || null;
}

async function ensureStandardVersionForProvider(db, productKey, printProviderId, now) {
  const fpId = await fulfillmentProviderIdForPrintProvider(db, printProviderId);
  if (!fpId) return null;

  const versions = await listProductVersions(db, productKey);
  const forProvider = versions.filter((v) => String(v.external_provider_id) === String(printProviderId));
  if (forProvider.length > 0) return forProvider.sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))[0];

  return upsertProductVersion(db, {
    product_key: productKey,
    fulfillment_provider_id: fpId,
    display_name: "Standard",
    sort_order: 0,
    external_template_product_id: "",
    publish_enabled: true,
    is_active: true,
    created_at: now,
    updated_at: now,
  });
}

async function upsertVariantPrintAreaDimensions(db, productKey, update, now) {
  const printAreaKey = String(update.print_area_key || "")
    .trim()
    .toLowerCase();
  const width = Number(update.printify_print_area_width);
  const height = Number(update.printify_print_area_height);
  if (!printAreaKey || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return;
  }

  const variantIds = Array.isArray(update.catalog_variant_ids)
    ? update.catalog_variant_ids.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  if (!variantIds.length && update.variant_id != null) {
    const vid = Number(update.variant_id);
    if (Number.isFinite(vid) && vid > 0) variantIds.push(vid);
  }
  if (!variantIds.length) return;

  for (const variantId of variantIds) {
    const existing = await queryFirst(
      db,
      `SELECT id FROM eazpire_product_variant_print_areas
       WHERE product_key = ? AND print_area_key = ? AND variant_id = ?`,
      productKey,
      printAreaKey,
      variantId
    );
    if (existing?.id) {
      await db
        .prepare(
          `UPDATE eazpire_product_variant_print_areas
           SET printify_print_area_width = ?, printify_print_area_height = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(Math.round(width), Math.round(height), now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO eazpire_product_variant_print_areas
            (id, product_key, print_area_key, variant_id, variant_title,
             printify_print_area_width, printify_print_area_height, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newId(),
          productKey,
          printAreaKey,
          variantId,
          update.variant_title != null ? String(update.variant_title) : null,
          Math.round(width),
          Math.round(height),
          now,
          now
        )
        .run();
    }
  }
}

/** After provider save: mirror version titles, design types, and market regions onto product + profiles. */
async function syncProductDerivedFromProviders(db, productKey, activeIds, body, now) {
  const designTypes = new Set();
  const countryCodes = new Set();

  const ingestVersion = (vu) => {
    const cfg = vu?.product_version_config;
    if (cfg && Array.isArray(cfg.design_types)) {
      for (const dt of cfg.design_types) {
        if (dt) designTypes.add(String(dt));
      }
    }
  };

  if (Array.isArray(body.version_updates)) {
    for (const vu of body.version_updates) {
      ingestVersion(vu);
      if (vu.product_version_config == null) {
        const v = await getProductVersion(db, vu.id);
        ingestVersion(v);
      }
    }
  }
  if (Array.isArray(body.new_versions)) {
    for (const nv of body.new_versions) ingestVersion(nv);
  }

  if (Array.isArray(body.publish_plan_updates)) {
    for (const plan of body.publish_plan_updates) {
      for (const cc of plan.country_codes || []) countryCodes.add(String(cc).toUpperCase());
    }
  }

  let productTitle = null;
  for (const pid of activeIds) {
    const versions = await queryAll(
      db,
      `SELECT v.display_name, v.sort_order
       FROM eazpire_product_versions v
       JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
       WHERE v.product_key = ? AND fp.external_provider_id = ?
       ORDER BY v.sort_order ASC, v.created_at ASC`,
      productKey,
      String(pid)
    );
    const name = String(versions[0]?.display_name || "").trim();
    if (name) {
      productTitle = name;
      break;
    }
  }

  const regions = regionCodesFromCountryCodes([...countryCodes]);
  const productPatch = {};
  if (productTitle) productPatch.title = productTitle;
  if (designTypes.size) productPatch.visible_design_types = [...designTypes];
  if (regions.length) productPatch.regions = regions;

  const statusVersions = await queryAll(
    db,
    `SELECT v.product_version_config_json, v.sort_order
     FROM eazpire_product_versions v
     JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
     WHERE v.product_key = ? AND fp.external_provider_id IN (${activeIds.map(() => "?").join(",") || "?"})
     ORDER BY v.sort_order ASC, v.created_at ASC`,
    ...(activeIds.length ? [productKey, ...activeIds.map(String)] : [productKey, "0"])
  );
  if (statusVersions.length) {
    let cfg = {};
    try {
      cfg = JSON.parse(statusVersions[0].product_version_config_json || "{}");
    } catch {
      cfg = {};
    }
    const st = String(cfg.catalog_status || "").toLowerCase();
    if (["offline", "preview", "online"].includes(st)) {
      productPatch.catalog_status = st;
    }
  }

  if (Object.keys(productPatch).length) {
    await updateEazpireProduct(db, productKey, productPatch);
  }

  for (const pid of activeIds) {
    const versions = await queryAll(
      db,
      `SELECT v.display_name, v.sort_order, fp.external_provider_id
       FROM eazpire_product_versions v
       JOIN manufacturer_fulfillment_providers fp ON fp.id = v.fulfillment_provider_id
       WHERE v.product_key = ? AND fp.external_provider_id = ?
       ORDER BY v.sort_order ASC, v.created_at ASC`,
      productKey,
      String(pid)
    );
    const stdName = String(versions[0]?.display_name || "").trim();
    if (!stdName) continue;
    const profile = await queryFirst(
      db,
      `SELECT id FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      pid
    );
    if (profile?.id) {
      await db
        .prepare(
          `UPDATE eazpire_product_publish_profiles SET
            title = ?, standard_product_display_name = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(stdName, stdName, now, profile.id)
        .run();
    }
  }
}

export async function saveProviders(env, productKey, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogProviders(env, productKey, body);
  }
  const db = env.MANUFACTURER_DB;
  const now = Date.now();
  const activeIds = Array.isArray(body.active_print_provider_ids)
    ? body.active_print_provider_ids.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];

  const prevActive = await queryAll(
    db,
    `SELECT print_provider_id FROM eazpire_product_active_providers WHERE product_key = ?`,
    productKey
  );
  const prevActiveSet = new Set(prevActive.map((r) => Number(r.print_provider_id)));

  await db.prepare(`DELETE FROM eazpire_product_active_providers WHERE product_key = ?`).bind(productKey).run();
  for (const pid of activeIds) {
    await db
      .prepare(
        `INSERT INTO eazpire_product_active_providers (id, product_key, print_provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(newId(), productKey, pid, now, now)
      .run();
    if (!prevActiveSet.has(pid)) {
      await ensureStandardVersionForProvider(db, productKey, pid, now);
    }
  }

  if (Array.isArray(body.deleted_version_ids)) {
    for (const versionId of body.deleted_version_ids) {
      const id = String(versionId || "").trim();
      if (!id) continue;
      const v = await getProductVersion(db, id);
      if (v && v.product_key === productKey) {
        await db.prepare(`DELETE FROM eazpire_product_versions WHERE id = ?`).bind(id).run();
      }
    }
  }

  if (Array.isArray(body.new_versions)) {
    for (const nv of body.new_versions) {
      const ppId = Number(nv.print_provider_id);
      if (!Number.isFinite(ppId)) continue;
      const fpId = await fulfillmentProviderIdForPrintProvider(db, ppId);
      if (!fpId) continue;
      await upsertProductVersion(db, {
        product_key: productKey,
        fulfillment_provider_id: fpId,
        display_name: nv.display_name || "New version",
        sort_order: nv.sort_order ?? 99,
        external_template_product_id: nv.external_template_product_id || "",
        product_version_config: nv.product_version_config ?? null,
        publish_enabled: nv.publish_enabled !== false,
        is_active: nv.is_active !== false,
      });
    }
  }

  if (Array.isArray(body.version_updates)) {
    for (const vu of body.version_updates) {
      const id = String(vu.id || "").trim();
      if (!id) continue;
      const patch = {};
      if (vu.display_name != null) patch.display_name = String(vu.display_name).trim() || "Version";
      if (vu.product_version_config != null) patch.product_version_config = vu.product_version_config;
      if (vu.sort_order != null) patch.sort_order = Number(vu.sort_order);
      if (vu.publish_enabled != null) patch.publish_enabled = !!vu.publish_enabled;
      if (vu.is_active != null) patch.is_active = !!vu.is_active;
      if (Object.keys(patch).length) await updateProductVersion(db, id, patch);
    }
  }

  if (Array.isArray(body.variant_print_area_updates)) {
    for (const upd of body.variant_print_area_updates) {
      await upsertVariantPrintAreaDimensions(db, productKey, upd, now);
    }
  }

  if (Array.isArray(body.publish_plan_updates)) {
    for (const plan of body.publish_plan_updates) {
      const existing = plan.id
        ? await queryFirst(db, `SELECT id FROM eazpire_product_publish_plans WHERE id = ?`, plan.id)
        : null;
      if (existing?.id) {
        const countryCodes = Array.isArray(plan.country_codes) ? plan.country_codes : [];
        const regionCodes =
          Array.isArray(plan.region_codes) && plan.region_codes.length
            ? plan.region_codes
            : regionCodesFromCountryCodes(countryCodes);
        const origin =
          plan.country_of_origin != null
            ? String(plan.country_of_origin).trim().toUpperCase().slice(0, 2) || null
            : null;
        await db
          .prepare(
            `UPDATE eazpire_product_publish_plans SET
              region_codes_json = ?, country_codes_json = ?, country_of_origin = COALESCE(?, country_of_origin),
              priority = ?, is_enabled = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            JSON.stringify(regionCodes),
            JSON.stringify(countryCodes),
            origin,
            plan.priority ?? 100,
            plan.is_enabled !== false ? 1 : 0,
            now,
            existing.id
          )
          .run();
      }
    }
  }

  await syncProductDerivedFromProviders(db, productKey, activeIds, body, now);

  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true };
}

export async function createProductVersion(env, productKey, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return createCatalogPatVersion(env, productKey, body);
  }
  const db = env.MANUFACTURER_DB;
  const fp = await queryFirst(
    db,
    `SELECT id FROM manufacturer_fulfillment_providers WHERE external_provider_id = ? LIMIT 1`,
    String(body.print_provider_id)
  );
  if (!fp?.id) return { ok: false, error: "provider_not_found" };
  const version = await upsertProductVersion(db, {
    product_key: productKey,
    fulfillment_provider_id: fp.id,
    display_name: body.display_name || "New version",
    external_template_product_id: body.external_template_product_id || "",
    sort_order: body.sort_order ?? 99,
  });
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true, version };
}

export async function deleteProductVersion(env, versionId) {
  if (isCatalogOpsMasterWrite(env)) {
    return deleteCatalogPatVersion(env, versionId);
  }
  const db = env.MANUFACTURER_DB;
  const v = await getProductVersion(db, versionId);
  if (!v) return { ok: false, error: "not_found" };
  await db.prepare(`DELETE FROM eazpire_product_versions WHERE id = ?`).bind(versionId).run();
  await mirrorEazpireProductToCatalogDb(env, v.product_key);
  return { ok: true };
}

export async function saveVersionConfig(env, versionId, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogVersionConfig(env, versionId, body);
  }
  const db = env.MANUFACTURER_DB;
  const version = await updateProductVersion(db, versionId, {
    display_name: body.display_name,
    product_version_config: body.product_version_config,
    publish_enabled: body.publish_enabled,
    is_active: body.is_active,
  });
  if (!version) return { ok: false, error: "not_found" };
  const st = String(body.product_version_config?.catalog_status || "").toLowerCase();
  if (["offline", "preview", "online"].includes(st)) {
    await updateEazpireProduct(db, version.product_key, { catalog_status: st });
  }
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, version.product_key);
  return { ok: true, version };
}

export async function getPrintAreaBundle(env, productKey, { printProviderId, versionId } = {}) {
  if (shouldUseCatalogOps(env)) {
    return getCatalogOpsPrintAreaBundle(env, productKey, { printProviderId, versionId });
  }
  const db = env.MANUFACTURER_DB;
  const versions = await listProductVersions(db, productKey);
  let version = versionId ? versions.find((v) => v.id === versionId) : versions[0];
  if (printProviderId) {
    version = versions.find((v) => String(v.external_provider_id) === String(printProviderId)) || version;
  }
  const mockupDefaults = enrichMockupDefaultsRows(
    await queryAll(
    db,
    `SELECT * FROM eazpire_product_mockup_defaults WHERE product_key = ?`,
    productKey
  ),
    env
  );
  const variantPrintAreas = await queryAll(
    db,
    `SELECT * FROM eazpire_product_variant_print_areas WHERE product_key = ?`,
    productKey
  );
  return { ok: true, version, versions, mockup_defaults: mockupDefaults, variant_print_areas: variantPrintAreas };
}

export async function savePrintAreaSnapshot(env, versionId, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogPrintAreaSnapshot(env, versionId, body);
  }
  const db = env.MANUFACTURER_DB;
  const existing = await getProductVersion(db, versionId);
  if (!existing) return { ok: false, error: "not_found" };
  const studio = { ...existing.studio_config, ...(body.studio_config || {}) };
  const version = await updateProductVersion(db, versionId, {
    studio_config: studio,
    qr_logo_snapshot: body.qr_logo_snapshot !== undefined ? body.qr_logo_snapshot : existing.qr_logo_snapshot,
    product_version_config: body.product_version_config !== undefined ? body.product_version_config : existing.product_version_config,
  });
  if (body.mockup_default) {
    const md = body.mockup_default;
    const row = await queryFirst(
      db,
      `SELECT id FROM eazpire_product_mockup_defaults WHERE product_key = ? AND print_area_key = ?`,
      existing.product_key,
      md.print_area_key || "front"
    );
    const now = Date.now();
    if (row?.id) {
      await db
        .prepare(
          `UPDATE eazpire_product_mockup_defaults SET
            print_area_rect_json = ?, mockup_print_area_rect_json = ?, universal_print_area_rect_json = ?,
            placement_x = ?, placement_y = ?, placement_scale = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          md.print_area_rect_json ? JSON.stringify(md.print_area_rect_json) : null,
          md.mockup_print_area_rect_json ? JSON.stringify(md.mockup_print_area_rect_json) : null,
          md.universal_print_area_rect_json ? JSON.stringify(md.universal_print_area_rect_json) : null,
          md.placement_x ?? 0.5,
          md.placement_y ?? 0.5,
          md.placement_scale ?? 1,
          now,
          row.id
        )
        .run();
    }
  }
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, existing.product_key);
  return { ok: true, version };
}

export async function getVariantsBundle(env, productKey, printProviderId) {
  if (shouldUseCatalogOps(env)) {
    return getCatalogOpsVariantsBundle(env, productKey, printProviderId);
  }
  const db = env.MANUFACTURER_DB;
  const variantConfig = await queryFirst(
    db,
    `SELECT * FROM eazpire_product_variant_config WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    Number(printProviderId)
  );
  const profile = await queryFirst(
    db,
    `SELECT * FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    Number(printProviderId)
  );
  const template = await queryFirst(
    db,
    `SELECT * FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    Number(printProviderId)
  );
  return {
    ok: true,
    variant_config: variantConfig ? parseJson(variantConfig.config_json, {}) : null,
    prices_json: profile ? parseJson(profile.prices_json, null) : null,
    variants_json: profile ? parseJson(profile.variants_json, null) : template ? parseJson(template.variants_json, null) : null,
    product_data: resolveVariantProductDataForUi(template, profile),
    product_data_json: resolveVariantProductDataForUi(template, profile),
    template,
  };
}

export async function saveVariants(env, productKey, printProviderId, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogVariants(env, productKey, printProviderId, body);
  }
  const db = env.MANUFACTURER_DB;
  const now = Date.now();
  if (body.config != null) {
    const existing = await queryFirst(
      db,
      `SELECT id FROM eazpire_product_variant_config WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      Number(printProviderId)
    );
    const configJson = JSON.stringify(body.config);
    if (existing?.id) {
      await db
        .prepare(`UPDATE eazpire_product_variant_config SET config_json = ?, updated_at = ? WHERE id = ?`)
        .bind(configJson, now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO eazpire_product_variant_config (id, product_key, print_provider_id, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(newId(), productKey, Number(printProviderId), configJson, now, now)
        .run();
    }
  }
  if (body.prices_json != null || body.variants_json != null) {
    const profile = await queryFirst(
      db,
      `SELECT id FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      Number(printProviderId)
    );
    if (profile?.id) {
      await db
        .prepare(
          `UPDATE eazpire_product_publish_profiles SET
            prices_json = COALESCE(?, prices_json), variants_json = COALESCE(?, variants_json), updated_at = ?
           WHERE id = ?`
        )
        .bind(
          body.prices_json != null ? JSON.stringify(body.prices_json) : null,
          body.variants_json != null ? JSON.stringify(body.variants_json) : null,
          now,
          profile.id
        )
        .run();
    }
  }
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true };
}

export async function getTemplateBundle(env, productKey, printProviderId) {
  const pid = Number(printProviderId);
  const draftCheck = await validateTemplateDraftProductId(env, productKey, pid);
  const draftMeta = {
    draft_product_id: draftCheck.draft_product_id || null,
    draft_stale_removed: !!draftCheck.draft_stale_removed,
    removed_draft_id: draftCheck.removed_draft_id || null,
  };

  if (shouldUseCatalogOps(env)) {
    const template = await getCatalogOpsTemplateRow(env, productKey, pid);
    const versions = await listCatalogOpsProductVersions(env, productKey);
    const version = versions.find((v) => String(v.external_provider_id) === String(pid));
    return { ok: true, template, version, ...draftMeta };
  }

  const db = env.MANUFACTURER_DB;
  const template = await queryFirst(
    db,
    `SELECT * FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );
  const versions = await listProductVersions(db, productKey);
  const version = versions.find((v) => String(v.external_provider_id) === String(pid));
  return { ok: true, template, version, ...draftMeta };
}

export async function saveTemplateSectionProductId(env, productKey, printProviderId, section, printifyProductId) {
  const column = TEMPLATE_SECTION_PRINTIFY_COLUMNS[section];
  if (!column) return { ok: false, error: "invalid_template_section" };

  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogTemplateSectionProductId(env, productKey, printProviderId, section, printifyProductId);
  }

  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };

  const now = Date.now();
  const pid = Number(printProviderId);
  const productId = String(printifyProductId || "").trim();
  if (!productId) return { ok: false, error: "printify_product_id_required" };

  const existing = await queryFirst(
    db,
    `SELECT id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );

  if (existing?.id) {
    await db
      .prepare(`UPDATE eazpire_template_products SET ${column} = ?, updated_at = ? WHERE id = ?`)
      .bind(productId, now, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_template_products
          (id, product_key, print_provider_id, printify_product_id, ${column}, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?)`
      )
      .bind(newId(), productKey, pid, productId, now, now)
      .run();
  }

  const profileRow = await queryFirst(
    db,
    `SELECT print_areas_config_json FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    pid
  );
  let base = {};
  try {
    base = profileRow?.print_areas_config_json ? JSON.parse(profileRow.print_areas_config_json) : {};
  } catch {
    base = {};
  }
  if (!base || typeof base !== "object" || Array.isArray(base)) base = {};
  const templateProductIds = { ...(base.template_product_ids || {}), [section]: productId };
  await patchMfgPublishProfileConfig(db, productKey, pid, {
    print_areas_config_json: { ...base, template_product_ids: templateProductIds },
  });

  return { ok: true, section, printify_product_id: productId };
}

async function patchMfgPublishProfileConfig(db, productKey, printProviderId, patch) {
  const now = Date.now();
  const row = await queryFirst(
    db,
    `SELECT id FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  if (row?.id) {
    await db
      .prepare(
        `UPDATE eazpire_product_publish_profiles SET print_areas_config_json = COALESCE(?, print_areas_config_json), updated_at = ? WHERE id = ?`
      )
      .bind(patch.print_areas_config_json != null ? JSON.stringify(patch.print_areas_config_json) : null, now, row.id)
      .run();
    return row.id;
  }
  await db
    .prepare(
      `INSERT INTO eazpire_product_publish_profiles
        (id, product_key, print_provider_id, print_areas_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), productKey, Number(printProviderId), JSON.stringify(patch.print_areas_config_json || {}), now, now)
    .run();
  return null;
}

export async function saveTemplate(env, productKey, printProviderId, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogTemplate(env, productKey, printProviderId, body);
  }
  const db = env.MANUFACTURER_DB;
  const now = Date.now();
  const existing = await queryFirst(
    db,
    `SELECT id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    Number(printProviderId)
  );
  const fields = {
    printify_product_id: String(body.printify_product_id || ""),
    title: body.title ?? null,
    variants_json: body.variants_json != null ? JSON.stringify(body.variants_json) : null,
    prices_json: body.prices_json != null ? JSON.stringify(body.prices_json) : null,
    updated_at: now,
  };
  if (existing?.id) {
    await db
      .prepare(
        `UPDATE eazpire_template_products SET printify_product_id = ?, title = ?, variants_json = ?, prices_json = ?, updated_at = ? WHERE id = ?`
      )
      .bind(fields.printify_product_id, fields.title, fields.variants_json, fields.prices_json, fields.updated_at, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_template_products
          (id, product_key, print_provider_id, printify_product_id, title, variants_json, prices_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(newId(), productKey, Number(printProviderId), fields.printify_product_id, fields.title, fields.variants_json, fields.prices_json, now, now)
      .run();
  }
  const versions = await listProductVersions(db, productKey);
  const version = versions.find((v) => String(v.external_provider_id) === String(printProviderId));
  if (version && body.printify_product_id) {
    await updateProductVersion(db, version.id, { external_template_product_id: String(body.printify_product_id) });
  }
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true };
}

export async function getMockupsBundle(env, productKey, printProviderId) {
  if (shouldUseCatalogOps(env)) {
    return getCatalogOpsMockupsBundle(env, productKey, printProviderId);
  }
  const db = env.MANUFACTURER_DB;
  const product = await getEazpireProduct(db, productKey);
  let images = await queryAll(db, `SELECT * FROM eazpire_product_mockup_images WHERE product_key = ?`, productKey);
  if (printProviderId != null) {
    images = images.filter((i) => Number(i.print_provider_id) === Number(printProviderId));
  }
  const cleanImages = filterImagesByMockupSet(images, MOCKUP_SET_CLEAN);
  const shopPreviewImages = filterImagesByMockupSet(images, MOCKUP_SET_SHOP_PREVIEW);
  const calibrationImages = filterImagesByMockupSet(images, MOCKUP_SET_CALIBRATION);
  const viewRandom = await queryAll(
    db,
    `SELECT * FROM eazpire_product_mockup_view_random WHERE product_key = ?`,
    productKey
  );
  const defaults = enrichMockupDefaultsRows(
    await queryAll(db, `SELECT * FROM eazpire_product_mockup_defaults WHERE product_key = ?`, productKey),
    env
  );
  return {
    ok: true,
    product,
    images: cleanImages,
    shop_preview_images: shopPreviewImages,
    calibration_images: calibrationImages,
    view_random: viewRandom,
    mockup_defaults: defaults,
  };
}

export async function saveMockups(env, productKey, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogMockups(env, productKey, body);
  }
  const db = env.MANUFACTURER_DB;
  const now = Date.now();
  if (body.print_area_edit_use_mocks !== undefined) {
    await updateEazpireProduct(db, productKey, { print_area_edit_use_mocks: body.print_area_edit_use_mocks });
  }
  if (body.image_rules && Array.isArray(body.image_rules)) {
    for (const rule of body.image_rules) {
      await db
        .prepare(
          `UPDATE eazpire_product_mockup_images SET preview_template_ids_json = ? WHERE id = ?`
        )
        .bind(JSON.stringify(rule.preview_template_ids || []), rule.id)
        .run();
    }
  }
  if (body.view_random_rules && Array.isArray(body.view_random_rules)) {
    for (const rule of body.view_random_rules) {
      const existing = await queryFirst(
        db,
        `SELECT id FROM eazpire_product_mockup_view_random WHERE product_key = ? AND view_key = ?`,
        productKey,
        rule.view_key
      );
      if (existing?.id) {
        await db
          .prepare(`UPDATE eazpire_product_mockup_view_random SET template_ids_json = ?, updated_at = ? WHERE id = ?`)
          .bind(JSON.stringify(rule.template_ids || []), now, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO eazpire_product_mockup_view_random (id, product_key, view_key, template_ids_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(newId(), productKey, rule.view_key, JSON.stringify(rule.template_ids || []), now, now)
          .run();
      }
    }
  }
  if (body.preview_mock_id && body.print_provider_id != null) {
    const ppId = Number(body.print_provider_id);
    const match = mockupSetSqlMatch(MOCKUP_SET_CLEAN);
    await db
      .prepare(
        `UPDATE eazpire_product_mockup_images SET is_default = 0 WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`
      )
      .bind(productKey, ppId, match.bind)
      .run();
    await db
      .prepare(`UPDATE eazpire_product_mockup_images SET is_default = 1 WHERE id = ? AND product_key = ?`)
      .bind(body.preview_mock_id, productKey)
      .run();
  }
  if (body.shop_preview_mock_id && body.print_provider_id != null) {
    const ppId = Number(body.print_provider_id);
    const match = mockupSetSqlMatch(MOCKUP_SET_SHOP_PREVIEW);
    await db
      .prepare(
        `UPDATE eazpire_product_mockup_images SET is_default = 0 WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`
      )
      .bind(productKey, ppId, match.bind)
      .run();
    await db
      .prepare(`UPDATE eazpire_product_mockup_images SET is_default = 1 WHERE id = ? AND product_key = ?`)
      .bind(body.shop_preview_mock_id, productKey)
      .run();
  }
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true };
}

export async function saveAutomations(env, versionId, body) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogAutomations(env, versionId, body);
  }
  const db = env.MANUFACTURER_DB;
  const auto = {
    auto_publish_enabled: !!body.auto_publish_enabled,
    automation_shopify_sync_enabled: !!body.automation_shopify_sync_enabled,
    automation_amazon_publish_enabled: !!body.automation_amazon_publish_enabled,
    automation_social: body.automation_social ?? null,
  };
  const version = await updateProductVersion(db, versionId, { auto_publish_config: auto });
  if (!version) return { ok: false, error: "not_found" };
  if (body.auto_mirror !== false) await mirrorEazpireProductToCatalogDb(env, version.product_key);
  return { ok: true, version };
}

export async function getPublishedBundle(env, productKey) {
  const creatorDb = env.CREATOR_DB;
  if (!creatorDb) return { ok: false, error: "creator_db_unavailable" };
  const publishedRows = await queryAll(
    creatorDb,
    `SELECT * FROM published_designs WHERE product_key = ? ORDER BY updated_at DESC LIMIT 200`,
    productKey
  );
  const versions = env.MANUFACTURER_DB ? await listProductVersions(env.MANUFACTURER_DB, productKey) : [];
  const published = publishedRows.map((row) => ({
    ...row,
    channels: {
      shopify: row.shopify_product_id ? 1 : 0,
      printify: row.printify_product_id ? 1 : 0,
      amazon: row.amazon_listing_id || row.amazon_asin || row.amazon_product_id ? 1 : 0,
    },
  }));
  return { ok: true, published, versions, template_versions: versions };
}

export async function updatePublishedListing(env, body) {
  const creatorDb = env.CREATOR_DB;
  if (!creatorDb) return { ok: false, error: "creator_db_unavailable" };
  return { ok: true, queued: true, message: "update_queued", design_id: body.design_id };
}

export async function deletePublishedListing(env, body) {
  const creatorDb = env.CREATOR_DB;
  if (!creatorDb) return { ok: false, error: "creator_db_unavailable" };
  if (!body.design_id) return { ok: false, error: "design_id_required" };
  await creatorDb.prepare(`DELETE FROM published_designs WHERE design_id = ?`).bind(body.design_id).run();
  return { ok: true };
}
