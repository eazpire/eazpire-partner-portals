import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { uploadBrandAsset, uploadProductBrandAsset } from "../api.js";
import { normalizeBrandAssetsMode } from "./helpers.js";

function assetTile(type, asset, { readonly = false } = {}) {
  const url = asset?.image_url || asset?.imageUrl;
  if (url) {
    const removeBtn = readonly
      ? ""
      : `<button type="button" class="ce-pa-img-remove ce-pa-brand-remove" data-type="${escapeHtml(type)}" aria-label="Remove ${escapeHtml(type)}">×</button>`;
    return `
      <div class="ce-pa-img-tile ce-pa-img-tile--filled" id="ce-pa-brand-${type}">
        <img src="${escapeHtml(url)}" alt="" />
        ${removeBtn}
      </div>`;
  }
  if (readonly) {
    return `
      <div class="ce-pa-img-tile ce-pa-img-tile--empty ce-pa-img-tile--readonly" id="ce-pa-brand-${type}" aria-label="${escapeHtml(type)} (global)">
        <span class="ce-hint">No global asset</span>
      </div>`;
  }
  return `
    <label class="ce-pa-img-tile ce-pa-img-tile--empty" id="ce-pa-brand-${type}" aria-label="Upload ${escapeHtml(type)}">
      <span class="ce-pa-img-add-icon" aria-hidden="true">+</span>
      <input type="file" class="ce-pa-brand-upload" accept="image/png,image/jpeg,image/webp" data-type="${escapeHtml(type)}" hidden />
    </label>`;
}

function brandGridHtml(displayAssets, { showQr, showLogo, readonly }) {
  const rows = [];
  if (showQr) {
    rows.push(`
      <div class="ce-pa-brand-row">
        <span class="ce-pa-brand-label">QR (black)</span>
        <div class="ce-pa-img-grid">${assetTile("qr", displayAssets?.qr?.black || null, { readonly })}</div>
      </div>`);
  }
  if (showLogo) {
    rows.push(`
      <div class="ce-pa-brand-row">
        <span class="ce-pa-brand-label">Logo (black)</span>
        <div class="ce-pa-img-grid">${assetTile("logo", displayAssets?.logo?.black || null, { readonly })}</div>
      </div>`);
  }
  return rows.join("");
}

function brandBodyHtml(options = {}) {
  const {
    mode = "global",
    globalAssets = {},
    specificAssets = {},
    showQr = true,
    showLogo = true,
    readonly = false,
  } = options;
  const isSpecific = normalizeBrandAssetsMode(mode) === "specific";
  const displayAssets = isSpecific ? specificAssets : globalAssets;
  const hint = isSpecific
    ? "Product-specific QR and Logo assets for this provider (saved with print area config)."
    : "Global QR and Logo assets from the shared library (upload updates all products using global mode).";
  const ro = readonly ? " disabled" : "";
  return `
    <p class="ce-hint">${hint}</p>
    <label class="ce-pa-check ce-pa-brand-specific-toggle">
      <input type="checkbox" id="ce-pa-brand-specific" ${isSpecific ? "checked" : ""}${ro} />
      <span>Specific assets</span>
    </label>
    <div class="ce-pa-brand-grid">${brandGridHtml(displayAssets, { showQr, showLogo, readonly: readonly || !isSpecific })}</div>`;
}

export function renderBrandAssetsSection(options = {}, meta = null) {
  const { showQr = true, showLogo = true, showSection = true } = options;
  if (!showSection || (!showQr && !showLogo)) return "";
  const inheritedClass = meta?.inherited ? " ce-pa-acc--inherited" : "";
  const toggle = meta?.toggle || "";
  const readonly = meta?.inherited ? true : options.readonly;
  return `
    <details class="ce-pa-acc ce-pa-acc--brand${inheritedClass}">
      <summary class="ce-pa-acc-summary-row"><span>Brand Assets</span>${toggle}</summary>
      <div class="ce-pa-acc-body">${brandBodyHtml({ ...options, readonly })}</div>
    </details>`;
}

export function refreshBrandAssetsSection(root, options = {}) {
  const acc = root.querySelector(".ce-pa-acc--brand .ce-pa-acc-body");
  if (!acc) return;
  acc.innerHTML = brandBodyHtml(options);
}

export function bindBrandAssetsSection(root, refs, callbacks = {}) {
  const {
    globalAssetsRef,
    specificAssetsRef,
    modeRef,
    productKey,
    printProviderId,
    showQr = true,
    showLogo = true,
    onUploaded,
    onCleared,
    onModeChange,
  } = callbacks;

  root.querySelector("#ce-pa-brand-specific")?.addEventListener("change", (e) => {
    modeRef.current = e.target.checked ? "specific" : "global";
    refreshBrandAssetsSection(root, {
      mode: modeRef.current,
      globalAssets: globalAssetsRef.current,
      specificAssets: specificAssetsRef.current,
      showQr,
      showLogo,
    });
    bindBrandAssetsSection(root, refs, callbacks);
    onModeChange?.(modeRef.current);
  });

  const isSpecific = normalizeBrandAssetsMode(modeRef.current) === "specific";
  if (!isSpecific) return;

  root.querySelectorAll(".ce-pa-brand-upload").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const type = input.dataset.type;
      input.disabled = true;
      try {
        const res = await uploadProductBrandAsset(productKey, printProviderId, type, "black", file);
        if (!specificAssetsRef.current) specificAssetsRef.current = { qr: {}, logo: {} };
        specificAssetsRef.current[type] = specificAssetsRef.current[type] || {};
        specificAssetsRef.current[type].black = {
          image_url: res.image_url,
          r2_key: res.r2_key,
        };
        refreshBrandAssetsSection(root, {
          mode: modeRef.current,
          globalAssets: globalAssetsRef.current,
          specificAssets: specificAssetsRef.current,
          showQr,
          showLogo,
        });
        bindBrandAssetsSection(root, refs, callbacks);
        onUploaded?.(type, res);
      } catch (err) {
        console.error("Product brand asset upload failed", err);
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });
  });

  root.querySelectorAll(".ce-pa-brand-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const type = btn.dataset.type;
      if (specificAssetsRef.current?.[type]) {
        specificAssetsRef.current[type].black = null;
      }
      refreshBrandAssetsSection(root, {
        mode: modeRef.current,
        globalAssets: globalAssetsRef.current,
        specificAssets: specificAssetsRef.current,
        showQr,
        showLogo,
      });
      bindBrandAssetsSection(root, refs, callbacks);
      onCleared?.(type);
    });
  });
}

/** Bind global asset uploads (admin library) — used outside print-area when needed. */
export function bindGlobalBrandAssetsSection(root, brandAssetsRef, callbacks = {}) {
  const { onUploaded, onCleared } = callbacks;

  root.querySelectorAll(".ce-pa-brand-upload").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const type = input.dataset.type;
      input.disabled = true;
      try {
        const res = await uploadBrandAsset(type, "black", file);
        if (!brandAssetsRef.current) brandAssetsRef.current = { qr: {}, logo: {} };
        brandAssetsRef.current[type] = brandAssetsRef.current[type] || {};
        brandAssetsRef.current[type].black = {
          image_url: res.image_url,
          r2_key: res.r2_key,
        };
        onUploaded?.(type, res);
      } catch (err) {
        console.error("Brand asset upload failed", err);
      } finally {
        input.disabled = false;
        input.value = "";
      }
    });
  });

  root.querySelectorAll(".ce-pa-brand-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const type = btn.dataset.type;
      if (brandAssetsRef.current?.[type]) {
        brandAssetsRef.current[type].black = null;
      }
      onCleared?.(type);
    });
  });
}
