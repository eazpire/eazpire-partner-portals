/**
 * Admin Creations → Products modal Channels panel (creator-style UI).
 * No Skill Tree limits — only product Channels unlocks from catalog settings.
 * TODO(amazon-worldwide): single listing across regions — discuss next.
 */
import { escapeHtml } from "/creations/shared/js/partner-api.js";

const AMAZON_REGIONS = [
  { code: "DE", label: "Amazon.de" },
  { code: "FR", label: "Amazon.fr" },
  { code: "IT", label: "Amazon.it" },
  { code: "ES", label: "Amazon.es" },
  { code: "NL", label: "Amazon.nl" },
  { code: "BE", label: "Amazon.com.be" },
  { code: "PL", label: "Amazon.pl" },
  { code: "SE", label: "Amazon.se" },
  { code: "UK", label: "Amazon.co.uk" },
  { code: "IE", label: "Amazon.ie" },
  { code: "TR", label: "Amazon.com.tr" },
  { code: "AE", label: "Amazon.ae" },
  { code: "SA", label: "Amazon.sa" },
  { code: "IN", label: "Amazon.in" },
  { code: "EG", label: "Amazon.eg" },
  { code: "MX", label: "Amazon.com.mx" },
  { code: "US", label: "Amazon.com" },
  { code: "CA", label: "Amazon.ca" },
];

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
const FLAG_CODE = { UK: "gb" };

const LOGOS = {
  eazpire:
    '<img class="cr-ch-logo-img" src="https://cdn.shopify.com/s/files/1/0739/5203/5098/files/eazpire-creator-logo.png?v=1763666950" alt="" width="36" height="36" loading="lazy" />',
  amazon:
    '<span class="cr-ch-logo-text cr-ch-logo-text--amazon">amazon</span>',
  etsy: '<span class="cr-ch-logo-text cr-ch-logo-text--etsy">etsy</span>',
  ebay: '<span class="cr-ch-logo-text cr-ch-logo-text--ebay"><i>e</i><i>b</i><i>a</i><i>y</i></span>',
};

function flagHtml(code) {
  const cc = String(FLAG_CODE[code] || code || "").toLowerCase();
  if (cc.length !== 2) return "";
  return `<img class="cr-ch-flag" src="${FLAG_CDN}${escapeHtml(cc)}.svg" alt="" loading="lazy" />`;
}

function unlocksFromProduct(product) {
  const u = product?.channels?.unlocks;
  if (u && typeof u === "object") return u;
  return {
    eazpire: { enabled: true },
    amazon: { enabled: false, markets: {} },
    etsy: { enabled: false },
    ebay: { enabled: false },
  };
}

function statusHtml(st) {
  if (st?.queue) {
    return `<span class="cr-ch-status cr-ch-status--queue"><span class="cr-ch-spinner" aria-hidden="true"></span>Queue</span>`;
  }
  if (st?.status === "published") {
    return `<span class="cr-ch-status cr-ch-status--published">Published</span>`;
  }
  return `<span class="cr-ch-status">Not published</span>`;
}

function actionHtml(channel, region, st) {
  if (st?.queue) return "";
  const regionAttr = region ? ` data-cr-ch-region="${escapeHtml(region)}"` : "";
  if (st?.status === "published") {
    return `<button type="button" class="btn btn-secondary cr-ch-btn" data-cr-ch-unpublish="${escapeHtml(
      channel
    )}"${regionAttr}>Unpublish</button>`;
  }
  return `<button type="button" class="btn btn-primary cr-ch-btn" data-cr-ch-publish="${escapeHtml(
    channel
  )}"${regionAttr}>Publish</button>`;
}

/**
 * @param {object} product
 * @param {{ channelState: Record<string, {status:string,queue:boolean}>; amazonExpanded: boolean }} ui
 */
export function renderChannelsPanelHtml(product, ui) {
  const unlocks = unlocksFromProduct(product);
  const showAmazon = !!unlocks.amazon?.enabled;
  const showEtsy = !!unlocks.etsy?.enabled;
  const showEbay = !!unlocks.ebay?.enabled;
  const markets = unlocks.amazon?.markets || {};
  const regions = AMAZON_REGIONS.filter((r) => !!markets[r.code]);
  const eaz = ui.channelState["eazpire"] || { status: "published", queue: false };

  let amzPublished = 0;
  for (const r of regions) {
    if ((ui.channelState[`amazon:${r.code}`] || {}).status === "published") amzPublished++;
  }

  const tiles = [];
  tiles.push(`<article class="cr-ch-tile cr-ch-tile--eazpire" role="listitem">
    ${LOGOS.eazpire}
    <div class="cr-ch-tile__top"><h4>eazpire</h4>${statusHtml(eaz)}</div>
    <div class="cr-ch-actions">${actionHtml("eazpire", "", eaz)}</div>
  </article>`);

  if (showAmazon) {
    const amzSt =
      amzPublished > 0 ? { status: "published", queue: false } : { status: "unpublished", queue: false };
    tiles.push(`<article class="cr-ch-tile cr-ch-tile--amazon ${
      ui.amazonExpanded ? "cr-ch-tile--expanded" : ""
    }" role="listitem" data-cr-ch-amazon-tile>
      ${LOGOS.amazon}
      <div class="cr-ch-tile__top"><h4>Amazon</h4>${statusHtml(amzSt)}</div>
      <p class="cr-ch-tile__meta">${ui.amazonExpanded ? "▾" : "▸"} Amazon regions · ${amzPublished}/${
      regions.length
    }</p>
    </article>`);
  }

  if (showEtsy) {
    tiles.push(`<article class="cr-ch-tile cr-ch-tile--soon" role="listitem">
      ${LOGOS.etsy}
      <div class="cr-ch-tile__top"><h4>Etsy</h4><span class="cr-ch-badge-soon">Coming soon</span></div>
    </article>`);
  }
  if (showEbay) {
    tiles.push(`<article class="cr-ch-tile cr-ch-tile--soon" role="listitem">
      ${LOGOS.ebay}
      <div class="cr-ch-tile__top"><h4>eBay</h4><span class="cr-ch-badge-soon">Coming soon</span></div>
    </article>`);
  }

  if (!showAmazon && !showEtsy && !showEbay) {
    tiles.push(
      `<p class="cr-pd-hint" style="grid-column:1/-1">Only eazpire is unlocked. Enable Amazon / Etsy / eBay in Admin Catalog Editor → Channels.</p>`
    );
  }

  let regionsHtml = "";
  if (showAmazon && ui.amazonExpanded) {
    if (!regions.length) {
      regionsHtml = `<p class="cr-pd-hint">Amazon is enabled but no regions are unlocked. Open Catalog Editor → Channels.</p>`;
    } else {
      regionsHtml = `<div class="cr-ch-regions" role="list">${regions
        .map((r) => {
          const st = ui.channelState[`amazon:${r.code}`] || { status: "unpublished", queue: false };
          return `<div class="cr-ch-region" role="listitem">
            <div class="cr-ch-region__head">${flagHtml(r.code)}<strong>${escapeHtml(r.code)}</strong>
              <span>${escapeHtml(r.label)}</span></div>
            ${statusHtml(st)}
            <div class="cr-ch-actions">${actionHtml("amazon", r.code, st)}</div>
          </div>`;
        })
        .join("")}</div>`;
    }
  }

  return `
    <div class="cr-ch-panel">
      <h3 class="cr-pd-section-title">Channels</h3>
      <p class="cr-pd-hint">Admin mode — Skill Tree limits ignored. Publish uses unlocked channels only.</p>
      <div class="cr-ch-track" role="list">${tiles.join("")}</div>
      ${regionsHtml}
    </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ channelState: object; amazonExpanded: boolean; onChange: () => void }} ui
 */
export function bindChannelsPanel(root, ui) {
  if (!root) return;
  root.querySelector("[data-cr-ch-amazon-tile]")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-cr-ch-publish],[data-cr-ch-unpublish]")) return;
    ui.amazonExpanded = !ui.amazonExpanded;
    ui.onChange();
  });

  root.querySelectorAll("[data-cr-ch-publish],[data-cr-ch-unpublish]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const publish = btn.hasAttribute("data-cr-ch-publish");
      const channel = btn.getAttribute("data-cr-ch-publish") || btn.getAttribute("data-cr-ch-unpublish");
      const region = btn.getAttribute("data-cr-ch-region") || "";
      const key = region ? `${channel}:${region}` : channel;
      if (!ui.channelState[key]) ui.channelState[key] = { status: "unpublished", queue: false };
      const st = ui.channelState[key];
      if (st.queue) return;
      st.queue = true;
      ui.onChange();
      // Phase 1 UX stub — real admin-publish queue wiring follows creator modal Phase 2.
      // Admin path must use publish_source=admin-publish (skips Skill Tree + listing limits).
      window.setTimeout(() => {
        st.queue = false;
        st.status = publish ? "published" : "unpublished";
        ui.onChange();
      }, 1200);
    });
  });
}

export function renderOverviewPanelHtml(product) {
  const unlocks = unlocksFromProduct(product);
  const unlocked = ["eazpire"];
  if (unlocks.amazon?.enabled) unlocked.push("Amazon");
  if (unlocks.etsy?.enabled) unlocked.push("Etsy");
  if (unlocks.ebay?.enabled) unlocked.push("eBay");
  return `
    <div class="cr-pd-overview">
      <h3 class="cr-pd-section-title">Overview</h3>
      <p class="cr-pd-hint">Stats placeholders — same structure as Creator Product Preview. Channel data will attach later.</p>
      <div class="cr-pd-overview-stats">
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Sales</span><strong>—</strong></div>
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Add to cart</span><strong>—</strong></div>
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Impressions</span><strong>—</strong></div>
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Clicks</span><strong>—</strong></div>
      </div>
      <p class="cr-pd-hint">Unlocked channels: ${escapeHtml(unlocked.join(" · "))}</p>
    </div>`;
}
