/**
 * Read Eazpire ops data from catalog-db (Phase 2 read path).
 */

import { parseJson } from "../db.js";
import { catalogStatusToIsActive, isActiveToCatalogStatus } from "./constants.js";
import { getEazpireProduct } from "./eazpireProductService.js";
import { listProductVersions, patRowToStudioConfig, patRowToAutoPublishConfig } from "./eazpireProductVersionService.js";
import { ensurePrintifyPartner } from "./printifyPartnerSeed.js";
import { resolvePrintifyBlueprintId } from "./editor/partnerEditorExtensions.js";

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

/** Same public mockup base as creator-engine / old admin (getMockupDefaults). */
export function mockupPublicBaseUrl(env) {
  return env?.PUBLIC_FILE_BASE_URL || "https://creator-engine.eazpire.workers.dev";
}

/** Attach template_url + print_area_template_url for partner UI (shared with product_mockup_defaults). */
export function enrichMockupDefaultRow(row, publicBaseUrl) {
  if (!row) return row;
  const base = String(publicBaseUrl || mockupPublicBaseUrl({})).replace(/\/$/, "");
  const printAreaKey = row.print_area_template_r2_key || null;
  const templateKey = row.template_r2_key || null;
  return {
    ...row,
    print_area_template_url: printAreaKey ? `${base}/mockup/${printAreaKey}` : null,
    template_url: templateKey ? `${base}/mockup/${templateKey}` : null,
    has_print_area_in_image: !!printAreaKey,
  };
}

export function enrichMockupDefaultsRows(rows, env) {
  const base = mockupPublicBaseUrl(env);
  return (rows || []).map((row) => enrichMockupDefaultRow(row, base));
}

function catalogRowToProduct(row, link = {}) {
  if (!row) return null;
  const status = isActiveToCatalogStatus(row.is_active);
  return {
    product_key: row.product_key,
    manufacturer_id: link.manufacturer_id || null,
    source_blueprint_id: link.source_blueprint_id || null,
    title: row.title,
    regions: parseJson(row.regions_json, []),
    catalog_status: status,
    is_active: Number(row.is_active),
    visible_design_types: parseJson(row.visible_design_types_json, null),
    catalog_category_group: row.catalog_category_group ?? null,
    catalog_category_leaf: row.catalog_category_leaf ?? null,
    catalog_audience: parseJson(row.catalog_audience_json, null),
    catalog_production_type: row.catalog_production_type ?? null,
    print_area_edit_use_mocks: !!row.print_area_edit_use_mocks,
    created_at: row.created_at,
    updated_at: row.updated_at,
    manufacturer_name: link.manufacturer_name || null,
    blueprint_title: link.blueprint_title || null,
    blueprint_category: link.blueprint_category || null,
    _ops_source: "catalog-db",
  };
}

function profileRowToEditor(row) {
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
    blueprint_id: row.blueprint_id ?? null,
  };
}

function patRowToVersion(pat, linkedEazVersion = null) {
  const ppId = pat.print_provider_id != null ? Number(pat.print_provider_id) : null;
  return {
    id: linkedEazVersion?.id || `pat-${pat.id}`,
    product_key: pat.product_key,
    fulfillment_provider_id: linkedEazVersion?.fulfillment_provider_id || null,
    display_name: pat.display_name || pat.title || "Standard",
    description: pat.description ?? linkedEazVersion?.description ?? null,
    sort_order: pat.sort_order ?? linkedEazVersion?.sort_order ?? 0,
    studio_config: patRowToStudioConfig(pat),
    auto_publish_config: patRowToAutoPublishConfig(pat),
    external_template_product_id: String(pat.printify_product_id || linkedEazVersion?.external_template_product_id || ""),
    product_version_config: parseJson(pat.product_version_config_json, linkedEazVersion?.product_version_config ?? null),
    qr_logo_snapshot: parseJson(pat.qr_logo_snapshot_json, linkedEazVersion?.qr_logo_snapshot ?? null),
    is_active: pat.is_active !== 0,
    publish_enabled: pat.publish_enabled !== 0,
    catalog_pat_id: pat.id,
    created_at: pat.created_at,
    updated_at: pat.updated_at,
    external_provider_id: ppId != null ? String(ppId) : linkedEazVersion?.external_provider_id || null,
    provider_name: linkedEazVersion?.provider_name || null,
    _ops_source: "catalog-db",
  };
}

async function resolveProductLink(env, productKey) {
  const mfgDb = env.MANUFACTURER_DB;
  if (!mfgDb) return {};
  const row = await getEazpireProduct(mfgDb, productKey);
  if (row) {
    return {
      manufacturer_id: row.manufacturer_id,
      source_blueprint_id: row.source_blueprint_id,
      manufacturer_name: row.manufacturer_name,
      blueprint_title: row.blueprint_title,
      blueprint_category: row.blueprint_category,
    };
  }
  try {
    const partnerId = await ensurePrintifyPartner(mfgDb);
    return { manufacturer_id: partnerId };
  } catch {
    return {};
  }
}

async function resolveBlueprintIdFromCatalog(env, productKey, link) {
  if (link.source_blueprint_id && env.MANUFACTURER_DB) {
    const ext = await resolvePrintifyBlueprintId(env.MANUFACTURER_DB, link.source_blueprint_id);
    if (ext) return ext;
  }
  const profile = await env.CATALOG_DB?.prepare(
    `SELECT blueprint_id FROM product_publish_profiles WHERE product_key = ? AND blueprint_id IS NOT NULL LIMIT 1`
  )
    .bind(productKey)
    .first();
  if (profile?.blueprint_id != null) return String(profile.blueprint_id);
  return null;
}

export async function getCatalogOpsProduct(env, productKey) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const row = await catalogDb
    .prepare(`SELECT * FROM product_catalog WHERE product_key = ? LIMIT 1`)
    .bind(productKey)
    .first();
  if (!row) return { ok: false, error: "not_found" };

  const link = await resolveProductLink(env, productKey);
  const product = catalogRowToProduct(row, link);
  const printifyBlueprintId = await resolveBlueprintIdFromCatalog(env, productKey, link);

  return { ok: true, product, printify_blueprint_id: printifyBlueprintId, link };
}

export async function listCatalogOpsProductVersions(env, productKey) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return [];

  const patRows = await queryAll(
    catalogDb,
    `SELECT * FROM print_area_printify_templates
     WHERE product_key = ? AND COALESCE(is_active, 1) = 1
     ORDER BY sort_order ASC, id ASC`,
    productKey
  );

  let eazVersions = [];
  if (env.MANUFACTURER_DB) {
    eazVersions = await listProductVersions(env.MANUFACTURER_DB, productKey);
  }
  const byPatId = new Map(
    eazVersions.filter((v) => v.catalog_pat_id != null).map((v) => [Number(v.catalog_pat_id), v])
  );

  return patRows.map((pat) => patRowToVersion(pat, byPatId.get(Number(pat.id)) || null));
}

export async function getCatalogOpsEditorBundle(env, productKey) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const base = await getCatalogOpsProduct(env, productKey);
  if (!base.ok) return base;

  const activeProviders = await queryAll(
    catalogDb,
    `SELECT * FROM product_active_print_providers WHERE product_key = ? ORDER BY print_provider_id ASC`,
    productKey
  );

  const publishProfileRows = await queryAll(
    catalogDb,
    `SELECT * FROM product_publish_profiles WHERE product_key = ? ORDER BY id ASC`,
    productKey
  );

  const publishPlans = await queryAll(
    catalogDb,
    `SELECT * FROM product_publish_map WHERE product_key = ? ORDER BY priority ASC, id ASC`,
    productKey
  );

  const profileById = new Map();
  const publishProfilesList = publishProfileRows.map((row) => {
    const p = profileRowToEditor(row);
    profileById.set(p.id, p);
    return p;
  });

  const versions = await listCatalogOpsProductVersions(env, productKey);

  let providers = [];
  if (base.product.manufacturer_id && env.MANUFACTURER_DB) {
    const { listFulfillmentProviders } = await import("./fulfillmentProviderService.js");
    providers = await listFulfillmentProviders(env.MANUFACTURER_DB, base.product.manufacturer_id);
  }

  const legacyDrift = env.MANUFACTURER_DB
    ? {
        ok: true,
        legacy_master_may_differ: true,
        message: "Reads from catalog-db; writes use catalog-db when CATALOG_OPS_MASTER_WRITE=1",
      }
    : null;

  return {
    ok: true,
    product: base.product,
    versions,
    providers,
    active_providers: activeProviders.map((r) => ({
      id: r.id,
      product_key: r.product_key,
      print_provider_id: r.print_provider_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      _ops_source: "catalog-db",
    })),
    publish_profiles: publishProfilesList,
    publish_plans: publishPlans.map((plan) => ({
      ...plan,
      profile: plan.publish_profile_id != null ? profileById.get(plan.publish_profile_id) || null : null,
      _ops_source: "catalog-db",
    })),
    drift: legacyDrift,
    ops_read_source: "catalog-db",
    tabs: ["provider", "template", "mockups", "variants", "print_area", "meta_data", "products", "automations"],
  };
}

export async function listCatalogOpsStudioProducts(catalogDb, { catalogStatus, productKeys = null } = {}) {
  if (!catalogDb) return [];
  const isActive = catalogStatusToIsActive(catalogStatus);
  const rows = await queryAll(
    catalogDb,
    `SELECT * FROM product_catalog WHERE is_active = ? ORDER BY title ASC`,
    isActive
  );
  const keySet = productKeys ? new Set(productKeys) : null;
  return rows.filter((r) => !keySet || keySet.has(r.product_key));
}

export async function getCatalogOpsProvidersData(env, productKey) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const base = await getCatalogOpsProduct(env, productKey);
  if (!base.ok) return base;

  const plans = await queryAll(
    catalogDb,
    `SELECT * FROM product_publish_map WHERE product_key = ? ORDER BY priority ASC, id ASC`,
    productKey
  );
  const profiles = await queryAll(
    catalogDb,
    `SELECT * FROM product_publish_profiles WHERE product_key = ?`,
    productKey
  );
  const active = await queryAll(
    catalogDb,
    `SELECT * FROM product_active_print_providers WHERE product_key = ?`,
    productKey
  );

  return {
    ok: true,
    product: base.product,
    printify_blueprint_id: base.printify_blueprint_id,
    plans,
    profiles,
    active,
  };
}

export async function getCatalogOpsVariantsBundle(env, productKey, printProviderId) {
  const catalogDb = env.CATALOG_DB;
  const creatorDb = env.CREATOR_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const pid = Number(printProviderId);
  const profile = Number.isFinite(pid)
    ? await catalogDb
        .prepare(`SELECT * FROM product_publish_profiles WHERE product_key = ? AND print_provider_id = ? LIMIT 1`)
        .bind(productKey, pid)
        .first()
    : null;

  const template = Number.isFinite(pid)
    ? await catalogDb
        .prepare(`SELECT * FROM template_products WHERE product_key = ? AND print_provider_id = ? LIMIT 1`)
        .bind(productKey, pid)
        .first()
    : null;

  let variantConfig = null;
  if (creatorDb && Number.isFinite(pid)) {
    variantConfig = await creatorDb
      .prepare(`SELECT * FROM product_variant_config WHERE product_key = ? AND print_provider_id = ? LIMIT 1`)
      .bind(productKey, pid)
      .first();
  }

  return {
    ok: true,
    variant_config: variantConfig ? parseJson(variantConfig.config_json, {}) : null,
    prices_json: profile ? parseJson(profile.prices_json, null) : null,
    variants_json: profile
      ? parseJson(profile.variants_json, null)
      : template
        ? parseJson(template.variants_json, null)
        : null,
    product_data:
      (profile ? parseJson(profile.product_data_json, null) : null) ||
      (template ? parseJson(template.product_data_json, null) : null) ||
      null,
    template,
    _ops_source: "catalog-db",
  };
}

export async function getCatalogOpsMockupsBundle(env, productKey, printProviderId) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const product = await catalogDb
    .prepare(`SELECT * FROM product_catalog WHERE product_key = ? LIMIT 1`)
    .bind(productKey)
    .first();

  let images = await queryAll(catalogDb, `SELECT * FROM product_mockup_images WHERE product_key = ?`, productKey);
  if (printProviderId != null) {
    images = images.filter((i) => Number(i.print_provider_id) === Number(printProviderId));
  }
  const viewRandom = await queryAll(
    catalogDb,
    `SELECT * FROM product_mockup_view_random WHERE product_key = ?`,
    productKey
  );
  const defaults = enrichMockupDefaultsRows(
    await queryAll(
    catalogDb,
    `SELECT * FROM product_mockup_defaults WHERE product_key = ?`,
    productKey
  ),
    env
  );

  return {
    ok: true,
    product,
    images,
    view_random: viewRandom,
    mockup_defaults: defaults,
    _ops_source: "catalog-db",
  };
}

export async function getCatalogOpsPrintAreaBundle(env, productKey, { printProviderId, versionId } = {}) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  const versions = await listCatalogOpsProductVersions(env, productKey);
  let version = versionId ? versions.find((v) => String(v.id) === String(versionId)) : versions[0];
  if (printProviderId) {
    version = versions.find((v) => String(v.external_provider_id) === String(printProviderId)) || version;
  }

  const mockupDefaults = enrichMockupDefaultsRows(
    await queryAll(
    catalogDb,
    `SELECT * FROM product_mockup_defaults WHERE product_key = ?`,
    productKey
  ),
    env
  );
  const variantPrintAreas = await queryAll(
    catalogDb,
    `SELECT * FROM product_variant_print_areas WHERE product_key = ?`,
    productKey
  );

  return {
    ok: true,
    version,
    versions,
    mockup_defaults: mockupDefaults,
    variant_print_areas: variantPrintAreas,
    _ops_source: "catalog-db",
  };
}

export async function productKeysForProviderFromCatalog(catalogDb, providerExternalId) {
  if (!catalogDb) return [];
  const rows = await queryAll(
    catalogDb,
    `SELECT DISTINCT product_key FROM product_active_print_providers WHERE print_provider_id = ? ORDER BY product_key ASC`,
    Number(providerExternalId)
  );
  return rows.map((r) => r.product_key);
}

export async function listCatalogOpsStudioProductsAsEazpire(env, { manufacturerId, catalogStatus } = {}) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return [];

  const rows = await listCatalogOpsStudioProducts(catalogDb, { catalogStatus });
  let filtered = rows;

  if (manufacturerId && env.MANUFACTURER_DB) {
    const linked = await queryAll(
      env.MANUFACTURER_DB,
      `SELECT product_key FROM eazpire_products WHERE manufacturer_id = ?`,
      manufacturerId
    );
    const keySet = new Set(linked.map((r) => r.product_key));
    if (keySet.size > 0) {
      filtered = rows.filter((r) => keySet.has(r.product_key));
    } else {
      const { getPartnerByIdOrSlug } = await import("./printifyPartnerSeed.js");
      const partner = await getPartnerByIdOrSlug(env.MANUFACTURER_DB, manufacturerId);
      if (String(partner?.slug || "").toLowerCase() !== "printify") {
        filtered = [];
      }
    }
  }

  const out = [];
  for (const row of filtered) {
    const link = await resolveProductLink(env, row.product_key);
    const product = catalogRowToProduct(row, link);
    product.version_count = await queryAll(
      catalogDb,
      `SELECT id FROM print_area_printify_templates WHERE product_key = ? AND COALESCE(is_active, 1) = 1`,
      row.product_key
    ).then((r) => r.length);
    out.push(product);
  }
  return out;
}

export async function getCatalogOpsTemplateRow(env, productKey, printProviderId) {
  const catalogDb = env.CATALOG_DB;
  if (!catalogDb) return null;
  const pid = Number(printProviderId);
  if (!Number.isFinite(pid)) return null;
  return catalogDb
    .prepare(`SELECT * FROM template_products WHERE product_key = ? AND print_provider_id = ? LIMIT 1`)
    .bind(productKey, pid)
    .first();
}
