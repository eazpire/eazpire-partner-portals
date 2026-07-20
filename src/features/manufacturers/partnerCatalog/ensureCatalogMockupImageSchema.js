/**
 * Runtime schema fixes for product_mockup_images (catalog-db).
 * Migration 0061 UNIQUE key omitted mockup_set — shop_preview sync collided with clean rows.
 */

import { canonicalizeMockupViewKey } from "../../../utils/printifyShopProductMocks.js";

let catalogMockupSchemaReady = false;

/** @param {string} sql */
export function tableSqlNeedsMockupSetUnique(sql) {
  const text = String(sql || "");
  const uniqueParts = text.match(/UNIQUE\s*\([^)]+\)/gi) || [];
  return uniqueParts.some(
    (u) => /view_key/i.test(u) && /color_name/i.test(u) && !/mockup_set/i.test(u)
  );
}

export function resetCatalogMockupImageSchemaReadyForTests() {
  catalogMockupSchemaReady = false;
}

async function ensureMockupSetColumn(db) {
  const res = await db.prepare(`PRAGMA table_info(product_mockup_images)`).all();
  const cols = new Set((res?.results || []).map((row) => row.name));
  if (!cols.has("mockup_set")) {
    await db
      .prepare(`ALTER TABLE product_mockup_images ADD COLUMN mockup_set TEXT NOT NULL DEFAULT 'clean'`)
      .run();
  }
}

async function rebuildMockupImagesUniqueWithSet(db) {
  await db
    .prepare(
      `CREATE TABLE product_mockup_images_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_key TEXT NOT NULL,
        print_provider_id INTEGER NOT NULL,
        printify_product_id TEXT NOT NULL,
        view_key TEXT NOT NULL,
        color_name TEXT NOT NULL,
        color_hex TEXT,
        image_url TEXT NOT NULL,
        printify_variant_ids TEXT,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        preview_template_ids_json TEXT,
        mockup_set TEXT NOT NULL DEFAULT 'clean',
        UNIQUE(product_key, print_provider_id, view_key, color_name, mockup_set)
      )`
    )
    .run();

  await db
    .prepare(
      `INSERT INTO product_mockup_images_new (
        id, product_key, print_provider_id, printify_product_id, view_key, color_name,
        color_hex, image_url, printify_variant_ids, is_default, created_at, preview_template_ids_json, mockup_set
      )
      SELECT
        id, product_key, print_provider_id, printify_product_id, view_key, color_name,
        color_hex, image_url, printify_variant_ids, is_default, created_at, preview_template_ids_json,
        COALESCE(NULLIF(TRIM(mockup_set), ''), 'clean')
      FROM product_mockup_images`
    )
    .run();

  await db.prepare(`DROP TABLE product_mockup_images`).run();
  await db.prepare(`ALTER TABLE product_mockup_images_new RENAME TO product_mockup_images`).run();

  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_product_mockup_images_product ON product_mockup_images(product_key)`)
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_product_mockup_images_view ON product_mockup_images(product_key, view_key)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_product_mockup_images_provider ON product_mockup_images(product_key, print_provider_id)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_product_mockup_images_set ON product_mockup_images(product_key, print_provider_id, mockup_set)`
    )
    .run();
}

/**
 * Ensure mockup_set column + UNIQUE(product_key, print_provider_id, view_key, color_name, mockup_set).
 * @param {any} db
 */
export async function ensureCatalogMockupImageSchema(db) {
  if (!db || catalogMockupSchemaReady) return;

  try {
    await ensureMockupSetColumn(db);

    const row = await db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='product_mockup_images'`)
      .first();
    if (tableSqlNeedsMockupSetUnique(row?.sql)) {
      console.log("[ensureCatalogMockupImageSchema] rebuilding product_mockup_images UNIQUE with mockup_set");
      await rebuildMockupImagesUniqueWithSet(db);
    }

    catalogMockupSchemaReady = true;
  } catch (err) {
    console.warn("[ensureCatalogMockupImageSchema]", err?.message || err);
    throw err;
  }
}

/** @param {Array<{ view_key?: string, color_name?: string }>} entries */
export function dedupeMockupEntriesByViewColor(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries || []) {
    const view = canonicalizeMockupViewKey(entry?.view_key || "other");
    const color = String(entry?.color_name || "Default").trim();
    const key = `${view}::${color}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, view_key: view });
  }
  return out;
}
