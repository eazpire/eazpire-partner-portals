/**
 * Ensure MANUFACTURER_DB schema — idempotent runtime guards for partner worker deploys
 * (D1 migrations may lag behind worker code; apply missing tables/columns here)
 */

import { getManufacturerDb } from "./db.js";

let schemaReady = false;

async function tableColumns(db, table) {
  try {
    const res = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (!res || !Array.isArray(res.results)) return null;
    return new Set(res.results.map((row) => row.name));
  } catch {
    return null;
  }
}

async function ensureColumn(db, table, column, definition) {
  const cols = await tableColumns(db, table);
  if (!cols) return;
  if (cols.has(column)) return;
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

async function applyPendingSchemaPatches(db) {
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS partner_email_blocks (
          email TEXT PRIMARY KEY,
          blocked_at INTEGER NOT NULL,
          blocked_by TEXT,
          reason TEXT
        )`
      )
      .run();
  } catch (e) {
    console.warn("[ensureManufacturerSchema] partner_email_blocks skipped:", e?.message || e);
  }

  try {
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_partner_email_blocks_blocked_at
         ON partner_email_blocks (blocked_at DESC)`
      )
      .run();
  } catch {
    /* index optional */
  }

  await ensureColumn(db, "manufacturers", "suspend_reason", "TEXT");
  await ensureColumn(db, "manufacturers", "suspended_at", "INTEGER");
  await ensureColumn(db, "manufacturers", "suspended_by", "TEXT");

  try {
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_manufacturers_suspended_at
         ON manufacturers (suspended_at DESC)`
      )
      .run();
  } catch {
    /* index optional */
  }
}

export async function ensureManufacturerSchema(env) {
  const db = getManufacturerDb(env);
  if (!db) return false;
  if (schemaReady) return true;

  await db.prepare(`SELECT 1 FROM manufacturers LIMIT 1`).first().catch(() => null);
  await applyPendingSchemaPatches(db);

  schemaReady = true;
  return true;
}
