/**
 * Write Eazpire ops data directly to catalog-db (Phase 3 write path).
 * variant config → CREATOR_DB per architecture decision.
 */

import { catalogStatusToIsActive, coerceVariantConfigProviderId } from "./constants.js";
import {
  studioConfigToPatFields,
  autoPublishConfigToPatFields,
  mergeStudioIntoPatPatch,
} from "./catalogOpsPatFields.js";
import { getProductVersion, updateProductVersion, patRowToStudioConfig } from "./eazpireProductVersionService.js";
import { updateEazpireProduct } from "./eazpireProductService.js";
import { getCatalogOpsProduct, listCatalogOpsProductVersions } from "./catalogOpsReadService.js";
import { regionCodesFromCountryCodes, expandToIsoCountryCodes } from "../../catalog/resolvePlanCountries.js";
import {
  MOCKUP_SET_CLEAN,
  MOCKUP_SET_SHOP_PREVIEW,
  MOCKUP_SET_CALIBRATION,
  normalizeMockupSet,
  filterImagesByMockupSet,
  mockupSetSqlMatch,
} from "./mockupSet.js";
import {
  ensureCatalogMockupImageSchema,
  dedupeMockupEntriesByViewColor,
} from "./ensureCatalogMockupImageSchema.js";

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

let catalogTemplateColumnsReady = false;

async function ensureCatalogTemplateProductColumns(db) {
  if (!db || catalogTemplateColumnsReady) return;
  try {
    const res = await db.prepare(`PRAGMA table_info(template_products)`).all();
    const cols = new Set((res?.results || []).map((row) => row.name));
    const add = async (name) => {
      if (!cols.has(name)) {
        await db.prepare(`ALTER TABLE template_products ADD COLUMN ${name} TEXT`).run();
        cols.add(name);
      }
    };
    await add("printify_draft_product_id");
    await add("printify_mockups_product_id");
    await add("printify_shop_preview_mockups_product_id");
    await add("printify_calibration_mockups_product_id");
    await add("printify_variants_product_id");
    await add("printify_print_areas_product_id");
    await add("variants_product_data_json");
    await add("variants_printify_product_id");
    catalogTemplateColumnsReady = true;
  } catch (err) {
    console.warn("[catalogOpsWriteService] ensureCatalogTemplateProductColumns:", err?.message || err);
  }
}

/** Templates tab sync sections → template_products column */
export const TEMPLATE_SECTION_PRINTIFY_COLUMNS = {
  calibration_mockup: "printify_calibration_mockups_product_id",
  mockups: "printify_mockups_product_id",
  shop_preview_mockups: "printify_shop_preview_mockups_product_id",
  variants: "printify_variants_product_id",
  print_areas: "printify_print_areas_product_id",
};

async function ensureCatalogDraftProductIdColumn(db) {
  await ensureCatalogTemplateProductColumns(db);
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
  // Guard: D1 INTEGER binds reject NaN (opaque Todify ids like "ma-1" → Number NaN).
  if (!Number.isFinite(pid)) {
    throw new Error(
      `invalid_print_provider_id: expected numeric Printify id, got "${printProviderId}"`
    );
  }
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

async function resolveDefaultPatDisplayName(env, productKey) {
  const db = catalogDb(env);
  // Prefer partner Details title over auto-seeded "Standard" for Todify drafts.
  try {
    const {
      loadPartnerEditorSource,
      resolvePartnerCatalogDisplayTitle,
      isPlaceholderVersionDisplayName,
    } = await import("./partnerCatalogEditorEnrichment.js");
    const partner = await loadPartnerEditorSource(env, productKey);
    const cat = await queryFirst(db, `SELECT title FROM product_catalog WHERE product_key = ? LIMIT 1`, productKey);
    const profile = await queryFirst(
      db,
      `SELECT title, standard_product_display_name, source_system
       FROM product_publish_profiles WHERE product_key = ? ORDER BY id ASC LIMIT 1`,
      productKey
    );
    const title = resolvePartnerCatalogDisplayTitle({
      title: partner?.title,
      productTitle: cat?.title,
      profileTitle: profile?.title || profile?.standard_product_display_name,
    });
    if (title && !isPlaceholderVersionDisplayName(title)) return title;
  } catch (e) {
    console.warn("[catalog-ops] resolve default PAT name:", e?.message || e);
  }
  return "Standard";
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

  const displayName = await resolveDefaultPatDisplayName(env, productKey);
  const insertResult = await db
    .prepare(
      `INSERT INTO print_area_printify_templates
        (product_key, print_provider_id, display_name, sort_order, is_active, publish_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, 1, ?, ?)`
    )
    .bind(productKey, pid, displayName, now, now)
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

/**
 * Write visibility to product_catalog.is_active (shop-create SoT) and eazpire_products.catalog_status.
 * Upserts a minimal catalog row when missing so Todify/partner products never stay invisible.
 */
export async function syncPublishIndexVisibility(env, productKey, catalogStatus, { title = null, regionsJson = null } = {}) {
  const db = catalogDb(env);
  const key = String(productKey || "").trim();
  const status = String(catalogStatus || "").toLowerCase();
  if (!db || !key || !["offline", "preview", "online"].includes(status)) {
    return { ok: false, error: "invalid_visibility_sync" };
  }
  const isActive = catalogStatusToIsActive(status);
  const now = Date.now();

  const existing = await queryFirst(db, `SELECT product_key, title, regions_json FROM product_catalog WHERE product_key = ? LIMIT 1`, key);
  if (existing) {
    await db
      .prepare(`UPDATE product_catalog SET is_active = ?, updated_at = ? WHERE product_key = ?`)
      .bind(isActive, now, key)
      .run();
  } else {
    const rowTitle = title || key;
    const regions = regionsJson || JSON.stringify(["EU"]);
    await db
      .prepare(
        `INSERT INTO product_catalog (product_key, title, regions_json, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(key, rowTitle, regions, isActive, now, now)
      .run();
  }

  if (env.MANUFACTURER_DB) {
    try {
      await env.MANUFACTURER_DB.prepare(
        `UPDATE eazpire_products SET catalog_status = ?, updated_at = ? WHERE product_key = ?`
      )
        .bind(status, now, key)
        .run();
    } catch (e) {
      console.warn("[syncPublishIndexVisibility] eazpire_products:", e?.message || e);
    }
  }

  return { ok: true, product_key: key, catalog_status: status, is_active: isActive };
}

export async function setCatalogProductStatus(env, productKey, catalogStatus) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const key = String(productKey || "").trim();
  if (!key) return { ok: false, error: "product_key_required" };

  const status = String(catalogStatus || "").toLowerCase();
  if (!["offline", "preview", "online"].includes(status)) {
    return { ok: false, error: "invalid_catalog_status" };
  }

  const existing = await queryFirst(db, `SELECT * FROM product_catalog WHERE product_key = ? LIMIT 1`, key);
  if (!existing) return { ok: false, error: "not_found" };

  const synced = await syncPublishIndexVisibility(env, key, status, {
    title: existing.title,
    regionsJson: existing.regions_json,
  });
  if (!synced.ok) return synced;

  const product = await getCatalogOpsProduct(env, key);
  return {
    ok: true,
    product_key: key,
    catalog_status: status,
    is_active: synced.is_active,
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
        is_active = ?,
        updated_at = ?
       WHERE product_key = ?`
    )
    .bind(isActive, now, productKey)
    .run();

  const printProviderId = body.print_provider_id;
  if (printProviderId != null) {
    await upsertCatalogPublishProfile(db, productKey, printProviderId, {
      title: body.profile_title ?? existing.title,
      shopify_category_id: body.shopify_category_id ?? null,
      standard_product_display_name: body.standard_product_display_name ?? null,
      product_features: body.product_features ?? null,
      care_instructions: body.care_instructions ?? null,
      size_table_html: body.size_table_html ?? null,
      gpsr_html: body.gpsr_html ?? null,
    });
  }

  const product = await getCatalogOpsProduct(env, productKey);
  return { ok: true, product: product.ok ? product.product : null, _ops_source: "catalog-db" };
}

async function syncCatalogProductDerivedFromProviders(env, db, productKey, activeIds, body, now) {
  const designTypes = new Set();
  const countryCodes = new Set();

  const ingestConfig = (cfg) => {
    if (cfg && Array.isArray(cfg.design_types)) {
      for (const dt of cfg.design_types) {
        if (dt) designTypes.add(String(dt));
      }
    }
  };

  if (Array.isArray(body.version_updates)) {
    for (const vu of body.version_updates) {
      if (vu.product_version_config) ingestConfig(vu.product_version_config);
    }
  }
  if (Array.isArray(body.new_versions)) {
    for (const nv of body.new_versions) ingestConfig(nv.product_version_config);
  }

  if (Array.isArray(body.publish_plan_updates)) {
    for (const plan of body.publish_plan_updates) {
      for (const cc of plan.country_codes || []) countryCodes.add(String(cc).toUpperCase());
    }
  }

  let productTitle = null;
  for (const pid of activeIds) {
    const row = await queryFirst(
      db,
      `SELECT display_name FROM print_area_printify_templates
       WHERE product_key = ? AND print_provider_id = ?
       ORDER BY sort_order ASC, id ASC LIMIT 1`,
      productKey,
      pid
    );
    const name = String(row?.display_name || "").trim();
    // Prefer a real product title over auto-seeded "Standard" when both exist.
    if (name && !/^standard$/i.test(name)) {
      productTitle = name;
      break;
    }
    if (name && !productTitle) productTitle = name;
  }
  if (!productTitle || /^standard$/i.test(productTitle)) {
    const preferred = await resolveDefaultPatDisplayName(env, productKey);
    if (preferred && !/^standard$/i.test(preferred)) productTitle = preferred;
  }

  const regions = regionCodesFromCountryCodes([...countryCodes]);
  const patch = [];
  const binds = [];
  if (productTitle) {
    patch.push("title = ?");
    binds.push(productTitle);
  }
  if (designTypes.size) {
    patch.push("visible_design_types_json = ?");
    binds.push(JSON.stringify([...designTypes]));
  }
  if (regions.length) {
    patch.push("regions_json = ?");
    binds.push(JSON.stringify(regions));
  }
  if (patch.length) {
    patch.push("updated_at = ?");
    binds.push(now, productKey);
    await db.prepare(`UPDATE product_catalog SET ${patch.join(", ")} WHERE product_key = ?`).bind(...binds).run();
  }

  for (const pid of activeIds) {
    const row = await queryFirst(
      db,
      `SELECT display_name FROM print_area_printify_templates
       WHERE product_key = ? AND print_provider_id = ?
       ORDER BY sort_order ASC, id ASC LIMIT 1`,
      productKey,
      pid
    );
    let stdName = String(row?.display_name || "").trim();
    if ((!stdName || /^standard$/i.test(stdName)) && productTitle && !/^standard$/i.test(productTitle)) {
      stdName = productTitle;
    }
    if (!stdName) continue;
    const profile = await queryFirst(
      db,
      `SELECT id FROM product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
      productKey,
      pid
    );
    if (profile?.id) {
      await db
        .prepare(
          `UPDATE product_publish_profiles SET title = ?, standard_product_display_name = ?, updated_at = ? WHERE id = ?`
        )
        .bind(stdName, stdName, now, profile.id)
        .run();
    }
  }
}

export async function saveCatalogProviders(env, productKey, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const now = Date.now();
  const rawActive = Array.isArray(body.active_print_provider_ids) ? body.active_print_provider_ids : [];
  const numericActive = [];
  const opaqueActive = [];
  for (const v of rawActive) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    const n = Number(s);
    if (Number.isFinite(n) && String(n) === s) numericActive.push(n);
    else opaqueActive.push(s);
  }
  // Prefer numeric Printify ids for INTEGER product_active_print_providers; Todify opaque ids
  // (ma-1) are resolved via manufacturer versions — do not wipe the table when only opaque ids ship.
  const activeIds = numericActive;

  const prevActive = await queryAll(
    db,
    `SELECT print_provider_id FROM product_active_print_providers WHERE product_key = ?`,
    productKey
  );
  const prevActiveSet = new Set(prevActive.map((r) => Number(r.print_provider_id)));

  if (activeIds.length || opaqueActive.length === 0) {
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
  }

  if (Array.isArray(body.deleted_version_ids)) {
    for (const versionId of body.deleted_version_ids) {
      const patId = await resolvePatIdFromVersionId(env, versionId, productKey);
      if (patId) {
        await db.prepare(`DELETE FROM print_area_printify_templates WHERE id = ?`).bind(patId).run();
      } else if (env.MANUFACTURER_DB) {
        const id = String(versionId || "").trim();
        if (id && !/^pat-/i.test(id)) {
          const v = await getProductVersion(env.MANUFACTURER_DB, id);
          if (v && v.product_key === productKey) {
            await env.MANUFACTURER_DB.prepare(`DELETE FROM eazpire_product_versions WHERE id = ?`).bind(id).run();
          }
        }
      }
    }
  }

  if (Array.isArray(body.new_versions)) {
    for (const nv of body.new_versions) {
      const ppRaw = nv.print_provider_id;
      const ppId = Number(ppRaw);
      if (Number.isFinite(ppId) && String(ppId) === String(ppRaw).trim()) {
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
        continue;
      }
      // Opaque partner provider (Todify ma-1): store on manufacturer versions only.
      if (env.MANUFACTURER_DB && String(ppRaw || "").trim()) {
        const { upsertProductVersion } = await import("./eazpireProductVersionService.js");
        const fp = await queryFirst(
          env.MANUFACTURER_DB,
          `SELECT id FROM manufacturer_fulfillment_providers WHERE external_provider_id = ? LIMIT 1`,
          String(ppRaw).trim()
        );
        if (fp?.id) {
          await upsertProductVersion(env.MANUFACTURER_DB, {
            product_key: productKey,
            fulfillment_provider_id: fp.id,
            display_name: nv.display_name || "New version",
            sort_order: nv.sort_order ?? 99,
            external_template_product_id: nv.external_template_product_id || "",
            product_version_config: nv.product_version_config ?? null,
            publish_enabled: nv.publish_enabled !== false,
            is_active: nv.is_active !== false,
          });
        }
      }
    }
  }

  if (Array.isArray(body.version_updates)) {
    for (const vu of body.version_updates) {
      const patId = await resolvePatIdFromVersionId(env, vu.id, productKey);
      if (patId) {
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
          if (vu.product_version_config != null) {
            await syncPatVisibilityToManufacturerShadow(env, patId, vu.product_version_config, productKey);
          }
        }
        continue;
      }

      // Todify / partner: version id is manufacturer eazpire_product_versions (no PAT row).
      if (env.MANUFACTURER_DB) {
        const id = String(vu.id || "").trim();
        if (!id || /^pat-/i.test(id)) continue;
        const v = await getProductVersion(env.MANUFACTURER_DB, id);
        if (!v || v.product_key !== productKey) continue;
        const patch = {};
        if (vu.display_name != null) patch.display_name = String(vu.display_name).trim() || "Version";
        if (vu.product_version_config != null) patch.product_version_config = vu.product_version_config;
        if (vu.sort_order != null) patch.sort_order = Number(vu.sort_order);
        if (vu.publish_enabled != null) patch.publish_enabled = !!vu.publish_enabled;
        if (vu.is_active != null) patch.is_active = !!vu.is_active;
        if (Object.keys(patch).length) await updateProductVersion(env.MANUFACTURER_DB, id, patch);
      }
    }
  }

  if (Array.isArray(body.variant_print_area_updates)) {
    for (const upd of body.variant_print_area_updates) {
      await upsertCatalogVariantPrintAreaDimensions(env, productKey, upd, now);
    }
  }

  if (Array.isArray(body.publish_plan_updates)) {
    let allowed = null;
    try {
      const mfgDb = env.MANUFACTURER_DB;
      if (mfgDb) {
        const mp = await queryFirst(
          mfgDb,
          `SELECT regions_json FROM manufacturer_products WHERE eazpire_product_key = ? LIMIT 1`,
          productKey
        );
        if (mp?.regions_json != null) {
          let regions = [];
          try {
            regions = JSON.parse(mp.regions_json || "[]");
          } catch {
            regions = [];
          }
          const list = expandToIsoCountryCodes(regions);
          if (list.length) allowed = new Set(list);
        }
      }
    } catch {
      allowed = null;
    }
    for (const plan of body.publish_plan_updates) {
      if (!plan.id) continue;
      let countryCodes = expandToIsoCountryCodes(Array.isArray(plan.country_codes) ? plan.country_codes : []);
      if (allowed) countryCodes = countryCodes.filter((cc) => allowed.has(cc));
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
          `UPDATE product_publish_map SET
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
          plan.id
        )
        .run();
    }
  }

  await syncCatalogProductDerivedFromProviders(env, db, productKey, activeIds, body, now);

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

async function syncPatVisibilityToManufacturerShadow(env, patId, productVersionConfig, productKey) {
  const mfgDb = env?.MANUFACTURER_DB;
  if (!mfgDb || patId == null || !productVersionConfig) return;

  const cfgJson = JSON.stringify(productVersionConfig);
  const now = Date.now();
  const versionRow = await queryFirst(
    mfgDb,
    `SELECT id FROM eazpire_product_versions WHERE catalog_pat_id = ? LIMIT 1`,
    patId
  );
  if (versionRow?.id) {
    await mfgDb
      .prepare(
        `UPDATE eazpire_product_versions SET product_version_config_json = ?, updated_at = ? WHERE id = ?`
      )
      .bind(cfgJson, now, versionRow.id)
      .run();
  }

  const st = String(productVersionConfig.catalog_status || "").toLowerCase();
  if (!["offline", "preview", "online"].includes(st) || !productKey) return;

  await mfgDb
    .prepare(`UPDATE eazpire_products SET catalog_status = ?, updated_at = ? WHERE product_key = ?`)
    .bind(st, now, productKey)
    .run();
}

export async function saveCatalogVersionConfig(env, versionId, body, productKey = null) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const patId = await resolvePatIdFromVersionId(env, versionId, productKey);
  if (!patId) return { ok: false, error: "not_found" };

  const existing = await getPatRow(env, patId);
  if (!existing) return { ok: false, error: "not_found" };

  const now = Date.now();
  const nextConfig =
    body.product_version_config != null
      ? body.product_version_config
      : parseJson(existing.product_version_config_json, null);

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

  const catalogStatus = String(nextConfig?.catalog_status || "").toLowerCase();
  if (["offline", "preview", "online"].includes(catalogStatus)) {
    // product_catalog.is_active is shop-create SoT — upsert so partner rows cannot drift/miss.
    await syncPublishIndexVisibility(env, existing.product_key, catalogStatus);
    await syncPatVisibilityToManufacturerShadow(env, patId, nextConfig, existing.product_key);
  }

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
  const rawNumericPid = Number(printProviderId);
  const pid = coerceVariantConfigProviderId(printProviderId);
  // CREATOR_DB.print_provider_id is INTEGER — map known opaque partner ids (ma-1 → sentinel).
  if (body.config != null && !Number.isFinite(pid)) {
    return {
      ok: false,
      error: "print_provider_id_required",
      detail: "variant_config_requires_numeric_print_provider_id",
    };
  }

  if (body.config != null && crDb) {
    try {
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
        // id is INTEGER PRIMARY KEY AUTOINCREMENT — never bind UUID/newId()
        await crDb
          .prepare(
            `INSERT INTO product_variant_config (product_key, print_provider_id, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(productKey, pid, configJson, now, now)
          .run();
      }
    } catch (err) {
      return {
        ok: false,
        error: "variant_config_save_failed",
        detail: String(err?.message || err),
      };
    }
  }

  if (body.prices_json != null || body.variants_json != null) {
    // Opaque partner ids must not create publish profiles with sentinel provider ids.
    if (!Number.isFinite(rawNumericPid) || rawNumericPid <= 0) {
      // Todify profiles are often seeded without print_provider_id — update the first profile.
      const anyProfile = await queryFirst(
        catDb,
        `SELECT id FROM product_publish_profiles WHERE product_key = ? ORDER BY id ASC LIMIT 1`,
        productKey
      );
      if (anyProfile?.id) {
        await catDb
          .prepare(
            `UPDATE product_publish_profiles SET
              prices_json = COALESCE(?, prices_json),
              variants_json = COALESCE(?, variants_json),
              updated_at = ?
             WHERE id = ?`
          )
          .bind(
            body.prices_json != null ? JSON.stringify(body.prices_json) : null,
            body.variants_json != null ? JSON.stringify(body.variants_json) : null,
            now,
            anyProfile.id
          )
          .run();
      }
    } else {
      await upsertCatalogPublishProfile(catDb, productKey, rawNumericPid, {
        prices_json: body.prices_json ?? undefined,
        variants_json: body.variants_json ?? undefined,
      });
    }
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function saveCatalogDraftProductId(env, productKey, printProviderId, draftProductId) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  await ensureCatalogDraftProductIdColumn(db);

  const now = Date.now();
  const pid = Number(printProviderId);
  const draftId = String(draftProductId || "").trim();
  if (!draftId) return { ok: false, error: "draft_product_id_required" };

  try {
    const existing = await queryFirst(
      db,
      `SELECT id FROM template_products WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      pid
    );

    if (existing?.id) {
      await db
        .prepare(`UPDATE template_products SET printify_draft_product_id = ?, updated_at = ? WHERE id = ?`)
        .bind(draftId, now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO template_products
            (product_key, print_provider_id, printify_product_id, printify_draft_product_id, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, ?)`
        )
        .bind(productKey, pid, draftId, now, now)
        .run();
    }
  } catch (err) {
    return { ok: false, error: "catalog_db_save_failed", detail: String(err?.message || err) };
  }

  return { ok: true, printify_draft_product_id: draftId, _ops_source: "catalog-db" };
}

export async function clearCatalogDraftProductId(env, productKey, printProviderId) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  await ensureCatalogDraftProductIdColumn(db);

  const now = Date.now();
  const pid = Number(printProviderId);
  const existing = await queryFirst(
    db,
    `SELECT id FROM template_products WHERE product_key = ? AND print_provider_id = ?`,
    productKey,
    pid
  );
  if (!existing?.id) return { ok: true, cleared: false, _ops_source: "catalog-db" };

  await db
    .prepare(`UPDATE template_products SET printify_draft_product_id = NULL, updated_at = ? WHERE id = ?`)
    .bind(now, existing.id)
    .run();

  return { ok: true, cleared: true, _ops_source: "catalog-db" };
}

async function mergeCatalogPublishProfileTemplateSources(catalogDbRef, productKey, printProviderId, section, printifyProductId) {
  const pid = Number(printProviderId);
  const productId = String(printifyProductId || "").trim();
  if (!productId || !TEMPLATE_SECTION_PRINTIFY_COLUMNS[section]) return;

  const row = await queryFirst(
    catalogDbRef,
    `SELECT print_areas_config_json FROM product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`,
    productKey,
    pid
  );
  const config = (() => {
    try {
      return row?.print_areas_config_json ? JSON.parse(row.print_areas_config_json) : {};
    } catch {
      return {};
    }
  })();
  const base = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const templateProductIds = { ...(base.template_product_ids || {}), [section]: productId };
  const mergedConfig = { ...base, template_product_ids: templateProductIds };

  await upsertCatalogPublishProfile(catalogDbRef, productKey, pid, {
    print_areas_config_json: mergedConfig,
  });
}

export async function saveCatalogTemplateSectionProductId(env, productKey, printProviderId, section, printifyProductId) {
  const column = TEMPLATE_SECTION_PRINTIFY_COLUMNS[section];
  if (!column) return { ok: false, error: "invalid_template_section" };

  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  await ensureCatalogTemplateProductColumns(db);

  const now = Date.now();
  const pid = Number(printProviderId);
  const productId = String(printifyProductId || "").trim();
  if (!productId) return { ok: false, error: "printify_product_id_required" };

  try {
    const existing = await queryFirst(
      db,
      `SELECT id FROM template_products WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      pid
    );

    if (existing?.id) {
      await db
        .prepare(`UPDATE template_products SET ${column} = ?, updated_at = ? WHERE id = ?`)
        .bind(productId, now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO template_products
            (product_key, print_provider_id, printify_product_id, ${column}, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, ?)`
        )
        .bind(productKey, pid, productId, now, now)
        .run();
    }

    await mergeCatalogPublishProfileTemplateSources(db, productKey, pid, section, productId);
  } catch (err) {
    return { ok: false, error: "catalog_db_save_failed", detail: String(err?.message || err) };
  }

  return { ok: true, section, printify_product_id: productId, _ops_source: "catalog-db" };
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
    const useMocks = body.print_area_edit_use_mocks ? 1 : 0;
    await db
      .prepare(`UPDATE product_catalog SET print_area_edit_use_mocks = ?, updated_at = ? WHERE product_key = ?`)
      .bind(useMocks, now, productKey)
      .run();
    // Keep manufacturer master in sync so post-save mirror does not revert catalog-db.
    const mfgDb = env.MANUFACTURER_DB;
    if (mfgDb) {
      await updateEazpireProduct(mfgDb, productKey, { print_area_edit_use_mocks: !!useMocks });
    }
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
    const match = mockupSetSqlMatch(MOCKUP_SET_CLEAN);
    await db
      .prepare(`UPDATE product_mockup_images SET is_default = 0 WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`)
      .bind(productKey, ppId, match.bind)
      .run();
    await db
      .prepare(`UPDATE product_mockup_images SET is_default = 1 WHERE id = ? AND product_key = ?`)
      .bind(body.preview_mock_id, productKey)
      .run();
  }

  if (body.shop_preview_mock_id && body.print_provider_id != null) {
    const ppId = Number(body.print_provider_id);
    const match = mockupSetSqlMatch(MOCKUP_SET_SHOP_PREVIEW);
    await db
      .prepare(`UPDATE product_mockup_images SET is_default = 0 WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`)
      .bind(productKey, ppId, match.bind)
      .run();
    await db
      .prepare(`UPDATE product_mockup_images SET is_default = 1 WHERE id = ? AND product_key = ?`)
      .bind(body.shop_preview_mock_id, productKey)
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

/** D1 rejects NaN/undefined binds — coerce optional numbers for COALESCE updates. */
function d1FiniteOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function d1FiniteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Accept object or pre-stringified JSON without double-encoding. */
function d1JsonText(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    throw new Error(`invalid_rect_json: ${err?.message || err}`);
  }
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

  const rectJson = d1JsonText(patch.print_area_rect_json);
  const mockupJson = d1JsonText(patch.mockup_print_area_rect_json);
  const universalJson = d1JsonText(patch.universal_print_area_rect_json);
  const px = d1FiniteOrNull(patch.placement_x);
  const py = d1FiniteOrNull(patch.placement_y);
  const ps = d1FiniteOrNull(patch.placement_scale);
  const pa = d1FiniteOrNull(patch.placement_angle);

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
      .bind(rectJson, mockupJson, universalJson, px, py, ps, pa, now, row.id)
      .run();
  } else {
    // product_mockup_defaults.template_r2_key is TEXT NOT NULL (no DEFAULT).
    // Todify / partner products often have no row yet (read path synthesizes defaults),
    // so INSERT must satisfy NOT NULL — empty string is a valid placeholder until a mock uploads.
    const templateR2 =
      patch.template_r2_key != null && String(patch.template_r2_key).trim()
        ? String(patch.template_r2_key).trim()
        : "";
    await db
      .prepare(
        `INSERT INTO product_mockup_defaults
          (product_key, print_area_key, template_r2_key, template_color,
           print_area_rect_json, mockup_print_area_rect_json, universal_print_area_rect_json,
           placement_x, placement_y, placement_scale, placement_angle, created_at, updated_at)
         VALUES (?, ?, ?, 'white', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        productKey,
        key,
        templateR2,
        rectJson,
        mockupJson,
        universalJson,
        d1FiniteOr(patch.placement_x, 0.5),
        d1FiniteOr(patch.placement_y, 0.5),
        d1FiniteOr(patch.placement_scale, 1),
        d1FiniteOr(patch.placement_angle, 0),
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

  await ensureCatalogTemplateProductColumns(db);

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

  try {
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
            printify_variants_product_id = ?, title = ?, blueprint_id = ?,
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
            (product_key, print_provider_id, printify_product_id, printify_variants_product_id, blueprint_id, title, variants_json, prices_json, product_data_json, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`
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

    await mergeCatalogPublishProfileTemplateSources(db, productKey, pid, "variants", printifyProductId);

    await upsertCatalogPublishProfile(db, productKey, pid, {
      title: product?.title || null,
      source_product_id: printifyProductId,
      blueprint_id: product?.blueprint_id ?? null,
      variants_json: variants,
      prices_json: prices,
      product_data_json: product,
    });
  } catch (err) {
    return { ok: false, error: "catalog_db_save_failed", detail: String(err?.message || err) };
  }

  return { ok: true, _ops_source: "catalog-db" };
}

/** Persist print_areas snapshot on template_products after Print Areas sync (publish reads DB, not live template). */
export async function upsertCatalogTemplatePrintAreasFromPrintify(
  env,
  productKey,
  printProviderId,
  product,
  printifyProductId
) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  await ensureCatalogTemplateProductColumns(db);

  const now = Date.now();
  const pid = Number(printProviderId);
  const printAreas = Array.isArray(product?.print_areas) ? product.print_areas : [];
  const productId = String(printifyProductId || "").trim();
  if (!productId) return { ok: false, error: "printify_product_id_required" };

  try {
    const existing = await queryFirst(
      db,
      `SELECT id, product_data_json FROM template_products WHERE product_key = ? AND print_provider_id = ?`,
      productKey,
      pid
    );
    let mergedProduct = product;
    if (existing?.product_data_json) {
      try {
        const prev = JSON.parse(existing.product_data_json);
        mergedProduct = { ...prev, ...product, print_areas: printAreas.length ? printAreas : prev?.print_areas || [] };
      } catch {
        mergedProduct = product;
      }
    }

    if (existing?.id) {
      await db
        .prepare(
          `UPDATE template_products SET
            printify_print_areas_product_id = ?,
            print_areas_json = ?,
            product_data_json = ?,
            blueprint_id = COALESCE(?, blueprint_id),
            updated_at = ?
           WHERE id = ?`
        )
        .bind(
          productId,
          JSON.stringify(printAreas),
          JSON.stringify(mergedProduct),
          product?.blueprint_id ?? null,
          now,
          existing.id
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO template_products
            (product_key, print_provider_id, printify_product_id, printify_print_areas_product_id, blueprint_id, title, print_areas_json, product_data_json, created_at, updated_at)
           VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          pid,
          productId,
          product?.blueprint_id ?? null,
          product?.title || null,
          JSON.stringify(printAreas),
          JSON.stringify(mergedProduct),
          now,
          now
        )
        .run();
    }

    await mergeCatalogPublishProfileTemplateSources(db, productKey, pid, "print_areas", productId);
  } catch (err) {
    return { ok: false, error: "catalog_db_save_failed", detail: String(err?.message || err) };
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function replaceCatalogMockupImages(env, productKey, printProviderId, printifyProductId, entries, mockupSet = MOCKUP_SET_CLEAN) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  try {
    await ensureCatalogMockupImageSchema(db);
    await ensureCatalogTemplateProductColumns(db);

    const now = Date.now();
    const pid = Number(printProviderId);
    const set = normalizeMockupSet(mockupSet);
    const match = mockupSetSqlMatch(set);

    const { persistMockupEntriesToR2 } = await import("./persistMockupImagesToR2.js");
    const dedupedEntries = dedupeMockupEntriesByViewColor(entries || []);
    const persistedEntries = await persistMockupEntriesToR2(env, productKey, dedupedEntries, set, {
      encodeWebp: false,
      concurrency: 6,
    });

    await db
      .prepare(`DELETE FROM product_mockup_images WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`)
      .bind(productKey, pid, match.bind)
      .run();

    for (const e of persistedEntries) {
      await db
        .prepare(
          `INSERT INTO product_mockup_images
          (product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex, image_url, printify_variant_ids, is_default, mockup_set, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          set,
          now
        )
        .run();
    }

    if (persistedEntries.length > 0) {
      await db
        .prepare(
          `UPDATE product_mockup_images SET is_default = 1
         WHERE product_key = ? AND print_provider_id = ? AND ${match.clause} AND id = (
           SELECT id FROM product_mockup_images WHERE product_key = ? AND print_provider_id = ? AND ${match.clause} ORDER BY created_at ASC LIMIT 1
         )`
        )
        .bind(productKey, pid, match.bind, productKey, pid, match.bind)
        .run();
    }

    const { buildMockupImagesByView } = await import("./mockupImagesByView.js");
    const images = await queryAll(
      db,
      `SELECT * FROM product_mockup_images WHERE product_key = ? AND print_provider_id = ? AND ${match.clause} ORDER BY created_at ASC`,
      productKey,
      pid,
      match.bind
    );

    let calibration_detection = null;
    if (set === MOCKUP_SET_CALIBRATION && persistedEntries.length > 0) {
      const { persistCalibrationRectsFromMockupEntries } = await import("./persistCalibrationRectsFromMockups.js");
      calibration_detection = await persistCalibrationRectsFromMockupEntries(env, productKey, persistedEntries);
    }

    return {
      ok: true,
      count: persistedEntries.length,
      printify_product_id: printifyProductId,
      mockup_set: set,
      by_view: buildMockupImagesByView(images),
      calibration_detection,
      _ops_source: "catalog-db",
    };
  } catch (err) {
    console.error("[replaceCatalogMockupImages]", productKey, mockupSet, err?.message || err);
    return {
      ok: false,
      error: "mockup_sync_failed",
      detail: String(err?.message || err),
      mockup_set: normalizeMockupSet(mockupSet),
    };
  }
}

export async function setCatalogPrintAreaTemplateKey(env, productKey, printAreaKey, r2Key) {
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
      .prepare(`UPDATE product_mockup_defaults SET print_area_template_r2_key = ?, updated_at = ? WHERE id = ?`)
      .bind(r2Key || null, now, row.id)
      .run();
  } else {
    // template_r2_key is NOT NULL — insert placeholder so Todify/first-time rows can be created.
    await db
      .prepare(
        `INSERT INTO product_mockup_defaults
          (product_key, print_area_key, template_r2_key, print_area_template_r2_key, template_color,
           placement_x, placement_y, placement_scale, placement_angle, created_at, updated_at)
         VALUES (?, ?, '', ?, 'white', 0.5, 0.5, 1.0, 0.0, ?, ?)`
      )
      .bind(productKey, key, r2Key || null, now, now)
      .run();
  }

  return { ok: true, _ops_source: "catalog-db" };
}

export async function saveCatalogVariantPrintAreaRect(env, body) {
  const db = catalogDb(env);
  if (!db) return { ok: false, error: "catalog_db_unavailable" };

  const productKey = String(body.product_key || "").trim();
  const printAreaKey = String(body.print_area_key || "front").trim();
  const variantId = Number(body.variant_id);
  const rect = body.print_area_rect;
  const rectType = body.rect_type === "mockup" ? "mockup" : "print_area";

  if (!productKey) return { ok: false, error: "product_key_required" };
  if (!variantId) return { ok: false, error: "variant_id_required" };
  if (!rect || typeof rect.x !== "number" || typeof rect.y !== "number") {
    return { ok: false, error: "print_area_rect_required" };
  }

  const angle = typeof rect.angle === "number" ? Math.max(-180, Math.min(180, rect.angle)) : 0;
  const rectJson = JSON.stringify({
    x: Math.max(0, Math.min(1, rect.x)),
    y: Math.max(0, Math.min(1, rect.y)),
    w: Math.max(0.01, Math.min(1, rect.w)),
    h: Math.max(0.01, Math.min(1, rect.h)),
    angle,
  });

  const now = Date.now();
  const col = rectType === "mockup" ? "mockup_print_area_rect_json" : "print_area_rect_json";
  const result = await db
    .prepare(
      `UPDATE product_variant_print_areas SET ${col} = ?, updated_at = ? WHERE product_key = ? AND print_area_key = ? AND variant_id = ?`
    )
    .bind(rectJson, now, productKey, printAreaKey, variantId)
    .run();

  if (result.meta?.changes === 0) {
    await db
      .prepare(
        `INSERT INTO product_variant_print_areas
          (product_key, print_area_key, variant_id, ${col}, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(productKey, printAreaKey, variantId, rectJson, now, now)
      .run();
  }

  return {
    ok: true,
    product_key: productKey,
    print_area_key: printAreaKey,
    variant_id: variantId,
    rect_type: rectType,
    _ops_source: "catalog-db",
  };
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
