import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  PH_TYPES,
  DESIGN_TYPES_ALL,
  normalizePatProductVersionConfig,
  mergePatDisplayConfigFromTemplate,
  patVersionDesignTypesForAdminUi,
  unionPatPlaceholderPositions,
  mergeCatalogAndDbPrintDimensions,
  applyPublishBrandingSemanticsToSlotsByPosition,
  catalogVariantIds,
  normalizePatPositionKey,
} from "./provider-print-technical.js";

const EMPTY_PLACEHOLDER_SLOTS = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };

function versionTemplateRow(version) {
  return {
    product_version_config_json: version?.product_version_config ?? version?.product_version_config_json ?? null,
    print_areas_snapshot_json:
      version?.studio_config?.print_areas_snapshot ??
      version?.print_areas_snapshot ??
      version?.print_areas_snapshot_json ??
      null,
  };
}

function versionConfigForUi(version, positions) {
  const tpl = versionTemplateRow(version);
  const merged = mergePatDisplayConfigFromTemplate(tpl);
  const norm = normalizePatProductVersionConfig(version?.product_version_config ?? merged);
  const designTypes = patVersionDesignTypesForAdminUi(tpl, merged.design_types);
  const placeholdersByPosition = { ...(merged.placeholders_by_position || {}) };

  const cfg = {
    placeholders_by_position: { ...placeholdersByPosition },
    design_types: designTypes,
    use_main_source: norm.use_main_source,
    use_main_source_provider: norm.use_main_source_provider,
    is_print_settings_main_source: norm.is_print_settings_main_source,
  };

  for (const ph of positions) {
    const pos = String(ph.position || "")
      .trim()
      .toLowerCase();
    if (!pos) continue;
    if (!cfg.placeholders_by_position[pos]) {
      cfg.placeholders_by_position[pos] = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
    }
  }
  applyPublishBrandingSemanticsToSlotsByPosition(cfg.placeholders_by_position);
  return cfg;
}

function placeholderBadgesHtml(slots) {
  const parts = [];
  for (const pt of PH_TYPES) {
    const n = Number(slots?.[pt.key]) || 0;
    if (n > 0) parts.push(`<span class="ce-prov-pv-badge">${escapeHtml(pt.label)}${n > 1 ? ` ×${n}` : ""}</span>`);
  }
  return parts.length ? `<div class="ce-prov-pv-badges">${parts.join("")}</div>` : "";
}

/** Active provider version body: print positions, placeholder counts, design types. Main source UI lives on Print Area tab only. */
export function renderVersionConfigPanel(version, catalogDetail = {}) {
  const variants = catalogDetail.variants || [];
  const vpa = catalogDetail.variant_print_areas || [];
  const positions = unionPatPlaceholderPositions(variants, {});
  const cfg = versionConfigForUi(version, positions);
  positions.length = 0;
  positions.push(...unionPatPlaceholderPositions(variants, cfg.placeholders_by_position));

  const versionId = version?.id || version?._tempId || "";
  const haveDt = cfg.design_types.length > 0;

  const posCards = positions.length
    ? positions
        .map((ph) => {
          const pos = String(ph.position || "")
            .trim()
            .toLowerCase();
          if (!pos) return "";
          const dim = mergeCatalogAndDbPrintDimensions(ph, vpa, ph.position);
          const hVal = dim.h != null && Number.isFinite(dim.h) ? String(dim.h) : "";
          const wVal = dim.w != null && Number.isFinite(dim.w) ? String(dim.w) : "";
          const slots = cfg.placeholders_by_position[pos] || { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
          const pickRows = PH_TYPES.map((pt) => {
            const cur = Number(slots[pt.key]) || 0;
            const opts = Array.from({ length: 11 }, (_, q) => {
              const sel = q === cur ? " selected" : "";
              return `<option value="${q}"${sel}>${q}</option>`;
            }).join("");
            return `<span class="ce-prov-ph-row">
              <span class="ce-prov-ph-label">${escapeHtml(pt.label)}</span>
              <select class="input input-sm ce-prov-ph-qty" data-version-id="${escapeHtml(String(versionId))}" data-position="${escapeHtml(pos)}" data-ph-key="${escapeHtml(pt.key)}">${opts}</select>
            </span>`;
          }).join("");
          return `<div class="ce-prov-pos-card" data-position="${escapeHtml(pos)}">
            <code class="ce-prov-pos-code">${escapeHtml(ph.position || pos)}</code>
            <div class="ce-prov-pos-deco">${escapeHtml(ph.decoration_method || "")}</div>
            <div class="ce-prov-pos-dim" data-print-area-key="${escapeHtml(pos)}">
              <div class="ce-prov-pos-dim-row">
                <label class="ce-prov-pos-dim-field">
                  <span class="ce-prov-pos-dim-lab">Height</span>
                  <input type="number" min="1" step="1" class="input input-sm ce-prov-dim-h" inputmode="numeric" value="${escapeHtml(hVal)}" />
                </label>
                <span class="ce-prov-pos-dim-mul">×</span>
                <label class="ce-prov-pos-dim-field">
                  <span class="ce-prov-pos-dim-lab">Width</span>
                  <input type="number" min="1" step="1" class="input input-sm ce-prov-dim-w" inputmode="numeric" value="${escapeHtml(wVal)}" />
                </label>
              </div>
            </div>
            ${placeholderBadgesHtml(slots)}
            <div class="ce-prov-ph-pick">
              <span class="ce-prov-ph-pick-label">Placeholders</span>
              ${pickRows}
            </div>
          </div>`;
        })
        .join("")
    : `<p class="ce-hint">No placeholder positions in catalog response.</p>`;

  const dtGrid = DESIGN_TYPES_ALL.map((dt) => {
    const on = haveDt ? cfg.design_types.includes(dt) : true;
    const id = `ce-prov-dt-${String(versionId).replace(/[^a-z0-9_-]/gi, "")}-${dt.replace(/[^a-z0-9_-]/gi, "")}`;
    return `<label class="ce-prov-dt" for="${id}">
      <input type="checkbox" id="${id}" class="ce-prov-dt-cb" data-version-id="${escapeHtml(String(versionId))}" data-dt="${escapeHtml(dt)}"${on ? " checked" : ""} />
      ${escapeHtml(dt)}
    </label>`;
  }).join("");

  return `
    <div class="ce-prov-version-body" data-version-id="${escapeHtml(String(versionId))}">
      <section class="ce-prov-section">
        <div class="ce-prov-section-head">
          <h4 class="ce-prov-section-title">Design types</h4>
        </div>
        <p class="ce-hint">Which design types apply to this version. Leave all unchecked to use the product default (Meta).</p>
        <div class="ce-prov-dt-grid">${dtGrid}</div>
      </section>
      <section class="ce-prov-section">
        <div class="ce-prov-section-head">
          <h4 class="ce-prov-section-title">Print area positions</h4>
        </div>
        <div class="ce-prov-pos-grid">${posCards}</div>
      </section>
    </div>`;
}
/** Placeholder counts per view from provider version config (for print-area sidebar/overlays). */
export function getVersionPlaceholderConfig(version, catalogDetail = {}) {
  const variants = catalogDetail?.variants || catalogDetail?.variants_json || [];
  const variantList = Array.isArray(variants) ? variants : [];
  const positions = unionPatPlaceholderPositions(variantList, {});
  const cfg = versionConfigForUi(version, positions);
  return cfg.placeholders_by_position || {};
}

export function getPlaceholderSlotsForView(version, catalogDetail, viewKey) {
  const byPos = getVersionPlaceholderConfig(version, catalogDetail);
  const vk = String(viewKey || "front").trim().toLowerCase();
  const candidates = new Set([
    vk,
    vk.replace(/-/g, "_"),
    vk.replace(/_/g, "-"),
    normalizePatPositionKey(vk),
  ]);
  for (const key of candidates) {
    if (byPos[key]) return { ...EMPTY_PLACEHOLDER_SLOTS, ...byPos[key] };
  }
  const norm = normalizePatPositionKey(vk);
  for (const [k, slots] of Object.entries(byPos)) {
    if (normalizePatPositionKey(k) === norm) return { ...EMPTY_PLACEHOLDER_SLOTS, ...slots };
  }
  return { ...EMPTY_PLACEHOLDER_SLOTS };
}

function readStoredMainSourceFlags(prevConfig) {
  const norm = normalizePatProductVersionConfig(prevConfig);
  return {
    use_main_source: norm.use_main_source,
    use_main_source_provider: norm.use_main_source_provider,
    is_print_settings_main_source: norm.is_print_settings_main_source,
  };
}

export function collectVersionConfigPanel(root, prevConfig = null, versionId = null) {
  let wrap = root;
  if (versionId != null && root?.querySelectorAll) {
    // Prefer the version body panel — never a leaf control (name input / qty select) that also
    // carries data-version-id. Leaf wraps made querySelectorAll(".ce-prov-ph-qty") return empty
    // and wiped placeholders_by_position on Provider Save.
    const vid = String(versionId);
    wrap =
      [...root.querySelectorAll(".ce-prov-version-body")].find(
        (el) => String(el.getAttribute("data-version-id")) === vid
      ) ||
      root.querySelector(".ce-prov-version-pane") ||
      root;
  }
  if (!wrap) return normalizePatProductVersionConfig(prevConfig);

  const cfg = normalizePatProductVersionConfig(prevConfig);
  const byPos = {};

  const qtyEls = [...wrap.querySelectorAll(".ce-prov-ph-qty")].filter(
    (sel) => versionId == null || String(sel.dataset.versionId) === String(versionId)
  );
  qtyEls.forEach((sel) => {
    const pos = sel.dataset.position;
    const key = sel.dataset.phKey;
    if (!pos || !key) return;
    if (!byPos[pos]) byPos[pos] = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
    byPos[pos][key] = Math.min(99, Math.max(0, parseInt(sel.value, 10) || 0));
  });

  const designTypes = [];
  const dtEls = [...wrap.querySelectorAll(".ce-prov-dt-cb")].filter(
    (cb) => versionId == null || String(cb.dataset.versionId) === String(versionId)
  );
  dtEls.forEach((cb) => {
    if (cb.checked) designTypes.push(cb.dataset.dt);
  });

  // Only overwrite when the panel actually rendered controls — otherwise keep prev (avoids wipe).
  if (qtyEls.length) cfg.placeholders_by_position = byPos;
  if (dtEls.length) cfg.design_types = designTypes;
  Object.assign(cfg, readStoredMainSourceFlags(prevConfig));

  applyPublishBrandingSemanticsToSlotsByPosition(cfg.placeholders_by_position);

  return cfg;
}
export function collectPrintAreaDimensionUpdates(root, catalogDetail) {
  const variants = catalogDetail?.variants || [];
  const catIds = catalogVariantIds(variants);
  const updates = [];
  const wrap = root || document;

  wrap.querySelectorAll(".ce-prov-pos-card[data-position]").forEach((card) => {
    if (card.classList.contains("ce-prov-pos-card--inherited")) return;
    const printAreaKey = card.dataset.position;
    const h = Number(card.querySelector(".ce-prov-dim-h")?.value);
    const w = Number(card.querySelector(".ce-prov-dim-w")?.value);
    if (!printAreaKey || !Number.isFinite(h) || !Number.isFinite(w) || h < 1 || w < 1) return;
    updates.push({
      print_area_key: printAreaKey,
      printify_print_area_height: Math.round(h),
      printify_print_area_width: Math.round(w),
      catalog_variant_ids: catIds,
    });
  });
  return updates;
}
