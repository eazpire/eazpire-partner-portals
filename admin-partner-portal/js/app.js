import { partnerFetch, badgeForStatus, escapeHtml } from "/partner/shared/js/partner-api.js";
import { initShell, openModal, closeModal, confirmAction, openActionModeModal, showToast, renderTable, setTopbarExtra } from "/partner/shared/js/partner-shell.js";

const NAV_CORE = [
  { route: "/partner", label: "Command Center", icon: "⌘" },
  { route: "/partner/manufacturers", label: "Manufacturers", icon: "🏭" },
  { route: "/partner/catalog", label: "Catalog Studio", icon: "▦" },
  { route: "/partner/orders", label: "Order Ops", icon: "↗" },
  { route: "/partner/api", label: "API Console", icon: "{ }" },
  { route: "/partner/certification", label: "Certification HQ", icon: "✓" },
];

const NETWORK_TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "suspended", label: "Suspended" },
  { key: "blocked", label: "Blocked" },
];

const CRUMB_LABELS = {
  "/partner": "Command Center",
  "/partner/manufacturers": "Manufacturers",
  "/partner/catalog": "Catalog Studio",
  "/partner/orders": "Order Ops",
  "/partner/api": "API Console",
  "/partner/certification": "Certification HQ",
  "/partner/requests": "Partner Requests",
};

const THEME_BY_ROUTE = {
  "/partner": "",
  "/partner/manufacturers": "",
  "/partner/catalog": "theme-studio",
  "/partner/orders": "theme-ops",
  "/partner/api": "theme-api",
  "/partner/certification": "theme-cert",
  "/partner/requests": "",
};

const COMMAND_TIME_RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

function getCommandTimeRange() {
  const stored = sessionStorage.getItem("admin_command_time_range");
  return COMMAND_TIME_RANGES.some((r) => r.key === stored) ? stored : "today";
}

function commandTimeTabsHtml(activeKey) {
  return `<div class="pill-tabs" role="tablist">${COMMAND_TIME_RANGES.map(
    (r) =>
      `<button type="button" class="pill-tab ${activeKey === r.key ? "active" : ""}" data-command-time="${r.key}">${r.label}</button>`
  ).join("")}</div>`;
}

const CATALOG_STUDIO_TABS = [
  { key: "partners", label: "Partners" },
  { key: "eazpire", label: "Eazpire Products" },
  { key: "review", label: "Review Queue" },
];

function getCatalogStudioTab() {
  const tab = sessionStorage.getItem("admin_catalog_studio_tab") || "partners";
  return CATALOG_STUDIO_TABS.some((t) => t.key === tab) ? tab : "partners";
}

function setCatalogStudioTab(tab) {
  sessionStorage.setItem("admin_catalog_studio_tab", tab);
  renderCatalog();
}

function getCatalogTab() {
  const tab = sessionStorage.getItem("admin_catalog_tab") || "products";
  return tab === "blueprints" ? "blueprints" : "products";
}

function setCatalogTab(tab) {
  sessionStorage.setItem("admin_catalog_tab", tab === "blueprints" ? "blueprints" : "products");
  renderCatalog();
}

function getNetworkTab() {
  const fromUrl = new URLSearchParams(location.search).get("tab");
  if (fromUrl && NETWORK_TABS.some((t) => t.key === fromUrl)) return fromUrl;
  const stored = sessionStorage.getItem("admin_network_tab");
  if (stored && NETWORK_TABS.some((t) => t.key === stored)) return stored;
  return "pending";
}

function setNetworkTab(tab) {
  sessionStorage.setItem("admin_network_tab", tab);
  const url = new URL(location.href);
  if (tab === "approved") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  history.replaceState({}, "", url.pathname + url.search);
  renderManufacturers();
}

function formatNetworkDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function priorHistoryLabel(event) {
  const date = formatNetworkDate(event.at);
  if (event.type === "rejected") return `Rejected on ${date}`;
  if (event.type === "suspended") return `Suspended on ${date}`;
  return `Prior event on ${date}`;
}

function priorHistoryHtml(history) {
  if (!history?.length) return "";
  return `<div class="prior-history-list">${history
    .map((event) => {
      const payload = encodeURIComponent(JSON.stringify(event));
      return `<button type="button" class="prior-history-chip" data-prior="${payload}">${escapeHtml(priorHistoryLabel(event))}</button>`;
    })
    .join("")}</div>`;
}

function openReasonInfoModal({ title, subtitle, reason, dateLabel, dateValue }) {
  openModal({
    title,
    bodyHtml: `
      ${subtitle ? `<p class="confirm-modal-message">${escapeHtml(subtitle)}</p>` : ""}
      ${dateLabel ? `<p><strong>${escapeHtml(dateLabel)}:</strong> ${escapeHtml(dateValue || "—")}</p>` : ""}
      <div class="field" style="margin-top:12px">
        <label>Reason</label>
        <div class="info-reason-box">${reason ? escapeHtml(reason) : "No reason was provided."}</div>
      </div>`,
    onSave: null,
  });
  const saveBtn = document.getElementById("modal-save");
  if (saveBtn) saveBtn.style.display = "none";
}

function openPriorHistoryModal(event) {
  const title = event.type === "rejected" ? "Previous rejection" : "Previous suspension";
  openReasonInfoModal({
    title,
    subtitle: event.company_name ? `Company: ${event.company_name}` : "",
    dateLabel: event.type === "rejected" ? "Rejected on" : "Suspended on",
    dateValue: formatNetworkDate(event.at),
    reason: event.reason,
  });
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

function entityCell(name, sub = "") {
  return `<div class="entity"><div class="avatar">${escapeHtml(initials(name))}</div><div><strong>${escapeHtml(name)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</div></div>`;
}

function stageHeading(kicker, title, desc, actionsHtml = "") {
  return `<div class="stage-heading"><div><div class="stage-kicker">${escapeHtml(kicker)}</div><h1 class="stage-title">${escapeHtml(title)}</h1><p class="stage-desc">${escapeHtml(desc)}</p></div>${actionsHtml}</div>`;
}

function applyRouteTheme(route) {
  const body = document.body;
  body.classList.remove("theme-studio", "theme-ops", "theme-api", "theme-cert");
  const theme = THEME_BY_ROUTE[route];
  if (theme) body.classList.add(theme);
}

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
      token_already_used:
        "This sign-in link was already used (often by an email security scanner). Request a new link below.",
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

function manufacturerModeBadge(m) {
  if (m.api_enabled || m.integration_mode === "api") return "badge-purple";
  return "badge-neutral";
}

function manufacturerModeLabel(m) {
  if (m.api_enabled || m.integration_mode === "api") return "API Partner";
  return "Portal";
}

async function renderCommand() {
  setTopbarExtra("");
  const el = document.getElementById("view-command");
  const timeRange = getCommandTimeRange();
  // TODO: pass timeRange to admin-manufacturer-network-overview when API supports days filter
  const data = await partnerFetch("admin-manufacturer-network-overview");
  const kpis = data.kpis || {};
  const health = data.manufacturer_health || [];
  const alerts = data.alerts || [];
  const atRisk = Number(kpis.at_risk ?? 0);
  const timeLabel = COMMAND_TIME_RANGES.find((r) => r.key === timeRange)?.label || "Today";

  el.innerHTML = `
    ${stageHeading(
      "Overview",
      "Command Center",
      "Network health, risk radar, and manufacturer onboarding pipeline.",
      commandTimeTabsHtml(timeRange)
    )}
    <p class="command-time-hint">Showing all-time network data · selected range: ${escapeHtml(timeLabel)} (V1)</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Active Manufacturers</div><div class="kpi-value">${escapeHtml(kpis.manufacturers_total ?? 0)}</div><div class="kpi-trend">↗ network total</div></div>
      <div class="kpi-card"><div class="kpi-label">Catalog Products</div><div class="kpi-value">${escapeHtml(kpis.catalog_products ?? 0)}</div><div class="kpi-trend">↗ in network</div></div>
      <div class="kpi-card"><div class="kpi-label">Open Orders</div><div class="kpi-value">${escapeHtml(kpis.orders_open ?? 0)}</div><div class="kpi-trend ${atRisk ? "is-warning" : ""}">${atRisk ? `⚠ ${atRisk} at risk` : "✓ on track"}</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Quality Score</div><div class="kpi-value">${escapeHtml(kpis.avg_quality_score ?? "—")}</div><div class="kpi-trend">✓ certified network</div></div>
    </div>
    <div class="content-grid">
      <div class="panel map-panel">
        <div class="map-grid"></div>
        <div class="node a"><h4>Manufacturers</h4><p>${escapeHtml(kpis.manufacturers_total ?? 0)} in network</p></div>
        <div class="node b"><h4>Pending review</h4><p>${escapeHtml(kpis.products_pending ?? 0)} products</p></div>
        <div class="node c"><h4>Open orders</h4><p>${escapeHtml(kpis.orders_open ?? 0)} active</p></div>
        <div class="node d"><h4>Quality avg</h4><p>${escapeHtml(kpis.avg_quality_score ?? "—")} score</p></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div><h2 class="panel-title">Risk Radar</h2><p class="panel-subtitle">Items needing operator attention</p></div>
          ${alerts.length ? `<span class="badge badge-warning">${alerts.length} alerts</span>` : `<span class="badge badge-success">Clear</span>`}
        </div>
        <div class="panel-body timeline">
          ${
            alerts.length
              ? alerts
                  .map(
                    (a, i) => `<div class="timeline-item"><div class="dot">${i + 1}</div><div class="timeline-content"><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.detail || "")}</p></div></div>`
                  )
                  .join("")
              : `<div class="empty-state"><div class="icon">✓</div><h3>All clear</h3><p>No network alerts require attention right now.</p></div>`
          }
        </div>
      </div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-header">
        <div><h2 class="panel-title">Manufacturer Health</h2><p class="panel-subtitle">Listview for partner operations</p></div>
      </div>
      ${renderTable(
        ["Manufacturer", "Region", "Mode", "Quality", "Status", "Action"],
        health
          .map(
            (m) => `<tr>
          <td>${entityCell(m.name, m.product_focus || m.owner_email || "")}</td>
          <td>${escapeHtml(m.country || "—")}</td>
          <td><span class="badge ${manufacturerModeBadge(m)}">${manufacturerModeLabel(m)}</span></td>
          <td>${escapeHtml(m.quality_score ?? "—")}</td>
          <td><span class="badge ${badgeForStatus(m.status)}">${escapeHtml(m.status)}</span></td>
          <td><button type="button" class="btn btn-secondary btn-open-mfg" data-id="${escapeHtml(m.id)}">Open</button></td>
        </tr>`
          )
          .join("") || '<tr><td colspan="6" class="empty">No manufacturers yet</td></tr>'
      )}
    </div>`;

  el.querySelectorAll("[data-command-time]").forEach((btn) => {
    btn.onclick = () => {
      sessionStorage.setItem("admin_command_time_range", btn.dataset.commandTime);
      renderCommand();
    };
  });

  el.querySelectorAll(".btn-open-mfg").forEach((btn) => {
    btn.onclick = () => navigateToManufacturers();
  });
}

function navigateToManufacturers() {
  const nav = document.querySelector('[data-route="/partner/manufacturers"]');
  nav?.click();
}

async function renderManufacturers() {
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="btn-invite">Invite Partner</button>`);
  const el = document.getElementById("view-manufacturers");
  const tab = getNetworkTab();
  const { board } = await partnerFetch("admin-manufacturer-network-board");
  const counts = board?.counts || {};

  const tabsHtml = NETWORK_TABS.map(
    (t) =>
      `<button type="button" class="pill-tab ${tab === t.key ? "active" : ""}" data-network-tab="${t.key}">${escapeHtml(t.label)}${counts[t.key] ? `<span class="pill-tab-count">${counts[t.key]}</span>` : ""}</button>`
  ).join("");

  el.innerHTML = `
    ${stageHeading(
      "Core Portal",
      "Manufacturers",
      "Review applications and manage approved partners in the Eazpire manufacturer network.",
      `<button type="button" class="btn btn-primary" id="btn-invite-heading">Invite Partner</button>`
    )}
    <div class="catalog-toolbar" style="margin-bottom:14px">
      <div class="pill-tabs">${tabsHtml}</div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div><h2 class="panel-title">${escapeHtml(NETWORK_TABS.find((t) => t.key === tab)?.label || "Network")}</h2><p class="panel-subtitle">${escapeHtml(networkTabSubtitle(tab))}</p></div>
        <span class="badge badge-neutral">${escapeHtml(String(counts[tab] ?? 0))}</span>
      </div>
      <div class="panel-body">${renderNetworkTabPanel(tab, board)}</div>
    </div>`;

  el.querySelectorAll("[data-network-tab]").forEach((btn) => {
    btn.onclick = () => setNetworkTab(btn.dataset.networkTab);
  });

  const openInvite = () => inviteManufacturerModal(el);
  document.getElementById("btn-invite")?.addEventListener("click", openInvite);
  document.getElementById("btn-invite-heading")?.addEventListener("click", openInvite);

  bindNetworkTabActions(el, tab);
}

function networkTabSubtitle(tab) {
  const map = {
    pending: "Applications awaiting operator decision",
    approved: "Verified partners active in the network",
    rejected: "Declined partner applications",
    suspended: "Partners with suspended portal access",
    blocked: "Emails blocked from new applications",
  };
  return map[tab] || "";
}

function renderNetworkTabPanel(tab, board) {
  if (tab === "pending") return renderPendingPanel(board?.pending || []);
  if (tab === "approved") return renderApprovedPanel(board?.approved || []);
  if (tab === "rejected") return renderRejectedPanel(board?.rejected || []);
  if (tab === "suspended") return renderSuspendedPanel(board?.suspended || []);
  if (tab === "blocked") return renderBlockedPanel(board?.blocked || []);
  return `<div class="empty-state"><p>No data</p></div>`;
}

function renderPendingPanel(applications) {
  return renderTable(
    ["Company", "Contact", "Email", "Country", "Status", "Actions"],
    applications
      .map((app) => {
        const historyHtml = priorHistoryHtml(app.prior_history);
        const companyCell = `${entityCell(app.company_name, app.product_types || "")}${historyHtml}`;
        const actions =
          app.status === "pending_review"
            ? `<button type="button" class="btn btn-primary btn-app-approve" data-id="${escapeHtml(app.id)}">Approve</button>
               <button type="button" class="btn btn-ghost btn-app-reject" data-id="${escapeHtml(app.id)}" data-name="${escapeHtml(app.company_name)}">Reject</button>`
            : `<span class="stage-desc">Awaiting email verify</span>`;
        return `<tr>
          <td>${companyCell}</td>
          <td>${escapeHtml(app.contact_name)}</td>
          <td>${escapeHtml(app.email)}</td>
          <td>${escapeHtml(app.country || "—")}</td>
          <td><span class="badge ${badgeForStatus(app.status)}">${escapeHtml(app.status)}</span></td>
          <td>${actions}</td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="6" class="empty">No pending applications</td></tr>'
  );
}

function renderApprovedPanel(manufacturers) {
  return renderTable(
    ["Manufacturer", "Region", "Mode", "Quality", "Status", "Actions"],
    manufacturers
      .map(
        (m) => `<tr>
          <td>${entityCell(m.name, m.owner_email || "")}</td>
          <td>${escapeHtml(m.country || "—")}</td>
          <td><span class="badge ${manufacturerModeBadge(m)}">${manufacturerModeLabel(m)}</span></td>
          <td>${escapeHtml(m.quality_score ?? "—")}</td>
          <td><span class="badge ${badgeForStatus(m.status)}">${escapeHtml(m.status)}</span></td>
          <td>
            ${m.status === "approved_for_test" ? `<button type="button" class="btn btn-secondary btn-approve" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">Verify</button>` : ""}
            <button type="button" class="btn btn-ghost btn-suspend" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">Suspend</button>
          </td>
        </tr>`
      )
      .join("") || '<tr><td colspan="6" class="empty">No approved manufacturers</td></tr>'
  );
}

function renderRejectedPanel(applications) {
  return renderTable(
    ["Company", "Contact", "Email", "Rejected", "Actions"],
    applications
      .map((app) => {
        const reasonPayload = encodeURIComponent(JSON.stringify({ type: "rejected", reason: app.rejection_reason, at: app.reviewed_at, company_name: app.company_name }));
        return `<tr>
          <td>${entityCell(app.company_name, app.product_types || "")}</td>
          <td>${escapeHtml(app.contact_name)}</td>
          <td>${escapeHtml(app.email)}</td>
          <td>${escapeHtml(formatNetworkDate(app.reviewed_at))}</td>
          <td><button type="button" class="btn btn-ghost btn-reason-info" data-reason="${reasonPayload}">View reason</button></td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="5" class="empty">No rejected applications</td></tr>'
  );
}

function renderSuspendedPanel(manufacturers) {
  return renderTable(
    ["Manufacturer", "Email", "Region", "Suspended", "Actions"],
    manufacturers
      .map((m) => {
        const reasonPayload = encodeURIComponent(
          JSON.stringify({ type: "suspended", reason: m.suspend_reason, at: m.suspended_at, company_name: m.name })
        );
        return `<tr>
          <td>${entityCell(m.name, m.country || "")}</td>
          <td>${escapeHtml(m.owner_email || "—")}</td>
          <td>${escapeHtml(m.country || "—")}</td>
          <td>${escapeHtml(formatNetworkDate(m.suspended_at))}</td>
          <td>
            <button type="button" class="btn btn-secondary btn-reactivate" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">Reactivate</button>
            <button type="button" class="btn btn-ghost btn-reason-info" data-reason="${reasonPayload}">View reason</button>
          </td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="5" class="empty">No suspended manufacturers</td></tr>'
  );
}

function renderBlockedPanel(blocks) {
  return renderTable(
    ["Email", "Blocked", "Reason", "Actions"],
    blocks
      .map((row) => {
        const reasonPayload = encodeURIComponent(JSON.stringify({ type: "blocked", reason: row.reason, at: row.blocked_at, email: row.email }));
        return `<tr>
          <td>${escapeHtml(row.email)}</td>
          <td>${escapeHtml(formatNetworkDate(row.blocked_at))}</td>
          <td>${row.reason ? escapeHtml(row.reason.slice(0, 80)) : "—"}</td>
          <td><button type="button" class="btn btn-ghost btn-reason-info" data-reason="${reasonPayload}">View details</button></td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="4" class="empty">No blocked emails</td></tr>'
  );
}

function bindNetworkTabActions(root) {
  root.querySelectorAll(".prior-history-chip").forEach((btn) => {
    btn.onclick = () => {
      try {
        openPriorHistoryModal(JSON.parse(decodeURIComponent(btn.dataset.prior || "%7B%7D")));
      } catch {
        showToast("Error", "Could not load history details");
      }
    };
  });

  root.querySelectorAll(".btn-reason-info").forEach((btn) => {
    btn.onclick = () => {
      try {
        const data = JSON.parse(decodeURIComponent(btn.dataset.reason || "%7B%7D"));
        if (data.type === "blocked") {
          openReasonInfoModal({
            title: "Blocked email",
            subtitle: data.email || "",
            dateLabel: "Blocked on",
            dateValue: formatNetworkDate(data.at),
            reason: data.reason,
          });
          return;
        }
        openPriorHistoryModal(data);
      } catch {
        showToast("Error", "Could not load reason details");
      }
    };
  });

  root.querySelectorAll(".btn-app-approve").forEach((btn) => {
    btn.onclick = () => {
      confirmAction({
        title: "Approve application",
        message: "Approve this partner application? A manufacturer account and magic link will be created.",
        confirmLabel: "Approve",
        onConfirm: async () => {
          await partnerFetch("admin-partner-application-approve", {
            method: "POST",
            body: { application_id: btn.dataset.id },
          });
          showToast("Application approved", "Magic link sent to applicant");
          await renderManufacturers();
        },
      });
    };
  });

  root.querySelectorAll(".btn-app-reject").forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.name || "this application";
      openActionModeModal({
        title: "Reject application",
        message: `Reject ${name}? The applicant will be notified by email.`,
        modes: [
          { value: "reject", label: "Just Reject", description: "Decline this application. They may apply again later." },
          { value: "reject_block", label: "Reject and Block", description: "Decline and block this email from future applications." },
        ],
        defaultMode: "reject",
        reasonPlaceholder: "Optional note for the applicant (included in email)…",
        confirmLabels: { reject: "Reject", reject_block: "Reject and Block" },
        confirmClasses: { reject_block: "btn-danger" },
        onConfirm: async ({ mode, reason }) => {
          await partnerFetch("admin-partner-application-reject", {
            method: "POST",
            body: {
              application_id: btn.dataset.id,
              mode,
              reason: reason || undefined,
            },
          });
          showToast("Application rejected", mode === "reject_block" ? "Email blocked" : "");
          await renderManufacturers();
        },
      });
    };
  });

  root.querySelectorAll(".btn-approve").forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.name || "this manufacturer";
      confirmAction({
        title: "Verify manufacturer",
        message: `Verify ${name}? They will be fully approved in the partner network.`,
        confirmLabel: "Verify",
        onConfirm: async () => {
          await partnerFetch("admin-manufacturer-approve", { method: "POST", body: { manufacturer_id: btn.dataset.id } });
          showToast("Verified", "Manufacturer fully approved");
          await renderManufacturers();
        },
      });
    };
  });

  root.querySelectorAll(".btn-suspend").forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.name || "this manufacturer";
      openActionModeModal({
        title: "Suspend manufacturer",
        message: `Suspend ${name}? They will lose partner portal access until reactivated.`,
        modes: [
          { value: "suspend", label: "Suspend", description: "Revoke portal access. They may apply again later." },
          { value: "suspend_block", label: "Suspend and Block", description: "Revoke access and block this email from new applications." },
        ],
        defaultMode: "suspend",
        reasonPlaceholder: "Optional note for the partner (included in email)…",
        confirmLabels: { suspend: "Suspend", suspend_block: "Suspend and Block" },
        confirmClasses: { suspend: "btn-warning", suspend_block: "btn-danger" },
        onConfirm: async ({ mode, reason }) => {
          await partnerFetch("admin-manufacturer-suspend", {
            method: "POST",
            body: {
              manufacturer_id: btn.dataset.id,
              mode,
              reason: reason || undefined,
            },
          });
          showToast("Suspended", mode === "suspend_block" ? "Partner suspended and email blocked" : "Partner access revoked");
          await renderManufacturers();
        },
      });
    };
  });

  root.querySelectorAll(".btn-reactivate").forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.name || "this manufacturer";
      confirmAction({
        title: "Reactivate manufacturer",
        message: `Reactivate ${name}? They will regain partner portal access.`,
        confirmLabel: "Reactivate",
        onConfirm: async () => {
          await partnerFetch("admin-manufacturer-reactivate", { method: "POST", body: { manufacturer_id: btn.dataset.id } });
          showToast("Reactivated", "Manufacturer access restored");
          await renderManufacturers();
        },
      });
    };
  });
}

function inviteManufacturerModal(el) {
  openModal({
    title: "Invite manufacturer",
    bodyHtml: `
      <div class="split-row">
        <div class="field"><label>Company name</label><input class="input" id="m-name" /></div>
        <div class="field"><label>Country</label><input class="input" id="m-country" /></div>
      </div>
      <div class="field"><label>Owner email</label><input class="input" id="m-email" type="email" /></div>`,
    onSave: async () => {
      await partnerFetch("admin-manufacturer-create", {
        method: "POST",
        body: {
          name: document.getElementById("m-name").value,
          owner_email: document.getElementById("m-email").value,
          country: document.getElementById("m-country").value,
        },
      });
      showToast("Manufacturer invited", "Magic link sent to owner email");
      await renderManufacturers();
    },
  });
}

async function renderCatalog() {
  setTopbarExtra("");
  const el = document.getElementById("view-catalog");
  const studioTab = getCatalogStudioTab();
  const { products: pendingProducts } = await partnerFetch("admin-manufacturer-product-list", {
    query: { status: "pending_review" },
  });
  const { blueprints: pendingBlueprints } = await partnerFetch("admin-blueprint-list", {
    query: { status: "pending_admin_review" },
  });
  const pendingCount = (pendingProducts || []).length;
  const blueprintCount = (pendingBlueprints || []).length;

  el.innerHTML = `
    ${stageHeading(
      "Catalog Studio",
      "Catalog Studio",
      "Manage partner catalogs, Eazpire shop products, and manufacturer review queues.",
      `<button type="button" class="btn btn-secondary" id="btn-catalog-mirror">Mirror to publish index</button>
       <button type="button" class="btn btn-primary" id="btn-catalog-refresh">Refresh</button>`
    )}
    <div class="catalog-toolbar" style="margin-bottom:16px">
      <div class="pill-tabs">
        ${CATALOG_STUDIO_TABS.map(
          (t) =>
            `<button type="button" class="pill-tab ${studioTab === t.key ? "active" : ""}" data-studio-tab="${t.key}">${t.label}${
              t.key === "review" ? ` (${pendingCount + blueprintCount})` : ""
            }</button>`
        ).join("")}
      </div>
    </div>
    <div id="admin-catalog-panel"></div>`;

  el.querySelectorAll("[data-studio-tab]").forEach((btn) => {
    btn.onclick = () => setCatalogStudioTab(btn.dataset.studioTab);
  });
  document.getElementById("btn-catalog-refresh").onclick = () => renderCatalog();
  document.getElementById("btn-catalog-mirror").onclick = async () => {
    const result = await partnerFetch("admin-eazpire-catalog-mirror-run", { method: "POST", body: {} });
    showToast("Mirror complete", `${result.mirrored ?? 0} product(s) synced to publish index`);
    await renderCatalog();
  };

  const panel = document.getElementById("admin-catalog-panel");
  if (studioTab === "partners") await renderPartnerCatalogPanel(panel);
  else if (studioTab === "eazpire") await renderEazpireProductsPanel(panel);
  else await renderCatalogReviewPanel(panel, pendingProducts || [], pendingBlueprints || []);
}

async function renderPartnerCatalogPanel(panel) {
  const { partners } = await partnerFetch("admin-partner-list");
  const printify = (partners || []).find((p) => p.slug === "printify") || partners?.[0];
  let providers = [];
  let blueprints = [];
  if (printify) {
    const provData = await partnerFetch("admin-partner-fulfillment-providers", {
      query: { manufacturer_id: printify.id },
    });
    providers = provData.providers || [];
    const bpData = await partnerFetch("admin-partner-catalog-blueprints", {
      query: { manufacturer_id: printify.id, status: "live" },
    });
    blueprints = bpData.blueprints || [];
  }

  panel.innerHTML = `
    <div class="split-row" style="align-items:flex-start;gap:16px">
      <div class="panel" style="flex:1">
        <div class="panel-header">
          <div><h2 class="panel-title">Partners</h2><p class="panel-subtitle">Fulfillment aggregators & manufacturers</p></div>
          <button type="button" class="btn btn-primary" id="btn-sync-printify">Sync Printify catalog</button>
        </div>
        <div class="panel-body">${renderTable(
          ["Partner", "Type", "Sub-providers", "Blueprints", "Eazpire products"],
          (partners || [])
            .map(
              (p) => `<tr>
            <td>${entityCell(p.name, p.slug)}</td>
            <td>${escapeHtml(p.integration_type)}</td>
            <td>${escapeHtml(p.fulfillment_provider_count ?? 0)}</td>
            <td>${escapeHtml(p.live_blueprint_count ?? 0)}</td>
            <td>${escapeHtml(p.eazpire_product_count ?? 0)}</td>
          </tr>`
            )
            .join("")
        )}</div>
      </div>
      <div class="panel" style="flex:1">
        <div class="panel-header"><div><h2 class="panel-title">${escapeHtml(printify?.name || "Partner")} — Sub-providers</h2></div></div>
        <div class="panel-body">${providers.length ? renderTable(
          ["Name", "External ID", "Status"],
          providers
            .map(
              (fp) => `<tr>
            <td>${escapeHtml(fp.name)}</td>
            <td>${escapeHtml(fp.external_provider_id)}</td>
            <td><span class="badge badge-success">${escapeHtml(fp.status)}</span></td>
          </tr>`
            )
            .join("")
        ) : `<div class="empty-state"><p>No sub-providers synced yet. Run Printify sync.</p></div>`}</div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <div class="panel-header"><div><h2 class="panel-title">Partner catalog (live blueprints)</h2><p class="panel-subtitle">${blueprints.length} blueprint(s)</p></div></div>
      <div class="panel-body">${blueprints.length ? renderTable(
        ["Title", "Category", "Quality", "Updated"],
        blueprints
          .slice(0, 50)
          .map(
            (b) => `<tr>
          <td>${escapeHtml(b.title)}</td>
          <td>${escapeHtml(b.normalized_category || "—")}</td>
          <td>${escapeHtml(b.quality_score ?? "—")}</td>
          <td>${escapeHtml(b.updated_at ? new Date(b.updated_at).toLocaleDateString() : "—")}</td>
        </tr>`
          )
          .join("")
      ) : `<div class="empty-state"><p>Run Printify sync to import blueprints for online products.</p></div>`}</div>
    </div>`;

  document.getElementById("btn-sync-printify").onclick = async () => {
    showToast("Syncing Printify…", "Online products only");
    const result = await partnerFetch("admin-partner-sync-printify", { method: "POST", body: {} });
    const s = result.sync?.synced || {};
    showToast("Printify sync complete", `${s.blueprints ?? 0} blueprint(s), ${result.import?.count ?? 0} product(s) imported`);
    await renderCatalog();
  };
}

async function renderEazpireProductsPanel(panel) {
  const { products } = await partnerFetch("admin-eazpire-product-list");
  let driftHtml = "";
  try {
    const drift = await partnerFetch("admin-eazpire-catalog-mirror-status");
    driftHtml = `<p class="panel-subtitle">${drift.in_sync ?? 0} / ${drift.total ?? 0} in sync with publish index</p>`;
  } catch {
    driftHtml = "";
  }

  panel.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div><h2 class="panel-title">Eazpire shop products</h2>${driftHtml}</div>
        <button type="button" class="btn btn-secondary" id="btn-import-catalog">Import from publish index</button>
      </div>
      <div class="panel-body">${(products || []).length ? renderTable(
        ["Product key", "Title", "Status", "Versions", ""],
        (products || [])
          .map(
            (p) => `<tr>
          <td><code>${escapeHtml(p.product_key)}</code></td>
          <td>${escapeHtml(p.title)}</td>
          <td><span class="badge ${p.catalog_status === "online" ? "badge-success" : "badge-secondary"}">${escapeHtml(p.catalog_status)}</span></td>
          <td>${escapeHtml(p.version_count ?? 0)}</td>
          <td><button type="button" class="btn btn-secondary btn-edit-eaz-product" data-key="${escapeHtml(p.product_key)}">Versions</button></td>
        </tr>`
          )
          .join("")
      ) : `<div class="empty-state"><h3>No Eazpire products yet</h3><p>Run Printify sync or import from publish index.</p></div>`}</div>
    </div>`;

  document.getElementById("btn-import-catalog").onclick = async () => {
    const result = await partnerFetch("admin-eazpire-catalog-import", { method: "POST", body: {} });
    showToast("Import complete", `${result.count ?? 0} online product(s)`);
    await renderCatalog();
  };

  panel.querySelectorAll(".btn-edit-eaz-product").forEach((btn) => {
    btn.onclick = () => openEazpireProductVersionsModal(btn.dataset.key);
  });
}

async function openEazpireProductVersionsModal(productKey) {
  const data = await partnerFetch("admin-eazpire-product-get", { query: { product_key: productKey } });
  const product = data.product;
  const versions = data.versions || [];

  openModal({
    title: `Product versions — ${product.title}`,
    bodyHtml: `
      <p><strong>Product key:</strong> <code>${escapeHtml(product.product_key)}</code></p>
      <p><strong>Status:</strong> ${escapeHtml(product.catalog_status)} · <strong>Regions:</strong> ${escapeHtml((product.regions || []).join(", ") || "—")}</p>
      <div class="field"><label>Catalog status</label>
        <select class="input" id="ep-catalog-status">
          <option value="offline" ${product.catalog_status === "offline" ? "selected" : ""}>Offline</option>
          <option value="preview" ${product.catalog_status === "preview" ? "selected" : ""}>Preview</option>
          <option value="online" ${product.catalog_status === "online" ? "selected" : ""}>Online</option>
        </select>
      </div>
      <div class="panel" style="margin-top:12px">
        <div class="panel-header"><h3 class="panel-title">Versions (${versions.length})</h3></div>
        <div class="panel-body">${versions.length ? renderTable(
          ["Display name", "Provider", "Auto-publish", ""],
          versions
            .map(
              (v) => `<tr>
            <td>${escapeHtml(v.display_name)}</td>
            <td>${escapeHtml(v.provider_name || v.external_provider_id || "—")}</td>
            <td>${v.auto_publish_config?.auto_publish_enabled ? "Yes" : "No"}</td>
            <td><button type="button" class="btn btn-secondary btn-edit-version" data-id="${escapeHtml(v.id)}">Edit</button></td>
          </tr>`
            )
            .join("")
        ) : `<p>No versions yet.</p>`}</div>
      </div>`,
    onSave: async () => {
      await partnerFetch("admin-eazpire-product-update", {
        method: "POST",
        body: {
          product_key: productKey,
          catalog_status: document.getElementById("ep-catalog-status").value,
        },
      });
      await partnerFetch("admin-eazpire-catalog-mirror-run", { method: "POST", body: { product_key: productKey } });
      showToast("Product saved", "Mirrored to publish index");
    },
  });

  panelModalVersions(productKey, versions);
}

function panelModalVersions(productKey, versions) {
  document.querySelectorAll(".btn-edit-version").forEach((btn) => {
    btn.onclick = async () => {
      const v = versions.find((x) => x.id === btn.dataset.id);
      if (!v) return;
      openModal({
        title: `Edit version — ${v.display_name}`,
        bodyHtml: `
          <div class="field"><label>Display name</label><input class="input" id="ver-display-name" value="${escapeHtml(v.display_name)}" /></div>
          <div class="field"><label><input type="checkbox" id="ver-auto-publish" ${v.auto_publish_config?.auto_publish_enabled ? "checked" : ""} /> Auto-publish enabled</label></div>
          <div class="field"><label><input type="checkbox" id="ver-publish-enabled" ${v.publish_enabled ? "checked" : ""} /> Publish enabled</label></div>`,
        onSave: async () => {
          await partnerFetch("admin-eazpire-product-version-update", {
            method: "POST",
            body: {
              id: v.id,
              display_name: document.getElementById("ver-display-name").value,
              auto_publish_config: {
                ...v.auto_publish_config,
                auto_publish_enabled: document.getElementById("ver-auto-publish").checked,
              },
              publish_enabled: document.getElementById("ver-publish-enabled").checked,
            },
          });
          await partnerFetch("admin-eazpire-catalog-mirror-run", { method: "POST", body: { product_key: productKey } });
          showToast("Version saved", "");
          openEazpireProductVersionsModal(productKey);
        },
      });
    };
  });
}

async function renderCatalogReviewPanel(panel, pendingProducts, pendingBlueprints) {
  const tab = getCatalogTab();
  panel.innerHTML = `
    <div class="catalog-toolbar">
      <div class="pill-tabs">
        <button type="button" class="pill-tab ${tab === "products" ? "active" : ""}" data-admin-tab="products">Product review (${pendingProducts.length})</button>
        <button type="button" class="pill-tab ${tab === "blueprints" ? "active" : ""}" data-admin-tab="blueprints">Blueprint review (${pendingBlueprints.length})</button>
      </div>
    </div>
    <div id="admin-catalog-review-inner"></div>`;
  panel.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.onclick = () => setCatalogTab(btn.dataset.adminTab);
  });
  const inner = document.getElementById("admin-catalog-review-inner");
  if (tab === "blueprints") await renderBlueprintReview(inner, pendingBlueprints);
  else await renderProductReview(inner, pendingProducts);
}

async function renderProductReview(panel, products) {
  if (!products?.length) {
    panel.innerHTML = `<div class="empty-state"><div class="icon">▦</div><h3>No products pending</h3><p>Manufacturer product submissions will appear here for review.</p></div>`;
    return;
  }

  panel.innerHTML = `<div class="card-grid catalog-grid">${products
    .map(
      (p) => `<article class="product-card">
      <div class="product-image">📦</div>
      <div class="product-card-content">
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.manufacturer_name || p.manufacturer_id)} · pending review</p>
        <div class="meta-row">
          <span class="badge ${badgeForStatus(p.status)}">${escapeHtml(p.status)}</span>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-primary btn-approve-product" data-id="${escapeHtml(p.id)}">Approve</button>
            <button type="button" class="btn btn-secondary btn-reject-product" data-id="${escapeHtml(p.id)}">Reject</button>
          </div>
        </div>
      </div>
    </article>`
    )
    .join("")}</div>`;

  panel.querySelectorAll(".btn-approve-product").forEach((btn) => {
    btn.onclick = () => {
      confirmAction({
        title: "Approve product",
        message: "Approve this product for the catalog?",
        confirmLabel: "Approve",
        onConfirm: async () => {
          await partnerFetch("admin-manufacturer-product-review", { method: "POST", body: { product_id: btn.dataset.id, approve: true } });
          showToast("Product approved", "");
          await renderCatalog();
        },
      });
    };
  });
  panel.querySelectorAll(".btn-reject-product").forEach((btn) => {
    btn.onclick = () => {
      confirmAction({
        title: "Reject product",
        message: "Reject this product? The manufacturer will need to revise and resubmit.",
        confirmLabel: "Reject",
        confirmClass: "btn-danger",
        onConfirm: async () => {
          await partnerFetch("admin-manufacturer-product-review", { method: "POST", body: { product_id: btn.dataset.id, approve: false } });
          showToast("Product rejected", "");
          await renderCatalog();
        },
      });
    };
  });
}

async function renderBlueprintReview(panel, blueprints) {
  if (!blueprints?.length) {
    panel.innerHTML = `<div class="empty-state"><div class="icon">◈</div><h3>No blueprints pending</h3><p>Universal Blueprint submissions will appear here for admin review.</p></div>`;
    return;
  }

  panel.innerHTML = `<div class="panel"><div class="panel-header"><div><h2 class="panel-title">Blueprint queue</h2><p class="panel-subtitle">Pending admin review</p></div></div>
    ${renderTable(
      ["Blueprint", "Manufacturer", "Category", "Quality", ""],
      blueprints
        .map(
          (b) => `<tr>
        <td>${entityCell(b.title, b.normalized_category || "")}</td>
        <td>${escapeHtml(b.manufacturer_name || b.manufacturer_id)}</td>
        <td>${escapeHtml(b.normalized_category || "—")}</td>
        <td>${escapeHtml(b.quality_score ?? "—")}</td>
        <td><button type="button" class="btn btn-secondary btn-review-bp" data-id="${escapeHtml(b.id)}">Review</button></td>
      </tr>`
        )
        .join("")
    )}</div>`;

  panel.querySelectorAll(".btn-review-bp").forEach((btn) => {
    btn.onclick = () => openBlueprintReviewModal(btn.dataset.id);
  });
}

async function openBlueprintReviewModal(blueprintId) {
  const data = await partnerFetch("admin-blueprint-review-get", { query: { blueprint_id: blueprintId } });
  const v = data.validation || {};
  const eaz = data.eazpire || {};
  openModal({
    title: `Blueprint review — ${eaz.title || blueprintId}`,
    bodyHtml: `
      <p><strong>Manufacturer:</strong> ${escapeHtml(eaz.manufacturer_name || eaz.manufacturer_id)}</p>
      <p><strong>Status:</strong> ${escapeHtml(eaz.status)} · Quality score ${escapeHtml(v.score ?? "—")}</p>
      <p><strong>Variants:</strong> ${escapeHtml((eaz.normalized?.variants || []).length)} ·
         <strong>Print areas:</strong> ${escapeHtml((eaz.normalized?.print_areas || []).length)}</p>
      ${v.errors?.length ? `<div class="panel" style="margin-top:12px"><div class="panel-body"><strong>Errors</strong><ul>${v.errors.map((e) => `<li>${escapeHtml(e.message || e.code)}</li>`).join("")}</ul></div></div>` : ""}
      ${v.warnings?.length ? `<div class="panel" style="margin-top:12px"><div class="panel-body"><strong>Warnings</strong><ul>${v.warnings.map((w) => `<li>${escapeHtml(w.message || w.code)}</li>`).join("")}</ul></div></div>` : ""}
      <div class="field" style="margin-top:12px"><label>Admin notes</label><textarea class="textarea" id="bp-admin-notes" rows="2">${escapeHtml(eaz.admin_notes || "")}</textarea></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary" id="btn-bp-rerun">Re-run conversion</button>
        <button type="button" class="btn btn-warning" id="btn-bp-changes">Request changes</button>
        <button type="button" class="btn btn-ghost" id="btn-bp-reject">Reject</button>
        <button type="button" class="btn btn-primary" id="btn-bp-approve">Approve & go live</button>
      </div>`,
    onSave: async () => {},
  });
  document.getElementById("modal-save").style.display = "none";

  const notes = () => document.getElementById("bp-admin-notes")?.value || "";
  const reopenReview = () => openBlueprintReviewModal(blueprintId);
  document.getElementById("btn-bp-rerun").onclick = () => {
    confirmAction({
      title: "Re-run conversion",
      message: "Re-run blueprint conversion?",
      confirmLabel: "Re-run",
      confirmClass: "btn-secondary",
      onCancel: reopenReview,
      onConfirm: async () => {
        await partnerFetch("admin-blueprint-rerun-conversion", { method: "POST", body: { blueprint_id: blueprintId } });
        showToast("Conversion re-run", "");
        openBlueprintReviewModal(blueprintId);
      },
    });
  };
  document.getElementById("btn-bp-approve").onclick = () => {
    confirmAction({
      title: "Approve blueprint",
      message: "Approve this blueprint and make it live?",
      confirmLabel: "Approve & go live",
      onCancel: reopenReview,
      onConfirm: async () => {
        await partnerFetch("admin-blueprint-approve", { method: "POST", body: { blueprint_id: blueprintId, notes: notes() } });
        showToast("Blueprint live", "Creators can use this blueprint");
        document.getElementById("modal-save").style.display = "";
        await renderCatalog();
      },
    });
  };
  document.getElementById("btn-bp-reject").onclick = () => {
    confirmAction({
      title: "Reject blueprint",
      message: "Reject this blueprint?",
      confirmLabel: "Reject",
      confirmClass: "btn-danger",
      onCancel: reopenReview,
      onConfirm: async () => {
        await partnerFetch("admin-blueprint-reject", { method: "POST", body: { blueprint_id: blueprintId, notes: notes() } });
        showToast("Blueprint rejected", "");
        document.getElementById("modal-save").style.display = "";
        await renderCatalog();
      },
    });
  };
  document.getElementById("btn-bp-changes").onclick = () => {
    confirmAction({
      title: "Request changes",
      message: "Request changes from the partner on this blueprint?",
      confirmLabel: "Request changes",
      confirmClass: "btn-warning",
      onCancel: reopenReview,
      onConfirm: async () => {
        await partnerFetch("admin-blueprint-request-changes", { method: "POST", body: { blueprint_id: blueprintId, notes: notes() } });
        showToast("Changes requested", "Partner notified via status");
        document.getElementById("modal-save").style.display = "";
        await renderCatalog();
      },
    });
  };
}

const KANBAN_COLS = [
  { key: "received", label: "Received", badge: "badge-neutral" },
  { key: "accepted", label: "Accepted", badge: "badge-info" },
  { key: "in_production", label: "In Production", badge: "badge-warning" },
  { key: "shipped", label: "Shipped", badge: "badge-success" },
];

async function renderOrders() {
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="btn-test-order">Create Test Order</button>`);
  const el = document.getElementById("view-orders");
  const { board } = await partnerFetch("admin-manufacturer-orders-board");

  el.innerHTML = `
    ${stageHeading(
      "Order Ops",
      "Order Operations",
      "Kanban command board for manufacturer order routing, production status, and fulfillment tracking.",
      `<button type="button" class="btn btn-primary" id="btn-test-order-heading">Create Test Order</button>`
    )}
    <div class="kanban-board">${KANBAN_COLS.map((col) => kanbanCol(col, board?.[col.key] || [])).join("")}</div>`;

  const openTestOrder = () => testOrderModal();
  document.getElementById("btn-test-order")?.addEventListener("click", openTestOrder);
  document.getElementById("btn-test-order-heading")?.addEventListener("click", openTestOrder);
}

function kanbanCol(col, orders) {
  return `<div class="kanban-col">
    <div class="kanban-head"><h3>${escapeHtml(col.label)}</h3><span class="badge ${col.badge}">${orders.length}</span></div>
    ${
      orders.length
        ? orders
            .map(
              (o) => `<div class="order-card"><h4>${escapeHtml(o.order_number || o.id)}</h4><p>${escapeHtml(o.manufacturer_name || "")} · ${escapeHtml(o.status)}</p><div class="order-meta"><span>${escapeHtml(o.status)}</span><span>${escapeHtml(o.manufacturer_name || "")}</span></div></div>`
            )
            .join("")
        : `<div class="empty-state"><div class="icon">↘</div><h3>Empty column</h3><p>Orders in this stage will appear here.</p></div>`
    }
  </div>`;
}

function testOrderModal() {
  openModal({
    title: "Create test order",
    bodyHtml: `
      <div class="field"><label>Manufacturer ID</label><input class="input" id="to-mfg" /></div>
      <div class="field"><label>Product ID</label><input class="input" id="to-product" /></div>
      <div class="field"><label>Variant ID (optional)</label><input class="input" id="to-variant" /></div>`,
    onSave: async () => {
      await partnerFetch("admin-test-order-create", {
        method: "POST",
        body: {
          manufacturer_id: document.getElementById("to-mfg").value,
          product_id: document.getElementById("to-product").value,
          variant_id: document.getElementById("to-variant").value || undefined,
        },
      });
      showToast("Test order created", "");
      await renderOrders();
    },
  });
}

async function renderApi() {
  setTopbarExtra(`<button type="button" class="btn btn-primary" disabled title="Coming in V2">Generate API Key</button>`);
  const el = document.getElementById("view-api");
  el.innerHTML = `
    ${stageHeading(
      "API Console",
      "API Developer Console",
      "Documentation-first developer experience for API partners: keys, webhooks, sandbox orders, and payload examples.",
      `<button type="button" class="btn btn-primary" disabled>Generate API Key</button>`
    )}
    <div class="api-layout">
      <aside class="panel">
        <div class="panel-header"><div><h2 class="panel-title">API Navigation</h2><p class="panel-subtitle">Docs sidebar component</p></div></div>
        <div class="panel-body doc-list">
          <div class="doc-item"><strong>Authentication</strong><span>API keys, signatures, scopes</span></div>
          <div class="doc-item"><strong>Catalog Sync</strong><span>Products, variants, print areas</span></div>
          <div class="doc-item"><strong>Order API</strong><span>Receive fulfillment orders</span></div>
          <div class="doc-item"><strong>Tracking Webhooks</strong><span>Production and shipment updates</span></div>
          <div class="doc-item"><strong>Artifact Ready</strong><span>QR payload and serial rules</span></div>
          <div class="doc-item"><strong>Sandbox</strong><span>Test orders and validation logs</span></div>
        </div>
      </aside>
      <section class="code-panel">
        <div class="code-tabs"><div class="code-tab">GET admin-manufacturer-list</div></div>
        <pre>GET ${location.origin}/partner?op=admin-manufacturer-list

// V1 read-only admin ops. Webhook logs and key management ship in V2.</pre>
      </section>
    </div>
    <div class="component-zone" style="margin-top:18px">
      <div class="panel">
        <div class="panel-header"><div><h2 class="panel-title">Webhook Logs</h2><p class="panel-subtitle">Recent integration events</p></div><span class="badge badge-neutral">V2</span></div>
        <div class="panel-body"><div class="empty-state"><div class="icon">{ }</div><h3>Coming in V2</h3><p>Webhook logs and API key management will appear here.</p></div></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><h2 class="panel-title">API Key Form</h2><p class="panel-subtitle">Form component style</p></div></div>
        <div class="panel-body">
          <div class="field"><label>Key name</label><input class="input" value="Production API Key" disabled /></div>
          <div class="field"><label>Scopes</label><select class="select" disabled><option>orders:read, orders:write, tracking:write</option></select></div>
          <button type="button" class="btn btn-primary" disabled>Save key settings</button>
        </div>
      </div>
    </div>`;
}

async function renderCertification() {
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="btn-cert-review" disabled>Run Review</button>`);
  const el = document.getElementById("view-certification");
  const { manufacturers } = await partnerFetch("admin-manufacturer-list", { query: { status: "verified" } });
  const list = manufacturers || [];
  const avgScore =
    list.length > 0
      ? (list.reduce((s, m) => s + Number(m.quality_score || 0), 0) / list.filter((m) => m.quality_score > 0).length || 0).toFixed(0)
      : "—";
  const ringPct = avgScore === "—" ? 0 : Math.min(100, Number(avgScore));

  el.innerHTML = `
    ${stageHeading(
      "Certification HQ",
      "Certification HQ",
      "Trust, safety and certification dashboard for Verified Manufacturer, Artifact Ready, and quality badges.",
      `<button type="button" class="btn btn-primary" disabled>Run Review</button>`
    )}
    <div class="cert-layout">
      <section>
        <div class="cert-hero">
          <h2>Certification creates trust before the first order.</h2>
          <p>Use a premium B2B certification system to protect marketplace quality, prevent fulfillment failures and highlight the best manufacturers in the Eazpire network.</p>
          <div class="cert-badges">
            <span class="cert-badge">Verified Manufacturer</span>
            <span class="cert-badge">Artifact Ready</span>
            <span class="cert-badge">Fast Fulfillment</span>
            <span class="cert-badge">Vegan Friendly</span>
            <span class="cert-badge">Premium Quality</span>
          </div>
        </div>
        <div class="panel" style="margin-top:18px">
          <div class="panel-header"><div><h2 class="panel-title">Certification Pipeline</h2><p class="panel-subtitle">Checklist and approval listview</p></div></div>
          ${renderTable(
            ["Manufacturer", "Quality", "Status", "Actions"],
            list
              .map(
                (m) => `<tr>
              <td>${entityCell(m.name, m.country || "")}</td>
              <td>${escapeHtml(m.quality_score ?? "—")}</td>
              <td><span class="badge badge-success">${escapeHtml(m.status)}</span></td>
              <td>
                <button type="button" class="btn btn-primary btn-cert-pass" data-id="${escapeHtml(m.id)}">Pass</button>
                <button type="button" class="btn btn-ghost btn-cert-fail" data-id="${escapeHtml(m.id)}">Fail</button>
              </td>
            </tr>`
              )
              .join("") || '<tr><td colspan="4" class="empty">No verified manufacturers</td></tr>'
          )}
        </div>
      </section>
      <aside class="panel">
        <div class="panel-header"><div><h2 class="panel-title">Network scorecard</h2><p class="panel-subtitle">Certification overview</p></div></div>
        <div class="panel-body">
          <div class="score-ring" style="background:conic-gradient(var(--success) 0 ${ringPct}%, #e2e8f0 ${ringPct}% 100%)"><strong>${escapeHtml(avgScore)}</strong></div>
          <div class="checklist">
            <div class="check-item"><strong>Verified manufacturers</strong><span class="badge badge-success">${list.length}</span></div>
            <div class="check-item"><strong>Avg quality score</strong><span class="badge badge-info">${escapeHtml(avgScore)}</span></div>
            <div class="check-item"><strong>Artifact readiness</strong><span class="badge badge-warning">Monitoring</span></div>
          </div>
        </div>
      </aside>
    </div>`;

  el.querySelectorAll(".btn-cert-pass").forEach((btn) => {
    btn.onclick = () => {
      confirmAction({
        title: "Certification passed",
        message: "Mark this manufacturer as certification passed?",
        confirmLabel: "Mark passed",
        onConfirm: async () => {
          await partnerFetch("admin-certification-review", {
            method: "POST",
            body: { manufacturer_id: btn.dataset.id, certification_key: "verified_manufacturer", approve: true },
          });
          showToast("Certification passed", "");
          await renderCertification();
        },
      });
    };
  });
  el.querySelectorAll(".btn-cert-fail").forEach((btn) => {
    btn.onclick = () => {
      confirmAction({
        title: "Certification failed",
        message: "Mark this manufacturer as certification failed?",
        confirmLabel: "Mark failed",
        confirmClass: "btn-danger",
        onConfirm: async () => {
          await partnerFetch("admin-certification-review", {
            method: "POST",
            body: { manufacturer_id: btn.dataset.id, certification_key: "verified_manufacturer", approve: false },
          });
          showToast("Certification failed", "");
          await renderCertification();
        },
      });
    };
  });
}

async function renderPartnerRequests() {
  sessionStorage.setItem("admin_network_tab", "pending");
  document.querySelector('[data-route="/partner/manufacturers"]')?.click();
}

const ROUTES = {
  "/partner": renderCommand,
  "/partner/manufacturers": renderManufacturers,
  "/partner/catalog": renderCatalog,
  "/partner/orders": renderOrders,
  "/partner/api": renderApi,
  "/partner/certification": renderCertification,
  "/partner/requests": renderPartnerRequests,
};

async function onRoute(route) {
  const path = route || "/partner";
  applyRouteTheme(path);
  const fn = ROUTES[path] || ROUTES["/partner"];
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
    initShell({
      navSections: [{ title: "Core Portal", items: NAV_CORE }],
      onRoute,
      brandSub: "Admin Ops",
      crumbLabels: CRUMB_LABELS,
    });
  } else {
    const authError = new URLSearchParams(location.search).get("auth_error") || "";
    showLogin(authError);
    if (authError) {
      history.replaceState({}, "", location.pathname);
    }
  }
})();
