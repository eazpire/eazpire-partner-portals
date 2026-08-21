/**
 * Creations Admin Logs — Products + Logs filter tabs (Catalog Studio FILTER EXPAND).
 */

export const PRODUCT_SECTIONS = [
  { key: "category", label: "Category" },
  { key: "visibility", label: "Visibility" },
  { key: "source", label: "Source" },
  { key: "product", label: "Product" },
  { key: "provider", label: "Provider" },
  { key: "printify_status", label: "Printify Status" },
  { key: "channels", label: "Channels" },
  { key: "amazon_markets", label: "Amazon Markets" },
  { key: "amazon_status", label: "Amazon Status" },
];

const PRODUCT_LABELS = {
  visibility: { public: "Public", private: "Private" },
  source: { product: "Product", customer: "Customer", samples: "Samples", other: "Other" },
  provider: { printify: "Printify", todify: "Todify" },
  printify_status: {
    published: "Published",
    unpublished: "Unpublished",
    unpublished_changes: "Unpublished Changes",
    publishing: "Publishing",
    error: "Error",
  },
  channels: { onlineshop: "eazpire Web", eazpire_headless: "eazpire Android" },
  amazon_markets: {
    amazon_eu: "Amazon EU",
    amazon_na: "Amazon US",
    amazon_de: "DE",
    amazon_uk: "UK",
    amazon_fr: "FR",
    amazon_nl: "NL",
    amazon_it: "IT",
    amazon_es: "ES",
    amazon_be: "BE",
    amazon_pl: "PL",
    amazon_se: "SE",
    amazon_ie: "IE",
    amazon_us: "US",
    amazon_ca: "CA",
  },
  amazon_status: { online: "Online", pending: "Pending" },
};

export function defaultProductFilterState() {
  return {
    q: "",
    tri: Object.fromEntries(PRODUCT_SECTIONS.map((s) => [s.key, {}])),
  };
}

export const LOG_SECTIONS = [
  { key: "status", label: "Status" },
  { key: "type", label: "Type" },
  { key: "source", label: "Source" },
  { key: "time_range", label: "Time range" },
  { key: "error", label: "Error" },
];

const LOG_STATIC_FACETS = {
  time_range: [
    { key: "today", label: "Today" },
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
    { key: "all", label: "All" },
  ],
  error: [
    { key: "has", label: "Has error" },
    { key: "none", label: "No error" },
  ],
};

export function defaultLogFilterState() {
  return {
    q: "",
    tri: Object.fromEntries(LOG_SECTIONS.map((s) => [s.key, {}])),
  };
}

export function countActiveProductFilters(state) {
  let n = state?.q?.trim() ? 1 : 0;
  for (const group of Object.values(state?.tri || {})) {
    for (const st of Object.values(group || {})) {
      if (Number(st) === 1 || Number(st) === -1) n += 1;
    }
  }
  return n;
}

export function countActiveLogFilters(state) {
  let n = state?.q?.trim() ? 1 : 0;
  for (const group of Object.values(state?.tri || {})) {
    for (const st of Object.values(group || {})) {
      if (Number(st) === 1 || Number(st) === -1) n += 1;
    }
  }
  return n;
}

export function productTriQuery(state) {
  return slimTriQuery(state);
}

export function logTriQuery(state) {
  return slimTriQuery(state);
}

function slimTriQuery(state) {
  const out = {};
  for (const [section, group] of Object.entries(state?.tri || {})) {
    const slim = {};
    for (const [key, st] of Object.entries(group || {})) {
      if (Number(st) === 1 || Number(st) === -1) slim[key] = Number(st);
    }
    if (Object.keys(slim).length) out[section] = slim;
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function facetLabel(section, key) {
  return PRODUCT_LABELS[section]?.[key] || key;
}

function mergeStaticFacets(staticList, facetList) {
  const byKey = new Map((facetList || []).map((f) => [String(f.key), f]));
  return staticList.map((opt) => ({
    key: opt.key,
    label: byKey.get(opt.key)?.label || opt.label,
    count: Number(byKey.get(opt.key)?.count) || 0,
  }));
}

function triSwitchHtml(sectionKey, value, state) {
  const st = Number(state) === 1 || Number(state) === -1 ? Number(state) : 0;
  return `<div class="cr-pf-triswitch" data-state="${st}" data-jl-section="${escapeHtml(sectionKey)}" data-jl-key="${escapeHtml(String(value))}" role="group">
    <div class="cr-pf-triswitch__track">
      <div class="cr-pf-triswitch__thumb"></div>
      <div class="cr-pf-triswitch__labels">
        <button type="button" data-v="-1" aria-label="Exclude"><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--minus">−</span></button>
        <button type="button" data-v="0" aria-label="Neutral"><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--dot"></span></button>
        <button type="button" data-v="1" aria-label="Include"><span class="cr-pf-triswitch__glyph cr-pf-triswitch__glyph--plus">+</span></button>
      </div>
    </div>
  </div>`;
}

export function productsFilterHtml(state, facets) {
  const active = countActiveProductFilters(state);
  return `
    <div class="cr-pf-search">
      <input type="search" id="jl-product-search" class="cr-pf-search__input" placeholder="Search products…" value="${escapeHtml(state.q)}" aria-label="Filter products" />
    </div>
    ${active ? `<button type="button" class="cr-pf-clear" id="jl-product-clear">Clear product filters (${active})</button>` : ""}
    <div class="cr-pf-sections">
      ${PRODUCT_SECTIONS.map(({ key, label }) => {
        const list = facets?.[key] || [];
        if (!list.length) return "";
        const group = state.tri[key] || {};
        const on = Object.values(group).filter((st) => Number(st) === 1 || Number(st) === -1).length;
        return `<details class="cr-pf-section" open>
          <summary class="cr-pf-section__summary">
            <span class="cr-pf-section__title">${escapeHtml(label)}</span>
            ${on ? `<span class="cr-pf-section__badge">${on}</span>` : ""}
          </summary>
          <div class="cr-pf-section__body">
            ${list
              .map((f) => {
                const st = Number(group[f.key] || 0);
                return `<div class="cr-pf-option cr-pf-option--tri" data-tri-state="${st}">
                  <span class="cr-pf-option__label">${escapeHtml(facetLabel(key, f.key))}</span>
                  <span class="cr-pf-option__count">${Number(f.count) || 0}</span>
                  ${triSwitchHtml(key, f.key, st)}
                </div>`;
              })
              .join("")}
          </div>
        </details>`;
      }).join("")}
    </div>`;
}

export function logsFilterHtml(state, facets) {
  const active = countActiveLogFilters(state);
  const lists = {
    status: facets?.status || [],
    type: facets?.type || [],
    source: facets?.source || [],
    time_range: mergeStaticFacets(LOG_STATIC_FACETS.time_range, facets?.time_range),
    error: mergeStaticFacets(LOG_STATIC_FACETS.error, facets?.error),
  };
  return `
    <div class="cr-pf-search">
      <input type="search" id="jl-log-search" class="cr-pf-search__input" placeholder="Search logs…" value="${escapeHtml(state.q)}" aria-label="Filter logs" />
    </div>
    ${active ? `<button type="button" class="cr-pf-clear" id="jl-log-clear">Clear log filters (${active})</button>` : ""}
    <div class="cr-pf-sections">
      ${LOG_SECTIONS.map(({ key, label }) => {
        const list = lists[key] || [];
        if (!list.length) return "";
        const group = state.tri[key] || {};
        const on = Object.values(group).filter((st) => Number(st) === 1 || Number(st) === -1).length;
        return `<details class="cr-pf-section" open>
          <summary class="cr-pf-section__summary">
            <span class="cr-pf-section__title">${escapeHtml(label)}</span>
            ${on ? `<span class="cr-pf-section__badge">${on}</span>` : ""}
          </summary>
          <div class="cr-pf-section__body">
            ${list
              .map((f) => {
                const st = Number(group[f.key] || 0);
                const countHtml =
                  f.count != null ? `<span class="cr-pf-option__count">${Number(f.count) || 0}</span>` : "";
                return `<div class="cr-pf-option cr-pf-option--tri" data-tri-state="${st}">
                  <span class="cr-pf-option__label">${escapeHtml(f.label || f.key)}</span>
                  ${countHtml}
                  ${triSwitchHtml(key, f.key, st)}
                </div>`;
              })
              .join("")}
          </div>
        </details>`;
      }).join("")}
    </div>`;
}

export function bindProductsFilter(root, state, onChange) {
  root.querySelector("#jl-product-search")?.addEventListener("input", (e) => {
    state.q = String(e.target.value || "");
    onChange();
  });
  root.querySelector("#jl-product-clear")?.addEventListener("click", () => {
    state.q = "";
    for (const key of Object.keys(state.tri)) state.tri[key] = {};
    onChange(true);
  });
  bindTriSwitches(root, state, onChange);
}

export function bindLogsFilter(root, state, onChange) {
  root.querySelector("#jl-log-search")?.addEventListener("input", (e) => {
    state.q = String(e.target.value || "");
    onChange();
  });
  root.querySelector("#jl-log-clear")?.addEventListener("click", () => {
    state.q = "";
    for (const key of Object.keys(state.tri)) state.tri[key] = {};
    onChange(true);
  });
  bindTriSwitches(root, state, onChange);
}

function bindTriSwitches(root, state, onChange) {
  root.querySelectorAll(".cr-pf-triswitch").forEach((el) => {
    el.querySelectorAll("button[data-v]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const section = el.getAttribute("data-jl-section");
        const key = el.getAttribute("data-jl-key");
        const v = Number(btn.getAttribute("data-v"));
        if (!state.tri[section]) state.tri[section] = {};
        if (v === 0) delete state.tri[section][key];
        else state.tri[section][key] = v;
        el.setAttribute("data-state", String(v === 1 || v === -1 ? v : 0));
        const row = el.closest(".cr-pf-option--tri");
        if (row) row.setAttribute("data-tri-state", String(v === 1 || v === -1 ? v : 0));
        onChange(true);
      });
    });
  });
}
