import { partnerFetch } from "/creations/shared/js/partner-api.js";
import { initShell, showToast, setTopbarExtra } from "/creations/shared/js/partner-shell.js";
import { initAdminAppDrawer } from "/creations/shared/js/admin-app-drawer.js";
import { mountDesignsPage } from "./designs.js";
import { mountProductsPage } from "./products.js";

const NAV_CORE = [
  { route: "/creations/designs", label: "Designs", icon: "◆" },
  { route: "/creations/products", label: "Products", icon: "▣" },
];

const CRUMB_LABELS = {
  "/creations": "Designs",
  "/creations/designs": "Designs",
  "/creations/products": "Products",
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

const ROUTES = {
  "/creations": async () => {
    history.replaceState({}, "", "/creations/designs");
    await ROUTES["/creations/designs"]();
  },
  "/creations/designs": async () => {
    setTopbarExtra("");
    await mountDesignsPage();
  },
  "/creations/products": async () => {
    setTopbarExtra("");
    await mountProductsPage();
  },
};

async function onRoute(route) {
  const path = route === "/creations" ? "/creations/designs" : route || "/creations/designs";
  const fn = ROUTES[path] || ROUTES["/creations/designs"];
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
    initAdminAppDrawer({ currentAppId: "creations", brandTitle: "Eazpire Creations" });
    initShell({
      navSections: [{ title: "Creations Portal", items: NAV_CORE }],
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
