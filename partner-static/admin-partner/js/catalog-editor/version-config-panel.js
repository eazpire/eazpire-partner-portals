import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  PH_TYPES,
  DESIGN_TYPES_ALL,
  MAIN_SOURCE_CATEGORY_KEYS,
  normalizePatProductVersionConfig,
  normalizeUseMainSourceCategories,
  defaultUseMainSourceCategories,
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

function placeholdersFromVariants(variants) {
  if (!variants?.length) return [];
  const phs = variants[0].placeholders;
  return Array.isArray(phs) ? phs : [];
}

function versionConfigForUi(version, positions, { mainVersion = null, mainCatalogDetail = null } = {}) {
  const tpl = versionTemplateRow(version);
  const merged = mergePatDisplayConfigFromTemplate(tpl);
  const norm = normalizePatProductVersionConfig(version?.product_version_config ?? merged);
  const useMain = normalizeUseMainSourceCategories(norm.use_main_source);
  const isMainSource = norm.is_print_settings_main_source === true;

  let designTypes = patVersionDesignTypesForAdminUi(tpl, merged.design_types);
  let placeholdersByPosition = { ...(merged.placeholders_by_position || {}) };

  if (!isMainSource && mainVersion) {
    const mainTpl = versionTemplateRow(mainVersion);
    const mainMerged = mergePatDisplayConfigFromTemplate(mainTpl);
    const mainNorm = normalizePatProductVersionConfig(mainVersion?.product_version_config ?? mainMerged);
    const mainDesignTypes = patVersionDesignTypesForAdminUi(mainTpl, mainMerged.design_types);
    const mainPositions = unionPatPlaceholderPositions(
      placeholdersFromVariants(mainCatalogDetail?.variants || []),
      mainNorm.placeholders_by_position
    );
    const mainCfg = buildUiConfigFromParts(mainDesignTypes, mainNorm.placeholders_by_position, mainPositions);

    if (useMain.design_types) designTypes = mainCfg.design_types.slice();
    if (useMain.print_area_positions) {
      placeholdersByPosition = JSON.parse(JSON.stringify(mainCfg.placeholders_by_position));
    }
  }

  const cfg = {
    placeholders_by_position: { ...placeholdersByPosition },
    design_types: designTypes,
    use_main_source: useMain,
    is_print_settings_main_source: isMainSource,
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

function buildUiConfigFromParts(designTypes, placeholdersByPosition, positions) {
  const cfg = {
    placeholders_by_position: { ...(placeholdersByPosition || {}) },
    design_types: Array.isArray(designTypes) ? designTypes.slice() : [],
  };
  for (const ph of positions || []) {
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

function categoryInheritToggleHtml(versionId, categoryKey, checked, disabled, mainSourceLabel) {
  const hint = mainSourceLabel ? ` title="Inherit from ${escapeHtml(mainSourceLabel)}"` : "";
  return `<label class="ce-prov-inherit-toggle"${hint}>
    <input type="checkbox" class="ce-prov-use-main-cb" data-version-id="${escapeHtml(String(versionId))}" data-category="${escapeHtml(categoryKey)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""} />
    <span class="ce-prov-inherit-label">Use main source</span>
  </label>`;
}

function placeholderBadgesHtml(slots) {
  const parts = [];
  for (const pt of PH_TYPES) {
    const n = Number(slots?.[pt.key]) || 0;
    if (n > 0) parts.push(`<span class="ce-prov-pv-badge">${escapeHtml(pt.label)}${n > 1 ? ` ×${n}` : ""}</span>`);
  }
  return parts.length ? `<div class="ce-prov-pv-badges">${parts.join("")}</div>` : "";
}

/**
 * Active provider version body: print positions, placeholder counts, design types.
 * @param {object} [inheritCtx] — { mainVersion, mainSourceLabel, hasMainSource }
 */
export function renderVersionConfigPanel(version, catalogDetail = {}, inheritCtx = {}) {
  const variants = catalogDetail.variants || [];
  const vpa = catalogDetail.variant_print_areas || [];
  const positions = unionPatPlaceholderPositions(variants, {});
  const cfg = versionConfigForUi(version, positions, {
    mainVersion: inheritCtx.mainVersion || null,
    mainCatalogDetail: inheritCtx.mainCatalogDetail || catalogDetail,
  });
  positions.length = 0;
  positions.push(...unionPatPlaceholderPositions(variants, cfg.placeholders_by_position));

  const versionId = version?.id || version?._tempId || "";
  const haveDt = cfg.design_types.length > 0;
  const isMainSource = cfg.is_print_settings_main_source === true;
  const useMain = cfg.use_main_source;
  const hasMainSource = inheritCtx.hasMainSource !== false && !!inheritCtx.mainVersion;
  const inheritDisabled = !hasMainSource || isMainSource;
  const mainSourceLabel = inheritCtx.mainSourceLabel || "main source provider";

  const inheritDt = !isMainSource && useMain.design_types;
  const inheritPos = !isMainSource && useMain.print_area_positions;

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
          const ro = inheritPos ? " disabled readonly" : "";
          const pickRows = PH_TYPES.map((pt) => {
            const cur = Number(slots[pt.key]) || 0;
            const opts = Array.from({ length: 11 }, (_, q) => {
              const sel = q === cur ? " selected" : "";
              return `<option value="${q}"${sel}>${q}</option>`;
            }).join("");
            return `<span class="ce-prov-ph-row">
              <span class="ce-prov-ph-label">${escapeHtml(pt.label)}</span>
              <select class="input input-sm ce-prov-ph-qty" data-version-id="${escapeHtml(String(versionId))}" data-position="${escapeHtml(pos)}" data-ph-key="${escapeHtml(pt.key)}"${ro}>${opts}</select>
            </span>`;
          }).join("");
          return `<div class="ce-prov-pos-card${inheritPos ? " ce-prov-pos-card--inherited" : ""}" data-position="${escapeHtml(pos)}">
            <code class="ce-prov-pos-code">${escapeHtml(ph.position || pos)}</code>
            <div class="ce-prov-pos-deco">${escapeHtml(ph.decoration_method || "")}</div>
            <div class="ce-prov-pos-dim" data-print-area-key="${escapeHtml(pos)}">
              <div class="ce-prov-pos-dim-row">
                <label class="ce-prov-pos-dim-field">
                  <span class="ce-prov-pos-dim-lab">Height</span>
                  <input type="number" min="1" step="1" class="input input-sm ce-prov-dim-h" inputmode="numeric" value="${escapeHtml(hVal)}"${ro} />
                </label>
                <span class="ce-prov-pos-dim-mul">×</span>
                <label class="ce-prov-pos-dim-field">
                  <span class="ce-prov-pos-dim-lab">Width</span>
                  <input type="number" min="1" step="1" class="input input-sm ce-prov-dim-w" inputmode="numeric" value="${escapeHtml(wVal)}"${ro} />
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
    const ro = inheritDt ? " disabled" : "";
    return `<label class="ce-prov-dt${inheritDt ? " ce-prov-dt--inherited" : ""}" for="${id}">
      <input type="checkbox" id="${id}" class="ce-prov-dt-cb" data-version-id="${escapeHtml(String(versionId))}" data-dt="${escapeHtml(dt)}"${on ? " checked" : ""}${ro} />
      ${escapeHtml(dt)}
    </label>`;
  }).join("");

  const dtInheritToggle = isMainSource
    ? ""
    : categoryInheritToggleHtml(versionId, "design_types", useMain.design_types, inheritDisabled, mainSourceLabel);
  const posInheritToggle = isMainSource
    ? ""
    : categoryInheritToggleHtml(versionId, "print_area_positions", useMain.print_area_positions, inheritDisabled, mainSourceLabel);

  const inheritHint =
    !isMainSource && !hasMainSource
      ? `<p class="ce-hint ce-prov-inherit-hint">Mark another provider as main source to enable inheritance.</p>`
      : "";

  return `
    <div class="ce-prov-version-body" data-version-id="${escapeHtml(String(versionId))}">
      ${inheritHint}
      <section class="ce-prov-section${inheritDt ? " ce-prov-section--inherited" : ""}">
        <div class="ce-prov-section-head">
          <h4 class="ce-prov-section-title">Design types</h4>
          ${dtInheritToggle}
        </div>
        <p class="ce-hint">Which design types apply to this version. Leave all unchecked to use the product default (Meta).</p>
        <div class="ce-prov-dt-grid">${dtGrid}</div>
      </section>
      <section class="ce-prov-section${inheritPos ? " ce-prov-section--inherited" : ""}">
        <div class="ce-prov-section-head">
          <h4 class="ce-prov-section-title">Print area positions</h4>
          ${posInheritToggle}
        </div>
        <div class="ce-prov-pos-grid">${posCards}</div>
      </section>
    </div>`;
}

/** Placeholder counts per view from provider version config (for print-area sidebar/overlays). */
export function getVersionPlaceholderConfig(version, catalogDetail = {}) {
  const variants = catalogDetail?.variants || catalogDetail?.variants_json || [];
  const phs = placeholdersFromVariants(Array.isArray(variants) ? variants : []);
  const cfg = versionConfigForUi(version, phs);
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

function readCategoryInheritFlags(wrap, versionId) {
  const useMain = defaultUseMainSourceCategories();
  wrap.querySelectorAll(".ce-prov-use-main-cb").forEach((cb) => {
    if (versionId != null && String(cb.dataset.versionId) !== String(versionId)) return;
    const cat = cb.dataset.category;
    if (cat && MAIN_SOURCE_CATEGORY_KEYS.includes(cat)) useMain[cat] = cb.checked;
  });
  return useMain;
}

/** Merge inherited category values from main source version into collected config. */
export function applyMainSourceInheritanceToConfig(cfg, useMain, mainVersion, mainCatalogDetail = {}) {
  if (!mainVersion || !cfg) return cfg;
  const use = normalizeUseMainSourceCategories(useMain);
  const mainVariants = mainCatalogDetail?.variants || [];
  const mainPositions = unionPatPlaceholderPositions(mainVariants, {});
  const mainCfg = versionConfigForUi(mainVersion, mainPositions, {});

  if (use.design_types) cfg.design_types = mainCfg.design_types.slice();
  if (use.print_area_positions) {
    cfg.placeholders_by_position = JSON.parse(JSON.stringify(mainCfg.placeholders_by_position));
    applyPublishBrandingSemanticsToSlotsByPosition(cfg.placeholders_by_position);
  }
  return cfg;
}

export function collectVersionConfigPanel(root, prevConfig = null, versionId = null, inheritOpts = {}) {
  let wrap = root;
  if (versionId != null && root?.querySelectorAll) {
    for (const el of root.querySelectorAll("[data-version-id]")) {
      if (String(el.getAttribute("data-version-id")) === String(versionId)) {
        wrap = el;
        break;
      }
    }
  }
  if (!wrap) return normalizePatProductVersionConfig(prevConfig);

  const cfg = normalizePatProductVersionConfig(prevConfig);
  const byPos = {};

  wrap.querySelectorAll(".ce-prov-ph-qty").forEach((sel) => {
    if (versionId != null && String(sel.dataset.versionId) !== String(versionId)) return;
    const pos = sel.dataset.position;
    const key = sel.dataset.phKey;
    if (!pos || !key) return;
    if (!byPos[pos]) byPos[pos] = { qr: 0, logo: 0, creator_design: 0, additional_design: 0 };
    byPos[pos][key] = Math.min(99, Math.max(0, parseInt(sel.value, 10) || 0));
  });

  const designTypes = [];
  wrap.querySelectorAll(".ce-prov-dt-cb").forEach((cb) => {
    if (versionId != null && String(cb.dataset.versionId) !== String(versionId)) return;
    if (cb.checked) designTypes.push(cb.dataset.dt);
  });

  cfg.placeholders_by_position = byPos;
  cfg.design_types = designTypes;
  cfg.use_main_source = readCategoryInheritFlags(wrap, versionId);

  const mainCb = wrap.closest(".ce-prov-detail-active")?.querySelector(".ce-prov-main-source-cb");
  if (mainCb) cfg.is_print_settings_main_source = mainCb.checked;

  applyPublishBrandingSemanticsToSlotsByPosition(cfg.placeholders_by_position);

  if (inheritOpts.mainVersion) {
    applyMainSourceInheritanceToConfig(cfg, cfg.use_main_source, inheritOpts.mainVersion, inheritOpts.mainCatalogDetail);
  }

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
