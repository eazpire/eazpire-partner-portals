/**
 * Ensure Printify system partner exists
 */

import { newId } from "../db.js";
import { PRINTIFY_PARTNER_ID, PRINTIFY_PARTNER_SLUG } from "./constants.js";

export async function ensurePrintifyPartner(db) {
  const existing = await db
    .prepare(`SELECT id FROM manufacturers WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(PRINTIFY_PARTNER_ID, PRINTIFY_PARTNER_SLUG)
    .first();
  if (existing?.id) return existing.id;

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO manufacturers
        (id, name, legal_name, slug, country, website, status, integration_type,
         quality_score, delivery_score, support_score, artifact_ready_score, created_at, updated_at)
       VALUES (?, 'Printify', 'Printify Inc.', ?, 'US', 'https://printify.com', 'verified', 'api', 0, 0, 0, 0, ?, ?)`
    )
    .bind(PRINTIFY_PARTNER_ID, PRINTIFY_PARTNER_SLUG, now, now)
    .run();
  return PRINTIFY_PARTNER_ID;
}

export async function getPartnerByIdOrSlug(db, idOrSlug) {
  const key = String(idOrSlug || "").trim();
  if (!key) return null;
  const row = await db
    .prepare(`SELECT * FROM manufacturers WHERE id = ? OR slug = ? LIMIT 1`)
    .bind(key, key)
    .first();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    integration_type: row.integration_type,
    country: row.country,
    website: row.website,
  };
}

export async function listPartnersForAdmin(db) {
  const res = await db
    .prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM manufacturer_fulfillment_providers fp WHERE fp.manufacturer_id = m.id) AS fulfillment_provider_count,
        (SELECT COUNT(*) FROM manufacturer_eazpire_blueprints eb WHERE eb.manufacturer_id = m.id AND eb.status = 'live') AS live_blueprint_count,
        (SELECT COUNT(*) FROM eazpire_products ep WHERE ep.manufacturer_id = m.id) AS eazpire_product_count
       FROM manufacturers m
       ORDER BY m.name ASC`
    )
    .all();
  return (res?.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    integration_type: row.integration_type,
    /** @deprecated use provider_count */
    fulfillment_provider_count: Number(row.fulfillment_provider_count || 0),
    provider_count: Number(row.fulfillment_provider_count || 0),
    live_blueprint_count: Number(row.live_blueprint_count || 0),
    eazpire_product_count: Number(row.eazpire_product_count || 0),
  }));
}
