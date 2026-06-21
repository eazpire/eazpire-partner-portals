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

/** Per-category inherit toggles for Print Area sidebar (non-main providers). */
export const MAIN_SOURCE_CATEGORY_KEYS = [
  "scope",
  "pattern",
  "brand_assets",
  "print_area_images",
  "placement",
];

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
  let w0 = null;
  let h0 = null;
  if (Array.isArray(variantPrintAreas)) {
    const pkNorm = normalizePatPositionKey(position);
    for (const r of variantPrintAreas) {
      if (normalizePatPositionKey(r?.print_area_key) !== pkNorm) continue;
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
  let n = Number(slotMap[ph]);
  if (Number.isFinite(n)) return n;
  for (const k of Object.keys(slotMap)) {
    if (String(k).trim().toLowerCase() === ph) {
      n = Number(slotMap[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  const up = ph.toUpperCase();
  if (slotMap[up] != null) {
    n = Number(slotMap[up]);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function mapPlaceholderNameToPatKey(nm) {
  if (nm == null || nm === "") return null;
  const s = String(nm)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (s === "qr" || s === "qrcode") return "qr";
  if (s === "logo") return "logo";
  if (s === "creator_design" || s === "creator" || s === "schoepferdesign" || s === "schöpferdesign" || s === "schopferdesign") {
    return "creator_design";
  }
  if (s.includes("additional") || s.includes("zusatz")) return "additional_design";
  return null;
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

export function defaultUseMainSourceCategories() {
  return {
    scope: false,
    pattern: false,
    brand_assets: false,
    print_area_images: false,
    placement: false,
  };
}

export function normalizeUseMainSourceCategories(raw) {
  const out = defaultUseMainSourceCategories();
  if (!raw || typeof raw !== "object") return out;
  for (const key of MAIN_SOURCE_CATEGORY_KEYS) {
    out[key] = raw[key] === true;
  }
  return out;
}

export function findPrintSettingsMainSource(allVersions = []) {
  for (const v of allVersions || []) {
    const cfg = v?.product_version_config;
    if (cfg && typeof cfg === "object" && cfg.is_print_settings_main_source === true) {
      const pid = Number(v.external_provider_id ?? v.print_provider_id);
      return {
        print_provider_id: Number.isFinite(pid) ? pid : null,
        version_id: v.id || v._tempId || null,
        version: v,
      };
    }
  }
  return null;
}

export function resolveMainSourceVersion(allVersions = [], mainSourceRef = null) {
  if (mainSourceRef?.version) return mainSourceRef.version;
  const vid = mainSourceRef?.version_id;
  const pid = mainSourceRef?.print_provider_id != null ? Number(mainSourceRef.print_provider_id) : null;
  if (vid != null) {
    const byId = (allVersions || []).find((v) => String(v.id || v._tempId) === String(vid));
    if (byId) return byId;
  }
  if (Number.isFinite(pid)) {
    const std = (allVersions || []).find(
      (v) => Number(v.external_provider_id ?? v.print_provider_id) === pid && (v.sort_order ?? 0) === 0
    );
    if (std) return std;
    return (allVersions || []).find((v) => Number(v.external_provider_id ?? v.print_provider_id) === pid) || null;
  }
  return findPrintSettingsMainSource(allVersions)?.version || null;
}

export function normalizePatProductVersionConfig(raw) {
  const out = {
    placeholders_by_position: {},
    design_types: [],
    use_main_source: defaultUseMainSourceCategories(),
    use_main_source_provider: false,
    is_print_settings_main_source: false,
  };
  let obj = raw;
  if (obj == null || obj === "") return out;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return out;
    }
  }
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
      const slotOut = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
      const slotMap = byPos[pos];
      if (Array.isArray(slotMap)) {
        for (const p of slotMap) {
          const nm = p && (p.name != null ? p.name : p.type != null ? p.type : p.placeholder_type != null ? p.placeholder_type : "");
          const key = mapPlaceholderNameToPatKey(nm);
          if (key) slotOut[key] = Math.min(99, slotOut[key] + 1);
        }
        out.placeholders_by_position[pk] = slotOut;
        continue;
      }
      if (!slotMap || typeof slotMap !== "object") continue;
      for (const ph of PAT_PH_KEYS) {
        const n = readNumericPlaceholderSlot(slotMap, ph);
        slotOut[ph] = Number.isFinite(n) ? Math.max(0, Math.min(99, Math.floor(n))) : 0;
      }
      out.placeholders_by_position[pk] = slotOut;
    }
  }

  if (Array.isArray(obj.design_types)) {
    for (const dt of obj.design_types) {
      const k = normalizeDesignTypeToken(dt);
      if (k && PAT_DT_KEYS[k] && !out.design_types.includes(k)) out.design_types.push(k);
    }
  }

  out.use_main_source = normalizeUseMainSourceCategories(obj.use_main_source);
  out.use_main_source_provider = obj.use_main_source_provider === true;
  out.is_print_settings_main_source = obj.is_print_settings_main_source === true;
  return out;
}

function emptyPatSlot() {
  return { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
}

function maxPatSlot(a, b) {
  return {
    qr: Math.max(a.qr, b.qr),
    logo: Math.max(a.logo, b.logo),
    creator_design: Math.max(a.creator_design, b.creator_design),
    additional_design: Math.max(a.additional_design, b.additional_design),
  };
}

function patSlotHasAny(s) {
  return !!(s && (s.qr > 0 || s.logo > 0 || s.creator_design > 0 || s.additional_design > 0));
}

export function normalizePatPositionKey(k) {
  const s = String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (s === "sleeve_left" || s === "left_sleeve" || s === "left-sleeve") return "left_sleeve";
  if (s === "sleeve_right" || s === "right_sleeve" || s === "right-sleeve") return "right_sleeve";
  return s;
}

function countPatAreasToSlot(areas) {
  const c = emptyPatSlot();
  if (!Array.isArray(areas)) return c;
  let nonBrandIdx = 0;
  for (const a of areas) {
    const t = String(a?.type || "").toLowerCase();
    if (t === "qr") c.qr++;
    else if (t === "logo") c.logo++;
    else if (t === "creator_design") {
      c.creator_design++;
      nonBrandIdx++;
    } else if (t === "design") {
      if (nonBrandIdx === 0) c.creator_design++;
      else c.additional_design++;
      nonBrandIdx++;
    }
  }
  return c;
}

function countPatPlaceholderArrayToSlot(arr) {
  const c = emptyPatSlot();
  if (!Array.isArray(arr)) return c;
  let nonBrandIdx = 0;
  for (const p of arr) {
    const raw = p && (p.name != null ? p.name : p.type != null ? p.type : p.placeholder_type != null ? p.placeholder_type : "");
    const key = mapPlaceholderNameToPatKey(raw);
    if (key) {
      c[key]++;
      if (key === "creator_design" || key === "additional_design") nonBrandIdx++;
      continue;
    }
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (s === "design" || s === "") {
      if (nonBrandIdx === 0) c.creator_design++;
      else c.additional_design++;
      nonBrandIdx++;
    }
  }
  return c;
}

function mergePatPhMapIntoAcc(acc, phMap) {
  if (!phMap || typeof phMap !== "object") return false;
  let touched = false;
  for (const pk of Object.keys(phMap)) {
    const pos = normalizePatPositionKey(pk);
    if (!pos) continue;
    const slot = countPatPlaceholderArrayToSlot(phMap[pk]);
    if (patSlotHasAny(slot)) touched = true;
    if (!acc[pos]) acc[pos] = emptyPatSlot();
    acc[pos] = maxPatSlot(acc[pos], slot);
  }
  return touched;
}

function parseJsonLoose(raw) {
  let snap = raw;
  if (snap == null || snap === "") return null;
  if (typeof snap === "string") {
    try {
      snap = JSON.parse(snap);
    } catch {
      return null;
    }
  }
  if (typeof snap === "string") {
    try {
      snap = JSON.parse(snap);
    } catch {
      return null;
    }
  }
  return snap && typeof snap === "object" ? snap : null;
}

/** Derive placeholders + design types from print_areas_snapshot_json (same as old admin). */
export function derivePatProductVersionConfigFromSnapshot(raw) {
  const outDt = [];
  const acc = {};
  const rememberDt = (dtRaw) => {
    const nk = normalizeDesignTypeToken(dtRaw);
    if (!nk || !PAT_DT_KEYS[nk]) return;
    if (!outDt.includes(nk)) outDt.push(nk);
  };
  const snap = parseJsonLoose(raw);
  if (!snap) return { placeholders_by_position: acc, design_types: outDt };

  const bdt = snap.by_design_type;
  if (bdt && typeof bdt === "object") {
    for (const dk of Object.keys(bdt)) {
      const slice = bdt[dk];
      if (!slice || typeof slice !== "object") continue;
      const nk = normalizeDesignTypeToken(dk);
      if (!PAT_DT_KEYS[nk]) continue;
      let any = false;
      if (slice.eaz_editor?.placeholders_by_position) {
        if (mergePatPhMapIntoAcc(acc, slice.eaz_editor.placeholders_by_position)) any = true;
      }
      for (const modeKey of ["mockup", "edit_mode"]) {
        const mode = slice[modeKey];
        if (!mode || typeof mode !== "object") continue;
        for (const viewKey of Object.keys(mode)) {
          const pos = normalizePatPositionKey(viewKey);
          if (!pos) continue;
          const node = mode[viewKey];
          const areas = node && Array.isArray(node.areas) ? node.areas : [];
          if (areas.length) any = true;
          const slot = countPatAreasToSlot(areas);
          if (!acc[pos]) acc[pos] = emptyPatSlot();
          acc[pos] = maxPatSlot(acc[pos], slot);
        }
      }
      if (any) rememberDt(dk);
    }
  }

  const ea = snap.eaz_admin;
  if (ea?.by_version && typeof ea.by_version === "object") {
    for (const ver of Object.keys(ea.by_version)) {
      const inner = ea.by_version[ver]?.by_design_type;
      if (!inner || typeof inner !== "object") continue;
      for (const dk of Object.keys(inner)) {
        const ed = inner[dk];
        const slot = ed?.eaz_editor;
        if (!slot || typeof slot !== "object") continue;
        rememberDt(dk);
        if (slot.placeholders_by_position) mergePatPhMapIntoAcc(acc, slot.placeholders_by_position);
      }
    }
  }
  if (ea?.enabled_design_types != null) {
    const edt = ea.enabled_design_types;
    if (Array.isArray(edt)) edt.forEach(rememberDt);
    else if (edt && typeof edt === "object") {
      for (const k of Object.keys(edt)) {
        if (edt[k]) rememberDt(k);
      }
    }
  }

  applyPublishBrandingSemanticsToSlotsByPosition(acc);
  return { placeholders_by_position: acc, design_types: outDt };
}

/** Merge snapshot-derived PAT layout with product_version_config_json (DB row). */
export function mergePatDisplayConfigFromTemplate(tpl) {
  const fromSnap = derivePatProductVersionConfigFromSnapshot(tpl?.print_areas_snapshot_json);
  const fromJson = normalizePatProductVersionConfig(tpl?.product_version_config_json);
  const merged = { placeholders_by_position: {}, design_types: [] };
  const seenPos = new Set();
  for (const pk of Object.keys(fromJson.placeholders_by_position || {})) seenPos.add(pk);
  for (const pk of Object.keys(fromSnap.placeholders_by_position || {})) seenPos.add(pk);
  for (const pos of seenPos) {
    const a = fromSnap.placeholders_by_position?.[pos] || emptyPatSlot();
    const b = fromJson.placeholders_by_position?.[pos] || emptyPatSlot();
    merged.placeholders_by_position[pos] = maxPatSlot(a, b);
  }
  const seenDt = new Set();
  for (const d of [...(fromJson.design_types || []), ...(fromSnap.design_types || [])]) {
    const k = normalizeDesignTypeToken(d);
    if (k && PAT_DT_KEYS[k] && !seenDt.has(k)) {
      seenDt.add(k);
      merged.design_types.push(k);
    }
  }
  applyPublishBrandingSemanticsToSlotsByPosition(merged.placeholders_by_position);
  return merged;
}

/** Checkbox state: explicit saved design_types win over snapshot union. */
export function patVersionDesignTypesForAdminUi(tpl, mergedDesignTypes) {
  const merged = Array.isArray(mergedDesignTypes) ? mergedDesignTypes.slice() : [];
  const raw = tpl?.product_version_config_json;
  if (raw == null || raw === "") return merged;
  const obj = parseJsonLoose(raw);
  if (!obj || typeof obj !== "object") return merged;
  if (!Object.prototype.hasOwnProperty.call(obj, "design_types")) return merged;
  const norm = normalizePatProductVersionConfig(obj);
  return Array.isArray(norm.design_types) ? norm.design_types.slice() : [];
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
