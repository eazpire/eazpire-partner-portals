/**
 * Mirror MANUFACTURER_DB shadow tables → catalog-db (+ CREATOR_DB variant config)
 */

async function updateShadowCatalogSourceId(mfgDb, table, shadowId, catalogSourceId) {
  await mfgDb
    .prepare(`UPDATE ${table} SET catalog_source_id = ? WHERE id = ?`)
    .bind(catalogSourceId, shadowId)
    .run();
}

export async function mirrorShadowTablesForProduct(env, productKey) {
  const mfgDb = env.MANUFACTURER_DB;
  const catalogDb = env.CATALOG_DB;
  if (!mfgDb || !catalogDb) return { ok: false, error: "database_unavailable" };

  const now = Date.now();
  const counts = {};
  const shadowProfileIdToCatalogId = {};

  // --- publish profiles (before plans) ---
  const profiles = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_publish_profiles WHERE product_key = ? ORDER BY print_provider_id ASC`)
    .bind(productKey)
    .all();
  counts.publish_profiles = 0;
  for (const row of profiles?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_publish_profiles SET
            product_key = ?, title = ?, source_system = ?, source_product_id = ?, blueprint_id = ?,
            print_provider_id = ?, product_features = ?, care_instructions = ?, size_table_html = ?,
            gpsr_html = ?, variants_json = ?, prices_json = ?, white_branding_variant_ids = ?,
            print_area_width = ?, print_area_height = ?, qr_logo_mapping_json = ?, product_data_json = ?,
            shopify_category_id = ?, standard_product_display_name = ?, print_areas_config_json = ?,
            is_active = ?, revision = ?, collected_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
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
          row.shopify_category_id,
          row.standard_product_display_name,
          row.print_areas_config_json,
          row.is_active ?? 1,
          row.revision ?? 1,
          row.collected_at ?? now,
          now,
          row.catalog_source_id
        )
        .run();
      shadowProfileIdToCatalogId[row.id] = row.catalog_source_id;
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_publish_profiles
            (product_key, title, source_system, source_product_id, blueprint_id, print_provider_id,
             product_features, care_instructions, size_table_html, gpsr_html, variants_json, prices_json,
             white_branding_variant_ids, print_area_width, print_area_height, qr_logo_mapping_json,
             product_data_json, shopify_category_id, standard_product_display_name, print_areas_config_json,
             collected_at, updated_at, is_active, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
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
          row.shopify_category_id,
          row.standard_product_display_name,
          row.print_areas_config_json,
          row.collected_at ?? now,
          now,
          row.is_active ?? 1,
          row.revision ?? 1
        )
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_publish_profiles", row.id, catalogId);
        shadowProfileIdToCatalogId[row.id] = catalogId;
      }
    }
    counts.publish_profiles++;
  }

  // --- publish plans ---
  const plans = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_publish_plans WHERE product_key = ? ORDER BY priority ASC, id ASC`)
    .bind(productKey)
    .all();
  counts.publish_plans = 0;
  for (const row of plans?.results || []) {
    const catalogProfileId =
      row.publish_profile_catalog_id ??
      (row.publish_profile_id ? shadowProfileIdToCatalogId[row.publish_profile_id] : null);

    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_publish_map SET
            region_codes_json = ?, provider_name = ?, provider_location = ?, country_codes_json = ?,
            priority = ?, is_enabled = ?, publish_profile_id = ?, publication_ids_json = ?,
            country_of_origin = ?, amazon_channel_enabled = ?, amazon_markets_enabled_json = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .bind(
          row.region_codes_json ?? "[]",
          row.provider_name ?? "",
          row.provider_location,
          row.country_codes_json ?? "[]",
          row.priority ?? 100,
          row.is_enabled ?? 1,
          catalogProfileId,
          row.publication_ids_json,
          row.country_of_origin,
          row.amazon_channel_enabled ?? 0,
          row.amazon_markets_enabled_json,
          now,
          row.catalog_source_id
        )
        .run();
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_publish_map
            (product_key, region_codes_json, provider_name, provider_location, country_codes_json,
             priority, is_enabled, publish_profile_id, publication_ids_json, country_of_origin,
             amazon_channel_enabled, amazon_markets_enabled_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          row.region_codes_json ?? "[]",
          row.provider_name ?? "",
          row.provider_location,
          row.country_codes_json ?? "[]",
          row.priority ?? 100,
          row.is_enabled ?? 1,
          catalogProfileId,
          row.publication_ids_json,
          row.country_of_origin,
          row.amazon_channel_enabled ?? 0,
          row.amazon_markets_enabled_json,
          row.created_at ?? now,
          now
        )
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_publish_plans", row.id, catalogId);
      }
    }
    counts.publish_plans++;
  }

  // --- active providers ---
  const activeProviders = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_active_providers WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.active_providers = 0;
  for (const row of activeProviders?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_active_print_providers SET print_provider_id = ?, updated_at = ? WHERE id = ?`
        )
        .bind(row.print_provider_id, now, row.catalog_source_id)
        .run();
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_active_print_providers
            (product_key, print_provider_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(productKey, row.print_provider_id, row.created_at ?? now, now)
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_active_providers", row.id, catalogId);
      }
    }
    counts.active_providers++;
  }

  // --- mockup defaults ---
  const mockupDefaults = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_mockup_defaults WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.mockup_defaults = 0;
  for (const row of mockupDefaults?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_mockup_defaults SET
            print_area_key = ?, template_r2_key = ?, mask_r2_key = ?, template_color = ?,
            placement_x = ?, placement_y = ?, placement_scale = ?, placement_angle = ?,
            printify_print_area_width = ?, printify_print_area_height = ?,
            template_width = ?, template_height = ?, available_colors_json = ?,
            print_area_rect_json = ?, mockup_print_area_rect_json = ?, universal_print_area_rect_json = ?,
            enabled_colors_json = ?, enabled_sizes_json = ?, visible_design_types_json = ?,
            is_active = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          row.print_area_key ?? "front",
          row.template_r2_key,
          row.mask_r2_key,
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
          row.print_area_rect_json,
          row.mockup_print_area_rect_json,
          row.universal_print_area_rect_json,
          row.enabled_colors_json,
          row.enabled_sizes_json,
          row.visible_design_types_json,
          row.is_active ?? 1,
          now,
          row.catalog_source_id
        )
        .run();
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_mockup_defaults
            (product_key, print_area_key, template_r2_key, mask_r2_key, template_color,
             placement_x, placement_y, placement_scale, placement_angle,
             printify_print_area_width, printify_print_area_height, template_width, template_height,
             available_colors_json, print_area_rect_json, mockup_print_area_rect_json,
             universal_print_area_rect_json, enabled_colors_json, enabled_sizes_json,
             visible_design_types_json, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          row.print_area_key ?? "front",
          row.template_r2_key,
          row.mask_r2_key,
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
          row.print_area_rect_json,
          row.mockup_print_area_rect_json,
          row.universal_print_area_rect_json,
          row.enabled_colors_json,
          row.enabled_sizes_json,
          row.visible_design_types_json,
          row.is_active ?? 1,
          row.created_at ?? now,
          now
        )
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_mockup_defaults", row.id, catalogId);
      }
    }
    counts.mockup_defaults++;
  }

  // --- mockup images ---
  const mockupImages = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_mockup_images WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.mockup_images = 0;
  for (const row of mockupImages?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_mockup_images SET
            print_provider_id = ?, printify_product_id = ?, view_key = ?, color_name = ?,
            color_hex = ?, image_url = ?, printify_variant_ids = ?, is_default = ?,
            preview_template_ids_json = ?
           WHERE id = ?`
        )
        .bind(
          row.print_provider_id ?? 0,
          row.printify_product_id ?? "",
          row.view_key,
          row.color_name,
          row.color_hex,
          row.image_url,
          row.printify_variant_ids,
          row.is_default ?? 0,
          row.preview_template_ids_json,
          row.catalog_source_id
        )
        .run();
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_mockup_images
            (product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
             image_url, printify_variant_ids, is_default, created_at, preview_template_ids_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          row.print_provider_id ?? 0,
          row.printify_product_id ?? "",
          row.view_key,
          row.color_name,
          row.color_hex,
          row.image_url,
          row.printify_variant_ids,
          row.is_default ?? 0,
          row.created_at ?? now,
          row.preview_template_ids_json
        )
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_mockup_images", row.id, catalogId);
      }
    }
    counts.mockup_images++;
  }

  // --- mockup view random ---
  const viewRandom = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_mockup_view_random WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.mockup_view_random = 0;
  for (const row of viewRandom?.results || []) {
    const existing = await catalogDb
      .prepare(
        `SELECT product_key FROM product_mockup_view_random_preview WHERE product_key = ? AND view_key = ?`
      )
      .bind(productKey, row.view_key)
      .first();
    if (existing) {
      await catalogDb
        .prepare(
          `UPDATE product_mockup_view_random_preview SET template_ids_json = ?, updated_at = ?
           WHERE product_key = ? AND view_key = ?`
        )
        .bind(row.template_ids_json, now, productKey, row.view_key)
        .run();
    } else {
      await catalogDb
        .prepare(
          `INSERT INTO product_mockup_view_random_preview
            (product_key, view_key, template_ids_json, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(productKey, row.view_key, row.template_ids_json, now)
        .run();
    }
    counts.mockup_view_random++;
  }

  // --- variant print areas ---
  const variantPrintAreas = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_variant_print_areas WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.variant_print_areas = 0;
  for (const row of variantPrintAreas?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_variant_print_areas SET
            print_area_key = ?, variant_id = ?, variant_title = ?,
            printify_print_area_width = ?, printify_print_area_height = ?,
            print_area_rect_json = ?, mockup_print_area_rect_json = ?, mockup_image_url = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .bind(
          row.print_area_key,
          row.variant_id,
          row.variant_title,
          row.printify_print_area_width,
          row.printify_print_area_height,
          row.print_area_rect_json,
          row.mockup_print_area_rect_json,
          row.mockup_image_url,
          now,
          row.catalog_source_id
        )
        .run();
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_variant_print_areas
            (product_key, print_area_key, variant_id, variant_title, printify_print_area_width,
             printify_print_area_height, print_area_rect_json, mockup_print_area_rect_json,
             mockup_image_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          row.print_area_key,
          row.variant_id,
          row.variant_title,
          row.printify_print_area_width,
          row.printify_print_area_height,
          row.print_area_rect_json,
          row.mockup_print_area_rect_json,
          row.mockup_image_url,
          row.created_at ?? now,
          now
        )
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_variant_print_areas", row.id, catalogId);
      }
    }
    counts.variant_print_areas++;
  }

  // --- base costs ---
  const baseCosts = await mfgDb
    .prepare(`SELECT * FROM eazpire_product_base_costs WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.base_costs = 0;
  for (const row of baseCosts?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE product_base_costs SET
            region_code = ?, base_cost_cents = ?, default_sell_price_cents = ?,
            min_profit_cents = ?, creator_share_percent = ?, currency = ?, source = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          row.region_code ?? "EU",
          row.base_cost_cents ?? 0,
          row.default_sell_price_cents ?? 0,
          row.min_profit_cents ?? 100,
          row.creator_share_percent ?? 40.0,
          row.currency ?? "EUR",
          row.source ?? "printify",
          now,
          row.catalog_source_id
        )
        .run();
    } else {
      const insertResult = await catalogDb
        .prepare(
          `INSERT INTO product_base_costs
            (product_key, region_code, base_cost_cents, default_sell_price_cents, min_profit_cents,
             creator_share_percent, currency, source, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          productKey,
          row.region_code ?? "EU",
          row.base_cost_cents ?? 0,
          row.default_sell_price_cents ?? 0,
          row.min_profit_cents ?? 100,
          row.creator_share_percent ?? 40.0,
          row.currency ?? "EUR",
          row.source ?? "printify",
          now
        )
        .run();
      const catalogId = insertResult.meta?.last_row_id;
      if (catalogId) {
        await updateShadowCatalogSourceId(mfgDb, "eazpire_product_base_costs", row.id, catalogId);
      }
    }
    counts.base_costs++;
  }

  // --- template products ---
  const templateProducts = await mfgDb
    .prepare(`SELECT * FROM eazpire_template_products WHERE product_key = ?`)
    .bind(productKey)
    .all();
  counts.template_products = 0;
  for (const row of templateProducts?.results || []) {
    if (row.catalog_source_id) {
      await catalogDb
        .prepare(
          `UPDATE template_products SET
            printify_product_id = ?, blueprint_id = ?, title = ?, variants_json = ?, prices_json = ?,
            print_area_width = ?, print_area_height = ?, print_areas_json = ?,
            selected_positions_json = ?, product_data_json = ?, mockup_images_count = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          row.printify_product_id ?? "",
          row.blueprint_id,
          row.title,
          row.variants_json,
          row.prices_json,
          row.print_area_width,
          row.print_area_height,
          row.print_areas_json,
          row.selected_positions_json,
          row.product_data_json,
          row.mockup_images_count ?? 0,
          now,
          row.catalog_source_id
        )
        .run();
    } else {
      const existing = await catalogDb
        .prepare(
          `SELECT id FROM template_products WHERE product_key = ? AND print_provider_id = ?`
        )
        .bind(productKey, row.print_provider_id)
        .first();
      if (existing?.id) {
        await catalogDb
          .prepare(
            `UPDATE template_products SET
              printify_product_id = ?, blueprint_id = ?, title = ?, variants_json = ?, prices_json = ?,
              print_area_width = ?, print_area_height = ?, print_areas_json = ?,
              selected_positions_json = ?, product_data_json = ?, mockup_images_count = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            row.printify_product_id ?? "",
            row.blueprint_id,
            row.title,
            row.variants_json,
            row.prices_json,
            row.print_area_width,
            row.print_area_height,
            row.print_areas_json,
            row.selected_positions_json,
            row.product_data_json,
            row.mockup_images_count ?? 0,
            now,
            existing.id
          )
          .run();
        await updateShadowCatalogSourceId(mfgDb, "eazpire_template_products", row.id, existing.id);
      } else {
        const insertResult = await catalogDb
          .prepare(
            `INSERT INTO template_products
              (product_key, print_provider_id, printify_product_id, blueprint_id, title, variants_json,
               prices_json, print_area_width, print_area_height, print_areas_json, selected_positions_json,
               product_data_json, mockup_images_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            productKey,
            row.print_provider_id,
            row.printify_product_id ?? "",
            row.blueprint_id,
            row.title,
            row.variants_json,
            row.prices_json,
            row.print_area_width,
            row.print_area_height,
            row.print_areas_json,
            row.selected_positions_json,
            row.product_data_json,
            row.mockup_images_count ?? 0,
            row.created_at ?? now,
            now
          )
          .run();
        const catalogId = insertResult.meta?.last_row_id;
        if (catalogId) {
          await updateShadowCatalogSourceId(mfgDb, "eazpire_template_products", row.id, catalogId);
        }
      }
    }
    counts.template_products++;
  }

  // --- variant config → CREATOR_DB ---
  counts.variant_config = 0;
  if (env.CREATOR_DB) {
    const variantConfigs = await mfgDb
      .prepare(`SELECT * FROM eazpire_product_variant_config WHERE product_key = ?`)
      .bind(productKey)
      .all();
    for (const row of variantConfigs?.results || []) {
      if (row.catalog_source_id) {
        await env.CREATOR_DB.prepare(
          `UPDATE product_variant_config SET config_json = ?, updated_at = ? WHERE id = ?`
        )
          .bind(row.config_json ?? "{}", now, row.catalog_source_id)
          .run();
      } else {
        const existing = await env.CREATOR_DB.prepare(
          `SELECT id FROM product_variant_config WHERE product_key = ? AND print_provider_id = ?`
        )
          .bind(productKey, row.print_provider_id)
          .first();
        if (existing?.id) {
          await env.CREATOR_DB.prepare(
            `UPDATE product_variant_config SET config_json = ?, updated_at = ? WHERE id = ?`
          )
            .bind(row.config_json ?? "{}", now, existing.id)
            .run();
          await updateShadowCatalogSourceId(mfgDb, "eazpire_product_variant_config", row.id, existing.id);
        } else {
          const insertResult = await env.CREATOR_DB.prepare(
            `INSERT INTO product_variant_config
              (product_key, print_provider_id, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
            .bind(productKey, row.print_provider_id, row.config_json ?? "{}", row.created_at ?? now, now)
            .run();
          const catalogId = insertResult.meta?.last_row_id;
          if (catalogId) {
            await updateShadowCatalogSourceId(mfgDb, "eazpire_product_variant_config", row.id, catalogId);
          }
        }
      }
      counts.variant_config++;
    }
  }

  return { ok: true, product_key: productKey, counts };
}

export async function mirrorShadowTablesToCatalogDb(env, productKeys = null) {
  const mfgDb = env.MANUFACTURER_DB;
  if (!mfgDb) return { ok: false, error: "manufacturer_db_unavailable" };
  if (!env.CATALOG_DB) return { ok: false, error: "catalog_db_unavailable" };

  let keys = productKeys;
  if (!keys || !keys.length) {
    const products = await mfgDb.prepare(`SELECT product_key FROM eazpire_products`).all();
    keys = (products?.results || []).map((r) => r.product_key);
  }

  const results = [];
  for (const productKey of keys) {
    results.push(await mirrorShadowTablesForProduct(env, productKey));
  }

  const ok = results.every((r) => r.ok);
  return { ok, mirrored: results.filter((r) => r.ok).length, results };
}
