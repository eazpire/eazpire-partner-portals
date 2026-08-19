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
import { startProductsActionDock, startProductsAltTextFixDock, startProductsAmazonPublishDock } from "./products-action-dock.js";
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
      <p class="confirm-modal-message">Queues a server job for every selected Shopify listing: missing or wrong Color|view labels, lifestyle/back labeled as front, and the card preview. If the product is already listed on Amazon, matching main/gallery images are updated there too. You can close this page — the queue keeps running.</p>
      <div class="cr-bulk-scroll" id="cr-products-alt-texts-body">
        ${eligible.map((item) => productRowHtml(item, { checked: true })).join("")}
      </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const keys = selectedRowsFromRoot("cr-products-alt-texts-body");
      const selected = eligible.filter((item) => keys.has(listingKey(item)));
      if (!selected.length) throw new Error("Select at least one product");
      setModalBusy(true, "Queueing…");
      clearSelection();
      setModalBusy(false);

      const { ok, errors } = await startProductsAltTextFixDock(selected, { onDone });
      return { ok, errors };
    },
  });
  configurePrimaryConfirm("Queue and repair");
}

function shopifyIdOf(item) {
  return String(item?.shopify_product_id || item?.id || "")
    .replace("gid://shopify/Product/", "")
    .replace(/\.0$/, "")
    .trim();
}

function formatRemoveVariantError(err) {
  const code = String(err?.error || err?.message || err || "");
  if (code === "last_color_blocked") return "This is the last remaining color on the listing";
  if (code === "color_not_on_product") return "This color is not on the Printify listing";
  if (code === "printify_product_id_required" || code === "printify_product_missing") {
    return "No Printify listing is linked";
  }
  if (/http_504|http_524|http_503|timed?\s*out|Worker exceeded|network/i.test(code)) {
    return "The request took too long. Try again — Printify and Shopify are now updated separately so this should finish.";
  }
  return code || "Remove variant failed";
}

async function waitForRemoveVariantSession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const prog = await partnerFetch("get-publish-progress", { query: { session_id: sid } });
    const products = prog?.products || [];
    const failed = products.find((p) => p.status === "error");
    if (failed) throw new Error(failed.message || "Remove variant failed");
    if (prog?.done || (products.length && products.every((p) => p.status === "completed"))) {
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Remove variant timed out");
}

/** Disable one color on selected Printify listings and sync Shopify / Amazon. */
export async function openProductsRemoveVariantModal(items, { color, onDone, onStarted } = {}) {
  const picked = String(color || "").trim();
  if (!picked) {
    releaseBulkDock();
    showToast("Remove Variant", "Select a color in the Variants bar first");
    return;
  }

  const { summarizeRemoveVariantImpact, productHasColor, channelsForRemoveColorVariant, colorHexForName } =
    await import("./products-color-facets.js");
  const impact = summarizeRemoveVariantImpact(items, picked);
  const eligible = impact.products
    .map((row) => row.item)
    .filter((item) => item.printify_product_id && shopifyIdOf(item) && item.product_key);

  if (!eligible.length) {
    releaseBulkDock();
    showToast("Remove Variant", "No selected products have that color on a Printify listing");
    return;
  }

  suppressBulkDock();
  const channelLine = impact.channels.length
    ? impact.channels.map((ch) => `${escapeHtml(ch.label)} (${ch.count})`).join(", ")
    : "Printify / Shopify (resolved per product)";
  const hex = colorHexForName(picked);

  openModal({
    title: eligible.length === 1 ? "Remove variant" : `Remove variant from ${eligible.length} products`,
    bodyHtml: `
      <p class="confirm-modal-message">
        Disable <strong>${escapeHtml(picked)}</strong> on the selected listings. Printify is updated first, then Shopify and any live Amazon channels stay in sync.
      </p>
      <div class="cr-remove-variant-summary">
        <div class="cr-remove-variant-summary__color" style="--cr-dot:${escapeHtml(hex)}">
          <span class="cr-remove-variant-summary__dot" aria-hidden="true"></span>
          <span>${escapeHtml(picked)}</span>
        </div>
        <p><strong>${eligible.length}</strong> product${eligible.length === 1 ? "" : "s"} · Channels: ${channelLine}</p>
      </div>
      <div class="cr-bulk-scroll" id="cr-products-remove-variant-body">
        ${eligible
          .map((item) => {
            const channels = channelsForRemoveColorVariant(item)
              .map((id) => {
                const found = impact.channels.find((c) => c.id === id);
                return found?.label || id;
              })
              .join(", ");
            return `${productRowHtml(item, { checked: true })}${
              channels ? `<p class="cr-remove-variant-channels">${escapeHtml(channels)}</p>` : ""
            }`;
          })
          .join("")}
      </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const keys = selectedRowsFromRoot("cr-products-remove-variant-body");
      const selected = eligible.filter((item) => keys.has(listingKey(item)));
      if (!selected.length) throw new Error("Select at least one product");
      clearSelection();
      if (typeof onStarted === "function") onStarted();
      // Return immediately so partner-shell closeModal() runs; dock shows progress / errors.
      void startProductsActionDock(selected, {
        action: "remove-variant",
        runItem: async (item) => {
          if (!item.printify_product_id) {
            return { ok: false, error: "No Printify listing is linked" };
          }
          try {
            const data = await partnerFetch("admin-creations-remove-color-variant", {
              method: "POST",
              body: {
                color: picked,
                printify_product_id: item.printify_product_id,
                shopify_product_id: shopifyIdOf(item),
                product_key: item.product_key,
                design_id: item.design_id || null,
                published_design_id: item.published_design_id || null,
                product_title: productTitle(item),
                owner_id: item.owner_id || "admin",
                print_provider_id: item.print_provider_id || 0,
                channels: channelsForRemoveColorVariant(item),
              },
            });
            if (data?.session_id) await waitForRemoveVariantSession(data.session_id);
            return { ok: true };
          } catch (err) {
            throw new Error(formatRemoveVariantError(err.data || err));
          }
        },
        onDone,
      }).catch((e) => {
        console.error("[products-bulk] remove-variant dock failed:", e);
        showToast("Error", e?.message || "Remove variant failed");
      });
    },
  });
  configurePrimaryConfirm("Remove variant");
}
