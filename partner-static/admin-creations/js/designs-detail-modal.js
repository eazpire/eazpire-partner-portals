/**
 * Creations Portal — Design Detail Modal (Creator-like layout, admin mode). IDEA-057.
 */

import { partnerFetch, escapeHtml } from "/creations/shared/js/partner-api.js";
import { showToast } from "/creations/shared/js/partner-shell.js";
import { openRemoveModal, openPublishModal, openUpdateModal } from "./designs-bulk-modals.js";

const ICON = {
  overview: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  metadata: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  products: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
};

let activeItem = null;
let onClosed = null;

function ensureRoot() {
  let root = document.getElementById("cr-design-detail");
  if (root) return root;
  root = document.createElement("div");
  root.id = "cr-design-detail";
  root.className = "cr-dd";
  root.hidden = true;
  root.innerHTML = `
    <div class="cr-dd__backdrop" data-cr-dd-close></div>
    <div class="cr-dd__shell" role="dialog" aria-modal="true" aria-labelledby="cr-dd-title">
      <header class="cr-dd__header">
        <h2 class="cr-dd__title" id="cr-dd-title">Design</h2>
        <button type="button" class="cr-dd__close" data-cr-dd-close aria-label="Close">×</button>
      </header>
      <div class="cr-dd__body">
        <nav class="cr-dd__rail" aria-label="Design sections">
          <button type="button" class="cr-dd__tab is-active" data-cr-dd-tab="overview" title="Overview">${ICON.overview}</button>
          <button type="button" class="cr-dd__tab" data-cr-dd-tab="edit" title="Edit">${ICON.edit}</button>
          <button type="button" class="cr-dd__tab" data-cr-dd-tab="metadata" title="Metadata">${ICON.metadata}</button>
          <button type="button" class="cr-dd__tab" data-cr-dd-tab="products" title="Products">${ICON.products}</button>
        </nav>
        <div class="cr-dd__panels">
          <section class="cr-dd__panel is-active" data-cr-dd-panel="overview"></section>
          <section class="cr-dd__panel" data-cr-dd-panel="edit"></section>
          <section class="cr-dd__panel" data-cr-dd-panel="metadata"></section>
          <section class="cr-dd__panel" data-cr-dd-panel="products"></section>
        </div>
      </div>
      <footer class="cr-dd__footer">
        <button type="button" class="btn btn-secondary" data-cr-dd-act="download">Download</button>
        <button type="button" class="btn btn-secondary" data-cr-dd-act="update">Update</button>
        <button type="button" class="btn btn-primary" data-cr-dd-act="publish">Publish</button>
        <button type="button" class="btn btn-danger" data-cr-dd-act="remove">Remove</button>
      </footer>
    </div>`;
  document.body.appendChild(root);

  root.querySelectorAll("[data-cr-dd-close]").forEach((el) => {
    el.addEventListener("click", () => closeDesignDetailModal());
  });
  root.querySelectorAll("[data-cr-dd-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.getAttribute("data-cr-dd-tab")));
  });
  root.querySelectorAll("[data-cr-dd-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.getAttribute("data-cr-dd-act");
      if (!activeItem) return;
      if (act === "download") {
        document
          .querySelector(`.cr-card[data-item-key="${CSS.escape(activeItem.item_key || "")}"] .cr-card__download`)
          ?.click();
        return;
      }
      if (act === "remove") {
        await openRemoveModal([activeItem], {
          onDone: async () => {
            closeDesignDetailModal();
            if (typeof onClosed === "function") await onClosed({ reload: true });
          },
        });
        return;
      }
      if (act === "publish") {
        await openPublishModal([activeItem], {
          onDone: async () => {
            await renderProductsPanel(activeItem);
            if (typeof onClosed === "function") await onClosed({ reload: false });
          },
        });
        return;
      }
      if (act === "update") {
        await openUpdateModal([activeItem], {
          onDone: async () => {
            await renderProductsPanel(activeItem);
          },
        });
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root && !root.hidden) closeDesignDetailModal();
  });

  return root;
}

function setTab(tab) {
  const root = ensureRoot();
  root.querySelectorAll("[data-cr-dd-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-cr-dd-tab") === tab);
  });
  root.querySelectorAll("[data-cr-dd-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.getAttribute("data-cr-dd-panel") === tab);
  });
}

function renderOverview(item) {
  const preview = item.preview_url || item.original_url || "";
  return `
    <div class="cr-dd-overview">
      <div class="cr-dd-frame">
        <div class="cr-dd-frame__label">Design</div>
        ${
          preview
            ? `<img src="${escapeHtml(preview)}" alt="" />`
            : `<div class="cr-dd-frame__empty">No preview</div>`
        }
      </div>
      <div class="cr-dd-frame">
        <div class="cr-dd-frame__label">Product mock</div>
        <div class="cr-dd-frame__empty" id="cr-dd-mock-slot">Loading live mock…</div>
      </div>
    </div>`;
}

function renderEdit(item) {
  return `<div class="cr-dd-note">
    <h3>Edit</h3>
    <p>Admin edit tools mirror the Creator Design Studio. Use <strong>Download</strong> for the file, or open Publish/Update from the footer for catalog actions.</p>
    <p class="cr-dd-muted">Design id: ${escapeHtml(String(item.id || "—"))} · Job: ${escapeHtml(String(item.job_id || "—"))}</p>
  </div>`;
}

function renderMetadata(item) {
  const meta = item.metadata && typeof item.metadata === "object" ? item.metadata : null;
  let rows = "";
  if (meta) {
    rows = Object.keys(meta)
      .slice(0, 40)
      .map(
        (k) =>
          `<div class="cr-dd-meta-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(
            typeof meta[k] === "string" ? meta[k] : JSON.stringify(meta[k])
          )}</dd></div>`
      )
      .join("");
  }
  return `<div class="cr-dd-note">
    <h3>Metadata</h3>
    <dl class="cr-dd-meta">${rows || "<p class=\"cr-dd-muted\">No metadata on this list item. Title and prompt are shown below.</p>"}</dl>
    <p><strong>Title:</strong> ${escapeHtml(item.title || "—")}</p>
    <p><strong>Prompt:</strong> ${escapeHtml(item.prompt || item.user_prompt || item.design_prompt || "—")}</p>
  </div>`;
}

async function renderProductsPanel(item) {
  const root = ensureRoot();
  const panel = root.querySelector('[data-cr-dd-panel="products"]');
  if (!panel) return;
  const designId = Number(item.id || 0);
  if (!designId) {
    panel.innerHTML = `<p class="cr-dd-muted">Unsaved designs have no catalog products yet.</p>`;
    return;
  }
  panel.innerHTML = `<p class="cr-dd-muted">Loading products…</p>`;
  try {
    const [preview, live] = await Promise.all([
      partnerFetch("admin-design-action-preview", {
        query: { action: "publish", design_id: designId },
      }),
      partnerFetch("admin-design-shopify-live-products", {
        query: { design_id: designId },
      }).catch(() => ({ products: [] })),
    ]);

    const liveByKey = new Map();
    for (const p of live.products || live.published_products || []) {
      liveByKey.set(String(p.product_key || ""), p);
    }

    const catalog = preview.catalog_products || [];
    const missingKeys = new Set((preview.missing_products || []).map((p) => String(p.product_key || "")));
    const designPreview = preview.design_preview_url || item.preview_url || item.original_url || "";

    const byChannel = new Map();
    for (const p of catalog) {
      const ch = String(p.channel || "printify").toLowerCase();
      if (ch === "amazon") continue;
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch).push(p);
    }

    const preferred = ["printify", "todify", "shopify"];
    const keys = [...byChannel.keys()].sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const html = keys
      .map((ch) => {
        const products = byChannel.get(ch) || [];
        const cards = products
          .map((p) => {
            const key = String(p.product_key || "");
            const liveRow = liveByKey.get(key);
            const online = !missingKeys.has(key) || !!liveRow;
            const mock = online
              ? liveRow?.image_url || liveRow?.featured_image || p.mock_url || p.preview_url || ""
              : p.mock_url || p.preview_url || "";
            return `<article class="cr-dd-prod ${online ? "is-online" : "is-offline"}">
              <div class="cr-dd-prod__media">
                ${
                  mock
                    ? `<img class="cr-dd-prod__mock" src="${escapeHtml(mock)}" alt="" loading="lazy" />`
                    : `<span class="cr-dd-prod__empty">No mock</span>`
                }
                ${
                  !online && designPreview
                    ? `<img class="cr-dd-prod__design" src="${escapeHtml(designPreview)}" alt="" loading="lazy" />`
                    : ""
                }
                <span class="cr-badge ${online ? "cr-badge--online" : "cr-badge--offline"}">${
                  online ? "Online" : "Offline"
                }</span>
              </div>
              <div class="cr-dd-prod__title">${escapeHtml(p.title || key)}</div>
            </article>`;
          })
          .join("");
        const label =
          ch === "printify"
            ? "Printify"
            : ch === "todify"
              ? "Todify"
              : ch === "shopify"
                ? "Shopify"
                : ch;
        return `<details class="cr-channel" open>
          <summary class="cr-channel__summary"><span>${escapeHtml(label)}</span><span class="cr-channel__count">${products.length}</span></summary>
          <div class="cr-channel__body"><div class="cr-dd-prod-grid">${cards}</div></div>
        </details>`;
      })
      .join("");

    panel.innerHTML =
      html ||
      `<p class="cr-dd-muted">No admin catalog products for this design type.</p>`;

    // Fill overview mock from first live product
    const mockSlot = root.querySelector("#cr-dd-mock-slot");
    if (mockSlot) {
      const firstLive = (live.products || live.published_products || []).find(
        (p) => p.image_url || p.featured_image
      );
      if (firstLive) {
        mockSlot.outerHTML = `<img src="${escapeHtml(
          firstLive.image_url || firstLive.featured_image
        )}" alt="" />`;
      } else if (designPreview) {
        mockSlot.outerHTML = `<div class="cr-dd-frame__stack">
          <span class="cr-dd-frame__empty">Studio-style preview</span>
          <img class="cr-dd-prod__design cr-dd-prod__design--solo" src="${escapeHtml(designPreview)}" alt="" />
        </div>`;
      } else {
        mockSlot.textContent = "No live Shopify mock yet";
      }
    }
  } catch (e) {
    panel.innerHTML = `<p class="cr-bulk-error">${escapeHtml(e.message || "Failed to load products")}</p>`;
  }
}

export async function openDesignDetailModal(item, { onClose } = {}) {
  if (!item) return;
  activeItem = item;
  onClosed = onClose || null;
  const root = ensureRoot();
  root.querySelector("#cr-dd-title").textContent = item.title || "Design";
  root.querySelector('[data-cr-dd-panel="overview"]').innerHTML = renderOverview(item);
  root.querySelector('[data-cr-dd-panel="edit"]').innerHTML = renderEdit(item);
  root.querySelector('[data-cr-dd-panel="metadata"]').innerHTML = renderMetadata(item);
  root.querySelector('[data-cr-dd-panel="products"]').innerHTML = `<p class="cr-dd-muted">Open the Products tab to load catalog status.</p>`;
  setTab("overview");
  root.hidden = false;
  document.body.classList.add("cr-dd-open");
  // Prefetch products for overview mock
  renderProductsPanel(item).catch(() => {});
}

export function closeDesignDetailModal() {
  const root = document.getElementById("cr-design-detail");
  if (root) root.hidden = true;
  document.body.classList.remove("cr-dd-open");
  activeItem = null;
}
