import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";

const SOURCE_FILTERS = [
  { key: "all", label: "All" },
  { key: "generate", label: "Generations" },
  { key: "upload", label: "Uploads" },
  { key: "automate", label: "Automations" },
];

const USAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "sample", label: "Sample" },
  { key: "product", label: "Product" },
];

const state = {
  library: "active",
  source: "all",
  usage: "all",
  q: "",
  qDebounced: "",
  offset: 0,
  limit: 48,
  loading: false,
  items: [],
  total: 0,
  hasMore: false,
  searchTimer: null,
};

function sourceBucketLabel(bucket) {
  if (bucket === "upload") return "Upload";
  if (bucket === "automate") return "Automate";
  return "Generate";
}

function formatDateTime(ms) {
  const n = Number(ms || 0);
  if (!n) return "—";
  const d = new Date(n < 1e12 ? n * 1000 : n);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

function matchesUsage(item, usage) {
  if (usage === "all") return true;
  const pub = Number(item.publish_count || 0);
  if (usage === "product") return pub > 0;
  if (usage === "sample") return item.item_kind === "creation" && pub === 0;
  return true;
}

function filterToolbarHtml() {
  const libActive = state.library === "active";
  return `
    <div class="cr-toolbar panel">
      <div class="cr-toolbar__row cr-toolbar__row--primary">
        <div class="cr-search" role="search">
          <span aria-hidden="true">⌕</span>
          <input type="search" id="cr-designs-search" placeholder="Search designs, users, creators, job ids…" aria-label="Search designs" autocomplete="off" value="${escapeHtml(state.q)}" />
        </div>
        <div class="cr-switch" role="group" aria-label="Library status">
          <button type="button" class="cr-switch__btn ${libActive ? "active" : ""}" data-cr-library="active">Active</button>
          <button type="button" class="cr-switch__btn ${!libActive ? "active" : ""}" data-cr-library="inactive">Inactive</button>
        </div>
      </div>
      <div class="cr-toolbar__row">
        <div class="cr-filter-group">
          <span class="cr-filter-label">Source</span>
          <div class="cr-chips" role="group" aria-label="Source filter">
            ${SOURCE_FILTERS.map(
              (f) =>
                `<button type="button" class="cr-chip ${state.source === f.key ? "active" : ""}" data-cr-source="${f.key}">${escapeHtml(f.label)}</button>`
            ).join("")}
          </div>
        </div>
        <div class="cr-filter-group">
          <span class="cr-filter-label">Usage</span>
          <div class="cr-chips" role="group" aria-label="Usage filter">
            ${USAGE_FILTERS.map(
              (f) =>
                `<button type="button" class="cr-chip ${state.usage === f.key ? "active" : ""}" data-cr-usage="${f.key}">${escapeHtml(f.label)}</button>`
            ).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

function designDownloadUrl(item) {
  const original = item?.original_url != null ? String(item.original_url).trim() : "";
  if (original) return original;
  const preview = item?.preview_url != null ? String(item.preview_url).trim() : "";
  return preview || "";
}

function designDownloadFilename(item, url) {
  let base = "design";
  if (item?.title) {
    base =
      String(item.title)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .substring(0, 50) || "design";
  } else if (item?.id) {
    base = `design-${item.id}`;
  } else if (item?.job_id) {
    base = `design-${item.job_id}`;
  } else {
    base = `design-${Date.now()}`;
  }

  let extension = "png";
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const raw = pathname.substring(pathname.lastIndexOf(".") + 1).toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(raw)) extension = raw;
  } catch {
    /* keep default */
  }
  return `${base}.${extension}`;
}

async function downloadDesignOriginal(item) {
  const url = designDownloadUrl(item);
  if (!url) {
    showToast("Error", "No original design available to download");
    return;
  }
  const filename = designDownloadFilename(item, url);

  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch {
    // Cross-origin hosts without CORS: open URL as fallback
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

const DOWNLOAD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

function designCardHtml(item) {
  const title = item.title != null ? String(item.title) : "—";
  const imgUrl = item.preview_url || item.original_url || "";
  const downloadUrl = designDownloadUrl(item);
  const libLabel = item.library_status === "inactive" ? "Inactive" : "Active";
  const unsaved = item.item_kind === "generated" ? '<span class="cr-badge cr-badge--warn">Unsaved</span>' : "";
  const thumbInner =
    imgUrl && String(imgUrl).trim()
      ? `<img src="${escapeHtml(imgUrl)}" alt="" loading="lazy" decoding="async" />`
      : '<span class="cr-card__noimg">No preview</span>';
  const downloadBtn = downloadUrl
    ? `<button type="button" class="cr-card__download" data-cr-download="${escapeHtml(item.item_key || "")}" aria-label="Download original design" title="Download original design">${DOWNLOAD_ICON_SVG}</button>`
    : "";

  return `<article class="cr-card" data-item-key="${escapeHtml(item.item_key || "")}">
    <div class="cr-card__title-row">
      <h3 class="cr-card__title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
    </div>
    <div class="cr-card__thumb">
      <div class="cr-card__thumb-inner">${thumbInner}</div>
      ${downloadBtn}
    </div>
    <div class="cr-card__meta">
      <span class="cr-meta-chip" title="User">${escapeHtml(item.user_name || item.owner_id || "—")}</span>
      <span class="cr-meta-chip">${escapeHtml(sourceBucketLabel(item.source_bucket))}</span>
      <span class="cr-meta-chip">${escapeHtml(formatDateTime(item.created_at))}</span>
      <span class="cr-meta-chip">${escapeHtml(item.creator_name || "—")}</span>
      <span class="cr-meta-chip">${escapeHtml(libLabel)} ${unsaved}</span>
      <span class="cr-meta-chip">${escapeHtml(item.type || "Classic")}</span>
      ${
        item.is_publishable
          ? `<span class="cr-meta-chip cr-meta-chip--stat">${Number(item.publish_count || 0)} / ${Number(item.publish_max || 0)} products</span>`
          : '<span class="cr-meta-chip cr-meta-chip--muted">—</span>'
      }
    </div>
  </article>`;
}

function bindDownloadButtons(grid) {
  grid.querySelectorAll("[data-cr-download]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.getAttribute("data-cr-download") || "";
      const item = state.items.find((row) => String(row.item_key || "") === key);
      if (!item) {
        showToast("Error", "Design not found");
        return;
      }
      void downloadDesignOriginal(item);
    });
  });
}

function renderGrid() {
  const grid = document.getElementById("cr-designs-grid");
  const empty = document.getElementById("cr-designs-empty");
  const loading = document.getElementById("cr-designs-loading");
  if (!grid) return;

  const visible = state.items.filter((item) => matchesUsage(item, state.usage));
  grid.innerHTML = visible.map(designCardHtml).join("");
  bindDownloadButtons(grid);
  const hasRows = visible.length > 0;
  grid.hidden = !hasRows;
  if (empty) empty.hidden = hasRows || state.loading;
  if (loading) loading.hidden = !state.loading || state.items.length > 0;

  const more = document.getElementById("cr-designs-more");
  if (more) {
    more.hidden = !state.hasMore;
    more.disabled = state.loading;
  }
}

async function fetchList({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  renderGrid();

  if (!append) {
    state.offset = 0;
    state.items = [];
  }

  try {
    const data = await partnerFetch("admin-creations-list", {
      query: {
        library: state.library,
        source: state.source,
        q: state.qDebounced,
        offset: state.offset,
        limit: state.limit,
      },
    });
    const chunk = Array.isArray(data.items) ? data.items : [];
    state.items = append ? state.items.concat(chunk) : chunk;
    state.total = typeof data.total === "number" ? data.total : state.items.length;
    state.hasMore = !!data.has_more;
    state.offset = state.items.length;
  } catch (e) {
    showToast("Error", e.message || "Could not load designs");
    if (!append) state.items = [];
  } finally {
    state.loading = false;
    renderGrid();
  }
}

function scheduleSearch() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.qDebounced = state.q;
    fetchList({ append: false });
  }, 280);
}

function bindToolbar(el) {
  el.querySelector("#cr-designs-search")?.addEventListener("input", (e) => {
    state.q = String(e.target.value || "").trim();
    scheduleSearch();
  });

  el.querySelectorAll("[data-cr-library]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lib = btn.dataset.crLibrary === "inactive" ? "inactive" : "active";
      if (state.library === lib) return;
      state.library = lib;
      el.querySelector(".cr-toolbar").outerHTML = filterToolbarHtml();
      bindToolbar(el);
      fetchList({ append: false });
    });
  });

  el.querySelectorAll("[data-cr-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.crSource || "all";
      if (state.source === next) return;
      state.source = next;
      el.querySelector(".cr-toolbar").outerHTML = filterToolbarHtml();
      bindToolbar(el);
      fetchList({ append: false });
    });
  });

  el.querySelectorAll("[data-cr-usage]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.crUsage || "all";
      if (state.usage === next) return;
      state.usage = next;
      el.querySelector(".cr-toolbar").outerHTML = filterToolbarHtml();
      bindToolbar(el);
      renderGrid();
    });
  });

  el.querySelector("#cr-designs-more")?.addEventListener("click", () => {
    if (!state.hasMore || state.loading) return;
    fetchList({ append: true });
  });
}

export async function mountDesignsPage() {
  const el = document.getElementById("view-designs");
  if (!el) return;

  el.innerHTML = `
    ${filterToolbarHtml()}
    <div class="cr-stage">
      <p class="cr-loading" id="cr-designs-loading">Loading designs…</p>
      <div class="cr-grid" id="cr-designs-grid" hidden></div>
      <p class="cr-empty" id="cr-designs-empty" hidden>No designs match your filters.</p>
      <div class="cr-load-more-wrap">
        <button type="button" class="btn btn-secondary" id="cr-designs-more" hidden>Load more</button>
      </div>
    </div>`;

  bindToolbar(el);
  await fetchList({ append: false });
}
