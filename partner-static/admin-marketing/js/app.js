import { partnerFetch, escapeHtml } from "/marketing/shared/js/partner-api.js";
import { initShell, showToast, setTopbarExtra, navigate } from "/marketing/shared/js/partner-shell.js";
import { initAdminAppDrawer } from "/marketing/shared/js/admin-app-drawer.js";
import { t } from "/marketing/js/i18n.js";

const NAV_CORE = [
  { route: "/marketing", label: t("admin.marketing.nav.hub"), icon: "◎" },
  { route: "/marketing/amazon-ads", label: t("admin.marketing.nav.amazon"), icon: "▲" },
  { route: "/marketing/social", label: t("admin.marketing.nav.social"), icon: "◈" },
  { route: "/marketing/internal", label: t("admin.marketing.nav.internal"), icon: "✦" },
];

const CRUMB_LABELS = {
  "/marketing": t("admin.marketing.nav.hub"),
  "/marketing/amazon-ads": t("admin.marketing.nav.amazon"),
  "/marketing/social": t("admin.marketing.nav.social"),
  "/marketing/internal": t("admin.marketing.nav.internal"),
};

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
      invalid_or_expired_token: t("admin.marketing.login_invalid"),
      token_already_used: t("admin.marketing.login_used"),
      token_required: t("admin.marketing.login_missing"),
    };
    msg.textContent = messages[authErrorCode] || t("admin.marketing.login_failed");
  }
}

function showShell() {
  document.getElementById("app-login").hidden = true;
  document.getElementById("app-shell").hidden = false;
  const loading = document.getElementById("app-loading");
  if (loading) loading.hidden = true;
}

function applyStaticCopy() {
  document.getElementById("btn-logout").textContent = t("admin.marketing.sign_out");
  document.getElementById("login-title").textContent = t("admin.marketing.sign_in_title");
  document.getElementById("login-body").textContent = t("admin.marketing.sign_in_body");
  document.querySelector("label[for='login-email']").textContent = t("admin.marketing.email");
  document.getElementById("login-submit").textContent = t("admin.marketing.send_link");
  document.getElementById("login-hint").textContent = t("admin.marketing.first_link_hint");
  const loadingTitle = document.querySelector("#app-loading h1");
  const loadingBody = document.querySelector("#app-loading p");
  if (loadingTitle) loadingTitle.textContent = t("admin.marketing.title");
  if (loadingBody) loadingBody.textContent = t("admin.marketing.checking_session");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
}

function stateClass(state) {
  const s = String(state || "").toUpperCase();
  if (s === "ENABLED") return "state-enabled";
  if (s === "PAUSED") return "state-paused";
  return "state-archived";
}

async function mountHub() {
  const root = document.getElementById("view-hub");
  setTopbarExtra("");
  root.innerHTML = `
    <p class="muted" style="margin:0 0 16px">${escapeHtml(t("admin.marketing.hub.lead"))}</p>
    <div class="mkt-grid">
      <a class="mkt-card" href="/marketing/amazon-ads">
        <h2>${escapeHtml(t("admin.marketing.hub.amazon_title"))}</h2>
        <p>${escapeHtml(t("admin.marketing.hub.amazon_body"))}</p>
        <div class="mkt-card__meta">${escapeHtml(t("admin.marketing.hub.amazon_meta"))}</div>
      </a>
      <div class="mkt-card" aria-disabled="true">
        <h2>${escapeHtml(t("admin.marketing.hub.social_title"))}</h2>
        <p>${escapeHtml(t("admin.marketing.hub.social_body"))}</p>
        <div class="mkt-card__meta">${escapeHtml(t("admin.marketing.hub.social_meta"))}</div>
      </div>
      <div class="mkt-card" aria-disabled="true">
        <h2>${escapeHtml(t("admin.marketing.hub.internal_title"))}</h2>
        <p>${escapeHtml(t("admin.marketing.hub.internal_body"))}</p>
        <div class="mkt-card__meta">${escapeHtml(t("admin.marketing.hub.internal_meta"))}</div>
      </div>
    </div>`;
  root.querySelector("a.mkt-card")?.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/marketing/amazon-ads", onRoute);
  });
}

function placeholderView(root, bodyKey) {
  setTopbarExtra("");
  root.innerHTML = `
    <div class="panel">
      <h2 style="margin:0 0 8px">${escapeHtml(t("admin.marketing.placeholder.title"))}</h2>
      <p class="muted" style="margin:0">${escapeHtml(t(bodyKey))}</p>
    </div>`;
}

function campaignRows(campaigns, maxBudget) {
  if (!campaigns?.length) {
    return `<tr><td colspan="5" class="muted">${escapeHtml(t("admin.marketing.amazon.empty"))}</td></tr>`;
  }
  return campaigns
    .map((c) => {
      const id = escapeHtml(c.campaignId);
      const budget = c.dailyBudget == null ? "" : String(c.dailyBudget);
      const canPause = String(c.state).toUpperCase() === "ENABLED";
      const canEnable = String(c.state).toUpperCase() === "PAUSED";
      return `<tr data-campaign-id="${id}">
        <td>${escapeHtml(c.name || c.campaignId)}</td>
        <td class="${stateClass(c.state)}">${escapeHtml(c.state || "—")}</td>
        <td>
          <div class="budget-row">
            <input class="input budget-input" type="number" min="1" max="${escapeHtml(maxBudget)}" step="0.01" value="${escapeHtml(budget)}" />
            <button type="button" class="btn btn-secondary btn-save-budget" data-id="${id}">${escapeHtml(t("admin.marketing.amazon.save_budget"))}</button>
          </div>
        </td>
        <td>${escapeHtml(c.targetingType || "—")}</td>
        <td>
          ${
            canPause
              ? `<button type="button" class="btn btn-secondary btn-pause" data-id="${id}">${escapeHtml(t("admin.marketing.amazon.pause"))}</button>`
              : ""
          }
          ${
            canEnable
              ? `<button type="button" class="btn btn-primary btn-enable" data-id="${id}">${escapeHtml(t("admin.marketing.amazon.enable"))}</button>`
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");
}

async function mountAmazon() {
  const root = document.getElementById("view-amazon");
  setTopbarExtra(
    `<button type="button" class="btn btn-secondary" id="amazon-refresh">${escapeHtml(t("admin.marketing.amazon.refresh"))}</button>`
  );

  const load = async () => {
    root.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(t("admin.marketing.amazon.loading"))}</p></div>`;
    try {
      const data = await partnerFetch("admin-marketing-amazon-ads-campaigns");
      const campaigns = data.campaigns || [];
      const maxBudget = data.max_daily_budget ?? 50;
      root.innerHTML = `
        <p class="muted" style="margin:0 0 12px">${escapeHtml(t("admin.marketing.amazon.lead"))}</p>
        <div class="mkt-kpis">
          <div class="mkt-kpi"><strong>${escapeHtml(t("admin.marketing.amazon.profile"))}</strong> DE Seller ${escapeHtml(data.seller_profile_id || data.profileId || "")}</div>
          <div class="mkt-kpi"><strong>${escapeHtml(t("admin.marketing.nav.amazon"))}</strong> ${escapeHtml(data.campaign_count ?? campaigns.length)}</div>
          <div class="mkt-kpi"><strong>${escapeHtml(t("admin.marketing.amazon.safety_cap"))}</strong> ${escapeHtml(maxBudget)}</div>
        </div>
        <p class="muted" style="margin:0 0 12px">${escapeHtml(data.metrics_note || t("admin.marketing.amazon.metrics_note"))}</p>
        <div class="panel">
          <div class="table-wrap"><table class="data">
            <thead><tr>
              <th>${escapeHtml(t("admin.marketing.amazon.col.name"))}</th>
              <th>${escapeHtml(t("admin.marketing.amazon.col.state"))}</th>
              <th>${escapeHtml(t("admin.marketing.amazon.col.budget"))}</th>
              <th>${escapeHtml(t("admin.marketing.amazon.col.type"))}</th>
              <th>${escapeHtml(t("admin.marketing.amazon.col.actions"))}</th>
            </tr></thead>
            <tbody>${campaignRows(campaigns, maxBudget)}</tbody>
          </table></div>
        </div>`;

      root.querySelectorAll(".btn-pause").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!window.confirm(t("admin.marketing.amazon.confirm_pause"))) return;
          try {
            await partnerFetch("admin-marketing-amazon-ads-campaign-state", {
              method: "POST",
              body: { campaignId: btn.getAttribute("data-id"), state: "PAUSED" },
            });
            showToast(t("admin.marketing.saved"), t("admin.marketing.amazon.paused"));
            await load();
          } catch (err) {
            showToast(t("admin.marketing.error"), err.message);
          }
        });
      });
      root.querySelectorAll(".btn-enable").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!window.confirm(t("admin.marketing.amazon.confirm_enable"))) return;
          try {
            await partnerFetch("admin-marketing-amazon-ads-campaign-state", {
              method: "POST",
              body: { campaignId: btn.getAttribute("data-id"), state: "ENABLED" },
            });
            showToast(t("admin.marketing.saved"), t("admin.marketing.amazon.enabled"));
            await load();
          } catch (err) {
            showToast(t("admin.marketing.error"), err.message);
          }
        });
      });
      root.querySelectorAll(".btn-save-budget").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = btn.closest("tr");
          const input = row?.querySelector(".budget-input");
          if (!window.confirm(t("admin.marketing.amazon.confirm_budget"))) return;
          try {
            await partnerFetch("admin-marketing-amazon-ads-campaign-budget", {
              method: "POST",
              body: {
                campaignId: btn.getAttribute("data-id"),
                dailyBudget: Number(input?.value),
              },
            });
            showToast(t("admin.marketing.saved"), t("admin.marketing.amazon.budget_saved"));
            await load();
          } catch (err) {
            showToast(t("admin.marketing.error"), err.message);
          }
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(t("admin.marketing.failed"))}: ${escapeHtml(e.message)}</p></div>`;
    }
  };

  await load();
  document.getElementById("amazon-refresh")?.addEventListener("click", load);
}

const ROUTES = {
  "/marketing": mountHub,
  "/marketing/amazon-ads": mountAmazon,
  "/marketing/social": () => placeholderView(document.getElementById("view-social"), "admin.marketing.placeholder.social"),
  "/marketing/internal": () =>
    placeholderView(document.getElementById("view-internal"), "admin.marketing.placeholder.internal"),
};

async function onRoute(route) {
  const raw = String(route || "/marketing").replace(/\/$/, "") || "/marketing";
  let path = "/marketing";
  if (raw.startsWith("/marketing/amazon-ads")) path = "/marketing/amazon-ads";
  else if (raw.startsWith("/marketing/social")) path = "/marketing/social";
  else if (raw.startsWith("/marketing/internal")) path = "/marketing/internal";
  const fn = ROUTES[path] || ROUTES["/marketing"];
  try {
    await fn();
  } catch (e) {
    if (e.status === 401 || e.status === 403) showLogin();
    else showToast(t("admin.marketing.error"), e.message || String(e));
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  await partnerFetch("admin-auth-request", { method: "POST", body: { email } });
  document.getElementById("login-message").textContent = t("admin.marketing.login_sent");
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await partnerFetch("admin-auth-logout", { method: "POST" });
  showLogin();
});

(async function boot() {
  applyStaticCopy();
  if (await ensureAdminSession()) {
    showShell();
    initAdminAppDrawer({ currentAppId: "marketing", brandTitle: t("admin.marketing.title") });
    initShell({
      navSections: [{ title: t("admin.marketing.title"), items: NAV_CORE }],
      onRoute,
      brandSub: t("admin.marketing.brand_sub"),
      crumbLabels: CRUMB_LABELS,
    });
  } else {
    const authError = new URLSearchParams(location.search).get("auth_error") || "";
    showLogin(authError);
    if (authError) history.replaceState({}, "", location.pathname);
  }
})();
