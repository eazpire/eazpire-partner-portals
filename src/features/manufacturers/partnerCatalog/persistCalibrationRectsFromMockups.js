/**
 * After calibration mockup sync: detect green print-area markers on mock images → catalog DB.
 */

import { detectPrintAreaFromPngBuffer, fracFromRect } from "../../../render/greenMarkerPrintArea.js";
import { upsertCatalogMockupDefault } from "./catalogOpsWriteService.js";
import { viewKeyToPrintAreaKey } from "./setPrintifyCalibrationMarkers.js";
import { isCatalogOpsMasterWrite } from "./catalogOpsConfig.js";
import { newId } from "../db.js";

async function queryFirst(db, sql, ...binds) {
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} productKey
 * @param {Array<{ view_key?: string, image_url?: string, color_name?: string }>} entries
 */
export async function persistCalibrationRectsFromMockupEntries(env, productKey, entries) {
  if (!productKey || !entries?.length) {
    return { ok: true, detected: [], skipped: entries?.length || 0 };
  }

  const byView = new Map();
  for (const entry of entries) {
    const view = String(entry?.view_key || "front").trim().toLowerCase();
    if (!byView.has(view)) byView.set(view, entry);
  }

  const detected = [];
  const errors = [];

  for (const [viewKey, entry] of byView.entries()) {
    const url = String(entry?.image_url || "").trim();
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push({ view_key: viewKey, error: `fetch_${res.status}` });
        continue;
      }
      const buf = await res.arrayBuffer();
      const hit = await detectPrintAreaFromPngBuffer(buf);
      if (!hit?.rect) {
        errors.push({ view_key: viewKey, error: "green_marker_not_found" });
        continue;
      }
      const frac = hit.frac || fracFromRect(hit.rect);
      if (!frac) {
        errors.push({ view_key: viewKey, error: "invalid_frac" });
        continue;
      }
      const printAreaKey = viewKeyToPrintAreaKey(viewKey);
      const rect = { x: frac.l, y: frac.t, w: frac.w, h: frac.h };

      if (isCatalogOpsMasterWrite(env)) {
        await upsertCatalogMockupDefault(env, productKey, printAreaKey, {
          mockup_print_area_rect_json: rect,
          print_area_rect_json: rect,
        });
      } else {
        const db = env.MANUFACTURER_DB;
        if (!db) {
          errors.push({ view_key: viewKey, error: "manufacturer_db_unavailable" });
          continue;
        }
        const now = Date.now();
        const row = await queryFirst(
          db,
          `SELECT id FROM eazpire_product_mockup_defaults WHERE product_key = ? AND print_area_key = ?`,
          productKey,
          printAreaKey
        );
        const rectJson = JSON.stringify(rect);
        if (row?.id) {
          await db
            .prepare(
              `UPDATE eazpire_product_mockup_defaults SET
                print_area_rect_json = ?,
                mockup_print_area_rect_json = ?,
                updated_at = ?
               WHERE id = ?`
            )
            .bind(rectJson, rectJson, now, row.id)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO eazpire_product_mockup_defaults
                (id, product_key, print_area_key, print_area_rect_json, mockup_print_area_rect_json,
                 placement_x, placement_y, placement_scale, placement_angle, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0.5, 0.5, 1, 0, ?, ?)`
            )
            .bind(newId(), productKey, printAreaKey, rectJson, rectJson, now, now)
            .run();
        }
      }

      detected.push({
        view_key: viewKey,
        print_area_key: printAreaKey,
        marker: hit.marker || null,
        rect,
      });
    } catch (e) {
      errors.push({ view_key: viewKey, error: String(e?.message || e) });
    }
  }

  return {
    ok: detected.length > 0 || errors.length === 0,
    detected,
    errors: errors.length ? errors : undefined,
    detected_count: detected.length,
  };
}
