/**
 * Manufacturer + location CRUD
 */

import { getManufacturerDb, newId, slugify, rowToManufacturer, parseJson } from "./db.js";
import { writeAuditLog } from "./rbac.js";
import { blockPartnerEmail, normalizePartnerEmail } from "./partnerEmailBlocks.js";
import { sendPartnerManufacturerSuspendedEmail } from "./email.js";
import { PRINTIFY_PARTNER_ID } from "./partnerCatalog/constants.js";
import {
  listFulfillmentProviders,
  upsertFulfillmentProvider,
} from "./partnerCatalog/fulfillmentProviderService.js";

export async function getManufacturerById(db, manufacturerId) {
  const row = await db.prepare(`SELECT * FROM manufacturers WHERE id = ?`).bind(manufacturerId).first();
  return rowToManufacturer(row);
}

export async function updateManufacturer(db, manufacturerId, patch) {
  const existing = await getManufacturerById(db, manufacturerId);
  if (!existing) return null;
  const now = Date.now();
  const next = {
    name: patch.name ?? existing.name,
    legal_name: patch.legal_name ?? existing.legal_name,
    country: patch.country ?? existing.country,
    website: patch.website ?? existing.website,
    support_email: patch.support_email ?? existing.support_email,
    business_email: patch.business_email ?? existing.business_email,
    integration_type: patch.integration_type ?? existing.integration_type,
  };
  await db
    .prepare(
      `UPDATE manufacturers SET
        name = ?, legal_name = ?, country = ?, website = ?,
        support_email = ?, business_email = ?, integration_type = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      next.name,
      next.legal_name,
      next.country,
      next.website,
      next.support_email,
      next.business_email,
      next.integration_type,
      now,
      manufacturerId
    )
    .run();
  return getManufacturerById(db, manufacturerId);
}

export async function listLocations(db, manufacturerId) {
  const res = await db
    .prepare(`SELECT * FROM manufacturer_locations WHERE manufacturer_id = ? ORDER BY created_at DESC`)
    .bind(manufacturerId)
    .all();
  return (res.results || []).map((row) => ({
    ...row,
    name: row.label || row.name,
    ships_to: parseJson(row.ships_to_json, []),
    return_address: parseJson(row.return_address_json, null),
  }));
}

/**
 * Keep Catalog Studio print-provider labels in sync with company location names.
 * Skips Printify (those providers come from Printify catalog sync).
 * If a fulfillment provider already links to this location via location_json.location_id,
 * only the display name / geo fields are updated (preserves todify/printify external ids).
 */
export async function syncLocationToFulfillmentProvider(db, manufacturerId, location) {
  if (!location?.id || manufacturerId === PRINTIFY_PARTNER_ID) return null;

  const displayName = String(location.label || location.name || "").trim();
  if (!displayName) return null;

  const providers = await listFulfillmentProviders(db, manufacturerId);
  const linked = providers.find(
    (p) => String(p.location?.location_id || "") === String(location.id)
  );

  const locationPayload = {
    ...(linked?.location && typeof linked.location === "object" ? linked.location : {}),
    country: location.country || null,
    city: location.city || null,
    region: location.region || null,
    location_id: location.id,
  };

  if (linked) {
    return upsertFulfillmentProvider(db, manufacturerId, {
      integration_system: linked.integration_system,
      external_provider_id: linked.external_provider_id,
      name: displayName,
      location: locationPayload,
      ships_to: location.ships_to?.length ? location.ships_to : linked.ships_to || [],
      production_days_min: location.production_days_min ?? linked.production_days_min,
      production_days_max: location.production_days_max ?? linked.production_days_max,
      status: location.status || linked.status || "active",
    });
  }

  return upsertFulfillmentProvider(db, manufacturerId, {
    integration_system: "portal",
    external_provider_id: String(location.id),
    name: displayName,
    location: locationPayload,
    ships_to: location.ships_to || [],
    production_days_min: location.production_days_min ?? 2,
    production_days_max: location.production_days_max ?? 7,
    status: location.status || "active",
  });
}

export async function createLocation(db, manufacturerId, input) {
  const id = newId("mloc");
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturer_locations
        (id, manufacturer_id, label, country, region, city, postal_code, ships_to_json,
         production_days_min, production_days_max, return_address_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(
      id,
      manufacturerId,
      input.label || input.name || null,
      input.country,
      input.region || null,
      input.city || null,
      input.postal_code || null,
      JSON.stringify(input.ships_to || []),
      Number(input.production_days_min ?? 2),
      Number(input.production_days_max ?? 7),
      input.return_address ? JSON.stringify(input.return_address) : null,
      now,
      now
    )
    .run();
  const location = (await listLocations(db, manufacturerId)).find((l) => l.id === id);
  try {
    await syncLocationToFulfillmentProvider(db, manufacturerId, location);
  } catch (e) {
    console.warn("[createLocation] fulfillment provider sync:", e?.message || e);
  }
  return location;
}

export async function updateLocation(db, manufacturerId, locationId, input) {
  const existing = (await listLocations(db, manufacturerId)).find((l) => l.id === locationId);
  if (!existing) return null;

  const now = Date.now();
  const next = {
    label: input.label ?? input.name ?? existing.label ?? existing.name,
    country: input.country ?? existing.country,
    region: input.region !== undefined ? input.region : existing.region,
    city: input.city !== undefined ? input.city : existing.city,
    postal_code: input.postal_code !== undefined ? input.postal_code : existing.postal_code,
    ships_to: input.ships_to !== undefined ? input.ships_to : existing.ships_to || [],
    production_days_min: Number(input.production_days_min ?? existing.production_days_min ?? 2),
    production_days_max: Number(input.production_days_max ?? existing.production_days_max ?? 7),
    status: input.status ?? existing.status ?? "active",
  };

  await db
    .prepare(
      `UPDATE manufacturer_locations SET
        label = ?, country = ?, region = ?, city = ?, postal_code = ?, ships_to_json = ?,
        production_days_min = ?, production_days_max = ?, status = ?, updated_at = ?
       WHERE id = ? AND manufacturer_id = ?`
    )
    .bind(
      next.label,
      next.country,
      next.region || null,
      next.city || null,
      next.postal_code || null,
      JSON.stringify(next.ships_to || []),
      next.production_days_min,
      next.production_days_max,
      next.status,
      now,
      locationId,
      manufacturerId
    )
    .run();

  const location = (await listLocations(db, manufacturerId)).find((l) => l.id === locationId);
  try {
    await syncLocationToFulfillmentProvider(db, manufacturerId, location);
  } catch (e) {
    console.warn("[updateLocation] fulfillment provider sync:", e?.message || e);
  }
  return location;
}

export async function getDashboard(db, manufacturerId) {
  const manufacturer = await getManufacturerById(db, manufacturerId);
  const products = await db
    .prepare(`SELECT status, COUNT(*) AS cnt FROM manufacturer_products WHERE manufacturer_id = ? GROUP BY status`)
    .bind(manufacturerId)
    .all();
  const orders = await db
    .prepare(
      `SELECT status, COUNT(*) AS cnt FROM manufacturer_orders WHERE manufacturer_id = ? GROUP BY status`
    )
    .bind(manufacturerId)
    .all();
  const openOrders = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM manufacturer_orders
       WHERE manufacturer_id = ? AND status IN ('received','accepted','in_production','quality_check')`
    )
    .bind(manufacturerId)
    .first();

  const pendingProducts = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM manufacturer_products
       WHERE manufacturer_id = ? AND status IN ('draft','pending_review')`
    )
    .bind(manufacturerId)
    .first();

  const pendingCount = Number(pendingProducts?.cnt || 0);

  const actionItems = [];
  const missingTracking = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM manufacturer_orders
       WHERE manufacturer_id = ? AND status = 'in_production' AND (tracking_number IS NULL OR tracking_number = '')`
    )
    .bind(manufacturerId)
    .first();
  if (Number(missingTracking?.cnt || 0) > 0) {
    actionItems.push({
      key: "tracking_missing",
      title: "Orders need tracking",
      detail: `${missingTracking.cnt} in-production order(s) missing tracking numbers`,
      status: "warning",
      count: Number(missingTracking.cnt),
      severity: "warning",
    });
  }

  if (pendingCount > 0) {
    actionItems.push({
      key: "products_pending",
      title: "Products awaiting submission or review",
      detail: `${pendingCount} product(s) in draft or pending review`,
      status: "pending_review",
      count: pendingCount,
      severity: "info",
    });
  }

  // Product review decisions (approve / reject / changes requested) for Overview notices
  let reviewDecisions = [];
  try {
    const decisionRes = await db
      .prepare(
        `SELECT id, title, status, review_note, eazpire_product_key, updated_at, meta_json
         FROM manufacturer_products
         WHERE manufacturer_id = ?
           AND status IN ('approved', 'rejected', 'changes_requested')
           AND review_note IS NOT NULL AND TRIM(review_note) != ''
         ORDER BY updated_at DESC
         LIMIT 25`
      )
      .bind(manufacturerId)
      .all();
    reviewDecisions = decisionRes?.results || [];
  } catch {
    reviewDecisions = [];
  }

  for (const row of reviewDecisions) {
    let displayName = row.title;
    try {
      const meta = JSON.parse(row.meta_json || "{}");
      if (meta?.display_name) displayName = meta.display_name;
    } catch {
      /* ignore */
    }
    const status = row.status;
    const title =
      status === "approved"
        ? `Product approved: ${displayName || row.id}`
        : status === "rejected"
          ? `Product rejected / review discarded: ${displayName || row.id}`
          : `Changes requested: ${displayName || row.id}`;
    actionItems.push({
      key: `product_review_${row.id}`,
      title,
      detail: row.review_note,
      status,
      count: 1,
      severity: status === "approved" ? "success" : "warning",
      product_id: row.id,
      eazpire_product_key: row.eazpire_product_key || null,
      updated_at: row.updated_at,
    });
  }

  const totalProducts = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM manufacturer_products WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .first();

  const certRow = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('approved','passed') THEN 1 ELSE 0 END) AS done
       FROM manufacturer_certifications WHERE manufacturer_id = ?`
    )
    .bind(manufacturerId)
    .first();
  const certTotal = Number(certRow?.total || 0);
  const certDone = Number(certRow?.done || 0);
  const certificationPct = certTotal > 0 ? Math.round((certDone / certTotal) * 100) : 0;

  return {
    manufacturer,
    kpis: {
      products_total: Number(totalProducts?.cnt || 0),
      products_pending: pendingCount,
      orders_open: Number(openOrders?.cnt || 0),
      certification_pct: certificationPct,
    },
    metrics: {
      products_by_status: products.results || [],
      orders_by_status: orders.results || [],
      open_orders: Number(openOrders?.cnt || 0),
      active_products: await db
        .prepare(`SELECT COUNT(*) AS cnt FROM manufacturer_products WHERE manufacturer_id = ? AND status = 'active'`)
        .bind(manufacturerId)
        .first()
        .then((r) => Number(r?.cnt || 0)),
    },
    action_items: actionItems,
    product_review_notices: reviewDecisions.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      review_note: row.review_note,
      eazpire_product_key: row.eazpire_product_key || null,
      updated_at: row.updated_at,
    })),
    pending_products: Number(pendingProducts?.cnt || 0),
  };
}

export async function adminCreateManufacturer(env, input, adminOwnerId, options = {}) {
  const db = getManufacturerDb(env);
  const id = newId("mfr");
  const now = Date.now();
  const slug = slugify(input.slug || input.name) || id;
  const ownerEmail = String(input.owner_email || "").trim().toLowerCase();

  await db
    .prepare(
      `INSERT INTO manufacturers
        (id, name, legal_name, slug, country, website, support_email, business_email, status, integration_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved_for_test', ?, ?, ?)`
    )
    .bind(
      id,
      input.name,
      input.legal_name || input.name,
      slug,
      input.country || "DE",
      input.website || null,
      input.support_email || ownerEmail,
      input.business_email || ownerEmail,
      input.integration_type || "portal",
      now,
      now
    )
    .run();

  if (ownerEmail) {
    const userId = newId("musr");
    await db
      .prepare(
        `INSERT INTO manufacturer_users (id, manufacturer_id, user_id, email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)`
      )
      .bind(userId, id, userId, ownerEmail, now, now)
      .run();
  }

  await writeAuditLog(env, {
    manufacturer_id: id,
    user_id: adminOwnerId,
    action: "admin_create_manufacturer",
    entity_type: "manufacturer",
    entity_id: id,
    after_json: { name: input.name, owner_email: ownerEmail },
  });

  if (ownerEmail && !options.skipMagicLink) {
    const { issuePartnerMagicLink } = await import("./partnerAuth.js");
    const mail = await issuePartnerMagicLink(env, ownerEmail);
    if (!mail.ok) {
      console.error("[admin-manufacturer-create] invite email failed", ownerEmail, mail.reason, mail.detail || "");
    }
  }

  return getManufacturerById(db, id);
}

export async function adminListManufacturers(db, { status, limit = 100 } = {}) {
  let sql = `SELECT * FROM manufacturers`;
  const binds = [];
  if (status) {
    sql += ` WHERE status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await db.prepare(sql).bind(...binds).all();
  return (res.results || []).map(rowToManufacturer);
}

async function deleteManufacturerCascade(db, manufacturerId) {
  await db
    .prepare(
      `DELETE FROM manufacturer_auth_tokens
       WHERE manufacturer_user_id IN (SELECT id FROM manufacturer_users WHERE manufacturer_id = ?)`
    )
    .bind(manufacturerId)
    .run();

  await db
    .prepare(
      `DELETE FROM manufacturer_order_items
       WHERE manufacturer_order_id IN (SELECT id FROM manufacturer_orders WHERE manufacturer_id = ?)`
    )
    .bind(manufacturerId)
    .run();

  await db.prepare(`DELETE FROM manufacturer_orders WHERE manufacturer_id = ?`).bind(manufacturerId).run();

  await db
    .prepare(
      `DELETE FROM manufacturer_blueprint_conversion_runs
       WHERE provider_blueprint_id IN (
         SELECT id FROM manufacturer_provider_blueprints WHERE manufacturer_id = ?
       )`
    )
    .bind(manufacturerId)
    .run();

  await db
    .prepare(`DELETE FROM manufacturer_eazpire_blueprints WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .run();

  await db
    .prepare(`DELETE FROM manufacturer_provider_blueprints WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .run();

  await db
    .prepare(
      `DELETE FROM manufacturer_print_areas
       WHERE manufacturer_product_id IN (SELECT id FROM manufacturer_products WHERE manufacturer_id = ?)`
    )
    .bind(manufacturerId)
    .run();

  await db
    .prepare(
      `DELETE FROM manufacturer_mockup_templates
       WHERE manufacturer_product_id IN (SELECT id FROM manufacturer_products WHERE manufacturer_id = ?)`
    )
    .bind(manufacturerId)
    .run();

  await db
    .prepare(
      `DELETE FROM manufacturer_variants
       WHERE manufacturer_product_id IN (SELECT id FROM manufacturer_products WHERE manufacturer_id = ?)`
    )
    .bind(manufacturerId)
    .run();

  await db.prepare(`DELETE FROM manufacturer_products WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db.prepare(`DELETE FROM manufacturer_shipping_rates WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db.prepare(`DELETE FROM manufacturer_certifications WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db.prepare(`DELETE FROM manufacturer_locations WHERE manufacturer_id = ?`).bind(manufacturerId).run();

  // Catalog versions / profiles tied to this manufacturer (before FPs / eazpire_products)
  const eazpireKeys = await db
    .prepare(`SELECT product_key FROM eazpire_products WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .all();
  for (const row of eazpireKeys?.results || []) {
    const key = row.product_key;
    if (!key) continue;
    for (const table of [
      "eazpire_product_versions",
      "eazpire_template_products",
      "eazpire_product_publish_plans",
      "eazpire_product_publish_profiles",
      "eazpire_product_active_providers",
      "eazpire_product_mockup_defaults",
      "eazpire_product_mockup_images",
      "eazpire_product_mockup_view_random",
      "eazpire_product_variant_print_areas",
      "eazpire_product_base_costs",
      "eazpire_product_variant_config",
    ]) {
      try {
        await db.prepare(`DELETE FROM ${table} WHERE product_key = ?`).bind(key).run();
      } catch {
        /* optional older schema */
      }
    }
  }
  await db.prepare(`DELETE FROM eazpire_products WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db
    .prepare(`DELETE FROM manufacturer_fulfillment_providers WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .run();

  await db
    .prepare(
      `DELETE FROM partner_application_tokens
       WHERE application_id IN (SELECT id FROM partner_applications WHERE manufacturer_id = ?)`
    )
    .bind(manufacturerId)
    .run();

  await db.prepare(`DELETE FROM partner_applications WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db.prepare(`DELETE FROM manufacturer_users WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db.prepare(`DELETE FROM manufacturer_audit_logs WHERE manufacturer_id = ?`).bind(manufacturerId).run();
  await db.prepare(`DELETE FROM manufacturers WHERE id = ?`).bind(manufacturerId).run();
}

/** Permanently delete a manufacturer and optionally block associated emails. */
export async function adminRemoveManufacturer(env, manufacturerId, mode, adminOwnerId) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, reason: "manufacturer_db_unavailable" };

  const manufacturer = await getManufacturerById(db, manufacturerId);
  if (!manufacturer) return { ok: false, reason: "not_found" };

  const blockEmails = mode === "block_remove";
  const emails = new Set();

  const users = await db
    .prepare(`SELECT email FROM manufacturer_users WHERE manufacturer_id = ?`)
    .bind(manufacturerId)
    .all();
  for (const row of users.results || []) {
    const normalized = normalizePartnerEmail(row.email);
    if (normalized) emails.add(normalized);
  }
  for (const field of [manufacturer.support_email, manufacturer.business_email]) {
    const normalized = normalizePartnerEmail(field);
    if (normalized) emails.add(normalized);
  }

  await deleteManufacturerCascade(db, manufacturerId);

  if (blockEmails) {
    for (const email of emails) {
      await blockPartnerEmail(db, email, adminOwnerId, "admin_block_remove");
    }
  }

  await writeAuditLog(env, {
    manufacturer_id: null,
    user_id: adminOwnerId,
    action: "admin_remove_manufacturer",
    entity_type: "manufacturer",
    entity_id: manufacturerId,
    after_json: {
      mode: blockEmails ? "block_remove" : "remove",
      name: manufacturer.name,
      blocked_emails: blockEmails ? [...emails] : [],
    },
  });

  return {
    ok: true,
    removed_id: manufacturerId,
    blocked_emails: blockEmails ? [...emails] : [],
  };
}

export async function adminUpdateManufacturerStatus(env, manufacturerId, status, adminOwnerId) {
  const db = getManufacturerDb(env);
  const now = Date.now();
  await db
    .prepare(`UPDATE manufacturers SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, now, manufacturerId)
    .run();
  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: adminOwnerId,
    action: "admin_manufacturer_status",
    entity_type: "manufacturer",
    entity_id: manufacturerId,
    after_json: { status },
  });
  return getManufacturerById(db, manufacturerId);
}

async function collectManufacturerEmails(db, manufacturer) {
  const emails = new Set();
  const users = await db
    .prepare(`SELECT email FROM manufacturer_users WHERE manufacturer_id = ?`)
    .bind(manufacturer.id)
    .all();
  for (const row of users.results || []) {
    const normalized = normalizePartnerEmail(row.email);
    if (normalized) emails.add(normalized);
  }
  for (const field of [manufacturer.support_email, manufacturer.business_email]) {
    const normalized = normalizePartnerEmail(field);
    if (normalized) emails.add(normalized);
  }
  return emails;
}

/** Suspend a manufacturer and optionally block associated emails. */
export async function adminSuspendManufacturer(env, manufacturerId, adminOwnerId, options = {}) {
  const db = getManufacturerDb(env);
  if (!db) return { ok: false, reason: "manufacturer_db_unavailable" };

  const manufacturer = await getManufacturerById(db, manufacturerId);
  if (!manufacturer) return { ok: false, reason: "not_found" };
  if (manufacturer.status === "suspended") {
    return { ok: true, manufacturer, blocked: false };
  }

  const block = !!options.block;
  const suspendReason = String(options.reason || "").trim() || null;
  const now = Date.now();

  await db
    .prepare(
      `UPDATE manufacturers
       SET status = 'suspended', suspend_reason = ?, suspended_at = ?, suspended_by = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(suspendReason, now, adminOwnerId, now, manufacturerId)
    .run();

  const emails = await collectManufacturerEmails(db, manufacturer);
  if (block) {
    for (const email of emails) {
      await blockPartnerEmail(db, email, adminOwnerId, suspendReason || "manufacturer_suspended");
    }
  }

  await writeAuditLog(env, {
    manufacturer_id: manufacturerId,
    user_id: adminOwnerId,
    action: "admin_manufacturer_suspended",
    entity_type: "manufacturer",
    entity_id: manufacturerId,
    after_json: {
      suspend_reason: suspendReason,
      blocked: block,
      blocked_emails: block ? [...emails] : [],
    },
  });

  const notifyEmail = [...emails][0] || null;
  if (notifyEmail) {
    const mail = await sendPartnerManufacturerSuspendedEmail(env, {
      to: notifyEmail,
      companyName: manufacturer.name,
      reason: suspendReason,
      blocked: block,
    });
    if (!mail.ok && !mail.skipped) {
      console.error("[admin-manufacturer-suspend] email failed", mail.error);
    }
  }

  return {
    ok: true,
    manufacturer: await getManufacturerById(db, manufacturerId),
    blocked: block,
    blocked_emails: block ? [...emails] : [],
  };
}

export async function adminNetworkOverview(db) {
  const manufacturers = await db.prepare(`SELECT COUNT(*) AS cnt FROM manufacturers`).first();
  const products = await db.prepare(`SELECT COUNT(*) AS cnt FROM manufacturer_products`).first();
  const openOrders = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM manufacturer_orders WHERE status NOT IN ('delivered','cancelled','refunded','failed')`
    )
    .first();
  const avgQuality = await db
    .prepare(`SELECT AVG(quality_score) AS avg FROM manufacturers WHERE quality_score > 0`)
    .first();

  const health = await db
    .prepare(`SELECT * FROM manufacturers ORDER BY updated_at DESC LIMIT 25`)
    .all();

  const risks = [];
  const lateTracking = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM manufacturer_orders
       WHERE status = 'in_production' AND (tracking_number IS NULL OR tracking_number = '')`
    )
    .first();
  if (Number(lateTracking?.cnt || 0) > 0) {
    risks.push({
      key: "late_tracking",
      message: `${lateTracking.cnt} orders in production without tracking`,
    });
  }

  return {
    kpis: {
      manufacturers_total: Number(manufacturers?.cnt || 0),
      products_pending: Number(
        (
          await db.prepare(
            `SELECT COUNT(*) AS cnt FROM manufacturer_products WHERE status = 'pending_review'`
          ).first()
        )?.cnt || 0
      ),
      orders_open: Number(openOrders?.cnt || 0),
      at_risk: risks.length,
      active_manufacturers: Number(manufacturers?.cnt || 0),
      catalog_products: Number(products?.cnt || 0),
      avg_quality_score: Number(avgQuality?.avg || 0).toFixed(1),
    },
    alerts: risks.map((r) => ({ title: r.key, detail: r.message, status: "warning" })),
    manufacturer_health: (health.results || []).map(rowToManufacturer),
    risks,
  };
}
