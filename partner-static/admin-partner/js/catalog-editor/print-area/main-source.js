import { escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  findPrintSettingsMainSource,
  resolveMainSourceVersion,
  normalizeUseMainSourceCategories,
  normalizePatProductVersionConfig,
  defaultUseMainSourceCategories,
  MAIN_SOURCE_CATEGORY_KEYS,
} from "../provider-print-technical.js";
import { providerLabel } from "../editor-subnav.js";
import {
  ensureByDesignTypeConfig,
  getDesignTypeSlice,
  defaultPatternConfig,
  defaultPublishLogicByPh,
  readPublishLogicFromConfig,
  normalizeDesignTypeKey,
  parseJsonSafe,
  readBrandAssetsFromConfig,
  resolvePrintAreaUseMockups,
} from "./helpers.js";

/** Sidebar section id → use_main_source key */
export const PA_MAIN_SOURCE_SECTIONS = [
  { key: "scope", label: "Scope" },
  { key: "pattern", label: "Pattern" },
  { key: "brand_assets", label: "Brand Assets" },
  { key: "print_area_images", label: "Print area images" },
  { key: "placement", label: "Placement" },
];

export function getPublishProfileConfigForProvider(ctx, printProviderId) {
  const pid = Number(printProviderId);
  const row = (ctx.bundle?.publish_profiles || []).find((p) => Number(p.print_provider_id) === pid);
  return parseJsonSafe(row?.print_areas_config_json, {}) || {};
}

export function versionsForProviderId(ctx, printProviderId) {
  const pid = String(printProviderId ?? "");
  return (ctx.bundle?.versions || [])
    .filter((v) => String(v.external_provider_id) === pid)
    .slice()
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
}

export function resolveProviderVersion(ctx, printProviderId, versionId = null) {
  const versions = versionsForProviderId(ctx, printProviderId);
  if (!versions.length) return null;
  if (versionId != null) {
    const match = versions.find((v) => String(v.id) === String(versionId));
    if (match) return match;
  }
  const selected =
    String(printProviderId) === String(ctx.selectedPrintProviderId) ? ctx.selectedVersionId : null;
  if (selected != null) {
    const match = versions.find((v) => String(v.id) === String(selected));
    if (match) return match;
  }
  return versions[0];
}

export function readMainSourceFlags(version) {
  const norm = normalizePatProductVersionConfig(version?.product_version_config);
  return {
    isMainSource: norm.is_print_settings_main_source === true,
    useMainSourceProvider: norm.use_main_source_provider === true,
    useMainSource: normalizeUseMainSourceCategories(norm.use_main_source),
  };
}

export function mergeVersionProductConfig(prev, patch) {
  const base = normalizePatProductVersionConfig(prev);
  const next = { ...base, ...patch };
  if (patch?.use_main_source) {
    next.use_main_source = { ...base.use_main_source, ...patch.use_main_source };
  }
  return next;
}

export function ensurePrintAreaVersionConfigEdits(ctx) {
  if (!ctx.printAreaVersionConfigEdits) ctx.printAreaVersionConfigEdits = new Map();
  return ctx.printAreaVersionConfigEdits;
}

export function getEffectiveVersionConfig(ctx, printProviderId, versionId = null) {
  const version = resolveProviderVersion(ctx, printProviderId, versionId);
  const editKey = version ? `${printProviderId}:${version.id || version._tempId}` : String(printProviderId);
  const edits = ensurePrintAreaVersionConfigEdits(ctx);
  if (version && edits.has(editKey)) return edits.get(editKey);
  return version?.product_version_config ?? null;
}

export function setProviderVersionConfig(ctx, printProviderId, productVersionConfig, versionId = null) {
  const version = resolveProviderVersion(ctx, printProviderId, versionId);
  if (!version) return;
  const editKey = `${printProviderId}:${version.id || version._tempId}`;
  ensurePrintAreaVersionConfigEdits(ctx).set(editKey, productVersionConfig);
  version.product_version_config = productVersionConfig;
}

export function patchProviderVersionConfig(ctx, printProviderId, patch, versionId = null) {
  const version = resolveProviderVersion(ctx, printProviderId, versionId);
  const prev = version?.product_version_config ?? getEffectiveVersionConfig(ctx, printProviderId);
  setProviderVersionConfig(ctx, printProviderId, mergeVersionProductConfig(prev, patch), versionId);
}

export function printAreaMainSourceContext(ctx, printProviderId = ctx.selectedPrintProviderId) {
  const allVersions = ctx.bundle?.versions || [];
  const mainRef = findPrintSettingsMainSource(allVersions);
  const mainVersion = resolveMainSourceVersion(allVersions, mainRef);
  const mainPid = mainRef?.print_provider_id;
  const mainSourceLabel = mainPid != null ? providerLabel(ctx, mainPid) : "main source provider";
  const isMainSource = mainPid != null && Number(printProviderId) === Number(mainPid);
  const version = resolveProviderVersion(ctx, printProviderId);
  const flags = readMainSourceFlags({ product_version_config: getEffectiveVersionConfig(ctx, printProviderId) });
  return {
    mainRef,
    mainVersion,
    mainPid,
    mainSourceLabel,
    hasMainSource: !!mainVersion,
    isMainSource,
    version,
    ...flags,
  };
}

export function renderPrintAreaProviderPill(ctx, pid) {
  const label = providerLabel(ctx, pid);
  const active = String(ctx.selectedPrintProviderId) === String(pid);
  const ms = printAreaMainSourceContext(ctx, pid);
  let toggleHtml = "";

  if (ms.isMainSource) {
    toggleHtml = `<label class="ce-pa-main-source-toggle" title="Main source for print area settings">
      <span class="ce-pa-main-source-label">main source</span>
      <input type="checkbox" class="ce-pa-main-source-cb" data-pid="${escapeHtml(String(pid))}" checked />
    </label>`;
  } else if (ms.hasMainSource) {
    const checked = ms.useMainSourceProvider ? " checked" : "";
    toggleHtml = `<label class="ce-pa-main-source-toggle" title="Inherit from ${escapeHtml(ms.mainSourceLabel)}">
      <span class="ce-pa-main-source-label">use main source</span>
      <input type="checkbox" class="ce-pa-use-main-provider-cb" data-pid="${escapeHtml(String(pid))}"${checked} />
    </label>`;
  } else {
    toggleHtml = `<label class="ce-pa-main-source-toggle">
      <span class="ce-pa-main-source-label">main source</span>
      <input type="checkbox" class="ce-pa-main-source-cb" data-pid="${escapeHtml(String(pid))}" />
    </label>`;
  }

  return `<div class="ce-provider-pill-group${active ? " ce-provider-pill-group--active" : ""}">
    <button type="button" class="ce-provider-pill ${active ? "active" : ""}" data-pid="${escapeHtml(String(pid))}">${escapeHtml(label)}</button>
    ${toggleHtml}
  </div>`;
}

function clearMainSourceFromOtherProviders(ctx, pid) {
  for (const v of ctx.bundle?.versions || []) {
    const vPid = Number(v.external_provider_id);
    if (!Number.isFinite(vPid) || Number(vPid) === Number(pid)) continue;
    if (v.product_version_config?.is_print_settings_main_source) {
      patchProviderVersionConfig(ctx, vPid, { is_print_settings_main_source: false }, v.id);
    }
  }
}

export function setProviderAsMainSource(ctx, pid) {
  clearMainSourceFromOtherProviders(ctx, pid);
  const versions = versionsForProviderId(ctx, pid);
  let activeIdx = 0;
  if (String(ctx.selectedPrintProviderId) === String(pid) && ctx.selectedVersionId) {
    const idx = versions.findIndex((v) => String(v.id) === String(ctx.selectedVersionId));
    if (idx >= 0) activeIdx = idx;
  }
  for (let i = 0; i < versions.length; i++) {
    patchProviderVersionConfig(
      ctx,
      pid,
      {
        is_print_settings_main_source: i === activeIdx,
        use_main_source_provider: false,
        use_main_source: defaultUseMainSourceCategories(),
      },
      versions[i].id
    );
  }
}

export function clearProviderMainSource(ctx, pid) {
  const version = resolveProviderVersion(ctx, pid);
  patchProviderVersionConfig(ctx, pid, { is_print_settings_main_source: false }, version?.id);
}

export function setProviderUseMainSource(ctx, pid, enabled) {
  const version = resolveProviderVersion(ctx, pid);
  patchProviderVersionConfig(
    ctx,
    pid,
    {
      use_main_source_provider: !!enabled,
      is_print_settings_main_source: false,
      use_main_source: defaultUseMainSourceCategories(),
    },
    version?.id
  );
}

export function setCategoryUseMainSource(ctx, pid, categoryKey, enabled) {
  if (!MAIN_SOURCE_CATEGORY_KEYS.includes(categoryKey)) return;
  const version = resolveProviderVersion(ctx, pid);
  const prev = getEffectiveVersionConfig(ctx, pid, version?.id);
  const flags = normalizeUseMainSourceCategories(mergeVersionProductConfig(prev, {}).use_main_source);
  flags[categoryKey] = !!enabled;
  patchProviderVersionConfig(ctx, pid, { use_main_source: flags }, version?.id);
}

export function categoryInheritToggleHtml(categoryKey, checked, disabled) {
  const dis = disabled ? " disabled" : "";
  const chk = checked ? " checked" : "";
  return `<label class="ce-pa-inherit-toggle">
    <span class="ce-pa-inherit-label">use main source</span>
    <input type="checkbox" class="ce-pa-use-main-cb" data-category="${escapeHtml(categoryKey)}"${chk}${dis} />
  </label>`;
}

export function shouldShowCategoryInheritToggles(msCtx) {
  return !msCtx.isMainSource && msCtx.hasMainSource && msCtx.useMainSourceProvider;
}

export function isCategoryInherited(msCtx, categoryKey) {
  return shouldShowCategoryInheritToggles(msCtx) && msCtx.useMainSource[categoryKey] === true;
}

/** Apply inherited print-area config slices from main source publish profile into live state. */
export function applyPrintAreaInheritanceToState(st, ctx, data, msCtx) {
  if (!msCtx?.hasMainSource || msCtx.isMainSource || !msCtx.useMainSourceProvider) return;
  const mainPid = msCtx.mainPid;
  if (mainPid == null) return;

  const mainConfig = ensureByDesignTypeConfig(getPublishProfileConfigForProvider(ctx, mainPid));
  const { slice: mainSlice } = getDesignTypeSlice(mainConfig, st.activeDesignType);
  const use = msCtx.useMainSource;

  if (use.scope) {
    const keys = Object.keys(mainConfig.by_design_type || {}).map(normalizeDesignTypeKey);
    if (keys.length) st.designTypesScope = new Set(keys.filter((k) => st.designTypes.includes(k)));
  }

  if (use.pattern) {
    st.patternConfig = { ...(mainSlice.pattern || defaultPatternConfig()) };
  }

  if (use.brand_assets) {
    const brand = readBrandAssetsFromConfig(mainConfig);
    st.brandAssetsMode = brand.mode;
    st.brandAssets = JSON.parse(JSON.stringify(brand.assets));
  }

  if (use.placement) {
    st.publishLogicByPh = readPublishLogicFromConfig(
      mainConfig,
      st.activeDesignType,
      st.versionSlug || "standard"
    );
  }

  if (use.print_area_images) {
    st.useMockups = resolvePrintAreaUseMockups(ctx, data);
    const { slice: targetSlice } = getDesignTypeSlice(st.workingConfig, st.activeDesignType);
    if (mainSlice.mockup) targetSlice.mockup = JSON.parse(JSON.stringify(mainSlice.mockup));
    if (mainSlice.edit_mode) targetSlice.edit_mode = JSON.parse(JSON.stringify(mainSlice.edit_mode));
  }
}

export function collectMainSourceVersionUpdates(ctx) {
  const edits = ensurePrintAreaVersionConfigEdits(ctx);
  const updates = [];
  const seen = new Set();
  for (const [key, cfg] of edits.entries()) {
    const versionId = String(key).split(":").slice(1).join(":");
    if (!versionId || seen.has(versionId)) continue;
    seen.add(versionId);
    updates.push({
      id: versionId,
      product_version_config: normalizePatProductVersionConfig(cfg),
    });
  }
  return updates;
}

export function collectMainSourceSnapshot(ctx) {
  const out = {};
  for (const [key, cfg] of ensurePrintAreaVersionConfigEdits(ctx).entries()) {
    out[key] = normalizePatProductVersionConfig(cfg);
  }
  return out;
}

export function syncMainSourceFromSubnavDom(ctx) {
  const stack = document.getElementById("ce-subnav-pills");
  if (!stack || ctx.activeTab !== "print_area") return;

  stack.querySelectorAll(".ce-pa-main-source-cb").forEach((cb) => {
    const pid = Number(cb.dataset.pid);
    const ms = printAreaMainSourceContext(ctx, pid);
    if (cb.checked && !ms.isMainSource) setProviderAsMainSource(ctx, pid);
    else if (!cb.checked && ms.isMainSource) clearProviderMainSource(ctx, pid);
  });

  stack.querySelectorAll(".ce-pa-use-main-provider-cb").forEach((cb) => {
    const pid = Number(cb.dataset.pid);
    setProviderUseMainSource(ctx, pid, cb.checked);
  });
}

export function syncCategoryInheritFromSidebarDom(ctx, root) {
  if (!root || ctx.activeTab !== "print_area") return;
  const pid = ctx.selectedPrintProviderId;
  root.querySelectorAll(".ce-pa-use-main-cb").forEach((cb) => {
    const cat = cb.dataset.category;
    if (cat) setCategoryUseMainSource(ctx, pid, cat, cb.checked);
  });
}

export function bindPrintAreaMainSourceSubnav(ctx, onChange) {
  const stack = document.getElementById("ce-subnav-pills");
  if (!stack) return;

  stack.querySelectorAll(".ce-pa-main-source-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const pid = Number(cb.dataset.pid);
      if (cb.checked) setProviderAsMainSource(ctx, pid);
      else clearProviderMainSource(ctx, pid);
      onChange?.();
    });
  });

  stack.querySelectorAll(".ce-pa-use-main-provider-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      setProviderUseMainSource(ctx, Number(cb.dataset.pid), cb.checked);
      onChange?.();
    });
  });
}
