/**
 * Creations Portal Designs — Remove / Publish / Update bulk modals (IDEA-057).
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { openModal, showToast } from "/creations/shared/js/partner-shell.js";
import { clearSelection } from "./designs-bulk.js";

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
  return partnerFetch("admin-design-action-preview", {
    query: { action: "publish", design_id: designId },
  });
}

async function fetchUpdatePreview(item) {
  const designId = designIdOf(item);
  if (!designId) throw new Error("Unsaved designs cannot be updated");
  return partnerFetch("admin-design-action-preview", {
    query: { action: "update", design_id: designId },
  });
}

export async function openRemoveModal(items, { onDone } = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) {
    showToast("Remove", "Select at least one design");
    return;
  }

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

function publishProductCardHtml(product, designPreviewUrl, { checked = true } = {}) {
  const key = String(product.product_key || "");
  const title = product.title || product.product_name || key;
  const mock = product.mock_url || product.preview_url || "";
  const designImg = designPreviewUrl || "";
  return `<label class="cr-pub-card">
    <input type="checkbox" class="cr-pub-card__cb" data-product-key="${escapeHtml(key)}" ${checked ? "checked" : ""} />
    <span class="cr-pub-card__media">
      ${
        mock
          ? `<img class="cr-pub-card__mock" src="${escapeHtml(mock)}" alt="" loading="lazy" />`
          : `<span class="cr-pub-card__mock cr-pub-card__mock--empty">No mock</span>`
      }
      ${designImg ? `<img class="cr-pub-card__design" src="${escapeHtml(designImg)}" alt="" loading="lazy" />` : ""}
      <span class="cr-badge cr-badge--offline">Offline</span>
    </span>
    <span class="cr-pub-card__title">${escapeHtml(title)}</span>
  </label>`;
}

function publishChannelHtml(channel, products, designPreviewUrl) {
  const cards = products.map((p) => publishProductCardHtml(p, designPreviewUrl, { checked: true })).join("");
  return `<details class="cr-channel" open>
    <summary class="cr-channel__summary">
      <span>${escapeHtml(channelLabel(channel))}</span>
      <span class="cr-channel__count">${products.length}</span>
    </summary>
    <div class="cr-channel__body">
      <div class="cr-pub-grid">${cards}</div>
    </div>
  </details>`;
}

export async function openPublishModal(items, { onDone } = {}) {
  const list = (items || []).filter((item) => designIdOf(item));
  if (!list.length) {
    showToast("Publish", "Select at least one saved design");
    return;
  }

  const blocks = [];
  for (const item of list) {
    try {
      const data = await fetchPublishPreview(item);
      blocks.push({ item, data });
    } catch (e) {
      blocks.push({ item, error: e.message || "Preview failed" });
    }
  }

  const body = blocks
    .map(({ item, data, error }) => {
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
      const designPreview = data.design_preview_url || item.preview_url || item.original_url || "";
      const channelsHtml = channelOrder(groups.keys())
        .map((ch) => publishChannelHtml(ch, groups.get(ch) || [], designPreview))
        .join("");
      return designShellHtml(
        designTitle(item, data.design_title),
        `<p class="confirm-modal-message">Only unpublished products. All admin variants are selected by default (Skill Tree ignored).</p>${channelsHtml}`,
        id
      );
    })
    .join("");

  openModal({
    title: list.length === 1 ? "Publish products" : `Publish ${list.length} designs`,
    bodyHtml: `<div class="cr-bulk-scroll" id="cr-publish-body">${body}</div>`,
    onSave: async () => {
      setModalBusy(true, "Publishing…");
      let queued = 0;
      const errors = [];
      for (const { item, data, error } of blocks) {
        if (error || !data) continue;
        const designId = designIdOf(item);
        const group = document.querySelector(`#cr-publish-body .cr-design-group[data-design-id="${designId}"]`);
        const keys = [...(group ? group.querySelectorAll(".cr-pub-card__cb:checked") : [])]
          .map((el) => el.getAttribute("data-product-key") || "")
          .filter(Boolean);
        const allowed = new Set((data.missing_products || []).map((p) => String(p.product_key || "")));
        const product_keys = keys.filter((k) => allowed.has(k));
        if (!product_keys.length) continue;
        try {
          await partnerFetch("admin-design-publish-missing-online", {
            method: "POST",
            body: { design_id: designId, product_keys, region_code: "EU" },
          });
          queued += 1;
        } catch (e) {
          errors.push(`${designTitle(item)}: ${e.message || "failed"}`);
        }
      }
      setModalBusy(false);
      clearSelection();
      if (queued) showToast("Publish queued", `${queued} design${queued === 1 ? "" : "s"} enqueued`);
      if (errors.length) showToast("Error", errors.slice(0, 2).join(" · "));
      if (typeof onDone === "function") await onDone({ queued, errors });
    },
  });
  configurePrimaryConfirm("Publish selected");
}

export async function openUpdateModal(items, { onDone } = {}) {
  const list = (items || []).filter((item) => designIdOf(item));
  if (!list.length) {
    showToast("Update", "Select at least one saved design");
    return;
  }

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
      onSave: async () => {},
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
