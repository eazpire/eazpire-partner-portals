/**
 * Partner Product Editor — bundle load/save, readiness, mockup upload, admin approve→catalog
 */

import { getManufacturerDb, newId, parseJson, rowToProduct, slugify } from "./db.js";
import {
  listVariants,
  listPrintAreas,
  getProduct,
  createProduct,
  updateProduct,
} from "./catalogService.js";
import { listLocations } from "./manufacturerService.js";
import { validatePrintArea } from "./printAreaValidation.js";
import { writeAuditLog } from "./rbac.js";
import { upsertEazpireProduct } from "./partnerCatalog/eazpireProductService.js";
import {
  buildTodifyCatalogVariantsFromPartner,
  catalogPlaceholdersFromPartnerPrintAreas,
  placeholdersByPositionFromPartnerPrintAreas,
} from "./partnerCatalog/partnerCatalogPlaceholders.js";
import {
  expandToIsoCountryCodes,
  regionCodesFromCountryCodes,
} from "../catalog/resolvePlanCountries.js";

const MOCKUP_SETS = ["clean", "shop_preview", "calibration", "preview_images"];

/**
 * Push partner print areas into catalog-db publish profile (variants_json placeholders +
 * catalog_placeholder_positions_json) and seed version placeholder config when empty.
 * Also mirrors mockups + mockup_defaults + product_data_json for Admin Catalog editor tabs.
 * Safe to call on approve, re-approve, and after partner print-area save.
 */
export async function syncPartnerPrintAreasIntoCatalog(env, manufacturerId, productId, productKey) {
  const db = getManufacturerDb(env);
  if (!db || !env?.CATALOG_DB || !productKey) return { ok: false, error: "unavailable" };

  await ensureEditorColumns(db);
  const [variants, printAreas, views, mockups] = await Promise.all([
    listVariants(db, manufacturerId, productId),
    listPrintAreas(db, manufacturerId, productId),
    listViews(db, productId),
    listMockupSlots(db, env, productId),
  ]);

  const placeholders = catalogPlaceholdersFromPartnerPrintAreas(printAreas, views);
  const catalogVariants = buildTodifyCatalogVariantsFromPartner({ variants, printAreas, views });
  const prices = {};
  catalogVariants.forEach((v) => {
    prices[String(v.id)] = v.price;
  });
  const positionsJson = JSON.stringify(placeholders.map((p) => p.position));
  const variantsJson = JSON.stringify(catalogVariants);
  const pricesJson = JSON.stringify(prices);
  const now = Date.now();

  const {
    buildPartnerProductDataForUi,
    catalogMockupRowsFromPartnerSlots,
    mockupDefaultsFromPartnerPrintAreas,
  } = await import("./partnerCatalog/partnerCatalogEditorEnrichment.js");
  const productData = buildPartnerProductDataForUi(variants, { title: productKey });
  const productDataJson = productData ? JSON.stringify(productData) : null;

  const prof = await env.CATALOG_DB.prepare(
    `SELECT id, variants_json FROM product_publish_profiles WHERE product_key = ? ORDER BY id ASC LIMIT 1`
  )
    .bind(productKey)
    .first();

  let profileId = prof?.id ?? null;
  if (profileId) {
    try {
      await env.CATALOG_DB.prepare(
        `UPDATE product_publish_profiles SET
           variants_json = ?, prices_json = ?,
           catalog_placeholder_positions_json = ?, catalog_placeholder_positions_updated_at = ?,
           product_data_json = COALESCE(?, product_data_json),
           source_system = COALESCE(NULLIF(source_system, ''), 'todify'),
           source_product_id = COALESCE(source_product_id, ?),
           updated_at = ?
         WHERE id = ?`
      )
        .bind(
          variantsJson,
          pricesJson,
          positionsJson,
          now,
          productDataJson,
          productId,
          now,
          profileId
        )
        .run();
    } catch (e) {
      // catalog_placeholder_positions_* or product_data may be missing on older DBs
      console.warn("[sync-partner-print-areas] profile update (positions):", e?.message || e);
      try {
        await env.CATALOG_DB.prepare(
          `UPDATE product_publish_profiles SET
             variants_json = ?, prices_json = ?, product_data_json = COALESCE(?, product_data_json), updated_at = ?
           WHERE id = ?`
        )
          .bind(variantsJson, pricesJson, productDataJson, now, profileId)
          .run();
      } catch (e2) {
        await env.CATALOG_DB.prepare(
          `UPDATE product_publish_profiles SET variants_json = ?, prices_json = ?, updated_at = ? WHERE id = ?`
        )
          .bind(variantsJson, pricesJson, now, profileId)
          .run();
      }
    }
  }

  // Seed product_variant_print_areas dims (used for Provider tab Height×Width)
  for (const ph of placeholders) {
    const pos = String(ph.position || "").trim().toLowerCase();
    if (!pos) continue;
    const w = Number(ph.width);
    const h = Number(ph.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) continue;
    for (const v of catalogVariants) {
      const vid = Number(v.id);
      if (!Number.isFinite(vid)) continue;
      try {
        const existing = await env.CATALOG_DB.prepare(
          `SELECT id FROM product_variant_print_areas
           WHERE product_key = ? AND print_area_key = ? AND variant_id = ? LIMIT 1`
        )
          .bind(productKey, pos, vid)
          .first();
        if (existing?.id) {
          await env.CATALOG_DB.prepare(
            `UPDATE product_variant_print_areas
             SET printify_print_area_width = ?, printify_print_area_height = ?, updated_at = ?
             WHERE id = ?`
          )
            .bind(Math.round(w), Math.round(h), now, existing.id)
            .run();
        } else {
          await env.CATALOG_DB.prepare(
            `INSERT INTO product_variant_print_areas
              (product_key, print_area_key, variant_id, variant_title,
               printify_print_area_width, printify_print_area_height, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(productKey, pos, vid, v.title || null, Math.round(w), Math.round(h), now, now)
            .run();
        }
      } catch (e) {
        console.warn("[sync-partner-print-areas] variant_print_areas:", e?.message || e);
      }
    }
  }

  // Seed product_mockup_defaults from partner print rects (only when row missing)
  const defaults = mockupDefaultsFromPartnerPrintAreas(printAreas, env);
  let defaultsSeeded = 0;
  for (const md of defaults) {
    const key = String(md.print_area_key || "").trim().toLowerCase();
    if (!key) continue;
    try {
      const existing = await env.CATALOG_DB.prepare(
        `SELECT id FROM product_mockup_defaults WHERE product_key = ? AND print_area_key = ? LIMIT 1`
      )
        .bind(productKey, key)
        .first();
      if (existing?.id) continue;
      await env.CATALOG_DB.prepare(
        `INSERT INTO product_mockup_defaults
          (product_key, print_area_key, print_area_rect_json, mockup_print_area_rect_json,
           printify_print_area_width, printify_print_area_height, print_area_template_r2_key,
           template_color, placement_x, placement_y, placement_scale, placement_angle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'white', 0.5, 0.5, 1.0, 0.0, ?, ?)`
      )
        .bind(
          productKey,
          key,
          md.print_area_rect_json,
          md.mockup_print_area_rect_json,
          md.printify_print_area_width,
          md.printify_print_area_height,
          md.print_area_template_r2_key,
          now,
          now
        )
        .run();
      defaultsSeeded += 1;
    } catch (e) {
      console.warn("[sync-partner-print-areas] mockup_defaults:", e?.message || e);
    }
  }

  // Mirror partner mockup images into catalog when catalog has none for this product
  let mockupsMirrored = 0;
  try {
    const existingImg = await env.CATALOG_DB.prepare(
      `SELECT id FROM product_mockup_images WHERE product_key = ? LIMIT 1`
    )
      .bind(productKey)
      .first();
    if (!existingImg && mockups.length) {
      const { ensureCatalogMockupImageSchema } = await import(
        "./partnerCatalog/ensureCatalogMockupImageSchema.js"
      );
      await ensureCatalogMockupImageSchema(env.CATALOG_DB);
      const rows = catalogMockupRowsFromPartnerSlots(mockups, {
        productKey,
        printProviderId: 0,
      });
      for (const row of rows) {
        try {
          await env.CATALOG_DB.prepare(
            `INSERT INTO product_mockup_images
              (product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
               image_url, printify_variant_ids, is_default, mockup_set, created_at)
             VALUES (?, ?, '', ?, ?, ?, ?, NULL, ?, ?, ?)`
          )
            .bind(
              productKey,
              0,
              row.view_key,
              row.color_name,
              row.color_hex,
              row.image_url,
              row.is_default ? 1 : 0,
              row.mockup_set || "clean",
              now
            )
            .run();
          mockupsMirrored += 1;
        } catch (e) {
          console.warn("[sync-partner-print-areas] mockup image:", e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn("[sync-partner-print-areas] mockups mirror:", e?.message || e);
  }

  // Seed version config placeholders when empty (manufacturer DB)
  try {
    const { listProductVersions, updateProductVersion } = await import(
      "./partnerCatalog/eazpireProductVersionService.js"
    );
    const versions = await listProductVersions(db, productKey);
    const byPos = placeholdersByPositionFromPartnerPrintAreas(printAreas);
    for (const ver of versions) {
      const cfg =
        ver.product_version_config && typeof ver.product_version_config === "object"
          ? { ...ver.product_version_config }
          : {};
      const existing = cfg.placeholders_by_position;
      const hasSlots =
        existing && typeof existing === "object" && Object.keys(existing).some((k) => {
          const s = existing[k];
          return s && (s.qr > 0 || s.logo > 0 || s.creator_design > 0 || s.additional_design > 0);
        });
      if (hasSlots) continue;
      cfg.placeholders_by_position = { ...(existing || {}), ...byPos };
      if (!Array.isArray(cfg.design_types)) cfg.design_types = [];
      await updateProductVersion(db, ver.id, { product_version_config: cfg });
    }
  } catch (e) {
    console.warn("[sync-partner-print-areas] version config:", e?.message || e);
  }

  return {
    ok: true,
    placeholder_count: placeholders.length,
    positions: placeholders.map((p) => p.position),
    profile_id: profileId,
    updated: true,
    variants_json: catalogVariants,
    mockups_mirrored: mockupsMirrored,
    mockup_defaults_seeded: defaultsSeeded,
    product_data_seeded: !!productData,
  };
}

export function publicFileUrl(env, r2Key) {
  const key = String(r2Key || "").trim();
  if (!key) return null;
  const base = String(env?.PUBLIC_FILE_BASE_URL || "https://creator-engine.eazpire.workers.dev").replace(/\/$/, "");
  // Partner editor uploads land in MOCKUP_R2 — served via /mockup-r2, not /file (main R2)
  if (key.startsWith("partner-products/")) {
    return `${base}/mockup-r2?k=${encodeURIComponent(key)}`;
  }
  return `${base}/file/${encodeURIComponent(key)}`;
}

async function ensureEditorColumns(db) {
  const cols = [
    ["sku_base", "TEXT"],
    ["design_types_json", "TEXT"],
    ["print_technique", "TEXT"],
    ["regions_json", "TEXT"],
    ["meta_json", "TEXT"],
    ["eazpire_product_key", "TEXT"],
    ["review_note", "TEXT"],
    ["provider_location_id", "TEXT"],
  ];
  for (const [col, def] of cols) {
    try {
      await db.prepare(`ALTER TABLE manufacturer_products ADD COLUMN ${col} ${def}`).run();
    } catch (_) {}
  }
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS manufacturer_product_views (
          id TEXT PRIMARY KEY,
          manufacturer_product_id TEXT NOT NULL,
          view_key TEXT NOT NULL,
          label TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          printable INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (manufacturer_product_id) REFERENCES manufacturer_products(id),
          UNIQUE (manufacturer_product_id, view_key)
        )`
      )
      .run();
  } catch (_) {}
  for (const [col, def] of [
    ["print_technique", "TEXT"],
    ["print_height", "REAL"],
    ["print_width", "REAL"],
    ["print_unit", "TEXT"],
  ]) {
    try {
      await db.prepare(`ALTER TABLE manufacturer_product_views ADD COLUMN ${col} ${def}`).run();
    } catch (_) {}
  }
  for (const [col, def] of [
    ["mockup_set", "TEXT"],
    ["color_key", "TEXT"],
  ]) {
    try {
      await db.prepare(`ALTER TABLE manufacturer_mockup_templates ADD COLUMN ${col} ${def}`).run();
    } catch (_) {}
  }
  for (const [col, def] of [
    ["view_key", "TEXT"],
    ["print_rect_json", "TEXT"],
    ["placeholders_json", "TEXT"],
    ["image_r2_key", "TEXT"],
    ["image_url", "TEXT"],
  ]) {
    try {
      await db.prepare(`ALTER TABLE manufacturer_print_areas ADD COLUMN ${col} ${def}`).run();
    } catch (_) {}
  }
}

export async function listViews(db, productId) {
  const res = await db
    .prepare(
      `SELECT * FROM manufacturer_product_views
       WHERE manufacturer_product_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(productId)
    .all();
  return (res?.results || []).map((row) => ({
    id: row.id,
    view_key: row.view_key,
    label: row.label,
    sort_order: Number(row.sort_order || 0),
    printable: !!row.printable,
    print_technique: row.print_technique || "",
    print_height: row.print_height != null && row.print_height !== "" ? Number(row.print_height) : null,
    print_width: row.print_width != null && row.print_width !== "" ? Number(row.print_width) : null,
    print_unit: row.print_unit || "mm",
  }));
}

export async function listMockupSlots(db, env, productId) {
  const res = await db
    .prepare(
      `SELECT * FROM manufacturer_mockup_templates
       WHERE manufacturer_product_id = ?
       ORDER BY mockup_set ASC, view_key ASC, color_key ASC`
    )
    .bind(productId)
    .all();
  return (res?.results || []).map((row) => {
    const overlay = parseJson(row.overlay_json, {});
    const r2Key = row.image_r2_key || null;
    // Always rebuild MOCKUP_R2 URLs — older rows may have broken /file/ links
    let imageUrl = null;
    if (r2Key) {
      imageUrl = publicFileUrl(env, r2Key);
    } else if (row.image_url) {
      imageUrl = row.image_url;
    }
    return {
      id: row.id,
      view_key: row.view_key,
      color_key: row.color_key || "",
      mockup_set: row.mockup_set || "clean",
      image_r2_key: r2Key,
      image_url: imageUrl,
      title: overlay.title || row.view_key || "",
      overlay,
      status: row.status,
    };
  });
}

function normalizeAreaForClient(a) {
  const raw = a?.print_rect || a?.position || {};
  const locked = typeof a?.locked === "boolean" ? a.locked : raw.locked !== false;
  const print_rect = {
    x: raw.x,
    y: raw.y,
    w: raw.w ?? raw.width,
    h: raw.h ?? raw.height,
    width: raw.w ?? raw.width,
    height: raw.h ?? raw.height,
    angle: Number(raw.angle) || 0,
  };
  return { ...a, print_rect, locked };
}

function mapPrintArea(row, env) {
  const rawRect = parseJson(row.print_rect_json, {}) || {};
  return normalizeAreaForClient({
    id: row.id,
    area_key: row.area_key,
    view_key: row.view_key || row.area_key,
    label: row.label,
    width_px: row.width_px,
    height_px: row.height_px,
    dpi: row.dpi,
    safe_zone: parseJson(row.safe_zone_json, {}),
    position: parseJson(row.position_json, {}),
    print_rect: rawRect,
    placeholders: parseJson(row.placeholders_json, {}),
    image_r2_key: row.image_r2_key || null,
    image_url: row.image_url || (row.image_r2_key ? publicFileUrl(env, row.image_r2_key) : null),
    supported_file_types: parseJson(row.supported_file_types_json, ["png"]),
    supports_transparency: !!row.supports_transparency,
    default_fit: row.default_fit,
    status: row.status,
  });
}

export async function getPartnerProductEditorBundle(env, manufacturerId, productId) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  await ensureEditorColumns(db);

  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };

  const mfg = await db
    .prepare(`SELECT id, name, slug FROM manufacturers WHERE id = ?`)
    .bind(manufacturerId)
    .first();

  // Do not auto-seed Front/Back — partners add views on Variants; Mockups stay empty until then.
  const views = await listViews(db, productId);

  const [variants, printAreas, mockups, locations] = await Promise.all([
    listVariants(db, manufacturerId, productId),
    listPrintAreas(db, manufacturerId, productId),
    listMockupSlots(db, env, productId),
    listLocations(db, manufacturerId),
  ]);

  const colors = [...new Set(variants.map((v) => String(v.color || "").trim()).filter(Boolean))];
  const sizes = [...new Set(variants.map((v) => String(v.size || "").trim()).filter(Boolean))];
  /** @type {Record<string, string>} */
  const color_hexes = {};
  for (const v of variants) {
    const color = String(v.color || "").trim();
    if (!color || color_hexes[color]) continue;
    const hex = String(v.attributes?.color_hex || "").trim();
    if (/^#?[0-9a-fA-F]{3,8}$/.test(hex)) {
      color_hexes[color] = hex.startsWith("#") ? hex.toLowerCase() : `#${hex.toLowerCase()}`;
    }
  }

  return {
    ok: true,
    product,
    manufacturer_name: mfg?.name || null,
    manufacturer_slug: mfg?.slug || null,
    views,
    variants,
    colors,
    sizes,
    color_hexes,
    locations: (locations || []).map((l) => ({ id: l.id, name: l.name || l.label || "" })),
    mockups,
    print_areas: printAreas.map((a) =>
      normalizeAreaForClient({
        ...a,
        view_key: a.view_key || a.area_key,
        print_rect: a.print_rect || a.position || {},
        placeholders: a.placeholders || {},
      })
    ),
    readiness: await buildPartnerProductReadiness(db, env, manufacturerId, productId),
  };
}

/** Resolve partner manufacturer_product linked to a catalog product_key (for Review tab). */
export async function findManufacturerProductByCatalogKey(env, productKey) {
  const db = getManufacturerDb(env);
  if (!db || !productKey) return null;
  await ensureEditorColumns(db);
  const row = await db
    .prepare(`SELECT manufacturer_id, id FROM manufacturer_products WHERE eazpire_product_key = ? LIMIT 1`)
    .bind(String(productKey))
    .first();
  if (!row) return null;
  return { manufacturer_id: row.manufacturer_id, product_id: row.id };
}

export async function buildPartnerProductReadiness(db, env, manufacturerId, productId) {
  const product = await getProduct(db, manufacturerId, productId);
  const views = await listViews(db, productId);
  const variants = await listVariants(db, manufacturerId, productId);
  const mockups = await listMockupSlots(db, env, productId);
  const areas = await listPrintAreas(db, manufacturerId, productId);
  const errors = [];

  if (!product?.title?.trim()) errors.push("title_required");
  if (!views.length) errors.push("views_required");
  if (!variants.length) errors.push("variants_required");
  const missingCost = variants.some((v) => !Number(v.base_cost_cents) || Number(v.base_cost_cents) <= 0);
  if (variants.length && missingCost) errors.push("variant_cost_required");
  if (!areas.length) errors.push("print_area_required");
  for (const area of areas) {
    const v = validatePrintArea(area);
    if (!v.ok) errors.push(...v.errors.map((e) => `print_area_${e}`));
  }
  const frontClean = mockups.some(
    (m) => m.mockup_set === "clean" && m.view_key === "front" && (m.image_r2_key || m.image_url)
  );
  if (!frontClean) errors.push("clean_front_mockup_required");
  const meta = product?.meta || {};
  if (!String(meta.display_name || product?.title || "").trim()) errors.push("meta_display_name_required");

  return { ok: errors.length === 0, errors };
}

export async function savePartnerProductHeader(db, manufacturerId, productId, body) {
  await ensureEditorColumns(db);
  const existing = await getProduct(db, manufacturerId, productId);
  if (!existing && !body.create) return null;

  let id = productId;
  if (!existing) {
    const created = await createProduct(db, manufacturerId, {
      title: body.title || "Untitled product",
      description: body.description,
      category: body.category,
      currency: body.currency || "EUR",
      base_cost_cents: body.base_cost_cents || 0,
    });
    id = created.id;
  }

    // Prefer non-empty title; empty string must not wipe existing title
    const title =
      body.title != null && String(body.title).trim() !== ""
        ? String(body.title).trim()
        : existing?.title || "Untitled product";
  let providerLocationId =
    body.provider_location_id !== undefined
      ? String(body.provider_location_id || "").trim() || null
      : existing?.provider_location_id ?? null;
  if (providerLocationId) {
    const loc = await db
      .prepare(`SELECT id FROM manufacturer_locations WHERE id = ? AND manufacturer_id = ?`)
      .bind(providerLocationId, manufacturerId)
      .first();
    if (!loc) providerLocationId = null;
  }

  const now = Date.now();
  await db
    .prepare(
      `UPDATE manufacturer_products SET
        title = ?, description = ?, category = ?, normalized_category = ?,
        sku_base = ?, design_types_json = ?, print_technique = ?, regions_json = ?,
        meta_json = ?, currency = ?, provider_location_id = ?, updated_at = ?
       WHERE id = ? AND manufacturer_id = ?`
    )
    .bind(
      title,
      body.description !== undefined ? body.description : existing?.description ?? null,
      body.category !== undefined ? body.category : existing?.category ?? null,
      body.category !== undefined ? body.category : existing?.normalized_category ?? null,
      body.sku_base !== undefined ? body.sku_base : existing?.sku_base ?? null,
      JSON.stringify(body.design_types ?? existing?.design_types ?? []),
      body.print_technique !== undefined ? body.print_technique : existing?.print_technique ?? null,
      JSON.stringify(
        expandToIsoCountryCodes(body.regions ?? existing?.regions ?? [])
      ),
      JSON.stringify(body.meta ?? existing?.meta ?? {}),
      body.currency ?? existing?.currency ?? "EUR",
      providerLocationId,
      now,
      id,
      manufacturerId
    )
    .run();

  return getProduct(db, manufacturerId, id);
}

export async function savePartnerProductViews(db, manufacturerId, productId, views) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };
  await ensureEditorColumns(db);
  const now = Date.now();
  const list = Array.isArray(views) ? views : [];
  await db.prepare(`DELETE FROM manufacturer_product_views WHERE manufacturer_product_id = ?`).bind(productId).run();
  let i = 0;
  for (const v of list) {
    const key = String(v.view_key || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    if (!key) continue;
    const printHeight =
      v.print_height != null && v.print_height !== "" && Number.isFinite(Number(v.print_height))
        ? Number(v.print_height)
        : null;
    const printWidth =
      v.print_width != null && v.print_width !== "" && Number.isFinite(Number(v.print_width))
        ? Number(v.print_width)
        : null;
    const printUnit = String(v.print_unit || "mm").trim().toLowerCase() || "mm";
    await db
      .prepare(
        `INSERT INTO manufacturer_product_views
          (id, manufacturer_product_id, view_key, label, sort_order, printable,
           print_technique, print_height, print_width, print_unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("mpv"),
        productId,
        key,
        String(v.label || key),
        Number(v.sort_order ?? i),
        v.printable === false || v.printable === 0 ? 0 : 1,
        String(v.print_technique || "").trim() || null,
        printHeight,
        printWidth,
        printUnit,
        now,
        now
      )
      .run();
    i += 1;
  }
  return { ok: true, views: await listViews(db, productId) };
}

function normalizeColorHex(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return null;
}

export async function savePartnerProductVariants(db, manufacturerId, productId, body) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };
  const colors = Array.isArray(body.colors) ? body.colors.map((c) => String(c).trim()).filter(Boolean) : [];
  const sizes = Array.isArray(body.sizes) ? body.sizes.map((s) => String(s).trim()).filter(Boolean) : [];
  const currency = String(body.currency || product.currency || "EUR").trim() || "EUR";
  const costs = body.costs && typeof body.costs === "object" ? body.costs : {};
  const costsMajor = body.costs_major && typeof body.costs_major === "object" ? body.costs_major : {};
  const colorHexes = body.color_hexes && typeof body.color_hexes === "object" ? body.color_hexes : {};
  const now = Date.now();

  await db.prepare(`DELETE FROM manufacturer_variants WHERE manufacturer_product_id = ?`).bind(productId).run();

  /** @type {Array<{ color: string, size: string }>} */
  let pairs = [];
  const pairKeys = Object.keys(costsMajor).filter((k) => String(k).includes("||"));
  if (pairKeys.length) {
    const seen = new Set();
    for (const key of pairKeys) {
      const sep = String(key).indexOf("||");
      const color = String(key.slice(0, sep) || "").trim();
      const size = String(key.slice(sep + 2) || "").trim();
      if (!color || !size) continue;
      const id = `${color}||${size}`;
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push({ color, size });
    }
  } else {
    const colorList = colors.length ? colors : ["Default"];
    const sizeList = sizes.length ? sizes : ["One Size"];
    for (const color of colorList) {
      for (const size of sizeList) pairs.push({ color, size });
    }
  }

  if (!pairs.length) {
    pairs = [{ color: "Default", size: "One Size" }];
  }

  for (const { color, size } of pairs) {
    const costKey = `${color}||${size}`;
    const colorCostKey = color;
    let cents = Number(costs[costKey] ?? costs[colorCostKey] ?? body.default_cost_cents ?? 0);
    if (!Number.isFinite(cents)) cents = 0;
    if (costsMajor[costKey] != null) {
      cents = Math.round(Number(costsMajor[costKey]) * 100);
    } else if (costsMajor[colorCostKey] != null) {
      cents = Math.round(Number(costsMajor[colorCostKey]) * 100);
    }
    const hex = normalizeColorHex(colorHexes[color]);
    const attributes = hex ? { color_hex: hex } : {};
    await db
      .prepare(
        `INSERT INTO manufacturer_variants
          (id, manufacturer_product_id, sku, color, size, material, base_cost_cents, currency, available, attributes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?)`
      )
      .bind(
        newId("mvar"),
        productId,
        `${product.sku_base || product.id}-${color}-${size}`.slice(0, 100),
        color,
        size,
        cents,
        currency,
        JSON.stringify(attributes),
        now,
        now
      )
      .run();
  }

  await db
    .prepare(`UPDATE manufacturer_products SET currency = ?, updated_at = ? WHERE id = ? AND manufacturer_id = ?`)
    .bind(currency, now, productId, manufacturerId)
    .run();

  return { ok: true, variants: await listVariants(db, manufacturerId, productId) };
}

export async function savePartnerProductMockups(db, manufacturerId, productId, slots, env = null) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };
  await ensureEditorColumns(db);
  const now = Date.now();
  await db.prepare(`DELETE FROM manufacturer_mockup_templates WHERE manufacturer_product_id = ?`).bind(productId).run();
  for (const s of Array.isArray(slots) ? slots : []) {
    const set = MOCKUP_SETS.includes(s.mockup_set) ? s.mockup_set : "clean";
    let viewKey = String(s.view_key || "").trim();
    if (!viewKey && set === "preview_images") {
      viewKey = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    if (!viewKey) continue;
    const overlay = {
      ...(s.overlay && typeof s.overlay === "object" ? s.overlay : {}),
    };
    if (s.title != null) overlay.title = String(s.title).trim();
    // Prefer regenerating URL from R2 key so clients always get a valid mockup-r2 link
    const r2Key = s.image_r2_key || null;
    const imageUrl = r2Key && env ? publicFileUrl(env, r2Key) : s.image_url || null;
    await db
      .prepare(
        `INSERT INTO manufacturer_mockup_templates
          (id, manufacturer_product_id, variant_id, view_key, image_r2_key, image_url, overlay_json, status, created_at, updated_at, mockup_set, color_key)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
      )
      .bind(
        newId("mmock"),
        productId,
        viewKey,
        r2Key,
        imageUrl,
        JSON.stringify(overlay),
        now,
        now,
        set,
        String(s.color_key || ""),
      )
      .run();
  }
  return { ok: true, mockups: await listMockupSlots(db, env, productId) };
}

function serializePrintRectForStorage(a) {
  const raw = a?.print_rect || a?.position || {};
  const locked = typeof a?.locked === "boolean" ? a.locked : raw.locked !== false;
  return {
    x: Number(raw.x),
    y: Number(raw.y),
    w: Number(raw.w ?? raw.width),
    h: Number(raw.h ?? raw.height),
    width: Number(raw.w ?? raw.width),
    height: Number(raw.h ?? raw.height),
    angle: Number(raw.angle) || 0,
    locked,
  };
}

export async function savePartnerProductPrintAreas(db, manufacturerId, productId, areas, env = null) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };
  await ensureEditorColumns(db);
  const now = Date.now();
  await db.prepare(`DELETE FROM manufacturer_print_areas WHERE manufacturer_product_id = ?`).bind(productId).run();
  for (const a of Array.isArray(areas) ? areas : []) {
    const viewKey = String(a.view_key || a.area_key || "").trim();
    if (!viewKey) continue;
    const width = Number(a.width_px);
    const height = Number(a.height_px);
    const printRectStored = serializePrintRectForStorage(a);
    await db
      .prepare(
        `INSERT INTO manufacturer_print_areas
          (id, manufacturer_product_id, area_key, label, width_px, height_px, dpi, safe_zone_json, position_json,
           supported_file_types_json, supports_transparency, default_fit, status, created_at, updated_at,
           view_key, print_rect_json, placeholders_json, image_r2_key, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'contain', 'draft', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("mpa"),
        productId,
        viewKey,
        a.label || viewKey,
        width,
        height,
        Number(a.dpi || 300),
        JSON.stringify(a.safe_zone || { x: 0, y: 0, width, height }),
        JSON.stringify(printRectStored),
        JSON.stringify(a.supported_file_types || ["png"]),
        now,
        now,
        viewKey,
        JSON.stringify(printRectStored),
        JSON.stringify(a.placeholders || {}),
        a.image_r2_key || null,
        a.image_url || null
      )
      .run();
  }
  if (product.eazpire_product_key && env?.CATALOG_DB) {
    try {
      await syncPartnerPrintAreasIntoCatalog(env, manufacturerId, productId, product.eazpire_product_key);
    } catch (e) {
      console.warn("[save-print-areas] catalog sync:", e?.message || e);
    }
  }
  return { ok: true, print_areas: (await listPrintAreas(db, manufacturerId, productId)).map(normalizeAreaForClient) };
}

/**
 * Detect green print-area placeholder on Calibration mockup for a view (+ optional color).
 * Returns normalized rect relative to the image (same coords map onto aligned Clean mocks).
 */
export async function detectPartnerPrintAreaFromCalibration(
  env,
  manufacturerId,
  productId,
  { view_key, color_key } = {}
) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  await ensureEditorColumns(db);

  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };

  const viewKey = String(view_key || "").trim();
  if (!viewKey) return { ok: false, error: "view_key_required" };

  const mockups = await listMockupSlots(db, env, productId);
  const calibration = mockups.filter(
    (m) => (m.mockup_set || "") === "calibration" && String(m.view_key) === viewKey && (m.image_r2_key || m.image_url)
  );
  if (!calibration.length) {
    return { ok: false, error: "calibration_mockup_missing", detail: "Upload a Calibration mockup with a green print-area placeholder for this view." };
  }

  const preferredColor = String(color_key || "");
  const slot =
    calibration.find((m) => String(m.color_key || "") === preferredColor) ||
    calibration.find((m) => !m.color_key) ||
    calibration[0];

  let buf = null;
  if (slot.image_r2_key) {
    const bucket = env.MOCKUP_R2 || env.R2;
    if (!bucket) return { ok: false, error: "r2_unavailable" };
    const obj = await bucket.get(slot.image_r2_key);
    if (!obj) return { ok: false, error: "calibration_image_not_found" };
    buf = await obj.arrayBuffer();
  } else if (slot.image_url) {
    const res = await fetch(slot.image_url);
    if (!res.ok) return { ok: false, error: `fetch_${res.status}` };
    buf = await res.arrayBuffer();
  }
  if (!buf) return { ok: false, error: "calibration_image_empty" };

  const { detectPrintAreaFromRgba, fracFromRect } = await import("../../render/greenMarkerPrintArea.js");
  const bytes = new Uint8Array(buf);
  let rgba;
  let width;
  let height;

  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;

  try {
    if (isPng) {
      const { decodePNGToRGBA } = await import("../../utils/png-crop.js");
      ({ rgba, width, height } = await decodePNGToRGBA(buf));
    } else if (isJpeg) {
      const jpegMod = await import("jpeg-js");
      const jpeg = jpegMod.default || jpegMod;
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      rgba = decoded.data;
      width = decoded.width;
      height = decoded.height;
    } else {
      return { ok: false, error: "unsupported_image_type", detail: "Use PNG or JPEG for Calibration mockups." };
    }
  } catch (e) {
    return { ok: false, error: "decode_failed", detail: String(e?.message || e) };
  }

  const hit = detectPrintAreaFromRgba(rgba, width, height, { loose: true, greenOnly: true });
  if (!hit) {
    return {
      ok: false,
      error: "green_marker_not_found",
      detail: "No solid green print-area placeholder found on the Calibration mockup.",
    };
  }

  const frac = fracFromRect(hit);
  const print_rect = {
    x: Number((frac?.l ?? hit.x).toFixed(6)),
    y: Number((frac?.t ?? hit.y).toFixed(6)),
    w: Number((frac?.w ?? hit.w).toFixed(6)),
    h: Number((frac?.h ?? hit.h).toFixed(6)),
    width: Number((frac?.w ?? hit.w).toFixed(6)),
    height: Number((frac?.h ?? hit.h).toFixed(6)),
    angle: 0,
  };

  return {
    ok: true,
    view_key: viewKey,
    color_key: slot.color_key || "",
    marker: hit.marker || "green",
    print_rect,
    calibration_image_url: slot.image_url || null,
  };
}

export async function savePartnerProductMeta(db, manufacturerId, productId, meta) {
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };
  await ensureEditorColumns(db);
  const now = Date.now();
  await db
    .prepare(`UPDATE manufacturer_products SET meta_json = ?, updated_at = ? WHERE id = ? AND manufacturer_id = ?`)
    .bind(JSON.stringify(meta || {}), now, productId, manufacturerId)
    .run();
  return { ok: true, product: await getProduct(db, manufacturerId, productId) };
}

export async function submitPartnerProductForReview(env, manufacturerId, productId) {
  const db = getManufacturerDb(env);
  await ensureEditorColumns(db);
  const readiness = await buildPartnerProductReadiness(db, env, manufacturerId, productId);
  if (!readiness.ok) return { ok: false, errors: readiness.errors };
  const now = Date.now();
  await db
    .prepare(`UPDATE manufacturer_products SET status = 'pending_review', updated_at = ? WHERE id = ? AND manufacturer_id = ?`)
    .bind(now, productId, manufacturerId)
    .run();
  return { ok: true, product: await getProduct(db, manufacturerId, productId) };
}

export async function uploadPartnerProductImage(env, manufacturerId, productId, { bytes, contentType, filename }) {
  const db = getManufacturerDb(env);
  const product = await getProduct(db, manufacturerId, productId);
  if (!product) return { ok: false, error: "not_found" };
  const bucket = env.MOCKUP_R2 || env.R2;
  if (!bucket) return { ok: false, error: "r2_unavailable" };
  const safeName = String(filename || "upload.png").replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `partner-products/${manufacturerId}/${productId}/${Date.now()}_${safeName}`;
  await bucket.put(r2Key, bytes, {
    httpMetadata: { contentType: contentType || "image/png" },
  });
  return { ok: true, image_r2_key: r2Key, image_url: publicFileUrl(env, r2Key) };
}

/**
 * Admin approve → eazpire_product + minimal catalog-db draft (source_system=todify)
 * Reject / changes_requested / discard (revoke) → partner notified with required review note
 */
export async function adminApprovePartnerProductToCatalog(
  env,
  productId,
  adminOwnerId,
  { changesRequested, rejected, discarded, note } = {}
) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, error: "manufacturer_db_unavailable" };
  await ensureEditorColumns(db);

  const reviewNote = String(note || "").trim();
  if (!reviewNote) {
    return { ok: false, error: "review_note_required" };
  }

  const row = await db.prepare(`SELECT * FROM manufacturer_products WHERE id = ?`).bind(productId).first();
  if (!row) return { ok: false, error: "not_found" };
  const manufacturerId = row.manufacturer_id;
  const productTitle = String(parseJson(row.meta_json, {})?.display_name || row.title || productId);
  const previousStatus = String(row.status || "");
  const linkedKey = row.eazpire_product_key ? String(row.eazpire_product_key) : null;

  // Discard / revoke — withdraw from review or pull approved preview back offline
  if (discarded) {
    const now = Date.now();
    await db
      .prepare(
        `UPDATE manufacturer_products SET status = 'rejected', review_note = ?, updated_at = ? WHERE id = ?`
      )
      .bind(reviewNote, now, productId)
      .run();

    if (linkedKey) {
      try {
        const { updateEazpireProduct } = await import("./partnerCatalog/eazpireProductService.js");
        await updateEazpireProduct(db, linkedKey, { catalog_status: "offline" });
      } catch (e) {
        console.warn("[discard-review] eazpire offline:", e?.message || e);
      }
      if (env.CATALOG_DB) {
        try {
          await env.CATALOG_DB.prepare(
            `UPDATE product_catalog SET is_active = 0, updated_at = ? WHERE product_key = ?`
          )
            .bind(now, linkedKey)
            .run();
        } catch (e) {
          console.warn("[discard-review] catalog deactivate:", e?.message || e);
        }
      }
    }

    await writeAuditLog(env, {
      manufacturer_id: manufacturerId,
      user_id: adminOwnerId,
      action: "admin_product_approval_discarded",
      entity_type: "manufacturer_product",
      entity_id: productId,
      after_json: {
        review_note: reviewNote,
        previous_status: previousStatus,
        product_key: linkedKey,
      },
    });

    const product = rowToProduct(
      await db.prepare(`SELECT * FROM manufacturer_products WHERE id = ?`).bind(productId).first()
    );
    const decision =
      previousStatus === "approved" || linkedKey ? "approval_revoked" : "discarded";
    await notifyPartnerProductReviewDecision(env, {
      manufacturerId,
      productTitle,
      decision,
      note: reviewNote,
      productId,
      productKey: linkedKey,
    });
    return {
      ok: true,
      status: "rejected",
      decision,
      product_key: linkedKey,
      catalog_status: linkedKey ? "offline" : null,
      product,
    };
  }

  const rejectOrChanges = !!(changesRequested || rejected);
  if (rejectOrChanges) {
    const now = Date.now();
    const nextStatus = rejected && !changesRequested ? "rejected" : "changes_requested";
    await db
      .prepare(
        `UPDATE manufacturer_products SET status = ?, review_note = ?, updated_at = ? WHERE id = ?`
      )
      .bind(nextStatus, reviewNote, now, productId)
      .run();
    await writeAuditLog(env, {
      manufacturer_id: manufacturerId,
      user_id: adminOwnerId,
      action: nextStatus === "rejected" ? "admin_product_rejected" : "admin_product_changes_requested",
      entity_type: "manufacturer_product",
      entity_id: productId,
      after_json: { review_note: reviewNote },
    });
    const product = rowToProduct(
      await db.prepare(`SELECT * FROM manufacturer_products WHERE id = ?`).bind(productId).first()
    );
    await notifyPartnerProductReviewDecision(env, {
      manufacturerId,
      productTitle,
      decision: nextStatus,
      note: reviewNote,
      productId,
    });
    return { ok: true, status: nextStatus, product };
  }

  const readiness = await buildPartnerProductReadiness(db, env, manufacturerId, productId);
  if (!readiness.ok) return { ok: false, error: "not_ready", errors: readiness.errors };

  const product = rowToProduct(row);
  const mfg = await db.prepare(`SELECT slug, name FROM manufacturers WHERE id = ?`).bind(manufacturerId).first();
  const baseKey =
    product.eazpire_product_key ||
    slugify(`${mfg?.slug || "partner"}-${product.sku_base || product.title || productId}`).slice(0, 80) ||
    `partner-${productId}`;

  let productKey = baseKey;
  if (env.CATALOG_DB) {
    const clash = await env.CATALOG_DB.prepare(`SELECT product_key FROM product_catalog WHERE product_key = ?`)
      .bind(productKey)
      .first();
    if (clash && product.eazpire_product_key !== productKey) {
      productKey = `${baseKey}-${String(productId).slice(-6)}`;
    }
  }

  const meta = product.meta || {};
  const title = String(meta.display_name || product.title || productKey);
  const countryCodes = expandToIsoCountryCodes(product.regions?.length ? product.regions : ["EU"]);
  const regions = regionCodesFromCountryCodes(countryCodes);

  await upsertEazpireProduct(db, {
    product_key: productKey,
    manufacturer_id: manufacturerId,
    title,
    regions,
    catalog_status: "preview",
    catalog_category_group: product.category || null,
    catalog_category_leaf: product.category || null,
    visible_design_types: product.design_types || [],
  });

  const [partnerVariants, partnerPrintAreas, partnerViews] = await Promise.all([
    listVariants(db, manufacturerId, productId),
    listPrintAreas(db, manufacturerId, productId),
    listViews(db, productId),
  ]);
  const byPosConfig = placeholdersByPositionFromPartnerPrintAreas(partnerPrintAreas);

  // One version (V1) under partner fulfillment provider when available
  try {
    const { listFulfillmentProviders } = await import("./partnerCatalog/fulfillmentProviderService.js");
    const { upsertProductVersion } = await import("./partnerCatalog/eazpireProductVersionService.js");
    const providers = await listFulfillmentProviders(db, manufacturerId);
    const locId = product.provider_location_id ? String(product.provider_location_id) : "";
    const fp =
      (locId &&
        providers.find(
          (p) =>
            String(p.id) === locId ||
            String(p.external_provider_id) === locId ||
            String(p.location?.location_id || "") === locId
        )) ||
      providers[0];
    if (fp?.id) {
      await upsertProductVersion(db, {
        product_key: productKey,
        fulfillment_provider_id: fp.id,
        display_name: title,
        external_template_product_id: productId,
        sort_order: 0,
        is_active: true,
        publish_enabled: true,
        studio_config: {
          source: "partner_product_editor",
          manufacturer_product_id: productId,
          cost_currency: product.currency || "EUR",
        },
        product_version_config: {
          placeholders_by_position: byPosConfig,
          design_types: Array.isArray(product.design_types) ? product.design_types : [],
        },
      });
    }
  } catch (e) {
    console.warn("[approve-to-catalog] version seed:", e?.message);
  }

  if (env.CATALOG_DB) {
    const now = Date.now();
    const cat = await env.CATALOG_DB.prepare(`SELECT product_key FROM product_catalog WHERE product_key = ?`)
      .bind(productKey)
      .first();
    if (!cat) {
      await env.CATALOG_DB.prepare(
        `INSERT INTO product_catalog (product_key, title, regions_json, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
        .bind(productKey, title, JSON.stringify(regions), now, now)
        .run();
    } else {
      await env.CATALOG_DB.prepare(
        `UPDATE product_catalog SET title = ?, regions_json = ?, is_active = 1, updated_at = ? WHERE product_key = ?`
      )
        .bind(title, JSON.stringify(regions), now, productKey)
        .run();
    }

    // Seed / refresh publish profile with partner print-area placeholders (Printify-shaped)
    const catalogVariants = buildTodifyCatalogVariantsFromPartner({
      variants: partnerVariants,
      printAreas: partnerPrintAreas,
      views: partnerViews,
    });
    const prices = {};
    catalogVariants.forEach((v) => {
      prices[String(v.id)] = v.price;
    });
    const positionsArr = catalogPlaceholdersFromPartnerPrintAreas(partnerPrintAreas, partnerViews).map(
      (p) => p.position
    );

    const prof = await env.CATALOG_DB.prepare(
      `SELECT id FROM product_publish_profiles WHERE product_key = ? LIMIT 1`
    )
      .bind(productKey)
      .first();

    if (!prof) {
      let insertResult;
      try {
        insertResult = await env.CATALOG_DB.prepare(
          `INSERT INTO product_publish_profiles
            (product_key, title, source_system, source_product_id, standard_product_display_name,
             variants_json, prices_json, product_features, care_instructions, size_table_html, gpsr_html,
             catalog_placeholder_positions_json, catalog_placeholder_positions_updated_at,
             is_active, collected_at, updated_at)
           VALUES (?, ?, 'todify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
          .bind(
            productKey,
            title,
            productId,
            title,
            JSON.stringify(catalogVariants),
            JSON.stringify(prices),
            meta.product_features || null,
            meta.care_instructions || null,
            meta.size_table_html || null,
            meta.gpsr_html || null,
            JSON.stringify(positionsArr),
            now,
            now,
            now
          )
          .run();
      } catch (e) {
        console.warn("[approve-to-catalog] profile insert with positions:", e?.message || e);
        insertResult = await env.CATALOG_DB.prepare(
          `INSERT INTO product_publish_profiles
            (product_key, title, source_system, source_product_id, standard_product_display_name,
             variants_json, prices_json, product_features, care_instructions, size_table_html, gpsr_html,
             is_active, collected_at, updated_at)
           VALUES (?, ?, 'todify', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
          .bind(
            productKey,
            title,
            productId,
            title,
            JSON.stringify(catalogVariants),
            JSON.stringify(prices),
            meta.product_features || null,
            meta.care_instructions || null,
            meta.size_table_html || null,
            meta.gpsr_html || null,
            now,
            now
          )
          .run();
      }

      const profileId = insertResult?.meta?.last_row_id;
      if (profileId) {
        const providerName = mfg?.name || "Todify";
        try {
          await env.CATALOG_DB.prepare(
            `INSERT INTO product_publish_map
              (product_key, region_codes_json, provider_name, country_codes_json, priority, publish_profile_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, 100, ?, ?, ?)`
          )
            .bind(
              productKey,
              JSON.stringify(regions),
              providerName,
              JSON.stringify(countryCodes),
              profileId,
              now,
              now
            )
            .run();
        } catch (e) {
          console.warn("[approve-to-catalog] publish map:", e?.message);
        }
      }
    }

    // Always refresh placeholders on approve (covers re-approve / already-existing profiles)
    try {
      await syncPartnerPrintAreasIntoCatalog(env, manufacturerId, productId, productKey);
    } catch (e) {
      console.warn("[approve-to-catalog] print-area sync:", e?.message || e);
    }
  }

  const now = Date.now();
  await db
    .prepare(
      `UPDATE manufacturer_products SET status = 'approved', eazpire_product_key = ?, review_note = ?, updated_at = ? WHERE id = ?`
    )
    .bind(productKey, reviewNote, now, productId)
    .run();

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: adminOwnerId,
    action: "admin_product_approved_to_catalog",
    entity_type: "manufacturer_product",
    entity_id: productId,
    after_json: { product_key: productKey, review_note: reviewNote },
  });

  await notifyPartnerProductReviewDecision(env, {
    manufacturerId,
    productTitle: title,
    decision: "approved",
    note: reviewNote,
    productId,
    productKey,
  });

  return {
    ok: true,
    product_key: productKey,
    status: "approved",
    catalog_status: "preview",
    product: await getProduct(db, manufacturerId, productId),
  };
}

async function collectPartnerNotifyEmails(db, manufacturerId) {
  const emails = new Set();
  const users = await db
    .prepare(`SELECT email FROM manufacturer_users WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .all();
  for (const row of users?.results || []) {
    const email = String(row.email || "").trim().toLowerCase();
    if (email) emails.add(email);
  }
  const mfg = await db
    .prepare(`SELECT name, support_email, business_email FROM manufacturers WHERE id = ?`)
    .bind(manufacturerId)
    .first();
  for (const field of [mfg?.support_email, mfg?.business_email]) {
    const email = String(field || "").trim().toLowerCase();
    if (email) emails.add(email);
  }
  return { emails: [...emails], companyName: mfg?.name || null };
}

async function notifyPartnerProductReviewDecision(env, { manufacturerId, productTitle, decision, note, productId, productKey }) {
  const db = getManufacturerDb(env);
  if (!db) return;
  const { emails, companyName } = await collectPartnerNotifyEmails(db, manufacturerId);
  if (!emails.length) {
    console.warn("[product-review-notify] no partner emails", manufacturerId, productId);
    return;
  }
  const { sendPartnerProductReviewDecisionEmail } = await import("./email.js");
  const portalBase = String(env.PARTNER_PORTAL_URL || "https://partner.eazpire.com").replace(/\/$/, "");
  for (const to of emails) {
    try {
      await sendPartnerProductReviewDecisionEmail(env, {
        to,
        companyName,
        productTitle,
        decision,
        note,
        productKey: productKey || null,
        portalUrl: `${portalBase}/`,
      });
    } catch (e) {
      console.warn("[product-review-notify] email failed", to, e?.message || e);
    }
  }
}
