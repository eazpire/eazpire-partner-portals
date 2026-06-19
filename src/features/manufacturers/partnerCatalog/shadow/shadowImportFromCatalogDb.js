/**
 * Import catalog-db shadow rows into MANUFACTURER_DB master (online products)
 */

import { newId } from "../../db.js";

async function deleteShadowRowsForProduct(mfgDb, table, productKey) {
  await mfgDb.prepare(`DELETE FROM ${table} WHERE product_key = ?`).bind(productKey).run();
}

async function safeCatalogAll(catalogDb, sql, productKey) {
  try {
    return await catalogDb.prepare(sql).bind(productKey).all();
  } catch {
    return { results: [] };
  }
}

async function safeCreatorAll(creatorDb, sql, productKey) {
  try {
    return await creatorDb.prepare(sql).bind(productKey).all();
  } catch {
    return { results: [] };
  }
}

export async function importShadowTablesForProduct(env, productKey) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb || !catalogDb) return { ok: false, error: "database_unavailable" };

  const now = Date.now();
  const counts = {};

  const profileCatalogIdToShadowId = {};

  // --- publish profiles (must run before publish plans) ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_publish_profiles", productKey);
  const profiles = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_publish_profiles WHERE product_key = ? ORDER BY id ASC`,
    productKey
  );
  counts.publish_profiles = 0;
  for (const row of profiles.results || []) {
    const shadowId = newId("eppp");
    profileCatalogIdToShadowId[row.id] = shadowId;
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_publish_profiles
          (id, product_key, title, source_system, source_product_id, blueprint_id, print_provider_id,
           product_features, care_instructions, size_table_html, gpsr_html, variants_json, prices_json,
           white_branding_variant_ids, print_area_width, print_area_height, qr_logo_mapping_json,
           product_data_json, shopify_category_id, standard_product_display_name, print_areas_config_json,
           catalog_source_id, is_active, revision, collected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        shadowId,
        row.product_key,
        row.title,
        row.source_system ?? "printify",
        row.source_product_id ?? "",
        row.blueprint_id,
        row.print_provider_id,
        row.product_features,
        row.care_instructions,
        row.size_table_html,
        row.gpsr_html,
        row.variants_json,
        row.prices_json,
        row.white_branding_variant_ids,
        row.print_area_width,
        row.print_area_height,
        row.qr_logo_mapping_json,
        row.product_data_json,
        row.shopify_category_id ?? null,
        row.standard_product_display_name ?? null,
        row.print_areas_config_json ?? null,
        row.id,
        row.is_active ?? 1,
        row.revision ?? 1,
        row.collected_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.publish_profiles++;
  }

  // --- publish plans (product_publish_map) ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_publish_plans", productKey);
  const plans = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_publish_map WHERE product_key = ? ORDER BY id ASC`,
    productKey
  );
  counts.publish_plans = 0;
  for (const row of plans.results || []) {
    const shadowProfileId =
      row.publish_profile_id != null ? profileCatalogIdToShadowId[row.publish_profile_id] ?? null : null;
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_publish_plans
          (id, product_key, region_codes_json, provider_name, provider_location, country_codes_json,
           priority, is_enabled, publish_profile_id, publish_profile_catalog_id, publication_ids_json,
           country_of_origin, amazon_channel_enabled, amazon_markets_enabled_json, catalog_source_id,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("eppl"),
        productKey,
        row.region_codes_json ?? "[]",
        row.provider_name ?? "",
        row.provider_location ?? null,
        row.country_codes_json ?? "[]",
        row.priority ?? 100,
        row.is_enabled ?? 1,
        shadowProfileId,
        row.publish_profile_id ?? null,
        row.publication_ids_json ?? null,
        row.country_of_origin ?? null,
        row.amazon_channel_enabled ?? 0,
        row.amazon_markets_enabled_json ?? null,
        row.id,
        row.created_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.publish_plans++;
  }

  // --- active print providers ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_active_providers", productKey);
  const activeProviders = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_active_print_providers WHERE product_key = ? ORDER BY print_provider_id ASC`,
    productKey
  );
  counts.active_providers = 0;
  for (const row of activeProviders.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_active_providers
          (id, product_key, print_provider_id, catalog_source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("epap"),
        productKey,
        row.print_provider_id,
        row.id,
        row.created_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.active_providers++;
  }

  // --- mockup defaults ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_mockup_defaults", productKey);
  const mockupDefaults = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_mockup_defaults WHERE product_key = ? ORDER BY print_area_key ASC`,
    productKey
  );
  counts.mockup_defaults = 0;
  for (const row of mockupDefaults.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_mockup_defaults
          (id, product_key, print_area_key, template_r2_key, mask_r2_key, template_color,
           placement_x, placement_y, placement_scale, placement_angle,
           printify_print_area_width, printify_print_area_height, template_width, template_height,
           available_colors_json, print_area_rect_json, mockup_print_area_rect_json,
           universal_print_area_rect_json, enabled_colors_json, enabled_sizes_json,
           visible_design_types_json, is_active, catalog_source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("epmd"),
        productKey,
        row.print_area_key ?? "front",
        row.template_r2_key ?? null,
        row.mask_r2_key ?? null,
        row.template_color ?? "white",
        row.placement_x ?? 0.5,
        row.placement_y ?? 0.5,
        row.placement_scale ?? 1.0,
        row.placement_angle ?? 0.0,
        row.printify_print_area_width,
        row.printify_print_area_height,
        row.template_width,
        row.template_height,
        row.available_colors_json,
        row.print_area_rect_json ?? null,
        row.mockup_print_area_rect_json ?? null,
        row.universal_print_area_rect_json ?? null,
        row.enabled_colors_json ?? null,
        row.enabled_sizes_json ?? null,
        row.visible_design_types_json ?? null,
        row.is_active ?? 1,
        row.id,
        row.created_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.mockup_defaults++;
  }

  // --- mockup images ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_mockup_images", productKey);
  const mockupImages = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_mockup_images WHERE product_key = ? ORDER BY id ASC`,
    productKey
  );
  counts.mockup_images = 0;
  for (const row of mockupImages.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_mockup_images
          (id, product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
           image_url, printify_variant_ids, is_default, preview_template_ids_json, catalog_source_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("epmi"),
        productKey,
        row.print_provider_id ?? 0,
        row.printify_product_id ?? "",
        row.view_key,
        row.color_name,
        row.color_hex ?? null,
        row.image_url,
        row.printify_variant_ids ?? null,
        row.is_default ?? 0,
        row.preview_template_ids_json ?? null,
        row.id,
        row.created_at ?? now
      )
      .run();
    counts.mockup_images++;
  }

  // --- mockup view random preview ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_mockup_view_random", productKey);
  const viewRandom = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_mockup_view_random_preview WHERE product_key = ? ORDER BY view_key ASC`,
    productKey
  );
  counts.mockup_view_random = 0;
  for (const row of viewRandom.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_mockup_view_random
          (id, product_key, view_key, template_ids_json, catalog_source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("epmvr"),
        productKey,
        row.view_key,
        row.template_ids_json,
        null,
        row.updated_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.mockup_view_random++;
  }

  // --- variant print areas ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_variant_print_areas", productKey);
  const variantPrintAreas = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_variant_print_areas WHERE product_key = ? ORDER BY id ASC`,
    productKey
  );
  counts.variant_print_areas = 0;
  for (const row of variantPrintAreas.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_variant_print_areas
          (id, product_key, print_area_key, variant_id, variant_title, printify_print_area_width,
           printify_print_area_height, print_area_rect_json, mockup_print_area_rect_json,
           mockup_image_url, catalog_source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("epvpa"),
        productKey,
        row.print_area_key,
        row.variant_id,
        row.variant_title ?? null,
        row.printify_print_area_width,
        row.printify_print_area_height,
        row.print_area_rect_json ?? null,
        row.mockup_print_area_rect_json ?? null,
        row.mockup_image_url ?? null,
        row.id,
        row.created_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.variant_print_areas++;
  }

  // --- base costs ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_base_costs", productKey);
  const baseCosts = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM product_base_costs WHERE product_key = ? ORDER BY region_code ASC`,
    productKey
  );
  counts.base_costs = 0;
  for (const row of baseCosts.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_product_base_costs
          (id, product_key, region_code, base_cost_cents, default_sell_price_cents, min_profit_cents,
           creator_share_percent, currency, source, catalog_source_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("epbc"),
        productKey,
        row.region_code ?? "EU",
        row.base_cost_cents ?? 0,
        row.default_sell_price_cents ?? 0,
        row.min_profit_cents ?? 100,
        row.creator_share_percent ?? 40.0,
        row.currency ?? "EUR",
        row.source ?? "printify",
        row.id,
        row.updated_at ?? now
      )
      .run();
    counts.base_costs++;
  }

  // --- template products ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_template_products", productKey);
  const templateProducts = await safeCatalogAll(
    catalogDb,
    `SELECT * FROM template_products WHERE product_key = ? ORDER BY print_provider_id ASC`,
    productKey
  );
  counts.template_products = 0;
  for (const row of templateProducts.results || []) {
    await mfgDb
      .prepare(
        `INSERT INTO eazpire_template_products
          (id, product_key, print_provider_id, printify_product_id, blueprint_id, title, variants_json,
           prices_json, print_area_width, print_area_height, print_areas_json, selected_positions_json,
           product_data_json, mockup_images_count, catalog_source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("etp"),
        productKey,
        row.print_provider_id,
        row.printify_product_id ?? "",
        row.blueprint_id,
        row.title ?? null,
        row.variants_json ?? null,
        row.prices_json ?? null,
        row.print_area_width,
        row.print_area_height,
        row.print_areas_json ?? null,
        row.selected_positions_json ?? null,
        row.product_data_json ?? null,
        row.mockup_images_count ?? 0,
        row.id,
        row.created_at ?? now,
        row.updated_at ?? now
      )
      .run();
    counts.template_products++;
  }

  // --- variant config (CREATOR_DB) ---
  await deleteShadowRowsForProduct(mfgDb, "eazpire_product_variant_config", productKey);
  counts.variant_config = 0;
  if (env.CREATOR_DB) {
    const variantConfigs = await safeCreatorAll(
      env.CREATOR_DB,
      `SELECT * FROM product_variant_config WHERE product_key = ? ORDER BY print_provider_id ASC`,
      productKey
    );
    for (const row of variantConfigs.results || []) {
      await mfgDb
        .prepare(
          `INSERT INTO eazpire_product_variant_config
            (id, product_key, print_provider_id, config_json, catalog_source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newId("epvc"),
          productKey,
          row.print_provider_id,
          row.config_json ?? "{}",
          row.id,
          row.created_at ?? now,
          row.updated_at ?? now
        )
        .run();
      counts.variant_config++;
    }
  }

  return { ok: true, product_key: productKey, counts };
}

export async function importShadowTablesFromCatalogDb(env, productKeys = null) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };
  if (!catalogDb) return { ok: false, error: "catalog_db_unavailable" };

  let keys = productKeys;
  if (!keys || !keys.length) {
    const online = await catalogDb.prepare(`SELECT product_key FROM product_catalog WHERE is_active = 2`).all();
    keys = (online?.results || []).map((r) => r.product_key);
  }

  const results = [];
  for (const productKey of keys) {
    results.push(await importShadowTablesForProduct(env, productKey));
  }

  const ok = results.every((r) => r.ok);
  return {
    ok,
    imported: results.filter((r) => r.ok).length,
    results,
  };
}
