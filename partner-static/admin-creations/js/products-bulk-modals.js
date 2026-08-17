/**
 * Creations Portal Products — Publish / Unpublish / Update bulk modals (IDEA-063).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { openModal, showToast } from "/creations/shared/js/partner-shell.js";
import {
  clearSelection,
  releaseBulkDock,
  selectionKey,
  suppressBulkDock,
} from "./products-bulk.js";
import { startProductsActionDock, startProductsAmazonPublishDock } from "./products-action-dock.js";
import { itemPreviewUrl } from "./products-preview-url.js";
import {
  AMAZON_EU_CONTENT_READY_CODES,
  amazonEuMarketsSelectorHtml,
  bindAmazonEuMarketsSelector,
  defaultAmazonEuMarketCodes,
  formatAmazonEuPublishMessage,
  formatAmazonEuPublishTitle,
  readAmazonEuMarketsSelection,
} from "./products-amazon-eu-markets.js";

function productTitle(item) {
  return String(item?.title || item?.catalog_product_name || item?.product_key || "Product").trim() || "Product";
}

function listingKey(item) {
  return selectionKey(item);
}

function setModalBusy(busy, label) {
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  if (saveBtn) {
    saveBtn.disabled = !!busy;
    if (busy && label) saveBtn.textContent = label;
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function configurePrimaryConfirm(label) {
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) {
    saveBtn.textContent = label || "Confirm";
    saveBtn.className = "btn btn-primary";
  }
}

function productRowHtml(item, { checked = true } = {}) {
  const key = listingKey(item);
  const preview = itemPreviewUrl(item);
  return `<label class="cr-bulk-product-row">
    <input type="checkbox" class="cr-bulk-product-row__cb" data-product-key="${escapeHtml(key)}" ${
    checked ? "checked" : ""
  } />
    <span class="cr-bulk-product-row__media">${
      preview ? `<img src="${escapeHtml(preview)}" alt="" loading="lazy" />` : ""
    }</span>
    <span class="cr-bulk-product-row__title">${escapeHtml(productTitle(item))}</span>
    ${item.provider_label ? `<span class="cr-badge">${escapeHtml(item.provider_label)}</span>` : ""}
  </label>`;
}

function selectedRowsFromRoot(rootId) {
  const root = document.getElementById(rootId);
  const keys = new Set(
    [...(root?.querySelectorAll(".cr-bulk-product-row__cb:checked") || [])].map(
      (cb) => cb.getAttribute("data-product-key") || ""
    )
  );
  return keys;
}

/**
 * Publish selected products to Amazon EU marketplaces (direct SP-API; no BIL).
 * Parent EU toggles all content-ready countries; each country is selectable.
 * Products already listed on Amazon DE are excluded from the picker list.
 */
export async function openProductsBulkPublishModal(items, { onDone } = {}) {
  const eligible = (items || []).filter(
    (p) =>
      (p.publish_eligible_amazon_de || p.publish_eligible_amazon_eu) &&
      !p.amazon_de_listed &&
      !p.amazon_de_channel
  );
  if (!eligible.length) {
    releaseBulkDock();
    showToast(
      "Publish",
      "No eligible products (already listed on Amazon DE, or missing Shopify listing)"
    );
    return;
  }
  suppressBulkDock();

  const initialCodes = defaultAmazonEuMarketCodes();
  const selRootId = "cr-products-publish-eu-sel";
  const msgId = "cr-products-publish-msg";

  function refreshModalChrome(codes) {
    const titleEl = document.getElementById("modal-title");
    const msgEl = document.getElementById(msgId);
    if (titleEl) titleEl.textContent = formatAmazonEuPublishTitle(eligible.length, codes);
    if (msgEl) msgEl.textContent = formatAmazonEuPublishMessage(codes);
    const saveBtn = document.getElementById("modal-save");
    if (saveBtn) saveBtn.disabled = !codes.length;
  }

  openModal({
    title: formatAmazonEuPublishTitle(eligible.length, initialCodes),
    bodyHtml: `
      <p class="confirm-modal-message" id="${msgId}">${escapeHtml(
        formatAmazonEuPublishMessage(initialCodes)
      )}</p>
      ${amazonEuMarketsSelectorHtml({ rootId: selRootId, selectedCodes: initialCodes })}
      <div class="cr-bulk-scroll" id="cr-products-publish-body">
        ${eligible.map((item) => productRowHtml(item, { checked: true })).join("")}
      </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const codes = readAmazonEuMarketsSelection(document.getElementById(selRootId));
      if (!codes.length) throw new Error("Select at least one Amazon EU marketplace");
      const keys = selectedRowsFromRoot("cr-products-publish-body");
      const selected = eligible.filter((item) => keys.has(listingKey(item)));
      if (!selected.length) throw new Error("Select at least one product");
      clearSelection();
      // Return immediately so partner-shell closeModal() runs; dock + Amazon poll continue in background.
      void startProductsAmazonPublishDock(selected, {
        continent: "europa",
        marketplace_codes: codes,
        onDone: async (summary) => {
          if (typeof onDone === "function") await onDone(summary);
        },
      }).catch((e) => {
        console.error("[products-bulk] Amazon publish dock failed:", e);
        showToast("Error", e?.message || "Amazon publish failed");
      });
    },
  });
  configurePrimaryConfirm("Publish selected");
  bindAmazonEuMarketsSelector(document.getElementById(selRootId), {
    onChange: refreshModalChrome,
  });
  refreshModalChrome(initialCodes);
}

/** Unpublish selected products from eazpire (Shopify) and/or Amazon EU / US. */
export async function openProductsBulkUnpublishModal(items, { onDone } = {}) {
  const eligible = (items || []).filter(
    (p) =>
      p.shopify_product_id ||
      p.id ||
      p.amazon_de_channel ||
      p.amazon_de_listed ||
      p.amazon_eu_channel ||
      p.amazon_eu_listed ||
      p.amazon_us_channel ||
      p.amazon_us_listed
  );
  if (!eligible.length) {
    releaseBulkDock();
    showToast("Unpublish", "No eligible products selected");
    return;
  }
  suppressBulkDock();

  const euUnpubCodes = AMAZON_EU_CONTENT_READY_CODES.slice();
  const body = `
    <p class="confirm-modal-message">Unpublish from eazpire and/or Amazon. Amazon EU removes listings on all content-ready EU marketplaces (${escapeHtml(
      euUnpubCodes.join(", ")
    )}).</p>
    <div class="cr-bulk-scroll" id="cr-products-unpublish-body">
      ${eligible
        .map((item) => {
          const key = listingKey(item);
          const preview = itemPreviewUrl(item);
          const hasAmazonEu = !!(
            item.amazon_de_channel ||
            item.amazon_de_listed ||
            item.amazon_eu_channel ||
            item.amazon_eu_listed
          );
          const hasAmazonUs = !!(item.amazon_us_channel || item.amazon_us_listed);
          return `<div class="cr-unpub-prod" data-product-key="${escapeHtml(key)}">
            <div class="cr-unpub-prod__head">
              <span class="cr-bulk-product-row__media">${
                preview ? `<img src="${escapeHtml(preview)}" alt="" loading="lazy" />` : ""
              }</span>
              <span class="cr-unpub-prod__title">${escapeHtml(productTitle(item))}</span>
            </div>
            <div class="cr-unpub-prod__channels">
              <label class="cr-unpub-ch"><input type="checkbox" class="cr-unpub-ch__cb" data-channel="eazpire" data-product-key="${escapeHtml(
                key
              )}" checked /> <span>eazpire</span></label>
              ${
                hasAmazonEu
                  ? `<label class="cr-unpub-ch"><input type="checkbox" class="cr-unpub-ch__cb" data-channel="amazon_eu" data-product-key="${escapeHtml(
                      key
                    )}" checked /> <span>Amazon EU</span></label>`
                  : ""
              }
              ${
                hasAmazonUs
                  ? `<label class="cr-unpub-ch"><input type="checkbox" class="cr-unpub-ch__cb" data-channel="amazon_us" data-product-key="${escapeHtml(
                      key
                    )}" /> <span>Amazon US</span></label>`
                  : ""
              }
            </div>
          </div>`;
        })
        .join("")}
    </div>`;

  openModal({
    title: eligible.length === 1 ? "Unpublish product" : `Unpublish ${eligible.length} products`,
    bodyHtml: body,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const root = document.getElementById("cr-products-unpublish-body");
      const checked = [...(root?.querySelectorAll(".cr-unpub-ch__cb:checked") || [])];
      if (!checked.length) throw new Error("Select at least one channel");

      const byKey = new Map(eligible.map((item) => [listingKey(item), item]));
      const targets = new Map(); // key -> { item, eazpire, amazon_eu, amazon_us }
      for (const cb of checked) {
        const key = cb.getAttribute("data-product-key") || "";
        const item = byKey.get(key);
        if (!item) continue;
        if (!targets.has(key)) {
          targets.set(key, { item, eazpire: false, amazon_eu: false, amazon_us: false });
        }
        const ch = cb.getAttribute("data-channel") || "";
        if (ch === "amazon_de") targets.get(key).amazon_eu = true;
        else targets.get(key)[ch] = true;
      }

      setModalBusy(true, "Unpublishing…");
      clearSelection();
      setModalBusy(false);

      const { ok, errors } = await startProductsActionDock([...targets.values()].map((t) => t.item), {
        action: "unpublish",
        runItem: async (item) => {
          const key = listingKey(item);
          const target = targets.get(key);
          if (!target) return { ok: true };
          if (target.eazpire) {
            await partnerFetch("admin-design-unpublish", {
              method: "POST",
              body: {
                design_id: item.design_id || undefined,
                product_keys: item.product_key ? [item.product_key] : [],
                published_ids: item.published_design_id ? [item.published_design_id] : [],
              },
            });
          }
          if (target.amazon_eu) {
            await partnerFetch("admin-amazon-unpublish", {
              method: "POST",
              body: {
                product_key: item.product_key || "",
                shopify_product_id: item.shopify_product_id || item.id || "",
                published_design_id: item.published_design_id || undefined,
                marketplace_codes: euUnpubCodes.slice(),
                continents: ["europa"],
              },
            });
          }
          if (target.amazon_us) {
            await partnerFetch("admin-amazon-unpublish", {
              method: "POST",
              body: {
                product_key: item.product_key || "",
                shopify_product_id: item.shopify_product_id || item.id || "",
                published_design_id: item.published_design_id || undefined,
                marketplace_codes: ["US"],
                continents: ["amerika"],
              },
            });
          }
          return { ok: true };
        },
      });
      if (typeof onDone === "function") await onDone({ ok, errors });
    },
  });
  configurePrimaryConfirm("Unpublish selected");
}

/** Update (re-sync) already-published listings that have drifted since their last publish. */
export async function openProductsBulkUpdateModal(items, { onDone } = {}) {
  const eligible = (items || []).filter((p) => p.needs_update && p.design_id);
  if (!eligible.length) {
    releaseBulkDock();
    showToast("Update", "No selected products need an update");
    return;
  }
  suppressBulkDock();

  openModal({
    title: eligible.length === 1 ? "Update listing" : `Update ${eligible.length} listings`,
    bodyHtml: `
      <p class="confirm-modal-message">Design or metadata changed since the last publish. Push the update to all live channels.</p>
      <div class="cr-bulk-scroll" id="cr-products-update-body">
        ${eligible.map((item) => productRowHtml(item, { checked: true })).join("")}
      </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const keys = selectedRowsFromRoot("cr-products-update-body");
      const selected = eligible.filter((item) => keys.has(listingKey(item)));
      if (!selected.length) throw new Error("Select at least one product");
      setModalBusy(true, "Updating…");
      clearSelection();
      setModalBusy(false);

      const { ok, errors } = await startProductsActionDock(selected, {
        action: "update",
        runItem: (item) =>
          partnerFetch("admin-design-update-commit", {
            method: "POST",
            body: { design_id: item.design_id },
          }),
      });
      if (typeof onDone === "function") await onDone({ ok, errors });
    },
  });
  configurePrimaryConfirm("Update selected");
}

/** Check and repair Shopify image alt texts + featured preview for selected listings. */
export async function openProductsBulkFixAltTextsModal(items, { onDone } = {}) {
  const eligible = (items || []).filter((p) =>
    String(p?.shopify_product_id || p?.id || "")
      .replace("gid://shopify/Product/", "")
      .replace(/\.0$/, "")
      .trim()
  );
  if (!eligible.length) {
    releaseBulkDock();
    showToast("Fix alt texts", "No selected products have a Shopify listing");
    return;
  }
  suppressBulkDock();

  openModal({
    title: eligible.length === 1 ? "Fix alt texts" : `Fix alt texts on ${eligible.length} listings`,
    bodyHtml: `
      <p class="confirm-modal-message">Checks every selected Shopify listing: whether image alt texts are set, whether Color|view labels match the real mockup (lifestyle/back must not be labeled front), and whether the card preview is the primary front image. Then repairs what is wrong.</p>
      <div class="cr-bulk-scroll" id="cr-products-alt-texts-body">
        ${eligible.map((item) => productRowHtml(item, { checked: true })).join("")}
      </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const keys = selectedRowsFromRoot("cr-products-alt-texts-body");
      const selected = eligible.filter((item) => keys.has(listingKey(item)));
      if (!selected.length) throw new Error("Select at least one product");
      setModalBusy(true, "Checking…");
      clearSelection();
      setModalBusy(false);

      const { ok, errors } = await startProductsActionDock(selected, {
        action: "alt-texts",
        runItem: (item) =>
          partnerFetch("admin-creations-fix-alt-texts", {
            method: "POST",
            body: {
              shopify_product_id: item.shopify_product_id || item.id || "",
              printify_product_id: item.printify_product_id || "",
              product_key: item.product_key || "",
              design_id: item.design_id || "",
            },
          }),
      });
      if (typeof onDone === "function") await onDone({ ok, errors });
    },
  });
  configurePrimaryConfirm("Check and repair");
}
