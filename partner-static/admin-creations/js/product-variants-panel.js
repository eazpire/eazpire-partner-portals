/**
 * Admin Creations — Product detail Variants panel (parent color / child size, mocks, checkboxes).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { openModal, showToast } from "/creations/shared/js/partner-shell.js";
import { startVariantUpdateDock } from "./products-variant-update-dock.js";

const MAX_ENABLED = 100;

function formatMoney(amount, currency) {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return escapeHtml(String(amount));
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ""}`.trim();
  }
}

function slideAt(slides, index) {
  const list = Array.isArray(slides) ? slides : [];
  if (!list.length) return null;
  const i = ((Number(index) || 0) % list.length + list.length) % list.length;
  return list[i];
}

function mockThumbHtml(slides, viewIndex, key) {
  const slide = slideAt(slides, viewIndex);
  const view = slide?.view || "front";
  const src = slide?.src || "";
  const hasMultiple = Array.isArray(slides) && slides.length > 1;
  return `<div class="cr-pd-vp-mock" data-cr-vp-mock="${escapeHtml(key)}">
    ${src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(view)}" loading="lazy" draggable="false" />`
      : `<span class="cr-pd-vp-mock__missing">No mock</span>`}
    ${hasMultiple
      ? `<div class="cr-pd-vp-mock__nav">
          <button type="button" class="cr-pd-vp-mock__arrow" data-cr-vp-view-prev="${escapeHtml(key)}" aria-label="Previous view">‹</button>
          <span class="cr-pd-vp-mock__view">${escapeHtml(view)}</span>
          <button type="button" class="cr-pd-vp-mock__arrow" data-cr-vp-view-next="${escapeHtml(key)}" aria-label="Next view">›</button>
        </div>`
      : `<span class="cr-pd-vp-mock__view cr-pd-vp-mock__view--solo">${escapeHtml(view)}</span>`}
  </div>`;
}

function buildBaselineFromGroups(groups) {
  const enabled = new Map();
  for (const g of groups || []) {
    for (const s of g.sizes || []) {
      const key = s.printify_variant_id || s.shopify_variant_id;
      if (!key) continue;
      enabled.set(String(key), s.enabled !== false);
    }
  }
  return enabled;
}

function collectVariantsMap(groups, enabledMap) {
  const out = {};
  for (const g of groups || []) {
    for (const s of g.sizes || []) {
      const pid = s.printify_variant_id;
      if (!pid) continue;
      out[String(pid)] = { enabled: enabledMap.get(String(pid)) !== false };
    }
  }
  return out;
}

function countEnabled(enabledMap) {
  let n = 0;
  for (const v of enabledMap.values()) if (v) n += 1;
  return n;
}

function isDirty(baseline, current) {
  if (baseline.size !== current.size) return true;
  for (const [k, v] of baseline) {
    if (current.get(k) !== v) return true;
  }
  return false;
}

function syncParentState(group, enabledMap) {
  const sizes = group.sizes || [];
  const enabledSizes = sizes.filter((s) => {
    const key = String(s.printify_variant_id || s.shopify_variant_id || "");
    return enabledMap.get(key) !== false;
  });
  return {
    all: enabledSizes.length === sizes.length && sizes.length > 0,
    none: enabledSizes.length === 0,
    partial: enabledSizes.length > 0 && enabledSizes.length < sizes.length,
  };
}

export function createVariantsUiState(product) {
  const groups = Array.isArray(product?.variant_groups) ? product.variant_groups : [];
  const baseline = buildBaselineFromGroups(groups);
  const enabled = new Map(baseline);
  const collapsed = new Set(groups.slice(1).map((g) => g.color));
  const viewIndex = new Map();
  for (const g of groups) {
    viewIndex.set(g.color, g.default_view_index || 0);
  }
  return { groups, baseline, enabled, collapsed, viewIndex, dirty: false };
}

export function renderVariantsPanelHtml(product, ui) {
  const groups = ui?.groups || [];
  const currency = product?.currency || "EUR";

  if (!groups.length) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (!variants.length) {
      return `<div class="cr-pd-empty">No variants found.</div>`;
    }
    return `<div class="cr-pd-empty">Variant groups could not be built. Try reloading the product detail.</div>`;
  }

  const enabledCount = countEnabled(ui.enabled);
  const totalVariants = groups.reduce((n, g) => n + (g.sizes?.length || 0), 0);
  let html = `<div class="cr-pd-variants">
    <p class="cr-pd-hint">Parent = color · Child = size. Toggle variants to include or exclude them on the next update.</p>
    <p class="cr-pd-vp-summary"><strong>${enabledCount}</strong> / ${totalVariants} enabled${enabledCount > MAX_ENABLED ? ` · max ${MAX_ENABLED}` : ""}</p>`;

  for (const group of groups) {
    const parentKey = `color:${group.color}`;
    const parentState = syncParentState(group, ui.enabled);
    const isOpen = !ui.collapsed.has(group.color);
    const viewIdx = ui.viewIndex.get(group.color) ?? group.default_view_index ?? 0;

    html += `<details class="cr-pd-vp-color" data-cr-vp-color="${escapeHtml(group.color)}" ${isOpen ? "open" : ""}>
      <summary class="cr-pd-vp-color__head">
        <label class="cr-pd-vp-check" onclick="event.stopPropagation()">
          <input type="checkbox" data-cr-vp-color-toggle="${escapeHtml(group.color)}" ${parentState.all ? "checked" : ""} ${parentState.partial ? 'data-indeterminate="1"' : ""} />
        </label>
        ${mockThumbHtml(group.mock_slides, viewIdx, parentKey)}
        <span class="cr-pd-vp-color__name">${escapeHtml(group.color)}</span>
        <span class="cr-pd-vp-color__count">${(group.sizes || []).filter((s) => ui.enabled.get(String(s.printify_variant_id || s.shopify_variant_id)) !== false).length}/${(group.sizes || []).length}</span>
      </summary>
      <div class="cr-pd-vp-sizes">
        <table class="cr-pd-vp-size-table">
          <thead><tr><th></th><th>Mock</th><th>Size</th><th>SKU</th><th>Price</th><th>Inventory</th></tr></thead>
          <tbody>`;

    for (const size of group.sizes || []) {
      const rowKey = String(size.printify_variant_id || size.shopify_variant_id || "");
      const childMockKey = `${parentKey}:${size.size}`;
      html += `<tr data-cr-vp-size-row="${escapeHtml(rowKey)}">
        <td><label class="cr-pd-vp-check"><input type="checkbox" data-cr-vp-size-toggle="${escapeHtml(rowKey)}" ${ui.enabled.get(rowKey) !== false ? "checked" : ""} /></label></td>
        <td>${mockThumbHtml(group.mock_slides, viewIdx, childMockKey)}</td>
        <td>${escapeHtml(size.size)}</td>
        <td><code>${escapeHtml(size.sku || "—")}</code></td>
        <td>${formatMoney(size.price, currency)}</td>
        <td>${size.inventory_quantity != null ? escapeHtml(String(size.inventory_quantity)) : "—"}</td>
      </tr>`;
    }

    html += `</tbody></table></div></details>`;
  }

  html += `<div class="cr-pd-vp-footer" ${ui.dirty ? "" : "hidden"}>
    <button type="button" class="btn btn-primary cr-pd-vp-update-btn" id="cr-pd-vp-update">Update Product</button>
  </div></div>`;

  return html;
}

function channelCheckboxHtml(ch) {
  return `<label class="cr-channel-row cr-pd-vp-channel">
    <input type="checkbox" name="cr-vp-channel" value="${escapeHtml(ch.id)}" checked />
    <span>${escapeHtml(ch.label)}</span>
  </label>`;
}

function openChannelConfirmModal(product, ui, onConfirm) {
  const channels = Array.isArray(product?.live_channels) ? product.live_channels : [];
  if (!channels.length) {
    showToast("Update", "No live channels found for this product");
    return;
  }

  openModal({
    title: "Update product on channels",
    bodyHtml: `
      <p class="confirm-modal-message">Push variant changes to the selected channels. All channels are selected by default.</p>
      <div class="cr-pd-vp-channels" id="cr-vp-channels">
        ${channels.map((ch) => channelCheckboxHtml(ch)).join("")}
      </div>`,
    onSave: async () => {
      const selected = [...document.querySelectorAll('#cr-vp-channels input[name="cr-vp-channel"]:checked')].map(
        (el) => el.value
      );
      if (!selected.length) throw new Error("Select at least one channel");
      await onConfirm(selected);
    },
  });
}

function allMockSlides(product) {
  const slides = [];
  for (const g of product?.variant_groups || []) {
    for (const s of g.mock_slides || []) {
      if (s?.src && !slides.some((x) => x.src === s.src)) slides.push(s);
    }
  }
  return slides;
}

export function bindVariantsPanel(root, product, ui, { onDirtyChange, onCloseModal } = {}) {
  if (!root || !ui) return;

  const refreshDirty = () => {
    ui.dirty = isDirty(ui.baseline, ui.enabled);
    const footer = root.querySelector(".cr-pd-vp-footer");
    if (footer) footer.hidden = !ui.dirty;
    if (typeof onDirtyChange === "function") onDirtyChange(ui.dirty);
  };

  root.querySelectorAll("[data-indeterminate='1']").forEach((el) => {
    el.indeterminate = true;
  });

  root.querySelectorAll("details.cr-pd-vp-color").forEach((det) => {
    det.addEventListener("toggle", () => {
      const color = det.dataset.crVpColor;
      if (!color) return;
      if (det.open) ui.collapsed.delete(color);
      else ui.collapsed.add(color);
    });
  });

  root.querySelectorAll("[data-cr-vp-view-prev]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.crVpViewPrev || "";
      const color = key.startsWith("color:") ? key.slice(6).split(":")[0] : "";
      if (!color) return;
      const group = ui.groups.find((g) => g.color === color);
      const len = group?.mock_slides?.length || 1;
      const cur = ui.viewIndex.get(color) ?? 0;
      ui.viewIndex.set(color, (cur - 1 + len) % len);
      onDirtyChange?.(ui.dirty);
      const host = root.closest("#cr-pd-content");
      if (host) {
        host.innerHTML = renderVariantsPanelHtml(product, ui);
        bindVariantsPanel(host, product, ui, { onDirtyChange, onCloseModal });
      }
    });
  });

  root.querySelectorAll("[data-cr-vp-view-next]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.crVpViewNext || "";
      const color = key.startsWith("color:") ? key.slice(6).split(":")[0] : "";
      if (!color) return;
      const group = ui.groups.find((g) => g.color === color);
      const len = group?.mock_slides?.length || 1;
      const cur = ui.viewIndex.get(color) ?? 0;
      ui.viewIndex.set(color, (cur + 1) % len);
      const host = root.closest("#cr-pd-content");
      if (host) {
        host.innerHTML = renderVariantsPanelHtml(product, ui);
        bindVariantsPanel(host, product, ui, { onDirtyChange, onCloseModal });
      }
    });
  });

  root.querySelectorAll("[data-cr-vp-color-toggle]").forEach((el) => {
    el.addEventListener("change", () => {
      const color = el.dataset.crVpColorToggle;
      const group = ui.groups.find((g) => g.color === color);
      if (!group) return;
      for (const s of group.sizes || []) {
        const key = String(s.printify_variant_id || s.shopify_variant_id || "");
        if (!key) continue;
        ui.enabled.set(key, el.checked);
      }
      const host = root.closest("#cr-pd-content");
      if (host) {
        host.innerHTML = renderVariantsPanelHtml(product, ui);
        bindVariantsPanel(host, product, ui, { onDirtyChange, onCloseModal });
        refreshDirty();
      }
    });
  });

  root.querySelectorAll("[data-cr-vp-size-toggle]").forEach((el) => {
    el.addEventListener("change", () => {
      const key = el.dataset.crVpSizeToggle;
      if (!key) return;
      ui.enabled.set(key, el.checked);
      const enabledN = countEnabled(ui.enabled);
      if (enabledN > MAX_ENABLED) {
        ui.enabled.set(key, false);
        el.checked = false;
        showToast("Limit", `Maximum ${MAX_ENABLED} enabled variants`);
      }
      const host = root.closest("#cr-pd-content");
      if (host) {
        host.innerHTML = renderVariantsPanelHtml(product, ui);
        bindVariantsPanel(host, product, ui, { onDirtyChange, onCloseModal });
        refreshDirty();
      }
    });
  });

  root.querySelector("#cr-pd-vp-update")?.addEventListener("click", () => {
    openChannelConfirmModal(product, ui, async (channels) => {
      const variantsMap = collectVariantsMap(ui.groups, ui.enabled);
      const payload = {
        shopify_product_id: product.id,
        product_key: product.product_key,
        print_provider_id: product.print_provider_id,
        printify_product_id: product.printify_product_id,
        design_id: product.design_id,
        published_design_id: product.published_design_id || product.amazon_publish?.published_design_id,
        product_title: product.title,
        existing_config: product.variant_config,
        variants: variantsMap,
        channels,
        mock_slides: allMockSlides(product),
      };

      const data = await partnerFetch("admin-creations-product-variant-update", {
        method: "POST",
        body: payload,
      });
      if (!data?.session_id) throw new Error(data?.error || "Update could not be started");

      ui.baseline = new Map(ui.enabled);
      ui.dirty = false;
      refreshDirty();

      if (typeof onCloseModal === "function") onCloseModal();

      await startVariantUpdateDock({
        sessionId: data.session_id,
        product,
        channels,
        mockSlides: payload.mock_slides,
      });
    });
  });

  refreshDirty();
}
