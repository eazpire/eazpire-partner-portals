/**
 * Creations Portal Designs — Remove / Publish / Update bulk modals (IDEA-057).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { openModal, showToast } from "/creations/shared/js/partner-shell.js";
import { clearSelection, releaseBulkDock, suppressBulkDock } from "./designs-bulk.js";
import {
  mountOfflineProductMedia,
  mountCleanProductMedia,
  bindProdCarousels,
  productCarouselHtml,
} from "./designs-product-media.js";
import { trackPublishSessions, startPublishDockWatch, getPublishingDesignIds } from "./designs-publish-dock.js";

const PHASE1_CHANNELS = new Set(["printify", "todify", "shopify"]);

function designIdOf(item) {
  const n = Number(item?.id || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function jobIdOf(item) {
  return String(item?.job_id || "").trim();
}

function designTitle(item, fallback = "Design") {
  return String(item?.title || fallback).trim() || fallback;
}

function channelKey(product) {
  return String(product?.channel || "printify")
    .trim()
    .toLowerCase() || "printify";
}

function channelLabel(productOrKey) {
  if (typeof productOrKey === "string") {
    const k = productOrKey.toLowerCase();
    if (k === "printify") return "Printify";
    if (k === "todify") return "Todify";
    if (k === "shopify") return "Shopify";
    if (k === "amazon") return "Amazon";
    return productOrKey;
  }
  return String(productOrKey?.channel_label || channelLabel(channelKey(productOrKey)));
}

/** Expand published products into channel buckets (manufacturing + Shopify when live). */
function groupPublishedByChannel(products) {
  const groups = new Map();
  for (const p of products || []) {
    const keys =
      Array.isArray(p.channels) && p.channels.length
        ? p.channels
        : [channelKey(p)];
    for (const raw of keys) {
      const key = String(raw || "printify").toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
  }
  return groups;
}

function groupCatalogByChannel(products) {
  const groups = new Map();
  for (const p of products || []) {
    const key = channelKey(p);
    // Phase 1: hide Amazon from publish picker
    if (key === "amazon") continue;
    if (!PHASE1_CHANNELS.has(key) && key !== "printify" && key !== "todify" && key !== "shopify") {
      // still show unknown manufacturing channels in phase 1 except amazon
      if (key.startsWith("amazon")) continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return groups;
}

function channelOrder(keys) {
  const preferred = ["printify", "todify", "shopify", "amazon"];
  const list = [...keys];
  list.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return list;
}

function productListHtml(products) {
  if (!products?.length) return `<p class="cr-bulk-empty">No products</p>`;
  return `<ul class="cr-bulk-product-list">${products
    .map(
      (p) =>
        `<li class="cr-bulk-product-list__item">
          <span class="cr-bulk-product-list__name">${escapeHtml(p.product_name || p.title || p.product_key || "Product")}</span>
          ${p.shopify_live ? '<span class="cr-badge">Shopify live</span>' : ""}
        </li>`
    )
    .join("")}</ul>`;
}

function channelContainersHtml(groups, { open = true } = {}) {
  const keys = channelOrder(groups.keys());
  if (!keys.length) return `<p class="cr-bulk-empty">No published products on any channel.</p>`;
  return keys
    .map((key, idx) => {
      const items = groups.get(key) || [];
      const openAttr = open && idx === 0 ? "open" : open && keys.length === 1 ? "open" : "";
      return `<details class="cr-channel" ${openAttr}>
        <summary class="cr-channel__summary">
          <span>${escapeHtml(channelLabel(key))}</span>
          <span class="cr-channel__count">${items.length}</span>
        </summary>
        <div class="cr-channel__body">${productListHtml(items)}</div>
      </details>`;
    })
    .join("");
}

function designShellHtml(title, bodyHtml, designId = "") {
  const idAttr = designId ? ` data-design-id="${escapeHtml(String(designId))}"` : "";
  return `<details class="cr-design-group" open${idAttr}>
    <summary class="cr-design-group__summary">${escapeHtml(title)}</summary>
    <div class="cr-design-group__body">${bodyHtml}</div>
  </details>`;
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

function configureDangerConfirm(label) {
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) {
    saveBtn.textContent = label || "Delete permanently";
    saveBtn.className = "btn btn-danger";
  }
}

function configurePrimaryConfirm(label) {
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) {
    saveBtn.textContent = label || "Confirm";
    saveBtn.className = "btn btn-primary";
  }
}

async function fetchDeletePreview(item) {
  const designId = designIdOf(item);
  const jobId = jobIdOf(item);
  const query = { action: "delete" };
  if (designId) query.design_id = designId;
  else if (jobId) query.job_id = jobId;
  else throw new Error("Design has no id");
  return partnerFetch("admin-design-action-preview", { query });
}

async function fetchPublishPreview(item) {
  const designId = designIdOf(item);
  if (!designId) throw new Error("Unsaved designs cannot be published");
  // studio_scope=missing: only attach Design Studio previews for unpublished products (faster bulk open).
  return partnerFetch("admin-design-action-preview", {
    query: { action: "publish", design_id: designId, studio_scope: "missing" },
  });
}

async function fetchUpdatePreview(item) {
  const designId = designIdOf(item);
  if (!designId) throw new Error("Unsaved designs cannot be updated");
  return partnerFetch("admin-design-action-preview", {
    query: { action: "update", design_id: designId },
  });
}

async function fetchUnpublishPreview(item) {
  const designId = designIdOf(item);
  if (!designId) throw new Error("Unsaved designs cannot be unpublished");
  return partnerFetch("admin-design-action-preview", {
    query: { action: "unpublish", design_id: designId },
  });
}

function salesChannelsForProduct(product) {
  if (Array.isArray(product?.sales_channels) && product.sales_channels.length) {
    return product.sales_channels;
  }
  // Fallback: manufacturing + shopify labels from delete/publish enrich
  const keys =
    Array.isArray(product?.channels) && product.channels.length
      ? product.channels
      : [channelKey(product)];
  return keys.map((key) => {
    const k = String(key || "printify").toLowerCase();
    if (k === "shopify") return { key: "eazpire", label: "eazpire", kind: "eazpire" };
    return { key: k, label: channelLabel(k), kind: "manufacturing" };
  });
}

function syncUnpublishConfirmEnabled(root) {
  const saveBtn = document.getElementById("modal-save");
  if (!saveBtn) return;
  const checked = root?.querySelectorAll?.(".cr-unpub-ch__cb:checked")?.length || 0;
  saveBtn.disabled = checked < 1;
}

function bindUnpublishCheckboxUi(root) {
  if (!root) return;
  const update = () => syncUnpublishConfirmEnabled(root);

  root.querySelectorAll("[data-cr-unpub-all]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.getAttribute("data-cr-unpub-all") === "1";
      root.querySelectorAll(".cr-unpub-ch__cb").forEach((cb) => {
        cb.checked = on;
      });
      root.querySelectorAll(".cr-unpub-prod__cb").forEach((cb) => {
        cb.checked = on;
        cb.indeterminate = false;
      });
      update();
    });
  });

  root.querySelectorAll(".cr-unpub-prod__cb").forEach((prodCb) => {
    prodCb.addEventListener("change", () => {
      const block = prodCb.closest(".cr-unpub-prod");
      block?.querySelectorAll(".cr-unpub-ch__cb").forEach((cb) => {
        cb.checked = prodCb.checked;
      });
      prodCb.indeterminate = false;
      update();
    });
  });

  root.querySelectorAll(".cr-unpub-ch__cb").forEach((chCb) => {
    chCb.addEventListener("change", () => {
      const block = chCb.closest(".cr-unpub-prod");
      const prodCb = block?.querySelector(".cr-unpub-prod__cb");
      const boxes = [...(block?.querySelectorAll(".cr-unpub-ch__cb") || [])];
      const n = boxes.filter((b) => b.checked).length;
      if (prodCb) {
        prodCb.checked = n === boxes.length && n > 0;
        prodCb.indeterminate = n > 0 && n < boxes.length;
      }
      update();
    });
  });

  update();
}

function unpublishProductBlockHtml(product) {
  const productKey = String(product.product_key || "");
  const publishedId = Number(product.published_id || 0);
  const title = product.product_name || product.title || productKey || "Product";
  const channels = salesChannelsForProduct(product);
  const channelRows = channels
    .map((ch) => {
      const key = String(ch.key || "");
      const kind = String(ch.kind || "eazpire");
      const continent = ch.continent ? String(ch.continent) : "";
      const marketplaceId = ch.marketplace_id ? String(ch.marketplace_id) : "";
      return `<label class="cr-unpub-ch">
        <input type="checkbox" class="cr-unpub-ch__cb" checked
          data-product-key="${escapeHtml(productKey)}"
          data-published-id="${escapeHtml(String(publishedId || ""))}"
          data-channel-key="${escapeHtml(key)}"
          data-channel-kind="${escapeHtml(kind)}"
          data-continent="${escapeHtml(continent)}"
          data-marketplace-id="${escapeHtml(marketplaceId)}" />
        <span>${escapeHtml(ch.label || key)}</span>
      </label>`;
    })
    .join("");
  return `<div class="cr-unpub-prod" data-product-key="${escapeHtml(productKey)}">
    <label class="cr-unpub-prod__head">
      <input type="checkbox" class="cr-unpub-prod__cb" checked />
      <span class="cr-unpub-prod__title">${escapeHtml(title)}</span>
      ${product.shopify_live ? '<span class="cr-badge">Shopify live</span>' : ""}
    </label>
    <div class="cr-unpub-prod__channels">${channelRows || `<p class="cr-bulk-empty">No active channels</p>`}</div>
  </div>`;
}

export async function openRemoveModal(items, { onDone } = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) {
    releaseBulkDock();
    showToast("Remove", "Select at least one design");
    return;
  }
  suppressBulkDock();

  const previews = [];
  for (const item of list) {
    try {
      const data = await fetchDeletePreview(item);
      previews.push({ item, data });
    } catch (e) {
      previews.push({ item, error: e.message || "Preview failed" });
    }
  }

  const body = previews
    .map(({ item, data, error }) => {
      if (error) {
        return designShellHtml(designTitle(item), `<p class="cr-bulk-error">${escapeHtml(error)}</p>`);
      }
      const products = data.published_products || [];
      const groups = groupPublishedByChannel(products);
      const warn =
        products.length > 0
          ? `<p class="cr-bulk-warn">This permanently deletes the design and all channel listings below.</p>`
          : `<p class="confirm-modal-message">No published products. The design will be deleted.</p>`;
      return designShellHtml(
        designTitle(item, data.design_title),
        `${warn}${channelContainersHtml(groups, { open: true })}`
      );
    })
    .join("");

  openModal({
    title: list.length === 1 ? "Remove design" : `Remove ${list.length} designs`,
    bodyHtml: `
      <p class="confirm-modal-message">Type <strong>DELETE</strong> to confirm. This cannot be undone.</p>
      <div class="field">
        <label for="cr-bulk-delete-confirm">Confirmation</label>
        <input class="input" id="cr-bulk-delete-confirm" autocomplete="off" placeholder="DELETE" />
      </div>
      <div class="cr-bulk-scroll">${body}</div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      const typed = String(document.getElementById("cr-bulk-delete-confirm")?.value || "").trim();
      if (typed !== "DELETE") throw new Error("Type DELETE to confirm");
      setModalBusy(true, "Deleting…");
      let ok = 0;
      const errors = [];
      for (const { item } of previews) {
        try {
          const designId = designIdOf(item);
          const jobId = jobIdOf(item);
          const bodyPayload = { confirm_text: "DELETE" };
          if (designId) bodyPayload.design_id = designId;
          else if (jobId) bodyPayload.job_id = jobId;
          await partnerFetch("admin-design-delete", { method: "POST", body: bodyPayload });
          ok += 1;
        } catch (e) {
          errors.push(`${designTitle(item)}: ${e.message || "failed"}`);
        }
      }
      setModalBusy(false);
      clearSelection();
      if (ok) showToast("Removed", `${ok} design${ok === 1 ? "" : "s"} deleted`);
      if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));
      if (typeof onDone === "function") await onDone({ ok, errors });
    },
  });
  configureDangerConfirm("Delete permanently");
}

function publishProductCardHtml(product, { checked = true, designCountLabel = "", global = false } = {}) {
  const key = String(product.product_key || "");
  const title = product.title || product.product_name || key;
  const countHtml = designCountLabel
    ? `<span class="cr-dd-prod__design-count" data-cr-pub-count="${escapeHtml(key)}">${escapeHtml(designCountLabel)}</span>`
    : `<span class="cr-dd-prod__design-count" data-cr-pub-count="${escapeHtml(key)}" hidden></span>`;
  const extraClass = global ? " cr-pub-global-card" : "";
  return `<article class="cr-dd-prod is-offline is-selected${extraClass}" data-product-key="${escapeHtml(key)}" data-online="0">
    <label class="cr-dd-prod__check">
      <input type="checkbox" class="cr-dd-prod__cb cr-pub-card__cb" data-product-key="${escapeHtml(key)}" ${
    checked ? "checked" : ""
  } />
    </label>
    <div class="cr-dd-prod__media" data-cr-dd-prod-media></div>
    ${countHtml}
    <div class="cr-dd-prod__title">${escapeHtml(title)}</div>
  </article>`;
}

function publishChannelHtml(channel, products, { cardOpts = {} } = {}) {
  const cards = products.map((p) => publishProductCardHtml(p, { checked: true, ...cardOpts })).join("");
  return `<details class="cr-channel" open>
    <summary class="cr-channel__summary">
      <span>${escapeHtml(channelLabel(channel))}</span>
      <span class="cr-channel__count">${products.length}</span>
    </summary>
    <div class="cr-channel__body">
      ${productCarouselHtml(cards)}
    </div>
  </details>`;
}

function publishDesignBlockHtml(item, data, error) {
  const id = designIdOf(item);
  if (error) return designShellHtml(designTitle(item), `<p class="cr-bulk-error">${escapeHtml(error)}</p>`, id);
  const missing = (data.missing_products || []).filter((p) => channelKey(p) !== "amazon");
  if (!missing.length) {
    return designShellHtml(
      designTitle(item, data.design_title),
      `<p class="cr-bulk-empty">All admin catalog products are already published.</p>`,
      id
    );
  }
  const groups = groupCatalogByChannel(missing);
  const channelsHtml = channelOrder(groups.keys())
    .map((ch) => publishChannelHtml(ch, groups.get(ch) || []))
    .join("");
  return designShellHtml(
    designTitle(item, data.design_title),
    `<p class="confirm-modal-message">Only unpublished products. All admin variants are selected by default (Skill Tree ignored).</p>${channelsHtml}`,
    id
  );
}

/** Union of missing products across designs — for global Clean Mockups picker. */
function collectGlobalPublishProducts(blocks) {
  const byKey = new Map();
  for (const { data, error } of blocks) {
    if (error || !data) continue;
    for (const p of data.missing_products || []) {
      if (channelKey(p) === "amazon") continue;
      const key = String(p.product_key || "").trim();
      if (!key || byKey.has(key)) continue;
      byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

function designCountLabel(selected, total) {
  if (!total) return "";
  if (total === 1) return selected ? "1 design" : "0/1 designs";
  return `${selected}/${total} designs`;
}

function publishGlobalSectionHtml(products) {
  if (!products.length) return "";
  const groups = groupCatalogByChannel(products);
  const channelsHtml = channelOrder(groups.keys())
    .map((ch) => {
      const list = groups.get(ch) || [];
      const cards = list
        .map((p) => publishProductCardHtml(p, { checked: true, global: true }))
        .join("");
      return `<details class="cr-channel" open>
        <summary class="cr-channel__summary">
          <span>${escapeHtml(channelLabel(ch))}</span>
          <span class="cr-channel__count">${list.length}</span>
        </summary>
        <div class="cr-channel__body">
          ${productCarouselHtml(cards)}
        </div>
      </details>`;
    })
    .join("");
  return `<section class="cr-pub-global" id="cr-pub-global">
    <h3 class="cr-pub-global__title">Clean mockups — apply to all designs</h3>
    <p class="confirm-modal-message">Select or deselect products here to toggle them for every design below. Previews show the blank product (no design).</p>
    ${channelsHtml}
  </section>`;
}

function countProductAcrossDesigns(root, productKey) {
  const groups = [...(root?.querySelectorAll(".cr-design-group[data-design-id]") || [])];
  let total = 0;
  let selected = 0;
  for (const group of groups) {
    const cb = group.querySelector(`.cr-pub-card__cb[data-product-key="${CSS.escape(productKey)}"]`);
    if (!cb) continue;
    total += 1;
    if (cb.checked) selected += 1;
  }
  return { selected, total };
}

function syncPublishDesignCountLabels(root) {
  if (!root) return;
  const keys = new Set(
    [...root.querySelectorAll(".cr-pub-card__cb[data-product-key]")].map((cb) => cb.getAttribute("data-product-key") || "").filter(Boolean)
  );
  for (const key of keys) {
    const { selected, total } = countProductAcrossDesigns(root, key);
    const label = designCountLabel(selected, total);
    root.querySelectorAll(`[data-cr-pub-count="${CSS.escape(key)}"]`).forEach((el) => {
      if (!total) {
        el.hidden = true;
        el.textContent = "";
        return;
      }
      el.hidden = false;
      el.textContent = label;
    });
  }
  // Sync global card checkbox / indeterminate from per-design state
  root.querySelectorAll("#cr-pub-global .cr-pub-global-card").forEach((card) => {
    const key = card.getAttribute("data-product-key") || "";
    const cb = card.querySelector(".cr-pub-card__cb");
    if (!cb || !key) return;
    const { selected, total } = countProductAcrossDesigns(root, key);
    cb.checked = total > 0 && selected === total;
    cb.indeterminate = selected > 0 && selected < total;
    card.classList.toggle("is-selected", selected > 0);
  });
}

function setProductCheckedForAllDesigns(root, productKey, checked) {
  root.querySelectorAll(`.cr-design-group .cr-pub-card__cb[data-product-key="${CSS.escape(productKey)}"]`).forEach((cb) => {
    cb.checked = !!checked;
    cb.closest(".cr-dd-prod")?.classList.toggle("is-selected", !!checked);
  });
}

function mountPublishProductMedia(root, blocks) {
  if (!root) return;
  // Clean mockups (global section)
  const globalSection = root.querySelector("#cr-pub-global");
  if (globalSection) {
    for (const p of collectGlobalPublishProducts(blocks)) {
      const key = String(p.product_key || "");
      if (!key) continue;
      const card = globalSection.querySelector(`.cr-pub-global-card[data-product-key="${CSS.escape(key)}"]`);
      const media = card?.querySelector("[data-cr-dd-prod-media]");
      if (!media) continue;
      mountCleanProductMedia(media, p);
      const badge = document.createElement("span");
      badge.className = "cr-badge cr-badge--clean";
      badge.textContent = "Clean";
      media.appendChild(badge);
    }
  }

  for (const { item, data, error } of blocks) {
    if (error || !data) continue;
    const designId = designIdOf(item);
    const designUrl = String(
      data.design_preview_url || item.preview_url || item.original_url || ""
    ).trim();
    const group = root.querySelector(`.cr-design-group[data-design-id="${CSS.escape(String(designId))}"]`);
    if (!group) continue;
    for (const p of data.missing_products || []) {
      if (channelKey(p) === "amazon") continue;
      const key = String(p.product_key || "");
      if (!key) continue;
      const card = group.querySelector(`.cr-dd-prod[data-product-key="${CSS.escape(key)}"]`);
      const media = card?.querySelector("[data-cr-dd-prod-media]");
      if (!media) continue;
      mountOfflineProductMedia(media, p, designUrl);
      const badge = document.createElement("span");
      badge.className = "cr-badge cr-badge--offline";
      badge.textContent = "Offline";
      media.appendChild(badge);
    }
  }
  bindProdCarousels(root);
  root.querySelectorAll("details.cr-channel").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (details.open) requestAnimationFrame(() => bindProdCarousels(details));
    });
  });

  root.querySelectorAll("#cr-pub-global .cr-pub-global-card .cr-pub-card__cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-product-key") || "";
      if (!key) return;
      setProductCheckedForAllDesigns(root, key, cb.checked);
      cb.indeterminate = false;
      cb.closest(".cr-dd-prod")?.classList.toggle("is-selected", !!cb.checked);
      syncPublishDesignCountLabels(root);
    });
  });

  root.querySelectorAll(".cr-design-group .cr-pub-card__cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const card = cb.closest(".cr-dd-prod");
      card?.classList.toggle("is-selected", !!cb.checked);
      syncPublishDesignCountLabels(root);
    });
  });

  syncPublishDesignCountLabels(root);
}

function setPublishModalChrome() {
  const modal = document.querySelector("#modal-backdrop .modal");
  modal?.classList.add("cr-bulk-publish-modal");
  configurePrimaryConfirm("Publish selected");
}

export async function openPublishModal(items, { onDone } = {}) {
  const list = (items || []).filter((item) => designIdOf(item) && !getPublishingDesignIds().has(Number(item?.id || 0)));
  if (!list.length) {
    releaseBulkDock();
    showToast("Publish", "Select at least one saved design");
    return;
  }

  suppressBulkDock();
  const blocks = [];
  let publishBusy = true;

  openModal({
    title: list.length === 1 ? "Publish products" : `Publish ${list.length} designs`,
    bodyHtml: `<div class="cr-bulk-scroll" id="cr-publish-body">
      <p class="cr-bulk-loading">Loading unpublished products…</p>
    </div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      if (publishBusy) throw new Error("Still loading product previews");
      setModalBusy(true, "Publishing…");
      let queued = 0;
      const errors = [];
      const tracked = [];
      for (const { item, data, error } of blocks) {
        if (error || !data) continue;
        const designId = designIdOf(item);
        const group = document.querySelector(`#cr-publish-body .cr-design-group[data-design-id="${designId}"]`);
        // Scoped to this design group so global Clean Mockups checkboxes are not double-counted
        const keys = [...(group?.querySelectorAll(".cr-pub-card__cb:checked") || [])]
          .map((el) => el.getAttribute("data-product-key") || "")
          .filter(Boolean);
        const allowed = new Set((data.missing_products || []).map((p) => String(p.product_key || "")));
        const product_keys = [...new Set(keys.filter((k) => allowed.has(k)))];
        if (!product_keys.length) continue;
        try {
          const res = await partnerFetch("admin-design-publish-missing-online", {
            method: "POST",
            body: { design_id: designId, product_keys, region_code: "EU" },
          });
          queued += 1;
          const sid = String(res?.session_id || res?.publish_session_id || "").trim();
          if (sid) {
            const byKey = new Map(
              (data.missing_products || []).map((p) => [String(p.product_key || ""), p])
            );
            tracked.push({
              session_id: sid,
              design_id: designId,
              design_title: designTitle(item, data.design_title),
              design_preview_url: String(
                data.design_preview_url || item.preview_url || item.original_url || ""
              ).trim(),
              products: product_keys.map((pk) => {
                const p = byKey.get(pk) || { product_key: pk };
                return {
                  product_key: pk,
                  title: p.title || p.product_name || pk,
                  status: "pending",
                  progress: 0,
                  message: "Waiting…",
                  mock_url: p.mock_url || "",
                  mock_urls: p.mock_urls || [],
                  studio_card_preview: p.studio_card_preview || null,
                  channel: p.channel || "printify",
                };
              }),
            });
          }
        } catch (e) {
          errors.push(`${designTitle(item)}: ${e.message || "failed"}`);
        }
      }
      setModalBusy(false);
      clearSelection();
      if (tracked.length) {
        trackPublishSessions(tracked);
        startPublishDockWatch();
      }
      if (queued) showToast("Publish queued", `${queued} design${queued === 1 ? "" : "s"} enqueued`);
      if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));
      if (typeof onDone === "function") await onDone({ queued, errors, sessions: tracked });
    },
  });
  setPublishModalChrome();
  setModalBusy(true, "Loading…");

  const settled = await Promise.all(
    list.map(async (item) => {
      try {
        const data = await fetchPublishPreview(item);
        return { item, data };
      } catch (e) {
        return { item, error: e.message || "Preview failed" };
      }
    })
  );
  blocks.push(...settled);

  const bodyEl = document.getElementById("cr-publish-body");
  if (!bodyEl || !document.getElementById("modal-backdrop")?.classList.contains("show")) {
    releaseBulkDock();
    return;
  }

  const globalProducts = collectGlobalPublishProducts(blocks);
  const designsHtml = blocks.map(({ item, data, error }) => publishDesignBlockHtml(item, data, error)).join("");
  bodyEl.innerHTML = `${publishGlobalSectionHtml(globalProducts)}${designsHtml}`;
  mountPublishProductMedia(bodyEl, blocks);
  publishBusy = false;
  setModalBusy(false);
  configurePrimaryConfirm("Publish selected");
}

/**
 * Context-menu / single-design unpublish with per-product + per-channel checkboxes.
 */
export async function openDesignUnpublishModal(item, { onDone } = {}) {
  if (!item || !designIdOf(item)) {
    showToast("Unpublish", "Only saved designs can be unpublished");
    return;
  }

  let data;
  try {
    data = await fetchUnpublishPreview(item);
  } catch (e) {
    showToast("Error", e.message || "Could not load published products");
    return;
  }

  const products = (data.published_products || []).filter((p) => {
    const sales = salesChannelsForProduct(p);
    return sales.length > 0;
  });

  if (!products.length) {
    openModal({
      title: "Unpublish",
      bodyHtml: `<p class="confirm-modal-message">This design has no live products or active sales channels to unpublish.</p>`,
      onSave: async () => {},
    });
    const saveBtn = document.getElementById("modal-save");
    if (saveBtn) saveBtn.style.display = "none";
    return;
  }

  const body = `
    <p class="confirm-modal-message">Select products and channels to unpublish. All are selected by default. At least one channel is required.</p>
    <div class="cr-unpub-toolbar">
      <button type="button" class="btn btn-secondary btn-sm" data-cr-unpub-all="1">Select all</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cr-unpub-all="0">Deselect all</button>
    </div>
    <div class="cr-bulk-scroll" id="cr-unpub-body">
      ${products.map(unpublishProductBlockHtml).join("")}
    </div>`;

  openModal({
    title: `Unpublish — ${designTitle(item, data.design_title)}`,
    bodyHtml: body,
    onSave: async () => {
      const root = document.getElementById("cr-unpub-body");
      const selected = [...(root?.querySelectorAll(".cr-unpub-ch__cb:checked") || [])];
      if (!selected.length) throw new Error("Select at least one channel");

      const eazpireByKey = new Map();
      const amazonByPublished = new Map();

      for (const cb of selected) {
        const kind = cb.getAttribute("data-channel-kind") || "";
        const productKey = cb.getAttribute("data-product-key") || "";
        const publishedId = Number(cb.getAttribute("data-published-id") || 0);
        if (kind === "amazon") {
          const continent = cb.getAttribute("data-continent") || "";
          if (!publishedId || !continent) continue;
          if (!amazonByPublished.has(publishedId)) {
            amazonByPublished.set(publishedId, { published_id: publishedId, continents: new Set() });
          }
          amazonByPublished.get(publishedId).continents.add(continent);
        } else {
          // eazpire / manufacturing / shopify → Shopify unpublish for this product
          if (!productKey && !publishedId) continue;
          eazpireByKey.set(productKey || `id:${publishedId}`, {
            product_key: productKey,
            published_id: publishedId,
          });
        }
      }

      if (!eazpireByKey.size && !amazonByPublished.size) {
        throw new Error("Select at least one channel");
      }

      setModalBusy(true, "Unpublishing…");
      const errors = [];
      let queued = 0;

      try {
        if (eazpireByKey.size) {
          const product_keys = [...eazpireByKey.values()].map((v) => v.product_key).filter(Boolean);
          const published_ids = [...eazpireByKey.values()]
            .map((v) => v.published_id)
            .filter((n) => Number.isFinite(n) && n > 0);
          await partnerFetch("admin-design-unpublish", {
            method: "POST",
            body: {
              design_id: designIdOf(item),
              product_keys,
              published_ids,
            },
          });
          queued += product_keys.length || published_ids.length;
        }

        for (const { published_id, continents } of amazonByPublished.values()) {
          try {
            await partnerFetch("admin-amazon-unpublish", {
              method: "POST",
              body: {
                published_design_id: published_id,
                continents: [...continents],
              },
            });
            queued += continents.size;
          } catch (e) {
            errors.push(`Amazon #${published_id}: ${e.message || "failed"}`);
          }
        }
      } catch (e) {
        setModalBusy(false);
        throw e;
      }

      setModalBusy(false);
      if (queued) showToast("Unpublish", `${queued} channel action(s) queued`);
      if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));
      if (typeof onDone === "function") await onDone({ queued, errors });
    },
  });
  configurePrimaryConfirm("Unpublish selected");
  const modalBody = document.getElementById("modal-body");
  bindUnpublishCheckboxUi(modalBody);
}

export async function openUpdateModal(items, { onDone } = {}) {
  const list = (items || []).filter((item) => designIdOf(item));
  if (!list.length) {
    releaseBulkDock();
    showToast("Update", "Select at least one saved design");
    return;
  }
  suppressBulkDock();

  const blocks = [];
  for (const item of list) {
    try {
      const data = await fetchUpdatePreview(item);
      blocks.push({ item, data });
    } catch (e) {
      blocks.push({ item, error: e.message || "Diff failed" });
    }
  }

  const updatable = blocks.filter(
    ({ data, error }) =>
      !error &&
      data &&
      (data.has_updatable_changes ||
        data.summary?.image_changed ||
        Number(data.summary?.changed_fields || 0) > 0)
  );

  if (!updatable.length) {
    openModal({
      title: "Update listings",
      bodyHtml: `<p class="confirm-modal-message">No online products with design or default changes since publish.</p>`,
      onCancel: () => releaseBulkDock(),
      onSave: async () => {
        releaseBulkDock();
      },
    });
    const saveBtn = document.getElementById("modal-save");
    if (saveBtn) saveBtn.style.display = "none";
    return;
  }

  const body = updatable
    .map(({ item, data }) => {
      const products = (data.published_products || []).filter((p) => p.shopify_live);
      const groups = groupPublishedByChannel(products);
      const fields = (data.changed_field_keys || []).slice(0, 8).map((f) => escapeHtml(f)).join(", ");
      const bits = [];
      if (data.summary?.image_changed || data.image_changed) bits.push("design image");
      if (fields) bits.push(`metadata: ${fields}`);
      return designShellHtml(
        designTitle(item, data.design_title),
        `<p class="confirm-modal-message">Changes detected (${bits.join(" · ") || "defaults"}).</p>${channelContainersHtml(groups, { open: true })}`,
        designIdOf(item)
      );
    })
    .join("");

  openModal({
    title: updatable.length === 1 ? "Update listings" : `Update ${updatable.length} designs`,
    bodyHtml: `<div class="cr-bulk-scroll">${body}</div>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      setModalBusy(true, "Updating…");
      let ok = 0;
      const errors = [];
      for (const { item } of updatable) {
        try {
          await partnerFetch("admin-design-update-commit", {
            method: "POST",
            body: { design_id: designIdOf(item) },
          });
          ok += 1;
        } catch (e) {
          errors.push(`${designTitle(item)}: ${e.message || "failed"}`);
        }
      }
      setModalBusy(false);
      clearSelection();
      if (ok) showToast("Updated", `${ok} design${ok === 1 ? "" : "s"} updated`);
      if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));
      if (typeof onDone === "function") await onDone({ ok, errors });
    },
  });
  configurePrimaryConfirm("Update");
}

function libraryStatusOf(item) {
  return String(item?.library_status || "").trim().toLowerCase() === "inactive" ? "inactive" : "active";
}

/**
 * Activate or deactivate saved designs without enqueueing product publish.
 * @param {object[]} items
 * @param {{ status: "active"|"inactive", onDone?: Function }} opts
 */
export async function openLibraryStatusModal(items, { status, onDone } = {}) {
  const target = status === "inactive" ? "inactive" : "active";
  const activating = target === "active";
  const verb = activating ? "Activate" : "Deactivate";
  const verbLower = activating ? "activate" : "deactivate";
  const list = (items || []).filter((item) => designIdOf(item));
  const eligible = list.filter((item) => libraryStatusOf(item) !== target);

  if (!eligible.length) {
    releaseBulkDock();
    showToast(verb, activating ? "No inactive saved designs selected" : "No active saved designs selected");
    return;
  }

  suppressBulkDock();
  const titles = eligible
    .map((item) => `<li>${escapeHtml(designTitle(item))}</li>`)
    .join("");
  const hint = activating
    ? "These designs become active in the creator library. Products are not published and nothing is added to the publish queue."
    : "These designs become inactive in the creator library. Published products stay online and are not unpublished.";

  openModal({
    title: eligible.length === 1 ? `${verb} design` : `${verb} ${eligible.length} designs`,
    bodyHtml: `
      <p class="confirm-modal-message">${escapeHtml(hint)}</p>
      <ul class="cr-bulk-product-list">${titles}</ul>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      setModalBusy(true, activating ? "Activating…" : "Deactivating…");
      try {
        const data = await partnerFetch("admin-design-set-library-status", {
          method: "POST",
          body: {
            design_ids: eligible.map((item) => designIdOf(item)),
            library_status: target,
          },
        });
        const changed = Array.isArray(data?.changed) ? data.changed.length : 0;
        const unchanged = Array.isArray(data?.unchanged) ? data.unchanged.length : 0;
        clearSelection();
        if (changed) {
          showToast(
            verb,
            changed === 1
              ? `1 design ${verbLower}d`
              : `${changed} designs ${verbLower}d`
          );
        } else if (unchanged) {
          showToast(verb, "Already in that status");
        }
        if (typeof onDone === "function") await onDone({ ok: changed, data });
      } catch (e) {
        showToast("Error", e?.message || `${verb} failed`);
        throw e;
      } finally {
        setModalBusy(false);
      }
    },
  });
  configurePrimaryConfirm(eligible.length === 1 ? `${verb} design` : `${verb} selected`);
}

function visibilityOf(item) {
  const top = item?.visibility;
  const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata.visibility : "";
  const raw = top != null && String(top).trim() !== "" ? top : meta;
  return String(raw || "private").trim().toLowerCase() === "public" ? "public" : "private";
}

/**
 * Set selected designs public or private. Does not enqueue product publish.
 * @param {object[]} items
 * @param {{ visibility: "public"|"private", onDone?: Function }} opts
 */
export async function openVisibilityModal(items, { visibility, onDone } = {}) {
  const target = visibility === "public" ? "public" : "private";
  const makingPublic = target === "public";
  const verb = makingPublic ? "Public" : "Private";
  const list = (items || []).filter((item) => designIdOf(item));
  const eligible = list.filter((item) => visibilityOf(item) !== target);

  if (!eligible.length) {
    releaseBulkDock();
    showToast(verb, makingPublic ? "No private saved designs selected" : "No public saved designs selected");
    return;
  }

  suppressBulkDock();
  const titles = eligible
    .map((item) => `<li>${escapeHtml(designTitle(item))}</li>`)
    .join("");
  const hint = makingPublic
    ? "These designs become public. Products are not published and nothing is added to the publish queue."
    : "These designs become private. Published products stay online and are not unpublished.";

  openModal({
    title: eligible.length === 1 ? `Set design ${target}` : `Set ${eligible.length} designs ${target}`,
    bodyHtml: `
      <p class="confirm-modal-message">${escapeHtml(hint)}</p>
      <ul class="cr-bulk-product-list">${titles}</ul>`,
    onCancel: () => releaseBulkDock(),
    onSave: async () => {
      setModalBusy(true, makingPublic ? "Setting public…" : "Setting private…");
      try {
        const data = await partnerFetch("admin-design-set-visibility", {
          method: "POST",
          body: {
            design_ids: eligible.map((item) => designIdOf(item)),
            visibility: target,
          },
        });
        const changed = Array.isArray(data?.changed) ? data.changed.length : 0;
        const unchanged = Array.isArray(data?.unchanged) ? data.unchanged.length : 0;
        clearSelection();
        if (changed) {
          showToast(
            verb,
            changed === 1 ? `1 design set to ${target}` : `${changed} designs set to ${target}`
          );
        } else if (unchanged) {
          showToast(verb, "Already in that visibility");
        }
        if (typeof onDone === "function") await onDone({ ok: changed, data });
      } catch (e) {
        showToast("Error", e?.message || `${verb} failed`);
        throw e;
      } finally {
        setModalBusy(false);
      }
    },
  });
  configurePrimaryConfirm(eligible.length === 1 ? `Set ${target}` : `Set selected ${target}`);
}
