/**
 * Admin Creations — Amazon EU marketplace selector (parent EU + per-country).
 * PLATFORM_SPECIFIC — admin.eazpire.com/creations/products
 *
 * Keep codes in sync with:
 * - src/features/catalog/productChannelsConfig.js → AMAZON_CHANNEL_MARKET_GROUPS.europa
 * - src/amazon/amazonMarketplaceContentGate.js → AMAZON_CONTENT_READY_MARKET_CODES
 */

import { escapeHtml } from "/creations/shared/js/partner-api.js";

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
const FLAG_CODE = { UK: "gb" };

/** Same order as Catalog Channels EU group. */
export const AMAZON_EU_CHANNEL_CODES = Object.freeze([
  "FR",
  "NL",
  "PL",
  "UK",
  "DE",
  "ES",
  "IE",
  "SE",
  "BE",
  "IT",
]);

/** Content-ready EU markets (publishable via SP-API listing path). */
export const AMAZON_EU_CONTENT_READY_CODES = Object.freeze(
  AMAZON_EU_CHANNEL_CODES.filter((c) =>
    ["DE", "UK", "FR", "IT", "ES", "NL", "BE", "SE", "IE", "PL"].includes(c)
  )
);

export const AMAZON_EU_MARKET_LABELS = Object.freeze({
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
});

function flagHtml(code) {
  const cc = String(FLAG_CODE[code] || code || "").toLowerCase();
  if (cc.length !== 2) return "";
  return `<img class="cr-amz-eu-sel__flag" src="${FLAG_CDN}${escapeHtml(cc)}.svg" alt="" loading="lazy" />`;
}

/**
 * Normalize / filter to content-ready EU codes (stable Channels order).
 * @param {string[]|null|undefined} codes
 * @returns {string[]}
 */
export function normalizeAmazonEuMarketCodes(codes) {
  const wanted = new Set(
    (Array.isArray(codes) ? codes : [])
      .map((c) => String(c || "").trim().toUpperCase())
      .filter(Boolean)
  );
  return AMAZON_EU_CONTENT_READY_CODES.filter((c) => wanted.has(c));
}

/**
 * Default selection: content-ready EU markets except paused Sweden (SE).
 * Softstyle Channels/Automations SE is off for new publishes; check SE manually to re-include.
 * @returns {string[]}
 */
export function defaultAmazonEuMarketCodes() {
  return AMAZON_EU_CONTENT_READY_CODES.filter((c) => c !== "SE");
}

/**
 * @param {string[]} codes
 * @returns {string}
 */
export function formatAmazonEuTargetsLabel(codes) {
  const list = normalizeAmazonEuMarketCodes(codes);
  if (!list.length) return "no markets";
  if (list.length === AMAZON_EU_CONTENT_READY_CODES.length) return "Amazon EU (all)";
  if (list.length === 1) return `Amazon ${list[0]}`;
  if (list.length <= 4) return `Amazon ${list.join(", ")}`;
  return `Amazon EU (${list.length} markets)`;
}

/**
 * @param {number} productCount
 * @param {string[]} codes
 */
export function formatAmazonEuPublishTitle(productCount, codes) {
  const targets = formatAmazonEuTargetsLabel(codes);
  const n = Number(productCount) || 0;
  if (n <= 1) return `Publish to ${targets}`;
  return `Publish ${n} products to ${targets}`;
}

/**
 * @param {string[]} codes
 */
export function formatAmazonEuPublishMessage(codes) {
  const list = normalizeAmazonEuMarketCodes(codes);
  const targets =
    list.length === AMAZON_EU_CONTENT_READY_CODES.length
      ? "all content-ready EU marketplaces"
      : list.length
        ? list.join(", ")
        : "no markets";
  return `Direct publish to ${targets} (no BIL). Toggle EU for all countries, or pick individually. Products already listed on Amazon DE are excluded from this list.`;
}

/**
 * Render EU parent + country checkboxes.
 * @param {{ rootId?: string, selectedCodes?: string[] }} [opts]
 */
export function amazonEuMarketsSelectorHtml(opts = {}) {
  const rootId = opts.rootId || "cr-amz-eu-sel";
  const selected = new Set(
    normalizeAmazonEuMarketCodes(opts.selectedCodes || defaultAmazonEuMarketCodes())
  );
  const allOn = AMAZON_EU_CONTENT_READY_CODES.every((c) => selected.has(c));
  const someOn = AMAZON_EU_CONTENT_READY_CODES.some((c) => selected.has(c));

  const countries = AMAZON_EU_CONTENT_READY_CODES.map((code) => {
    const label = AMAZON_EU_MARKET_LABELS[code] || code;
    const checked = selected.has(code) ? "checked" : "";
    return `<label class="cr-amz-eu-sel__country">
      <input type="checkbox" class="cr-amz-eu-sel__cb" data-amz-eu-code="${escapeHtml(code)}" ${checked} />
      ${flagHtml(code)}
      <span class="cr-amz-eu-sel__code">${escapeHtml(code)}</span>
      <span class="cr-amz-eu-sel__name">${escapeHtml(label)}</span>
    </label>`;
  }).join("");

  return `<div class="cr-amz-eu-sel" id="${escapeHtml(rootId)}" data-amz-eu-sel>
    <label class="cr-amz-eu-sel__parent">
      <input type="checkbox" class="cr-amz-eu-sel__parent-cb" data-amz-eu-parent ${
        allOn ? "checked" : ""
      } ${!allOn && someOn ? "data-indeterminate=\"1\"" : ""} />
      <span class="cr-amz-eu-sel__parent-label"><strong>EU</strong> — all content-ready Amazon EU marketplaces</span>
    </label>
    <div class="cr-amz-eu-sel__countries" role="group" aria-label="Amazon EU countries">${countries}</div>
  </div>`;
}

/**
 * @param {ParentNode|null} root
 * @returns {string[]}
 */
export function readAmazonEuMarketsSelection(root) {
  if (!root) return [];
  const codes = [...root.querySelectorAll(".cr-amz-eu-sel__cb:checked")].map(
    (cb) => cb.getAttribute("data-amz-eu-code") || ""
  );
  return normalizeAmazonEuMarketCodes(codes);
}

/**
 * Wire parent ↔ children sync and optional onChange.
 * @param {ParentNode|null} root
 * @param {{ onChange?: (codes: string[]) => void }} [opts]
 */
export function bindAmazonEuMarketsSelector(root, opts = {}) {
  if (!root) return;
  const parentCb = root.querySelector("[data-amz-eu-parent]");
  const childCbs = () => [...root.querySelectorAll(".cr-amz-eu-sel__cb")];

  function syncParentFromChildren() {
    if (!parentCb) return;
    const kids = childCbs();
    const checked = kids.filter((cb) => cb.checked).length;
    parentCb.checked = checked > 0 && checked === kids.length;
    parentCb.indeterminate = checked > 0 && checked < kids.length;
  }

  function emit() {
    if (typeof opts.onChange === "function") opts.onChange(readAmazonEuMarketsSelection(root));
  }

  parentCb?.addEventListener("change", () => {
    const on = !!parentCb.checked;
    for (const cb of childCbs()) cb.checked = on;
    parentCb.indeterminate = false;
    emit();
  });

  for (const cb of childCbs()) {
    cb.addEventListener("change", () => {
      syncParentFromChildren();
      emit();
    });
  }

  if (parentCb?.getAttribute("data-indeterminate") === "1") {
    parentCb.indeterminate = true;
  } else {
    syncParentFromChildren();
  }
}
