/**
 * Catalog editor → Shipping tab.
 * Ships-from origins + per-country rates (USD), grouped by continent.
 * Printify catalog products get official sync; Todify / partner products use manual entry only.
 */
import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast } from "/partner/shared/js/partner-shell.js";
import { fetchShipping, saveShipping, syncShipping } from "../api.js";
import { bindTabDirtyInputs, notifyActiveTabDirty } from "../editor-tab-dirty.js";
import { providerLabel } from "../editor-subnav.js";
import { isPartnerOrTodifyProduct } from "../print-area/helpers.js";
import {
  buildContinentGroups,
  countryDisplayName,
  worldCountryCatalog,
} from "../market-country-picker.js";

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";

/** Printify sync UI only for Printify catalog products (not Todify / direct_shopify partners). */
function usesPrintifyShippingSync(ctx) {
  return !isPartnerOrTodifyProduct(ctx);
}

function resolveShippingProviderId(ctx) {
  const raw = ctx.selectedPrintProviderId;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && String(n) === String(raw).trim()) return n;
  const s = String(raw ?? "").trim();
  if (s) return s;
  return null;
}

function ensureState(ctx) {
  if (!ctx.shippingTabState) {
    ctx.shippingTabState = {
      loaded: false,
      print_provider_id: null,
      printifySync: false,
      ships_from: [],
      network_origins: [],
      ships_from_note: null,
      continents: [],
      currency: "USD",
      last_synced_at: null,
      sync_source: null,
      sync_error: null,
      sync_message: null,
      shipping_rates_url: null,
      openContinents: new Set(["EU", "NA", "OTHER", "OC"]),
    };
  }
  return ctx.shippingTabState;
}

function rateCountryLabel(code, fallback) {
  const c = String(code || "").toUpperCase();
  if (c === "ROW") return "Rest of the World";
  return fallback || countryDisplayName(c) || c;
}

function centsToUsdInput(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

function usdInputToCents(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function formatSyncedAt(ts) {
  if (!ts) return "";
  try {
    return new Date(Number(ts)).toLocaleString();
  } catch {
    return "";
  }
}

function flagHtml(code) {
  const cc = String(code || "").toLowerCase();
  if (!cc || cc.length !== 2) return "";
  return `<img class="ce-ship-flag" src="${FLAG_CDN}${escapeHtml(cc)}.svg" alt="" loading="lazy" />`;
}

function shipsFromHtml(shipsFrom, opts = {}) {
  const printifySync = !!opts.printifySync;
  const list = Array.isArray(shipsFrom) ? shipsFrom : [];
  const selected = new Set(list.map((s) => String(s.code || "").toUpperCase()));
  const emptyHint = printifySync
    ? "No ships-from countries yet. Sync from Printify or add one below."
    : "No ships-from countries yet. Add one below.";
  const chips = list.length
    ? list
        .map((s) => {
          const code = String(s.code || "").toUpperCase();
          const label = s.label || countryDisplayName(code) || code;
          return `<label class="ce-ship-from-chip is-on">
            <input type="checkbox" class="ce-ship-from-check" data-ships-from="${escapeHtml(code)}" checked />
            ${flagHtml(code)}
            <span class="ce-ship-from-chip__label">Ships from ${escapeHtml(label)}</span>
          </label>`;
        })
        .join("")
    : `<p class="ce-hint" id="ce-ship-from-empty">${emptyHint}</p>`;

  // Network partners are Printify Choice–specific; hide for Todify / partner products.
  const network = printifySync && Array.isArray(opts.network_origins) ? opts.network_origins : [];
  const networkChips = network
    .filter((s) => !selected.has(String(s.code || "").toUpperCase()))
    .map((s) => {
      const code = String(s.code || "").toUpperCase();
      const label = s.label || countryDisplayName(code) || code;
      return `<button type="button" class="ce-ship-from-chip ce-ship-network-add" data-network-add="${escapeHtml(code)}" title="Add as Ships from">
        ${flagHtml(code)}
        <span class="ce-ship-from-chip__label">${escapeHtml(label)}</span>
        <span class="ce-ship-network-add__plus">+</span>
      </button>`;
    })
    .join("");

  const note =
    printifySync && opts.ships_from_note
      ? `<p class="ce-hint">${escapeHtml(opts.ships_from_note)}</p>`
      : `<p class="ce-hint">These labels appear in Creator Journey Overview as “Ships from …”. Uncheck a chip to remove it before saving.</p>`;

  const networkBlock = networkChips
    ? `<div class="ce-ship-network">
        <h4 class="ce-ship-network__title">Network partners (not yet in Ships from)</h4>
        <p class="ce-hint">Click + to add. After Sync, partners are usually already included under Ships from.</p>
        <div class="ce-ship-from-grid">${networkChips}</div>
      </div>`
    : network.length
      ? `<p class="ce-hint">All known network partner countries are already included in Ships from.</p>`
      : "";

  const addOptions = (worldCountryCatalog().allCodes || [])
    .map((code) => {
      const cc = String(code).toUpperCase();
      return `<option value="${escapeHtml(cc)}">${escapeHtml(countryDisplayName(cc) || cc)} (${escapeHtml(cc)})</option>`;
    })
    .join("");

  return `
    <div class="ce-ship-from-grid" id="ce-ship-from-grid">${chips}</div>
    ${note}
    ${networkBlock}
    <div class="ce-ship-add-row">
      <label>Add ships-from country
        <select class="input" id="ce-ship-from-add-select">
          <option value="">Select country…</option>
          ${addOptions}
        </select>
      </label>
      <button type="button" class="btn btn-secondary" id="ce-ship-from-add-btn">Add</button>
    </div>
  `;
}

function continentRatesHtml(continents, openSet, opts = {}) {
  const printifySync = !!opts.printifySync;
  if (!continents?.length) {
    const emptyHint = printifySync
      ? `No destination rates yet. Use <strong>Sync from Printify</strong> or add countries manually below.`
      : `No destination rates yet. Add countries manually below.`;
    return `<p class="ce-hint" id="ce-ship-empty-rates">${emptyHint}</p>
      <div class="ce-ship-add-row">
        <label>Add country / zone
          <input type="text" class="input" id="ce-ship-add-code" maxlength="3" placeholder="DE or ROW" />
        </label>
        <button type="button" class="btn btn-secondary" id="ce-ship-add-country">Add country</button>
      </div>
      <div id="ce-ship-continents"></div>`;
  }

  const blocks = continents
    .map((cont) => {
      const open = openSet?.has(cont.code) ? " open" : "";
      const countries = cont.countries || [];
      const rows = countries
        .map((c) => {
          const label = rateCountryLabel(c.code, c.label);
          return `<div class="ce-ship-rate-row" data-country="${escapeHtml(c.code)}">
            <div class="ce-ship-rate-row__country">
              ${flagHtml(c.code)}
              <span>${escapeHtml(label)}</span>
              <code>${escapeHtml(c.code)}</code>
            </div>
            <label class="ce-ship-rate-field">
              <span>1st item (USD)</span>
              <input type="number" class="input ce-ship-first" min="0" step="0.01"
                data-country="${escapeHtml(c.code)}"
                value="${escapeHtml(centsToUsdInput(c.shipping_first_cents))}" />
            </label>
            <label class="ce-ship-rate-field">
              <span>Additional (USD)</span>
              <input type="number" class="input ce-ship-additional" min="0" step="0.01"
                data-country="${escapeHtml(c.code)}"
                value="${escapeHtml(centsToUsdInput(c.shipping_additional_cents))}" />
            </label>
          </div>`;
        })
        .join("");

      return `<details class="ce-ship-continent" data-continent="${escapeHtml(cont.code)}"${open}>
        <summary class="ce-ship-continent__summary">
          <span>${escapeHtml(cont.title || cont.code)}</span>
          <span class="ce-ship-continent__count">${countries.length} countries</span>
        </summary>
        <div class="ce-ship-continent__bulk">
          <label>1st item
            <input type="number" class="input ce-ship-bulk-first" min="0" step="0.01" placeholder="2.99" data-bulk-continent="${escapeHtml(cont.code)}" />
          </label>
          <label>Additional
            <input type="number" class="input ce-ship-bulk-additional" min="0" step="0.01" placeholder="1.19" data-bulk-continent="${escapeHtml(cont.code)}" />
          </label>
          <button type="button" class="btn btn-secondary ce-ship-bulk-apply" data-bulk-apply="${escapeHtml(cont.code)}">
            Apply to continent
          </button>
        </div>
        <div class="ce-ship-rate-list">${rows}</div>
      </details>`;
    })
    .join("");

  return `
    <div class="ce-ship-add-row">
      <label>Add country / zone
        <input type="text" class="input" id="ce-ship-add-code" maxlength="3" placeholder="DE or ROW" />
      </label>
      <button type="button" class="btn btn-secondary" id="ce-ship-add-country">Add country</button>
    </div>
    <div id="ce-ship-continents">${blocks}</div>`;
}

function destinationRatesHintHtml(printifySync) {
  if (printifySync) {
    return `<p class="ce-hint">1st item = first product · Additional = each extra. Sync expands <strong>ROW</strong> (Rest of the World) onto every country without a dedicated zone (US/CA/AU keep API prices). Use “Apply to continent” to overwrite a whole group.</p>`;
  }
  return `<p class="ce-hint">1st item = first product in the order · Additional = each extra product. Use “Apply to continent” to copy values to every country in that group.</p>`;
}

function printifySyncSectionHtml(state, pname, pid) {
  return `<section class="ce-meta-card">
        <h3 class="ce-section-title">Printify sync</h3>
        <p class="ce-hint">Load official ships-from + destination rates (USD) for <strong>${escapeHtml(pname)}</strong> (provider ${escapeHtml(String(pid))}).</p>
        <div class="ce-ship-sync-bar">
          <button type="button" class="btn btn-primary" id="ce-ship-sync">Sync from Printify</button>
        </div>
        <div id="ce-ship-sync-status">${syncBannerHtml(state)}</div>
      </section>`;
}

function syncBannerHtml(state) {
  const parts = [];
  if (state.sync_message) {
    parts.push(`<p class="ce-ship-sync-msg">${escapeHtml(state.sync_message)}</p>`);
  }
  if (state.sync_error) {
    parts.push(`<p class="ce-ship-sync-error">${escapeHtml(state.sync_error)}</p>`);
  }
  if (state.last_synced_at) {
    const src = state.sync_source ? ` · source: ${state.sync_source}` : "";
    parts.push(
      `<p class="ce-hint">Last sync: ${escapeHtml(formatSyncedAt(state.last_synced_at))}${escapeHtml(src)}</p>`
    );
  }
  if (state.shipping_rates_url) {
    parts.push(
      `<p class="ce-hint"><a href="${escapeHtml(state.shipping_rates_url)}" target="_blank" rel="noopener">Open Printify shipping page</a></p>`
    );
  }
  return parts.join("");
}

function readShipsFromFromDom(root) {
  const out = [];
  root.querySelectorAll(".ce-ship-from-check:checked").forEach((input) => {
    const code = String(input.getAttribute("data-ships-from") || "").toUpperCase();
    if (!code) return;
    out.push({ code, label: countryDisplayName(code) || code });
  });
  return out;
}

function readRatesFromDom(root) {
  const rates = [];
  root.querySelectorAll(".ce-ship-rate-row").forEach((row) => {
    const code = String(row.getAttribute("data-country") || "").toUpperCase();
    if (!code) return;
    const firstEl = row.querySelector(".ce-ship-first");
    const addEl = row.querySelector(".ce-ship-additional");
    rates.push({
      country_code: code,
      country_label: rateCountryLabel(code),
      shipping_first_cents: usdInputToCents(firstEl?.value),
      shipping_additional_cents: usdInputToCents(addEl?.value),
    });
  });
  return rates;
}

function rebuildContinentsFromRates(rates) {
  const groups = buildContinentGroups();
  const codeToCont = new Map();
  for (const g of groups) {
    for (const c of g.countries || []) {
      codeToCont.set(String(c).toUpperCase(), g.id);
    }
  }
  const byCont = new Map();
  for (const r of rates) {
    const contCode = r.country_code === "ROW" ? "OTHER" : codeToCont.get(r.country_code) || "OTHER";
    if (!byCont.has(contCode)) {
      const g = groups.find((x) => x.id === contCode);
      byCont.set(contCode, {
        code: contCode,
        title: contCode === "OTHER" ? "Other / zones" : g?.label || contCode,
        countries: [],
      });
    }
    byCont.get(contCode).countries.push({
      code: r.country_code,
      label: rateCountryLabel(r.country_code, r.country_label),
      shipping_first_cents: r.shipping_first_cents,
      shipping_additional_cents: r.shipping_additional_cents,
    });
  }
  const order = ["EU", "NA", "SA", "AS", "AF", "OC", "AN", "OTHER"];
  return order
    .filter((c) => byCont.has(c))
    .map((c) => {
      const block = byCont.get(c);
      block.countries.sort((a, b) => a.label.localeCompare(b.label, "en"));
      return block;
    });
}

export async function loadShippingTab(ctx) {
  const state = ensureState(ctx);
  const pid = resolveShippingProviderId(ctx);
  if (pid == null) {
    return `<div class="ce-tab-panel ce-ship-panel">
      <p class="ce-hint">Select an active provider in the subnav to configure shipping.</p>
    </div>`;
  }

  const printifySync = usesPrintifyShippingSync(ctx);
  const data = await fetchShipping(ctx.productKey, pid);
  state.loaded = true;
  state.print_provider_id = pid;
  state.printifySync = printifySync;
  state.ships_from = Array.isArray(data.ships_from) ? data.ships_from : [];
  state.network_origins = printifySync && Array.isArray(data.network_origins) ? data.network_origins : [];
  state.ships_from_note = printifySync ? data.ships_from_note || null : null;
  state.continents = Array.isArray(data.continents) ? data.continents : [];
  state.currency = data.currency || "USD";
  state.last_synced_at = printifySync ? data.last_synced_at ?? null : null;
  state.sync_source = printifySync ? data.sync_source || null : null;
  state.sync_error = printifySync ? data.sync_error || null : null;
  state.sync_message = null;
  state.shipping_rates_url = null;

  const pname = providerLabel(ctx, pid);
  const syncSection = printifySync ? printifySyncSectionHtml(state, pname, pid) : "";

  return `
    <div class="ce-tab-panel ce-ship-panel${printifySync ? "" : " ce-ship-panel--manual"}">
      ${syncSection}

      <section class="ce-meta-card">
        <h3 class="ce-section-title">Ships from</h3>
        ${shipsFromHtml(state.ships_from, {
          printifySync,
          network_origins: state.network_origins,
          ships_from_note: state.ships_from_note,
        })}
      </section>

      <section class="ce-meta-card">
        <h3 class="ce-section-title">Destination rates (USD)</h3>
        ${destinationRatesHintHtml(printifySync)}
        ${continentRatesHtml(state.continents, state.openContinents, { printifySync })}
      </section>
    </div>`;
}

export function snapshotShippingTab(ctx) {
  const root = document.getElementById("ce-body");
  if (!root?.querySelector(".ce-ship-panel")) return null;
  const state = ensureState(ctx);
  return {
    print_provider_id: state.print_provider_id || resolveShippingProviderId(ctx),
    ships_from: readShipsFromFromDom(root),
    rates: readRatesFromDom(root),
    currency: "USD",
  };
}

function remountRatesSection(ctx, root) {
  const state = ensureState(ctx);
  const printifySync = !!state.printifySync;
  const cards = root.querySelectorAll(".ce-meta-card");
  const ratesCard = [...cards].find((c) => c.querySelector("#ce-ship-continents") || c.querySelector("#ce-ship-add-country"));
  if (!ratesCard) return;
  ratesCard.innerHTML =
    '<h3 class="ce-section-title">Destination rates (USD)</h3>' +
    destinationRatesHintHtml(printifySync) +
    continentRatesHtml(state.continents, state.openContinents, { printifySync });
  bindRatesControls(ctx, root);
  notifyActiveTabDirty(ctx);
}

function bindRatesControls(ctx, root) {
  const state = ensureState(ctx);

  root.querySelectorAll(".ce-ship-continent").forEach((details) => {
    details.addEventListener("toggle", () => {
      const code = details.getAttribute("data-continent");
      if (!code) return;
      if (details.open) state.openContinents.add(code);
      else state.openContinents.delete(code);
    });
  });

  root.querySelectorAll(".ce-ship-bulk-apply").forEach((btn) => {
    btn.onclick = () => {
      const cont = btn.getAttribute("data-bulk-apply");
      const block = root.querySelector(`.ce-ship-continent[data-continent="${cont}"]`);
      if (!block) return;
      const first = block.querySelector(".ce-ship-bulk-first")?.value;
      const add = block.querySelector(".ce-ship-bulk-additional")?.value;
      block.querySelectorAll(".ce-ship-first").forEach((input) => {
        if (first !== "" && first != null) input.value = Number(first).toFixed(2);
      });
      block.querySelectorAll(".ce-ship-additional").forEach((input) => {
        if (add !== "" && add != null) input.value = Number(add).toFixed(2);
      });
      notifyActiveTabDirty(ctx);
    };
  });

  const addBtn = root.querySelector("#ce-ship-add-country");
  const addInput = root.querySelector("#ce-ship-add-code");
  if (addBtn && addInput) {
    addBtn.onclick = () => {
      const code = String(addInput.value || "")
        .trim()
        .toUpperCase();
      if (!(code === "ROW" || /^[A-Z]{2}$/.test(code))) {
        showToast("Invalid code", "Enter a 2-letter ISO code (e.g. DE) or ROW");
        return;
      }
      const rates = readRatesFromDom(root);
      if (rates.some((r) => r.country_code === code)) {
        showToast("Already listed", `${code} is already in the list`);
        return;
      }
      rates.push({
        country_code: code,
        country_label: rateCountryLabel(code),
        shipping_first_cents: 0,
        shipping_additional_cents: 0,
      });
      state.continents = rebuildContinentsFromRates(rates);
      remountRatesSection(ctx, root);
      addInput.value = "";
    };
  }
}

function remountShipsFromSection(ctx, root) {
  const state = ensureState(ctx);
  const printifySync = !!state.printifySync;
  const shipsCard = [...root.querySelectorAll(".ce-meta-card")].find((c) =>
    c.querySelector("#ce-ship-from-grid")
  );
  if (!shipsCard) return;
  const title = shipsCard.querySelector(".ce-section-title");
  shipsCard.innerHTML =
    (title ? title.outerHTML : '<h3 class="ce-section-title">Ships from</h3>') +
    shipsFromHtml(state.ships_from, {
      printifySync,
      network_origins: state.network_origins,
      ships_from_note: state.ships_from_note,
    });
  bindShipsFromControls(ctx, root);
  notifyActiveTabDirty(ctx);
}

function bindShipsFromControls(ctx, root) {
  const state = ensureState(ctx);
  const addBtn = root.querySelector("#ce-ship-from-add-btn");
  const select = root.querySelector("#ce-ship-from-add-select");
  if (addBtn && select) {
    addBtn.onclick = () => {
      const code = String(select.value || "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) return;
      const existing = readShipsFromFromDom(root);
      if (existing.some((s) => s.code === code)) {
        showToast("Already listed", `${code} is already a ships-from country`);
        return;
      }
      state.ships_from = [...existing, { code, label: countryDisplayName(code) || code }];
      remountShipsFromSection(ctx, root);
      select.value = "";
    };
  }
  root.querySelectorAll("[data-network-add]").forEach((btn) => {
    btn.onclick = () => {
      const code = String(btn.getAttribute("data-network-add") || "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) return;
      const existing = readShipsFromFromDom(root);
      if (existing.some((s) => s.code === code)) return;
      state.ships_from = [...existing, { code, label: countryDisplayName(code) || code }];
      remountShipsFromSection(ctx, root);
    };
  });
}

export function bindShippingTab(ctx, root) {
  const state = ensureState(ctx);
  bindTabDirtyInputs(root, ctx);
  bindRatesControls(ctx, root);
  bindShipsFromControls(ctx, root);

  const syncBtn = root.querySelector("#ce-ship-sync");
  if (syncBtn && state.printifySync) {
    syncBtn.onclick = async () => {
      const pid = resolveShippingProviderId(ctx);
      if (pid == null) return;
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing…";
      try {
        const res = await syncShipping(ctx.productKey, {
          print_provider_id: pid,
          provider_name: providerLabel(ctx, pid),
        });
        state.ships_from = Array.isArray(res.ships_from) ? res.ships_from : [];
        state.network_origins = Array.isArray(res.network_origins) ? res.network_origins : [];
        state.ships_from_note = res.ships_from_note || state.ships_from_note;
        state.continents = Array.isArray(res.continents) ? res.continents : [];
        state.last_synced_at = res.last_synced_at ?? null;
        state.sync_source = res.sync_source || null;
        state.sync_error = res.sync_error || null;
        state.sync_message = res.sync_message || null;
        state.shipping_rates_url = res.shipping_rates_url || null;

        const status = root.querySelector("#ce-ship-sync-status");
        if (status) status.innerHTML = syncBannerHtml(state);
        remountShipsFromSection(ctx, root);
        remountRatesSection(ctx, root);
        notifyActiveTabDirty(ctx);
        showToast(
          res.sync_ok ? "Synced" : "Sync incomplete",
          res.sync_message || res.sync_error || "Done"
        );
      } catch (err) {
        state.sync_error = err?.message || "Sync failed";
        state.sync_message =
          "Printify sync failed. You can enter ships-from and rates manually, then Save tab.";
        const status = root.querySelector("#ce-ship-sync-status");
        if (status) status.innerHTML = syncBannerHtml(state);
        showToast("Sync failed", state.sync_error);
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync from Printify";
      }
    };
  }
}

export async function saveShippingTab(ctx) {
  const snap = snapshotShippingTab(ctx);
  if (!snap?.print_provider_id) {
    throw new Error("Select a provider before saving shipping");
  }
  await saveShipping(ctx.productKey, {
    print_provider_id: snap.print_provider_id,
    ships_from: snap.ships_from,
    rates: snap.rates,
    currency: "USD",
  });
  ctx.shippingTabState = null;
}
