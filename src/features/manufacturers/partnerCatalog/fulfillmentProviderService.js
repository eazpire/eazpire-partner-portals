/**
 * Fulfillment providers (Providers under a Partner)
 */

import { newId, parseJson } from "../db.js";

function rowToFulfillmentProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    manufacturer_id: row.manufacturer_id,
    external_provider_id: row.external_provider_id,
    integration_system: row.integration_system,
    name: row.name,
    location: parseJson(row.location_json, {}),
    ships_to: parseJson(row.ships_to_json, []),
    production_days_min: row.production_days_min,
    production_days_max: row.production_days_max,
    status: row.status,
    synced_at: row.synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listFulfillmentProviders(db, manufacturerId) {
  const res = await db
    .prepare(
      `SELECT * FROM manufacturer_fulfillment_providers
       WHERE manufacturer_id = ?
       ORDER BY name ASC`
    )
    .bind(manufacturerId)
    .all();
  return (res?.results || []).map(rowToFulfillmentProvider);
}

export async function getFulfillmentProviderByExternalId(db, manufacturerId, integrationSystem, externalProviderId) {
  const row = await db
    .prepare(
      `SELECT * FROM manufacturer_fulfillment_providers
       WHERE manufacturer_id = ? AND integration_system = ? AND external_provider_id = ?
       LIMIT 1`
    )
    .bind(manufacturerId, integrationSystem, String(externalProviderId))
    .first();
  return rowToFulfillmentProvider(row);
}

export async function upsertFulfillmentProvider(db, manufacturerId, input) {
  const externalId = String(input.external_provider_id || "").trim();
  const system = String(input.integration_system || "printify").trim().toLowerCase();
  if (!externalId) throw new Error("external_provider_id_required");

  const existing = await getFulfillmentProviderByExternalId(db, manufacturerId, system, externalId);
  const now = Date.now();
  const payload = {
    name: String(input.name || `Provider ${externalId}`).trim(),
    location_json: JSON.stringify(input.location || {}),
    ships_to_json: JSON.stringify(input.ships_to || []),
    production_days_min: input.production_days_min ?? null,
    production_days_max: input.production_days_max ?? null,
    status: input.status || "active",
    synced_at: input.synced_at ?? now,
  };

  if (existing) {
    await db
      .prepare(
        `UPDATE manufacturer_fulfillment_providers SET
          name = ?, location_json = ?, ships_to_json = ?,
          production_days_min = ?, production_days_max = ?, status = ?, synced_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        payload.name,
        payload.location_json,
        payload.ships_to_json,
        payload.production_days_min,
        payload.production_days_max,
        payload.status,
        payload.synced_at,
        now,
        existing.id
      )
      .run();
    return getFulfillmentProviderByExternalId(db, manufacturerId, system, externalId);
  }

  const id = newId("mfp");
  await db
    .prepare(
      `INSERT INTO manufacturer_fulfillment_providers
        (id, manufacturer_id, external_provider_id, integration_system, name, location_json,
         ships_to_json, production_days_min, production_days_max, status, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      manufacturerId,
      externalId,
      system,
      payload.name,
      payload.location_json,
      payload.ships_to_json,
      payload.production_days_min,
      payload.production_days_max,
      payload.status,
      payload.synced_at,
      now,
      now
    )
    .run();
  return getFulfillmentProviderByExternalId(db, manufacturerId, system, externalId);
}

export async function getFulfillmentProviderById(db, id) {
  const row = await db.prepare(`SELECT * FROM manufacturer_fulfillment_providers WHERE id = ?`).bind(id).first();
  return rowToFulfillmentProvider(row);
}
