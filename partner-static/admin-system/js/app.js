import { partnerFetch, escapeHtml } from "/system/shared/js/partner-api.js";
import { initShell, showToast, setTopbarExtra } from "/system/shared/js/partner-shell.js";
import { initAdminAppDrawer } from "/system/shared/js/admin-app-drawer.js";

const NAV_CORE = [{ route: "/system/generator", label: "Generator", icon: "✦" }];

const CRUMB_LABELS = {
  "/system": "System",
  "/system/generator": "Generator",
};

let catalogCache = null;
let configsCache = {};
let selectedFeature = "design";

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

async function loadGeneratorData(force = false) {
  if (!force && catalogCache) return { catalog: catalogCache, configs: configsCache };
  const data = await partnerFetch("admin-system-generator-config-get");
  catalogCache = data.catalog;
  configsCache = data.configs || {};
  return { catalog: catalogCache, configs: configsCache };
}

function findModel(catalog, providerId, modelId) {
  return (catalog?.models?.[providerId] || []).find((m) => m.id === modelId) || null;
}

function findProvider(catalog, providerId) {
  return (catalog?.providers || []).find((p) => p.id === providerId) || null;
}

function currentFormState() {
  const provider = document.getElementById("gen-provider")?.value || "replicate";
  const model = document.getElementById("gen-model")?.value || "";
  const fallback = document.getElementById("gen-fallback")?.value || "";
  const settings = {};
  const quality = document.getElementById("gen-quality");
  const background = document.getElementById("gen-background");
  const size = document.getElementById("gen-size");
  const stream = document.getElementById("gen-stream");
  const partials = document.getElementById("gen-partials");
  if (quality) settings.quality = quality.value;
  if (background) settings.background = background.value;
  if (size) settings.size = size.value;
  if (stream) settings.stream = stream.checked;
  if (partials) settings.partial_images = Number(partials.value);
  return { feature: selectedFeature, provider, model, fallback_provider: fallback, settings };
}

function optionHtml(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderFieldSelect(id, label, values, current) {
  if (!values?.length) return "";
  return `<div class="field">
    <label for="${id}">${escapeHtml(label)}</label>
    <select class="input" id="${id}">${values.map((v) => optionHtml(v, v, v === current)).join("")}</select>
  </div>`;
}

function renderModelFields(model, settings) {
  const fields = model?.fields || {};
  const s = settings || {};
  let html = "";
  html += renderFieldSelect("gen-quality", "Quality", fields.quality, s.quality);
  html += renderFieldSelect("gen-background", "Background", fields.background, s.background);
  html += renderFieldSelect("gen-size", "Size", fields.size, s.size);
  if (fields.stream) {
    html += `<div class="field"><label><input type="checkbox" id="gen-stream"${s.stream === false ? "" : " checked"} /> Stream live previews</label></div>`;
  }
  if (fields.partial_images) {
    const min = fields.partial_images.min ?? 0;
    const max = fields.partial_images.max ?? 3;
    const val = Number.isFinite(Number(s.partial_images)) ? s.partial_images : Math.min(2, max);
    html += `<div class="field">
      <label for="gen-partials">Partial images (${min}–${max})</label>
      <input class="input" id="gen-partials" type="number" min="${min}" max="${max}" value="${escapeHtml(val)}" />
    </div>`;
  }
  return html || `<p class="muted">This model has no extra defaults.</p>`;
}

function liveNote(provider) {
  if (!provider) return "";
  const badgeCls = provider.live ? "badge badge-success" : "badge badge-warning";
  const status = provider.live ? "Live in shop generate" : "Saved only — not live yet";
  return `<div class="gen-live">
    <span class="${badgeCls}">${escapeHtml(status)}</span>
    <p class="muted" style="margin:8px 0 0">${escapeHtml(provider.note || "")}</p>
  </div>`;
}

function renderGeneratorForm(catalog, config) {
  const providers = catalog.providers || [];
  const providerId = config.provider || "replicate";
  const models = catalog.models?.[providerId] || [];
  const modelId = models.some((m) => m.id === config.model) ? config.model : models[0]?.id || "";
  const model = findModel(catalog, providerId, modelId);
  const provider = findProvider(catalog, providerId);

  return `
    <div class="form-grid">
      <div class="field">
        <label for="gen-provider">Provider</label>
        <select class="input" id="gen-provider">
          ${providers.map((p) => optionHtml(p.id, p.label, p.id === providerId)).join("")}
        </select>
      </div>
      <div class="field">
        <label for="gen-fallback">Fallback provider</label>
        <select class="input" id="gen-fallback">
          ${optionHtml("", "None", !config.fallback_provider)}
          ${providers
            .filter((p) => p.id !== providerId)
            .map((p) => optionHtml(p.id, p.label, p.id === config.fallback_provider))
            .join("")}
        </select>
      </div>
      <div class="field">
        <label for="gen-model">Model</label>
        <select class="input" id="gen-model">
          ${models.map((m) => optionHtml(m.id, m.label, m.id === modelId)).join("")}
        </select>
      </div>
    </div>
    ${liveNote(provider)}
    <div id="gen-fields">${renderModelFields(model, config.settings)}</div>`;
}

function bindGeneratorForm(catalog) {
  const refresh = () => {
    const state = currentFormState();
    const models = catalog.models?.[state.provider] || [];
    if (!models.some((m) => m.id === state.model)) state.model = models[0]?.id || "";
    const root = document.getElementById("gen-form");
    if (!root) return;
    root.innerHTML = renderGeneratorForm(catalog, state);
    bindGeneratorForm(catalog);
  };
  document.getElementById("gen-provider")?.addEventListener("change", refresh);
  document.getElementById("gen-model")?.addEventListener("change", refresh);
}

async function mountOverview() {
  setTopbarExtra("");
  const root = document.getElementById("view-overview");
  root.innerHTML = `
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">System</h2>
          <p class="panel-subtitle">Shop and platform settings</p>
        </div>
      </div>
      <div class="panel-body">
        <p class="muted" style="margin:0">More areas will follow. First page: Generator.</p>
      </div>
    </div>
    <div class="sys-grid">
      <a class="sys-card" href="/system/generator">
        <h2>Generator</h2>
        <p>Choose the AI provider, model, and defaults for Design generate. Hero and Character come later.</p>
      </a>
    </div>`;
}

async function mountGenerator() {
  const root = document.getElementById("view-generator");
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="gen-save">Save</button>
    <button type="button" class="btn btn-secondary" id="gen-refresh">Refresh</button>`);
  root.innerHTML = `<div class="panel"><div class="panel-body"><p class="muted">Loading Generator…</p></div></div>`;

  const load = async () => {
    root.innerHTML = `<div class="panel"><div class="panel-body"><p class="muted">Loading Generator…</p></div></div>`;
    try {
      const { catalog, configs } = await loadGeneratorData(true);
      if (!catalog.features.some((f) => f.id === selectedFeature && f.enabled)) {
        selectedFeature = catalog.features.find((f) => f.enabled)?.id || "design";
      }
      const config = configs[selectedFeature] || { feature: selectedFeature, provider: "replicate", settings: {} };

      root.innerHTML = `
        <div class="panel">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">Generator</h2>
              <p class="panel-subtitle">Provider, model, and defaults for AI generate</p>
            </div>
          </div>
          <div class="panel-body">
            <p class="muted" style="margin:0 0 16px">Pick a feature, then choose provider and model from the allowed list. Fields change with the model. Replicate settings apply to live shop generate. OpenAI and Workers AI can be saved, but they are not live yet.</p>
            <div class="feature-grid">
              ${(catalog.features || [])
                .map((f) => {
                  const pressed = f.id === selectedFeature;
                  const soonBadge = f.enabled ? "" : `<span class="badge badge-neutral" style="margin-top:8px">Coming soon</span>`;
                  return `<button type="button" class="feature-card" data-feature="${escapeHtml(f.id)}" ${
                    f.enabled ? "" : "disabled"
                  } aria-pressed="${pressed ? "true" : "false"}">
                    <div class="feature-card__label">${escapeHtml(f.label)}</div>
                    <div class="feature-card__meta">${f.enabled ? escapeHtml(f.description || "") : "Not available yet"}</div>
                    ${soonBadge}
                  </button>`;
                })
                .join("")}
            </div>
            <div id="gen-form">${renderGeneratorForm(catalog, config)}</div>
          </div>
        </div>`;

      bindGeneratorForm(catalog);
      root.querySelectorAll(".feature-card").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          selectedFeature = btn.getAttribute("data-feature") || "design";
          load();
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="panel"><div class="panel-body"><p class="muted">Failed: ${escapeHtml(e.message)}</p></div></div>`;
    }
  };

  await load();
  document.getElementById("gen-refresh")?.addEventListener("click", load);
  document.getElementById("gen-save")?.addEventListener("click", async () => {
    try {
      const body = currentFormState();
      const data = await partnerFetch("admin-system-generator-config-save", { method: "POST", body });
      configsCache[body.feature] = data.config;
      showToast("Saved", data.config?.live ? "Live Replicate settings updated." : "Saved. Not live in shop generate yet.");
      await load();
    } catch (err) {
      showToast("Error", err.message);
    }
  });
}

const ROUTES = {
  "/system": mountOverview,
  "/system/generator": mountGenerator,
};

async function onRoute(route) {
  const raw = String(route || "/system").replace(/\/$/, "") || "/system";
  const path = raw.startsWith("/system/generator") ? "/system/generator" : "/system";
  const fn = ROUTES[path] || ROUTES["/system"];
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
    initAdminAppDrawer({ currentAppId: "system", brandTitle: "Eazpire System" });
    initShell({
      navSections: [{ title: "System", items: NAV_CORE }],
      onRoute,
      brandSub: "Shop · Platform",
      crumbLabels: CRUMB_LABELS,
    });
  } else {
    const authError = new URLSearchParams(location.search).get("auth_error") || "";
    showLogin(authError);
    if (authError) history.replaceState({}, "", location.pathname);
  }
})();
