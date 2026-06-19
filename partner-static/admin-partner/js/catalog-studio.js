import { partnerFetch, escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast, renderTable, openModal, closeModal, confirmAction } from "/partner/shared/js/partner-shell.js";
import { openProductEditor } from "./catalog-editor/shell.js";

const STATUS_FILTERS = [
  { key: "available", label: "Available" },
  { key: "online", label: "Online" },
  { key: "preview", label: "Preview" },
  { key: "offline", label: "Offline" },
];

const STORAGE = {
  partnerId: "admin_catalog_partner_id",
  providerId: "admin_catalog_provider_id",
  filter: "admin_catalog_status_filter",
  partnersOpen: "admin_catalog_partners_open",
  studioSidebar: "admin_catalog_studio_sidebar_collapsed",
};

function getFilter() {
  const f = sessionStorage.getItem(STORAGE.filter) || "online";
  return STATUS_FILTERS.some((t) => t.key === f) ? f : "online";
}

function setFilter(key) {
  sessionStorage.setItem(STORAGE.filter, key);
}

function getPartnerId() {
  return sessionStorage.getItem(STORAGE.partnerId) || "";
}

function setPartnerId(id) {
  sessionStorage.setItem(STORAGE.partnerId, id || "");
  sessionStorage.removeItem(STORAGE.providerId);
}

function getProviderId() {
  return sessionStorage.getItem(STORAGE.providerId) || "";
}

function setProviderId(id) {
  if (id) sessionStorage.setItem(STORAGE.providerId, id);
  else sessionStorage.removeItem(STORAGE.providerId);
}

function getPartnersOpenSet() {
  try {
    const raw = sessionStorage.getItem(STORAGE.partnersOpen);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function togglePartnerOpen(partnerId) {
  const set = getPartnersOpenSet();
  if (set.has(partnerId)) set.delete(partnerId);
  else set.add(partnerId);
  sessionStorage.setItem(STORAGE.partnersOpen, JSON.stringify([...set]));
}

function isStudioSidebarCollapsed() {
  return sessionStorage.getItem(STORAGE.studioSidebar) === "1";
}

function setStudioSidebarCollapsed(collapsed) {
  sessionStorage.setItem(STORAGE.studioSidebar, collapsed ? "1" : "0");
}

function statusBadge(status, { clickable = false, productKey = "" } = {}) {
  const map = {
    online: "badge-success",
    preview: "badge-warning",
    offline: "badge-neutral",
    available: "badge-info",
  };
  const cls = map[status] || "badge-neutral";
  const label = escapeHtml(status);
  if (clickable && productKey) {
    return `<button type="button" class="badge ${cls} cs-status-btn" data-product-key="${escapeHtml(productKey)}" data-status="${escapeHtml(status)}" title="Change status">${label}</button>`;
  }
  return `<span class="badge ${cls}">${label}</span>`;
}

function formatPrintAreaLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderPrintAreaBadges(areas) {
  if (!areas?.length) return `<span class="text-muted">—</span>`;
  return `<div class="cs-print-areas">${areas
    .map((key) => `<span class="badge badge-neutral cs-print-area-badge">${escapeHtml(formatPrintAreaLabel(key))}</span>`)
    .join("")}</div>`;
}

function mockPlaceholderSvg() {
  return `<div class="cs-mock-carousel__placeholder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;
}

function buildMockCarouselHtml(images, rowId) {
  const urls = (images || []).filter((u) => typeof u === "string" && u);
  if (!urls.length) return `<div class="cs-mock-carousel cs-mock-carousel--empty">${mockPlaceholderSvg()}</div>`;
  if (urls.length === 1) {
    return `<div class="cs-mock-carousel cs-mock-carousel--single" data-images="${escapeHtml(JSON.stringify(urls))}" data-row-id="${escapeHtml(rowId)}">
      <button type="button" class="cs-mock-carousel__open" data-idx="0" aria-label="View mockup">
        <img src="${escapeHtml(urls[0])}" alt="" loading="lazy" decoding="async" />
      </button>
    </div>`;
  }
  const slides = urls
    .map(
      (url, i) =>
        `<div class="cs-mock-carousel__slide"><button type="button" class="cs-mock-carousel__open" data-idx="${i}" aria-label="View mockup ${i + 1}"><img src="${escapeHtml(url)}" alt="" loading="${i === 0 ? "eager" : "lazy"}" decoding="async" /></button></div>`
    )
    .join("");
  const dots = urls
    .map((_, i) => `<button type="button" class="cs-mock-carousel__dot${i === 0 ? " cs-mock-carousel__dot--active" : ""}" data-idx="${i}" aria-label="Slide ${i + 1}"></button>`)
    .join("");
  return `<div class="cs-mock-carousel" data-count="${urls.length}" data-images="${escapeHtml(JSON.stringify(urls))}" data-row-id="${escapeHtml(rowId)}">
    <div class="cs-mock-carousel__track">${slides}</div>
    <button type="button" class="cs-mock-carousel__arrow cs-mock-carousel__arrow--prev" aria-label="Previous mockup">&#8249;</button>
    <button type="button" class="cs-mock-carousel__arrow cs-mock-carousel__arrow--next" aria-label="Next mockup">&#8250;</button>
    <div class="cs-mock-carousel__dots">${dots}</div>
  </div>`;
}

function initMockCarousels(container) {
  if (!container) return;
  container.querySelectorAll(".cs-mock-carousel[data-count]").forEach((carousel) => {
    if (carousel.dataset.init) return;
    carousel.dataset.init = "1";
    const track = carousel.querySelector(".cs-mock-carousel__track");
    const dots = carousel.querySelectorAll(".cs-mock-carousel__dot");
    const count = parseInt(carousel.dataset.count, 10) || 1;
    let cur = 0;
    let startX = 0;
    let dx = 0;
    let swiping = false;

    function goTo(idx) {
      const next = ((idx % count) + count) % count;
      cur = next;
      track.style.transform = `translateX(-${cur * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle("cs-mock-carousel__dot--active", i === cur));
    }

    carousel.querySelector(".cs-mock-carousel__arrow--prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(cur - 1);
    });
    carousel.querySelector(".cs-mock-carousel__arrow--next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(cur + 1);
    });
    dots.forEach((d) =>
      d.addEventListener("click", (e) => {
        e.stopPropagation();
        goTo(+d.dataset.idx);
      })
    );
    track.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        dx = 0;
        swiping = true;
        track.style.transition = "none";
      },
      { passive: true }
    );
    track.addEventListener(
      "touchmove",
      (e) => {
        if (!swiping) return;
        dx = e.touches[0].clientX - startX;
        track.style.transform = `translateX(${-(cur * 100) + (dx / track.offsetWidth) * 100}%)`;
      },
      { passive: true }
    );
    track.addEventListener("touchend", () => {
      if (!swiping) return;
      swiping = false;
      track.style.transition = "";
      const threshold = track.offsetWidth * 0.2;
      if (dx < -threshold) goTo(cur + 1);
      else if (dx > threshold) goTo(cur - 1);
      else goTo(cur);
    });
  });
}

let mockViewerState = null;

function ensureMockViewer() {
  let el = document.getElementById("cs-mock-viewer");
  if (el) return el;
  el = document.createElement("div");
  el.id = "cs-mock-viewer";
  el.className = "cs-mock-viewer";
  el.hidden = true;
  el.innerHTML = `<div class="cs-mock-viewer__backdrop" data-close="1"></div>
    <div class="cs-mock-viewer__panel" role="dialog" aria-modal="true" aria-label="Mockup viewer">
      <button type="button" class="cs-mock-viewer__close" aria-label="Close">&times;</button>
      <button type="button" class="cs-mock-viewer__arrow cs-mock-viewer__arrow--prev" aria-label="Previous">&#8249;</button>
      <div class="cs-mock-viewer__stage"><img src="" alt="" /></div>
      <button type="button" class="cs-mock-viewer__arrow cs-mock-viewer__arrow--next" aria-label="Next">&#8250;</button>
      <div class="cs-mock-viewer__counter"></div>
    </div>`;
  document.body.appendChild(el);

  const close = () => closeMockViewer();
  el.querySelector(".cs-mock-viewer__close").onclick = close;
  el.querySelector(".cs-mock-viewer__backdrop").onclick = close;
  el.querySelector(".cs-mock-viewer__arrow--prev").onclick = () => stepMockViewer(-1);
  el.querySelector(".cs-mock-viewer__arrow--next").onclick = () => stepMockViewer(1);

  document.addEventListener("keydown", (e) => {
    if (!mockViewerState) return;
    if (e.key === "Escape") closeMockViewer();
    if (e.key === "ArrowLeft") stepMockViewer(-1);
    if (e.key === "ArrowRight") stepMockViewer(1);
  });

  return el;
}

function renderMockViewer() {
  if (!mockViewerState) return;
  const viewer = ensureMockViewer();
  const { images, index } = mockViewerState;
  const img = viewer.querySelector(".cs-mock-viewer__stage img");
  const counter = viewer.querySelector(".cs-mock-viewer__counter");
  img.src = images[index] || "";
  counter.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : "";
  viewer.querySelector(".cs-mock-viewer__arrow--prev").style.display = images.length > 1 ? "" : "none";
  viewer.querySelector(".cs-mock-viewer__arrow--next").style.display = images.length > 1 ? "" : "none";
}

function openMockViewer(images, startIndex = 0) {
  const urls = (images || []).filter((u) => typeof u === "string" && u);
  if (!urls.length) return;
  mockViewerState = { images: urls, index: Math.max(0, Math.min(startIndex, urls.length - 1)) };
  const viewer = ensureMockViewer();
  viewer.hidden = false;
  viewer.classList.add("is-open");
  renderMockViewer();
}

function closeMockViewer() {
  mockViewerState = null;
  const viewer = document.getElementById("cs-mock-viewer");
  if (viewer) {
    viewer.classList.remove("is-open");
    viewer.hidden = true;
  }
}

function stepMockViewer(delta) {
  if (!mockViewerState) return;
  const { images, index } = mockViewerState;
  mockViewerState.index = (index + delta + images.length) % images.length;
  renderMockViewer();
}

function openStatusPicker(productKey, currentStatus, onChanged) {
  const options = [
    { value: "online", label: "Online", description: "Visible in the live catalog", badge: "badge-success" },
    { value: "preview", label: "Preview", description: "Visible for preview/testing only", badge: "badge-warning" },
    { value: "offline", label: "Offline", description: "Hidden from storefront", badge: "badge-neutral" },
    { value: "remove", label: "Remove", description: "Delete product and return blueprint to Available", badge: "badge-danger" },
  ];

  const bodyHtml = `<p class="confirm-modal-message">Choose a new status for <code>${escapeHtml(productKey)}</code>.</p>
    <div class="cs-status-options">${options
      .map(
        (opt) => `<button type="button" class="cs-status-option ${opt.value === currentStatus ? "is-current" : ""}" data-status-choice="${escapeHtml(opt.value)}">
          <span class="badge ${opt.badge}">${escapeHtml(opt.label)}</span>
          <span class="cs-status-option__desc">${escapeHtml(opt.description)}</span>
        </button>`
      )
      .join("")}</div>`;

  openModal({ title: "Product status", bodyHtml, onSave: null });
  const backdrop = document.getElementById("modal-backdrop");
  const modal = backdrop?.querySelector(".modal");
  modal?.classList.add("confirm-modal", "cs-status-modal");
  const saveBtn = document.getElementById("modal-save");
  const cancelBtn = document.getElementById("modal-cancel");
  if (saveBtn) saveBtn.style.display = "none";
  if (cancelBtn) cancelBtn.textContent = "Close";

  backdrop?.querySelectorAll("[data-status-choice]").forEach((btn) => {
    btn.onclick = async () => {
      const choice = btn.dataset.statusChoice;
      closeModal();
      if (choice === "remove") {
        confirmAction({
          title: "Remove product",
          message: `Remove "${productKey}" from the catalog? The blueprint will return to Available.`,
          confirmLabel: "Remove",
          confirmClass: "btn-danger",
          onConfirm: async () => {
            try {
              await partnerFetch("admin-catalog-studio-remove-product", {
                method: "POST",
                body: { product_key: productKey },
              });
              showToast("Product removed", "Blueprint is available again");
              await onChanged();
            } catch (e) {
              showToast("Remove failed", e.message || String(e));
            }
          },
        });
        return;
      }
      if (choice === currentStatus) return;
      try {
        await partnerFetch("admin-catalog-studio-set-status", {
          method: "POST",
          body: { product_key: productKey, catalog_status: choice },
        });
        showToast("Status updated", `${productKey} is now ${choice}`);
        await onChanged();
      } catch (e) {
        showToast("Status update failed", e.message || String(e));
      }
    };
  });
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

function renderAvatar(name, logoUrl, sizeClass = "") {
  const cls = `cs-avatar ${sizeClass}`.trim();
  if (logoUrl) {
    return `<span class="${cls}"><img src="${escapeHtml(logoUrl)}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="${cls} cs-avatar--initials">${escapeHtml(initials(name))}</span>`;
}

function renderExpandedTree(partners, selectedPartnerId, selectedProviderId) {
  const openSet = getPartnersOpenSet();
  return partners
    .map((partner) => {
      const isOpen = openSet.has(partner.id);
      const providerCount = partner.provider_count ?? partner.fulfillment_provider_count ?? 0;
      const partnerActive = partner.id === selectedPartnerId && !selectedProviderId;
      const providers = partner.providers || [];
      return `<div class="cs-tree-partner ${isOpen ? "is-open" : ""}">
        <div class="cs-tree-partner-row">
          <button type="button" class="cs-tree-chevron-btn" data-tree-toggle="${escapeHtml(partner.id)}" aria-label="Toggle providers">${isOpen ? "▾" : "▸"}</button>
          <button type="button" class="cs-tree-partner-btn ${partnerActive ? "active" : ""}" data-partner-id="${escapeHtml(partner.id)}">
            ${renderAvatar(partner.name, partner.logo_url)}
            <span class="cs-tree-partner-name">${escapeHtml(partner.name)}</span>
          </button>
          <span class="cs-tree-count">${providerCount}</span>
        </div>
        <div class="cs-tree-providers" ${isOpen ? "" : "hidden"}>
          ${providers
            .map(
              (fp) => `<button type="button" class="cs-tree-provider-btn ${selectedProviderId === String(fp.external_provider_id) ? "active" : ""}"
                data-partner-id="${escapeHtml(partner.id)}" data-provider-id="${escapeHtml(fp.external_provider_id)}">
                ${renderAvatar(fp.name, fp.logo_url, "cs-avatar--sm")}
                <span>${escapeHtml(fp.name)}</span>
              </button>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");
}

function renderCollapsedRail(partners, selectedPartnerId, selectedProviderId) {
  const openSet = getPartnersOpenSet();
  return partners
    .map((partner) => {
      const isOpen = openSet.has(partner.id);
      const partnerActive = partner.id === selectedPartnerId && !selectedProviderId;
      const providers = partner.providers || [];
      return `<div class="cs-rail-partner-group">
        <button type="button" class="cs-rail-partner-btn ${partnerActive ? "active" : ""}"
          data-partner-id="${escapeHtml(partner.id)}"
          title="${escapeHtml(partner.name)}" aria-label="${escapeHtml(partner.name)}">
          ${renderAvatar(partner.name, partner.logo_url)}
        </button>
        ${
          isOpen && providers.length
            ? `<div class="cs-rail-providers">${providers
                .map(
                  (fp) => `<button type="button" class="cs-rail-provider-btn ${selectedProviderId === String(fp.external_provider_id) ? "active" : ""}"
                    data-partner-id="${escapeHtml(partner.id)}" data-provider-id="${escapeHtml(fp.external_provider_id)}"
                    title="${escapeHtml(fp.name)}" aria-label="${escapeHtml(fp.name)}">
                    ${renderAvatar(fp.name, fp.logo_url, "cs-avatar--sm")}
                  </button>`
                )
                .join("")}</div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

function renderTree(partners, selectedPartnerId, selectedProviderId) {
  return `<div class="cs-tree-expanded">${renderExpandedTree(partners, selectedPartnerId, selectedProviderId)}</div>
    <div class="cs-tree-collapsed-rail">${renderCollapsedRail(partners, selectedPartnerId, selectedProviderId)}</div>`;
}

function renderProductsTable(items, filter) {
  if (!items?.length) {
    return `<div class="empty-state"><h3>No products</h3><p>Nothing matches this filter for the current selection.</p></div>`;
  }

  if (filter === "available") {
    return renderTable(
      ["", "Title", "Blueprint key", "Category", "Country", "Print areas", "Status"],
      items
        .map((row, i) => {
          const rowId = `bp-${row.blueprint_id || i}`;
          return `<tr>
        <td class="cs-mock-cell">${buildMockCarouselHtml(row.mock_images, rowId)}</td>
        <td>${escapeHtml(row.title)}</td>
        <td><code>${escapeHtml(row.blueprint_key || "—")}</code></td>
        <td>${escapeHtml(row.category || "—")}</td>
        <td>${escapeHtml(row.manufacturer_country || "—")}</td>
        <td>${renderPrintAreaBadges(row.print_areas)}</td>
        <td>${statusBadge("available")}</td>
      </tr>`;
        })
        .join("")
    );
  }

  return renderTable(
    ["", "Title", "Country", "Print areas", "Status", "Versions", ""],
    items
      .map((row, i) => {
        const rowId = `pk-${row.product_key || i}`;
        return `<tr data-product-key="${escapeHtml(row.product_key)}">
      <td class="cs-mock-cell">${buildMockCarouselHtml(row.mock_images, rowId)}</td>
      <td><strong>${escapeHtml(row.title)}</strong><br><code class="text-muted">${escapeHtml(row.product_key)}</code></td>
      <td>${escapeHtml(row.manufacturer_country || "—")}</td>
      <td>${renderPrintAreaBadges(row.print_areas)}</td>
      <td>${statusBadge(row.catalog_status, { clickable: true, productKey: row.product_key })}</td>
      <td>${escapeHtml(row.version_count ?? 0)}</td>
      <td><button type="button" class="btn btn-primary btn-sm btn-edit-eaz-product" data-key="${escapeHtml(row.product_key)}">Edit</button></td>
    </tr>`;
      })
      .join("")
  );
}

function wireProductsTable(container, reload) {
  const productsEl = container.querySelector("#catalog-studio-products");
  if (!productsEl) return;

  initMockCarousels(productsEl);

  productsEl.querySelectorAll(".cs-mock-carousel__open").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const carousel = btn.closest(".cs-mock-carousel");
      let images = [];
      try {
        images = JSON.parse(carousel?.dataset.images || "[]");
      } catch {
        images = [];
      }
      openMockViewer(images, +(btn.dataset.idx || 0));
    });
  });

  productsEl.querySelectorAll(".btn-edit-eaz-product").forEach((btn) => {
    btn.onclick = () => openProductEditor(btn.dataset.key);
  });

  productsEl.querySelectorAll(".cs-status-btn").forEach((btn) => {
    btn.onclick = () => openStatusPicker(btn.dataset.productKey, btn.dataset.status, reload);
  });
}

function bindTreeEvents(root, onSelect) {
  root.querySelectorAll("[data-tree-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePartnerOpen(btn.dataset.treeToggle);
      onSelect();
    });
  });

  root.querySelectorAll(".cs-tree-partner-btn[data-partner-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPartnerId(btn.dataset.partnerId);
      setProviderId("");
      onSelect();
    });
  });

  root.querySelectorAll(".cs-rail-partner-btn[data-partner-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.partnerId;
      togglePartnerOpen(pid);
      setPartnerId(pid);
      setProviderId("");
      onSelect();
    });
  });

  root.querySelectorAll(".cs-tree-provider-btn, .cs-rail-provider-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPartnerId(btn.dataset.partnerId);
      setProviderId(btn.dataset.providerId);
      onSelect();
    });
  });
}

export async function mountCatalogStudio(container) {
  const collapsed = isStudioSidebarCollapsed();
  container.innerHTML = `
    <div class="catalog-studio ${collapsed ? "catalog-studio--sidebar-collapsed" : ""}">
      <div class="catalog-studio-sidebar-wrap">
        <aside class="catalog-studio-sidebar" id="catalog-studio-sidebar">
          <div class="catalog-studio-sidebar-head">
            <span class="catalog-studio-sidebar-label">Partners</span>
          </div>
          <div class="catalog-studio-tree" id="catalog-studio-tree"><p class="catalog-studio-loading">Loading…</p></div>
        </aside>
        <button type="button" class="catalog-studio-rail" id="catalog-studio-sidebar-toggle" aria-label="Collapse partner sidebar" title="Collapse">
          <span class="catalog-studio-rail__arrow-zone" aria-hidden="true"><span class="catalog-studio-rail__arrow">‹</span></span>
          <span class="catalog-studio-rail__label">${collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>
      <div class="catalog-studio-main">
        <div class="catalog-studio-toolbar">
          <div class="pill-tabs" id="catalog-status-tabs"></div>
          <div class="catalog-studio-actions">
            <button type="button" class="btn btn-secondary" id="btn-catalog-sync">Sync</button>
            <button type="button" class="btn btn-secondary" id="btn-catalog-mirror">Mirror</button>
            <button type="button" class="btn btn-primary" id="btn-catalog-refresh">Refresh</button>
          </div>
        </div>
        <p class="catalog-studio-selection" id="catalog-studio-selection"></p>
        <div class="panel catalog-studio-panel">
          <div class="panel-body" id="catalog-studio-products"><p class="catalog-studio-loading">Loading products…</p></div>
        </div>
      </div>
    </div>`;

  const studioEl = container.querySelector(".catalog-studio");
  const filter = getFilter();

  container.querySelector("#catalog-status-tabs").innerHTML = STATUS_FILTERS.map(
    (t) =>
      `<button type="button" class="pill-tab ${filter === t.key ? "active" : ""}" data-status-filter="${t.key}">${t.label}</button>`
  ).join("");

  container.querySelectorAll("[data-status-filter]").forEach((btn) => {
    btn.onclick = () => {
      setFilter(btn.dataset.statusFilter);
      mountCatalogStudio(container);
    };
  });

  container.querySelector("#catalog-studio-sidebar-toggle").onclick = () => {
    const next = !isStudioSidebarCollapsed();
    setStudioSidebarCollapsed(next);
    studioEl.classList.toggle("catalog-studio--sidebar-collapsed", next);
    const label = container.querySelector(".catalog-studio-rail__label");
    const toggle = container.querySelector("#catalog-studio-sidebar-toggle");
    if (label) label.textContent = next ? "Expand" : "Collapse";
    if (toggle) {
      toggle.setAttribute("aria-label", next ? "Expand partner sidebar" : "Collapse partner sidebar");
      toggle.title = next ? "Expand" : "Collapse";
    }
  };

  container.querySelector("#btn-catalog-refresh").onclick = () => mountCatalogStudio(container);

  container.querySelector("#btn-catalog-mirror").onclick = async () => {
    const result = await partnerFetch("admin-eazpire-catalog-mirror-run", { method: "POST", body: {} });
    showToast("Mirror complete", `${result.mirrored ?? 0} product(s) synced to publish index`);
    await mountCatalogStudio(container);
  };

  container.querySelector("#btn-catalog-sync").onclick = async () => {
    const partnerId = getPartnerId();
    const partners = (await partnerFetch("admin-catalog-studio-tree")).partners || [];
    const partner = partners.find((p) => p.id === partnerId);
    if (!partner || partner.slug !== "printify") {
      showToast("Sync", "Printify sync is available when Printify is selected.");
      return;
    }
    try {
      showToast("Syncing Printify…", "Online products only");
      const result = await partnerFetch("admin-partner-sync-printify", { method: "POST", body: {} });
      const s = result.sync?.synced || {};
      showToast("Printify sync complete", `${s.blueprints ?? 0} blueprint(s), ${result.import?.count ?? 0} product(s) imported`);
      await mountCatalogStudio(container);
    } catch (e) {
      showToast("Sync failed", e.message || String(e));
    }
  };

  const treeData = await partnerFetch("admin-catalog-studio-tree");
  const partners = treeData.partners || [];
  let partnerId = getPartnerId();
  if (!partnerId && partners[0]) {
    partnerId = partners[0].id;
    setPartnerId(partnerId);
  }
  const providerId = getProviderId();
  const partner = partners.find((p) => p.id === partnerId);
  const provider = partner?.providers?.find((fp) => String(fp.external_provider_id) === String(providerId));

  const treeRoot = container.querySelector("#catalog-studio-tree");
  treeRoot.innerHTML = partners.length
    ? renderTree(partners, partnerId, providerId)
    : `<p class="text-muted">No partners yet.</p>`;
  bindTreeEvents(treeRoot, () => mountCatalogStudio(container));

  const selectionEl = container.querySelector("#catalog-studio-selection");
  if (provider) {
    selectionEl.textContent = `${partner?.name || "Partner"} · Provider: ${provider.name}`;
  } else if (partner) {
    selectionEl.textContent = `${partner.name} · All providers`;
  } else {
    selectionEl.textContent = "Select a partner";
  }

  const productsEl = container.querySelector("#catalog-studio-products");
  if (!partnerId) {
    productsEl.innerHTML = `<div class="empty-state"><p>Select a partner from the sidebar.</p></div>`;
    return;
  }

  const productData = await partnerFetch("admin-catalog-studio-products", {
    query: {
      manufacturer_id: partnerId,
      provider_id: providerId || undefined,
      filter,
    },
  });

  productsEl.innerHTML = renderProductsTable(productData.items || [], filter);
  wireProductsTable(container, () => mountCatalogStudio(container));
}
