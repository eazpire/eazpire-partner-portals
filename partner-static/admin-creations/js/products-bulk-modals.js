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
import { startProductsActionDock } from "./products-action-dock.js";

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
  const preview = item.preview_url || item.grid_views?.[0]?.src || "";
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
 * Publish selected products to Amazon EU (DE) only.
 * Already Amazon-EU-listed or Amazon-US-listed products are excluded from the list entirely.
 */
export async function openProductsBulkPublishModal(items, { onDone } = {}) {
  const eligible = (items || []).filter(
    (p) => p.publish_eligible_amazon_eu && !p.amazon_eu_listed && !p.amazon_us_listed
  );
  if (!eligible.length) {
    releaseBulkDock();
    showToast("Publish", "No eligible products (already listed on Amazon EU/US, or missing Shopify listing)");
    return;
  }
  suppressBulkDock();

  openModal({
    title: eligible.length === 1 ? "Publish to Amazon EU (DE)" : `Publish ${eligible.length} products to Amazon EU (DE)`,
    bodyHtml: `
      <p class="confirm-modal-message">Amazon EU (DE marketplace) only. Products already listed on Amazon EU or US are excluded.</p>
      <div class="cr-bulk-scroll" id="cr-products-publish-body">
        ${eligible.map((item) => productRowHtml(item, { checked: true })).join("")}
      </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const keys = selectedRowsFromRoot("cr-products-publish-body");
      const selected = eligible.filter((item) => keys.has(listingKey(item)));
      if (!selected.length) throw new Error("Select at least one product");
      setModalBusy(true, "Publishing…");
      clearSelection();
      setModalBusy(false);

      const { ok, errors } = await startProductsActionDock(selected, {
        action: "publish",
        runItem: (item) =>
          partnerFetch("admin-amazon-publish", {
            method: "POST",
            body: {
              product_key: item.product_key || "",
              shopify_product_id: item.shopify_product_id || item.id || "",
              published_design_id: item.published_design_id || undefined,
              // Catalog Channels use "europa" / "amerika" (not "eu" / "us").
              continents: ["europa"],
              dry_run: false,
              live_submit: true,
            },
          }),
      });
      if (typeof onDone === "function") await onDone({ ok, errors });
    },
  });
  configurePrimaryConfirm("Publish selected");
}

/** Unpublish selected products from eazpire (Shopify) and/or Amazon EU (DE). */
export async function openProductsBulkUnpublishModal(items, { onDone } = {}) {
  const eligible = (items || []).filter(
    (p) => p.shopify_product_id || p.id || p.amazon_eu_channel || p.amazon_eu_listed || p.amazon_us_channel || p.amazon_us_listed
  );
  if (!eligible.length) {
    releaseBulkDock();
    showToast("Unpublish", "No eligible products selected");
    return;
  }
  suppressBulkDock();

  const body = `
    <p class="confirm-modal-message">Unpublish from eazpire and/or Amazon EU (DE). Select channels per product.</p>
    <div class="cr-bulk-scroll" id="cr-products-unpublish-body">
      ${eligible
        .map((item) => {
          const key = listingKey(item);
          const preview = item.preview_url || item.grid_views?.[0]?.src || "";
          const hasAmazonEu = !!(item.amazon_eu_channel || item.amazon_eu_listed);
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
                    )}" checked /> <span>Amazon EU (DE)</span></label>`
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
      const targets = new Map(); // key -> { item, eazpire: bool, amazon_eu: bool }
      for (const cb of checked) {
        const key = cb.getAttribute("data-product-key") || "";
        const item = byKey.get(key);
        if (!item) continue;
        if (!targets.has(key)) targets.set(key, { item, eazpire: false, amazon_eu: false });
        targets.get(key)[cb.getAttribute("data-channel") || ""] = true;
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
                continents: ["europa"],
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
