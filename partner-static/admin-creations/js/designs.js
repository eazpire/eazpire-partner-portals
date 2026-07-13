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
  // Large optimized PNGs can take a few seconds to flush to disk — keep the blob URL alive.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
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

const PNG_MIME = "image/png";
/** Prefer 300 DPI for print-oriented optimized downloads (pHYs pixels/meter). */
const OPTIMIZED_PNG_DPI = 300;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG CRC-32 (ISO 3309 / ITU-T V.42) over chunk type + data. */
function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dpiToPixelsPerMeter(dpi) {
  const d = Number(dpi);
  const safeDpi = Number.isFinite(d) && d >= 150 ? d : OPTIMIZED_PNG_DPI;
  return Math.round(safeDpi / 0.0254);
}

function assertPngSignature(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) throw new Error("Invalid PNG");
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file");
  }
}

function readU32be(bytes, offset) {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function writeU32be(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * Parse PNG into signature + chunk copies (skips nothing; caller filters).
 * Each chunk is a full on-disk chunk: length|type|data|crc.
 */
function parsePngChunks(pngBytes) {
  const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
  assertPngSignature(bytes);
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32be(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("Truncated PNG chunk");
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    chunks.push({
      type,
      bytes: bytes.slice(offset, chunkEnd),
    });
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  if (!chunks.some((c) => c.type === "IHDR")) throw new Error("PNG missing IHDR");
  if (!chunks.some((c) => c.type === "IEND")) throw new Error("PNG missing IEND");
  return chunks;
}

/**
 * Build a PNG pHYs chunk for the given DPI (unit = meter).
 * 300 DPI → 11811 pixels per meter.
 */
function buildPngPhysChunk(dpi = OPTIMIZED_PNG_DPI) {
  const ppm = dpiToPixelsPerMeter(dpi);
  const data = new Uint8Array(9);
  writeU32be(data, 0, ppm);
  writeU32be(data, 4, ppm);
  data[8] = 1; // unit: meter
  const type = new TextEncoder().encode("pHYs");
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(type, 0);
  typeAndData.set(data, 4);
  const crc = pngCrc32(typeAndData);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeU32be(chunk, 0, data.length);
  chunk.set(typeAndData, 4);
  writeU32be(chunk, 4 + typeAndData.length, crc);
  return chunk;
}

/** Read first pHYs chunk → { ppmX, ppmY, unit, dpiX, dpiY } or null. */
function readPngPhys(pngBytes) {
  const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
  assertPngSignature(bytes);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32be(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("Truncated PNG chunk");
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (type === "pHYs") {
      if (length < 9) throw new Error("Invalid pHYs chunk");
      const typeAndData = bytes.subarray(offset + 4, offset + 8 + length);
      const storedCrc = readU32be(bytes, offset + 8 + length);
      if (pngCrc32(typeAndData) !== storedCrc) throw new Error("PNG pHYs CRC mismatch");
      const ppmX = readU32be(bytes, offset + 8);
      const ppmY = readU32be(bytes, offset + 12);
      const unit = bytes[offset + 16];
      return {
        ppmX,
        ppmY,
        unit,
        dpiX: unit === 1 ? ppmX * 0.0254 : null,
        dpiY: unit === 1 ? ppmY * 0.0254 : null,
      };
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  return null;
}

/**
 * Remove every pHYs chunk, then insert a fresh one immediately after IHDR.
 * Does not change pixel dimensions — metadata only.
 */
function setPngDpiBytes(pngBytes, dpi = OPTIMIZED_PNG_DPI) {
  const chunks = parsePngChunks(pngBytes).filter((c) => c.type !== "pHYs");
  const physChunk = buildPngPhysChunk(dpi);
  const ihdrIndex = chunks.findIndex((c) => c.type === "IHDR");
  if (ihdrIndex < 0) throw new Error("PNG missing IHDR");
  chunks.splice(ihdrIndex + 1, 0, { type: "pHYs", bytes: physChunk });

  let total = 8;
  for (const c of chunks) total += c.bytes.length;
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let writeAt = 8;
  for (const c of chunks) {
    out.set(c.bytes, writeAt);
    writeAt += c.bytes.length;
  }

  const verified = readPngPhys(out);
  const expectedPpm = dpiToPixelsPerMeter(dpi);
  if (
    !verified ||
    verified.unit !== 1 ||
    verified.ppmX !== expectedPpm ||
    verified.ppmY !== expectedPpm
  ) {
    throw new Error("PNG DPI stamp verification failed");
  }
  return out;
}

async function setPngBlobDpi(blob, dpi = OPTIMIZED_PNG_DPI) {
  const buf = await blob.arrayBuffer();
  const withDpi = setPngDpiBytes(new Uint8Array(buf), dpi);
  // Copy into a fresh ArrayBuffer so the Blob owns exact PNG bytes.
  const copy = withDpi.buffer.slice(withDpi.byteOffset, withDpi.byteOffset + withDpi.byteLength);
  return new Blob([copy], { type: PNG_MIME });
}

/** Confirm stamped blob still has ~target DPI before download. */
async function assertPngBlobDpi(blob, dpi = OPTIMIZED_PNG_DPI) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const phys = readPngPhys(buf);
  const expectedPpm = dpiToPixelsPerMeter(dpi);
  if (!phys || phys.unit !== 1 || phys.ppmX !== expectedPpm || phys.ppmY !== expectedPpm) {
    throw new Error(`Optimized PNG DPI assert failed (expected ${dpi}, got ${phys?.dpiX ?? "missing"})`);
  }
  return phys;
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
      reject(new Error("Could not decode image"));
    };
    img.src = objectUrl;
  });
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("PNG encoding failed"));
        else resolve(blob);
      },
      PNG_MIME
    );
  });
}

async function encodePngAtScale(img, scale) {
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToPngBlob(canvas);
}

/** Convert any decodable image blob to PNG at full resolution. */
async function convertBlobToPng(sourceBlob) {
  if (sourceBlob instanceof Blob && String(sourceBlob.type || "").toLowerCase().includes("png")) {
    return sourceBlob;
  }
  const img = await loadImageFromBlob(sourceBlob);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image has no dimensions");
  }
  return encodePngAtScale(img, 1);
}

async function downloadDirectUrl(item, url, { suffix = "" } = {}) {
  const filename = designDownloadFilename(item, url, { suffix, mimeType: PNG_MIME, fallbackExt: "png" });
  try {
    const blob = await fetchDesignBlob(url);
    const pngBlob = await convertBlobToPng(blob);
    triggerBlobDownload(pngBlob, designDownloadFilename(item, url, {
      suffix,
      mimeType: PNG_MIME,
      fallbackExt: "png",
    }));
  } catch {
    // Cross-origin hosts without CORS / decode failure: open URL as fallback
    triggerUrlDownloadFallback(url, filename);
  }
}

/**
 * Client-side size optimization as PNG.
 * PNG is lossless — quality knobs don't apply; binary-search scale (dimensions)
 * to stay as large as possible under maxBytes without exceeding it.
 * Always stamps pHYs at 300 DPI and asserts it before download — never silent-fail.
 */
async function optimizeImageToMaxBytes(sourceBlob, maxBytes) {
  if (!(sourceBlob instanceof Blob)) throw new Error("Invalid image data");
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("Max size must be greater than 0");

  async function stampOptimizedDpi(blob, meta) {
    const stamped = await setPngBlobDpi(blob, OPTIMIZED_PNG_DPI);
    await assertPngBlobDpi(stamped, OPTIMIZED_PNG_DPI);
    return { blob: stamped, mimeType: PNG_MIME, dpi: OPTIMIZED_PNG_DPI, ...meta };
  }

  // Prefer magic-byte detection: R2/CDN often serves application/octet-stream.
  let looksPng = String(sourceBlob.type || "").toLowerCase().includes("png");
  if (!looksPng && sourceBlob.size >= 8) {
    try {
      const head = new Uint8Array(await sourceBlob.slice(0, 8).arrayBuffer());
      looksPng = PNG_SIGNATURE.every((b, i) => head[i] === b);
    } catch {
      looksPng = false;
    }
  }

  if (looksPng && sourceBlob.size <= maxBytes) {
    try {
      return await stampOptimizedDpi(sourceBlob, { scaled: false, reused: true });
    } catch (e) {
      // Odd/corrupt structure: fall through to canvas re-encode + stamp.
      console.warn("[designs] Direct PNG DPI stamp failed, re-encoding:", e?.message || e);
    }
  }

  const img = await loadImageFromBlob(sourceBlob);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image has no dimensions");
  }

  // Full-res PNG first — keep if under the limit.
  const fullPng = await encodePngAtScale(img, 1);
  if (fullPng.size <= maxBytes) {
    return stampOptimizedDpi(fullPng, { scaled: false, reused: false });
  }

  // Binary search on scale: find the largest dimensions that fit under maxBytes.
  let lo = 0.05;
  let hi = 1;
  let best = null;

  for (let i = 0; i < 14; i++) {
    const scale = (lo + hi) / 2;
    const blob = await encodePngAtScale(img, scale);
    if (blob.size <= maxBytes) {
      best = { blob, scale };
      lo = scale;
    } else {
      hi = scale;
    }
  }

  // Ensure we have a fitting candidate (edge: even tiny scale may still be over).
  if (!best) {
    const tiny = await encodePngAtScale(img, 0.05);
    if (tiny.size <= maxBytes) best = { blob: tiny, scale: 0.05 };
  }

  if (!best) {
    throw new Error("Could not fit image under the selected size limit");
  }

  return stampOptimizedDpi(best.blob, {
    scaled: best.scale < 0.999,
    reused: false,
  });
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
        <p class="cr-dl-hint">Downloads as PNG. Scales down to stay under this limit while keeping the largest size possible.</p>
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
            mimeType: PNG_MIME,
            fallbackExt: "png",
          });
          triggerBlobDownload(result.blob, filename);
          const sizeMb = (result.blob.size / (1024 * 1024)).toFixed(2);
          const dpiLabel = `${result.dpi || OPTIMIZED_PNG_DPI} DPI`;
          showToast(
            "Downloaded",
            result.reused
              ? `Already under ${maxMb} MB as PNG (${sizeMb} MB, ${dpiLabel})`
              : `Optimized PNG to ${sizeMb} MB · ${dpiLabel}`
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
