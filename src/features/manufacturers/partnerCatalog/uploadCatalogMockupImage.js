/**
 * Admin Catalog Editor — upload a mockup image into product_mockup_images
 * (Shop Preview / Preview Images / Clean). Stored in MOCKUP_R2.
 */

import {
  MOCKUP_SET_CLEAN,
  MOCKUP_SET_PREVIEW_IMAGES,
  MOCKUP_SET_SHOP_PREVIEW,
  normalizeMockupSet,
  mockupSetSqlMatch,
} from "./mockupSet.js";
import { ensureCatalogMockupImageSchema } from "./ensureCatalogMockupImageSchema.js";
import { isCatalogOpsMasterWrite } from "./catalogOpsConfig.js";

const ALLOWED_SETS = new Set([
  MOCKUP_SET_CLEAN,
  MOCKUP_SET_SHOP_PREVIEW,
  MOCKUP_SET_PREVIEW_IMAGES,
]);
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_BYTES = 12 * 1024 * 1024;

function mockupPublicBase(env) {
  return String(env?.PUBLIC_FILE_BASE_URL || "https://creator-engine.eazpire.workers.dev").replace(/\/$/, "");
}

function extForMime(mime) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function slugPart(s, max = 40) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, max) || "x";
}

/**
 * @param {object} env
 * @param {Request} request — multipart form: file|image, product_key, mockup_set, view_key?, color_name?, print_provider_id?
 */
export async function uploadCatalogMockupImage(env, request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return { ok: false, error: "invalid_form_data" };

  const productKey = String(formData.get("product_key") || "").trim();
  if (!productKey) return { ok: false, error: "missing_product_key" };

  const mockupSet = normalizeMockupSet(formData.get("mockup_set") || MOCKUP_SET_SHOP_PREVIEW);
  if (!ALLOWED_SETS.has(mockupSet)) return { ok: false, error: "unsupported_mockup_set" };

  const file = formData.get("file") || formData.get("image");
  if (!file || !(file instanceof File)) return { ok: false, error: "missing_file" };

  let mime = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(mime)) return { ok: false, error: "unsupported_file_type" };

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: "file_too_large", max_bytes: MAX_BYTES };
  }

  if (!env?.MOCKUP_R2) return { ok: false, error: "storage_unavailable" };

  const viewKeyRaw = String(formData.get("view_key") || "").trim();
  const colorNameRaw = String(formData.get("color_name") || "").trim();
  const viewKey =
    viewKeyRaw ||
    (mockupSet === MOCKUP_SET_PREVIEW_IMAGES || mockupSet === MOCKUP_SET_SHOP_PREVIEW
      ? `upload_${Date.now().toString(36)}`
      : "front");
  const colorName = colorNameRaw || "Default";

  const ppRaw = formData.get("print_provider_id");
  let printProviderId = ppRaw != null && String(ppRaw).trim() !== "" ? Number(ppRaw) : NaN;
  if (!Number.isFinite(printProviderId)) printProviderId = 0;

  const ext = extForMime(mime);
  const setPart = mockupSet !== MOCKUP_SET_CLEAN ? `${mockupSet}/` : "";
  const r2Key = `mockups/${slugPart(productKey, 64)}/${setPart}mockup-images/${slugPart(viewKey, 24)}-${slugPart(colorName, 30)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await env.MOCKUP_R2.put(r2Key, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: {
      product_key: productKey,
      mockup_set: mockupSet,
      view_key: viewKey,
      color_name: colorName,
    },
  });

  const imageUrl = `${mockupPublicBase(env)}/mockup/${r2Key}`;
  const now = Date.now();

  const db = isCatalogOpsMasterWrite(env) ? env.CATALOG_DB : env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "database_unavailable" };

  if (isCatalogOpsMasterWrite(env)) {
    await ensureCatalogMockupImageSchema(db);
    const match = mockupSetSqlMatch(mockupSet);
    const existingCount = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM product_mockup_images
         WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`
      )
      .bind(productKey, printProviderId, match.bind)
      .first();
    const isDefault = Number(existingCount?.c || 0) === 0 ? 1 : 0;

    await db
      .prepare(
        `INSERT INTO product_mockup_images
          (product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
           image_url, printify_variant_ids, is_default, mockup_set, created_at)
         VALUES (?, ?, '', ?, ?, NULL, ?, NULL, ?, ?, ?)`
      )
      .bind(productKey, printProviderId, viewKey, colorName, imageUrl, isDefault, mockupSet, now)
      .run();

    const row = await db
      .prepare(
        `SELECT id, product_key, print_provider_id, view_key, color_name, color_hex, image_url,
                is_default, mockup_set, created_at
         FROM product_mockup_images
         WHERE product_key = ? AND print_provider_id = ? AND view_key = ? AND color_name = ?
           AND ${match.clause}
         ORDER BY rowid DESC LIMIT 1`
      )
      .bind(productKey, printProviderId, viewKey, colorName, match.bind)
      .first();

    return {
      ok: true,
      image_url: imageUrl,
      r2_key: r2Key,
      mockup_set: mockupSet,
      image: row || {
        id: null,
        product_key: productKey,
        print_provider_id: printProviderId,
        view_key: viewKey,
        color_name: colorName,
        image_url: imageUrl,
        is_default: isDefault,
        mockup_set: mockupSet,
      },
    };
  }

  // Manufacturer DB path (legacy mirror)
  const { newId } = await import("../db.js");
  const id = newId();
  const match = mockupSetSqlMatch(mockupSet);
  const existingCount = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM eazpire_product_mockup_images
       WHERE product_key = ? AND print_provider_id = ? AND ${match.clause}`
    )
    .bind(productKey, printProviderId, match.bind)
    .first()
    .catch(() => ({ c: 0 }));
  const isDefault = Number(existingCount?.c || 0) === 0 ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO eazpire_product_mockup_images
        (id, product_key, print_provider_id, printify_product_id, view_key, color_name, color_hex,
         image_url, printify_variant_ids, is_default, mockup_set, created_at)
       VALUES (?, ?, ?, '', ?, ?, NULL, ?, NULL, ?, ?, ?)`
    )
    .bind(id, productKey, printProviderId, viewKey, colorName, imageUrl, isDefault, mockupSet, now)
    .run();

  return {
    ok: true,
    image_url: imageUrl,
    r2_key: r2Key,
    mockup_set: mockupSet,
    image: {
      id,
      product_key: productKey,
      print_provider_id: printProviderId,
      view_key: viewKey,
      color_name: colorName,
      image_url: imageUrl,
      is_default: isDefault,
      mockup_set: mockupSet,
    },
  };
}

/**
 * Delete one catalog mockup image by id (+ mockup_set guard).
 */
export async function deleteCatalogMockupImage(env, { productKey, imageId, mockupSet }) {
  const pk = String(productKey || "").trim();
  const id = String(imageId || "").trim();
  if (!pk || !id) return { ok: false, error: "missing_product_key_or_id" };

  const set = normalizeMockupSet(mockupSet || MOCKUP_SET_SHOP_PREVIEW);
  const match = mockupSetSqlMatch(set);
  const db = isCatalogOpsMasterWrite(env) ? env.CATALOG_DB : env.MANUFACTURER_DB;
  if (!db) return { ok: false, error: "database_unavailable" };

  const table = isCatalogOpsMasterWrite(env) ? "product_mockup_images" : "eazpire_product_mockup_images";
  const row = await db
    .prepare(
      `SELECT id, image_url FROM ${table}
       WHERE product_key = ? AND id = ? AND ${match.clause} LIMIT 1`
    )
    .bind(pk, id, match.bind)
    .first();
  if (!row) return { ok: false, error: "not_found" };

  await db
    .prepare(`DELETE FROM ${table} WHERE product_key = ? AND id = ? AND ${match.clause}`)
    .bind(pk, id, match.bind)
    .run();

  return { ok: true, deleted: true, id };
}
