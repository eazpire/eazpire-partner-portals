/**
 * After calibration mockup sync: detect green print-area markers on mock images → catalog DB.
 */

import { detectPrintAreaFromImageBuffer, fracFromRect } from "../../../render/greenMarkerPrintArea.js";
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
 * @param {{ positions?: string[]|null }} [opts] - when set, only detect these print-area keys
 */
export async function persistCalibrationRectsFromMockupEntries(env, productKey, entries, opts = {}) {
  if (!productKey || !entries?.length) {
    return { ok: true, detected: [], skipped: entries?.length || 0 };
  }

  const allow = Array.isArray(opts?.positions) && opts.positions.length
    ? new Set(
        opts.positions
          .map((p) => viewKeyToPrintAreaKey(String(p || "").trim().toLowerCase()))
          .filter(Boolean)
      )
    : null;

  // One image per print-area key (not raw view_key) so back/back_* collapse together.
  const byPrintArea = new Map();
  for (const entry of entries) {
    const view = String(entry?.view_key || "front").trim().toLowerCase();
    const printAreaKey = viewKeyToPrintAreaKey(view);
    if (allow && !allow.has(printAreaKey)) continue;
    if (!byPrintArea.has(printAreaKey)) {
      byPrintArea.set(printAreaKey, { viewKey: view, entry });
    }
  }

  if (!byPrintArea.size) {
    return {
      ok: false,
      detected: [],
      errors: [{ error: "no_matching_views_for_detection", selected_positions: allow ? [...allow] : undefined }],
      detected_count: 0,
      error_count: 1,
    };
  }

  const detected = [];
  const errors = [];

  for (const [printAreaKey, { viewKey, entry }] of byPrintArea.entries()) {
    const url = String(entry?.image_url || "").trim();
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push({ view_key: viewKey, print_area_key: printAreaKey, error: `fetch_${res.status}` });
        continue;
      }
      const buf = await res.arrayBuffer();
      // Match partner editor: JPEG mocks + loose green-only detection.
      let hit;
      try {
        hit = await detectPrintAreaFromImageBuffer(buf, { loose: true, greenOnly: true });
      } catch (decodeErr) {
        const msg = String(decodeErr?.message || decodeErr);
        errors.push({
          view_key: viewKey,
          print_area_key: printAreaKey,
          error: msg === "unsupported_image_type" ? "unsupported_image_type" : `decode_failed:${msg}`,
        });
        continue;
      }
      if (!hit?.rect) {
        errors.push({ view_key: viewKey, print_area_key: printAreaKey, error: "green_marker_not_found" });
        continue;
      }
      const frac = hit.frac || fracFromRect(hit.rect);
      if (!frac) {
        errors.push({ view_key: viewKey, print_area_key: printAreaKey, error: "invalid_frac" });
        continue;
      }
      const rect = { x: frac.l, y: frac.t, w: frac.w, h: frac.h };

      if (isCatalogOpsMasterWrite(env)) {
        await upsertCatalogMockupDefault(env, productKey, printAreaKey, {
          mockup_print_area_rect_json: rect,
          print_area_rect_json: rect,
        });
      } else {
        const db = env.MANUFACTURER_DB;
        if (!db) {
          errors.push({ view_key: viewKey, print_area_key: printAreaKey, error: "manufacturer_db_unavailable" });
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
      errors.push({ view_key: viewKey, print_area_key: printAreaKey, error: String(e?.message || e) });
    }
  }

  return {
    ok: detected.length > 0 || errors.length === 0,
    detected,
    errors: errors.length ? errors : undefined,
    detected_count: detected.length,
    error_count: errors.length,
  };
}
