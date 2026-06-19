import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { fetchProvidersBundle, saveProviders, createVersion, deleteVersion, saveVersionConfig } from "../api.js";

export async function loadProvidersTab(ctx) {
  const data = await fetchProvidersBundle(ctx.productKey);
  ctx.providersData = data;
  return renderProvidersTab(ctx, data);
}

function renderProvidersTab(ctx, data) {
  const activeIds = new Set((data.active_providers || []).map((r) => Number(r.print_provider_id)));
  const providerRows = (data.providers || [])
    .map((fp) => {
      const pid = Number(fp.external_provider_id);
      const checked = activeIds.has(pid) ? "checked" : "";
      return `<label class="ce-check-row">
        <input type="checkbox" class="ce-provider-active" data-pid="${pid}" ${checked} />
        <span><strong>${escapeHtml(fp.name)}</strong> · ID ${escapeHtml(fp.external_provider_id)}</span>
      </label>`;
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
      <h3 class="ce-section-title">Product versions</h3>
      <div class="ce-inline-actions">
        <input class="input" id="ce-new-version-name" placeholder="New version name" />
        <input class="input" id="ce-new-version-pid" placeholder="Print provider ID" />
        <button type="button" class="btn btn-secondary" id="ce-btn-add-version">Add version</button>
      </div>
      <table class="data-table ce-table"><thead><tr><th>Name</th><th>Provider</th><th>Publish</th><th></th></tr></thead>
        <tbody>${versionRows || "<tr><td colspan=\"4\">No versions yet.</td></tr>"}</tbody></table>
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
      const name = prompt("Display name", v.display_name);
      if (name == null) return;
      await saveVersionConfig(v.id, {
        display_name: name,
        product_version_config: v.product_version_config,
        publish_enabled: v.publish_enabled,
        is_active: v.is_active,
        auto_mirror: false,
      });
      ctx.reloadTab();
    });
  });
}

export async function saveProvidersTab(ctx) {
  const active = [...document.querySelectorAll(".ce-provider-active:checked")].map((el) => Number(el.dataset.pid));
  await saveProviders(ctx.productKey, { active_print_provider_ids: active, auto_mirror: false });
}
