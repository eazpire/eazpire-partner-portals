import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveAutomations } from "../api.js";

export function renderAutomationsTab(ctx) {
  const versions = ctx.bundle.versions || [];
  const version = versions.find((v) => v.id === ctx.selectedVersionId) || versions[0];
  const auto = version?.auto_publish_config || {};
  const versionOptions = versions
    .map(
      (v) =>
        `<option value="${escapeHtml(v.id)}" ${v.id === version?.id ? "selected" : ""}>${escapeHtml(v.display_name)}</option>`
    )
    .join("");
  return `
    <div class="ce-tab-panel">
      <div class="ce-automation-layout">
        <aside class="ce-automation-side">
          <div class="field"><label>Product version</label>
            <select class="input" id="ce-auto-version">${versionOptions}</select></div>
          <div class="ce-hint">Marketplace sections</div>
          <div class="ce-check-list">
            <label class="ce-check-row"><input type="checkbox" id="ce-auto-publish" ${
              auto.auto_publish_enabled ? "checked" : ""
            } /> Printify publishing</label>
            <label class="ce-check-row"><input type="checkbox" id="ce-auto-shopify" ${
              auto.automation_shopify_sync_enabled ? "checked" : ""
            } /> Shopify sync</label>
            <label class="ce-check-row"><input type="checkbox" id="ce-auto-amazon" ${
              auto.automation_amazon_publish_enabled ? "checked" : ""
            } /> Amazon publish</label>
          </div>
        </aside>
        <section class="ce-automation-main">
          <h3 class="ce-section-title">Social automations</h3>
          <div class="field"><label>automation_social JSON</label>
            <textarea class="textarea ce-code" id="ce-auto-social" rows="10">${escapeHtml(
              JSON.stringify(auto.automation_social || {}, null, 2)
            )}</textarea></div>
        </section>
      </div>
    </div>`;
}

export function bindAutomationsTab(ctx, root) {
  root.querySelector("#ce-auto-version")?.addEventListener("change", (e) => {
    ctx.selectedVersionId = e.target.value;
    ctx.reloadTab();
  });
}

export async function saveAutomationsTab(ctx) {
  const versionId = document.getElementById("ce-auto-version")?.value || ctx.selectedVersionId;
  if (!versionId) return;
  let automation_social = null;
  try {
    const raw = document.getElementById("ce-auto-social")?.value?.trim();
    if (raw) automation_social = JSON.parse(raw);
  } catch {
    throw new Error("Invalid social automation JSON");
  }
  await saveAutomations(versionId, {
    auto_publish_enabled: document.getElementById("ce-auto-publish")?.checked,
    automation_shopify_sync_enabled: document.getElementById("ce-auto-shopify")?.checked,
    automation_amazon_publish_enabled: document.getElementById("ce-auto-amazon")?.checked,
    automation_social,
    auto_mirror: false,
  });
}
