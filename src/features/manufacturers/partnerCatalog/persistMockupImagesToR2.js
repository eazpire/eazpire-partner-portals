/**
 * Download Printify mockup URLs into MOCKUP_R2 and return stable worker URLs.
 * Used by partner catalog sync so publish/shop do not depend on Printify CDN.
 */

import { imageBufferToWebp } from "../../../utils/imageBufferToWebp.js";

function mockupPublicBase(env) {
  return String(env?.PUBLIC_FILE_BASE_URL || "https://creator-engine.eazpire.workers.dev").replace(/\/$/, "");
}

/**
 * @param {any} env
 * @param {string} productKey
 * @param {{ view_key: string, color_name: string, image_url: string, mockup_set?: string }} entry
 * @returns {Promise<string>} persisted image URL (or original on failure)
 */
export async function persistMockupImageUrlToR2(env, productKey, entry) {
  const sourceUrl = String(entry?.image_url || "").trim();
  if (!sourceUrl || !env?.MOCKUP_R2 || !productKey) return sourceUrl;

  if (sourceUrl.includes("/mockup/") && sourceUrl.includes(mockupPublicBase(env))) {
    return sourceUrl;
  }

  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return sourceUrl;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    let buffer = new Uint8Array(await res.arrayBuffer());
    let ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    try {
      buffer = await imageBufferToWebp(buffer, { quality: 82, mimeHint: contentType });
      ext = "webp";
    } catch {
      /* keep original format */
    }
    const setPart = entry.mockup_set && entry.mockup_set !== "clean" ? `${entry.mockup_set}/` : "";
    const colorSafe = String(entry.color_name || "default")
      .replace(/[^a-z0-9_-]/gi, "-")
      .slice(0, 30);
    const viewSafe = String(entry.view_key || "view")
      .replace(/[^a-z0-9_-]/gi, "-")
      .slice(0, 24);
    const r2Key = `mockups/${productKey}/${setPart}mockup-images/${viewSafe}-${colorSafe}-${Date.now()}.${ext}`;
    await env.MOCKUP_R2.put(r2Key, buffer, {
      httpMetadata: { contentType: ext === "webp" ? "image/webp" : contentType },
    });
    return `${mockupPublicBase(env)}/mockup/${encodeURIComponent(r2Key)}`;
  } catch (err) {
    console.warn("[persistMockupImageUrlToR2] failed:", productKey, entry?.view_key, err?.message || err);
    return sourceUrl;
  }
}

/**
 * @param {any} env
 * @param {string} productKey
 * @param {Array<{ view_key: string, color_name: string, image_url: string, mockup_set?: string }>} entries
 */
export async function persistMockupEntriesToR2(env, productKey, entries, mockupSet = "clean") {
  const out = [];
  for (const entry of entries || []) {
    const image_url = await persistMockupImageUrlToR2(env, productKey, {
      ...entry,
      mockup_set: mockupSet,
    });
    out.push({ ...entry, image_url });
  }
  return out;
}
