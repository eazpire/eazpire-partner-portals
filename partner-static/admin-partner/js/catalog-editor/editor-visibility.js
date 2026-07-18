import { getVersionsForProvider } from "./editor-subnav.js";
import { saveVersionConfig, saveProductCatalogStatus } from "./api.js";

export const CATALOG_STATUSES = ["offline", "preview", "online"];

const STATUS_TO_TRI = { offline: 0, preview: 1, online: 2 };
const TRI_TO_STATUS = ["offline", "preview", "online"];

export function catalogStatusToTri(status) {
  const key = String(status || "offline").toLowerCase();
  return STATUS_TO_TRI[key] ?? 0;
}

export function triToCatalogStatus(tri) {
  const n = Number(tri);
  return TRI_TO_STATUS[n] || "offline";
}

function versionKey(version) {
  return String(version?.id || version?._tempId || "");
}

export function ensureVisibilityState(ctx) {
  if (!ctx.versionVisibility) ctx.versionVisibility = new Map();
  return ctx.versionVisibility;
}

export function readCatalogStatusFromConfig(config, fallback = "offline") {
  const raw = config?.catalog_status;
  if (raw && CATALOG_STATUSES.includes(String(raw).toLowerCase())) {
    return String(raw).toLowerCase();
  }
  return fallback;
}

export function getVersionForVisibility(ctx) {
  if (ctx.activeTab === "provider" && ctx.providersTabState?.selectedPid) {
    const state = ctx.providersTabState;
    const pid = state.selectedPid;
    const versions = (state.localVersions?.get(String(pid)) || ctx.bundle?.versions || [])
      .filter((v) => String(v.external_provider_id) === String(pid))
      .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
    const idx = Math.min(state.selectedVersionIdx ?? 0, Math.max(0, versions.length - 1));
    return versions[idx] || null;
  }

  const providerId = ctx.selectedPrintProviderId || ctx.bundle?.active_providers?.[0]?.print_provider_id;
  const versions = getVersionsForProvider(ctx, providerId);
  return (
    versions.find((v) => String(v.id) === String(ctx.selectedVersionId)) ||
    versions[0] ||
    null
  );
}

function productCatalogStatusFallback(ctx) {
  const raw = String(ctx?.bundle?.product?.catalog_status || "").toLowerCase();
  return CATALOG_STATUSES.includes(raw) ? raw : "offline";
}

export function getVisibilityForVersion(ctx, version) {
  const productStatus = productCatalogStatusFallback(ctx);
  if (!version) return productStatus;
  const map = ensureVisibilityState(ctx);
  const key = versionKey(version);
  if (map.has(key)) return map.get(key);
  // Shared SoT with Catalog Studio: product.catalog_status wins over stale version config
  // (approve sets product=preview; an older version config can still say offline).
  map.set(key, productStatus);
  return productStatus;
}

export function setVisibilityForVersion(ctx, version, status) {
  if (!version) return;
  const normalized = CATALOG_STATUSES.includes(status) ? status : "offline";
  const key = versionKey(version);
  ensureVisibilityState(ctx).set(key, normalized);
  if (!version.product_version_config || typeof version.product_version_config !== "object") {
    version.product_version_config = {};
  }
  version.product_version_config.catalog_status = normalized;
  // Keep in-memory product aligned so list/footer stay in sync before reload.
  if (ctx?.bundle?.product) {
    ctx.bundle.product.catalog_status = normalized;
  }
}

export function renderCatalogEditorTriSwitch(status = "offline") {
  const tri = catalogStatusToTri(status);
  return `
    <div class="ce-triswitch" id="ce-triswitch" data-status="${tri}" role="group" aria-label="Catalog visibility">
      <div class="ce-triswitch__track">
        <div class="ce-triswitch__thumb" aria-hidden="true"></div>
        <div class="ce-triswitch__labels">
          <span class="ce-triswitch__label" data-val="0" role="button" tabindex="0">Offline</span>
          <span class="ce-triswitch__label" data-val="1" role="button" tabindex="0">Preview</span>
          <span class="ce-triswitch__label" data-val="2" role="button" tabindex="0">Online</span>
        </div>
      </div>
    </div>`;
}

export function refreshVisibilityTriSwitch(ctx) {
  const el = document.getElementById("ce-triswitch");
  if (!el) return;
  const version = getVersionForVisibility(ctx);
  const status = getVisibilityForVersion(ctx, version);
  el.setAttribute("data-status", String(catalogStatusToTri(status)));
  const foot = document.getElementById("ce-foot-visibility");
  if (foot) {
    foot.hidden = !version && ctx.activeTab !== "provider";
    const hint = foot.querySelector(".ce-foot-visibility-hint");
    if (hint && version) {
      hint.textContent = version.display_name
        ? `Version: ${version.display_name}`
        : "Catalog visibility for selected version";
    }
  }
}

function applyTriStatus(sw, tri) {
  const v = Math.max(0, Math.min(2, Number(tri) || 0));
  sw.setAttribute("data-status", String(v));
}

export function bindCatalogEditorTriSwitch(ctx, onChange) {
  const sw = document.getElementById("ce-triswitch");
  if (!sw || sw.dataset.bound === "1") return;
  sw.dataset.bound = "1";

  const onPick = (tri) => {
    const version = getVersionForVisibility(ctx);
    if (!version) return;
    const status = triToCatalogStatus(tri);
    setVisibilityForVersion(ctx, version, status);
    applyTriStatus(sw, tri);
    onChange?.();
  };

  sw.querySelectorAll(".ce-triswitch__label").forEach((label) => {
    label.addEventListener("click", () => onPick(label.dataset.val));
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick(label.dataset.val);
      }
    });
  });

  let swipeStart = null;
  let swipeFrom = 0;
  const track = sw.querySelector(".ce-triswitch__track");
  track?.addEventListener(
    "touchstart",
    (e) => {
      swipeStart = e.touches[0].clientX;
      swipeFrom = Number(sw.getAttribute("data-status")) || 0;
      sw.classList.add("ce-triswitch--swiping");
    },
    { passive: true }
  );
  track?.addEventListener(
    "touchend",
    (e) => {
      if (swipeStart == null) return;
      const dx = (e.changedTouches[0]?.clientX || swipeStart) - swipeStart;
      let next = swipeFrom;
      if (dx > 36 && swipeFrom > 0) next = swipeFrom - 1;
      else if (dx < -36 && swipeFrom < 2) next = swipeFrom + 1;
      swipeStart = null;
      sw.classList.remove("ce-triswitch--swiping");
      onPick(next);
    },
    { passive: true }
  );
}

export function initVisibilityFromBundle(ctx) {
  const map = ensureVisibilityState(ctx);
  map.clear();
  // Product-level catalog_status is the shared source of truth with Catalog Studio.
  const productStatus = productCatalogStatusFallback(ctx);
  for (const v of ctx.bundle?.versions || []) {
    map.set(versionKey(v), productStatus);
    if (!v.product_version_config || typeof v.product_version_config !== "object") {
      v.product_version_config = {};
    }
    v.product_version_config.catalog_status = productStatus;
  }
}

export function snapshotVisibilityState(ctx) {
  const version = getVersionForVisibility(ctx);
  if (!version) return null;
  return {
    version_id: versionKey(version),
    catalog_status: getVisibilityForVersion(ctx, version),
  };
}

export function mergeVisibilityIntoVersionConfig(ctx, version, config) {
  const base = config && typeof config === "object" ? { ...config } : {};
  const status = getVisibilityForVersion(ctx, version);
  base.catalog_status = status;
  return base;
}

/** Persist visibility: product_catalog.is_active first, then version config as display mirror. */
export async function saveVisibilityFromFooter(ctx) {
  const map = ensureVisibilityState(ctx);
  if (!map.size) return;
  const initial = ctx._visibilityBaseline || new Map();
  const dirty = [...map.entries()].filter(([k, v]) => initial.get(k) !== v);
  if (!dirty.length) return;

  const productKey = ctx.productKey || ctx.bundle?.product?.product_key;
  const productStatus =
    (ctx.bundle?.product?.catalog_status &&
      CATALOG_STATUSES.includes(String(ctx.bundle.product.catalog_status).toLowerCase()) &&
      String(ctx.bundle.product.catalog_status).toLowerCase()) ||
    dirty[0]?.[1] ||
    "offline";

  if (productKey) {
    const res = await saveProductCatalogStatus(productKey, productStatus);
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to save catalog visibility");
    }
  }

  for (const [vid, catalog_status] of dirty) {
    if (!vid || String(vid).startsWith("new_")) continue;
    const version = (ctx.bundle?.versions || []).find((v) => versionKey(v) === vid);
    const cfg = mergeVisibilityIntoVersionConfig(ctx, version, version?.product_version_config);
    cfg.catalog_status = catalog_status;
    await saveVersionConfig(vid, { product_version_config: cfg, auto_mirror: false });
  }
}

export function captureVisibilityBaseline(ctx) {
  ctx._visibilityBaseline = new Map(ensureVisibilityState(ctx));
}
