import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { saveAutomations } from "../api.js";
import { getVersionsForProvider, versionDisplayName } from "../editor-subnav.js";

export function renderAutomationsTab(ctx) {
  const versions = getVersionsForProvider(ctx, ctx.selectedPrintProviderId);
  const version =
    versions.find((v) => String(v.id) === String(ctx.selectedVersionId)) || versions[0] || null;
  const auto = version?.auto_publish_config || {};

  return `
    <div class="ce-tab-panel">
      <div class="ce-automation-layout">
        <aside class="ce-automation-side">
          <div class="ce-hint">Marketplace sections${
            version ? ` · ${escapeHtml(versionDisplayName(version, versions.indexOf(version)))}` : ""
          }</div>
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

export function bindAutomationsTab() {
  /* version selection lives in editor subnav */
}

export async function saveAutomationsTab(ctx) {
  const versionId = ctx.selectedVersionId;
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
