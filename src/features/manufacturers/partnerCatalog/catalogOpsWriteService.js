/**
 * Write Eazpire ops data directly to catalog-db (Phase 3 write path).
 * variant config → CREATOR_DB per architecture decision.
 */

import { newId } from "../db.js";
import { catalogStatusToIsActive } from "./constants.js";
import {
  studioConfigToPatFields,
  autoPublishConfigToPatFields,
  mergeStudioIntoPatPatch,
} from "./catalogOpsPatFields.js";
import { getProductVersion, patRowToStudioConfig } from "./eazpireProductVersionService.js";
import { getCatalogOpsProduct, listCatalogOpsProductVersions } from "./catalogOpsReadService.js";

async function queryAll(db, sql, ...binds) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return res?.results || [];
  } catch {
    return [];
  }
}

async function queryFirst(db, sql, ...binds) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

function catalogDb(env) {
  return env?.CATALOG_DB || null;
}

function creatorDb(env) {
  return env?.CREATOR_DB || null;
}

/** Resolve numeric PAT id from editor version id (`pat-10`, numeric, or legacy eaz version). */
export async function resolvePatIdFromVersionId(env, versionId, productKey = null) {
  const id = String(versionId || "").trim();
  if (!id) return null;

  const patMatch = id.match(/^pat-(\d+)$/i);
  if (patMatch) return Number(patMatch[1]);

  if (/^\d+$/.test(id)) {
    const n = Number(id);
    const catalogDbRef = catalogDb(env);
    if (catalogDbRef) {
      const pat = await queryFirst(
        catalogDbRef,
        `SELECT id FROM print_area_printify_templates WHERE id = ? LIMIT 1`,
        n
      );
      if (pat?.id != null) return Number(pat.id);
    }
  }

  if (env.MANUFACTURER_DB) {
    const v = await getProductVersion(env.MANUFACTURER_DB, id);
    if (v?.catalog_pat_id != null) return Number(v.catalog_pat_id);
    if (productKey && v?.product_key === productKey && v.catalog_pat_id) {
      return Number(v.catalog_pat_id);
    }
  }

  return null;
}

async function getPatRow(env, patId) {
  const db = catalogDb(env);
  if (!db || patId == null) return null;
  return queryFirst(db, `SELECT * FROM print_area_printify_templates WHERE id = ? LIMIT 1`, patId);
}

export async function upsertCatalogPublishProfile(catalogDbRef, productKey, printProviderId, patch) {
  const now = Date.now();
  const pid = Number(printProviderId);
  const row = await queryFirst(
    catalogDbRef,
    `SELECT * FROM product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    pid
  );

  if (row?.id != null) {
    await catalogDbRef
      .prepare(
        `UPDATE product_publish_profiles SET
          title = COALESCE(?, title),
          source_product_id = COALESCE(?, source_product_id),
          blueprint_id = COALESCE(?, blueprint_id),
          variants_json = COALESCE(?, variants_json),
          prices_json = COALESCE(?, prices_json),
          product_data_json = COALESCE(?, product_data_json),
          print_areas_config_json = COALESCE(?, print_areas_config_json),
          shopify_category_id = COALESCE(?, shopify_category_id),
          standard_product_display_name = COALESCE(?, standard_product_display_name),
          product_features = COALESCE(?, product_features),
          care_instructions = COALESCE(?, care_instructions),
          size_table_html = COALESCE(?, size_table_html),
          gpsr_html = COALESCE(?, gpsr_html),
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
        patch.shopify_category_id ?? null,
        patch.standard_product_display_name ?? null,
        patch.product_features ?? null,
        patch.care_instructions ?? null,
        patch.size_table_html ?? null,
        patch.gpsr_html ?? null,
        now,
        row.id
      )
      .run();
    return row.id;
  }

  const insertResult = await catalogDbRef
    .prepare(
      `INSERT INTO product_publish_profiles
        (product_key, title, source_system, source_product_id, blueprint_id, print_provider_id,
         variants_json, prices_json, product_data_json, print_areas_config_json,
         shopify_category_id, standard_product_display_name, product_features, care_instructions,
         size_table_html, gpsr_html, collected_at, updated_at, is_active, revision)
       VALUES (?, ?, 'printify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
    )
    .bind(
      productKey,
      patch.title || "Publish profile",
      patch.source_product_id || "",
      patch.blueprint_id ?? null,
      pid,
      patch.variants_json != null ? JSON.stringify(patch.variants_json) : null,
      patch.prices_json != null ? JSON.stringify(patch.prices_json) : null,
      patch.product_data_json != null ? JSON.stringify(patch.product_data_json) : null,
      patch.print_areas_config_json != null ? JSON.stringify(patch.print_areas_config_json) : null,
      patch.shopify_category_id ?? null,
      patch.standard_product_display_name ?? null,
      patch.product_features ?? null,
      patch.care_instructions ?? null,
      patch.size_table_html ?? null,
      patch.gpsr_html ?? null,
      now,
      now
    )
    .run();
  return insertResult.meta?.last_row_id ?? null;
}

async function ensureStandardPatForProvider(env, productKey, printProviderId, now) {
  const db = catalogDb(env);
  const pid = Number(printProviderId);
  const existing = await queryFirst(
    db,
    `SELECT * FROM print_area_printify_templates
     WHERE product_key = ? AND print_provider_id = ?
     ORDER BY sort_order ASC, id ASC LIMIT 1`,
    productKey,
    pid
  );
  if (existing) return existing;

  const insertResult = await db
    .prepare(
      `INSERT INTO print_area_printify_templates
        (product_key, print_provider_id, display_name, sort_order, is_active, publish_enabled, created_at, updated_at)
       VALUES (?, ?, 'Standard', 0, 1, 1, ?, ?)`
    )
    .bind(productKey, pid, now, now)
    .run();
  const patId = insertResult.meta?.last_row_id;
  return patId ? getPatRow(env, patId) : null;
}

async function upsertCatalogVariantPrintAreaDimensions(env, productKey, update, now) {
  const db = catalogDb(env);
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
      `SELECT id FROM product_variant_print_areas
       WHERE product_key = ? AND print_area_key = ? AND variant_id = ?`,
      productKey,
      printAreaKey,
      variantId
    );
    if (existing?.id) {
      await db
        .prepare(
          `UPDATE product_variant_print_areas
           SET printify_print_area_width = ?, printify_print_area_height = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(Math.round(width), Math.round(height), now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO product_variant_print_areas
            (product_key, print_area_key, variant_id, variant_title,
             printify_print_area_width, printify_print_area_height, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
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

export async function setCatalogProductStatus(env, productKey, catalogStatus) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const key = String(productKey || "").trim();
  if (!key) return { ok: false, error: "product_key_required" };

  const status = String(catalogStatus || "").toLowerCase();
  const isActive = catalogStatusToIsActive(status);
  const now = Date.now();

  const existing = await queryFirst(db, `SELECT * FROM product_catalog WHERE product_key = ? LIMIT 1`, key);
  if (!existing) return { ok: false, error: "not_found" };

  await db
    .prepare(`UPDATE product_catalog SET is_active = ?, updated_at = ? WHERE product_key = ?`)
    .bind(isActive, now, key)
    .run();

  const product = await getCatalogOpsProduct(env, key);
  return {
    ok: true,
    product_key: key,
    catalog_status: status,
    is_active: isActive,
    product: product.ok ? product.product : null,
    _ops_source: "catalog-db",
  };
}

export async function updateCatalogProductMeta(env, productKey, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const existing = await queryFirst(db, `SELECT * FROM product_catalog WHERE product_key = ? LIMIT 1`, productKey);
  if (!existing) return { ok: false, error: "not_found" };

  const isActive =
    body.catalog_status != null ? catalogStatusToIsActive(body.catalog_status) : existing.is_active;

  await db
    .prepare(
      `UPDATE product_catalog SET
        title = COALESCE(?, title),
        regions_json = COALESCE(?, regions_json),
        is_active = ?,
        visible_design_types_json = COALESCE(?, visible_design_types_json),
        catalog_category_group = COALESCE(?, catalog_category_group),
        catalog_category_leaf = COALESCE(?, catalog_category_leaf),
        catalog_audience_json = COALESCE(?, catalog_audience_json),
        catalog_production_type = COALESCE(?, catalog_production_type),
        print_area_edit_use_mocks = COALESCE(?, print_area_edit_use_mocks),
        updated_at = ?
       WHERE product_key = ?`
    )
    .bind(
      body.title ?? null,
      body.regions != null ? JSON.stringify(body.regions) : null,
      isActive,
      body.visible_design_types != null ? JSON.stringify(body.visible_design_types) : null,
      body.catalog_category_group ?? null,
      body.catalog_category_leaf ?? null,
      body.catalog_audience != null ? JSON.stringify(body.catalog_audience) : null,
      body.catalog_production_type ?? null,
      body.print_area_edit_use_mocks != null ? (body.print_area_edit_use_mocks ? 1 : 0) : null,
      now,
      productKey
    )
    .run();

  const printProviderId = body.print_provider_id;
  if (printProviderId != null) {
    await upsertCatalogPublishProfile(db, productKey, printProviderId, {
      title: body.profile_title ?? body.title ?? existing.title,
      shopify_category_id: body.shopify_category_id ?? null,
      standard_product_display_name: body.standard_product_display_name ?? null,
      product_features: body.product_features ?? null,
      care_instructions: body.care_instructions ?? null,
      size_table_html: body.size_table_html ?? null,
      gpsr_html: body.gpsr_html ?? null,
    });

    if (body.publish_plan) {
      const plan = body.publish_plan;
      const planExisting = await queryFirst(
        db,
        `SELECT id FROM product_publish_map WHERE product_key = ? AND provider_name = ? LIMIT 1`,
        productKey,
        plan.provider_name || ""
      );
      if (planExisting?.id) {
        await db
          .prepare(
            `UPDATE product_publish_map SET
              region_codes_json = ?, country_codes_json = ?, priority = ?, is_enabled = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            JSON.stringify(plan.region_codes || []),
            JSON.stringify(plan.country_codes || []),
            plan.priority ?? 100,
            plan.is_enabled !== false ? 1 : 0,
            now,
            planExisting.id
          )
          .run();
      }
    }
  }

  const product = await getCatalogOpsProduct(env, productKey);
  return { ok: true, product: product.ok ? product.product : null, _ops_source: "catalog-db" };
}

export async function saveCatalogProviders(env, productKey, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const activeIds = Array.isArray(body.active_print_provider_ids)
    ? body.active_print_provider_ids.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];

  const prevActive = await queryAll(
    db,
    `SELECT print_provider_id FROM product_active_print_providers WHERE product_key = ?`,
    productKey
  );
  const prevActiveSet = new Set(prevActive.map((r) => Number(r.print_provider_id)));

  await db.prepare(`DELETE FROM product_active_print_providers WHERE product_key = ?`).bind(productKey).run();
  for (const pid of activeIds) {
    await db
      .prepare(
        `INSERT INTO product_active_print_providers (product_key, print_provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(productKey, pid, now, now)
      .run();
    if (!prevActiveSet.has(pid)) {
      await ensureStandardPatForProvider(env, productKey, pid, now);
    }
  }

  if (Array.isArray(body.deleted_version_ids)) {
    for (const versionId of body.deleted_version_ids) {
      const patId = await resolvePatIdFromVersionId(env, versionId, productKey);
      if (patId) {
        await db.prepare(`DELETE FROM print_area_printify_templates WHERE id = ?`).bind(patId).run();
      }
    }
  }

  if (Array.isArray(body.new_versions)) {
    for (const nv of body.new_versions) {
      const ppId = Number(nv.print_provider_id);
      if (!Number.isFinite(ppId)) continue;
      await db
        .prepare(
          `INSERT INTO print_area_printify_templates
            (product_key, print_provider_id, display_name, sort_order, printify_product_id,
             product_version_config_json, is_active, publish_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          ppId,
          nv.display_name || "New version",
          nv.sort_order ?? 99,
          nv.external_template_product_id || "",
          nv.product_version_config != null ? JSON.stringify(nv.product_version_config) : null,
          nv.is_active !== false ? 1 : 0,
          nv.publish_enabled !== false ? 1 : 0,
          now,
          now
        )
        .run();
    }
  }

  if (Array.isArray(body.version_updates)) {
    for (const vu of body.version_updates) {
      const patId = await resolvePatIdFromVersionId(env, vu.id, productKey);
      if (!patId) continue;
      const patch = [];
      const binds = [];
      if (vu.display_name != null) {
        patch.push("display_name = ?");
        binds.push(String(vu.display_name).trim() || "Version");
      }
      if (vu.product_version_config != null) {
        patch.push("product_version_config_json = ?");
        binds.push(JSON.stringify(vu.product_version_config));
      }
      if (vu.sort_order != null) {
        patch.push("sort_order = ?");
        binds.push(Number(vu.sort_order));
      }
      if (vu.publish_enabled != null) {
        patch.push("publish_enabled = ?");
        binds.push(vu.publish_enabled ? 1 : 0);
      }
      if (vu.is_active != null) {
        patch.push("is_active = ?");
        binds.push(vu.is_active ? 1 : 0);
      }
      if (patch.length) {
        patch.push("updated_at = ?");
        binds.push(now, patId);
        await db.prepare(`UPDATE print_area_printify_templates SET ${patch.join(", ")} WHERE id = ?`).bind(...binds).run();
      }
    }
  }

  if (Array.isArray(body.variant_print_area_updates)) {
    for (const upd of body.variant_print_area_updates) {
      await upsertCatalogVariantPrintAreaDimensions(env, productKey, upd, now);
    }
  }

  if (Array.isArray(body.publish_plan_updates)) {
    for (const plan of body.publish_plan_updates) {
      if (!plan.id) continue;
      await db
        .prepare(
          `UPDATE product_publish_map SET
            region_codes_json = ?, country_codes_json = ?, priority = ?, is_enabled = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          JSON.stringify(plan.region_codes || []),
          JSON.stringify(plan.country_codes || []),
          plan.priority ?? 100,
          plan.is_enabled !== false ? 1 : 0,
          now,
          plan.id
        )
        .run();
    }
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function createCatalogPatVersion(env, productKey, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const ppId = Number(body.print_provider_id);
  if (!Number.isFinite(ppId)) return { ok: false, error: "print_provider_id_required" };

  const now = Date.now();
  const insertResult = await db
    .prepare(
      `INSERT INTO print_area_printify_templates
        (product_key, print_provider_id, display_name, sort_order, printify_product_id, is_active, publish_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`
    )
    .bind(
      productKey,
      ppId,
      body.display_name || "New version",
      body.sort_order ?? 99,
      body.external_template_product_id || "",
      now,
      now
    )
    .run();

  const patId = insertResult.meta?.last_row_id;
  const versions = await listCatalogOpsProductVersions(env, productKey);
  const version = versions.find((v) => Number(v.catalog_pat_id) === Number(patId)) || null;

  return { ok: true, version, _ops_source: "catalog-db" };
}

export async function deleteCatalogPatVersion(env, versionId, productKey = null) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const patId = await resolvePatIdFromVersionId(env, versionId, productKey);
  if (!patId) return { ok: false, error: "not_found" };

  const pat = await getPatRow(env, patId);
  if (!pat) return { ok: false, error: "not_found" };

  await db.prepare(`DELETE FROM print_area_printify_templates WHERE id = ?`).bind(patId).run();
  return { ok: true, product_key: pat.product_key, _ops_source: "catalog-db" };
}

export async function saveCatalogVersionConfig(env, versionId, body, productKey = null) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const patId = await resolvePatIdFromVersionId(env, versionId, productKey);
  if (!patId) return { ok: false, error: "not_found" };

  const existing = await getPatRow(env, patId);
  if (!existing) return { ok: false, error: "not_found" };

  const now = Date.now();
  await db
    .prepare(
      `UPDATE print_area_printify_templates SET
        display_name = COALESCE(?, display_name),
        product_version_config_json = COALESCE(?, product_version_config_json),
        publish_enabled = COALESCE(?, publish_enabled),
        is_active = COALESCE(?, is_active),
        updated_at = ?
       WHERE id = ?`
    )
    .bind(
      body.display_name ?? null,
      body.product_version_config != null ? JSON.stringify(body.product_version_config) : null,
      body.publish_enabled != null ? (body.publish_enabled ? 1 : 0) : null,
      body.is_active != null ? (body.is_active ? 1 : 0) : null,
      now,
      patId
    )
    .run();

  const versions = await listCatalogOpsProductVersions(env, existing.product_key);
  const version = versions.find((v) => Number(v.catalog_pat_id) === patId) || null;
  return { ok: true, version, _ops_source: "catalog-db" };
}

export async function saveCatalogPrintAreaSnapshot(env, versionId, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const patId = await resolvePatIdFromVersionId(env, versionId);
  if (!patId) return { ok: false, error: "not_found" };

  const existing = await getPatRow(env, patId);
  if (!existing) return { ok: false, error: "not_found" };

  const now = Date.now();
  const studio = { ...patRowToStudioConfig(existing), ...(body.studio_config || {}) };
  const patFields = studioConfigToPatFields(studio);

  await db
    .prepare(
      `UPDATE print_area_printify_templates SET
        print_areas_snapshot_json = COALESCE(?, print_areas_snapshot_json),
        printify_print_area_groups_json = COALESCE(?, printify_print_area_groups_json),
        shopify_design_placement = COALESCE(?, shopify_design_placement),
        print_provider_id = COALESCE(?, print_provider_id),
        qr_logo_snapshot_json = COALESCE(?, qr_logo_snapshot_json),
        product_version_config_json = COALESCE(?, product_version_config_json),
        updated_at = ?
       WHERE id = ?`
    )
    .bind(
      patFields.print_areas_snapshot_json,
      patFields.printify_print_area_groups_json,
      patFields.shopify_design_placement,
      patFields.print_provider_id,
      body.qr_logo_snapshot !== undefined ? JSON.stringify(body.qr_logo_snapshot) : null,
      body.product_version_config !== undefined ? JSON.stringify(body.product_version_config) : null,
      now,
      patId
    )
    .run();

  if (body.mockup_default) {
    const md = body.mockup_default;
    const key = String(md.print_area_key || "front").trim() || "front";
    const row = await queryFirst(
      db,
      `SELECT id FROM product_mockup_defaults WHERE product_key = ? AND print_area_key = ?`,
      existing.product_key,
      key
    );
    if (row?.id) {
      await db
        .prepare(
          `UPDATE product_mockup_defaults SET
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

  const versions = await listCatalogOpsProductVersions(env, existing.product_key);
  const version = versions.find((v) => Number(v.catalog_pat_id) === patId) || null;
  return { ok: true, version, _ops_source: "catalog-db" };
}

export async function saveCatalogVariants(env, productKey, printProviderId, body) {
  const catDb = catalogDb(env);
  const crDb = creatorDb(env);
  if (!catDb) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const pid = Number(printProviderId);

  if (body.config != null && crDb) {
    const existing = await queryFirst(
      crDb,
      `SELECT id FROM product_variant_config WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      pid
    );
    const configJson = JSON.stringify(body.config);
    if (existing?.id) {
      await crDb
        .prepare(`UPDATE product_variant_config SET config_json = ?, updated_at = ? WHERE id = ?`)
        .bind(configJson, now, existing.id)
        .run();
    } else {
      await crDb
        .prepare(
          `INSERT INTO product_variant_config (id, product_key, print_provider_id, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(newId(), productKey, pid, configJson, now, now)
        .run();
    }
  }

  if (body.prices_json != null || body.variants_json != null) {
    await upsertCatalogPublishProfile(catDb, productKey, pid, {
      prices_json: body.prices_json ?? undefined,
      variants_json: body.variants_json ?? undefined,
    });
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function saveCatalogTemplate(env, productKey, printProviderId, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const pid = Number(printProviderId);
  const existing = await queryFirst(
    db,
    `SELECT id FROM template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );

  const fields = {
    printify_product_id: String(body.printify_product_id || ""),
    title: body.title ?? null,
    variants_json: body.variants_json != null ? JSON.stringify(body.variants_json) : null,
    prices_json: body.prices_json != null ? JSON.stringify(body.prices_json) : null,
  };

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE template_products SET printify_product_id = ?, title = ?, variants_json = ?, prices_json = ?, updated_at = ? WHERE id = ?`
      )
      .bind(fields.printify_product_id, fields.title, fields.variants_json, fields.prices_json, now, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO template_products
          (product_key, print_provider_id, printify_product_id, title, variants_json, prices_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(productKey, pid, fields.printify_product_id, fields.title, fields.variants_json, fields.prices_json, now, now)
      .run();
  }

  if (body.printify_product_id) {
    const pat = await queryFirst(
      db,
      `SELECT id FROM print_area_printify_templates WHERE product_key = ? AND print_provider_id = ? ORDER BY sort_order ASC LIMIT 1`,
      productKey,
      pid
    );
    if (pat?.id) {
      await db
        .prepare(`UPDATE print_area_printify_templates SET printify_product_id = ?, updated_at = ? WHERE id = ?`)
        .bind(String(body.printify_product_id), now, pat.id)
        .run();
    }
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function saveCatalogMockups(env, productKey, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();

  if (body.print_area_edit_use_mocks !== undefined) {
    await db
      .prepare(`UPDATE product_catalog SET print_area_edit_use_mocks = ?, updated_at = ? WHERE product_key = ?`)
      .bind(body.print_area_edit_use_mocks ? 1 : 0, now, productKey)
      .run();
  }

  if (body.image_rules && Array.isArray(body.image_rules)) {
    for (const rule of body.image_rules) {
      await db
        .prepare(`UPDATE product_mockup_images SET preview_template_ids_json = ? WHERE id = ?`)
        .bind(JSON.stringify(rule.preview_template_ids || []), rule.id)
        .run();
    }
  }

  if (body.view_random_rules && Array.isArray(body.view_random_rules)) {
    for (const rule of body.view_random_rules) {
      const existing = await queryFirst(
        db,
        `SELECT id FROM product_mockup_view_random WHERE product_key = ? AND view_key = ?`,
        productKey,
        rule.view_key
      );
      if (existing?.id) {
        await db
          .prepare(`UPDATE product_mockup_view_random SET template_ids_json = ?, updated_at = ? WHERE id = ?`)
          .bind(JSON.stringify(rule.template_ids || []), now, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO product_mockup_view_random (product_key, view_key, template_ids_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(productKey, rule.view_key, JSON.stringify(rule.template_ids || []), now, now)
          .run();
      }
    }
  }

  if (body.preview_mock_id && body.print_provider_id != null) {
    const ppId = Number(body.print_provider_id);
    await db
      .prepare(`UPDATE product_mockup_images SET is_default = 0 WHERE product_key = ? AND print_provider_id = ?`)
      .bind(productKey, ppId)
      .run();
    await db
      .prepare(`UPDATE product_mockup_images SET is_default = 1 WHERE id = ? AND product_key = ?`)
      .bind(body.preview_mock_id, productKey)
      .run();
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function saveCatalogAutomations(env, versionId, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const patId = await resolvePatIdFromVersionId(env, versionId);
  if (!patId) return { ok: false, error: "not_found" };

  const existing = await getPatRow(env, patId);
  if (!existing) return { ok: false, error: "not_found" };

  const auto = {
    auto_publish_enabled: !!body.auto_publish_enabled,
    automation_shopify_sync_enabled: !!body.automation_shopify_sync_enabled,
    automation_amazon_publish_enabled: !!body.automation_amazon_publish_enabled,
    automation_social: body.automation_social ?? null,
  };
  const autoFields = autoPublishConfigToPatFields(auto);
  const now = Date.now();

  await db
    .prepare(
      `UPDATE print_area_printify_templates SET
        auto_publish_enabled = ?, automation_shopify_sync_enabled = ?,
        automation_amazon_publish_enabled = ?, automation_social_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      autoFields.auto_publish_enabled,
      autoFields.automation_shopify_sync_enabled,
      autoFields.automation_amazon_publish_enabled,
      autoFields.automation_social_json,
      now,
      patId
    )
    .run();

  const versions = await listCatalogOpsProductVersions(env, existing.product_key);
  const version = versions.find((v) => Number(v.catalog_pat_id) === patId) || null;
  return { ok: true, version, _ops_source: "catalog-db" };
}

export async function upsertCatalogMockupDefault(env, productKey, printAreaKey, patch) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const key = String(printAreaKey || "front").trim() || "front";
  const now = Date.now();
  const row = await queryFirst(
    db,
    `SELECT id FROM product_mockup_defaults WHERE product_key = ? AND print_area_key = ?`,
    productKey,
    key
  );

  if (row?.id) {
    await db
      .prepare(
        `UPDATE product_mockup_defaults SET
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
        patch.print_area_rect_json != null ? JSON.stringify(patch.print_area_rect_json) : null,
        patch.mockup_print_area_rect_json != null ? JSON.stringify(patch.mockup_print_area_rect_json) : null,
        patch.universal_print_area_rect_json != null ? JSON.stringify(patch.universal_print_area_rect_json) : null,
        patch.placement_x ?? null,
        patch.placement_y ?? null,
        patch.placement_scale ?? null,
        patch.placement_angle ?? null,
        now,
        row.id
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO product_mockup_defaults
          (product_key, print_area_key, print_area_rect_json, mockup_print_area_rect_json, universal_print_area_rect_json,
           placement_x, placement_y, placement_scale, placement_angle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        key,
        patch.print_area_rect_json != null ? JSON.stringify(patch.print_area_rect_json) : null,
        patch.mockup_print_area_rect_json != null ? JSON.stringify(patch.mockup_print_area_rect_json) : null,
        patch.universal_print_area_rect_json != null ? JSON.stringify(patch.universal_print_area_rect_json) : null,
        patch.placement_x ?? 0.5,
        patch.placement_y ?? 0.5,
        patch.placement_scale ?? 1,
        patch.placement_angle ?? 0,
        now,
        now
      )
      .run();
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function patchCatalogPatStudioConfig(env, versionId, studioPatch, productKey = null) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const patId = await resolvePatIdFromVersionId(env, versionId, productKey);
  if (!patId) return { ok: false, error: "not_found" };

  const existing = await getPatRow(env, patId);
  if (!existing) return { ok: false, error: "not_found" };

  const mergedStudio = { ...patRowToStudioConfig(existing), ...studioPatch };
  const patFields = mergeStudioIntoPatPatch(mergedStudio, existing);
  const now = Date.now();

  await db
    .prepare(
      `UPDATE print_area_printify_templates SET
        print_areas_snapshot_json = COALESCE(?, print_areas_snapshot_json),
        printify_print_area_groups_json = COALESCE(?, printify_print_area_groups_json),
        shopify_design_placement = COALESCE(?, shopify_design_placement),
        print_provider_id = COALESCE(?, print_provider_id),
        printify_product_id = COALESCE(?, printify_product_id),
        updated_at = ?
       WHERE id = ?`
    )
    .bind(
      patFields.print_areas_snapshot_json,
      patFields.printify_print_area_groups_json,
      patFields.shopify_design_placement,
      patFields.print_provider_id,
      studioPatch.printify_product_id != null ? String(studioPatch.printify_product_id) : null,
      now,
      patId
    )
    .run();

  return { ok: true, pat_id: patId, _ops_source: "catalog-db" };
}

export async function upsertCatalogTemplateFromPrintify(env, productKey, printProviderId, product, printifyProductId) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const pid = Number(printProviderId);
  const variants = Array.isArray(product?.variants) ? product.variants.filter((v) => v?.is_enabled !== false) : [];
  const prices = variants.map((v) => {
    const c = v?.cost;
    let cents = 0;
    if (typeof c === "string") {
      const n = parseFloat(c);
      cents = Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
    } else if (typeof c === "number") {
      cents = Math.max(0, Math.round(c));
    }
    return { variant_id: v.id, price: cents };
  });

  const existing = await queryFirst(
    db,
    `SELECT id FROM template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE template_products SET
          printify_product_id = ?, title = ?, blueprint_id = ?,
          variants_json = ?, prices_json = ?, product_data_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        String(printifyProductId),
        product?.title || null,
        product?.blueprint_id ?? null,
        JSON.stringify(variants),
        JSON.stringify(prices),
        JSON.stringify(product),
        now,
        existing.id
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO template_products
          (product_key, print_provider_id, printify_product_id, blueprint_id, title, variants_json, prices_json, product_data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        pid,
        String(printifyProductId),
        product?.blueprint_id ?? null,
        product?.title || null,
        JSON.stringify(variants),
        JSON.stringify(prices),
        JSON.stringify(product),
        now,
        now
      )
      .run();
  }

  await upsertCatalogPublishProfile(db, productKey, pid, {
    title: product?.title || null,
    source_product_id: printifyProductId,
    blueprint_id: product?.blueprint_id ?? null,
    variants_json: variants,
    prices_json: prices,
    product_data_json: product,
  });

  return { ok: true, _ops_source: "catalog-db" };
}

export async function replaceCatalogMockupImages(env, productKey, printProviderId, printifyProductId, entries) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const pid = Number(printProviderId);

  await db
    .prepare(`DELETE FROM product_mockup_images WHERE product_key = ? AND print_provider_id = ?`)
    .bind(productKey, pid)
    .run();

  for (const e of entries) {
    await db
      .prepare(
        `INSERT INTO product_mockup_images
          (product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex, image_url, printify_variant_ids, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        pid,
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
        `UPDATE product_mockup_images SET is_default = 1
         WHERE product_key = ? AND print_provider_id = ? AND id = (
           SELECT id FROM product_mockup_images WHERE product_key = ? AND print_provider_id = ? ORDER BY created_at ASC LIMIT 1
         )`
      )
      .bind(productKey, pid, productKey, pid)
      .run();
  }

  return { ok: true, count: entries.length, _ops_source: "catalog-db" };
}

export async function updateCatalogPatPrintifyProductId(env, productKey, printProviderId, printifyProductId) {
  const db = catalogDb(env);
  if (!db) return;
  const now = Date.now();
  const pat = await queryFirst(
    db,
    `SELECT id FROM print_area_printify_templates WHERE product_key = ? AND print_provider_id = ? ORDER BY sort_order ASC LIMIT 1`,
    productKey,
    Number(printProviderId)
  );
  if (pat?.id) {
    await db
      .prepare(`UPDATE print_area_printify_templates SET printify_product_id = ?, updated_at = ? WHERE id = ?`)
      .bind(String(printifyProductId), now, pat.id)
      .run();
  }
}
