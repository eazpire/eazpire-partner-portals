/**
 * Admin Creations → Products modal Channels panel (creator-style UI).
 * No Skill Tree limits — only product Channels unlocks from catalog settings.
 * Amazon publish targets = continents (Europa → DE source, USA → US) for this phase.
 */
import { escapeHtml, partnerFetch } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";

const FLAG_CDN = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
const FLAG_CODE = { UK: "gb" };

const LOGOS = {
  eazpire:
    '<img class="cr-ch-logo-img" src="https://cdn.shopify.com/s/files/1/0739/5203/5098/files/eazpire-creator-logo.png?v=1763666950" alt="" width="36" height="36" loading="lazy" />',
  amazon: '<span class="cr-ch-logo-text cr-ch-logo-text--amazon">amazon</span>',
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
    amazon: { enabled: false, continents: { europa: false, amerika: false }, markets: {} },
    etsy: { enabled: false },
    ebay: { enabled: false },
  };
}

/**
 * Continent publish targets — prefer API amazon_publish_targets (DE + US phase).
 */
function amazonTargetsFromProduct(product) {
  const apiTargets = product?.channels?.amazon_publish_targets;
  if (Array.isArray(apiTargets) && apiTargets.length) {
    return apiTargets.map((t) => ({
      continent: t.continent,
      label: t.label || (t.continent === "amerika" ? "USA / Amerika" : "Europa"),
      source: t.source_marketplace || (t.continent === "amerika" ? "US" : "DE"),
      publishCodes: t.publish_marketplace_codes || [t.source_marketplace || "DE"],
    }));
  }

  const unlocks = unlocksFromProduct(product);
  const amz = unlocks?.amazon || {};
  if (!amz.enabled) return [];
  const continents = amz.continents || {};
  const markets = amz.markets || {};
  const src = amz.source_marketplaces || {};
  const targets = [];

  const europaOn =
    continents.europa === true ||
    ["FR", "NL", "PL", "UK", "DE", "ES", "IE", "SE", "BE", "IT"].some((c) => !!markets[c]);
  const amerikaOn = continents.amerika === true || !!markets.US || !!markets.CA;

  if (europaOn) {
    const source = src.europa || "DE";
    targets.push({
      continent: "europa",
      label: "Europa",
      source,
      publishCodes: [source],
    });
  }
  if (amerikaOn) {
    targets.push({
      continent: "amerika",
      label: "USA / Amerika",
      source: src.amerika || "US",
      publishCodes: ["US"],
    });
  }
  return targets;
}

function amazonLinkHtml(st) {
  const productUrl = st?.product_url || null;
  const scUrl = st?.seller_central_url || null;
  if (!productUrl && !scUrl) return "";
  const parts = [];
  if (productUrl) {
    parts.push(
      `<a class="cr-ch-amzlink" href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">Open on Amazon</a>`
    );
  }
  if (scUrl) {
    parts.push(
      `<a class="cr-ch-amzlink cr-ch-amzlink--sc" href="${escapeHtml(scUrl)}" target="_blank" rel="noopener noreferrer">Seller Central</a>`
    );
  }
  return `<div class="cr-ch-amzlinks">${parts.join(" · ")}</div>`;
}

function statusHtml(st) {
  if (st?.queue) {
    return `<span class="cr-ch-status cr-ch-status--queue"><span class="cr-ch-spinner" aria-hidden="true"></span>${escapeHtml(
      st.queueLabel || "Working…"
    )}</span>`;
  }
  if (st?.status === "published") {
    const asinHint = st.asin ? ` · ${st.asin}` : "";
    return `<span class="cr-ch-status cr-ch-status--published">Published${escapeHtml(
      asinHint
    )}</span>`;
  }
  if (st?.status === "publishing" || st?.status === "queued") {
    return `<span class="cr-ch-status cr-ch-status--queue"><span class="cr-ch-spinner" aria-hidden="true"></span>${escapeHtml(
      st.status === "queued" ? "Live queued" : "Publishing…"
    )}</span>`;
  }
  if (st?.status === "dry_run_ok") {
    return `<span class="cr-ch-status cr-ch-status--published">Dry run OK</span>`;
  }
  if (st?.status === "dry_run_failed") {
    return `<span class="cr-ch-status cr-ch-status--failed">Dry run failed</span>`;
  }
  if (st?.status === "failed") {
    return `<span class="cr-ch-status cr-ch-status--failed">Failed</span>`;
  }
  return `<span class="cr-ch-status">Not published</span>`;
}

function formatMarketplaceErrors(m) {
  const errs = Array.isArray(m?.errors) ? m.errors.filter(Boolean) : [];
  if (errs.length) return errs;
  if (m?.credentials?.ok === false && m.credentials.error) {
    return [`credentials: ${m.credentials.error}`];
  }
  return [];
}

function errorsListHtml(errors) {
  const list = (errors || []).filter(Boolean);
  if (!list.length) return "";
  return `<ul class="cr-ch-errors" role="list">${list
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join("")}</ul>`;
}

function dryRunBannerHtml(product) {
  const dr = product?.amazon_publish?.dry_run;
  if (!dr) return "";
  const markets = dr.marketplaces || [];
  const codes = markets.map((m) => m.code).join(", ") || "—";
  const cls = dr.ok ? "cr-ch-dryok" : "cr-ch-dryfail";
  const failLines = markets
    .filter((m) => !m.ok)
    .map((m) => {
      const errs = formatMarketplaceErrors(m);
      return `${m.code || "?"}: ${errs.length ? errs.join("; ") : "failed"}`;
    });
  return `<div class="cr-ch-drybanner ${cls}" role="status">
    <strong>Last dry run:</strong> ${dr.ok ? "OK" : "Failed"}
    · markets ${escapeHtml(codes)}
    ${dr.summary ? `· ${dr.summary.ok || 0}/${dr.summary.total || 0} ok` : ""}
    ${
      failLines.length
        ? `<div class="cr-ch-drybanner__errors">${failLines
            .map((line) => `<div>${escapeHtml(line)}</div>`)
            .join("")}</div>`
        : ""
    }
  </div>`;
}

/**
 * partnerFetch throws when ok===false (HTTP 422 dry-run with marketplace errors).
 * Recover DRY_RUN payloads so continent cards can show marketplaces[].errors.
 */
function extractAmazonPublishResponse(errOrData) {
  const candidates = [errOrData, errOrData?.data].filter(Boolean);
  for (const data of candidates) {
    if (
      data &&
      typeof data === "object" &&
      (Array.isArray(data.marketplaces) || data.mode === "DRY_RUN" || data.mode === "LIVE")
    ) {
      return data;
    }
  }
  return null;
}

/**
 * @param {object} product
 * @param {{ channelState: Record<string, object>; amazonExpanded: boolean }} ui
 */
export function renderChannelsPanelHtml(product, ui) {
  const unlocks = unlocksFromProduct(product);
  const showAmazon = !!unlocks.amazon?.enabled;
  const showEtsy = !!unlocks.etsy?.enabled;
  const showEbay = !!unlocks.ebay?.enabled;
  const targets = amazonTargetsFromProduct(product);
  const eaz = ui.channelState["eazpire"] || { status: "published", queue: false };

  let amzPublished = 0;
  let amzDryOk = 0;
  for (const t of targets) {
    const st = ui.channelState[`amazon:${t.continent}`] || {};
    if (st.status === "published" || st.status === "queued" || st.status === "publishing") {
      amzPublished++;
    }
    if (st.status === "dry_run_ok") amzDryOk++;
  }

  const tiles = [];
  tiles.push(`<article class="cr-ch-tile cr-ch-tile--eazpire" role="listitem">
    ${LOGOS.eazpire}
    <div class="cr-ch-tile__top"><h4>eazpire</h4>${statusHtml(eaz)}</div>
    <div class="cr-ch-actions"></div>
  </article>`);

  if (showAmazon) {
    const amzSt =
      amzPublished > 0
        ? { status: "published", queue: false }
        : amzDryOk > 0
          ? { status: "dry_run_ok", queue: false }
          : { status: "unpublished", queue: false };
    const publishLabels = targets.map((t) => (t.publishCodes || []).join("/")).filter(Boolean);
    tiles.push(`<article class="cr-ch-tile cr-ch-tile--amazon ${
      ui.amazonExpanded ? "cr-ch-tile--expanded" : ""
    }" role="listitem" data-cr-ch-amazon-tile>
      ${LOGOS.amazon}
      <div class="cr-ch-tile__top"><h4>Amazon</h4>${statusHtml(amzSt)}</div>
      <p class="cr-ch-tile__meta">${ui.amazonExpanded ? "▾" : "▸"} Continents · ${
      amzPublished || amzDryOk
    }/${targets.length}${
      publishLabels.length ? ` · publish ${escapeHtml(publishLabels.join(" + "))}` : ""
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
    if (!targets.length) {
      regionsHtml = `<p class="cr-pd-hint">Amazon is enabled but no continent is Aktiv. Open Catalog Editor → Channels and enable Europa and/or USA.</p>`;
    } else {
      const pdId = product?.published_design_id || product?.amazon_publish?.published_design_id;
      regionsHtml = `${dryRunBannerHtml(product)}
      <p class="cr-pd-hint">Phase: publish/dry-run only <strong>DE</strong> (Europa source) and <strong>USA</strong>. Other EU markets are display-only until Amazon BIL is set up.${
        pdId ? ` · published_design #${escapeHtml(String(pdId))}` : " · ⚠ no published_design linked"
      }</p>
      <div class="cr-ch-regions" role="list">${targets
        .map((t) => {
          const st = ui.channelState[`amazon:${t.continent}`] || {
            status: "unpublished",
            queue: false,
          };
          const flagCode = t.continent === "amerika" ? "US" : t.source || "DE";
          const publishCode = (t.publishCodes && t.publishCodes[0]) || t.source || "DE";
          const codesHint =
            t.continent === "europa"
              ? `Publish → Amazon ${publishCode} (source ${t.source}) · EU list display-only`
              : `Publish → Amazon USA · source ${t.source}`;
          const canAct = !st.queue;
          const isPublished = st.status === "published";
          const dryOk = st.status === "dry_run_ok" || isPublished;
          const errors = Array.isArray(st.errors) ? st.errors : [];
          return `<div class="cr-ch-region" role="listitem" data-cr-ch-continent="${escapeHtml(
            t.continent
          )}">
            <div class="cr-ch-region__head">${flagHtml(flagCode)}<strong>${escapeHtml(
              t.label
            )}</strong>
              <span>${escapeHtml(codesHint)}</span></div>
            ${statusHtml(st)}
            ${amazonLinkHtml(st)}
            <div class="cr-ch-actions">
              ${
                canAct
                  ? `<button type="button" class="btn btn-secondary cr-ch-btn" data-cr-ch-dryrun="amazon" data-cr-ch-region="${escapeHtml(
                      t.continent
                    )}">Dry run</button>`
                  : ""
              }
              ${
                canAct && !isPublished
                  ? `<button type="button" class="btn btn-primary cr-ch-btn" data-cr-ch-publish="amazon" data-cr-ch-region="${escapeHtml(
                      t.continent
                    )}" ${dryOk ? "" : 'title="Run Dry run first (recommended)"'}>Publish live</button>`
                  : ""
              }
              ${
                canAct && (isPublished || st.status === "failed" || st.status === "publishing")
                  ? `<button type="button" class="btn btn-secondary cr-ch-btn" data-cr-ch-sync="amazon" data-cr-ch-region="${escapeHtml(
                      t.continent
                    )}">Refresh from Amazon</button>`
                  : ""
              }
            </div>
            ${
              st.lastMessage
                ? `<p class="cr-pd-hint cr-ch-lastmsg">${escapeHtml(st.lastMessage)}</p>`
                : ""
            }
            ${errorsListHtml(errors)}
          </div>`;
        })
        .join("")}
      </div>`;
    }
  }

  return `
    <div class="cr-ch-panel">
      <h3 class="cr-pd-section-title">Channels</h3>
      <p class="cr-pd-hint">Admin mode — Skill Tree limits ignored. Amazon dry-run builds payloads &amp; checks credentials; <strong>Publish live</strong> creates real Amazon offers.</p>
      <div class="cr-ch-track" role="list">${tiles.join("")}</div>
      ${regionsHtml}
    </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ channelState: object; amazonExpanded: boolean; onChange: () => void; product: object; onProductPatch?: (p: object) => void }} ui
 */
export function bindChannelsPanel(root, ui) {
  if (!root) return;
  root.querySelector("[data-cr-ch-amazon-tile]")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-cr-ch-publish],[data-cr-ch-dryrun],[data-cr-ch-sync]")) return;
    ui.amazonExpanded = !ui.amazonExpanded;
    ui.onChange();
  });

  const product = ui.product;
  const shopifyId = product?.id;
  const publishedDesignId =
    product?.published_design_id || product?.amazon_publish?.published_design_id || null;

  function applyAmazonPublishResult(data, { continents, live }) {
    const keys = (continents || []).map((c) => `amazon:${c}`);
    const resultsByContinent = {};
    for (const m of data.marketplaces || []) {
      resultsByContinent[m.continent] = m;
    }

    for (const key of keys.length
      ? keys
      : Object.keys(ui.channelState).filter((k) => k.startsWith("amazon:"))) {
      const continent = key.replace(/^amazon:/, "");
      const m = resultsByContinent[continent];
      const st = ui.channelState[key] || { status: "unpublished", queue: false };
      st.queue = false;
      if (live && data.queued) {
        st.status = "queued";
        st.lastMessage = data.message || `Job ${data.job_id || ""}`;
        st.errors = [];
      } else if (m) {
        const errs = formatMarketplaceErrors(m);
        st.status = m.ok ? "dry_run_ok" : "dry_run_failed";
        st.errors = m.ok ? [] : errs;
        st.lastMessage = m.ok
          ? `${m.code}: payload OK${m.credentials?.ok ? " · credentials OK" : ""}`
          : errs.slice(0, 3).join("; ") || "failed";
      } else if (data.ok && !live) {
        st.status = "dry_run_ok";
        st.lastMessage = data.message || "Dry run OK";
        st.errors = [];
      } else if (!data.ok) {
        st.status = "dry_run_failed";
        const summaries = data.error_summaries || data.summary?.errors || [];
        st.errors = summaries.length ? summaries : [data.message || data.error || "failed"].filter(Boolean);
        st.lastMessage = st.errors[0] || data.message || data.error || "failed";
      }
      ui.channelState[key] = st;
    }

    if (ui.onProductPatch && data.mode === "DRY_RUN") {
      ui.onProductPatch({
        amazon_publish: {
          published_design_id: data.published_design_id || publishedDesignId,
          dry_run: {
            ok: !!data.ok,
            mode: data.mode,
            summary: data.summary || null,
            saved_at: Date.now(),
            marketplaces: (data.marketplaces || []).map((m) => ({
              ok: m.ok,
              code: m.code,
              continent: m.continent,
              errors: formatMarketplaceErrors(m),
              credentials: m.credentials
                ? { ok: !!m.credentials.ok, error: m.credentials.error || null }
                : undefined,
            })),
          },
        },
        published_design_id: data.published_design_id || publishedDesignId,
      });
    }

    const toastDetail =
      data.message ||
      (data.ok
        ? "OK"
        : (data.error_summaries || data.summary?.errors || []).join(" | ") || data.error || "Finished with errors");
    showToast(live ? "Amazon live" : "Amazon dry run", toastDetail);
  }

  async function runAmazonAction({ continents, live }) {
    const keys = (continents || []).map((c) => `amazon:${c}`);
    for (const key of keys) {
      if (!ui.channelState[key]) ui.channelState[key] = { status: "unpublished", queue: false };
      ui.channelState[key].queue = true;
      ui.channelState[key].queueLabel = live ? "Publishing…" : "Dry run…";
      ui.channelState[key].lastMessage = "";
      ui.channelState[key].errors = [];
    }
    ui.onChange();

    try {
      const body = {
        shopify_product_id: shopifyId,
        published_design_id: publishedDesignId || undefined,
        continents: continents && continents.length ? continents : undefined,
        dry_run: !live,
        live_submit: !!live,
      };
      if (live) {
        body.dry_run = false;
        body.live_submit = true;
      }

      let data;
      try {
        data = await partnerFetch("admin-amazon-publish", {
          method: "POST",
          body,
        });
      } catch (e) {
        // Dry-run with marketplace failures returns HTTP 422 + ok:false — still a usable payload.
        const recovered = extractAmazonPublishResponse(e);
        if (recovered) {
          data = recovered;
        } else {
          throw e;
        }
      }

      if (live && data?.skipped && !data?.queued) {
        applyContinentMap(data.continents || {}, continents || []);
        showToast(
          "Amazon live",
          data.message || "Already published — nothing enqueued (no duplicate publish)."
        );
      } else {
        applyAmazonPublishResult(data, { continents, live });
        if (live && data?.queued && data?.published_design_id) {
          pollAmazonPublishStatus(data.published_design_id, continents || []);
        }
      }
    } catch (e) {
      for (const key of keys) {
        if (!ui.channelState[key]) continue;
        ui.channelState[key].queue = false;
        ui.channelState[key].status = "dry_run_failed";
        ui.channelState[key].lastMessage = e.message || String(e);
        ui.channelState[key].errors = [e.message || String(e)];
      }
      showToast("Amazon error", e.message || String(e));
    }
    ui.onChange();
  }

  function applyContinentMap(contMap, continents) {
    const keys = (continents || []).map((c) => `amazon:${c}`);
    for (const key of keys.length
      ? keys
      : Object.keys(ui.channelState).filter((k) => k.startsWith("amazon:"))) {
      const continent = key.replace(/^amazon:/, "");
      const cont = contMap[continent];
      if (!cont) continue;
      const st = ui.channelState[key] || { status: "unpublished", queue: false };
      st.queue = cont.status === "publishing" || cont.status === "queued";
      st.queueLabel = cont.status === "queued" ? "Live queued" : "Publishing…";
      st.status = cont.status;
      st.asin = cont.asin || null;
      st.product_url = cont.product_url || null;
      st.seller_central_url = cont.seller_central_url || null;
      st.lastMessage = [cont.code, cont.asin ? `ASIN ${cont.asin}` : cont.amazon_sku, cont.last_error]
        .filter(Boolean)
        .join(" · ");
      st.errors = cont.status === "failed" && cont.last_error ? [cont.last_error] : [];
      ui.channelState[key] = st;
    }
  }

  /**
   * After LIVE enqueue, refresh continent cards from amazon_listing
   * (queued → publishing → published) without reopening the modal.
   */
  async function pollAmazonPublishStatus(publishedDesignId, continents) {
    const id = Number(publishedDesignId);
    if (!Number.isFinite(id) || id <= 0) return;
    const delays = [4000, 8000, 15000, 25000, 40000];
    for (let i = 0; i < delays.length; i++) {
      await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const query = { published_design_id: String(id) };
        if (i === delays.length - 1) query.sync = "1";
        const data = await partnerFetch("admin-amazon-publish-status", { query });
        const contMap = data?.continents || {};
        applyContinentMap(contMap, continents || []);
        let anyTerminal = true;
        for (const c of continents || []) {
          const cont = contMap[c];
          if (!cont || cont.status === "publishing" || cont.status === "queued") anyTerminal = false;
        }
        if (ui.onProductPatch) {
          ui.onProductPatch({
            amazon_publish: {
              published_design_id: id,
              continents: contMap,
              listings: data.listings || [],
            },
            published_design_id: id,
          });
        }
        ui.onChange();
        if (anyTerminal) break;
      } catch {
        /* keep polling */
      }
    }
  }

  async function syncAmazonContinent(region) {
    const key = `amazon:${region}`;
    if (!ui.channelState[key]) ui.channelState[key] = { status: "unpublished", queue: false };
    ui.channelState[key].queue = true;
    ui.channelState[key].queueLabel = "Refreshing…";
    ui.onChange();
    try {
      const data = await partnerFetch("admin-amazon-sync-listing", {
        method: "POST",
        body: {
          shopify_product_id: shopifyId,
          published_design_id: publishedDesignId || undefined,
          continents: [region],
        },
      });
      applyContinentMap(data?.continents || {}, [region]);
      if (ui.onProductPatch) {
        ui.onProductPatch({
          amazon_publish: {
            published_design_id: data?.published_design_id || publishedDesignId,
            continents: data?.continents || {},
            listings: data?.listings || [],
          },
          published_design_id: data?.published_design_id || publishedDesignId,
        });
      }
      const cont = data?.continents?.[region];
      showToast(
        "Amazon sync",
        cont?.asin
          ? `${cont.code || region}: ASIN ${cont.asin}`
          : cont?.seller_central_url
            ? "Synced — open Seller Central if ASIN not ready yet"
            : data?.sync?.ok
              ? "Synced"
              : data?.sync?.error || "Sync finished"
      );
    } catch (e) {
      ui.channelState[key].queue = false;
      ui.channelState[key].lastMessage = e.message || String(e);
      showToast("Amazon sync error", e.message || String(e));
    }
    ui.channelState[key].queue = false;
    ui.onChange();
  }

  root.querySelectorAll("[data-cr-ch-dryrun]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const region = btn.getAttribute("data-cr-ch-region");
      if (!region) return;
      runAmazonAction({ continents: [region], live: false });
    });
  });

  root.querySelectorAll("[data-cr-ch-publish]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const region = btn.getAttribute("data-cr-ch-region");
      if (!region) return;
      const st = ui.channelState[`amazon:${region}`] || {};
      if (st.status === "published") {
        window.alert(
          "This continent is already marked published.\n\nUse “Refresh from Amazon” for the live link, or contact support to force-republish."
        );
        return;
      }
      if (st.status !== "dry_run_ok" && st.status !== "queued") {
        const ok = window.confirm(
          "Dry run has not succeeded for this continent yet.\n\nPublish LIVE anyway? This creates real Amazon offers."
        );
        if (!ok) return;
      } else {
        const ok = window.confirm(
          "Publish LIVE to Amazon?\n\nThis creates real listings/offers (not a dry run)."
        );
        if (!ok) return;
      }
      runAmazonAction({ continents: [region], live: true });
    });
  });

  root.querySelectorAll("[data-cr-ch-sync]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const region = btn.getAttribute("data-cr-ch-region");
      if (!region) return;
      syncAmazonContinent(region);
    });
  });

}

export function renderOverviewPanelHtml(product) {
  const unlocks = unlocksFromProduct(product);
  const unlocked = ["eazpire"];
  if (unlocks.amazon?.enabled) unlocked.push("Amazon");
  if (unlocks.etsy?.enabled) unlocked.push("Etsy");
  if (unlocks.ebay?.enabled) unlocked.push("eBay");
  const targets = amazonTargetsFromProduct(product);
  const targetLabels = targets
    .map((t) => `${t.label}→${(t.publishCodes || []).join(",")}`)
    .join(" · ") || "none";
  const dr = product?.amazon_publish?.dry_run;
  const failHint =
    dr && !dr.ok
      ? (dr.marketplaces || [])
          .filter((m) => !m.ok)
          .map((m) => `${m.code}: ${(m.errors || []).join("; ") || "failed"}`)
          .join(" · ")
      : "";
  return `
    <div class="cr-pd-overview">
      <h3 class="cr-pd-section-title">Overview</h3>
      <p class="cr-pd-hint">Admin product modal — same structure as Creator Product Preview. Skill Tree limits ignored.</p>
      <div class="cr-pd-overview-stats">
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Sales</span><strong>—</strong></div>
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Add to cart</span><strong>—</strong></div>
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Impressions</span><strong>—</strong></div>
        <div class="cr-pd-stat"><span class="cr-pd-stat__label">Clicks</span><strong>—</strong></div>
      </div>
      <p class="cr-pd-hint">Unlocked channels: ${escapeHtml(unlocked.join(" · "))}</p>
      <p class="cr-pd-hint">Amazon publish targets: ${escapeHtml(targetLabels)}</p>
      ${
        product?.published_design_id
          ? `<p class="cr-pd-hint">published_design_id: ${escapeHtml(String(product.published_design_id))}</p>`
          : `<p class="cr-pd-hint">No published_design linked — Amazon publish needs a Shopify-published design row.</p>`
      }
      ${
        dr
          ? `<p class="cr-pd-hint">Last Amazon dry run: ${dr.ok ? "OK" : "Failed"}${
              dr.summary ? ` (${dr.summary.ok}/${dr.summary.total})` : ""
            }</p>${
              failHint
                ? `<p class="cr-pd-hint cr-ch-lastmsg">${escapeHtml(failHint)}</p>`
                : ""
            }`
          : ""
      }
    </div>`;
}

/**
 * Seed channelState from product amazon_publish continents (live listings)
 * and dry_run markers. Live / publishing status wins over dry-run.
 */
export function seedChannelStateFromProduct(product) {
  const state = { eazpire: { status: "published", queue: false } };
  const targets = amazonTargetsFromProduct(product);
  const drMarkets = product?.amazon_publish?.dry_run?.marketplaces || [];
  const continents = product?.amazon_publish?.continents || {};
  for (const t of targets) {
    const cont = continents[t.continent];
    const contStatus = String(cont?.status || "").toLowerCase();
    if (
      cont &&
      (contStatus === "published" ||
        contStatus === "publishing" ||
        contStatus === "queued" ||
        contStatus === "failed")
    ) {
      const msgParts = [];
      if (cont.code) msgParts.push(cont.code);
      if (cont.asin) msgParts.push(`ASIN ${cont.asin}`);
      else if (cont.amazon_sku) msgParts.push(cont.amazon_sku);
      if (contStatus === "failed" && cont.last_error) msgParts.push(cont.last_error);
      state[`amazon:${t.continent}`] = {
        status: contStatus,
        queue: false,
        asin: cont.asin || null,
        product_url: cont.product_url || null,
        seller_central_url: cont.seller_central_url || null,
        lastMessage: msgParts.join(" · ") || contStatus,
        errors: contStatus === "failed" && cont.last_error ? [cont.last_error] : [],
      };
      continue;
    }

    const m = drMarkets.find((x) => x.continent === t.continent);
    if (m) {
      const errs = formatMarketplaceErrors(m);
      state[`amazon:${t.continent}`] = {
        status: m.ok ? "dry_run_ok" : "dry_run_failed",
        queue: false,
        lastMessage: m.ok ? `${m.code}: dry run OK` : errs.join("; ") || "failed",
        errors: m.ok ? [] : errs,
      };
    } else {
      state[`amazon:${t.continent}`] = { status: "unpublished", queue: false, errors: [] };
    }
  }
  return state;
}
