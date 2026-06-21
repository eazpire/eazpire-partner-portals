import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { uploadBrandAsset } from "../api.js";

function assetTile(type, asset) {
  const url = asset?.image_url || asset?.imageUrl;
  if (url) {
    return `
      <div class="ce-pa-img-tile ce-pa-img-tile--filled" id="ce-pa-brand-${type}">
        <img src="${escapeHtml(url)}" alt="" />
        <button type="button" class="ce-pa-img-remove ce-pa-brand-remove" data-type="${escapeHtml(type)}" aria-label="Remove ${escapeHtml(type)}">×</button>
      </div>`;
  }
  return `
    <label class="ce-pa-img-tile ce-pa-img-tile--empty" id="ce-pa-brand-${type}" aria-label="Upload ${escapeHtml(type)}">
      <span class="ce-pa-img-add-icon" aria-hidden="true">+</span>
      <input type="file" class="ce-pa-brand-upload" accept="image/png,image/jpeg,image/webp" data-type="${escapeHtml(type)}" hidden />
    </label>`;
}

export function renderBrandAssetsSection(brandAssets) {
  const qr = brandAssets?.qr?.black || null;
  const logo = brandAssets?.logo?.black || null;
  return `
    <details class="ce-pa-acc ce-pa-acc--brand">
      <summary>Brand Assets</summary>
      <div class="ce-pa-acc-body">
        <p class="ce-hint">Publish black QR and Logo assets used in print area overlays.</p>
        <div class="ce-pa-brand-grid">
          <div class="ce-pa-brand-row">
            <span class="ce-pa-brand-label">QR (black)</span>
            <div class="ce-pa-img-grid">${assetTile("qr", qr)}</div>
          </div>
          <div class="ce-pa-brand-row">
            <span class="ce-pa-brand-label">Logo (black)</span>
            <div class="ce-pa-img-grid">${assetTile("logo", logo)}</div>
          </div>
        </div>
      </div>
    </details>`;
}

export function refreshBrandAssetsSection(root, brandAssets) {
  const acc = root.querySelector(".ce-pa-acc--brand .ce-pa-acc-body");
  if (!acc) return;
  const qr = brandAssets?.qr?.black || null;
  const logo = brandAssets?.logo?.black || null;
  acc.innerHTML = `
    <p class="ce-hint">Publish black QR and Logo assets used in print area overlays.</p>
    <div class="ce-pa-brand-grid">
      <div class="ce-pa-brand-row">
        <span class="ce-pa-brand-label">QR (black)</span>
        <div class="ce-pa-img-grid">${assetTile("qr", qr)}</div>
      </div>
      <div class="ce-pa-brand-row">
        <span class="ce-pa-brand-label">Logo (black)</span>
        <div class="ce-pa-img-grid">${assetTile("logo", logo)}</div>
      </div>
    </div>`;
}

export function bindBrandAssetsSection(root, brandAssetsRef, callbacks = {}) {
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
        refreshBrandAssetsSection(root, brandAssetsRef.current);
        bindBrandAssetsSection(root, brandAssetsRef, callbacks);
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
      refreshBrandAssetsSection(root, brandAssetsRef.current);
      bindBrandAssetsSection(root, brandAssetsRef, callbacks);
      onCleared?.(type);
    });
  });
}
