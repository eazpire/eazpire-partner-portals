import { partnerFetch, escapeHtml } from "/audience/shared/js/partner-api.js";
import { initShell, showToast, setTopbarExtra } from "/audience/shared/js/partner-shell.js";
import { initAdminAppDrawer } from "/audience/shared/js/admin-app-drawer.js";

const NAV_CORE = [
  { route: "/audience", label: "Overview", icon: "◎" },
  { route: "/audience/plan", label: "Plan", icon: "◆" },
  { route: "/audience/reality", label: "Reality", icon: "▣" },
  { route: "/audience/gaps", label: "Gaps", icon: "⇄" },
];

const CRUMB_LABELS = {
  "/audience": "Overview",
  "/audience/plan": "Plan",
  "/audience/reality": "Reality",
  "/audience/gaps": "Gaps",
};

let daysFilter = "30";
let planCache = null;

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

function daysSelectHtml(id = "days-filter") {
  return `<select class="input" id="${id}" style="width:auto">
    <option value="7"${daysFilter === "7" ? " selected" : ""}>7 days</option>
    <option value="30"${daysFilter === "30" ? " selected" : ""}>30 days</option>
    <option value="90"${daysFilter === "90" ? " selected" : ""}>90 days</option>
    <option value="all"${daysFilter === "all" ? " selected" : ""}>All time</option>
  </select>`;
}

function bindDaysFilter(id, reload) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("change", () => {
    daysFilter = el.value;
    reload();
  });
}

function tableRows(rows, cols) {
  if (!rows?.length) return `<tr><td colspan="${cols}" class="muted">No data.</td></tr>`;
  return rows.join("");
}

async function mountOverview() {
  const root = document.getElementById("view-overview");
  setTopbarExtra(`${daysSelectHtml("overview-days")}
    <button type="button" class="btn btn-secondary" id="overview-refresh">Refresh</button>`);
  root.innerHTML = `<div class="panel"><p class="muted">Loading overview…</p></div>`;

  const load = async () => {
    root.innerHTML = `<div class="panel"><p class="muted">Loading overview…</p></div>`;
    try {
      const data = await partnerFetch("audience-overview", { query: { days: daysFilter } });
      const s = data.search || {};
      const cov = data.profile_coverage || {};
      const plan = data.plan || {};
      const events = data.active_events || [];

      root.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__label">Searches</div><div class="kpi__value">${escapeHtml(s.total ?? "—")}</div></div>
          <div class="kpi"><div class="kpi__label">Sessions</div><div class="kpi__value">${escapeHtml(s.unique_sessions ?? "—")}</div></div>
          <div class="kpi"><div class="kpi__label">Active priors</div><div class="kpi__value">${escapeHtml(plan.priors ?? 0)}</div></div>
          <div class="kpi"><div class="kpi__label">Events (config)</div><div class="kpi__value">${escapeHtml(plan.events ?? 0)}</div></div>
          <div class="kpi"><div class="kpi__label">Profiles w/ gender</div><div class="kpi__value">${escapeHtml(cov.with_gender ?? "—")}<span class="muted" style="font-size:.85rem"> / ${escapeHtml(cov.profiles ?? "—")}</span></div></div>
          <div class="kpi"><div class="kpi__label">Profiles w/ birth date</div><div class="kpi__value">${escapeHtml(cov.with_birth_date ?? "—")}</div></div>
        </div>
        <div class="panel" style="margin-bottom:12px">
          <h2 style="margin:0 0 8px">Active events today</h2>
          ${
            events.length
              ? events.map((e) => `<span class="chip">${escapeHtml(e.name_en)} (${escapeHtml((e.lang_codes || []).join(",") || "any")} / ${(e.country_codes || []).join(",") || "any"})</span>`).join(" ")
              : `<p class="muted" style="margin:0">No events active in the current date window.</p>`
          }
        </div>
        <div class="panel" style="margin-bottom:12px">
          <h2 style="margin:0 0 8px">Top searches</h2>
          <div class="table-wrap"><table class="data"><thead><tr><th>Query</th><th>Count</th></tr></thead>
          <tbody>${tableRows(
            (s.top_queries || []).map(
              (r) => `<tr><td>${escapeHtml(r.query)}</td><td>${escapeHtml(r.count)}</td></tr>`
            ),
            2
          )}</tbody></table></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="panel">
            <h2 style="margin:0 0 8px">By country</h2>
            <div class="table-wrap"><table class="data"><thead><tr><th>Country</th><th>Count</th></tr></thead>
            <tbody>${tableRows(
              (s.by_country || []).map(
                (r) => `<tr><td>${escapeHtml(r.country)}</td><td>${escapeHtml(r.count)}</td></tr>`
              ),
              2
            )}</tbody></table></div>
          </div>
          <div class="panel">
            <h2 style="margin:0 0 8px">By shop language</h2>
            <div class="table-wrap"><table class="data"><thead><tr><th>Lang</th><th>Count</th></tr></thead>
            <tbody>${tableRows(
              (s.by_shop_language || []).map(
                (r) => `<tr><td>${escapeHtml(r.lang)}</td><td>${escapeHtml(r.count)}</td></tr>`
              ),
              2
            )}</tbody></table></div>
          </div>
        </div>`;
    } catch (e) {
      root.innerHTML = `<div class="panel"><p class="muted">Failed: ${escapeHtml(e.message)}</p></div>`;
    }
  };

  await load();
  bindDaysFilter("overview-days", load);
  document.getElementById("overview-refresh")?.addEventListener("click", load);
}

async function loadPlanData(force = false) {
  if (!force && planCache) return planCache;
  planCache = await partnerFetch("audience-plan-get");
  return planCache;
}

function interestOptions(interests, selectedId) {
  return (interests || [])
    .map(
      (i) =>
        `<option value="${escapeHtml(i.id)}"${Number(i.id) === Number(selectedId) ? " selected" : ""}>${escapeHtml(i.name_en)} (${escapeHtml(i.category_key || "")})</option>`
    )
    .join("");
}

async function mountPlan() {
  const root = document.getElementById("view-plan");
  setTopbarExtra(`<button type="button" class="btn btn-primary" id="plan-add-prior">Add prior</button>
    <button type="button" class="btn btn-secondary" id="plan-add-event">Add event</button>
    <button type="button" class="btn btn-secondary" id="plan-refresh">Refresh</button>`);
  root.innerHTML = `<div class="panel"><p class="muted">Loading plan…</p></div>`;

  const load = async () => {
    root.innerHTML = `<div class="panel"><p class="muted">Loading plan…</p></div>`;
    try {
      const data = await loadPlanData(true);
      const priors = data.priors || [];
      const events = data.events || [];
      const interests = data.interests || [];

      root.innerHTML = `
        <div class="panel" style="margin-bottom:12px">
          <h2 style="margin:0 0 8px">Segment theme priors</h2>
          <p class="muted" style="margin:0 0 12px">Soft-boost design themes only. Empty fields = any. Gender/age apply only when the shopper profile has those values.</p>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Lang</th><th>Country</th><th>Gender</th><th>Age</th><th>Intent</th><th>Theme</th><th>Weight</th><th>Active</th><th></th></tr></thead>
            <tbody>${tableRows(
              priors.map(
                (p) => `<tr data-prior-id="${escapeHtml(p.id)}">
                  <td>${escapeHtml(p.lang || "*")}</td>
                  <td>${escapeHtml(p.country || "*")}</td>
                  <td>${escapeHtml(p.gender || "*")}</td>
                  <td>${escapeHtml(p.age_band || "*")}</td>
                  <td>${escapeHtml(p.product_intent || "*")}</td>
                  <td>${escapeHtml(p.interest_name || p.interest_id)}</td>
                  <td>${escapeHtml(p.weight)}</td>
                  <td>${p.active ? "yes" : "no"}</td>
                  <td>
                    <button type="button" class="btn btn-secondary btn-edit-prior" data-id="${escapeHtml(p.id)}">Edit</button>
                    <button type="button" class="btn btn-secondary btn-del-prior" data-id="${escapeHtml(p.id)}">Delete</button>
                  </td>
                </tr>`
              ),
              9
            )}</tbody>
          </table></div>
        </div>
        <div class="panel">
          <h2 style="margin:0 0 8px">Events calendar</h2>
          <p class="muted" style="margin:0 0 12px">Language = culture (e.g. Arabic holidays). Country = local (e.g. CH). Link interest IDs for theme boost during the window.</p>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Key</th><th>Name</th><th>Langs</th><th>Countries</th><th>Window</th><th>Now</th><th>Weight</th><th>Interests</th><th></th></tr></thead>
            <tbody>${tableRows(
              events.map(
                (e) => `<tr>
                  <td>${escapeHtml(e.key)}</td>
                  <td>${escapeHtml(e.name_en)}</td>
                  <td>${escapeHtml((e.lang_codes || []).join(", ") || "*")}</td>
                  <td>${escapeHtml((e.country_codes || []).join(", ") || "*")}</td>
                  <td>${escapeHtml(e.start_md || "—")} → ${escapeHtml(e.end_md || "—")}</td>
                  <td>${e.is_active_now ? '<span class="gap-match">active</span>' : "—"}</td>
                  <td>${escapeHtml(e.weight)}</td>
                  <td>${escapeHtml((e.interest_ids || []).join(", ") || "—")}</td>
                  <td>
                    <button type="button" class="btn btn-secondary btn-edit-event" data-id="${escapeHtml(e.id)}">Edit</button>
                    <button type="button" class="btn btn-secondary btn-del-event" data-id="${escapeHtml(e.id)}">Delete</button>
                  </td>
                </tr>`
              ),
              9
            )}</tbody>
          </table></div>
        </div>`;

      const openPriorModal = (prior = null) => {
        const backdrop = document.getElementById("modal-backdrop");
        document.getElementById("modal-title").textContent = prior ? "Edit prior" : "Add prior";
        document.getElementById("modal-body").innerHTML = `
          <div class="field"><label>Language (e.g. ar)</label><input class="input" id="m-lang" value="${escapeHtml(prior?.lang || "")}" /></div>
          <div class="field"><label>Country (e.g. CH)</label><input class="input" id="m-country" value="${escapeHtml(prior?.country || "")}" /></div>
          <div class="field"><label>Gender</label>
            <select class="input" id="m-gender"><option value="">any</option>
              <option value="female"${prior?.gender === "female" ? " selected" : ""}>female</option>
              <option value="male"${prior?.gender === "male" ? " selected" : ""}>male</option>
            </select></div>
          <div class="field"><label>Age band</label>
            <select class="input" id="m-age"><option value="">any</option>
              ${["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
                .map((a) => `<option value="${a}"${prior?.age_band === a ? " selected" : ""}>${a}</option>`)
                .join("")}
            </select></div>
          <div class="field"><label>Product intent</label>
            <select class="input" id="m-intent"><option value="">any</option>
              <option value="men"${prior?.product_intent === "men" ? " selected" : ""}>men</option>
              <option value="women"${prior?.product_intent === "women" ? " selected" : ""}>women</option>
              <option value="unisex"${prior?.product_intent === "unisex" ? " selected" : ""}>unisex</option>
            </select></div>
          <div class="field"><label>Theme interest</label><select class="input" id="m-interest">${interestOptions(interests, prior?.interest_id)}</select></div>
          <div class="field"><label>Weight</label><input class="input" id="m-weight" type="number" min="1" max="100" value="${escapeHtml(prior?.weight ?? 1)}" /></div>
          <div class="field"><label><input type="checkbox" id="m-active"${prior?.active === 0 ? "" : " checked"} /> Active</label></div>`;
        backdrop.hidden = false;
        backdrop.classList.add("show");
        const saveBtn = document.getElementById("modal-save");
        const onSave = async () => {
          try {
            await partnerFetch("audience-plan-save", {
              method: "POST",
              body: {
                id: prior?.id || undefined,
                lang: document.getElementById("m-lang").value,
                country: document.getElementById("m-country").value,
                gender: document.getElementById("m-gender").value,
                age_band: document.getElementById("m-age").value,
                product_intent: document.getElementById("m-intent").value,
                interest_id: Number(document.getElementById("m-interest").value),
                weight: Number(document.getElementById("m-weight").value) || 1,
                active: document.getElementById("m-active").checked ? 1 : 0,
              },
            });
            showToast("Saved", "Prior updated");
            closeModal();
            await load();
          } catch (err) {
            showToast("Error", err.message);
          }
        };
        saveBtn.onclick = onSave;
      };

      const openEventModal = (ev = null) => {
        const backdrop = document.getElementById("modal-backdrop");
        document.getElementById("modal-title").textContent = ev ? "Edit event" : "Add event";
        document.getElementById("modal-body").innerHTML = `
          <div class="field"><label>Key</label><input class="input" id="m-key" value="${escapeHtml(ev?.key || "")}" ${ev ? "readonly" : ""} /></div>
          <div class="field"><label>Name (EN)</label><input class="input" id="m-name" value="${escapeHtml(ev?.name_en || "")}" /></div>
          <div class="field"><label>Lang codes (comma)</label><input class="input" id="m-langs" value="${escapeHtml((ev?.lang_codes || []).join(", "))}" placeholder="ar" /></div>
          <div class="field"><label>Country codes (comma)</label><input class="input" id="m-countries" value="${escapeHtml((ev?.country_codes || []).join(", "))}" placeholder="CH" /></div>
          <div class="field"><label>Start MM-DD</label><input class="input" id="m-start" value="${escapeHtml(ev?.start_md || "")}" placeholder="02-28" /></div>
          <div class="field"><label>End MM-DD</label><input class="input" id="m-end" value="${escapeHtml(ev?.end_md || "")}" placeholder="04-10" /></div>
          <div class="field"><label>Interest IDs (comma)</label><input class="input" id="m-iids" value="${escapeHtml((ev?.interest_ids || []).join(", "))}" /></div>
          <div class="field"><label>Weight</label><input class="input" id="m-ew" type="number" min="1" max="100" value="${escapeHtml(ev?.weight ?? 5)}" /></div>
          <div class="field"><label><input type="checkbox" id="m-eactive"${ev?.active === 0 ? "" : " checked"} /> Active</label></div>`;
        backdrop.hidden = false;
        backdrop.classList.add("show");
        document.getElementById("modal-save").onclick = async () => {
          try {
            const langs = document
              .getElementById("m-langs")
              .value.split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            const countries = document
              .getElementById("m-countries")
              .value.split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            const interest_ids = document
              .getElementById("m-iids")
              .value.split(",")
              .map((x) => Number(x.trim()))
              .filter((n) => Number.isFinite(n) && n > 0);
            await partnerFetch("audience-events-save", {
              method: "POST",
              body: {
                id: ev?.id || undefined,
                key: document.getElementById("m-key").value,
                name_en: document.getElementById("m-name").value,
                lang_codes: langs,
                country_codes: countries,
                start_md: document.getElementById("m-start").value,
                end_md: document.getElementById("m-end").value,
                interest_ids,
                weight: Number(document.getElementById("m-ew").value) || 1,
                active: document.getElementById("m-eactive").checked ? 1 : 0,
              },
            });
            showToast("Saved", "Event updated");
            closeModal();
            await load();
          } catch (err) {
            showToast("Error", err.message);
          }
        };
      };

      document.getElementById("plan-add-prior")?.addEventListener("click", () => openPriorModal());
      document.getElementById("plan-add-event")?.addEventListener("click", () => openEventModal());
      root.querySelectorAll(".btn-edit-prior").forEach((btn) => {
        btn.addEventListener("click", () => {
          const p = priors.find((x) => String(x.id) === btn.getAttribute("data-id"));
          openPriorModal(p);
        });
      });
      root.querySelectorAll(".btn-del-prior").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this prior?")) return;
          try {
            await partnerFetch("audience-plan-save", {
              method: "POST",
              body: { action: "delete", id: Number(btn.getAttribute("data-id")) },
            });
            showToast("Deleted", "Prior removed");
            await load();
          } catch (err) {
            showToast("Error", err.message);
          }
        });
      });
      root.querySelectorAll(".btn-edit-event").forEach((btn) => {
        btn.addEventListener("click", () => {
          const e = events.find((x) => String(x.id) === btn.getAttribute("data-id"));
          openEventModal(e);
        });
      });
      root.querySelectorAll(".btn-del-event").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this event?")) return;
          try {
            await partnerFetch("audience-events-save", {
              method: "POST",
              body: { action: "delete", id: Number(btn.getAttribute("data-id")) },
            });
            showToast("Deleted", "Event removed");
            await load();
          } catch (err) {
            showToast("Error", err.message);
          }
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="panel"><p class="muted">Failed: ${escapeHtml(e.message)}</p></div>`;
    }
  };

  await load();
  document.getElementById("plan-refresh")?.addEventListener("click", load);
}

function closeModal() {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.hidden = true;
  backdrop.classList.remove("show");
  document.getElementById("modal-save").onclick = null;
}

async function mountReality() {
  const root = document.getElementById("view-reality");
  setTopbarExtra(`${daysSelectHtml("reality-days")}
    <input class="input" id="reality-lang" placeholder="Lang (ar)" style="width:90px" />
    <input class="input" id="reality-country" placeholder="Country (CH)" style="width:110px" />
    <button type="button" class="btn btn-secondary" id="reality-refresh">Refresh</button>`);
  root.innerHTML = `<div class="panel"><p class="muted">Loading reality…</p></div>`;

  const load = async () => {
    root.innerHTML = `<div class="panel"><p class="muted">Loading reality…</p></div>`;
    try {
      const data = await partnerFetch("audience-reality", {
        query: {
          days: daysFilter,
          shop_language: document.getElementById("reality-lang")?.value || "",
          country: document.getElementById("reality-country")?.value || "",
        },
      });
      const intent = data.product_intent_volume || {};
      root.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__label">Men-intent volume</div><div class="kpi__value">${escapeHtml(intent.men ?? 0)}</div></div>
          <div class="kpi"><div class="kpi__label">Women-intent volume</div><div class="kpi__value">${escapeHtml(intent.women ?? 0)}</div></div>
          <div class="kpi"><div class="kpi__label">Other</div><div class="kpi__value">${escapeHtml(intent.other ?? 0)}</div></div>
        </div>
        <div class="panel" style="margin-bottom:12px">
          <h2 style="margin:0 0 8px">Top queries</h2>
          <div class="table-wrap"><table class="data"><thead><tr><th>Query</th><th>Count</th><th>Intent</th></tr></thead>
          <tbody>${tableRows(
            (data.top_queries || []).map(
              (r) =>
                `<tr><td>${escapeHtml(r.query)}</td><td>${escapeHtml(r.count)}</td><td>${escapeHtml(r.product_intent || "—")}</td></tr>`
            ),
            3
          )}</tbody></table></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="panel">
            <h2 style="margin:0 0 8px">Lang × country</h2>
            <div class="table-wrap"><table class="data"><thead><tr><th>Lang</th><th>Country</th><th>Count</th></tr></thead>
            <tbody>${tableRows(
              (data.by_lang_country || []).map(
                (r) =>
                  `<tr><td>${escapeHtml(r.lang)}</td><td>${escapeHtml(r.country)}</td><td>${escapeHtml(r.count)}</td></tr>`
              ),
              3
            )}</tbody></table></div>
          </div>
          <div class="panel">
            <h2 style="margin:0 0 8px">Browser ≠ shop language</h2>
            <div class="table-wrap"><table class="data"><thead><tr><th>Browser</th><th>Shop</th><th>Country</th><th>Count</th></tr></thead>
            <tbody>${tableRows(
              (data.browser_shop_lang_mismatch || []).map(
                (r) =>
                  `<tr><td>${escapeHtml(r.browser_lang)}</td><td>${escapeHtml(r.shop_lang)}</td><td>${escapeHtml(r.country || "—")}</td><td>${escapeHtml(r.count)}</td></tr>`
              ),
              4
            )}</tbody></table></div>
          </div>
        </div>`;
    } catch (e) {
      root.innerHTML = `<div class="panel"><p class="muted">Failed: ${escapeHtml(e.message)}</p></div>`;
    }
  };

  await load();
  bindDaysFilter("reality-days", load);
  document.getElementById("reality-refresh")?.addEventListener("click", load);
}

async function mountGaps() {
  const root = document.getElementById("view-gaps");
  setTopbarExtra(`${daysSelectHtml("gaps-days")}
    <button type="button" class="btn btn-secondary" id="gaps-refresh">Refresh</button>`);
  root.innerHTML = `<div class="panel"><p class="muted">Loading gaps…</p></div>`;

  const load = async () => {
    root.innerHTML = `<div class="panel"><p class="muted">Loading gaps…</p></div>`;
    try {
      const data = await partnerFetch("audience-gap", { query: { days: daysFilter } });
      const gaps = data.gaps || [];
      root.innerHTML = `
        <div class="panel">
          <h2 style="margin:0 0 8px">Plan vs reality</h2>
          <p class="muted" style="margin:0 0 12px"><span class="gap-match">match</span> · <span class="gap-weak">weak</span> · <span class="gap-mismatch">mismatch / unplanned demand</span></p>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Segment</th><th>Planned themes</th><th>Reality top queries</th><th>Status</th></tr></thead>
            <tbody>${tableRows(
              gaps.map((g) => {
                const seg = [g.lang || "*", g.country || "*", g.gender || "*", g.age_band || "*", g.product_intent || "*"].join(" / ");
                const planned = (g.planned_themes || []).map((t) => escapeHtml(t.name || t.interest_id)).join(", ") || "—";
                const reality =
                  (g.reality_top_queries || []).map((q) => `${escapeHtml(q.query)} (${escapeHtml(q.count)})`).join(", ") ||
                  (g.unplanned_volume != null ? `volume ${escapeHtml(g.unplanned_volume)} (no plan)` : "—");
                const stClass =
                  g.status === "match" ? "gap-match" : g.status === "mismatch" ? "gap-mismatch" : "gap-weak";
                return `<tr>
                  <td>${escapeHtml(seg)}</td>
                  <td>${planned}</td>
                  <td>${reality}</td>
                  <td class="${stClass}">${escapeHtml(g.status)}</td>
                </tr>`;
              }),
              4
            )}</tbody>
          </table></div>
        </div>`;
    } catch (e) {
      root.innerHTML = `<div class="panel"><p class="muted">Failed: ${escapeHtml(e.message)}</p></div>`;
    }
  };

  await load();
  bindDaysFilter("gaps-days", load);
  document.getElementById("gaps-refresh")?.addEventListener("click", load);
}

const ROUTES = {
  "/audience": mountOverview,
  "/audience/plan": mountPlan,
  "/audience/reality": mountReality,
  "/audience/gaps": mountGaps,
};

async function onRoute(route) {
  const raw = String(route || "/audience").replace(/\/$/, "") || "/audience";
  let path = "/audience";
  if (raw.startsWith("/audience/plan")) path = "/audience/plan";
  else if (raw.startsWith("/audience/reality")) path = "/audience/reality";
  else if (raw.startsWith("/audience/gaps")) path = "/audience/gaps";
  else path = "/audience";
  const fn = ROUTES[path] || ROUTES["/audience"];
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

document.getElementById("modal-close")?.addEventListener("click", closeModal);
document.getElementById("modal-cancel")?.addEventListener("click", closeModal);

(async function boot() {
  if (await ensureAdminSession()) {
    showShell();
    initAdminAppDrawer({ currentAppId: "audience", brandTitle: "Eazpire Audience" });
    initShell({
      navSections: [{ title: "Audience", items: NAV_CORE }],
      onRoute,
      brandSub: "Plan · Reality · Gaps",
      crumbLabels: CRUMB_LABELS,
    });
  } else {
    const authError = new URLSearchParams(location.search).get("auth_error") || "";
    showLogin(authError);
    if (authError) history.replaceState({}, "", location.pathname);
  }
})();
