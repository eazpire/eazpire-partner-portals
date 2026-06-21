import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { PH_TYPES } from "../provider-print-technical.js";
import {
  isPaSidebarCollapsed,
  setPaSidebarCollapsed,
  defaultPatternConfig,
  normalizeDesignTypeKey,
  loadRectsForVariantGroup,
} from "./helpers.js";
import { renderImageGrids, bindImageGrids } from "./image-grid.js";

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
    <label class="ce-pa-check">
      <input type="checkbox" class="ce-pa-scope-dt" data-dt="${escapeHtml(dt)}" ${
        st.designTypesScope.has(dt) ? "checked" : ""
      } />
      <span>${escapeHtml(dt)}</span>
    </label>`
    )
    .join("");

  const variantRows = st.variantGroups.groups
    .map((g) => {
      const dot =
        st.variantGroupMode === "color"
          ? `<span class="ce-pa-color-dot" style="background:${escapeHtml(g.hex || "#888")}"></span>`
          : "";
      return `
    <label class="ce-pa-check ce-pa-variant-row">
      <input type="checkbox" class="ce-pa-scope-variant" data-variant-id="${escapeHtml(g.id)}" ${
        st.variantsScope.has(g.id) ? "checked" : ""
      } />
      ${dot}
      <span>${escapeHtml(g.title)}</span>
      <span class="ce-pa-variant-count">${g.variantIds.length}</span>
    </label>`;
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
          ${
            st.variantGroups.groups.length > 1
              ? `
          <div class="ce-pa-variant-edit-row">
            <span class="ce-hint">Edit group</span>
            <select class="select select-sm" id="ce-pa-active-variant-group">
              ${st.variantGroups.groups
                .map(
                  (g) =>
                    `<option value="${escapeHtml(g.id)}" ${g.id === st.activeVariantGroupId ? "selected" : ""}>${escapeHtml(g.title)}</option>`
                )
                .join("")}
            </select>
          </div>`
              : ""
          }
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

  return `
    <details class="ce-pa-acc" open>
      <summary>Pattern — ${escapeHtml(st.activeDesignType)}</summary>
      <div class="ce-pa-acc-body">
        <label class="ce-pa-check">
          <input type="checkbox" id="ce-pa-pattern-enabled" ${pat.enabled ? "checked" : ""} />
          <span>Enable pattern layout</span>
        </label>
        <div class="ce-pa-pattern-styles">
          <button type="button" class="btn btn-secondary btn-xs ce-pa-pattern-style ${pat.style === "grid" ? "active" : ""}" data-style="grid">Grid</button>
          <button type="button" class="btn btn-secondary btn-xs ce-pa-pattern-style ${pat.style === "brick" ? "active" : ""}" data-style="brick">Brick</button>
        </div>
        ${sliders}
      </div>
    </details>`;
}

function renderPlacementSection(st) {
  const rows = PH_TYPES.map((ph) => {
    const val = st.publishLogicByPh?.[ph.key] || "calculated";
    return `
    <div class="ce-pa-pl-row">
      <span>${escapeHtml(ph.label)}</span>
      <select class="select select-sm ce-pa-pl-mode" data-ph="${ph.key}">
        <option value="calculated" ${val === "calculated" ? "selected" : ""}>Calculated</option>
        <option value="template" ${val === "template" ? "selected" : ""}>Template</option>
      </select>
    </div>`;
  }).join("");

  return `
    <details class="ce-pa-acc">
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
      <div class="ce-pa-acc-body">
        <label class="ce-pa-check">
          <input type="checkbox" id="ce-pa-use-mocks" ${st.useMockups ? "checked" : ""} />
          <span>Use mockups (hide upload grids)</span>
        </label>
        <div class="ce-pa-img-grids ${st.useMockups ? "ce-pa-img-grids--hidden" : ""}" id="ce-pa-img-grids">${renderImageGrids(st, data)}</div>
      </div>
    </details>`;
}

function renderDesignTypePicker(st) {
  return `
    <div class="ce-pa-dt-picker">
      <span class="ce-pa-dt-label">Edit design type</span>
      <div class="ce-pa-dt-tabs">
        ${st.designTypes
          .map(
            (dt) =>
              `<button type="button" class="btn btn-secondary btn-xs ce-pa-dt-tab ${
                st.activeDesignType === dt ? "active" : ""
              }" data-dt="${escapeHtml(dt)}">${escapeHtml(dt)}</button>`
          )
          .join("")}
      </div>
    </div>`;
}

export function renderPrintAreaSidebar(st, data) {
  const collapsed = isPaSidebarCollapsed();
  return `
    <div class="ce-pa-layout ${collapsed ? "ce-pa-layout--collapsed" : ""}">
      <aside class="ce-pa-sidebar-wrap">
        <div class="ce-pa-sidebar">
          <h3 class="ce-pa-sidebar-title">Print Area Settings</h3>
          ${renderDesignTypePicker(st)}
          <div class="ce-pa-sidebar-scroll">
            ${renderScopeSection(st)}
            ${renderPatternSection(st)}
            ${renderPlacementSection(st)}
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

export function bindPrintAreaSidebar(root, st, data, callbacks = {}) {
  const { onChange, onDesignTypeChange, onVariantGroupChange, onReload, ctx } = callbacks;

  root.querySelector("#ce-pa-sidebar-toggle")?.addEventListener("click", () => {
    setPaSidebarCollapsed(!isPaSidebarCollapsed());
    root.querySelector(".ce-pa-layout")?.classList.toggle("ce-pa-layout--collapsed", isPaSidebarCollapsed());
  });

  root.querySelectorAll(".ce-pa-dt-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dt = normalizeDesignTypeKey(btn.dataset.dt);
      if (dt === st.activeDesignType) return;
      onDesignTypeChange?.(dt);
    });
  });

  root.querySelector("#ce-pa-dt-all")?.addEventListener("click", () => {
    st.designTypesScope = new Set(st.designTypes);
    root.querySelectorAll(".ce-pa-scope-dt").forEach((cb) => {
      cb.checked = true;
    });
    onChange?.();
  });

  root.querySelector("#ce-pa-var-all")?.addEventListener("click", () => {
    st.variantsScope = new Set(st.variantGroups.groups.map((g) => g.id));
    root.querySelectorAll(".ce-pa-scope-variant").forEach((cb) => {
      cb.checked = true;
    });
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

  root.querySelectorAll(".ce-pa-scope-variant").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.variantId;
      if (cb.checked) st.variantsScope.add(id);
      else st.variantsScope.delete(id);
      onChange?.();
    });
  });

  const syncPattern = (key, val) => {
    st.patternConfig[key] = val;
    onChange?.();
  };

  root.querySelector("#ce-pa-pattern-enabled")?.addEventListener("change", (e) => {
    st.patternConfig.enabled = e.target.checked;
    onChange?.();
  });

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

  root.querySelectorAll(".ce-pa-pl-mode").forEach((sel) => {
    sel.addEventListener("change", () => {
      st.publishLogicByPh[sel.dataset.ph] = sel.value;
      onChange?.();
    });
  });

  root.querySelector("#ce-pa-use-mocks")?.addEventListener("change", (e) => {
    st.useMockups = e.target.checked;
    root.querySelector("#ce-pa-img-grids")?.classList.toggle("ce-pa-img-grids--hidden", st.useMockups);
    onChange?.();
    onReload?.();
  });

  root.querySelector("#ce-pa-active-variant-group")?.addEventListener("change", (e) => {
    st.activeVariantGroupId = e.target.value;
    if (data) loadRectsForVariantGroup(st, data, st.activeVariantGroupId);
    onVariantGroupChange?.(st.activeVariantGroupId);
  });

  bindImageGrids(root, ctx, st, data, {
    onUploaded: () => onReload?.(),
    onUseMockPick: (viewKey, color) => {
      st.useMockups = true;
      st.activeVariantGroupId =
        st.variantGroups.groups.find((g) => g.title === color)?.id || st.activeVariantGroupId;
      onChange?.();
      onReload?.();
    },
  });
}
