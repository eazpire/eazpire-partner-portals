import { checkDirty } from "./editor-dirty.js";
import { snapshotProvidersTab, syncProvidersDomState } from "./tabs/providers.js";
import { snapshotPrintAreaTab } from "./tabs/print-area.js";
import { snapshotMetaTab } from "./tabs/meta.js";
import { snapshotMockupsTab } from "./tabs/mockups.js";
import { snapshotVariantsTab } from "./tabs/variants.js";
import { snapshotAutomationsTab } from "./tabs/automations.js";

const SAVE_DISABLED_TABS = new Set(["template", "products"]);

export function tabSaveDisabled(tabId) {
  return SAVE_DISABLED_TABS.has(tabId);
}

export function syncActiveTabDom(ctx) {
  if (!ctx) return;
  if (ctx.activeTab === "provider") syncProvidersDomState(ctx);
}

export function snapshotActiveTab(ctx) {
  if (!ctx) return null;
  switch (ctx.activeTab) {
    case "provider":
      return ctx.providersTabState ? snapshotProvidersTab(ctx) : null;
    case "print_area":
      return snapshotPrintAreaTab(ctx);
    case "meta_data":
      return snapshotMetaTab();
    case "mockups":
      return snapshotMockupsTab();
    case "variants":
      return snapshotVariantsTab();
    case "automations":
      return snapshotAutomationsTab();
    default:
      return null;
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
