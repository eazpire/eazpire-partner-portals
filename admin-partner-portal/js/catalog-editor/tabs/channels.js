/**
 * Catalog editor → Channels tab.
 * Unlock sales channels for this product + Amazon IDs/settings (no skill-tree limits here).
 * TODO(amazon-worldwide): single listing across regions — discuss next; unlocks only for now.
 */
import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchChannels, saveChannels } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
const FLAG_CODE = { UK: "gb", AE: "ae", SA: "sa" };

function ensureState(ctx) {
  if (!ctx.channelsTabState) {
    ctx.channelsTabState = {
      loaded: false,
      channels: null,
      amazon_market_codes: [],
      seller_id_env_fallback: "",
      amazonExpanded: true,
      amazonSettingsExpanded: true,
    };
  }
  return ctx.channelsTabState;
}

function flagHtml(code) {
  const cc = String(FLAG_CODE[code] || code || "").toLowerCase();
  if (!cc || cc.length !== 2) return "";
  return `<img class="ce-ship-flag" src="${FLAG_CDN}${escapeHtml(cc)}.svg" alt="" loading="lazy" />`;
}

function readDomChannels() {
  const amazonEnabled = !!document.getElementById("ce-ch-amazon")?.checked;
  const etsyEnabled = !!document.getElementById("ce-ch-etsy")?.checked;
  const ebayEnabled = !!document.getElementById("ce-ch-ebay")?.checked;
  const markets = {};
  document.querySelectorAll("[data-ce-amazon-market]").forEach((inp) => {
    const code = inp.getAttribute("data-ce-amazon-market");
    if (code) markets[code] = !!inp.checked;
  });
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
      markets,
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

function marketsGridHtml(st) {
  const markets = st.channels?.amazon?.markets || {};
  const codes = st.amazon_market_codes?.length
    ? st.amazon_market_codes
    : Object.keys(markets);
  return codes
    .map((code) => {
      const on = !!markets[code];
      return `<label class="ce-channels-market-card">
        ${flagHtml(code)}
        <span class="ce-channels-market-card__label">${escapeHtml(code)}</span>
        <input type="checkbox" data-ce-amazon-market="${escapeHtml(code)}" ${on ? "checked" : ""} ${
        st.channels?.amazon?.enabled ? "" : "disabled"
      } />
      </label>`;
    })
    .join("");
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
      <p class="ce-hint">TODO: Amazon worldwide single-listing strategy (one ASIN / multi-marketplace) — discuss next; region unlocks only for now.</p>

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
          <h4 class="ce-section-title" style="font-size:0.95rem">Amazon regions</h4>
          <p class="ce-hint">Only enabled regions appear in Admin Creations → Channels for this product.</p>
          <div class="ce-channels-markets">${marketsGridHtml(st)}</div>

          <button type="button" class="ce-channels-expand ce-channels-expand--sub" id="ce-ch-amz-settings-expand" aria-expanded="${
            st.amazonSettingsExpanded ? "true" : "false"
          }">
            <span aria-hidden="true">${st.amazonSettingsExpanded ? "▾" : "▸"}</span>
            <strong>Amazon settings</strong>
          </button>
          <div id="ce-ch-amz-settings-body" ${st.amazonSettingsExpanded ? "" : "hidden"}>
            <div class="ce-channels-settings-grid">
              <div class="field"><label for="ce-ch-amz-seller">Seller ID</label>
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

function syncAmazonMarketDisabled(root) {
  const on = !!root.querySelector("#ce-ch-amazon")?.checked;
  root.querySelectorAll("[data-ce-amazon-market]").forEach((inp) => {
    inp.disabled = !on;
  });
}

export async function loadChannelsTab(ctx) {
  const st = ensureState(ctx);
  const data = await fetchChannels(ctx.productKey);
  if (!data?.ok) throw new Error(data?.error || "Failed to load channels");
  st.channels = data.channels;
  st.amazon_market_codes = data.amazon_market_codes || [];
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
    st.channels = readDomChannels();
    const body = document.getElementById("ce-body");
    if (body) {
      body.innerHTML = renderPanel(st);
      bindChannelsTab(ctx, body);
      notifyActiveTabDirty(ctx);
    }
  });

  panel.querySelector("#ce-ch-amz-settings-expand")?.addEventListener("click", () => {
    st.amazonSettingsExpanded = !st.amazonSettingsExpanded;
    st.channels = readDomChannels();
    const body = document.getElementById("ce-body");
    if (body) {
      body.innerHTML = renderPanel(st);
      bindChannelsTab(ctx, body);
      notifyActiveTabDirty(ctx);
    }
  });

  panel.querySelector("#ce-ch-amazon")?.addEventListener("change", () => {
    syncAmazonMarketDisabled(panel);
  });
  syncAmazonMarketDisabled(panel);
}

export async function saveChannelsTab(ctx) {
  const channels = readDomChannels();
  await saveChannels(ctx.productKey, { channels });
  const st = ensureState(ctx);
  st.channels = channels;
}
