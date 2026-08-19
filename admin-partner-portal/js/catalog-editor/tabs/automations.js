import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveAutomations } from "../api.js";
import { getVersionsForProvider, versionDisplayName } from "../editor-subnav.js";
import { bindTabDirtyInputs } from "../editor-tab-dirty.js";

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
const FLAG_CODE = { UK: "gb" };

const EU_CODES = ["FR", "NL", "PL", "UK", "DE", "ES", "IE", "SE", "BE", "IT"];
const NA_CODES = ["CA", "US"];
const ALL_CODES = [...EU_CODES, ...NA_CODES];

const MARKET_LABELS = {
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

function asBool(v) {
  return v === true || v === 1 || v === "1" || String(v || "").toLowerCase() === "true";
}

function flagHtml(code) {
  const cc = String(FLAG_CODE[code] || code || "").toLowerCase();
  if (!cc || cc.length !== 2) return "";
  return `<img class="ce-channels-country-row__flag" src="${FLAG_CDN}${escapeHtml(cc)}.svg" alt="" loading="lazy" />`;
}

function normalizeUseSettings(raw) {
  return String(raw || "").trim().toLowerCase() === "admin" ? "admin" : "creator";
}

function emptyMarkets() {
  const out = {};
  for (const code of ALL_CODES) out[code] = false;
  return out;
}

function normalizeMarkets(raw, amazonOn) {
  const out = emptyMarkets();
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const code of ALL_CODES) {
    if (src[code] != null) out[code] = asBool(src[code]);
  }
  if (amazonOn && !ALL_CODES.some((code) => out[code])) {
    for (const code of EU_CODES) out[code] = true;
  }
  return out;
}

function euMasterOn(markets) {
  return EU_CODES.every((code) => !!markets[code]);
}

function readUseSettings() {
  const checked = document.querySelector('input[name="ce-auto-use-settings"]:checked');
  return normalizeUseSettings(checked?.value);
}

function readMarketsFromDom() {
  const out = emptyMarkets();
  for (const code of ALL_CODES) {
    out[code] = !!document.querySelector(`[data-ce-auto-amz="${code}"]`)?.checked;
  }
  return out;
}

function switchRow(id, label, hint, checked) {
  return `
    <div class="ce-auto-switch-row">
      <div>
        <strong>${escapeHtml(label)}</strong>
        ${hint ? `<span class="ce-hint" style="display:block;margin:0">${escapeHtml(hint)}</span>` : ""}
      </div>
      <label class="ce-mock-source-switch">
        <input type="checkbox" id="${escapeHtml(id)}" ${checked ? "checked" : ""} />
        <span class="ce-mock-source-switch__track" aria-hidden="true"></span>
        <span class="ce-mock-source-switch__text">On</span>
      </label>
    </div>`;
}

function countryRow(code, checked, enabled) {
  return `<label class="ce-auto-amz-country${checked ? " is-on" : ""}">
    ${flagHtml(code)}
    <input type="checkbox" data-ce-auto-amz="${escapeHtml(code)}" ${checked ? "checked" : ""} ${
      enabled ? "" : "disabled"
    } />
    <span>${escapeHtml(MARKET_LABELS[code] || code)} (${escapeHtml(code)})</span>
  </label>`;
}

export function renderAutomationsTab(ctx) {
  const versions = getVersionsForProvider(ctx, ctx.selectedPrintProviderId);
  const version =
    versions.find((v) => String(v.id) === String(ctx.selectedVersionId)) || versions[0] || null;
  const auto = version?.auto_publish_config || {};
  const useSettings = normalizeUseSettings(auto.use_settings || auto.automation_use_settings);
  const amazonOn = asBool(auto.automation_amazon_publish_enabled);
  const markets = normalizeMarkets(auto.amazon_markets || auto.automation_amazon_markets, amazonOn);
  const euOn = euMasterOn(markets);
  const versionHint = version
    ? ` · ${escapeHtml(versionDisplayName(version, versions.indexOf(version)))}`
    : "";

  if (!ctx.automationsTabState) ctx.automationsTabState = { amazonExpanded: amazonOn };
  const amazonExpanded = ctx.automationsTabState.amazonExpanded !== false;

  return `
    <div class="ce-tab-panel ce-auto-panel">
      <p class="ce-hint">Settings apply to this product only${versionHint}. New designs after save, and older unpublished designs, join the existing publish queue (not all live at once).</p>

      <section class="ce-auto-card">
        <h3 class="ce-section-title">Use Settings</h3>
        <p class="ce-hint">Creator keeps the creator’s variants, print area, and Skill Tree unlocks. Admin publishes like Admin Designs bulk publish (catalog variants and print area; Skill Tree ignored).</p>
        <div class="ce-auto-segment" role="radiogroup" aria-label="Use Settings">
          <label class="ce-auto-segment__opt${useSettings === "creator" ? " is-active" : ""}">
            <input type="radio" name="ce-auto-use-settings" value="creator" ${
              useSettings === "creator" ? "checked" : ""
            } />
            <span>Creator</span>
          </label>
          <label class="ce-auto-segment__opt${useSettings === "admin" ? " is-active" : ""}">
            <input type="radio" name="ce-auto-use-settings" value="admin" ${
              useSettings === "admin" ? "checked" : ""
            } />
            <span>Admin</span>
          </label>
        </div>
      </section>

      <section class="ce-auto-card">
        <h3 class="ce-section-title">Auto Publish</h3>
        ${switchRow("ce-auto-publish", "Printify", "Create Printify drafts for this product.", asBool(auto.auto_publish_enabled))}
        ${switchRow("ce-auto-shopify", "Shopify", "Sync this product to the shop after Printify.", asBool(auto.automation_shopify_sync_enabled))}

        <div class="ce-auto-switch-row">
          <button type="button" class="ce-channels-expand" id="ce-auto-amazon-expand" aria-expanded="${
            amazonExpanded ? "true" : "false"
          }">
            <span aria-hidden="true">${amazonExpanded ? "▾" : "▸"}</span>
            <strong>Amazon</strong>
          </button>
          <label class="ce-mock-source-switch">
            <input type="checkbox" id="ce-auto-amazon" ${amazonOn ? "checked" : ""} />
            <span class="ce-mock-source-switch__track" aria-hidden="true"></span>
            <span class="ce-mock-source-switch__text">On</span>
          </label>
        </div>
        <div class="ce-auto-amazon" id="ce-auto-amazon-body" ${amazonExpanded ? "" : "hidden"}>
          <p class="ce-hint">EU countries first. Master toggle turns all EU markets on or off. This product only — not the rest of the catalog. Channel listing IDs stay on the Channels tab.</p>
          ${switchRow("ce-auto-amz-eu", "All EU countries", "Turns every EU marketplace on or off.", euOn && amazonOn)}
          <div class="ce-auto-amz-list" role="list">
            ${EU_CODES.map((code) => countryRow(code, markets[code], amazonOn)).join("")}
          </div>
          <p class="ce-hint" style="margin:12px 0 6px">North America</p>
          <div class="ce-auto-amz-list" role="list">
            ${NA_CODES.map((code) => countryRow(code, markets[code], amazonOn)).join("")}
          </div>
        </div>
      </section>
    </div>`;
}

export function snapshotAutomationsTab() {
  return {
    use_settings: readUseSettings(),
    auto_publish_enabled: !!document.getElementById("ce-auto-publish")?.checked,
    automation_shopify_sync_enabled: !!document.getElementById("ce-auto-shopify")?.checked,
    automation_amazon_publish_enabled: !!document.getElementById("ce-auto-amazon")?.checked,
    amazon_markets: readMarketsFromDom(),
  };
}

function syncAmazonDisabled(root) {
  const on = !!root.querySelector("#ce-auto-amazon")?.checked;
  const eu = root.querySelector("#ce-auto-amz-eu");
  if (eu) eu.disabled = !on;
  root.querySelectorAll("[data-ce-auto-amz]").forEach((el) => {
    el.disabled = !on;
  });
}

function syncEuMasterFromCountries(root) {
  const markets = readMarketsFromDom();
  const eu = root.querySelector("#ce-auto-amz-eu");
  if (eu) eu.checked = euMasterOn(markets) && !!root.querySelector("#ce-auto-amazon")?.checked;
}

function setSegmentActive(root) {
  root.querySelectorAll(".ce-auto-segment__opt").forEach((lab) => {
    const on = !!lab.querySelector("input")?.checked;
    lab.classList.toggle("is-active", on);
  });
}

export function bindAutomationsTab(ctx, root) {
  const el = root || document;
  bindTabDirtyInputs(el, ctx);
  if (!ctx.automationsTabState) ctx.automationsTabState = { amazonExpanded: true };

  const expand = el.querySelector("#ce-auto-amazon-expand");
  const body = el.querySelector("#ce-auto-amazon-body");
  expand?.addEventListener("click", () => {
    const next = body?.hasAttribute("hidden");
    ctx.automationsTabState.amazonExpanded = !!next;
    if (body) body.toggleAttribute("hidden", !next);
    if (expand) {
      expand.setAttribute("aria-expanded", next ? "true" : "false");
      const chev = expand.querySelector("span");
      if (chev) chev.textContent = next ? "▾" : "▸";
    }
  });

  el.querySelector("#ce-auto-amazon")?.addEventListener("change", () => {
    const on = !!el.querySelector("#ce-auto-amazon")?.checked;
    ctx.automationsTabState.amazonExpanded = true;
    if (body) body.removeAttribute("hidden");
    if (on) {
      const any = ALL_CODES.some((code) => el.querySelector(`[data-ce-auto-amz="${code}"]`)?.checked);
      if (!any) {
        for (const code of EU_CODES) {
          const box = el.querySelector(`[data-ce-auto-amz="${code}"]`);
          if (box) box.checked = true;
        }
      }
    }
    syncAmazonDisabled(el);
    syncEuMasterFromCountries(el);
  });

  el.querySelector("#ce-auto-amz-eu")?.addEventListener("change", () => {
    const on = !!el.querySelector("#ce-auto-amz-eu")?.checked;
    for (const code of EU_CODES) {
      const box = el.querySelector(`[data-ce-auto-amz="${code}"]`);
      if (box && !box.disabled) box.checked = on;
    }
  });

  el.querySelectorAll("[data-ce-auto-amz]").forEach((box) => {
    box.addEventListener("change", () => syncEuMasterFromCountries(el));
  });

  el.querySelectorAll('input[name="ce-auto-use-settings"]').forEach((radio) => {
    radio.addEventListener("change", () => setSegmentActive(el));
  });

  syncAmazonDisabled(el);
  syncEuMasterFromCountries(el);
}

export async function saveAutomationsTab(ctx) {
  const versionId = ctx.selectedVersionId;
  if (!versionId) return;
  await saveAutomations(versionId, {
    use_settings: readUseSettings(),
    auto_publish_enabled: document.getElementById("ce-auto-publish")?.checked,
    automation_shopify_sync_enabled: document.getElementById("ce-auto-shopify")?.checked,
    automation_amazon_publish_enabled: document.getElementById("ce-auto-amazon")?.checked,
    amazon_markets: readMarketsFromDom(),
    auto_mirror: false,
  });
}
