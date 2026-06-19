import { partnerFetch, escapeHtml } from "/partner/shared/js/partner-api.js";
import { showToast, renderTable } from "/partner/shared/js/partner-shell.js";
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

function statusBadge(status) {
  const map = {
    online: "badge-success",
    preview: "badge-warning",
    offline: "badge-secondary",
    available: "badge-info",
  };
  return `<span class="badge ${map[status] || "badge-secondary"}">${escapeHtml(status)}</span>`;
}

function renderTree(partners, selectedPartnerId, selectedProviderId) {
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
            <span class="cs-tree-partner-name">${escapeHtml(partner.name)}</span>
          </button>
          <span class="cs-tree-count">${providerCount}</span>
        </div>
        <div class="cs-tree-providers" ${isOpen ? "" : "hidden"}>
          ${providers
            .map(
              (fp) => `<button type="button" class="cs-tree-provider-btn ${selectedProviderId === String(fp.external_provider_id) ? "active" : ""}"
                data-partner-id="${escapeHtml(partner.id)}" data-provider-id="${escapeHtml(fp.external_provider_id)}">
                <span>${escapeHtml(fp.name)}</span>
              </button>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");
}

function renderProductsTable(items, filter) {
  if (!items?.length) {
    return `<div class="empty-state"><h3>No products</h3><p>Nothing matches this filter for the current selection.</p></div>`;
  }

  if (filter === "available") {
    return renderTable(
      ["Title", "Blueprint key", "Category", "Status", ""],
      items
        .map(
          (row) => `<tr>
        <td>${escapeHtml(row.title)}</td>
        <td><code>${escapeHtml(row.blueprint_key || "—")}</code></td>
        <td>${escapeHtml(row.category || "—")}</td>
        <td>${statusBadge("available")}</td>
        <td><span class="text-muted">Not in Eazpire yet</span></td>
      </tr>`
        )
        .join("")
    );
  }

  return renderTable(
    ["Product key", "Title", "Status", "Versions", ""],
    items
      .map(
        (row) => `<tr>
      <td><code>${escapeHtml(row.product_key)}</code></td>
      <td>${escapeHtml(row.title)}</td>
      <td>${statusBadge(row.catalog_status)}</td>
      <td>${escapeHtml(row.version_count ?? 0)}</td>
      <td><button type="button" class="btn btn-primary btn-sm btn-edit-eaz-product" data-key="${escapeHtml(row.product_key)}">Edit</button></td>
    </tr>`
      )
      .join("")
  );
}

function bindTreeEvents(root, onSelect) {
  root.querySelectorAll("[data-tree-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePartnerOpen(btn.dataset.treeToggle);
      onSelect();
    });
  });

  root.querySelectorAll(".cs-tree-partner-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPartnerId(btn.dataset.partnerId);
      setProviderId("");
      onSelect();
    });
  });

  root.querySelectorAll(".cs-tree-provider-btn").forEach((btn) => {
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
      <aside class="catalog-studio-sidebar" id="catalog-studio-sidebar">
        <div class="catalog-studio-sidebar-head">
          <span class="catalog-studio-sidebar-label">Partners</span>
          <button type="button" class="icon-btn catalog-studio-sidebar-toggle" id="catalog-studio-sidebar-toggle" aria-label="Collapse partner sidebar">‹</button>
        </div>
        <div class="catalog-studio-tree" id="catalog-studio-tree"><p class="catalog-studio-loading">Loading…</p></div>
      </aside>
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
    setStudioSidebarCollapsed(!isStudioSidebarCollapsed());
    studioEl.classList.toggle("catalog-studio--sidebar-collapsed");
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
  productsEl.querySelectorAll(".btn-edit-eaz-product").forEach((btn) => {
    btn.onclick = () => openProductEditor(btn.dataset.key);
  });
}
