/**
 * Ensure MANUFACTURER_DB schema (migrations applied via wrangler; runtime no-op guard)
 */

import { getManufacturerDb } from "./db.js";

let schemaReady = false;

export async function ensureManufacturerSchema(env) {
  const db = getManufacturerDb(env);
  if (!db) return false;
  if (schemaReady) return true;
  await db.prepare(`SELECT 1 FROM manufacturers LIMIT 1`).first().catch(() => null);
  schemaReady = true;
  return true;
}
