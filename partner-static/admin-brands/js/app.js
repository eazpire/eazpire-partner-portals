import { partnerFetch, escapeHtml, badgeForStatus } from "/brands/shared/js/partner-api.js";
import { initShell, showToast, setTopbarExtra } from "/brands/shared/js/partner-shell.js";
import { initAdminAppDrawer } from "/brands/shared/js/admin-app-drawer.js";

const NAV_CORE = [
  { route: "/brands", label: "All Brands", icon: "◆" },
];

const CRUMB_LABELS = {
  "/brands": "Brands",
  "/brands/detail": "Brand detail",
};

let selectedBrandId = null;

async function ensureAdminSession() {
  try {
    await partnerFetch("admin-auth-me");
    return true;
  } catch {
    return false;
  }
}

function showLogin(authErrorCode = "") {
  document.getElementById("app-login").hidden = false;
  document.getElementById("app-shell").hidden = true;
  const loading = document.getElementById("app-loading");
  if (loading) loading.hidden = true;
  const msg = document.getElementById("login-message");
  if (msg && authErrorCode) {
    const messages = {
      invalid_or_expired_token: "This sign-in link is invalid or has expired. Request a new link below.",
      token_already_used: "This sign-in link was already used. Request a new link below.",
      token_required: "Sign-in link is missing. Request a new link below.",
    };
    msg.textContent = messages[authErrorCode] || "Sign-in failed. Request a new link below.";
  }
}

function showShell() {
  document.getElementById("app-login").hidden = true;
  document.getElementById("app-shell").hidden = false;
  const loading = document.getElementById("app-loading");
  if (loading) loading.hidden = true;
}

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(Number(ts)).toLocaleString();
  } catch {
    return "—";
  }
}

function connBadge(connected) {
  return connected
    ? `<span class="badge badge-success">connected</span>`
    : `<span class="badge badge-neutral">no</span>`;
}

async function mountBrandsList() {
  const root = document.getElementById("view-brands-list");
  setTopbarExtra(`
    <input class="input" id="brands-q" placeholder="Search name, handle, email" style="width:220px" />
    <select class="input" id="brands-status" style="width:auto">
      <option value="">All statuses</option>
      <option value="active">Active</option>
      <option value="suspended">Suspended</option>
    </select>
    <button type="button" class="btn btn-secondary" id="brands-refresh">Refresh</button>
  `);

  const load = async () => {
    root.innerHTML = `<div class="panel"><p class="muted">Loading brands…</p></div>`;
    const q = document.getElementById("brands-q")?.value?.trim() || "";
    const status = document.getElementById("brands-status")?.value || "";
    const data = await partnerFetch("admin-brand-list", { query: { q, status, limit: 100 } });
    const brands = data.brands || [];
    root.innerHTML = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
          <div>
            <h2 style="margin:0">Brands</h2>
            <p class="muted" style="margin:6px 0 0">${brands.length} brand${brands.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Handle</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Printify</th>
                <th>Shopify</th>
                <th>Products</th>
                <th>Dual-publish</th>
              </tr>
            </thead>
            <tbody>
              ${
                brands.length
                  ? brands
                      .map(
                        (b) => `<tr class="row-click" data-brand-id="${escapeHtml(b.id)}" style="cursor:pointer">
                  <td><strong>${escapeHtml(b.name || "—")}</strong></td>
                  <td><code>${escapeHtml(b.handle || "—")}</code></td>
                  <td>${escapeHtml(b.owner_email || "—")}</td>
                  <td><span class="badge ${badgeForStatus(b.status)}">${escapeHtml(b.status || "—")}</span></td>
                  <td>${connBadge(b.printify_connected)}</td>
                  <td>${connBadge(b.shopify_connected)}</td>
                  <td>${Number(b.product_count || 0)}</td>
                  <td>${Number(b.dual_published_count || 0)} pub${
                          Number(b.dual_error_count || 0)
                            ? ` · <span class="badge badge-warning">${Number(b.dual_error_count)} err</span>`
                            : ""
                        }</td>
                </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="8" class="muted">No brands found.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>`;

    root.querySelectorAll("[data-brand-id]").forEach((row) => {
      row.addEventListener("click", () => {
        selectedBrandId = row.getAttribute("data-brand-id");
        history.pushState({}, "", `/brands/detail?id=${encodeURIComponent(selectedBrandId)}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    });
  };

  document.getElementById("brands-refresh")?.addEventListener("click", () => load().catch((e) => showToast("Error", e.message)));
  document.getElementById("brands-status")?.addEventListener("change", () => load().catch((e) => showToast("Error", e.message)));
  let qTimer = null;
  document.getElementById("brands-q")?.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => load().catch((e) => showToast("Error", e.message)), 300);
  });

  await load();
}

async function mountBrandDetail() {
  const root = document.getElementById("view-brands-detail");
  const params = new URLSearchParams(location.search);
  const brandId = params.get("id") || selectedBrandId;
  if (!brandId) {
    history.replaceState({}, "", "/brands");
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  selectedBrandId = brandId;

  setTopbarExtra(`<button type="button" class="btn btn-secondary" id="btn-back-brands">← All brands</button>`);
  document.getElementById("btn-back-brands")?.addEventListener("click", () => {
    history.pushState({}, "", "/brands");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  root.innerHTML = `<div class="panel"><p class="muted">Loading brand…</p></div>`;
  const data = await partnerFetch("admin-brand-get", { query: { brand_id: brandId } });
  const brand = data.brand;
  const connections = data.connections || {};
  const products = data.products || [];
  const members = data.members || [];

  const isSuspended = brand.status === "suspended";

  root.innerHTML = `
    <div class="panel" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <h2 style="margin:0 0 6px">${escapeHtml(brand.name)}</h2>
          <p class="muted" style="margin:0"><code>${escapeHtml(brand.handle)}</code> ·
            <span class="badge ${badgeForStatus(brand.status)}">${escapeHtml(brand.status)}</span>
            ${brand.tagline ? ` · ${escapeHtml(brand.tagline)}` : ""}
          </p>
          <p style="margin:10px 0 0">Owner: <strong>${escapeHtml(brand.owner_email || "—")}</strong>
            ${brand.owner_eazpire_linked ? ' · <span class="badge badge-success">eazpire account linked</span>' : ""}
          </p>
          ${
            isSuspended
              ? `<p class="muted" style="margin:8px 0 0">Suspended ${fmtDate(brand.suspended_at)}${
                  brand.suspend_reason ? `: ${escapeHtml(brand.suspend_reason)}` : ""
                }</p>`
              : ""
          }
        </div>
        <div class="actions-row" style="margin:0">
          ${
            isSuspended
              ? `<button type="button" class="btn btn-primary" id="btn-activate">Activate</button>`
              : `<button type="button" class="btn btn-secondary" id="btn-suspend">Suspend</button>`
          }
          <button type="button" class="btn btn-secondary" id="btn-force-unpublish-all">Force unpublish all</button>
        </div>
      </div>
      ${brand.about ? `<p style="margin:14px 0 0">${escapeHtml(brand.about)}</p>` : ""}
    </div>

    <div class="panel" style="margin-bottom:16px">
      <h3 style="margin-top:0">Connections (health only)</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Type</th><th>Status</th><th>Last OK</th><th>Meta</th></tr></thead>
          <tbody>
            <tr>
              <td>Printify</td>
              <td>${connBadge(connections.printify?.connected)}</td>
              <td>${fmtDate(connections.printify?.last_ok_at)}</td>
              <td class="muted">${escapeHtml(
                connections.printify?.meta?.shop_id
                  ? `shop ${connections.printify.meta.shop_id}`
                  : "—"
              )}</td>
            </tr>
            <tr>
              <td>Shopify (BYO)</td>
              <td>${connBadge(connections.shopify?.connected)}</td>
              <td>${fmtDate(connections.shopify?.last_ok_at)}</td>
              <td class="muted">${escapeHtml(connections.shopify?.meta?.shop_domain || "—")}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <h3 style="margin:0">Products on eazpire</h3>
        <button type="button" class="btn btn-secondary" id="btn-force-unpublish-selected" disabled>Unpublish selected</button>
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table class="data">
          <thead>
            <tr>
              <th></th>
              <th>Title</th>
              <th>Printify</th>
              <th>eazpire ID</th>
              <th>Handle</th>
              <th>Dual status</th>
            </tr>
          </thead>
          <tbody>
            ${
              products.length
                ? products
                    .map(
                      (p) => `<tr>
                <td><input type="checkbox" class="prod-check" value="${escapeHtml(p.id)}" ${
                        p.eazpire_shopify_product_id ? "" : "disabled"
                      } /></td>
                <td>${escapeHtml(p.title || "—")}</td>
                <td>${escapeHtml(p.printify_product_id || "—")}</td>
                <td>${escapeHtml(p.eazpire_shopify_product_id || "—")}</td>
                <td>${escapeHtml(p.eazpire_handle || "—")}</td>
                <td><span class="badge ${badgeForStatus(p.dual_publish_status || "draft")}">${escapeHtml(
                  p.dual_publish_status || "—"
                )}</span>${
                        p.dual_publish_error
                          ? ` <span class="muted" title="${escapeHtml(p.dual_publish_error)}">!</span>`
                          : ""
                      }</td>
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="6" class="muted">No products synced yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top:0">Team</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Email</th><th>Role</th><th>Publish mode</th><th>Status</th></tr></thead>
          <tbody>
            ${
              members.length
                ? members
                    .map(
                      (m) => `<tr>
                <td>${escapeHtml(m.email)}</td>
                <td>${escapeHtml(m.role)}</td>
                <td>${escapeHtml(m.publish_mode)}</td>
                <td><span class="badge ${badgeForStatus(m.status)}">${escapeHtml(m.status)}</span></td>
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="4" class="muted">No team members.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  const selectedIds = () =>
    [...root.querySelectorAll(".prod-check:checked")].map((el) => el.value);

  const updateSelBtn = () => {
    const btn = document.getElementById("btn-force-unpublish-selected");
    if (btn) btn.disabled = selectedIds().length === 0;
  };
  root.querySelectorAll(".prod-check").forEach((el) => el.addEventListener("change", updateSelBtn));

  document.getElementById("btn-suspend")?.addEventListener("click", async () => {
    const reason = window.prompt("Suspend reason (optional):", "") ?? "";
    try {
      await partnerFetch("admin-brand-suspend", {
        method: "POST",
        body: { brand_id: brandId, reason },
      });
      showToast("Suspended", brand.name);
      await mountBrandDetail();
    } catch (e) {
      showToast("Error", e.message);
    }
  });

  document.getElementById("btn-activate")?.addEventListener("click", async () => {
    try {
      await partnerFetch("admin-brand-activate", { method: "POST", body: { brand_id: brandId } });
      showToast("Activated", brand.name);
      await mountBrandDetail();
    } catch (e) {
      showToast("Error", e.message);
    }
  });

  document.getElementById("btn-force-unpublish-all")?.addEventListener("click", async () => {
    if (!window.confirm(`Draft all eazpire listings for ${brand.name}?`)) return;
    try {
      const res = await partnerFetch("admin-brand-force-unpublish", {
        method: "POST",
        body: { brand_id: brandId, all: true },
      });
      showToast("Unpublished", `${res.unpublished || 0} products`);
      await mountBrandDetail();
    } catch (e) {
      showToast("Error", e.message);
    }
  });

  document.getElementById("btn-force-unpublish-selected")?.addEventListener("click", async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    if (!window.confirm(`Draft ${ids.length} eazpire listing(s)?`)) return;
    try {
      const res = await partnerFetch("admin-brand-force-unpublish", {
        method: "POST",
        body: { brand_id: brandId, product_ids: ids, all: false },
      });
      showToast("Unpublished", `${res.unpublished || 0} products`);
      await mountBrandDetail();
    } catch (e) {
      showToast("Error", e.message);
    }
  });
}

const ROUTES = {
  "/brands": async () => {
    await mountBrandsList();
  },
  "/brands/detail": async () => {
    await mountBrandDetail();
  },
};

async function onRoute(route) {
  const raw = String(route || "/brands").replace(/\/$/, "") || "/brands";
  const path = raw.startsWith("/brands/detail") ? "/brands/detail" : raw === "/brands" ? "/brands" : "/brands";
  const fn = ROUTES[path] || ROUTES["/brands"];
  try {
    await fn();
  } catch (e) {
    if (e.status === 401 || e.status === 403) showLogin();
    else showToast("Error", e.message || String(e));
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  await partnerFetch("admin-auth-request", { method: "POST", body: { email } });
  document.getElementById("login-message").textContent =
    "If this email is authorized, you will receive a sign-in link within a few minutes. Check spam.";
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await partnerFetch("admin-auth-logout", { method: "POST" });
  showLogin();
});

(async function boot() {
  if (await ensureAdminSession()) {
    showShell();
    initAdminAppDrawer({ currentAppId: "brands", brandTitle: "Eazpire Brands" });
    initShell({
      navSections: [{ title: "Brands Portal", items: NAV_CORE }],
      onRoute,
      brandSub: "Admin Ops",
      crumbLabels: CRUMB_LABELS,
    });
  } else {
    const authError = new URLSearchParams(location.search).get("auth_error") || "";
    showLogin(authError);
    if (authError) history.replaceState({}, "", location.pathname);
  }
})();
