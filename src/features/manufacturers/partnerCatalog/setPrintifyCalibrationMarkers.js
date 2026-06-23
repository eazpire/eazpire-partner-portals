/**
 * Partner Templates: place solid-green Printify placeholder images per print area,
 * then regenerate mockups so calibration sync can detect print-area geometry.
 */

import { encode } from "fast-png";
import {
  getPrintifyProduct,
  putProductPrintAreasFullMerge,
  uploadImageToPrintifyFromBuffer,
  getPrintifyUploadedImage,
} from "../../../utils/printify.js";
import { getPrintifyShopId, getPrintifyApiKey } from "../../../utils/printifyEnv.js";
import { uniformContainPrintifyScale } from "../../../utils/printAreas.js";
import { sanitizeStudioPrintAreasForPrintifyApi } from "../../shop/studioPrintAreaPlacement.js";

export const PARTNER_CALIBRATION_PH_PREFIX = "partner-calibration-ph-fill";

export function isPartnerCalibrationPhFillImage(img) {
  if (!img) return false;
  const hint = `${img?.file_name || ""} ${img?.filename || ""} ${img?.name || ""}`.toLowerCase();
  return hint.includes(PARTNER_CALIBRATION_PH_PREFIX);
}

export function normPlaceholderPosition(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

/** Map mockup view_key → catalog print_area_key. */
export function viewKeyToPrintAreaKey(viewKey) {
  const v = normPlaceholderPosition(viewKey);
  if (!v || v === "other") return "front";
  if (v.includes("back")) return "back";
  if (v.includes("front") || v === "right" || v === "left") return "front";
  if (v.includes("neck")) return "neck";
  if (v.includes("sleeve")) return v.includes("left") ? "left_sleeve" : "right_sleeve";
  return v;
}

export function createSolidGreenPngBuffer(width, height) {
  const w = Math.max(1, Math.min(8000, Math.round(Number(width) || 1)));
  const h = Math.max(1, Math.min(8000, Math.round(Number(height) || 1)));
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 0;
    data[i * 4 + 1] = 220;
    data[i * 4 + 2] = 80;
    data[i * 4 + 3] = 255;
  }
  const pngBytes = encode({ width: w, height: h, data, depth: 8, channels: 4 });
  return pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength);
}

function isTextOnlyPlaceholder(ph) {
  const imgs = Array.isArray(ph?.images) ? ph.images : [];
  if (!imgs.length) return false;
  return imgs.every((im) => String(im?.type || "").toLowerCase().includes("text"));
}

/**
 * Collect placeholder positions that should receive a green calibration image.
 * @param {any[]} printAreas
 * @returns {Map<string, { width: number, height: number }>}
 */
export function collectCalibrationPlaceholderTargets(printAreas) {
  const out = new Map();
  for (const area of printAreas || []) {
    for (const ph of area?.placeholders || []) {
      if (!ph || typeof ph !== "object") continue;
      if (isTextOnlyPlaceholder(ph)) continue;
      const pos = normPlaceholderPosition(ph.position);
      if (!pos) continue;
      const w = Number(ph.width);
      const h = Number(ph.height);
      if (!(w > 0 && h > 0)) continue;
      if (!out.has(pos)) out.set(pos, { width: w, height: h });
    }
  }
  return out;
}

/**
 * Strip every placeholder image, then set only the green calibration marker per target position.
 * @param {any[]} printAreas
 * @param {Map<string, string>} uploadIdByPosition
 * @param {Map<string, number>} scaleByPosition
 */
export function applyCalibrationGreenToPrintAreas(printAreas, uploadIdByPosition, scaleByPosition) {
  const clone = JSON.parse(JSON.stringify(Array.isArray(printAreas) ? printAreas : []));
  for (const area of clone) {
    for (const ph of area?.placeholders || []) {
      if (!ph || typeof ph !== "object") continue;
      const pos = normPlaceholderPosition(ph.position);
      const uploadId = uploadIdByPosition.get(pos);

      if (!uploadId) {
        ph.images = [];
        continue;
      }

      const scale = scaleByPosition.get(pos) ?? 1;
      ph.images = [
        {
          id: uploadId,
          x: "0.5",
          y: "0.5",
          scale: String(Math.min(1e3, Math.max(1e-6, Number(scale) || 1)).toFixed(6)),
          angle: 0,
        },
      ];
    }
  }
  return clone;
}

async function waitForPrintifyUploadReady(env, uploadId) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const meta = await getPrintifyUploadedImage(env, uploadId);
      if (meta && (meta.preview_url || meta.previewUrl)) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120 + attempt * 40));
  }
  return false;
}

async function triggerPrintifyMockupGenerate(env, productId) {
  const shopId = getPrintifyShopId(env);
  const key = getPrintifyApiKey(env);
  if (!shopId || !key || !productId) return false;
  try {
    const r = await fetch(
      `https://api.printify.com/v1/shops/${shopId}/products/${encodeURIComponent(String(productId))}/mockups/generate.json`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      }
    );
    return r.ok || r.status === 202;
  } catch {
    return false;
  }
}

async function waitForPrintifyMockupRefresh(env, productId, previousImageCount, maxMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const p = await getPrintifyProduct(env, productId);
    const images = Array.isArray(p?.images) ? p.images : [];
    if (images.length > 0 && images.some((im) => im?.src)) {
      if (previousImageCount === 0 || images.length >= previousImageCount) return p;
    }
  }
  return getPrintifyProduct(env, productId);
}

/**
 * @param {any} env
 * @param {{ productKey?: string, printifyProductId: string }} opts
 */
export async function setPrintifyCalibrationMarkersOnProduct(env, opts) {
  const printifyProductId = String(opts?.printifyProductId || "").trim();
  if (!printifyProductId) return { ok: false, error: "printify_product_id_required" };
  if (!env?.PRINTIFY_API_KEY) return { ok: false, error: "printify_api_unavailable" };

  const product = await getPrintifyProduct(env, printifyProductId);
  if (!product) return { ok: false, error: "printify_product_not_found" };

  const printAreas = Array.isArray(product.print_areas) ? product.print_areas : [];
  const targets = collectCalibrationPlaceholderTargets(printAreas);
  if (!targets.size) {
    return {
      ok: false,
      error: "no_print_area_placeholders",
      message: "Printify product has no placeholders with width/height.",
    };
  }

  const uploadIdByPosition = new Map();
  const scaleByPosition = new Map();
  const applied = [];

  for (const [pos, dims] of targets.entries()) {
    const buf = createSolidGreenPngBuffer(dims.width, dims.height);
    const fileName = `${PARTNER_CALIBRATION_PH_PREFIX}-${pos}-${dims.width}x${dims.height}.png`;
    const up = await uploadImageToPrintifyFromBuffer(env, buf, fileName, "image/png", null);
    const uploadId = up?.id != null ? String(up.id) : "";
    if (!uploadId) {
      return { ok: false, error: "printify_upload_failed", position: pos };
    }
    await waitForPrintifyUploadReady(env, uploadId);
    const scale = uniformContainPrintifyScale(dims.width, dims.height, dims.width, dims.height);
    uploadIdByPosition.set(pos, uploadId);
    scaleByPosition.set(pos, scale);
    applied.push({ position: pos, width: dims.width, height: dims.height, upload_id: uploadId, scale });
  }

  const merged = applyCalibrationGreenToPrintAreas(printAreas, uploadIdByPosition, scaleByPosition);
  const sanitized = sanitizeStudioPrintAreasForPrintifyApi(merged);
  const prevImageCount = Array.isArray(product.images) ? product.images.length : 0;

  await putProductPrintAreasFullMerge(env, printifyProductId, sanitized);
  await triggerPrintifyMockupGenerate(env, printifyProductId);
  const refreshed = await waitForPrintifyMockupRefresh(env, printifyProductId, prevImageCount);

  return {
    ok: true,
    printify_product_id: printifyProductId,
    placements_applied: applied,
    mockup_count: Array.isArray(refreshed?.images) ? refreshed.images.length : 0,
  };
}
