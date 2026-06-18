/**
 * Universal Blueprint service — partner + admin ops (V1)
 */

import { getManufacturerDb, newId, parseJson, slugify } from "../db.js";
import { writeAuditLog } from "../rbac.js";
import { hashJson, slugBlueprintKey } from "./blueprintSchema.js";
import { validateUniversalBlueprint } from "./blueprintValidator.js";
import {
  normalizeWizardInput,
  normalizeFromProviderJson,
  parseCsvVariants,
} from "./blueprintNormalizer.js";

function rowToProviderBlueprint(row) {
  if (!row) return null;
  return {
    id: row.id,
    manufacturer_id: row.manufacturer_id,
    source_type: row.source_type,
    external_blueprint_id: row.external_blueprint_id,
    external_product_id: row.external_product_id,
    title: row.title,
    status: row.status,
    raw: parseJson(row.raw_json, {}),
    raw_hash: row.raw_hash,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToEazpireBlueprint(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider_blueprint_id: row.provider_blueprint_id,
    manufacturer_id: row.manufacturer_id,
    blueprint_key: row.blueprint_key,
    blueprint_version: row.blueprint_version,
    title: row.title,
    normalized_category: row.normalized_category,
    product_type: row.product_type,
    artifact_slot_type: row.artifact_slot_type,
    status: row.status,
    normalized: parseJson(row.normalized_json, {}),
    quality_score: row.quality_score,
    studio_score: row.studio_score,
    auto_publish_score: row.auto_publish_score,
    artifact_score: row.artifact_score,
    admin_notes: row.admin_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    manufacturer_name: row.manufacturer_name,
  };
}

async function getProviderBlueprint(db, manufacturerId, id) {
  const row = await db
    .prepare(`SELECT * FROM manufacturer_provider_blueprints WHERE id = ? AND manufacturer_id = ?`)
    .bind(id, manufacturerId)
    .first();
  return rowToProviderBlueprint(row);
}

async function getEazpireBlueprintByProvider(db, providerBlueprintId) {
  const row = await db
    .prepare(`SELECT * FROM manufacturer_eazpire_blueprints WHERE provider_blueprint_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(providerBlueprintId)
    .first();
  return rowToEazpireBlueprint(row);
}

async function getEazpireBlueprint(db, id) {
  const row = await db.prepare(`SELECT * FROM manufacturer_eazpire_blueprints WHERE id = ?`).bind(id).first();
  return rowToEazpireBlueprint(row);
}

async function recordConversionRun(db, providerBlueprintId, { status, warnings, errors, inputHash, outputHash }) {
  const id = newId("bcr");
  await db
    .prepare(
      `INSERT INTO manufacturer_blueprint_conversion_runs
        (id, provider_blueprint_id, converter_key, input_hash, output_hash, status, warnings_json, errors_json, created_at)
       VALUES (?, ?, 'portal_manual', ?, ?, ?, ?, ?, ?)`
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
  return id;
}

async function upsertEazpireBlueprint(db, providerBlueprintId, manufacturerId, normalized, validation) {
  const existing = await getEazpireBlueprintByProvider(db, providerBlueprintId);
  const now = Date.now();
  const blueprintKey = normalized.identity?.blueprint_key || slugBlueprintKey(normalized.identity?.title);
  const version = normalized.versioning?.version || "1.0.0";
  const payload = [
    blueprintKey,
    version,
    normalized.identity?.title || "Untitled",
    normalized.category?.normalized || null,
    normalized.category?.product_type || null,
    normalized.category?.artifact_slot_type || normalized.artifact?.slot_type || null,
    validation.ok ? validation.status : "validation_failed",
    JSON.stringify(normalized),
    validation.score ?? 0,
    validation.studio_score ?? 0,
    validation.auto_publish_score ?? 0,
    validation.artifact_score ?? 0,
    now,
  ];

  if (existing) {
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
    return getEazpireBlueprint(db, existing.id);
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
      validation.ok ? validation.status : "validation_failed",
      JSON.stringify(normalized),
      validation.score ?? 0,
      validation.studio_score ?? 0,
      validation.auto_publish_score ?? 0,
      validation.artifact_score ?? 0,
      now,
      now
    )
    .run();
  return getEazpireBlueprint(db, id);
}

export async function listPartnerBlueprints(db, manufacturerId, { status } = {}) {
  let sql = `SELECT p.*, e.id AS eazpire_id, e.status AS eazpire_status, e.quality_score
             FROM manufacturer_provider_blueprints p
             LEFT JOIN manufacturer_eazpire_blueprints e ON e.provider_blueprint_id = p.id
             WHERE p.manufacturer_id = ?`;
  const binds = [manufacturerId];
  if (status) {
    sql += ` AND (p.status = ? OR e.status = ?)`;
    binds.push(status, status);
  }
  sql += ` ORDER BY p.updated_at DESC`;
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map((row) => ({
    ...rowToProviderBlueprint(row),
    eazpire_id: row.eazpire_id,
    eazpire_status: row.eazpire_status,
    quality_score: row.quality_score,
  }));
}

export async function getPartnerBlueprintDetail(db, manufacturerId, providerBlueprintId) {
  const provider = await getProviderBlueprint(db, manufacturerId, providerBlueprintId);
  if (!provider) return null;
  const eazpire = await getEazpireBlueprintByProvider(db, providerBlueprintId);
  const runs = await db
    .prepare(
      `SELECT * FROM manufacturer_blueprint_conversion_runs WHERE provider_blueprint_id = ? ORDER BY created_at DESC LIMIT 5`
    )
    .bind(providerBlueprintId)
    .all();
  return {
    provider,
    eazpire,
    conversion_runs: (runs.results || []).map((r) => ({
      ...r,
      warnings: parseJson(r.warnings_json, []),
      errors: parseJson(r.errors_json, []),
    })),
  };
}

export async function createPartnerBlueprint(db, manufacturerId, input, uploadedBy) {
  const now = Date.now();
  const id = newId("pbp");
  const title = input.title || "Untitled Blueprint";
  const raw = input.raw || input;
  await db
    .prepare(
      `INSERT INTO manufacturer_provider_blueprints
        (id, manufacturer_id, source_type, external_product_id, title, status, raw_json, raw_hash, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      manufacturerId,
      input.source_type || "manual_wizard",
      input.external_product_id || null,
      title,
      JSON.stringify(raw),
      hashJson(raw),
      uploadedBy || null,
      now,
      now
    )
    .run();
  return getProviderBlueprint(db, manufacturerId, id);
}

export async function updatePartnerBlueprint(db, manufacturerId, providerBlueprintId, input) {
  const existing = await getProviderBlueprint(db, manufacturerId, providerBlueprintId);
  if (!existing) return null;
  const raw = input.raw ?? input.wizard ?? existing.raw;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE manufacturer_provider_blueprints SET
        title = ?, source_type = ?, external_product_id = ?, raw_json = ?, raw_hash = ?, updated_at = ?
       WHERE id = ? AND manufacturer_id = ?`
    )
    .bind(
      input.title ?? existing.title,
      input.source_type ?? existing.source_type,
      input.external_product_id ?? existing.external_product_id,
      JSON.stringify(raw),
      hashJson(raw),
      now,
      providerBlueprintId,
      manufacturerId
    )
    .run();
  return getProviderBlueprint(db, manufacturerId, providerBlueprintId);
}

export async function uploadPartnerBlueprintJson(db, manufacturerId, { json, uploadedBy }) {
  const raw = typeof json === "string" ? parseJson(json, null) : json;
  if (!raw) return { ok: false, error: "invalid_json" };
  const title = raw.title || raw.identity?.title || "Imported Blueprint";
  const provider = await createPartnerBlueprint(db, manufacturerId, { title, raw, source_type: "json_upload" }, uploadedBy);
  return runConversion(db, manufacturerId, provider.id);
}

export async function uploadPartnerBlueprintCsv(db, manufacturerId, { csv, title, wizard, uploadedBy }) {
  const variants = parseCsvVariants(csv);
  if (!variants.length) return { ok: false, error: "csv_no_variants" };
  const raw = { ...(wizard || {}), title: title || wizard?.title || "CSV Blueprint", variants };
  const provider = await createPartnerBlueprint(db, manufacturerId, { title: raw.title, raw, source_type: "csv_import" }, uploadedBy);
  return runConversion(db, manufacturerId, provider.id);
}

export async function runConversion(db, manufacturerId, providerBlueprintId) {
  const provider = await getProviderBlueprint(db, manufacturerId, providerBlueprintId);
  if (!provider) return { ok: false, error: "not_found" };

  const normalized = normalizeFromProviderJson(provider.raw, {
    manufacturerId,
    sourceType: provider.source_type,
  });
  const validation = validateUniversalBlueprint(normalized);
  const inputHash = hashJson(provider.raw);
  const outputHash = hashJson(normalized);

  await recordConversionRun(db, providerBlueprintId, {
    status: validation.ok ? "success" : "failed",
    warnings: validation.warnings,
    errors: validation.errors,
    inputHash,
    outputHash,
  });

  const eazpire = await upsertEazpireBlueprint(db, providerBlueprintId, manufacturerId, normalized, validation);

  const providerStatus = validation.ok ? "normalized" : "validation_failed";
  await db
    .prepare(`UPDATE manufacturer_provider_blueprints SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(providerStatus, Date.now(), providerBlueprintId)
    .run();

  return { ok: true, provider: { ...provider, status: providerStatus }, eazpire, validation };
}

export async function validatePartnerBlueprint(db, manufacturerId, providerBlueprintId) {
  const detail = await getPartnerBlueprintDetail(db, manufacturerId, providerBlueprintId);
  if (!detail) return { ok: false, error: "not_found" };
  const normalized = detail.eazpire?.normalized || normalizeFromProviderJson(detail.provider.raw, { manufacturerId });
  const validation = validateUniversalBlueprint(normalized);
  if (detail.eazpire) {
    await upsertEazpireBlueprint(db, providerBlueprintId, manufacturerId, normalized, validation);
  }
  return { ok: true, validation, normalized };
}

export async function submitBlueprintForReview(db, manufacturerId, providerBlueprintId) {
  const result = await runConversion(db, manufacturerId, providerBlueprintId);
  if (!result.ok) return result;
  if (!result.validation?.ok) {
    return { ok: false, errors: result.validation.errors, validation: result.validation };
  }
  const now = Date.now();
  await db
    .prepare(`UPDATE manufacturer_provider_blueprints SET status = 'pending_admin_review', updated_at = ? WHERE id = ?`)
    .bind(now, providerBlueprintId)
    .run();
  await db
    .prepare(`UPDATE manufacturer_eazpire_blueprints SET status = 'pending_admin_review', updated_at = ? WHERE provider_blueprint_id = ?`)
    .bind(now, providerBlueprintId)
    .run();
  return {
    ok: true,
    provider: await getProviderBlueprint(db, manufacturerId, providerBlueprintId),
    eazpire: await getEazpireBlueprintByProvider(db, providerBlueprintId),
  };
}

export async function saveWizardBlueprint(db, manufacturerId, input, uploadedBy) {
  const normalized = normalizeWizardInput(input, {
    manufacturerId,
    blueprintKey: input.blueprint_key,
    title: input.title,
  });
  const raw = input.raw || input;
  let provider;
  if (input.provider_blueprint_id) {
    provider = await updatePartnerBlueprint(db, manufacturerId, input.provider_blueprint_id, {
      title: input.title,
      raw: { ...raw, ...input },
    });
  } else {
    provider = await createPartnerBlueprint(
      db,
      manufacturerId,
      { title: input.title, raw: { ...raw, ...input }, source_type: "manual_wizard" },
      uploadedBy
    );
  }
  const validation = validateUniversalBlueprint(normalized);
  const eazpire = await upsertEazpireBlueprint(db, provider.id, manufacturerId, normalized, validation);
  await db
    .prepare(`UPDATE manufacturer_provider_blueprints SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(validation.ok ? "preview_ready" : "validation_failed", Date.now(), provider.id)
    .run();
  return { ok: true, provider, eazpire, validation };
}

// ----- Admin -----

export async function adminListBlueprints(db, { status, limit = 200 } = {}) {
  let sql = `SELECT e.*, m.name AS manufacturer_name, p.title AS provider_title, p.source_type
             FROM manufacturer_eazpire_blueprints e
             JOIN manufacturers m ON m.id = e.manufacturer_id
             JOIN manufacturer_provider_blueprints p ON p.id = e.provider_blueprint_id`;
  const binds = [];
  if (status) {
    sql += ` WHERE e.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY e.updated_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map(rowToEazpireBlueprint);
}

export async function adminGetBlueprintReview(db, eazpireBlueprintId) {
  const eazpire = await getEazpireBlueprint(db, eazpireBlueprintId);
  if (!eazpire) return null;
  const provider = await db
    .prepare(`SELECT * FROM manufacturer_provider_blueprints WHERE id = ?`)
    .bind(eazpire.provider_blueprint_id)
    .first();
  const mfg = await db.prepare(`SELECT name FROM manufacturers WHERE id = ?`).bind(eazpire.manufacturer_id).first();
  const validation = validateUniversalBlueprint(eazpire.normalized);
  const runs = await db
    .prepare(`SELECT * FROM manufacturer_blueprint_conversion_runs WHERE provider_blueprint_id = ? ORDER BY created_at DESC LIMIT 10`)
    .bind(eazpire.provider_blueprint_id)
    .all();
  return {
    eazpire: { ...eazpire, manufacturer_name: mfg?.name },
    provider: rowToProviderBlueprint(provider),
    validation,
    conversion_runs: (runs.results || []).map((r) => ({
      ...r,
      warnings: parseJson(r.warnings_json, []),
      errors: parseJson(r.errors_json, []),
    })),
  };
}

export async function adminReviewBlueprint(env, eazpireBlueprintId, { action, notes, adminOwnerId }) {
  const db = getManufacturerDb(env);
  const eazpire = await getEazpireBlueprint(db, eazpireBlueprintId);
  if (!eazpire) return null;

  const statusMap = {
    approve: "live",
    reject: "rejected",
    request_changes: "pending_partner_fix",
  };
  const status = statusMap[action];
  if (!status) return null;

  const now = Date.now();
  await db
    .prepare(`UPDATE manufacturer_eazpire_blueprints SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?`)
    .bind(status, notes || null, now, eazpireBlueprintId)
    .run();

  const providerStatus =
    action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending_partner_fix";
  await db
    .prepare(`UPDATE manufacturer_provider_blueprints SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(providerStatus, now, eazpire.provider_blueprint_id)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: eazpire.manufacturer_id,
    user_id: adminOwnerId,
    action: `admin_blueprint_${action}`,
    entity_type: "manufacturer_eazpire_blueprint",
    entity_id: eazpireBlueprintId,
  });

  return adminGetBlueprintReview(db, eazpireBlueprintId);
}

export async function adminRerunConversion(env, eazpireBlueprintId) {
  const db = getManufacturerDb(env);
  const eazpire = await getEazpireBlueprint(db, eazpireBlueprintId);
  if (!eazpire) return { ok: false, error: "not_found" };
  return runConversion(db, eazpire.manufacturer_id, eazpire.provider_blueprint_id);
}

export async function listLiveBlueprints(db, { limit = 100 } = {}) {
  const res = await db
    .prepare(
      `SELECT * FROM manufacturer_eazpire_blueprints WHERE status = 'live' ORDER BY updated_at DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  return (res.results || []).map(rowToEazpireBlueprint);
}

export { rowToProviderBlueprint, rowToEazpireBlueprint, slugify };
