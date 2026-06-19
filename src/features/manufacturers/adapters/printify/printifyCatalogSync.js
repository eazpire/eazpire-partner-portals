/**
 * Sync Printify catalog into MANUFACTURER_DB (MVP: online product_keys only)
 */

import { newId, parseJson } from "../../db.js";
import { hashJson, slugBlueprintKey } from "../../blueprints/blueprintSchema.js";
import { validateUniversalBlueprint } from "../../blueprints/blueprintValidator.js";
import { resolveBlueprintIdForProductKey } from "../../../../utils/resolveBlueprintForProductKey.js";
import { ensurePrintifyPartner } from "../../partnerCatalog/printifyPartnerSeed.js";
import { upsertFulfillmentProvider } from "../../partnerCatalog/fulfillmentProviderService.js";
import {
  fetchAllPrintProviders,
  fetchPrintProviderDetail,
  fetchBlueprint,
  fetchBlueprintProviderVariants,
} from "./printifyCatalogClient.js";
import { normalizePrintifyCatalogBlueprint } from "./printifyBlueprintNormalizer.js";

async function getOnlineProductScope(env) {
  if (!env.CATALOG_DB) return [];
  const products = await env.CATALOG_DB.prepare(
    `SELECT product_key, title, regions_json, is_active, visible_design_types_json,
            catalog_category_group, catalog_category_leaf, catalog_audience_json, catalog_production_type,
            print_area_edit_use_mocks
     FROM product_catalog WHERE is_active = 2`
  ).all();

  const scope = [];
  for (const row of products?.results || []) {
    const blueprintId = await resolveBlueprintIdForProductKey(env, row.product_key);
    if (!blueprintId) continue;

    let providerIds = [];
    try {
      const active = await env.CATALOG_DB.prepare(
        `SELECT print_provider_id FROM product_active_print_providers WHERE product_key = ?`
      )
        .bind(row.product_key)
        .all();
      providerIds = (active?.results || []).map((r) => Number(r.print_provider_id)).filter(Boolean);
    } catch {
      /* optional table */
    }
    if (!providerIds.length) {
      const profiles = await env.CATALOG_DB.prepare(
        `SELECT DISTINCT print_provider_id FROM product_publish_profiles
         WHERE product_key = ? AND print_provider_id IS NOT NULL AND is_active = 1`
      )
        .bind(row.product_key)
        .all();
      providerIds = (profiles?.results || []).map((r) => Number(r.print_provider_id)).filter(Boolean);
    }

    scope.push({
      product_key: row.product_key,
      catalog_row: row,
      blueprint_id: blueprintId,
      print_provider_ids: [...new Set(providerIds)],
    });
  }
  return scope;
}

async function upsertProviderBlueprint(db, manufacturerId, blueprintId, raw) {
  const externalId = String(blueprintId);
  const now = Date.now();
  const rawJson = JSON.stringify(raw);
  const rawHash = hashJson(raw);

  let row = await db
    .prepare(
      `SELECT id FROM manufacturer_provider_blueprints
       WHERE manufacturer_id = ? AND external_blueprint_id = ? LIMIT 1`
    )
    .bind(manufacturerId, externalId)
    .first();

  if (row?.id) {
    await db
      .prepare(
        `UPDATE manufacturer_provider_blueprints SET
          title = ?, status = 'parsed', raw_json = ?, raw_hash = ?, source_type = 'printify_catalog_sync', updated_at = ?
         WHERE id = ?`
      )
      .bind(raw?.title || `Blueprint ${externalId}`, rawJson, rawHash, now, row.id)
      .run();
    return row.id;
  }

  const id = newId("pbp");
  await db
    .prepare(
      `INSERT INTO manufacturer_provider_blueprints
        (id, manufacturer_id, source_type, external_blueprint_id, title, status, raw_json, raw_hash, created_at, updated_at)
       VALUES (?, ?, 'printify_catalog_sync', ?, ?, 'parsed', ?, ?, ?, ?)`
    )
    .bind(id, manufacturerId, externalId, raw?.title || `Blueprint ${externalId}`, rawJson, rawHash, now, now)
    .run();
  return id;
}

async function upsertEazpireBlueprintFromNormalized(db, providerBlueprintId, manufacturerId, normalized, validation) {
  const now = Date.now();
  const blueprintKey = normalized.identity?.blueprint_key || slugBlueprintKey(normalized.identity?.title);
  const version = normalized.versioning?.version || "1.0.0";

  const existing = await db
    .prepare(`SELECT id FROM manufacturer_eazpire_blueprints WHERE provider_blueprint_id = ? LIMIT 1`)
    .bind(providerBlueprintId)
    .first();

  const status = validation.ok ? "live" : "validation_failed";
  const payload = [
    blueprintKey,
    version,
    normalized.identity?.title || "Untitled",
    normalized.category?.normalized || null,
    normalized.category?.product_type || null,
    normalized.category?.artifact_slot_type || null,
    status,
    JSON.stringify(normalized),
    validation.score ?? 0,
    validation.studio_score ?? 0,
    validation.auto_publish_score ?? 0,
    validation.artifact_score ?? 0,
    now,
  ];

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE manufacturer_eazpire_blueprints SET
          blueprint_key = ?, blueprint_version = ?, title = ?, normalized_category = ?, product_type = ?,
          artifact_slot_type = ?, status = ?, normalized_json = ?,
          quality_score = ?, studio_score = ?, auto_publish_score = ?, artifact_score = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(...payload, existing.id)
      .run();
    return existing.id;
  }

  const id = newId("ebp");
  await db
    .prepare(
      `INSERT INTO manufacturer_eazpire_blueprints
        (id, provider_blueprint_id, manufacturer_id, blueprint_key, blueprint_version, title,
         normalized_category, product_type, artifact_slot_type, status, normalized_json,
         quality_score, studio_score, auto_publish_score, artifact_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      providerBlueprintId,
      manufacturerId,
      blueprintKey,
      version,
      normalized.identity?.title || "Untitled",
      normalized.category?.normalized || null,
      normalized.category?.product_type || null,
      normalized.category?.artifact_slot_type || null,
      status,
      JSON.stringify(normalized),
      validation.score ?? 0,
      validation.studio_score ?? 0,
      validation.auto_publish_score ?? 0,
      validation.artifact_score ?? 0,
      now,
      now
    )
    .run();
  return id;
}

async function recordPrintifyConversionRun(db, providerBlueprintId, { status, warnings, errors, inputHash, outputHash }) {
  const id = newId("bcr");
  await db
    .prepare(
      `INSERT INTO manufacturer_blueprint_conversion_runs
        (id, provider_blueprint_id, converter_key, input_hash, output_hash, status, warnings_json, errors_json, created_at)
       VALUES (?, ?, 'printify_catalog', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      providerBlueprintId,
      inputHash || null,
      outputHash || null,
      status,
      JSON.stringify(warnings || []),
      JSON.stringify(errors || []),
      Date.now()
    )
    .run();
}

export async function syncPrintifyPartnerCatalog(env) {
  const db = env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };

  const partnerId = await ensurePrintifyPartner(db);
  const scope = await getOnlineProductScope(env);
  if (!scope.length) {
    return { ok: true, synced: { providers: 0, blueprints: 0, scope_products: 0 }, message: "no_online_products_in_catalog" };
  }

  const neededProviderIds = new Set();
  const neededBlueprintIds = new Set();
  for (const item of scope) {
    neededBlueprintIds.add(item.blueprint_id);
    for (const pid of item.print_provider_ids) neededProviderIds.add(pid);
  }

  const providersResult = await fetchAllPrintProviders(env);
  if (!providersResult.ok) return { ok: false, error: providersResult.error };

  let providersSynced = 0;
  for (const p of providersResult.providers) {
    if (!neededProviderIds.has(Number(p.id))) continue;
    await upsertFulfillmentProvider(db, partnerId, {
      external_provider_id: String(p.id),
      integration_system: "printify",
      name: p.title || `Provider ${p.id}`,
      location: p.location || {},
      synced_at: Date.now(),
    });
    providersSynced++;
  }

  let blueprintsSynced = 0;
  const blueprintIdToEazpireId = new Map();

  for (const blueprintId of neededBlueprintIds) {
    const bpResult = await fetchBlueprint(env, blueprintId);
    if (!bpResult.ok) continue;
    const raw = { ...bpResult.blueprint, id: blueprintId };

    const providerBlueprintId = await upsertProviderBlueprint(db, partnerId, blueprintId, raw);
    const firstProviderId = [...neededProviderIds][0];
    let variantsPayload = null;
    if (firstProviderId) {
      const vResult = await fetchBlueprintProviderVariants(env, blueprintId, firstProviderId);
      if (vResult.ok) variantsPayload = vResult;
    }

    const normalized = normalizePrintifyCatalogBlueprint(raw, {
      manufacturerId: partnerId,
      printProviderId: firstProviderId,
      variantsPayload,
    });
    const validation = validateUniversalBlueprint(normalized);
    await recordPrintifyConversionRun(db, providerBlueprintId, {
      status: validation.ok ? "ok" : "failed",
      warnings: validation.warnings,
      errors: validation.errors,
      inputHash: hashJson(raw),
      outputHash: hashJson(normalized),
    });
    const eazpireBlueprintId = await upsertEazpireBlueprintFromNormalized(
      db,
      providerBlueprintId,
      partnerId,
      normalized,
      validation
    );
    blueprintIdToEazpireId.set(blueprintId, eazpireBlueprintId);
    blueprintsSynced++;
  }

  return {
    ok: true,
    synced: {
      providers: providersSynced,
      blueprints: blueprintsSynced,
      scope_products: scope.length,
    },
    scope: scope.map((s) => ({
      product_key: s.product_key,
      blueprint_id: s.blueprint_id,
      eazpire_blueprint_id: blueprintIdToEazpireId.get(s.blueprint_id) || null,
      print_provider_ids: s.print_provider_ids,
    })),
  };
}

export async function listPartnerCatalogBlueprints(db, manufacturerId, { status = "live" } = {}) {
  let sql = `SELECT eb.*, m.name AS manufacturer_name
             FROM manufacturer_eazpire_blueprints eb
             JOIN manufacturers m ON m.id = eb.manufacturer_id
             WHERE eb.manufacturer_id = ?`;
  const binds = [manufacturerId];
  if (status) {
    sql += ` AND eb.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY eb.updated_at DESC`;
  const res = await db.prepare(sql).bind(...binds).all();
  return (res?.results || []).map((row) => ({
    id: row.id,
    manufacturer_id: row.manufacturer_id,
    manufacturer_name: row.manufacturer_name,
    blueprint_key: row.blueprint_key,
    title: row.title,
    normalized_category: row.normalized_category,
    status: row.status,
    quality_score: row.quality_score,
    normalized: parseJson(row.normalized_json, {}),
    updated_at: row.updated_at,
  }));
}
