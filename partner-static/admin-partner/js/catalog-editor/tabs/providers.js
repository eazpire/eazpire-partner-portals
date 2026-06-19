import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchProvidersBundle, saveProviders, createVersion, deleteVersion, saveVersionConfig } from "../api.js";
import { renderVersionConfigPanel, collectVersionConfigPanel } from "../version-config-panel.js";

export async function loadProvidersTab(ctx) {
  const data = await fetchProvidersBundle(ctx.productKey);
  ctx.providersData = data;
  return renderProvidersTab(ctx, data);
}

function renderProvidersTab(ctx, data) {
  const activeIds = new Set((data.active_providers || []).map((r) => Number(r.print_provider_id)));
  const providerRows = (data.merged_providers || data.providers || [])
    .map((fp) => {
      const pid = Number(fp.print_provider_id || fp.external_provider_id);
      const checked = activeIds.has(pid) ? "checked" : "";
      const region = fp.region || fp.dbPlan?.region_codes_json || "Other";
      const location = fp.locationLabel || fp.dbPlan?.provider_location || "";
      return `<label class="ce-check-row">
        <input type="checkbox" class="ce-provider-active" data-pid="${pid}" ${checked} />
        <span><strong>${escapeHtml(fp.name || fp.title || `Provider ${pid}`)}</strong> · ID ${escapeHtml(
          String(pid)
        )} · ${escapeHtml(String(region))} ${location ? `· ${escapeHtml(location)}` : ""}</span>
      </label>`;
    })
    .join("");

  const plans = (data.publish_plans || [])
    .map((plan) => {
      let countries = [];
      try {
        countries = JSON.parse(plan.country_codes_json || "[]");
      } catch {
        countries = [];
      }
      let regions = [];
      try {
        regions = JSON.parse(plan.region_codes_json || "[]");
      } catch {
        regions = [];
      }
      return `<tr>
        <td>${escapeHtml(plan.provider_name || plan.profile?.title || "Provider")}</td>
        <td>${escapeHtml(regions.join(", ") || "—")}</td>
        <td>${escapeHtml(countries.join(", ") || "—")}</td>
        <td>${escapeHtml(String(plan.priority ?? 100))}</td>
        <td>${Number(plan.is_enabled ?? 1) === 1 ? "Yes" : "No"}</td>
      </tr>`;
    })
    .join("");

  const versionRows = (data.versions || [])
    .map(
      (v) => `<tr>
        <td>${escapeHtml(v.display_name)}</td>
        <td>${escapeHtml(v.provider_name || v.external_provider_id || "—")}</td>
        <td>${v.publish_enabled ? "Yes" : "No"}</td>
        <td><button type="button" class="btn btn-secondary btn-sm ce-version-edit" data-id="${escapeHtml(v.id)}">Config</button>
        <button type="button" class="btn btn-secondary btn-sm ce-version-delete" data-id="${escapeHtml(v.id)}">Delete</button></td>
      </tr>`
    )
    .join("");

  return `
    <div class="ce-tab-panel">
      <h3 class="ce-section-title">Active print providers</h3>
      <div class="ce-check-list">${providerRows || "<p>No fulfillment providers synced.</p>"}</div>
      <h3 class="ce-section-title">Publish plans</h3>
      <table class="data-table ce-table"><thead><tr><th>Provider</th><th>Regions</th><th>Countries</th><th>Priority</th><th>Enabled</th></tr></thead>
        <tbody>${plans || '<tr><td colspan="5">No publish plans.</td></tr>'}</tbody></table>
      <h3 class="ce-section-title">Product versions</h3>
      <div class="ce-inline-actions">
        <input class="input" id="ce-new-version-name" placeholder="New version name" />
        <input class="input" id="ce-new-version-pid" placeholder="Print provider ID" />
        <button type="button" class="btn btn-secondary" id="ce-btn-add-version">Add version</button>
      </div>
      <table class="data-table ce-table"><thead><tr><th>Name</th><th>Provider</th><th>Publish</th><th></th></tr></thead>
        <tbody>${versionRows || "<tr><td colspan=\"4\">No versions yet.</td></tr>"}</tbody></table>
      <div id="ce-version-modal" class="ce-inline-modal" hidden></div>
    </div>`;
}

export function bindProvidersTab(ctx, root) {
  root.querySelector("#ce-btn-add-version")?.addEventListener("click", async () => {
    const name = document.getElementById("ce-new-version-name")?.value?.trim();
    const pid = document.getElementById("ce-new-version-pid")?.value?.trim();
    if (!pid) return;
    await createVersion(ctx.productKey, { display_name: name || "New version", print_provider_id: pid, auto_mirror: false });
    ctx.reloadTab();
  });

  root.querySelectorAll(".ce-version-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this product version?")) return;
      await deleteVersion(btn.dataset.id);
      ctx.reloadTab();
    });
  });

  root.querySelectorAll(".ce-version-edit").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const v = (ctx.providersData?.versions || []).find((x) => x.id === btn.dataset.id);
      if (!v) return;
      const modal = document.getElementById("ce-version-modal");
      if (!modal) return;
      modal.hidden = false;
      modal.innerHTML = `
        <div class="ce-inline-modal-card">
          <h4>Version config · ${escapeHtml(v.display_name)}</h4>
          <div class="field"><label>Display name</label><input class="input" id="ce-vcfg-name" value="${escapeHtml(
            v.display_name || ""
          )}"></div>
          ${renderVersionConfigPanel(v)}
          <div class="ce-inline-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="ce-vcfg-cancel">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" id="ce-vcfg-save">Save</button>
          </div>
        </div>`;
      modal.querySelector("#ce-vcfg-cancel")?.addEventListener("click", () => {
        modal.hidden = true;
      });
      modal.querySelector("#ce-vcfg-save")?.addEventListener("click", async () => {
        const product_version_config = collectVersionConfigPanel(modal, v.product_version_config);
        await saveVersionConfig(v.id, {
          display_name: document.getElementById("ce-vcfg-name")?.value?.trim() || v.display_name,
          product_version_config,
          publish_enabled: v.publish_enabled,
          is_active: v.is_active,
          auto_mirror: false,
        });
        modal.hidden = true;
        ctx.reloadTab();
      });
    });
  });
}

export async function saveProvidersTab(ctx) {
  const active = [...document.querySelectorAll(".ce-provider-active:checked")].map((el) => Number(el.dataset.pid));
  await saveProviders(ctx.productKey, { active_print_provider_ids: active, auto_mirror: false });
}
