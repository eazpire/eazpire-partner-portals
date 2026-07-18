import { escapeHtml } from "/partner/shared/js/partner-api.js";
import { resolveActivePrintProviderIds } from "./active-provider-ids.js";

/** Tabs that use the shared provider / version subheader stack. */
export const EDITOR_SUBNAV_TAB_IDS = new Set([
  "template",
  "mockups",
  "variants",
  "print_area",
  "shipping",
  "meta_data",
  "products",
  "automations",
]);

export const CE_SUBNAV_DRAWER_KEY = "admin_catalog_editor_subnav_collapsed";

export function tabUsesEditorSubnav(tabId) {
  return EDITOR_SUBNAV_TAB_IDS.has(tabId);
}

export function isSubnavDrawerCollapsed() {
  return sessionStorage.getItem(CE_SUBNAV_DRAWER_KEY) === "1";
}

export function setSubnavDrawerCollapsed(collapsed) {
  sessionStorage.setItem(CE_SUBNAV_DRAWER_KEY, collapsed ? "1" : "0");
}

export function getActiveProviderIds(ctx) {
  if (ctx.providersTabState?.activeIds?.size) {
    return [...ctx.providersTabState.activeIds].map((id) => String(id));
  }

  const ids = resolveActivePrintProviderIds({
    active_providers: ctx.bundle?.active_providers,
    merged_providers: ctx.providersData?.merged_providers,
    publish_plans: ctx.bundle?.publish_plans,
    versions: ctx.bundle?.versions,
  });

  return [...ids].map((id) => String(id));
}

export function getVersionsForProvider(ctx, printProviderId) {
  const pid = String(printProviderId ?? ctx.selectedPrintProviderId ?? "");
  return (ctx.bundle?.versions || [])
    .filter((v) => String(v.external_provider_id) === pid)
    .slice()
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
}

export function versionDisplayName(version, idx = 0) {
  if (!version) return "Version";
  if (version.display_name) return version.display_name;
  return idx === 0 ? "Standard" : `Version ${idx + 1}`;
}

export function ensureEditorSelections(ctx) {
  const providerIds = getActiveProviderIds(ctx);
  if (providerIds.length) {
    if (!ctx.selectedPrintProviderId || !providerIds.includes(String(ctx.selectedPrintProviderId))) {
      ctx.selectedPrintProviderId = providerIds[0];
    }
  } else {
    ctx.selectedPrintProviderId = null;
  }

  const versions = getVersionsForProvider(ctx, ctx.selectedPrintProviderId);
  if (!versions.length) {
    ctx.selectedVersionId = null;
    return;
  }
  const match = versions.find((v) => String(v.id) === String(ctx.selectedVersionId));
  if (!match) ctx.selectedVersionId = versions[0].id;
}

export function getSubnavVisibility(ctx) {
  const providerIds = getActiveProviderIds(ctx);
  const versions = getVersionsForProvider(ctx, ctx.selectedPrintProviderId);
  const showProviders = providerIds.length > 0;
  const showVersions = versions.length > 1;
  return {
    showStack: showProviders || showVersions,
    showProviders,
    showVersions,
    providerIds,
    versions,
  };
}

export function providerLabel(ctx, pid) {
  const fp = (ctx.bundle?.providers || []).find((p) => String(p.external_provider_id) === String(pid));
  return fp?.name || `Provider ${pid}`;
}

export function renderVersionPills(versions, selectedVersionId) {
  return versions
    .map((v, idx) => {
      const name = versionDisplayName(v, idx);
      const active = String(v.id) === String(selectedVersionId) ? " active" : "";
      const badge = idx === 0 ? `<span class="ce-prov-ver-badge">Standard</span>` : "";
      return `<button type="button" class="ce-version-pill ce-prov-ver-tab${active}" data-version-id="${escapeHtml(
        String(v.id)
      )}" role="tab" aria-selected="${active ? "true" : "false"}">${badge}<span>${escapeHtml(name)}</span></button>`;
    })
    .join("");
}
