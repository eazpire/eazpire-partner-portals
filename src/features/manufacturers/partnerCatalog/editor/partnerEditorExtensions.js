/**
 * Partner product editor parity helpers (master-first shadow tables).
 */

import { parseJson, newId } from "../../db.js";
import { getEazpireProduct } from "../eazpireProductService.js";
import { isCatalogOpsMasterWrite, shouldUseCatalogOps } from "../catalogOpsConfig.js";
import { getCatalogOpsProduct, getCatalogOpsTemplateRow, listCatalogOpsProductVersions } from "../catalogOpsReadService.js";
import {
  upsertCatalogPublishProfile,
  upsertCatalogMockupDefault,
  patchCatalogPatStudioConfig,
  upsertCatalogTemplateFromPrintify,
  replaceCatalogMockupImages,
  updateCatalogPatPrintifyProductId,
  saveCatalogDraftProductId,
  clearCatalogDraftProductId,
} from "../catalogOpsWriteService.js";
import { listProductVersions, updateProductVersion } from "../eazpireProductVersionService.js";
import { mirrorEazpireProductToCatalogDb } from "../mirrorToCatalogDb.js";
import { fetchPrintifyProductById } from "../../../admin/adminProducts.js";
import { buildProductPublishReadiness } from "../../../admin/adminPublishReadiness.js";
import { fetchBlueprint, fetchBlueprintProviderVariants, fetchAllPrintProviders } from "../../adapters/printify/printifyCatalogClient.js";
import { createPrintifyProduct, getPrintifyProduct } from "../../../../utils/printify.js";
import { getPrintifyApiKey } from "../../../../utils/printifyEnv.js";
import {
  mergeProviders,
  buildPrintProviderCatalogMap,
  enrichBlueprintProviderWithCatalog,
  enrichProviderRowWithCatalog,
} from "./providerBundleService.js";

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

function variantCost(variant) {
  const c = variant?.cost;
  if (c == null || c === "") return 0;
  if (typeof c === "string") {
    const n = parseFloat(c);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  }
  if (typeof c === "number") return Math.max(0, Math.round(c));
  return 0;
}

function extractVariantsAndPrices(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const enabled = variants.filter((v) => v?.is_enabled !== false);
  const prices = enabled.map((v) => ({ variant_id: v.id, price: variantCost(v) }));
  return { variants_json: enabled, prices_json: prices };
}

/** Resolve Printify catalog blueprint id from internal eazpire blueprint row id. */
export async function resolvePrintifyBlueprintId(db, sourceBlueprintId) {
  if (!sourceBlueprintId) return null;
  const row = await queryFirst(
    db,
    `SELECT pb.external_blueprint_id
     FROM manufacturer_eazpire_blueprints eb
     INNER JOIN manufacturer_provider_blueprints pb ON pb.id = eb.provider_blueprint_id
     WHERE eb.id = ?`,
    sourceBlueprintId
  );
  const ext = row?.external_blueprint_id;
  if (ext != null && String(ext).trim() !== "") return String(ext).trim();
  const raw = String(sourceBlueprintId).trim();
  return /^\d+$/.test(raw) ? raw : null;
}

async function printifyGet(env, endpoint) {
  const apiKey = String(env?.PRINTIFY_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "printify_api_key_not_configured" };
  try {
    const resp = await fetch(`https://api.printify.com/v1${endpoint}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { ok: false, error: "printify_catalog_error", status: resp.status, detail };
    }
    return { ok: true, data: await resp.json().catch(() => ({})) };
  } catch (err) {
    return { ok: false, error: "printify_network_error", detail: String(err?.message || err) };
  }
}

async function upsertPublishProfile(db, productKey, printProviderId, patch) {
  const now = Date.now();
  const row = await queryFirst(
    db,
    `SELECT * FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  if (row?.id) {
    await db
      .prepare(
        `UPDATE eazpire_product_publish_profiles SET
          title = COALESCE(?, title),
          source_product_id = COALESCE(?, source_product_id),
          blueprint_id = COALESCE(?, blueprint_id),
          variants_json = COALESCE(?, variants_json),
          prices_json = COALESCE(?, prices_json),
          product_data_json = COALESCE(?, product_data_json),
          print_areas_config_json = COALESCE(?, print_areas_config_json),
          updated_at = ?
         WHERE id = ?`
      )
      .bind(
        patch.title ?? null,
        patch.source_product_id ?? null,
        patch.blueprint_id ?? null,
        patch.variants_json != null ? JSON.stringify(patch.variants_json) : null,
        patch.prices_json != null ? JSON.stringify(patch.prices_json) : null,
        patch.product_data_json != null ? JSON.stringify(patch.product_data_json) : null,
        patch.print_areas_config_json != null ? JSON.stringify(patch.print_areas_config_json) : null,
        now,
        row.id
      )
      .run();
    return row.id;
  }

  const id = newId();
  await db
    .prepare(
      `INSERT INTO eazpire_product_publish_profiles
        (id, product_key, title, source_system, source_product_id, blueprint_id, print_provider_id,
         variants_json, prices_json, product_data_json, print_areas_config_json, collected_at, updated_at, is_active, revision)
       VALUES (?, ?, ?, 'printify', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
    )
    .bind(
      id,
      productKey,
      patch.title || "Publish profile",
      patch.source_product_id || "",
      patch.blueprint_id ?? null,
      Number(printProviderId),
      patch.variants_json != null ? JSON.stringify(patch.variants_json) : null,
      patch.prices_json != null ? JSON.stringify(patch.prices_json) : null,
      patch.product_data_json != null ? JSON.stringify(patch.product_data_json) : null,
      patch.print_areas_config_json != null ? JSON.stringify(patch.print_areas_config_json) : null,
      now,
      now
    )
    .run();
  return id;
}

export async function enhanceProvidersBundle(env, productKey) {
  if (shouldUseCatalogOps(env)) {
    return enhanceProvidersBundleFromCatalog(env, productKey);
  }
  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  const product = await getEazpireProduct(db, productKey);
  if (!product) return { ok: false, error: "not_found" };

  const plans = await queryAll(
    db,
    `SELECT * FROM eazpire_product_publish_plans WHERE product_key = ? ORDER BY priority ASC, id ASC`,
    productKey
  );
  const profiles = await queryAll(
    db,
    `SELECT * FROM eazpire_product_publish_profiles WHERE product_key = ?`,
    productKey
  );
  const active = await queryAll(
    db,
    `SELECT * FROM eazpire_product_active_providers WHERE product_key = ?`,
    productKey
  );

  let blueprintProviders = [];
  const printifyBlueprintId = await resolvePrintifyBlueprintId(db, product.source_blueprint_id);
  if (printifyBlueprintId) {
    const p = await printifyGet(
      env,
      `/catalog/blueprints/${encodeURIComponent(printifyBlueprintId)}/print_providers.json`
    );
    if (p.ok && Array.isArray(p.data)) blueprintProviders = p.data;
  }

  const catalogRes = await fetchAllPrintProviders(env);
  const catalogById = catalogRes.ok ? buildPrintProviderCatalogMap(catalogRes.providers) : new Map();
  blueprintProviders = blueprintProviders.map((bp) => enrichBlueprintProviderWithCatalog(bp, catalogById));

  const planWithProfile = plans.map((plan) => {
    const profile = profiles.find((p) => p.id === plan.publish_profile_id) || null;
    return { ...plan, profile };
  });

  const activeIds = active.map((a) => Number(a.print_provider_id)).filter((n) => Number.isFinite(n));
  const merged = mergeProviders(planWithProfile, blueprintProviders, activeIds).map((row) =>
    enrichProviderRowWithCatalog(row, catalogById)
  );
  return {
    ok: true,
    product,
    merged_providers: merged,
    blueprint_providers: blueprintProviders,
    publish_plans: planWithProfile,
    active_providers: active,
  };
}

async function enhanceProvidersBundleFromCatalog(env, productKey) {
  const data = await getCatalogOpsProvidersData(env, productKey);
  if (!data.ok) return data;

  const { product, plans, profiles, active, printify_blueprint_id: printifyBlueprintId } = data;

  let blueprintProviders = [];
  if (printifyBlueprintId) {
    const p = await printifyGet(
      env,
      `/catalog/blueprints/${encodeURIComponent(printifyBlueprintId)}/print_providers.json`
    );
    if (p.ok && Array.isArray(p.data)) blueprintProviders = p.data;
  }

  const catalogRes = await fetchAllPrintProviders(env);
  const catalogById = catalogRes.ok ? buildPrintProviderCatalogMap(catalogRes.providers) : new Map();
  blueprintProviders = blueprintProviders.map((bp) => enrichBlueprintProviderWithCatalog(bp, catalogById));

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const planWithProfile = plans.map((plan) => ({
    ...plan,
    profile: plan.publish_profile_id != null ? profileById.get(plan.publish_profile_id) || null : null,
  }));

  const activeIds = active.map((a) => Number(a.print_provider_id)).filter((n) => Number.isFinite(n));
  const merged = mergeProviders(planWithProfile, blueprintProviders, activeIds).map((row) =>
    enrichProviderRowWithCatalog(row, catalogById)
  );

  return {
    ok: true,
    product,
    merged_providers: merged,
    blueprint_providers: blueprintProviders,
    publish_plans: planWithProfile,
    active_providers: active,
    ops_read_source: "catalog-db",
  };
}

export async function loadPrintifySettings(
  env,
  { productKey, printProviderId, versionId, printifyProductId, designType, autoMirror = false }
) {
  if (!productKey || !printifyProductId) return { ok: false, error: "product_key_or_printify_product_id_required" };

  const product = await fetchPrintifyProductById(env, printifyProductId);

  if (isCatalogOpsMasterWrite(env)) {
    const catalogDb = env.CATALOG_DB;
    if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

    const versions = await listCatalogOpsProductVersions(env, productKey);
    const version =
      versions.find((v) => String(v.id) === String(versionId)) ||
      versions.find((v) => String(v.external_provider_id) === String(printProviderId)) ||
      null;

    if (version?.id) {
      const studioPatch = {
        printify_product_id: printifyProductId,
        print_provider_id: Number(printProviderId) || Number(version.external_provider_id) || null,
        design_type: designType || "classic",
        printify_snapshot: product,
        print_areas_snapshot: Array.isArray(product?.print_areas) ? product.print_areas : [],
      };
      await patchCatalogPatStudioConfig(env, version.id, studioPatch, productKey);
    }

    const existingProfile = await queryFirst(
      catalogDb,
      `SELECT print_areas_config_json FROM product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
      productKey,
      Number(printProviderId)
    );
    const currentConfig = parseJson(existingProfile?.print_areas_config_json, {}) || {};
    const mergedConfig = {
      ...currentConfig,
      design_type: designType || currentConfig.design_type || "classic",
      printify_product_id: printifyProductId,
      print_areas: product?.print_areas || [],
    };

    await upsertCatalogPublishProfile(catalogDb, productKey, Number(printProviderId), {
      title: product?.title || null,
      source_product_id: printifyProductId,
      blueprint_id: product?.blueprint_id ?? null,
      product_data_json: product || null,
      print_areas_config_json: mergedConfig,
    });

    return { ok: true, version_id: version?.id || null, printify_product: product, print_areas_config_json: mergedConfig };
  }

  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  const versions = await listProductVersions(db, productKey);
  const version =
    versions.find((v) => String(v.id) === String(versionId)) ||
    versions.find((v) => String(v.external_provider_id) === String(printProviderId)) ||
    null;

  if (version?.id) {
    const studioPatch = {
      printify_product_id: printifyProductId,
      print_provider_id: Number(printProviderId) || Number(version.external_provider_id) || null,
      design_type: designType || "classic",
      printify_snapshot: product,
      print_areas_snapshot: Array.isArray(product?.print_areas) ? product.print_areas : [],
    };
    await updateProductVersion(db, version.id, { studio_config: { ...version.studio_config, ...studioPatch } });
  }

  const existingProfile = await queryFirst(
    db,
    `SELECT print_areas_config_json FROM eazpire_product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  const currentConfig = parseJson(existingProfile?.print_areas_config_json, {}) || {};
  const mergedConfig = {
    ...currentConfig,
    design_type: designType || currentConfig.design_type || "classic",
    printify_product_id: printifyProductId,
    print_areas: product?.print_areas || [],
  };

  await upsertPublishProfile(db, productKey, Number(printProviderId), {
    title: product?.title || null,
    source_product_id: printifyProductId,
    blueprint_id: product?.blueprint_id ?? null,
    product_data_json: product || null,
    print_areas_config_json: mergedConfig,
  });

  if (autoMirror) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true, version_id: version?.id || null, printify_product: product, print_areas_config_json: mergedConfig };
}

export async function savePrintAreaRect(
  env,
  { productKey, printAreaKey, printAreaRect, mockupRect, universalRect, placement, autoMirror = false }
) {
  if (!productKey) return { ok: false, error: "product_key_required" };

  const px = Number(placement?.x);
  const py = Number(placement?.y);
  const ps = Number(placement?.scale);
  const pa = Number(placement?.angle);

  if (isCatalogOpsMasterWrite(env)) {
    return upsertCatalogMockupDefault(env, productKey, printAreaKey, {
      print_area_rect_json: printAreaRect,
      mockup_print_area_rect_json: mockupRect,
      universal_print_area_rect_json: universalRect,
      placement_x: Number.isFinite(px) ? px : undefined,
      placement_y: Number.isFinite(py) ? py : undefined,
      placement_scale: Number.isFinite(ps) ? ps : undefined,
      placement_angle: Number.isFinite(pa) ? pa : undefined,
    });
  }

  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };

  const key = String(printAreaKey || "front").trim() || "front";
  const now = Date.now();
  const row = await queryFirst(
    db,
    `SELECT id FROM eazpire_product_mockup_defaults WHERE product_key = ? AND print_area_key = ?`,
    productKey,
    key
  );

  if (row?.id) {
    await db
      .prepare(
        `UPDATE eazpire_product_mockup_defaults SET
          print_area_rect_json = COALESCE(?, print_area_rect_json),
          mockup_print_area_rect_json = COALESCE(?, mockup_print_area_rect_json),
          universal_print_area_rect_json = COALESCE(?, universal_print_area_rect_json),
          placement_x = COALESCE(?, placement_x),
          placement_y = COALESCE(?, placement_y),
          placement_scale = COALESCE(?, placement_scale),
          placement_angle = COALESCE(?, placement_angle),
          updated_at = ?
         WHERE id = ?`
      )
      .bind(
        printAreaRect != null ? JSON.stringify(printAreaRect) : null,
        mockupRect != null ? JSON.stringify(mockupRect) : null,
        universalRect != null ? JSON.stringify(universalRect) : null,
        Number.isFinite(px) ? px : null,
        Number.isFinite(py) ? py : null,
        Number.isFinite(ps) ? ps : null,
        Number.isFinite(pa) ? pa : null,
        now,
        row.id
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_product_mockup_defaults
          (id, product_key, print_area_key, print_area_rect_json, mockup_print_area_rect_json, universal_print_area_rect_json,
           placement_x, placement_y, placement_scale, placement_angle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId(),
        productKey,
        key,
        printAreaRect != null ? JSON.stringify(printAreaRect) : null,
        mockupRect != null ? JSON.stringify(mockupRect) : null,
        universalRect != null ? JSON.stringify(universalRect) : null,
        Number.isFinite(px) ? px : 0.5,
        Number.isFinite(py) ? py : 0.5,
        Number.isFinite(ps) ? ps : 1,
        Number.isFinite(pa) ? pa : 0,
        now,
        now
      )
      .run();
  }

  if (autoMirror) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true };
}

export async function savePrintAreasConfig(env, productKey, printProviderId, config, autoMirror = false) {
  if (!productKey || printProviderId == null) return { ok: false, error: "product_key_or_print_provider_id_required" };

  if (isCatalogOpsMasterWrite(env)) {
    const catalogDb = env.CATALOG_DB;
    if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };
    await upsertCatalogPublishProfile(catalogDb, productKey, Number(printProviderId), {
      print_areas_config_json: config || {},
    });
    return { ok: true };
  }

  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };

  await upsertPublishProfile(db, productKey, Number(printProviderId), { print_areas_config_json: config || {} });
  if (autoMirror) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true };
}

export async function refreshVariantsFromTemplate(
  env,
  productKey,
  printProviderId,
  printifyProductId,
  autoMirror = false
) {
  if (!productKey || !printifyProductId) return { ok: false, error: "product_key_or_printify_product_id_required" };

  const product = await fetchPrintifyProductById(env, printifyProductId);
  const { variants_json, prices_json } = extractVariantsAndPrices(product);

  if (isCatalogOpsMasterWrite(env)) {
    await upsertCatalogTemplateFromPrintify(env, productKey, Number(printProviderId), product, printifyProductId);
    return { ok: true, printify_product: product, variants_count: variants_json.length };
  }

  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  const now = Date.now();

  const existingTpl = await queryFirst(
    db,
    `SELECT id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  if (existingTpl?.id) {
    await db
      .prepare(
        `UPDATE eazpire_template_products SET
          printify_product_id = ?, title = ?, blueprint_id = ?,
          variants_json = ?, prices_json = ?, product_data_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        String(printifyProductId),
        product?.title || null,
        product?.blueprint_id ?? null,
        JSON.stringify(variants_json),
        JSON.stringify(prices_json),
        JSON.stringify(product),
        now,
        existingTpl.id
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_template_products
          (id, product_key, print_provider_id, printify_product_id, blueprint_id, title, variants_json, prices_json, product_data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId(),
        productKey,
        Number(printProviderId),
        String(printifyProductId),
        product?.blueprint_id ?? null,
        product?.title || null,
        JSON.stringify(variants_json),
        JSON.stringify(prices_json),
        JSON.stringify(product),
        now,
        now
      )
      .run();
  }

  await upsertPublishProfile(db, productKey, Number(printProviderId), {
    title: product?.title || null,
    source_product_id: printifyProductId,
    blueprint_id: product?.blueprint_id ?? null,
    variants_json,
    prices_json,
    product_data_json: product,
  });

  if (autoMirror) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true, printify_product: product, variants_count: variants_json.length };
}

export async function printifyShopProductExists(env, printifyProductId) {
  const id = String(printifyProductId || "").trim();
  if (!id) return false;
  try {
    await fetchPrintifyProductById(env, id);
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes(":404:") || msg.includes("404")) return false;
    return true;
  }
}

async function resolvePrintifyBlueprintForProduct(env, productKey) {
  if (shouldUseCatalogOps(env)) {
    const ops = await getCatalogOpsProduct(env, productKey);
    if (!ops.ok) return ops;
    const blueprintId = ops.printify_blueprint_id;
    if (!blueprintId) return { ok: false, error: "source_blueprint_missing" };
    return { ok: true, blueprint_id: Number(blueprintId), product_title: ops.product?.title };
  }
  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  const productRow = await getEazpireProduct(db, productKey);
  if (!productRow) return { ok: false, error: "not_found" };
  const blueprintId = await resolvePrintifyBlueprintId(db, productRow.source_blueprint_id);
  if (!blueprintId) return { ok: false, error: "source_blueprint_missing" };
  return { ok: true, blueprint_id: Number(blueprintId), product_title: productRow.title };
}

async function getLatestPrintifyUploadId(env) {
  const apiKey = getPrintifyApiKey(env);
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://api.printify.com/v1/uploads.json?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => ({}));
    const uploads = data?.data || data;
    if (!Array.isArray(uploads) || !uploads.length) return null;
    return uploads[0]?.id ?? null;
  } catch {
    return null;
  }
}

function placeholderPositionsFromCatalogVariants(variants) {
  const positions = new Set();
  for (const v of variants || []) {
    for (const ph of v?.placeholders || []) {
      const p = String(ph?.position || "").trim();
      if (p) positions.add(p);
    }
  }
  return positions.size ? [...positions] : ["front"];
}

async function saveDraftProductId(env, productKey, printProviderId, draftId) {
  if (isCatalogOpsMasterWrite(env)) {
    return saveCatalogDraftProductId(env, productKey, printProviderId, draftId);
  }
  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  const now = Date.now();
  const pid = Number(printProviderId);
  const existing = await queryFirst(
    db,
    `SELECT id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );
  if (existing?.id) {
    await db
      .prepare(`UPDATE eazpire_template_products SET printify_draft_product_id = ?, updated_at = ? WHERE id = ?`)
      .bind(String(draftId), now, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO eazpire_template_products
          (id, product_key, print_provider_id, printify_product_id, printify_draft_product_id, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?)`
      )
      .bind(newId(), productKey, pid, String(draftId), now, now)
      .run();
  }
  return { ok: true, printify_draft_product_id: String(draftId) };
}

async function clearDraftProductId(env, productKey, printProviderId) {
  if (isCatalogOpsMasterWrite(env)) {
    return clearCatalogDraftProductId(env, productKey, printProviderId);
  }
  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  const now = Date.now();
  const existing = await queryFirst(
    db,
    `SELECT id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    Number(printProviderId)
  );
  if (!existing?.id) return { ok: true, cleared: false };
  await db
    .prepare(`UPDATE eazpire_template_products SET printify_draft_product_id = NULL, updated_at = ? WHERE id = ?`)
    .bind(now, existing.id)
    .run();
  return { ok: true, cleared: true };
}

async function readDraftProductId(env, productKey, printProviderId) {
  const pid = Number(printProviderId);
  if (shouldUseCatalogOps(env)) {
    const row = await getCatalogOpsTemplateRow(env, productKey, pid);
    return String(row?.printify_draft_product_id || "").trim() || null;
  }
  const row = await queryFirst(
    env.MANUFACTURER_DB,
    `SELECT printify_draft_product_id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );
  return String(row?.printify_draft_product_id || "").trim() || null;
}

export async function validateTemplateDraftProductId(env, productKey, printProviderId) {
  const draftId = await readDraftProductId(env, productKey, printProviderId);
  if (!draftId) return { ok: true, draft_product_id: null, draft_stale_removed: false };
  const exists = await printifyShopProductExists(env, draftId);
  if (exists) return { ok: true, draft_product_id: draftId, draft_stale_removed: false };
  await clearDraftProductId(env, productKey, printProviderId);
  return { ok: true, draft_product_id: null, draft_stale_removed: true, removed_draft_id: draftId };
}

export async function createPrintifyTemplateDraft(env, productKey, printProviderId, autoMirror = false) {
  if (!productKey || printProviderId == null) return { ok: false, error: "product_key_or_print_provider_id_required" };

  const existingDraft = await readDraftProductId(env, productKey, printProviderId);
  if (existingDraft) {
    return { ok: false, error: "draft_already_exists", printify_draft_product_id: existingDraft };
  }

  const bpRes = await resolvePrintifyBlueprintForProduct(env, productKey);
  if (!bpRes.ok) return bpRes;

  const variantsRes = await fetchBlueprintProviderVariants(env, bpRes.blueprint_id, Number(printProviderId));
  if (!variantsRes.ok) return variantsRes;

  const catalogVariants = Array.isArray(variantsRes.variants) ? variantsRes.variants : [];
  if (!catalogVariants.length) return { ok: false, error: "no_variants_found" };

  const placeholderImageId = await getLatestPrintifyUploadId(env);
  if (!placeholderImageId) {
    return {
      ok: false,
      error: "no_placeholder_image",
      message: "No uploaded images in Printify account (required to create a draft product).",
    };
  }

  const positions = placeholderPositionsFromCatalogVariants(catalogVariants);
  const TEMP_PRICE = 1000;
  const enabledVariants = catalogVariants.filter((v) => v?.is_enabled !== false);
  const variants = (enabledVariants.length ? enabledVariants : catalogVariants).map((v) => ({
    id: v.id,
    price: TEMP_PRICE,
    is_enabled: true,
  }));
  const variantIds = variants.map((v) => v.id);
  const placeholders = positions.map((pos) => ({
    position: pos,
    images: [{ id: placeholderImageId, x: -0.5, y: -0.5, scale: 0.01, angle: 0 }],
  }));

  const payload = {
    title: `${bpRes.product_title || productKey} Draft`,
    description: bpRes.product_title || "Eazpire draft product",
    blueprint_id: bpRes.blueprint_id,
    print_provider_id: Number(printProviderId),
    variants,
    print_areas: [{ variant_ids: variantIds, placeholders }],
  };

  let created;
  try {
    created = await createPrintifyProduct(env, payload);
  } catch (err) {
    return { ok: false, error: "printify_draft_create_failed", detail: String(err?.message || err) };
  }

  const pid = String(created?.id || "");
  if (!pid) return { ok: false, error: "printify_draft_create_failed" };

  const saved = await saveDraftProductId(env, productKey, printProviderId, pid);
  if (!saved.ok) return saved;

  if (autoMirror) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true, printify_draft_product_id: pid, draft: created };
}

export async function removePrintifyTemplateDraft(env, productKey, printProviderId) {
  if (!productKey || printProviderId == null) return { ok: false, error: "product_key_or_print_provider_id_required" };
  const draftId = await readDraftProductId(env, productKey, printProviderId);
  if (!draftId) return { ok: false, error: "draft_not_found" };
  const cleared = await clearDraftProductId(env, productKey, printProviderId);
  if (!cleared.ok) return cleared;
  return { ok: true, removed_draft_id: draftId };
}

function extractMockupEntries(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const byId = new Map(variants.map((v) => [String(v.id), v]));
  const images = Array.isArray(product?.images) ? product.images : [];
  const out = [];
  const seen = new Set();
  for (const image of images) {
    if (!image?.src) continue;
    const viewKey = String(image?.position || image?.camera_label || "other")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const vids = Array.isArray(image?.variant_ids) && image.variant_ids.length ? image.variant_ids : [null];
    for (const id of vids) {
      const vv = id != null ? byId.get(String(id)) : null;
      const colorName = String(vv?.title || "Default");
      const key = `${viewKey}::${colorName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        view_key: viewKey || "other",
        color_name: colorName,
        color_hex: null,
        image_url: image.src,
        printify_variant_ids: JSON.stringify(id != null ? [id] : []),
      });
    }
  }
  return out;
}

export async function fetchPrintifyMockups(env, productKey, printProviderId, autoMirror = false, printifyProductIdOverride = null) {
  if (!productKey || printProviderId == null) return { ok: false, error: "product_key_or_print_provider_id_required" };

  const catalogDbRef = env.CATALOG_DB;
  const mfgDb = env.MANUFACTURER_DB;

  const overrideId = String(printifyProductIdOverride || "").trim();
  let printifyProductId = overrideId;

  if (!printifyProductId) {
    const tpl = isCatalogOpsMasterWrite(env)
      ? await queryFirst(
          catalogDbRef,
          `SELECT printify_product_id FROM template_products WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
          productKey,
          Number(printProviderId)
        )
      : await queryFirst(
          mfgDb,
          `SELECT printify_product_id FROM eazpire_template_products WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
          productKey,
          Number(printProviderId)
        );
    printifyProductId = String(tpl?.printify_product_id || "").trim();
  }
  if (!isCatalogOpsMasterWrite(env) && !mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };
  if (isCatalogOpsMasterWrite(env) && !catalogDbRef) return { ok: false, error: "catalog_db_unavailable" };

  if (!printifyProductId) return { ok: false, error: "template_printify_product_missing" };

  const product = await getPrintifyProduct(env, printifyProductId);
  if (!product) return { ok: false, error: "printify_product_not_found" };
  const entries = extractMockupEntries(product);

  if (isCatalogOpsMasterWrite(env)) {
    return replaceCatalogMockupImages(env, productKey, Number(printProviderId), printifyProductId, entries);
  }

  const db = mfgDb;
  const now = Date.now();

  await db
    .prepare(`DELETE FROM eazpire_product_mockup_images WHERE product_key = ? AND print_provider_id = ?`)
    .bind(productKey, Number(printProviderId))
    .run();

  for (const e of entries) {
    await db
      .prepare(
        `INSERT INTO eazpire_product_mockup_images
          (id, product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex, image_url, printify_variant_ids, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId(),
        productKey,
        Number(printProviderId),
        printifyProductId,
        e.view_key,
        e.color_name,
        e.color_hex,
        e.image_url,
        e.printify_variant_ids,
        0,
        now
      )
      .run();
  }

  if (entries.length > 0) {
    await db
      .prepare(
        `UPDATE eazpire_product_mockup_images SET is_default = 1
         WHERE product_key = ? AND print_provider_id = ? AND id = (
           SELECT id FROM eazpire_product_mockup_images WHERE product_key = ? AND print_provider_id = ? ORDER BY created_at ASC LIMIT 1
         )`
      )
      .bind(productKey, Number(printProviderId), productKey, Number(printProviderId))
      .run();
  }

  if (autoMirror) await mirrorEazpireProductToCatalogDb(env, productKey);
  return { ok: true, count: entries.length, printify_product_id: printifyProductId };
}

async function getBasicShadowReadiness(env, productKey) {
  const db = env?.MANUFACTURER_DB;
  if (!db || !productKey) return { ready: false, blocking: [{ code: "manufacturer_db_unavailable" }], warnings: [] };
  const blocking = [];
  const warnings = [];

  const active = await queryFirst(
    db,
    `SELECT 1 AS ok FROM eazpire_product_active_providers WHERE product_key = ? LIMIT 1`,
    productKey
  );
  if (!active?.ok) blocking.push({ code: "active_provider_missing", tab: "provider" });

  const profile = await queryFirst(
    db,
    `SELECT variants_json, prices_json, print_areas_config_json FROM eazpire_product_publish_profiles WHERE product_key = ? LIMIT 1`,
    productKey
  );
  if (!profile) blocking.push({ code: "publish_profile_missing", tab: "provider" });
  if (profile && !Array.isArray(parseJson(profile.variants_json, null))) blocking.push({ code: "variants_missing", tab: "variants" });
  if (profile && !Array.isArray(parseJson(profile.prices_json, null))) blocking.push({ code: "prices_missing", tab: "variants" });
  if (profile && !parseJson(profile.print_areas_config_json, null)) warnings.push({ code: "print_areas_config_missing", tab: "print_area" });

  return { ready: blocking.length === 0, blocking, warnings, checked_at: Date.now() };
}

export async function getProductReadiness(env, productKey) {
  if (env?.CATALOG_DB) {
    try {
      const ready = await buildProductPublishReadiness(env, productKey);
      return { ok: true, ...ready, source: "catalog_publish_readiness" };
    } catch {
      // fallback below
    }
  }
  const basic = await getBasicShadowReadiness(env, productKey);
  return { ok: true, ...basic, source: "shadow_basic_checks" };
}

const COUNTRY_NAME_MAP = {
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  BE: "Belgium",
  AT: "Austria",
  CH: "Switzerland",
  PL: "Poland",
  CZ: "Czech Republic",
  SE: "Sweden",
  DK: "Denmark",
  FI: "Finland",
  NO: "Norway",
  IE: "Ireland",
  PT: "Portugal",
  GR: "Greece",
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  UK: "United Kingdom",
  AU: "Australia",
};

export async function resolveCountries(env, codes) {
  const list = Array.isArray(codes) ? codes : [];
  const normalized = [...new Set(list.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean))];
  const countries = normalized.map((code) => ({ code, name: COUNTRY_NAME_MAP[code] || code }));
  return { ok: true, countries };
}
