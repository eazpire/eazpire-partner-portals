import { partnerFetch, escapeHtml } from "/partner/shared/js/partner-api.js";
import {
  defaultProductFilterState,
  defaultLogFilterState,
  productsFilterHtml,
  logsFilterHtml,
  bindProductsFilter,
  bindLogsFilter,
  productTriQuery,
  logTriQuery,
  countActiveProductFilters,
  countActiveLogFilters,
} from "./job-logs-filters.js";
import { jobLogPreviewUrl } from "./job-logs-preview-url.js";

const FILTER_COLLAPSED_KEY = "admin_partner_logs_filter_collapsed";
const FILTER_TAB_KEY = "admin_partner_logs_filter_tab";
const ACTIVE_POLL_MS = 3500;

function isFilterCollapsed() {
  try {
    return sessionStorage.getItem(FILTER_COLLAPSED_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function setFilterCollapsed(next) {
  try {
    sessionStorage.setItem(FILTER_COLLAPSED_KEY, next ? "1" : "0");
  } catch (_) {}
}

function getFilterTab() {
  try {
    return sessionStorage.getItem(FILTER_TAB_KEY) === "products" ? "products" : "logs";
  } catch (_) {
    return "logs";
  }
}

function setFilterTab(tab) {
  try {
    sessionStorage.setItem(FILTER_TAB_KEY, tab);
  } catch (_) {}
}

function formatWhen(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status) {
  if (status === "completed") return "jl-status--ok";
  if (status === "failed") return "jl-status--err";
  return "jl-status--live";
}

export function liveStatusText(row) {
  const msg = String(row?.progress_message || "").trim();
  if (msg) return msg;
  if (row?.type === "printify_publish") return "Printify publish — waiting for progress";
  if (row?.type === "shopify_publish") return "Shopify sync in progress";
  if (row?.type === "amazon_publish") {
    const cc = String(row.amazon_country || "").trim();
    return cc ? `Amazon ${cc} submit in progress` : "Amazon submit in progress";
  }
  return `${row?.type_label || "Job"} in progress`;
}

function thumbHtml(row) {
  const src = jobLogPreviewUrl(row);
  const img = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" />`
    : `<span class="jl-thumb__empty" aria-hidden="true"></span>`;
  const open = src
    ? ` role="button" tabindex="0" data-jl-preview="${escapeHtml(src)}" aria-label="Open mockup preview"`
    : "";
  return `<span class="jl-thumb${src ? " is-clickable" : ""}"${open}>${img}</span>`;
}

function statusHtml(row) {
  const active = row.status === "active";
  const spin = active ? `<span class="jl-status__spin" aria-hidden="true"></span>` : "";
  return `<div class="jl-row__status">
        ${spin}
        <span class="jl-status ${statusClass(row.status)}">${escapeHtml(row.status_label || row.status)}</span>
      </div>`;
}

function renderList(items) {
  if (!items?.length) {
    return `<div class="empty-state"><div class="icon">☰</div><h3>No matching logs</h3><p>Try another filter, or wait for the next publish / Studio job.</p></div>`;
  }
  return `<ul class="jl-list">${items
    .map((row) => {
      const active = row.status === "active";
      const err = row.error ? `<p class="jl-row__error">${escapeHtml(row.error)}</p>` : "";
      const live = active
        ? `<div class="jl-row__live">${escapeHtml(liveStatusText(row))}</div>`
        : "";
      return `<li class="jl-row${active ? " is-active" : ""}" data-job-key="${escapeHtml(row.job_key || "")}">
        ${thumbHtml(row)}
        <div class="jl-row__main">
          <div class="jl-row__title">${escapeHtml(row.title || row.product_title || "Untitled")}</div>
          ${live}
          <div class="jl-row__meta">
            <span>${escapeHtml(row.type_label || row.type)}</span>
            <span>${escapeHtml(row.source_label || row.source)}</span>
            ${row.product_key ? `<span>${escapeHtml(row.product_key)}</span>` : ""}
            <span>${escapeHtml(formatWhen(row.updated_at || row.started_at))}</span>
          </div>
          ${err}
          ${active ? `<div class="jl-row__actions"><button type="button" class="jl-fail-btn" data-jl-fail="${escapeHtml(row.job_key || "")}">Mark failed</button></div>` : ""}
        </div>
        ${statusHtml(row)}
      </li>`;
    })
    .join("")}</ul>`;
}

export async function mountJobLogs(container) {
  const productState = defaultProductFilterState();
  const logState = defaultLogFilterState();
  let filterTab = getFilterTab();
  let collapsed = isFilterCollapsed();
  let lastPayload = { items: [], product_facets: {}, log_facets: {}, total: 0, groups: null, history_note: null };
  let searchTimer = null;
  let pollTimer = null;
  let paintedOnce = false;
  let alive = true;

  container.innerHTML = `
    <div class="catalog-studio job-logs ${collapsed ? "catalog-studio--filter-collapsed" : ""}">
      <div class="catalog-studio-filter-wrap">
        <aside class="catalog-studio-filter-sidebar" id="job-logs-filter-sidebar">
          <div class="catalog-studio-sidebar-head">
            <div class="jl-filter-tabs" role="tablist">
              <button type="button" class="jl-filter-tab ${filterTab === "products" ? "is-on" : ""}" data-jl-tab="products" role="tab">Products</button>
              <button type="button" class="jl-filter-tab ${filterTab === "logs" ? "is-on" : ""}" data-jl-tab="logs" role="tab">Logs</button>
            </div>
          </div>
          <div class="cs-category-tree cr-pf-body" id="job-logs-filter-body"></div>
        </aside>
        <button type="button" class="catalog-studio-rail catalog-studio-filter-rail" id="job-logs-filter-toggle" aria-label="Collapse filter sidebar" title="Collapse">
          <span class="catalog-studio-rail__arrow-zone" aria-hidden="true"><span class="catalog-studio-rail__arrow">‹</span></span>
          <span class="catalog-studio-rail__labels">
            <span class="catalog-studio-rail__section">Filter</span>
            <span class="catalog-studio-rail__action">${collapsed ? "Expand" : "Collapse"}</span>
          </span>
        </button>
      </div>
      <div class="catalog-studio-main">
        <div class="catalog-studio-toolbar">
          <div>
            <p class="stage-kicker">Job history</p>
            <h2 class="panel-title" style="margin:0">Publish &amp; product logs</h2>
          </div>
          <div class="catalog-studio-actions">
            <button type="button" class="btn btn-secondary" id="job-logs-refresh">Refresh</button>
          </div>
        </div>
        <p class="catalog-studio-selection" id="job-logs-summary"></p>
        <div class="panel catalog-studio-panel">
          <div class="panel-body" id="job-logs-list"><p class="catalog-studio-loading">Loading logs…</p></div>
        </div>
      </div>
    </div>
    <div id="jl-lightbox" class="jl-lightbox" hidden>
      <button type="button" class="jl-lightbox__close" data-jl-lightbox-close aria-label="Close">×</button>
      <img class="jl-lightbox__img" alt="Mockup preview" />
    </div>`;

  const studioEl = container.querySelector(".job-logs");
  const filterBody = container.querySelector("#job-logs-filter-body");
  const listEl = container.querySelector("#job-logs-list");
  const summaryEl = container.querySelector("#job-logs-summary");
  const panelEl = container.querySelector(".catalog-studio-panel");

  function paintFilter() {
    if (filterTab === "products") {
      filterBody.innerHTML = productsFilterHtml(productState, lastPayload.product_facets);
      bindProductsFilter(filterBody, productState, (immediate) => reload(immediate));
    } else {
      filterBody.innerHTML = logsFilterHtml(logState, lastPayload.log_facets);
      bindLogsFilter(filterBody, logState, (immediate) => reload(immediate));
    }
    container.querySelectorAll("[data-jl-tab]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-jl-tab") === filterTab);
    });
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!alive) return;
    const hasActive = (lastPayload.items || []).some((row) => row.status === "active");
    if (!hasActive) return;
    pollTimer = setTimeout(() => reload(true, { skipFilterPaint: true }), ACTIVE_POLL_MS);
  }

  async function reload(immediate, { skipFilterPaint } = {}) {
    const run = async () => {
      try {
        const data = await partnerFetch("admin-partner-job-logs", {
          query: {
            q: logState.q,
            log_tri: JSON.stringify(logTriQuery(logState)),
            product_q: productState.q,
            product_tri: JSON.stringify(productTriQuery(productState)),
          },
        });
        if (!alive) return;
        lastPayload = data;
        const groups = data.groups?.byStatus || {};
        const productN = countActiveProductFilters(productState);
        const logN = countActiveLogFilters(logState);
        summaryEl.textContent = `${data.total || 0} job(s) · ${groups.active || 0} active · ${groups.completed || 0} completed · ${groups.failed || 0} failed${productN || logN ? ` · filters on` : ""}`;
        const scrollY = panelEl?.scrollTop || 0;
        listEl.innerHTML = renderList(data.items || []);
        if (panelEl) panelEl.scrollTop = scrollY;
        if (!skipFilterPaint && (immediate || !paintedOnce)) {
          paintedOnce = true;
          paintFilter();
        }
        schedulePoll();
      } catch (e) {
        if (!alive) return;
        listEl.innerHTML = `<div class="empty-state"><h3>Could not load logs</h3><p>${escapeHtml(e.message || String(e))}</p></div>`;
      }
    };
    clearTimeout(searchTimer);
    if (immediate) await run();
    else searchTimer = setTimeout(run, 220);
  }

  container.querySelector("#job-logs-filter-toggle").onclick = () => {
    collapsed = !collapsed;
    setFilterCollapsed(collapsed);
    studioEl.classList.toggle("catalog-studio--filter-collapsed", collapsed);
    const label = container.querySelector(".catalog-studio-filter-rail .catalog-studio-rail__action");
    const toggle = container.querySelector("#job-logs-filter-toggle");
    if (label) label.textContent = collapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-label", collapsed ? "Expand filter sidebar" : "Collapse filter sidebar");
  };

  container.querySelectorAll("[data-jl-tab]").forEach((btn) => {
    btn.onclick = () => {
      filterTab = btn.getAttribute("data-jl-tab") === "products" ? "products" : "logs";
      setFilterTab(filterTab);
      paintFilter();
    };
  });

  container.querySelector("#job-logs-refresh").onclick = () => reload(true);

  const lightbox = container.querySelector("#jl-lightbox");
  const lightboxImg = lightbox?.querySelector(".jl-lightbox__img");

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightbox.classList.remove("is-open");
    if (lightboxImg) lightboxImg.removeAttribute("src");
  }

  function openLightbox(src) {
    if (!lightbox || !lightboxImg || !src) return;
    lightboxImg.src = src;
    lightbox.hidden = false;
    lightbox.classList.add("is-open");
  }

  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target.closest("[data-jl-lightbox-close]")) closeLightbox();
  });

  listEl.addEventListener("click", async (event) => {
    const failBtn = event.target.closest("[data-jl-fail]");
    if (failBtn) {
      const jobKey = failBtn.getAttribute("data-jl-fail");
      if (!jobKey) return;
      failBtn.disabled = true;
      try {
        await partnerFetch("admin-partner-job-log-resolve", {
          method: "POST",
          body: { job_key: jobKey, action: "fail" },
        });
        await reload(true, { skipFilterPaint: true });
      } catch (e) {
        failBtn.disabled = false;
        window.alert(e.message || "Could not mark job failed");
      }
      return;
    }
    const thumb = event.target.closest("[data-jl-preview]");
    if (thumb) openLightbox(thumb.getAttribute("data-jl-preview"));
  });

  listEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const thumb = event.target.closest("[data-jl-preview]");
    if (!thumb) return;
    event.preventDefault();
    openLightbox(thumb.getAttribute("data-jl-preview"));
  });

  const onEsc = (event) => {
    if (event.key === "Escape") closeLightbox();
  };
  document.addEventListener("keydown", onEsc);

  paintFilter();
  await reload(true);

  return () => {
    alive = false;
    clearTimeout(searchTimer);
    clearTimeout(pollTimer);
    document.removeEventListener("keydown", onEsc);
    closeLightbox();
  };
}
