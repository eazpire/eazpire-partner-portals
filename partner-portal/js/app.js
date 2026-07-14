import { partnerFetch, badgeForStatus, escapeHtml } from "/shared/js/partner-api.js";
import { initShell, openModal, closeModal, showToast, renderTable, setTopbarExtra } from "/shared/js/partner-shell.js";
import { openProductEditor } from "./product-editor/shell.js";

const PAGE_LABELS = {
  "/": "Overview",
  "/company": "Company",
  "/catalog": "Catalog",
  "/orders": "Orders",
  "/api": "API",
  "/certification": "Certification",
};

const NAV = [
  { route: "/", label: "Overview", icon: "⌘" },
  { route: "/company", label: "Company", icon: "🏭" },
  { route: "/catalog", label: "Catalog", icon: "▦" },
  { route: "/orders", label: "Orders", icon: "↗" },
  { route: "/api", label: "API", icon: "{ }" },
  { route: "/certification", label: "Certification", icon: "✓" },
];

let session = null;
let sessionMode = null;
let shellInitialized = false;

const LOGIN_POLL_TTL_MS = 15 * 60 * 1000;
const LOGIN_POLL_INTERVAL_MS = 2500;

const BLOCKED_EMAIL_MESSAGE = "This email address cannot be used for partner applications.";
const APPLICATION_REQUIRED_MESSAGE =
  "We don't have a partner application for this email yet. Please complete the Become a Partner form first — then you can sign in with a magic link.";

const loginWaitState = {
  pollToken: null,
  email: "",
  pollTimer: null,
  countdownTimer: null,
  expiresAt: 0,
  active: false,
};

function formatCountdown(msLeft) {
  const totalSec = Math.max(0, Math.ceil(msLeft / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function stopLoginWait() {
  loginWaitState.active = false;
  if (loginWaitState.pollTimer) {
    clearInterval(loginWaitState.pollTimer);
    loginWaitState.pollTimer = null;
  }
  if (loginWaitState.countdownTimer) {
    clearInterval(loginWaitState.countdownTimer);
    loginWaitState.countdownTimer = null;
  }
  loginWaitState.pollToken = null;
}

function showLoginFormPanel() {
  stopLoginWait();
  document.getElementById("login-panel").hidden = false;
  document.getElementById("login-waiting").hidden = true;
}

function showLoginWaitingPanel(email) {
  document.getElementById("login-panel").hidden = true;
  document.getElementById("login-waiting").hidden = false;
  document.getElementById("login-waiting-email").textContent = email;
  document.getElementById("login-message").textContent = "";
}

function updateLoginCountdown() {
  const el = document.getElementById("login-waiting-countdown");
  if (!el) return;
  const msLeft = loginWaitState.expiresAt - Date.now();
  el.textContent = formatCountdown(msLeft);
  if (msLeft <= 0) {
    stopLoginWait();
    showLoginFormPanel();
    document.getElementById("login-message").textContent =
      "The sign-in link has expired. Request a new link below.";
  }
}

async function pollLoginStatus() {
  if (!loginWaitState.active || !loginWaitState.pollToken) return;
  try {
    const data = await partnerFetch("partner-auth-poll", {
      query: { poll_token: loginWaitState.pollToken },
    });
    if (data.status === "verified" && data.exchange_token) {
      stopLoginWait();
      const exchanged = await partnerFetch("partner-auth-exchange", {
        method: "POST",
        body: { exchange_token: data.exchange_token },
      });
      const mode = exchanged.mode || data.mode;
      if (mode === "applicant") {
        const meMode = await ensureSession();
        if (meMode === "full") {
          await enterFullPortal("/");
          return;
        }
        showApplicantShell();
        await renderApplicationStatus();
        history.replaceState({}, "", "/application-status");
      } else {
        await enterFullPortal("/");
      }
      return;
    }
    if (data.status === "expired") {
      stopLoginWait();
      showLoginFormPanel();
      document.getElementById("login-message").textContent =
        "The sign-in link has expired. Request a new link below.";
    }
  } catch {
    /* keep polling until expiry */
  }
}

function startLoginWait(email, pollToken) {
  stopLoginWait();
  loginWaitState.email = email;
  loginWaitState.pollToken = pollToken;
  loginWaitState.expiresAt = Date.now() + LOGIN_POLL_TTL_MS;
  loginWaitState.active = Boolean(pollToken);
  showLoginWaitingPanel(email);
  updateLoginCountdown();
  if (!pollToken) return;
  loginWaitState.countdownTimer = setInterval(updateLoginCountdown, 1000);
  pollLoginStatus();
  loginWaitState.pollTimer = setInterval(pollLoginStatus, LOGIN_POLL_INTERVAL_MS);
}

async function ensureSession() {
  try {
    const me = await partnerFetch("partner-auth-me");
    session = me.session;
    sessionMode = session?.mode || (session?.manufacturer_id ? "full" : null);
    if (me.upgraded || sessionMode === "full") {
      sessionMode = "full";
      return "full";
    }
    return sessionMode;
  } catch {
    session = null;
    sessionMode = null;
    return null;
  }
}

async function enterFullPortal(route = "/") {
  sessionMode = "full";
  showShell();
  if (!shellInitialized) {
    initShell({ navItems: NAV, onRoute, brandSub: "Manufacturer Portal", crumbLabels: PAGE_LABELS });
    shellInitialized = true;
  }
  const onStatusPage =
    route.includes("application-status") || location.pathname.includes("application-status");
  const target = onStatusPage ? "/" : route || "/";
  if (location.pathname !== target) {
    history.replaceState({}, "", target);
  }
  await onRoute(target);
}

function showLogin(authErrorCode = "") {
  stopLoginWait();
  showLoginFormPanel();
  document.getElementById("app-login").hidden = false;
  document.getElementById("app-shell").hidden = true;
  document.getElementById("app-applicant").hidden = true;
  const msg = document.getElementById("login-message");
  if (msg && authErrorCode) {
    const messages = {
      invalid_or_expired_token:
        "This sign-in link is invalid or has expired. Request a new link below.",
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
  document.getElementById("app-applicant").hidden = true;
}

function showApplicantShell() {
  document.getElementById("app-login").hidden = true;
  document.getElementById("app-shell").hidden = true;
  document.getElementById("app-applicant").hidden = false;
}

async function renderApplicationStatus() {
  const mode = await ensureSession();
  if (mode === "full") {
    await enterFullPortal("/");
    return;
  }

  const data = await partnerFetch("partner-application-status");
  if (data.upgraded) {
    session = data.session;
    sessionMode = "full";
    await enterFullPortal("/");
    return;
  }

  const el = document.getElementById("view-applicant-status");
  const app = data.application || session?.application || {};
  const status = app.status || "pending_review";
  const statusLabel = {
    pending_email_verification: "Email verification pending",
    pending_review: "Under review",
    approved: "Approved",
    rejected: "Not approved",
  }[status] || status;

  el.innerHTML = `
    <div class="panel" style="max-width:640px">
      <div class="panel-header"><strong>Partner application</strong><span class="badge ${badgeForStatus(status)}">${escapeHtml(statusLabel)}</span></div>
      <div class="panel-body">
        <p><strong>${escapeHtml(app.company_name || "Your company")}</strong></p>
        <p class="stage-desc" style="margin-top:8px">Thank you for applying to become an Eazpire manufacturing partner.</p>
        ${
          status === "pending_review"
            ? `<p style="margin-top:16px">Your application is being reviewed by our team. You will receive an email when a decision is made. Once approved, you will be taken to the full partner portal automatically.</p>`
            : status === "pending_email_verification"
              ? `<p style="margin-top:16px">Please check your inbox for a verification link to continue. You can also request a magic link from the sign-in page to view this status.</p>`
              : status === "rejected"
                ? `<p style="margin-top:16px">Unfortunately we could not approve your application at this time.${app.rejection_reason ? ` Reason: ${escapeHtml(app.rejection_reason)}` : ""}</p>`
                : ""
        }
        <dl style="margin-top:20px;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:14px">
          <dt>Contact</dt><dd>${escapeHtml(app.contact_name || "—")}</dd>
          <dt>Email</dt><dd>${escapeHtml(app.email || session?.email || "—")}</dd>
          <dt>Country</dt><dd>${escapeHtml(app.country || "—")}</dd>
          ${app.website ? `<dt>Website</dt><dd>${escapeHtml(app.website)}</dd>` : ""}
          ${app.product_types ? `<dt>Capabilities</dt><dd>${escapeHtml(app.product_types)}</dd>` : ""}
        </dl>
      </div>
    </div>`;
}

async function renderOverview() {
  const el = document.getElementById("view-overview");
  setTopbarExtra("");
  const { dashboard } = await partnerFetch("manufacturer-dashboard");
  const kpis = dashboard?.kpis || {};
  const reviewNotices = dashboard?.product_review_notices || [];
  el.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Products", kpis.products_total ?? 0)}
      ${kpiCard("Pending review", kpis.products_pending ?? 0)}
      ${kpiCard("Open orders", kpis.orders_open ?? 0)}
      ${kpiCard("Certification", `${kpis.certification_pct ?? 0}%`)}
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-header"><strong>Action items</strong></div>
      <div class="panel-body">${(dashboard?.action_items || []).map(actionRow).join("") || '<div class="empty">No action items</div>'}</div>
    </div>
    ${
      reviewNotices.length
        ? `<div class="panel" style="margin-top:18px">
      <div class="panel-header"><strong>Product review notices</strong></div>
      <div class="panel-body">${reviewNotices
        .map(
          (n) => `<div class="order-card">
            <strong>${escapeHtml(n.title || "Product")}</strong>
            <p>${escapeHtml(n.review_note || "")}</p>
            <span class="badge ${badgeForStatus(n.status)}">${escapeHtml(n.status || "")}</span>
            ${n.eazpire_product_key ? `<p class="muted">Catalog key: ${escapeHtml(n.eazpire_product_key)}</p>` : ""}
          </div>`
        )
        .join("")}</div>
    </div>`
        : ""
    }`;
}

function kpiCard(label, value) {
  return `<div class="kpi-card"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div></div>`;
}

function actionRow(item) {
  return `<div class="order-card"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail || "")}</p><span class="badge ${badgeForStatus(item.status)}">${escapeHtml(item.status || "info")}</span></div>`;
}

async function renderCompany() {
  const el = document.getElementById("view-company");
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="btn-add-location">Add location</button>`);
  const [{ manufacturer, certification_progress }, { locations }] = await Promise.all([
    partnerFetch("manufacturer-get"),
    partnerFetch("manufacturer-location-list"),
  ]);
  document.getElementById("sidebar-progress").textContent = `Artifact Ready ${certification_progress?.pct ?? 0}%`;
  el.innerHTML = `
    <div class="panel" style="margin-bottom:18px">
      <div class="panel-header"><strong>Company profile</strong><button type="button" class="btn btn-secondary" id="btn-save-company">Save</button></div>
      <div class="panel-body split-row">
        ${field("name", "Display name", manufacturer?.name)}
        ${field("legal_name", "Legal name", manufacturer?.legal_name)}
        ${field("country", "Country", manufacturer?.country)}
        ${field("website", "Website", manufacturer?.website)}
        ${field("support_email", "Support email", manufacturer?.support_email)}
        ${field("business_email", "Business email", manufacturer?.business_email)}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><strong>Locations</strong></div>
      <div class="panel-body">${renderTable(
        ["Name", "Country", "Status"],
        (locations || []).map(
          (l) => `<tr><td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.country)}</td><td><span class="badge badge-neutral">${escapeHtml(l.status)}</span></td></tr>`
        ).join("") || '<tr><td colspan="3" class="empty">No locations yet</td></tr>'
      )}</div>
    </div>`;

  document.getElementById("btn-save-company").onclick = async () => {
    const body = {};
    el.querySelectorAll("[data-field]").forEach((input) => {
      body[input.dataset.field] = input.value;
    });
    await partnerFetch("manufacturer-update", { method: "POST", body });
    showToast("Saved", "Company profile updated");
  };

  const addLocBtn = document.getElementById("btn-add-location");
  if (addLocBtn) {
    addLocBtn.onclick = () => {
      openModal({
        title: "Add location",
        bodyHtml: `
        <div class="field"><label>Name</label><input class="input" id="loc-name" /></div>
        <div class="field"><label>Country</label><input class="input" id="loc-country" /></div>
        <div class="field"><label>City</label><input class="input" id="loc-city" /></div>`,
        onSave: async () => {
          await partnerFetch("manufacturer-location-create", {
            method: "POST",
            body: {
              name: document.getElementById("loc-name").value,
              country: document.getElementById("loc-country").value,
              city: document.getElementById("loc-city").value,
            },
          });
          showToast("Location added", "");
          await renderCompany();
        },
      });
    };
  }
}

function field(key, label, value) {
  return `<div class="field"><label>${escapeHtml(label)}</label><input class="input" data-field="${escapeHtml(key)}" value="${escapeHtml(value || "")}" /></div>`;
}

async function renderCatalog() {
  const el = document.getElementById("view-catalog");
  const tab = sessionStorage.getItem("catalog_tab") || "products";
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="btn-catalog-primary">${tab === "blueprints" ? "New blueprint" : "Add product"}</button>`);
  el.innerHTML = `
    <div class="catalog-toolbar" style="margin-bottom:14px">
      <div class="pill-tabs">
        <button type="button" class="pill-tab ${tab === "products" ? "active" : ""}" data-catalog-tab="products">Products</button>
        <button type="button" class="pill-tab ${tab === "blueprints" ? "active" : ""}" data-catalog-tab="blueprints">Blueprints</button>
      </div>
    </div>
    <div id="catalog-panel"></div>`;

  el.querySelectorAll("[data-catalog-tab]").forEach((btn) => {
    btn.onclick = () => {
      sessionStorage.setItem("catalog_tab", btn.dataset.catalogTab);
      renderCatalog();
    };
  });

  document.getElementById("btn-catalog-primary")?.addEventListener("click", () =>
    tab === "blueprints"
      ? openBlueprintWizard()
      : openProductEditor(null, { onClose: () => renderCatalog() })
  );

  const panel = document.getElementById("catalog-panel");
  if (tab === "blueprints") await renderBlueprintList(panel);
  else await renderProductList(panel);
}

async function renderProductList(panel) {
  const { products } = await partnerFetch("manufacturer-product-list");
  panel.innerHTML = `<div class="panel"><div class="panel-body">${renderTable(
    ["Product", "Category", "Status", ""],
    (products || []).map(
      (p) => `<tr>
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.normalized_category || p.category || "—")}</td>
        <td><span class="badge ${badgeForStatus(p.status)}">${escapeHtml(p.status)}</span></td>
        <td><button type="button" class="btn btn-secondary btn-product" data-id="${escapeHtml(p.id)}">Manage</button></td>
      </tr>`
    ).join("") || '<tr><td colspan="4" class="empty">No products yet</td></tr>'
  )}</div></div>`;
  panel.querySelectorAll(".btn-product").forEach((btn) => {
    btn.onclick = () => openProductEditor(btn.dataset.id, { onClose: () => renderCatalog() });
  });
}

async function renderBlueprintList(panel) {
  const { blueprints } = await partnerFetch("partner-blueprint-list");
  panel.innerHTML = `<div class="panel"><div class="panel-body">${renderTable(
    ["Blueprint", "Source", "Status", "Quality", ""],
    (blueprints || []).map(
      (b) => `<tr>
        <td>${escapeHtml(b.title)}</td>
        <td>${escapeHtml(b.source_type || "manual")}</td>
        <td><span class="badge ${badgeForStatus(b.eazpire_status || b.status)}">${escapeHtml(b.eazpire_status || b.status)}</span></td>
        <td>${escapeHtml(b.quality_score ?? "—")}</td>
        <td><button type="button" class="btn btn-secondary btn-blueprint" data-id="${escapeHtml(b.id)}">Edit</button></td>
      </tr>`
    ).join("") || '<tr><td colspan="5" class="empty">No blueprints yet — create your first Universal Blueprint.</td></tr>'
  )}</div></div>`;
  panel.querySelectorAll(".btn-blueprint").forEach((btn) => {
    btn.onclick = () => openBlueprintWizard(btn.dataset.id);
  });
}

async function openBlueprintWizard(providerBlueprintId) {
  let draft = {
    title: "",
    normalized_category: "apparel.tshirt",
    productId: null,
    variants: [{ variant_key: "black_m", color: "Black", size: "M", base_cost: 15, currency: "EUR" }],
    print_areas: [
      {
        area_key: "front",
        width_px: 4500,
        height_px: 5400,
        dpi: 300,
        safe_zone: { x: 300, y: 300, width: 3900, height: 4800 },
      },
    ],
  };
  let validation = null;

  if (providerBlueprintId) {
    const data = await partnerFetch("partner-blueprint-get", { query: { blueprint_id: providerBlueprintId } });
    const raw = data.provider?.raw || {};
    draft = {
      provider_blueprint_id: providerBlueprintId,
      title: data.provider?.title || raw.title || "",
      normalized_category: raw.normalized_category || data.eazpire?.normalized_category || "apparel.tshirt",
      external_product_id: raw.external_product_id || "",
      variants: raw.variants?.length ? raw.variants : draft.variants,
      print_areas: raw.print_areas?.length ? raw.print_areas : draft.print_areas,
    };
    try {
      const v = await partnerFetch("partner-blueprint-validate", { query: { blueprint_id: providerBlueprintId } });
      validation = v.validation;
    } catch {
      /* ignore */
    }
  }

  openModal({
    title: providerBlueprintId ? "Edit Universal Blueprint" : "New Universal Blueprint",
    bodyHtml: blueprintWizardHtml(draft, validation),
    onSave: async () => {
      const body = readBlueprintWizardForm(draft);
      const op = providerBlueprintId ? "partner-blueprint-update" : "partner-blueprint-create";
      await partnerFetch(op, { method: "POST", body });
      showToast("Blueprint saved", "Normalized and validated");
      await renderCatalog();
    },
  });

  document.getElementById("btn-bp-import-json")?.addEventListener("click", async () => {
    const text = document.getElementById("bp-json-import")?.value?.trim();
    if (!text) return;
    try {
      await partnerFetch("partner-blueprint-upload-json", { method: "POST", body: { json: JSON.parse(text) } });
      showToast("JSON imported", "Blueprint converted");
      closeModal();
      await renderCatalog();
    } catch (e) {
      showToast("Import failed", e.message || String(e));
    }
  });

  document.getElementById("btn-bp-validate")?.addEventListener("click", async () => {
    const body = readBlueprintWizardForm(draft);
    const saved = await partnerFetch(providerBlueprintId ? "partner-blueprint-update" : "partner-blueprint-create", {
      method: "POST",
      body,
    });
    const id = saved.provider?.id || providerBlueprintId;
    const v = await partnerFetch("partner-blueprint-validate", { query: { blueprint_id: id } });
    showToast(v.validation?.ok ? "Validation passed" : "Validation issues", `${v.validation?.errors?.length || 0} errors`);
    openBlueprintWizard(id);
  });

  document.getElementById("btn-bp-submit")?.addEventListener("click", async () => {
    const body = readBlueprintWizardForm(draft);
    const saved = await partnerFetch(providerBlueprintId ? "partner-blueprint-update" : "partner-blueprint-create", {
      method: "POST",
      body,
    });
    const id = saved.provider?.id || providerBlueprintId;
    try {
      await partnerFetch("partner-blueprint-submit-review", { method: "POST", body: { blueprint_id: id } });
      showToast("Submitted", "Blueprint sent for admin review");
      closeModal();
      await renderCatalog();
    } catch (e) {
      showToast("Submit blocked", (e.data?.errors || [e.message]).map((x) => x.message || x).join(", "));
    }
  });
}

function blueprintWizardHtml(draft, validation) {
  const pa = draft.print_areas?.[0] || {};
  const v0 = draft.variants?.[0] || {};
  const valBlock = validation
    ? `<div class="panel" style="margin-top:12px;background:var(--surface-2)">
        <div class="panel-body">
          <strong>Validation</strong> — Score ${validation.score ?? 0}
          ${validation.errors?.length ? `<ul>${validation.errors.map((e) => `<li>${escapeHtml(e.message || e.code)}</li>`).join("")}</ul>` : "<p>No hard errors</p>"}
        </div>
      </div>`
    : "";
  return `
    <p class="stage-desc">Universal Blueprint wizard (V1): identity, variants, print areas, shipping defaults.</p>
    <div class="field"><label>Product title</label><input class="input" id="bp-title" value="${escapeHtml(draft.title)}" required /></div>
    <div class="field"><label>Category</label>
      <select class="input" id="bp-category">
        <option value="apparel.tshirt" ${draft.normalized_category === "apparel.tshirt" ? "selected" : ""}>T-Shirt</option>
        <option value="apparel.hoodie" ${draft.normalized_category === "apparel.hoodie" ? "selected" : ""}>Hoodie</option>
        <option value="apparel.socks" ${draft.normalized_category === "apparel.socks" ? "selected" : ""}>Socks</option>
        <option value="wall_art.poster" ${draft.normalized_category === "wall_art.poster" ? "selected" : ""}>Poster</option>
        <option value="home.mug" ${draft.normalized_category === "home.mug" ? "selected" : ""}>Mug</option>
        <option value="accessory.cap" ${draft.normalized_category === "accessory.cap" ? "selected" : ""}>Cap</option>
      </select>
    </div>
    <div class="field"><label>External product ID</label><input class="input" id="bp-ext-id" value="${escapeHtml(draft.external_product_id || "")}" placeholder="Your SKU / product code" /></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0" />
    <p><strong>Variant (first)</strong></p>
    <div class="split-row">
      <div class="field"><label>Color</label><input class="input" id="bp-v-color" value="${escapeHtml(v0.color?.name || v0.color || "Black")}" /></div>
      <div class="field"><label>Size</label><input class="input" id="bp-v-size" value="${escapeHtml(v0.size?.label || v0.size || "M")}" /></div>
      <div class="field"><label>Base cost (EUR)</label><input class="input" id="bp-v-cost" type="number" step="0.01" value="${escapeHtml(v0.base_cost ?? 15)}" /></div>
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0" />
    <p><strong>Print area — front</strong></p>
    <div class="split-row">
      <div class="field"><label>Canvas width px</label><input class="input" id="bp-pa-w" type="number" value="${escapeHtml(pa.width_px || pa.canvas?.width_px || 4500)}" /></div>
      <div class="field"><label>Canvas height px</label><input class="input" id="bp-pa-h" type="number" value="${escapeHtml(pa.height_px || pa.canvas?.height_px || 5400)}" /></div>
      <div class="field"><label>DPI</label><input class="input" id="bp-pa-dpi" type="number" value="${escapeHtml(pa.dpi || pa.canvas?.dpi || 300)}" /></div>
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0" />
    <p><strong>Import JSON</strong></p>
    <textarea class="textarea" id="bp-json-import" rows="3" placeholder='Paste provider JSON…'></textarea>
    <button type="button" class="btn btn-secondary" id="btn-bp-import-json" style="margin-top:8px">Import JSON</button>
    ${valBlock}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-secondary" id="btn-bp-validate">Run validation</button>
      <button type="button" class="btn btn-warning" id="btn-bp-submit">Submit for review</button>
    </div>`;
}

function readBlueprintWizardForm(draft) {
  const w = Number(document.getElementById("bp-pa-w").value);
  const h = Number(document.getElementById("bp-pa-h").value);
  const dpi = Number(document.getElementById("bp-pa-dpi").value);
  return {
    provider_blueprint_id: draft.provider_blueprint_id,
    title: document.getElementById("bp-title").value,
    normalized_category: document.getElementById("bp-category").value,
    external_product_id: document.getElementById("bp-ext-id").value || undefined,
    variants: [
      {
        variant_key: `${document.getElementById("bp-v-color").value}_${document.getElementById("bp-v-size").value}`.toLowerCase().replace(/\s+/g, "_"),
        color: document.getElementById("bp-v-color").value,
        size: document.getElementById("bp-v-size").value,
        base_cost: Number(document.getElementById("bp-v-cost").value),
        currency: "EUR",
      },
    ],
    print_areas: [
      {
        area_key: "front",
        label: "Front Print",
        width_px: w,
        height_px: h,
        dpi,
        safe_zone: { x: Math.round(w * 0.07), y: Math.round(h * 0.07), width: Math.round(w * 0.86), height: Math.round(h * 0.86) },
      },
    ],
    shipping: [{ ship_from_country: "DE", ship_to_countries: ["DE", "AT", "CH"], base_shipping: 4.9, currency: "EUR" }],
  };
}
async function openProductModal(productId) {
  await openProductEditor(productId || null, { onClose: () => renderCatalog() });
}

async function renderOrders() {
  const el = document.getElementById("view-orders");
  setTopbarExtra("");
  const { orders } = await partnerFetch("manufacturer-order-list");
  el.innerHTML = `
    <div class="panel"><div class="panel-body">${renderTable(
      ["Order", "Status", "Tracking", "Actions"],
      (orders || []).map((o) => `<tr>
        <td>${escapeHtml(o.order_number || o.id)}</td>
        <td><span class="badge ${badgeForStatus(o.status)}">${escapeHtml(o.status)}</span></td>
        <td>${escapeHtml(o.tracking_number || "—")}</td>
        <td>${orderActions(o)}</td>
      </tr>`).join("") || '<tr><td colspan="4" class="empty">No orders yet</td></tr>'
    )}</div></div>`;
  bindOrderActions(el);
}

function orderActions(order) {
  const id = escapeHtml(order.id);
  if (order.status === "received") return `<button class="btn btn-secondary btn-accept" data-id="${id}">Accept</button>`;
  if (order.status === "in_production") {
    return `<button class="btn btn-secondary btn-print" data-id="${id}">Print file</button>
      <button class="btn btn-primary btn-track" data-id="${id}">Tracking</button>`;
  }
  return "—";
}

function bindOrderActions(root) {
  root.querySelectorAll(".btn-accept").forEach((btn) => {
    btn.onclick = async () => {
      await partnerFetch("manufacturer-order-accept", { method: "POST", body: { order_id: btn.dataset.id } });
      showToast("Order accepted", "");
      await renderOrders();
    };
  });
  root.querySelectorAll(".btn-print").forEach((btn) => {
    btn.onclick = async () => {
      const data = await partnerFetch("manufacturer-order-download-print-file", { query: { order_id: btn.dataset.id } });
      if (data.url) window.open(data.url, "_blank");
    };
  });
  root.querySelectorAll(".btn-track").forEach((btn) => {
    btn.onclick = () => {
      openModal({
        title: "Upload tracking",
        bodyHtml: `<div class="field"><label>Tracking number</label><input class="input" id="track-no" /></div>
          <div class="field"><label>Carrier</label><input class="input" id="track-carrier" value="DHL" /></div>`,
        onSave: async () => {
          await partnerFetch("manufacturer-order-tracking-update", {
            method: "POST",
            body: {
              order_id: btn.dataset.id,
              tracking_number: document.getElementById("track-no").value,
              carrier: document.getElementById("track-carrier").value,
            },
          });
          showToast("Tracking saved", "");
          await renderOrders();
        },
      });
    };
  });
}

function renderApiDocs() {
  setTopbarExtra("");
  document.getElementById("view-api").innerHTML = `
    <div class="code-panel"><pre>POST ${location.origin}?op=manufacturer-product-list
Cookie: partner_session=…</pre></div>`;
}

async function renderCertification() {
  const el = document.getElementById("view-certification");
  setTopbarExtra("");
  const { certifications } = await partnerFetch("manufacturer-certification-list");
  el.innerHTML = `
    <div class="cert-hero"><h2>Certification</h2><p>Complete checklist items to unlock Artifact Ready status.</p></div>
    <div class="panel"><div class="panel-body">${(certifications || []).map(
      (c) => `<div class="check-item order-card"><div><strong>${escapeHtml(c.title || c.certification_key)}</strong><p>${escapeHtml(c.description || "")}</p></div><span class="badge ${badgeForStatus(c.status)}">${escapeHtml(c.status)}</span></div>`
    ).join("") || '<div class="empty">No certification items yet</div>'}</div></div>
    <button type="button" class="btn btn-primary" id="btn-request-cert" style="margin-top:14px">Request review</button>`;
  document.getElementById("btn-request-cert")?.addEventListener("click", async () => {
    await partnerFetch("manufacturer-certification-request", { method: "POST", body: { certification_key: "verified_manufacturer" } });
    showToast("Review requested", "");
    await renderCertification();
  });
}

const ROUTE_RENDERERS = {
  "/": renderOverview,
  "/company": renderCompany,
  "/catalog": renderCatalog,
  "/orders": renderOrders,
  "/api": renderApiDocs,
  "/certification": renderCertification,
};

async function onRoute(route) {
  const fn = ROUTE_RENDERERS[route] || ROUTE_RENDERERS["/"];
  try {
    await fn();
  } catch (e) {
    if (e.status === 401) showLogin();
    else showToast("Error", e.message || String(e));
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const loginMessage = document.getElementById("login-message");
  loginMessage.textContent = "";
  loginMessage.classList.remove("login-message--apply-hint");
  if (submitBtn) submitBtn.disabled = true;
  try {
    const data = await partnerFetch("partner-auth-request", { method: "POST", body: { email } });
    if (data.poll_token) {
      startLoginWait(email, data.poll_token);
    } else {
      showLoginFormPanel();
      loginMessage.textContent =
        "If this email is registered or has a partner application on file, you will receive a sign-in link within a few minutes. Check spam or contact Eazpire if you were invited but receive nothing.";
    }
  } catch (err) {
    const code = err.message || err.data?.error;
    if (code === "application_required") {
      loginMessage.textContent = APPLICATION_REQUIRED_MESSAGE;
      loginMessage.classList.add("login-message--apply-hint");
      showLoginFormPanel();
      pulseBecomePartnerButton();
    } else {
      const blocked = code === "email_blocked";
      loginMessage.textContent = blocked
        ? BLOCKED_EMAIL_MESSAGE
        : err.message || "Could not send sign-in link. Please try again.";
      showLoginFormPanel();
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

function pulseBecomePartnerButton() {
  const btn = document.getElementById("btn-show-apply");
  if (!btn) return;
  btn.classList.remove("btn-attention-pulse");
  void btn.offsetWidth;
  btn.classList.add("btn-attention-pulse");
  btn.scrollIntoView({ behavior: "smooth", block: "nearest" });
  window.setTimeout(() => btn.classList.remove("btn-attention-pulse"), 1600);
}

document.getElementById("btn-login-waiting-cancel").addEventListener("click", () => {
  stopLoginWait();
  showLoginFormPanel();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await partnerFetch("partner-auth-logout", { method: "POST" });
  showLogin();
});

document.getElementById("btn-applicant-logout").addEventListener("click", async () => {
  await partnerFetch("partner-auth-logout", { method: "POST" });
  showLogin();
});

const APPLY_STEP_COUNT = 7;

const applyWizard = {
  step: 0,
  submitting: false,
};

function applyFieldValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function showApplyError(stepIndex, message) {
  const el = document.getElementById(`apply-error-${stepIndex}`);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function clearApplyErrors() {
  for (let i = 0; i < APPLY_STEP_COUNT; i++) showApplyError(i, "");
}

function validateApplyStep(stepIndex) {
  clearApplyErrors();
  if (stepIndex === 0) {
    if (!applyFieldValue("apply-company")) {
      showApplyError(0, "Please fill in your company name.");
      return false;
    }
  } else if (stepIndex === 1) {
    if (!applyFieldValue("apply-contact")) {
      showApplyError(1, "Please fill in a contact name.");
      return false;
    }
  } else if (stepIndex === 2) {
    const email = applyFieldValue("apply-email");
    if (!email) {
      showApplyError(2, "Please fill in your business email.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showApplyError(2, "Please enter a valid email address.");
      return false;
    }
  } else if (stepIndex === 3) {
    if (!applyFieldValue("apply-country")) {
      showApplyError(3, "Please fill in your country.");
      return false;
    }
  } else if (stepIndex === 4) {
    const website = applyFieldValue("apply-website");
    if (website && !/^https?:\/\/.+/i.test(website)) {
      showApplyError(4, "Please enter a valid URL starting with http:// or https://");
      return false;
    }
  }
  return true;
}

function renderApplyReview() {
  const summary = document.getElementById("apply-review-summary");
  if (!summary) return;
  const website = applyFieldValue("apply-website");
  const products = applyFieldValue("apply-products");
  summary.innerHTML = `
    <dt>Company</dt><dd>${escapeHtml(applyFieldValue("apply-company"))}</dd>
    <dt>Contact</dt><dd>${escapeHtml(applyFieldValue("apply-contact"))}</dd>
    <dt>Email</dt><dd>${escapeHtml(applyFieldValue("apply-email"))}</dd>
    <dt>Country</dt><dd>${escapeHtml(applyFieldValue("apply-country"))}</dd>
    <dt>Website</dt><dd>${escapeHtml(website || "—")}</dd>
    <dt>Capabilities</dt><dd>${escapeHtml(products || "—")}</dd>`;
}

function renderApplyStep() {
  const { step } = applyWizard;
  document.querySelectorAll(".apply-step").forEach((el) => {
    el.hidden = Number(el.dataset.step) !== step;
  });

  const pct = ((step + 1) / APPLY_STEP_COUNT) * 100;
  const fill = document.getElementById("apply-progress-fill");
  const label = document.getElementById("apply-progress-label");
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${step + 1} of ${APPLY_STEP_COUNT}`;

  const backBtn = document.getElementById("btn-apply-back");
  const nextBtn = document.getElementById("btn-apply-next");
  const submitBtn = document.getElementById("btn-apply-submit");
  const isReview = step === APPLY_STEP_COUNT - 1;

  if (backBtn) backBtn.hidden = step === 0;
  if (nextBtn) nextBtn.hidden = isReview;
  if (submitBtn) submitBtn.hidden = !isReview;

  if (isReview) renderApplyReview();

  const activeStep = document.querySelector(`.apply-step[data-step="${step}"]`);
  const focusInput = activeStep?.querySelector(".apply-input, .apply-textarea");
  if (focusInput && !applyWizard.submitting) {
    requestAnimationFrame(() => focusInput.focus());
  }
}

function resetApplyWizard() {
  applyWizard.step = 0;
  applyWizard.submitting = false;
  document.getElementById("apply-form")?.reset();
  clearApplyErrors();
  const submitBtn = document.getElementById("btn-apply-submit");
  if (submitBtn) submitBtn.disabled = false;
  document.getElementById("apply-form")?.removeAttribute("hidden");
  document.getElementById("apply-success")?.setAttribute("hidden", "");
  document.getElementById("apply-wizard-actions")?.removeAttribute("hidden");
  document.querySelector(".apply-wizard-top")?.removeAttribute("hidden");
  renderApplyStep();
}

function showApplyWizard() {
  stopLoginWait();
  document.getElementById("login-panel").hidden = true;
  document.getElementById("login-waiting").hidden = true;
  document.getElementById("apply-wizard").hidden = false;
  resetApplyWizard();
}

function hideApplyWizard() {
  document.getElementById("apply-wizard").hidden = true;
  showLoginFormPanel();
  resetApplyWizard();
}

function advanceApplyStep() {
  if (applyWizard.submitting) return;
  if (!validateApplyStep(applyWizard.step)) return;
  if (applyWizard.step < APPLY_STEP_COUNT - 1) {
    applyWizard.step += 1;
    renderApplyStep();
  }
}

function retreatApplyStep() {
  if (applyWizard.submitting) return;
  if (applyWizard.step > 0) {
    applyWizard.step -= 1;
    renderApplyStep();
  }
}

function showApplySuccess() {
  applyWizard.submitting = true;
  document.getElementById("apply-form")?.setAttribute("hidden", "");
  document.getElementById("apply-success")?.removeAttribute("hidden");
  document.getElementById("apply-wizard-actions")?.setAttribute("hidden", "");
  document.querySelector(".apply-wizard-top")?.setAttribute("hidden", "");
}

document.getElementById("btn-show-apply").addEventListener("click", showApplyWizard);

document.getElementById("btn-back-login").addEventListener("click", hideApplyWizard);

document.getElementById("btn-apply-back").addEventListener("click", retreatApplyStep);

document.getElementById("btn-apply-next").addEventListener("click", advanceApplyStep);

document.getElementById("apply-form").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const tag = e.target?.tagName?.toLowerCase();
  if (tag === "textarea") return;
  e.preventDefault();
  if (applyWizard.step < APPLY_STEP_COUNT - 1) advanceApplyStep();
});

document.getElementById("apply-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (applyWizard.submitting) return;
  if (!validateApplyStep(applyWizard.step)) return;

  const submitBtn = document.getElementById("btn-apply-submit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    await partnerFetch("partner-application-submit", {
      method: "POST",
      body: {
        company_name: applyFieldValue("apply-company"),
        contact_name: applyFieldValue("apply-contact"),
        email: applyFieldValue("apply-email"),
        country: applyFieldValue("apply-country"),
        website: applyFieldValue("apply-website") || undefined,
        product_types: applyFieldValue("apply-products") || undefined,
        message: applyFieldValue("apply-message-text") || undefined,
        capabilities: applyFieldValue("apply-products") || undefined,
      },
    });
    showApplySuccess();
  } catch (err) {
    const blocked = err.message === "email_blocked" || err.data?.error === "email_blocked";
    if (blocked) {
      applyWizard.step = 2;
      renderApplyStep();
      showApplyError(2, BLOCKED_EMAIL_MESSAGE);
    } else {
      showApplyError(APPLY_STEP_COUNT - 1, err.message || "Something went wrong. Please try again.");
    }
    if (submitBtn) submitBtn.disabled = false;
  }
});

(async function boot() {
  const mode = await ensureSession();
  if (mode === "full") {
    await enterFullPortal(location.pathname.includes("application-status") ? "/" : location.pathname || "/");
  } else if (mode === "applicant") {
    showApplicantShell();
    await renderApplicationStatus();
  } else {
    const authError = new URLSearchParams(location.search).get("auth_error") || "";
    showLogin(authError);
    if (authError) {
      history.replaceState({}, "", "/");
    }
    if (location.pathname === "/application-status") {
      history.replaceState({}, "", "/");
    }
  }
})();
