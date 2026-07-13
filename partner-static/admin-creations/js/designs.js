import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast, openModal } from "/creations/shared/js/partner-shell.js";

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

function designOriginalUrl(item) {
  return item?.original_url != null ? String(item.original_url).trim() : "";
}

function designPreviewUrl(item) {
  return item?.preview_url != null ? String(item.preview_url).trim() : "";
}

function designDownloadUrl(item) {
  return designOriginalUrl(item) || designPreviewUrl(item) || "";
}

function designFilenameBase(item) {
  if (item?.title) {
    return (
      String(item.title)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .substring(0, 50) || "design"
    );
  }
  if (item?.id) return `design-${item.id}`;
  if (item?.job_id) return `design-${item.job_id}`;
  return `design-${Date.now()}`;
}

function extensionFromUrlOrType(url, mimeType, fallback = "png") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const raw = pathname.substring(pathname.lastIndexOf(".") + 1).toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(raw)) return raw === "jpeg" ? "jpg" : raw;
  } catch {
    /* keep fallback */
  }
  return fallback;
}

function designDownloadFilename(item, url, { suffix = "", mimeType = "", fallbackExt = "png" } = {}) {
  const base = designFilenameBase(item);
  const ext = extensionFromUrlOrType(url, mimeType, fallbackExt);
  return `${base}${suffix}.${ext}`;
}

function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

function triggerUrlDownloadFallback(url, filename) {
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

async function fetchDesignBlob(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}

async function downloadDirectUrl(item, url, { suffix = "" } = {}) {
  const filename = designDownloadFilename(item, url, { suffix });
  try {
    const blob = await fetchDesignBlob(url);
    triggerBlobDownload(blob, designDownloadFilename(item, url, { suffix, mimeType: blob.type }));
  } catch {
    // Cross-origin hosts without CORS: open URL as fallback
    triggerUrlDownloadFallback(url, filename);
  }
}

function supportsWebPEncoding() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode image for optimization"));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Image encoding failed"));
        else resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

async function encodeAtScale(img, scale, mimeType, quality) {
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToBlob(canvas, mimeType, quality);
}

/**
 * Client-side size optimization of the original asset.
 * Binary-search quality at full resolution, then scale down only if needed.
 * Stays as close as possible to maxBytes without exceeding it.
 */
async function optimizeImageToMaxBytes(sourceBlob, maxBytes) {
  if (!(sourceBlob instanceof Blob)) throw new Error("Invalid image data");
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("Max size must be greater than 0");

  if (sourceBlob.size <= maxBytes) {
    return { blob: sourceBlob, mimeType: sourceBlob.type || "application/octet-stream", scaled: false, reused: true };
  }

  const img = await loadImageFromBlob(sourceBlob);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image has no dimensions");
  }

  const mimeType = supportsWebPEncoding() ? "image/webp" : "image/jpeg";
  const qualityMin = 0.1;
  const qualityMax = 0.95;
  let scale = 1;
  let best = null;

  for (let scaleAttempt = 0; scaleAttempt < 18; scaleAttempt++) {
    let lo = qualityMin;
    let hi = qualityMax;
    let bestAtScale = null;

    for (let i = 0; i < 10; i++) {
      const quality = (lo + hi) / 2;
      const blob = await encodeAtScale(img, scale, mimeType, quality);
      if (blob.size <= maxBytes) {
        bestAtScale = { blob, quality };
        lo = quality;
      } else {
        hi = quality;
      }
    }

    // Prefer the highest quality that still fits; if none, try lowest quality once more.
    if (!bestAtScale) {
      const lowest = await encodeAtScale(img, scale, mimeType, qualityMin);
      if (lowest.size <= maxBytes) bestAtScale = { blob: lowest, quality: qualityMin };
    }

    if (bestAtScale) {
      best = bestAtScale;
      break;
    }

    scale *= 0.9;
    if (scale < 0.05) break;
  }

  if (!best) {
    throw new Error("Could not fit image under the selected size limit");
  }

  return {
    blob: best.blob,
    mimeType,
    scaled: scale < 0.999,
    reused: false,
  };
}

function setDownloadModalBusy(busy, label) {
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  if (saveBtn) {
    saveBtn.disabled = !!busy;
    if (busy && label) saveBtn.textContent = label;
    else if (!busy) saveBtn.textContent = "Download";
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function syncDownloadModeUi() {
  const mode = document.querySelector('input[name="cr-dl-mode"]:checked')?.value || "preview";
  const optField = document.getElementById("cr-dl-opt-field");
  if (optField) optField.hidden = mode !== "optimized";
}

function openDesignDownloadModal(item) {
  const previewUrl = designPreviewUrl(item);
  const originalUrl = designOriginalUrl(item);
  const hasAny = !!(previewUrl || originalUrl);
  if (!hasAny) {
    showToast("Error", "No design file available to download");
    return;
  }

  const defaultMode = previewUrl ? "preview" : originalUrl ? "original" : "preview";
  const previewDisabled = previewUrl ? "" : "disabled";
  const originalDisabled = originalUrl ? "" : "disabled";
  const optimizedDisabled = originalUrl ? "" : "disabled";

  openModal({
    title: "Download design",
    bodyHtml: `
      <p class="confirm-modal-message">Choose which version to download.</p>
      <div class="action-mode-options cr-dl-options" role="radiogroup" aria-label="Download version">
        <label class="action-mode-option ${previewUrl ? "" : "is-disabled"}">
          <input type="radio" name="cr-dl-mode" value="preview" ${defaultMode === "preview" ? "checked" : ""} ${previewDisabled} />
          <span><strong>Preview</strong> — download the preview version</span>
        </label>
        <label class="action-mode-option ${originalUrl ? "" : "is-disabled"}">
          <input type="radio" name="cr-dl-mode" value="original" ${defaultMode === "original" ? "checked" : ""} ${originalDisabled} />
          <span><strong>Original</strong> — download the original design</span>
        </label>
        <label class="action-mode-option ${originalUrl ? "" : "is-disabled"}">
          <input type="radio" name="cr-dl-mode" value="optimized" ${defaultMode === "optimized" ? "checked" : ""} ${optimizedDisabled} />
          <span><strong>Optimized</strong> — size-optimized version of the original</span>
        </label>
      </div>
      <div class="field cr-dl-opt-field" id="cr-dl-opt-field" ${defaultMode === "optimized" ? "" : "hidden"}>
        <label for="cr-dl-max-mb">Max file size (MB)</label>
        <input class="input" id="cr-dl-max-mb" type="number" min="0.1" step="0.1" value="10" inputmode="decimal" />
        <p class="cr-dl-hint">Stays as close as possible to this limit without exceeding it.</p>
      </div>`,
    onSave: async () => {
      const mode = document.querySelector('input[name="cr-dl-mode"]:checked')?.value;
      if (!mode) throw new Error("Select a download option");

      if (mode === "preview") {
        if (!previewUrl) throw new Error("No preview available");
        setDownloadModalBusy(true, "Downloading…");
        try {
          await downloadDirectUrl(item, previewUrl, { suffix: "-preview" });
          showToast("Downloaded", "Preview saved");
        } finally {
          setDownloadModalBusy(false);
        }
        return;
      }

      if (mode === "original") {
        if (!originalUrl) throw new Error("No original available");
        setDownloadModalBusy(true, "Downloading…");
        try {
          await downloadDirectUrl(item, originalUrl, { suffix: "-original" });
          showToast("Downloaded", "Original saved");
        } finally {
          setDownloadModalBusy(false);
        }
        return;
      }

      if (mode === "optimized") {
        if (!originalUrl) throw new Error("No original available to optimize");
        const maxMbRaw = document.getElementById("cr-dl-max-mb")?.value;
        const maxMb = Number(maxMbRaw);
        if (!Number.isFinite(maxMb) || maxMb <= 0) {
          throw new Error("Enter a max file size greater than 0 MB");
        }
        const maxBytes = Math.floor(maxMb * 1024 * 1024);
        setDownloadModalBusy(true, "Optimizing…");
        try {
          const source = await fetchDesignBlob(originalUrl);
          const result = await optimizeImageToMaxBytes(source, maxBytes);
          const filename = designDownloadFilename(item, originalUrl, {
            suffix: "-optimized",
            mimeType: result.mimeType,
            fallbackExt: result.mimeType.includes("webp") ? "webp" : "jpg",
          });
          triggerBlobDownload(result.blob, filename);
          const sizeMb = (result.blob.size / (1024 * 1024)).toFixed(2);
          showToast(
            "Downloaded",
            result.reused
              ? `Original already under ${maxMb} MB (${sizeMb} MB)`
              : `Optimized to ${sizeMb} MB`
          );
        } catch (e) {
          throw new Error(e?.message || "Optimization failed");
        } finally {
          setDownloadModalBusy(false);
        }
        return;
      }

      throw new Error("Unknown download option");
    },
  });

  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) {
    saveBtn.textContent = "Download";
    saveBtn.className = "btn btn-primary";
  }

  document.querySelectorAll('input[name="cr-dl-mode"]').forEach((radio) => {
    radio.addEventListener("change", syncDownloadModeUi);
  });
  syncDownloadModeUi();
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
    ? `<button type="button" class="cr-card__download" data-cr-download="${escapeHtml(item.item_key || "")}" aria-label="Download design" title="Download design">${DOWNLOAD_ICON_SVG}</button>`
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
      openDesignDownloadModal(item);
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
