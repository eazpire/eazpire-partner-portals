import { checkDirty } from "./editor-dirty.js";
import { snapshotProvidersTab, syncProvidersDomState } from "./tabs/providers.js";
import { snapshotPrintAreaTab, syncPrintAreaDomState } from "./tabs/print-area.js";
import { snapshotMetaTab } from "./tabs/meta.js";
import { snapshotMockupsTab } from "./tabs/mockups.js";
import { snapshotVariantsTab } from "./tabs/variants.js";
import { snapshotAutomationsTab } from "./tabs/automations.js";
import { snapshotVisibilityState } from "./editor-visibility.js";

function withVisibility(ctx, base) {
  const visibility = snapshotVisibilityState(ctx);
  if (base == null && visibility == null) return null;
  return { ...(base || {}), visibility };
}

const SAVE_DISABLED_TABS = new Set(["template", "products", "review"]);

export function tabSaveDisabled(tabId) {
  return SAVE_DISABLED_TABS.has(tabId);
}

export function syncActiveTabDom(ctx) {
  if (!ctx) return;
  if (ctx.activeTab === "provider") syncProvidersDomState(ctx);
  if (ctx.activeTab === "print_area") syncPrintAreaDomState(ctx);
}

export function snapshotActiveTab(ctx) {
  if (!ctx) return null;
  switch (ctx.activeTab) {
    case "provider":
      return withVisibility(ctx, ctx.providersTabState ? snapshotProvidersTab(ctx) : null);
    case "print_area":
      return withVisibility(ctx, snapshotPrintAreaTab(ctx));
    case "meta_data":
      return withVisibility(ctx, snapshotMetaTab());
    case "mockups":
      return withVisibility(ctx, snapshotMockupsTab());
    case "variants":
      return withVisibility(ctx, snapshotVariantsTab());
    case "automations":
      return withVisibility(ctx, snapshotAutomationsTab());
    default:
      return withVisibility(ctx, null);
  }
}

export function notifyActiveTabDirty(ctx) {
  const state = snapshotActiveTab(ctx);
  if (state == null) return;
  checkDirty(state);
}

export function bindTabDirtyInputs(root, ctx) {
  if (!root || tabSaveDisabled(ctx?.activeTab)) return;
  const handler = () => notifyActiveTabDirty(ctx);
  root.addEventListener("input", handler);
  root.addEventListener("change", handler);
}
