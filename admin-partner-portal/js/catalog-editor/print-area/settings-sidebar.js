import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { PH_TYPES } from "../provider-print-technical.js";
import { getPlaceholderSlotsForView } from "../version-config-panel.js";
import {
  isPaSidebarCollapsed,
  setPaSidebarCollapsed,
  defaultPatternConfig,
  normalizeDesignTypeKey,
  loadRectsForVariantGroup,
  aggregateBrandAssetSlots,
} from "./helpers.js";
import { renderUploadGrids, renderMockCarousels, bindImageGrids } from "./image-grid.js";
import { renderBrandAssetsSection, bindBrandAssetsSection, refreshBrandAssetsSection } from "./brand-assets.js";

const PATTERN_SLIDERS = [
  { key: "spacingH", label: "Spacing H", min: 0, max: 200, step: 1 },
  { key: "spacingV", label: "Spacing V", min: 0, max: 200, step: 1 },
  { key: "angle", label: "Angle", min: -180, max: 180, step: 1 },
  { key: "offsetH", label: "Offset H", min: -100, max: 100, step: 1 },
  { key: "rotH", label: "Rot H", min: -180, max: 180, step: 1 },
  { key: "rotV", label: "Rot V", min: -180, max: 180, step: 1 },
];

function renderScopeSection(st) {
  const dtChecks = st.designTypes
    .map(
      (dt) => `
    <div class="ce-pa-scope-row ce-pa-dt-row ${st.activeDesignType === dt ? "ce-pa-dt-row--active" : ""}">
      <label class="ce-pa-check ce-pa-check--box-only">
        <input type="checkbox" class="ce-pa-scope-dt" data-dt="${escapeHtml(dt)}" ${
          st.designTypesScope.has(dt) ? "checked" : ""
        } />
      </label>
      <button type="button" class="ce-pa-dt-name btn btn-ghost btn-xs" data-dt="${escapeHtml(dt)}">${escapeHtml(dt)}</button>
    </div>`
    )
    .join("");

  const variantRows = st.variantGroups.groups
    .map((g) => {
      const dot =
        st.variantGroupMode === "color"
          ? `<span class="ce-pa-color-dot" style="background:${escapeHtml(g.hex || "#888")}"></span>`
          : "";
      const isActive = g.id === st.activeVariantGroupId;
      return `
    <div class="ce-pa-scope-row ce-pa-variant-row ${isActive ? "ce-pa-variant-row--active" : ""}">
      <label class="ce-pa-check ce-pa-check--box-only">
        <input type="checkbox" class="ce-pa-scope-variant" data-variant-id="${escapeHtml(g.id)}" ${
          st.variantsScope.has(g.id) ? "checked" : ""
        } />
      </label>
      ${dot}
      <button type="button" class="ce-pa-variant-name btn btn-ghost btn-xs" data-variant-id="${escapeHtml(g.id)}">${escapeHtml(g.title)}</button>
      <span class="ce-pa-variant-count">${g.variantIds.length}</span>
    </div>`;
    })
    .join("");

  return `
    <details class="ce-pa-acc" open>
      <summary>Scope</summary>
      <div class="ce-pa-acc-body">
        <p class="ce-hint">Design types and variants that receive changes when you save this tab.</p>
        <div class="ce-pa-scope-block">
          <div class="ce-pa-scope-head">
            <strong>Design types</strong>
            <button type="button" class="btn btn-ghost btn-xs" id="ce-pa-dt-all">All</button>
          </div>
          <div class="ce-pa-check-grid">${dtChecks}</div>
        </div>
        <div class="ce-pa-scope-block">
          <div class="ce-pa-scope-head">
            <strong>Variants</strong>
            <button type="button" class="btn btn-ghost btn-xs" id="ce-pa-var-all">All</button>
          </div>
          <div class="ce-pa-check-grid">${variantRows || '<p class="ce-hint">No variants loaded.</p>'}</div>
        </div>
      </div>
    </details>`;
}

function renderPatternSection(st) {
  const pat = st.patternConfig || defaultPatternConfig();
  const sliders = PATTERN_SLIDERS.map(
    (s) => `
    <div class="ce-pa-slider-row">
      <label>${escapeHtml(s.label)}</label>
      <input type="range" class="ce-pa-pattern-slider" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${Number(pat[s.key]) || 0}" />
      <input type="number" class="ce-pa-pattern-num input input-sm" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${Number(pat[s.key]) || 0}" />
    </div>`
  ).join("");

  const patternBody = pat.enabled
    ? `
        <div class="ce-pa-pattern-styles">
          <button type="button" class="btn btn-secondary btn-xs ce-pa-pattern-style ${pat.style === "grid" ? "active" : ""}" data-style="grid">Grid</button>
          <button type="button" class="btn btn-secondary btn-xs ce-pa-pattern-style ${pat.style === "brick" ? "active" : ""}" data-style="brick">Brick</button>
        </div>
        ${sliders}`
    : "";

  return `
    <details class="ce-pa-acc ce-pa-acc--pattern ${pat.enabled ? "" : "ce-pa-acc--pattern-off"}" open>
      <summary class="ce-pa-pattern-summary">
        <label class="ce-pa-check ce-pa-check--inline" id="ce-pa-pattern-enabled-wrap">
          <input type="checkbox" id="ce-pa-pattern-enabled" ${pat.enabled ? "checked" : ""} />
        </label>
        <span>Pattern — ${escapeHtml(st.activeDesignType)}</span>
      </summary>
      <div class="ce-pa-acc-body ce-pa-pattern-body">${patternBody}</div>
    </details>`;
}

function renderPlacementSection(st, data, ctx) {
  const version =
    (data?.versions || []).find((v) => String(v.id) === String(ctx?.selectedVersionId)) || data?.version || null;
  const catalogDetail = { variants: data?.variants_json || data?.variants || [] };
  const slots = getPlaceholderSlotsForView(version, catalogDetail, st.activeView);
  const activePhTypes = PH_TYPES.filter((ph) => (Number(slots[ph.key]) || 0) > 0);
  if (!activePhTypes.length) return "";

  const rows = activePhTypes
    .map((ph) => {
      const val = st.publishLogicByPh?.[ph.key] || "calculated";
      return `
    <div class="ce-pa-pl-row">
      <span class="ce-pa-pl-label">${escapeHtml(ph.label)}</span>
      <select class="select select-sm ce-pa-pl-mode" data-ph="${ph.key}">
        <option value="calculated" ${val === "calculated" ? "selected" : ""}>Calculated</option>
        <option value="template" ${val === "template" ? "selected" : ""}>Template</option>
      </select>
    </div>`;
    })
    .join("");

  return `
    <details class="ce-pa-acc ce-pa-acc--placement">
      <summary>Placement mode — ${escapeHtml(st.activeView)}</summary>
      <div class="ce-pa-acc-body">
        <p class="ce-hint">Per placeholder for the active view.</p>
        ${rows}
      </div>
    </details>`;
}

function renderImagesSection(st, data) {
  return `
    <details class="ce-pa-acc">
      <summary>Print area images</summary>
      <div class="ce-pa-acc-body" id="ce-pa-images-body">
        <label class="ce-pa-check">
          <input type="checkbox" id="ce-pa-use-mocks" ${st.useMockups ? "checked" : ""} />
          <span>Use mockups (hide upload grids)</span>
        </label>
        <div class="ce-pa-img-upload-section ${st.useMockups ? "ce-pa-img-section--hidden" : ""}" id="ce-pa-upload-section">${renderUploadGrids(st, data)}</div>
        <div class="ce-pa-img-mock-section ${st.useMockups ? "" : "ce-pa-img-section--hidden"}" id="ce-pa-mock-section">${renderMockCarousels(st, data)}</div>
      </div>
    </details>`;
}

function brandAssetsOptions(st, data, ctx, globalAssets) {
  const version =
    (data?.versions || []).find((v) => String(v.id) === String(ctx?.selectedVersionId)) || data?.version || null;
  const catalogDetail = { variants: data?.variants_json || data?.variants || [] };
  const slots = aggregateBrandAssetSlots(version, catalogDetail, st.viewKeys);
  return {
    mode: st.brandAssetsMode || "global",
    globalAssets: globalAssets || {},
    specificAssets: st.brandAssets || { qr: {}, logo: {} },
    showQr: slots.showQr,
    showLogo: slots.showLogo,
    showSection: slots.showSection,
  };
}

export function renderPrintAreaSidebar(st, data, ctx, globalBrandAssets) {
  const collapsed = isPaSidebarCollapsed();
  const brandOpts = brandAssetsOptions(st, data, ctx, globalBrandAssets);
  return `
    <div class="ce-pa-layout ${collapsed ? "ce-pa-layout--collapsed" : ""}">
      <aside class="ce-pa-sidebar-wrap">
        <div class="ce-pa-sidebar">
          <h3 class="ce-pa-sidebar-title">Print Area Settings</h3>
          <div class="ce-pa-sidebar-scroll">
            ${renderScopeSection(st)}
            ${renderPatternSection(st)}
            ${renderPlacementSection(st, data, ctx)}
            ${renderBrandAssetsSection(brandOpts)}
            ${renderImagesSection(st, data)}
          </div>
        </div>
        <button type="button" class="ce-pa-rail" id="ce-pa-sidebar-toggle" aria-label="Toggle print area sidebar">
          <span class="ce-pa-rail-arrow">‹</span>
        </button>
      </aside>
      <div class="ce-pa-main" id="ce-pa-main"></div>
    </div>`;
}

export function refreshPatternSection(root, st, onChange) {
  const acc = root.querySelector(".ce-pa-acc--pattern");
  if (!acc) return;
  const pat = st.patternConfig || defaultPatternConfig();
  acc.classList.toggle("ce-pa-acc--pattern-off", !pat.enabled);
  const body = acc.querySelector(".ce-pa-pattern-body");
  if (!body) return;

  if (!pat.enabled) {
    body.innerHTML = "";
    return;
  }

  const sliders = PATTERN_SLIDERS.map(
    (s) => `
    <div class="ce-pa-slider-row">
      <label>${escapeHtml(s.label)}</label>
      <input type="range" class="ce-pa-pattern-slider" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${Number(pat[s.key]) || 0}" />
      <input type="number" class="ce-pa-pattern-num input input-sm" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${Number(pat[s.key]) || 0}" />
    </div>`
  ).join("");

  body.innerHTML = `
    <div class="ce-pa-pattern-styles">
      <button type="button" class="btn btn-secondary btn-xs ce-pa-pattern-style ${pat.style === "grid" ? "active" : ""}" data-style="grid">Grid</button>
      <button type="button" class="btn btn-secondary btn-xs ce-pa-pattern-style ${pat.style === "brick" ? "active" : ""}" data-style="brick">Brick</button>
    </div>
    ${sliders}`;

  bindPatternControls(root, st, onChange);
}

export function refreshScopeActiveStates(root, st) {
  root.querySelectorAll(".ce-pa-dt-row").forEach((row) => {
    const dt = normalizeDesignTypeKey(row.querySelector(".ce-pa-dt-name")?.dataset.dt);
    row.classList.toggle("ce-pa-dt-row--active", dt === st.activeDesignType);
  });
  root.querySelectorAll(".ce-pa-variant-row").forEach((row) => {
    const id = row.querySelector(".ce-pa-variant-name")?.dataset.variantId;
    row.classList.toggle("ce-pa-variant-row--active", id === st.activeVariantGroupId);
  });
}

export function refreshPatternSummary(root, st) {
  const label = root.querySelector(".ce-pa-pattern-summary > span");
  if (label) label.textContent = `Pattern — ${st.activeDesignType}`;
}

export function refreshPlacementSummary(root, st) {
  const plAcc = root.querySelector(".ce-pa-acc--placement");
  const summary = plAcc?.querySelector("summary");
  if (summary) summary.textContent = `Placement mode — ${st.activeView}`;
}

export function refreshPlacementSection(root, st, data, ctx) {
  const patternAcc = root.querySelector(".ce-pa-acc--pattern");
  const oldPl = root.querySelector(".ce-pa-acc--placement");
  if (oldPl) oldPl.remove();
  const html = renderPlacementSection(st, data, ctx);
  if (html && patternAcc) {
    patternAcc.insertAdjacentHTML("afterend", html);
  }
  refreshPlacementValues(root, st);
  root.querySelectorAll(".ce-pa-pl-mode").forEach((sel) => {
    sel.addEventListener("change", () => {
      st.publishLogicByPh[sel.dataset.ph] = sel.value;
    });
  });
}

export function refreshPlacementValues(root, st) {
  root.querySelectorAll(".ce-pa-pl-mode").forEach((sel) => {
    sel.value = st.publishLogicByPh?.[sel.dataset.ph] || "calculated";
  });
}

export function refreshBrandAssetsSidebar(root, st, data, ctx, globalBrandAssets) {
  const opts = brandAssetsOptions(st, data, ctx, globalBrandAssets);
  const existing = root.querySelector(".ce-pa-acc--brand");
  if (!opts.showSection) {
    existing?.remove();
    return opts;
  }
  if (!existing) {
    const imagesAcc = root.querySelector(".ce-pa-acc:not(.ce-pa-acc--brand):not(.ce-pa-acc--pattern):not(.ce-pa-acc--placement)");
    const html = renderBrandAssetsSection(opts);
    if (html && imagesAcc) imagesAcc.insertAdjacentHTML("beforebegin", html);
    return opts;
  }
  refreshBrandAssetsSection(root, opts);
  return opts;
}

export function refreshImagesGrids(root, ctx, st, data, gridCallbacks) {
  const upload = root.querySelector("#ce-pa-upload-section");
  const mock = root.querySelector("#ce-pa-mock-section");
  if (upload) {
    upload.innerHTML = renderUploadGrids(st, data);
    upload.classList.toggle("ce-pa-img-section--hidden", st.useMockups);
  }
  if (mock) {
    mock.innerHTML = renderMockCarousels(st, data);
    mock.classList.toggle("ce-pa-img-section--hidden", !st.useMockups);
  }
  bindImageGrids(root, ctx, st, data, gridCallbacks);
}

function toggleImageSections(root, st) {
  root.querySelector("#ce-pa-upload-section")?.classList.toggle("ce-pa-img-section--hidden", st.useMockups);
  root.querySelector("#ce-pa-mock-section")?.classList.toggle("ce-pa-img-section--hidden", !st.useMockups);
}

function bindPatternControls(root, st, onChange) {
  const syncPattern = (key, val) => {
    st.patternConfig[key] = val;
    onChange?.();
  };

  root.querySelectorAll(".ce-pa-pattern-style").forEach((btn) => {
    btn.addEventListener("click", () => {
      st.patternConfig.style = btn.dataset.style || "grid";
      root.querySelectorAll(".ce-pa-pattern-style").forEach((b) => b.classList.toggle("active", b === btn));
      onChange?.();
    });
  });

  root.querySelectorAll(".ce-pa-pattern-slider").forEach((slider) => {
    slider.addEventListener("input", () => {
      const key = slider.dataset.key;
      const val = Number(slider.value);
      syncPattern(key, val);
      const num = root.querySelector(`.ce-pa-pattern-num[data-key="${key}"]`);
      if (num) num.value = String(val);
    });
  });

  root.querySelectorAll(".ce-pa-pattern-num").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const val = Number(input.value);
      syncPattern(key, val);
      const slider = root.querySelector(`.ce-pa-pattern-slider[data-key="${key}"]`);
      if (slider) slider.value = String(val);
    });
  });
}

export function bindPrintAreaSidebar(root, st, data, callbacks = {}) {
  const {
    onChange,
    onPatternChange,
    onPrintAreaRefresh,
    onDesignTypeChange,
    onVariantGroupChange,
    imageGridCallbacks,
    ctx,
    globalBrandAssetsRef,
    brandAssetsModeRef,
    specificBrandAssetsRef,
    onBrandAssetsChange,
  } = callbacks;

  const gridCallbacks = {
    onUploaded: (...args) => imageGridCallbacks?.onUploaded?.(...args),
    onCleared: (...args) => imageGridCallbacks?.onCleared?.(...args),
    onUseMockPick: (viewKey, color) => {
      st.activeVariantGroupId =
        st.variantGroups.groups.find((g) => g.title === color)?.id || st.activeVariantGroupId;
      refreshScopeActiveStates(root, st);
      root.querySelectorAll(".ce-pa-mock-pick").forEach((btn) => {
        btn.classList.toggle("ce-pa-mock-pick--active", btn.dataset.color === color);
      });
      onChange?.();
      onPrintAreaRefresh?.();
    },
  };

  root.querySelector("#ce-pa-sidebar-toggle")?.addEventListener("click", () => {
    setPaSidebarCollapsed(!isPaSidebarCollapsed());
    root.querySelector(".ce-pa-layout")?.classList.toggle("ce-pa-layout--collapsed", isPaSidebarCollapsed());
  });

  root.querySelector("#ce-pa-dt-all")?.addEventListener("click", () => {
    const allIds = st.designTypes;
    const allSelected = allIds.every((dt) => st.designTypesScope.has(dt));
    if (allSelected) {
      st.designTypesScope = new Set();
      root.querySelectorAll(".ce-pa-scope-dt").forEach((cb) => {
        cb.checked = false;
      });
    } else {
      st.designTypesScope = new Set(allIds);
      root.querySelectorAll(".ce-pa-scope-dt").forEach((cb) => {
        cb.checked = true;
      });
    }
    onChange?.();
  });

  root.querySelector("#ce-pa-var-all")?.addEventListener("click", () => {
    const allIds = st.variantGroups.groups.map((g) => g.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => st.variantsScope.has(id));
    if (allSelected) {
      st.variantsScope = new Set();
      root.querySelectorAll(".ce-pa-scope-variant").forEach((cb) => {
        cb.checked = false;
      });
    } else {
      st.variantsScope = new Set(allIds);
      root.querySelectorAll(".ce-pa-scope-variant").forEach((cb) => {
        cb.checked = true;
      });
    }
    onChange?.();
  });

  root.querySelectorAll(".ce-pa-scope-dt").forEach((cb) => {
    cb.addEventListener("change", () => {
      const dt = normalizeDesignTypeKey(cb.dataset.dt);
      if (cb.checked) st.designTypesScope.add(dt);
      else st.designTypesScope.delete(dt);
      onChange?.();
    });
  });

  root.querySelectorAll(".ce-pa-dt-name").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dt = normalizeDesignTypeKey(btn.dataset.dt);
      if (dt === st.activeDesignType) return;
      onDesignTypeChange?.(dt);
    });
  });

  root.querySelectorAll(".ce-pa-scope-variant").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.variantId;
      if (cb.checked) st.variantsScope.add(id);
      else st.variantsScope.delete(id);
      onChange?.();
    });
  });

  root.querySelectorAll(".ce-pa-variant-name").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.variantId;
      if (id === st.activeVariantGroupId) return;
      st.activeVariantGroupId = id;
      if (data) loadRectsForVariantGroup(st, data, id);
      onVariantGroupChange?.(id);
    });
  });

  root.querySelector("#ce-pa-pattern-enabled-wrap")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  root.querySelector("#ce-pa-pattern-enabled")?.addEventListener("change", (e) => {
    st.patternConfig.enabled = e.target.checked;
    refreshPatternSection(root, st, onPatternChange);
    onPatternChange?.();
  });

  bindPatternControls(root, st, onPatternChange);

  root.querySelectorAll(".ce-pa-pl-mode").forEach((sel) => {
    sel.addEventListener("change", () => {
      st.publishLogicByPh[sel.dataset.ph] = sel.value;
      onChange?.();
    });
  });

  if (globalBrandAssetsRef && brandAssetsModeRef && specificBrandAssetsRef) {
    const brandOpts = brandAssetsOptions(st, data, ctx, globalBrandAssetsRef.current);
    bindBrandAssetsSection(
      root,
      { global: globalBrandAssetsRef, specific: specificBrandAssetsRef, mode: brandAssetsModeRef },
      {
        globalAssetsRef: globalBrandAssetsRef,
        specificAssetsRef: specificBrandAssetsRef,
        modeRef: brandAssetsModeRef,
        productKey: ctx?.productKey,
        printProviderId: ctx?.selectedPrintProviderId,
        showQr: brandOpts.showQr,
        showLogo: brandOpts.showLogo,
        onUploaded: () => onBrandAssetsChange?.(),
        onCleared: () => onBrandAssetsChange?.(),
        onModeChange: (mode) => {
          st.brandAssetsMode = mode;
          onBrandAssetsChange?.(mode);
        },
      }
    );
  }

  root.querySelector("#ce-pa-use-mocks")?.addEventListener("change", (e) => {
    st.useMockups = e.target.checked;
    toggleImageSections(root, st);
    if (st.useMockups) {
      const mockSection = root.querySelector("#ce-pa-mock-section");
      if (mockSection) mockSection.innerHTML = renderMockCarousels(st, data);
      bindImageGrids(root, ctx, st, data, gridCallbacks);
    }
    onChange?.();
    onPrintAreaRefresh?.();
  });

  bindImageGrids(root, ctx, st, data, gridCallbacks);
}
