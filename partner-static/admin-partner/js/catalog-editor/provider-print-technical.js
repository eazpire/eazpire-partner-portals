/**
 * Print area / PAT helpers for partner catalog editor Provider tab.
 * ES module port of theme/assets/admin-provider-print-technical.js (subset).
 */

import { escapeHtml } from "/partner/shared/js/partner-api.js";

export const PH_TYPES = [
  { key: "qr", label: "QR" },
  { key: "logo", label: "Logo" },
  { key: "creator_design", label: "Creator Design" },
  { key: "additional_design", label: "Additional Design" },
];

export const DESIGN_TYPES_ALL = ["classic", "pattern", "all-over", "full-coverage", "panorama"];

const PAT_PH_KEYS = ["qr", "logo", "creator_design", "additional_design"];
const PAT_DT_KEYS = { classic: 1, pattern: 1, "all-over": 1, "full-coverage": 1, panorama: 1 };

export function placeholdersFromFirstVariant(variants) {
  if (!variants?.length) return [];
  for (const v of variants) {
    if (v?.is_enabled === false) continue;
    const phs = v?.placeholders;
    if (Array.isArray(phs) && phs.length) return phs.slice();
  }
  for (const v of variants) {
    const phs = v?.placeholders;
    if (Array.isArray(phs) && phs.length) return phs.slice();
  }
  return [];
}

export function mergeCatalogAndDbPrintDimensions(ph, variantPrintAreas, position) {
  const pk = String(position || "")
    .trim()
    .toLowerCase();
  let w0 = null;
  let h0 = null;
  if (Array.isArray(variantPrintAreas)) {
    for (const r of variantPrintAreas) {
      const rpk = String(r?.print_area_key || "")
        .trim()
        .toLowerCase();
      if (rpk !== pk) continue;
      const rw = Number(r.printify_print_area_width);
      const rh = Number(r.printify_print_area_height);
      if (rw > 0 && rh > 0) {
        w0 = Math.round(rw);
        h0 = Math.round(rh);
        break;
      }
    }
  }
  if (w0 == null || h0 == null) {
    const cw = ph?.width != null ? Number(ph.width) : NaN;
    const ch = ph?.height != null ? Number(ph.height) : NaN;
    if (Number.isFinite(cw) && cw > 0) w0 = Math.round(cw);
    if (Number.isFinite(ch) && ch > 0) h0 = Math.round(ch);
  }
  return { w: w0, h: h0 };
}

function readNumericPlaceholderSlot(slotMap, ph) {
  if (!slotMap || typeof slotMap !== "object") return NaN;
  const n = Number(slotMap[ph]);
  if (Number.isFinite(n)) return n;
  for (const k of Object.keys(slotMap)) {
    if (String(k).trim().toLowerCase() === ph) {
      const v = Number(slotMap[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return NaN;
}

function normalizeDesignTypeToken(dt) {
  const k0 = String(dt || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
  const alias = {
    klassisch: "classic",
    muster: "pattern",
    vollabdeckung: "full-coverage",
    "voll-abdeckung": "full-coverage",
    allover: "all-over",
    fullcoverage: "full-coverage",
  };
  let k = alias[k0] || k0;
  k = k.replace(/all_over|allover/g, "all-over").replace(/full_coverage|fullcoverage/g, "full-coverage");
  return k;
}

export function normalizePatProductVersionConfig(raw) {
  const out = { placeholders_by_position: {}, design_types: [] };
  let obj = raw;
  if (obj == null || obj === "") return out;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return out;
    }
  }
  if (!obj || typeof obj !== "object") return out;

  const byPos = obj.placeholders_by_position;
  if (byPos && typeof byPos === "object") {
    for (const pos of Object.keys(byPos)) {
      const pk = String(pos || "")
        .trim()
        .toLowerCase();
      if (!pk) continue;
      out.placeholders_by_position[pk] = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
      const slotMap = byPos[pos];
      if (!slotMap || typeof slotMap !== "object") continue;
      for (const ph of PAT_PH_KEYS) {
        const n = readNumericPlaceholderSlot(slotMap, ph);
        out.placeholders_by_position[pk][ph] = Number.isFinite(n) ? Math.max(0, Math.min(99, Math.floor(n))) : 0;
      }
    }
  }

  if (Array.isArray(obj.design_types)) {
    for (const dt of obj.design_types) {
      const k = normalizeDesignTypeToken(dt);
      if (k && PAT_DT_KEYS[k] && !out.design_types.includes(k)) out.design_types.push(k);
    }
  }
  return out;
}

function emptyPatSlot() {
  return { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
}

function isBrandingOnlyPatPosition(pos) {
  const p = String(pos || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (p.includes("neck")) return true;
  return ["left_sleeve", "right_sleeve", "sleeve_left", "sleeve_right", "left", "right"].includes(p);
}

export function applyPublishBrandingSemanticsToSlotsByPosition(map) {
  if (!map || typeof map !== "object") return;
  for (const pos of Object.keys(map)) {
    if (!isBrandingOnlyPatPosition(pos)) continue;
    const s = map[pos];
    if (!s || typeof s !== "object") continue;
    s.creator_design = 0;
    s.additional_design = 0;
  }
}

export function unionPatPlaceholderPositions(variants, placeholdersByPosition) {
  const catalog = placeholdersFromFirstVariant(variants);
  const seen = new Set();
  const out = [];
  for (const ph of catalog) {
    const pos = String(ph?.position ?? "")
      .trim()
      .toLowerCase();
    if (!pos) continue;
    seen.add(pos);
    out.push(ph);
  }
  if (placeholdersByPosition && typeof placeholdersByPosition === "object") {
    for (const k of Object.keys(placeholdersByPosition)) {
      const pos = String(k || "")
        .trim()
        .toLowerCase();
      if (!pos || seen.has(pos)) continue;
      seen.add(pos);
      out.push({ position: pos, decoration_method: "", width: null, height: null });
    }
  }
  return out;
}

export function catalogVariantIds(variants) {
  return (variants || [])
    .map((v) => (v?.id != null ? Number(v.id) : NaN))
    .filter((x) => Number.isFinite(x) && x > 0);
}

/** Read-only print areas for inactive providers (matches old admin placeholder cards). */
export function renderInactivePrintAreasHtml(
  variants,
  { variantPrintAreas = [], title = "Print area positions" } = {}
) {
  const list = placeholdersFromFirstVariant(variants);
  if (!list.length) {
    if (!variants?.length) {
      return `<p class="ce-hint">Could not load print area data from Printify catalog for this provider.</p>`;
    }
    return `<p class="ce-hint">No print area positions in catalog response.</p>`;
  }
  const cards = list
    .map((ph) => {
      const pos = ph.position || "";
      const dim = mergeCatalogAndDbPrintDimensions(ph, variantPrintAreas, pos);
      const hVal = dim.h != null && Number.isFinite(dim.h) ? String(dim.h) : ph.height != null ? String(ph.height) : "?";
      const wVal = dim.w != null && Number.isFinite(dim.w) ? String(dim.w) : ph.width != null ? String(ph.width) : "?";
      const deco = ph.decoration_method || "—";
      return `<div class="ce-prov-pos-card ce-prov-pos-card--readonly">
        <code class="ce-prov-pos-code">${escapeHtml(String(pos))}</code>
        <div class="ce-prov-pos-deco">${escapeHtml(String(deco))}</div>
        <div class="ce-prov-pos-dim-read">
          <span class="ce-prov-pos-dim-lab">Height</span> ${escapeHtml(hVal)}
          <span class="ce-prov-pos-dim-mul">×</span>
          <span class="ce-prov-pos-dim-lab">Width</span> ${escapeHtml(wVal)}
        </div>
      </div>`;
    })
    .join("");
  return `<section class="ce-prov-section">
    <h4 class="ce-prov-section-title">${escapeHtml(title)}</h4>
    <div class="ce-prov-pos-grid">${cards}</div>
  </section>`;
}
