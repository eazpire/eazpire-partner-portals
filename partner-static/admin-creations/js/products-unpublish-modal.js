/**
 * Admin Creations → Products: context-menu Unpublish (active sales channels).
 * PLATFORM_SPECIFIC — admin.eazpire.com/creations/products
 */

import { escapeHtml, partnerFetch } from "/creations/shared/js/partner-api.js";
import { openModal, showToast } from "/creations/shared/js/partner-shell.js";
import { seedChannelStateFromProduct } from "./product-channels-panel.js";

function setModalBusy(busy, label) {
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  if (saveBtn) {
    if (busy && label) saveBtn.textContent = label;
    if (busy) saveBtn.disabled = true;
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function configurePrimaryConfirm(label) {
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) {
    saveBtn.textContent = label || "Confirm";
    saveBtn.className = "btn btn-primary";
    saveBtn.style.display = "";
  }
}

function syncConfirmEnabled(root) {
  const saveBtn = document.getElementById("modal-save");
  if (!saveBtn) return;
  const n = root?.querySelectorAll?.(".cr-unpub-ch__cb:checked")?.length || 0;
  saveBtn.disabled = n < 1;
}

function bindCheckboxUi(root) {
  if (!root) return;
  const update = () => syncConfirmEnabled(root);

  root.querySelectorAll("[data-cr-unpub-all]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.getAttribute("data-cr-unpub-all") === "1";
      root.querySelectorAll(".cr-unpub-ch__cb").forEach((cb) => {
        cb.checked = on;
      });
      update();
    });
  });

  root.querySelectorAll(".cr-unpub-ch__cb").forEach((cb) => {
    cb.addEventListener("change", update);
  });

  update();
}

function amazonTargetsFromProduct(product) {
  const apiTargets = product?.channels?.amazon_publish_targets;
  if (Array.isArray(apiTargets) && apiTargets.length) {
    return apiTargets.map((t) => ({
      continent: t.continent,
      label: t.label || (t.continent === "amerika" ? "USA / Amerika" : "Europa"),
    }));
  }
  const amz = product?.channels?.unlocks?.amazon || {};
  if (!amz.enabled) return [];
  const continents = amz.continents || {};
  const markets = amz.markets || {};
  const targets = [];
  const europaOn =
    continents.europa === true ||
    ["FR", "NL", "PL", "UK", "DE", "ES", "IE", "SE", "BE", "IT"].some((c) => !!markets[c]);
  const amerikaOn = continents.amerika === true || !!markets.US || !!markets.CA;
  if (europaOn) targets.push({ continent: "europa", label: "Europa" });
  if (amerikaOn) targets.push({ continent: "amerika", label: "USA / Amerika" });
  return targets;
}

function activeChannelsFromProduct(product) {
  const state = seedChannelStateFromProduct(product || {});
  const channels = [];

  // eazpire channel: D1-linked listing OR live Shopify product (Todify / orphan after D1-only unpublish).
  if (product?.published_design_id || product?.id) {
    channels.push({
      key: "eazpire",
      label: "eazpire",
      kind: "eazpire",
    });
  }

  const targets = amazonTargetsFromProduct(product);
  const continents = product?.amazon_publish?.continents || {};
  for (const t of targets) {
    const cont = continents[t.continent] || state[`amazon:${t.continent}`] || {};
    const st = String(cont.status || "").toLowerCase();
    if (st !== "published" && st !== "publishing" && st !== "queued") continue;
    channels.push({
      key: `amazon:${t.continent}`,
      label:
        t.continent === "amerika"
          ? "Amazon USA / Amerika"
          : t.label
            ? `Amazon ${t.label}`
            : "Amazon Europa",
      kind: "amazon",
      continent: t.continent,
      marketplace_id: cont.marketplace_id || null,
    });
  }

  return channels;
}

/**
 * @param {{ shopifyId?: string, studioListingId?: string, title?: string }} opts
 * @param {{ onDone?: Function }} hooks
 */
export async function openProductUnpublishModal(
  { shopifyId, studioListingId, title } = {},
  { onDone } = {}
) {
  const id = String(shopifyId || "").trim();
  const studioId = String(studioListingId || "").trim();
  const detailRef = id || (studioId ? `studio:${studioId}` : "");
  if (!detailRef) {
    showToast("Unpublish", "Missing product id");
    return;
  }

  let product = null;
  let loadError = "";
  try {
    const data = await partnerFetch("admin-creations-shopify-product-detail", {
      query: { product_id: detailRef },
    });
    product = data.product || null;
  } catch (e) {
    loadError = String(e?.message || e || "");
    // Studio listing not on Shopify yet — still allow cancel/unpublish via studio id.
    if (!studioId && !/^studio:/i.test(detailRef)) {
      showToast("Error", loadError || "Could not load product");
      return;
    }
    product = {
      id: id || null,
      title: title || detailRef,
      published_design_id: null,
      design_id: null,
      product_key: "",
      studio_listing_id: studioId || null,
    };
  }

  let channels = activeChannelsFromProduct(product);
  // Orphan studio / Shopify-only: still offer eazpire channel so Unpublish can delete/cancel.
  if (!channels.length && (id || studioId || product?.id)) {
    channels = [{ key: "eazpire", label: "eazpire", kind: "eazpire" }];
  }
  const displayTitle = title || product?.title || detailRef;

  if (!channels.length) {
    openModal({
      title: "Unpublish channels",
      bodyHtml: `<p class="confirm-modal-message">No active channels to unpublish for <strong>${escapeHtml(
        displayTitle
      )}</strong>${loadError ? ` <span class="text-muted">(${escapeHtml(loadError)})</span>` : ""}.</p>`,
      onSave: async () => {},
    });
    const saveBtn = document.getElementById("modal-save");
    if (saveBtn) saveBtn.style.display = "none";
    return;
  }

  const channelRows = channels
    .map(
      (ch) => `<label class="cr-unpub-ch">
      <input type="checkbox" class="cr-unpub-ch__cb" checked
        data-channel-key="${escapeHtml(ch.key)}"
        data-channel-kind="${escapeHtml(ch.kind)}"
        data-continent="${escapeHtml(ch.continent || "")}"
        data-marketplace-id="${escapeHtml(ch.marketplace_id || "")}" />
      <span>${escapeHtml(ch.label)}</span>
    </label>`
    )
    .join("");

  openModal({
    title: "Unpublish channels",
    bodyHtml: `
      <p class="confirm-modal-message">Unpublish <strong>${escapeHtml(
        displayTitle
      )}</strong> from the selected channels. All active channels are selected by default.</p>
      <div class="cr-unpub-toolbar">
        <button type="button" class="btn btn-secondary btn-sm" data-cr-unpub-all="1">Select all</button>
        <button type="button" class="btn btn-secondary btn-sm" data-cr-unpub-all="0">Deselect all</button>
      </div>
      <div class="cr-unpub-prod__channels" id="cr-prod-unpub-body">${channelRows}</div>`,
    onSave: async () => {
      const root = document.getElementById("cr-prod-unpub-body") || document.getElementById("modal-body");
      const selected = [...(root?.querySelectorAll(".cr-unpub-ch__cb:checked") || [])];
      if (!selected.length) throw new Error("Select at least one channel");

      const wantEazpire = selected.some((cb) => cb.getAttribute("data-channel-kind") === "eazpire");
      const amazonContinents = selected
        .filter((cb) => cb.getAttribute("data-channel-kind") === "amazon")
        .map((cb) => cb.getAttribute("data-continent") || "")
        .filter(Boolean);

      const publishedDesignId = Number(product?.published_design_id || 0);
      const designId = Number(product?.design_id || product?.amazon_publish?.design_id || 0);
      const productKey = String(product?.product_key || "").trim();

      setModalBusy(true, "Unpublishing…");

      try {
        let queued = 0;
        if (wantEazpire) {
          if (designId && publishedDesignId) {
            await partnerFetch("admin-design-unpublish", {
              method: "POST",
              body: {
                design_id: designId,
                product_keys: productKey ? [productKey] : [],
                published_ids: [publishedDesignId],
              },
            });
          } else {
            // Shopify-only / studio orphan — delete Admin product and/or cancel studio listing.
            await partnerFetch("admin-creations-shopify-product-unpublish", {
              method: "POST",
              body: {
                product_id: id || detailRef,
                studio_listing_id: studioId || undefined,
              },
            });
          }
          queued += 1;
        }

        if (amazonContinents.length) {
          if (!publishedDesignId) {
            throw new Error("Cannot unpublish Amazon: missing published_design link");
          }
          await partnerFetch("admin-amazon-unpublish", {
            method: "POST",
            body: {
              published_design_id: publishedDesignId,
              shopify_product_id: id,
              continents: amazonContinents,
            },
          });
          queued += amazonContinents.length;
        }

        setModalBusy(false);
        if (queued) showToast("Unpublish", `${queued} channel action(s) queued`);
        if (typeof onDone === "function") await onDone({ queued });
      } catch (e) {
        setModalBusy(false);
        syncConfirmEnabled(document.getElementById("modal-body"));
        throw e;
      }
    },
  });
  configurePrimaryConfirm("Unpublish selected");
  bindCheckboxUi(document.getElementById("modal-body"));
}
