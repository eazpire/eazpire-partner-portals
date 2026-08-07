/**
 * Catalog editor → Channels tab.
 * Amazon: EU/Amerika parents + per-country publish toggles (no BIL).
 * Optional per-country seller / refresh-token env overrides.
 */
import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchChannels, saveChannels } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
const FLAG_CODE = { UK: "gb" };

const DEFAULT_MARKET_GROUPS = {
  europa: ["FR", "NL", "PL", "UK", "DE", "ES", "IE", "SE", "BE", "IT"],
  amerika: ["CA", "US"],
};

const DEFAULT_MARKET_LABELS = {
  FR: "France",
  NL: "Netherlands",
  PL: "Poland",
  UK: "United Kingdom",
  DE: "Germany",
  ES: "Spain",
  IE: "Ireland",
  SE: "Sweden",
  BE: "Belgium",
  IT: "Italy",
  CA: "Canada",
  US: "United States",
};

const DEFAULT_SOURCE = { europa: "DE", amerika: "US" };
/** Keep in sync with src/amazon/amazonMarketplaceContentGate.js */
const CONTENT_READY = new Set([
  "DE",
  "US",
  "UK",
  "FR",
  "IT",
  "ES",
  "NL",
  "BE",
  "SE",
  "IE",
  "PL",
]);

function ensureState(ctx) {
  if (!ctx.channelsTabState) {
    ctx.channelsTabState = {
      loaded: false,
      channels: null,
      amazon_market_codes: [],
      amazon_market_groups: { ...DEFAULT_MARKET_GROUPS },
      amazon_market_labels: { ...DEFAULT_MARKET_LABELS },
      seller_id_env_fallback: "",
      amazonExpanded: true,
      amazonSettingsExpanded: true,
      europaExpanded: true,
      amerikaExpanded: true,
    };
  }
  return ctx.channelsTabState;
}

function flagHtml(code, className = "ce-channels-country-row__flag") {
  const cc = String(FLAG_CODE[code] || code || "").toLowerCase();
  if (!cc || cc.length !== 2) return "";
  return `<img class="${escapeHtml(className)}" src="${FLAG_CDN}${escapeHtml(cc)}.svg" alt="" loading="lazy" />`;
}

function marketLabel(st, code) {
  return st.amazon_market_labels?.[code] || DEFAULT_MARKET_LABELS[code] || code;
}

function continentOn(st, key) {
  return !!st.channels?.amazon?.continents?.[key];
}

function marketOn(st, code) {
  return !!st.channels?.amazon?.markets?.[code];
}

function sourceMarketplace(st, key) {
  return (
    st.channels?.amazon?.source_marketplaces?.[key] ||
    DEFAULT_SOURCE[key] ||
    (key === "europa" ? "DE" : "US")
  );
}

function overrideFor(st, code) {
  return st.channels?.amazon?.market_overrides?.[code] || {};
}

function readDomChannels() {
  const amazonEnabled = !!document.getElementById("ce-ch-amazon")?.checked;
  const etsyEnabled = !!document.getElementById("ce-ch-etsy")?.checked;
  const ebayEnabled = !!document.getElementById("ce-ch-ebay")?.checked;

  const europaEl = document.querySelector('[data-ce-amazon-continent="europa"]');
  const amerikaEl = document.querySelector('[data-ce-amazon-continent="amerika"]');
  const continents = {
    europa:
      europaEl?.getAttribute("aria-pressed") === "true" || europaEl?.classList.contains("is-active"),
    amerika:
      amerikaEl?.getAttribute("aria-pressed") === "true" || amerikaEl?.classList.contains("is-active"),
  };

  const source_marketplaces = {
    europa: document.getElementById("ce-ch-amz-source-europa")?.value?.trim().toUpperCase() || "DE",
    amerika: document.getElementById("ce-ch-amz-source-amerika")?.value?.trim().toUpperCase() || "US",
  };

  const markets = {};
  for (const code of [...DEFAULT_MARKET_GROUPS.europa, ...DEFAULT_MARKET_GROUPS.amerika]) {
    markets[code] = !!document.querySelector(`[data-ce-amazon-market="${code}"]`)?.checked;
  }

  const market_overrides = {};
  for (const code of [...DEFAULT_MARKET_GROUPS.europa, ...DEFAULT_MARKET_GROUPS.amerika]) {
    const seller = document.getElementById(`ce-ch-amz-ov-seller-${code}`)?.value?.trim() || "";
    const tokenKey = document.getElementById(`ce-ch-amz-ov-token-${code}`)?.value?.trim() || "";
    if (seller || tokenKey) {
      market_overrides[code] = {
        ...(seller ? { seller_id: seller } : {}),
        ...(tokenKey ? { refresh_token_env_key: tokenKey } : {}),
      };
    }
  }

  const pricing = {
    mode: document.getElementById("ce-ch-amz-price-mode")?.value || "percent_of_retail",
    percent: Number(document.getElementById("ce-ch-amz-price-percent")?.value) || 97,
    floor: Number(document.getElementById("ce-ch-amz-price-floor")?.value) || 14.99,
    ceiling: Number(document.getElementById("ce-ch-amz-price-ceiling")?.value) || 19.99,
    fallback: Number(document.getElementById("ce-ch-amz-price-fallback")?.value) || 19.99,
    psychRound: "nearest",
    ending: 0.99,
  };
  return {
    eazpire: { enabled: true },
    amazon: {
      enabled: amazonEnabled,
      continents,
      source_marketplaces,
      markets,
      market_overrides,
      markets_version: 2,
      settings: {
        seller_id: document.getElementById("ce-ch-amz-seller")?.value?.trim() || "",
        product_type: document.getElementById("ce-ch-amz-ptype")?.value?.trim() || "SHIRT",
        browse_node: document.getElementById("ce-ch-amz-browse")?.value?.trim() || "",
        brand: document.getElementById("ce-ch-amz-brand")?.value?.trim() || "eazpire",
        merchant_shipping_group_name: document.getElementById("ce-ch-amz-ship")?.value?.trim() || "",
        pricing,
      },
    },
    etsy: { enabled: etsyEnabled },
    ebay: { enabled: ebayEnabled },
  };
}

export function snapshotChannelsTab() {
  return readDomChannels();
}

function countryRowsHtml(st, groupKey, continentActive, amazonOn) {
  const groups = st.amazon_market_groups || DEFAULT_MARKET_GROUPS;
  const codes = groups[groupKey]?.length ? groups[groupKey] : DEFAULT_MARKET_GROUPS[groupKey] || [];
  const enabled = amazonOn && continentActive;
  return `<div class="ce-channels-country-list" role="list">
    ${codes
      .map((code) => {
        const name = marketLabel(st, code);
        const checked = marketOn(st, code);
        const ready = CONTENT_READY.has(code);
        const ov = overrideFor(st, code);
        const ovId = `ce-ch-amz-ov-${code}`;
        return `<div class="ce-channels-country-row${checked ? " is-included" : ""}" role="listitem">
          ${flagHtml(code)}
          <label class="ce-channels-country-row__name" style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
            <input type="checkbox" data-ce-amazon-market="${escapeHtml(code)}" ${checked ? "checked" : ""} ${
              enabled ? "" : "disabled"
            } />
            <span>${escapeHtml(name)} (${escapeHtml(code)})</span>
          </label>
          <span class="ce-channels-country-row__meta">${
            ready ? "Publish ready" : "Content gate — planning only"
          }</span>
          <details class="ce-channels-country-ov" id="${ovId}">
            <summary class="ce-hint" style="cursor:pointer">Auth override</summary>
            <div class="ce-channels-settings-grid" style="margin-top:8px">
              <div class="field"><label for="ce-ch-amz-ov-seller-${escapeHtml(code)}">Seller ID (${escapeHtml(
                code
              )})</label>
                <input id="ce-ch-amz-ov-seller-${escapeHtml(code)}" class="input" type="text" value="${escapeHtml(
                  ov.seller_id || ""
                )}" placeholder="default = region seller" ${enabled ? "" : "disabled"} autocomplete="off" /></div>
              <div class="field"><label for="ce-ch-amz-ov-token-${escapeHtml(code)}">Refresh token env key</label>
                <input id="ce-ch-amz-ov-token-${escapeHtml(code)}" class="input" type="text" value="${escapeHtml(
                  ov.refresh_token_env_key || ""
                )}" placeholder="e.g. AMAZON_REFRESH_TOKEN_EU" ${enabled ? "" : "disabled"} autocomplete="off" /></div>
            </div>
          </details>
        </div>`;
      })
      .join("")}
  </div>`;
}

function sourceSelectHtml(st, groupKey, enabled) {
  const groups = st.amazon_market_groups || DEFAULT_MARKET_GROUPS;
  const codes = groups[groupKey] || [];
  const selected = sourceMarketplace(st, groupKey);
  const id = `ce-ch-amz-source-${groupKey}`;
  const label =
    groupKey === "europa" ? "Default source marketplace (Europa)" : "Default source marketplace (USA / Amerika)";
  const hint =
    groupKey === "europa"
      ? "Used as default when enabling Europa (usually Germany)."
      : "Used as default when enabling Amerika (usually USA).";
  return `<div class="field ce-channels-source-field">
    <label for="${id}">${escapeHtml(label)}</label>
    <select id="${id}" class="input" data-ce-amazon-source="${escapeHtml(groupKey)}" ${
      enabled ? "" : "disabled"
    }>
      ${codes
        .map(
          (code) =>
            `<option value="${escapeHtml(code)}" ${code === selected ? "selected" : ""}>${escapeHtml(
              marketLabel(st, code)
            )} (${escapeHtml(code)})</option>`
        )
        .join("")}
    </select>
    <p class="ce-hint" style="margin:4px 0 0">${escapeHtml(hint)}</p>
  </div>`;
}

function continentGroupHtml(st, groupKey, title, hint) {
  const active = continentOn(st, groupKey);
  const amazonOn = !!st.channels?.amazon?.enabled;
  const expandedKey = groupKey === "europa" ? "europaExpanded" : "amerikaExpanded";
  const expanded = st[expandedKey] !== false;
  const expandId = `ce-ch-amz-group-${groupKey}`;
  const bodyId = `ce-ch-amz-group-${groupKey}-body`;
  const toggleId = `ce-ch-amz-continent-${groupKey}`;

  return `
    <div class="ce-channels-market-group">
      <div class="ce-channels-continent-head">
        <button type="button" class="ce-channels-expand ce-channels-expand--sub" id="${expandId}" aria-expanded="${
          expanded ? "true" : "false"
        }">
          <span aria-hidden="true">${expanded ? "▾" : "▸"}</span>
          <strong>${escapeHtml(title)}</strong>
        </button>
        <button type="button"
          id="${toggleId}"
          class="ce-channels-continent-card${active ? " is-active" : ""}"
          data-ce-amazon-continent="${escapeHtml(groupKey)}"
          aria-pressed="${active ? "true" : "false"}"
          ${amazonOn ? "" : "disabled"}>
          <span class="ce-channels-continent-card__label">${escapeHtml(title)}</span>
          <span class="ce-channels-continent-card__status">${active ? "Aktiv" : "Off"}</span>
        </button>
      </div>
      <div id="${bodyId}" ${expanded ? "" : "hidden"}>
        <p class="ce-hint ce-channels-market-group__hint">${escapeHtml(hint)}</p>
        ${sourceSelectHtml(st, groupKey, amazonOn && active)}
        <p class="ce-hint" style="margin:10px 0 6px">Countries — select which marketplaces to publish (direct SP-API, no BIL):</p>
        ${countryRowsHtml(st, groupKey, active, amazonOn)}
      </div>
    </div>`;
}

function continentsHtml(st) {
  return (
    continentGroupHtml(
      st,
      "europa",
      "Europa",
      "Parent unlock for the EU account. Toggle countries below. Content-ready publish: DE, UK, FR, IT, ES, NL, BE, SE, IE, PL."
    ) +
    continentGroupHtml(
      st,
      "amerika",
      "USA / Amerika",
      "Parent unlock for North America. Toggle countries below (default US)."
    )
  );
}

function renderPanel(st) {
  const ch = st.channels || {};
  const amz = ch.amazon || {};
  const settings = amz.settings || {};
  const pricing = settings.pricing || {};
  const sellerValue = settings.seller_id || st.seller_id_env_fallback || "";
  const sellerPh = st.seller_id_env_fallback || "from env AMAZON_SELLER_ID";

  return `
    <div class="ce-tab-panel ce-channels-panel">
      <p class="ce-hint">Unlock sales channels for this product. Creators still need Skill Tree unlocks; <strong>Admin Creations</strong> ignores Skill Tree limits and only uses these unlocks. eazpire is always on.</p>
      <p class="ce-hint">Amazon: enable <strong>Europa / USA</strong> as parents, then select <strong>countries</strong> to publish. Optional auth overrides per country (separate seller token). No BIL.</p>

      <div class="ce-channels-list">
        <div class="ce-channels-row ce-channels-row--locked">
          <div>
            <strong>eazpire</strong>
            <span class="ce-hint" style="display:block;margin:0">Always enabled — cannot be disabled</span>
          </div>
          <label class="ce-switch"><input type="checkbox" checked disabled /><span>On</span></label>
        </div>

        <div class="ce-channels-row">
          <button type="button" class="ce-channels-expand" id="ce-ch-amazon-expand" aria-expanded="${
            st.amazonExpanded ? "true" : "false"
          }">
            <span aria-hidden="true">${st.amazonExpanded ? "▾" : "▸"}</span>
            <strong>Amazon</strong>
          </button>
          <label class="ce-switch">
            <input type="checkbox" id="ce-ch-amazon" ${amz.enabled ? "checked" : ""} />
            <span>Enabled</span>
          </label>
        </div>
        <div class="ce-channels-amazon" id="ce-ch-amazon-body" ${st.amazonExpanded ? "" : "hidden"}>
          <h4 class="ce-section-title" style="font-size:0.95rem">Amazon regions &amp; countries</h4>
          <p class="ce-hint">Tap Europa or USA / Amerika for the parent, then check countries to publish.</p>
          ${continentsHtml(st)}

          <button type="button" class="ce-channels-expand ce-channels-expand--sub" id="ce-ch-amz-settings-expand" aria-expanded="${
            st.amazonSettingsExpanded ? "true" : "false"
          }">
            <span aria-hidden="true">${st.amazonSettingsExpanded ? "▾" : "▸"}</span>
            <strong>Amazon settings (defaults)</strong>
          </button>
          <div id="ce-ch-amz-settings-body" ${st.amazonSettingsExpanded ? "" : "hidden"}>
            <div class="ce-channels-settings-grid">
              <div class="field"><label for="ce-ch-amz-seller">Seller ID (EU default)</label>
                <input id="ce-ch-amz-seller" class="input" type="text" value="${escapeHtml(
                  sellerValue
                )}" placeholder="${escapeHtml(sellerPh)}" autocomplete="off" /></div>
              <div class="field"><label for="ce-ch-amz-brand">Brand</label>
                <input id="ce-ch-amz-brand" class="input" type="text" value="${escapeHtml(
                  settings.brand || "eazpire"
                )}" /></div>
              <div class="field"><label for="ce-ch-amz-ptype">Product type</label>
                <input id="ce-ch-amz-ptype" class="input" type="text" value="${escapeHtml(
                  settings.product_type || "SHIRT"
                )}" /></div>
              <div class="field"><label for="ce-ch-amz-browse">Browse node</label>
                <input id="ce-ch-amz-browse" class="input" type="text" value="${escapeHtml(
                  settings.browse_node || "1760215031"
                )}" /></div>
              <div class="field" style="grid-column:1/-1"><label for="ce-ch-amz-ship">Merchant shipping group name</label>
                <input id="ce-ch-amz-ship" class="input" type="text" value="${escapeHtml(
                  settings.merchant_shipping_group_name || ""
                )}" /></div>
            </div>
            <h4 class="ce-section-title" style="font-size:0.9rem;margin-top:16px">Pricing (EUR visibility)</h4>
            <div class="ce-channels-settings-grid">
              <div class="field"><label for="ce-ch-amz-price-mode">Mode</label>
                <select id="ce-ch-amz-price-mode" class="input">
                  <option value="percent_of_retail" ${
                    pricing.mode !== "fixed" ? "selected" : ""
                  }>Percent of retail</option>
                  <option value="fixed" ${pricing.mode === "fixed" ? "selected" : ""}>Fixed EUR</option>
                </select></div>
              <div class="field"><label for="ce-ch-amz-price-percent">Percent</label>
                <input id="ce-ch-amz-price-percent" class="input" type="number" step="0.1" value="${escapeHtml(
                  String(pricing.percent ?? 97)
                )}" /></div>
              <div class="field"><label for="ce-ch-amz-price-floor">Floor</label>
                <input id="ce-ch-amz-price-floor" class="input" type="number" step="0.01" value="${escapeHtml(
                  String(pricing.floor ?? 14.99)
                )}" /></div>
              <div class="field"><label for="ce-ch-amz-price-ceiling">Ceiling</label>
                <input id="ce-ch-amz-price-ceiling" class="input" type="number" step="0.01" value="${escapeHtml(
                  String(pricing.ceiling ?? 19.99)
                )}" /></div>
              <div class="field"><label for="ce-ch-amz-price-fallback">Fallback</label>
                <input id="ce-ch-amz-price-fallback" class="input" type="number" step="0.01" value="${escapeHtml(
                  String(pricing.fallback ?? 19.99)
                )}" /></div>
            </div>
          </div>
        </div>

        <div class="ce-channels-row">
          <div>
            <strong>Etsy</strong>
            <span class="badge" style="margin-left:8px">Coming soon</span>
          </div>
          <label class="ce-switch">
            <input type="checkbox" id="ce-ch-etsy" ${ch.etsy?.enabled ? "checked" : ""} />
            <span>Enabled</span>
          </label>
        </div>
        <div class="ce-channels-row">
          <div>
            <strong>eBay</strong>
            <span class="badge" style="margin-left:8px">Coming soon</span>
          </div>
          <label class="ce-switch">
            <input type="checkbox" id="ce-ch-ebay" ${ch.ebay?.enabled ? "checked" : ""} />
            <span>Enabled</span>
          </label>
        </div>
      </div>
    </div>`;
}

function syncAmazonContinentDisabled(root) {
  const on = !!root.querySelector("#ce-ch-amazon")?.checked;
  root.querySelectorAll("[data-ce-amazon-continent]").forEach((el) => {
    el.disabled = !on;
  });
  root.querySelectorAll("[data-ce-amazon-source]").forEach((el) => {
    const key = el.getAttribute("data-ce-amazon-source");
    const cont = root.querySelector(`[data-ce-amazon-continent="${key}"]`);
    const contOn = cont?.getAttribute("aria-pressed") === "true";
    el.disabled = !on || !contOn;
  });
  root.querySelectorAll("[data-ce-amazon-market]").forEach((el) => {
    const code = el.getAttribute("data-ce-amazon-market");
    const group = DEFAULT_MARKET_GROUPS.europa.includes(code) ? "europa" : "amerika";
    const cont = root.querySelector(`[data-ce-amazon-continent="${group}"]`);
    const contOn = cont?.getAttribute("aria-pressed") === "true";
    el.disabled = !on || !contOn;
  });
}

function setContinentActive(el, on) {
  el.classList.toggle("is-active", on);
  el.setAttribute("aria-pressed", on ? "true" : "false");
  const status = el.querySelector(".ce-channels-continent-card__status");
  if (status) status.textContent = on ? "Aktiv" : "Off";
}

function rerenderChannels(ctx, st) {
  st.channels = readDomChannels();
  // When turning continent on with no countries, default DE/US
  if (st.channels.amazon.continents.europa && !Object.values(st.channels.amazon.markets || {}).some(Boolean)) {
    st.channels.amazon.markets = st.channels.amazon.markets || {};
    st.channels.amazon.markets.DE = true;
  }
  if (st.channels.amazon.continents.europa) {
    const euAny = DEFAULT_MARKET_GROUPS.europa.some((c) => st.channels.amazon.markets[c]);
    if (!euAny) st.channels.amazon.markets.DE = true;
  }
  if (st.channels.amazon.continents.amerika) {
    const amAny = DEFAULT_MARKET_GROUPS.amerika.some((c) => st.channels.amazon.markets[c]);
    if (!amAny) st.channels.amazon.markets.US = true;
  }
  const body = document.getElementById("ce-body");
  if (!body) return;
  body.innerHTML = renderPanel(st);
  bindChannelsTab(ctx, body);
  notifyActiveTabDirty(ctx);
}

export async function loadChannelsTab(ctx) {
  const st = ensureState(ctx);
  const data = await fetchChannels(ctx.productKey);
  if (!data?.ok) throw new Error(data?.error || "Failed to load channels");
  st.channels = data.channels;
  if (!st.channels.amazon.continents) {
    st.channels.amazon.continents = { europa: false, amerika: false };
  }
  if (!st.channels.amazon.source_marketplaces) {
    st.channels.amazon.source_marketplaces = { ...DEFAULT_SOURCE };
  }
  if (!st.channels.amazon.markets) st.channels.amazon.markets = {};
  if (!st.channels.amazon.market_overrides) st.channels.amazon.market_overrides = {};
  st.amazon_market_codes = data.amazon_market_codes || [];
  st.amazon_market_groups = data.amazon_market_groups || { ...DEFAULT_MARKET_GROUPS };
  st.amazon_market_labels = data.amazon_market_labels || { ...DEFAULT_MARKET_LABELS };
  st.seller_id_env_fallback = data.defaults?.seller_id_env_fallback || "";
  st.loaded = true;
  return renderPanel(st);
}

export function bindChannelsTab(ctx, root) {
  const st = ensureState(ctx);
  const panel = root || document;
  bindTabDirtyInputs(panel, ctx);

  panel.querySelector("#ce-ch-amazon-expand")?.addEventListener("click", () => {
    st.amazonExpanded = !st.amazonExpanded;
    rerenderChannels(ctx, st);
  });

  panel.querySelector("#ce-ch-amz-settings-expand")?.addEventListener("click", () => {
    st.amazonSettingsExpanded = !st.amazonSettingsExpanded;
    rerenderChannels(ctx, st);
  });

  panel.querySelector("#ce-ch-amz-group-europa")?.addEventListener("click", () => {
    st.europaExpanded = !st.europaExpanded;
    rerenderChannels(ctx, st);
  });

  panel.querySelector("#ce-ch-amz-group-amerika")?.addEventListener("click", () => {
    st.amerikaExpanded = !st.amerikaExpanded;
    rerenderChannels(ctx, st);
  });

  panel.querySelectorAll("[data-ce-amazon-continent]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.disabled) return;
      const next = el.getAttribute("aria-pressed") !== "true";
      setContinentActive(el, next);
      syncAmazonContinentDisabled(panel);
      rerenderChannels(ctx, st);
    });
  });

  panel.querySelectorAll("[data-ce-amazon-market]").forEach((el) => {
    el.addEventListener("change", () => {
      st.channels = readDomChannels();
      notifyActiveTabDirty(ctx);
    });
  });

  panel.querySelector("#ce-ch-amazon")?.addEventListener("change", () => {
    syncAmazonContinentDisabled(panel);
  });
  syncAmazonContinentDisabled(panel);
}

export async function saveChannelsTab(ctx) {
  const channels = readDomChannels();
  await saveChannels(ctx.productKey, { channels });
  const st = ensureState(ctx);
  st.channels = channels;
}
